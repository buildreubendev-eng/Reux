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
- transaction insert;
- transaction row locks and retryable conflict handling;
- durable outbox enqueue;
- after-commit hook reporting.

Useful commands:

```powershell
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

`creditAccount` is the current pilot transaction for retryable write conflicts:

```dl
transaction function creditAccount(accountRef: Account, amount: Decimal) writes Account retry 3 {
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

The seed uses stable UUIDs and `mode: "upsert"` with `by: ["id"]`, so it can be run repeatedly during local development. The order references `$ada`, and the payment references `$adaOrder`, so the seed can also run on a fresh database without manually copying UUIDs.

Use `project-seed-check pilot/seeds/smoke.json` before applying the seed when editing fixtures. It validates the fixture against the pilot schema without opening a database connection, including entity names, fields, enum values, conflict keys, and alias order.

Use `project-seed-dry-run pilot/seeds/smoke.json` to run the fixture against PostgreSQL and roll it back, which catches database-level constraint issues without leaving rows behind.

Use `project-seed-delete pilot/seeds/smoke.json` to remove the fixture rows. Deletes run in reverse seed order, so `Payment` is removed before `Order`, and `Order` before `Account`. Use `project-seed-reset pilot/seeds/smoke.json` to delete and reapply the fixture in one local development transaction.

Likely next language/runtime needs exposed by this pilot:

- typed money/currency conventions;
- transaction-local generated IDs;
- richer insert result binding;
- broader transition checking for parameterized assignments;
- richer seed reset modes for truncating or refreshing whole fixture groups.
