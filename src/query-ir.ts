import { QueryDeclaration, QueryProjection } from "./ast.js";
import { DlError } from "./errors.js";
import { EntityIr, FieldIr, findEntity, SchemaIr } from "./schema.js";

export type QueryIr = MapIr;

export type QueryInputIr = ScanIr | JoinIr | FilterIr | GroupIr | OrderIr | LimitIr | MapIr;

export interface QueryPlanIr {
  name: string;
  resultType: string;
  parameters: QueryParameterIr[];
  root: QueryIr;
}

export interface QueryParameterIr {
  name: string;
  type: string;
  position: number;
}

export interface ScanIr {
  kind: "Scan";
  entity: string;
  table: string;
  alias: string;
}

export interface JoinIr {
  kind: "Join";
  input: QueryInputIr;
  entity: string;
  table: string;
  alias: string;
  on: ExpressionIr;
}

export interface FilterIr {
  kind: "Filter";
  input: QueryInputIr;
  predicate: ExpressionIr;
}

export interface GroupIr {
  kind: "Group";
  input: QueryInputIr;
  keys: ExpressionIr[];
}

export interface OrderIr {
  kind: "Order";
  input: QueryInputIr;
  keys: OrderKeyIr[];
}

export interface LimitIr {
  kind: "Limit";
  input: QueryInputIr;
  count: ExpressionIr;
}

export interface OrderKeyIr {
  expression: ExpressionIr;
  direction: "asc" | "desc";
}

export interface MapIr {
  kind: "Map";
  input: QueryInputIr;
  projection: ProjectionIr;
}

export type ProjectionIr = EntityProjectionIr | RecordProjectionIr;

export interface EntityProjectionIr {
  kind: "Entity";
  alias: string;
}

export interface RecordProjectionIr {
  kind: "Record";
  fields: ProjectionFieldIr[];
}

export interface ProjectionFieldIr {
  name: string;
  expression: ExpressionIr;
}

export interface ExpressionIr {
  source: string;
  fields: FieldRefIr[];
  aliases: AliasRefIr[];
  parameters: ParameterRefIr[];
  enumLiterals: EnumLiteralRefIr[];
  predicate?: PredicateIr;
}

export type PredicateIr = LogicalPredicateIr | GroupPredicateIr | ComparisonPredicateIr;

export interface LogicalPredicateIr {
  kind: "And" | "Or";
  left: PredicateIr;
  right: PredicateIr;
}

export interface GroupPredicateIr {
  kind: "Group";
  predicate: PredicateIr;
}

export interface ComparisonPredicateIr {
  kind: "Comparison";
  operator: "==" | "!=" | ">" | ">=" | "<" | "<=";
  left: PredicateOperandIr;
  right: PredicateOperandIr;
}

export type PredicateOperandIr =
  | { kind: "Field"; source: string; alias: string; field: string }
  | { kind: "Identifier"; name: string }
  | { kind: "String"; value: string }
  | { kind: "Number"; value: string }
  | { kind: "Boolean"; value: boolean }
  | { kind: "Null" };

export interface FieldRefIr {
  source: string;
  entity: string;
  field: string;
  column: string;
  alias: string;
}

export interface AliasRefIr {
  name: string;
  entity: string;
  alias: string;
}

export interface ParameterRefIr {
  name: string;
  position: number;
}

export interface EnumLiteralRefIr {
  source: string;
  enumName: string;
  value: string;
}

