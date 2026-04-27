# ADR 0001: Language Scope

## Status

Accepted for prototype.

## Context

The architecture document recommends designing DL as a full language while implementing the MVP as a data/application subset.

## Decision

The prototype starts with data modules: `module`, `entity`, `enum`, and query declarations. Ordinary functions, transaction functions, migrations, and runtime execution will be added after the schema and query front end is stable.

## Consequences

- Early users can validate the durable data model and query surface without committing to a whole application runtime.
- The compiler must still preserve room for Core IR and Transaction IR, even when they are not implemented yet.
