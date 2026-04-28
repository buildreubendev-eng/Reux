import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { emitQuerySql, emitTransactionSql, transactionRetryAttempts } from "../../dist/compiler.js";
import { loadConfig } from "../../dist/config.js";
import {
  applyMigrations,
  createPostgresDatabase,
  migrationStatus,
  processOutboxEvents,
  runSqlQuery,
  runTransactionSql,
} from "../../dist/runtime.js";
import { parseSeedSpec, resetSeed } from "../../dist/seed.js";

const rootDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const publicDir = join(rootDir, "demo", "pilot-app", "public");
const sourcePath = join(rootDir, "examples", "pilot_reux.dl");
const seedPath = join(rootDir, "pilot", "seeds", "smoke.json");
const config = loadConfig(rootDir, "pilot/dl.json");
const source = readFileSync(sourcePath, "utf8");
const seed = parseSeedSpec(`@${seedPath}`);
const demoSchema = process.env.REUX_DEMO_SCHEMA ?? "reux_demo";
const setupToken = process.env.REUX_DEMO_SETUP_TOKEN ?? "";
const host = process.env.HOST ?? "0.0.0.0";
const publicHost = host === "0.0.0.0" ? "127.0.0.1" : host;
const port = Number.parseInt(process.env.PORT ?? process.env.REUX_DEMO_PORT ?? "4173", 10);
const quotedDemoSchema = quoteIdentifier(demoSchema);
const outboxTable = `${quotedDemoSchema}._dl_outbox`;
process.env[config.databaseUrlEnv] = databaseUrlWithSearchPath(
  process.env[config.databaseUrlEnv],
  demoSchema,
  config.databaseUrlEnv,
);
const db = createPostgresDatabase(config);

