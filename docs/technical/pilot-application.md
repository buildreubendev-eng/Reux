# Pilot Application

The first Reux pilot source is `examples/pilot_reux.dl`.

It models a small accounts/orders/payments domain:

- `Account`: customer identity and balance;
- `Product`: sellable catalog item;
- `Order`: account-owned order with total and status;
- `Payment`: order payment lifecycle.

The pilot intentionally stays inside the currently supported compiler/runtime subset:

- one-base-entity queries with explicit joins;
- explicit joins over entity references;
- enum-backed status fields;
- validated transition rules for order and payment status fields;
- generated UUID identities;
- entity references;
- indexes;
- transaction insert with a bound result for generated IDs;
- bound insert references in later outbox payloads;
- transaction row locks and retryable conflict handling;
- durable outbox enqueue;
- after-commit hook reporting;
- embeddable outbox worker loop.
- generated TypeScript API clients for pilot queries and transaction functions.
- generated HTTP server scaffolds for exposing pilot queries and transaction functions.
- generated worker scaffolds for pilot outbox events and after-commit hooks.

Useful commands:

```powershell
npm run demo:pilot
npm run demo:pilot-app
npm run demo:pilot-worker
$env:REUX_CONFIG='pilot/dl.json'
node dist/cli.js project-check
node dist/cli.js project-doctor
node dist/cli.js project-transition-rules
node dist/cli.js project-transition-rules Payment.status
node dist/cli.js project-sql
node dist/cli.js project-query-sql openOrders
node dist/cli.js project-query-sql accountBalances
node dist/cli.js project-query-sql accountOrders
node dist/cli.js project-query-sql orderPayments
node dist/cli.js project-query-sql accountOrderSummary
node dist/cli.js project-api-ts ./runtime.js
node dist/cli.js project-api-server-ts ./api.js ./config.js ./runtime.js
node dist/cli.js project-worker-ts ./config.js ./runtime.js
node dist/cli.js project-tx-sql capturePayment
node dist/cli.js project-tx-sql markOrderPaid
node dist/cli.js project-tx-sql creditAccount
node dist/cli.js project-seed-check pilot/seeds/smoke.json
node dist/cli.js project-seed-dry-run pilot/seeds/smoke.json
node dist/cli.js project-seed-run pilot/seeds/smoke.json
node dist/cli.js project-seed-delete pilot/seeds/smoke.json
node dist/cli.js project-seed-reset pilot/seeds/smoke.json
```

The pilot is activated through `pilot/dl.json`, `pilot/.dl/schema-manifest.json`, and `pilot/migrations/`. Keeping those separate lets the root `dl.json` and root `migrations/` continue to drive the commerce fixtures while the completed Phase 6 pilot remains available as an independent application slice.

## Browser Demo App

`demo/pilot-app` is the first end-to-end app built on the pilot. It serves a small browser console at `http://127.0.0.1:4173` and uses the Reux compiler/runtime artifacts directly. The console now has Commerce and Logistics tabs; pass `?domain=logistics` to open the logistics tab directly.

- `Apply Schema + Reset Seed` applies the active domain schema and refreshes its seed fixture;
- the dashboard panels run the pilot queries (`accountOrders`, `accountBalances`, `orderPayments`, `accountOrderSummary`, and `openOrders`);
- the transaction buttons run `capturePayment`, `markOrderPaid`, and `creditAccount` against PostgreSQL;
- the logistics tab runs `activeShipments`, `driverManifest`, `shipmentStatusSummary`, `startShipment`, `markDelivered`, and `creditDriver`;
- outbox rows are read from `_dl_outbox` so transaction side effects are visible immediately;
- `Process Outbox` runs the embeddable outbox processor with demo handlers and marks pending events as processed.

Run it after setting the same PostgreSQL connection used by the integration tests:

```powershell
$env:DATABASE_URL='postgres://datalang:datalang@localhost:5432/datalang_dev'
npm run demo:pilot-app
```

The app keeps its objects in a dedicated PostgreSQL schema named `reux_demo` by default, so it can coexist with the root commerce fixtures in the same database. Override that with `REUX_DEMO_SCHEMA` when you need a different local schema. Public deployments should set `REUX_DEMO_SETUP_TOKEN` so reset/setup requires an admin token. The app intentionally stays dependency-light: the server uses Node's built-in HTTP module, static browser files, and the built Reux runtime in `dist/`.

## Demo Outbox Worker

`scripts/demo-pilot-worker.mjs` is a deployable worker-style process for the pilot outbox. It uses the same pilot config and event names as the browser demo, processes pending `_dl_outbox` rows, and logs handled `AccountCredited`, `OrderPaid`, and `PaymentCaptured` events.

Run it against the demo schema:

```powershell
$env:DATABASE_URL='postgres://datalang:datalang@localhost:5432/datalang_dev'
$env:REUX_DEMO_SCHEMA='reux_demo'
npm run demo:pilot-worker
```

Useful worker controls:

```powershell
$env:REUX_WORKER_INTERVAL_MS='1000'
$env:REUX_WORKER_LIMIT='10'
$env:REUX_WORKER_MAX_ITERATIONS='1'
$env:REUX_WORKER_REQUEUE_STALE_SECONDS='300'
```

## Transition Rules

The pilot declares compiler-visible state transitions for the two lifecycle fields:

```dl
transition Order.status {
  Pending -> Paid
  Pending -> Cancelled
  Paid -> Refunded
}

transition Payment.status {
  Authorized -> Captured
  Authorized -> Failed
  Captured -> Refunded
}
```

