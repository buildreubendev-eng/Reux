# Compiler Artifacts

The Reux prototype keeps source syntax, schema, query plans, and SQL as separate artifacts.

## AST

The parser reads source files into declaration-oriented AST objects for modules, entities, enums, transition rules, queries, and transaction functions.

## Schema IR

Schema IR is the backend-neutral durable model. It records:

- entity names and table names;
- field names and column names;
- field type, optionality, primary key, uniqueness, defaults, and checks;
- references between entities;
- indexes;
- enums.
- enum-backed transition rules.

Before Schema IR is emitted, the compiler rejects duplicate durable names, fields, indexes, enum values, and parameters so downstream artifacts remain deterministic.

Transition rules validate entity/field references and enum values before they appear in Schema IR. They are currently compiler artifacts rather than generated database constraints.

Inspect transition-rule artifacts:

```bash
node dist/cli.js transition-rules examples/pilot_reux.dl
node dist/cli.js project-transition-rules Order.status
```

The CLI emits Schema IR as a manifest:

```bash
node dist/cli.js diagnose examples/commerce.dl
node dist/cli.js manifest examples/commerce.dl
```

The manifest format is `dl.schema.v1` and includes a stable SHA-256 schema hash.

## Query IR

Query IR is the typed intermediate representation used before SQL lowering. The current operators are:

- `Scan`
- `Join`
- `Filter`
- `Group`
- `Order`
- `Limit`
- `Map`

Inspect a query plan:

```bash
node dist/cli.js query-ir examples/commerce.dl highValueUsers
node dist/cli.js project-query-ir highValueUsers
```

Expression IR records field, parameter, alias, and enum-literal references. This lets `where order.status == Paid` lower to a PostgreSQL enum literal while still rejecting values that are not declared by the field's enum type.

`explain` includes both the Query IR and the generated PostgreSQL SQL:

```bash
node dist/cli.js explain examples/commerce.dl highValueUsers
node dist/cli.js project-explain highValueUsers
```

## PostgreSQL SQL

The PostgreSQL backend currently emits:

- `CREATE EXTENSION IF NOT EXISTS pgcrypto` for generated UUID primary keys;
- `CREATE TYPE` for enums;
- `CREATE TABLE` for entities;
- foreign key constraints for references;
- column constraints for nullability, uniqueness, defaults, and checks;
- `CREATE INDEX` for declared indexes;
- `SELECT` statements for the supported query subset, including explicit joins over entity references, narrow grouped aggregations, and `LIMIT`.

## Transaction IR

Transaction IR records transaction function signatures, declared write sets, and a first structured view of mutation steps.

Current step kinds:

- `LoadForUpdate`
- `Mutation`
- `Save`
- `Insert`
- `Enqueue`
- `AfterCommit`
- `ExternalCall`
- `Abort`
- `Raw`

Inspect a transaction function:

```bash
node dist/cli.js tx-ir examples/commerce_v2.dl rewardUser
node dist/cli.js project-tx-ir rewardUser
```

The current compiler validates that declared `writes` entities exist, that simple `insert`, mutation, and `save` steps are covered by the declared write set, that enum-valued transaction writes use declared enum values, and that retryable transactions do not directly call external-looking functions.

Emit the current PostgreSQL transaction lowering:

```bash
node dist/cli.js tx-sql examples/commerce_v2.dl rewardUser
node dist/cli.js project-tx-sql rewardUser
```

The SQL lowering currently supports `load <entity-param> for update`, simple field assignment/update statements over loaded state, `insert Entity { ... }`, bound inserts such as `let row = insert Entity { ... }`, and `enqueue Event { ... }`. `save` and `after commit` appear as comments because mutation statements are explicit and external hooks are not executed by the runtime yet.

Bound inserts emit a marker comment before the generated `INSERT ... RETURNING *`; the runtime uses that marker to return the inserted row under `bindings.<name>`.

When a loaded entity assignment targets an enum field with transition rules, SQL lowering adds a transition guard for literal targets and enum-typed parameter targets. Literal guards include the allowed previous enum values in the `WHERE` clause. Parameterized guards check the current value and requested next value against the declared transition table. Both forms emit a marker comment that the runtime uses to fail the transaction if the update touches no rows.

Run the supported SQL subset:

```bash
node dist/cli.js tx-run examples/commerce_v2.dl rewardUser '["user-id","100"]'
```

`tx-run` executes recognized SQL statements inside a managed transaction. `enqueue` writes durable `_dl_outbox` rows. `after commit` comments become reported pending hooks.

## TypeScript API Client

The compiler can emit a TypeScript client that wraps generated query and transaction SQL in runtime calls:

```bash
node dist/cli.js api-ts examples/pilot_reux.dl ./runtime.js
node dist/cli.js project-api-ts ./runtime.js
```

The generated client includes:

- enum union types;
- row interfaces for entities and query projections;
- parameter interfaces for queries and transactions;
- embedded SQL constants;
- a `create<Module>Api(db)` factory that calls `runSqlQuery` and `runTransactionSql`.

Entity parameters are represented as the underlying UUID string handle. Decimal values accept `number | string` so callers can avoid losing precision when they need exact PostgreSQL numeric behavior.

The compiler can also emit a minimal HTTP server scaffold around the generated client:

```bash
node dist/cli.js api-server-ts examples/pilot_reux.dl ./api.js ./config.js ./runtime.js
node dist/cli.js project-api-server-ts ./api.js ./config.js ./runtime.js
```

The scaffold intentionally uses Node's built-in `http` module, so it remains dependency-light. It wires `GET /health`, `POST /queries/<queryName>`, and `POST /transactions/<transactionName>` to the generated API client. Applications can copy the scaffold into an app package, then replace or wrap the plain HTTP handling with their framework of choice.

Generated servers reject invalid JSON with `400` and request bodies larger than `REUX_HTTP_MAX_BODY_BYTES` with `413`. The default body limit is 1 MiB.

## TypeScript Worker Scaffold

The compiler can emit a worker scaffold for durable transaction events:

```bash
node dist/cli.js worker-ts examples/pilot_reux.dl ./config.js ./runtime.js
node dist/cli.js project-worker-ts ./config.js ./runtime.js
```

The scaffold discovers `enqueue Event { ... }` statements and `after commit hook(...)` calls from transaction functions. It generates placeholder `OutboxHandler` and `AfterCommitHandler` objects, configures graceful shutdown for `SIGINT`/`SIGTERM`, requeues stale processing claims using `REUX_WORKER_REQUEUE_STALE_SECONDS`, and runs `runOutboxWorker` against the configured PostgreSQL database.

Outbox handlers are durable and can be retried through `_dl_outbox`. After-commit handlers are generated as placeholders because the current runtime reports after-commit hooks from transaction execution but does not persist them across process restarts.
