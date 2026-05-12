import { EntityIr, FieldIr, findEntity, SchemaIr, snakeCase } from "./schema.js";
import { DlError } from "./errors.js";
import { buildQueryIr, ExpressionIr, ProjectionIr, QueryInputIr, QueryPlanIr } from "./query-ir.js";
import { QueryDeclaration, RuleDeclaration, TransactionDeclaration, ViewDeclaration } from "./ast.js";
import { buildTransactionIr, TransactionIr } from "./transaction-ir.js";
import { parseObjectLiteral } from "./object-literal.js";
import { buildViewIr, ViewMetricIr, ViewPlanIr, ViewPredicateIr, ViewPredicateOperandIr } from "./view-ir.js";
import { buildRuleIr, RuleActionIr, RuleOperandIr, RulePlanIr, RulePredicateIr } from "./rule-ir.js";

export function schemaToPostgres(schema: SchemaIr): string {
  const extensionSql = [
    "CREATE EXTENSION IF NOT EXISTS pgcrypto;",
    [
      "CREATE TABLE IF NOT EXISTS _dl_idempotency_keys (",
      "  key text PRIMARY KEY,",
      "  created_at timestamptz NOT NULL DEFAULT now()",
      ");",
    ].join("\n"),
  ];
  const enumSql = schema.enums.map((enumeration) => {
    const values = enumeration.values.map((value) => quoteLiteral(value)).join(", ");
    return `CREATE TYPE ${snakeCase(enumeration.name)} AS ENUM (${values});`;
  });

  const tableSql = schema.entities.map((entity) => {
    const columns = entity.fields.map((field) => `  ${columnSql(schema, field)}`);
    const tableConstraints = entity.fields.flatMap((field) => {
      if (!field.reference) return [];
      const referenced = findEntity(schema, field.reference.entity);
      if (!referenced) return [];
      return [
        `  CONSTRAINT ${entity.tableName}_${field.columnName}_fkey FOREIGN KEY (${field.columnName}) REFERENCES ${referenced.tableName}(id)`,
      ];
    });
    return `CREATE TABLE ${entity.tableName} (\n${[...columns, ...tableConstraints].join(",\n")}\n);`;
  });

  const indexSql = schema.entities.flatMap((entity) =>
    entity.indexes.map((index) => {
      const columns = index.fields
        .map((field) => `${field.columnName}${field.direction ? ` ${field.direction.toUpperCase()}` : ""}`)
        .join(", ");
      return `CREATE INDEX ${entity.tableName}_${snakeCase(index.name)} ON ${entity.tableName} (${columns});`;
    }),
  );

  return [...extensionSql, ...enumSql, ...tableSql, ...indexSql].join("\n\n");
}

export function queryToPostgres(schema: SchemaIr, query: QueryDeclaration): string {
  return queryIrToPostgres(buildQueryIr(schema, query));
}

export function viewToPostgres(schema: SchemaIr, view: ViewDeclaration): string {
  return viewIrToPostgres(buildViewIr(schema, view));
}

export function ruleToPostgres(schema: SchemaIr, rule: RuleDeclaration): string {
  return ruleIrToPostgres(buildRuleIr(schema, rule));
}

export function transactionToPostgres(schema: SchemaIr, transaction: TransactionDeclaration): string {
  return transactionIrToPostgres(schema, buildTransactionIr(schema, transaction));
}

export function queryIrToPostgres(plan: QueryPlanIr): string {
  const clauses = collectClauses(plan.root.input);
  return [
    `SELECT ${projectionSql(plan.root.projection)}`,
    clauses.from,
    ...clauses.joins,
    clauses.where,
    clauses.groupBy,
    clauses.orderBy,
    clauses.limit,
  ]
    .filter(Boolean)
    .join("\n")
    .concat(";");
}

export function viewIrToPostgres(plan: ViewPlanIr): string {
  return `SELECT\n${plan.metrics.map((metric) => `  ${viewMetricSql(metric)} AS ${quoteIdentifier(metric.name)}`).join(",\n")};`;
}

