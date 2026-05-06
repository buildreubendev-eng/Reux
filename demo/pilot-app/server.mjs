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
import {
  RateLimitExceededError,
  clientKeyFromRequest,
  createRateLimiter,
  defaultRateLimitMaxRequests,
  defaultRateLimitWindowMs,
  defaultWriteRateLimitMaxRequests,
} from "./rate-limit.mjs";
import { demoErrorHeaders, demoErrorResponseBody } from "./error-response.mjs";
import { createRequestStats } from "./request-stats.mjs";
import {
  createSimulationRunStore,
  defaultMaxSimulationRunRecords,
  defaultSimulationRunTtlMs,
  recordSummary,
} from "./simulation-runs.mjs";
import {
  createPilotRequestSender,
  createPilotRequestStore,
  defaultMaxPilotRequestRecords,
  normalizePilotRequestOperatorUpdate,
  pilotRequestSummary,
  submitPilotRequest,
} from "./pilot-requests.mjs";

const rootDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const publicDir = join(rootDir, "demo", "pilot-app", "public");
const config = loadConfig(rootDir, "pilot/dl.json");
const packageInfo = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
const demoApiVersion = "2026-05-02";
const demoSchema = process.env.REUX_DEMO_SCHEMA ?? "reux_demo";
const setupToken = process.env.REUX_DEMO_SETUP_TOKEN ?? "";
const host = process.env.HOST ?? "0.0.0.0";
const publicHost = host === "0.0.0.0" ? "127.0.0.1" : host;
const port = Number.parseInt(process.env.PORT ?? process.env.REUX_DEMO_PORT ?? "4173", 10);
const sessionMode = process.env.REUX_DEMO_SESSION_MODE ?? "isolated";
const allowedOrigins = parseAllowedOrigins(process.env.REUX_DEMO_ALLOWED_ORIGINS ?? "*");
const corsMaxAgeSeconds = parsePositiveInteger(process.env.REUX_DEMO_CORS_MAX_AGE_SECONDS, 600);
const jsonBodyLimitBytes = parsePositiveInteger(process.env.REUX_DEMO_JSON_BODY_LIMIT_BYTES, defaultJsonBodyLimitBytes);
const rateLimitWindowMs = parsePositiveInteger(process.env.REUX_DEMO_RATE_LIMIT_WINDOW_MS, defaultRateLimitWindowMs);
const rateLimitMaxRequests = parsePositiveInteger(process.env.REUX_DEMO_RATE_LIMIT_MAX_REQUESTS, defaultRateLimitMaxRequests);
const writeRateLimitMaxRequests = parsePositiveInteger(process.env.REUX_DEMO_WRITE_RATE_LIMIT_MAX_REQUESTS, defaultWriteRateLimitMaxRequests);
const maxSessionContexts = parsePositiveInteger(process.env.REUX_DEMO_MAX_SESSION_CONTEXTS, defaultMaxSessionContexts);
const sessionIdleMs = parsePositiveInteger(process.env.REUX_DEMO_SESSION_IDLE_MS, defaultSessionIdleMs);
const maxSimulationRunRecords = parsePositiveInteger(process.env.REUX_DEMO_MAX_SIMULATION_RUNS, defaultMaxSimulationRunRecords);
const simulationRunTtlMs = parsePositiveInteger(process.env.REUX_DEMO_SIMULATION_RUN_TTL_MS, defaultSimulationRunTtlMs);
const maxPilotRequestRecords = parsePositiveInteger(process.env.REUX_DEMO_MAX_PILOT_REQUESTS, defaultMaxPilotRequestRecords);
const apiRateLimiter = createRateLimiter({ maxRequests: rateLimitMaxRequests, windowMs: rateLimitWindowMs });
const writeRateLimiter = createRateLimiter({ maxRequests: writeRateLimitMaxRequests, windowMs: rateLimitWindowMs });
const requestStats = createRequestStats();
const simulationRunStore = createSimulationRunStore({
  maxRecords: maxSimulationRunRecords,
  ttlMs: simulationRunTtlMs,
});
const pilotRequestSender = createPilotRequestSender();
const pilotRequestStore = createPilotRequestStore({
  maxRecords: maxPilotRequestRecords,
});
const buildId = buildIdentifier();
const databases = new Map();

