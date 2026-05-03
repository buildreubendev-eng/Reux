# Business Simulator Backend Roadmap

This roadmap is for Codex/backend work. Keep changes focused on Reux-owned backend, API, runtime, validation, saved-result, and documentation surfaces that make Business Simulator sellable.

## Goal

Make the backend feel dependable enough for guided pilots: stable simulation APIs, explainable recommendation payloads, saved/shareable runs, safe validation, operational health, and enough product scaffolding for the frontend to move without backend guesswork.

## Definition Of Sellable

- The public API contract is stable enough for frontend and website work.
- A failed request returns field-level validation issues that can be shown directly in the UI.
- Saved runs have clear metadata for result pages, sharing, expiry, and recent-run lists.
- Recommendations explain why a scenario won, not only which scenario won.
- Health, smoke, rate-limit, and maintenance tooling catch demo-breaking regressions before a buyer sees them.

## P0 Backend Completion Path

1. Recommendation payloads
   - Ensure Business Simulator responses include winner, metric deltas, risk/tradeoff signals, and plain-language rationale.
   - Add stable summary fields for "what changed from baseline" and "why this scenario won."
   - Keep recommendation fields deterministic so result pages and tests do not drift.

2. Saved/shareable run support
   - Keep saved-run creation, lookup, listing, expiry, and fallback behavior covered by tests and deep health checks.
   - Add any missing result-page metadata the frontend needs: display title, generated time, scenario count, best scenario, key metric, and expiry.
   - Keep saved-run records public-safe and scoped so recent lists do not leak across visitor sessions.

3. Validation and API ergonomics
   - Maintain stable `issues[].path` values for both specialized Business Simulator routes and generic Reux simulation execution.
   - Add contract examples for common frontend failures: invalid field, invalid unit, too many scenarios, expired run, and not found.
   - Keep primitive and `{ value, unit }` assumption inputs working.

4. Public API contract
   - Keep `docs/public/reux-demo-api-contract.json` synchronized with behavior.
   - Keep `docs/technical/public-demo-api.md` and `docs/technical/business-simulator-api.md` aligned with the current response shape.
   - Add examples that frontend agents can mock without reading source code.

## P1 Product Reliability

- Expand deep health checks to cover the exact sellable path: list templates, run simulation, save run, reload saved result, list recent runs, validate bad input.
- Add result-store counters to health output if any frontend status panel needs them.
- Add clearer server-side error codes for expired saved run, missing saved run, validation failure, persistence fallback, and rate limit.
- Keep rate-limit metadata visible enough for frontend retry states.
- Add tests for public-safe response bodies so internal errors do not leak into user-facing payloads.

## P2 Simulation Depth For Product Value

- Improve comparison/explanation output so recommendations are not shallow.
- Add stronger unit/formula validation where it improves buyer trust.
- Add additional decision templates only when they support the Business Simulator offer: staffing, pricing, process improvement, capacity planning.
- Expand domain-pack guidance if it helps identify missing assumptions, metrics, objectives, or scenario templates.

## Operational Gates

Before backend work is considered done:

- `npm run check`
- focused tests for touched backend modules
- `npm test` when response shape, saved runs, or validation changes
- `npm run check:demo`
- `npm run check:public`
- `node scripts/release-preflight.mjs --allow-dirty` when docs/status/release assets change

## Coordination With Frontend

When frontend agents need a backend change, capture it as one of:

- missing field in response
- unclear validation path
- missing saved-run metadata
- missing API contract example
- missing health/status signal
- unclear or unstable recommendation wording

Backend should prefer stable, explicit response fields over asking frontend to infer meaning from generic JSON.
