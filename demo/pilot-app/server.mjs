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
import {
  assertPostgresIdentifier,
  databaseUrlWithSearchPath,
  quoteIdentifier,
  sessionIdFromHeader,
  sessionInfo,
  sessionSchema,
} from "./session.mjs";

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
const sessionMode = process.env.REUX_DEMO_SESSION_MODE ?? "isolated";
const baseDatabaseUrl = process.env[config.databaseUrlEnv];
const databases = new Map();

if (!baseDatabaseUrl) {
  throw new Error(`database URL environment variable ${config.databaseUrlEnv} is not set`);
}

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
    await Promise.all([...databases.values()].map(({ db }) => db.end?.()));
    process.exit(0);
  });
}

async function route(request, response) {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

  if (url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, module: "pilot", databaseUrlEnv: config.databaseUrlEnv, schema: demoSchema, sessionMode });
    return;
  }

  if (url.pathname === "/api/setup" && method === "POST") {
    const body = await readJson(request);
    assertSetupAllowed(request, body);
    sendJson(response, 200, await setupDemo(request));
    return;
  }

  if (url.pathname === "/api/session/reset" && method === "POST") {
    sendJson(response, 200, await setupDemo(request));
    return;
  }

  if (url.pathname === "/api/dashboard" && method === "GET") {
    sendJson(response, 200, await dashboard(request));
    return;
  }

  if (url.pathname === "/api/actions/capture-payment" && method === "POST") {
    const body = await readJson(request);
    sendJson(response, 200, await runTransaction(request, "capturePayment", [body.orderId ?? demoIds.order, body.amount ?? "250"]));
    return;
  }

  if (url.pathname === "/api/actions/mark-paid" && method === "POST") {
    const body = await readJson(request);
    sendJson(response, 200, await runTransaction(request, "markOrderPaid", [body.orderId ?? demoIds.order]));
    return;
  }

  if (url.pathname === "/api/actions/credit-account" && method === "POST") {
    const body = await readJson(request);
    sendJson(response, 200, await runTransaction(request, "creditAccount", [body.accountId ?? demoIds.account, body.amount ?? "25"]));
    return;
  }

  if (url.pathname === "/api/actions/process-outbox" && method === "POST") {
    sendJson(response, 200, await processDemoOutbox(request));
    return;
  }

  if (method !== "GET") {
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  serveStatic(url.pathname, response);
}

async function setupDemo(request) {
  const context = requestContext(request);
  await ensureDemoSchema(context);
  await applyMigrations(context.db, config.migrationsDir);
  await ensureDemoOutboxTable(context);
  const reset = await resetSeed(context.db, source, seed);
  return { ok: true, reset, session: sessionInfo(context) };
}

async function dashboard(request) {
  const context = requestContext(request);
  await ensureDemoSchema(context);
  await ensureDemoOutboxTable(context);
  const status = await migrationStatus(context.db, config.migrationsDir);
  let queryResults;
  try {
    queryResults = await Promise.all([
      runSqlQuery(context.db, emitQuerySql(source, "accountOrders"), ["0"]),
      runSqlQuery(context.db, emitQuerySql(source, "accountBalances"), ["0"]),
      runSqlQuery(context.db, emitQuerySql(source, "orderPayments"), ["0"]),
      runSqlQuery(context.db, emitQuerySql(source, "accountOrderSummary"), ["0"]),
      runSqlQuery(context.db, emitQuerySql(source, "openOrders"), ["0"]),
      runSqlQuery(
      context.db,
      `SELECT id, event_type, payload, status, attempts, created_at FROM ${context.outboxTable} ORDER BY created_at DESC LIMIT 10;`,
      [],
    ),
    ]);
  } catch (error) {
    if (isMissingRelation(error)) {
      return emptyDashboard(status, context);
    }
    throw error;
  }
  const [orders, balances, payments, summary, openOrders, outbox] = queryResults;

  return {
    ids: demoIds,
    session: sessionInfo(context),
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

function emptyDashboard(status, context) {
  return {
    ids: demoIds,
    session: sessionInfo(context),
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

async function runTransaction(request, name, params) {
  const context = requestContext(request);
  await ensureDemoSchema(context);
  await ensureDemoOutboxTable(context);
  const result = await runTransactionSql(
    context.db,
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
    session: sessionInfo(context),
  };
}

async function processDemoOutbox(request) {
  const context = requestContext(request);
  await ensureDemoSchema(context);
  await ensureDemoOutboxTable(context);
  const result = await processOutboxEvents(
    context.db,
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
    session: sessionInfo(context),
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

function requestContext(request) {
  const sessionId = sessionMode === "shared" ? "" : sessionIdFromHeader(request.headers["x-reux-demo-session"]);
  const schema = sessionSchema(demoSchema, sessionId);
  return schemaContext(schema, sessionId);
}

function schemaContext(schema, sessionId) {
  assertPostgresIdentifier(schema, "demo schema must be a PostgreSQL identifier");
  let context = databases.get(schema);
  if (context) return context;

  const quotedSchema = quoteIdentifier(schema);
  const previousUrl = process.env[config.databaseUrlEnv];
  process.env[config.databaseUrlEnv] = databaseUrlWithSearchPath(baseDatabaseUrl, schema, config.databaseUrlEnv);
  try {
    context = {
      db: createPostgresDatabase(config),
      schema,
      quotedSchema,
      outboxTable: `${quotedSchema}._dl_outbox`,
      sessionId,
    };
    databases.set(schema, context);
    return context;
  } finally {
    if (previousUrl === undefined) {
      delete process.env[config.databaseUrlEnv];
    } else {
      process.env[config.databaseUrlEnv] = previousUrl;
    }
  }
}

async function ensureDemoSchema(context) {
  await context.db.query(`CREATE SCHEMA IF NOT EXISTS ${context.quotedSchema};`);
}

async function ensureDemoOutboxTable(context) {
  await context.db.query(`
CREATE TABLE IF NOT EXISTS ${context.outboxTable} (
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
  await context.db.query(`ALTER TABLE ${context.outboxTable} ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;`);
  await context.db.query(`ALTER TABLE ${context.outboxTable} ADD COLUMN IF NOT EXISTS last_error text NULL;`);
  await context.db.query(`ALTER TABLE ${context.outboxTable} ADD COLUMN IF NOT EXISTS claimed_at timestamptz NULL;`);
  await context.db.query(`CREATE INDEX IF NOT EXISTS _dl_outbox_status_created_at_idx ON ${context.outboxTable} (status, created_at);`);
  await context.db.query(`CREATE INDEX IF NOT EXISTS _dl_outbox_status_claimed_at_idx ON ${context.outboxTable} (status, claimed_at);`);
}
