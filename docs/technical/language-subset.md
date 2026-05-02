# Reux Language Subset

This prototype implements the first data-module subset of Reux. It is intentionally smaller than the full language in the research architecture.

## Supported Declarations

- `module <name>`
- `entity <Name> { ... }`
- `enum <Name> { ... }`
- `event <Name> { ... }`
- `transition <Entity>.<field> { ... }`
- `query fragment <name>(range in Entity) = where ...`
- `query <name>(params): Query<T> = from ...`
- `simulate <name> { ... }`
- `transaction function <name>(params) writes Entity, ... { ... }`

## Entity Fields

Fields use:

```dl
name: Type modifier...
```

Supported field modifiers:

- `primary`
- `generated`
- `required`
- `unique`
- `default <value>`
- `check <expression>`

Non-optional fields are required by default and lower to `NOT NULL`. Optional fields use `T?` and lower to nullable columns.

## Supported Types

Scalar types:

```text
Bool Int Int64 Float Decimal CurrencyCode String Bytes Date Time Instant Duration Uuid Json
```

`Decimal` may also declare explicit PostgreSQL numeric precision and scale:

```dl
balance: Decimal<12,2> default 0
```

Bounded decimals lower to `numeric(precision, scale)`. The compiler validates that precision and scale are integer literals, that precision is between 1 and 1000, and that scale is between 0 and precision.

`CurrencyCode` represents a three-letter ISO-style uppercase currency code. It lowers to PostgreSQL `char(3)` with a generated `CHECK` constraint requiring `^[A-Z]{3}$`:

```dl
currency: CurrencyCode default USD
```

Entity IDs:

```dl
id: Id<User> primary generated
```

References:

```dl
user: User required
```

Enums:

```dl
enum OrderStatus {
  Pending
  Paid
}
```

Events declare typed outbox payload contracts:

```dl
event AccountDebited {
  account: Account
  amount: Decimal<12,2>
}
```

If an `enqueue` statement targets a declared event, the compiler validates required payload fields, rejects unknown payload fields, and checks payload expression types against the event declaration.

## Simulation Subset

The first simulation slice is intentionally small. It exists to prove the Reux ecosystem direction without forcing PLOS or the business simulation engine to depend on an unfinished full language.

```dl
simulate personal_finance {
  dimension product = PLOS
  dimension domain = finance
  dimension audience = personal

  income = 5000 USD
  rent = 1500 USD
  debt_payment = 500 USD
  formula cash_flow = income - rent - debt_payment
  formula annual_surplus = cash_flow * 12
  objective maximize cash_flow
  objective maximize annual_surplus

  change at 7 months {
    rent = 1600 USD
  }

  scenario lower_rent {
    rent = 1200 USD

    change at 7 months {
      rent = 1300 USD
    }
  }

  scenario debt_free {
    debt_payment = 0 USD
  }

  forecast 12 months
}

simulate workforce_change {
  dimension product = business_simulation
  dimension domain = workforce
  dimension audience = enterprise

  employees = 50 count
  productivity_gain = 8 percent
  overtime_reduction = 10 percent
  formula productivity_index = 100 * (1 + productivity_gain)
  formula operating_relief = productivity_gain + overtime_reduction
  objective maximize productivity_index
  objective maximize operating_relief

  change at 4 months {
    productivity_gain = 10 percent
  }

  scenario stronger_training {
    productivity_gain = 12 percent

    change at 4 months {
      productivity_gain = 14 percent
    }
  }

  forecast 6 months
}
```

Supported simulation statements:

- `dimension name = identifier`
- `dimension name = "quoted string"`
- `name = number`
- `name = number unit`
- `name = true | false`
- `name = "quoted string"`
- `formula name = expression`
- `objective maximize metric_name`
- `objective minimize metric_name`
- `change at N days|weeks|months|quarters|years { ... }`
- `scenario name { ... }`
- `forecast N days|weeks|months|quarters|years`

Dimensions attach lightweight domain metadata to a simulation without affecting the forecast math. They are intended to classify models across the Reuben ecosystem, such as `product = PLOS`, `domain = finance`, or `audience = enterprise`. Dimension names must be unique and cannot collide with assumption names. Dimension values may be identifiers or quoted strings.

Unit quantities attach a lightweight unit label to numeric assumptions. `percent` and `%` normalize to a decimal value plus `percent` unit, so `8 percent` evaluates as `0.08`. Uppercase currency labels such as `USD` are preserved. Common count labels normalize to `count`.

Formula expressions support numeric literals, assumptions, earlier formulas, parentheses, and `+`, `-`, `*`, `/`. The compiler validates that referenced values exist, that formulas only use numeric assumptions or earlier formulas, and that unit math is compatible. Adding or subtracting requires matching non-percent units, scalar multiplication preserves the unit value, same-unit division produces a unitless ratio, and percent values can participate in scalar/rate calculations. Unsupported compound-unit math, such as `USD * count` or `USD + percent`, is rejected instead of silently producing a misleading metric. Formula results carry a unit when the expression is unit-compatible, such as adding/subtracting `USD` values or multiplying one unit value by a scalar.