const demoIds = {
  account: "00000000-0000-4000-8000-000000000001",
  product: "00000000-0000-4000-8000-000000000002",
  order: "00000000-0000-4000-8000-000000000003",
  payment: "00000000-0000-4000-8000-000000000004",
};

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendJson(response, statusCode, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, host, () => {
  console.log(`Reux pilot app listening on http://${publicHost}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    server.close();
    await db.end?.();
    process.exit(0);
  });
}

async function route(request, response) {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

  if (url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, module: "pilot", databaseUrlEnv: config.databaseUrlEnv, schema: demoSchema });
    return;
  }

  if (url.pathname === "/api/setup" && method === "POST") {
    const body = await readJson(request);
    assertSetupAllowed(request, body);
    await ensureDemoSchema();
    await applyMigrations(db, config.migrationsDir);
    const reset = await resetSeed(db, source, seed);
    sendJson(response, 200, { ok: true, reset });
    return;
  }

  if (url.pathname === "/api/dashboard" && method === "GET") {
    sendJson(response, 200, await dashboard());
    return;
  }

  if (url.pathname === "/api/actions/capture-payment" && method === "POST") {
    const body = await readJson(request);
    sendJson(response, 200, await runTransaction("capturePayment", [body.orderId ?? demoIds.order, body.amount ?? "250"]));
    return;
  }

  if (url.pathname === "/api/actions/mark-paid" && method === "POST") {
    const body = await readJson(request);
    sendJson(response, 200, await runTransaction("markOrderPaid", [body.orderId ?? demoIds.order]));
    return;
  }

  if (url.pathname === "/api/actions/credit-account" && method === "POST") {
    const body = await readJson(request);
    sendJson(response, 200, await runTransaction("creditAccount", [body.accountId ?? demoIds.account, body.amount ?? "25"]));
    return;
  }

  if (url.pathname === "/api/actions/process-outbox" && method === "POST") {
    sendJson(response, 200, await processDemoOutbox());
    return;
  }

  if (method !== "GET") {
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  serveStatic(url.pathname, response);
}

async function dashboard() {
  await ensureDemoSchema();
  await ensureDemoOutboxTable();
  const status = await migrationStatus(db, config.migrationsDir);
  let queryResults;
  try {
    queryResults = await Promise.all([
      runSqlQuery(db, emitQuerySql(source, "accountOrders"), ["0"]),
      runSqlQuery(db, emitQuerySql(source, "accountBalances"), ["0"]),
      runSqlQuery(db, emitQuerySql(source, "orderPayments"), ["0"]),
      runSqlQuery(db, emitQuerySql(source, "accountOrderSummary"), ["0"]),
      runSqlQuery(db, emitQuerySql(source, "openOrders"), ["0"]),
      runSqlQuery(
      db,
      `SELECT id, event_type, payload, status, attempts, created_at FROM ${outboxTable} ORDER BY created_at DESC LIMIT 10;`,
      [],
    ),
    ]);
  } catch (error) {
    if (isMissingRelation(error)) {
      return emptyDashboard(status);
    }
    throw error;
  }
  const [orders, balances, payments, summary, openOrders, outbox] = queryResults;

  return {
    ids: demoIds,
    setupRequired: false,
    migrations: {
      applied: status.applied.length,
      pending: status.pending.map((migration) => migration.filename),
    },
    orders: orders.rows,
    balances: balances.rows,
    payments: payments.rows,
    summary: summary.rows,
    openOrders: openOrders.rows,
    outbox: outbox.rows,
  };
}

function emptyDashboard(status) {
  return {
    ids: demoIds,
    setupRequired: true,
    migrations: {
      applied: status.applied.length,
      pending: status.pending.map((migration) => migration.filename),
    },
    orders: [],
    balances: [],
    payments: [],
    summary: [],
    openOrders: [],
    outbox: [],
  };
}

async function runTransaction(name, params) {
  await ensureDemoSchema();
  await ensureDemoOutboxTable();
  const result = await runTransactionSql(
    db,
    emitTransactionSql(source, name),
    params,
    transactionRetryAttempts(source, name),
  );
  return {
    ok: true,
    name,
    attempts: result.attempts,
    statements: result.statements,
    rowCounts: result.rowCounts,
    outboxEvents: result.outboxEvents,
    afterCommit: result.afterCommit,
    bindings: result.bindings,
  };
}

async function processDemoOutbox() {
  await ensureDemoSchema();
  await ensureDemoOutboxTable();
  const result = await processOutboxEvents(
    db,
    {
      AccountCredited: () => undefined,
      OrderPaid: () => undefined,
      PaymentCaptured: () => undefined,
    },
    10,
  );
  return {
    ok: true,
    processed: result.processed.length,
    failed: result.failed.length,
    events: {
      processed: result.processed,
      failed: result.failed,
    },
  };
}

function serveStatic(pathname, response) {
  const safePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const resolved = resolve(publicDir, safePath);
  const insidePublic = resolved === publicDir || resolved.startsWith(`${publicDir}${sep}`);
  if (!insidePublic || !existsSync(resolved)) {
    sendJson(response, 404, { error: "not found" });
    return;
  }
  response.writeHead(200, { "content-type": contentType(resolved) });
  createReadStream(resolved).pipe(response);
}

function readJson(request) {
  return new Promise((resolveJson, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolveJson({});
        return;
      }
      try {
        resolveJson(JSON.parse(body));
      } catch (error) {
        reject(new Error("invalid JSON request body"));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function contentType(pathname) {
  switch (extname(pathname)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function assertSetupAllowed(request, body) {
  if (!setupToken) return;
  const headerToken = request.headers["x-reux-demo-token"];
  const provided = Array.isArray(headerToken) ? headerToken[0] : headerToken ?? body.setupToken;
  if (provided !== setupToken) {
    const error = new Error("setup requires a valid demo admin token");
    error.statusCode = 403;
    throw error;
  }
}

function isMissingRelation(error) {
  return error?.code === "42P01" || /relation ".+" does not exist/.test(error?.message ?? "");
}

async function ensureDemoSchema() {
  await db.query(`CREATE SCHEMA IF NOT EXISTS ${quotedDemoSchema};`);
}

async function ensureDemoOutboxTable() {
  await db.query(`
CREATE TABLE IF NOT EXISTS ${outboxTable} (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz NULL,
  processed_at timestamptz NULL
);
`);
  await db.query(`ALTER TABLE ${outboxTable} ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;`);
  await db.query(`ALTER TABLE ${outboxTable} ADD COLUMN IF NOT EXISTS last_error text NULL;`);
  await db.query(`ALTER TABLE ${outboxTable} ADD COLUMN IF NOT EXISTS claimed_at timestamptz NULL;`);
  await db.query(`CREATE INDEX IF NOT EXISTS _dl_outbox_status_created_at_idx ON ${outboxTable} (status, created_at);`);
  await db.query(`CREATE INDEX IF NOT EXISTS _dl_outbox_status_claimed_at_idx ON ${outboxTable} (status, claimed_at);`);
}

function databaseUrlWithSearchPath(value, schema, envName) {
  if (!value) {
    throw new Error(`database URL environment variable ${envName} is not set`);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error("REUX_DEMO_SCHEMA must be a PostgreSQL identifier");
  }

  const url = new URL(value);
  const options = url.searchParams.get("options");
  const searchPath = `-c search_path=${schema},public`;
  url.searchParams.set("options", options ? `${options} ${searchPath}` : searchPath);
  return url.toString();
}

function quoteIdentifier(value) {
  return `"${value.replace(/"/g, '""')}"`;
}