function viewMetricSql(metric: ViewMetricIr): string {
  const where = metric.predicate ? ` WHERE ${viewPredicateSql(metric.predicate.predicate)}` : "";
  return `(SELECT count(*) FROM ${metric.table} AS ${quoteIdentifier("_row")}${where})`;
}

function viewPredicateSql(predicate: ViewPredicateIr): string {
  switch (predicate.kind) {
    case "And":
    case "Or": {
      const operator = predicate.kind === "And" ? "AND" : "OR";
      return `${viewPredicateSql(predicate.left)} ${operator} ${viewPredicateSql(predicate.right)}`;
    }
    case "Group":
      return `(${viewPredicateSql(predicate.predicate)})`;
    case "In":
      return `${viewOperandSql(predicate.left)} IN (${predicate.values.map((value) => viewOperandSql(value, predicate.left)).join(", ")})`;
    case "Comparison": {
      const operator = predicate.operator === "!=" ? "<>" : predicate.operator === "==" ? "=" : predicate.operator;
      const left = viewOperandSql(predicate.left, predicate.right);
      const right = viewOperandSql(predicate.right, predicate.left);
      if (predicate.operator === "==" && predicate.right.kind === "Null") return `${left} IS NULL`;
      if (predicate.operator === "==" && predicate.left.kind === "Null") return `${right} IS NULL`;
      if (predicate.operator === "!=" && predicate.right.kind === "Null") return `${left} IS NOT NULL`;
      if (predicate.operator === "!=" && predicate.left.kind === "Null") return `${right} IS NOT NULL`;
      return `${left} ${operator} ${right}`;
    }
  }
}

function viewOperandSql(operand: ViewPredicateOperandIr, other?: ViewPredicateOperandIr): string {
  if (operand.kind === "Field") return `${quoteIdentifier("_row")}.${quoteIdentifier(operand.column)}`;
  if (operand.kind === "String") return quoteLiteral(operand.value);
  if (operand.kind === "Number") return operand.value;
  if (operand.kind === "Boolean") return operand.value ? "TRUE" : "FALSE";
  if (operand.kind === "Null") return "NULL";
  if (operand.kind === "Identifier" && other?.kind === "Field") return quoteLiteral(operand.name);
  return quoteLiteral(operand.name);
}

export function ruleIrToPostgres(plan: RulePlanIr): string {
  return plan.actions.map((action) => ruleActionSql(plan, action)).join("\n\n");
}

function ruleActionSql(plan: RulePlanIr, action: RuleActionIr): string {
  const where = rulePredicateSql(plan.condition.predicate);
  if (action.kind === "Mark") {
    return [
      `UPDATE ${plan.table} AS ${quoteIdentifier("_row")}`,
      `SET ${quoteIdentifier(action.field.column)} = ${ruleOperandSql(action.value, { kind: "Field", source: action.field.source, entity: action.field.entity, field: action.field.field, column: action.field.column, type: action.field.type })}`,
      `WHERE ${where}`,
      `RETURNING ${quoteIdentifier("_row")}.*;`,
    ].join("\n");
  }

  return [
    "WITH matched AS (",
    `  SELECT ${ruleColumnSql(plan.primaryKey.column)}::text AS record_id, ${ruleColumnSql(action.recipient.column)}::text AS recipient`,
    `  FROM ${plan.table} AS ${quoteIdentifier("_row")}`,
    `  WHERE ${where}`,
    "), inserted_keys AS (",
    "  INSERT INTO _dl_rule_notifications (rule_name, entity_name, record_id, recipient_field, recipient)",
    `  SELECT ${quoteLiteral(plan.name)}, ${quoteLiteral(plan.entity)}, matched.record_id, ${quoteLiteral(action.recipient.field)}, matched.recipient`,
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
    `SELECT ${quoteLiteral("RuleNotificationRequested")}, jsonb_build_object(${[
      quoteLiteral("rule"),
      "rule_name",
      quoteLiteral("entity"),
      "entity_name",
      quoteLiteral("recordId"),
      "record_id",
      quoteLiteral("recipientField"),
      "recipient_field",
      quoteLiteral("recipient"),
      "recipient",
    ].join(", ")})`,
    "FROM inserted_keys",
    "RETURNING id, event_type, payload;",
  ].join("\n");
}

