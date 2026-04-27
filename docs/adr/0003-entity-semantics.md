# ADR 0003: Entity Semantics

## Status

Accepted for prototype.

## Context

The architecture document recommends entity-as-handle semantics in ordinary code, explicit loaded mutable state in transactions, and structural projections for transfer.

## Decision

Entities are modeled as durable nominal handles in Schema IR. Fields are queryable through query expressions and will later be materialized through explicit `fetch` or `load` operations.

## Consequences

- The prototype avoids hidden lazy I/O.
- Future Transaction IR can distinguish immutable handles from `Mut<Entity>` loaded state.
