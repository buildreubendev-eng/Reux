import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { compileSource, emitRuleSql, emitViewSql } from "./compiler.js";
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

export interface ViewRunResult extends QueryRunResult {
  row: unknown | null;
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

export interface OutboxStatusStats {
  status: string;
  count: number;
  attempts: number;
  oldestCreatedAt: string | null;
  newestCreatedAt: string | null;
}

export interface OutboxStats {
  total: number;
  byStatus: OutboxStatusStats[];
}

export type OutboxListStatus = "pending" | "processing" | "processed" | "failed" | "dead" | "all";

export type OutboxHandler = (event: OutboxEvent) => Promise<void> | void;

export interface OutboxProcessResult {
  processed: OutboxEvent[];
  failed: OutboxFailure[];
  retried: OutboxFailure[];
  deadLettered: OutboxFailure[];
}

export interface OutboxFailurePolicy {
  maxAttempts?: number;
  retryDelaySeconds?: number;
}

export interface OutboxWorkerOptions {
  limit?: number;
  intervalMs?: number;
  maxAttempts?: number;
  retryDelaySeconds?: number;
  requeueStaleAfterSeconds?: number;
  requeueStaleLimit?: number;
  maxIterations?: number;
  signal?: AbortSignal;
  onIteration?(result: OutboxWorkerIterationResult): void | Promise<void>;
}

export interface OutboxWorkerResult {
  iterations: number;
  processed: number;
  failed: number;
  retried: number;
  deadLettered: number;
  staleRequeued: number;
  stopped: "maxIterations" | "aborted";
}

export interface OutboxWorkerIterationResult extends OutboxProcessResult {
  iteration: number;
  staleRequeued: OutboxEvent[];
}

export interface OutboxFailure {
  event: OutboxEvent;
  error: string;
}

export interface AfterCommitHook {
  call: string;
  name: string;
  args: string[];
  resolvedArgs?: unknown[];
}

export type AfterCommitHandler = (hook: AfterCommitHook) => Promise<void> | void;

export interface AfterCommitContext {
  parameters?: Record<string, unknown>;
  bindings?: Record<string, unknown>;
}

export interface AfterCommitProcessResult {
  processed: AfterCommitHook[];
  failed: AfterCommitFailure[];
}

export interface AfterCommitFailure {
  hook: AfterCommitHook;
  error: string;
}

export interface TransactionRunResult {
  attempts: number;
  statements: number;
  rowCounts: (number | null)[];
  returnedRows: unknown[];
  outboxEvents: unknown[];
  afterCommit: string[];
  bindings?: Record<string, unknown>;
}

export interface RuleRunResult {
  statements: number;
  rowCounts: (number | null)[];
  returnedRows: unknown[];
  outboxEvents: unknown[];
}

export type RuleNotificationListStatus = "open" | "resolved" | "all";

export interface RuleNotificationKey {
  ruleName: string;
  entityName: string;
  recordId: string;
  recipientField: string;
}

export interface RuleNotification extends RuleNotificationKey {
  recipient: string | null;
  status: "open" | "resolved";
  createdAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}

export interface RuleBatchRunResult {
  rules: RuleBatchRuleResult[];
  summary: {
    rules: number;
    statements: number;
    returnedRows: number;
    outboxEvents: number;
  };
}

export interface RuleBatchRuleResult extends RuleRunResult {
  ruleName: string;
}

export interface RuleWorkerOptions {
  ruleNames?: string[];
  intervalMs?: number;
  maxIterations?: number;
  signal?: AbortSignal;
  onIteration?(result: RuleWorkerIterationResult): void | Promise<void>;
}

export interface RuleWorkerIterationResult extends RuleBatchRunResult {
  iteration: number;
}

export interface RuleWorkerResult {
  iterations: number;
  rules: number;
  statements: number;
  returnedRows: number;
  outboxEvents: number;
  stopped: "maxIterations" | "aborted";
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
  next_attempt_at timestamptz NULL,
  dead_lettered_at timestamptz NULL,
  processed_at timestamptz NULL
);
`);
  await db.query("ALTER TABLE _dl_outbox ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;");
  await db.query("ALTER TABLE _dl_outbox ADD COLUMN IF NOT EXISTS last_error text NULL;");
  await db.query("ALTER TABLE _dl_outbox ADD COLUMN IF NOT EXISTS claimed_at timestamptz NULL;");
  await db.query("ALTER TABLE _dl_outbox ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NULL;");
  await db.query("ALTER TABLE _dl_outbox ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz NULL;");
  await db.query("CREATE INDEX IF NOT EXISTS _dl_outbox_status_created_at_idx ON _dl_outbox (status, created_at);");
  await db.query("CREATE INDEX IF NOT EXISTS _dl_outbox_status_claimed_at_idx ON _dl_outbox (status, claimed_at);");
  await db.query("CREATE INDEX IF NOT EXISTS _dl_outbox_status_next_attempt_at_idx ON _dl_outbox (status, next_attempt_at);");
}

export async function ensureIdempotencyTable(db: Database): Promise<void> {
  await db.query(`
CREATE TABLE IF NOT EXISTS _dl_idempotency_keys (
  key text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
`);
}

export async function ensureRuleNotificationTable(db: Database): Promise<void> {
  await db.query(`
CREATE TABLE IF NOT EXISTS _dl_rule_notifications (
  rule_name text NOT NULL,
  entity_name text NOT NULL,
  record_id text NOT NULL,
  recipient_field text NOT NULL,
  recipient text NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  PRIMARY KEY (rule_name, entity_name, record_id, recipient_field)
);
`);
  await db.query("ALTER TABLE _dl_rule_notifications ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open';");
  await db.query("ALTER TABLE _dl_rule_notifications ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();");
  await db.query("ALTER TABLE _dl_rule_notifications ADD COLUMN IF NOT EXISTS resolved_at timestamptz NULL;");
  await db.query("CREATE INDEX IF NOT EXISTS _dl_rule_notifications_status_created_at_idx ON _dl_rule_notifications (status, created_at);");
  await db.query("CREATE INDEX IF NOT EXISTS _dl_rule_notifications_recipient_status_idx ON _dl_rule_notifications (recipient, status);");
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
SET status = 'processed',
    claimed_at = NULL,
    next_attempt_at = NULL,
    processed_at = now()
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
    AND (next_attempt_at IS NULL OR next_attempt_at <= now())
  ORDER BY created_at ASC
  LIMIT $1
  FOR UPDATE SKIP LOCKED
)
UPDATE _dl_outbox o
SET status = 'processing',
    attempts = attempts + 1,
    last_error = NULL,
    next_attempt_at = NULL,
    claimed_at = now()
FROM claimed
WHERE o.id = claimed.id
RETURNING o.id, o.event_type, o.payload, o.status, o.attempts, o.last_error, o.created_at, o.processed_at;
`,
    [limit],
  );
  return result.rows.map(outboxRow);
}