function rulePredicateSql(predicate: RulePredicateIr): string {
  switch (predicate.kind) {
    case "And":
    case "Or": {
      const operator = predicate.kind === "And" ? "AND" : "OR";
      return `${rulePredicateSql(predicate.left)} ${operator} ${rulePredicateSql(predicate.right)}`;
    }
    case "Group":
      return `(${rulePredicateSql(predicate.predicate)})`;
    case "Comparison": {
      const operator = predicate.operator === "!=" ? "<>" : predicate.operator === "==" ? "=" : predicate.operator;
      const left = ruleOperandSql(predicate.left, predicate.right);
      const right = ruleOperandSql(predicate.right, predicate.left);
      if (predicate.operator === "==" && predicate.right.kind === "Null") return `${left} IS NULL`;
      if (predicate.operator === "==" && predicate.left.kind === "Null") return `${right} IS NULL`;
      if (predicate.operator === "!=" && predicate.right.kind === "Null") return `${left} IS NOT NULL`;
      if (predicate.operator === "!=" && predicate.left.kind === "Null") return `${right} IS NOT NULL`;
      return `${left} ${operator} ${right}`;
    }
  }
}

function ruleOperandSql(operand: RuleOperandIr, other?: RuleOperandIr): string {
  if (operand.kind === "Field") return ruleColumnSql(operand.column);
  if (operand.kind === "String") return quoteLiteral(operand.value);
  if (operand.kind === "Number") return operand.value;
  if (operand.kind === "Boolean") return operand.value ? "TRUE" : "FALSE";
  if (operand.kind === "Null") return "NULL";
  if (operand.kind === "Today") return "CURRENT_DATE";
  if (operand.kind === "Identifier" && other?.kind === "Field") return quoteLiteral(operand.name);
  return quoteLiteral(operand.name);
}

function ruleColumnSql(column: string): string {
  return `${quoteIdentifier("_row")}.${quoteIdentifier(column)}`;
}

export function columnSql(schema: SchemaIr, field: FieldIr): string {
  const parts = [field.columnName, sqlType(schema, field), field.nullable ? "NULL" : "NOT NULL"];
  if (field.primary) parts.push("PRIMARY KEY");
  if (field.generated && field.type.name === "Id") parts.push("DEFAULT gen_random_uuid()");
  if (field.defaultValue && !field.generated) parts.push(`DEFAULT ${defaultSql(field.defaultValue)}`);
  if (field.unique) parts.push("UNIQUE");
  if (field.type.name === "CurrencyCode") parts.push(`CHECK (${quoteIdentifier(field.columnName)} ~ '^[A-Z]{3}$')`);
  if (field.check) parts.push(`CHECK (${checkSql(field)})`);
  return parts.join(" ");
}

export function sqlType(schema: SchemaIr, field: FieldIr): string {
  if (field.reference || field.type.name === "Id") return "uuid";
  switch (field.type.name) {
    case "Bool":
      return "boolean";
    case "Int":
      return "integer";
    case "Int64":
      return "bigint";
    case "Float":
      return "double precision";
    case "Decimal":
      return decimalSqlType(field.type.raw);
    case "CurrencyCode":
      return "char(3)";
    case "String":
      return "text";
    case "Bytes":
      return "bytea";
    case "Date":
      return "date";
    case "Time":
      return "time";
    case "Instant":
      return "timestamptz";
    case "Duration":
      return "interval";
    case "Uuid":
      return "uuid";
    case "Json":
      return "jsonb";
    default:
      if (schema.enums.some((enumeration) => enumeration.name === field.type.name)) {
        return snakeCase(field.type.name);
      }
      throw new DlError(`no PostgreSQL type mapping for ${field.type.raw}`);
  }
}

function defaultSql(value: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*\(\)$/.test(value)) {
    if (value === "now()") return "now()";
    return value;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) return quoteLiteral(value);
  return value;
}