export function buildQueryIr(schema: SchemaIr, query: QueryDeclaration): QueryPlanIr {
  const entity = findEntity(schema, query.body.sourceEntity);
  if (!entity) {
    throw new DlError(`query ${query.name} scans unknown entity ${query.body.sourceEntity}`);
  }
  const aliases = new Map<string, EntityIr>([[query.body.rangeName, entity]]);

  let input: QueryInputIr = {
    kind: "Scan",
    entity: entity.name,
    table: entity.tableName,
    alias: query.body.rangeName,
  };

  for (const join of query.body.joins) {
    const joinEntity = findEntity(schema, join.sourceEntity);
    if (!joinEntity) {
      throw new DlError(`query ${query.name} joins unknown entity ${join.sourceEntity}`);
    }
    aliases.set(join.rangeName, joinEntity);
    input = {
      kind: "Join",
      input,
      entity: joinEntity.name,
      table: joinEntity.tableName,
      alias: join.rangeName,
      on: expressionIr(schema, query, aliases, join.on),
    };
  }

  if (query.body.where) {
    const predicate = predicateExpressionIr(schema, query, aliases, query.body.where);
    input = {
      kind: "Filter",
      input,
      predicate,
    };
  }

  if (query.body.groupBy.length > 0) {
    input = {
      kind: "Group",
      input,
      keys: query.body.groupBy.map((expression) => expressionIr(schema, query, aliases, expression)),
    };
  }

  if (query.body.orderBy) {
    input = {
      kind: "Order",
      input,
      keys: [
        {
          expression: expressionIr(schema, query, aliases, query.body.orderBy.expression),
          direction: query.body.orderBy.direction,
        },
      ],
    };
  }

  if (query.body.limit) {
    input = {
      kind: "Limit",
      input,
      count: expressionIr(schema, query, aliases, query.body.limit),
    };
  }

  return {
    name: query.name,
    resultType: query.resultType,
    parameters: query.parameters.map((parameter, index) => ({
      name: parameter.name,
      type: parameter.type.raw,
      position: index + 1,
    })),
    root: {
      kind: "Map",
      input,
      projection: projectionIr(schema, query, aliases, query.body.select),
    },
  };
}

function projectionIr(
  schema: SchemaIr,
  query: QueryDeclaration,
  aliases: Map<string, EntityIr>,
  projection: QueryProjection,
): ProjectionIr {
  if (projection.kind === "entity") {
    if (projection.expression !== query.body.rangeName) {
      throw new DlError(`only selecting the range entity is supported for entity projections`);
    }
    return {
      kind: "Entity",
      alias: query.body.rangeName,
    };
  }

  return {
    kind: "Record",
    fields: projection.fields.map((field) => ({
      name: field.name,
      expression: expressionIr(schema, query, aliases, field.expression),
    })),
  };
}

function expressionIr(schema: SchemaIr, query: QueryDeclaration, aliases: Map<string, EntityIr>, source: string): ExpressionIr {
  const fields: FieldRefIr[] = [];
  for (const match of source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    const entity = aliases.get(match[1]);
    if (!entity) {
      throw new DlError(`query ${query.name} references unknown range ${match[1]}`);
    }
    const field = entity.fields.find((candidate) => candidate.name === match[2]);
    if (!field) {
      throw new DlError(`query ${query.name} references unknown field ${entity.name}.${match[2]}`);
    }
    fields.push({
      source: match[0],
      entity: entity.name,
      field: field.name,
      column: field.columnName,
      alias: match[1],
    });
  }

  const aliasRefs = [...aliases.entries()]
    .filter(([alias]) => new RegExp(`\\b${alias}\\b`).test(source) && !source.includes(`${alias}.`))
    .map(([alias, entity]) => ({
      name: alias,
      entity: entity.name,
      alias,
    }));

  const parameters = query.parameters
    .map((parameter, index) => ({
      name: parameter.name,
      position: index + 1,
    }))
    .filter((parameter) => new RegExp(`\\b${parameter.name}\\b`).test(source));

  const enumLiterals = collectEnumLiterals(schema, query, source, fields, aliases, parameters);

  return {
    source,
    fields,
    aliases: aliasRefs,
    parameters,
    enumLiterals,
  };
}

function predicateExpressionIr(
  schema: SchemaIr,
  query: QueryDeclaration,
  aliases: Map<string, EntityIr>,
  source: string,
): ExpressionIr {
  const expression = expressionIr(schema, query, aliases, source);
  const predicate = new PredicateParser(query.name, source).parse();
  validatePredicateOperands(schema, query, aliases, predicate);
  return {
    ...expression,
    predicate,
  };
}

