import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { DlConfig, databaseUrl } from "./config.js";
import { mapDatabaseError } from "./db-errors.js";

const { Pool } = pg;

export interface Database {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
  end?(): Promise<void>;
}

export interface MigrationRecord {
  filename: string;
  hash: string;
  appliedAt: string;
}

export interface MigrationFile {
  filename: string;
  path: string;
  hash: string;
  sql: string;
}

export interface MigrationStatus {
  applied: MigrationRecord[];
  pending: MigrationFile[];
}

export interface QueryRunResult {
  rows: unknown[];
  rowCount: number | null;
}

export interface OutboxEvent {
  id: string;
  eventType: string;
  payload: unknown;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
}

export type OutboxListStatus = "pending" | "processing" | "processed" | "failed" | "all";

export type OutboxHandler = (event: OutboxEvent) => Promise<void> | void;

export interface OutboxProcessResult {
  processed: OutboxEvent[];
  failed: OutboxFailure[];
}

export interface OutboxFailure {
  event: OutboxEvent;
  error: string;
}

export interface TransactionRunResult {
  attempts: number;
  statements: number;
  rowCounts: (number | null)[];
  returnedRows: unknown[];
  outboxEvents: unknown[];
  afterCommit: string[];
}

export function createPostgresDatabase(config: DlConfig): Database {
  return new Pool({
    connectionString: databaseUrl(config),
  });
}

export async function ensureMigrationTable(db: Database): Promise<void> {
  await db.query(`
CREATE TABLE IF NOT EXISTS _dl_schema_migrations (
  filename text PRIMARY KEY,
  hash text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
`);
}