function checkSql(field: FieldIr): string {
  return field.check?.replaceAll(field.name, field.columnName) ?? "";
}

function collectClauses(input: QueryInputIr): {
  from: string;
  joins: string[];
  where?: string;
  groupBy?: string;
  orderBy?: string;
  limit?: string;
} {
  if (input.kind === "Scan") {
    return {
      from: `FROM ${input.table} AS ${quoteIdentifier(input.alias)}`,
      joins: [],
    };
  }

  const clauses = collectClauses(input.input);
  if (input.kind === "Join") {
    const joinSql = input.joinKind === "left" ? "LEFT JOIN" : "JOIN";
    return {
      ...clauses,
      joins: [...clauses.joins, `${joinSql} ${input.table} AS ${quoteIdentifier(input.alias)} ON ${expressionSql(input.on)}`],
    };
  }

  if (input.kind === "Filter") {
    return {
      ...clauses,
      where: `WHERE ${expressionSql(input.predicate)}`,
    };
  }

  if (input.kind === "Group") {
    return {
      ...clauses,
      groupBy: `GROUP BY ${input.keys.map(expressionSql).join(", ")}`,
    };
  }

  if (input.kind === "Order") {
    return {
      ...clauses,
      orderBy: `ORDER BY ${input.keys
        .map((key) => `${expressionSql(key.expression)} ${key.direction.toUpperCase()}`)
        .join(", ")}`,
    };
  }

  if (input.kind === "Limit") {
    return {
      ...clauses,
      limit: `LIMIT ${expressionSql(input.count)}`,
    };
  }

  return clauses;
}

function projectionSql(projection: ProjectionIr): string {
  if (projection.kind === "Entity") {
    return `${quoteIdentifier(projection.alias)}.*`;
  }

  return projection.fields.map((field) => `${expressionSql(field.expression)} AS ${field.name}`).join(", ");
}

function expressionSql(expression: ExpressionIr): string {
  return expressionSegments(expression.source)
    .map((segment) => (segment.kind === "string" ? quoteLiteral(segment.value) : expressionSegmentSql(segment.source, expression)))
    .join("");
}

function expressionSegmentSql(source: string, expression: ExpressionIr): string {
  let sql = source;
  for (const field of expression.fields) {
    sql = sql.replaceAll(field.source, `${quoteIdentifier(field.alias)}.${field.column}`);
  }

  for (const alias of expression.aliases) {
    sql = sql.replace(new RegExp(`\\b${alias.name}\\b`, "g"), `${quoteIdentifier(alias.alias)}.id`);
  }

  for (const parameter of expression.parameters) {
    sql = sql.replace(new RegExp(`\\b${parameter.name}\\b`, "g"), `$${parameter.position}`);
  }

  for (const literal of expression.enumLiterals) {
    sql = sql.replace(new RegExp(`\\b${literal.source}\\b`, "g"), quoteLiteral(literal.value));
  }

  sql = sql.replace(/\bcount\(\s*\)/g, "count(*)");
  sql = sql.replace(/\band\b/g, "AND").replace(/\bor\b/g, "OR");
  sql = normalizeNullComparisons(sql);
  sql = sql.replaceAll("!=", "<>");

  return sql.replaceAll("==", "=");
}

function expressionSegments(source: string): ExpressionSegment[] {
  const segments: ExpressionSegment[] = [];
  let index = 0;
  let segmentStart = 0;

  while (index < source.length) {
    const char = source[index];
    if (char !== "'" && char !== "\"") {
      index += 1;
      continue;
    }

    if (segmentStart < index) {
      segments.push({ kind: "source", source: source.slice(segmentStart, index) });
    }

    const parsed = readSqlStringSegment(source, index);
    segments.push({ kind: "string", value: parsed.value });
    index = parsed.nextIndex;
    segmentStart = index;
  }

  if (segmentStart < source.length) {
    segments.push({ kind: "source", source: source.slice(segmentStart) });
  }
  return segments;
}

