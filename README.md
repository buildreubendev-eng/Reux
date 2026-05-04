# Reux Prototype

This repository is the first executable slice of the Reux language architecture. It starts with the document's recommended path: a modest compiler/runtime for a data/application subset before any custom database engine.

Current scope:

- Parse `module`, `entity`, `enum`, and supported `query` declarations.
- Build a backend-neutral Schema IR.
- Validate basic type, reference, optionality, primary key, uniqueness, check, and index constraints.
- Lower Schema IR to PostgreSQL DDL.
- Lower a narrow query comprehension subset with explicit joins and limits to PostgreSQL `SELECT`.
- Lower narrow grouped aggregations with `count()` and `sum(field)`.
- Emit schema manifests, Query IR, initial migrations, and conservative migration plans.
- Parse transaction functions, emit Transaction IR, lower a supported subset to PostgreSQL, and run it against PostgreSQL.
- Persist durable transaction events through a small `_dl_outbox` runtime table.
- Emit generated TypeScript API clients, minimal HTTP server scaffolds, and worker scaffolds for supported queries and transaction functions.
- Parse `simulate` declarations, emit Simulation IR, and run a small prototype static forecast for early PLOS and business-simulation research.

Ecosystem direction:

- Reuben is the parent brand and public website.
- Reux is the language/runtime layer for data-aware workflows and simulations.
- PLOS is the future personal simulation product for finances, health, career, habits, goals, and time.
- The real-time business simulation engine is the future enterprise product for workforce, cost, productivity, risk, and operational scenario comparison.

The product apps should be built with normal web technology first. Reux should become the shared rule and simulation layer underneath them as the language matures.

## Quick Start

Use this path on a fresh clone when you want to prove the local toolchain works without setting up a database:

```bash
npm install
npm run onboarding:smoke
```

That command builds the CLI, checks real Reux source, emits query and transaction SQL, validates a clinic seed fixture, and runs a simulation forecast. Read [Developer onboarding](docs/technical/developer-onboarding.md) for the guided walkthrough and what each step proves.

For the full local verification suite:

```bash
npm run verify
```

PostgreSQL is only required for runtime/database checks such as `npm run verify:postgres` and the local hosted demo app.

## Command Reference

```bash
npm install
npm run onboarding:smoke
npm run verify
npm run verify:cli
npm run verify:package
npm run release:beta-status
npm run onboarding:doctor
npm run demo:pilot
npm run demo:logistics
npm run demo:clinic
node dist/cli.js check examples/clinic_reux.dl
node dist/cli.js seed-check examples/clinic_reux.dl examples/seeds/clinic_smoke.json
node dist/cli.js simulation-ir examples/simulations/personal_finance.reux
node dist/cli.js simulation-run examples/simulations/workforce_change.reux
node dist/cli.js simulation-run examples/simulations/habit_consistency.reux
node dist/cli.js simulation-run examples/simulations/operations_throughput.reux
$env:DATABASE_URL='postgres://datalang:datalang@127.0.0.1:5432/datalang_dev'
npm run demo:pilot-app
npm run demo:pilot-worker
npm run demo:healthcheck -- http://127.0.0.1:4173 --deep
$env:REUX_DEMO_SETUP_TOKEN='your-admin-token'
npm run demo:pilot-leads -- http://127.0.0.1:4173
npm run demo:monitor -- http://127.0.0.1:4173 --deep
node dist/cli.js version
npm run verify:postgres
npm run build
npm run test:postgres
npm run test:pilot:postgres
node dist/cli.js format examples/pilot_reux.dl
node dist/cli.js check examples/commerce.dl
node dist/cli.js project-check
node dist/cli.js project-format
node dist/cli.js project-summary
node dist/cli.js project-summary --json
node dist/cli.js project-doctor
node dist/cli.js project-doctor --db
node dist/cli.js project-sql
node dist/cli.js project-manifest-write
node dist/cli.js project-migrate-plan
node dist/cli.js project-migrate-check
node dist/cli.js project-migrate-diff-create commerce_next
node dist/cli.js project-query-sql highValueUsers
node dist/cli.js project-query-run highValueUsers '[1000]'
node dist/cli.js project-explain highValueUsers
node dist/cli.js project-api-ts ./runtime.js
node dist/cli.js project-api-server-ts ./api.js ./config.js ./runtime.js
node dist/cli.js project-worker-ts ./config.js ./runtime.js
node dist/cli.js project-tx-sql rewardUser
node dist/cli.js project-tx-run rewardUser '["user-id","100"]'
node dist/cli.js project-data-insert-sql User '{"name":"Ada","email":"ada@example.com","balance":"1200"}'
node dist/cli.js sql examples/commerce.dl
node dist/cli.js manifest examples/commerce.dl
node dist/cli.js manifest-write examples/commerce.dl
node dist/cli.js query-ir examples/commerce.dl highValueUsers
node dist/cli.js query-sql examples/commerce.dl highValueUsers
node dist/cli.js query-run examples/commerce.dl highValueUsers '[1000]'
node dist/cli.js data-insert-sql examples/commerce.dl User '{"name":"Ada","email":"ada@example.com","balance":"1200"}'
node dist/cli.js data-insert examples/commerce.dl User '{"name":"Ada","email":"ada@example.com","balance":"1200"}'
node dist/cli.js seed-dry-run examples/commerce_v2.dl examples/seeds/commerce_smoke.json
node dist/cli.js seed-check examples/pilot_reux.dl pilot/seeds/smoke.json
node dist/cli.js seed-dry-run examples/pilot_reux.dl pilot/seeds/smoke.json
node dist/cli.js seed-run examples/pilot_reux.dl pilot/seeds/smoke.json
node dist/cli.js seed-delete examples/pilot_reux.dl pilot/seeds/smoke.json
node dist/cli.js seed-reset examples/pilot_reux.dl pilot/seeds/smoke.json
node dist/cli.js tx-ir examples/commerce_v2.dl rewardUser
node dist/cli.js tx-sql examples/commerce_v2.dl rewardUser
node dist/cli.js tx-run examples/commerce_v2.dl rewardUser '["user-id","100"]'
node dist/cli.js check examples/pilot_reux.dl
node dist/cli.js query-sql examples/pilot_reux.dl accountOrders
node dist/cli.js query-sql examples/pilot_reux.dl accountOrderSummary
node dist/cli.js api-ts examples/pilot_reux.dl ./runtime.js
node dist/cli.js api-server-ts examples/pilot_reux.dl ./api.js ./config.js ./runtime.js
node dist/cli.js worker-ts examples/pilot_reux.dl ./config.js ./runtime.js
node dist/cli.js tx-sql examples/pilot_reux.dl creditAccount
$env:REUX_CONFIG='pilot/dl.json'
node dist/cli.js project-doctor
node dist/cli.js project-query-sql accountOrders
node dist/cli.js project-seed-check pilot/seeds/smoke.json
node dist/cli.js project-seed-dry-run pilot/seeds/smoke.json
node dist/cli.js project-seed-run pilot/seeds/smoke.json
node dist/cli.js project-seed-delete pilot/seeds/smoke.json
node dist/cli.js project-seed-reset pilot/seeds/smoke.json
Remove-Item Env:REUX_CONFIG
node dist/cli.js outbox-list
node dist/cli.js outbox-list failed 10
node dist/cli.js outbox-list dead 10
node dist/cli.js outbox-claim 10
node dist/cli.js outbox-mark-processed '<event-id>'
node dist/cli.js outbox-mark-failed '<event-id>' 'smtp unavailable'
node dist/cli.js outbox-requeue '<event-id>'
node dist/cli.js outbox-requeue-stale 300 50
node dist/cli.js explain examples/commerce.dl highValueUsers
node dist/cli.js migrate-create examples/commerce.dl initial_schema
node dist/cli.js manifest examples/commerce.dl > old-manifest.json
node dist/cli.js migrate-plan old-manifest.json examples/commerce_v2.dl
node dist/cli.js migrate-check old-manifest.json examples/commerce_v2.dl
node dist/cli.js migrate-diff-create old-manifest.json examples/commerce_v2.dl commerce_v2
npm run release:preflight
npm run release:pack-dry-run
```

