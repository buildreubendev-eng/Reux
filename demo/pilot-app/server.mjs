import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BusinessSimulatorValidationError,
  ReuxSimulationExecutionError,
  compareBusinessSimulatorScenarios,
  emitPostgresSchema,
  emitQuerySql,
  emitTransactionSql,
  getBusinessSimulation,
  getReuxSimulation,
  listBusinessSimulations,
  listReuxSimulations,
  runBusinessSimulator,
  runReuxSimulation,
  transactionRetryAttempts,
} from "../../dist/compiler.js";
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
import {
  collectSessionContextEvictions,
  defaultMaxSessionContexts,
  defaultSessionIdleMs,
  parsePositiveInteger,
  sessionCacheStats,
  touchSessionContext,
} from "./session-cache.mjs";
import { defaultJsonBodyLimitBytes, readJson } from "./http.mjs";
import { emptyOutboxSummary, summarizeOperationalDashboard, summarizeOutboxStats } from "./status.mjs";

const rootDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const publicDir = join(rootDir, "demo", "pilot-app", "public");
const config = loadConfig(rootDir, "pilot/dl.json");
const demoSchema = process.env.REUX_DEMO_SCHEMA ?? "reux_demo";
const setupToken = process.env.REUX_DEMO_SETUP_TOKEN ?? "";
const host = process.env.HOST ?? "0.0.0.0";
const publicHost = host === "0.0.0.0" ? "127.0.0.1" : host;
const port = Number.parseInt(process.env.PORT ?? process.env.REUX_DEMO_PORT ?? "4173", 10);
const sessionMode = process.env.REUX_DEMO_SESSION_MODE ?? "isolated";
const allowedOrigins = parseAllowedOrigins(process.env.REUX_DEMO_ALLOWED_ORIGINS ?? "*");
const corsMaxAgeSeconds = parsePositiveInteger(process.env.REUX_DEMO_CORS_MAX_AGE_SECONDS, 600);
const jsonBodyLimitBytes = parsePositiveInteger(process.env.REUX_DEMO_JSON_BODY_LIMIT_BYTES, defaultJsonBodyLimitBytes);
const maxSessionContexts = parsePositiveInteger(process.env.REUX_DEMO_MAX_SESSION_CONTEXTS, defaultMaxSessionContexts);
const sessionIdleMs = parsePositiveInteger(process.env.REUX_DEMO_SESSION_IDLE_MS, defaultSessionIdleMs);
const baseDatabaseUrl = process.env[config.databaseUrlEnv];
const databases = new Map();

if (!baseDatabaseUrl) {
  throw new Error(`database URL environment variable ${config.databaseUrlEnv} is not set`);
}

const commerceSource = readFileSync(join(rootDir, "examples", "pilot_reux.dl"), "utf8");
const logisticsSource = readFileSync(join(rootDir, "examples", "logistics_reux.dl"), "utf8");
const productSimulationSources = [
  "personal_finance.reux",
  "habit_consistency.reux",
  "workforce_change.reux",
  "operations_throughput.reux",
  "business_simulator.reux",
].map((filename) => ({
  filename,
  source: readFileSync(join(rootDir, "examples", "simulations", filename), "utf8"),
}));

