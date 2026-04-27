import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  compileSource,
  emitDiffMigration,
  emitInitialMigration,
  emitMigrationPlan,
  emitPostgresSchema,
  emitQueryIr,
  emitQuerySql,
  emitSchemaManifest,
  emitTransitionRules,
  emitTransactionIr,
  emitTransactionSql,
  explainQuery,
} from "../src/compiler.js";
import { DlAggregateError } from "../src/errors.js";

const commerce = `module commerce

entity User {
  id: Id<User> primary generated
  name: String
  email: String? unique
  balance: Decimal default 0

  index byBalance(balance desc)
}

entity Order {
  id: Id<Order> primary generated
  user: User required
  total: Decimal check total >= 0
  status: OrderStatus default Pending
}

enum OrderStatus {
  Pending
  Paid
  Cancelled
}

query highValueUsers(min: Decimal): Query<{ email: String?, balance: Decimal }> =
  from user in User
  where user.balance > min
  order by user.balance desc
  select { email: user.email, balance: user.balance }

transaction function rewardUser(userRef: User, amount: Decimal) writes User retry 3 {
  let user = load userRef for update
  user.balance += amount
  save user
  enqueue RewardGranted { user: userRef, amount: amount }
  after commit sendRewardEmail(userRef)
}
`;

const commerceV2 = `module commerce

entity User {
  id: Id<User> primary generated
  name: String
  email: String? unique
  balance: Decimal default 0
  displayName: String?

  index byBalance(balance desc)
  index byEmail(email asc)
}

entity Order {
  id: Id<Order> primary generated
  user: User required
  total: Decimal check total >= 0
  status: OrderStatus default Pending
}

enum OrderStatus {
  Pending
  Paid
  Cancelled
  Refunded
}

query highValueUsers(min: Decimal): Query<{ email: String?, balance: Decimal }> =
  from user in User
  where user.balance > min
  order by user.balance desc
  select { email: user.email, balance: user.balance }

transaction function rewardUser(userRef: User, amount: Decimal) writes User retry 3 {
  let user = load userRef for update
  user.balance += amount
  save user
  enqueue RewardGranted { user: userRef, amount: amount }
  after commit sendRewardEmail(userRef)
}
`;