function readSqlStringSegment(source: string, start: number): { value: string; nextIndex: number } {
  const quote = source[start];
  let value = "";
  let index = start + 1;

  while (index < source.length) {
    const char = source[index];
    if (char === quote) {
      if (source[index + 1] === quote) {
        value += quote;
        index += 2;
        continue;
      }
      return {
        value,
        nextIndex: index + 1,
      };
    }
    value += char;
    index += 1;
  }

  return {
    value: source.slice(start + 1),
    nextIndex: source.length,
  };
}

type ExpressionSegment = { kind: "source"; source: string } | { kind: "string"; value: string };

export function transactionIrToPostgres(schema: SchemaIr, transaction: TransactionIr): string {
  const lowered = new TransactionLowering(schema, transaction);
  return lowered.lower();
}

class TransactionLowering {
  private readonly loaded = new Map<string, { entity: EntityIr; sourceParameter: number }>();
  private readonly boundInserts = new Map<string, EntityIr>();

  constructor(
    private readonly schema: SchemaIr,
    private readonly transaction: TransactionIr,
  ) {}

  lower(): string {
    const lines = ["BEGIN;"];
    for (const step of this.transaction.steps) {
      if (step.kind === "LoadForUpdate") {
        lines.push(this.lowerLoadForUpdate(step.target, step.source));
      } else if (step.kind === "Mutation") {
        lines.push(this.lowerMutation(step.target, step.operator, step.expression));
      } else if (step.kind === "ConditionalMutation") {
        lines.push(this.lowerMutation(step.target, step.operator, step.expression, step.condition));
      } else if (step.kind === "Save") {
        lines.push(`-- save ${step.target}: staged by explicit mutation statements`);
      } else if (step.kind === "Insert") {
        lines.push(this.lowerInsert(step.entity, step.source, step.target));
      } else if (step.kind === "Enqueue") {
        lines.push(this.lowerEnqueue(step.event, step.source));
      } else if (step.kind === "ConditionalEnqueue") {
        lines.push(this.lowerEnqueue(step.event, step.source, step.condition));
      } else if (step.kind === "ConditionalAfterCommit") {
        lines.push(this.lowerConditionalAfterCommit(step.condition, step.call));
      } else if (step.kind === "IdempotencyKey") {
        lines.push(this.lowerIdempotencyKey(step.expression));
      } else if (step.kind === "Require") {
        lines.push(this.lowerRequire(step.condition, step.error));
      } else if (step.kind === "ConditionalAbort") {
        lines.push(this.lowerConditionalAbort(step.condition, step.error));
      } else if (step.kind === "AfterCommit") {
        lines.push(`-- after commit: ${step.call}`);
      } else if (step.kind === "ExternalCall") {
        lines.push(`-- external call: ${step.call}`);
      } else if (step.kind === "Abort") {
        lines.push(this.lowerAbort(step.error));
      } else {
        lines.push(`-- raw: ${step.source}`);
      }
    }
    lines.push("COMMIT;");
    return lines.join("\n");
  }

  private lowerLoadForUpdate(target: string, source: string): string {
    const parameter = this.parameter(source);
    const entity = findEntity(this.schema, parameter.type);
    if (!entity) {
      throw new DlError(`cannot lower load for non-entity parameter ${source}`);
    }
    this.loaded.set(target, {
      entity,
      sourceParameter: parameter.position,
    });
    this.boundInserts.set(target, entity);
    return `-- bind result: ${target}\nSELECT * FROM ${entity.tableName} WHERE id = $${parameter.position} FOR UPDATE;`;
  }

  private lowerAbort(error: string): string {
    return `-- abort: ${error}\nSELECT 1 / 0;`;
  }