These rules are validated against `OrderStatus` and `PaymentStatus` and emitted in Schema IR/manifests. Literal enum assignments over loaded entity state use the rules as runtime guards.

`markOrderPaid` demonstrates a guarded transition:

```dl
transaction function markOrderPaid(orderRef: Order) writes Order retry 3 {
  let order = load orderRef for update
  order.status = Paid
  save order
  enqueue OrderPaid { order: orderRef }
  after commit notifyOrderPaid(orderRef)
}
```

The generated `UPDATE` only succeeds when the current status is a declared predecessor of `Paid`, currently `Pending`.

## Transaction Conflict Slice

`capturePayment` demonstrates a transaction-local generated ID flowing into durable outbox coordination:

```dl
transaction function capturePayment(orderRef: Order, amount: Decimal<12,2>) writes Payment retry 3 {
  let order = load orderRef for update
  let payment = insert Payment { order: orderRef, amount: amount, currency: order.currency, status: Captured }
  enqueue PaymentCaptured { payment: payment.id, order: orderRef, amount: amount, currency: order.currency }
  after commit sendReceipt(orderRef)
}
```

The generated SQL binds the inserted `Payment` row and resolves `payment.id` when building the `PaymentCaptured` payload.

`creditAccount` is the current pilot transaction for retryable write conflicts:

```dl
transaction function creditAccount(accountRef: Account, amount: Decimal<12,2>) writes Account retry 3 {
  let account = load accountRef for update
  account.balance += amount
  save account
  enqueue AccountCredited { account: accountRef, amount: amount }
  after commit notifyAccountCredited(accountRef)
}
```

It lowers to a `SELECT ... FOR UPDATE`, an `UPDATE accounts SET balance = balance + $2`, and an outbox insert inside the same transaction. At runtime, PostgreSQL serialization conflicts and deadlocks are retried up to the declared `retry 3` attempt budget.

## Migration Evolution

Phase 6 migration evolution is exercised by keeping the root commerce source and migrations stable while the pilot source evolves independently. The root `dl.json` still points at `examples/commerce_v2.dl`, so existing applied migration hashes remain valid in the local WSL PostgreSQL database.

For pilot schema evolution planning, generate a manifest from the current pilot source and compare future pilot revisions against it:

```powershell
$env:REUX_CONFIG='pilot/dl.json'
node dist/cli.js project-manifest-write
node dist/cli.js migrate-plan pilot/.dl/schema-manifest.json examples/pilot_reux_next.dl
```

Do not place pilot migration files into the checked-in root `migrations/` directory until the root `dl.json` is intentionally switched to the pilot source.

## Production-Like Check

The local production-like path for Phase 6 uses PostgreSQL running in WSL and the same CLI/runtime code used by project commands:

```powershell
$env:DATABASE_URL='postgres://datalang:datalang@localhost:5432/datalang_dev'
npm run build
npm run test:postgres
npm run test:pilot:postgres
$env:REUX_CONFIG='pilot/dl.json'
node dist/cli.js project-doctor
node dist/cli.js project-query-sql accountOrders
node dist/cli.js project-tx-sql creditAccount
node dist/cli.js project-seed-check pilot/seeds/smoke.json
```

`test:pilot:postgres` creates a temporary PostgreSQL schema, applies the pilot migrations, seeds accounts/orders/payments data, runs the join and aggregation queries, runs `capturePayment`, `markOrderPaid`, and `creditAccount`, then drops the temporary schema. This verifies the pilot without requiring Docker Desktop and without colliding with the root commerce fixtures.

## Pilot Seed

`pilot/seeds/smoke.json` is the first reusable pilot fixture. It inserts:

- one account aliased as `ada`;
- one product aliased as `starterKit`;
- one order aliased as `adaOrder`;
- one payment aliased as `adaPayment`.

The seed uses stable UUIDs, `mode: "upsert"` with `by: ["id"]`, and `reset: "truncate"` for local/demo refreshes. It can be run repeatedly during local development. The order references `$ada`, and the payment references `$adaOrder`, so the seed can also run on a fresh database without manually copying UUIDs.

Use `project-seed-check pilot/seeds/smoke.json` before applying the seed when editing fixtures. It validates the fixture against the pilot schema without opening a database connection, including entity names, fields, enum values, conflict keys, and alias order.

Use `project-seed-dry-run pilot/seeds/smoke.json` to run the fixture against PostgreSQL and roll it back, which catches database-level constraint issues without leaving rows behind.

Use `project-seed-delete pilot/seeds/smoke.json` to remove the fixture rows. Deletes run in reverse seed order, so `Payment` is removed before `Order`, and `Order` before `Account`. Use `project-seed-reset pilot/seeds/smoke.json` to truncate the fixture tables and reapply the fixture in one local development transaction.

The pilot models money-like values as `Decimal<12,2>`, which compiles to PostgreSQL `numeric(12, 2)` and remains `number | string` in generated TypeScript APIs. Product prices, order totals, and payment amounts also carry a `CurrencyCode` field with a default `USD` value; Reux lowers this to `char(3)` with an uppercase three-letter check constraint. `capturePayment` locks the order and copies `order.currency` into the inserted payment and outbox payload, so captured payments inherit the order currency.

Likely next language/runtime needs exposed by this pilot:

- cross-entity currency consistency checks for multi-currency orders and payments;
