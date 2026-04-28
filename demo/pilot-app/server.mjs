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
const db = createPostgresDatabase(config);
const port = Number.parseInt(process.env.REUX_DEMO_PORT ?? "4173", 10);

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
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Reux pilot app listening on http://127.0.0.1:${port}`);
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
    sendJson(response, 200, { ok: true, module: "pilot", databaseUrlEnv: config.databaseUrlEnv });
    return;
  }

  if (url.pathname === "/api/setup" && method === "POST") {
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

  if (method !== "GET") {
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  serveStatic(url.pathname, response);
}

async function dashboard() {
  const status = await migrationStatus(db, config.migrationsDir);
  const [orders, balances, payments, summary, openOrders, outbox] = await Promise.all([
    runSqlQuery(db, emitQuerySql(source, "accountOrders"), ["0"]),
    runSqlQuery(db, emitQuerySql(source, "accountBalances"), ["0"]),
    runSqlQuery(db, emitQuerySql(source, "orderPayments"), ["0"]),
    runSqlQuery(db, emitQuerySql(source, "accountOrderSummary"), ["0"]),
    runSqlQuery(db, emitQuerySql(source, "openOrders"), ["0"]),
    runSqlQuery(
      db,
      "SELECT id, event_type, payload, status, attempts, created_at FROM _dl_outbox ORDER BY created_at DESC LIMIT 10;",
      [],
    ).catch(() => ({ rows: [], rowCount: 0 })),
  ]);

  return {
    ids: demoIds,
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

async function runTransaction(name, params) {
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
