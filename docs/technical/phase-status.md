# Phase Status

Reux has completed the Phase 6 prototype pilot slice from the architecture roadmap while continuing to harden earlier phases.

## Phase 0: Specification And Prototype Front End

Status: mostly implemented for the MVP subset.

- Parses `module`, `entity`, `enum`, `query`, `simulate`, and `transaction function`.
- Builds a declaration-oriented AST.
- Reports parser and aggregate validation diagnostics.
- Maintains a basic type environment through Schema IR validation.

## Phase 1: Schema And Type Checker

Status: mostly implemented for the MVP subset.

- Supports scalar fields, bounded `Decimal<precision, scale>` fields, validated `CurrencyCode` fields, entity references, generated IDs, enums, typed outbox events, indexes, defaults, checks, uniqueness, and nullability.
- Emits backend-neutral Schema IR and stable schema manifests.
- Supports enum-backed transition rules as validated Schema IR artifacts.
- Rejects duplicate declarations, invalid references, unsupported types, duplicate fields/indexes/enum values, and invalid query/transaction parameters.

## Phase 2: Query Compiler

Status: implemented for a narrow query subset.

- Supports one scanned entity with explicit joins, left joins, reusable filter fragments, compound `where`, cursor `after`, optional `group by`, optional deterministic `order by`/`limit`, entity or record projection, enum literal predicates, `Query<infer>` row typing for generated clients, and narrow `count()`/`sum(field)`/`avg(field)`/`min(field)`/`max(field)` aggregations.
- Emits Query IR and PostgreSQL SQL.
- Validates referenced fields, parameter references, enum literal values, and record projection shape against declared `Query<{ ... }>` result types.
- Provides `explain`, `query-ir`, `query-sql`, and project-scoped variants.

## Phase 3: Runtime And Transactions

Status: implemented for the supported SQL subset.

- Uses PostgreSQL through `pg`.
- Runs compiled queries.
- Runs supported transaction SQL inside managed `BEGIN`/`COMMIT`/`ROLLBACK`.
- Retries retryable PostgreSQL conflicts and deadlocks according to `retry N`.
- Supports `load ... for update`, simple loaded-entity mutations, `idempotency key`, `require ... else abort ...` guards, transition-guarded literal and parameterized enum assignments, `insert Entity { ... }`, bound insert results and later bound-field references, typed event payload validation, enum-valued transaction writes with enum-parameter compatibility checks, and durable `enqueue Event { ... }`.
- Validates `after commit` hook argument references before runtime dispatch.
- Records outbox events in `_dl_outbox` and exposes list, claim, mark processed, mark failed, requeue, and stale-claim recovery commands.
- Provides embeddable `processOutboxEvents` and `runOutboxWorker` helpers for dispatching claimed events to application handlers, with delayed retry scheduling, max-attempt dead-lettering, stale claim recovery, `outbox-stats` summaries, per-iteration worker observability, stale-requeue totals, and separate retry/dead-letter result reporting.
- Provides an embeddable `processAfterCommitHooks` helper for dispatching returned after-commit hooks to application handlers, with optional parameter and binding resolution for hook arguments.

## Phase 4: Migrations

Status: implemented for conservative schema diffs.

- Emits schema manifests with stable hashes.
- Creates initial migrations.
- Plans diffs from previous manifest to current source.
- Emits SQL for safe operations and comments/diagnostics for unsafe or destructive operations.
- Applies migrations with hash recording and hash mismatch refusal.
- Provides project-scoped migration planning and diff creation.
- Provides migration safety checks that fail deployment gates on unsafe or destructive operations unless explicitly allowed.
- Includes review notes, rollback notes, deployment checklists, production environment gates, and pre-create safety checks for generated diff migrations.

## Phase 5: Tooling

Status: implemented for the MVP workflow.

