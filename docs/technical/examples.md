# Example Catalog

The examples are the public proof set for Reux. They are intentionally small, but each one exists to exercise a different part of the language/runtime story.

Use this command to verify the whole catalog:

```powershell
npm run examples:check
```

The checker rebuilds the CLI, compiles every showcased source file, validates workflow seeds, emits representative query and transaction SQL, emits generated API/worker scaffolds for workflow pilots, runs simulation examples, and confirms the docs still point at the right files and commands.

## Workflow Pilots

| Example | Source | Seed | Walkthrough | What It Proves |
| --- | --- | --- | --- | --- |
| Commerce | `examples/pilot_reux.dl` | `pilot/seeds/smoke.json` | `npm run demo:pilot` | Accounts, products, orders, payments, money fields, lifecycle transitions, transactions, and outbox events. |
| Logistics | `examples/logistics_reux.dl` | `examples/seeds/logistics_smoke.json` | `npm run demo:logistics` | Drivers, vehicles, shipments, dispatch state transitions, driver payout crediting, joins, aggregates, and events. |
| Clinic | `examples/clinic_reux.dl` | `examples/seeds/clinic_smoke.json` | `npm run demo:clinic` | Patients, clinicians, visits, care tasks, appointment transitions, task load aggregates, task assignment, and events. |

The workflow examples should all keep this shape:

- one module with a domain-specific name;
- multiple entities with references;
- at least one enum-backed transition declaration;
- typed queries for worklists and summaries;
- retryable transaction functions;
- durable outbox events and after-commit hooks;
- a small smoke seed;
- a dedicated technical doc or walkthrough.

## Simulation Examples

| Example | Source | Product Dimension | Domain Dimension | Audience |
| --- | --- | --- | --- | --- |
| Personal finance | `examples/simulations/personal_finance.reux` | `PLOS` | `finance` | `personal` |
| Habit consistency | `examples/simulations/habit_consistency.reux` | `PLOS` | `habits` | `personal` |
| Workforce change | `examples/simulations/workforce_change.reux` | `business_simulation` | `workforce` | `enterprise` |
| Operations throughput | `examples/simulations/operations_throughput.reux` | `business_simulation` | `operations` | `enterprise` |
| Business simulator | `examples/simulations/business_simulator.reux` | `business_simulation` | `operations` | `enterprise` |

The simulation examples should all keep this shape:

- `dimension product = ...`;
- `dimension domain = ...`;
- `dimension audience = ...`;
- at least one assumption;
- at least one formula;
- at least one objective that references a formula;
- at least one scenario;
- a forecast horizon.

The `business_simulator.reux` example intentionally uses camelCase names because it mirrors the public Business Simulator API contract. The other examples use snake_case to keep language examples readable.

## Common Commands

```powershell
npm run build
npm run examples:check
node dist/cli.js check examples/pilot_reux.dl
node dist/cli.js query-sql examples/logistics_reux.dl driverManifest
node dist/cli.js tx-sql examples/clinic_reux.dl assignCareTask
node dist/cli.js seed-check examples/clinic_reux.dl examples/seeds/clinic_smoke.json
node dist/cli.js simulation-run examples/simulations/business_simulator.reux
```

## Adding A New Example

For a new workflow pilot:

1. Add a source file under `examples/`.
2. Add a smoke seed under `examples/seeds/` or the pilot folder if it has a project config.
3. Add a demo script if the example needs a walkthrough.
4. Add or update a technical doc.
5. Add the example metadata to `scripts/check-examples.mjs`.
6. Run `npm run examples:check`.

For a new simulation example:

1. Add a `.reux` file under `examples/simulations/`.
2. Include `product`, `domain`, and `audience` dimensions.
3. Include assumptions, formulas, objectives, scenarios, and a forecast.
4. Add the example metadata to `scripts/check-examples.mjs`.
5. Run `npm run examples:check`.

The goal is not to make every example large. The goal is for every example to prove one clear slice of Reux and stay executable.
