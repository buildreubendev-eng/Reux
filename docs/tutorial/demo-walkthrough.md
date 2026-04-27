# Pilot Demo Walkthrough

This walkthrough exercises the Reux pilot without Docker and without a live database. It is the quickest way to show that the language source compiles into useful artifacts for an application.

Run the full no-database demo:

```bash
npm run demo:pilot
```

The script sets `REUX_CONFIG=pilot/dl.json`, builds the CLI, then runs these checks:

- compile and summarize `examples/pilot_reux.dl`;
- run project doctor without connecting to PostgreSQL;
- inspect `Order.status` transition rules;
- compare the pilot source to the checked-in pilot schema manifest;
- emit SQL for `accountOrderSummary`;
- emit guarded transaction SQL for `markOrderPaid`;
- emit a generated TypeScript API client;
- validate `pilot/seeds/smoke.json` against the pilot schema.

## Manual Flow

Use this flow when you want to present each artifact one at a time:

```powershell
$env:REUX_CONFIG='pilot/dl.json'
npm run build
node dist/cli.js project-diagnose --json
node dist/cli.js project-transition-rules Order.status
node dist/cli.js project-query-sql accountOrderSummary
node dist/cli.js project-tx-sql markOrderPaid
node dist/cli.js project-api-ts ./runtime.js
node dist/cli.js project-seed-check pilot/seeds/smoke.json
Remove-Item Env:REUX_CONFIG
```

## Database Check

Once PostgreSQL is available, use the production-like check:

```powershell
$env:DATABASE_URL='postgres://datalang:datalang@127.0.0.1:5432/datalang_dev'
npm run verify:postgres:full
```

That path runs the PostgreSQL preflight, integration tests, pilot tests, a build, and `project-doctor --db --json`.
