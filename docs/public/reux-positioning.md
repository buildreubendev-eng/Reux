# Reux Positioning Guide

This guide keeps public messaging clear while the language and ecosystem continue to mature.

## Short Positioning

Reux is a data-native language for reliable backend workflows and simulation-driven applications.

It helps teams model data, run state-changing workflows, emit durable events, and compare scenarios before decisions become production changes.

## Category Framing

Reux should be positioned as a backend decision language, not as "another general-purpose programming language."

The clearest public category is:

> A backend language for data-aware workflows and simulation-driven decisions.

That category keeps the message specific enough to be credible while still leaving room for the long-term ecosystem.

## Public One-Liner

Reux lets teams define data models, workflows, events, and simulations in one auditable backend language, then use normal web technology to build the product interface around it.

## First Sellable Product

The first sellable product direction is the Business Simulator.

For early buyers, lead with operational scenario planning rather than language infrastructure. The buyer-facing promise is: compare operational decisions, save/share results, and explain the recommendation before committing money, staff, time, or risk.

Reux should still be visible as the engine underneath the product, but the sale should start with a concrete Business Simulator pilot.

## What To Say

Use this language publicly:

- Reux is a data-native language and runtime prototype.
- Reux focuses first on backend decision logic, data models, transactions, events, migrations, and simulations.
- Reux is designed to sit underneath normal web applications, not replace every layer on day one.
- Reux is being validated through real products: the Reuben website, the public Reux demo, PLOS, and the business simulation engine.
- The goal is explainable software for systems where data state and future outcomes matter.
- The Business Simulator is the current proof point: a real interface using Reux-backed simulation logic to compare operational decisions.
- The Business Simulator is the first sellable wedge; Reux is the language/runtime layer that makes it explainable and extensible.

## What To Avoid Saying For Now

Avoid these claims until the platform supports them more completely:

- Reux is a finished general-purpose language.
- Reux replaces JavaScript, TypeScript, Python, or SQL across the whole stack.
- Reux is a complete full-stack language today.
- Reux has a mature package ecosystem.
- Reux is production-ready for arbitrary external teams without guided onboarding.

## Full-Stack Answer

If someone asks whether Reux is a full-stack language, the honest answer is:

Reux is not a full-stack language yet. Today it is strongest as a backend/data/simulation language prototype with generated TypeScript integration. The long-term direction could become full-stack in the sense that Reux may define the data model, workflow logic, event layer, simulation logic, and generated app contracts, while established frontend frameworks still handle the interface.

## Audience-Specific Messaging

For technical reviewers:

- Reux compiles a focused schema/query/transaction/simulation subset into PostgreSQL and TypeScript integration artifacts.
- The current architecture favors boring infrastructure underneath: PostgreSQL, TypeScript, HTTP services, and generated scaffolds.
- The differentiator is the language layer around data state, workflow safety, and simulation semantics.

For business visitors:

- Reux is a way to build software that can reason about decisions before they happen.
- It is being tested through commerce, logistics, personal planning, and business operations use cases.
- The product vision is software that can model the present, simulate the future, and explain the tradeoffs.

For demo users:

- The demo is a public preview of how Reux handles real workflows.
- Each visitor gets an isolated session, so testing does not collide with other users.
- The current demo is meant to show direction and capability, not the final product surface.

## Tagline Options

- Model the data. Run the workflow. Simulate the decision.
- A data-native language for systems that need to explain what happens next.
- Build workflows that understand state, events, and future outcomes.
- The language layer for simulation-driven software.

## Ecosystem Story

Reuben is the public home for the work. Reux is the language and runtime layer. PLOS is the personal simulation product that validates individual planning use cases. The real-time business simulation engine is the enterprise product that validates operational and financial decision use cases.

Together, those products make the language easier to understand because Reux is not only a syntax experiment. It is being shaped by products that need it.

## Investor / Customer Translation

If the audience is not technical, avoid leading with compiler details. Lead with the operational pain:

- Modern products scatter important business rules across application code, SQL, queues, spreadsheets, and dashboards.
- Reux brings those rules closer to the data and makes them easier to inspect, test, and simulate.
- The first commercial wedge is simulation-driven software: business operators can compare choices before committing money, staff, time, or risk.

## Developer Translation

If the audience is technical, lead with the architecture:

- Reux compiles a focused source language into PostgreSQL and TypeScript-facing artifacts.
- It keeps boring infrastructure underneath: Node.js, PostgreSQL, generated SQL, generated TypeScript, and normal web apps.
- The differentiated layer is semantic: schemas, workflows, state transitions, durable events, and simulation models live in one inspectable source language.
