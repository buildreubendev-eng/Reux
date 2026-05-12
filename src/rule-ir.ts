import { RuleDeclaration } from "./ast.js";
import { DlError } from "./errors.js";
import { EntityIr, FieldIr, findEntity, SchemaIr } from "./schema.js";

export interface RulePlanIr {
  name: string;
  entity: string;
  table: string;
  primaryKey: RuleFieldRefIr;
  condition: RuleConditionExpressionIr;
  actions: RuleActionIr[];
}

export interface RuleConditionExpressionIr {
  source: string;
  fields: RuleFieldRefIr[];
  enumLiterals: RuleEnumLiteralRefIr[];
  predicate: RulePredicateIr;
}

export type RuleActionIr = RuleMarkActionIr | RuleNotifyActionIr;

export interface RuleMarkActionIr {
  kind: "Mark";
  source: string;
  entity: string;
  field: RuleFieldRefIr;
  value: RuleOperandIr;
}

export interface RuleNotifyActionIr {
  kind: "Notify";
  source: string;
  recipient: RuleFieldRefIr;
}

export type RulePredicateIr = RuleLogicalPredicateIr | RuleGroupPredicateIr | RuleComparisonPredicateIr;

export interface RuleLogicalPredicateIr {
  kind: "And" | "Or";
  left: RulePredicateIr;
  right: RulePredicateIr;
}

export interface RuleGroupPredicateIr {
  kind: "Group";
  predicate: RulePredicateIr;
}

export interface RuleComparisonPredicateIr {
  kind: "Comparison";
  operator: "==" | "!=" | ">" | ">=" | "<" | "<=";
  left: RuleOperandIr;
  right: RuleOperandIr;
}

export type RuleOperandIr =
  | { kind: "Field"; source: string; entity: string; field: string; column: string; type: string }
  | { kind: "Identifier"; name: string }
  | { kind: "String"; value: string }
  | { kind: "Number"; value: string }
  | { kind: "Boolean"; value: boolean }
  | { kind: "Null" }
  | { kind: "Today" };

export interface RuleFieldRefIr {
  source: string;
  entity: string;
  field: string;
  column: string;
  type: string;
}

export interface RuleEnumLiteralRefIr {
  source: string;
  enumName: string;
  value: string;
}

export function buildRuleIr(schema: SchemaIr, rule: RuleDeclaration): RulePlanIr {
  const condition = conditionIr(schema, rule);
  const entityNames = new Set(condition.fields.map((field) => field.entity));
  if (entityNames.size !== 1) {
    throw new DlError(`rule ${rule.name} must reference exactly one entity in its when clause`);
  }

  const entityName = [...entityNames][0];
  const entity = findEntity(schema, entityName);
  if (!entity) {
    throw new DlError(`rule ${rule.name} references unknown entity ${entityName}`);
  }
  const primaryKey = entity.fields.find((field) => field.primary) ?? entity.fields.find((field) => field.name === "id");
  if (!primaryKey) {
    throw new DlError(`rule ${rule.name} entity ${entity.name} must have a primary key for executable rules`);
  }

  return {
    name: rule.name,
    entity: entity.name,
    table: entity.tableName,
    primaryKey: fieldRef(entity, `${entity.name}.${primaryKey.name}`, primaryKey),
    condition,
    actions: rule.actions.map((action) => actionIr(schema, rule, entity, action.source)),
  };
}

function conditionIr(schema: SchemaIr, rule: RuleDeclaration): RuleConditionExpressionIr {
  const parser = new RulePredicateParser(schema, rule.name, rule.when);
  const predicate = parser.parse();
  const fields: RuleFieldRefIr[] = [];
  const enumLiterals: RuleEnumLiteralRefIr[] = [];
  collectPredicateRefs(schema, rule.name, predicate, fields, enumLiterals);
  return {
    source: rule.when,
    fields: uniqueFields(fields),
    enumLiterals: uniqueEnumLiterals(enumLiterals),
    predicate,
  };
}