class PredicateParser {
  private readonly tokens: PredicateToken[];
  private index = 0;

  constructor(
    private readonly queryName: string,
    source: string,
  ) {
    this.tokens = tokenizePredicate(source, queryName);
  }

  parse(): PredicateIr {
    const predicate = this.parseOr();
    if (this.peek().kind !== "eof") {
      throw new DlError(`query ${this.queryName} where predicate has unexpected token '${this.peek().source}'`);
    }
    return predicate;
  }

  private parseOr(): PredicateIr {
    let left = this.parseAnd();
    while (this.matchKeyword("or")) {
      left = {
        kind: "Or",
        left,
        right: this.parseAnd(),
      };
    }
    return left;
  }

  private parseAnd(): PredicateIr {
    let left = this.parseAtom();
    while (this.matchKeyword("and")) {
      left = {
        kind: "And",
        left,
        right: this.parseAtom(),
      };
    }
    return left;
  }

  private parseAtom(): PredicateIr {
    if (this.match("(")) {
      const predicate = this.parseOr();
      this.expect(")");
      return {
        kind: "Group",
        predicate,
      };
    }
    return this.parseComparison();
  }

  private parseComparison(): PredicateIr {
    const left = this.parseOperand();
    const operator = this.peek();
    if (operator.kind !== "operator") {
      throw new DlError(`query ${this.queryName} where predicate expected a comparison operator after '${operandSource(left)}'`);
    }
    this.index += 1;
    return {
      kind: "Comparison",
      operator: operator.source as ComparisonPredicateIr["operator"],
      left,
      right: this.parseOperand(),
    };
  }

