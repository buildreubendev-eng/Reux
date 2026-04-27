import { EntityDeclaration, FieldDeclaration, Program, QueryDeclaration, QueryProjection, TypeRef } from "./ast.js";
import { DlAggregateError } from "./errors.js";

export interface SchemaIr {
  moduleName: string;
  entities: EntityIr[];
  enums: EnumIr[];
}

export interface EntityIr {
  name: string;
  tableName: string;
  fields: FieldIr[];
  indexes: IndexIr[];
}

export interface FieldIr {
  name: string;
  columnName: string;
  type: TypeRef;
  nullable: boolean;
  primary: boolean;
  generated: boolean;
  unique: boolean;
  defaultValue?: string;
  check?: string;
  reference?: {
    entity: string;
    columnName: string;
  };
}

export interface IndexIr {
  name: string;
  fields: {
    name: string;
    columnName: string;
    direction?: "asc" | "desc";
  }[];
}

export interface EnumIr {
  name: string;
  values: string[];
}

const scalarTypes = new Set([
  "Bool",
  "Int",
  "Int64",
  "Float",
  "Decimal",
  "String",
  "Bytes",
  "Date",
  "Time",
  "Instant",
  "Duration",
  "Uuid",
  "Json",
]);

export function buildSchema(program: Program): SchemaIr {
  const diagnostics: string[] = [];
  const entityDecls = program.declarations.filter((decl): decl is EntityDeclaration => decl.kind === "entity");
  const enumDecls = program.declarations.filter((decl) => decl.kind === "enum");
  const queryDecls = program.declarations.filter((decl): decl is QueryDeclaration => decl.kind === "query");
  const transactionDecls = program.declarations.filter((decl) => decl.kind === "transaction");
  const entityNames = new Set(entityDecls.map((entity) => entity.name));
  const enumNames = new Set(enumDecls.map((enumeration) => enumeration.name));

  for (const duplicate of duplicates(entityDecls.map((entity) => entity.name))) {
    diagnostics.push(`duplicate entity declaration ${duplicate}`);
  }
  for (const duplicate of duplicates(enumDecls.map((enumeration) => enumeration.name))) {
    diagnostics.push(`duplicate enum declaration ${duplicate}`);
  }
  for (const duplicate of duplicates(queryDecls.map((query) => query.name))) {
    diagnostics.push(`duplicate query declaration ${duplicate}`);
  }
  for (const duplicate of duplicates(transactionDecls.map((transaction) => transaction.name))) {
    diagnostics.push(`duplicate transaction declaration ${duplicate}`);
  }
  for (const duplicate of [...entityNames].filter((name) => enumNames.has(name))) {
    diagnostics.push(`duplicate durable type declaration ${duplicate}`);
  }

  for (const entity of entityDecls) {
    const seen = new Set<string>();
    for (const duplicate of duplicates(entity.indexes.map((index) => index.name))) {
      diagnostics.push(`entity ${entity.name} declares duplicate index ${duplicate}`);
    }
    const primaryFields = entity.fields.filter((field) => field.attributes.primary);
    if (primaryFields.length === 0) {
      diagnostics.push(`entity ${entity.name} must declare a primary field`);
    }
    if (primaryFields.length > 1) {
      diagnostics.push(`entity ${entity.name} declares multiple primary fields`);
    }

    for (const field of entity.fields) {
      if (seen.has(field.name)) {
        diagnostics.push(`entity ${entity.name} declares duplicate field ${field.name}`);
      }
      seen.add(field.name);
      validateType(field, entity.name, entityNames, enumNames, diagnostics);
    }

    for (const index of entity.indexes) {
      for (const field of index.fields) {
        if (!seen.has(field.name)) {
          diagnostics.push(`index ${entity.name}.${index.name} references unknown field ${field.name}`);
        }
      }
    }
  }

  for (const enumeration of enumDecls) {
    for (const duplicate of duplicates(enumeration.values)) {
      diagnostics.push(`enum ${enumeration.name} declares duplicate value ${duplicate}`);
    }
  }

  for (const query of queryDecls) {
    for (const duplicate of duplicates(query.parameters.map((parameter) => parameter.name))) {
      diagnostics.push(`query ${query.name} declares duplicate parameter ${duplicate}`);
    }
    if (!entityNames.has(query.body.sourceEntity)) {
      diagnostics.push(`query ${query.name} scans unknown entity ${query.body.sourceEntity}`);
    } else {
      validateQuery(query, entityDecls, diagnostics);
    }
    for (const param of query.parameters) {
      validateType({ name: param.name, type: param.type, attributes: emptyAttrs(), source: param.type.raw }, `query ${query.name}`, entityNames, enumNames, diagnostics);
    }
  }

  for (const transaction of transactionDecls) {
    for (const duplicate of duplicates(transaction.parameters.map((parameter) => parameter.name))) {
      diagnostics.push(`transaction ${transaction.name} declares duplicate parameter ${duplicate}`);
    }
    for (const param of transaction.parameters) {
      validateType({ name: param.name, type: param.type, attributes: emptyAttrs(), source: param.type.raw }, `transaction ${transaction.name}`, entityNames, enumNames, diagnostics);
    }
    for (const write of transaction.writes) {
      if (!entityNames.has(write)) {
        diagnostics.push(`transaction ${transaction.name} declares write to unknown entity ${write}`);
      }
    }
    if (transaction.retry && transaction.retry.attempts < 1) {
      diagnostics.push(`transaction ${transaction.name} retry attempts must be greater than zero`);
    }
    validateTransactionEffects(transaction, entityNames, diagnostics);
  }

  if (diagnostics.length > 0) {
    throw new DlAggregateError(diagnostics);
  }

  return {
    moduleName: program.moduleName,
    entities: entityDecls.map((entity) => lowerEntity(entity, entityNames)),
    enums: enumDecls.map((enumeration) => ({
      name: enumeration.name,
      values: enumeration.values,
    })),
  };
}

