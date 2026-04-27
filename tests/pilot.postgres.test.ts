import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  emitQuerySql,
  emitTransactionSql,
  transactionRetryAttempts,
} from "../src/compiler.js";
import { DlConfig } from "../src/config.js";
import {
  applyMigrations,
  createPostgresDatabase,
  migrationStatus,
  runSqlQuery,
  runTransactionSql,
} from "../src/runtime.js";
import { parseSeedSpec, runSeed } from "../src/seed.js";

const runIntegration = Boolean(process.env.DATABASE_URL);
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration("pilot postgres smoke", () => {
  it("applies pilot migrations, seeds data, and exercises pilot queries and transactions", async () => {
    const schemaName = `reux_pilot_${randomUUID().replaceAll("-", "_")}`;
    const adminConfig: DlConfig = {
      backend: "postgres",
      databaseUrlEnv: "DATABASE_URL",
      migrationsDir: "pilot/migrations",
      schemaManifest: "pilot/.dl/schema-manifest.json",
      sources: ["examples/pilot_reux.dl"],
    };
    const adminDb = createPostgresDatabase(adminConfig);
    const previousPilotUrl = process.env.PILOT_DATABASE_URL;
    let pilotDb: ReturnType<typeof createPostgresDatabase> | undefined;

    try {
      await adminDb.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)};`);
      process.env.PILOT_DATABASE_URL = databaseUrlWithSearchPath(process.env.DATABASE_URL!, schemaName);
      const pilotConfig: DlConfig = {
        ...adminConfig,
        databaseUrlEnv: "PILOT_DATABASE_URL",
      };
      pilotDb = createPostgresDatabase(pilotConfig);

      await applyMigrations(pilotDb, pilotConfig.migrationsDir);
      const status = await migrationStatus(pilotDb, pilotConfig.migrationsDir);
      expect(status.pending).toEqual([]);

      const source = readFileSync("examples/pilot_reux.dl", "utf8");
      const seed = parseSeedSpec("@pilot/seeds/smoke.json");
      const seedResult = await runSeed(pilotDb, source, seed);
      await runSeed(pilotDb, source, seed);
      const account = seeded(seedResult, "ada");
      const order = seeded(seedResult, "adaOrder");

      const accountOrders = await runSqlQuery(pilotDb, emitQuerySql(source, "accountOrders"), ["100"]);
      expect(accountOrders.rows).toEqual([
        expect.objectContaining({
          email: "ada.pilot@example.com",
          status: "Pending",
        }),
      ]);

      const orderPayments = await runSqlQuery(pilotDb, emitQuerySql(source, "orderPayments"), ["100"]);
      expect(orderPayments.rows).toEqual([
        expect.objectContaining({
          paymentstatus: "Authorized",
        }),
      ]);

      const accountSummary = await runSqlQuery(pilotDb, emitQuerySql(source, "accountOrderSummary"), ["100"]);
      expect(accountSummary.rows).toEqual([
        expect.objectContaining({
          email: "ada.pilot@example.com",
          ordercount: "1",
        }),
      ]);

      const captureResult = await runTransactionSql(
        pilotDb,
        emitTransactionSql(source, "capturePayment"),
        [order.id, "250"],
        transactionRetryAttempts(source, "capturePayment"),
      );
      expect(captureResult.outboxEvents).toEqual([
        expect.objectContaining({
          event_type: "PaymentCaptured",
        }),
      ]);
      expect(captureResult.afterCommit).toEqual(["sendReceipt(orderRef)"]);

      const markPaidResult = await runTransactionSql(
        pilotDb,
        emitTransactionSql(source, "markOrderPaid"),
        [order.id],
        transactionRetryAttempts(source, "markOrderPaid"),
      );
      expect(markPaidResult.outboxEvents).toEqual([
        expect.objectContaining({
          event_type: "OrderPaid",
        }),
      ]);
      expect(markPaidResult.afterCommit).toEqual(["notifyOrderPaid(orderRef)"]);

      const creditResult = await runTransactionSql(
        pilotDb,
        emitTransactionSql(source, "creditAccount"),
        [account.id, "25"],
        transactionRetryAttempts(source, "creditAccount"),
      );
      expect(creditResult.outboxEvents).toEqual([
        expect.objectContaining({
          event_type: "AccountCredited",
        }),
      ]);
      expect(creditResult.afterCommit).toEqual(["notifyAccountCredited(accountRef)"]);

      const balances = await runSqlQuery(pilotDb, emitQuerySql(source, "accountBalances"), ["70"]);
      expect(balances.rows).toEqual([
        expect.objectContaining({
          email: "ada.pilot@example.com",
        }),
      ]);
    } finally {
      await pilotDb?.end?.();
      if (previousPilotUrl === undefined) {
        delete process.env.PILOT_DATABASE_URL;
      } else {
        process.env.PILOT_DATABASE_URL = previousPilotUrl;
      }
      await adminDb.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE;`);
      await adminDb.end?.();
    }
  });
});

function databaseUrlWithSearchPath(source: string, schemaName: string): string {
  const url = new URL(source);
  url.searchParams.set("options", `-c search_path=${schemaName},public`);
  return url.toString();
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function seeded(result: { inserted: { as?: string; id?: unknown }[] }, alias: string): { id: string } {
  const match = result.inserted.find((record) => record.as === alias);
  if (!match?.id || typeof match.id !== "string") {
    throw new Error(`seed alias ${alias} was not inserted`);
  }
  return { id: match.id };
}
