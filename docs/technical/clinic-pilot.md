# Clinic Pilot

`examples/clinic_reux.dl` is the third non-commerce Reux pilot slice. It models clinic operations with patients, clinicians, visits, care tasks, lifecycle transitions, durable events, and task assignment workflows.

The slice demonstrates Reux outside commerce and logistics:

- `Patient`: patient identity, account balance, and lightweight risk score;
- `Clinician`: clinician identity and specialty;
- `Visit`: scheduled appointment with patient, clinician, copay, priority, and lifecycle status;
- `CareTask`: follow-up work attached to a visit and owned by a clinician.

Supported compiler/runtime features exercised:

- required entity references from `Visit` to `Patient` and `Clinician`;
- required entity references from `CareTask` to `Visit` and `Clinician`;
- bounded decimal fields for balances, copays, risk scores, and effort estimates;
- enum-backed visit and task lifecycle transitions;
- multi-join query for upcoming visit worklists;
- aggregate query for clinician task load;
- aggregate query for visit status summaries;
- retryable visit check-in and completion transactions;
- retryable care task assignment and close transactions;
- durable outbox events and after-commit hooks.

Useful commands:

```powershell
npm run demo:clinic
node dist/cli.js check examples/clinic_reux.dl
node dist/cli.js transition-rules examples/clinic_reux.dl Visit.status
node dist/cli.js transition-rules examples/clinic_reux.dl CareTask.status
node dist/cli.js query-sql examples/clinic_reux.dl upcomingVisits
node dist/cli.js query-sql examples/clinic_reux.dl clinicianTaskLoad
node dist/cli.js query-sql examples/clinic_reux.dl visitStatusSummary
node dist/cli.js tx-sql examples/clinic_reux.dl checkInVisit
node dist/cli.js tx-sql examples/clinic_reux.dl completeVisit
node dist/cli.js tx-sql examples/clinic_reux.dl assignCareTask
node dist/cli.js tx-sql examples/clinic_reux.dl closeCareTask
node dist/cli.js seed-check examples/clinic_reux.dl examples/seeds/clinic_smoke.json
```

`npm run demo:clinic` is the fastest end-to-end walkthrough for the current clinic slice. It rebuilds the CLI, diagnoses the source, emits query and transaction SQL, emits generated TypeScript API/server/worker scaffolds, and validates the smoke seed without requiring a database.

The smoke seed in `examples/seeds/clinic_smoke.json` creates one patient, one clinician, one scheduled visit, and one open care task. It is intentionally small so it can serve as a focused fixture for relationship, transition, aggregate query, and transaction compiler coverage.
