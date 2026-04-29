# Reuben Ecosystem Architecture

This document captures the practical architecture direction for the Reuben ecosystem. The goal is to validate Reux through real products without forcing every product to wait for the language to be complete.

## Product Boundaries

Reuben is the parent brand and website. It should present the portfolio clearly, host project pages, and point users to demos.

Reux is the language and runtime layer. This repository owns the compiler, parser, CLI, PostgreSQL lowering, generated TypeScript integration points, and the first simulation language experiments.

PLOS is the future personal simulation product. Its domains are finances, health, career, goals, time, habits, and scenario simulation.

The real-time business simulation engine is the future enterprise product. Its domains are workforce simulation, cost modeling, productivity forecasting, risk scoring, and operational scenario comparison.

## Architecture Principle

Build the products with normal TypeScript and web infrastructure first. Let Reux power the decision, workflow, and simulation layer as it becomes reliable enough.

That keeps the products shippable while the language evolves. It also gives Reux real pressure tests instead of abstract language examples.

## Current Foundation

The Reux repo currently owns:

- data schema declarations;
- query declarations;
- transaction functions;
- typed events and worker scaffolds;
- migration and seed tooling;
- hosted commerce and logistics demo foundations;
- first-pass `simulate` declarations and Simulation IR.

The website repo should own:

- Reuben landing and project pages;
- public copywriting;
- visual design;
- demo embeds and links;
- product-positioning pages for Reux, PLOS, and business simulation.

## Simulation Path

The first simulation syntax supports static forecast declarations:

```dl
simulate personal_finance {
  income = 5000 USD
  rent = 1500 USD
  debt_payment = 500 USD
  formula cash_flow = income - rent - debt_payment

  change at 7 months {
    rent = 1600 USD
  }

  scenario lower_rent {
    rent = 1200 USD

    change at 7 months {
      rent = 1300 USD
    }
  }

  forecast 12 months
}
```

This compiles to Simulation IR and can run a prototype formula forecast with shared scheduled changes, scenario-specific scheduled changes, and final-period scenario comparison. The next language steps are:

- richer dimensional analysis;
- richer comparison reports;
- reusable domain templates;
- connections between simulation inputs and Reux entities/queries;
- generated TypeScript types for simulation inputs and outputs.

## Product Validation Strategy

Each product should validate one part of the language thesis:

- Commerce validates data-aware transactions and durable events.
- Logistics validates the same subset outside commerce.
- PLOS validates personal forecasting and scenario comparison.
- Business simulation validates operational forecasting, risk scoring, and decision comparison.

The public story should stay focused: Reux is a language for modeling data-backed decisions before they affect real systems.
