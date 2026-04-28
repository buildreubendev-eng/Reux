# Logistics Pilot

`examples/logistics_reux.dl` is the second non-commerce Reux pilot slice. It models dispatch operations with drivers, vehicles, shipments, lifecycle transitions, outbox events, and payout-style transactions.

The slice demonstrates that Reux is useful for durable operational workflows beyond accounts/orders/payments:

- `Driver`: dispatcher-facing worker identity and payout balance;
- `Vehicle`: truck identity and capacity;
- `Shipment`: assigned delivery with tracking number, destination, weight, and lifecycle status.

Supported compiler/runtime features exercised:

- required entity references from `Shipment` to `Driver` and `Vehicle`;
- unique fields and indexes for lookup paths;
- bounded decimal fields for weights, capacities, and payouts;
- enum-backed shipment lifecycle transitions;
- join query for driver manifests;
- aggregate query for status summaries;
- transaction state transitions for starting and delivering shipments;
- retryable driver payout credit;
- durable outbox events and after-commit hooks.

Useful commands:

```powershell
node dist/cli.js check examples/logistics_reux.dl
node dist/cli.js query-sql examples/logistics_reux.dl activeShipments
node dist/cli.js query-sql examples/logistics_reux.dl driverManifest
node dist/cli.js query-sql examples/logistics_reux.dl shipmentStatusSummary
node dist/cli.js tx-sql examples/logistics_reux.dl startShipment
node dist/cli.js tx-sql examples/logistics_reux.dl markDelivered
node dist/cli.js tx-sql examples/logistics_reux.dl creditDriver
node dist/cli.js seed-check examples/logistics_reux.dl examples/seeds/logistics_smoke.json
```

The smoke seed in `examples/seeds/logistics_smoke.json` creates one driver, one vehicle, and one scheduled shipment. It is intentionally small so it can serve as a focused fixture for query, transition, and transaction compiler coverage.