  private lowerMutation(target: string, operator: "+=" | "-=" | "=", expression: string, condition?: string): string {
    const [localName, fieldName] = target.split(".");
    const loaded = this.loaded.get(localName);
    if (!loaded) {
      throw new DlError(`cannot lower mutation for unloaded entity state ${localName}`);
    }
    const field = loaded.entity.fields.find((candidate) => candidate.name === fieldName);
    if (!field) {
      throw new DlError(`cannot lower mutation for unknown field ${loaded.entity.name}.${fieldName}`);
    }
    const valueSql = this.expressionSql(expression);
    const assignment =
      operator === "="
        ? `${field.columnName} = ${valueSql}`
        : `${field.columnName} = ${field.columnName} ${operator[0]} ${valueSql}`;
    const whereConditions = [`id = $${loaded.sourceParameter}`];
    if (condition) whereConditions.push(this.conditionSql(condition));
    const transitionGuard = this.transitionGuard(loaded.entity, field, operator, expression);
    if (!transitionGuard) {
      return `UPDATE ${loaded.entity.tableName} SET ${assignment} WHERE ${whereConditions.join(" AND ")};`;
    }
    if (transitionGuard.kind === "parameter") {
      return [
        `-- transition guard: ${loaded.entity.name}.${field.name} -> ${transitionGuard.to}`,
        `UPDATE ${loaded.entity.tableName} SET ${assignment} WHERE ${whereConditions.join(" AND ")} AND EXISTS (SELECT 1 FROM (VALUES ${transitionGuard.values}) AS _dl_transition(from_value, to_value) WHERE _dl_transition.from_value = ${loaded.entity.tableName}.${field.columnName} AND _dl_transition.to_value = ${valueSql});`,
      ].join("\n");
    }
    return [
      `-- transition guard: ${loaded.entity.name}.${field.name} -> ${transitionGuard.to}`,
      `UPDATE ${loaded.entity.tableName} SET ${assignment} WHERE ${whereConditions.join(" AND ")} AND ${field.columnName} IN (${transitionGuard.from.map(quoteLiteral).join(", ")});`,
    ].join("\n");
  }

  private transitionGuard(
    entity: EntityIr,
    field: FieldIr,
    operator: "+=" | "-=" | "=",
    expression: string,
  ): TransitionGuard | undefined {
    if (operator !== "=") return undefined;
    const transitions = this.schema.transitions.filter((transition) => transition.entity === entity.name && transition.field === field.name);
    if (transitions.length === 0) return undefined;

    const parameter = this.parameterOrUndefined(expression.trim());
    if (parameter && parameter.type === field.type.raw) {
      const enumSqlType = sqlType(this.schema, field);
      return {
        kind: "parameter",
        to: parameter.name,
        values: transitions
          .map((transition) => `(${quoteLiteral(transition.from)}::${enumSqlType}, ${quoteLiteral(transition.to)}::${enumSqlType})`)
          .join(", "),
      };
    }

    const to = sourceLiteralValue(expression);
    if (to) {
      const from = transitions.filter((transition) => transition.to === to).map((transition) => transition.from);
      return from.length > 0 ? { kind: "literal", to, from } : undefined;
    }
    return undefined;
  }

  private expressionSql(expression: string): string {
    const parameter = this.transaction.parameters.find((candidate) => candidate.name === expression);
    if (parameter) return `$${this.transaction.parameters.indexOf(parameter) + 1}`;
    const loaded = this.loaded.get(expression);
    if (loaded) return `$${loaded.sourceParameter}`;
    const bound = this.boundReferenceSql(expression);
    if (bound) return bound;
    if (/^-?\d+(\.\d+)?$/.test(expression)) return expression;
    if ((expression.startsWith("\"") && expression.endsWith("\"")) || (expression.startsWith("'") && expression.endsWith("'"))) {
      return quoteLiteral(expression.slice(1, -1));
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(expression)) return quoteLiteral(expression);
    if (isArithmeticExpressionSource(expression)) return this.replaceExpressionReferences(expression);
    return expression;
  }