export async function ensureOutboxTable(db: Database): Promise<void> {
  await db.query(`
CREATE TABLE IF NOT EXISTS _dl_outbox (
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
  await db.query("ALTER TABLE _dl_outbox ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;");
  await db.query("ALTER TABLE _dl_outbox ADD COLUMN IF NOT EXISTS last_error text NULL;");
  await db.query("ALTER TABLE _dl_outbox ADD COLUMN IF NOT EXISTS claimed_at timestamptz NULL;");
  await db.query("CREATE INDEX IF NOT EXISTS _dl_outbox_status_created_at_idx ON _dl_outbox (status, created_at);");
  await db.query("CREATE INDEX IF NOT EXISTS _dl_outbox_status_claimed_at_idx ON _dl_outbox (status, claimed_at);");
}

export async function listOutboxEvents(
  db: Database,
  limit = 50,
  status: OutboxListStatus = "pending",
): Promise<OutboxEvent[]> {
  await ensureOutboxTable(db);
  const params = status === "all" ? [limit] : [limit, status];
  const result = await db.query<OutboxEventRow>(
    status === "all"
      ? `
SELECT id, event_type, payload, status, attempts, last_error, created_at, processed_at
FROM _dl_outbox
ORDER BY created_at ASC
LIMIT $1;
`
      : `
SELECT id, event_type, payload, status, attempts, last_error, created_at, processed_at
FROM _dl_outbox
WHERE status = $2
ORDER BY created_at ASC
LIMIT $1;
`,
    params,
  );
  return result.rows.map(outboxRow);
}

export async function markOutboxProcessed(db: Database, id: string): Promise<OutboxEvent | undefined> {
  await ensureOutboxTable(db);
  const result = await db.query<OutboxEventRow>(
    `
UPDATE _dl_outbox
SET status = 'processed', processed_at = now()
WHERE id = $1
RETURNING id, event_type, payload, status, attempts, last_error, created_at, processed_at;
`,
    [id],
  );
  const row = result.rows[0];
  return row ? outboxRow(row) : undefined;
}

export async function claimOutboxEvents(db: Database, limit = 10): Promise<OutboxEvent[]> {
  await ensureOutboxTable(db);
  const result = await db.query<OutboxEventRow>(
    `
WITH claimed AS (
  SELECT id
  FROM _dl_outbox
  WHERE status = 'pending'
  ORDER BY created_at ASC
  LIMIT $1
  FOR UPDATE SKIP LOCKED
)
UPDATE _dl_outbox o
SET status = 'processing',
    attempts = attempts + 1,
    last_error = NULL,
    claimed_at = now()
FROM claimed
WHERE o.id = claimed.id
RETURNING o.id, o.event_type, o.payload, o.status, o.attempts, o.last_error, o.created_at, o.processed_at;
`,
    [limit],
  );
  return result.rows.map(outboxRow);
}

export async function markOutboxFailed(db: Database, id: string, error: string): Promise<OutboxEvent | undefined> {
  await ensureOutboxTable(db);
  const result = await db.query<OutboxEventRow>(
    `
UPDATE _dl_outbox
SET status = 'failed',
    last_error = $2
WHERE id = $1
RETURNING id, event_type, payload, status, attempts, last_error, created_at, processed_at;
`,
    [id, error],
  );
  const row = result.rows[0];
  return row ? outboxRow(row) : undefined;
}

export async function requeueOutboxEvent(db: Database, id: string): Promise<OutboxEvent | undefined> {
  await ensureOutboxTable(db);
  const result = await db.query<OutboxEventRow>(
    `
UPDATE _dl_outbox
SET status = 'pending',
    last_error = NULL,
    claimed_at = NULL,
    processed_at = NULL
WHERE id = $1
  AND status IN ('processing', 'failed')
RETURNING id, event_type, payload, status, attempts, last_error, created_at, processed_at;
`,
    [id],
  );
  const row = result.rows[0];
  return row ? outboxRow(row) : undefined;
}

export async function requeueStaleOutboxEvents(db: Database, olderThanSeconds: number, limit = 50): Promise<OutboxEvent[]> {
  await ensureOutboxTable(db);
  const result = await db.query<OutboxEventRow>(
    `
WITH stale AS (
  SELECT id
  FROM _dl_outbox
  WHERE status = 'processing'
    AND claimed_at IS NOT NULL
    AND claimed_at < now() - ($1 * interval '1 second')
  ORDER BY claimed_at ASC
  LIMIT $2
  FOR UPDATE SKIP LOCKED
)
UPDATE _dl_outbox o
SET status = 'pending',
    last_error = NULL,
    claimed_at = NULL,
    processed_at = NULL
FROM stale
WHERE o.id = stale.id
RETURNING o.id, o.event_type, o.payload, o.status, o.attempts, o.last_error, o.created_at, o.processed_at;
`,
    [olderThanSeconds, limit],
  );
  return result.rows.map(outboxRow);
}

export async function processOutboxEvents(
  db: Database,
  handlers: Record<string, OutboxHandler>,
  limit = 10,
): Promise<OutboxProcessResult> {
  const events = await claimOutboxEvents(db, limit);
  const processed: OutboxEvent[] = [];
  const failed: OutboxFailure[] = [];

  for (const event of events) {
    const handler = handlers[event.eventType];
    if (!handler) {
      const error = `no handler registered for outbox event ${event.eventType}`;
      await markOutboxFailed(db, event.id, error);
      failed.push({ event, error });
      continue;
    }

    try {
      await handler(event);
      const updated = await markOutboxProcessed(db, event.id);
      processed.push(updated ?? event);
    } catch (error) {
      const message = errorMessage(error);
      await markOutboxFailed(db, event.id, message);
      failed.push({ event, error: message });
    }
  }

  return { processed, failed };
}

export async function migrationStatus(db: Database, migrationsDir: string): Promise<MigrationStatus> {
  await ensureMigrationTable(db);
  const files = readMigrationFiles(migrationsDir);
  const appliedResult = await db.query<MigrationRecordRow>(
    "SELECT filename, hash, applied_at FROM _dl_schema_migrations ORDER BY filename ASC;",
  );
  const applied = appliedResult.rows.map((row) => ({
    filename: row.filename,
    hash: row.hash,
    appliedAt: row.applied_at instanceof Date ? row.applied_at.toISOString() : String(row.applied_at),
  }));
  const appliedByName = new Map(applied.map((record) => [record.filename, record]));
  const pending = files.filter((file) => {
    const record = appliedByName.get(file.filename);
    if (!record) return true;
    if (record.hash !== file.hash) {
      throw new Error(`migration ${file.filename} hash mismatch; refusing to continue`);
    }
    return false;
  });

  return { applied, pending };
}

export async function applyMigrations(db: Database, migrationsDir: string): Promise<MigrationRecord[]> {
  const status = await migrationStatus(db, migrationsDir);
  const applied: MigrationRecord[] = [];

  for (const migration of status.pending) {
    await db.query("BEGIN;");
    try {
      await db.query(migration.sql);
      await db.query("INSERT INTO _dl_schema_migrations (filename, hash) VALUES ($1, $2);", [
        migration.filename,
        migration.hash,
      ]);
      await db.query("COMMIT;");
      applied.push({
        filename: migration.filename,
        hash: migration.hash,
        appliedAt: new Date().toISOString(),
      });
    } catch (error) {
      await db.query("ROLLBACK;");
      throw error;
    }
  }

  return applied;
}

export async function runSqlQuery(db: Database, sql: string, params: unknown[]): Promise<QueryRunResult> {
  const result = await db.query(sql, params);
  return {
    rows: result.rows,
    rowCount: result.rowCount,
  };
}

export async function runTransactionSql(
  db: Database,
  sql: string,
  params: unknown[],
  maxAttempts = 1,
): Promise<TransactionRunResult> {
  const plan = parseTransactionSql(sql);
  if (plan.usesOutbox) {
    await ensureOutboxTable(db);
  }
  const attempts = Math.max(1, maxAttempts);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await db.query("BEGIN;");
    try {
      const rowCounts: (number | null)[] = [];
      const returnedRows: unknown[] = [];
      const outboxEvents: unknown[] = [];
      for (const statement of plan.statements) {
        const result = await db.query(statement.sql, params.slice(0, statement.paramCount));
        rowCounts.push(result.rowCount);
        returnedRows.push(...result.rows);
        if (statement.outbox) {
          outboxEvents.push(...result.rows);
        }
      }
      await db.query("COMMIT;");
      return {
        attempts: attempt,
        statements: plan.statements.length,
        rowCounts,
        returnedRows,
        outboxEvents,
        afterCommit: plan.afterCommit,
      };
    } catch (error) {
      await db.query("ROLLBACK;");
      const mapped = mapDatabaseError(error);
      if (!mapped?.retryable || attempt === attempts) {
        throw error;
      }
    }
  }

  throw new Error("transaction retry loop exited unexpectedly");
}

export function readMigrationFiles(migrationsDir: string): MigrationFile[] {
  return readdirSync(migrationsDir)
    .filter((filename) => filename.endsWith(".sql"))
    .sort()
    .map((filename) => {
      const path = join(migrationsDir, filename);
      const sql = readFileSync(path, "utf8");
      return {
        filename,
        path,
        sql,
        hash: sha256(sql),
      };
    });
}

export function parseJsonParams(source: string | undefined): unknown[] {
  if (!source) return [];
  const json = source.startsWith("@") ? readFileSync(source.slice(1), "utf8") : source;
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("query params must be a JSON array");
  }
  return parsed;
}

export function parseTransactionSql(sql: string): { statements: TransactionStatement[]; afterCommit: string[]; usesOutbox: boolean } {
  const statements: TransactionStatement[] = [];
  const afterCommit: string[] = [];
  let usesOutbox = false;

  for (const rawLine of sql.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("-- after commit:")) {
      afterCommit.push(line.replace("-- after commit:", "").trim());
      continue;
    }
    if (line.startsWith("--")) continue;
    if (line === "BEGIN;" || line === "COMMIT;") continue;
    const outbox = line.includes("INSERT INTO _dl_outbox");
    usesOutbox ||= outbox;
    statements.push({
      sql: line,
      paramCount: maxPlaceholder(line),
      outbox,
    });
  }

  return { statements, afterCommit, usesOutbox };
}

function maxPlaceholder(sql: string): number {
  let max = 0;
  for (const match of sql.matchAll(/\$(\d+)/g)) {
    max = Math.max(max, Number.parseInt(match[1], 10));
  }
  return max;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

interface MigrationRecordRow {
  filename: string;
  hash: string;
  applied_at: Date | string;
}

interface TransactionStatement {
  sql: string;
  paramCount: number;
  outbox: boolean;
}

interface OutboxEventRow {
  id: string;
  event_type: string;
  payload: unknown;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: Date | string;
  processed_at: Date | string | null;
}

function outboxRow(row: OutboxEventRow): OutboxEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    processedAt:
      row.processed_at === null
        ? null
        : row.processed_at instanceof Date
          ? row.processed_at.toISOString()
          : String(row.processed_at),
  };
}