  private parseOperand(): PredicateOperandIr {
    const token = this.peek();
    if (token.kind === "identifier") {
      this.index += 1;
      if (this.match(".")) {
        const field = this.peek();
        if (field.kind !== "identifier") {
          throw new DlError(`query ${this.queryName} where predicate expected a field name after '${token.source}.'`);
        }
        this.index += 1;
        return {
          kind: "Field",
          source: `${token.source}.${field.source}`,
          alias: token.source,
          field: field.source,
        };
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
    throw new DlError(`query ${this.queryName} where predicate expected a value but found '${token.source}'`);
  }

  private peek(): PredicateToken {
    return this.tokens[this.index] ?? { kind: "eof", source: "" };
  }

  private match(source: string): boolean {
    if (this.peek().source !== source) return false;
    this.index += 1;
    return true;
  }

  private expect(source: string): void {
    if (this.match(source)) return;
    throw new DlError(`query ${this.queryName} where predicate expected '${source}' but found '${this.peek().source}'`);
  }

  private matchKeyword(source: "and" | "or"): boolean {
    const token = this.peek();
    if (token.kind !== "identifier" || token.source !== source) return false;
    this.index += 1;
    return true;
  }
}

function validatePredicateOperands(
  schema: SchemaIr,
  query: QueryDeclaration,
  aliases: Map<string, EntityIr>,
  predicate: PredicateIr,
): void {
  if (predicate.kind === "And" || predicate.kind === "Or") {
    validatePredicateOperands(schema, query, aliases, predicate.left);
    validatePredicateOperands(schema, query, aliases, predicate.right);
    return;
  }

  if (predicate.kind === "Group") {
    validatePredicateOperands(schema, query, aliases, predicate.predicate);
    return;
  }

  if (predicate.kind === "Comparison") {
    validatePredicateOperand(schema, query, aliases, predicate.left, predicate.right);
    validatePredicateOperand(schema, query, aliases, predicate.right, predicate.left);
  }
}

function validatePredicateOperand(
  schema: SchemaIr,
  query: QueryDeclaration,
  aliases: Map<string, EntityIr>,
  operand: PredicateOperandIr,
  other: PredicateOperandIr,
): void {
  if (operand.kind === "Field") {
    const entity = aliases.get(operand.alias);
    if (!entity) {
      throw new DlError(`query ${query.name} references unknown range ${operand.alias}`);
    }
    if (!entity.fields.some((field) => field.name === operand.field)) {
      throw new DlError(`query ${query.name} references unknown field ${entity.name}.${operand.field}`);
    }
    return;
  }

  if (operand.kind !== "Identifier") return;
  if (query.parameters.some((parameter) => parameter.name === operand.name) || aliases.has(operand.name)) return;

  const otherField = predicateField(aliases, other);
  const enumeration = otherField ? schema.enums.find((candidate) => candidate.name === otherField.type.name) : undefined;
  if (enumeration?.values.includes(operand.name)) return;

  throw new DlError(`query ${query.name} where predicate references unknown value ${operand.name}`);
}

function predicateField(aliases: Map<string, EntityIr>, operand: PredicateOperandIr): FieldIr | undefined {
  if (operand.kind !== "Field") return undefined;
  return aliases.get(operand.alias)?.fields.find((field) => field.name === operand.field);
}

function tokenizePredicate(source: string, queryName: string): PredicateToken[] {
  const tokens: PredicateToken[] = [];
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
      const parsed = readStringToken(source, index, queryName);
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

    throw new DlError(`query ${queryName} where predicate has unsupported token '${char}'`);
  }

  tokens.push({ kind: "eof", source: "" });
  return tokens;
}

function readStringToken(
  source: string,
  start: number,
  queryName: string,
): { token: PredicateToken; nextIndex: number } {
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
  throw new DlError(`query ${queryName} where predicate has an unterminated string literal`);
}

function operandSource(operand: PredicateOperandIr): string {
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

type PredicateToken =
  | { kind: "identifier"; source: string }
  | { kind: "number"; source: string }
  | { kind: "string"; source: string; value: string }
  | { kind: "operator"; source: string }
  | { kind: "punctuation"; source: string }
  | { kind: "eof"; source: string };

function collectEnumLiterals(
  schema: SchemaIr,
  query: QueryDeclaration,
  source: string,
  fields: FieldRefIr[],
  aliases: Map<string, EntityIr>,
  parameters: ParameterRefIr[],
): EnumLiteralRefIr[] {
  const literals: EnumLiteralRefIr[] = [];
  const seen = new Set<string>();
  const parameterNames = new Set(parameters.map((parameter) => parameter.name));

  for (const fieldRef of fields) {
    const field = fieldForRef(aliases, fieldRef);
    const enumeration = schema.enums.find((candidate) => candidate.name === field?.type.name);
    if (!field || !enumeration) continue;

    for (const token of comparedBareTokens(source, fieldRef.source)) {
      if (parameterNames.has(token) || aliases.has(token)) continue;
      if (!enumeration.values.includes(token)) {
        throw new DlError(`query ${query.name} compares ${fieldRef.entity}.${fieldRef.field} to invalid ${enumeration.name} value ${token}`);
      }
      const key = `${enumeration.name}:${token}`;
      if (seen.has(key)) continue;
      seen.add(key);
      literals.push({
        source: token,
        enumName: enumeration.name,
        value: token,
      });
    }
  }

  return literals;
}

function fieldForRef(aliases: Map<string, EntityIr>, fieldRef: FieldRefIr): FieldIr | undefined {
  return aliases.get(fieldRef.alias)?.fields.find((field) => field.name === fieldRef.field);
}

function comparedBareTokens(source: string, fieldSource: string): string[] {
  const escaped = escapeRegExp(fieldSource);
  const token = "([A-Za-z_][A-Za-z0-9_]*)";
  const after = new RegExp(`\\b${escaped}\\b\\s*(?:==|!=)\\s*\\b${token}\\b(?!\\s*\\.)`, "g");
  const before = new RegExp(`(?<!\\.)\\b${token}\\b(?!\\s*\\.)\\s*(?:==|!=)\\s*\\b${escaped}\\b`, "g");
  return [...source.matchAll(after), ...source.matchAll(before)].map((match) => match[1]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
