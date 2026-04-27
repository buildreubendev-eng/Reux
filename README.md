# Reux Prototype

This repository is the first executable slice of the Reux language architecture. It starts with the document's recommended path: a modest compiler/runtime for a data/application subset before any custom database engine.

Current scope:

- Parse `module`, `entity`, `enum`, and supported `query` declarations.
- Build a backend-neutral Schema IR.
- Validate basic type, reference, optionality, primary key, uniqueness, check, and index constraints.
- Lower Schema IR to PostgreSQL DDL.
- Lower a narrow query comprehension subset with explicit joins to PostgreSQL `SELECT`.
- Lower narrow grouped aggregations with `count()` and `sum(field)`.
- Emit schema manifests, Query IR, initial migrations, and conservative migration plans.
- Parse transaction functions, emit Transaction IR, lower a supported subset to PostgreSQL, and run it against PostgreSQL.
- Persist durable transaction events through a small `_dl_outbox` runtime table.

Run:

```bash
npm install
npm run verify
npm run verify:cli
npm run verify:package
node dist/cli.js version
$env:DATABASE_URL='postgres://datalang:datalang@127.0.0.1:5432/datalang_dev'
npm run verify:postgres
npm run build
npm run test:postgres
npm run test:pilot:postgres
node dist/cli.js check examples/commerce.dl
node dist/cli.js project-check
node dist/cli.js project-summary
node dist/cli.js project-summary --json
node dist/cli.js project-doctor
node dist/cli.js project-doctor --db
node dist/cli.js project-sql
node dist/cli.js project-manifest-write
node dist/cli.js project-migrate-plan
node dist/cli.js project-migrate-diff-create commerce_next
node dist/cli.js project-query-sql highValueUsers
node dist/cli.js project-query-run highValueUsers '[1000]'
node dist/cli.js project-explain highValueUsers
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
node dist/cli.js outbox-claim 10
node dist/cli.js outbox-mark-processed '<event-id>'
node dist/cli.js outbox-mark-failed '<event-id>' 'smtp unavailable'
node dist/cli.js outbox-requeue '<event-id>'
node dist/cli.js outbox-requeue-stale 300 50
node dist/cli.js explain examples/commerce.dl highValueUsers
node dist/cli.js migrate-create examples/commerce.dl initial_schema
node dist/cli.js manifest examples/commerce.dl > old-manifest.json
node dist/cli.js migrate-plan old-manifest.json examples/commerce_v2.dl
node dist/cli.js migrate-diff-create old-manifest.json examples/commerce_v2.dl commerce_v2
```

This is intentionally a scoped MVP slice, not the complete language.

Technical documentation:

- [Language subset](docs/technical/language-subset.md)
- [Compiler artifacts](docs/technical/compiler-artifacts.md)
- [CLI reference](docs/technical/cli.md)
- [Migrations](docs/technical/migrations.md)
- [Runtime](docs/technical/runtime.md)
- [Release and packaging](docs/technical/release.md)
- [Local PostgreSQL](docs/technical/local-postgres.md)
- [Phase status](docs/technical/phase-status.md)
- [Pilot application](docs/technical/pilot-application.md)

GitHub Actions runs `npm run verify` and PostgreSQL-backed `npm run verify:postgres` on pushes and pull requests to `main`.
