# ADR 0004: Optionality And Query Semantics

## Status

Accepted for prototype.

## Context

The architecture document rejects exposing SQL three-valued null logic directly and recommends bag semantics for `Query<T>`.

## Decision

The source language uses `T?` for optional fields and treats `Query<T>` as a bag unless `distinct` is introduced later. SQL lowering maps optional scalar fields to nullable columns, but source-level optional handling remains explicit.

## Consequences

- Initial validation records optionality in Schema IR.
- Query lowering is intentionally narrow until optional comparison rules are implemented with full diagnostics.