export function findEntity(schema: SchemaIr, entityName: string): EntityIr | undefined {
  return schema.entities.find((entity) => entity.name === entityName);
}

export function snakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

function lowerEntity(entity: EntityDeclaration, entityNames: Set<string>): EntityIr {
  const fields = entity.fields.map((field) => lowerField(field, entityNames));
  return {
    name: entity.name,
    tableName: pluralize(snakeCase(entity.name)),
    fields,
    indexes: entity.indexes.map((index) => ({
      name: index.name,
      fields: index.fields.map((field) => ({
        ...field,
        columnName: fields.find((candidate) => candidate.name === field.name)?.columnName ?? snakeCase(field.name),
      })),
    })),
  };
}

function lowerField(field: FieldDeclaration, entityNames: Set<string>): FieldIr {
  const isReference = entityNames.has(field.type.name);
  return {
    name: field.name,
    columnName: isReference ? `${snakeCase(field.name)}_id` : snakeCase(field.name),
    type: field.type,
    nullable: field.type.optional && !field.attributes.primary,
    primary: field.attributes.primary,
    generated: field.attributes.generated,
    unique: field.attributes.unique,
    defaultValue: field.attributes.defaultValue,
    check: field.attributes.check,
    reference: isReference
      ? {
          entity: field.type.name,
          columnName: `${snakeCase(field.name)}_id`,
        }
      : undefined,
  };
}

function validateType(
  field: FieldDeclaration,
  owner: string,
  entityNames: Set<string>,
  enumNames: Set<string>,
  diagnostics: string[],
): void {
  if (field.type.name === "Id") {
    if (field.type.args.length !== 1 || !entityNames.has(field.type.args[0].name)) {
      diagnostics.push(`${owner}.${field.name} uses Id<T> with an unknown entity`);
    }
    return;
  }

  if (field.type.args.length > 0) {
    diagnostics.push(`${owner}.${field.name} uses unsupported generic type ${field.type.raw}`);
    return;
  }

  if (!scalarTypes.has(field.type.name) && !entityNames.has(field.type.name) && !enumNames.has(field.type.name)) {
    diagnostics.push(`${owner}.${field.name} uses unknown type ${field.type.raw}`);
  }
}

