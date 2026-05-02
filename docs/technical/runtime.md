# Runtime

The runtime layer is the first bridge from Reux compiler artifacts to a live PostgreSQL database.

## Configuration

Runtime commands read `dl.json` from the current working directory by default:

```json
{
  "backend": "postgres",
  "databaseUrlEnv": "DATABASE_URL",
  "migrationsDir": "migrations",
  "schemaManifest": ".dl/schema-manifest.json",
  "sources": ["examples/commerce_v2.dl"]
}
```

Fields:

- `backend`: currently only `postgres`.
- `databaseUrlEnv`: environment variable that contains the PostgreSQL connection string.
- `migrationsDir`: directory containing checked-in `.sql` migrations.
- `schemaManifest`: location where `manifest-write` stores the compiled schema manifest.
- `sources`: source globs used by project-level commands such as `project-check`.

Secrets are not stored in `dl.json`; set the configured environment variable before running database commands.

Use `REUX_CONFIG` to point project commands at another config file without replacing the main workspace config:

```powershell
$env:REUX_CONFIG="pilot/dl.json"
node dist/cli.js project-check
node dist/cli.js project-doctor
```

## Project Commands

Compile all configured source files:

```bash
node dist/cli.js project-diagnose
node dist/cli.js project-diagnose --json
node dist/cli.js project-check
```

Summarize configured source files:

```bash
node dist/cli.js project-summary
node dist/cli.js project-summary --json
node dist/cli.js project-doctor
node dist/cli.js project-doctor --db
node dist/cli.js project-doctor --json
node dist/cli.js project-doctor --db --json
```

`project-doctor` checks source discovery, duplicate declaration warnings, schema manifest freshness, migration directory visibility, and whether the configured database URL environment variable is set. `project-doctor --db` also opens a PostgreSQL connection and reports applied and pending migration counts. Add `--json` for machine-readable output.

Emit active project artifacts when `sources` resolves to exactly one file:

```bash
node dist/cli.js project-sql
node dist/cli.js project-manifest
node dist/cli.js project-manifest-write
node dist/cli.js project-transition-rules
node dist/cli.js project-transition-rules Order.status
node dist/cli.js project-migrate-plan
node dist/cli.js project-migrate-check --env production --allow-production
node dist/cli.js project-migrate-diff-create commerce_next
node dist/cli.js project-query-sql highValueUsers
node dist/cli.js project-query-run highValueUsers '[1000]'
node dist/cli.js project-tx-sql rewardUser
node dist/cli.js project-tx-run rewardUser '["user-id","100"]'
node dist/cli.js project-data-insert-sql User '{"name":"Ada","email":"ada@example.com","balance":"1200"}'
node dist/cli.js project-seed-check pilot/seeds/smoke.json
node dist/cli.js project-seed-dry-run pilot/seeds/smoke.json
node dist/cli.js project-seed-run pilot/seeds/smoke.json
node dist/cli.js project-seed-delete pilot/seeds/smoke.json
node dist/cli.js project-seed-reset pilot/seeds/smoke.json
```

The initial source discovery supports exact paths plus `*` and `**` glob patterns, deduplicates overlapping matches, and reports each compiled file in stable path order. `project-summary` also reports duplicate declaration names across configured files by module and declaration kind, including transition-rule declarations.

## Schema Manifest

Write the current compiled schema manifest:

```bash
node dist/cli.js manifest-write examples/commerce.dl
```

The destination comes from `dl.json` and defaults to `.dl/schema-manifest.json`.

## Migration Table

The runtime creates this bookkeeping table if needed:

```sql
CREATE TABLE IF NOT EXISTS _dl_schema_migrations (
  filename text PRIMARY KEY,
  hash text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
```

Each applied migration is recorded by filename and SHA-256 hash. If a file with the same name has a different hash than the applied record, the runtime refuses to continue.

## Migration Status

```bash
node dist/cli.js migrate-status
node dist/cli.js migrate-status --json
```

Prints applied and pending migration files. `--json` returns the same applied/pending structure used by the runtime API.

## Migration Apply

```bash
node dist/cli.js migrate-apply
```

Applies pending migration files in filename order. Each file is executed inside a transaction and recorded in `_dl_schema_migrations` after it succeeds.

Before creating or applying a diff migration, run `migrate-plan` or `project-migrate-plan` and read the generated review notes, rollback notes, and deployment checklist. `migrate-diff-create` and `project-migrate-diff-create` refuse to write unsafe or destructive migrations unless the matching approval flags are present. For production gates, pass `--env production --allow-production` only after the migration has been reviewed and tested against staging or a disposable database.

## Query Run

