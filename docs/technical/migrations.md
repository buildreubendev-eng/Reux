# Migrations

Reux treats migrations as reviewed artifacts. Entity declarations describe desired schema state, while manifests record compiled schema state at a point in time.

## Initial Migration

Create an initial migration from a source file:

```bash
node dist/cli.js migrate-create examples/commerce.dl initial_schema
```

This writes a timestamped SQL file under `migrations/`.

Generated PostgreSQL schema includes `CREATE EXTENSION IF NOT EXISTS pgcrypto;` so `Id<T> primary generated` can use `gen_random_uuid()`.

## Migration Planning

Create a manifest for the old schema:

```bash
node dist/cli.js manifest examples/commerce.dl > old-manifest.json
```

Plan changes against newer source:

```bash
node dist/cli.js migrate-plan old-manifest.json examples/commerce_v2.dl
```

Plan changes from the configured `schemaManifest` to the active configured source:

```bash
node dist/cli.js project-migrate-plan
node dist/cli.js project-migrate-plan --json
```

Create a diff migration from the configured `schemaManifest` to the active configured source:

```bash
node dist/cli.js project-migrate-diff-create commerce_next
```

If there are no migration operations, the command reports that the manifest is already up to date and does not create an empty file.

Show applied and pending migrations for the configured database:

```bash
node dist/cli.js migrate-status
node dist/cli.js migrate-status --json
```

Use `--json` when another script needs to inspect applied and pending migrations without parsing human-readable text.

Create a reviewable diff migration file:

```bash
node dist/cli.js migrate-diff-create old-manifest.json examples/commerce_v2.dl commerce_v2
```

The generated diff migration includes SQL for safe operations and comments for unsafe/destructive operations. Unsafe comments are intentional: they force a human-authored migration step instead of hiding a risky schema change.

The planner classifies each operation:

- `safe`: SQL can be emitted by the prototype.
- `unsafe`: human review or a typed data migration is required before SQL should be emitted.
- `destructive`: data or database objects are removed.

## Current Safety Rules

Safe:

- create enum;
- add enum value;
- create entity;
- add nullable field;
- add non-null field with default or generated value;
- create index.

Unsafe:

- remove enum value;
- change field type, optionality, uniqueness, defaults, checks, or references;
- add non-null field without a default.

Destructive:

- drop entity;
- drop field;
- drop index.

This is deliberately conservative. Future migration work should add stable schema IDs, explicit rename operations, data migrations, and staged zero-downtime migration support.
