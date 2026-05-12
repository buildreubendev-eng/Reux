import { ViewDeclaration } from "./ast.js";
import { DlError } from "./errors.js";
import { EntityIr, FieldIr, findEntity, SchemaIr } from "./schema.js";

export interface ViewPlanIr {
  name: string;
  metrics: ViewMetricIr[];
}

export interface ViewMetricIr {
  name: string;
  aggregate: "avg" | "count" | "max" | "min" | "sum";
  entity: string;
  table: string;
  field?: ViewAggregateFieldIr;
  predicate?: ViewPredicateExpressionIr;
}

export interface ViewAggregateFieldIr {
  source: string;
  field: string;
  column: string;
  type: string;
}

export interface ViewPredicateExpressionIr {
  source: string;
  fields: ViewFieldRefIr[];
  enumLiterals: ViewEnumLiteralRefIr[];
  predicate: ViewPredicateIr;
}

export type ViewPredicateIr = ViewLogicalPredicateIr | ViewGroupPredicateIr | ViewComparisonPredicateIr | ViewInPredicateIr;

export interface ViewLogicalPredicateIr {
  kind: "And" | "Or";
  left: ViewPredicateIr;
  right: ViewPredicateIr;
}

export interface ViewGroupPredicateIr {
  kind: "Group";
  predicate: ViewPredicateIr;
}

export interface ViewComparisonPredicateIr {
  kind: "Comparison";
  operator: "==" | "!=" | ">" | ">=" | "<" | "<=";
  left: ViewPredicateOperandIr;
  right: ViewPredicateOperandIr;
}

export interface ViewInPredicateIr {
  kind: "In";
  left: ViewPredicateOperandIr;
  values: ViewPredicateOperandIr[];
}

export type ViewPredicateOperandIr =
  | { kind: "Field"; source: string; entity: string; field: string; column: string; type: string }
  | { kind: "Identifier"; name: string }
  | { kind: "String"; value: string }
  | { kind: "Number"; value: string }
  | { kind: "Boolean"; value: boolean }
  | { kind: "Null" };

export interface ViewFieldRefIr {
  source: string;
  entity: string;
  field: string;
  column: string;
}

export interface ViewEnumLiteralRefIr {
  source: string;
  enumName: string;
  value: string;
}

export function buildViewIr(schema: SchemaIr, view: ViewDeclaration): ViewPlanIr {
  return {
    name: view.name,
    metrics: view.metrics.map((metric) => metricIr(schema, view, metric.name, metric.expression)),
  };
}

function metricIr(schema: SchemaIr, view: ViewDeclaration, metricName: string, source: string): ViewMetricIr {
  const match = source
    .trim()
    .match(/^(count|sum|avg|min|max)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?(?:\s+where\s+(.+))?$/);
  if (!match) {
    throw new DlError(`view ${view.name}.${metricName} supports count Entity or sum/avg/min/max Entity.field metrics`);
  }

  const aggregate = match[1] as ViewMetricIr["aggregate"];
  const entity = findEntity(schema, match[2]);
  if (!entity) {
    throw new DlError(`view ${view.name}.${metricName} ${aggregate}s unknown entity ${match[2]}`);
  }

  const fieldName = match[3];
  if (aggregate === "count" && fieldName) {
    throw new DlError(`view ${view.name}.${metricName} count metrics use count Entity, not count Entity.field`);
  }
  if (aggregate !== "count" && !fieldName) {
    throw new DlError(`view ${view.name}.${metricName} ${aggregate} metrics require Entity.field`);
  }

  const field = fieldName ? entity.fields.find((candidate) => candidate.name === fieldName) : undefined;
  if (fieldName && !field) {
    throw new DlError(`view ${view.name}.${metricName} ${aggregate}s unknown field ${entity.name}.${fieldName}`);
  }
  if (field && !isNumericType(field.type.raw)) {
    throw new DlError(`view ${view.name}.${metricName} ${aggregate} requires numeric field ${entity.name}.${field.name}`);
  }

  return {
    name: metricName,
    aggregate,
    entity: entity.name,
    table: entity.tableName,
    field: field
      ? {
          source: `${entity.name}.${field.name}`,
          field: field.name,
          column: field.columnName,
          type: field.type.raw,
        }
      : undefined,
    predicate: match[4] ? predicateExpressionIr(schema, view.name, metricName, entity, match[4].trim()) : undefined,
  };
}

function isNumericType(type: string): boolean {
  const required = type.endsWith("?") ? type.slice(0, -1) : type;
  return required === "Int" || required === "Int64" || required === "Float" || required.startsWith("Decimal");
}

