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
}

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
    input = {
      kind: "Filter",
      input,
      predicate: expressionIr(schema, query, aliases, query.body.where),
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
