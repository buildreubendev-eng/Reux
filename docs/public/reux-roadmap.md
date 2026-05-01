# Reux Public Roadmap

Reux is a data-native language for applications that need reliable workflows, auditable state changes, and simulation-driven decision logic. The current prototype already powers a hosted commerce and logistics demo while the deeper language, tooling, and simulation layers continue to mature.

Current status:

- Demo readiness: roughly 95%.
- Full platform completion: roughly 86%.
- Public demo scope: commerce workflows, logistics workflows, isolated visitor sessions, transaction execution, PostgreSQL-backed state, queue/outbox processing, and health checks.
- Core language scope: schema declarations, typed queries, transaction functions, durable events, conservative migrations, generated TypeScript integration, and early simulation declarations.

## What Is Live Now

- Public browser demo for commerce workflows.
- Public browser demo for logistics workflows.
- Hosted Railway backend connected to PostgreSQL.
- Reuben website embed/link for public testing.
- Reux compiler checks for schema, query, transaction, migration, seed, and simulation files.
- Generated TypeScript client/server/worker scaffolds.
- Outbox queue processing with retry, dead-letter, stale-claim recovery, queue stats, and worker observability counters.
- Early simulation syntax for PLOS and business-simulation research.

## Next Milestones

### 1. Demo Hardening

Goal: make the public demo feel stable, explainable, and safe for repeat visitors.

Planned work:

- Improve public demo copy and empty states.
- Add clearer visible status for queue/outbox processing.
- Add uptime and post-deploy monitoring.
- Add richer hosted health checks for demo regressions.
- Document the public reset/session behavior for testers.

### 2. Reux Language Depth

Goal: turn the current useful subset into a stronger application language foundation.

Planned work:

- Broaden transaction control flow.
- Deepen expression typing.
- Improve generated worker contracts.
- Expand reusable query patterns.
- Continue tightening compiler diagnostics and safety checks.

### 3. Simulation Foundation

Goal: make Reux useful for structured forecasting and scenario comparison.

Planned work:

- Expand simulation domain packs for PLOS and business operations.
- Add richer time-series and assumption modeling.
- Add stronger unit and formula validation.
- Improve comparison reports and explanation output.
- Prepare simulation APIs that product apps can call directly.

### 4. Product Ecosystem

Goal: keep Reux grounded in real products instead of building language features in isolation.

Planned work:

- Build PLOS as a personal simulation product using normal web technology first.
- Build the real-time business simulation engine as an enterprise product prototype.
- Use Reux underneath both products as the rule, workflow, and simulation layer as it matures.
- Add more non-commerce pilots to prove the language outside a single domain.

### 5. Developer Experience

Goal: make Reux approachable for technical reviewers and early users.

Planned work:

- Improve editor completions, definitions, and diagnostics.
- Publish clearer examples and tutorials.
- Prepare package distribution and installation docs.
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
