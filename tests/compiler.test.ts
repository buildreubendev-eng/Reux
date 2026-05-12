import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  compileSource,
  checkMigrationSafety,
  diagnoseSource,
  emitApiClient,
  emitApiServer,
  emitDiffMigration,
  emitInitialMigration,
  emitMigrationPlan,
  emitPostgresSchema,
  emitQueryIr,
  emitQuerySql,
  emitRuleIr,
  emitRuleSql,
  emitSchemaManifest,
  emitSimulationIr,
  emitSimulationPacks,
  emitSimulationRun,
  emitSimulationTypes,
  emitTransitionRules,
  emitTransactionIr,
  emitTransactionSql,
  emitViewIr,
  emitViewSql,
  emitWorker,
  explainQuery,
  formatReuxSource,
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
    expect(result.schema.entities[0].fields.find((field) => field.name === "balance")?.type.raw).toBe("Decimal<12,2>");
    expect(result.program.declarations.some((declaration) => declaration.kind === "transaction" && declaration.name === "capturePayment")).toBe(true);
    expect(result.program.declarations.some((declaration) => declaration.kind === "transaction" && declaration.name === "markOrderPaid")).toBe(true);
    expect(result.program.declarations.some((declaration) => declaration.kind === "transaction" && declaration.name === "creditAccount")).toBe(true);
  });

  it("formats Reux source with stable indentation", () => {
    const formatted = formatReuxSource(`module demo
entity Account {
id: Id<Account> primary generated
balance: Decimal
}
transaction function debit(accountRef: Account, amount: Decimal) writes Account {
let account = load accountRef for update
require account.balance >= amount else abort InsufficientFunds
account.balance -= amount
save account
}
`);

    expect(formatted).toBe(`module demo
entity Account {
  id: Id<Account> primary generated
  balance: Decimal
}
transaction function debit(accountRef: Account, amount: Decimal) writes Account {
  let account = load accountRef for update
  require account.balance >= amount else abort InsufficientFunds
  account.balance -= amount
  save account
}
`);
    expect(() => compileSource(formatted)).not.toThrow();
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

  it("compiles the logistics pilot source", () => {
    const result = compileSource(readFileSync("examples/logistics_reux.dl", "utf8"));

    expect(result.schema.entities.map((entity) => entity.name)).toEqual(["Driver", "Vehicle", "Shipment"]);
    expect(result.schema.enums[0]).toEqual({
      name: "ShipmentStatus",
      values: ["Scheduled", "InTransit", "Delivered", "Exception"],
    });
    expect(result.schema.transitions).toHaveLength(4);
    expect(result.program.declarations.some((declaration) => declaration.kind === "transaction" && declaration.name === "startShipment")).toBe(true);
    expect(result.program.declarations.some((declaration) => declaration.kind === "transaction" && declaration.name === "markDelivered")).toBe(true);
    expect(result.program.declarations.some((declaration) => declaration.kind === "transaction" && declaration.name === "creditDriver")).toBe(true);
  });

  it("lowers logistics pilot joins and aggregations to PostgreSQL", () => {
    const source = readFileSync("examples/logistics_reux.dl", "utf8");
    const manifestSql = emitQuerySql(source, "driverManifest");
    const summarySql = emitQuerySql(source, "shipmentStatusSummary");

    expect(manifestSql).toContain('JOIN drivers AS "driver" ON "shipment".driver_id = "driver".id');
    expect(manifestSql).toContain('SELECT "driver".email AS email, "shipment".tracking_number AS trackingNumber');
    expect(summarySql).toContain('SELECT "shipment".status AS status, count(*) AS shipmentCount, sum("shipment".weight) AS totalWeight');
    expect(summarySql).toContain('GROUP BY "shipment".status');
  });

  it("lowers logistics pilot transitions and outbox events to guarded PostgreSQL", () => {
    const source = readFileSync("examples/logistics_reux.dl", "utf8");
    const startSql = emitTransactionSql(source, "startShipment");
    const deliveredSql = emitTransactionSql(source, "markDelivered");
    const creditSql = emitTransactionSql(source, "creditDriver");

    expect(startSql).toContain("-- transition guard: Shipment.status -> InTransit");
    expect(startSql).toContain("UPDATE shipments SET status = 'InTransit' WHERE id = $1 AND status IN ('Scheduled', 'Exception');");
    expect(startSql).toContain("INSERT INTO _dl_outbox (event_type, payload) VALUES ('ShipmentStarted'");
    expect(deliveredSql).toContain("-- transition guard: Shipment.status -> Delivered");
    expect(deliveredSql).toContain("UPDATE shipments SET status = 'Delivered' WHERE id = $1 AND status IN ('InTransit');");
    expect(deliveredSql).toContain("INSERT INTO _dl_outbox (event_type, payload) VALUES ('ShipmentDelivered'");
    expect(creditSql).toContain("UPDATE drivers SET payout_balance = payout_balance + $2 WHERE id = $1;");
    expect(creditSql).toContain("INSERT INTO _dl_outbox (event_type, payload) VALUES ('DriverCredited'");
  });

  it("compiles the clinic pilot source", () => {
    const result = compileSource(readFileSync("examples/clinic_reux.dl", "utf8"));

    expect(result.schema.entities.map((entity) => entity.name)).toEqual(["Patient", "Clinician", "Visit", "CareTask"]);
    expect(result.schema.enums.map((enumDecl) => enumDecl.name)).toEqual(["VisitStatus", "VisitPriority", "TaskStatus"]);
    expect(result.schema.transitions).toHaveLength(9);
    expect(result.program.declarations.some((declaration) => declaration.kind === "transaction" && declaration.name === "checkInVisit")).toBe(true);
    expect(result.program.declarations.some((declaration) => declaration.kind === "transaction" && declaration.name === "completeVisit")).toBe(true);
    expect(result.program.declarations.some((declaration) => declaration.kind === "transaction" && declaration.name === "assignCareTask")).toBe(true);
    expect(result.program.declarations.some((declaration) => declaration.kind === "transaction" && declaration.name === "closeCareTask")).toBe(true);
  });

  it("lowers clinic pilot joins and aggregations to PostgreSQL", () => {
    const source = readFileSync("examples/clinic_reux.dl", "utf8");
    const visitsSql = emitQuerySql(source, "upcomingVisits");
    const taskLoadSql = emitQuerySql(source, "clinicianTaskLoad");
    const statusSummarySql = emitQuerySql(source, "visitStatusSummary");

    expect(visitsSql).toContain('JOIN patients AS "patient" ON "visit".patient_id = "patient".id');
    expect(visitsSql).toContain('JOIN clinicians AS "clinician" ON "visit".clinician_id = "clinician".id');
    expect(visitsSql).toContain('ORDER BY "visit".scheduled_at ASC');
    expect(taskLoadSql).toContain('SELECT "clinician".email AS clinicianEmail, count(*) AS taskCount, sum("task".effort_hours) AS totalEffort');
    expect(taskLoadSql).toContain('GROUP BY "clinician".email');
    expect(statusSummarySql).toContain('SELECT "visit".status AS status, count(*) AS visitCount, sum("visit".copay) AS totalCopay');
    expect(statusSummarySql).toContain('GROUP BY "visit".status');
  });

  it("lowers clinic pilot transitions, inserts, and outbox events to PostgreSQL", () => {
    const source = readFileSync("examples/clinic_reux.dl", "utf8");
    const checkInSql = emitTransactionSql(source, "checkInVisit");
    const completeSql = emitTransactionSql(source, "completeVisit");
    const assignSql = emitTransactionSql(source, "assignCareTask");
    const closeSql = emitTransactionSql(source, "closeCareTask");

    expect(checkInSql).toContain("-- transition guard: Visit.status -> CheckedIn");
    expect(checkInSql).toContain("UPDATE visits SET status = 'CheckedIn' WHERE id = $1 AND status IN ('Scheduled');");
    expect(checkInSql).toContain("INSERT INTO _dl_outbox (event_type, payload) VALUES ('VisitCheckedIn'");
    expect(completeSql).toContain("-- transition guard: Visit.status -> Completed");
    expect(completeSql).toContain("UPDATE visits SET status = 'Completed' WHERE id = $1 AND status IN ('CheckedIn');");
    expect(completeSql).toContain("INSERT INTO _dl_outbox (event_type, payload) VALUES ('VisitCompleted'");
    expect(assignSql).toContain("INSERT INTO care_tasks (visit_id, owner_id, description, effort_hours, status) VALUES ($1, $2, $3, $4, 'Open') RETURNING *;");
    expect(assignSql).toContain("INSERT INTO _dl_outbox (event_type, payload) VALUES ('CareTaskCreated'");
    expect(closeSql).toContain("-- transition guard: CareTask.status -> Done");
    expect(closeSql).toContain("UPDATE care_tasks SET status = 'Done' WHERE id = $1 AND status IN ('Open', 'Blocked');");
    expect(closeSql).toContain("INSERT INTO _dl_outbox (event_type, payload) VALUES ('CareTaskClosed'");
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

  it("lowers query limit clauses to PostgreSQL", () => {
    const source = `module commerce

entity User {
  id: Id<User> primary generated
  email: String
  balance: Decimal
}

query topUsers(maxRows: Int): Query<{ email: String, balance: Decimal }> =
  from user in User
  order by user.balance desc
  limit maxRows
  select { email: user.email, balance: user.balance }
`;
    const queryIr = JSON.parse(emitQueryIr(source, "topUsers"));
    const sql = emitQuerySql(source, "topUsers");

    expect(queryIr.root.input).toMatchObject({
      kind: "Limit",
      count: {
        source: "maxRows",
        parameters: [{ name: "maxRows", position: 1 }],
      },
    });
    expect(sql).toContain('ORDER BY "user".balance DESC');
    expect(sql).toContain("LIMIT $1;");
  });

  it("lowers cursor-style after clauses to bounded PostgreSQL pagination", () => {
    const sql = emitQuerySql(
      `module commerce

entity User {
  id: Id<User> primary generated
  email: String
  balance: Decimal
  active: Bool
}

query activeUserPage(cursorBalance: Decimal, pageSize: Int): Query<{ email: String, balance: Decimal }> =
  from user in User
  where user.active == true
  after user.balance < cursorBalance
  order by user.balance desc
  limit pageSize
  select { email: user.email, balance: user.balance }
`,
      "activeUserPage",
    );

    expect(sql).toContain('WHERE ("user".active = true) AND ("user".balance < $1)');
    expect(sql).toContain('ORDER BY "user".balance DESC');
    expect(sql).toContain("LIMIT $2;");
  });

  it("rejects unsafe pagination shapes", () => {
    expect(() =>
      compileSource(`module broken

entity User {
  id: Id<User> primary generated
  email: String
}

query users(): Query<User> =
  from user in User
  limit 1001
  select user
`),
    ).toThrow(DlAggregateError);

    expect(() =>
      compileSource(`module broken

entity User {
  id: Id<User> primary generated
  email: String
}

query users(cursor: String): Query<User> =
  from user in User
  after user.email > cursor
  select user
`),
    ).toThrow(DlAggregateError);
  });

  it("rejects non-integer query limits", () => {
    expect(() =>
      compileSource(`module broken

entity User {
  id: Id<User> primary generated
  email: String
}

query users(limitText: String): Query<User> =
  from user in User
  limit limitText
  select user
`),
    ).toThrow(DlAggregateError);

    expect(() =>
      compileSource(`module broken

entity User {
  id: Id<User> primary generated
  email: String
}

query users(): Query<User> =
  from user in User
  limit user.email
  select user
`),
    ).toThrow(DlAggregateError);
  });

  it("lowers the Reux pilot conflict transaction to PostgreSQL", () => {
    const sql = emitTransactionSql(readFileSync("examples/pilot_reux.dl", "utf8"), "creditAccount");

    expect(sql).toContain("-- bind result: account");
    expect(sql).toContain("SELECT * FROM accounts WHERE id = $1 FOR UPDATE;");
    expect(sql).toContain("UPDATE accounts SET balance = balance + $2 WHERE id = $1;");
    expect(sql).toContain("INSERT INTO _dl_outbox (event_type, payload) VALUES ('AccountCredited', jsonb_build_object('account', $1::uuid, 'amount', $2::numeric(12, 2))) RETURNING id, event_type, payload;");
    expect(sql).toContain("-- after commit: notifyAccountCredited(accountRef)");
  });

  it("uses the bound Reux pilot payment row in outbox payloads", () => {
    const sql = emitTransactionSql(readFileSync("examples/pilot_reux.dl", "utf8"), "capturePayment");

    expect(sql).toContain("-- bind result: order");
    expect(sql).toContain("INSERT INTO payments (order_id, amount, currency, status) VALUES ($1, $2, :order.currency, 'Captured') RETURNING *;");
    expect(sql).toContain("-- bind result: payment");
    expect(sql).toContain("jsonb_build_object('payment', :payment.id::uuid, 'order', $1::uuid, 'amount', $2::numeric(12, 2), 'currency', :order.currency::char(3))");
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

  it("reports compile diagnostics without throwing", () => {
    const report = diagnoseSource(`module broken

entity User {
  id: Id<User> primary generated
  email: MissingType
}
`);

    expect(report).toEqual({
      ok: false,
      diagnostics: [{ severity: "error", message: "User.email uses unknown type MissingType" }],
    });
  });

  it("parses compiler-visible view and rule declarations", () => {
    const result = compileSource(readFileSync("examples/plos_executive.reux", "utf8"));
    const view = result.program.declarations.find((declaration) => declaration.kind === "view");
    const rules = result.program.declarations.filter((declaration) => declaration.kind === "rule");

    expect(view).toEqual({
      kind: "view",
      name: "DailyCommandBrief",
      metrics: [
        { name: "openDecisions", expression: "count Decision where status != Approved" },
        { name: "blockedImpact", expression: "sum Decision.estimatedImpact where status == Blocked" },
        { name: "averageConfidence", expression: "avg Decision.confidence where status != Approved" },
        { name: "overdueFollowUps", expression: "count FollowUp where status == Overdue" },
        { name: "highRisks", expression: "count RiskItem where severity in [High, Critical]" },
      ],
    });
    expect(rules).toEqual([
      {
        kind: "rule",
        name: "overdue_follow_up",
        when: "FollowUp.status != Complete and FollowUp.dueDate < today()",
        actions: [{ source: "mark FollowUp.status = Overdue" }],
      },
      {
        kind: "rule",
        name: "critical_risk_attention",
        when: "RiskItem.severity == Critical",
        actions: [{ source: "notify owner" }],
      },
    ]);
  });

  it("includes views and rules in diagnosis summaries", () => {
    const report = diagnoseSource(readFileSync("examples/plos_executive.reux", "utf8"));

    expect(report.ok).toBe(true);
    expect(report.summary).toMatchObject({
      views: 1,
      rules: 2,
    });
  });

  it("emits View IR and SQL for PLOS Executive command briefs", () => {
    const source = readFileSync("examples/plos_executive.reux", "utf8");
    const viewIr = JSON.parse(emitViewIr(source, "DailyCommandBrief"));
    const sql = emitViewSql(source, "DailyCommandBrief");

    expect(viewIr).toMatchObject({
      name: "DailyCommandBrief",
      metrics: [
        {
          name: "openDecisions",
          aggregate: "count",
          entity: "Decision",
          table: "decisions",
          predicate: {
            fields: [{ entity: "Decision", field: "status", column: "status" }],
            enumLiterals: [{ enumName: "DecisionStatus", value: "Approved" }],
          },
        },
        {
          name: "blockedImpact",
          aggregate: "sum",
          entity: "Decision",
          table: "decisions",
          field: { field: "estimatedImpact", column: "estimated_impact", type: "Decimal<12, 2>" },
          predicate: {
            fields: [{ entity: "Decision", field: "status", column: "status" }],
            enumLiterals: [{ enumName: "DecisionStatus", value: "Blocked" }],
          },
        },
        {
          name: "averageConfidence",
          aggregate: "avg",
          entity: "Decision",
          table: "decisions",
          field: { field: "confidence", column: "confidence", type: "Float" },
          predicate: {
            fields: [{ entity: "Decision", field: "status", column: "status" }],
            enumLiterals: [{ enumName: "DecisionStatus", value: "Approved" }],
          },
        },
        {
          name: "overdueFollowUps",
          aggregate: "count",
          entity: "FollowUp",
          table: "follow_ups",
        },
        {
          name: "highRisks",
          aggregate: "count",
          entity: "RiskItem",
          table: "risk_items",
          predicate: {
            enumLiterals: [
              { enumName: "RiskSeverity", value: "High" },
              { enumName: "RiskSeverity", value: "Critical" },
            ],
          },
        },
      ],
    });
    expect(sql).toBe(
      [
        "SELECT",
        "  (SELECT count(*) FROM decisions AS \"_row\" WHERE \"_row\".\"status\" <> 'Approved') AS \"openDecisions\",",
        "  (SELECT sum(\"_row\".\"estimated_impact\") FROM decisions AS \"_row\" WHERE \"_row\".\"status\" = 'Blocked') AS \"blockedImpact\",",
        "  (SELECT avg(\"_row\".\"confidence\") FROM decisions AS \"_row\" WHERE \"_row\".\"status\" <> 'Approved') AS \"averageConfidence\",",
        "  (SELECT count(*) FROM follow_ups AS \"_row\" WHERE \"_row\".\"status\" = 'Overdue') AS \"overdueFollowUps\",",
        "  (SELECT count(*) FROM risk_items AS \"_row\" WHERE \"_row\".\"severity\" IN ('High', 'Critical')) AS \"highRisks\";",
      ].join("\n"),
    );
  });

  it("rejects duplicate view metrics", () => {
    expect(() =>
      compileSource(`module broken

entity Decision {
  id: Id<Decision> primary generated
}

view DailyCommandBrief {
  openDecisions = count Decision
  openDecisions = count Decision
}
`),
    ).toThrow(DlAggregateError);
  });

  it("rejects unsupported and invalid view metrics", () => {
    expect(() =>
      emitViewIr(
        `module broken

entity Decision {
  id: Id<Decision> primary generated
}

view DailyCommandBrief {
  openDecisions = sum Decision
}
`,
        "DailyCommandBrief",
      ),
    ).toThrow("sum metrics require Entity.field");

    expect(() =>
      emitViewIr(
        `module broken

entity Decision {
  id: Id<Decision> primary generated
  title: String
}

view DailyCommandBrief {
  titleTotal = sum Decision.title
}
`,
        "DailyCommandBrief",
      ),
    ).toThrow("sum requires numeric field Decision.title");

    expect(() =>
      emitViewSql(
        `module broken

entity Decision {
  id: Id<Decision> primary generated
  status: DecisionStatus
}

enum DecisionStatus {
  Pending
  Approved
}

view DailyCommandBrief {
  openDecisions = count Decision where status == Missing
}
`,
        "DailyCommandBrief",
      ),
    ).toThrow("unknown value Missing for Decision.status");
  });

  it("emits Rule IR and SQL for PLOS Executive operating rules", () => {
    const source = readFileSync("examples/plos_executive.reux", "utf8");
    const overdueRule = JSON.parse(emitRuleIr(source, "overdue_follow_up"));
    const overdueSql = emitRuleSql(source, "overdue_follow_up");
    const notifyRule = JSON.parse(emitRuleIr(source, "critical_risk_attention"));
    const notifySql = emitRuleSql(source, "critical_risk_attention");

    expect(overdueRule).toMatchObject({
      name: "overdue_follow_up",
      entity: "FollowUp",
      table: "follow_ups",
      condition: {
        fields: [
          { entity: "FollowUp", field: "status", column: "status" },
          { entity: "FollowUp", field: "dueDate", column: "due_date" },
        ],
        enumLiterals: [{ enumName: "FollowUpStatus", value: "Complete" }],
      },
      actions: [
        {
          kind: "Mark",
          entity: "FollowUp",
          field: { field: "status", column: "status" },
          value: { kind: "Identifier", name: "Overdue" },
        },
      ],
    });
    expect(overdueSql).toBe(
      [
        'UPDATE follow_ups AS "_row"',
        'SET "status" = \'Overdue\'',
        'WHERE "_row"."status" <> \'Complete\' AND "_row"."due_date" < CURRENT_DATE',
        'RETURNING "_row".*;',
      ].join("\n"),
    );

    expect(notifyRule).toMatchObject({
      name: "critical_risk_attention",
      entity: "RiskItem",
      table: "risk_items",
      actions: [
        {
          kind: "Notify",
          recipient: { field: "owner", column: "owner" },
        },
      ],
    });
    expect(notifySql).toBe(
      [
        "WITH matched AS (",
        '  SELECT "_row"."id"::text AS record_id, "_row"."owner"::text AS recipient',
        '  FROM risk_items AS "_row"',
        '  WHERE "_row"."severity" = \'Critical\'',
        "), inserted_keys AS (",
        "  INSERT INTO _dl_rule_notifications (rule_name, entity_name, record_id, recipient_field, recipient)",
        "  SELECT 'critical_risk_attention', 'RiskItem', matched.record_id, 'owner', matched.recipient",
        "  FROM matched",
        "  ON CONFLICT (rule_name, entity_name, record_id, recipient_field) DO UPDATE",
        "  SET recipient = EXCLUDED.recipient,",
        "      status = 'open',",
        "      resolved_at = NULL,",
        "      last_seen_at = now()",
        "  WHERE _dl_rule_notifications.status <> 'open'",
        "     OR _dl_rule_notifications.resolved_at IS NOT NULL",
        "     OR _dl_rule_notifications.recipient IS DISTINCT FROM EXCLUDED.recipient",
        "  RETURNING rule_name, entity_name, record_id, recipient_field, recipient",
        ")",
        "INSERT INTO _dl_outbox (event_type, payload)",
        "SELECT 'RuleNotificationRequested', jsonb_build_object('rule', rule_name, 'entity', entity_name, 'recordId', record_id, 'recipientField', recipient_field, 'recipient', recipient)",
        "FROM inserted_keys",
        "RETURNING id, event_type, payload;",
      ].join("\n"),
    );
  });

  it("rejects unsupported and invalid executable rules", () => {
    expect(() =>
      emitRuleSql(
        `module broken

entity FollowUp {
  id: Id<FollowUp> primary generated
  status: FollowUpStatus
}

enum FollowUpStatus {
  Open
  Complete
}

rule bad_value {
  when FollowUp.status == Missing
  then mark FollowUp.status = Complete
}
`,
        "bad_value",
      ),
    ).toThrow("unknown value Missing for FollowUp.status");

    expect(() =>
      emitRuleIr(
        `module broken

entity FollowUp {
  id: Id<FollowUp> primary generated
  status: FollowUpStatus
}

enum FollowUpStatus {
  Open
  Complete
}

rule bad_action {
  when FollowUp.status != Complete
  then archive FollowUp
}
`,
        "bad_action",
      ),
    ).toThrow("is not executable yet");
  });

  it("rejects malformed rule declarations", () => {
    expect(() =>
      compileSource(`module broken

entity Decision {
  id: Id<Decision> primary generated
}

rule missing_action {
  when Decision.id != null
}
`),
    ).toThrow("missing a then action");
  });

  it("parses simulation declarations and emits prototype forecast runs", () => {
    const source = `module personal_life

simulate personal_finance {
  dimension product = PLOS
  dimension domain = finance
  income = 5000 USD
  rent = 1500 USD
  debt_payment = 500 USD
  formula cash_flow = income - rent - debt_payment
  formula annual_surplus = cash_flow * 12
  objective maximize cash_flow
  objective maximize annual_surplus

  scenario lower_rent {
    rent = 1200 USD
  }

  forecast 12 months
}
`;
    const ir = JSON.parse(emitSimulationIr(source));
    const run = JSON.parse(emitSimulationRun(source, "personal_finance"));

    expect(ir).toEqual({
      name: "personal_finance",
      dimensions: [
        { name: "product", value: "PLOS" },
        { name: "domain", value: "finance" },
      ],
      assumptions: [
        { name: "income", type: "number", value: 5000, unit: "USD" },
        { name: "rent", type: "number", value: 1500, unit: "USD" },
        { name: "debt_payment", type: "number", value: 500, unit: "USD" },
      ],
      formulas: [
        { name: "cash_flow", expression: "income - rent - debt_payment", references: ["debt_payment", "income", "rent"], unit: "USD" },
        { name: "annual_surplus", expression: "cash_flow * 12", references: ["cash_flow"], unit: "USD" },
      ],
      objectives: [
        { metric: "cash_flow", direction: "maximize" },
        { metric: "annual_surplus", direction: "maximize" },
      ],
      scenarios: [{ name: "lower_rent", overrides: [{ name: "rent", type: "number", value: 1200, unit: "USD" }], changes: [] }],
      changes: [],
      forecast: { periods: 12, unit: "month" },
    });
    expect(run.model).toBe("prototype-formula-forecast");
    expect(run.dimensions).toEqual({ product: "PLOS", domain: "finance" });
    expect(run.objectives).toEqual([
      { metric: "cash_flow", direction: "maximize" },
      { metric: "annual_surplus", direction: "maximize" },
    ]);
    expect(run.periods).toHaveLength(12);
    expect(run.periods[0].metrics.cash_flow).toBe(3000);
    expect(run.periods[0].metrics.annual_surplus).toBe(36000);
    expect(run.periods[0].metricUnits).toEqual({ cash_flow: "USD", annual_surplus: "USD" });
    expect(run.scenarios).toHaveLength(2);
    expect(run.scenarios[1].periods[0].metrics.cash_flow).toBe(3300);
    expect(run.comparison.scenarios[0].metricDeltas).toEqual({ cash_flow: 300, annual_surplus: 3600 });
    expect(run.comparison.scenarios[0].metricUnits).toEqual({ cash_flow: "USD", annual_surplus: "USD" });
    expect(run.comparison.scenarios[0].firstDivergence).toMatchObject({
      period: 1,
      label: "1 month",
      metricDeltas: { cash_flow: 300, annual_surplus: 3600 },
    });
    expect(run.comparison.scenarios[0].periodDeltas).toHaveLength(12);
    expect(run.comparison.metricRankings).toEqual([
      {
        metric: "annual_surplus",
        unit: "USD",
        objective: "maximize",
        direction: "descending_delta",
        scenarios: [{ name: "lower_rent", delta: 3600, rank: 1 }],
      },
      {
        metric: "cash_flow",
        unit: "USD",
        objective: "maximize",
        direction: "descending_delta",
        scenarios: [{ name: "lower_rent", delta: 300, rank: 1 }],
      },
    ]);
    expect(run.comparison.explanations[1]).toEqual({
      metric: "cash_flow",
      unit: "USD",
      objective: "maximize",
      preferredScenario: "lower_rent",
      preferredDelta: 300,
      firstDivergence: {
        scenario: "lower_rent",
        period: 1,
        label: "1 month",
      },
      summary: "lower_rent ranks first for cash_flow under the maximize objective with a final delta of 300 USD. First divergence occurs at 1 month.",
    });
  });

  it("emits prototype index metrics for rate-based simulations", () => {
    const run = JSON.parse(emitSimulationRun(readFileSync("examples/simulations/workforce_change.reux", "utf8")));

    expect(run.name).toBe("workforce_change");
    expect(run.dimensions).toEqual({ product: "business_simulation", domain: "workforce", audience: "enterprise" });
    expect(run.forecast).toEqual({ periods: 6, unit: "month" });
    expect(run.periods[0].metrics.productivity_index).toBe(108);
    expect(run.periods[0].metrics.operating_relief).toBe(0.18);
    expect(run.periods[0].metricUnits).toEqual({ operating_relief: "percent" });
    expect(run.timeSeries.metrics.find((series: { name: string }) => series.name === "productivity_index")).toMatchObject({
      name: "productivity_index",
      points: [
        { period: 1, label: "1 month", value: 108 },
        { period: 2, label: "2 months", value: 108 },
        { period: 3, label: "3 months", value: 108 },
        { period: 4, label: "4 months", value: 110 },
        { period: 5, label: "5 months", value: 110 },
        { period: 6, label: "6 months", value: 110 },
      ],
    });
    expect(run.timeSeries.assumptions.find((series: { name: string }) => series.name === "productivity_gain")).toMatchObject({
      name: "productivity_gain",
      unit: "percent",
      points: [
        { period: 1, value: 0.08, changedFromPrevious: false, changedFromBaseline: false, deltaFromPrevious: 0, deltaFromBaseline: 0 },
        { period: 2, value: 0.08, changedFromPrevious: false, changedFromBaseline: false, deltaFromPrevious: 0, deltaFromBaseline: 0 },
        { period: 3, value: 0.08, changedFromPrevious: false, changedFromBaseline: false, deltaFromPrevious: 0, deltaFromBaseline: 0 },
        { period: 4, value: 0.1, changedFromPrevious: true, changedFromBaseline: true, deltaFromPrevious: 0.02, deltaFromBaseline: 0.02 },
        { period: 5, value: 0.1, changedFromPrevious: false, changedFromBaseline: true, deltaFromPrevious: 0, deltaFromBaseline: 0.02 },
        { period: 6, value: 0.1, changedFromPrevious: false, changedFromBaseline: true, deltaFromPrevious: 0, deltaFromBaseline: 0.02 },
      ],
    });
    expect(run.periods[3].assumptionDeltas.productivity_gain).toMatchObject({
      name: "productivity_gain",
      baseline: 0.08,
      previous: 0.08,
      current: 0.1,
      changedFromPrevious: true,
      changedFromBaseline: true,
      deltaFromPrevious: 0.02,
      deltaFromBaseline: 0.02,
      unit: "percent",
    });
    expect(run.periods[4].assumptionDeltas.productivity_gain).toMatchObject({
      previous: 0.1,
      current: 0.1,
      changedFromPrevious: false,
      changedFromBaseline: true,
      deltaFromPrevious: 0,
      deltaFromBaseline: 0.02,
    });
    expect(run.comparison.scenarios.map((scenario: { name: string }) => scenario.name)).toEqual(["stronger_training", "no_overtime_change"]);
    expect(run.scenarios[1].periods[3].metrics.productivity_index).toBe(114);
    expect(run.scenarios[1].periods[3].metrics.operating_relief).toBe(0.24);
    expect(run.scenarios[1].periods[3].assumptionDeltas.productivity_gain).toMatchObject({
      baseline: 0.12,
      previous: 0.12,
      current: 0.14,
      changedFromPrevious: true,
      changedFromBaseline: true,
      deltaFromPrevious: 0.02,
      deltaFromBaseline: 0.02,
    });
    expect(run.comparison.scenarios[0].metricDeltas).toEqual({ productivity_index: 4, operating_relief: 0.04 });
    expect(run.comparison.scenarios[0].periodDeltas[0].metricDeltas).toEqual({ productivity_index: 4, operating_relief: 0.04 });
    expect(run.comparison.scenarios[0].periodDeltas[3].metricDeltas).toEqual({ productivity_index: 4, operating_relief: 0.04 });
    expect(run.comparison.metricRankings.find((ranking: { metric: string }) => ranking.metric === "operating_relief")).toEqual({
      metric: "operating_relief",
      unit: "percent",
      objective: "maximize",
      direction: "descending_delta",
      scenarios: [
        { name: "stronger_training", delta: 0.04, rank: 1 },
        { name: "no_overtime_change", delta: -0.1, rank: 2 },
      ],
    });
    expect(run.comparison.explanations.find((explanation: { metric: string }) => explanation.metric === "operating_relief")).toMatchObject({
      metric: "operating_relief",
      unit: "percent",
      objective: "maximize",
      preferredScenario: "stronger_training",
      preferredDelta: 0.04,
      firstDivergence: { scenario: "stronger_training", period: 1, label: "1 month" },
    });
  });

  it("ranks minimize simulation objectives by lower final deltas", () => {
    const run = JSON.parse(
      emitSimulationRun(`module ops

simulate support_cost {
  software_cost = 300 USD
  labor_cost = 700 USD
  formula total_cost = software_cost + labor_cost
  objective minimize total_cost

  scenario automation {
    labor_cost = 500 USD
  }

  scenario manual_growth {
    labor_cost = 900 USD
  }

  forecast 1 month
}
`),
    );

    expect(run.comparison.metricRankings).toEqual([
      {
        metric: "total_cost",
        unit: "USD",
        objective: "minimize",
        direction: "ascending_delta",
        scenarios: [
          { name: "automation", delta: -200, rank: 1 },
          { name: "manual_growth", delta: 200, rank: 2 },
        ],
      },
    ]);
  });

  it("emits TypeScript contracts for simulations", () => {
    const types = emitSimulationTypes(readFileSync("examples/simulations/workforce_change.reux", "utf8"));

    expect(types).toContain("export type WorkforceChangeAssumptionName = \"employees\" | \"productivity_gain\" | \"overtime_reduction\";");
    expect(types).toContain("export type WorkforceChangeDimensionName = \"product\" | \"domain\" | \"audience\";");
    expect(types).toContain("export type WorkforceChangeMetricName = \"operating_relief\" | \"productivity_index\";");
    expect(types).toContain("export type WorkforceChangeScenarioName = \"baseline\" | \"stronger_training\" | \"no_overtime_change\";");
    expect(types).toContain("export interface WorkforceChangeAssumptions");
    expect(types).toContain("export interface ReuxSimulationExplanation<ScenarioName extends string, MetricName extends string>");
    expect(types).toContain("export interface ReuxSimulationAssumptionDelta<Value = ReuxSimulationValue>");
    expect(types).toContain("export interface ReuxSimulationTimeSeries<Assumptions extends object, Metrics extends object>");
    expect(types).toContain("export interface ReuxSimulationMetricSummary<ScenarioName extends string, MetricName extends string>");
    expect(types).toContain("assumptionDeltas: Partial<{ [Name in keyof Assumptions]: ReuxSimulationAssumptionDelta<Assumptions[Name]> }>;");
    expect(types).toContain("timeSeries: ReuxSimulationTimeSeries<Assumptions, Metrics>;");
    expect(types).toContain("export function formatReuxSimulationDelta(delta: number | undefined, unit?: string): string");
    expect(types).toContain("export function summarizeReuxSimulationComparison<ScenarioName extends string, Metrics extends object, MetricName extends string>");
    expect(types).toContain("export function listReuxSimulationScenarioDeltas<ScenarioName extends string, Metrics extends object, MetricName extends string>");
    expect(types).toContain("productivity_gain: number;");
    expect(types).toContain("export type WorkforceChangeRun = ReuxSimulationRun<WorkforceChangeSimulationName, WorkforceChangeScenarioName, WorkforceChangeAssumptions, WorkforceChangeMetrics, WorkforceChangeMetricName>;");
    expect(types).toContain("export const workforceChangeSimulation = {");
    expect(types).toContain("} as const satisfies ReuxSimulationMetadata;");
    expect(types).toContain("export const reuxSimulationCatalog = [workforceChangeSimulation] as const;");
    expect(types).toContain("export function listReuxSimulationNames(): Array<ReuxGeneratedSimulationMetadata[\"name\"]>");
    expect(types).toContain("export function findReuxSimulationMetadata(name: string): ReuxGeneratedSimulationMetadata | undefined");
    expect(types).toContain("\"dimensions\": [");
    expect(types).toContain("\"direction\": \"maximize\"");
  });

  it("reports simulation domain pack coverage", () => {
    const report = JSON.parse(emitSimulationPacks(readFileSync("examples/simulations/workforce_change.reux", "utf8"), undefined, "json"));

    expect(report.simulations[0].pack).toEqual({
      id: "business_simulation.workforce.enterprise",
      title: "Business workforce simulation",
      description: "Workforce, productivity, overtime, and staffing-decision simulations.",
    });
    expect(report.simulations[0].dimensions).toEqual({
      product: "business_simulation",
      domain: "workforce",
      audience: "enterprise",
    });
    expect(report.simulations[0].missingDimensions).toEqual([]);
    expect(report.simulations[0].missingSuggestedAssumptions).toEqual(["average_hourly_cost"]);
    expect(report.simulations[0].missingSuggestedMetrics).toEqual(["labor_cost_delta", "capacity_delta"]);
    expect(report.simulations[0].missingSuggestedScenarios).toEqual([
      { name: "automation", purpose: "Estimate whether automation reduces labor cost or increases capacity." },
      { name: "hiring_plan", purpose: "Compare new headcount against productivity and overtime alternatives." },
    ]);
    expect(report.simulations[0].missingSuggestedObjectives).toEqual([
      { metric: "labor_cost_delta", direction: "minimize" },
      { metric: "capacity_delta", direction: "maximize" },
    ]);
    expect(report.simulations[0].coverage).toEqual({
      overallPercent: 63,
      dimensions: { present: 3, total: 3 },
      assumptions: { present: 3, total: 4 },
      metrics: { present: 2, total: 4 },
      scenarios: { present: 2, total: 4 },
      objectives: { present: 2, total: 4 },
    });
  });

  it("formats simulation domain pack scenario and objective guidance", () => {
    const report = emitSimulationPacks(readFileSync("examples/simulations/workforce_change.reux", "utf8"));

    expect(report).toContain("coverage: 63%");
    expect(report).toContain("suggested scenarios to add: automation (Estimate whether automation reduces labor cost or increases capacity.); hiring_plan");
    expect(report).toContain("suggested objectives to add: minimize labor_cost_delta, maximize capacity_delta");
  });

  it("reports PLOS habit simulation pack coverage", () => {
    const source = readFileSync("examples/simulations/habit_consistency.reux", "utf8");
    const run = JSON.parse(emitSimulationRun(source, "habit_consistency"));
    const report = JSON.parse(emitSimulationPacks(source, undefined, "json"));

    expect(run.name).toBe("habit_consistency");
    expect(run.dimensions).toEqual({ product: "PLOS", domain: "habits", audience: "personal" });
    expect(run.periods[0].metrics.completion_rate).toBe(0.68);
    expect(run.periods[0].metrics.missed_sessions).toBe(1.6);
    expect(run.periods[2].metrics.completion_rate).toBe(0.7);
    expect(run.scenarios.find((scenario: { name: string }) => scenario.name === "reduced_friction").periods[2].appliedChanges).toEqual([
      { period: 3, unit: "week" },
    ]);
    expect(report.simulations[0].pack).toEqual({
      id: "plos.habits.personal",
      title: "PLOS habit consistency",
      description: "Habit adherence, friction reduction, reminders, and routine-resilience simulations.",
    });
    expect(report.simulations[0].coverage.overallPercent).toBe(95);
    expect(report.simulations[0].missingSuggestedAssumptions).toEqual([]);
    expect(report.simulations[0].missingSuggestedMetrics).toEqual([]);
    expect(report.simulations[0].missingSuggestedScenarios).toEqual([
      { name: "travel_week", purpose: "Stress-test the routine against a predictable disruption." },
    ]);
    expect(report.simulations[0].missingSuggestedObjectives).toEqual([]);
  });

  it("reports enterprise operations simulation pack coverage", () => {
    const source = readFileSync("examples/simulations/operations_throughput.reux", "utf8");
    const run = JSON.parse(emitSimulationRun(source, "operations_throughput"));
    const report = JSON.parse(emitSimulationPacks(source, undefined, "json"));

    expect(run.name).toBe("operations_throughput");
    expect(run.dimensions).toEqual({ product: "business_simulation", domain: "operations", audience: "enterprise" });
    expect(run.periods[0].metrics).toMatchObject({
      throughput: 250,
      operating_cost: 12000,
      risk_score: 5,
      margin_delta: 6000,
    });
    expect(run.periods[2].metrics.risk_score).toBe(4);
    expect(run.comparison.metricRankings.find((ranking: { metric: string }) => ranking.metric === "throughput").scenarios[0]).toEqual({
      name: "process_improvement",
      delta: 83.333333,
      rank: 1,
    });
    expect(report.simulations[0].pack).toEqual({
      id: "business_simulation.operations.enterprise",
      title: "Business operations simulation",
      description: "Operational throughput, cost, risk, and scenario-comparison simulations.",
    });
    expect(report.simulations[0].coverage.overallPercent).toBe(100);
    expect(report.simulations[0].missingSuggestedAssumptions).toEqual([]);
    expect(report.simulations[0].missingSuggestedMetrics).toEqual([]);
    expect(report.simulations[0].missingSuggestedScenarios).toEqual([]);
    expect(report.simulations[0].missingSuggestedObjectives).toEqual([]);
  });

  it("applies simulation assumption changes by forecast period", () => {
    const run = JSON.parse(
      emitSimulationRun(`module personal_life

simulate rent_change {
  income = 5000 USD
  rent = 1500 USD
  formula cash_flow = income - rent
  change at 7 months {
    rent = 1600 USD
  }
  forecast 12 months
}
`),
    );

    expect(run.periods[0].metrics.cash_flow).toBe(3500);
    expect(run.periods[6].metrics.cash_flow).toBe(3400);
    expect(run.periods[6].assumptions.rent).toBe(1600);
    expect(run.periods[6].appliedChanges).toEqual([{ period: 7, unit: "month" }]);
  });

  it("validates simulation duplicate assumptions and values", () => {
    expect(() =>
      compileSource(`module broken

simulate bad {
  income = 5000
  income = nope
  forecast 1 month
}
`),
    ).toThrow(DlAggregateError);
  });

  it("validates simulation dimensions", () => {
    expect(() =>
      compileSource(`module broken

simulate bad {
  dimension domain = finance
  dimension domain = personal
  domain = "conflict"
  forecast 1 month
}
`),
    ).toThrow(DlAggregateError);

    expect(() =>
      compileSource(`module broken

simulate bad {
  dimension domain = personal finance
  forecast 1 month
}
`),
    ).toThrow();
  });

  it("validates simulation formula references", () => {
    expect(() =>
      compileSource(`module broken

simulate bad {
  income = 5000
  label = "personal"
  formula cash_flow = income - rent
  formula invalid = label * 2
  forecast 1 month
}
`),
    ).toThrow(DlAggregateError);
  });

  it("validates simulation formula units", () => {
    expect(() =>
      compileSource(`module broken

simulate bad {
  income = 5000 USD
  rent = 1500 USD
  productivity_gain = 8 percent
  employees = 50 count
  formula cash_flow = income - rent
  formula bad_add = cash_flow + productivity_gain
  formula bad_product = income * employees
  forecast 1 month
}
`),
    ).toThrow(/cannot add unit USD and unit percent/);
    expect(() =>
      compileSource(`module broken

simulate bad {
  income = 5000 USD
  employees = 50 count
  formula bad_product = income * employees
  forecast 1 month
}
`),
    ).toThrow(/cannot multiply unit USD by unit count/);
  });

  it("validates simulation objective metrics", () => {
    expect(() =>
      compileSource(`module broken

simulate bad {
  income = 5000 USD
  formula cash_flow = income
  objective maximize missing_metric
  objective minimize cash_flow
  objective maximize cash_flow
  forecast 1 month
}
`),
    ).toThrow(DlAggregateError);
  });

  it("validates simulation scenario overrides", () => {
    expect(() =>
      compileSource(`module broken

simulate bad {
  income = 5000 USD
  formula cash_flow = income - rent
  scenario upside {
    rent = 1200 USD
    income = "high"
  }
  forecast 1 month
}
`),
    ).toThrow(DlAggregateError);
  });

  it("validates simulation scenario override units", () => {
    expect(() =>
      compileSource(`module broken

simulate bad {
  income = 5000 USD
  formula cash_flow = income
  scenario wrong_currency {
    income = 5000 EUR
  }
  forecast 1 month
}
`),
    ).toThrow(DlAggregateError);
  });

  it("validates simulation change periods and units", () => {
    expect(() =>
      compileSource(`module broken

simulate bad {
  income = 5000 USD
  formula cash_flow = income
  change at 2 weeks {
    income = 5500 USD
  }
  forecast 3 months
}
`),
    ).toThrow(DlAggregateError);
  });

  it("validates simulation scenario-specific change periods and units", () => {
    expect(() =>
      compileSource(`module broken

simulate bad {
  income = 5000 USD
  formula cash_flow = income
  scenario upside {
    change at 2 weeks {
      income = 5500 USD
    }
  }
  forecast 3 months
}
`),
    ).toThrow(DlAggregateError);
  });

  it("rejects non-finite simulation formula output", () => {
    expect(() =>
      emitSimulationRun(`module broken

simulate bad_math {
  income = 5000 USD
  zero = 0
  formula impossible = income / zero
  forecast 1 month
}
`),
    ).toThrow(/divides by zero/);
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

  it("emits bounded Decimal precision and scale as PostgreSQL numeric precision", () => {
    const sql = emitPostgresSchema(`module billing

entity Invoice {
  id: Id<Invoice> primary generated
  amount: Decimal<12,2> check amount >= 0
  discount: Decimal<6,2>?
}
`);

    expect(sql).toContain("amount numeric(12, 2) NOT NULL CHECK (amount >= 0)");
    expect(sql).toContain("discount numeric(6, 2) NULL");
  });

  it("emits CurrencyCode fields with PostgreSQL validation", () => {
    const sql = emitPostgresSchema(`module billing

entity Invoice {
  id: Id<Invoice> primary generated
  currency: CurrencyCode default USD
}
`);

    expect(sql).toContain("currency char(3) NOT NULL DEFAULT 'USD' CHECK (\"currency\" ~ '^[A-Z]{3}$')");
  });

  it("emits a TypeScript API client for queries and transactions", () => {
    const api = emitApiClient(readFileSync("examples/pilot_reux.dl", "utf8"), { runtimeImport: "@reux/runtime" });

    expect(api).toContain('import type { Database, QueryRunResult, RuleRunResult, TransactionRunResult, ViewRunResult } from "@reux/runtime";');
    expect(api).toContain("export interface PilotApi");
    expect(api).toContain("export type OrderStatus = \"Pending\" | \"Paid\" | \"Cancelled\" | \"Refunded\";");
    expect(api).toContain("export interface OpenOrdersParams");
    expect(api).toContain("minTotal: number | string;");
    expect(api).toContain("orderRef: string;");
    expect(api).toContain("export type OpenOrdersRow = { total: number | string; status: OrderStatus };");
    expect(api).toContain("openOrders(params: OpenOrdersParams): Promise<ReuxQueryResult<OpenOrdersRow>>;");
    expect(api).toContain("capturePayment(params: CapturePaymentParams): Promise<TransactionRunResult>;");
    expect(api).toContain("return runSqlQuery(db, querySql.openOrders, [params.minTotal]) as Promise<ReuxQueryResult<OpenOrdersRow>>;");
    expect(api).toContain("return runTransactionSql(db, transactionSql.capturePayment, [params.orderRef, params.amount], 3);");
  });

  it("emits TypeScript API helpers for views and rules", () => {
    const api = emitApiClient(readFileSync("examples/plos_executive.reux", "utf8"), { runtimeImport: "@reux/runtime" });

    expect(api).toContain('import { runRuleSql, runSqlQuery, runTransactionSql } from "@reux/runtime";');
    expect(api).toContain("views: {");
    expect(api).toContain("DailyCommandBrief(): Promise<ViewRunResult>;");
    expect(api).toContain("rules: {");
    expect(api).toContain("overdue_follow_up(): Promise<RuleRunResult>;");
    expect(api).toContain("const viewSql = {");
    expect(api).toContain("DailyCommandBrief:");
    expect(api).toContain("const ruleSql = {");
    expect(api).toContain("critical_risk_attention:");
    expect(api).toContain("const result = await runSqlQuery(db, viewSql.DailyCommandBrief, []);");
    expect(api).toContain("return { ...result, row: result.rows[0] ?? null } as ViewRunResult;");
    expect(api).toContain("return runRuleSql(db, ruleSql.overdue_follow_up);");
  });

  it("emits a TypeScript HTTP API server scaffold", () => {
    const server = emitApiServer(readFileSync("examples/pilot_reux.dl", "utf8"), {
      apiImport: "./pilot-api.js",
      configImport: "./pilot-config.js",
      runtimeImport: "./pilot-runtime.js",
    });

    expect(server).toContain('import { createServer, type IncomingMessage, type ServerResponse } from "node:http";');
    expect(server).toContain('import { loadConfig } from "./pilot-config.js";');
    expect(server).toContain('import { createPostgresDatabase } from "./pilot-runtime.js";');
    expect(server).toContain("import { createPilotApi, type OpenOrdersParams, type AccountBalancesParams");
    expect(server).toContain('openOrders: async (body: unknown) => api.queries.openOrders(body as OpenOrdersParams),');
    expect(server).toContain('capturePayment: async (body: unknown) => api.transactions.capturePayment(body as CapturePaymentParams),');
    expect(server).toContain('openOrders: [{ name: "minTotal", optional: false, kind: "numeric" }],');
    expect(server).toContain("const validationError = validateBody(body, expectedParams);");
    expect(server).toContain("return `missing required parameter: ${parameter.name}`;");
    expect(server).toContain("return `unknown parameter: ${key}`;");
    expect(server).toContain("function validateParamValue(value: unknown, parameter: ExpectedParam): string | undefined");
    expect(server).toContain("return valid ? undefined : `${parameter.name} must be ${paramKindDescription(parameter.kind)}`;");
    expect(server).toContain('sendJson(response, 200, { ok: true, module: "pilot" });');
    expect(server).toContain('const maxBodyBytes = Number.parseInt(process.env.REUX_HTTP_MAX_BODY_BYTES ?? "1048576", 10);');
    expect(server).toContain('sendJson(response, 413, { error: "request body too large" });');
    expect(server).toContain('sendJson(response, 400, { error: "invalid JSON request body" });');
    expect(server).toContain("Reux API server listening on http://127.0.0.1:${port}");
  });

  it("emits HTTP routes for generated views and rules", () => {
    const server = emitApiServer(readFileSync("examples/plos_executive.reux", "utf8"), {
      apiImport: "./plos-api.js",
      configImport: "./plos-config.js",
      runtimeImport: "./plos-runtime.js",
    });

    expect(server).toContain("views: {");
    expect(server).toContain("DailyCommandBrief: async (body: unknown) => api.views.DailyCommandBrief(),");
    expect(server).toContain("rules: {");
    expect(server).toContain("overdue_follow_up: async (body: unknown) => api.rules.overdue_follow_up(),");
    expect(server).toContain("return value === \"queries\" || value === \"transactions\" || value === \"views\" || value === \"rules\";");
  });

  it("emits a TypeScript worker scaffold for outbox events", () => {
    const worker = emitWorker(readFileSync("examples/pilot_reux.dl", "utf8"), {
      configImport: "./pilot-config.js",
      runtimeImport: "./pilot-runtime.js",
    });

    expect(worker).toContain('import { loadConfig } from "./pilot-config.js";');
    expect(worker).toContain("createPostgresDatabase, runOutboxWorker, type AfterCommitHandler, type OutboxHandler");
    expect(worker).toContain("PaymentCaptured: async (event) => {");
    expect(worker).toContain("OrderPaid: async (event) => {");
    expect(worker).toContain("AccountCredited: async (event) => {");
    expect(worker).toContain("sendReceipt: async (hook) => {");
    expect(worker).toContain("notifyOrderPaid: async (hook) => {");
    expect(worker).toContain('type AfterCommitHandlerForsendReceipt = (hook: AfterCommitHook & { name: "sendReceipt"; resolvedArgs?: [string] }) => Promise<void> | void;');
    expect(worker).toContain("hook.resolvedArgs ?? hook.args");
    expect(worker).toContain("REUX_WORKER_INTERVAL_MS");
    expect(worker).toContain("REUX_WORKER_REQUEUE_STALE_SECONDS");
    expect(worker).toContain("REUX_WORKER_MAX_ATTEMPTS");
    expect(worker).toContain("REUX_WORKER_RETRY_DELAY_SECONDS");
    expect(worker).toContain("requeueStaleAfterSeconds,");
    expect(worker).toContain("dead=${result.deadLettered.length}");
    expect(worker).toContain("await runOutboxWorker(db, outboxHandlers");
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

  it("lowers compound query predicates to PostgreSQL", () => {
    const sql = emitQuerySql(
      `module commerce

entity User {
  id: Id<User> primary generated
  email: String?
  balance: Decimal
  active: Bool
}

query filteredUsers(min: Decimal, blockedEmail: String): Query<{ email: String?, balance: Decimal }> =
  from user in User
  where (user.balance >= min and user.email != blockedEmail) or user.active == true
  select { email: user.email, balance: user.balance }
`,
      "filteredUsers",
    );

    expect(sql).toBe(
      'SELECT "user".email AS email, "user".balance AS balance\nFROM users AS "user"\nWHERE ("user".balance >= $1 AND "user".email <> $2) OR "user".active = true;',
    );
  });

  it("keeps query string literals separate from parameters", () => {
    const sql = emitQuerySql(
      `module commerce

entity User {
  id: Id<User> primary generated
  email: String
  balance: Decimal
}

query namedUsers(min: Decimal): Query<User> =
  from user in User
  where user.email != "min" and user.balance > min
  select user
`,
      "namedUsers",
    );

    expect(sql).toBe('SELECT "user".*\nFROM users AS "user"\nWHERE "user".email <> \'min\' AND "user".balance > $1;');
  });

  it("lowers null comparisons in query predicates", () => {
    const source = `module commerce

entity User {
  id: Id<User> primary generated
  email: String?
}

query missingEmail(): Query<User> =
  from user in User
  where user.email == null
  select user

query knownEmail(): Query<User> =
  from user in User
  where null != user.email
  select user
`;

    expect(emitQuerySql(source, "missingEmail")).toBe('SELECT "user".*\nFROM users AS "user"\nWHERE "user".email IS NULL;');
    expect(emitQuerySql(source, "knownEmail")).toBe('SELECT "user".*\nFROM users AS "user"\nWHERE "user".email IS NOT NULL;');
  });

  it("expands reusable query fragments into query predicates", () => {
    const source = `module commerce

entity User {
  id: Id<User> primary generated
  email: String
  balance: Decimal
  active: Bool
}

query fragment activeUsers(user in User) = where user.active == true

query activePremiumUsers(min: Decimal): Query<infer> =
  from user in User
  with activeUsers
  where user.balance > min
  select { email: user.email, balance: user.balance }
`;
    const sql = emitQuerySql(source, "activePremiumUsers");
    const queryIr = JSON.parse(emitQueryIr(source, "activePremiumUsers"));
    const api = emitApiClient(source);

    expect(sql).toContain('WHERE ("user".active = true) AND ("user".balance > $1)');
    expect(queryIr.inferredResultType).toBe("Query<{ email: String, balance: Decimal }>");
    expect(api).toContain("export type ActivePremiumUsersRow = { email: string; balance: number | string };");
  });

  it("reuses query fragments across aliases for the same source entity", () => {
    const source = `module commerce

entity User {
  id: Id<User> primary generated
  email: String
  balance: Decimal
  active: Bool
}

query fragment activeUsers(user in User) = where user.active == true

query activeAccounts(min: Decimal): Query<infer> =
  from account in User
  with activeUsers
  where account.balance > min
  select { email: account.email, balance: account.balance }
`;
    const sql = emitQuerySql(source, "activeAccounts");
    const queryIr = JSON.parse(emitQueryIr(source, "activeAccounts"));

    expect(sql).toContain('WHERE ("account".active = true) AND ("account".balance > $1)');
    expect(queryIr.inferredResultType).toBe("Query<{ email: String, balance: Decimal }>");
  });

  it("lowers nullable left joins and infers nullable joined fields", () => {
    const source = `module commerce

entity Profile {
  id: Id<Profile> primary generated
  bio: String
}

entity Account {
  id: Id<Account> primary generated
  email: String
  profile: Profile?
}

query accountProfiles(): Query<infer> =
  from account in Account
  left join profile in Profile on account.profile == profile
  select { email: account.email, bio: profile.bio }
`;
    const sql = emitQuerySql(source, "accountProfiles");
    const queryIr = JSON.parse(emitQueryIr(source, "accountProfiles"));
    const api = emitApiClient(source);

    expect(sql).toContain('LEFT JOIN profiles AS "profile" ON "account".profile_id = "profile".id');
    expect(queryIr.inferredResultType).toBe("Query<{ email: String, bio: String? }>");
    expect(api).toContain("export type AccountProfilesRow = { email: string; bio: string | null };");
  });

  it("requires explicit result types to mark left-joined fields optional", () => {
    expect(() =>
      compileSource(`module commerce

entity Profile {
  id: Id<Profile> primary generated
  bio: String
}

entity Account {
  id: Id<Account> primary generated
  email: String
  profile: Profile?
}

query accountProfiles(): Query<{ email: String, bio: String }> =
  from account in Account
  left join profile in Profile on account.profile == profile
  select { email: account.email, bio: profile.bio }
`),
    ).toThrow(DlAggregateError);
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

  it("rejects unknown bare values in query predicates", () => {
    expect(() =>
      emitQuerySql(
        `module commerce

entity User {
  id: Id<User> primary generated
  balance: Decimal
}

query users(): Query<User> =
  from user in User
  where user.balance > missingMinimum
  select user
`,
        "users",
      ),
    ).toThrow("query users where predicate references unknown value missingMinimum");
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
    expect(plan).toContain("Review required: no");
    expect(plan).toContain("[safe] add enum value OrderStatus.Refunded");
    expect(plan).toContain("[safe] add field User.displayName");
    expect(plan).toContain("[safe] create index User.byEmail");
    expect(plan).toContain("ALTER TABLE users ADD COLUMN display_name text NULL;");
    expect(plan).toContain("Rollback SQL:");
    expect(plan).toContain("DROP INDEX users_by_email;");
    expect(plan).toContain("ALTER TABLE users DROP COLUMN display_name;");
    expect(plan).toContain("Deployment checklist:");
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
`,
        "json",
      ),
    );

    expect(plan.summary.unsafe).toBeGreaterThan(0);
    expect(plan.review.required).toBe(true);
    expect(plan.review.rollback).toContainEqual(expect.stringContaining("requiredCode"));
    expect(plan.review.rollbackSql).not.toContainEqual(expect.stringContaining("required_code"));
    expect(plan.operations).toContainEqual(
      expect.objectContaining({
        kind: "add_field",
        safety: "unsafe",
        description: expect.stringContaining("requiredCode"),
      }),
    );
  });

  it("checks migration safety for deployment gates", () => {
    const previousManifest = emitSchemaManifest(commerce);
    const next = `module commerce

entity User {
  id: Id<User> primary generated
  name: String
  email: String? unique
  balance: Decimal default 0
  requiredCode: String

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
`;

    const blocked = checkMigrationSafety(previousManifest, next);
    const allowed = checkMigrationSafety(previousManifest, next, { allowUnsafe: true });
    const productionBlocked = checkMigrationSafety(previousManifest, next, {
      allowUnsafe: true,
      environment: "production",
    });

    expect(blocked.ok).toBe(false);
    expect(blocked.diagnostics).toContain("unsafe: add field User.requiredCode requires backfill or default validation");
    expect(allowed.ok).toBe(true);
    expect(productionBlocked.ok).toBe(false);
    expect(productionBlocked.diagnostics).toContain("production: pass --allow-production after reviewing rollback notes and testing against staging");
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

  it("lowers idempotency keys and require guards in transactions", () => {
    const source = `module commerce

entity Account {
  id: Id<Account> primary generated
  balance: Decimal<12,2>
}

event AccountDebited {
  account: Account
  amount: Decimal<12,2>
}

transaction function debitAccount(accountRef: Account, amount: Decimal<12,2>, requestId: String) writes Account retry 3 {
  idempotency key requestId
  let account = load accountRef for update
  require account.balance >= amount else abort InsufficientFunds
  account.balance -= amount
  save account
  enqueue AccountDebited { account: accountRef, amount: amount }
}
`;
    const txIr = JSON.parse(emitTransactionIr(source, "debitAccount"));
    const sql = emitTransactionSql(source, "debitAccount");
    const worker = emitWorker(source);

    expect(txIr.steps[0]).toEqual({ kind: "IdempotencyKey", expression: "requestId" });
    expect(txIr.steps[2]).toEqual({ kind: "Require", condition: "account.balance >= amount", error: "InsufficientFunds" });
    expect(sql).toContain("INSERT INTO _dl_idempotency_keys (key) VALUES ($3::text) ON CONFLICT (key) DO NOTHING RETURNING key;");
    expect(sql).toContain("-- guard: InsufficientFunds");
    expect(sql).toContain("SELECT CASE WHEN :account.balance >= $2 THEN 1 ELSE 1 / 0 END;");
    expect(worker).toContain("export interface AccountDebitedPayload");
    expect(worker).toContain("account: string;");
    expect(worker).toContain("amount: number | string;");
    expect(worker).toContain("AccountDebited: TypedOutboxHandler<AccountDebitedPayload>");
  });

  it("lowers conditional transaction aborts", () => {
    const source = `module commerce

entity Account {
  id: Id<Account> primary generated
  balance: Decimal<12,2>
}

transaction function debitAccount(accountRef: Account, amount: Decimal<12,2>) writes Account retry 3 {
  let account = load accountRef for update
  if account.balance < amount then abort InsufficientFunds
  account.balance -= amount
  save account
}
`;
    const txIr = JSON.parse(emitTransactionIr(source, "debitAccount"));
    const sql = emitTransactionSql(source, "debitAccount");

    expect(txIr.steps[1]).toEqual({ kind: "ConditionalAbort", condition: "account.balance < amount", error: "InsufficientFunds" });
    expect(sql).toContain("-- conditional abort: InsufficientFunds");
    expect(sql).toContain("SELECT CASE WHEN :account.balance < $2 THEN 1 / 0 ELSE 1 END;");
  });

  it("types and lowers arithmetic transaction expressions", () => {
    const source = `module commerce

entity Account {
  id: Id<Account> primary generated
  balance: Decimal<12,2>
}

event AccountAdjusted {
  account: Account
  amount: Decimal<12,2>
}

transaction function adjustAccount(accountRef: Account, amount: Decimal<12,2>, fee: Decimal<12,2>, requestId: String) writes Account retry 3 {
  idempotency key requestId
  let account = load accountRef for update
  account.balance += amount - fee
  enqueue AccountAdjusted { account: accountRef, amount: amount - fee }
  save account
}
`;
    const sql = emitTransactionSql(source, "adjustAccount");

    expect(sql).toContain("UPDATE accounts SET balance = balance + $2 - $3 WHERE id = $1;");
    expect(sql).toContain("jsonb_build_object('account', $1::uuid, 'amount', $2 - $3)");
  });

  it("lowers conditional transaction mutations and enqueues", () => {
    const source = `module commerce

entity Account {
  id: Id<Account> primary generated
  balance: Decimal<12,2>
}

event AccountAdjusted {
  account: Account
  amount: Decimal<12,2>
}

transaction function adjustAccount(accountRef: Account, amount: Decimal<12,2>, fee: Decimal<12,2>, ceiling: Decimal<12,2>) writes Account retry 3 {
  let account = load accountRef for update
  if account.balance < ceiling then account.balance += amount - fee
  if amount > fee then enqueue AccountAdjusted { account: accountRef, amount: amount - fee }
  save account
}
`;
    const txIr = JSON.parse(emitTransactionIr(source, "adjustAccount"));
    const sql = emitTransactionSql(source, "adjustAccount");

    expect(txIr.steps[1]).toEqual({
      kind: "ConditionalMutation",
      condition: "account.balance < ceiling",
      target: "account.balance",
      operator: "+=",
      expression: "amount - fee",
    });
    expect(txIr.steps[2]).toEqual({
      kind: "ConditionalEnqueue",
      condition: "amount > fee",
      event: "AccountAdjusted",
      source: "{ account: accountRef, amount: amount - fee }",
    });
    expect(sql).toContain("UPDATE accounts SET balance = balance + $2 - $3 WHERE id = $1 AND :account.balance < $4;");
    expect(sql).toContain(
      "INSERT INTO _dl_outbox (event_type, payload) SELECT 'AccountAdjusted', jsonb_build_object('account', $1::uuid, 'amount', $2 - $3) WHERE $2 > $3 RETURNING id, event_type, payload;",
    );
  });

  it("lowers block conditionals and conditional after-commit hooks", () => {
    const source = `module commerce

entity Account {
  id: Id<Account> primary generated
  balance: Decimal<12,2>
  active: Bool
}

event AccountAdjusted {
  account: Account
  amount: Decimal<12,2>
}

transaction function adjustAccount(accountRef: Account, amount: Decimal<12,2>, fee: Decimal<12,2>) writes Account retry 3 {
  let account = load accountRef for update
  if account.active {
    account.balance += amount - fee
    enqueue AccountAdjusted { account: accountRef, amount: amount - fee }
    after commit notifyAccount(accountRef)
  }
  save account
}
`;
    const txIr = JSON.parse(emitTransactionIr(source, "adjustAccount"));
    const sql = emitTransactionSql(source, "adjustAccount");
    const worker = emitWorker(source);

    expect(txIr.steps[1]).toEqual({
      kind: "ConditionalMutation",
      condition: "account.active",
      target: "account.balance",
      operator: "+=",
      expression: "amount - fee",
    });
    expect(txIr.steps[2]).toEqual({
      kind: "ConditionalEnqueue",
      condition: "account.active",
      event: "AccountAdjusted",
      source: "{ account: accountRef, amount: amount - fee }",
    });
    expect(txIr.steps[3]).toEqual({
      kind: "ConditionalAfterCommit",
      condition: "account.active",
      call: "notifyAccount(accountRef)",
    });
    expect(sql).toContain("UPDATE accounts SET balance = balance + $2 - $3 WHERE id = $1 AND :account.active;");
    expect(sql).toContain(
      "INSERT INTO _dl_outbox (event_type, payload) SELECT 'AccountAdjusted', jsonb_build_object('account', $1::uuid, 'amount', $2 - $3) WHERE :account.active RETURNING id, event_type, payload;",
    );
    expect(sql).toContain("-- conditional after commit: notifyAccount(accountRef)");
    expect(sql).toContain("SELECT CASE WHEN :account.active THEN 'notifyAccount(accountRef)' ELSE NULL END AS _dl_after_commit;");
    expect(worker).toContain("notifyAccount: AfterCommitHandlerFornotifyAccount");
  });

  it("rejects unknown and unsupported transaction guard expressions", () => {
    const brokenGuardSource = (condition: string) => `module broken

entity Account {
  id: Id<Account> primary generated
  balance: Decimal
}

transaction function debitAccount(accountRef: Account, amount: Decimal) writes Account retry 3 {
  let account = load accountRef for update
  require ${condition} else abort InsufficientFunds
  account.balance -= amount
  save account
}
`;

    expect(() => compileSource(brokenGuardSource("account.balance >= amunt"))).toThrow(DlAggregateError);
    expect(() => compileSource(brokenGuardSource("account.missing >= amount"))).toThrow(DlAggregateError);
    expect(() => compileSource(brokenGuardSource("canDebit(accountRef)"))).toThrow(DlAggregateError);
  });

  it("rejects incompatible transaction guard operand types", () => {
    const source = (condition: string) => `module broken

entity Account {
  id: Id<Account> primary generated
  balance: Decimal
  active: Bool
}

transaction function debitAccount(accountRef: Account, amount: Decimal, label: String) writes Account retry 3 {
  let account = load accountRef for update
  require ${condition} else abort InvalidGuard
  account.balance -= amount
  save account
}
`;

    expect(diagnoseSource(source('account.balance == "paid"')).diagnostics.map((diagnostic) => diagnostic.message)).toContain(
      'transaction debitAccount guard compares incompatible operands in \'account.balance == "paid"\' (Decimal == String)',
    );
    expect(diagnoseSource(source('account.balance > "10"')).diagnostics.map((diagnostic) => diagnostic.message)).toContain(
      'transaction debitAccount guard compares non-numeric operands in \'account.balance > "10"\' (Decimal > String)',
    );
    expect(diagnoseSource(source("amount")).diagnostics.map((diagnostic) => diagnostic.message)).toContain(
      "transaction debitAccount guard clause 'amount' must be Bool, got Decimal",
    );
    expect(compileSource(source("account.active"))).toBeTruthy();
    expect(compileSource(source("not account.active"))).toBeTruthy();
    expect(compileSource(source("(account.balance > amount) and account.active"))).toBeTruthy();
  });

  it("lowers null comparisons in transaction guards", () => {
    const source = `module commerce

entity Account {
  id: Id<Account> primary generated
  email: String?
  balance: Decimal
}

transaction function requireEmail(accountRef: Account) writes Account {
  let account = load accountRef for update
  require account.email != null else abort MissingEmail
  if null == account.email then abort MissingEmail
  account.balance += 1
}
`;
    const sql = emitTransactionSql(source, "requireEmail");

    expect(sql).toContain("SELECT CASE WHEN :account.email IS NOT NULL THEN 1 ELSE 1 / 0 END;");
    expect(sql).toContain("SELECT CASE WHEN :account.email IS NULL THEN 1 / 0 ELSE 1 END;");
  });

  it("accepts compatible enum transaction guard comparisons", () => {
    const source = `module commerce

entity Order {
  id: Id<Order> primary generated
  status: OrderStatus
}

enum OrderStatus {
  Pending
  Paid
}

transaction function markPaid(orderRef: Order, nextStatus: OrderStatus) writes Order {
  let order = load orderRef for update
  require order.status != Paid else abort AlreadyPaid
  if order.status == nextStatus then abort NoChange
  order.status = Paid
}
`;

    expect(compileSource(source)).toBeTruthy();
  });

  it("rejects unsupported arithmetic transaction expressions", () => {
    expect(() =>
      compileSource(`module broken

entity Account {
  id: Id<Account> primary generated
  balance: Decimal
}

transaction function bad(accountRef: Account, amount: Decimal) writes Account {
  let account = load accountRef for update
  account.balance = amount + missing
}
`),
    ).toThrow(DlAggregateError);
    expect(() =>
      compileSource(`module broken

entity Account {
  id: Id<Account> primary generated
  balance: Decimal
}

transaction function bad(accountRef: Account, amount: Decimal) writes Account {
  let account = load accountRef for update
  account.balance = amount +
}
`),
    ).toThrow(DlAggregateError);
  });

  it("rejects nullable transaction expressions assigned to required targets", () => {
    const diagnostics = diagnoseSource(`module broken

entity Account {
  id: Id<Account> primary generated
  email: String?
  displayName: String
  balance: Decimal
}

event AccountRenamed {
  displayName: String
}

transaction function renameAccount(accountRef: Account, maybeName: String?, maybeAmount: Decimal?) writes Account {
  let account = load accountRef for update
  account.displayName = maybeName
  account.displayName = account.email
  account.balance = maybeAmount + 1
  enqueue AccountRenamed { displayName: account.email }
}
`);

    expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        "transaction renameAccount assigns required Account.displayName from nullable expression type String?",
        "transaction renameAccount assigns required Account.displayName from nullable expression type String?",
        "transaction renameAccount assigns Account.balance from unsupported arithmetic expression maybeAmount + 1",
        "transaction renameAccount assigns required AccountRenamed.displayName from nullable expression type String?",
      ]),
    );
  });

  it("accepts nullable transaction expressions assigned to optional targets", () => {
    expect(() =>
      compileSource(`module nullable

entity Account {
  id: Id<Account> primary generated
  email: String?
  displayName: String?
}

event AccountRenamed {
  displayName: String?
}

transaction function renameAccount(accountRef: Account, maybeName: String?) writes Account {
  let account = load accountRef for update
  account.displayName = maybeName
  enqueue AccountRenamed { displayName: account.email }
}
`),
    ).not.toThrow();
  });

  it("lowers explicit transaction abort steps", () => {
    const source = `module commerce

entity Account {
  id: Id<Account> primary generated
  balance: Decimal
}

transaction function stopAccount(accountRef: Account) writes Account retry 3 {
  let account = load accountRef for update
  abort ManualStop
}
`;

    const txIr = JSON.parse(emitTransactionIr(source, "stopAccount"));
    const sql = emitTransactionSql(source, "stopAccount");

    expect(txIr.steps[1]).toEqual({ kind: "Abort", error: "ManualStop" });
    expect(sql).toContain("-- abort: ManualStop");
    expect(sql).toContain("SELECT 1 / 0;");
  });

  it("validates after commit hook arguments", () => {
    const source = (hook: string) => `module commerce

entity Account {
  id: Id<Account> primary generated
  balance: Decimal
}

transaction function notifyAccount(accountRef: Account) writes Account retry 3 {
  let account = load accountRef for update
  after commit ${hook}
}
`;

    expect(() => compileSource(source("notifyAccount(accountRef, account.id, \"ok\")"))).not.toThrow();
    expect(() => compileSource(source("notifyAccount(missingRef)"))).toThrow(DlAggregateError);
    expect(() => compileSource(source("notifyAccount(account.missing)"))).toThrow(DlAggregateError);
    expect(() => compileSource(source("notifyAccount(accountRef + 1)"))).toThrow(DlAggregateError);
  });

  it("validates transaction expression and event payload types", () => {
    expect(() =>
      compileSource(`module broken

entity Account {
  id: Id<Account> primary generated
  balance: Decimal
}

event AccountDebited {
  account: Account
  amount: Decimal
}

transaction function bad(accountRef: Account, amount: Decimal) writes Account {
  let account = load accountRef for update
  account.balance = accountRef
  enqueue AccountDebited { account: accountRef }
}
`),
    ).toThrow(DlAggregateError);
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

  it("lowers parameterized transition assignments to guarded transaction updates", () => {
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

transaction function moveOrder(orderRef: Order, nextStatus: OrderStatus) writes Order {
  let order = load orderRef for update
  order.status = nextStatus
  save order
}
`,
      "moveOrder",
    );

    expect(sql).toContain("-- transition guard: Order.status -> nextStatus");
    expect(sql).toContain(
      "UPDATE orders SET status = $2 WHERE id = $1 AND EXISTS (SELECT 1 FROM (VALUES ('Pending'::order_status, 'Paid'::order_status), ('Pending'::order_status, 'Cancelled'::order_status)) AS _dl_transition(from_value, to_value) WHERE _dl_transition.from_value = orders.status AND _dl_transition.to_value = $2);",
    );
  });

  it("rejects enum assignments from incompatible transaction parameters", () => {
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

enum PaymentStatus {
  Authorized
  Captured
}

transition Order.status {
  Pending -> Paid
}

transaction function moveOrder(orderRef: Order, nextStatus: PaymentStatus) writes Order {
  let order = load orderRef for update
  order.status = nextStatus
  save order
}
`),
    ).toThrow(DlAggregateError);
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

  it("lowers bound transaction inserts to named runtime results", () => {
    const txIr = JSON.parse(
      emitTransactionIr(
        `module banking

entity LedgerEntry {
  id: Id<LedgerEntry> primary generated
  amount: Decimal
}

transaction function recordReward(amount: Decimal) writes LedgerEntry retry 3 {
  let entry = insert LedgerEntry { amount: amount }
}
`,
        "recordReward",
      ),
    );
    const sql = emitTransactionSql(
      `module banking

entity LedgerEntry {
  id: Id<LedgerEntry> primary generated
  amount: Decimal
}

transaction function recordReward(amount: Decimal) writes LedgerEntry retry 3 {
  let entry = insert LedgerEntry { amount: amount }
}
`,
      "recordReward",
    );

    expect(txIr.steps[0]).toEqual({ kind: "Insert", target: "entry", entity: "LedgerEntry", source: "{ amount: amount }" });
    expect(sql).toContain("-- bind result: entry");
    expect(sql).toContain("INSERT INTO ledger_entries (amount) VALUES ($1) RETURNING *;");
  });

  it("lowers bound insert references in later transaction statements", () => {
    const sql = emitTransactionSql(
      `module commerce

entity Account {
  id: Id<Account> primary generated
}

entity Payment {
  id: Id<Payment> primary generated
  account: Account required
  amount: Decimal
}

entity PaymentAudit {
  id: Id<PaymentAudit> primary generated
  payment: Payment required
  amount: Decimal
}

transaction function capture(accountRef: Account, amount: Decimal) writes Payment, PaymentAudit retry 3 {
  let payment = insert Payment { account: accountRef, amount: amount }
  insert PaymentAudit { payment: payment, amount: amount }
  enqueue PaymentCaptured { payment: payment.id, amount: amount }
}
`,
      "capture",
    );

    expect(sql).toContain("-- bind result: payment");
    expect(sql).toContain("INSERT INTO payments (account_id, amount) VALUES ($1, $2) RETURNING *;");
    expect(sql).toContain("INSERT INTO payment_audits (payment_id, amount) VALUES (:payment.id, $2) RETURNING *;");
    expect(sql).toContain("jsonb_build_object('payment', :payment.id::uuid, 'amount', $2::numeric)");
  });

  it("lowers loaded field references in later transaction statements", () => {
    const sql = emitTransactionSql(
      `module commerce

entity Order {
  id: Id<Order> primary generated
  currency: CurrencyCode default USD
}

entity Payment {
  id: Id<Payment> primary generated
  order: Order required
  currency: CurrencyCode
}

transaction function capture(orderRef: Order) writes Payment retry 3 {
  let order = load orderRef for update
  insert Payment { order: orderRef, currency: order.currency }
  enqueue PaymentCaptured { order: orderRef, currency: order.currency }
}
`,
      "capture",
    );

    expect(sql).toContain("-- bind result: order");
    expect(sql).toContain("INSERT INTO payments (order_id, currency) VALUES ($1, :order.currency) RETURNING *;");
    expect(sql).toContain("jsonb_build_object('order', $1::uuid, 'currency', :order.currency::char(3))");
  });

  it("rejects unknown bound insert fields", () => {
    expect(() =>
      compileSource(`module commerce

entity Payment {
  id: Id<Payment> primary generated
  amount: Decimal
}

transaction function capture(amount: Decimal) writes Payment retry 3 {
  let payment = insert Payment { amount: amount }
  enqueue PaymentCaptured { missing: payment.missing }
}
`),
    ).toThrow(DlAggregateError);
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

  it("rejects enum inserts from incompatible transaction parameters", () => {
    expect(() =>
      compileSource(`module commerce

entity Order {
  id: Id<Order> primary generated
}

entity Payment {
  id: Id<Payment> primary generated
  order: Order required
  status: PaymentStatus
}

enum OrderStatus {
  Pending
  Paid
}

enum PaymentStatus {
  Authorized
  Captured
}

transaction function capture(orderRef: Order, nextStatus: OrderStatus) writes Payment retry 3 {
  insert Payment { order: orderRef, status: nextStatus }
}
`),
    ).toThrow(DlAggregateError);
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
    expect(migration.sql).toContain("-- Rollback SQL:");
    expect(migration.sql).toContain("--   ALTER TABLE users DROP COLUMN display_name;");
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

  it("rejects invalid Decimal precision and scale declarations", () => {
    expect(() =>
      compileSource(`module broken

entity Invoice {
  id: Id<Invoice> primary generated
  amount: Decimal<2,4>
}
`),
    ).toThrow(DlAggregateError);
  });

  it("rejects invalid query result field types", () => {
    expect(() =>
      compileSource(`module broken

entity Invoice {
  id: Id<Invoice> primary generated
  amount: Decimal<12,2>
}

query invoices(): Query<{ amount: Decimal<2,4> }> =
  from invoice in Invoice
  select { amount: invoice.amount }
`),
    ).toThrow(DlAggregateError);
  });

  it("rejects invalid CurrencyCode literals in transaction writes", () => {
    expect(() =>
      compileSource(`module commerce

entity Product {
  id: Id<Product> primary generated
  currency: CurrencyCode
}

transaction function createProduct() writes Product retry 3 {
  insert Product { currency: US }
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
