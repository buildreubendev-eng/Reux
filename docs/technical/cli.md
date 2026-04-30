# CLI Reference

Build before running the CLI:

```bash
npm run build
```

Run the no-database pilot demo:

```bash
npm run demo:pilot
```

## Commands

Check a Reux source file:

```bash
node dist/cli.js version
node dist/cli.js diagnose examples/commerce.dl
node dist/cli.js diagnose examples/commerce.dl --json
node dist/cli.js check examples/commerce.dl
```

Check every source file matched by `dl.json`:

```bash
node dist/cli.js project-diagnose
node dist/cli.js project-diagnose --json
node dist/cli.js project-check
```

`diagnose` and `project-diagnose` report compile errors without printing stack traces. JSON output is intended for editor tooling, CI summaries, and demo scripts that need structured diagnostics.

Summarize every source file matched by `dl.json`:

```bash
node dist/cli.js project-summary
node dist/cli.js project-summary --json
node dist/cli.js project-doctor
node dist/cli.js project-doctor --db
node dist/cli.js project-doctor --json
node dist/cli.js project-doctor --db --json
```

The summary inventories entities, enums, queries, simulations, transactions, and transition-rule declarations, and includes duplicate declaration diagnostics across configured files. `project-doctor` also checks manifest freshness, migration directory visibility, and whether the configured database URL environment variable is set. Add `--db` to have `project-doctor` connect to PostgreSQL and include applied/pending migration counts. Add `--json` for machine-readable output.

Project commands read `dl.json` by default. Set `REUX_CONFIG` to use a different config, such as the pilot application:

```powershell
$env:REUX_CONFIG='pilot/dl.json'
node dist/cli.js project-check
node dist/cli.js project-transition-rules
node dist/cli.js project-transition-rules Order.status
node dist/cli.js project-query-sql accountOrderSummary
node dist/cli.js project-api-ts ./runtime.js
node dist/cli.js project-api-server-ts ./api.js ./config.js ./runtime.js
node dist/cli.js project-worker-ts ./config.js ./runtime.js
Remove-Item Env:REUX_CONFIG
```

Emit project SQL and manifests from the single configured source file:

```bash
node dist/cli.js project-sql
node dist/cli.js project-manifest
node dist/cli.js project-manifest-write
```

Plan a migration from the configured `schemaManifest` to the active configured source:

```bash
node dist/cli.js project-migrate-plan
node dist/cli.js project-migrate-plan --json
node dist/cli.js project-migrate-check
node dist/cli.js project-migrate-check --json
node dist/cli.js project-migrate-diff-create commerce_next
```

`project-migrate-check` fails when unsafe or destructive operations are present. Add `--allow-unsafe` or `--allow-destructive` for explicit deployment gates.

Emit query and transaction artifacts from the active configured source:

```bash
node dist/cli.js project-query-ir highValueUsers
node dist/cli.js project-query-sql highValueUsers
node dist/cli.js project-query-run highValueUsers '[1000]'
node dist/cli.js project-explain highValueUsers
node dist/cli.js project-tx-ir rewardUser
node dist/cli.js project-tx-sql rewardUser
node dist/cli.js project-tx-run rewardUser '["user-id","100"]'
node dist/cli.js project-simulation-ir personal_finance
node dist/cli.js project-simulation-run personal_finance
node dist/cli.js project-api-ts ./runtime.js
node dist/cli.js project-api-server-ts ./api.js ./config.js ./runtime.js
node dist/cli.js project-worker-ts ./config.js ./runtime.js
node dist/cli.js project-data-insert-sql User '{"name":"Ada","email":"ada@example.com","balance":"1200"}'
node dist/cli.js project-data-insert User '{"name":"Ada","email":"ada@example.com","balance":"1200"}'
node dist/cli.js project-seed-check pilot/seeds/smoke.json
node dist/cli.js project-seed-dry-run pilot/seeds/smoke.json
node dist/cli.js project-seed-run pilot/seeds/smoke.json
node dist/cli.js project-seed-reset pilot/seeds/smoke.json
```

Emit PostgreSQL schema SQL:

```bash
node dist/cli.js sql examples/commerce.dl
```

Emit a schema manifest:

```bash
node dist/cli.js manifest examples/commerce.dl
```