```bash
node dist/cli.js query-run examples/commerce.dl highValueUsers '[1000]'
```

`query-run` compiles the named query to PostgreSQL SQL, parses the optional third argument as a JSON array of parameters, executes the query, and prints JSON:

```json
{
  "rowCount": 2,
  "rows": []
}
```

The current query runtime supports the same query subset as the compiler: one base scanned entity, explicit joins, optional `where`, optional `group by`, optional `order by`, simple projections, and narrow `count()`/`sum(field)` aggregations.

Parameter arrays can also be read from files:

```bash
node dist/cli.js query-run examples/commerce.dl highValueUsers @params.json
```

## Data Insert

Insert one row for an entity:

```bash
node dist/cli.js data-insert examples/commerce.dl User '{"name":"Ada","email":"ada@example.com","balance":"1200"}'
```

Preview the generated insert statement without connecting to PostgreSQL:

```bash
node dist/cli.js data-insert-sql examples/commerce.dl User '{"name":"Ada","email":"ada@example.com","balance":"1200"}'
```

For larger fixtures or shells that strip JSON quotes, pass `@path/to/file.json`.

The JSON object keys must match entity fields. Generated primary keys and omitted fields are left to database defaults or nullable columns.

Enum field values are validated before the runtime opens a database connection, so typos fail with a Reux diagnostic instead of a PostgreSQL enum cast error.

## Seed Files

Run a seed file against an explicit source:

```bash
node dist/cli.js seed-check examples/pilot_reux.dl pilot/seeds/smoke.json
node dist/cli.js seed-dry-run examples/commerce_v2.dl examples/seeds/commerce_smoke.json
node dist/cli.js seed-dry-run examples/pilot_reux.dl pilot/seeds/smoke.json
node dist/cli.js seed-run examples/pilot_reux.dl pilot/seeds/smoke.json
node dist/cli.js seed-delete examples/pilot_reux.dl pilot/seeds/smoke.json
node dist/cli.js seed-reset examples/pilot_reux.dl pilot/seeds/smoke.json
```

Run a seed file against the configured project source:

```powershell
$env:REUX_CONFIG="pilot/dl.json"
node dist/cli.js project-seed-check pilot/seeds/smoke.json
node dist/cli.js project-seed-dry-run pilot/seeds/smoke.json
node dist/cli.js project-seed-run pilot/seeds/smoke.json
node dist/cli.js project-seed-delete pilot/seeds/smoke.json
node dist/cli.js project-seed-reset pilot/seeds/smoke.json
```

`seed-check` and `project-seed-check` validate a seed file without connecting to PostgreSQL. They compile the source, report the file-level `mode` and `reset` settings, verify that every record targets a known entity, reject unknown data fields, validate enum literals, verify each `by` field exists and is present in the record data, and ensure `$alias` values only reference earlier seed records.

`seed-dry-run` and `project-seed-dry-run` insert the seed records inside a transaction and always roll it back. They are useful after `seed-check` when you also want PostgreSQL to validate foreign keys, uniqueness, enum values, and database casts without preserving fixture rows.

`examples/seeds/commerce_smoke.json` targets `examples/commerce_v2.dl` and gives the file-scoped seed commands a minimal root fixture. `pilot/seeds/smoke.json` targets the pilot source through `pilot/dl.json`.

Seed files insert records in order. The default mode is `insert`:

```json
{
  "records": [
    {
      "entity": "Account",
      "as": "ada",
      "data": { "email": "ada@example.com", "balance": "50" }
    },
    {
      "entity": "Order",
      "as": "adaOrder",
      "data": { "account": "$ada", "total": "250", "status": "Pending" }
    }
  ]
}
```

`as` stores the inserted row id under an alias. A later string value of `$alias` is replaced with that id before insertion. This is enough for simple relationship fixtures such as account-owned orders and order-owned payments.

`seed-delete` and `project-seed-delete` delete the same records in reverse order. This lets a fixture remove dependent rows first, such as payments before orders and orders before accounts. Deletion uses each record's `by` fields, or the default unique field when `by` is omitted.

`seed-reset` and `project-seed-reset` compose a reset step and run in one transaction. By default the reset step deletes the seed records in reverse order. If the seed file declares `"reset": "truncate"`, reset truncates the distinct entity tables used by the file with `RESTART IDENTITY CASCADE` before rerunning the records. Use truncate reset for local/demo fixtures when the seed should refresh whole fixture groups rather than only rows addressable by `by` fields.

Use `mode: "upsert"` for rerunnable local fixtures. Each upsert record uses `by` as its conflict key; if `by` is omitted, Reux uses the first unique non-generated field if one exists:

