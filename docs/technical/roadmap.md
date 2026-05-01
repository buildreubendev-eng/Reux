# Reux Roadmap

This roadmap describes the current prototype in practical terms: what is usable now, what needs hardening before a public pilot, and what belongs to later language/runtime phases.

## Current Baseline

Reux is currently a data-native language prototype that compiles a focused schema/query/transaction subset to PostgreSQL and TypeScript integration points.

Implemented today:

- Schema declarations for modules, entities, enums, typed events, indexes, checks, generated IDs, references, transition rules, bounded decimals, and currency codes.
- Query declarations with explicit joins, left joins, reusable filter fragments, compound predicates, cursor pagination, inferred record result types, ordering, limits, record projections, and a narrow aggregation subset.
- Transaction functions with row locking, mutations, inserts, retry metadata, idempotency keys, require guards, transition guards, typed durable outbox events, and after-commit hooks.
- Simulation declarations with domain dimensions, advisory PLOS/business domain pack reports with coverage scoring, static assumptions, lightweight unit-compatibility checks, formulas, maximize/minimize objectives, shared and scenario-specific time-varying changes, scenarios, forecast windows, Simulation IR, period-level comparison reports, objective-aware metric rankings, explanation summaries, generated TypeScript contracts, typed comparison helpers, and prototype formula forecast runners for finance, habits, and workforce examples.
- PostgreSQL runtime helpers for migrations, compiled queries, transaction execution, seed resets, and outbox processing with delayed retries, dead-lettering, stale-claim recovery, status summaries, and worker observability counters.
- CLI workflows for checking, diagnosis, migration planning, migration safety checks, migration review/rollback guidance, SQL inspection, API generation, worker generation, and seed validation.
- A hosted commerce and logistics pilot demo with isolated public sessions and public reset flow.
- Logistics and clinic pilot sources showing the same language subset applied outside commerce.

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
| Clinic pilot source | Complete | `examples/clinic_reux.dl` validates that Reux can model appointment and care-task workflows. |
| Clinic executable walkthrough | Complete | `npm run demo:clinic` shows diagnostics, SQL, generated scaffolds, and seed validation without a database. |
| Production monitoring | Started | Hosted health exists, `npm run demo:healthcheck -- <url>` validates the public service, `npm run demo:healthcheck -- <url> --deep` validates queue stats endpoints, `npm run demo:healthcheck -- <url> --smoke` validates public reset/transaction/outbox behavior in an isolated session, `npm run demo:monitor -- <url> --deep` provides repeatable uptime watching with optional JSON webhook alerts, `npm run verify:demo:smoke` boots the compiled demo server against PostgreSQL in CI, the public dashboard shows domain-scoped queue health, the public UI now includes tester guidance and clearer empty states, `outbox-stats` and demo API queue endpoints summarize queue health, and worker logs expose retry/dead-letter/stale-requeue counters. DB maintenance is still manual. |

## Full-Completion Priorities

The next big engineering work should move in this order.

1. Transaction language depth: complete for the prototype with stronger expression validation, durable idempotency keys, explicit abort lowering, validated after-commit hook arguments, typed event payloads, require guards that reject unknown references before SQL lowering, and typed generated worker contracts; future work is richer multi-step control flow and deeper expression typing.
2. Simulation language foundation: complete for the prototype with static `simulate` declarations, named domain dimensions, advisory PLOS/business domain pack reports with coverage scoring and scenario/objective guidance, arithmetic formulas, lightweight unit-compatibility checks, shared scheduled changes, scenario-specific timelines, deterministic applied-change reporting, non-finite formula rejection, scenario overrides, maximize/minimize objectives, first-divergence reporting, period-level deltas, objective-aware metric rankings, explanation summaries, generated TypeScript contracts, typed comparison helpers, generated simulation catalog helpers for product apps, executable PLOS finance/habit examples, an executable business operations example, and a prototype runner; future work is richer domain packs and product execution APIs.
3. Production worker semantics: complete for the prototype with delayed retries, max-attempt dead-lettering, generated worker controls, stale claim recovery, queue status summaries, per-iteration worker observability counters, hosted demo operations dashboard, and operational docs; future work is richer handler-level traces.
4. Migration authoring workflow: complete for the prototype with generated review notes, rollback notes, synthesized rollback SQL for safe reversible operations, deployment checklists, environment-specific safety gates, and pre-create diff safety checks; future work is multi-schema deployment stories.
5. Project packaging: complete for the prototype with typed package entrypoints, packaged docs/examples/editor assets, tarball guidance, versioning notes, release preflight checks, package dry-run command, public release plan, and cross-repo upgrade guidance.
6. Editor tooling: complete for the prototype with CLI formatting, a local VS Code grammar, CLI-backed line-aware diagnostics, heuristic symbol/field diagnostic targeting, CLI-backed document formatting, lightweight completions, query-alias field completions, insert/enqueue object-field completions, hover text, and current-file go-to-definition for `.dl` and `.reux` files; future work is compiler-backed semantic completion, cross-file navigation, rename, and a proper language-server process.
7. Additional pilots: complete for this prototype with logistics and clinic domains validating Reux beyond commerce; future work is deeper product-specific pilots for PLOS and enterprise operations.
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

- Demo readiness: roughly 99%. The commerce and logistics demos are public-UI ready, have health, deep, hosted, and CI-backed end-to-end smoke checks, expose session-scoped queue health endpoints, show domain-scoped queue health in the public dashboard, include in-page tester guidance and clearer empty states, include optional monitor webhook alerts, and now produce useful worker retry/dead-letter/stale-requeue logs; the remaining demo gap is mainly DB maintenance and production operations polish.
- Full completion: roughly 100%. The prototype foundation is complete: query expressiveness has moved forward, transaction functions have the first serious safety layer, outbox workers have delayed retry, dead-letter protection, stale-claim recovery, and observability counters, migration tooling has review/rollback guidance, synthesized rollback SQL for safe reversible operations, and production gates, package distribution has typed entrypoints, tarball guidance, release preflight checks, package dry-run support, and a public release plan, editor tooling has formatting, syntax highlighting, CLI-backed line-aware diagnostics, heuristic diagnostic targeting, VS Code format integration, query/transaction/object-field completions, hover text, and current-file definition jumps, hosted and CI demo validation now covers public reset/transaction/queue/outbox behavior with a reusable monitor and operations dashboard, the public demo explains its tester flow in-product, and Reux has simulation syntax with domain dimensions, advisory PLOS/business domain pack reports with coverage scoring and scenario/objective guidance, formulas, unit-compatibility checks, deterministic scheduled changes, declared objectives, period-level scenario comparison, objective-aware metric rankings, explanation summaries, generated simulation contracts, typed comparison helpers, generated simulation catalog helpers, and executable PLOS finance/habit plus business workforce/operations examples. Remaining work is now future product/language expansion rather than completion of this prototype bar.

Use [Phase status](phase-status.md) for implementation-by-phase details, [Ecosystem architecture](ecosystem-architecture.md) for the Reuben/Reux/PLOS/business simulation boundary, and [Pilot demo deployment](demo-deployment.md) for hosted demo operations.