const domains = {
  commerce: {
    key: "commerce",
    title: "Commerce Console",
    source: commerceSource,
    seed: parseSeedSpec(`@${join(rootDir, "pilot", "seeds", "smoke.json")}`),
    migrationsDir: config.migrationsDir,
    ids: {
      account: "00000000-0000-4000-8000-000000000001",
      product: "00000000-0000-4000-8000-000000000002",
      order: "00000000-0000-4000-8000-000000000003",
      payment: "00000000-0000-4000-8000-000000000004",
    },
    outboxHandlers: {
      AccountCredited: () => undefined,
      OrderPaid: () => undefined,
      PaymentCaptured: () => undefined,
    },
  },
  logistics: {
    key: "logistics",
    title: "Logistics Dispatch",
    source: logisticsSource,
    seed: parseSeedSpec(`@${join(rootDir, "examples", "seeds", "logistics_smoke.json")}`),
    schemaSql: emitPostgresSchema(logisticsSource),
    readyTable: "shipments",
    ids: {
      driver: "00000000-0000-4000-8000-200000000001",
      vehicle: "00000000-0000-4000-8000-200000000002",
      shipment: "00000000-0000-4000-8000-200000000003",
    },
    outboxHandlers: {
      ShipmentStarted: () => undefined,
      ShipmentDelivered: () => undefined,
      DriverCredited: () => undefined,
    },
  },
};

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode)
      ? error.statusCode
      : error instanceof BusinessSimulatorValidationError || error instanceof ReuxSimulationExecutionError
        ? 400
        : 500;
    sendJson(response, statusCode, errorResponseBody(error, statusCode));
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
  if (url.pathname.startsWith("/api/")) {
    applyCorsHeaders(request, response);
    if (method === "OPTIONS") {
      sendNoContent(response);
      return;
    }
  }

  if (url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      module: "pilot",
      databaseUrlEnv: config.databaseUrlEnv,
      schema: demoSchema,
      sessionMode,
      jsonBodyLimitBytes,
      sessionCache: sessionCacheStats(databases, { idleMs: sessionIdleMs, maxContexts: maxSessionContexts }),
      domains: Object.keys(domains),
      productSimulations: listProductSimulations().simulations.map((simulation) => simulation.name),
    });
    return;
  }

  if (url.pathname === "/api/ops" && method === "GET") {
    sendJson(response, 200, await operationsDashboard(request));
    return;
  }

  if (url.pathname === "/api/reux/simulations" && method === "GET") {
    sendJson(response, 200, listProductSimulations());
    return;
  }

  if (url.pathname.startsWith("/api/reux/simulations/") && url.pathname.endsWith("/run") && method === "POST") {
    const name = decodeURIComponent(url.pathname.slice("/api/reux/simulations/".length, -"/run".length));
    sendJson(response, 200, runProductSimulation(name, await readJson(request, { limitBytes: jsonBodyLimitBytes })));
    return;
  }

  if (url.pathname.startsWith("/api/reux/simulations/") && method === "GET") {
    const name = decodeURIComponent(url.pathname.slice("/api/reux/simulations/".length));
    sendJson(response, 200, getProductSimulation(name));
    return;
  }

  if (url.pathname === "/api/simulations" && method === "GET") {
    sendJson(response, 200, listBusinessSimulations());
    return;
  }

  if (url.pathname.startsWith("/api/simulations/") && method === "GET") {
    const id = decodeURIComponent(url.pathname.slice("/api/simulations/".length));
    sendJson(response, 200, businessSimulationTemplate(id));
    return;
  }

  if (url.pathname === "/api/simulations/run" && method === "POST") {
    sendJson(response, 200, businessSimulationRun(await readJson(request, { limitBytes: jsonBodyLimitBytes })));
    return;
  }

  if (url.pathname === "/api/scenarios/compare" && method === "POST") {
    sendJson(response, 200, businessScenarioCompare(await readJson(request, { limitBytes: jsonBodyLimitBytes })));
    return;
  }

  if (url.pathname === "/api/setup" && method === "POST") {
    const body = await readJson(request, { limitBytes: jsonBodyLimitBytes });
    assertSetupAllowed(request, body);
    sendJson(response, 200, await setupDemo(request, domains.commerce));
    return;
  }

  if (url.pathname === "/api/session/reset" && method === "POST") {
    sendJson(response, 200, await setupDemo(request, domains.commerce));
    return;
  }

  if (url.pathname === "/api/dashboard" && method === "GET") {
    sendJson(response, 200, await commerceDashboard(request));
    return;
  }

  if (url.pathname === "/api/actions/capture-payment" && method === "POST") {
    const body = await readJson(request, { limitBytes: jsonBodyLimitBytes });
    sendJson(response, 200, await runTransaction(request, domains.commerce, "capturePayment", [body.orderId ?? domains.commerce.ids.order, body.amount ?? "250"]));
    return;
  }

  if (url.pathname === "/api/actions/mark-paid" && method === "POST") {
    const body = await readJson(request, { limitBytes: jsonBodyLimitBytes });
    sendJson(response, 200, await runTransaction(request, domains.commerce, "markOrderPaid", [body.orderId ?? domains.commerce.ids.order]));
    return;
  }

  if (url.pathname === "/api/actions/credit-account" && method === "POST") {
    const body = await readJson(request, { limitBytes: jsonBodyLimitBytes });
    sendJson(response, 200, await runTransaction(request, domains.commerce, "creditAccount", [body.accountId ?? domains.commerce.ids.account, body.amount ?? "25"]));
    return;
  }

  if (url.pathname === "/api/actions/process-outbox" && method === "POST") {
    sendJson(response, 200, await processDemoOutbox(request, domains.commerce));
    return;
  }

  if (url.pathname === "/api/outbox/stats" && method === "GET") {
    sendJson(response, 200, await demoOutboxStats(request, domains.commerce));
    return;
  }

  if (url.pathname === "/api/logistics/setup" && method === "POST") {
    const body = await readJson(request, { limitBytes: jsonBodyLimitBytes });
    assertSetupAllowed(request, body);
    sendJson(response, 200, await setupDemo(request, domains.logistics));
    return;
  }

  if (url.pathname === "/api/logistics/session/reset" && method === "POST") {
    sendJson(response, 200, await setupDemo(request, domains.logistics));
    return;
  }

  if (url.pathname === "/api/logistics/dashboard" && method === "GET") {
    sendJson(response, 200, await logisticsDashboard(request));
    return;
  }

  if (url.pathname === "/api/logistics/actions/start-shipment" && method === "POST") {
    const body = await readJson(request, { limitBytes: jsonBodyLimitBytes });
    sendJson(response, 200, await runTransaction(request, domains.logistics, "startShipment", [body.shipmentId ?? domains.logistics.ids.shipment]));
    return;
  }

  if (url.pathname === "/api/logistics/actions/mark-delivered" && method === "POST") {
    const body = await readJson(request, { limitBytes: jsonBodyLimitBytes });
    sendJson(response, 200, await runTransaction(request, domains.logistics, "markDelivered", [body.shipmentId ?? domains.logistics.ids.shipment]));
    return;
  }

  if (url.pathname === "/api/logistics/actions/credit-driver" && method === "POST") {
    const body = await readJson(request, { limitBytes: jsonBodyLimitBytes });
    sendJson(response, 200, await runTransaction(request, domains.logistics, "creditDriver", [body.driverId ?? domains.logistics.ids.driver, body.amount ?? "40"]));
    return;
  }

  if (url.pathname === "/api/logistics/actions/process-outbox" && method === "POST") {
    sendJson(response, 200, await processDemoOutbox(request, domains.logistics));
    return;
  }

  if (url.pathname === "/api/logistics/outbox/stats" && method === "GET") {
    sendJson(response, 200, await demoOutboxStats(request, domains.logistics));
    return;
  }

  if (method !== "GET") {
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  serveStatic(url.pathname, response);
}

