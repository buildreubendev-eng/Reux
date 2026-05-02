import {
  EntityDeclaration,
  EventDeclaration,
  FieldDeclaration,
  Program,
  QueryDeclaration,
  QueryProjection,
  TransitionDeclaration,
  TypeRef,
} from "./ast.js";
import { DlAggregateError } from "./errors.js";
import { parseObjectLiteral } from "./object-literal.js";
import { parseTypeRef } from "./parser.js";

export interface SchemaIr {
  moduleName: string;
  entities: EntityIr[];
  enums: EnumIr[];
  events: EventIr[];
  transitions: TransitionIr[];
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

export interface EventIr {
  name: string;
  fields: EventFieldIr[];
}

export interface EventFieldIr {
  name: string;
  type: TypeRef;
  nullable: boolean;
}

export interface TransitionIr {
  entity: string;
  field: string;
  enumName: string;
  from: string;
  to: string;
}

const scalarTypes = new Set([
  "Bool",
  "Int",
  "Int64",
  "Float",
  "Decimal",
  "CurrencyCode",
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
  const eventDecls = program.declarations.filter((decl): decl is EventDeclaration => decl.kind === "event");
  const queryDecls = program.declarations.filter((decl): decl is QueryDeclaration => decl.kind === "query");
  const transactionDecls = program.declarations.filter((decl) => decl.kind === "transaction");
  const transitionDecls = program.declarations.filter((decl): decl is TransitionDeclaration => decl.kind === "transition");
  const entityNames = new Set(entityDecls.map((entity) => entity.name));
  const enumNames = new Set(enumDecls.map((enumeration) => enumeration.name));

  for (const duplicate of duplicates(entityDecls.map((entity) => entity.name))) {
    diagnostics.push(`duplicate entity declaration ${duplicate}`);
  }
  for (const duplicate of duplicates(enumDecls.map((enumeration) => enumeration.name))) {
    diagnostics.push(`duplicate enum declaration ${duplicate}`);
  }
  for (const duplicate of duplicates(eventDecls.map((event) => event.name))) {
    diagnostics.push(`duplicate event declaration ${duplicate}`);
  }
  for (const duplicate of duplicates(queryDecls.map((query) => query.name))) {
    diagnostics.push(`duplicate query declaration ${duplicate}`);
  }
  for (const duplicate of duplicates(transactionDecls.map((transaction) => transaction.name))) {
    diagnostics.push(`duplicate transaction declaration ${duplicate}`);
  }
  for (const duplicate of duplicates(transitionDecls.map((transition) => `${transition.entity}.${transition.field}`))) {
    diagnostics.push(`duplicate transition declaration ${duplicate}`);
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

  for (const event of eventDecls) {
    const seen = new Set<string>();
    for (const field of event.fields) {
      if (seen.has(field.name)) {
        diagnostics.push(`event ${event.name} declares duplicate field ${field.name}`);
      }
      seen.add(field.name);
      validateType(field, `event ${event.name}`, entityNames, enumNames, diagnostics);
    }
  }

  for (const query of queryDecls) {
    for (const duplicate of duplicates(query.parameters.map((parameter) => parameter.name))) {
      diagnostics.push(`query ${query.name} declares duplicate parameter ${duplicate}`);
    }
    if (!entityNames.has(query.body.sourceEntity)) {
      diagnostics.push(`query ${query.name} scans unknown entity ${query.body.sourceEntity}`);
    } else {
      validateQuery(query, entityDecls, enumNames, diagnostics);
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
    validateTransactionEffects(transaction, entityDecls, enumDecls, eventDecls, transitionDecls, diagnostics);
  }

  validateTransitions(transitionDecls, entityDecls, enumDecls, diagnostics);

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
    events: eventDecls.map((event) => ({
      name: event.name,
      fields: event.fields.map((field) => ({
        name: field.name,
        type: field.type,
        nullable: field.type.optional,
      })),
    })),
    transitions: lowerTransitions(transitionDecls, entityDecls),
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

  if (field.type.name === "Decimal") {
    validateDecimalType(field, owner, diagnostics);
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

function validateDecimalType(field: FieldDeclaration, owner: string, diagnostics: string[]): void {
  if (field.type.args.length === 0) return;
  if (field.type.args.length !== 2) {
    diagnostics.push(`${owner}.${field.name} uses Decimal precision as Decimal<precision, scale>`);
    return;
  }
  const [precision, scale] = field.type.args.map(decimalTypeArgument);
  if (precision === undefined || scale === undefined) {
    diagnostics.push(`${owner}.${field.name} uses Decimal precision and scale as integer literals`);
    return;
  }
  if (precision < 1 || precision > 1000) {
    diagnostics.push(`${owner}.${field.name} Decimal precision must be between 1 and 1000`);
  }
  if (scale < 0 || scale > precision) {
    diagnostics.push(`${owner}.${field.name} Decimal scale must be between 0 and precision`);
  }
}

function decimalTypeArgument(type: TypeRef): number | undefined {
  if (type.optional || type.args.length > 0 || !/^\d+$/.test(type.name)) return undefined;
  return Number.parseInt(type.name, 10);
}

function validateQuery(query: QueryDeclaration, entities: EntityDeclaration[], enumNames: Set<string>, diagnostics: string[]): void {
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
    query.body.after,
    ...query.body.groupBy,
    query.body.orderBy?.expression,
    query.body.limit,
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

  validateQueryPagination(query, diagnostics);
  validateQueryResultType(query, aliases, new Set(entities.map((entity) => entity.name)), enumNames, diagnostics);
}

function projectionExpressions(projection: QueryProjection): string[] {
  if (projection.kind === "entity") return [projection.expression];
  return projection.fields.map((field) => field.expression);
}

function validateQueryPagination(query: QueryDeclaration, diagnostics: string[]): void {
  if (query.body.after) {
    if (!query.body.orderBy) {
      diagnostics.push(`query ${query.name} after requires order by for deterministic cursor pagination`);
    }
    if (!query.body.limit) {
      diagnostics.push(`query ${query.name} after requires limit for bounded cursor pagination`);
    }
    if (!query.parameters.some((parameter) => new RegExp(`\\b${parameter.name}\\b`).test(query.body.after ?? ""))) {
      diagnostics.push(`query ${query.name} after must compare against a query parameter`);
    }
  }

  if (!query.body.limit) return;
  if (!query.body.orderBy) {
    diagnostics.push(`query ${query.name} limit requires order by for deterministic pagination`);
  }
  const limit = query.body.limit.trim();
  if (/^[1-9][0-9]*$/.test(limit)) {
    if (Number.parseInt(limit, 10) > 1000) {
      diagnostics.push(`query ${query.name} limit literal must be 1000 or less`);
    }
    return;
  }

  const parameter = query.parameters.find((candidate) => candidate.name === limit);
  if (parameter) {
    if (parameter.type.optional || (parameter.type.name !== "Int" && parameter.type.name !== "Int64")) {
      diagnostics.push(`query ${query.name} limit parameter ${parameter.name} must be Int or Int64`);
    }
    return;
  }

  diagnostics.push(`query ${query.name} limit must be a positive integer literal or Int parameter`);
}

function validateQueryResultType(
  query: QueryDeclaration,
  aliases: Map<string, EntityDeclaration>,
  entityNames: Set<string>,
  enumNames: Set<string>,
  diagnostics: string[],
): void {
  if (query.resultType === "Query<infer>") {
    validateInferredQueryResultType(query, aliases, diagnostics);
    return;
  }

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

  for (const [fieldName, sourceType] of declaredFields) {
    validateType(
      { name: fieldName, type: parseTypeRef(sourceType), attributes: emptyAttrs(), source: sourceType },
      `query ${query.name} result`,
      entityNames,
      enumNames,
      diagnostics,
    );
  }

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

    const aggregate = aggregateExpression(projection.expression);
    if (aggregate) {
      const entity = aliases.get(aggregate.alias);
      const entityField = entity?.fields.find((field) => field.name === aggregate.field);
      if (entity && entityField && declared !== entityField.type.raw) {
        diagnostics.push(
          `query ${query.name} declares ${projection.name}: ${declared} but ${aggregate.fn}(${entity.name}.${entityField.name}) is ${entityField.type.raw}`,
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
    const expected = entityField ? queryExpressionFieldType(query, fieldMatch[1], entityField.type.raw) : undefined;
    if (entity && entityField && declared !== expected) {
      diagnostics.push(
        `query ${query.name} declares ${projection.name}: ${declared} but ${entity.name}.${entityField.name} is ${expected}`,
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

function validateInferredQueryResultType(
  query: QueryDeclaration,
  aliases: Map<string, EntityDeclaration>,
  diagnostics: string[],
): void {
  if (query.body.select.kind === "entity") {
    if (!aliases.has(query.body.select.expression)) {
      diagnostics.push(`query ${query.name} cannot infer unknown entity projection ${query.body.select.expression}`);
    }
    if (query.body.groupBy.length > 0) {
      diagnostics.push(`query ${query.name} cannot select an entity from a grouped query`);
    }
    return;
  }

  for (const projection of query.body.select.fields) {
    if (isCountExpression(projection.expression) || aggregateExpression(projection.expression)) continue;
    const fieldMatch = projection.expression.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/);
    if (!fieldMatch) {
      diagnostics.push(`query ${query.name} cannot infer projection field ${projection.name} from expression ${projection.expression}`);
      continue;
    }
    if (query.body.groupBy.length > 0 && !query.body.groupBy.includes(projection.expression)) {
      diagnostics.push(`query ${query.name} projects ${projection.expression} without grouping by it`);
    }
  }
}

function queryExpressionFieldType(query: QueryDeclaration, alias: string, fieldType: string): string {
  const nullableAlias = query.body.joins.some((join) => join.kind === "left" && join.rangeName === alias);
  return nullableAlias && !fieldType.endsWith("?") ? `${fieldType}?` : fieldType;
}

function isCountExpression(expression: string): boolean {
  return /^count\(\s*\)$/.test(expression);
}

function aggregateExpression(expression: string): { fn: "sum" | "avg" | "min" | "max"; alias: string; field: string } | undefined {
  const match = expression.match(/^(sum|avg|min|max)\(([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\)$/);
  if (!match) return undefined;
  return {
    fn: match[1] as "sum" | "avg" | "min" | "max",
    alias: match[2],
    field: match[3],
  };
}

function validateTransitions(
  transitions: TransitionDeclaration[],
  entities: EntityDeclaration[],
  enumerations: Extract<Program["declarations"][number], { kind: "enum" }>[],
  diagnostics: string[],
): void {
  const enumByName = new Map(enumerations.map((enumeration) => [enumeration.name, enumeration]));

  for (const transition of transitions) {
    const entity = entities.find((candidate) => candidate.name === transition.entity);
    if (!entity) {
      diagnostics.push(`transition ${transition.entity}.${transition.field} references unknown entity ${transition.entity}`);
      continue;
    }

    const field = entity.fields.find((candidate) => candidate.name === transition.field);
    if (!field) {
      diagnostics.push(`transition ${transition.entity}.${transition.field} references unknown field ${transition.entity}.${transition.field}`);
      continue;
    }

    const enumeration = enumByName.get(field.type.name);
    if (!enumeration) {
      diagnostics.push(`transition ${transition.entity}.${transition.field} must target an enum field`);
      continue;
    }

    if (transition.rules.length === 0) {
      diagnostics.push(`transition ${transition.entity}.${transition.field} must declare at least one rule`);
    }

    for (const duplicate of duplicates(transition.rules.map((rule) => `${rule.from}->${rule.to}`))) {
      diagnostics.push(`transition ${transition.entity}.${transition.field} declares duplicate rule ${duplicate}`);
    }

    for (const rule of transition.rules) {
      if (!enumeration.values.includes(rule.from)) {
        diagnostics.push(`transition ${transition.entity}.${transition.field} references invalid ${enumeration.name} value ${rule.from}`);
      }
      if (!enumeration.values.includes(rule.to)) {
        diagnostics.push(`transition ${transition.entity}.${transition.field} references invalid ${enumeration.name} value ${rule.to}`);
      }
      if (rule.from === rule.to) {
        diagnostics.push(`transition ${transition.entity}.${transition.field} declares no-op rule ${rule.from}->${rule.to}`);
      }
    }
  }
}

function lowerTransitions(transitions: TransitionDeclaration[], entities: EntityDeclaration[]): TransitionIr[] {
  return transitions.flatMap((transition) => {
    const entity = entities.find((candidate) => candidate.name === transition.entity);
    const field = entity?.fields.find((candidate) => candidate.name === transition.field);
    if (!field) return [];
    return transition.rules.map((rule) => ({
      entity: transition.entity,
      field: transition.field,
      enumName: field.type.name,
      from: rule.from,
      to: rule.to,
    }));
  });
}

function validateTransactionEffects(
  transaction: Extract<Program["declarations"][number], { kind: "transaction" }>,
  entities: EntityDeclaration[],
  enumerations: Extract<Program["declarations"][number], { kind: "enum" }>[],
  events: EventDeclaration[],
  transitions: TransitionDeclaration[],
  diagnostics: string[],
): void {
  const entityNames = new Set(entities.map((entity) => entity.name));
  const enumByName = new Map(enumerations.map((enumeration) => [enumeration.name, enumeration]));
  const eventByName = new Map(events.map((event) => [event.name, event]));
  const writes = new Set(transaction.writes);
  const parameterEntities = new Map(
    transaction.parameters
      .filter((parameter) => entityNames.has(parameter.type.name))
      .map((parameter) => [parameter.name, parameter.type.name]),
  );
  const parameterTypes = new Map(transaction.parameters.map((parameter) => [parameter.name, parameter.type.raw]));
  const loadedEntities = new Map<string, string>();
  const boundEntities = new Map<string, string>();

  for (const line of transactionBodyLines(transaction.body)) {
    const load = line.match(/^let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*load\s+([A-Za-z_][A-Za-z0-9_]*)\s+for\s+update$/);
    if (load) {
      const entity = parameterEntities.get(load[2]);
      if (entity) {
        loadedEntities.set(load[1], entity);
        boundEntities.set(load[1], entity);
      } else {
        diagnostics.push(`transaction ${transaction.name} loads non-entity parameter ${load[2]}`);
      }
      continue;
    }

    const mutation = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\.[A-Za-z_][A-Za-z0-9_]*\s*(?:\+=|-=|=)\s*.+$/);
    if (mutation) {
      const entity = loadedEntities.get(mutation[1]);
      if (entity && !writes.has(entity)) {
        diagnostics.push(`transaction ${transaction.name} mutates ${entity} through ${mutation[1]} but does not declare writes ${entity}`);
      }
      validateMutationExpression(transaction.name, line, entity, entities, enumByName, parameterTypes, boundEntities, transitions, diagnostics);
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

    const insert = line.match(/^(?:let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*)?insert\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/);
    if (insert) {
      if (!entityNames.has(insert[2])) {
        diagnostics.push(`transaction ${transaction.name} inserts unknown entity ${insert[2]}`);
      } else if (!writes.has(insert[2])) {
        diagnostics.push(`transaction ${transaction.name} inserts ${insert[2]} but does not declare writes ${insert[2]}`);
      }
      validateInsertFields(transaction.name, line, entities, enumByName, parameterTypes, diagnostics);
      validateInsertExpressionTypes(transaction.name, line, entities, enumByName, parameterTypes, boundEntities, diagnostics);
      validateBoundReferences(transaction.name, insert[3], entities, boundEntities, diagnostics);
      if (insert[1] && entityNames.has(insert[2])) {
        boundEntities.set(insert[1], insert[2]);
      }
      continue;
    }

    const enqueue = line.match(/^enqueue\s+[A-Za-z_][A-Za-z0-9_]*\s+(.+)$/);
    if (enqueue) {
      validateBoundReferences(transaction.name, enqueue[1], entities, boundEntities, diagnostics);
      validateEventPayload(transaction.name, line, eventByName, enumByName, parameterTypes, boundEntities, entities, diagnostics);
      continue;
    }

    const idempotency = line.match(/^idempotency\s+key\s+(.+)$/);
    if (idempotency) {
      const expressionType = transactionExpressionType(idempotency[1], parameterTypes, boundEntities, entities);
      if (!expressionType) {
        diagnostics.push(`transaction ${transaction.name} idempotency key references unknown expression ${idempotency[1]}`);
      }
      continue;
    }

    const require = line.match(/^require\s+(.+)\s+else\s+abort\s+([A-Za-z_][A-Za-z0-9_]*)$/);
    if (require) {
      validateGuardExpression(transaction.name, require[1], parameterTypes, boundEntities, entities, enumerations, diagnostics);
      continue;
    }

    const conditionalAbort = line.match(/^if\s+(.+)\s+then\s+abort\s+([A-Za-z_][A-Za-z0-9_]*)$/);
    if (conditionalAbort) {
      validateGuardExpression(transaction.name, conditionalAbort[1], parameterTypes, boundEntities, entities, enumerations, diagnostics);
      continue;
    }

    const conditionalMutation = line.match(
      /^if\s+(.+)\s+then\s+([A-Za-z_][A-Za-z0-9_]*)\.[A-Za-z_][A-Za-z0-9_]*\s*(?:\+=|-=|=)\s*.+$/,
    );
    if (conditionalMutation) {
      validateGuardExpression(transaction.name, conditionalMutation[1], parameterTypes, boundEntities, entities, enumerations, diagnostics);
      const innerLine = line.slice(line.indexOf(" then ") + " then ".length);
      const entity = loadedEntities.get(conditionalMutation[2]);
      if (entity && !writes.has(entity)) {
        diagnostics.push(`transaction ${transaction.name} mutates ${entity} through ${conditionalMutation[2]} but does not declare writes ${entity}`);
      }
      validateMutationExpression(transaction.name, innerLine, entity, entities, enumByName, parameterTypes, boundEntities, transitions, diagnostics);
      continue;
    }

    const conditionalEnqueue = line.match(/^if\s+(.+)\s+then\s+(enqueue\s+[A-Za-z_][A-Za-z0-9_]*\s+.+)$/);
    if (conditionalEnqueue) {
      validateGuardExpression(transaction.name, conditionalEnqueue[1], parameterTypes, boundEntities, entities, enumerations, diagnostics);
      const enqueue = conditionalEnqueue[2].match(/^enqueue\s+[A-Za-z_][A-Za-z0-9_]*\s+(.+)$/);
      if (enqueue) {
        validateBoundReferences(transaction.name, enqueue[1], entities, boundEntities, diagnostics);
        validateEventPayload(transaction.name, conditionalEnqueue[2], eventByName, enumByName, parameterTypes, boundEntities, entities, diagnostics);
      }
      continue;
    }

    const conditionalAfterCommit = line.match(/^if\s+(.+)\s+then\s+after\s+commit\s+(.+)$/);
    if (conditionalAfterCommit) {
      validateGuardExpression(transaction.name, conditionalAfterCommit[1], parameterTypes, boundEntities, entities, enumerations, diagnostics);
      validateAfterCommitHook(transaction.name, conditionalAfterCommit[2], parameterTypes, boundEntities, entities, enumerations, diagnostics);
      continue;
    }

    const afterCommit = line.match(/^after\s+commit\s+(.+)$/);
    if (afterCommit) {
      validateAfterCommitHook(transaction.name, afterCommit[1], parameterTypes, boundEntities, entities, enumerations, diagnostics);
      continue;
    }

    if (/^abort\s+[A-Za-z_][A-Za-z0-9_]*$/.test(line)) {
      continue;
    }

    if (transaction.retry && isRetryUnsafeExternalCall(line)) {
      diagnostics.push(
        `transaction ${transaction.name} is retryable but calls external function '${line}'. Move it to 'after commit ...' or persist an outbox event with 'enqueue ...'.`,
      );
      continue;
    }

    if (!line.startsWith("after commit ") && !isRetryUnsafeExternalCall(line)) {
      diagnostics.push(`transaction ${transaction.name} has unsupported statement '${line}'`);
    }
  }
}

function transactionBodyLines(body: string): string[] {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const expanded: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const block = lines[index].match(/^if\s+(.+?)\s*\{$/);
    if (!block) {
      expanded.push(lines[index]);
      continue;
    }

    const condition = block[1];
    let closed = false;
    for (index += 1; index < lines.length; index += 1) {
      if (lines[index] === "}") {
        closed = true;
        break;
      }
      expanded.push(`if ${condition} then ${lines[index]}`);
    }
    if (!closed) {
      expanded.push(lines[index - 1] ?? `if ${condition} {`);
    }
  }

  return expanded;
}

function validateBoundReferences(
  transactionName: string,
  source: string,
  entities: EntityDeclaration[],
  boundEntities: Map<string, string>,
  diagnostics: string[],
): void {
  for (const objectField of parseObjectLiteral(source)) {
    const match = objectField.value.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?$/);
    if (!match || !boundEntities.has(match[1])) continue;
    const entityName = boundEntities.get(match[1]);
    const entity = entities.find((candidate) => candidate.name === entityName);
    const fieldName = match[2] ?? "id";
    if (!entity?.fields.some((field) => field.name === fieldName)) {
      diagnostics.push(`transaction ${transactionName} references unknown bound field ${match[1]}.${fieldName}`);
    }
  }
}

function validateInsertFields(
  transactionName: string,
  line: string,
  entities: EntityDeclaration[],
  enumByName: Map<string, Extract<Program["declarations"][number], { kind: "enum" }>>,
  parameterTypes: Map<string, string>,
  diagnostics: string[],
): void {
  const match = line.match(/^(?:let\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*)?insert\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/);
  if (!match) return;
  const entity = entities.find((candidate) => candidate.name === match[1]);
  if (!entity) return;

  for (const objectField of parseObjectLiteral(match[2])) {
    const field = entity.fields.find((candidate) => candidate.name === objectField.name);
    if (!field) {
      diagnostics.push(`transaction ${transactionName} inserts unknown field ${entity.name}.${objectField.name}`);
      continue;
    }
    validateEnumLiteral(transactionName, `${entity.name}.${field.name}`, field, objectField.value, enumByName, diagnostics);
    validateCurrencyCodeLiteral(transactionName, `${entity.name}.${field.name}`, field, objectField.value, diagnostics);
    validateEnumParameterAssignment(
      transactionName,
      `${entity.name}.${field.name}`,
      field,
      objectField.value,
      enumByName,
      parameterTypes,
      diagnostics,
    );
  }
}

function validateInsertExpressionTypes(
  transactionName: string,
  line: string,
  entities: EntityDeclaration[],
  enumByName: Map<string, Extract<Program["declarations"][number], { kind: "enum" }>>,
  parameterTypes: Map<string, string>,
  boundEntities: Map<string, string>,
  diagnostics: string[],
): void {
  const match = line.match(/^(?:let\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*)?insert\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/);
  if (!match) return;
  const entity = entities.find((candidate) => candidate.name === match[1]);
  if (!entity) return;

  for (const objectField of parseObjectLiteral(match[2])) {
    const field = entity.fields.find((candidate) => candidate.name === objectField.name);
    if (!field) continue;
    validateAssignmentType(
      transactionName,
      `${entity.name}.${field.name}`,
      field.type.raw,
      objectField.value,
      enumByName,
      parameterTypes,
      boundEntities,
      entities,
      diagnostics,
    );
  }
}

function validateMutationExpression(
  transactionName: string,
  line: string,
  entityName: string | undefined,
  entities: EntityDeclaration[],
  enumByName: Map<string, Extract<Program["declarations"][number], { kind: "enum" }>>,
  parameterTypes: Map<string, string>,
  boundEntities: Map<string, string>,
  transitions: TransitionDeclaration[],
  diagnostics: string[],
): void {
  if (!entityName) return;
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*(\+=|-=|=)\s*(.+)$/);
  if (!match) return;
  const entity = entities.find((candidate) => candidate.name === entityName);
  const field = entity?.fields.find((candidate) => candidate.name === match[2]);
  if (!field) {
    diagnostics.push(`transaction ${transactionName} mutates unknown field ${entityName}.${match[2]}`);
    return;
  }

  if ((match[3] === "+=" || match[3] === "-=") && !isNumericType(field.type.raw)) {
    diagnostics.push(`transaction ${transactionName} uses ${match[3]} on non-numeric field ${entityName}.${field.name}`);
  }
  validateAssignmentType(transactionName, `${entityName}.${field.name}`, field.type.raw, match[4], enumByName, parameterTypes, boundEntities, entities, diagnostics);
  validateEnumLiteral(transactionName, `${entityName}.${field.name}`, field, match[4], enumByName, diagnostics);
  validateCurrencyCodeLiteral(transactionName, `${entityName}.${field.name}`, field, match[4], diagnostics);
  validateEnumParameterAssignment(transactionName, `${entityName}.${field.name}`, field, match[4], enumByName, parameterTypes, diagnostics);
  validateTransitionAssignment(transactionName, entityName, field.name, match[4], transitions, diagnostics);
}

function validateEventPayload(
  transactionName: string,
  line: string,
  eventByName: Map<string, EventDeclaration>,
  enumByName: Map<string, Extract<Program["declarations"][number], { kind: "enum" }>>,
  parameterTypes: Map<string, string>,
  boundEntities: Map<string, string>,
  entities: EntityDeclaration[],
  diagnostics: string[],
): void {
  const match = line.match(/^enqueue\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/);
  if (!match) return;
  const event = eventByName.get(match[1]);
  if (!event) return;

  const objectFields = parseObjectLiteral(match[2]);
  const provided = new Set(objectFields.map((field) => field.name));
  for (const duplicate of duplicates(objectFields.map((field) => field.name))) {
    diagnostics.push(`transaction ${transactionName} enqueues ${event.name} with duplicate payload field ${duplicate}`);
  }
  for (const field of event.fields) {
    if (!field.type.optional && !provided.has(field.name)) {
      diagnostics.push(`transaction ${transactionName} enqueues ${event.name} without required payload field ${field.name}`);
    }
  }
  for (const objectField of objectFields) {
    const eventField = event.fields.find((field) => field.name === objectField.name);
    if (!eventField) {
      diagnostics.push(`transaction ${transactionName} enqueues ${event.name} with unknown payload field ${objectField.name}`);
      continue;
    }
    validateAssignmentType(
      transactionName,
      `${event.name}.${eventField.name}`,
      eventField.type.raw,
      objectField.value,
      enumByName,
      parameterTypes,
      boundEntities,
      entities,
      diagnostics,
    );
  }
}

function validateAssignmentType(
  transactionName: string,
  target: string,
  targetType: string,
  expression: string,
  enumByName: Map<string, Extract<Program["declarations"][number], { kind: "enum" }>>,
  parameterTypes: Map<string, string>,
  boundEntities: Map<string, string>,
  entities: EntityDeclaration[],
  diagnostics: string[],
): void {
  const expressionType = transactionExpressionType(expression, parameterTypes, boundEntities, entities);
  if (!expressionType) {
    if (isArithmeticExpressionSource(expression)) {
      diagnostics.push(`transaction ${transactionName} assigns ${target} from unsupported arithmetic expression ${expression}`);
    }
    return;
  }
  if (isOptionalType(expressionType) && !isOptionalType(targetType)) {
    diagnostics.push(`transaction ${transactionName} assigns required ${target} from nullable expression type ${expressionType}`);
    return;
  }
  if (typesCompatible(targetType, expressionType, enumByName)) return;
  diagnostics.push(`transaction ${transactionName} assigns ${target} from incompatible expression type ${expressionType}`);
}

function transactionExpressionType(
  expression: string,
  parameterTypes: Map<string, string>,
  boundEntities: Map<string, string>,
  entities: EntityDeclaration[],
): string | undefined {
  const value = expression.trim();
  const parameterType = parameterTypes.get(value);
  if (parameterType) return parameterType;
  if (value === "true" || value === "false") return "Bool";
  if (value === "null") return "Null";
  if (/^-?\d+$/.test(value)) return "Int64";
  if (/^-?\d+\.\d+$/.test(value)) return "Decimal";
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) return "String";

  const bound = value.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?$/);
  if (bound && boundEntities.has(bound[1])) {
    const entityName = boundEntities.get(bound[1]);
    const entity = entities.find((candidate) => candidate.name === entityName);
    const fieldName = bound[2] ?? "id";
    const field = entity?.fields.find((candidate) => candidate.name === fieldName);
    return field?.type.raw;
  }
  if (isArithmeticExpressionSource(value)) {
    return arithmeticExpressionType(value, parameterTypes, boundEntities, entities);
  }
  return undefined;
}

function arithmeticExpressionType(
  expression: string,
  parameterTypes: Map<string, string>,
  boundEntities: Map<string, string>,
  entities: EntityDeclaration[],
): string | undefined {
  const tokens = arithmeticExpressionTokens(expression);
  if (tokens.length === 0 || !isValidArithmeticExpressionTokens(tokens)) return undefined;

  let sawOperand = false;
  let sawDecimal = false;
  let sawFloat = false;
  for (const token of tokens) {
    if (/^[+\-*/()]$/.test(token)) continue;
    sawOperand = true;
    const tokenType = transactionExpressionType(token, parameterTypes, boundEntities, entities);
    if (!tokenType || isOptionalType(tokenType) || !isNumericType(tokenType)) return undefined;
    if (tokenType === "Float") sawFloat = true;
    if (tokenType.startsWith("Decimal") || /^-?\d+\.\d+$/.test(token)) sawDecimal = true;
  }
  if (!sawOperand) return undefined;
  if (sawFloat) return "Float";
  if (sawDecimal) return "Decimal";
  return "Int64";
}

function arithmeticExpressionTokens(expression: string): string[] {
  const tokens: string[] = [];
  const pattern = /\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?|-?\d+(?:\.\d+)?|[()+\-*/])\s*/gy;
  let index = 0;
  while (index < expression.length) {
    pattern.lastIndex = index;
    const match = pattern.exec(expression);
    if (!match) return [];
    tokens.push(match[1]);
    index = pattern.lastIndex;
  }
  return tokens;
}

function isValidArithmeticExpressionTokens(tokens: string[]): boolean {
  let depth = 0;
  let expectsOperand = true;
  for (const token of tokens) {
    if (token === "(") {
      if (!expectsOperand) return false;
      depth += 1;
      continue;
    }
    if (token === ")") {
      if (expectsOperand || depth === 0) return false;
      depth -= 1;
      expectsOperand = false;
      continue;
    }
    if (/^[+\-*/]$/.test(token)) {
      if (expectsOperand) return false;
      expectsOperand = true;
      continue;
    }
    if (!expectsOperand) return false;
    expectsOperand = false;
  }
  return depth === 0 && !expectsOperand;
}

function typesCompatible(
  targetType: string,
  expressionType: string,
  enumByName: Map<string, Extract<Program["declarations"][number], { kind: "enum" }>>,
): boolean {
  if (expressionType === "Null") return targetType.endsWith("?");
  const requiredTarget = targetType.endsWith("?") ? targetType.slice(0, -1) : targetType;
  const requiredExpression = expressionType.endsWith("?") ? expressionType.slice(0, -1) : expressionType;
  if (requiredTarget === requiredExpression) return true;
  if (requiredExpression === `Id<${requiredTarget}>`) return true;
  if (isNumericType(requiredTarget) && isNumericType(requiredExpression)) return true;
  if (requiredTarget === "String" && enumByName.has(requiredExpression)) return true;
  return false;
}

function isNumericType(type: string): boolean {
  const required = type.endsWith("?") ? type.slice(0, -1) : type;
  return required === "Int" || required === "Int64" || required === "Float" || required.startsWith("Decimal");
}

function isOptionalType(type: string): boolean {
  return type.endsWith("?");
}

function validateGuardExpression(
  transactionName: string,
  condition: string,
  parameterTypes: Map<string, string>,
  boundEntities: Map<string, string>,
  entities: EntityDeclaration[],
  enumerations: Extract<Program["declarations"][number], { kind: "enum" }>[],
  diagnostics: string[],
): void {
  const normalized = stripQuotedStrings(condition);
  const enumValues = new Set(enumerations.flatMap((enumeration) => enumeration.values));
  const enumValueTypes = enumValueTypeMap(enumerations);
  for (const call of normalized.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    diagnostics.push(`transaction ${transactionName} guard uses unsupported call expression ${call[1]}(...)`);
  }

  for (const reference of normalized.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?\b/g)) {
    const token = reference[0];
    if (guardKeywords.has(token)) continue;
    if (parameterTypes.has(token) || boundEntities.has(token) || enumValues.has(token)) continue;
    if (!reference[2]) {
      diagnostics.push(`transaction ${transactionName} guard references unknown value ${token}`);
      continue;
    }
    const entityName = boundEntities.get(reference[1]);
    if (!entityName) {
      diagnostics.push(`transaction ${transactionName} guard references unknown value ${reference[1]}`);
      continue;
    }
    const entity = entities.find((candidate) => candidate.name === entityName);
    if (!entity?.fields.some((field) => field.name === reference[2])) {
      diagnostics.push(`transaction ${transactionName} guard references unknown field ${token}`);
    }
  }
  validateGuardComparisonTypes(transactionName, condition, parameterTypes, boundEntities, entities, enumByName(enumerations), enumValueTypes, diagnostics);
}

const guardKeywords = new Set(["and", "or", "not", "is", "in", "true", "false", "null"]);

function validateGuardComparisonTypes(
  transactionName: string,
  condition: string,
  parameterTypes: Map<string, string>,
  boundEntities: Map<string, string>,
  entities: EntityDeclaration[],
  enumTypes: Map<string, Extract<Program["declarations"][number], { kind: "enum" }>>,
  enumValueTypes: Map<string, string>,
  diagnostics: string[],
): void {
  for (const rawClause of splitGuardClauses(condition)) {
    const clause = stripOuterParentheses(rawClause);
    const comparison = splitComparisonClause(clause);
    if (!comparison) {
      const operand = clause.startsWith("not ") ? clause.slice("not ".length).trim() : clause;
      const type = guardOperandType(operand, parameterTypes, boundEntities, entities, enumValueTypes);
      if (type && type !== "Bool") {
        diagnostics.push(`transaction ${transactionName} guard clause '${rawClause}' must be Bool, got ${type}`);
      }
      continue;
    }

    const leftType = guardOperandType(comparison.left, parameterTypes, boundEntities, entities, enumValueTypes);
    const rightType = guardOperandType(comparison.right, parameterTypes, boundEntities, entities, enumValueTypes);
    if (!leftType || !rightType) continue;

    if (comparison.operator === "<" || comparison.operator === "<=" || comparison.operator === ">" || comparison.operator === ">=") {
      if (!isNumericType(leftType) || !isNumericType(rightType)) {
        diagnostics.push(
          `transaction ${transactionName} guard compares non-numeric operands in '${clause}' (${leftType} ${comparison.operator} ${rightType})`,
        );
      }
      continue;
    }

    if (!typesCompatible(leftType, rightType, enumTypes) && !typesCompatible(rightType, leftType, enumTypes)) {
      diagnostics.push(
        `transaction ${transactionName} guard compares incompatible operands in '${clause}' (${leftType} ${comparison.operator} ${rightType})`,
      );
    }
  }
}

function guardOperandType(
  expression: string,
  parameterTypes: Map<string, string>,
  boundEntities: Map<string, string>,
  entities: EntityDeclaration[],
  enumValueTypes: Map<string, string>,
): string | undefined {
  const value = stripOuterParentheses(expression.trim());
  return transactionExpressionType(value, parameterTypes, boundEntities, entities) ?? enumValueTypes.get(value);
}

function splitGuardClauses(condition: string): string[] {
  const clauses: string[] = [];
  let quote: string | undefined;
  let depth = 0;
  let start = 0;
  for (let index = 0; index < condition.length; index += 1) {
    const char = condition[index];
    if (quote) {
      if (char === quote && condition[index - 1] !== "\\") quote = undefined;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")" && depth > 0) {
      depth -= 1;
      continue;
    }
    if (depth > 0) continue;
    const rest = condition.slice(index);
    const connector = rest.match(/^(?:\s+)(and|or)(?:\s+)/);
    if (!connector) continue;
    clauses.push(condition.slice(start, index).trim());
    index += connector[0].length - 1;
    start = index + 1;
  }
  clauses.push(condition.slice(start).trim());
  return clauses.filter(Boolean);
}

function splitComparisonClause(clause: string): { left: string; operator: string; right: string } | undefined {
  const match = clause.match(/^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/);
  if (!match) return undefined;
  return {
    left: match[1].trim(),
    operator: match[2],
    right: match[3].trim(),
  };
}

function stripOuterParentheses(source: string): string {
  let value = source.trim();
  while (value.startsWith("(") && value.endsWith(")") && wrapsWholeExpression(value)) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function wrapsWholeExpression(source: string): boolean {
  let quote: string | undefined;
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote && source[index - 1] !== "\\") quote = undefined;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0 && index < source.length - 1) return false;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function enumByName(
  enumerations: Extract<Program["declarations"][number], { kind: "enum" }>[],
): Map<string, Extract<Program["declarations"][number], { kind: "enum" }>> {
  return new Map(enumerations.map((enumeration) => [enumeration.name, enumeration]));
}

function enumValueTypeMap(enumerations: Extract<Program["declarations"][number], { kind: "enum" }>[]): Map<string, string> {
  const valueTypes = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const enumeration of enumerations) {
    for (const value of enumeration.values) {
      if (valueTypes.has(value)) {
        duplicates.add(value);
      } else {
        valueTypes.set(value, enumeration.name);
      }
    }
  }
  for (const value of duplicates) {
    valueTypes.delete(value);
  }
  return valueTypes;
}

function validateAfterCommitHook(
  transactionName: string,
  call: string,
  parameterTypes: Map<string, string>,
  boundEntities: Map<string, string>,
  entities: EntityDeclaration[],
  enumerations: Extract<Program["declarations"][number], { kind: "enum" }>[],
  diagnostics: string[],
): void {
  const match = call.match(/^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/);
  if (!match) {
    diagnostics.push(`transaction ${transactionName} has invalid after commit hook ${call}`);
    return;
  }

  const enumValues = new Set(enumerations.flatMap((enumeration) => enumeration.values));
  const args = match[2].trim() ? splitTopLevel(match[2], ",") : [];
  for (const arg of args) {
    validateAfterCommitArg(transactionName, arg, parameterTypes, boundEntities, entities, enumValues, diagnostics);
  }
}

function validateAfterCommitArg(
  transactionName: string,
  arg: string,
  parameterTypes: Map<string, string>,
  boundEntities: Map<string, string>,
  entities: EntityDeclaration[],
  enumValues: Set<string>,
  diagnostics: string[],
): void {
  const value = arg.trim();
  if (parameterTypes.has(value) || enumValues.has(value)) return;
  if (value === "true" || value === "false" || value === "null") return;
  if (/^-?\d+(\.\d+)?$/.test(value)) return;
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) return;

  const bindingMatch = value.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?$/);
  if (!bindingMatch) {
    diagnostics.push(`transaction ${transactionName} after commit hook uses unsupported argument ${value}`);
    return;
  }

  const entityName = boundEntities.get(bindingMatch[1]);
  if (!entityName) {
    diagnostics.push(`transaction ${transactionName} after commit hook references unknown value ${bindingMatch[1]}`);
    return;
  }

  const fieldName = bindingMatch[2] ?? "id";
  const entity = entities.find((candidate) => candidate.name === entityName);
  if (!entity?.fields.some((field) => field.name === fieldName)) {
    diagnostics.push(`transaction ${transactionName} after commit hook references unknown field ${bindingMatch[1]}.${fieldName}`);
  }
}

function stripQuotedStrings(source: string): string {
  let output = "";
  let quote: string | undefined;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote && source[index - 1] !== "\\") quote = undefined;
      output += " ";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      output += " ";
      continue;
    }
    output += char;
  }
  return output;
}

function validateEnumMutation(
  transactionName: string,
  line: string,
  entityName: string | undefined,
  entities: EntityDeclaration[],
  enumByName: Map<string, Extract<Program["declarations"][number], { kind: "enum" }>>,
  parameterTypes: Map<string, string>,
  transitions: TransitionDeclaration[],
  diagnostics: string[],
): void {
  if (!entityName) return;
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*(?:\+=|-=|=)\s*(.+)$/);
  if (!match) return;
  const entity = entities.find((candidate) => candidate.name === entityName);
  const field = entity?.fields.find((candidate) => candidate.name === match[2]);
  if (!field) {
    diagnostics.push(`transaction ${transactionName} mutates unknown field ${entityName}.${match[2]}`);
    return;
  }
  validateEnumLiteral(transactionName, `${entityName}.${field.name}`, field, match[3], enumByName, diagnostics);
  validateCurrencyCodeLiteral(transactionName, `${entityName}.${field.name}`, field, match[3], diagnostics);
  validateEnumParameterAssignment(transactionName, `${entityName}.${field.name}`, field, match[3], enumByName, parameterTypes, diagnostics);
  validateTransitionAssignment(transactionName, entityName, field.name, match[3], transitions, diagnostics);
}

