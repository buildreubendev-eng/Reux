#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  compileSource,
  checkMigrationSafety,
  diagnoseSource,
  emitApiClient,
  emitApiServer,
  emitBusinessSimulatorContractFixture,
  emitInsertStatement,
  emitDiffMigration,
  formatReuxSource,
  emitInitialMigration,
  emitMigrationPlan,
  emitPostgresSchema,
  emitQueryIr,
  emitQuerySql,
  emitSchemaManifest,
  emitSimulationIr,
  emitReuxSimulationExecutionFixture,
  emitSimulationPacks,
  emitSimulationRun,
  emitSimulationTypes,
  emitTransitionRules,
  emitTransactionIr,
  emitTransactionSql,
  emitWorker,
  explainQuery,
  transactionRetryAttempts,
} from "./compiler.js";
import { emitReuxCapabilitiesJson, formatReuxCapabilitiesMarkdown } from "./capabilities.js";
import { loadConfig } from "./config.js";
import { commandUsage, formatCommandHelp, formatMainHelp, formatUnknownCommand, isKnownCommand } from "./cli-help.js";
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
  outboxStats,
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
    console.error(formatMainHelp());
    process.exitCode = 1;
  } else if (command === "help" || command === "--help" || command === "-h") {
    console.log(file ? formatCommandHelp(file) : formatMainHelp());
  } else if (command === "version" || command === "--version" || command === "-v") {
    console.log(packageVersion());
  } else if (args.includes("--help") || args.includes("-h")) {
    console.log(formatCommandHelp(command));
  } else if (!isKnownCommand(command)) {
    console.error(formatUnknownCommand(command));
    process.exitCode = 1;
  } else if (command === "capabilities") {
    process.stdout.write(file === "--markdown" ? formatReuxCapabilitiesMarkdown() : emitReuxCapabilitiesJson());
  } else if (command === "business-simulator-contract") {
    process.stdout.write(emitBusinessSimulatorContractFixture());
  } else if (command === "project-diagnose") {
    const config = loadConfig();
    const files = discoverSourceFiles(config);
    if (files.length === 0) {
      throw new Error(`no Reux source files matched configured sources: ${config.sources.join(", ")}`);
    }
    const reports = files.map((sourceFile) => ({
      path: sourceFile.relativePath,
      ...diagnoseSource(readFileSync(sourceFile.path, "utf8")),
    }));
    const ok = reports.every((report) => report.ok);
    if (file === "--json") {
      console.log(JSON.stringify({ ok, files: reports }, null, 2));
    } else {
      console.log(formatDiagnosticReports(reports));
    }
    if (!ok) process.exitCode = 1;
  } else if (command === "format") {
    if (!file) {
      throw new Error("format requires a source file");
    }
    process.stdout.write(formatReuxSource(readFileSync(file, "utf8")));
  } else if (command === "project-format") {
    const source = readSingleProjectSource(loadConfig(), command);
    process.stdout.write(formatReuxSource(source));
  } else if (command === "migrate-status") {
    await withDatabase(async (db, config) => {
      const status = await migrationStatus(db, config.migrationsDir);
      if (file === "--json") {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(`applied: ${status.applied.length}`);
        for (const record of status.applied) {
          console.log(`  ${record.filename} ${record.hash.slice(0, 12)} ${record.appliedAt}`);
        }
        console.log(`pending: ${status.pending.length}`);
        for (const pending of status.pending) {
          console.log(`  ${pending.filename} ${pending.hash.slice(0, 12)}`);
        }
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
  } else if (command === "outbox-stats") {
    await withDatabase(async (db) => {
      console.log(JSON.stringify(await outboxStats(db), null, 2));
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
      console.log(`ok: ${sourceFile.relativePath} (${result.schema.entities.length} entities, ${result.schema.enums.length} enums, ${result.simulations.length} simulations)`);
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
    const config = loadConfig();
    const includeDatabase = args.includes("--db");
    const json = args.includes("--json");
    const report = buildProjectDoctorReport(config);
    if (includeDatabase) {
      await withDatabase(async (db) => {
        report.database = databaseDoctorReport(await migrationStatus(db, config.migrationsDir));
      });
    }
    console.log(json ? JSON.stringify(report, null, 2) : formatProjectDoctorReport(report));
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
  } else if (command === "project-migrate-check") {
    const config = loadConfig();
    const source = readSingleProjectSource(config, command);
    const previousManifest = readFileSync(config.schemaManifest, "utf8");
    const check = checkMigrationSafety(previousManifest, source, migrationSafetyOptions());
    console.log(args.includes("--json") ? JSON.stringify(check, null, 2) : formatMigrationSafetyCheck(check));
    if (!check.ok) process.exitCode = 1;
  } else if (command === "project-migrate-diff-create") {
    const config = loadConfig();
    const source = readSingleProjectSource(config, command);
    const previousManifest = readFileSync(config.schemaManifest, "utf8");
    assertMigrationSafe(previousManifest, source);
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
  } else if (command === "project-transition-rules") {
    const source = readSingleProjectSource(loadConfig(), command);
    console.log(emitTransitionRules(source, file));
  } else if (command === "project-api-ts") {
    const source = readSingleProjectSource(loadConfig(), command);
    console.log(emitApiClient(source, { runtimeImport: file }));
  } else if (command === "project-api-server-ts") {
    const source = readSingleProjectSource(loadConfig(), command);
    console.log(emitApiServer(source, parseApiServerOptions(file, extra, extra2)));
  } else if (command === "project-worker-ts") {
    const source = readSingleProjectSource(loadConfig(), command);
    console.log(emitWorker(source, { configImport: file, runtimeImport: extra }));
  } else if (command === "project-simulation-types-ts") {
    const source = readSingleProjectSource(loadConfig(), command);
    console.log(emitSimulationTypes(source));
  } else if (command === "project-simulation-packs") {
    const source = readSingleProjectSource(loadConfig(), command);
    const target = file === "--json" ? undefined : file;
    console.log(emitSimulationPacks(source, target, args.includes("--json") ? "json" : "text"));
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
  } else if (command === "project-simulation-ir" || command === "project-simulation-run") {
    const source = readSingleProjectSource(loadConfig(), command);
    if (command === "project-simulation-ir") {
      console.log(emitSimulationIr(source, file));
    } else {
      console.log(emitSimulationRun(source, file));
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
  } else if (command === "migrate-plan" || command === "migrate-check" || command === "migrate-diff-create") {
    if (!file) {
      throw new Error(`${command} requires <old-manifest.json> <current-file.dl>`);
    }
    if (!extra) {
      throw new Error(`${command} requires <old-manifest.json> <current-file.dl>`);
    }
    const previousManifest = readFileSync(file, "utf8");
    const currentSource = readFileSync(extra, "utf8");
    if (command === "migrate-plan") {
      console.log(emitMigrationPlan(previousManifest, currentSource, args.includes("--json") ? "json" : "text"));
    } else if (command === "migrate-check") {
      const check = checkMigrationSafety(previousManifest, currentSource, migrationSafetyOptions());
      console.log(args.includes("--json") ? JSON.stringify(check, null, 2) : formatMigrationSafetyCheck(check));
      if (!check.ok) process.exitCode = 1;
    } else {
      assertMigrationSafe(previousManifest, currentSource);
      const migrationName = process.argv.slice(2)[3] ?? "schema_diff";
      const artifact = emitDiffMigration(previousManifest, currentSource, migrationName);
      mkdirSync("migrations", { recursive: true });
      const path = join("migrations", artifact.filename);
      writeFileSync(path, artifact.sql);
      console.log(`created ${path}`);
    }
  } else {
    if (!file) {
      throw new Error(`${command} requires a source file`);
    }
    const source = readFileSync(file, "utf8");
    if (command === "diagnose") {
      const report = diagnoseSource(source);
      if (extra === "--json") {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatDiagnosticReport(file, report));
      }
      if (!report.ok) process.exitCode = 1;
    } else if (command === "check") {
      const result = compileSource(source);
      console.log(`ok: ${basename(file)} (${result.schema.entities.length} entities, ${result.schema.enums.length} enums, ${result.simulations.length} simulations)`);
    } else if (command === "sql") {
      console.log(emitPostgresSchema(source));
    } else if (command === "manifest") {
      console.log(emitSchemaManifest(source));
    } else if (command === "transition-rules") {
      console.log(emitTransitionRules(source, extra));
    } else if (command === "api-ts") {
      console.log(emitApiClient(source, { runtimeImport: extra }));
    } else if (command === "api-server-ts") {
      console.log(emitApiServer(source, parseApiServerOptions(extra, extra2, args[4])));
    } else if (command === "worker-ts") {
      console.log(emitWorker(source, { configImport: extra, runtimeImport: extra2 }));
    } else if (command === "simulation-types-ts") {
      console.log(emitSimulationTypes(source));
    } else if (command === "simulation-packs") {
      const target = extra === "--json" ? undefined : extra;
      console.log(emitSimulationPacks(source, target, args.includes("--json") ? "json" : "text"));
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
    } else if (command === "simulation-ir") {
      console.log(emitSimulationIr(source, extra));
    } else if (command === "simulation-run") {
      console.log(emitSimulationRun(source, extra));
    } else if (command === "simulation-execution-fixture") {
      console.log(emitReuxSimulationExecutionFixture(source, extra));
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
    const usage = command ? commandUsage(command) : undefined;
    if (usage) {
      console.error(`Usage: ${usage}`);
      console.error(`Run \`reux help ${command}\` for examples.`);
    } else {
      console.error("Run `reux help` to list available commands.");
    }
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
}

function usage(): void {
  console.error(formatMainHelp());
}

function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { name?: string; version?: string };
  return `${pkg.name ?? "reux"} ${pkg.version ?? "0.0.0"}`;
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
  return value === "pending" || value === "processing" || value === "processed" || value === "failed" || value === "dead" || value === "all";
}

function parseApiServerOptions(apiImport?: string, configImport?: string, runtimeImport?: string): Parameters<typeof emitApiServer>[1] {
  return {
    apiImport,
    configImport,
    runtimeImport,
  };
}

function migrationSafetyOptions(): Parameters<typeof checkMigrationSafety>[2] {
  const allowDestructive = args.includes("--allow-destructive");
  const envIndex = args.indexOf("--env");
  const environment = envIndex >= 0 ? args[envIndex + 1] : process.env.REUX_ENV;
  return {
    allowDestructive,
    allowUnsafe: allowDestructive || args.includes("--allow-unsafe"),
    environment: parseMigrationEnvironment(environment),
    allowProduction: args.includes("--allow-production"),
  };
}

function parseMigrationEnvironment(value: string | undefined): "development" | "staging" | "production" | undefined {
  if (!value) return undefined;
  if (value === "development" || value === "staging" || value === "production") return value;
  throw new Error(`unknown migration environment ${value}`);
}

function assertMigrationSafe(previousManifest: string, currentSource: string): void {
  const check = checkMigrationSafety(previousManifest, currentSource, migrationSafetyOptions());
  if (!check.ok) {
    throw new Error(`migration safety check failed before creating migration:\n${check.diagnostics.map((diagnostic) => `- ${diagnostic}`).join("\n")}`);
  }
}

function formatMigrationSafetyCheck(check: ReturnType<typeof checkMigrationSafety>): string {
  const lines = [
    check.ok ? "migration safety check passed" : "migration safety check failed",
    `Safe: ${check.summary.safe}, unsafe: ${check.summary.unsafe}, destructive: ${check.summary.destructive}`,
  ];
  if (check.allowed.allowUnsafe || check.allowed.allowDestructive) {
    lines.push(
      `Allowed: unsafe=${check.allowed.allowUnsafe ? "yes" : "no"}, destructive=${check.allowed.allowDestructive ? "yes" : "no"}`,
    );
  }
  if (check.allowed.environment) {
    lines.push(`Environment: ${check.allowed.environment}${check.allowed.allowProduction ? " (production override enabled)" : ""}`);
  }
  for (const diagnostic of check.diagnostics) {
    lines.push(`- ${diagnostic}`);
  }
  if (check.review.required) {
    lines.push("Review required before apply:");
    for (const warning of check.review.warnings) lines.push(`- ${warning}`);
  }
  return lines.join("\n");
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
    `simulations: ${summary.totals.simulations}`,
    `transactions: ${summary.totals.transactions}`,
    `transitions: ${summary.totals.transitions}`,
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
    lines.push(`  simulations: ${formatList(file.simulations)}`);
    lines.push(`  transactions: ${formatList(file.transactions)}`);
    lines.push(`  transitions: ${formatList(file.transitions)}`);
  }

  return lines.join("\n");
}

function formatDiagnosticReports(reports: Array<{ path: string } & ReturnType<typeof diagnoseSource>>): string {
  return reports.map((report) => formatDiagnosticReport(report.path, report)).join("\n\n");
}

function formatDiagnosticReport(path: string, report: ReturnType<typeof diagnoseSource>): string {
  if (report.ok) {
    const summary = report.summary;
    if (!summary) return `${path}: ok`;
    return [
      `${path}: ok`,
      `  module: ${summary.moduleName}`,
      `  entities: ${summary.entities}`,
      `  enums: ${summary.enums}`,
      `  queries: ${summary.queries}`,
      `  simulations: ${summary.simulations}`,
      `  transactions: ${summary.transactions}`,
      `  transitions: ${summary.transitions}`,
    ].join("\n");
  }

  return [`${path}: ${report.diagnostics.length} error${report.diagnostics.length === 1 ? "" : "s"}`, ...report.diagnostics.map((diagnostic) => `  error: ${diagnostic.message}`)].join("\n");
}

function formatList(values: string[]): string {
  return values.length === 0 ? "-" : values.join(", ");
}

interface ProjectDoctorReport {
  backend: string;
  databaseUrlEnv: {
    name: string;
    set: boolean;
  };
  sources: string[];
  matchedSourceFiles: number;
  warnings: string[];
  schemaManifest: ProjectDoctorSchemaManifest;
  migrations: ProjectDoctorMigrations;
  database?: ProjectDoctorDatabase;
}

interface ProjectDoctorSchemaManifest {
  path: string;
  status: "current" | "missing" | "present" | "stale";
  storedHash?: string;
  currentHash?: string;
  note?: string;
}

interface ProjectDoctorMigrations {
  path: string;
  status: "missing" | "present";
  sqlFiles: number;
}

interface ProjectDoctorDatabase {
  appliedMigrations: number;
  pendingMigrations: number;
  pendingFiles: string[];
}

function buildProjectDoctorReport(config: ReturnType<typeof loadConfig>): ProjectDoctorReport {
  const summary = summarizeProject(config);
  return {
    backend: config.backend,
    databaseUrlEnv: {
      name: config.databaseUrlEnv,
      set: Boolean(process.env[config.databaseUrlEnv]),
    },
    sources: config.sources,
    matchedSourceFiles: summary.totals.files,
    warnings: summary.diagnostics,
    schemaManifest: schemaManifestDoctorReport(config),
    migrations: migrationsDoctorReport(config),
  };
}

function formatProjectDoctorReport(report: ProjectDoctorReport): string {
  const lines = ["project doctor"];
  lines.push(`backend: ${report.backend}`);
  lines.push(`database env: ${report.databaseUrlEnv.name} ${report.databaseUrlEnv.set ? "(set)" : "(not set)"}`);
  lines.push(`sources: ${report.sources.join(", ")}`);
  lines.push(`matched source files: ${report.matchedSourceFiles}`);
  for (const diagnostic of report.warnings) {
    lines.push(`warning: ${diagnostic}`);
  }

  lines.push(...formatSchemaManifestDoctor(report.schemaManifest));
  lines.push(formatMigrationsDoctor(report.migrations));
  if (report.database) {
    lines.push(...formatDatabaseDoctor(report.database));
  }
  return lines.join("\n");
}

function schemaManifestDoctorReport(config: ReturnType<typeof loadConfig>): ProjectDoctorSchemaManifest {
  if (!existsSync(config.schemaManifest)) {
    return { path: config.schemaManifest, status: "missing" };
  }

  const files = discoverSourceFiles(config);
  if (files.length !== 1) {
    return {
      path: config.schemaManifest,
      status: "present",
      note: "freshness check requires exactly one configured source",
    };
  }

  const current = JSON.parse(emitSchemaManifest(readFileSync(files[0].path, "utf8"))) as { schemaHash: string };
  const stored = JSON.parse(readFileSync(config.schemaManifest, "utf8")) as { schemaHash?: string };
  if (stored.schemaHash === current.schemaHash) {
    return { path: config.schemaManifest, status: "current", storedHash: stored.schemaHash, currentHash: current.schemaHash };
  }
  return {
    path: config.schemaManifest,
    status: "stale",
    storedHash: stored.schemaHash,
    currentHash: current.schemaHash,
  };
}

function formatSchemaManifestDoctor(manifest: ProjectDoctorSchemaManifest): string[] {
  if (manifest.status === "missing") {
    return [`schema manifest: missing (${manifest.path})`];
  }
  if (manifest.status === "present") {
    return [`schema manifest: present (${manifest.path}); ${manifest.note}`];
  }
  if (manifest.status === "current") {
    return [`schema manifest: current (${manifest.path})`];
  }
  return [
    `schema manifest: stale (${manifest.path})`,
    `  stored: ${manifest.storedHash ?? "missing"}`,
    `  current: ${manifest.currentHash}`,
  ];
}

function migrationsDoctorReport(config: ReturnType<typeof loadConfig>): ProjectDoctorMigrations {
  if (!existsSync(config.migrationsDir)) {
    return { path: config.migrationsDir, status: "missing", sqlFiles: 0 };
  }
  const migrationCount = readdirSync(config.migrationsDir).filter((file) => file.endsWith(".sql")).length;
  return { path: config.migrationsDir, status: "present", sqlFiles: migrationCount };
}

function formatMigrationsDoctor(migrations: ProjectDoctorMigrations): string {
  if (migrations.status === "missing") {
    return `migrations: missing directory (${migrations.path})`;
  }
  return `migrations: ${migrations.sqlFiles} sql file${migrations.sqlFiles === 1 ? "" : "s"} (${migrations.path})`;
}

function databaseDoctorReport(status: Awaited<ReturnType<typeof migrationStatus>>): ProjectDoctorDatabase {
  return {
    appliedMigrations: status.applied.length,
    pendingMigrations: status.pending.length,
    pendingFiles: status.pending.map((pending) => pending.filename),
  };
}

function formatDatabaseDoctor(database: ProjectDoctorDatabase): string[] {
  const lines = ["database doctor"];
  lines.push(`applied migrations: ${database.appliedMigrations}`);
  lines.push(`pending migrations: ${database.pendingMigrations}`);
  for (const pending of database.pendingFiles) {
    lines.push(`  pending: ${pending}`);
  }
  return lines;
}