  private lowerInsert(entityName: string, source: string, target?: string): string {
    const entity = findEntity(this.schema, entityName);
    if (!entity) {
      throw new DlError(`cannot lower insert for unknown entity ${entityName}`);
    }
    const fields = parseObjectLiteral(source);
    const columns: string[] = [];
    const values: string[] = [];
    for (const objectField of fields) {
      const field = entity.fields.find((candidate) => candidate.name === objectField.name);
      if (!field) {
        throw new DlError(`cannot lower insert for unknown field ${entityName}.${objectField.name}`);
      }
      columns.push(field.columnName);
      values.push(this.expressionSql(objectField.value));
    }
    const sql =
      columns.length === 0
        ? `INSERT INTO ${entity.tableName} DEFAULT VALUES RETURNING *;`
        : `INSERT INTO ${entity.tableName} (${columns.join(", ")}) VALUES (${values.join(", ")}) RETURNING *;`;
    if (target) {
      this.boundInserts.set(target, entity);
    }
    return target ? `-- bind result: ${target}\n${sql}` : sql;
  }

  private lowerEnqueue(event: string, source: string, condition?: string): string {
    const fields = parseObjectLiteral(source);
    const payloadParts = fields.flatMap((field) => [quoteLiteral(field.name), this.jsonExpressionSql(field.value)]);
    const payload = payloadParts.length > 0 ? `jsonb_build_object(${payloadParts.join(", ")})` : "'{}'::jsonb";
    if (condition) {
      return `INSERT INTO _dl_outbox (event_type, payload) SELECT ${quoteLiteral(event)}, ${payload} WHERE ${this.conditionSql(condition)} RETURNING id, event_type, payload;`;
    }
    return `INSERT INTO _dl_outbox (event_type, payload) VALUES (${quoteLiteral(event)}, ${payload}) RETURNING id, event_type, payload;`;
  }

  private lowerIdempotencyKey(expression: string): string {
    return `INSERT INTO _dl_idempotency_keys (key) VALUES (${this.expressionSql(expression)}::text) ON CONFLICT (key) DO NOTHING RETURNING key;`;
  }

  private lowerRequire(condition: string, error: string): string {
    return [
      `-- guard: ${error}`,
      `SELECT CASE WHEN ${this.conditionSql(condition)} THEN 1 ELSE 1 / 0 END;`,
    ].join("\n");
  }

  private lowerConditionalAbort(condition: string, error: string): string {
    return [
      `-- conditional abort: ${error}`,
      `SELECT CASE WHEN ${this.conditionSql(condition)} THEN 1 / 0 ELSE 1 END;`,
    ].join("\n");
  }

  private lowerConditionalAfterCommit(condition: string, call: string): string {
    return [
      `-- conditional after commit: ${call}`,
      `SELECT CASE WHEN ${this.conditionSql(condition)} THEN ${quoteLiteral(call)} ELSE NULL END AS _dl_after_commit;`,
    ].join("\n");
  }

  private jsonExpressionSql(expression: string): string {
    const parameter = this.transaction.parameters.find((candidate) => candidate.name === expression);
    if (parameter) {
      return `$${this.transaction.parameters.indexOf(parameter) + 1}::${this.parameterSqlType(parameter.type)}`;
    }
    const loaded = this.loaded.get(expression);
    if (loaded) return `$${loaded.sourceParameter}::uuid`;
    const bound = this.boundReferenceSql(expression);
    if (bound) return `${bound}::${this.boundReferenceType(expression) ?? "text"}`;
    return this.expressionSql(expression);
  }

  private conditionSql(expression: string): string {
    let sql = this.replaceExpressionReferences(expression);
    sql = sql.replace(/\band\b/g, "AND").replace(/\bor\b/g, "OR");
    sql = normalizeNullComparisons(sql);
    sql = sql.replaceAll("!=", "<>");
    return sql.replaceAll("==", "=");
  }

  private replaceExpressionReferences(expression: string): string {
    return expressionSegments(expression)
      .map((segment) => (segment.kind === "string" ? quoteLiteral(segment.value) : this.replaceSourceReferences(segment.source)))
      .join("");
  }

  private replaceSourceReferences(source: string): string {
    let sql = source;
    for (const [name, loaded] of this.loaded) {
      for (const field of loaded.entity.fields) {
        sql = sql.replace(new RegExp(`\\b${name}\\.${field.name}\\b`, "g"), `:${name}.${field.columnName}`);
      }
    }
    for (const [name, entity] of this.boundInserts) {
      if (this.loaded.has(name)) continue;
      for (const field of entity.fields) {
        sql = sql.replace(new RegExp(`\\b${name}\\.${field.name}\\b`, "g"), `:${name}.${field.columnName}`);
      }
    }
    for (const parameter of this.transaction.parameters) {
      const position = this.transaction.parameters.indexOf(parameter) + 1;
      sql = sql.replace(new RegExp(`(?<![.:])\\b${parameter.name}\\b(?!\\.)`, "g"), `$${position}`);
    }
    return sql;
  }