function predicateExpressionIr(
  schema: SchemaIr,
  viewName: string,
  metricName: string,
  entity: EntityIr,
  source: string,
): ViewPredicateExpressionIr {
  const parser = new ViewPredicateParser(viewName, metricName, entity, source);
  const predicate = parser.parse();
  const fields: ViewFieldRefIr[] = [];
  const enumLiterals: ViewEnumLiteralRefIr[] = [];
  collectPredicateRefs(schema, viewName, metricName, predicate, fields, enumLiterals);
  return {
    source,
    fields: uniqueFields(fields),
    enumLiterals: uniqueEnumLiterals(enumLiterals),
    predicate,
  };
}

class ViewPredicateParser {
  private readonly tokens: ViewPredicateToken[];
  private index = 0;

  constructor(
    private readonly viewName: string,
    private readonly metricName: string,
    private readonly entity: EntityIr,
    source: string,
  ) {
    this.tokens = tokenizePredicate(source, viewName, metricName);
  }

  parse(): ViewPredicateIr {
    const predicate = this.parseOr();
    if (this.peek().kind !== "eof") {
      throw new DlError(`view ${this.viewName}.${this.metricName} predicate has unexpected token '${this.peek().source}'`);
    }
    return predicate;
  }

  private parseOr(): ViewPredicateIr {
    let left = this.parseAnd();
    while (this.matchKeyword("or")) {
      left = { kind: "Or", left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): ViewPredicateIr {
    let left = this.parseAtom();
    while (this.matchKeyword("and")) {
      left = { kind: "And", left, right: this.parseAtom() };
    }
    return left;
  }

  private parseAtom(): ViewPredicateIr {
    if (this.match("(")) {
      const predicate = this.parseOr();
      this.expect(")");
      return { kind: "Group", predicate };
    }
    return this.parseComparison();
  }

  private parseComparison(): ViewPredicateIr {
    const left = this.parseOperand();
    if (this.matchKeyword("in")) {
      this.expect("[");
      const values: ViewPredicateOperandIr[] = [];
      if (!this.match("]")) {
        do {
          values.push(this.parseOperand());
        } while (this.match(","));
        this.expect("]");
      }
      if (values.length === 0) {
        throw new DlError(`view ${this.viewName}.${this.metricName} predicate requires at least one value for in []`);
      }
      return { kind: "In", left, values };
    }

    const operator = this.peek();
    if (operator.kind !== "operator") {
      throw new DlError(`view ${this.viewName}.${this.metricName} predicate expected a comparison operator after '${operandSource(left)}'`);
    }
    this.index += 1;
    return {
      kind: "Comparison",
      operator: operator.source as ViewComparisonPredicateIr["operator"],
      left,
      right: this.parseOperand(),
    };
  }

  private parseOperand(): ViewPredicateOperandIr {
    const token = this.peek();
    if (token.kind === "identifier") {
      this.index += 1;
      if (this.match(".")) {
        const field = this.peek();
        if (field.kind !== "identifier") {
          throw new DlError(`view ${this.viewName}.${this.metricName} predicate expected a field name after '${token.source}.'`);
        }
        this.index += 1;
        if (token.source !== this.entity.name) {
          throw new DlError(`view ${this.viewName}.${this.metricName} predicate references unknown entity ${token.source}`);
        }
        return this.fieldOperand(`${token.source}.${field.source}`, field.source);
      }
      if (token.source === "true" || token.source === "false") {
        return { kind: "Boolean", value: token.source === "true" };
      }
      if (token.source === "null") {
        return { kind: "Null" };
      }
      const field = this.entity.fields.find((candidate) => candidate.name === token.source);
      if (field) {
        return fieldOperand(this.entity, token.source, field);
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
    throw new DlError(`view ${this.viewName}.${this.metricName} predicate expected a value but found '${token.source}'`);
  }

  private fieldOperand(source: string, fieldName: string): ViewPredicateOperandIr {
    const field = this.entity.fields.find((candidate) => candidate.name === fieldName);
    if (!field) {
      throw new DlError(`view ${this.viewName}.${this.metricName} predicate references unknown field ${this.entity.name}.${fieldName}`);
    }
    return fieldOperand(this.entity, source, field);
  }

  private peek(): ViewPredicateToken {
    return this.tokens[this.index] ?? { kind: "eof", source: "" };
  }

  private match(source: string): boolean {
    if (this.peek().source !== source) return false;
    this.index += 1;
    return true;
  }

  private expect(source: string): void {
    if (this.match(source)) return;
    throw new DlError(`view ${this.viewName}.${this.metricName} predicate expected '${source}' but found '${this.peek().source}'`);
  }

  private matchKeyword(source: "and" | "or" | "in"): boolean {
    const token = this.peek();
    if (token.kind !== "identifier" || token.source !== source) return false;
    this.index += 1;
    return true;
  }
}

function fieldOperand(entity: EntityIr, source: string, field: FieldIr): ViewPredicateOperandIr {
  return {
    kind: "Field",
    source,
    entity: entity.name,
    field: field.name,
    column: field.columnName,
    type: field.type.raw,
  };
}

function collectPredicateRefs(
  schema: SchemaIr,
  viewName: string,
  metricName: string,
  predicate: ViewPredicateIr,
  fields: ViewFieldRefIr[],
  enumLiterals: ViewEnumLiteralRefIr[],
): void {
  switch (predicate.kind) {
    case "And":
    case "Or":
      collectPredicateRefs(schema, viewName, metricName, predicate.left, fields, enumLiterals);
      collectPredicateRefs(schema, viewName, metricName, predicate.right, fields, enumLiterals);
      return;
    case "Group":
      collectPredicateRefs(schema, viewName, metricName, predicate.predicate, fields, enumLiterals);
      return;
    case "Comparison":
      collectOperandRefs(schema, viewName, metricName, predicate.left, predicate.right, fields, enumLiterals);
      collectOperandRefs(schema, viewName, metricName, predicate.right, predicate.left, fields, enumLiterals);
      return;
    case "In": {
      collectOperandRefs(schema, viewName, metricName, predicate.left, undefined, fields, enumLiterals);
      const field = predicate.left.kind === "Field" ? predicate.left : undefined;
      for (const value of predicate.values) {
        collectOperandRefs(schema, viewName, metricName, value, field, fields, enumLiterals);
      }
    }
  }
}

function collectOperandRefs(
  schema: SchemaIr,
  viewName: string,
  metricName: string,
  operand: ViewPredicateOperandIr,
  other: ViewPredicateOperandIr | undefined,
  fields: ViewFieldRefIr[],
  enumLiterals: ViewEnumLiteralRefIr[],
): void {
  if (operand.kind === "Field") {
    fields.push({
      source: operand.source,
      entity: operand.entity,
      field: operand.field,
      column: operand.column,
    });
    return;
  }

  if (operand.kind !== "Identifier") return;
  const otherField = other?.kind === "Field" ? other : undefined;
  const enumeration = otherField ? schema.enums.find((candidate) => candidate.name === otherField.type) : undefined;
  if (enumeration?.values.includes(operand.name)) {
    enumLiterals.push({
      source: operand.name,
      enumName: enumeration.name,
      value: operand.name,
    });
    return;
  }

  const target = otherField ? ` for ${otherField.entity}.${otherField.field}` : "";
  throw new DlError(`view ${viewName}.${metricName} predicate references unknown value ${operand.name}${target}`);
}

function tokenizePredicate(source: string, viewName: string, metricName: string): ViewPredicateToken[] {
  const tokens: ViewPredicateToken[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "(" || char === ")" || char === "." || char === "[" || char === "]" || char === ",") {
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
      const parsed = readStringToken(source, index, viewName, metricName);
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

    throw new DlError(`view ${viewName}.${metricName} predicate has unsupported token '${char}'`);
  }

  tokens.push({ kind: "eof", source: "" });
  return tokens;
}

function readStringToken(
  source: string,
  start: number,
  viewName: string,
  metricName: string,
): { token: ViewPredicateToken; nextIndex: number } {
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
  throw new DlError(`view ${viewName}.${metricName} predicate has an unterminated string literal`);
}

function uniqueFields(fields: ViewFieldRefIr[]): ViewFieldRefIr[] {
  const seen = new Set<string>();
  return fields.filter((field) => {
    const key = `${field.entity}.${field.field}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueEnumLiterals(literals: ViewEnumLiteralRefIr[]): ViewEnumLiteralRefIr[] {
  const seen = new Set<string>();
  return literals.filter((literal) => {
    const key = `${literal.enumName}.${literal.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function operandSource(operand: ViewPredicateOperandIr): string {
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
  }
}

type ViewPredicateToken =
  | { kind: "identifier"; source: string }
  | { kind: "number"; source: string }
  | { kind: "string"; source: string; value: string }
  | { kind: "operator"; source: string }
  | { kind: "punctuation"; source: string }
  | { kind: "eof"; source: string };