function validateQuery(query: QueryDeclaration, entities: EntityDeclaration[], diagnostics: string[]): void {
  const entity = entities.find((candidate) => candidate.name === query.body.sourceEntity);
  if (!entity) return;
  const aliases = new Map<string, EntityDeclaration>([[query.body.rangeName, entity]]);

  for (const join of query.body.joins) {
    const joinEntity = entities.find((candidate) => candidate.name === join.sourceEntity);
    if (!joinEntity) {
      diagnostics.push(`query ${query.name} joins unknown entity ${join.sourceEntity}`);
      continue;
    }
    if (aliases.has(join.rangeName)) {
      diagnostics.push(`query ${query.name} declares duplicate range ${join.rangeName}`);
    }
    aliases.set(join.rangeName, joinEntity);
  }

  if (query.body.select.kind === "record") {
    for (const duplicate of duplicates(query.body.select.fields.map((field) => field.name))) {
      diagnostics.push(`query ${query.name} declares duplicate projection field ${duplicate}`);
    }
  }

  const expressions = [
    ...query.body.joins.map((join) => join.on),
    query.body.where,
    ...query.body.groupBy,
    query.body.orderBy?.expression,
    ...projectionExpressions(query.body.select),
  ].filter((expression): expression is string => Boolean(expression));

  for (const expression of expressions) {
    const references = expression.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g);
    for (const reference of references) {
      const aliasEntity = aliases.get(reference[1]);
      if (!aliasEntity) {
        diagnostics.push(`query ${query.name} references unknown range ${reference[1]}`);
        continue;
      }
      const fieldName = reference[2];
      if (!aliasEntity.fields.some((field) => field.name === fieldName)) {
        diagnostics.push(`query ${query.name} references unknown field ${aliasEntity.name}.${fieldName}`);
      }
    }
  }

  validateQueryResultType(query, aliases, diagnostics);
}

function projectionExpressions(projection: QueryProjection): string[] {
  if (projection.kind === "entity") return [projection.expression];
  return projection.fields.map((field) => field.expression);
}