```json
{
  "mode": "upsert",
  "reset": "truncate",
  "records": [
    {
      "entity": "Account",
      "as": "ada",
      "by": ["id"],
      "data": {
        "id": "00000000-0000-4000-8000-000000000001",
        "email": "ada@example.com",
        "balance": "50"
      }
    }
  ]
}
```

## Error Mapping

PostgreSQL errors are mapped into Reux-style error names where possible:

- `UniqueViolation`
- `ReferenceViolation`
- `ConstraintViolation`
- `RetryableTransactionConflict`
- `RetryableDeadlock`

## Transaction Run

Run a supported transaction function:

```bash
node dist/cli.js tx-run examples/commerce_v2.dl rewardUser '["user-id","100"]'
```

Transaction parameters can also be passed as `@params.json`.

`tx-run` compiles the transaction function to PostgreSQL statements and executes the supported subset inside a managed transaction. Bound inserts such as `let payment = insert Payment { ... }` are returned in the JSON result under `bindings.payment`, which gives callers access to generated IDs and other returned columns. Later generated statements can reference that row with binding placeholders such as `:payment.id`; runtime execution resolves them from the returned row and sends them to PostgreSQL as ordinary parameters.

Currently executable:

- `load <entity-param> for update`
- field mutation over loaded state, such as `user.balance += amount` or `account.balance += amount - fee`
- conditional field mutation over loaded state, such as `if account.balance < ceiling then account.balance += amount - fee`
- block conditionals for supported conditional statements, such as `if account.active { ... }`
- `insert Entity { ... }`
- `let name = insert Entity { ... }`, returned from `tx-run` in `bindings.name`
- transition-guarded enum assignments over loaded state, such as `order.status = Paid`
- conditional abort guards, such as `if account.balance < amount then abort InsufficientFunds`

Currently reported but not executed:

- `save`, because mutations are emitted as explicit `UPDATE` statements;
- `after commit ...`, returned as pending after-commit hooks;

Currently executed for durable side-effect coordination:

- `enqueue Event { ... }`, inserted into `_dl_outbox` inside the same transaction.
- `if condition then enqueue Event { ... }`, inserted only when the condition is true.

Retry behavior:

- `retry N` in the transaction function header sets the maximum attempts.
- PostgreSQL serialization conflicts and deadlocks are retried.
- Direct external-looking calls are rejected at compile time inside retryable transactions.
- `after commit ...` hooks are returned in the `afterCommit` array and can be dispatched by application code with `processAfterCommitHooks`.
- `if condition then after commit ...` hooks are returned in the `afterCommit` array only when the condition emits a hook during the transaction run.

Transition behavior:

- If a transition rule exists for an enum field, assigning a literal enum value through a loaded entity state lowers to a guarded `UPDATE`.
- Literal targets must appear as a `to` value in at least one transition rule for that field.
- The guard requires the row's current enum value to be one of the declared predecessors for the target value.
- If the guarded update changes zero rows, `tx-run` fails the transaction and rolls it back.

## After-Commit Processing API

Applications can process returned after-commit hooks with a small handler registry:

```ts
import { processAfterCommitHooks } from "./dist/runtime.js";

const txResult = await runTransactionSql(db, sql, params, attempts);
const hooks = await processAfterCommitHooks(txResult.afterCommit, {
  notifyAccountCredited: async (hook) => {
    await notifyAccount(hook.resolvedArgs?.[0]);
  },
}, {
  parameters: { accountRef: params[0], amount: params[1] },
  bindings: txResult.bindings,
});
```

`processAfterCommitHooks` parses calls such as `notifyAccountCredited(accountRef)`, dispatches by function name, and returns `{ processed, failed }`. `hook.args` keeps the source-level argument strings. When callers provide parameter and binding context, `hook.resolvedArgs` contains application values for parameter names such as `accountRef`, bound fields such as `payment.id`, and simple literals.

## Outbox

The runtime creates `_dl_outbox` when a transaction uses `enqueue`:

```sql
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
```

The runtime also creates `_dl_outbox_status_created_at_idx` on `(status, created_at)` for listing, `_dl_outbox_status_claimed_at_idx` on `(status, claimed_at)` for stale claim recovery, and `_dl_outbox_status_next_attempt_at_idx` on `(status, next_attempt_at)` for delayed retries.

Example:

```dl
enqueue RewardGranted { user: userRef, amount: amount }
```

This lowers to an outbox insert with `event_type = 'RewardGranted'` and a JSON payload. `tx-run` returns inserted outbox rows in `outboxEvents`.

List pending outbox events:

```bash
node dist/cli.js outbox-list
```

