# Business Simulator Frontend Roadmap

This roadmap is for Opus/Gemini frontend work. Keep changes focused on the buyer-facing Business Simulator product. The Commerce, Logistics, and Operations demo frontend is considered functionally complete; only touch those demo-console surfaces to fix regressions or keep status links accurate.

## Goal

Make Business Simulator feel like a finished, sellable product: a visitor can understand the offer, run a scenario, save or reload results, and share an explainable recommendation without knowing Reux internals.

## Current Focus

The active frontend priority is the sellable Business Simulator product surface, not more demo-console polish.

- Treat the public Commerce/Logistics/Ops demo frontend as complete unless QA finds a concrete regression.
- Build the Business Simulator experience around the live backend contract: template selection, guided assumptions, scenario comparison, saved runs, shareable results, and buyer-facing recommendation guidance.
- Render the current backend fields directly where useful: `capacity-planning`, `staffing-plan`, `pricing-strategy`, `decisionSummary`, `recommendedAction`, `confidence`, `confidenceSummary`, `watchouts`, `resultSummary`, `keyMetric`, and `expiryNote`.
- Keep status surfaces current when Business Simulator product UI moves from planned to in progress to complete.

## Definition Of Sellable

- The first screen makes it clear that Business Simulator is the product to try.
- A user can complete the main path without setup or developer knowledge.
- The UI explains what changed, why the recommendation won, and what to do next.
- Saved result pages feel intentional, shareable, and trustworthy.
- Public status surfaces stay current whenever the frontend moves from planned to in progress to complete.

## P0 Completion Path

Status: complete. All P0 items have been implemented in `simulator.html` + `simulator.js`.

1. [DONE] Sellable product entry and positioning
   - Simulator hero with product promise from the product brief.
   - Pilot CTA using the brief's "Bring one real decision..." language.
   - Navigation links from demo console and ops dashboard.

2. [DONE] Template selection and guided run flow
   - Users choose between `operations-decision`, `capacity-planning`, `staffing-plan`, and `pricing-strategy`.
   - Baseline assumptions and scenario assumptions are easy to scan and edit with business-readable labels.
   - Validation errors rendered inline using API `issues[].path`.
   - Primary action obvious from first load through successful run.

3. [DONE] Results and recommendation
   - Renders `decisionSummary`, `recommendedAction`, `confidenceSummary`, `watchouts`, `keyMetric`, `scoreBreakdown`, `scenarioRanking`, and `scoreGap`.
   - "What changed from baseline" in plain language.
   - Next actions: revise assumptions, new simulation, copy share link.

4. [DONE] Saved and shareable results
   - Saved-run list with display title, subtitle, scenario count, and recommendation.
   - Deep-link loading via `?run=<id>` query parameter.
   - Empty, loading, error, expired, and not-found states.

## P1 Product Polish

- Keep commerce/logistics demo summaries stable; do not spend new frontend passes there unless a regression appears.
- Add empty, loading, error, retry, and expired-result states for every public simulator route.
- Add saved-result list and shared-result loading states for the Business Simulator product path.
- Run responsive visual QA at mobile, tablet, 1366x768, 1440x900, and wide desktop.
- Fix overflow, cramped nav, nested cards, disproportionate hierarchy visuals, and text clipping.
- Keep the Reuben > Reux > PLOS/Business Simulator hierarchy compact and balanced.

## P2 Trust And Conversion

- Add a concise "How this works" panel that explains scenarios, assumptions, recommendations, and saved runs without mentioning compiler internals.
- Add example decision templates such as staffing, pricing, process change, and capacity planning.
- Add a lightweight pilot handoff form or CTA target when the hosting site is ready.
- Add screenshot-ready states for marketing, docs, and investor/customer demos.

## Status Sync Requirements

Every frontend completion PR must update the relevant status surfaces:

- `docs/public/reux-roadmap.json`
- `docs/public/reux-roadmap.md`
- `docs/public/reux-capabilities.json`
- `docs/public/reux-capabilities.md`
- generated public snapshot and next backlog via `npm run public:write`
- any demo testing docs affected by the UI behavior

Do not mark an item complete unless the UI path is actually usable and checked at the required responsive sizes.

## Suggested Opus/Gemini Prompt

```text
Work only in the Reux repo. Use docs/public/business-simulator-product-brief.md and docs/public/business-simulator-frontend-roadmap.md as the source of truth.

The Commerce/Logistics/Ops demo frontend is considered functionally complete. Do not spend this pass polishing the demo console unless you find a concrete regression. The active frontend focus is the sellable Business Simulator product.

Implement the next highest-priority frontend item toward a sellable Business Simulator:
- template selection for operations-decision, capacity-planning, staffing-plan, and pricing-strategy,
- guided scenario run flow,
- clear recommendation/result summary using decisionSummary, recommendedAction, confidenceSummary, and watchouts,
- saved/shareable result page and reload states,
- pilot CTA and product positioning,
- responsive visual QA,
- status surface updates.

Do not change backend language/runtime code unless absolutely necessary. If an API gap blocks you, document the exact backend need and keep moving on frontend-safe work.

Before finishing, run relevant checks, run npm run public:write if status assets changed, and summarize which roadmap/status labels were updated.
```
