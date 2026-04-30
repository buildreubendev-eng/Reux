# Reux Roadmap

This roadmap describes the current prototype in practical terms: what is usable now, what needs hardening before a public pilot, and what belongs to later language/runtime phases.

## Current Baseline

Reux is currently a data-native language prototype that compiles a focused schema/query/transaction subset to PostgreSQL and TypeScript integration points.

Implemented today:

- Schema declarations for modules, entities, enums, typed events, indexes, checks, generated IDs, references, transition rules, bounded decimals, and currency codes.
- Query declarations with explicit joins, left joins, reusable filter fragments, compound predicates, cursor pagination, inferred record result types, ordering, limits, record projections, and a narrow aggregation subset.
- Transaction functions with row locking, mutations, inserts, retry metadata, idempotency keys, require guards, transition guards, typed durable outbox events, and after-commit hooks.
- Simulation declarations with static assumptions, lightweight unit-compatibility checks, formulas, maximize/minimize objectives, shared and scenario-specific time-varying changes, scenarios, forecast windows, Simulation IR, period-level comparison reports, objective-aware metric rankings, explanation summaries, generated TypeScript contracts, typed comparison helpers, and a prototype formula forecast runner.
- PostgreSQL runtime helpers for migrations, compiled queries, transaction execution, seed resets, and outbox processing with delayed retries and dead-lettering.
- CLI workflows for checking, diagnosis, migration planning, migration safety checks, migration review/rollback guidance, SQL inspection, API generation, worker generation, and seed validation.
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

1. Transaction language depth: first slice complete with stronger expression validation, durable idempotency keys, typed event payloads, require guards that reject unknown references before SQL lowering, and typed generated worker contracts; remaining work is richer multi-step control flow and deeper expression typing.
2. Simulation language foundation: first slices complete with static `simulate` declarations, arithmetic formulas, lightweight unit-compatibility checks, shared scheduled changes, scenario-specific timelines, scenario overrides, maximize/minimize objectives, first-divergence reporting, period-level deltas, objective-aware metric rankings, explanation summaries, generated TypeScript contracts, typed comparison helpers, and a prototype runner; remaining work is named domain dimensions and production-grade simulation semantics.
3. Production worker semantics: first slice complete with delayed retries, max-attempt dead-lettering, generated worker controls, stale claim recovery, and operational docs; remaining work is richer handler observability and hosted worker dashboards.
4. Migration authoring workflow: first slice complete with generated review notes, rollback notes, deployment checklists, environment-specific safety gates, and pre-create diff safety checks; remaining work is richer rollback SQL synthesis and multi-schema deployment stories.
5. Project packaging: first slice complete with typed package entrypoints, packaged docs/examples/editor assets, tarball guidance, and versioning notes; remaining work is public package naming, publishing, and cross-repo upgrade automation.
6. Editor tooling: first slice complete with CLI formatting and a local VS Code grammar for `.dl` and `.reux` files; remaining work is language-server diagnostics, go-to-definition, completion, and editor-native formatting.
7. Additional pilots: add one more non-commerce domain to keep the language honest after commerce and logistics.
8. Query expressiveness follow-through: broaden expression typing beyond simple projections, add reusable join fragments, support multi-column cursors, and deepen aggregate semantics.

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
- Full completion: roughly 78%. The foundation is real, query expressiveness has moved forward, transaction functions now have the first serious safety layer, outbox workers have delayed retry and dead-letter protection, migration tooling has review/rollback guidance and production gates, package distribution has typed entrypoints and tarball guidance, editor tooling has formatting and first syntax highlighting, and Reux has its first simulation syntax with formulas, unit-compatibility checks, shared scheduled changes, scenario-specific timelines, declared objectives, period-level scenario comparison, objective-aware metric rankings, explanation summaries, generated simulation contracts, and typed comparison helpers. The largest remaining gaps are language-server quality, public publishing, richer control flow, deeper expression typing, named domain dimensions, production-grade simulation semantics, richer worker observability, and deeper rollback SQL synthesis.

Use [Phase status](phase-status.md) for implementation-by-phase details, [Ecosystem architecture](ecosystem-architecture.md) for the Reuben/Reux/PLOS/business simulation boundary, and [Pilot demo deployment](demo-deployment.md) for hosted demo operations.