Limit the number of events:

```bash
node dist/cli.js outbox-list 10
```

List a specific status or all statuses:

```bash
node dist/cli.js outbox-list failed 10
node dist/cli.js outbox-list processing 10
node dist/cli.js outbox-list dead 10
node dist/cli.js outbox-list all 50
```

Summarize outbox counts by status:

```bash
node dist/cli.js outbox-stats
```

`outbox-stats` returns `total` plus `byStatus` rows with count, accumulated attempts, oldest event time, and newest event time. This gives dashboards and hosted operators a cheap health snapshot without listing every event.

The pilot app exposes equivalent demo-layer views through `/api/outbox/stats`, `/api/logistics/outbox/stats`, `/api/ops`, and `/ops.html`. Production apps can build the same style of worker dashboard from `outbox-stats` or the `summarizeOutboxStats` helper.

Mark an event processed after an external worker has handled it:

```bash
node dist/cli.js outbox-mark-processed 00000000-0000-0000-0000-000000000000
```

Claim events for a worker:

```bash
node dist/cli.js outbox-claim 10
```

Claiming uses `FOR UPDATE SKIP LOCKED`, changes status from `pending` to `processing`, increments `attempts`, clears `last_error`, and skips rows whose `next_attempt_at` is still in the future.

Mark an event failed:

```bash
node dist/cli.js outbox-mark-failed 00000000-0000-0000-0000-000000000000 "smtp unavailable"
```

Requeue a failed or processing event:

```bash
node dist/cli.js outbox-requeue 00000000-0000-0000-0000-000000000000
```

Requeueing changes status back to `pending`, clears `last_error`, clears `next_attempt_at`, leaves `attempts` intact, and applies to events currently in `failed`, `processing`, or `dead`.

Requeue abandoned processing claims:

```bash
node dist/cli.js outbox-requeue-stale 300 50
```

`outbox-requeue-stale` moves events from `processing` back to `pending` when their `claimed_at` timestamp is older than the supplied age in seconds. The optional second argument limits the number of events requeued. This is intended for worker recovery when a process dies after claiming events but before marking them processed or failed.

## Outbox Processing API

Applications can embed a small dispatcher loop with `processOutboxEvents`:

```ts
import { createPostgresDatabase, processOutboxEvents } from "./dist/runtime.js";

const db = createPostgresDatabase(config);
const result = await processOutboxEvents(db, {
  RewardGranted: async (event) => {
    await sendRewardEmail(event.payload);
  },
});
```

`processOutboxEvents` claims pending events, dispatches by `eventType`, marks successful events processed, and marks missing or throwing handlers failed with `last_error` populated. Pass `{ maxAttempts, retryDelaySeconds }` to turn failures into scheduled retries until the attempt budget is exhausted; exhausted events move to `dead` and set `dead_lettered_at`. It returns `{ processed, failed, retried, deadLettered }` so a caller can log normal failures, scheduled retries, and terminal poison-message cases separately.

For a long-running application worker, use `runOutboxWorker`:

```ts
import { createPostgresDatabase, runOutboxWorker } from "./dist/runtime.js";

const db = createPostgresDatabase(config);
const controller = new AbortController();

await runOutboxWorker(
  db,
  {
    RewardGranted: async (event) => {
      await sendRewardEmail(event.payload);
    },
  },
  {
    limit: 10,
    intervalMs: 1000,
    maxAttempts: 5,
    retryDelaySeconds: 30,
    signal: controller.signal,
  },
);
```

`runOutboxWorker` repeatedly calls `processOutboxEvents`, supports abort signals for shutdown, and supports `maxIterations` for tests or demos. Set `maxAttempts` and `retryDelaySeconds` to protect the worker from poison messages while preserving delayed retry behavior. Set `requeueStaleAfterSeconds` to have the worker move abandoned `processing` events back to `pending` before each processing iteration; `requeueStaleLimit` controls how many stale claims are recovered per iteration.

The worker returns cumulative observability counters:

```json
{
  "iterations": 1,
  "processed": 1,
  "failed": 0,
  "retried": 0,
  "deadLettered": 0,
  "staleRequeued": 0,
  "stopped": "maxIterations"
}
```

`onIteration` receives the per-iteration `processed`, `failed`, `retried`, `deadLettered`, and `staleRequeued` collections plus the current `iteration` number. The hosted demo worker logs those counters and honors `REUX_WORKER_MAX_ATTEMPTS` and `REUX_WORKER_RETRY_DELAY_SECONDS`.

These commands are intentionally small. They provide enough operational visibility for the prototype while leaving hosted worker deployment and handler discovery to the application layer.