async function setupDemo(request, domain) {
  const context = requestContext(request);
  await ensureDemoSchema(context);
  await ensureDomainStore(context, domain);
  await ensureDemoOutboxTable(context);
  const reset = await resetSeed(context.db, domain.source, domain.seed);
  return { ok: true, domain: domain.key, reset, session: sessionInfo(context) };
}

function listProductSimulations() {
  return {
    simulations: productSimulationSources.flatMap(({ filename, source }) =>
      listReuxSimulations(source).simulations.map((simulation) => ({
        ...simulation,
        sourceFile: filename,
      })),
    ),
  };
}

function getProductSimulation(name) {
  const source = findProductSimulationSource(name);
  return {
    ...getReuxSimulation(source.source, name),
    sourceFile: source.filename,
  };
}

function runProductSimulation(name, body) {
  const source = findProductSimulationSource(name);
  return {
    ...runReuxSimulation(source.source, { ...body, simulationName: name }),
    sourceFile: source.filename,
  };
}

function findProductSimulationSource(name) {
  for (const source of productSimulationSources) {
    if (listReuxSimulations(source.source).simulations.some((simulation) => simulation.name === name)) {
      return source;
    }
  }
  const error = new Error(`simulation '${name}' was not found`);
  error.statusCode = 404;
  error.code = "not_found";
  throw error;
}

