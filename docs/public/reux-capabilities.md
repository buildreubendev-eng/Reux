# Reux Capabilities

Reux is a data-native language prototype for reliable backend workflows and simulation-driven applications.

Updated: 2026-05-02

## Status

- Demo readiness: roughly 100%.
- Full platform completion: roughly 100%.
- Release track: prototype-complete.
- Reux is demo-ready for public commerce, logistics, and Business Simulator testing, and prototype-complete for the current language/runtime foundation. The first sellable wedge is the Business Simulator: a guided operational scenario-planning product powered by Reux. The current language-core completion pass is closed; remaining work is product expansion, simulation depth, package distribution, and developer onboarding polish rather than closing the original MVP bar.

## Positioning

- Use normal web frameworks for the product shell.
- Use Reux for data models, typed queries, transactions, events, migrations, and simulation declarations.
- Use real product pilots to validate language features instead of building abstract syntax in isolation.
- Sell Business Simulator first, and let Reux be the engine underneath the buyer-facing product.

## Capability Groups

### Commercial Productization

Status: active.

The first sellable wedge is Business Simulator, aimed at teams that need operational scenario planning, saved results, and explainable recommendations.

- Business Simulator product brief with first-wedge positioning, buyer/user definition, pilot signal, and offer copy.
- Guided pilot offer for turning one real spreadsheet-modeled decision into a reusable scenario model.
- Buyer-facing framing around operational decisions before committing money, staff, time, or risk.
- Demo completion bar focused on result creation, saved runs, shareable summaries, and recommendations.

### Language Core

Status: prototype-complete.

The prototype language core can model schemas, enums, reusable typed queries, guarded transaction functions, durable events, migrations, and simulations.

- Module, entity, enum, query, transaction, event, and simulate declarations.
- Validated scalar, decimal, currency, enum, reference, generated ID, unique, index, check, and transition-rule metadata.
- Explicit joins, left joins, alias-remapped reusable filters, cursor pagination, ordering, limits, record projections, null predicate lowering, and narrow aggregation support.
- Transaction guards, row locking, inserts, mutations, retry metadata, idempotency keys, typed outbox events, typed after-commit hook contracts, nullable expression checks, and null guard lowering.
- Formula-based simulation forecasts with dimensions, units, scheduled changes, scenarios, objectives, rankings, and explanations.

### Runtime And Database

Status: prototype-complete.

The runtime path uses PostgreSQL today and supports compiled query execution, transaction execution, migrations, seeds, and outbox processing.

- PostgreSQL schema emission and runtime query execution.
- Managed transaction execution with retryable conflict handling.
- Migration manifests, diff planning, safety checks, rollback notes, rollback SQL, and environment gates.
- Seed checks, dry runs, upserts, deletes, and transactional resets.
- Outbox list, claim, process, fail, requeue, stale-claim recovery, dead-letter handling, and queue statistics.

### Developer Experience

Status: prototype-complete.

The CLI, docs, package smoke checks, and editor tooling are ready for technical review and local experimentation.

- CLI command catalog, command-specific help, typo suggestions, and actionable usage on failures.
- Generated TypeScript API clients, HTTP server scaffolds, worker scaffolds, and simulation contracts.
- Local VS Code syntax highlighting, diagnostics, formatting, completions, hover text, and current-file definitions.
- Onboarding smoke path, example catalog checks, release preflight, package dry-run, and package install smoke checks.
- Technical docs for architecture, CLI, examples, runtime, migrations, package distribution, editor tooling, and deployment.

### Public Demo

Status: live.

The hosted demo lets public users test commerce, logistics, and Business Simulator workflows with isolated visitor sessions, public API rate limiting, request counters, PostgreSQL-backed saved simulation runs, saved-run health checks, and maintenance cleanup tooling.

- Commerce workflow demo with reset, transaction, queue, and outbox behavior.
- Logistics workflow demo validating non-commerce dispatch workflows.
- Business Simulator demo with result metadata and PostgreSQL-backed saved run records.
- Public API rate limiting and request counters for hosted demo protection.
- Dry-run/apply maintenance cleanup for visitor schemas and saved simulation runs.
- Hosted deep health checks for saved-run creation, reload, and listing.
- Railway-hosted backend connected to PostgreSQL.
- Reuben website embed/link for public testing.
- Health checks, deep smoke checks, CI smoke automation, monitor wrapper, webhook alerts, and operations dashboard.

### Pilots And Validation

Status: active.

Commerce, logistics, clinic, PLOS, and business operations examples keep Reux grounded in real product needs.

- Commerce pilot for accounts, orders, payments, transitions, and durable events.
- Logistics pilot for drivers, vehicles, shipments, dispatch transitions, payouts, and events.
- Clinic pilot for appointments, patients, clinicians, care tasks, lifecycle transitions, and events.
- PLOS finance and habit-consistency simulations.
- Business workforce and operations simulations with domain-pack coverage reports.

## Not Yet

- A custom database engine.
- A distributed runtime.
- A full standard library.
- A package ecosystem.
- General-purpose UI syntax.
- A graphical modeling tool.

## Next Research Tracks

- Richer simulation time-series and assumptions.
- Product-facing simulation execution APIs.
- Compiler-backed language-server features.
