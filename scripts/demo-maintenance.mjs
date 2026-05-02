import pg from "pg";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const help = args.includes("--help") || args.includes("-h");
const baseSchema = optionValue("--schema") ?? process.env.REUX_DEMO_SCHEMA ?? "reux_demo";
const databaseUrlEnv = optionValue("--database-url-env") ?? "DATABASE_URL";
const keepSessions = new Set(
  [
    "healthcheck",
    "healthcheckci",
    ...splitCsv(optionValue("--keep") ?? process.env.REUX_DEMO_MAINTENANCE_KEEP_SESSIONS ?? ""),
  ].map(normalizeSessionId).filter(Boolean),
);

if (help) {
  console.log(`Usage: node scripts/demo-maintenance.mjs [--apply] [--schema=name] [--database-url-env=DATABASE_URL] [--keep=session1,session2]

Dry-run by default. Lists isolated public demo schemas matching <schema>_s_<session>.
Pass --apply to drop candidate schemas with CASCADE.

Environment:
  DATABASE_URL                              PostgreSQL connection string by default.
  REUX_DEMO_SCHEMA                         Base demo schema. Defaults to reux_demo.
  REUX_DEMO_MAINTENANCE_KEEP_SESSIONS      Comma-separated session ids to keep.
`);
  process.exit(0);
}

assertIdentifier(baseSchema, "base schema");
const databaseUrl = process.env[databaseUrlEnv];
if (!databaseUrl) {
  throw new Error(`database URL environment variable ${databaseUrlEnv} is not set`);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const schemas = await listSessionSchemas(client, baseSchema);
  const candidates = schemas.filter((schema) => !keepSessions.has(sessionIdFromSchema(baseSchema, schema)));
  const dropped = [];

  if (apply) {
    for (const schema of candidates) {
      await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE;`);
      dropped.push(schema);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    mode: apply ? "apply" : "dry-run",
    baseSchema,
    keepSessions: [...keepSessions],
    candidateCount: candidates.length,
    candidates,
    dropped,
  }, null, 2));
} finally {
  await client.end();
}

async function listSessionSchemas(client, schema) {
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

function isManagedSessionSchema(schema, name) {
  return new RegExp(`^${escapeRegExp(schema)}_s_[a-z0-9]{8,16}$`).test(name);
}

function sessionIdFromSchema(schema, name) {
  return name.slice(`${schema}_s_`.length);
}

function optionValue(name) {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function splitCsv(value) {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function normalizeSessionId(raw) {
  return String(raw).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
}

function assertIdentifier(value, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${label} must be a PostgreSQL identifier`);
  }
}

function quoteIdentifier(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