Inspect transition rules:

```bash
node dist/cli.js transition-rules examples/pilot_reux.dl
node dist/cli.js transition-rules examples/pilot_reux.dl Order.status
```

Emit and run Simulation IR:

```bash
node dist/cli.js simulation-ir examples/simulations/personal_finance.reux
node dist/cli.js simulation-run examples/simulations/workforce_change.reux
```

When a source contains exactly one simulation, the simulation name is optional. If a source contains multiple simulations, pass the simulation name as the final argument.

Emit a generated TypeScript API client:

```bash
node dist/cli.js api-ts examples/pilot_reux.dl ./runtime.js
node dist/cli.js project-api-ts ./runtime.js
```

The optional import argument controls where the generated file imports `Database`, `runSqlQuery`, and `runTransactionSql` from. Generated API clients include enum unions, row interfaces, query/transaction parameter interfaces, SQL constants, and a `create<Module>Api(db)` factory.

Emit a generated HTTP server scaffold around a generated API client:

```bash
node dist/cli.js api-server-ts examples/pilot_reux.dl ./api.js ./config.js ./runtime.js
node dist/cli.js project-api-server-ts ./api.js ./config.js ./runtime.js
```

The scaffold uses Node's built-in HTTP server. It exposes `GET /health`, `POST /queries/<queryName>`, and `POST /transactions/<transactionName>`. The three optional import arguments are the generated API client module, config module, and runtime module.

Emit a generated worker scaffold:

```bash
node dist/cli.js worker-ts examples/pilot_reux.dl ./config.js ./runtime.js
node dist/cli.js project-worker-ts ./config.js ./runtime.js
```

The worker scaffold creates placeholder handlers for each `enqueue` event and each `after commit` hook declared in transaction functions. Fill in those handlers before running the worker in production.

Write a schema manifest to the configured `schemaManifest` path:

```bash
node dist/cli.js manifest-write examples/commerce.dl
```

Emit Query IR:

```bash
node dist/cli.js query-ir examples/commerce.dl highValueUsers
```

Emit query SQL:

```bash
node dist/cli.js query-sql examples/commerce.dl highValueUsers
```

Run a query against PostgreSQL:

```bash
node dist/cli.js query-run examples/commerce.dl highValueUsers '[1000]'
```

You can pass `@params.json` instead of inline JSON.

Insert one entity row:

```bash
node dist/cli.js data-insert examples/commerce.dl User '{"name":"Ada","email":"ada@example.com","balance":"1200"}'
```

Preview insert SQL without connecting to a database:

```bash
node dist/cli.js data-insert-sql examples/commerce.dl User '{"name":"Ada","email":"ada@example.com","balance":"1200"}'
```

`data-insert-sql` and `data-insert` validate enum field values before connecting to PostgreSQL.

For shells that make inline JSON awkward, pass `@path/to/file.json`:

```bash
node dist/cli.js data-insert-sql examples/commerce.dl User @seed/user.json
```

Run an ordered seed file:

```bash
node dist/cli.js seed-check examples/pilot_reux.dl pilot/seeds/smoke.json
node dist/cli.js seed-dry-run examples/commerce_v2.dl examples/seeds/commerce_smoke.json
node dist/cli.js seed-dry-run examples/pilot_reux.dl pilot/seeds/smoke.json
node dist/cli.js seed-run examples/pilot_reux.dl pilot/seeds/smoke.json
node dist/cli.js seed-delete examples/pilot_reux.dl pilot/seeds/smoke.json
node dist/cli.js seed-reset examples/pilot_reux.dl pilot/seeds/smoke.json
node dist/cli.js project-seed-check pilot/seeds/smoke.json
node dist/cli.js project-seed-dry-run pilot/seeds/smoke.json
node dist/cli.js project-seed-run pilot/seeds/smoke.json
node dist/cli.js project-seed-delete pilot/seeds/smoke.json
node dist/cli.js project-seed-reset pilot/seeds/smoke.json
```

`seed-check` and `project-seed-check` compile the Reux source and validate the seed file without opening a database connection. The check reports the file-level `mode` and `reset` settings, then verifies entity names, data field names, enum literals, `by` fields, required conflict keys for upsert records, and `$alias` references in declaration order.