- CLI includes file-scoped commands and project-scoped commands driven by `dl.json`.
- `project-check` compiles configured sources.
- `project-summary` inventories configured sources and reports duplicate cross-file declarations.
- `project-doctor` checks source discovery, manifest freshness, migration directory visibility, and database URL environment status.
- `api-ts` and `project-api-ts` emit generated TypeScript API clients for supported queries and transaction functions.
- `api-server-ts` and `project-api-server-ts` emit a minimal HTTP server scaffold around the generated client.
- `worker-ts` and `project-worker-ts` emit an outbox worker scaffold with typed payload contracts, retry/dead-letter environment controls, declared event handlers, and named after-commit handler contracts.
- `simulation-ir` and `simulation-run` emit and execute the first prototype formula-based simulation forecast model with domain dimensions, lightweight units, formula unit-compatibility diagnostics, maximize/minimize objectives, shared scheduled assumption changes, scenario-specific scheduled changes, scenario overrides, final-period deltas, period-by-period deltas, first-divergence reporting, objective-aware metric rankings, and explanation summaries.
- `simulation-types-ts` and `project-simulation-types-ts` emit TypeScript contracts for simulation dimensions, assumptions, metrics, scenarios, objectives, run results, comparisons, explanations, comparison summaries, helper functions, and metadata constants.
- `simulation-packs` and `project-simulation-packs` report advisory PLOS/business domain pack matches, coverage scoring, and suggested assumptions, metrics, scenarios, or objectives to add.
- PLOS simulation examples now cover both personal finance and habit consistency.
- `format` and `project-format` provide conservative stdout formatting for `.dl` and `.reux` files.
- A local VS Code language package under `editors/vscode` provides `.dl`/`.reux` file association, syntax highlighting, bracket pairing, line-aware diagnostics backed by `reux diagnose --json`, formatting backed by `reux format`, lightweight completions, query-alias field completions, insert/enqueue object-field completions, hover text, and current-file go-to-definition.
- Package distribution now has typed ESM entrypoints, runtime subpath exports, package dry-run coverage for editor assets, and tarball installation documentation.
- `scripts/demo-pilot-worker.mjs` provides a runnable pilot outbox worker process for hosted and local demo environments.
- Seed tooling supports schema-only checks with enum validation, PostgreSQL dry runs, rerunnable upserts, deletes, and transactional resets.
- Seed reset supports delete-and-rerun and truncate-and-rerun modes for local fixture refreshes.
- `npm run demo:pilot` provides a no-database pilot demo that emits compiler, migration, query, transaction, API-client, and seed-check artifacts.
- GitHub Actions runs the core verification script, built CLI smoke checks, and PostgreSQL-backed runtime verification on pushes and pull requests to `main`.
- Technical documentation is maintained alongside implementation.

## Phase 6: Pilot Application

Status: complete for the current prototype scope.

The current commerce examples remain compiler/runtime fixtures. The first pilot source now lives at `examples/pilot_reux.dl` and models a realistic accounts/orders/payments slice with several relationships, nontrivial join queries, a payment-capture transaction, a retryable account-credit transaction, and durable outbox coordination.

A second non-commerce pilot source now lives at `examples/logistics_reux.dl`. It models driver dispatch, vehicles, shipments, shipment lifecycle transitions, driver payout credits, and logistics outbox events.

Phase 6 coverage:

- Accounts/orders/payments domain modeled in Reux source.
- Several relationships represented through `Order.account` and `Payment.order`.
- Nontrivial queries represented by `accountOrders` and `orderPayments`, both with explicit joins.
- Pilot summary reporting represented by `accountOrderSummary`, which uses `group by`, `count()`, and `sum(order.total)`.
- Migration evolution documented through pilot manifest comparison while the active commerce migrations remain hash-stable.
- Transaction-local generated ID behavior represented by `capturePayment`, which binds the inserted payment and includes `payment.id` in the durable outbox payload.
- Transaction conflict behavior represented by `creditAccount`, which lowers to `SELECT ... FOR UPDATE`, a balance update, retry metadata, and an outbox event.
- Production-like verification path documented for WSL PostgreSQL through `npm run test:postgres`.
- Browser demo app deployed as a Node/PostgreSQL service path with public-safe admin setup controls, schema-isolated outbox state, domain-scoped queue health, and a worker-style outbox processing loop.
- Public demo UI includes in-page tester guidance and clearer empty states so visitors understand reset, transaction, and outbox behavior without an admin token.
- Hosted demo validation includes health, deep queue stats, and an opt-in smoke mode that exercises public reset, transactions, queue health transitions, and outbox processing for commerce and logistics.
- CI runs the same smoke path against a PostgreSQL-backed demo server through `npm run verify:demo:smoke`.
- Isolated public demo sessions map each visitor to a session schema and expose a public `Reset My Session` flow, avoiding shared-state collisions in the hosted demo.
- Logistics pilot coverage shows the same Reux subset applied to dispatch workflows rather than commerce.

The remaining gaps are beyond Phase 6 rather than blockers for it: richer query composition, deeper aggregation semantics, broader fixture/seed workflows, more production-grade worker supervision/dead-letter behavior, deeper simulation semantics, and eventually switching `dl.json` from commerce fixtures to the pilot source when the project is ready to treat the pilot as the active application. See [Roadmap](roadmap.md) for the current demo-readiness and full-completion priorities.
