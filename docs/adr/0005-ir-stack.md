# ADR 0005: IR Stack

## Status

Accepted for prototype.

## Context

The architecture document emphasizes separate AST, HIR, Schema IR, Query IR, Transaction IR, and Core IR.

## Decision

The prototype implements AST, Schema IR, and a small Query IR. HIR, Transaction IR, Core IR, Migration IR, and Policy IR are reserved as explicit future layers.

## Consequences

- Query and schema lowering are not collapsed into strings at parse time.
- The codebase has stable places to add type/effect checking and migration planning later.