describe("compiler prototype", () => {
  it("compiles the Reux pilot source", () => {
    const result = compileSource(readFileSync("examples/pilot_reux.dl", "utf8"));

    expect(result.schema.entities.map((entity) => entity.name)).toEqual(["Account", "Product", "Order", "Payment"]);
    expect(result.program.declarations.some((declaration) => declaration.kind === "transaction" && declaration.name === "capturePayment")).toBe(true);
    expect(result.program.declarations.some((declaration) => declaration.kind === "transaction" && declaration.name === "markOrderPaid")).toBe(true);
    expect(result.program.declarations.some((declaration) => declaration.kind === "transaction" && declaration.name === "creditAccount")).toBe(true);
  });

  it("lowers Reux pilot joins to PostgreSQL", () => {
    const sql = emitQuerySql(readFileSync("examples/pilot_reux.dl", "utf8"), "accountOrders");

    expect(sql).toContain('SELECT "account".email AS email, "order".total AS total, "order".status AS status');
    expect(sql).toContain('FROM orders AS "order"');
    expect(sql).toContain('JOIN accounts AS "account" ON "order".account_id = "account".id');
    expect(sql).toContain('WHERE "order".total > $1');
    expect(sql).toContain('ORDER BY "order".total DESC');
  });

  it("lowers Reux pilot aggregations to PostgreSQL", () => {
    const sql = emitQuerySql(readFileSync("examples/pilot_reux.dl", "utf8"), "accountOrderSummary");

    expect(sql).toContain('SELECT "account".email AS email, count(*) AS orderCount, sum("order".total) AS totalSpend');
    expect(sql).toContain('JOIN accounts AS "account" ON "order".account_id = "account".id');
    expect(sql).toContain('WHERE "order".total > $1');
    expect(sql).toContain('GROUP BY "account".email');
    expect(sql).toContain('ORDER BY sum("order".total) DESC');
  });

  it("lowers broader grouped aggregate functions to PostgreSQL", () => {
    const sql = emitQuerySql(
      `module commerce

entity Account {
  id: Id<Account> primary generated
  email: String
}

entity Order {
  id: Id<Order> primary generated
  account: Account required
  total: Decimal
}

query accountOrderStats(): Query<{ email: String, averageTotal: Decimal, smallestTotal: Decimal, largestTotal: Decimal }> =
  from order in Order
  join account in Account on order.account == account
  group by account.email
  order by max(order.total) desc
  select { email: account.email, averageTotal: avg(order.total), smallestTotal: min(order.total), largestTotal: max(order.total) }
`,
      "accountOrderStats",
    );

    expect(sql).toContain('avg("order".total) AS averageTotal');
    expect(sql).toContain('min("order".total) AS smallestTotal');
    expect(sql).toContain('max("order".total) AS largestTotal');
    expect(sql).toContain('ORDER BY max("order".total) DESC');
  });

  it("lowers the Reux pilot conflict transaction to PostgreSQL", () => {
    const sql = emitTransactionSql(readFileSync("examples/pilot_reux.dl", "utf8"), "creditAccount");

    expect(sql).toContain("SELECT * FROM accounts WHERE id = $1 FOR UPDATE;");
    expect(sql).toContain("UPDATE accounts SET balance = balance + $2 WHERE id = $1;");
    expect(sql).toContain("INSERT INTO _dl_outbox (event_type, payload) VALUES ('AccountCredited', jsonb_build_object('account', $1::uuid, 'amount', $2::numeric)) RETURNING id, event_type, payload;");
    expect(sql).toContain("-- after commit: notifyAccountCredited(accountRef)");
  });

  it("lowers the Reux pilot order transition transaction to guarded PostgreSQL", () => {
    const sql = emitTransactionSql(readFileSync("examples/pilot_reux.dl", "utf8"), "markOrderPaid");

    expect(sql).toContain("-- transition guard: Order.status -> Paid");
    expect(sql).toContain("UPDATE orders SET status = 'Paid' WHERE id = $1 AND status IN ('Pending');");
    expect(sql).toContain("INSERT INTO _dl_outbox (event_type, payload) VALUES ('OrderPaid', jsonb_build_object('order', $1::uuid)) RETURNING id, event_type, payload;");
    expect(sql).toContain("-- after commit: notifyOrderPaid(orderRef)");
  });

  it("builds Schema IR for entities, references, enums, and indexes", () => {
    const { schema } = compileSource(commerce);

    expect(schema.entities).toHaveLength(2);
    expect(schema.enums[0]).toEqual({
      name: "OrderStatus",
      values: ["Pending", "Paid", "Cancelled"],
    });
    expect(schema.entities[1].fields.find((field) => field.name === "user")?.reference).toEqual({
      entity: "User",
      columnName: "user_id",
    });
  });

  it("builds Schema IR for transition rules", () => {
    const { schema } = compileSource(`module commerce

entity Order {
  id: Id<Order> primary generated
  status: OrderStatus default Pending
}

enum OrderStatus {
  Pending
  Paid
  Cancelled
}

transition Order.status {
  Pending -> Paid
  Pending -> Cancelled
}
`);

    expect(schema.transitions).toEqual([
      { entity: "Order", field: "status", enumName: "OrderStatus", from: "Pending", to: "Paid" },
      { entity: "Order", field: "status", enumName: "OrderStatus", from: "Pending", to: "Cancelled" },
    ]);
  });

  it("emits transition rules as inspectable JSON", () => {
    const rules = JSON.parse(
      emitTransitionRules(
        `module commerce

entity Order {
  id: Id<Order> primary generated
  status: OrderStatus
}

enum OrderStatus {
  Pending
  Paid
  Cancelled
}

transition Order.status {
  Pending -> Paid
  Pending -> Cancelled
}
`,
        "Order.status",
      ),
    );

    expect(rules.transitions).toEqual([
      { entity: "Order", field: "status", enumName: "OrderStatus", from: "Pending", to: "Paid" },
      { entity: "Order", field: "status", enumName: "OrderStatus", from: "Pending", to: "Cancelled" },
    ]);
  });

  it("emits PostgreSQL DDL from Schema IR", () => {
    const sql = emitPostgresSchema(commerce);

    expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
    expect(sql).toContain("CREATE TABLE users");
    expect(sql).toContain("id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()");
    expect(sql).toContain("name text NOT NULL");
    expect(sql).toContain("email text NULL UNIQUE");
    expect(sql).toContain("balance numeric NOT NULL DEFAULT 0");
    expect(sql).toContain("CREATE TYPE order_status AS ENUM ('Pending', 'Paid', 'Cancelled');");
    expect(sql).toContain("FOREIGN KEY (user_id) REFERENCES users(id)");
    expect(sql).toContain("CREATE INDEX users_by_balance ON users (balance DESC);");
  });

  it("rejects invalid transition rules", () => {
    expect(() =>
      compileSource(`module commerce

entity Order {
  id: Id<Order> primary generated
  status: OrderStatus
}

enum OrderStatus {
  Pending
  Paid
}

transition Order.status {
  Pending -> Refunded
}
`),
    ).toThrow(DlAggregateError);
  });

  it("explains simple query lowering", () => {
    const explanation = explainQuery(commerce, "highValueUsers");

    expect(explanation).toContain("Result type: Query<{ email: String?, balance: Decimal }>");
    expect(explanation).toContain("Query IR:");
    expect(explanation).toContain('"kind": "Filter"');
    expect(explanation).toContain('SELECT "user".email AS email, "user".balance AS balance');
    expect(explanation).toContain('FROM users AS "user"');
    expect(explanation).toContain('WHERE "user".balance > $1');
    expect(explanation).toContain('ORDER BY "user".balance DESC');
  });

  it("lowers enum literals in query predicates", () => {
    const sql = emitQuerySql(
      `module commerce

entity Order {
  id: Id<Order> primary generated
  status: OrderStatus default Pending
}

enum OrderStatus {
  Pending
  Paid
}

query paidOrders(): Query<Order> =
  from order in Order
  where order.status == Paid
  select order
`,
      "paidOrders",
    );

    expect(sql).toBe('SELECT "order".*\nFROM orders AS "order"\nWHERE "order".status = \'Paid\';');
  });

  it("rejects invalid enum literals in query predicates", () => {
    expect(() =>
      emitQuerySql(
        `module commerce

entity Order {
  id: Id<Order> primary generated
  status: OrderStatus
}

enum OrderStatus {
  Pending
  Paid
}

query refundedOrders(): Query<Order> =
  from order in Order
  where order.status == Refunded
  select order
`,
        "refundedOrders",
      ),
    ).toThrow("query refundedOrders compares Order.status to invalid OrderStatus value Refunded");
  });

  it("emits explicit Query IR", () => {
    const queryIr = JSON.parse(emitQueryIr(commerce, "highValueUsers"));

    expect(queryIr).toMatchObject({
      name: "highValueUsers",
      resultType: "Query<{ email: String?, balance: Decimal }>",
      root: {
        kind: "Map",
        input: {
          kind: "Order",
          input: {
            kind: "Filter",
            input: {
              kind: "Scan",
              entity: "User",
              table: "users",
              alias: "user",
            },
          },
        },
      },
    });
    expect(queryIr.root.input.input.predicate.parameters).toEqual([{ name: "min", position: 1 }]);
  });

  it("emits a hashed schema manifest", () => {
    const manifest = JSON.parse(emitSchemaManifest(commerce));

    expect(manifest.format).toBe("dl.schema.v1");
    expect(manifest.schemaHash).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.schema.entities.map((entity: { name: string }) => entity.name)).toEqual(["Order", "User"]);
  });

  it("creates an initial migration artifact", () => {
    const migration = emitInitialMigration(commerce, "Initial Schema");

    expect(migration.filename).toMatch(/^\d{14}_initial_schema\.sql$/);
    expect(migration.sql).toContain("-- Reux migration: Initial Schema");
    expect(migration.sql).toContain("CREATE TABLE users");
    expect(migration.sql).toContain("CREATE TABLE orders");
  });

  it("plans a conservative migration from an older manifest", () => {
    const previousManifest = emitSchemaManifest(commerce);
    const plan = emitMigrationPlan(previousManifest, commerceV2);

    expect(plan).toContain("Migration plan for module commerce");
    expect(plan).toContain("[safe] add enum value OrderStatus.Refunded");
    expect(plan).toContain("[safe] add field User.displayName");
    expect(plan).toContain("[safe] create index User.byEmail");
    expect(plan).toContain("ALTER TABLE users ADD COLUMN display_name text NULL;");
  });

  it("flags unsafe migration changes without SQL", () => {
    const previousManifest = emitSchemaManifest(commerce);
    const plan = JSON.parse(
      emitMigrationPlan(
        previousManifest,
        `module commerce

entity User {
  id: Id<User> primary generated
  name: String
  email: String? unique
  balance: Decimal default 0
  requiredCode: String
}

entity Order {
  id: Id<Order> primary generated
  user: User required
  total: Decimal check total >= 0
  status: OrderStatus default Pending
}

enum OrderStatus {
  Pending
  Paid
  Cancelled
}
`,
        "json",
      ),
    );

    expect(plan.summary.unsafe).toBeGreaterThan(0);
    expect(plan.operations).toContainEqual(
      expect.objectContaining({
        kind: "add_field",
        safety: "unsafe",
        description: expect.stringContaining("requiredCode"),
      }),
    );
  });

  it("emits Transaction IR for transaction functions", () => {
    const txIr = JSON.parse(emitTransactionIr(commerceV2, "rewardUser"));

    expect(txIr).toEqual({
      name: "rewardUser",
      parameters: [
        { name: "userRef", type: "User" },
        { name: "amount", type: "Decimal" },
      ],
      writes: ["User"],
      retry: { attempts: 3 },
      steps: [
        { kind: "LoadForUpdate", target: "user", source: "userRef" },
        { kind: "Mutation", target: "user.balance", operator: "+=", expression: "amount" },
        { kind: "Save", target: "user" },
        { kind: "Enqueue", event: "RewardGranted", source: "{ user: userRef, amount: amount }" },
        { kind: "AfterCommit", call: "sendRewardEmail(userRef)" },
      ],
    });
  });

  it("lowers simple Transaction IR to PostgreSQL statements", () => {
    const sql = emitTransactionSql(commerceV2, "rewardUser");

    expect(sql).toContain("BEGIN;");
    expect(sql).toContain("SELECT * FROM users WHERE id = $1 FOR UPDATE;");
    expect(sql).toContain("UPDATE users SET balance = balance + $2 WHERE id = $1;");
    expect(sql).toContain("-- save user: staged by explicit mutation statements");
    expect(sql).toContain("INSERT INTO _dl_outbox (event_type, payload) VALUES ('RewardGranted', jsonb_build_object('user', $1::uuid, 'amount', $2::numeric)) RETURNING id, event_type, payload;");
    expect(sql).toContain("-- after commit: sendRewardEmail(userRef)");
    expect(sql).toContain("COMMIT;");
  });

  it("lowers transition rules to guarded transaction updates", () => {
    const sql = emitTransactionSql(
      `module commerce

entity Order {
  id: Id<Order> primary generated
  status: OrderStatus
}

enum OrderStatus {
  Pending
  Paid
  Cancelled
}

transition Order.status {
  Pending -> Paid
  Pending -> Cancelled
}

transaction function markPaid(orderRef: Order) writes Order {
  let order = load orderRef for update
  order.status = Paid
  save order
}
`,
      "markPaid",
    );

    expect(sql).toContain("-- transition guard: Order.status -> Paid");
    expect(sql).toContain("UPDATE orders SET status = 'Paid' WHERE id = $1 AND status IN ('Pending');");
  });

  it("lowers transaction inserts to PostgreSQL insert statements", () => {
    const sql = emitTransactionSql(
      `module banking

entity User {
  id: Id<User> primary generated
}

entity LedgerEntry {
  id: Id<LedgerEntry> primary generated
  user: User required
  amount: Decimal
  kind: String
}

transaction function recordReward(userRef: User, amount: Decimal) writes LedgerEntry retry 3 {
  insert LedgerEntry { user: userRef, amount: amount, kind: "Reward" }
}
`,
      "recordReward",
    );

    expect(sql).toContain("INSERT INTO ledger_entries (user_id, amount, kind) VALUES ($1, $2, 'Reward') RETURNING *;");
  });

  it("lowers bare enum literals in transaction inserts", () => {
    const sql = emitTransactionSql(
      `module commerce

entity Order {
  id: Id<Order> primary generated
}

entity Payment {
  id: Id<Payment> primary generated
  order: Order required
  status: PaymentStatus
}

enum PaymentStatus {
  Authorized
  Captured
}

transaction function capture(orderRef: Order) writes Payment retry 3 {
  insert Payment { order: orderRef, status: Captured }
}
`,
      "capture",
    );

    expect(sql).toContain("INSERT INTO payments (order_id, status) VALUES ($1, 'Captured') RETURNING *;");
  });

  it("rejects invalid enum literals in transaction writes", () => {
    expect(() =>
      compileSource(`module commerce

entity Order {
  id: Id<Order> primary generated
  status: OrderStatus
}

enum OrderStatus {
  Pending
  Paid
}

transaction function markPaid(orderRef: Order) writes Order {
  let order = load orderRef for update
  order.status = Refunded
  save order
}
`),
    ).toThrow(DlAggregateError);
  });

  it("rejects enum assignments with no matching transition target", () => {
    expect(() =>
      compileSource(`module commerce

entity Order {
  id: Id<Order> primary generated
  status: OrderStatus
}

enum OrderStatus {
  Pending
  Paid
}

transition Order.status {
  Pending -> Paid
}

transaction function reopen(orderRef: Order) writes Order {
  let order = load orderRef for update
  order.status = Pending
  save order
}
`),
    ).toThrow(DlAggregateError);
  });

  it("creates a diff migration artifact from a manifest", () => {
    const previousManifest = emitSchemaManifest(commerce);
    const migration = emitDiffMigration(previousManifest, commerceV2, "Commerce V2");

    expect(migration.filename).toMatch(/^\d{14}_commerce_v2\.sql$/);
    expect(migration.sql).toContain("-- Kind: schema diff");
    expect(migration.sql).toContain("ALTER TYPE order_status ADD VALUE 'Refunded';");
    expect(migration.sql).toContain("ALTER TABLE users ADD COLUMN display_name text NULL;");
  });

  it("rejects transaction writes to unknown entities", () => {
    expect(() =>
      compileSource(`module broken

entity User {
  id: Id<User> primary generated
}

transaction function bad(userRef: User) writes Missing {
  let user = load userRef for update
}
`),
    ).toThrow(DlAggregateError);
  });

  it("rejects unknown field types", () => {
    expect(() =>
      compileSource(`module broken

entity User {
  id: Id<User> primary generated
  email: EmailAddress
}
`),
    ).toThrow(DlAggregateError);
  });

  it("rejects duplicate durable declarations and members", () => {
    expect(() =>
      compileSource(`module broken

entity User {
  id: Id<User> primary generated
  email: String
  email: String?

  index byEmail(email asc)
  index byEmail(email desc)
}

entity User {
  id: Id<User> primary generated
}

enum Status {
  Pending
  Pending
}
`),
    ).toThrow(DlAggregateError);
  });

  it("rejects duplicate query and transaction parameters", () => {
    expect(() =>
      compileSource(`module broken

entity User {
  id: Id<User> primary generated
  balance: Decimal default 0
}

query users(min: Decimal, min: Decimal): Query<User> =
  from user in User
  where user.balance > min
  select user

transaction function rewardUser(userRef: User, userRef: User) writes User {
  let user = load userRef for update
  save user
}
`),
    ).toThrow(DlAggregateError);
  });

  it("rejects unknown query fields", () => {
    expect(() =>
      compileSource(`module broken

entity User {
  id: Id<User> primary generated
  email: String
}

query users(): Query<User> =
  from user in User
  where user.balance > 0
  select user
`),
    ).toThrow(DlAggregateError);
  });

  it("rejects query result optionality mismatches", () => {
    expect(() =>
      compileSource(`module broken

entity User {
  id: Id<User> primary generated
  email: String?
}

query users(): Query<{ email: String }> =
  from user in User
  select { email: user.email }
`),
    ).toThrow(DlAggregateError);
  });

  it("rejects query projection/result shape mismatches", () => {
    expect(() =>
      compileSource(`module broken

entity User {
  id: Id<User> primary generated
  email: String
  balance: Decimal
}

query users(): Query<{ email: String, balance: Decimal }> =
  from user in User
  select { email: user.email, email: user.email }
`),
    ).toThrow(DlAggregateError);
  });

  it("rejects grouped projections that are neither grouped nor aggregated", () => {
    expect(() =>
      compileSource(`module broken

entity Account {
  id: Id<Account> primary generated
  email: String
}

entity Order {
  id: Id<Order> primary generated
  account: Account required
  total: Decimal
}

query bad(): Query<{ email: String, total: Decimal }> =
  from order in Order
  join account in Account on order.account == account
  group by account.email
  select { email: account.email, total: order.total }
`),
    ).toThrow(DlAggregateError);
  });

  it("rejects transaction mutations not covered by declared writes", () => {
    expect(() =>
      compileSource(`module broken

entity User {
  id: Id<User> primary generated
  balance: Decimal default 0
}

transaction function bad(userRef: User, amount: Decimal) writes Order {
  let user = load userRef for update
  user.balance += amount
  save user
}

entity Order {
  id: Id<Order> primary generated
}
`),
    ).toThrow(DlAggregateError);
  });

  it("rejects transaction inserts not covered by declared writes", () => {
    expect(() =>
      compileSource(`module broken

entity User {
  id: Id<User> primary generated
}

entity LedgerEntry {
  id: Id<LedgerEntry> primary generated
}

transaction function bad(userRef: User) writes User {
  insert LedgerEntry { user: userRef }
}
`),
    ).toThrow(DlAggregateError);
  });

  it("rejects direct external calls in retryable transactions", () => {
    expect(() =>
      compileSource(`module broken

entity User {
  id: Id<User> primary generated
  balance: Decimal default 0
}

transaction function bad(userRef: User, amount: Decimal) writes User retry 3 {
  let user = load userRef for update
  user.balance += amount
  save user
  sendRewardEmail(userRef)
}
`),
    ).toThrow(DlAggregateError);
  });

  it("allows outbox enqueue and after commit calls in retryable transactions", () => {
    const result = compileSource(`module ok

entity User {
  id: Id<User> primary generated
  balance: Decimal default 0
}

entity RewardEvent {
  id: Id<RewardEvent> primary generated
}

transaction function good(userRef: User, amount: Decimal) writes User retry 3 {
  let user = load userRef for update
  user.balance += amount
  save user
  enqueue RewardRequested { user: userRef }
  after commit sendRewardEmail(userRef)
}
`);

    expect(result.schema.entities.map((entity) => entity.name)).toEqual(["User", "RewardEvent"]);
  });
});