Objectives declare whether a metric should be maximized or minimized. Objective metrics must reference formula output metrics or known derived metrics such as `netCashFlow`, `cumulativeNetCashFlow`, `changeRate`, or `projectedIndex`. Rankings use objectives when present: maximize sorts by largest final delta, while minimize sorts by smallest final delta.

Scenarios declare alternate assumption values against the same formulas and forecast window. Scenario overrides must reference existing assumptions and keep the same primitive type and unit as the baseline value. Scenarios may also declare their own `change at` blocks. Scenario-specific changes are applied after the shared baseline changes for that scenario only, which lets a model compare paths such as "baseline training improves in month 4" against "stronger training improves more in month 4."

Changes declare time-varying assumption values that take effect at a forecast period and continue for later periods. Change blocks must use the same forecast unit, must occur inside the forecast window, and must keep the same primitive type and unit as the baseline assumption. When shared and scenario-specific changes apply in the same period, the runner reports a single applied change marker for that period while still applying all overrides deterministically.

The compiler emits Simulation IR and can run a prototype formula forecast. The runner repeats the declared assumptions for each period, applies any scheduled changes, carries simulation dimensions into the run output, emits formula results as metrics with `metricUnits` when known, emits `assumptionDeltas` for each period compared with the previous period and scenario baseline, rejects non-finite numeric output such as divide-by-zero results, and compares scenarios against the baseline.

Scenario comparison reports include:

- final-period `metricDeltas` for quick summaries;
- `periodDeltas` for every forecast period;
- `firstDivergence`, which points to the first period where any metric differs from baseline.
- `metricRankings`, which ranks scenarios by final-period delta for each metric and uses declared objectives when present.
- `explanations`, which summarize the preferred scenario, objective, final delta, and first divergence for each metric.

If a simulation has no formulas, the runner still derives a small set of early prototype metrics:

- `netCashFlow` and `cumulativeNetCashFlow` when an `income` assumption is present;
- `changeRate` and `projectedIndex` when rate-like assumptions such as `productivity_gain` or `overtime_reduction` are present.

Inspect and run simulations with:

```bash
node dist/cli.js simulation-ir examples/simulations/personal_finance.reux
node dist/cli.js simulation-run examples/simulations/workforce_change.reux
node dist/cli.js simulation-run examples/simulations/habit_consistency.reux
node dist/cli.js simulation-run examples/simulations/operations_throughput.reux
node dist/cli.js simulation-types-ts examples/simulations/workforce_change.reux
node dist/cli.js simulation-packs examples/simulations/workforce_change.reux
```

Generated simulation TypeScript contracts include typed dimension names, typed assumption maps, metric maps, scenario names, run/result shapes, explanation summaries, summary helper types, runtime helper functions, and a small metadata constant for each simulation. They also include a generated catalog API (`reuxSimulationCatalog`, `listReuxSimulationNames()`, and `findReuxSimulationMetadata(name)`) so a frontend or product backend can discover simulation models without treating them as unstructured JSON or hard-coding source-file details.

Product backends can also execute simulations through the package API without shelling out to the CLI:

```ts
import { runReuxSimulation } from "reux-prototype/simulation";

const result = runReuxSimulation(source, {
  simulationName: "personal_finance",
  assumptions: {
    income: 6200,
  },
  scenarios: [
    {
      name: "lower_rent_runtime",
      overrides: {
        rent: 1100,
      },
      changes: [
        {
          period: 6,
          overrides: {
            debt_payment: 0,
          },
        },
      ],
    },
  ],
});
```

`listReuxSimulations(source)` returns product-facing metadata for every simulation in a source file, `getReuxSimulation(source, name)` returns one model, and `runReuxSimulation(source, request)` returns the same run/comparison shape as the CLI. Runtime overrides must reference declared assumptions, keep the original primitive type, preserve declared units, and keep scenario changes inside the forecast window. Invalid requests throw `ReuxSimulationExecutionError` with stable `issues[].path` values so product APIs can return field-level validation messages.

Domain pack reports use dimensions such as `product`, `domain`, and `audience` to classify a simulation against the built-in PLOS and business simulation pack catalog. The report is advisory: it names a matching pack when one exists, reports coverage by dimensions, assumptions, metrics, scenarios, and objectives, and lists suggested assumptions, metrics, scenarios, or objectives that would make the model more complete for that pack. Current built-in packs cover PLOS finance, PLOS habits, business workforce, and business operations, with executable examples now covering PLOS finance, PLOS habits, business workforce, and business operations. This gives PLOS and business simulations a shared vocabulary without forcing every model to use the same shape.