async function commerceDashboard(request) {
  const context = requestContext(request);
  await ensureDemoSchema(context);
  await ensureDemoOutboxTable(context);
  const status = await domainStatus(context, domains.commerce);
  const queue = summarizeOutboxStats(await domainOutboxStats(context, domains.commerce));
  let queryResults;
  try {
    queryResults = await Promise.all([
      runSqlQuery(context.db, emitQuerySql(domains.commerce.source, "accountOrders"), ["0"]),
      runSqlQuery(context.db, emitQuerySql(domains.commerce.source, "accountBalances"), ["0"]),
      runSqlQuery(context.db, emitQuerySql(domains.commerce.source, "orderPayments"), ["0"]),
      runSqlQuery(context.db, emitQuerySql(domains.commerce.source, "accountOrderSummary"), ["0"]),
      runSqlQuery(context.db, emitQuerySql(domains.commerce.source, "openOrders"), ["0"]),
      runSqlQuery(
      context.db,
      `SELECT id, event_type, payload, status, attempts, created_at FROM ${context.outboxTable} WHERE event_type IN ('AccountCredited', 'OrderPaid', 'PaymentCaptured') ORDER BY created_at DESC LIMIT 10;`,
      [],
    ),
    ]);
  } catch (error) {
    if (isMissingRelation(error)) {
      return emptyDashboard(domains.commerce, status, context, queue);
    }
    throw error;
  }
  const [orders, balances, payments, summary, openOrders, outbox] = queryResults;

  return {
    domain: domains.commerce.key,
    ids: domains.commerce.ids,
    session: sessionInfo(context),
    setupRequired: false,
    migrations: {
      applied: status.applied.length,
      pending: status.pending.map((migration) => migration.filename),
    },
    queue,
    orders: orders.rows,
    balances: balances.rows,
    payments: payments.rows,
    summary: summary.rows,
    openOrders: openOrders.rows,
    outbox: outbox.rows,
  };
}

async function logisticsDashboard(request) {
  const context = requestContext(request);
  await ensureDemoSchema(context);
  await ensureDemoOutboxTable(context);
  const status = await domainStatus(context, domains.logistics);
  const queue = summarizeOutboxStats(await domainOutboxStats(context, domains.logistics));
  let queryResults;
  try {
    queryResults = await Promise.all([
      runSqlQuery(context.db, emitQuerySql(domains.logistics.source, "activeShipments"), ["0"]),
      runSqlQuery(context.db, emitQuerySql(domains.logistics.source, "driverManifest"), ["0"]),
      runSqlQuery(context.db, emitQuerySql(domains.logistics.source, "shipmentStatusSummary"), ["0"]),
      runSqlQuery(
        context.db,
        `SELECT id, event_type, payload, status, attempts, created_at FROM ${context.outboxTable} WHERE event_type IN ('ShipmentStarted', 'ShipmentDelivered', 'DriverCredited') ORDER BY created_at DESC LIMIT 10;`,
        [],
      ),
    ]);
  } catch (error) {
    if (isMissingRelation(error)) {
      return emptyDashboard(domains.logistics, status, context, queue);
    }
    throw error;
  }
  const [activeShipments, driverManifest, statusSummary, outbox] = queryResults;

  return {
    domain: domains.logistics.key,
    ids: domains.logistics.ids,
    session: sessionInfo(context),
    setupRequired: false,
    migrations: {
      applied: status.applied.length,
      pending: status.pending.map((migration) => migration.filename),
    },
    queue,
    activeShipments: activeShipments.rows,
    driverManifest: driverManifest.rows,
    statusSummary: statusSummary.rows,
    outbox: outbox.rows,
  };
}

