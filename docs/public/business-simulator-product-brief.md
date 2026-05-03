# Business Simulator Product Brief

This brief turns the current Reux prototype into the first sellable product direction.

## First Sellable Wedge

The first sellable wedge is the Business Simulator, powered by Reux.

Do not lead with "a new programming language" for early buyers. Lead with a product that helps operators compare operational decisions before they commit budget, staff, time, or risk.

Reux remains the engine underneath: it models the assumptions, scenarios, formulas, timelines, comparisons, and explainable backend contracts. The Business Simulator is the buyer-facing surface.

## Product Promise

Business Simulator helps teams run operational what-if scenarios, save and share results, and explain which scenario performs best before decisions become real-world commitments.

## Target Buyer

Primary buyer:

- Founder, owner-operator, or operations leader who makes staffing, pricing, capacity, or process decisions.
- Consultant or fractional operator who needs a repeatable way to show clients tradeoffs and recommendations.
- Small-to-mid-size business team that is too operationally complex for a spreadsheet but not ready for a custom analytics platform.

Primary user:

- Someone who can adjust assumptions, compare scenarios, and explain a recommendation to another stakeholder.

Early adopter signal:

- They already use spreadsheets for scenario planning.
- They rerun similar what-if models repeatedly.
- They need saved results, clear recommendations, and shareable decision summaries.
- They care about why the recommendation changed, not only the final number.

## Demo Completion Bar

The demo should feel complete when a visitor can:

- Start from the Reuben/Reux site and understand that Business Simulator is the product to try first.
- Open the simulator without setup.
- Adjust baseline assumptions and scenario assumptions.
- Run a simulation and see a clear recommendation.
- Save or reload a result.
- Understand what changed, why it changed, and what to do next.
- Share or hand off the result without needing compiler knowledge.

Frontend work should prioritize this path before adding more visual polish elsewhere.

Detailed execution roadmaps:

- Frontend: `docs/public/business-simulator-frontend-roadmap.md`
- Backend: `docs/public/business-simulator-backend-roadmap.md`

## Simple Offer

Working offer:

> Business Simulator is a Reux-powered planning tool for teams that need to compare operational decisions before committing money, staff, time, or risk.

Pilot CTA:

> Bring one real decision you are currently modeling in a spreadsheet. We will turn it into a reusable Business Simulator scenario so you can compare options, save results, and explain the recommendation.

Pilot success criteria:

- One real decision can be modeled with baseline assumptions and at least two scenarios.
- The user can understand the recommendation without reading Reux source.
- The result is useful enough to revisit, share, or rerun with changed assumptions.
- The model exposes where Reux needs more domain depth, validation, or explanation support.

## What Reux Proves Through This Product

- Reux can power a normal web product instead of staying a syntax demo.
- Simulation declarations can become product-facing decision workflows.
- Saved runs and API contracts make simulations usable beyond a CLI.
- The same language/runtime layer can later support PLOS and deeper enterprise simulations.

## Not The Initial Sale

Do not sell the first version as:

- A complete general-purpose programming language.
- A replacement for a full analytics platform.
- A self-serve enterprise deployment for arbitrary external teams.
- A package ecosystem.

The first sale is guided access to a decision simulator that is already backed by Reux.
