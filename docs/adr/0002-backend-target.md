# ADR 0002: Backend Target

## Status

Accepted for prototype.

## Context

The architecture document recommends PostgreSQL first, with SQLite as a later development/testing backend.

## Decision

PostgreSQL is the first SQL lowering target. Backend assumptions are explicit in the compiler and CLI output.

## Consequences

- DDL generation can use PostgreSQL-native features such as `uuid`, `numeric`, `timestamptz`, enums, checks, references, and indexes.
- SQLite compatibility will not weaken source-level semantics during the first implementation slice.