function actionIr(schema: SchemaIr, rule: RuleDeclaration, entity: EntityIr, source: string): RuleActionIr {
  const mark = source.match(/^mark\s+([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
  if (mark) {
    if (mark[1] !== entity.name) {
      throw new DlError(`rule ${rule.name} action '${source}' must target ${entity.name}`);
    }
    const field = entity.fields.find((candidate) => candidate.name === mark[2]);
    if (!field) {
      throw new DlError(`rule ${rule.name} action '${source}' references unknown field ${entity.name}.${mark[2]}`);
    }
    const value = parseActionValue(rule.name, source, mark[3].trim());
    validateOperandValue(schema, rule.name, value, fieldOperand(entity, `${entity.name}.${field.name}`, field));
    return {
      kind: "Mark",
      source,
      entity: entity.name,
      field: fieldRef(entity, `${entity.name}.${field.name}`, field),
      value,
    };
  }

  const notify = source.match(/^notify\s+([A-Za-z_][A-Za-z0-9_]*)$/);
  if (notify) {
    const field = entity.fields.find((candidate) => candidate.name === notify[1]);
    if (!field) {
      throw new DlError(`rule ${rule.name} action '${source}' references unknown field ${entity.name}.${notify[1]}`);
    }
    return {
      kind: "Notify",
      source,
      recipient: fieldRef(entity, `${entity.name}.${field.name}`, field),
    };
  }

  throw new DlError(`rule ${rule.name} action '${source}' is not executable yet`);
}

class RulePredicateParser {
  private readonly tokens: RulePredicateToken[];
  private index = 0;

  constructor(
    private readonly schema: SchemaIr,
    private readonly ruleName: string,
    source: string,
  ) {
    this.tokens = tokenizePredicate(source, ruleName);
  }

  parse(): RulePredicateIr {
    const predicate = this.parseOr();
    if (this.peek().kind !== "eof") {
      throw new DlError(`rule ${this.ruleName} predicate has unexpected token '${this.peek().source}'`);
    }
    return predicate;
  }

  private parseOr(): RulePredicateIr {
    let left = this.parseAnd();
    while (this.matchKeyword("or")) {
      left = { kind: "Or", left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): RulePredicateIr {
    let left = this.parseAtom();
    while (this.matchKeyword("and")) {
      left = { kind: "And", left, right: this.parseAtom() };
    }
    return left;
  }

  private parseAtom(): RulePredicateIr {
    if (this.match("(")) {
      const predicate = this.parseOr();
      this.expect(")");
      return { kind: "Group", predicate };
    }
    return this.parseComparison();
  }

  private parseComparison(): RulePredicateIr {
    const left = this.parseOperand();
    const operator = this.peek();
    if (operator.kind !== "operator") {
      throw new DlError(`rule ${this.ruleName} predicate expected a comparison operator after '${operandSource(left)}'`);
    }
    this.index += 1;
    const right = this.parseOperand();
    return {
      kind: "Comparison",
      operator: operator.source as RuleComparisonPredicateIr["operator"],
      left,
      right,
    };
  }

  private parseOperand(): RuleOperandIr {
    const token = this.peek();
    if (token.kind === "identifier") {
      this.index += 1;
      if (token.source === "today" && this.match("(")) {
        this.expect(")");
        return { kind: "Today" };
      }
      if (this.match(".")) {
        const field = this.peek();
        if (field.kind !== "identifier") {
          throw new DlError(`rule ${this.ruleName} predicate expected a field name after '${token.source}.'`);
        }
        this.index += 1;
        const entity = findEntity(this.schema, token.source);
        if (!entity) {
          throw new DlError(`rule ${this.ruleName} predicate references unknown entity ${token.source}`);
        }
        const entityField = entity.fields.find((candidate) => candidate.name === field.source);
        if (!entityField) {
          throw new DlError(`rule ${this.ruleName} predicate references unknown field ${entity.name}.${field.source}`);
        }
        return fieldOperand(entity, `${entity.name}.${entityField.name}`, entityField);
      }
      if (token.source === "true" || token.source === "false") {
        return { kind: "Boolean", value: token.source === "true" };
      }
      if (token.source === "null") {
        return { kind: "Null" };
      }
      return { kind: "Identifier", name: token.source };
    }
    if (token.kind === "number") {
      this.index += 1;
      return { kind: "Number", value: token.source };
    }
    if (token.kind === "string") {
      this.index += 1;
      return { kind: "String", value: token.value ?? "" };
    }
    throw new DlError(`rule ${this.ruleName} predicate expected a value but found '${token.source}'`);
  }

  private peek(): RulePredicateToken {
    return this.tokens[this.index] ?? { kind: "eof", source: "" };
  }

  private match(source: string): boolean {
    if (this.peek().source !== source) return false;
    this.index += 1;
    return true;
  }

  private expect(source: string): void {
    if (this.match(source)) return;
    throw new DlError(`rule ${this.ruleName} predicate expected '${source}' but found '${this.peek().source}'`);
  }

  private matchKeyword(source: "and" | "or"): boolean {
    const token = this.peek();
    if (token.kind !== "identifier" || token.source !== source) return false;
    this.index += 1;
    return true;
  }
}

function collectPredicateRefs(
  schema: SchemaIr,
  ruleName: string,
  predicate: RulePredicateIr,
  fields: RuleFieldRefIr[],
  enumLiterals: RuleEnumLiteralRefIr[],
): void {
  switch (predicate.kind) {
    case "And":
    case "Or":
      collectPredicateRefs(schema, ruleName, predicate.left, fields, enumLiterals);
      collectPredicateRefs(schema, ruleName, predicate.right, fields, enumLiterals);
      return;
    case "Group":
      collectPredicateRefs(schema, ruleName, predicate.predicate, fields, enumLiterals);
      return;
    case "Comparison":
      collectOperandRefs(schema, ruleName, predicate.left, predicate.right, fields, enumLiterals);
      collectOperandRefs(schema, ruleName, predicate.right, predicate.left, fields, enumLiterals);
      return;
  }
}

function collectOperandRefs(
  schema: SchemaIr,
  ruleName: string,
  operand: RuleOperandIr,
  other: RuleOperandIr | undefined,
  fields: RuleFieldRefIr[],
  enumLiterals: RuleEnumLiteralRefIr[],
): void {
  if (operand.kind === "Field") {
    fields.push({
      source: operand.source,
      entity: operand.entity,
      field: operand.field,
      column: operand.column,
      type: operand.type,
    });
    return;
  }
  validateOperandValue(schema, ruleName, operand, other);
  if (operand.kind !== "Identifier" || other?.kind !== "Field") return;

  const enumeration = schema.enums.find((candidate) => candidate.name === other.type);
  if (!enumeration?.values.includes(operand.name)) return;
  enumLiterals.push({
    source: operand.name,
    enumName: enumeration.name,
    value: operand.name,
  });
}

function validateOperandValue(schema: SchemaIr, ruleName: string, operand: RuleOperandIr, other: RuleOperandIr | undefined): void {
  if (operand.kind !== "Identifier") return;
  const otherField = other?.kind === "Field" ? other : undefined;
  const enumeration = otherField ? schema.enums.find((candidate) => candidate.name === otherField.type) : undefined;
  if (enumeration?.values.includes(operand.name)) return;
  const target = otherField ? ` for ${otherField.entity}.${otherField.field}` : "";
  throw new DlError(`rule ${ruleName} references unknown value ${operand.name}${target}`);
}

function parseActionValue(ruleName: string, action: string, source: string): RuleOperandIr {
  if (source === "true" || source === "false") return { kind: "Boolean", value: source === "true" };
  if (source === "null") return { kind: "Null" };
  if (source === "today()") return { kind: "Today" };
  if (/^-?\d+(?:\.\d+)?$/.test(source)) return { kind: "Number", value: source };
  if ((source.startsWith("\"") && source.endsWith("\"")) || (source.startsWith("'") && source.endsWith("'"))) {
    return { kind: "String", value: source.slice(1, -1) };
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(source)) return { kind: "Identifier", name: source };
  throw new DlError(`rule ${ruleName} action '${action}' uses unsupported value ${source}`);
}

function tokenizePredicate(source: string, ruleName: string): RulePredicateToken[] {
  const tokens: RulePredicateToken[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "(" || char === ")" || char === ".") {
      tokens.push({ kind: "punctuation", source: char });
      index += 1;
      continue;
    }
    const two = source.slice(index, index + 2);
    if (two === "==" || two === "!=" || two === ">=" || two === "<=") {
      tokens.push({ kind: "operator", source: two });
      index += 2;
      continue;
    }
    if (char === ">" || char === "<") {
      tokens.push({ kind: "operator", source: char });
      index += 1;
      continue;
    }
    if (char === "'" || char === "\"") {
      const parsed = readStringToken(source, index, ruleName);
      tokens.push(parsed.token);
      index = parsed.nextIndex;
      continue;
    }
    const number = source.slice(index).match(/^-?\d+(?:\.\d+)?/);
    if (number) {
      tokens.push({ kind: "number", source: number[0] });
      index += number[0].length;
      continue;
    }
    const identifier = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) {
      tokens.push({ kind: "identifier", source: identifier[0] });
      index += identifier[0].length;
      continue;
    }
    throw new DlError(`rule ${ruleName} predicate has unsupported token '${char}'`);
  }

  tokens.push({ kind: "eof", source: "" });
  return tokens;
}

function readStringToken(source: string, start: number, ruleName: string): { token: RulePredicateToken; nextIndex: number } {
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
        token: { kind: "string", source: source.slice(start, index + 1), value },
        nextIndex: index + 1,
      };
    }
    value += char;
    index += 1;
  }
  throw new DlError(`rule ${ruleName} predicate has an unterminated string literal`);
}

