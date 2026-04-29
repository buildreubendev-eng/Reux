# Reux Roadmap

This roadmap describes the current prototype in practical terms: what is usable now, what needs hardening before a public pilot, and what belongs to later language/runtime phases.

## Current Baseline

Reux is currently a data-native language prototype that compiles a focused schema/query/transaction subset to PostgreSQL and TypeScript integration points.

Implemented today:

- Schema declarations for modules, entities, enums, indexes, checks, generated IDs, references, transition rules, bounded decimals, and currency codes.
- Query declarations with explicit joins, predicates, ordering, limits, record projections, and a narrow aggregation subset.
- Transaction functions with row locking, mutations, inserts, retry metadata, transition guards, durable outbox events, and after-commit hooks.
- PostgreSQL runtime helpers for migrations, compiled queries, transaction execution, seed resets, and outbox processing.
- CLI workflows for checking, diagnosis, migration planning, migration safety checks, SQL inspection, API generation, worker generation, and seed validation.
- A hosted commerce and logistics pilot demo with isolated public sessions and public reset flow.
- A logistics pilot source showing the same language subset applied outside commerce.

## Demo-Ready Milestones

These are the milestones that make the prototype usable by public testers and early technical reviewers.

| Milestone | Status | Notes |
| --- | --- | --- |
| Commerce browser demo | Complete | Public users can reset their own isolated session, run transactions, and process outbox events. |
| Logistics browser demo | Complete | Public users can switch to Logistics, reset a session, run dispatch transactions, and process logistics outbox events. |
| Hosted demo deployment | Complete | Railway web service is live with PostgreSQL-backed state and isolated visitor schemas. |
| Website embed/link | Complete | The Reuben website exposes the live Reux demo and links to the project. |
| Session isolation tests | Complete | Fast unit coverage now protects browser session ID normalization and schema derivation. |
| Logistics pilot source | Complete | `examples/logistics_reux.dl` validates that Reux can model dispatch workflows. |
| Logistics executable walkthrough | Complete | `npm run demo:logistics` shows diagnostics, SQL, generated scaffolds, and seed validation without a database. |
| Production monitoring | Not started | Hosted health exists, but logs, alerting, uptime tracking, and DB maintenance are still manual. |

## Full-Completion Priorities

The next big engineering work should move in this order.

1. Query expressiveness: add richer boolean expressions, reusable query fragments, safer pagination, nullable join behavior, and stronger result-shape inference.
2. Transaction language depth: support broader control flow, richer validation, explicit idempotency patterns, stronger event payload typing, and better generated handler contracts.
3. Production worker semantics: add dead-letter queues, retry/backoff configuration, handler observability, poison-message protection, and clear operational docs.
4. Migration authoring workflow: improve generated migration review, environment-specific safety gates, rollback guidance, and multi-schema deployment stories.
5. Project packaging: define how a Reux project should be published, versioned, consumed, and upgraded across application repos.
6. Editor tooling: add syntax highlighting, language-server diagnostics, go-to-definition, and formatted output for `.dl` files.
7. Additional pilots: add one more non-commerce domain to keep the language honest after commerce and logistics.

## Deliberately Out Of Scope For Now

The prototype should not try to become a complete general-purpose language yet. These items are future research tracks, not current blockers:

- A custom database engine.
- A distributed runtime.
- A full standard library.
- General-purpose application syntax unrelated to the data layer.
- A package ecosystem.
- A graphical modeling tool.

## Completion Read

As of this document:

- Demo readiness: roughly 90%. The commerce and logistics demos are public-UI ready; the remaining demo gap is mainly polish, monitoring, and hosted redeployment validation.
- Full completion: roughly 45%. The foundation is real, but the language still needs broader query and transaction semantics, stronger operations, editor tooling, and packaging before it feels complete.

Use [Phase status](phase-status.md) for implementation-by-phase details and [Pilot demo deployment](demo-deployment.md) for hosted demo operations.