export async function markOutboxFailed(
  db: Database,
  id: string,
  error: string,
  policy: OutboxFailurePolicy = {},
): Promise<OutboxEvent | undefined> {
  await ensureOutboxTable(db);
  const retryDelaySeconds = policy.retryDelaySeconds;
  const maxAttempts = policy.maxAttempts ?? 0;
  if (maxAttempts > 0) {
    const result = await db.query<OutboxEventRow>(
      `
UPDATE _dl_outbox
SET status = CASE WHEN attempts >= $3 THEN 'dead' ELSE 'pending' END,
    last_error = $2,
    claimed_at = NULL,
    next_attempt_at = CASE WHEN attempts >= $3 THEN NULL ELSE now() + ($4 * interval '1 second') END,
    dead_lettered_at = CASE WHEN attempts >= $3 THEN now() ELSE dead_lettered_at END
WHERE id = $1
RETURNING id, event_type, payload, status, attempts, last_error, created_at, processed_at;
`,
      [id, error, maxAttempts, retryDelaySeconds ?? 0],
    );
    const row = result.rows[0];
    return row ? outboxRow(row) : undefined;
  }
  const result = await db.query<OutboxEventRow>(
    `
UPDATE _dl_outbox
SET status = 'failed',
    last_error = $2,
    claimed_at = NULL,
    next_attempt_at = ${retryDelaySeconds === undefined ? "NULL" : "now() + ($3 * interval '1 second')"}
WHERE id = $1
RETURNING id, event_type, payload, status, attempts, last_error, created_at, processed_at;
`,
    retryDelaySeconds === undefined ? [id, error] : [id, error, retryDelaySeconds],
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
    next_attempt_at = NULL,
    dead_lettered_at = NULL,
    processed_at = NULL
WHERE id = $1
  AND status IN ('processing', 'failed', 'dead')
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
    next_attempt_at = NULL,
    processed_at = NULL
FROM stale
WHERE o.id = stale.id
RETURNING o.id, o.event_type, o.payload, o.status, o.attempts, o.last_error, o.created_at, o.processed_at;
`,
    [olderThanSeconds, limit],
  );
  return result.rows.map(outboxRow);
}

export async function outboxStats(db: Database): Promise<OutboxStats> {
  await ensureOutboxTable(db);
  const result = await db.query<{
    status: string;
    count: string | number;
    attempts: string | number | null;
    oldest_created_at: string | Date | null;
    newest_created_at: string | Date | null;
  }>(`
SELECT status,
       count(*) AS count,
       COALESCE(sum(attempts), 0) AS attempts,
       min(created_at) AS oldest_created_at,
       max(created_at) AS newest_created_at
FROM _dl_outbox
GROUP BY status
ORDER BY status ASC;
`);
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

export async function processOutboxEvents(
  db: Database,
  handlers: Record<string, OutboxHandler>,
  limit = 10,
  failurePolicy: OutboxFailurePolicy = {},
): Promise<OutboxProcessResult> {
  const events = await claimOutboxEvents(db, limit);
  const processed: OutboxEvent[] = [];
  const failed: OutboxFailure[] = [];
  const retried: OutboxFailure[] = [];
  const deadLettered: OutboxFailure[] = [];

  for (const event of events) {
    const handler = handlers[event.eventType];
    if (!handler) {
      const error = `no handler registered for outbox event ${event.eventType}`;
      const updated = await markOutboxFailed(db, event.id, error, failurePolicy);
      trackOutboxFailure(updated ?? event, error, failed, retried, deadLettered);
      continue;
    }

    try {
      await handler(event);
      const updated = await markOutboxProcessed(db, event.id);
      processed.push(updated ?? event);
    } catch (error) {
      const message = errorMessage(error);
      const updated = await markOutboxFailed(db, event.id, message, failurePolicy);
      trackOutboxFailure(updated ?? event, message, failed, retried, deadLettered);
    }
  }

  return { processed, failed, retried, deadLettered };
}

export async function runOutboxWorker(
  db: Database,
  handlers: Record<string, OutboxHandler>,
  options: OutboxWorkerOptions = {},
): Promise<OutboxWorkerResult> {
  const limit = options.limit ?? 10;
  const intervalMs = options.intervalMs ?? 1000;
  const failurePolicy: OutboxFailurePolicy = {
    maxAttempts: options.maxAttempts,
    retryDelaySeconds: options.retryDelaySeconds,
  };
  let iterations = 0;
  let processed = 0;
  let failed = 0;
  let retried = 0;
  let deadLettered = 0;
  let staleRequeued = 0;

  while (!options.signal?.aborted) {
    let stale: OutboxEvent[] = [];
    if (options.requeueStaleAfterSeconds !== undefined) {
      stale = await requeueStaleOutboxEvents(db, options.requeueStaleAfterSeconds, options.requeueStaleLimit ?? limit);
    }
    const result = await processOutboxEvents(db, handlers, limit, failurePolicy);
    iterations += 1;
    processed += result.processed.length;
    failed += result.failed.length;
    retried += result.retried.length;
    deadLettered += result.deadLettered.length;
    staleRequeued += stale.length;
    await options.onIteration?.({ ...result, iteration: iterations, staleRequeued: stale });

    if (options.maxIterations !== undefined && iterations >= options.maxIterations) {
      return { iterations, processed, failed, retried, deadLettered, staleRequeued, stopped: "maxIterations" };
    }
    if (options.signal?.aborted) break;
    await delay(intervalMs, options.signal);
  }

  return { iterations, processed, failed, retried, deadLettered, staleRequeued, stopped: "aborted" };
}

function trackOutboxFailure(
  event: OutboxEvent,
  error: string,
  failed: OutboxFailure[],
  retried: OutboxFailure[],
  deadLettered: OutboxFailure[],
): void {
  const failure = { event, error };
  failed.push(failure);
  if (event.status === "pending") retried.push(failure);
  if (event.status === "dead") deadLettered.push(failure);
}

function timestampValue(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

async function updateRuleNotificationStatus(
  db: Database,
  key: RuleNotificationKey,
  status: "open" | "resolved",
): Promise<RuleNotification | undefined> {
  await ensureRuleNotificationTable(db);
  const result = await db.query<RuleNotificationRow>(
    `
UPDATE _dl_rule_notifications
SET status = $5,
    resolved_at = CASE WHEN $5 = 'resolved' THEN now() ELSE NULL END,
    last_seen_at = CASE WHEN $5 = 'open' THEN now() ELSE last_seen_at END
WHERE rule_name = $1
  AND entity_name = $2
  AND record_id = $3
  AND recipient_field = $4
RETURNING rule_name, entity_name, record_id, recipient_field, recipient, status, created_at, last_seen_at, resolved_at;
`,
    [key.ruleName, key.entityName, key.recordId, key.recipientField, status],
  );
  const row = result.rows[0];
  return row ? ruleNotificationRow(row) : undefined;
}

export function parseAfterCommitHook(call: string): AfterCommitHook {
  const match = call.match(/^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/);
  if (!match) {
    throw new Error(`invalid after commit hook ${call}`);
  }
  const argsSource = match[2].trim();
  return {
    call,
    name: match[1],
    args: argsSource ? splitHookArgs(argsSource) : [],
  };
}

export async function processAfterCommitHooks(
  calls: string[],
  handlers: Record<string, AfterCommitHandler>,
  context: AfterCommitContext = {},
): Promise<AfterCommitProcessResult> {
  const processed: AfterCommitHook[] = [];
  const failed: AfterCommitFailure[] = [];

  for (const call of calls) {
    const hook = resolveAfterCommitHook(parseAfterCommitHook(call), context);
    const handler = handlers[hook.name];
    if (!handler) {
      failed.push({ hook, error: `no handler registered for after commit hook ${hook.name}` });
      continue;
    }
    try {
      await handler(hook);
      processed.push(hook);
    } catch (error) {
      failed.push({ hook, error: errorMessage(error) });
    }
  }

  return { processed, failed };
}

function resolveAfterCommitHook(hook: AfterCommitHook, context: AfterCommitContext): AfterCommitHook {
  if (!context.parameters && !context.bindings) return hook;
  return {
    ...hook,
    resolvedArgs: hook.args.map((arg) => resolveAfterCommitArg(arg, context)),
  };
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

export async function runView(db: Database, source: string, viewName: string): Promise<ViewRunResult> {
  const result = await runSqlQuery(db, emitViewSql(source, viewName), []);
  return {
    ...result,
    row: result.rows[0] ?? null,
  };
}

export async function listRuleNotifications(
  db: Database,
  limit = 50,
  status: RuleNotificationListStatus = "open",
): Promise<RuleNotification[]> {
  await ensureRuleNotificationTable(db);
  const params = status === "all" ? [limit] : [limit, status];
  const result = await db.query<RuleNotificationRow>(
    status === "all"
      ? `
SELECT rule_name, entity_name, record_id, recipient_field, recipient, status, created_at, last_seen_at, resolved_at
FROM _dl_rule_notifications
ORDER BY created_at ASC
LIMIT $1;
`
      : `
SELECT rule_name, entity_name, record_id, recipient_field, recipient, status, created_at, last_seen_at, resolved_at
FROM _dl_rule_notifications
WHERE status = $2
ORDER BY created_at ASC
LIMIT $1;
`,
    params,
  );
  return result.rows.map(ruleNotificationRow);
}

export async function resolveRuleNotification(db: Database, key: RuleNotificationKey): Promise<RuleNotification | undefined> {
  return updateRuleNotificationStatus(db, key, "resolved");
}

export async function reopenRuleNotification(db: Database, key: RuleNotificationKey): Promise<RuleNotification | undefined> {
  return updateRuleNotificationStatus(db, key, "open");
}

export async function runRule(db: Database, source: string, ruleName: string): Promise<RuleRunResult> {
  return runRuleSql(db, emitRuleSql(source, ruleName));
}

export async function runRules(db: Database, source: string, ruleNames?: string[]): Promise<RuleBatchRunResult> {
  const names = ruleNames && ruleNames.length > 0 ? ruleNames : sourceRuleNames(source);
  const rules: RuleBatchRuleResult[] = [];
  for (const ruleName of names) {
    rules.push({
      ruleName,
      ...(await runRule(db, source, ruleName)),
    });
  }
  return {
    rules,
    summary: summarizeRuleBatch(rules),
  };
}

export async function runRuleWorker(db: Database, source: string, options: RuleWorkerOptions = {}): Promise<RuleWorkerResult> {
  const intervalMs = options.intervalMs ?? 1000;
  let iterations = 0;
  let rules = 0;
  let statements = 0;
  let returnedRows = 0;
  let outboxEvents = 0;

  while (!options.signal?.aborted) {
    const result = await runRules(db, source, options.ruleNames);
    iterations += 1;
    rules += result.summary.rules;
    statements += result.summary.statements;
    returnedRows += result.summary.returnedRows;
    outboxEvents += result.summary.outboxEvents;
    await options.onIteration?.({ ...result, iteration: iterations });

    if (options.maxIterations !== undefined && iterations >= options.maxIterations) {
      return { iterations, rules, statements, returnedRows, outboxEvents, stopped: "maxIterations" };
    }
    if (options.signal?.aborted) break;
    await delay(intervalMs, options.signal);
  }

  return { iterations, rules, statements, returnedRows, outboxEvents, stopped: "aborted" };
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
  if (plan.usesIdempotency) {
    await ensureIdempotencyTable(db);
  }
  const attempts = Math.max(1, maxAttempts);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await db.query("BEGIN;");
    try {
      const rowCounts: (number | null)[] = [];
      const returnedRows: unknown[] = [];
      const outboxEvents: unknown[] = [];
      const bindings: Record<string, unknown> = {};
      const afterCommit = [...plan.afterCommit];
      for (const statement of plan.statements) {
        const prepared = prepareTransactionStatement(statement.sql, params.slice(0, statement.paramCount), bindings);
        const result = await db.query(prepared.sql, prepared.params);
        if (statement.transitionGuard && result.rowCount === 0) {
          throw new Error(`transition guard failed for ${statement.transitionGuard}`);
        }
        rowCounts.push(result.rowCount);
        returnedRows.push(...result.rows);
        if (statement.resultBinding) {
          bindings[statement.resultBinding] = result.rows.length === 1 ? result.rows[0] : result.rows;
        }
        if (statement.outbox) {
          outboxEvents.push(...result.rows);
        }
        if (statement.conditionalAfterCommit) {
          afterCommit.push(...result.rows.map((row) => (row as Record<string, unknown>)._dl_after_commit).filter(isString));
        }
      }
      const bound = Object.keys(bindings).length > 0 ? { bindings } : {};
      await db.query("COMMIT;");
      return {
        attempts: attempt,
        statements: plan.statements.length,
        rowCounts,
        returnedRows,
        outboxEvents,
        afterCommit,
        ...bound,
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

export async function runRuleSql(db: Database, sql: string): Promise<RuleRunResult> {
  const statements = splitSqlStatements(sql);
  const usesOutbox = statements.some((statement) => statement.includes("INSERT INTO _dl_outbox"));
  const usesRuleNotifications = statements.some((statement) => statement.includes("_dl_rule_notifications"));
  if (usesOutbox) {
    await ensureOutboxTable(db);
  }
  if (usesRuleNotifications) {
    await ensureRuleNotificationTable(db);
  }

  await db.query("BEGIN;");
  try {
    const rowCounts: (number | null)[] = [];
    const returnedRows: unknown[] = [];
    const outboxEvents: unknown[] = [];
    for (const statement of statements) {
      const result = await db.query(statement);
      rowCounts.push(result.rowCount);
      returnedRows.push(...result.rows);
      if (statement.includes("INSERT INTO _dl_outbox")) {
        outboxEvents.push(...result.rows);
      }
    }
    await db.query("COMMIT;");
    return {
      statements: statements.length,
      rowCounts,
      returnedRows,
      outboxEvents,
    };
  } catch (error) {
    await db.query("ROLLBACK;");
    throw error;
  }
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

export function parseTransactionSql(sql: string): {
  statements: TransactionStatement[];
  afterCommit: string[];
  usesOutbox: boolean;
  usesIdempotency?: boolean;
} {
  const statements: TransactionStatement[] = [];
  const afterCommit: string[] = [];
  let usesOutbox = false;
  let usesIdempotency = false;
  let transitionGuard: string | undefined;
  let resultBinding: string | undefined;
  let conditionalAfterCommit: string | undefined;

  for (const rawLine of sql.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("-- transition guard:")) {
      transitionGuard = line.replace("-- transition guard:", "").trim();
      continue;
    }
    if (line.startsWith("-- bind result:")) {
      resultBinding = line.replace("-- bind result:", "").trim();
      continue;
    }
    if (line.startsWith("-- after commit:")) {
      afterCommit.push(line.replace("-- after commit:", "").trim());
      continue;
    }
    if (line.startsWith("-- conditional after commit:")) {
      conditionalAfterCommit = line.replace("-- conditional after commit:", "").trim();
      continue;
    }
    if (line.startsWith("--")) continue;
    if (line === "BEGIN;" || line === "COMMIT;") continue;
    const outbox = line.includes("INSERT INTO _dl_outbox");
    const idempotency = line.includes("INSERT INTO _dl_idempotency_keys");
    usesOutbox ||= outbox;
    usesIdempotency ||= idempotency;
    const statement: TransactionStatement = {
      sql: line,
      paramCount: maxPlaceholder(line),
      outbox,
    };
    if (transitionGuard) statement.transitionGuard = transitionGuard;
    if (resultBinding) statement.resultBinding = resultBinding;
    if (conditionalAfterCommit) statement.conditionalAfterCommit = conditionalAfterCommit;
    statements.push(statement);
    transitionGuard = undefined;
    resultBinding = undefined;
    conditionalAfterCommit = undefined;
  }

  return usesIdempotency ? { statements, afterCommit, usesOutbox, usesIdempotency } : { statements, afterCommit, usesOutbox };
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let quote: string | undefined;
  let start = 0;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (quote) {
      if (char === quote) {
        if (sql[index + 1] === quote) {
          index += 1;
          continue;
        }
        quote = undefined;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (char !== ";") continue;
    const statement = sql.slice(start, index + 1).trim();
    if (statement) statements.push(statement);
    start = index + 1;
  }
  const trailing = sql.slice(start).trim();
  if (trailing) statements.push(trailing.endsWith(";") ? trailing : `${trailing};`);
  return statements;
}

function sourceRuleNames(source: string): string[] {
  const { program } = compileSource(source);
  return program.declarations
    .filter((declaration) => declaration.kind === "rule")
    .map((declaration) => declaration.name);
}

function summarizeRuleBatch(rules: RuleBatchRuleResult[]): RuleBatchRunResult["summary"] {
  return {
    rules: rules.length,
    statements: rules.reduce((sum, rule) => sum + rule.statements, 0),
    returnedRows: rules.reduce((sum, rule) => sum + rule.returnedRows.length, 0),
    outboxEvents: rules.reduce((sum, rule) => sum + rule.outboxEvents.length, 0),
  };
}

function maxPlaceholder(sql: string): number {
  let max = 0;
  for (const match of sql.matchAll(/\$(\d+)/g)) {
    max = Math.max(max, Number.parseInt(match[1], 10));
  }
  return max;
}

function prepareTransactionStatement(
  sql: string,
  params: unknown[],
  bindings: Record<string, unknown>,
): { sql: string; params: unknown[] } {
  if (!/:[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*/.test(sql)) {
    return { sql, params };
  }

  const preparedParams: unknown[] = [];
  const parameterIndexes = new Map<number, number>();
  const bindingIndexes = new Map<string, number>();
  const preparedSql = sql.replace(/\$(\d+)|:([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g, (token, rawPosition, binding, field) => {
    if (rawPosition !== undefined) {
      const position = Number.parseInt(rawPosition, 10);
      const existing = parameterIndexes.get(position);
      if (existing) return `$${existing}`;
      preparedParams.push(params[position - 1]);
      parameterIndexes.set(position, preparedParams.length);
      return `$${preparedParams.length}`;
    }

    const key = `${binding}.${field}`;
    const existing = bindingIndexes.get(key);
    if (existing) return `$${existing}`;
    preparedParams.push(boundFieldValue(bindings, binding, field));
    bindingIndexes.set(key, preparedParams.length);
    return `$${preparedParams.length}`;
  });
  return { sql: preparedSql, params: preparedParams };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function boundFieldValue(bindings: Record<string, unknown>, binding: string, field: string): unknown {
  const value = bindings[binding];
  if (value === undefined) {
    throw new Error(`unknown transaction result binding ${binding}`);
  }
  if (Array.isArray(value)) {
    throw new Error(`transaction result binding ${binding} returned multiple rows`);
  }
  if (typeof value !== "object" || value === null || !(field in value)) {
    throw new Error(`transaction result binding ${binding} has no field ${field}`);
  }
  return (value as Record<string, unknown>)[field];
}

function resolveAfterCommitArg(arg: string, context: AfterCommitContext): unknown {
  const value = arg.trim();
  if (context.parameters && value in context.parameters) {
    return context.parameters[value];
  }
  const bindingMatch = value.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/);
  if (bindingMatch && context.bindings) {
    return boundFieldValue(context.bindings, bindingMatch[1], bindingMatch[2]);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("\"") && value.endsWith("\"")) {
    return JSON.parse(value) as unknown;
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("\\'", "'");
  }
  return arg;
}

function splitHookArgs(source: string): string[] {
  const args: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | undefined;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      current += char;
      if (char === quote && source[index - 1] !== "\\") {
        quote = undefined;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(" || char === "{" || char === "[") depth += 1;
    if (char === ")" || char === "}" || char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) {
    args.push(current.trim());
  }
  return args;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
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
  transitionGuard?: string;
  resultBinding?: string;
  conditionalAfterCommit?: string;
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

interface RuleNotificationRow {
  rule_name: string;
  entity_name: string;
  record_id: string;
  recipient_field: string;
  recipient: string | null;
  status: "open" | "resolved";
  created_at: Date | string;
  last_seen_at: Date | string;
  resolved_at: Date | string | null;
}

function ruleNotificationRow(row: RuleNotificationRow): RuleNotification {
  return {
    ruleName: row.rule_name,
    entityName: row.entity_name,
    recordId: row.record_id,
    recipientField: row.recipient_field,
    recipient: row.recipient,
    status: row.status,
    createdAt: timestampValue(row.created_at) ?? "",
    lastSeenAt: timestampValue(row.last_seen_at) ?? "",
    resolvedAt: timestampValue(row.resolved_at),
  };
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
