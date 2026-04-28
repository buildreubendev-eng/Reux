# Phase Status

Reux has completed the Phase 6 prototype pilot slice from the architecture roadmap while continuing to harden earlier phases.

## Phase 0: Specification And Prototype Front End

Status: mostly implemented for the MVP subset.

- Parses `module`, `entity`, `enum`, `query`, and `transaction function`.
- Builds a declaration-oriented AST.
- Reports parser and aggregate validation diagnostics.
- Maintains a basic type environment through Schema IR validation.

## Phase 1: Schema And Type Checker

Status: mostly implemented for the MVP subset.

- Supports scalar fields, entity references, generated IDs, enums, indexes, defaults, checks, uniqueness, and nullability.
- Emits backend-neutral Schema IR and stable schema manifests.
- Supports enum-backed transition rules as validated Schema IR artifacts.
- Rejects duplicate declarations, invalid references, unsupported types, duplicate fields/indexes/enum values, and invalid query/transaction parameters.

## Phase 2: Query Compiler

Status: implemented for a narrow query subset.

- Supports one scanned entity with explicit joins, optional `where`, optional `group by`, optional `order by`, optional `limit`, entity or record projection, enum literal predicates, and narrow `count()`/`sum(field)`/`avg(field)`/`min(field)`/`max(field)` aggregations.
- Emits Query IR and PostgreSQL SQL.
- Validates referenced fields, parameter references, enum literal values, and record projection shape against declared `Query<{ ... }>` result types.
- Provides `explain`, `query-ir`, `query-sql`, and project-scoped variants.

## Phase 3: Runtime And Transactions

Status: implemented for the supported SQL subset.

- Uses PostgreSQL through `pg`.
- Runs compiled queries.
- Runs supported transaction SQL inside managed `BEGIN`/`COMMIT`/`ROLLBACK`.
- Retries retryable PostgreSQL conflicts and deadlocks according to `retry N`.
- Supports `load ... for update`, simple loaded-entity mutations, transition-guarded literal and parameterized enum assignments, `insert Entity { ... }`, bound insert results, enum-valued transaction writes, and durable `enqueue Event { ... }`.
- Records outbox events in `_dl_outbox` and exposes list, claim, mark processed, mark failed, requeue, and stale-claim recovery commands.
- Provides embeddable `processOutboxEvents` and `runOutboxWorker` helpers for dispatching claimed events to application handlers.
- Provides an embeddable `processAfterCommitHooks` helper for dispatching returned after-commit hooks to application handlers.

## Phase 4: Migrations

Status: implemented for conservative schema diffs.

- Emits schema manifests with stable hashes.
- Creates initial migrations.
- Plans diffs from previous manifest to current source.
- Emits SQL for safe operations and comments/diagnostics for unsafe or destructive operations.
- Applies migrations with hash recording and hash mismatch refusal.
- Provides project-scoped migration planning and diff creation.
- Provides migration safety checks that fail deployment gates on unsafe or destructive operations unless explicitly allowed.

## Phase 5: Tooling

Status: implemented for the MVP workflow.

- CLI includes file-scoped commands and project-scoped commands driven by `dl.json`.
- `project-check` compiles configured sources.
- `project-summary` inventories configured sources and reports duplicate cross-file declarations.
- `project-doctor` checks source discovery, manifest freshness, migration directory visibility, and database URL environment status.
- `api-ts` and `project-api-ts` emit generated TypeScript API clients for supported queries and transaction functions.
- `api-server-ts` and `project-api-server-ts` emit a minimal HTTP server scaffold around the generated client.
- `worker-ts` and `project-worker-ts` emit an outbox worker scaffold with placeholders for declared event and after-commit handlers.
- Seed tooling supports schema-only checks with enum validation, PostgreSQL dry runs, rerunnable upserts, deletes, and transactional resets.
- `npm run demo:pilot` provides a no-database pilot demo that emits compiler, migration, query, transaction, API-client, and seed-check artifacts.
- GitHub Actions runs the core verification script, built CLI smoke checks, and PostgreSQL-backed runtime verification on pushes and pull requests to `main`.
- Technical documentation is maintained alongside implementation.

## Phase 6: Pilot Application

Status: complete for the current prototype scope.

The current commerce examples remain compiler/runtime fixtures. The first pilot source now lives at `examples/pilot_reux.dl` and models a realistic accounts/orders/payments slice with several relationships, nontrivial join queries, a payment-capture transaction, a retryable account-credit transaction, and durable outbox coordination.

Phase 6 coverage:

- Accounts/orders/payments domain modeled in Reux source.
- Several relationships represented through `Order.account` and `Payment.order`.
- Nontrivial queries represented by `accountOrders` and `orderPayments`, both with explicit joins.
- Pilot summary reporting represented by `accountOrderSummary`, which uses `group by`, `count()`, and `sum(order.total)`.
- Migration evolution documented through pilot manifest comparison while the active commerce migrations remain hash-stable.
- Transaction conflict behavior represented by `creditAccount`, which lowers to `SELECT ... FOR UPDATE`, a balance update, retry metadata, and an outbox event.
- Production-like verification path documented for WSL PostgreSQL through `npm run test:postgres`.

The remaining gaps are beyond Phase 6 rather than blockers for it: richer query composition, deeper aggregation semantics, broader fixture/seed workflows, turning the embeddable outbox loop into a packaged service process, and eventually switching `dl.json` from commerce fixtures to the pilot source when the project is ready to treat the pilot as the active application.