function validateEnumParameterAssignment(
  transactionName: string,
  target: string,
  field: FieldDeclaration,
  expression: string,
  enumByName: Map<string, Extract<Program["declarations"][number], { kind: "enum" }>>,
  parameterTypes: Map<string, string>,
  diagnostics: string[],
): void {
  if (!enumByName.has(field.type.name)) return;
  const parameterType = parameterTypes.get(expression.trim());
  if (!parameterType || parameterType === field.type.raw) return;
  diagnostics.push(`transaction ${transactionName} assigns ${target} from incompatible parameter type ${parameterType}`);
}

function validateTransitionAssignment(
  transactionName: string,
  entityName: string,
  fieldName: string,
  expression: string,
  transitions: TransitionDeclaration[],
  diagnostics: string[],
): void {
  const transition = transitions.find((candidate) => candidate.entity === entityName && candidate.field === fieldName);
  if (!transition) return;
  const literal = sourceLiteralValue(expression);
  if (!literal) return;
  if (!transition.rules.some((rule) => rule.to === literal)) {
    diagnostics.push(`transaction ${transactionName} assigns ${entityName}.${fieldName} to ${literal}, but no transition rule targets ${literal}`);
  }
}

function validateEnumLiteral(
  transactionName: string,
  target: string,
  field: FieldDeclaration,
  expression: string,
  enumByName: Map<string, Extract<Program["declarations"][number], { kind: "enum" }>>,
  diagnostics: string[],
): void {
  const enumeration = enumByName.get(field.type.name);
  if (!enumeration) return;
  const literal = sourceLiteralValue(expression);
  if (!literal) return;
  if (!enumeration.values.includes(literal)) {
    diagnostics.push(`transaction ${transactionName} assigns invalid ${enumeration.name} value ${literal} to ${target}`);
  }
}

function validateCurrencyCodeLiteral(
  transactionName: string,
  target: string,
  field: FieldDeclaration,
  expression: string,
  diagnostics: string[],
): void {
  if (field.type.name !== "CurrencyCode") return;
  const literal = sourceLiteralValue(expression);
  if (!literal) return;
  if (!/^[A-Z]{3}$/.test(literal)) {
    diagnostics.push(`transaction ${transactionName} assigns invalid CurrencyCode value ${literal} to ${target}`);
  }
}

function sourceLiteralValue(expression: string): string | undefined {
  const value = expression.trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (/^[A-Z][A-Za-z0-9_]*$/.test(value)) {
    return value;
  }
  return undefined;
}

function isArithmeticExpressionSource(expression: string): boolean {
  return /[+\-*/()]/.test(expression) && /^[A-Za-z0-9_.$\s+\-*/()]+$/.test(expression);
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
