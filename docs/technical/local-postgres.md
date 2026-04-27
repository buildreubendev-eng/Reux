# Local PostgreSQL

The repository includes a Docker Compose setup for local runtime testing. If Docker Desktop is unavailable, WSL PostgreSQL is also supported and was used for the first full integration-backed pass.

## Start PostgreSQL

### Docker Compose

```bash
docker compose up -d postgres
```

### WSL PostgreSQL

In Ubuntu WSL:

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo service postgresql start
sudo -u postgres psql -c "CREATE USER datalang WITH PASSWORD 'datalang';"
sudo -u postgres psql -c "CREATE DATABASE datalang_dev OWNER datalang;"
```

If the user or database already exists, keep going. For a clean disposable database:

```bash
sudo -u postgres dropdb --if-exists datalang_dev
sudo -u postgres createdb -O datalang datalang_dev
```

Set the database URL:

```bash
$env:DATABASE_URL="postgres://datalang:datalang@localhost:5432/datalang_dev"
```

PowerShell users can also copy `.env.example` into their own shell/profile workflow. The CLI reads the environment variable named by `dl.json`.

## Build

```bash
npm install
npm run verify
npm run verify:cli
npm run build
```

`npm run verify` runs the TypeScript no-emit check, unit test suite, build, and CLI smoke checks. Use it before committing changes that do not need a live database. `npm run verify:cli` can be run after a build to repeat only the built CLI smoke checks.

Check database reachability before running integration tests:

```bash
npm run postgres:preflight
```

## Apply Migrations

```bash
node dist/cli.js migrate-status
node dist/cli.js migrate-status --json
node dist/cli.js project-doctor --db
node dist/cli.js migrate-apply
node dist/cli.js migrate-status
```

## Insert Data

```bash
node dist/cli.js data-insert examples/commerce.dl User '{"name":"Ada","email":"ada@example.com","balance":"1200"}'
node dist/cli.js project-data-insert User '{"name":"Ada","email":"ada@example.com","balance":"1200"}'
node dist/cli.js seed-dry-run examples/commerce_v2.dl examples/seeds/commerce_smoke.json
```

Fields omitted from the JSON object are left to database defaults or nullable columns.

Preview generated insert SQL:

```bash
node dist/cli.js data-insert-sql examples/commerce.dl User '{"name":"Ada","email":"ada@example.com","balance":"1200"}'
node dist/cli.js project-data-insert-sql User '{"name":"Ada","email":"ada@example.com","balance":"1200"}'
```

You can also place the JSON in a file and pass `@seed/user.json`.

## Run A Query

```bash
node dist/cli.js query-run examples/commerce.dl highValueUsers '["1000"]'
node dist/cli.js project-query-run highValueUsers '["1000"]'
```

The result is printed as JSON.
You can also pass parameters as `@params.json`.

## Run A Transaction

Use the UUID returned from `data-insert` as the entity handle:

```bash
node dist/cli.js tx-run examples/commerce_v2.dl rewardUser '["00000000-0000-0000-0000-000000000000","100"]'
node dist/cli.js project-tx-run rewardUser '["00000000-0000-0000-0000-000000000000","100"]'
```

The current transaction runtime updates simple loaded entity fields and reports pending `after commit` hooks.
You can also pass parameters as `@params.json`.

If the transaction uses `enqueue`, `tx-run` creates `_dl_outbox` if needed and inserts the event in the same transaction.

List and mark outbox events:

```bash
node dist/cli.js outbox-list
node dist/cli.js outbox-list failed 10
node dist/cli.js outbox-claim 10
node dist/cli.js outbox-mark-processed <event-id>
node dist/cli.js outbox-mark-failed <event-id> "smtp unavailable"
node dist/cli.js outbox-requeue <event-id>
node dist/cli.js outbox-requeue-stale 300 50
```

## Integration Tests

Integration tests are skipped unless `DATABASE_URL` is set:

```bash
$env:DATABASE_URL="postgres://datalang:datalang@localhost:5432/datalang_dev"
npm run postgres:preflight
npm run verify:postgres
npm run verify:postgres:full
npm run test:postgres
```

`npm run verify:postgres` checks connectivity and runs both PostgreSQL-backed suites: the root runtime integration test and the pilot application test. `npm run verify:postgres:full` adds a built CLI `project-doctor --db --json` pass. `npm test` also runs the integration suite when `DATABASE_URL` is set. These tests use the configured database and should be run against a disposable development database.