if (!process.env[config.databaseUrlEnv]) {
  console.warn(`Reux pilot app starting without ${config.databaseUrlEnv}; database-backed routes will return 503.`);
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
  const startedAt = Date.now();
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  response.on("finish", () => {
    requestStats.record({
      method: request.method ?? "GET",
      pathname: url.pathname,
      statusCode: response.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  try {
    await route(request, response, url);
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode)
      ? error.statusCode
      : error instanceof BusinessSimulatorValidationError || error instanceof ReuxSimulationExecutionError
        ? 400
        : 500;
    sendJson(
      response,
      statusCode,
      demoErrorResponseBody(error, statusCode, {
        BusinessSimulatorValidationError,
        ReuxSimulationExecutionError,
      }),
      demoErrorHeaders(error),
    );
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

async function route(request, response, url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`)) {
  const method = request.method ?? "GET";
  if (url.pathname.startsWith("/api/")) {
    applyCorsHeaders(request, response);
    if (method === "OPTIONS") {
      sendNoContent(response);
      return;
    }
    enforceApiRateLimit(request, method);
  }

  if (url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      module: "pilot",
      apiVersion: demoApiVersion,
      packageVersion: packageInfo.version,
      build: buildId,
      databaseUrlEnv: config.databaseUrlEnv,
      database: {
        configured: Boolean(process.env[config.databaseUrlEnv]),
        urlEnv: config.databaseUrlEnv,
      },
      schema: demoSchema,
      sessionMode,
      jsonBodyLimitBytes,
      rateLimit: {
        windowMs: rateLimitWindowMs,
        maxRequests: rateLimitMaxRequests,
        writeMaxRequests: writeRateLimitMaxRequests,
        api: apiRateLimiter.stats(),
        write: writeRateLimiter.stats(),
      },
      requests: requestStats.summary(),
      sessionCache: sessionCacheStats(databases, { idleMs: sessionIdleMs, maxContexts: maxSessionContexts }),
      simulationRuns: await simulationRunStats(),
      pilotRequests: await pilotRequestStats(),
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

  if (url.pathname === "/api/simulation-runs" && method === "GET") {
    sendJson(response, 200, await businessSimulationRuns(request));
    return;
  }

  if (url.pathname.startsWith("/api/simulation-runs/") && method === "GET") {
    const id = decodeURIComponent(url.pathname.slice("/api/simulation-runs/".length));
    sendJson(response, 200, await businessSimulationRunRecord(id));
    return;
  }

  if (url.pathname.startsWith("/api/simulations/") && method === "GET") {
    const id = decodeURIComponent(url.pathname.slice("/api/simulations/".length));
    sendJson(response, 200, businessSimulationTemplate(id));
    return;
  }

  if (url.pathname === "/api/simulations/run" && method === "POST") {
    sendJson(response, 200, await businessSimulationRun(request, await readJson(request, { limitBytes: jsonBodyLimitBytes })));
    return;
  }

  if (url.pathname === "/api/scenarios/compare" && method === "POST") {
    sendJson(response, 200, businessScenarioCompare(await readJson(request, { limitBytes: jsonBodyLimitBytes })));
    return;
  }

  if (url.pathname === "/api/pilot-requests" && method === "GET") {
    assertAdminAllowed(request);
    sendJson(response, 200, await pilotRequests(url));
    return;
  }

  if (url.pathname.startsWith("/api/pilot-requests/") && method === "GET") {
    assertAdminAllowed(request);
    const id = decodeURIComponent(url.pathname.slice("/api/pilot-requests/".length));
    sendJson(response, 200, await pilotRequestRecord(id));
    return;
  }

  if (url.pathname.startsWith("/api/pilot-requests/") && url.pathname.endsWith("/operator") && method === "PATCH") {
    assertAdminAllowed(request);
    const id = decodeURIComponent(url.pathname.slice("/api/pilot-requests/".length, -"/operator".length));
    sendJson(response, 200, await updatePilotRequestOperator(id, await readJson(request, { limitBytes: jsonBodyLimitBytes })));
    return;
  }

  if (url.pathname === "/api/pilot-requests" && method === "POST") {
    sendJson(response, 202, await submitStoredPilotRequest(await readJson(request, { limitBytes: jsonBodyLimitBytes })));
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
    sendJson(response, 405, demoErrorResponseBody(new Error("method not allowed"), 405));
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

async function businessSimulationRuns(request) {
  const sessionId = simulationSession(request).id;
  try {
    return {
      runs: await listPersistedSimulationRuns(sessionId),
    };
  } catch (error) {
    console.warn(`falling back to in-memory simulation run list: ${error.message}`);
    return {
      runs: simulationRunStore.list({ sessionId }),
    };
  }
}

async function businessSimulationRunRecord(id) {
  const memoryResult = simulationRunStore.getStatus(id);
  if (memoryResult.status === "found") {
    return { run: memoryResult.record };
  }
  if (memoryResult.status === "expired") {
    throw savedSimulationRunExpiredError(id, memoryResult.expiresAt);
  }

  const persistedResult = await getPersistedSimulationRunStatus(id);
  if (persistedResult.status === "found") {
    return { run: persistedResult.record };
  }
  if (persistedResult.status === "expired") {
    throw savedSimulationRunExpiredError(id, persistedResult.expiresAt);
  }

  const error = new Error(`simulation run '${id}' was not found`);
  error.statusCode = 404;
  error.code = "not_found";
  throw error;
}

async function businessSimulationRun(request, body) {
  try {
    const response = runBusinessSimulator(body);
    const record = simulationRunStore.save({
      request: body,
      response,
      session: simulationSession(request),
    });
    try {
      record.storage = "postgres";
      record.response = {
        ...record.response,
        run: recordSummary(record),
      };
      await savePersistedSimulationRun(record);
    } catch (error) {
      record.storage = "memory";
      record.persistenceWarning = "Saved run is using temporary in-memory fallback storage.";
      record.response = {
        ...record.response,
        run: recordSummary(record),
      };
      console.warn(`failed to persist simulation run ${record.id}: ${error.message}`);
    }
    return record.response;
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

async function submitStoredPilotRequest(body) {
  return submitPilotRequest(body, {
    sender: pilotRequestSender,
    store: {
      async save({ pilotRequest, delivery }) {
        const record = pilotRequestStore.save({ pilotRequest, delivery });
        try {
          record.storage = "postgres";
          await savePersistedPilotRequest(record);
        } catch (error) {
          record.storage = "memory";
          record.persistenceWarning = "Pilot request is using temporary in-memory fallback storage.";
          console.warn(`failed to persist pilot request ${record.id}: ${error.message}`);
        }
        pilotRequestStore.save({ pilotRequest: record, delivery: record.delivery, storage: record.storage, persistenceWarning: record.persistenceWarning });
        return record;
      },
    },
  });
}

async function pilotRequests(url) {
  const limit = parsePositiveInteger(Number.parseInt(url.searchParams.get("limit") ?? "", 10), maxPilotRequestRecords);
  try {
    return {
      requests: await listPersistedPilotRequests(limit),
    };
  } catch (error) {
    console.warn(`falling back to in-memory pilot request list: ${error.message}`);
    return {
      requests: pilotRequestStore.list({ limit }),
    };
  }
}

async function pilotRequestRecord(id) {
  try {
    const record = await getPersistedPilotRequest(id);
    if (record) return { request: record };
  } catch (error) {
    console.warn(`failed to load persisted pilot request ${id}: ${error.message}`);
  }

  const record = pilotRequestStore.get(id);
  if (record) return { request: record };

  const error = new Error(`pilot request '${id}' was not found`);
  error.statusCode = 404;
  error.code = "not_found";
  throw error;
}

async function updatePilotRequestOperator(id, body) {
  const update = normalizePilotRequestOperatorUpdate(body);
  try {
    const record = await updatePersistedPilotRequestOperator(id, update);
    if (record) {
      pilotRequestStore.updateOperator(id, update);
      return { request: record };
    }
  } catch (error) {
    console.warn(`failed to update persisted pilot request ${id}: ${error.message}`);
  }

  const record = pilotRequestStore.updateOperator(id, update);
  if (record) return { request: record };

  const error = new Error(`pilot request '${id}' was not found`);
  error.statusCode = 404;
  error.code = "not_found";
  throw error;
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

function sendJson(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-reux-api-version": demoApiVersion,
    "x-reux-build": buildId,
    ...headers,
  });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function sendNoContent(response) {
  response.writeHead(204, {
    "cache-control": "no-store",
    "x-reux-api-version": demoApiVersion,
    "x-reux-build": buildId,
  });
  response.end();
}

function buildIdentifier() {
  const source = process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GITHUB_SHA ??
    process.env.REUX_DEMO_BUILD_ID ??
    "";
  return source ? source.slice(0, 12) : "local";
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

function enforceApiRateLimit(request, method) {
  const clientKey = clientKeyFromRequest(request);
  const globalResult = apiRateLimiter.check(`${clientKey}:all`);
  if (!globalResult.allowed) {
    throw new RateLimitExceededError(globalResult);
  }
  if (!["GET", "HEAD"].includes(method)) {
    const writeResult = writeRateLimiter.check(`${clientKey}:write`);
    if (!writeResult.allowed) {
      throw new RateLimitExceededError(writeResult);
    }
  }
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

function assertAdminAllowed(request) {
  assertSetupAllowed(request, {});
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

function simulationSession(request) {
  const sessionId = sessionMode === "shared" ? "" : sessionIdFromHeader(request.headers["x-reux-demo-session"]);
  return {
    id: sessionId,
    isolated: Boolean(sessionId),
    schema: sessionSchema(demoSchema, sessionId),
  };
}

async function simulationRunStats() {
  const fallback = simulationRunStore.stats();
  try {
    const context = await simulationRunContext();
    const result = await context.db.query(`
SELECT count(*) AS records,
       min(created_at) AS oldest_created_at,
       max(created_at) AS newest_created_at
FROM ${simulationRunTable(context)}
WHERE expires_at > now();
`);
    const row = result.rows[0] ?? {};
    return {
      records: Number(row.records ?? 0),
      maxRecords: maxSimulationRunRecords,
      ttlMs: simulationRunTtlMs,
      storage: "postgres",
      oldestCreatedAt: timestampValue(row.oldest_created_at),
      newestCreatedAt: timestampValue(row.newest_created_at),
      memoryFallback: fallback,
    };
  } catch (error) {
    return {
      ...fallback,
      storage: "memory",
      persistenceError: error.message,
    };
  }
}

async function pilotRequestStats() {
  const senderStatus = pilotRequestSender.status();
  const fallback = pilotRequestStore.stats();
  try {
    const context = await pilotRequestContext();
    const result = await context.db.query(`
SELECT count(*) AS records,
       min(received_at) AS oldest_received_at,
       max(received_at) AS newest_received_at
FROM ${pilotRequestTable(context)};
`);
    const row = result.rows[0] ?? {};
    return {
      ...senderStatus,
      records: Number(row.records ?? 0),
      maxRecords: maxPilotRequestRecords,
      storage: "postgres",
      oldestReceivedAt: timestampValue(row.oldest_received_at),
      newestReceivedAt: timestampValue(row.newest_received_at),
      memoryFallback: fallback,
    };
  } catch (error) {
    return {
      ...senderStatus,
      ...fallback,
      storage: "memory",
      persistenceError: error.message,
    };
  }
}

async function savePersistedSimulationRun(record) {
  const context = await simulationRunContext();
  await context.db.query(
    `
INSERT INTO ${simulationRunTable(context)}
  (id, simulation_id, session_id, session_isolated, session_schema, request, response, created_at, expires_at)
VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::timestamptz, $9::timestamptz)
ON CONFLICT (id) DO UPDATE SET
  simulation_id = excluded.simulation_id,
  session_id = excluded.session_id,
  session_isolated = excluded.session_isolated,
  session_schema = excluded.session_schema,
  request = excluded.request,
  response = excluded.response,
  created_at = excluded.created_at,
  expires_at = excluded.expires_at;
`,
    [
      record.id,
      record.simulationId,
      record.session.id,
      record.session.isolated,
      record.session.schema ?? null,
      JSON.stringify(record.request),
      JSON.stringify(record.response),
      record.createdAt,
      record.expiresAt,
    ],
  );
  await prunePersistedSimulationRuns(context);
}

async function getPersistedSimulationRunStatus(id) {
  try {
    const context = await simulationRunContext();
    const result = await context.db.query(
      `
SELECT id, simulation_id, session_id, session_isolated, session_schema, request, response, created_at, expires_at
FROM ${simulationRunTable(context)}
WHERE id = $1;
`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return { status: "missing" };
    const expiresAt = timestampValue(row.expires_at);
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      return { status: "expired", expiresAt };
    }
    return { status: "found", record: simulationRunRecordFromRow(row) };
  } catch (error) {
    console.warn(`failed to load persisted simulation run ${id}: ${error.message}`);
    return { status: "missing" };
  }
}

function savedSimulationRunExpiredError(id, expiresAt) {
  const error = new Error(`simulation run '${id}' expired at ${expiresAt}`);
  error.statusCode = 410;
  error.code = "saved_run_expired";
  error.expiresAt = expiresAt;
  return error;
}

async function listPersistedSimulationRuns(sessionId) {
  const context = await simulationRunContext();
  const result = await context.db.query(
    `
SELECT id, simulation_id, session_id, session_isolated, session_schema, request, response, created_at, expires_at
FROM ${simulationRunTable(context)}
WHERE ($1::text = '' OR session_id = $1) AND expires_at > now()
ORDER BY created_at DESC
LIMIT $2;
`,
    [sessionId, maxSimulationRunRecords],
  );
  return result.rows.map((row) => recordSummary(simulationRunRecordFromRow(row)));
}

async function prunePersistedSimulationRuns(context) {
  await context.db.query(`DELETE FROM ${simulationRunTable(context)} WHERE expires_at <= now();`);
  const extra = await context.db.query(
    `SELECT id FROM ${simulationRunTable(context)} ORDER BY created_at DESC OFFSET $1;`,
    [maxSimulationRunRecords],
  );
  const ids = extra.rows.map((row) => row.id);
  if (ids.length > 0) {
    await context.db.query(`DELETE FROM ${simulationRunTable(context)} WHERE id = ANY($1::text[]);`, [ids]);
  }
}

async function simulationRunContext() {
  const context = schemaContext(demoSchema, "");
  await ensureDemoSchema(context);
  await ensureSimulationRunTable(context);
  return context;
}

async function savePersistedPilotRequest(record) {
  const context = await pilotRequestContext();
  await context.db.query(
    `
INSERT INTO ${pilotRequestTable(context)}
  (id, received_at, name, email, company, role, phone, decision, source_run_id, page_url, delivery, storage)
VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
ON CONFLICT (id) DO UPDATE SET
  received_at = excluded.received_at,
  name = excluded.name,
  email = excluded.email,
  company = excluded.company,
  role = excluded.role,
  phone = excluded.phone,
  decision = excluded.decision,
  source_run_id = excluded.source_run_id,
  page_url = excluded.page_url,
  delivery = excluded.delivery,
  storage = excluded.storage;
`,
    [
      record.id,
      record.receivedAt,
      record.name,
      record.email,
      record.company ?? null,
      record.role ?? null,
      record.phone ?? null,
      record.decision,
      record.sourceRunId ?? null,
      record.pageUrl ?? null,
      JSON.stringify(record.delivery ?? {}),
      "postgres",
    ],
  );
  await prunePersistedPilotRequests(context);
}

async function listPersistedPilotRequests(limit) {
  const context = await pilotRequestContext();
  const result = await context.db.query(
    `
SELECT id, received_at, name, email, company, role, phone, decision, source_run_id, page_url, delivery, storage,
       operator_status, operator_notes, operator_updated_at
FROM ${pilotRequestTable(context)}
ORDER BY received_at DESC
LIMIT $1;
`,
    [Math.min(limit, maxPilotRequestRecords)],
  );
  return result.rows.map((row) => pilotRequestSummary(pilotRequestRecordFromRow(row)));
}

async function getPersistedPilotRequest(id) {
  const context = await pilotRequestContext();
  const result = await context.db.query(
    `
SELECT id, received_at, name, email, company, role, phone, decision, source_run_id, page_url, delivery, storage,
       operator_status, operator_notes, operator_updated_at
FROM ${pilotRequestTable(context)}
WHERE id = $1;
`,
    [id],
  );
  const row = result.rows[0];
  return row ? pilotRequestRecordFromRow(row) : null;
}

async function updatePersistedPilotRequestOperator(id, update) {
  const context = await pilotRequestContext();
  const result = await context.db.query(
    `
UPDATE ${pilotRequestTable(context)}
SET operator_status = COALESCE($2, operator_status),
    operator_notes = COALESCE($3, operator_notes),
    operator_updated_at = $4::timestamptz
WHERE id = $1
RETURNING id, received_at, name, email, company, role, phone, decision, source_run_id, page_url, delivery, storage,
          operator_status, operator_notes, operator_updated_at;
`,
    [
      id,
      update.status ?? null,
      update.notes ?? null,
      update.operatorUpdatedAt,
    ],
  );
  const row = result.rows[0];
  return row ? pilotRequestRecordFromRow(row) : null;
}

async function prunePersistedPilotRequests(context) {
  const extra = await context.db.query(
    `SELECT id FROM ${pilotRequestTable(context)} ORDER BY received_at DESC OFFSET $1;`,
    [maxPilotRequestRecords],
  );
  const ids = extra.rows.map((row) => row.id);
  if (ids.length > 0) {
    await context.db.query(`DELETE FROM ${pilotRequestTable(context)} WHERE id = ANY($1::text[]);`, [ids]);
  }
}

async function pilotRequestContext() {
  const context = schemaContext(demoSchema, "");
  await ensureDemoSchema(context);
  await ensurePilotRequestTable(context);
  return context;
}

async function ensureSimulationRunTable(context) {
  await context.db.query(`
CREATE TABLE IF NOT EXISTS ${simulationRunTable(context)} (
  id text PRIMARY KEY,
  simulation_id text NOT NULL,
  session_id text NOT NULL DEFAULT '',
  session_isolated boolean NOT NULL DEFAULT false,
  session_schema text NULL,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
`);
  await context.db.query(`CREATE INDEX IF NOT EXISTS _reux_simulation_runs_session_created_idx ON ${simulationRunTable(context)} (session_id, created_at DESC);`);
  await context.db.query(`CREATE INDEX IF NOT EXISTS _reux_simulation_runs_expires_idx ON ${simulationRunTable(context)} (expires_at);`);
}

function simulationRunTable(context) {
  return `${context.quotedSchema}._reux_simulation_runs`;
}

async function ensurePilotRequestTable(context) {
  await context.db.query(`
CREATE TABLE IF NOT EXISTS ${pilotRequestTable(context)} (
  id text PRIMARY KEY,
  received_at timestamptz NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  company text NULL,
  role text NULL,
  phone text NULL,
  decision text NOT NULL,
  source_run_id text NULL,
  page_url text NULL,
  delivery jsonb NOT NULL,
  storage text NOT NULL DEFAULT 'postgres',
  operator_status text NOT NULL DEFAULT 'new',
  operator_notes text NOT NULL DEFAULT '',
  operator_updated_at timestamptz NULL
);
`);
  await context.db.query(`ALTER TABLE ${pilotRequestTable(context)} ADD COLUMN IF NOT EXISTS operator_status text NOT NULL DEFAULT 'new';`);
  await context.db.query(`ALTER TABLE ${pilotRequestTable(context)} ADD COLUMN IF NOT EXISTS operator_notes text NOT NULL DEFAULT '';`);
  await context.db.query(`ALTER TABLE ${pilotRequestTable(context)} ADD COLUMN IF NOT EXISTS operator_updated_at timestamptz NULL;`);
  await context.db.query(`CREATE INDEX IF NOT EXISTS _reux_pilot_requests_received_idx ON ${pilotRequestTable(context)} (received_at DESC);`);
  await context.db.query(`CREATE INDEX IF NOT EXISTS _reux_pilot_requests_source_run_idx ON ${pilotRequestTable(context)} (source_run_id);`);
  await context.db.query(`CREATE INDEX IF NOT EXISTS _reux_pilot_requests_operator_status_idx ON ${pilotRequestTable(context)} (operator_status, received_at DESC);`);
}

function pilotRequestTable(context) {
  return `${context.quotedSchema}._reux_pilot_requests`;
}

function simulationRunRecordFromRow(row) {
  const record = {
    id: row.id,
    simulationId: row.simulation_id,
    createdAt: timestampValue(row.created_at),
    expiresAt: timestampValue(row.expires_at),
    session: {
      id: row.session_id ?? "",
      isolated: Boolean(row.session_isolated),
      schema: row.session_schema ?? undefined,
    },
    request: jsonValue(row.request),
    response: jsonValue(row.response),
  };
  record.response = {
    ...record.response,
    run: recordSummary(record),
  };
  return record;
}

function pilotRequestRecordFromRow(row) {
  return {
    id: row.id,
    receivedAt: timestampValue(row.received_at),
    name: row.name,
    email: row.email,
    ...(row.company ? { company: row.company } : {}),
    ...(row.role ? { role: row.role } : {}),
    ...(row.phone ? { phone: row.phone } : {}),
    decision: row.decision,
    ...(row.source_run_id ? { sourceRunId: row.source_run_id } : {}),
    ...(row.page_url ? { pageUrl: row.page_url } : {}),
    delivery: jsonValue(row.delivery),
    storage: row.storage ?? "postgres",
    operatorStatus: row.operator_status ?? "new",
    operatorNotes: row.operator_notes ?? "",
    ...(row.operator_updated_at ? { operatorUpdatedAt: timestampValue(row.operator_updated_at) } : {}),
  };
}

function schemaContext(schema, sessionId) {
  assertPostgresIdentifier(schema, "demo schema must be a PostgreSQL identifier");
  pruneSessionContexts(schema);
  let context = databases.get(schema);
  if (context) return touchSessionContext(context);

  const baseDatabaseUrl = requireDatabaseUrl();
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

function requireDatabaseUrl() {
  const databaseUrl = process.env[config.databaseUrlEnv];
  if (databaseUrl) return databaseUrl;

  const error = new Error(`database URL environment variable ${config.databaseUrlEnv} is not set`);
  error.statusCode = 503;
  error.code = "database_not_configured";
  throw error;
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

function jsonValue(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
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