`seed-dry-run` and `project-seed-dry-run` run the seed against PostgreSQL inside a transaction that always rolls back. Use dry runs to catch database-level constraint or type errors without keeping inserted fixture rows.

`examples/seeds/commerce_smoke.json` is a small file-scoped fixture for the root commerce example. `pilot/seeds/smoke.json` is the richer pilot fixture used with `pilot/dl.json`.

`seed-reset` and `project-seed-reset` first reset the fixture, then run the seed again inside one database transaction. The default reset deletes the seed records in reverse order. Add `"reset": "truncate"` to a seed file to truncate the distinct entity tables used by the fixture with `RESTART IDENTITY CASCADE` before inserting rows again.

Seed files contain ordered records. `as` creates an alias for the inserted row id; later records can use `$alias` in their data. Use `mode: "upsert"` with `by` to make a seed rerunnable:

```json
{
  "mode": "upsert",
  "reset": "truncate",
  "records": [
    { "entity": "Account", "as": "ada", "by": ["id"], "data": { "id": "00000000-0000-4000-8000-000000000001", "email": "ada@example.com", "balance": "50" } },
    { "entity": "Order", "as": "order1", "by": ["id"], "data": { "id": "00000000-0000-4000-8000-000000000002", "account": "$ada", "total": "250" } }
  ]
}
```

Emit Transaction IR:

```bash
node dist/cli.js tx-ir examples/commerce_v2.dl rewardUser
```

Emit PostgreSQL transaction SQL:

```bash
node dist/cli.js tx-sql examples/commerce_v2.dl rewardUser
```

Run a transaction against PostgreSQL:

```bash
node dist/cli.js tx-run examples/commerce_v2.dl rewardUser '["user-id","100"]'
```

Parameters are passed as a JSON array. Entity handles currently use the underlying UUID value.
You can pass `@params.json` instead of inline JSON.

Explain a query:

```bash
node dist/cli.js explain examples/commerce.dl highValueUsers
```

Create an initial migration file in `migrations/`:

```bash
node dist/cli.js migrate-create examples/commerce.dl initial_schema
```

Plan a migration from a previous manifest to current source:

```bash
node dist/cli.js migrate-plan old-manifest.json examples/commerce_v2.dl
node dist/cli.js migrate-check old-manifest.json examples/commerce_v2.dl
node dist/cli.js migrate-check old-manifest.json examples/commerce_v2.dl --env production --allow-production
```

`migrate-plan` now prints review notes, rollback notes, and a deployment checklist. `migrate-check` fails unsafe/destructive plans unless you pass `--allow-unsafe` or `--allow-destructive`; production checks also require `--allow-production` after review. You can set the environment with `--env development|staging|production` or `REUX_ENV`.

Create a diff migration file:

```bash
node dist/cli.js migrate-diff-create old-manifest.json examples/commerce_v2.dl commerce_v2
```

`migrate-diff-create` runs the same safety gate before writing the file. Use the same approval flags only after reading the rollback notes and testing the SQL against staging or a disposable database.

Show migration status against PostgreSQL:

```bash
node dist/cli.js migrate-status
node dist/cli.js migrate-status --json
```

Apply pending migrations:

```bash
node dist/cli.js migrate-apply
```

List pending outbox events:

```bash
node dist/cli.js outbox-list
node dist/cli.js outbox-list 10
```

List events by status:

```bash
node dist/cli.js outbox-list failed 10
node dist/cli.js outbox-list processing 10
node dist/cli.js outbox-list dead 10
node dist/cli.js outbox-list all 50
```

Claim pending outbox events for a worker:

```bash
node dist/cli.js outbox-claim 10
```

Mark an outbox event processed:

```bash
node dist/cli.js outbox-mark-processed <event-id>
```

Mark an outbox event failed:

```bash
node dist/cli.js outbox-mark-failed <event-id> "smtp unavailable"
```

Requeue a failed or processing event:

```bash
node dist/cli.js outbox-requeue <event-id>
```

Requeue processing events abandoned by a worker:

```bash
node dist/cli.js outbox-requeue-stale 300 50
```

The first argument is the minimum claimed age in seconds. The optional second argument is the maximum number of events to requeue.

## Exit Behavior

Diagnostics are printed to stderr and the process exits non-zero when parsing, validation, or artifact generation fails.
