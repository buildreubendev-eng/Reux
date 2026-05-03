# Reux Public Roadmap

Reux is a data-native language for applications that need reliable workflows, auditable state changes, and simulation-driven decision logic. The current prototype already powers a hosted commerce and logistics demo while the simulation, tooling, and product layers continue to mature. The first sellable wedge is the Business Simulator: a guided operational scenario-planning product powered by Reux.

Current status:

- Demo readiness: roughly 100%.
- Full platform completion: roughly 100%.
- Public demo scope: commerce workflows, logistics workflows, Business Simulator workflows, isolated visitor sessions, PostgreSQL-backed saved simulation runs, saved-run health checks, stable public error envelopes, public API rate limiting, request counters, maintenance cleanup tooling, transaction execution, PostgreSQL-backed state, queue/outbox processing, and health checks.
- Core language scope: schema declarations, reusable typed queries, guarded transaction functions, durable events, conservative migrations, generated TypeScript integration, and early simulation declarations.

## What Is Live Now

- Public browser demo for commerce workflows.
- Public browser demo for logistics workflows.
- Public Business Simulator demo with PostgreSQL-backed saved run records for result pages and sharing.
- Business Simulator operations-decision, capacity-planning, staffing-plan, and pricing-strategy templates for product pilots.
- Business Simulator buyer-facing recommendation guidance with action, confidence, and watchout fields.
- Business Simulator error envelopes for validation, expired saved runs, missing records, oversized requests, malformed JSON, and rate limits.
- Business Simulator first-wedge product brief for buyer, offer, and pilot positioning.
- Separate Business Simulator frontend and backend roadmaps for sellable-product execution.
- Public API rate limiting and request counters for hosted demo protection.
- Dry-run/apply maintenance cleanup for visitor schemas and saved simulation runs.
- Hosted deep health checks for saved-run creation, reload, listing, missing-run handling, and frontend-ready result metadata.
- Clinic pilot source and walkthrough for appointment and care-task workflows.
- In-page public testing guide and clearer empty states for first-time visitors.
- Hosted Railway backend connected to PostgreSQL.
- Reuben website embed/link for public testing.
- Reux compiler checks for schema, query, transaction, migration, seed, and simulation files.
- VS Code diagnostic targeting for declaration and field-level compiler errors.
- Generated TypeScript client/server/worker scaffolds.
- Public capabilities manifest for website, CLI, and release-check alignment.
- Release preflight checks for package entrypoints, release docs, roadmap sync, and clean-tree readiness.
- Public release plan and package dry-run command.
- Migration rollback SQL for safe reversible schema changes.
- Outbox queue processing with retry, dead-letter, stale-claim recovery, domain-scoped queue health, queue stats, and worker observability counters.
- Hosted smoke checks that validate public reset, transactions, queue health, and outbox processing for both demo domains.
- Hosted demo monitor for continuous or cron-style health checks with optional webhook alerts.
- Hosted operations dashboard for cross-domain queue and worker health.
- CI smoke automation that boots the demo server against PostgreSQL and runs the same public smoke path on every push.
- Early simulation syntax for PLOS and business-simulation research.
- Deterministic simulation change reporting and non-finite formula rejection.
- Advisory simulation domain-pack coverage for PLOS and business models, including suggested assumptions, metrics, scenarios, and objectives.
- Executable PLOS habit-consistency example alongside the personal-finance example.
- Executable business operations simulation example alongside the workforce example.
- Generated simulation catalog helpers so product apps can discover available Reux simulation models.
- Language-core completion pass for transaction control flow, expression typing, reusable filters, worker contracts, null-aware lowering, and diagnostics.
- Functionally complete Commerce, Logistics, and Operations demo frontend.

## Next Milestones

### 1. Sellable Business Simulator Frontend

Goal: finish the buyer-facing Business Simulator product UI now that the demo console is functionally complete.

Planned work:

- Expose template selection for operations-decision, capacity-planning, staffing-plan, and pricing-strategy.
- Build the guided assumption and scenario run flow for non-developer buyers.
- Render decisionSummary, recommendedAction, confidenceSummary, watchouts, and keyMetric as first-class result content.
- Add saved-result list, shareable result loading, expired-result, and not-found states.
- Add pilot CTA and product positioning from the Business Simulator product brief.
- Run responsive visual QA on the Business Simulator product path.

### 2. Commercialization Wedge

Goal: turn Business Simulator into the first sellable Reux-powered product.

Planned work:

- Package Business Simulator as the first sellable wedge around operational scenario planning.
- Keep completion focused on result creation, saved runs, shareable summaries, and clear recommendations.
- Define buyer, user, early-adopter signal, and pilot qualification notes.
- Add simple pilot offer and CTA copy for website and sales handoff.

### 3. Website & Status Sync

Goal: keep public project cards, roadmap badges, live/demo links, and completed/in-progress labels current.

Planned work:

- Never complete sellable-product frontend work without updating the status surfaces that describe it.
- Keep demo-console completion marked as live unless a concrete regression is found.
- Update Business Simulator completion/status labels as the product UI lands.
- Keep docs/public/business-simulator-frontend-roadmap.md aligned with the actual frontend.

### 4. Documentation Handoff

Goal: keep docs aligned with the actual demo.

Planned work:

- Update public testing docs and screenshots/copy references if demo UI changes.
- Update Business Simulator product docs when sellable-product UI changes.
- Keep docs/public/reux-demo-testing-guide.md aligned with the actual demo.

### 5. Simulation Foundation

Goal: make Reux useful for structured forecasting and scenario comparison.

Planned work:

- Expand simulation domain packs for PLOS and business operations.
- Add richer time-series and assumption modeling.
- Add stronger unit and formula validation.
- Improve comparison reports and explanation output.
- Expand simulation APIs from generated catalog discovery into full product-facing execution services.

### 6. Product Ecosystem

Goal: keep Reux grounded in real products instead of building language features in isolation.

Planned work:

- Build PLOS as a personal simulation product using normal web technology first.
- Build the real-time business simulation engine as an enterprise product prototype.
- Use Reux underneath both products as the rule, workflow, and simulation layer as it matures.
- Use clinic, logistics, and future product pilots to keep language features grounded in real workflows.
- Add deeper product pilots for PLOS and enterprise operations once the core language/runtime path is stable.

### 7. Developer Experience

Goal: make Reux approachable for technical reviewers and early users.

Planned work:

- Improve editor completions, definitions, and diagnostics.
- Publish clearer examples and tutorials.
- Execute the public package-name decision and publish when the owning account is ready.
- Add concise getting-started flows for local development and hosted demos.

## Long-Term Direction

Reux is not trying to replace every part of a web stack immediately. The near-term strategy is to use established web technology for the application shell while Reux owns the parts where it can become meaningfully different:

- Data models.
- Queries.
- Transactions.
- Events.
- Migrations.
- Simulation declarations.
- Decision logic that needs to be auditable and explainable.

The long-term vision is an ecosystem where Reuben presents the work publicly, Reux provides the language/runtime layer, PLOS validates personal simulation use cases, and the business simulation engine validates enterprise decision-making use cases.
