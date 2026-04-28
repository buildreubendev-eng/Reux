# Reux Language Subset

This prototype implements the first data-module subset of Reux. It is intentionally smaller than the full language in the research architecture.

## Supported Declarations

- `module <name>`
- `entity <Name> { ... }`
- `enum <Name> { ... }`
- `transition <Entity>.<field> { ... }`
- `query <name>(params): Query<T> = from ...`
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
Bool Int Int64 Float Decimal String Bytes Date Time Instant Duration Uuid Json
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

The current query subset supports one scanned entity, optional joins, optional `where`, optional `group by`, optional `order by`, optional `limit`, and `select` projections:

```dl
query highValueUsers(min: Decimal): Query<{ email: String?, balance: Decimal }> =
  from user in User
  where user.balance > min
  order by user.balance desc
  limit 20
  select { email: user.email, balance: user.balance }
```

Query parameters lower to positional PostgreSQL parameters such as `$1`. Entity field references are validated against Schema IR before SQL is emitted.

`limit` accepts a positive integer literal or a non-optional `Int`/`Int64` query parameter:

```dl
query topUsers(maxRows: Int): Query<{ email: String, balance: Decimal }> =
  from user in User
  order by user.balance desc
  limit maxRows
  select { email: user.email, balance: user.balance }
```

Enum fields can be compared with bare enum literals in query predicates. For example, `order.status == Paid` lowers to a PostgreSQL enum literal comparison, and invalid values are rejected during query lowering.

Record projections must match the declared `Query<{ ... }>` result shape: projected fields must be declared, declared fields must be projected, duplicate projected field names are rejected, and simple field optionality must match.

Join support is intentionally narrow and explicit:

```dl
query accountOrders(minTotal: Decimal): Query<{ email: String, total: Decimal }> =
  from order in Order
  join account in Account on order.account == account
  where order.total > minTotal
  select { email: account.email, total: order.total }
```

The supported join predicate shape is an entity reference compared with a joined range variable, such as `order.account == account`. This lowers to a PostgreSQL foreign-key equality.

Aggregation support is intentionally narrow:

```dl
query accountOrderSummary(minTotal: Decimal): Query<{ email: String, orderCount: Int64, totalSpend: Decimal }> =
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
transaction function rewardUser(userRef: User, amount: Decimal) writes User retry 3 {
  let user = load userRef for update
  user.balance += amount
  save user
  after commit sendRewardEmail(userRef)
}
```

Supported Transaction IR step recognition:

- `let name = load expr for update`
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
- retryable transactions use `retry N`;
- direct external-looking calls such as `sendEmail(user)` are rejected inside retryable transactions;
- `after commit sendEmail(user)` and `enqueue Event { ... }` are allowed retry-safe fences;
- `enqueue Event { ... }` is durable at runtime through `_dl_outbox`.

## Name Validation

The compiler rejects duplicate top-level declarations by kind, duplicate durable type names between entities and enums, duplicate fields, duplicate indexes, duplicate enum values, and duplicate query or transaction parameters. This keeps generated manifests, SQL, and lookup commands deterministic.