function validateQueryResultType(query: QueryDeclaration, aliases: Map<string, EntityDeclaration>, diagnostics: string[]): void {
  if (query.body.select.kind === "entity") {
    const entity = aliases.get(query.body.rangeName);
    if (!entity) return;
    if (query.body.groupBy.length > 0) {
      diagnostics.push(`query ${query.name} cannot select an entity from a grouped query`);
      return;
    }
    if (query.resultType !== `Query<${entity.name}>`) {
      diagnostics.push(`query ${query.name} selects ${entity.name} but declares ${query.resultType}`);
    }
    return;
  }

  const declaredFields = parseResultRecord(query.resultType);
  if (!declaredFields) return;

  for (const projection of query.body.select.fields) {
    const declared = declaredFields.get(projection.name);
    if (!declared) {
      diagnostics.push(`query ${query.name} projection field ${projection.name} is missing from declared result type`);
      continue;
    }

    if (isCountExpression(projection.expression)) {
      if (declared !== "Int64") {
        diagnostics.push(`query ${query.name} declares ${projection.name}: ${declared} but count() is Int64`);
      }
      continue;
    }

    const sumMatch = projection.expression.match(/^sum\(([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\)$/);
    if (sumMatch) {
      const entity = aliases.get(sumMatch[1]);
      const entityField = entity?.fields.find((field) => field.name === sumMatch[2]);
      if (entity && entityField && declared !== entityField.type.raw) {
        diagnostics.push(
          `query ${query.name} declares ${projection.name}: ${declared} but sum(${entity.name}.${entityField.name}) is ${entityField.type.raw}`,
        );
      }
      continue;
    }

    const fieldMatch = projection.expression.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/);
    if (!fieldMatch) continue;
    if (query.body.groupBy.length > 0 && !query.body.groupBy.includes(projection.expression)) {
      diagnostics.push(`query ${query.name} projects ${projection.expression} without grouping by it`);
    }
    const entity = aliases.get(fieldMatch[1]);
    const entityField = entity?.fields.find((field) => field.name === fieldMatch[2]);
    if (entity && entityField && declared !== entityField.type.raw) {
      diagnostics.push(
        `query ${query.name} declares ${projection.name}: ${declared} but ${entity.name}.${entityField.name} is ${entityField.type.raw}`,
      );
    }
  }

  const projectedFields = new Set(query.body.select.fields.map((field) => field.name));
  for (const declaredField of declaredFields.keys()) {
    if (!projectedFields.has(declaredField)) {
      diagnostics.push(`query ${query.name} declares result field ${declaredField} but does not project it`);
    }
  }
}

function isCountExpression(expression: string): boolean {
  return /^count\(\s*\)$/.test(expression);
}

function validateTransactionEffects(
  transaction: Extract<Program["declarations"][number], { kind: "transaction" }>,
  entityNames: Set<string>,
  diagnostics: string[],
): void {
  const writes = new Set(transaction.writes);
  const parameterEntities = new Map(
    transaction.parameters
      .filter((parameter) => entityNames.has(parameter.type.name))
      .map((parameter) => [parameter.name, parameter.type.name]),
  );
  const loadedEntities = new Map<string, string>();

  for (const line of transaction.body.split("\n").map((sourceLine) => sourceLine.trim()).filter(Boolean)) {
    const load = line.match(/^let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*load\s+([A-Za-z_][A-Za-z0-9_]*)\s+for\s+update$/);
    if (load) {
      const entity = parameterEntities.get(load[2]);
      if (entity) loadedEntities.set(load[1], entity);
      continue;
    }

    const mutation = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\.[A-Za-z_][A-Za-z0-9_]*\s*(?:\+=|-=|=)\s*.+$/);
    if (mutation) {
      const entity = loadedEntities.get(mutation[1]);
      if (entity && !writes.has(entity)) {
        diagnostics.push(`transaction ${transaction.name} mutates ${entity} through ${mutation[1]} but does not declare writes ${entity}`);
      }
      continue;
    }

    const save = line.match(/^save\s+([A-Za-z_][A-Za-z0-9_]*)$/);
    if (save) {
      const entity = loadedEntities.get(save[1]);
      if (entity && !writes.has(entity)) {
        diagnostics.push(`transaction ${transaction.name} saves ${entity} through ${save[1]} but does not declare writes ${entity}`);
      }
      continue;
    }

    const insert = line.match(/^insert\s+([A-Za-z_][A-Za-z0-9_]*)\s+/);
    if (insert) {
      if (!entityNames.has(insert[1])) {
        diagnostics.push(`transaction ${transaction.name} inserts unknown entity ${insert[1]}`);
      } else if (!writes.has(insert[1])) {
        diagnostics.push(`transaction ${transaction.name} inserts ${insert[1]} but does not declare writes ${insert[1]}`);
      }
      continue;
    }

    if (transaction.retry && isRetryUnsafeExternalCall(line)) {
      diagnostics.push(
        `transaction ${transaction.name} is retryable but calls external function '${line}'. Move it to 'after commit ...' or persist an outbox event with 'enqueue ...'.`,
      );
    }
  }
}

function isRetryUnsafeExternalCall(line: string): boolean {
  if (line.startsWith("after commit ")) return false;
  if (line.startsWith("enqueue ")) return false;
  return /^[A-Za-z_][A-Za-z0-9_]*\([^)]*\)$/.test(line);
}

function parseResultRecord(resultType: string): Map<string, string> | undefined {
  const match = resultType.match(/^Query<\{(.+)\}>$/);
  if (!match) return undefined;

  const fields = new Map<string, string>();
  for (const part of splitTopLevel(match[1], ",")) {
    const separator = part.indexOf(":");
    if (separator < 0) return undefined;
    fields.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  return fields;
}

function splitTopLevel(source: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "<" || char === "{" || char === "(") depth += 1;
    if (char === ">" || char === "}" || char === ")") depth -= 1;
    if (depth === 0 && char === separator) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}

function emptyAttrs() {
  return {
    primary: false,
    generated: false,
    required: false,
    unique: false,
  };
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicateValues = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicateValues.add(value);
    }
    seen.add(value);
  }
  return [...duplicateValues];
}

function pluralize(value: string): string {
  if (value.endsWith("y")) return `${value.slice(0, -1)}ies`;
  if (value.endsWith("s")) return `${value}es`;
  return `${value}s`;
}
