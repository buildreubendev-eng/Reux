import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { emitInsertStatement, emitQuerySql, emitTransactionSql, transactionRetryAttempts } from "../src/compiler.js";
import {
  applyMigrations,
  createPostgresDatabase,
  claimOutboxEvents,
  listOutboxEvents,
  markOutboxFailed,
  markOutboxProcessed,
  migrationStatus,
  requeueOutboxEvent,
  runTransactionSql,
  runSqlQuery,
} from "../src/runtime.js";
import { defaultConfig } from "../src/config.js";

const runIntegration = Boolean(process.env.DATABASE_URL);
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration("postgres integration", () => {
  it("applies migrations, inserts data, and runs a compiled query", async () => {
    const db = createPostgresDatabase(defaultConfig);
    const unique = randomUUID().slice(0, 8);
    let insertedUserId: string | undefined;
    let outboxEventId: string | undefined;
    try {
      await applyMigrations(db, "migrations");
      const status = await migrationStatus(db, "migrations");
      expect(status.pending).toEqual([]);

      const source = `module commerce

entity User {
  id: Id<User> primary generated
  name: String
  email: String? unique
  balance: Decimal default 0
}

query highValueUsers(min: Decimal): Query<{ email: String?, balance: Decimal }> =
  from user in User
  where user.balance > min
  order by user.balance desc
  select { email: user.email, balance: user.balance }

transaction function rewardUser(userRef: User, amount: Decimal) writes User retry 3 {
  let user = load userRef for update
  user.balance += amount
  save user
  enqueue RewardGranted { user: userRef, amount: amount }
  after commit sendRewardEmail(userRef)
}
`;
      const insert = emitInsertStatement(source, "User", {
        name: `Ada ${unique}`,
        email: `ada-${unique}@example.com`,
        balance: "1200",
      });
      const inserted = await runSqlQuery(db, insert.sql, insert.params);
      const insertedUser = inserted.rows[0] as { id: string };
      insertedUserId = insertedUser.id;

      const txSql = emitTransactionSql(source, "rewardUser");
      const txResult = await runTransactionSql(db, txSql, [insertedUser.id, "50"], transactionRetryAttempts(source, "rewardUser"));
      expect(txResult.afterCommit).toEqual(["sendRewardEmail(userRef)"]);
      expect(txResult.outboxEvents).toEqual([
        expect.objectContaining({
          event_type: "RewardGranted",
        }),
      ]);
      const pendingEvents = await listOutboxEvents(db, 10);
      outboxEventId = (txResult.outboxEvents[0] as { id: string }).id;
      const event = pendingEvents.find((candidate) => candidate.id === outboxEventId);
      expect(event).toMatchObject({
        eventType: "RewardGranted",
        status: "pending",
      });
      const claimed = await claimOutboxEvents(db, 1);
      expect(claimed).toEqual([
        expect.objectContaining({
          id: event!.id,
          status: "processing",
          attempts: expect.any(Number),
        }),
      ]);
      const failed = await markOutboxFailed(db, event!.id, "integration retry check");
      expect(failed).toMatchObject({
        id: event!.id,
        status: "failed",
        lastError: "integration retry check",
      });
      const requeued = await requeueOutboxEvent(db, event!.id);
      expect(requeued).toMatchObject({
        id: event!.id,
        status: "pending",
      });
      const reclaimed = await claimOutboxEvents(db, 1);
      expect(reclaimed[0]).toMatchObject({
        id: event!.id,
        status: "processing",
      });
      const processed = await markOutboxProcessed(db, event!.id);
      expect(processed).toMatchObject({
        id: event!.id,
        status: "processed",
      });

      const query = emitQuerySql(source, "highValueUsers");
      const result = await runSqlQuery(db, query, ["1000"]);

      expect(result.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            email: `ada-${unique}@example.com`,
          }),
        ]),
      );
    } finally {
      if (outboxEventId) {
        await db.query("DELETE FROM _dl_outbox WHERE id = $1;", [outboxEventId]);
      }
      if (insertedUserId) {
        await db.query("DELETE FROM users WHERE id = $1;", [insertedUserId]);
      }
      await db.end?.();
    }
  });
});