  private boundReferenceSql(expression: string): string | undefined {
    const match = expression.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?$/);
    if (!match) return undefined;
    const entity = this.boundInserts.get(match[1]);
    if (!entity) return undefined;
    const fieldName = match[2] ?? "id";
    const field = entity.fields.find((candidate) => candidate.name === fieldName);
    if (!field) {
      throw new DlError(`cannot lower bound insert reference ${expression}; ${entity.name} has no field ${fieldName}`);
    }
    return `:${match[1]}.${field.columnName}`;
  }

  private boundReferenceType(expression: string): string | undefined {
    const match = expression.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?$/);
    if (!match) return undefined;
    const entity = this.boundInserts.get(match[1]);
    if (!entity) return undefined;
    const field = entity.fields.find((candidate) => candidate.name === (match[2] ?? "id"));
    return field ? sqlType(this.schema, field) : undefined;
  }

  private parameter(name: string): { name: string; type: string; position: number } {
    const parameter = this.parameterOrUndefined(name);
    if (!parameter) {
      throw new DlError(`unknown transaction parameter ${name}`);
    }
    return parameter;
  }

  private parameterOrUndefined(name: string): { name: string; type: string; position: number } | undefined {
    const index = this.transaction.parameters.findIndex((parameter) => parameter.name === name);
    if (index < 0) return undefined;
    return {
      ...this.transaction.parameters[index],
      position: index + 1,
    };
  }

  private parameterSqlType(type: string): string {
    if (findEntity(this.schema, type)) return "uuid";
    if (type.startsWith("Decimal")) return decimalSqlType(type);
    switch (type) {
      case "Bool":
        return "boolean";
      case "Int":
        return "integer";
      case "Int64":
        return "bigint";
      case "Float":
        return "double precision";
      case "CurrencyCode":
        return "char(3)";
      case "String":
        return "text";
      case "Date":
        return "date";
      case "Time":
        return "time";
      case "Instant":
        return "timestamptz";
      case "Uuid":
        return "uuid";
      case "Json":
        return "jsonb";
      default:
        if (this.schema.enums.some((enumeration) => enumeration.name === type)) {
          return snakeCase(type);
        }
        return "text";
    }
  }
}

function decimalSqlType(type: string): string {
  const required = type.endsWith("?") ? type.slice(0, -1) : type;
  const match = required.match(/^Decimal(?:<(\d+),\s*(\d+)>)?$/);
  if (!match?.[1]) return "numeric";
  return `numeric(${match[1]}, ${match[2]})`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

type TransitionGuard =
  | {
      kind: "literal";
      to: string;
      from: string[];
    }
  | {
      kind: "parameter";
      to: string;
      values: string;
    };

function sourceLiteralValue(expression: string): string | undefined {
  const value = expression.trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) return value;
  return undefined;
}

function normalizeNullComparisons(sql: string): string {
  return sql
    .replace(/([A-Za-z0-9_".:$]+)\s*==\s*null\b/g, "$1 IS NULL")
    .replace(/\bnull\s*==\s*([A-Za-z0-9_".:$]+)/g, "$1 IS NULL")
    .replace(/([A-Za-z0-9_".:$]+)\s*!=\s*null\b/g, "$1 IS NOT NULL")
    .replace(/\bnull\s*!=\s*([A-Za-z0-9_".:$]+)/g, "$1 IS NOT NULL");
}

function isArithmeticExpressionSource(expression: string): boolean {
  return /[+\-*/()]/.test(expression) && /^[A-Za-z0-9_.$\s+\-*/()]+$/.test(expression);
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export { quoteIdentifier, quoteLiteral };
