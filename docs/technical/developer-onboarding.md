# Developer Onboarding

This is the shortest path from a fresh clone to a working Reux toolchain. It does not require PostgreSQL, Docker, Railway, or the hosted demo.

## Prerequisites

- Node.js 22 or newer.
- npm.
- Optional: VS Code for `.dl` and `.reux` editing.

## First Ten Minutes

From the repository root:

```powershell
npm install
npm run onboarding:doctor
npm run onboarding:smoke
```

`onboarding:doctor` is a fast prerequisite check. It verifies the Node version, important package scripts, examples, seed fixtures, docs, and editor files before the heavier build path starts.

The smoke path builds the CLI and runs a representative no-database workflow:

- `reux version` confirms the CLI can start.
- `reux check examples/pilot_reux.dl` validates a workflow/data source file.
- `reux query-sql examples/pilot_reux.dl accountOrders` emits PostgreSQL for a query.
- `reux tx-sql examples/pilot_reux.dl markOrderPaid` emits guarded transaction SQL.
- `reux seed-check examples/clinic_reux.dl examples/seeds/clinic_smoke.json` validates seed data against the clinic pilot schema.
- `reux simulation-run examples/simulations/workforce_change.reux` runs a prototype simulation forecast.

If this command passes, the local compiler, formatter dependencies, example sources, seed validator, SQL emitters, and simulation runner are all usable.

## What To Look At First

- `examples/pilot_reux.dl`: commerce workflow with accounts, products, orders, payments, transitions, transactions, and events.
- `examples/logistics_reux.dl`: dispatch workflow with drivers, vehicles, shipments, transitions, and driver crediting.
- `examples/clinic_reux.dl`: clinic workflow with patients, clinicians, visits, care tasks, transitions, and appointment events.
- `examples/simulations/*.reux`: early simulation language examples for PLOS and business-simulator research.

See [Example catalog](examples.md) for the full list and the consistency rules each example is expected to follow.

## Common Local Commands

```powershell
npm run build
npm run examples:check
node dist/cli.js check examples/clinic_reux.dl
node dist/cli.js query-sql examples/logistics_reux.dl driverManifest
node dist/cli.js tx-sql examples/pilot_reux.dl capturePayment
node dist/cli.js simulation-run examples/simulations/business_simulator.reux
npm test
```

Use the `npm run reux -- <command>` style if you prefer npm to resolve the local CLI wrapper:

```powershell
npm run reux -- check examples/pilot_reux.dl
```

## Editor Setup

The local VS Code extension lives in `editors/vscode`. It provides `.dl` and `.reux` file associations, syntax highlighting, diagnostics, formatting, completions, hover text, and current-file go-to-definition.

For local development, point the extension at this repo's CLI build:

```json
{
  "reux.cliPath": "C:\\path\\to\\Reux\\dist\\cli.js"
}
```

After editing compiler or CLI code, run:

```powershell
npm run build
```

Then reopen or reload VS Code if diagnostics are still using an older build.

## When You Need PostgreSQL

The onboarding smoke path is intentionally database-free. Use PostgreSQL only when testing runtime execution, migrations, seed application, or the local demo app.

```powershell
$env:DATABASE_URL='postgres://datalang:datalang@127.0.0.1:5432/datalang_dev'
npm run verify:postgres
npm run demo:pilot-app
```

See [Local PostgreSQL](local-postgres.md) for setup details.

## What Passing Means

A passing onboarding smoke path means a new developer can:

- install the repo dependencies;
- build and run the Reux CLI;
- validate real Reux source files;
- inspect generated SQL without a database;
- validate seed fixtures;
- run simulation examples;
- move on to the full test or PostgreSQL workflows with confidence.

For the complete CLI catalog, see [CLI Reference](cli.md).
