import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { databaseUrl, loadConfig } from "../src/config.js";
import { emitInsertStatement, emitQuerySql } from "../src/compiler.js";
import { mapDatabaseError } from "../src/db-errors.js";
import { parseJsonObject } from "../src/data.js";
import { checkSeed, deleteSeed, parseSeedSpec, resetSeed, runSeed } from "../src/seed.js";
import {
  applyMigrations,
  claimOutboxEvents,
  Database,
  listOutboxEvents,
  markOutboxFailed,
  markOutboxProcessed,
  migrationStatus,
  parseJsonParams,
  parseTransactionSql,
  processOutboxEvents,
  readMigrationFiles,
  requeueOutboxEvent,
  runTransactionSql,
} from "../src/runtime.js";

describe("runtime spine", () => {
  it("loads dl.json with defaults", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "dl.json"),
      JSON.stringify({
        databaseUrlEnv: "TEST_DATABASE_URL",
        migrationsDir: "db/migrations",
      }),
    );

    const config = loadConfig(dir);

    expect(config).toEqual({
      backend: "postgres",
      databaseUrlEnv: "TEST_DATABASE_URL",
      migrationsDir: "db/migrations",
      schemaManifest: ".dl/schema-manifest.json",
      sources: ["src/**/*.dl"],
    });
  });

  it("loads an alternate project config from REUX_CONFIG", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "pilot.json"),
      JSON.stringify({
        migrationsDir: "pilot/migrations",
        schemaManifest: "pilot/.dl/schema-manifest.json",
        sources: ["examples/pilot_reux.dl"],
      }),
    );
    const previous = process.env.REUX_CONFIG;

    try {
      process.env.REUX_CONFIG = "pilot.json";

      expect(loadConfig(dir)).toMatchObject({
        migrationsDir: "pilot/migrations",
        schemaManifest: "pilot/.dl/schema-manifest.json",
        sources: ["examples/pilot_reux.dl"],
      });
    } finally {
      if (previous === undefined) {
        delete process.env.REUX_CONFIG;
      } else {
        process.env.REUX_CONFIG = previous;
      }
    }
  });

  it("reads configured database URL environment variable", () => {
    expect(databaseUrl(loadConfig(), { DATABASE_URL: "postgres://example" })).toBe("postgres://example");
  });

  it("reads sorted migration files with hashes", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "002_second.sql"), "SELECT 2;\n");
    writeFileSync(join(dir, "001_first.sql"), "SELECT 1;\n");

    const files = readMigrationFiles(dir);

    expect(files.map((file) => file.filename)).toEqual(["001_first.sql", "002_second.sql"]);
    expect(files[0].hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reports pending migrations against fake database state", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "001_first.sql"), "SELECT 1;\n");
    const db = new FakeDb();

    const status = await migrationStatus(db, dir);

    expect(status.applied).toEqual([]);
    expect(status.pending.map((file) => file.filename)).toEqual(["001_first.sql"]);
    expect(db.queries[0]).toContain("CREATE TABLE IF NOT EXISTS _dl_schema_migrations");
  });

  it("applies pending migrations and records hashes", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "001_first.sql"), "SELECT 1;\n");
    const db = new FakeDb();

    const applied = await applyMigrations(db, dir);

    expect(applied.map((record) => record.filename)).toEqual(["001_first.sql"]);
    expect(db.queries).toContain("BEGIN;");
    expect(db.queries).toContain("SELECT 1;\n");
    expect(db.queries).toContain("COMMIT;");
    expect(db.applied).toHaveLength(1);
  });

  it("parses query-run JSON parameters", () => {
    expect(parseJsonParams('["100.00", true]')).toEqual(["100.00", true]);
    expect(() => parseJsonParams('{"not":"array"}')).toThrow("query params must be a JSON array");
  });

  it("parses query-run JSON parameters from @files", () => {
    const dir = makeTempDir();
    const path = join(dir, "params.json");
    writeFileSync(path, '["100.00"]');

    expect(parseJsonParams(`@${path}`)).toEqual(["100.00"]);
  });

  it("emits query SQL for runtime execution", () => {
    const sql = emitQuerySql(
      `module commerce

entity User {
  id: Id<User> primary generated
  balance: Decimal default 0
}

query highValueUsers(min: Decimal): Query<User> =
  from user in User
  where user.balance > min
  select user
`,
      "highValueUsers",
    );

    expect(sql).toBe('SELECT "user".*\nFROM users AS "user"\nWHERE "user".balance > $1;');
  });

  it("emits insert SQL for entity data", () => {
    const statement = emitInsertStatement(
      `module commerce

entity User {
  id: Id<User> primary generated
  name: String
  email: String?
  balance: Decimal default 0
}
`,
      "User",
      { name: "Ada", email: "ada@example.com", balance: "1200" },
    );

    expect(statement).toEqual({
      sql: "INSERT INTO users (name, email, balance) VALUES ($1, $2, $3) RETURNING *;",
      params: ["Ada", "ada@example.com", "1200"],
    });
  });

  it("rejects unknown data insert fields", () => {
    expect(() =>
      emitInsertStatement(
        `module commerce

entity User {
  id: Id<User> primary generated
}
`,
        "User",
        { missing: true },
      ),
    ).toThrow("entity User has no field missing");
  });

  it("parses JSON objects for data insert", () => {
    expect(parseJsonObject('{"name":"Ada"}')).toEqual({ name: "Ada" });
    expect(() => parseJsonObject("[1,2]")).toThrow("expected a JSON object");
  });

  it("parses JSON objects from @files for data insert", () => {
    const dir = makeTempDir();
    const path = join(dir, "user.json");
    writeFileSync(path, '{"name":"Ada"}');

    expect(parseJsonObject(`@${path}`)).toEqual({ name: "Ada" });
  });

  it("parses and runs seed records with aliases", async () => {
    const db = new FakeDb();
    const source = `module commerce

entity User {
  id: Id<User> primary generated
  email: String
}

entity Order {
  id: Id<Order> primary generated
  user: User required
  total: Decimal
}
`;

    const result = await runSeed(
      db,
      source,
      parseSeedSpec(
        JSON.stringify({
          records: [
            { entity: "User", as: "ada", data: { email: "ada@example.com" } },
            { entity: "Order", as: "order1", data: { user: "$ada", total: "100" } },
          ],
        }),
      ),
    );

    expect(result.inserted).toEqual([
      { entity: "User", as: "ada", id: "row-1" },
      { entity: "Order", as: "order1", id: "row-2" },
    ]);
    expect(db.queryCalls[1]).toEqual({
      sql: "INSERT INTO orders (user_id, total) VALUES ($1, $2) RETURNING *;",
      params: ["row-1", "100"],
    });
  });

  it("checks seed records without a database", () => {
    const source = `module commerce

entity User {
  id: Id<User> primary generated
  email: String unique
}

entity Order {
  id: Id<Order> primary generated
  user: User required
  total: Decimal
}
`;

    const result = checkSeed(
      source,
      parseSeedSpec(
        JSON.stringify({
          mode: "upsert",
          records: [
            { entity: "User", as: "ada", by: ["email"], data: { email: "ada@example.com" } },
            { entity: "Order", as: "order1", by: ["id"], data: { id: "order-1", user: "$ada", total: "100" } },
          ],
        }),
      ),
    );

    expect(result).toEqual({
      records: [
        { entity: "User", as: "ada", mode: "upsert", by: ["email"], fields: ["email"] },
        { entity: "Order", as: "order1", mode: "upsert", by: ["id"], fields: ["id", "user", "total"] },
      ],
    });
  });

  it("rejects invalid seed checks before opening a database connection", () => {
    const source = `module commerce

entity User {
  id: Id<User> primary generated
  email: String unique
}
`;

    expect(() =>
      checkSeed(
        source,
        parseSeedSpec(
          JSON.stringify({
            mode: "upsert",
            records: [{ entity: "User", by: ["email"], data: { name: "Ada" } }],
          }),
        ),
      ),
    ).toThrow("entity User has no field name");

    expect(() =>
      checkSeed(
        source,
        parseSeedSpec(
          JSON.stringify({
            mode: "upsert",
            records: [{ entity: "User", by: ["email"], data: { id: "$missing", email: "ada@example.com" } }],
          }),
        ),
      ),
    ).toThrow("seed reference $missing has not been inserted yet");
  });

  it("runs upsert seed records with explicit conflict fields", async () => {
    const db = new FakeDb();
    const source = `module commerce

entity User {
  id: Id<User> primary generated
  email: String unique
  balance: Decimal default 0
}
`;

    const result = await runSeed(
      db,
      source,
      parseSeedSpec(
        JSON.stringify({
          mode: "upsert",
          records: [
            {
              entity: "User",
              as: "ada",
              by: ["email"],
              data: { email: "ada@example.com", balance: "100" },
            },
          ],
        }),
      ),
    );

    expect(result.inserted).toEqual([{ entity: "User", as: "ada", id: "row-1" }]);
    expect(db.queryCalls[0]).toEqual({
      sql: 'INSERT INTO users ("email", "balance") VALUES ($1, $2) ON CONFLICT ("email") DO UPDATE SET "balance" = EXCLUDED."balance" RETURNING *;',
      params: ["ada@example.com", "100"],
    });
  });

  it("deletes seed records in reverse dependency order", async () => {
    const db = new FakeDb();
    const source = `module commerce

entity User {
  id: Id<User> primary generated
  email: String unique
}

entity Order {
  id: Id<Order> primary generated
  user: User required
  total: Decimal
}
`;

    const result = await deleteSeed(
      db,
      source,
      parseSeedSpec(
        JSON.stringify({
          mode: "upsert",
          records: [
            { entity: "User", as: "ada", by: ["id"], data: { id: "user-1", email: "ada@example.com" } },
            { entity: "Order", as: "order1", by: ["id"], data: { id: "order-1", user: "$ada", total: "100" } },
          ],
        }),
      ),
    );

    expect(result.deleted).toEqual([
      { entity: "Order", as: "order1", rowCount: 1 },
      { entity: "User", as: "ada", rowCount: 1 },
    ]);
    expect(db.queryCalls).toEqual([
      {
        sql: 'DELETE FROM orders WHERE "id" = $1 RETURNING id;',
        params: ["order-1"],
      },
      {
        sql: 'DELETE FROM users WHERE "id" = $1 RETURNING id;',
        params: ["user-1"],
      },
    ]);
  });

  it("resets seed records by deleting then running", async () => {
    const db = new FakeDb();
    const source = `module commerce

entity User {
  id: Id<User> primary generated
  email: String unique
}

entity Order {
  id: Id<Order> primary generated
  user: User required
  total: Decimal
}
`;

    const result = await resetSeed(
      db,
      source,
      parseSeedSpec(
        JSON.stringify({
          records: [
            { entity: "User", as: "ada", by: ["id"], data: { id: "user-1", email: "ada@example.com" } },
            { entity: "Order", as: "order1", by: ["id"], data: { id: "order-1", user: "$ada", total: "100" } },
          ],
        }),
      ),
    );

    expect(result).toEqual({
      deleted: [
        { entity: "Order", as: "order1", rowCount: 1 },
        { entity: "User", as: "ada", rowCount: 1 },
      ],
      inserted: [
        { entity: "User", as: "ada", id: "row-1" },
        { entity: "Order", as: "order1", id: "row-2" },
      ],
    });
    expect(db.queryCalls).toEqual([
      {
        sql: 'DELETE FROM orders WHERE "id" = $1 RETURNING id;',
        params: ["order-1"],
      },
      {
        sql: 'DELETE FROM users WHERE "id" = $1 RETURNING id;',
        params: ["user-1"],
      },
      {
        sql: "INSERT INTO users (id, email) VALUES ($1, $2) RETURNING *;",
        params: ["user-1", "ada@example.com"],
      },
      {
        sql: "INSERT INTO orders (id, user_id, total) VALUES ($1, $2, $3) RETURNING *;",
        params: ["order-1", "row-1", "100"],
      },
    ]);
  });

  it("rejects seed references before their alias is inserted", async () => {
    await expect(
      runSeed(
        new FakeDb(),
        `module commerce

entity Order {
  id: Id<Order> primary generated
  user: String
}
`,
        parseSeedSpec(JSON.stringify({ records: [{ entity: "Order", data: { user: "$missing" } }] })),
      ),
    ).rejects.toThrow("seed reference $missing has not been inserted yet");
  });

  it("maps PostgreSQL errors into DL database errors", () => {
    expect(mapDatabaseError({ code: "23505", constraint: "users_email_key" })).toMatchObject({
      name: "UniqueViolation",
      retryable: false,
    });
    expect(mapDatabaseError({ code: "40001" })).toMatchObject({
      name: "RetryableTransactionConflict",
      retryable: true,
    });
    expect(mapDatabaseError({ code: "99999" })).toBeUndefined();
  });

  it("parses executable transaction SQL and after commit hooks", () => {
    const parsed = parseTransactionSql(`BEGIN;
SELECT * FROM users WHERE id = $1 FOR UPDATE;
UPDATE users SET balance = balance + $2 WHERE id = $1;
-- save user: staged by explicit mutation statements
-- after commit: sendRewardEmail(userRef)
COMMIT;`);

    expect(parsed).toEqual({
      statements: [
        { sql: "SELECT * FROM users WHERE id = $1 FOR UPDATE;", paramCount: 1, outbox: false },
        { sql: "UPDATE users SET balance = balance + $2 WHERE id = $1;", paramCount: 2, outbox: false },
      ],
      afterCommit: ["sendRewardEmail(userRef)"],
      usesOutbox: false,
    });
  });

  it("runs transaction SQL inside a managed transaction", async () => {
    const db = new FakeDb();

    const result = await runTransactionSql(
      db,
      `BEGIN;
SELECT * FROM users WHERE id = $1 FOR UPDATE;
UPDATE users SET balance = balance + $2 WHERE id = $1;
-- after commit: sendRewardEmail(userRef)
COMMIT;`,
      ["user-id", "100"],
      1,
    );

    expect(result).toEqual({
      attempts: 1,
      statements: 2,
      rowCounts: [0, 0],
      returnedRows: [],
      outboxEvents: [],
      afterCommit: ["sendRewardEmail(userRef)"],
    });
    expect(db.queryCalls).toEqual([
      { sql: "BEGIN;", params: undefined },
      { sql: "SELECT * FROM users WHERE id = $1 FOR UPDATE;", params: ["user-id"] },
      { sql: "UPDATE users SET balance = balance + $2 WHERE id = $1;", params: ["user-id", "100"] },
      { sql: "COMMIT;", params: undefined },
    ]);
  });

  it("retries transaction SQL on retryable database errors", async () => {
    const db = new FakeDb({
      failOnceOn: "UPDATE users",
      error: { code: "40001" },
    });

    const result = await runTransactionSql(
      db,
      `BEGIN;
UPDATE users SET balance = balance + $2 WHERE id = $1;
COMMIT;`,
      ["user-id", "100"],
      2,
    );

    expect(result.attempts).toBe(2);
    expect(db.queries).toEqual(["BEGIN;", "UPDATE users SET balance = balance + $2 WHERE id = $1;", "ROLLBACK;", "BEGIN;", "UPDATE users SET balance = balance + $2 WHERE id = $1;", "COMMIT;"]);
  });

  it("runs outbox statements and reports enqueued events", async () => {
    const db = new FakeDb();

    const result = await runTransactionSql(
      db,
      `BEGIN;
INSERT INTO _dl_outbox (event_type, payload) VALUES ('RewardGranted', jsonb_build_object('user', $1)) RETURNING id, event_type, payload;
COMMIT;`,
      ["user-id"],
      1,
    );

    expect(db.queries[0]).toContain("CREATE TABLE IF NOT EXISTS _dl_outbox");
    expect(db.queries).toContain("CREATE INDEX IF NOT EXISTS _dl_outbox_status_created_at_idx ON _dl_outbox (status, created_at);");
    expect(result.outboxEvents).toEqual([
      {
        id: "outbox-1",
        event_type: "RewardGranted",
        payload: { user: "user-id" },
        attempts: 0,
        last_error: null,
        status: "pending",
        created_at: "2026-04-25T00:00:00.000Z",
        processed_at: null,
      },
    ]);
    expect(result.returnedRows).toEqual(result.outboxEvents);
  });

  it("lists pending outbox events", async () => {
    const db = new FakeDb();
    db.outbox.push({
      id: "outbox-1",
      event_type: "RewardGranted",
      payload: { user: "user-id" },
      status: "pending",
      attempts: 0,
      last_error: null,
      created_at: "2026-04-25T00:00:00.000Z",
      processed_at: null,
    });
    db.outbox.push({
      id: "outbox-2",
      event_type: "RewardGranted",
      payload: { user: "other-user-id" },
      status: "failed",
      attempts: 1,
      last_error: "smtp unavailable",
      created_at: "2026-04-25T00:02:00.000Z",
      processed_at: null,
    });

    const events = await listOutboxEvents(db, 10);

    expect(events).toEqual([
      {
        id: "outbox-1",
        eventType: "RewardGranted",
        payload: { user: "user-id" },
        attempts: 0,
        lastError: null,
        status: "pending",
        createdAt: "2026-04-25T00:00:00.000Z",
        processedAt: null,
      },
    ]);
    expect(db.queryCalls.at(-1)).toEqual({
      sql: expect.stringContaining("FROM _dl_outbox"),
      params: [10, "pending"],
    });
  });

  it("lists outbox events by status or all statuses", async () => {
    const db = new FakeDb();
    db.outbox.push(
      {
        id: "outbox-1",
        event_type: "RewardGranted",
        payload: { user: "user-id" },
        status: "pending",
        attempts: 0,
        last_error: null,
        created_at: "2026-04-25T00:00:00.000Z",
        processed_at: null,
      },
      {
        id: "outbox-2",
        event_type: "RewardGranted",
        payload: { user: "other-user-id" },
        status: "failed",
        attempts: 1,
        last_error: "smtp unavailable",
        created_at: "2026-04-25T00:02:00.000Z",
        processed_at: null,
      },
    );

    expect(await listOutboxEvents(db, 10, "failed")).toEqual([
      expect.objectContaining({
        id: "outbox-2",
        status: "failed",
        lastError: "smtp unavailable",
      }),
    ]);
    expect(await listOutboxEvents(db, 10, "all")).toHaveLength(2);
  });

  it("marks outbox events processed", async () => {
    const db = new FakeDb();
    db.outbox.push({
      id: "outbox-1",
      event_type: "RewardGranted",
      payload: { user: "user-id" },
      attempts: 0,
      last_error: null,
      status: "pending",
      created_at: "2026-04-25T00:00:00.000Z",
      processed_at: null,
    });

    const event = await markOutboxProcessed(db, "outbox-1");

    expect(event).toMatchObject({
      id: "outbox-1",
      status: "processed",
      processedAt: "2026-04-25T00:01:00.000Z",
    });
  });

  it("requeues failed outbox events", async () => {
    const db = new FakeDb();
    db.outbox.push({
      id: "outbox-1",
      event_type: "RewardGranted",
      payload: { user: "user-id" },
      status: "failed",
      attempts: 2,
      last_error: "smtp unavailable",
      created_at: "2026-04-25T00:00:00.000Z",
      processed_at: null,
    });

    const event = await requeueOutboxEvent(db, "outbox-1");

    expect(event).toMatchObject({
      id: "outbox-1",
      status: "pending",
      attempts: 2,
      lastError: null,
      processedAt: null,
    });
  });

  it("claims pending outbox events for processing", async () => {
    const db = new FakeDb();
    db.outbox.push({
      id: "outbox-1",
      event_type: "RewardGranted",
      payload: { user: "user-id" },
      status: "pending",
      attempts: 0,
      last_error: null,
      created_at: "2026-04-25T00:00:00.000Z",
      processed_at: null,
    });

    const events = await claimOutboxEvents(db, 5);

    expect(events).toEqual([
      expect.objectContaining({
        id: "outbox-1",
        status: "processing",
        attempts: 1,
        lastError: null,
      }),
    ]);
    expect(db.queryCalls.at(-1)).toEqual({
      sql: expect.stringContaining("FOR UPDATE SKIP LOCKED"),
      params: [5],
    });
  });

  it("marks outbox events failed", async () => {
    const db = new FakeDb();
    db.outbox.push({
      id: "outbox-1",
      event_type: "RewardGranted",
      payload: { user: "user-id" },
      status: "processing",
      attempts: 1,
      last_error: null,
      created_at: "2026-04-25T00:00:00.000Z",
      processed_at: null,
    });

    const event = await markOutboxFailed(db, "outbox-1", "smtp unavailable");

    expect(event).toMatchObject({
      id: "outbox-1",
      status: "failed",
      attempts: 1,
      lastError: "smtp unavailable",
    });
  });

  it("processes outbox events with registered handlers", async () => {
    const db = new FakeDb();
    db.outbox.push({
      id: "outbox-1",
      event_type: "RewardGranted",
      payload: { user: "user-id" },
      status: "pending",
      attempts: 0,
      last_error: null,
      created_at: "2026-04-25T00:00:00.000Z",
      processed_at: null,
    });
    const handled: unknown[] = [];

    const result = await processOutboxEvents(db, {
      RewardGranted: (event) => {
        handled.push(event.payload);
      },
    });

    expect(handled).toEqual([{ user: "user-id" }]);
    expect(result).toEqual({
      processed: [
        expect.objectContaining({
          id: "outbox-1",
          status: "processed",
          attempts: 1,
        }),
      ],
      failed: [],
    });
  });

  it("marks outbox events failed when processing has no handler", async () => {
    const db = new FakeDb();
    db.outbox.push({
      id: "outbox-1",
      event_type: "UnknownEvent",
      payload: { user: "user-id" },
      status: "pending",
      attempts: 0,
      last_error: null,
      created_at: "2026-04-25T00:00:00.000Z",
      processed_at: null,
    });

    const result = await processOutboxEvents(db, {});

    expect(result.failed).toEqual([
      {
        event: expect.objectContaining({ id: "outbox-1", eventType: "UnknownEvent", attempts: 1 }),
        error: "no handler registered for outbox event UnknownEvent",
      },
    ]);
    expect(db.outbox[0]).toMatchObject({
      status: "failed",
      attempts: 1,
      last_error: "no handler registered for outbox event UnknownEvent",
    });
  });
});

