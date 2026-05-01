# Reux Public Demo Testing Guide

This guide is for people trying the hosted Reux demo from the Reuben website. It explains what the demo is meant to show, what to test, and what successful behavior looks like.

## What The Demo Shows

The current demo is a public preview of Reux as a data-native workflow layer. It shows how Reux can model a domain, execute state-changing transactions, emit durable events, and expose queue/outbox behavior through a normal web application.

The demo currently includes:

- Commerce workflows for accounts, orders, payments, account credits, and durable events.
- Logistics workflows for dispatch-style operations.
- Isolated visitor sessions so public testers do not overwrite each other's demo state.
- Public reset controls that rebuild only the current visitor's session.
- In-page testing guidance for reset, transaction, and outbox verification.
- Queue/outbox processing that demonstrates how durable events move through the system.

## Recommended Test Flow

1. Open the Reux demo from the Reuben website.
2. Use the public reset control to create a fresh session.
3. Review the seeded commerce data.
4. Run a payment or account-credit transaction.
5. Refresh the data and confirm balances, payments, or orders changed as expected.
6. Process outbox events.
7. Confirm the queue health strip moves pending events down after processing.
8. Switch to the logistics demo.
9. Reset the logistics session.
10. Run a logistics transaction and confirm the visible state changes.

## Expected Results

The demo is behaving correctly when:

- Reset creates a fresh isolated session without requiring a private admin token.
- Transactions update the visible state.
- Refresh shows the latest PostgreSQL-backed data.
- Outbox events appear after transactions that emit durable events.
- Processing outbox events reduces pending queue counts and returns the queue health to `Clear`.
- Commerce and logistics sessions do not interfere with each other.
- Commerce and logistics queue health only counts the events for the active tab.
- Reloading the page keeps the same visitor session unless the browser storage is cleared.

## Release Smoke Check

After a hosted redeploy, maintainers can run:

```bash
npm run demo:healthcheck -- https://your-demo-host.example.com --smoke
```

That command tests the same public flow with the isolated `healthcheck` session: reset, transaction, queue health, outbox processing, and final clear state for both Commerce and Logistics.

For lightweight uptime watching, maintainers can also run:

```bash
npm run demo:monitor -- https://your-demo-host.example.com --deep
```

The monitor repeats the hosted health/deep check and exits nonzero after repeated failures.

## What Is Not Final Yet

The demo is not the finished Reux product experience. It is intentionally closer to a working technical preview than a polished customer app.

Known remaining polish areas:

- Hosted uptime monitoring.
- Richer public examples for simulations.
- More product-focused flows for PLOS and business simulation use cases.

## Useful Language For Public Testers

Reux is not replacing the whole web stack in this demo. The browser UI and hosting use normal web technology. Reux is being tested as the layer that owns data models, transactions, durable events, and simulation-oriented logic.

That separation is intentional. It lets the public demo stay understandable while the language matures underneath it.