function emptyDashboard(domain, status, context, queue = emptyOutboxSummary()) {
  const common = {
    domain: domain.key,
    ids: domain.ids,
    session: sessionInfo(context),
    setupRequired: true,
    migrations: {
      applied: status.applied.length,
      pending: status.pending.map((migration) => migration.filename),
    },
    queue,
    outbox: [],
  };
  if (domain.key === "logistics") {
    return {
      ...common,
      activeShipments: [],
      driverManifest: [],
      statusSummary: [],
    };
  }
  return {
    ...common,
    orders: [],
    balances: [],
    payments: [],
    summary: [],
    openOrders: [],
  };
}

async function runTransaction(request, domain, name, params) {
  const context = requestContext(request);
  await ensureDemoSchema(context);
  await ensureDemoOutboxTable(context);
  const result = await runTransactionSql(
    context.db,
    emitTransactionSql(domain.source, name),
    params,
    transactionRetryAttempts(domain.source, name),
  );
  return {
    ok: true,
    domain: domain.key,
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

async function processDemoOutbox(request, domain) {
  const context = requestContext(request);
  await ensureDemoSchema(context);
  await ensureDemoOutboxTable(context);
  const result = await processOutboxEvents(
    context.db,
    {
      ...domains.commerce.outboxHandlers,
      ...domains.logistics.outboxHandlers,
    },
    10,
  );
  return {
    ok: true,
    domain: domain.key,
    processed: result.processed.length,
    failed: result.failed.length,
    events: {
      processed: result.processed,
      failed: result.failed,
    },
    session: sessionInfo(context),
  };
}

async function demoOutboxStats(request, domain) {
  const context = requestContext(request);
  await ensureDemoSchema(context);
  await ensureDemoOutboxTable(context);
  const stats = await domainOutboxStats(context, domain);
  return {
    ok: true,
    domain: domain.key,
    session: sessionInfo(context),
    outbox: stats,
    summary: summarizeOutboxStats(stats),
  };
}

async function operationsDashboard(request) {
  const context = requestContext(request);
  await ensureDemoSchema(context);
  await ensureDemoOutboxTable(context);
  const summaries = await Promise.all(
    Object.values(domains).map(async (domain) => ({
      domain: domain.key,
      title: domain.title,
      outbox: await domainOutboxStats(context, domain),
    })),
  );
  return {
    ok: true,
    session: sessionInfo(context),
    ...summarizeOperationalDashboard(summaries),
  };
}

function businessSimulationTemplate(id) {
  try {
    return getBusinessSimulation(id);
  } catch (error) {
    throw withStatus(error, 404);
  }
}

function businessSimulationRun(body) {
  try {
    return runBusinessSimulator(body);
  } catch (error) {
    throw withStatus(error, 400);
  }
}

function businessScenarioCompare(body) {
  try {
    return compareBusinessSimulatorScenarios(body);
  } catch (error) {
    throw withStatus(error, 400);
  }
}

async function domainOutboxStats(context, domain) {
  const eventTypes = Object.keys(domain.outboxHandlers);
  const placeholders = eventTypes.map((_, index) => `$${index + 1}`).join(", ");
  const result = await context.db.query(
    `
SELECT status,
       count(*) AS count,
       COALESCE(sum(attempts), 0) AS attempts,
       min(created_at) AS oldest_created_at,
       max(created_at) AS newest_created_at
FROM ${context.outboxTable}
WHERE event_type IN (${placeholders})
GROUP BY status
ORDER BY status ASC;
`,
    eventTypes,
  );
  const byStatus = result.rows.map((row) => ({
    status: row.status,
    count: Number(row.count),
    attempts: Number(row.attempts ?? 0),
    oldestCreatedAt: timestampValue(row.oldest_created_at),
    newestCreatedAt: timestampValue(row.newest_created_at),
  }));
  return {
    total: byStatus.reduce((sum, status) => sum + status.count, 0),
    byStatus,
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

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function errorResponseBody(error, statusCode) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof BusinessSimulatorValidationError) {
    return {
      ok: false,
      error: message,
      message,
      code: "business_simulator_validation_failed",
      issues: error.issues,
    };
  }
  if (error instanceof ReuxSimulationExecutionError) {
    return {
      ok: false,
      error: message,
      message,
      code: error.code,
      issues: error.issues,
    };
  }
  return {
    ok: false,
    error: message,
    message,
    code: error?.code ?? (statusCode === 404 ? "not_found" : statusCode === 405 ? "method_not_allowed" : "request_failed"),
  };
}

function sendNoContent(response) {
  response.writeHead(204);
  response.end();
}

function parseAllowedOrigins(value) {
  return value.split(",").map((origin) => origin.trim()).filter(Boolean);
}

function applyCorsHeaders(request, response) {
  const origin = request.headers.origin;
  const allowedOrigin = corsOrigin(origin);
  if (allowedOrigin) {
    response.setHeader("access-control-allow-origin", allowedOrigin);
    if (allowedOrigin !== "*") response.setHeader("vary", "Origin");
  }
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type, x-reux-demo-session, x-reux-demo-token");
  response.setHeader("access-control-max-age", String(corsMaxAgeSeconds));
}

function corsOrigin(origin) {
  if (allowedOrigins.includes("*")) return "*";
  if (!origin) return undefined;
  return allowedOrigins.includes(origin) ? origin : undefined;
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

function withStatus(error, statusCode) {
  if (error && typeof error === "object") {
    error.statusCode = statusCode;
    return error;
  }
  const wrapped = new Error(String(error));
  wrapped.statusCode = statusCode;
  return wrapped;
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
  pruneSessionContexts(schema);
  let context = databases.get(schema);
  if (context) return touchSessionContext(context);

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
    databases.set(schema, touchSessionContext(context));
    pruneSessionContexts(schema);
    return context;
  } finally {
    if (previousUrl === undefined) {
      delete process.env[config.databaseUrlEnv];
    } else {
      process.env[config.databaseUrlEnv] = previousUrl;
    }
  }
}

function pruneSessionContexts(keepSchema = "") {
  const evictions = collectSessionContextEvictions(databases, {
    idleMs: sessionIdleMs,
    maxContexts: maxSessionContexts,
    keepSchema,
  });

  for (const schema of evictions) {
    const context = databases.get(schema);
    databases.delete(schema);
    closeContext(context);
  }
}

function closeContext(context) {
  const close = context?.db?.end?.();
  if (close && typeof close.catch === "function") {
    close.catch((error) => {
      console.warn(`failed to close demo database context for ${context.schema}: ${error.message}`);
    });
  }
}

async function ensureDemoSchema(context) {
  await context.db.query(`CREATE SCHEMA IF NOT EXISTS ${context.quotedSchema};`);
}

async function ensureDomainStore(context, domain) {
  if (domain.migrationsDir) {
    await applyMigrations(context.db, domain.migrationsDir);
    return;
  }
  if (domain.readyTable && (await tableExists(context.db, domain.readyTable))) {
    return;
  }
  await context.db.query(domain.schemaSql);
}

async function domainStatus(context, domain) {
  if (domain.migrationsDir) {
    return migrationStatus(context.db, domain.migrationsDir);
  }
  const ready = domain.readyTable ? await tableExists(context.db, domain.readyTable) : false;
  return {
    applied: ready ? [{ filename: "generated schema", hash: "", appliedAt: "" }] : [],
    pending: ready ? [] : [{ filename: "generated schema", hash: "", path: "", sql: "" }],
  };
}

async function tableExists(db, tableName) {
  const result = await db.query("SELECT to_regclass($1) AS name;", [tableName]);
  return Boolean(result.rows[0]?.name);
}

function timestampValue(value) {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
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