This is not yet the full simulation language. The next layers are richer domain packs for PLOS/business use cases, deeper generated TypeScript clients, and eventually integration with Reux data modules.

## Transition Rules

Transition declarations attach allowed enum-state edges to an entity field:

```dl
transition Order.status {
  Pending -> Paid
  Pending -> Cancelled
}
```

The compiler validates that the target entity and field exist, that the field is enum-typed, and that each `from`/`to` value is declared by the enum. Transition rules are emitted into Schema IR and manifests as compiler-visible domain rules.

For the current runtime subset, literal and enum-parameter assignments inside loaded-entity transactions are guarded when transition rules exist. For example, `order.status = Paid` only updates rows whose current status is one of the declared predecessors of `Paid`; otherwise the transaction fails and rolls back.

If a transaction assigns a literal enum value to a field with transition rules, the target value must appear as a `to` value in at least one rule. This prevents transition-managed fields from silently compiling to unguarded updates.

Inspect transition rules with:

```bash
node dist/cli.js transition-rules examples/pilot_reux.dl
node dist/cli.js transition-rules examples/pilot_reux.dl Order.status
```

## Query Subset

The current query subset supports one scanned entity, optional joins, reusable filter fragments, optional `where`, optional cursor `after`, optional `group by`, optional `order by`, optional `limit`, and `select` projections:

```dl
query highValueUsers(min: Decimal<12,2>): Query<{ email: String?, balance: Decimal<12,2> }> =
  from user in User
  where user.balance > min
  order by user.balance desc
  limit 20
  select { email: user.email, balance: user.balance }
```

Query parameters lower to positional PostgreSQL parameters such as `$1`. Entity field references are validated against Schema IR before SQL is emitted.

`limit` accepts a positive integer literal of 1000 or less, or a non-optional `Int`/`Int64` query parameter. Limited queries must declare `order by` so generated SQL is deterministic:

```dl
query topUsers(maxRows: Int): Query<{ email: String, balance: Decimal<12,2> }> =
  from user in User
  order by user.balance desc
  limit maxRows
  select { email: user.email, balance: user.balance }
```

Cursor-style pagination uses `after` with an ordered and limited query. The `after` predicate must compare against at least one query parameter:

```dl
query activeUserPage(cursorBalance: Decimal<12,2>, pageSize: Int): Query<{ email: String, balance: Decimal<12,2> }> =
  from user in User
  where user.active == true
  after user.balance < cursorBalance
  order by user.balance desc
  limit pageSize
  select { email: user.email, balance: user.balance }
```

`where` predicates support comparisons joined with `and` / `or`, plus parentheses for grouping:

```dl
where (user.balance >= min and user.email != blockedEmail) or user.active == true
```

Supported comparison operators are `==`, `!=`, `>`, `>=`, `<`, and `<=`. Predicate operands may be entity field references, query parameters, string literals, numeric literals, boolean literals, `null`, joined range aliases, or enum literals when compared with enum-typed fields. Query lowering validates bare predicate values so misspelled parameter names fail before SQL execution, and `== null` / `!= null` lower to SQL `IS NULL` / `IS NOT NULL` checks.

Enum fields can be compared with bare enum literals in query predicates. For example, `order.status == Paid` lowers to a PostgreSQL enum literal comparison, and invalid values are rejected during query lowering.

Reusable query fragments package common filters for queries that scan the same entity. Fragment predicates are written against the fragment's range alias; consuming queries may use a different alias, and the compiler remaps the fragment predicate to the query alias:

```dl
query fragment activeUsers(user in User) = where user.active == true

query activePremiumUsers(min: Decimal<12,2>): Query<infer> =
  from user in User
  with activeUsers
  where user.balance > min
  select { email: user.email, balance: user.balance }
```

Fragments are expanded into the query `where` predicate and validated with the consuming query's parameters and aliases.

Record projections must match the declared `Query<{ ... }>` result shape: projected fields must be declared, declared fields must be projected, declared result field types must be valid Reux types, duplicate projected field names are rejected, and simple field optionality must match. Queries may also declare `Query<infer>` to let generated TypeScript API clients infer row types from simple field projections and supported aggregates.

Join support is intentionally narrow and explicit:

```dl
query accountOrders(minTotal: Decimal<12,2>): Query<{ email: String, total: Decimal<12,2> }> =
  from order in Order
  join account in Account on order.account == account
  where order.total > minTotal
  select { email: account.email, total: order.total }
```

The supported join predicate shape is an entity reference compared with a joined range variable, such as `order.account == account`. This lowers to a PostgreSQL foreign-key equality.

Optional relationships may be read with `left join`. Fields projected from a left-joined alias infer as nullable and must be declared as optional when using explicit result types:

```dl
query accountProfiles(): Query<infer> =
  from account in Account
  left join profile in Profile on account.profile == profile
  select { email: account.email, bio: profile.bio }
```

Aggregation support is intentionally narrow:

```dl
query accountOrderSummary(minTotal: Decimal<12,2>): Query<{ email: String, orderCount: Int64, totalSpend: Decimal<12,2> }> =
  from order in Order
  join account in Account on order.account == account
  where order.total > minTotal
  group by account.email
  order by sum(order.total) desc
  select { email: account.email, orderCount: count(), totalSpend: sum(order.total) }
```

Supported aggregate expressions are `count()`, `sum(alias.field)`, `avg(alias.field)`, `min(alias.field)`, and `max(alias.field)`. Grouped record projections must either be grouped expressions or supported aggregate expressions. `count()` is typed as `Int64`; field-based aggregates have the same declared type as the referenced field in the current subset.

## Transaction Function Subset

The compiler can parse transaction functions, emit Transaction IR, lower the supported subset to PostgreSQL statements, and run that subset through `tx-run`.

```dl
transaction function rewardUser(userRef: User, amount: Decimal<12,2>) writes User retry 3 {
  let user = load userRef for update
  user.balance += amount
  save user
  after commit sendRewardEmail(userRef)
}
```

Supported Transaction IR step recognition:

- `let name = load expr for update`
- `idempotency key expr`
- `require condition else abort ErrorName`
- `if condition then abort ErrorName`
- `if condition then target.field += expr`
- `if condition then enqueue Event { ... }`
- `if condition then after commit callName(args)`
- `if condition { ... }` blocks containing `abort`, mutation, `enqueue`, or `after commit` statements
- `target.field += expr`
- `target.field -= expr`
- `target.field = expr`
- `save name`
- `insert Entity { ... }`
- `let name = insert Entity { ... }`
- `enqueue Event { ... }`
- `after commit callName(args)`
- `abort ErrorName`

Unrecognized statements are preserved as raw Transaction IR steps so the compiler can keep source visibility while the transaction language matures.

The compiler also validates the first effect boundary:

- every entity in `writes` must exist;
- `insert Entity` requires `writes Entity`;
- mutation or `save` of an entity loaded from an entity-typed parameter requires `writes Entity`.
- enum-valued inserts and assignments accept bare enum literals and reject values that are not declared by the enum.
- enum-valued inserts and assignments from transaction parameters require the parameter enum type to match the target field enum type.
- mutation, insert, and event payload expressions are checked against target field types for simple parameters, literals, loaded rows, bound insert references, and numeric arithmetic over those values. Nullable expressions may only flow into nullable targets, and nullable numeric values are rejected in arithmetic until the transaction language has explicit null handling.
- `idempotency key expr` lowers to an insert into `_dl_idempotency_keys`, giving retryable callers a first-class durable key.
- `require condition else abort ErrorName` lowers to a SQL guard that rolls back the transaction when the condition is false.
- `if condition then abort ErrorName` lowers to a SQL guard that rolls back the transaction when the condition is true.
- `if condition then target.field += expr` and `if condition then enqueue Event { ... }` lower to conditional SQL side effects.
- `if condition then after commit callName(args)` lowers to a runtime-collected after-commit hook that is returned only when the condition is true.
- `if condition { ... }` block syntax is accepted as a compact form for multiple conditional `abort`, mutation, `enqueue`, or `after commit` statements.
- `require` and `if` guard expressions validate transaction parameters, loaded row fields, bound insert references, enum literals, parenthesized clauses, `not` boolean clauses, `null` checks, and comparison operand types. Unknown bare references, unknown loaded fields, function-call-shaped guard expressions, non-boolean bare clauses, non-numeric ordering comparisons, and incompatible equality comparisons are rejected before SQL lowering.
- `abort ErrorName` lowers to an explicit failing SQL statement so supported transaction runners roll back immediately.
- declared event payloads validate `enqueue Event { ... }` and generate typed worker payload contracts. Generated worker scaffolds also infer after-commit hook names and resolved argument tuple types for supported hook arguments.
- retryable transactions use `retry N`;
- direct external-looking calls such as `sendEmail(user)` are rejected inside retryable transactions;
- `after commit sendEmail(user)` and `enqueue Event { ... }` are allowed retry-safe fences;
- `after commit` hook arguments are validated against transaction parameters, loaded rows, bound insert results, literals, and enum literals;
- `enqueue Event { ... }` is durable at runtime through `_dl_outbox`.

## Name Validation

The compiler rejects duplicate top-level declarations by kind, duplicate durable type names between entities and enums, duplicate fields, duplicate indexes, duplicate enum values, and duplicate query or transaction parameters. This keeps generated manifests, SQL, and lookup commands deterministic.