This is intentionally a scoped MVP slice, not the complete language.

Technical documentation:

- [Developer onboarding](docs/technical/developer-onboarding.md)
- [Language subset](docs/technical/language-subset.md)
- [Ecosystem architecture](docs/technical/ecosystem-architecture.md)
- [Compiler artifacts](docs/technical/compiler-artifacts.md)
- [CLI reference](docs/technical/cli.md)
- [Example catalog](docs/technical/examples.md)
- [Migrations](docs/technical/migrations.md)
- [Runtime](docs/technical/runtime.md)
- [Release and packaging](docs/technical/release.md)
- [Package distribution](docs/technical/package-distribution.md)
- [Editor tooling](docs/technical/editor-tooling.md)
- [Local PostgreSQL](docs/technical/local-postgres.md)
- [Roadmap](docs/technical/roadmap.md)
- [Phase status](docs/technical/phase-status.md)
- [Pilot application](docs/technical/pilot-application.md)
- [Pilot demo deployment](docs/technical/demo-deployment.md)
- [Logistics pilot](docs/technical/logistics-pilot.md)
- [Clinic pilot](docs/technical/clinic-pilot.md)
- [Pilot demo walkthrough](docs/tutorial/demo-walkthrough.md)
- [Public demo testing guide](docs/public/reux-demo-testing-guide.md)
- [Public Reux roadmap](docs/public/reux-roadmap.md)
- [Public Reux roadmap data](docs/public/reux-roadmap.json)
- [Public Reux capabilities](docs/public/reux-capabilities.md)
- [Public Reux capabilities data](docs/public/reux-capabilities.json)
- [Public Reux snapshot](docs/public/reux-public-snapshot.md)
- [Public Reux snapshot data](docs/public/reux-public-snapshot.json)
- [Public Reux positioning guide](docs/public/reux-positioning.md)
- [Business Simulator product brief](docs/public/business-simulator-product-brief.md)
- [Business Simulator frontend roadmap](docs/public/business-simulator-frontend-roadmap.md)
- [Business Simulator backend roadmap](docs/public/business-simulator-backend-roadmap.md)
- [Public Reux developer access](docs/public/reux-developer-access.md)
- [Next backlog](docs/technical/next-backlog.md)

GitHub Actions runs `npm run verify` and PostgreSQL-backed `npm run verify:postgres` on pushes and pull requests to `main`.
