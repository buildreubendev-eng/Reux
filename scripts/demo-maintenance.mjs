import { pathToFileURL } from "node:url";
import pg from "pg";

export const defaultMaintenanceKeepSessions = ["healthcheck", "healthcheckci"];
export const defaultMaintenanceMaxSimulationRuns = 200;

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2), process.env);
}

export async function main(args = [], env = process.env) {
  const apply = args.includes("--apply");
  const help = args.includes("--help") || args.includes("-h");
  const baseSchema = optionValue(args, "--schema") ?? env.REUX_DEMO_SCHEMA ?? "reux_demo";
  const databaseUrlEnv = optionValue(args, "--database-url-env") ?? "DATABASE_URL";
  const maxSimulationRuns = parsePositiveInteger(
    optionValue(args, "--max-simulation-runs") ?? env.REUX_DEMO_MAX_SIMULATION_RUNS,
    defaultMaintenanceMaxSimulationRuns,
  );
  const keepSessions = maintenanceKeepSessions(
    optionValue(args, "--keep") ?? env.REUX_DEMO_MAINTENANCE_KEEP_SESSIONS ?? "",
  );

  if (help) {
    console.log(`Usage: node scripts/demo-maintenance.mjs [--apply] [--schema=name] [--database-url-env=DATABASE_URL] [--keep=session1,session2] [--max-simulation-runs=200]

Dry-run by default. Lists isolated public demo schemas matching <schema>_s_<session>,
expired Business Simulator saved runs, and saved-run overflow beyond the retention cap.
Pass --apply to drop candidate schemas and delete candidate saved runs.

Environment:
  DATABASE_URL                              PostgreSQL connection string by default.
  REUX_DEMO_SCHEMA                         Base demo schema. Defaults to reux_demo.
  REUX_DEMO_MAINTENANCE_KEEP_SESSIONS      Comma-separated session ids to keep.
  REUX_DEMO_MAX_SIMULATION_RUNS            Saved Business Simulator run retention cap.
`);
    return;
  }

  assertIdentifier(baseSchema, "base schema");
  const databaseUrl = env[databaseUrlEnv];
  if (!databaseUrl) {
    throw new Error(`database URL environment variable ${databaseUrlEnv} is not set`);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const schemas = await listSessionSchemas(client, baseSchema);
    const schemaCandidates = schemas.filter((schema) => !keepSessions.has(sessionIdFromSchema(baseSchema, schema)));
    const simulationRuns = await planSimulationRunMaintenance(client, baseSchema, maxSimulationRuns);
    const droppedSchemas = [];
    const deletedSimulationRuns = [];

    if (apply) {
      for (const schema of schemaCandidates) {
        await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE;`);
        droppedSchemas.push(schema);
      }
      if (simulationRuns.candidateIds.length > 0) {
        await client.query(
          `DELETE FROM ${simulationRunTable(baseSchema)} WHERE id = ANY($1::text[]);`,
          [simulationRuns.candidateIds],
        );
        deletedSimulationRuns.push(...simulationRuns.candidateIds);
      }
    }

    console.log(JSON.stringify({
      ok: true,
      mode: apply ? "apply" : "dry-run",
      baseSchema,
      keepSessions: [...keepSessions],
      sessionSchemas: {
        candidateCount: schemaCandidates.length,
        candidates: schemaCandidates,
        dropped: droppedSchemas,
      },
      simulationRuns: {
        tableExists: simulationRuns.tableExists,
        maxRecords: maxSimulationRuns,
        activeCount: simulationRuns.activeCount,
        expiredCount: simulationRuns.expiredIds.length,
        overflowCount: simulationRuns.overflowIds.length,
        candidateCount: simulationRuns.candidateIds.length,
        expiredIds: simulationRuns.expiredIds,
        overflowIds: simulationRuns.overflowIds,
        deleted: deletedSimulationRuns,
      },
    }, null, 2));
  } finally {
    await client.end();
  }
}

export async function listSessionSchemas(client, schema) {
  const prefix = `${schema}_s_`;
  const result = await client.query(
    `
SELECT nspname
FROM pg_namespace
WHERE nspname LIKE $1
ORDER BY nspname ASC;
`,
    [`${prefix}%`],
  );
  return result.rows
    .map((row) => row.nspname)
    .filter((name) => isManagedSessionSchema(schema, name));
}

export async function planSimulationRunMaintenance(client, schema, maxRecords = defaultMaintenanceMaxSimulationRuns) {
  const table = simulationRunTable(schema);
  const tableResult = await client.query("SELECT to_regclass($1) AS name;", [`${schema}._reux_simulation_runs`]);
  if (!tableResult.rows[0]?.name) {
    return {
      tableExists: false,
      activeCount: 0,
      expiredIds: [],
      overflowIds: [],
      candidateIds: [],
    };
  }

  const expired = await client.query(
    `SELECT id FROM ${table} WHERE expires_at <= now() ORDER BY expires_at ASC, created_at ASC;`,
  );
  const overflow = await client.query(
    `
SELECT id
FROM ${table}
WHERE expires_at > now()
ORDER BY created_at DESC
OFFSET $1;
`,
    [maxRecords],
  );
  const active = await client.query(`SELECT count(*) AS count FROM ${table} WHERE expires_at > now();`);
  const expiredIds = expired.rows.map((row) => row.id);
  const overflowIds = overflow.rows.map((row) => row.id);
  const candidateIds = [...new Set([...expiredIds, ...overflowIds])];

  return {
    tableExists: true,
    activeCount: Number(active.rows[0]?.count ?? 0),
    expiredIds,
    overflowIds,
    candidateIds,
  };
}

export function maintenanceKeepSessions(value) {
  return new Set(
    [
      ...defaultMaintenanceKeepSessions,
      ...splitCsv(value),
    ].map(normalizeSessionId).filter(Boolean),
  );
}

export function isManagedSessionSchema(schema, name) {
  return new RegExp(`^${escapeRegExp(schema)}_s_[a-z0-9]{8,16}$`).test(name);
}

export function sessionIdFromSchema(schema, name) {
  return name.slice(`${schema}_s_`.length);
}

export function simulationRunTable(schema) {
  return `${quoteIdentifier(schema)}._reux_simulation_runs`;
}

export function optionValue(args, name) {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

export function splitCsv(value) {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

export function normalizeSessionId(raw) {
  return String(raw).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
}

export function assertIdentifier(value, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${label} must be a PostgreSQL identifier`);
  }
}

export function quoteIdentifier(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
