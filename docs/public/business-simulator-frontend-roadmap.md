# Business Simulator Frontend Roadmap

This roadmap is for Opus/Gemini frontend work. Keep changes focused on the buyer-facing Business Simulator product and the public demo surfaces that support it.

## Goal

Make Business Simulator feel like a finished, sellable product: a visitor can understand the offer, run a scenario, save or reload results, and share an explainable recommendation without knowing Reux internals.

## Definition Of Sellable

- The first screen makes it clear that Business Simulator is the product to try.
- A user can complete the main path without setup or developer knowledge.
- The UI explains what changed, why the recommendation won, and what to do next.
- Saved result pages feel intentional, shareable, and trustworthy.
- Public status surfaces stay current whenever the frontend moves from planned to in progress to complete.

## P0 Completion Path

1. Entry and positioning
   - Make the Reuben/Reux entry point frame Business Simulator as the first sellable wedge.
   - Use the product promise from `docs/public/business-simulator-product-brief.md`.
   - Add a visible pilot CTA using the brief's "Bring one real decision..." language.

2. Guided run flow
   - Make baseline assumptions and scenario assumptions easy to scan and edit.
   - Keep labels business-readable; avoid compiler/source terminology in the main path.
   - Show validation errors next to the affected field when the API returns `issues[].path`.
   - Keep the primary action obvious from first load through successful run.

3. Results and recommendation
   - Show the winning scenario, key metric deltas, risk/tradeoff summary, and recommendation rationale.
   - Explain "what changed from baseline" in plain language.
   - Provide a next action after every run: save, revise assumptions, compare another scenario, or share.

4. Saved and shareable results
   - Make saved-run loading feel like a product result page, not a debug payload.
   - Show run metadata, scenario count, best scenario, generated time, and expiry/temporary-data note.
   - Provide copy that is understandable when someone opens a shared result cold.

## P1 Product Polish

- Make commerce/logistics demo summaries visually and verbally consistent with Business Simulator summaries.
- Add empty, loading, error, retry, and expired-result states for every public simulator route.
- Make the operations dashboard useful for a non-developer evaluator: queue health, stale/dead-letter meaning, last smoke status, and saved-run store status.
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
Work only in the Reux repo. Focus on the Business Simulator frontend and public demo surfaces. Use docs/public/business-simulator-product-brief.md and docs/public/business-simulator-frontend-roadmap.md as the source of truth.

Implement the next highest-priority frontend item toward a sellable Business Simulator:
- guided scenario run flow,
- clear recommendation/result summary,
- saved/shareable result page,
- pilot CTA and product positioning,
- responsive visual QA,
- status surface updates.

Do not change backend language/runtime code unless absolutely necessary. If an API gap blocks you, document the exact backend need and keep moving on frontend-safe work.

Before finishing, run relevant checks, run npm run public:write if status assets changed, and summarize which roadmap/status labels were updated.
```