class FakeDb implements Database {
  readonly queries: string[] = [];
  readonly queryCalls: { sql: string; params?: unknown[] }[] = [];
  readonly applied: { filename: string; hash: string }[] = [];
  readonly outbox: FakeOutboxRow[] = [];
  private failed = false;

  constructor(private readonly options: { failOnceOn?: string; error?: unknown } = {}) {}

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> {
    this.queries.push(sql);
    this.queryCalls.push({ sql, params });
    if (this.options.failOnceOn && sql.startsWith(this.options.failOnceOn) && !this.failed) {
      this.failed = true;
      throw this.options.error ?? new Error("fake database failure");
    }
    if (sql.startsWith("SELECT filename")) {
      return {
        rows: this.applied.map((record) => ({
          filename: record.filename,
          hash: record.hash,
          applied_at: "2026-04-25T00:00:00.000Z",
        })) as T[],
        rowCount: this.applied.length,
      };
    }
    if (sql.startsWith("INSERT INTO _dl_schema_migrations")) {
      this.applied.push({
        filename: params?.[0] as string,
        hash: params?.[1] as string,
      });
    }
    if (sql.startsWith("INSERT INTO users") || sql.startsWith("INSERT INTO orders")) {
      return {
        rows: [{ id: `row-${this.queryCalls.filter((call) => call.sql.startsWith("INSERT INTO users") || call.sql.startsWith("INSERT INTO orders")).length}` }] as T[],
        rowCount: 1,
      };
    }
    if (sql.startsWith("DELETE FROM users") || sql.startsWith("DELETE FROM orders")) {
      return {
        rows: [{ id: params?.[0] }] as T[],
        rowCount: 1,
      };
    }
    if (sql.startsWith("INSERT INTO _dl_outbox")) {
      const row = {
        id: `outbox-${this.outbox.length + 1}`,
        event_type: "RewardGranted",
        payload: { user: params?.[0] },
        status: "pending",
        attempts: 0,
        last_error: null,
        created_at: "2026-04-25T00:00:00.000Z",
        processed_at: null,
      };
      this.outbox.push(row);
      return {
        rows: [row] as T[],
        rowCount: 1,
      };
    }
    if (sql.includes("UPDATE _dl_outbox")) {
      const row = sql.includes("FROM claimed")
        ? this.outbox.find((candidate) => candidate.status === "pending")
        : this.outbox.find((candidate) => candidate.id === params?.[0]);
      if (!row) return { rows: [], rowCount: 0 };
      if (sql.includes("status = 'processing'")) {
        row.status = "processing";
        row.attempts += 1;
        row.last_error = null;
      } else if (sql.includes("status = 'failed'")) {
        row.status = "failed";
        row.last_error = params?.[1] as string;
      } else if (sql.includes("status = 'pending'")) {
        row.status = "pending";
        row.last_error = null;
        row.processed_at = null;
      } else {
        row.status = "processed";
        row.processed_at = "2026-04-25T00:01:00.000Z";
      }
      return { rows: [row] as T[], rowCount: 1 };
    }
    if (sql.includes("FROM _dl_outbox")) {
      const status = params?.[1] as string | undefined;
      const rows = status ? this.outbox.filter((row) => row.status === status) : this.outbox;
      return {
        rows: rows as T[],
        rowCount: rows.length,
      };
    }
    return { rows: [], rowCount: 0 };
  }
}

interface FakeOutboxRow {
  id: string;
  event_type: string;
  payload: unknown;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
}

function makeTempDir(): string {
  const dir = join(tmpdir(), `dl-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}
