#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  compileSource,
  emitInsertStatement,
  emitDiffMigration,
  emitInitialMigration,
  emitMigrationPlan,
  emitPostgresSchema,
  emitQueryIr,
  emitQuerySql,
  emitSchemaManifest,
  emitTransactionIr,
  emitTransactionSql,
  explainQuery,
  transactionRetryAttempts,
} from "./compiler.js";
import { loadConfig } from "./config.js";
import { mapDatabaseError } from "./db-errors.js";
import { parseJsonObject } from "./data.js";
import { DlAggregateError } from "./errors.js";
import { discoverSourceFiles, ProjectSummary, summarizeProject } from "./project.js";
import { checkSeed, deleteSeed, dryRunSeed, parseSeedSpec, resetSeed, runSeed } from "./seed.js";
import {
  applyMigrations,
  claimOutboxEvents,
  createPostgresDatabase,
  listOutboxEvents,
  markOutboxFailed,
  markOutboxProcessed,
  migrationStatus,
  OutboxListStatus,
  requeueOutboxEvent,
  requeueStaleOutboxEvents,
  parseJsonParams,
  runTransactionSql,
  runSqlQuery,
} from "./runtime.js";

const args = process.argv.slice(2);
const [command, file, extra, extra2] = args;

try {
  if (!command) {
    usage();
    process.exitCode = 1;
  } else if (command === "migrate-status") {
    await withDatabase(async (db, config) => {
      const status = await migrationStatus(db, config.migrationsDir);
      console.log(`applied: ${status.applied.length}`);
      for (const record of status.applied) {
        console.log(`  ${record.filename} ${record.hash.slice(0, 12)} ${record.appliedAt}`);
      }
      console.log(`pending: ${status.pending.length}`);
      for (const pending of status.pending) {
        console.log(`  ${pending.filename} ${pending.hash.slice(0, 12)}`);
      }
    });
  } else if (command === "migrate-apply") {
    await withDatabase(async (db, config) => {
      const applied = await applyMigrations(db, config.migrationsDir);
      if (applied.length === 0) {
        console.log("migrations already up to date");
      } else {
        for (const record of applied) {
          console.log(`applied ${record.filename}`);
        }
      }
    });
  } else if (command === "outbox-list") {
    const { status, limit } = parseOutboxListArgs(file, extra);
    await withDatabase(async (db) => {
      const events = await listOutboxEvents(db, limit, status);
      console.log(JSON.stringify(events, null, 2));
    });
  } else if (command === "outbox-mark-processed") {
    if (!file) {
      throw new Error("outbox-mark-processed requires an outbox event id");
    }
    await withDatabase(async (db) => {
      const event = await markOutboxProcessed(db, file);
      if (!event) {
        throw new Error(`outbox event ${file} was not found`);
      }
      console.log(JSON.stringify(event, null, 2));
    });
  } else if (command === "outbox-claim") {
    const limit = file ? Number.parseInt(file, 10) : 10;
    await withDatabase(async (db) => {
      const events = await claimOutboxEvents(db, Number.isFinite(limit) ? limit : 10);
      console.log(JSON.stringify(events, null, 2));
    });
  } else if (command === "outbox-mark-failed") {
    if (!file) {
      throw new Error("outbox-mark-failed requires an outbox event id");
    }
    const message = extra ?? "failed";
    await withDatabase(async (db) => {
      const event = await markOutboxFailed(db, file, message);
      if (!event) {
        throw new Error(`outbox event ${file} was not found`);
      }
      console.log(JSON.stringify(event, null, 2));
    });
  } else if (command === "outbox-requeue") {
    if (!file) {
      throw new Error("outbox-requeue requires an outbox event id");
    }
    await withDatabase(async (db) => {
      const event = await requeueOutboxEvent(db, file);
      if (!event) {
        throw new Error(`outbox event ${file} was not found in a requeueable state`);
      }
      console.log(JSON.stringify(event, null, 2));
    });
  } else if (command === "outbox-requeue-stale") {
    const olderThanSeconds = file ? Number.parseInt(file, 10) : 300;
    const limit = extra ? Number.parseInt(extra, 10) : 50;
    if (!Number.isFinite(olderThanSeconds) || olderThanSeconds < 1) {
      throw new Error("outbox-requeue-stale requires older-than seconds as a positive integer");
    }
    await withDatabase(async (db) => {
      const events = await requeueStaleOutboxEvents(db, olderThanSeconds, Number.isFinite(limit) ? limit : 50);
      console.log(JSON.stringify(events, null, 2));
    });
  } else if (command === "project-check") {
    const config = loadConfig();
    const files = discoverSourceFiles(config);
    if (files.length === 0) {
      throw new Error(`no Reux source files matched configured sources: ${config.sources.join(", ")}`);
    }
    for (const sourceFile of files) {
      const result = compileSource(readFileSync(sourceFile.path, "utf8"));
      console.log(`ok: ${sourceFile.relativePath} (${result.schema.entities.length} entities, ${result.schema.enums.length} enums)`);
    }
    console.log(`checked ${files.length} source file${files.length === 1 ? "" : "s"}`);
  } else if (command === "project-summary") {
    const config = loadConfig();
    const summary = summarizeProject(config);
    if (summary.files.length === 0) {
      throw new Error(`no Reux source files matched configured sources: ${config.sources.join(", ")}`);
    }
    if (file === "--json") {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(formatProjectSummary(summary));
    }
  } else if (command === "project-doctor") {
    console.log(formatProjectDoctor(loadConfig()));
  } else if (command === "project-sql" || command === "project-manifest" || command === "project-manifest-write") {
    const config = loadConfig();
    const source = readSingleProjectSource(config, command);
    if (command === "project-sql") {
      console.log(emitPostgresSchema(source));
    } else if (command === "project-manifest") {
      console.log(emitSchemaManifest(source));
    } else {
      mkdirSync(dirname(config.schemaManifest), { recursive: true });
      writeFileSync(config.schemaManifest, emitSchemaManifest(source));
      console.log(`wrote ${config.schemaManifest}`);
    }
  } else if (command === "project-migrate-plan") {
    const config = loadConfig();
    const source = readSingleProjectSource(config, command);
    const previousManifest = readFileSync(config.schemaManifest, "utf8");
    console.log(emitMigrationPlan(previousManifest, source, file === "--json" ? "json" : "text"));
  } else if (command === "project-migrate-diff-create") {
    const config = loadConfig();
    const source = readSingleProjectSource(config, command);
    const previousManifest = readFileSync(config.schemaManifest, "utf8");
    const plan = JSON.parse(emitMigrationPlan(previousManifest, source, "json")) as { operations: unknown[] };
    if (plan.operations.length === 0) {
      console.log("no migration operations; schema manifest is already up to date");
    } else {
      const migrationName = file ?? "schema_diff";
      const artifact = emitDiffMigration(previousManifest, source, migrationName);
      mkdirSync(config.migrationsDir, { recursive: true });
      const path = join(config.migrationsDir, artifact.filename);
      writeFileSync(path, artifact.sql);
      console.log(`created ${path}`);
    }
  } else if (command === "project-query-ir" || command === "project-query-sql" || command === "project-explain") {
    if (!file) {
      throw new Error(`${command} requires a query name`);
    }
    const source = readSingleProjectSource(loadConfig(), command);
    if (command === "project-query-ir") {
      console.log(emitQueryIr(source, file));
    } else if (command === "project-query-sql") {
      console.log(emitQuerySql(source, file));
    } else {
      console.log(explainQuery(source, file));
    }
  } else if (command === "project-tx-ir" || command === "project-tx-sql") {
    if (!file) {
      throw new Error(`${command} requires a transaction function name`);
    }
    const source = readSingleProjectSource(loadConfig(), command);
    if (command === "project-tx-ir") {
      console.log(emitTransactionIr(source, file));
    } else {
      console.log(emitTransactionSql(source, file));
    }
  } else if (command === "project-query-run") {
    if (!file) {
      throw new Error("project-query-run requires a query name");
    }
    const source = readSingleProjectSource(loadConfig(), command);
    const sql = emitQuerySql(source, file);
    const params = parseJsonParams(extra);
    await withDatabase(async (db) => {
      const result = await runSqlQuery(db, sql, params);
      console.log(JSON.stringify({ rowCount: result.rowCount, rows: result.rows }, null, 2));
    });
  } else if (command === "project-tx-run") {
    if (!file) {
      throw new Error("project-tx-run requires a transaction function name");
    }
    const source = readSingleProjectSource(loadConfig(), command);
    const sql = emitTransactionSql(source, file);
    const params = parseJsonParams(extra);
    const attempts = transactionRetryAttempts(source, file);
    await withDatabase(async (db) => {
      const result = await runTransactionSql(db, sql, params, attempts);
      console.log(JSON.stringify(result, null, 2));
    });
  } else if (command === "project-data-insert" || command === "project-data-insert-sql") {
    if (!file) {
      throw new Error(`${command} requires an entity name`);
    }
    if (!extra) {
      throw new Error(`${command} requires a JSON object`);
    }
    const source = readSingleProjectSource(loadConfig(), command);
    const statement = emitInsertStatement(source, file, parseJsonObject(extra));
    if (command === "project-data-insert-sql") {
      console.log(JSON.stringify(statement, null, 2));
    } else {
      await withDatabase(async (db) => {
        const result = await runSqlQuery(db, statement.sql, statement.params);
        console.log(JSON.stringify({ rowCount: result.rowCount, rows: result.rows }, null, 2));
      });
    }
  } else if (command === "project-seed-run") {
    if (!file) {
      throw new Error("project-seed-run requires a seed JSON file");
    }
    const source = readSingleProjectSource(loadConfig(), command);
    const spec = parseSeedSpec(`@${file}`);
    await withDatabase(async (db) => {
      console.log(JSON.stringify(await runSeed(db, source, spec), null, 2));
    });
  } else if (command === "project-seed-dry-run") {
    if (!file) {
      throw new Error("project-seed-dry-run requires a seed JSON file");
    }
    const source = readSingleProjectSource(loadConfig(), command);
    const spec = parseSeedSpec(`@${file}`);
    await withDatabase(async (db) => {
      console.log(JSON.stringify(await dryRunSeed(db, source, spec), null, 2));
    });
  } else if (command === "project-seed-check") {
    if (!file) {
      throw new Error("project-seed-check requires a seed JSON file");
    }
    const source = readSingleProjectSource(loadConfig(), command);
    const spec = parseSeedSpec(`@${file}`);
    console.log(JSON.stringify(checkSeed(source, spec), null, 2));
  } else if (command === "project-seed-delete") {
    if (!file) {
      throw new Error("project-seed-delete requires a seed JSON file");
    }
    const source = readSingleProjectSource(loadConfig(), command);
    const spec = parseSeedSpec(`@${file}`);
    await withDatabase(async (db) => {
      console.log(JSON.stringify(await deleteSeed(db, source, spec), null, 2));
    });
  } else if (command === "project-seed-reset") {
    if (!file) {
      throw new Error("project-seed-reset requires a seed JSON file");
    }
    const source = readSingleProjectSource(loadConfig(), command);
    const spec = parseSeedSpec(`@${file}`);
    await withDatabase(async (db) => {
      console.log(JSON.stringify(await resetSeed(db, source, spec), null, 2));
    });
  } else if (command === "migrate-plan" || command === "migrate-diff-create") {
    if (!file) {
      throw new Error(`${command} requires <old-manifest.json> <current-file.dl>`);
    }
    if (!extra) {
      throw new Error(`${command} requires <old-manifest.json> <current-file.dl>`);
    }
    const previousManifest = readFileSync(file, "utf8");
    const currentSource = readFileSync(extra, "utf8");
    if (command === "migrate-plan") {
      console.log(emitMigrationPlan(previousManifest, currentSource));
    } else {
      const migrationName = process.argv.slice(2)[3] ?? "schema_diff";
      const artifact = emitDiffMigration(previousManifest, currentSource, migrationName);
      mkdirSync("migrations", { recursive: true });
      const path = join("migrations", artifact.filename);
      writeFileSync(path, artifact.sql);
      console.log(`created ${path}`);
    }
  } else {
    if (!file) {
      usage();
      process.exitCode = 1;
      throw new Error("missing file argument");
    }
    const source = readFileSync(file, "utf8");
    if (command === "check") {
      const result = compileSource(source);
      console.log(`ok: ${basename(file)} (${result.schema.entities.length} entities, ${result.schema.enums.length} enums)`);
    } else if (command === "sql") {
      console.log(emitPostgresSchema(source));
    } else if (command === "manifest") {
      console.log(emitSchemaManifest(source));
    } else if (command === "manifest-write") {
      const config = loadConfig();
      mkdirSync(dirname(config.schemaManifest), { recursive: true });
      writeFileSync(config.schemaManifest, emitSchemaManifest(source));
      console.log(`wrote ${config.schemaManifest}`);
    } else if (command === "query-ir") {
      if (!extra) {
        throw new Error("query-ir requires a query name");
      }
      console.log(emitQueryIr(source, extra));
    } else if (command === "query-sql") {
      if (!extra) {
        throw new Error("query-sql requires a query name");
      }
      console.log(emitQuerySql(source, extra));
    } else if (command === "query-run") {
      if (!extra) {
        throw new Error("query-run requires a query name");
      }
      const sql = emitQuerySql(source, extra);
      const params = parseJsonParams(extra2);
      await withDatabase(async (db) => {
        const result = await runSqlQuery(db, sql, params);
        console.log(JSON.stringify({ rowCount: result.rowCount, rows: result.rows }, null, 2));
      });
    } else if (command === "data-insert" || command === "data-insert-sql") {
      if (!extra) {
        throw new Error(`${command} requires an entity name`);
      }
      if (!extra2) {
        throw new Error(`${command} requires a JSON object`);
      }
      const statement = emitInsertStatement(source, extra, parseJsonObject(extra2));
      if (command === "data-insert-sql") {
        console.log(JSON.stringify(statement, null, 2));
      } else {
        await withDatabase(async (db) => {
          const result = await runSqlQuery(db, statement.sql, statement.params);
          console.log(JSON.stringify({ rowCount: result.rowCount, rows: result.rows }, null, 2));
        });
      }
    } else if (command === "seed-run") {
      if (!extra) {
        throw new Error("seed-run requires a seed JSON file");
      }
      const spec = parseSeedSpec(`@${extra}`);
      await withDatabase(async (db) => {
        console.log(JSON.stringify(await runSeed(db, source, spec), null, 2));
      });
    } else if (command === "seed-dry-run") {
      if (!extra) {
        throw new Error("seed-dry-run requires a seed JSON file");
      }
      const spec = parseSeedSpec(`@${extra}`);
      await withDatabase(async (db) => {
        console.log(JSON.stringify(await dryRunSeed(db, source, spec), null, 2));
      });
    } else if (command === "seed-check") {
      if (!extra) {
        throw new Error("seed-check requires a seed JSON file");
      }
      const spec = parseSeedSpec(`@${extra}`);
      console.log(JSON.stringify(checkSeed(source, spec), null, 2));
    } else if (command === "seed-delete") {
      if (!extra) {
        throw new Error("seed-delete requires a seed JSON file");
      }
      const spec = parseSeedSpec(`@${extra}`);
      await withDatabase(async (db) => {
        console.log(JSON.stringify(await deleteSeed(db, source, spec), null, 2));
      });
    } else if (command === "seed-reset") {
      if (!extra) {
        throw new Error("seed-reset requires a seed JSON file");
      }
      const spec = parseSeedSpec(`@${extra}`);
      await withDatabase(async (db) => {
        console.log(JSON.stringify(await resetSeed(db, source, spec), null, 2));
      });
    } else if (command === "tx-ir") {
      if (!extra) {
        throw new Error("tx-ir requires a transaction function name");
      }
      console.log(emitTransactionIr(source, extra));
    } else if (command === "tx-sql") {
      if (!extra) {
        throw new Error("tx-sql requires a transaction function name");
      }
      console.log(emitTransactionSql(source, extra));
    } else if (command === "tx-run") {
      if (!extra) {
        throw new Error("tx-run requires a transaction function name");
      }
      const sql = emitTransactionSql(source, extra);
      const params = parseJsonParams(extra2);
      const attempts = transactionRetryAttempts(source, extra);
      await withDatabase(async (db) => {
        const result = await runTransactionSql(db, sql, params, attempts);
        console.log(JSON.stringify(result, null, 2));
      });
    } else if (command === "explain") {
      if (!extra) {
        throw new Error("explain requires a query name");
      }
      console.log(explainQuery(source, extra));
    } else if (command === "migrate-create") {
      const migrationName = extra ?? "initial_schema";
      const artifact = emitInitialMigration(source, migrationName);
      mkdirSync("migrations", { recursive: true });
      const path = join("migrations", artifact.filename);
      writeFileSync(path, artifact.sql);
      console.log(`created ${path}`);
    } else {
      usage();
      process.exitCode = 1;
    }
  }
} catch (error) {
  const mapped = mapDatabaseError(error);
  if (mapped) {
    console.error(`error[${mapped.name}]: ${mapped.message}`);
    if (mapped.detail) console.error(mapped.detail);
  } else if (error instanceof DlAggregateError) {
    for (const diagnostic of error.diagnostics) {
      console.error(`error: ${diagnostic}`);
    }
  } else if (error instanceof Error) {
    console.error(`error: ${error.message}`);
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
}

function usage(): void {
  console.error("usage: dl <check|project-check|project-summary|project-doctor|project-sql|project-manifest|project-manifest-write|project-migrate-plan|project-migrate-diff-create|project-query-ir|project-query-sql|project-query-run|project-explain|project-tx-ir|project-tx-sql|project-tx-run|project-data-insert|project-data-insert-sql|project-seed-run|project-seed-dry-run|project-seed-check|project-seed-delete|project-seed-reset|sql|manifest|manifest-write|query-ir|query-sql|query-run|data-insert|data-insert-sql|seed-run|seed-dry-run|seed-check|seed-delete|seed-reset|tx-ir|tx-sql|tx-run|explain|migrate-create|migrate-plan|migrate-diff-create|migrate-status|migrate-apply|outbox-list|outbox-claim|outbox-mark-processed|outbox-mark-failed|outbox-requeue|outbox-requeue-stale> [args]");
}

async function withDatabase<T>(callback: (db: ReturnType<typeof createPostgresDatabase>, config: ReturnType<typeof loadConfig>) => Promise<T>): Promise<T> {
  const config = loadConfig();
  const db = createPostgresDatabase(config);
  try {
    return await callback(db, config);
  } finally {
    await db.end?.();
  }
}

function parseOutboxListArgs(first: string | undefined, second: string | undefined): { status: OutboxListStatus; limit: number } {
  const defaultLimit = 50;
  if (!first) {
    return { status: "pending", limit: defaultLimit };
  }

  const firstAsLimit = Number.parseInt(first, 10);
  if (Number.isFinite(firstAsLimit) && String(firstAsLimit) === first) {
    return { status: "pending", limit: firstAsLimit };
  }

  if (!isOutboxListStatus(first)) {
    throw new Error(`unknown outbox status ${first}`);
  }

  const secondAsLimit = second ? Number.parseInt(second, 10) : defaultLimit;
  return {
    status: first,
    limit: Number.isFinite(secondAsLimit) ? secondAsLimit : defaultLimit,
  };
}

function isOutboxListStatus(value: string): value is OutboxListStatus {
  return value === "pending" || value === "processing" || value === "processed" || value === "failed" || value === "all";
}

function readSingleProjectSource(config: ReturnType<typeof loadConfig>, command: string): string {
  const files = discoverSourceFiles(config);
  if (files.length === 0) {
    throw new Error(`no Reux source files matched configured sources: ${config.sources.join(", ")}`);
  }
  if (files.length > 1) {
    throw new Error(`${command} requires exactly one configured source file; found ${files.length}`);
  }
  return readFileSync(files[0].path, "utf8");
}

function formatProjectSummary(summary: ProjectSummary): string {
  const lines = [
    `files: ${summary.totals.files}`,
    `entities: ${summary.totals.entities}`,
    `enums: ${summary.totals.enums}`,
    `queries: ${summary.totals.queries}`,
    `transactions: ${summary.totals.transactions}`,
    "",
  ];

  if (summary.diagnostics.length > 0) {
    lines.push("diagnostics:");
    for (const diagnostic of summary.diagnostics) {
      lines.push(`  - ${diagnostic}`);
    }
    lines.push("");
  }

  for (const file of summary.files) {
    lines.push(`${file.path}`);
    lines.push(`  module: ${file.moduleName}`);
    lines.push(`  entities: ${formatList(file.entities)}`);
    lines.push(`  enums: ${formatList(file.enums)}`);
    lines.push(`  queries: ${formatList(file.queries)}`);
    lines.push(`  transactions: ${formatList(file.transactions)}`);
  }

  return lines.join("\n");
}

function formatList(values: string[]): string {
  return values.length === 0 ? "-" : values.join(", ");
}

function formatProjectDoctor(config: ReturnType<typeof loadConfig>): string {
  const lines = ["project doctor"];
  lines.push(`backend: ${config.backend}`);
  lines.push(`database env: ${config.databaseUrlEnv} ${process.env[config.databaseUrlEnv] ? "(set)" : "(not set)"}`);
  lines.push(`sources: ${config.sources.join(", ")}`);

  const summary = summarizeProject(config);
  lines.push(`matched source files: ${summary.totals.files}`);
  for (const diagnostic of summary.diagnostics) {
    lines.push(`warning: ${diagnostic}`);
  }

  lines.push(...manifestDoctorLines(config));
  lines.push(...migrationDoctorLines(config));
  return lines.join("\n");
}

function manifestDoctorLines(config: ReturnType<typeof loadConfig>): string[] {
  if (!existsSync(config.schemaManifest)) {
    return [`schema manifest: missing (${config.schemaManifest})`];
  }

  const files = discoverSourceFiles(config);
  if (files.length !== 1) {
    return [`schema manifest: present (${config.schemaManifest}); freshness check requires exactly one configured source`];
  }

  const current = JSON.parse(emitSchemaManifest(readFileSync(files[0].path, "utf8"))) as { schemaHash: string };
  const stored = JSON.parse(readFileSync(config.schemaManifest, "utf8")) as { schemaHash?: string };
  if (stored.schemaHash === current.schemaHash) {
    return [`schema manifest: current (${config.schemaManifest})`];
  }
  return [`schema manifest: stale (${config.schemaManifest})`, `  stored: ${stored.schemaHash ?? "missing"}`, `  current: ${current.schemaHash}`];
}

function migrationDoctorLines(config: ReturnType<typeof loadConfig>): string[] {
  if (!existsSync(config.migrationsDir)) {
    return [`migrations: missing directory (${config.migrationsDir})`];
  }
  const migrationCount = readdirSync(config.migrationsDir).filter((file) => file.endsWith(".sql")).length;
  return [`migrations: ${migrationCount} sql file${migrationCount === 1 ? "" : "s"} (${config.migrationsDir})`];
}