function fieldOperand(entity: EntityIr, source: string, field: FieldIr): RuleOperandIr {
  return {
    kind: "Field",
    source,
    entity: entity.name,
    field: field.name,
    column: field.columnName,
    type: field.type.raw,
  };
}

function fieldRef(entity: EntityIr, source: string, field: FieldIr): RuleFieldRefIr {
  return {
    source,
    entity: entity.name,
    field: field.name,
    column: field.columnName,
    type: field.type.raw,
  };
}

function uniqueFields(fields: RuleFieldRefIr[]): RuleFieldRefIr[] {
  const seen = new Set<string>();
  return fields.filter((field) => {
    const key = `${field.entity}.${field.field}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueEnumLiterals(literals: RuleEnumLiteralRefIr[]): RuleEnumLiteralRefIr[] {
  const seen = new Set<string>();
  return literals.filter((literal) => {
    const key = `${literal.enumName}.${literal.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function operandSource(operand: RuleOperandIr): string {
  switch (operand.kind) {
    case "Field":
      return operand.source;
    case "Identifier":
      return operand.name;
    case "String":
      return `"${operand.value}"`;
    case "Number":
      return operand.value;
    case "Boolean":
      return String(operand.value);
    case "Null":
      return "null";
    case "Today":
      return "today()";
  }
}

type RulePredicateToken =
  | { kind: "identifier"; source: string }
  | { kind: "number"; source: string }
  | { kind: "string"; source: string; value: string }
  | { kind: "operator"; source: string }
  | { kind: "punctuation"; source: string }
  | { kind: "eof"; source: string };
