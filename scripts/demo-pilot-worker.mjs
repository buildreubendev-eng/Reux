import { fileURLToPath } from "node:url";
import { loadConfig } from "../dist/config.js";
import { createPostgresDatabase, runOutboxWorker } from "../dist/runtime.js";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const config = loadConfig(rootDir, "pilot/dl.json");
const schema = process.env.REUX_DEMO_SCHEMA ?? process.env.REUX_WORKER_SCHEMA;

if (schema) {
  process.env[config.databaseUrlEnv] = databaseUrlWithSearchPath(
    process.env[config.databaseUrlEnv],
    schema,
    config.databaseUrlEnv,
  );
}

const db = createPostgresDatabase(config);
const controller = new AbortController();
const intervalMs = envInt("REUX_WORKER_INTERVAL_MS", 1000);
const limit = envInt("REUX_WORKER_LIMIT", 10);
const requeueStaleAfterSeconds = envInt("REUX_WORKER_REQUEUE_STALE_SECONDS", 300);
const maxAttempts = envInt("REUX_WORKER_MAX_ATTEMPTS", 5);
const retryDelaySeconds = envInt("REUX_WORKER_RETRY_DELAY_SECONDS", 30);
const maxIterations = optionalEnvInt("REUX_WORKER_MAX_ITERATIONS");

const outboxHandlers = {
  AccountCredited: async (event) => {
    console.log("processed AccountCredited", event.id, JSON.stringify(event.payload));
  },
  OrderPaid: async (event) => {
    console.log("processed OrderPaid", event.id, JSON.stringify(event.payload));
  },
  PaymentCaptured: async (event) => {
    console.log("processed PaymentCaptured", event.id, JSON.stringify(event.payload));
  },
};

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => controller.abort());
}

try {
  if (schema) {
    await db.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)};`);
  }
  const result = await runOutboxWorker(db, outboxHandlers, {
    intervalMs,
    limit,
    maxAttempts,
    retryDelaySeconds,
    maxIterations,
    requeueStaleAfterSeconds,
    signal: controller.signal,
    onIteration(iteration) {
      if (
        iteration.processed.length > 0 ||
        iteration.failed.length > 0 ||
        iteration.retried.length > 0 ||
        iteration.deadLettered.length > 0 ||
        iteration.staleRequeued.length > 0
      ) {
        console.log(
          `outbox iteration=${iteration.iteration} processed=${iteration.processed.length} failed=${iteration.failed.length} retried=${iteration.retried.length} dead=${iteration.deadLettered.length} staleRequeued=${iteration.staleRequeued.length}`,
        );
      }
    },
  });
  console.log(
    `worker stopped: ${result.stopped} iterations=${result.iterations} processed=${result.processed} failed=${result.failed} retried=${result.retried} dead=${result.deadLettered} staleRequeued=${result.staleRequeued}`,
  );
} finally {
  await db.end?.();
}

function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function optionalEnvInt(name) {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

function databaseUrlWithSearchPath(value, targetSchema, envName) {
  if (!value) {
    throw new Error(`database URL environment variable ${envName} is not set`);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(targetSchema)) {
    throw new Error("worker schema must be a PostgreSQL identifier");
  }

  const url = new URL(value);
  const options = url.searchParams.get("options");
  const searchPath = `-c search_path=${targetSchema},public`;
  url.searchParams.set("options", options ? `${options} ${searchPath}` : searchPath);
  return url.toString();
}

function quoteIdentifier(value) {
  return `"${value.replace(/"/g, '""')}"`;
}
