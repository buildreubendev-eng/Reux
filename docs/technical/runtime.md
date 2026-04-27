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
node dist/cli.js project-check
```

Summarize configured source files:

```bash
node dist/cli.js project-summary
node dist/cli.js project-summary --json
node dist/cli.js project-doctor
node dist/cli.js project-doctor --db
```

`project-doctor` checks source discovery, duplicate declaration warnings, schema manifest freshness, migration directory visibility, and whether the configured database URL environment variable is set. `project-doctor --db` also opens a PostgreSQL connection and reports applied and pending migration counts.

Emit active project artifacts when `sources` resolves to exactly one file:

```bash
node dist/cli.js project-sql
node dist/cli.js project-manifest
node dist/cli.js project-manifest-write
node dist/cli.js project-migrate-plan
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

The initial source discovery supports exact paths plus `*` and `**` glob patterns, deduplicates overlapping matches, and reports each compiled file in stable path order. `project-summary` also reports duplicate declaration names across configured files by module and declaration kind.

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

`seed-check` and `project-seed-check` validate a seed file without connecting to PostgreSQL. They compile the source, verify that every record targets a known entity, reject unknown data fields, verify each `by` field exists and is present in the record data, and ensure `$alias` values only reference earlier seed records.

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

`seed-reset` and `project-seed-reset` compose delete and run in one transaction. They are useful for keeping a local development database aligned with a fixture file after editing seed values.

Use `mode: "upsert"` for rerunnable local fixtures. Each upsert record uses `by` as its conflict key; if `by` is omitted, Reux uses the first unique non-generated field if one exists:

```json
{
  "mode": "upsert",
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

`tx-run` compiles the transaction function to PostgreSQL statements and executes the supported subset inside a managed transaction.

Currently executable:

- `load <entity-param> for update`
- simple field mutation over loaded state, such as `user.balance += amount`
- `insert Entity { ... }`

Currently reported but not executed:

- `save`, because mutations are emitted as explicit `UPDATE` statements;
- `after commit ...`, returned as pending after-commit hooks;

Currently executed for durable side-effect coordination:

- `enqueue Event { ... }`, inserted into `_dl_outbox` inside the same transaction.

Retry behavior:

- `retry N` in the transaction function header sets the maximum attempts.
- PostgreSQL serialization conflicts and deadlocks are retried.
- Direct external-looking calls are rejected at compile time inside retryable transactions.
- `after commit ...` hooks are returned in the `afterCommit` array and can be dispatched by application code with `processAfterCommitHooks`.

## After-Commit Processing API

Applications can process returned after-commit hooks with a small handler registry:

```ts
import { processAfterCommitHooks } from "./dist/runtime.js";

const txResult = await runTransactionSql(db, sql, params, attempts);
const hooks = await processAfterCommitHooks(txResult.afterCommit, {
  notifyAccountCredited: async (hook) => {
    await notifyAccount(hook.args[0]);
  },
});
```

`processAfterCommitHooks` parses calls such as `notifyAccountCredited(accountRef)`, dispatches by function name, and returns `{ processed, failed }`. Arguments are returned as source-level strings because the prototype runtime does not yet bind transaction parameter names to application values.

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
  processed_at timestamptz NULL
);
```

The runtime also creates `_dl_outbox_status_created_at_idx` on `(status, created_at)` for listing and `_dl_outbox_status_claimed_at_idx` on `(status, claimed_at)` for stale claim recovery.

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
node dist/cli.js outbox-list all 50
```

Mark an event processed after an external worker has handled it:

```bash
node dist/cli.js outbox-mark-processed 00000000-0000-0000-0000-000000000000
```

Claim events for a worker:

```bash
node dist/cli.js outbox-claim 10
```

Claiming uses `FOR UPDATE SKIP LOCKED`, changes status from `pending` to `processing`, increments `attempts`, and clears `last_error`.

Mark an event failed:

```bash
node dist/cli.js outbox-mark-failed 00000000-0000-0000-0000-000000000000 "smtp unavailable"
```

Requeue a failed or processing event:

```bash
node dist/cli.js outbox-requeue 00000000-0000-0000-0000-000000000000
```

Requeueing changes status back to `pending`, clears `last_error`, leaves `attempts` intact, and only applies to events currently in `failed` or `processing`.

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

`processOutboxEvents` claims pending events, dispatches by `eventType`, marks successful events processed, and marks missing or throwing handlers failed with `last_error` populated. It returns `{ processed, failed }` so a caller can log or retry according to its own worker policy.

These commands are intentionally small. They provide enough operational visibility for the prototype while leaving full dispatcher/worker semantics for a later runtime layer.
