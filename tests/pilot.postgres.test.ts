import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  emitInsertStatement,
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
      const account = await insertOne<{ id: string }>(pilotDb, source, "Account", {
        email: `pilot-${schemaName}@example.com`,
        displayName: "Pilot Account",
        balance: "50",
      });
      await insertOne(pilotDb, source, "Product", {
        sku: `SKU-${schemaName}`,
        name: "Pilot Product",
        price: "250",
      });
      const order = await insertOne<{ id: string }>(pilotDb, source, "Order", {
        account: account.id,
        total: "250",
        status: "Pending",
      });
      await insertOne(pilotDb, source, "Payment", {
        order: order.id,
        amount: "125",
        status: "Authorized",
      });

      const accountOrders = await runSqlQuery(pilotDb, emitQuerySql(source, "accountOrders"), ["100"]);
      expect(accountOrders.rows).toEqual([
        expect.objectContaining({
          email: `pilot-${schemaName}@example.com`,
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
          email: `pilot-${schemaName}@example.com`,
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
          email: `pilot-${schemaName}@example.com`,
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

async function insertOne<T>(
  db: ReturnType<typeof createPostgresDatabase>,
  source: string,
  entity: string,
  record: Record<string, unknown>,
): Promise<T> {
  const statement = emitInsertStatement(source, entity, record);
  const result = await runSqlQuery(db, statement.sql, statement.params);
  return result.rows[0] as T;
}

function databaseUrlWithSearchPath(source: string, schemaName: string): string {
  const url = new URL(source);
  url.searchParams.set("options", `-c search_path=${schemaName},public`);
  return url.toString();
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
