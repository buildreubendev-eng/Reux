import { readFileSync } from "node:fs";
import { compileSource, emitInsertStatement } from "./compiler.js";
import { Database, runSqlQuery } from "./runtime.js";
import { EntityIr, EnumIr, findEntity } from "./schema.js";

export interface SeedSpec {
  mode: SeedMode;
  records: SeedRecord[];
}

export interface SeedRecord {
  entity: string;
  as?: string;
  mode?: SeedMode;
  by?: string[];
  data: Record<string, unknown>;
}

export type SeedMode = "insert" | "upsert";

export interface SeedRunResult {
  inserted: SeedInsertedRecord[];
}

export interface SeedDryRunResult extends SeedRunResult {
  rolledBack: true;
}

export interface SeedDeleteResult {
  deleted: SeedDeletedRecord[];
}

export interface SeedResetResult {
  deleted: SeedDeletedRecord[];
  inserted: SeedInsertedRecord[];
}

export interface SeedCheckResult {
  records: SeedCheckedRecord[];
}

export interface SeedCheckedRecord {
  entity: string;
  as?: string;
  mode: SeedMode;
  by: string[];
  fields: string[];
}

export interface SeedInsertedRecord {
  entity: string;
  as?: string;
  id?: unknown;
}

export interface SeedDeletedRecord {
  entity: string;
  as?: string;
  rowCount: number | null;
}

export function parseSeedSpec(source: string): SeedSpec {
  const json = source.startsWith("@") ? readFileSync(source.slice(1), "utf8") : source;
  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("seed file must be a JSON object");
  }
  const records = (parsed as { records?: unknown }).records;
  if (!Array.isArray(records)) {
    throw new Error("seed file must contain a records array");
  }
  const mode = parseSeedMode((parsed as { mode?: unknown }).mode, "insert", "seed file") ?? "insert";

  const aliases = new Set<string>();
  return {
    mode,
    records: records.map((record, index) => parseSeedRecord(record, index, aliases)),
  };
}

export function checkSeed(source: string, spec: SeedSpec): SeedCheckResult {
  const schema = compileSource(source).schema;
  const aliases = new Set<string>();
  const records: SeedCheckedRecord[] = [];

  for (const record of spec.records) {
    const entity = findRequiredEntity(schema.entities, record.entity);
    const mode = record.mode ?? spec.mode;
    validateSeedRecord(entity, record.data, record.by, mode, schema.enums);
    validateSeedReferences(record.data, aliases);
    if (record.as) {
      aliases.add(record.as);
    }
    records.push({
      entity: record.entity,
      as: record.as,
      mode,
      by: record.by ?? (mode === "upsert" ? defaultConflictFields(entity) : []),
      fields: Object.keys(record.data),
    });
  }

  return { records };
}

export async function runSeed(db: Database, source: string, spec: SeedSpec): Promise<SeedRunResult> {
  const schema = compileSource(source).schema;
  const aliases = new Map<string, unknown>();
  const inserted: SeedInsertedRecord[] = [];

  for (const record of spec.records) {
    const data = resolveRecord(record.data, aliases);
    const mode = record.mode ?? spec.mode;
    const statement =
      mode === "upsert"
        ? seedUpsertStatement(findRequiredEntity(schema.entities, record.entity), data, record.by)
        : emitInsertStatement(source, record.entity, data);
    const result = await runSqlQuery(db, statement.sql, statement.params);
    const row = result.rows[0] as { id?: unknown } | undefined;
    if (record.as) {
      if (!row || row.id === undefined) {
        throw new Error(`seed record ${record.as} did not return an id`);
      }
      aliases.set(record.as, row.id);
    }
    inserted.push({
      entity: record.entity,
      as: record.as,
      id: row?.id,
    });
  }

  return { inserted };
}

export async function dryRunSeed(db: Database, source: string, spec: SeedSpec): Promise<SeedDryRunResult> {
  await db.query("BEGIN;");
  try {
    const result = await runSeed(db, source, spec);
    await db.query("ROLLBACK;");
    return {
      ...result,
      rolledBack: true,
    };
  } catch (error) {
    await db.query("ROLLBACK;");
    throw error;
  }
}

export async function deleteSeed(db: Database, source: string, spec: SeedSpec): Promise<SeedDeleteResult> {
  const schema = compileSource(source).schema;
  const aliases = new Map<string, unknown>();
  const resolved = spec.records.map((record) => {
    const data = resolveRecord(record.data, aliases);
    if (record.as && Object.prototype.hasOwnProperty.call(data, "id")) {
      aliases.set(record.as, data.id);
    }
    return { record, data };
  });
  const deleted: SeedDeletedRecord[] = [];

  for (const { record, data } of [...resolved].reverse()) {
    const statement = seedDeleteStatement(findRequiredEntity(schema.entities, record.entity), data, record.by);
    const result = await runSqlQuery(db, statement.sql, statement.params);
    deleted.push({
      entity: record.entity,
      as: record.as,
      rowCount: result.rowCount,
    });
  }

  return { deleted };
}

export async function resetSeed(db: Database, source: string, spec: SeedSpec): Promise<SeedResetResult> {
  await db.query("BEGIN;");
  try {
    const deleted = await deleteSeed(db, source, spec);
    const inserted = await runSeed(db, source, spec);
    await db.query("COMMIT;");
    return {
      deleted: deleted.deleted,
      inserted: inserted.inserted,
    };
  } catch (error) {
    await db.query("ROLLBACK;");
    throw error;
  }
}

function parseSeedRecord(record: unknown, index: number, aliases: Set<string>): SeedRecord {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`seed record ${index + 1} must be an object`);
  }
  const candidate = record as Partial<SeedRecord>;
  if (typeof candidate.entity !== "string" || !candidate.entity) {
    throw new Error(`seed record ${index + 1} must declare an entity`);
  }
  const mode = parseSeedMode(candidate.mode, undefined, `seed record ${index + 1}`);
  if (candidate.as !== undefined) {
    if (typeof candidate.as !== "string" || !candidate.as) {
      throw new Error(`seed record ${index + 1} has an invalid alias`);
    }
    if (aliases.has(candidate.as)) {
      throw new Error(`seed alias ${candidate.as} is declared more than once`);
    }
    aliases.add(candidate.as);
  }
  if (!candidate.data || typeof candidate.data !== "object" || Array.isArray(candidate.data)) {
    throw new Error(`seed record ${index + 1} must contain a data object`);
  }

  return {
    entity: candidate.entity,
    as: candidate.as,
    mode,
    by: parseConflictFields(candidate.by, index),
    data: candidate.data as Record<string, unknown>,
  };
}

function seedDeleteStatement(entity: EntityIr, record: Record<string, unknown>, conflictFields?: string[]): { sql: string; params: unknown[] } {
  const fields = conflictFields ?? defaultConflictFields(entity);
  if (fields.length === 0) {
    throw new Error(`seed delete for ${entity.name} needs a by field because the entity has no unique non-generated field`);
  }
  validateConflictFieldValues(entity, record, fields, "delete");
  const params = fields.map((fieldName) => {
    return record[fieldName];
  });
  const predicate = fields
    .map((fieldName, index) => `${quoteIdentifier(fieldColumn(entity, fieldName).columnName)} = $${index + 1}`)
    .join(" AND ");
  return {
    sql: `DELETE FROM ${entity.tableName} WHERE ${predicate} RETURNING id;`,
    params,
  };
}

function seedUpsertStatement(entity: EntityIr, record: Record<string, unknown>, conflictFields?: string[]): { sql: string; params: unknown[] } {
  const insert = insertColumns(entity, record);
  const fields = conflictFields ?? defaultConflictFields(entity);
  if (fields.length === 0) {
    throw new Error(`seed upsert for ${entity.name} needs a by field because the entity has no unique non-generated field`);
  }
  validateConflictFieldValues(entity, record, fields, "upsert");
  const conflictColumns = fields.map((fieldName) => fieldColumn(entity, fieldName).columnName);
  const updateColumns = insert.columns.filter((column) => !conflictColumns.includes(column));
  const updateSql =
    updateColumns.length === 0
      ? "DO NOTHING"
      : `DO UPDATE SET ${updateColumns.map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`).join(", ")}`;

  return {
    sql: `INSERT INTO ${entity.tableName} (${insert.columns.map(quoteIdentifier).join(", ")}) VALUES (${insert.placeholders.join(", ")}) ON CONFLICT (${conflictColumns.map(quoteIdentifier).join(", ")}) ${updateSql} RETURNING *;`,
    params: insert.params,
  };
}

function validateSeedRecord(
  entity: EntityIr,
  record: Record<string, unknown>,
  conflictFields: string[] | undefined,
  mode: SeedMode,
  enums: EnumIr[],
): void {
  validateRecordFields(entity, record);
  validateEnumFieldValues(entity, record, enums);
  const fields = conflictFields ?? (mode === "upsert" ? defaultConflictFields(entity) : []);
  if (mode === "upsert" && fields.length === 0) {
    throw new Error(`seed upsert for ${entity.name} needs a by field because the entity has no unique non-generated field`);
  }
  if (fields.length > 0) {
    validateConflictFieldValues(entity, record, fields, mode === "upsert" ? "upsert" : "record");
  }
}

function validateEnumFieldValues(entity: EntityIr, record: Record<string, unknown>, enums: EnumIr[]): void {
  const enumsByName = new Map(enums.map((enumeration) => [enumeration.name, enumeration]));
  for (const field of entity.fields) {
    const enumeration = enumsByName.get(field.type.name);
    if (!enumeration || !Object.prototype.hasOwnProperty.call(record, field.name)) continue;
    const value = record[field.name];
    if (value === null || value === undefined) continue;
    if (typeof value !== "string" || value.startsWith("$")) continue;
    if (!enumeration.values.includes(value)) {
      throw new Error(`seed value ${value} is not a valid ${enumeration.name} for ${entity.name}.${field.name}`);
    }
  }
}

function insertColumns(entity: EntityIr, record: Record<string, unknown>): { columns: string[]; placeholders: string[]; params: unknown[] } {
  validateRecordFields(entity, record);

  const columns: string[] = [];
  const params: unknown[] = [];
  for (const field of entity.fields) {
    if (!Object.prototype.hasOwnProperty.call(record, field.name)) continue;
    if (field.primary && field.generated && record[field.name] === undefined) continue;
    columns.push(field.columnName);
    params.push(record[field.name]);
  }
  return {
    columns,
    placeholders: params.map((_param, index) => `$${index + 1}`),
    params,
  };
}

function validateRecordFields(entity: EntityIr, record: Record<string, unknown>): void {
  const knownFields = new Set(entity.fields.map((field) => field.name));
  for (const key of Object.keys(record)) {
    if (!knownFields.has(key)) {
      throw new Error(`entity ${entity.name} has no field ${key}`);
    }
  }
}

function validateConflictFieldValues(entity: EntityIr, record: Record<string, unknown>, fields: string[], action: "delete" | "record" | "upsert"): void {
  for (const fieldName of fields) {
    fieldColumn(entity, fieldName);
    if (!Object.prototype.hasOwnProperty.call(record, fieldName)) {
      throw new Error(`seed ${action} for ${entity.name} is missing by field ${fieldName}`);
    }
  }
}

function defaultConflictFields(entity: EntityIr): string[] {
  const unique = entity.fields.find((field) => field.unique && !field.generated);
  if (unique) return [unique.name];
  const primary = entity.fields.find((field) => field.primary && !field.generated);
  return primary ? [primary.name] : [];
}

function fieldColumn(entity: EntityIr, fieldName: string): { columnName: string } {
  const field = entity.fields.find((candidate) => candidate.name === fieldName);
  if (!field) {
    throw new Error(`entity ${entity.name} has no field ${fieldName}`);
  }
  return field;
}

function findRequiredEntity(entities: EntityIr[], entityName: string): EntityIr {
  const entity = findEntity({ moduleName: "seed", enums: [], transitions: [], entities }, entityName);
  if (!entity) {
    throw new Error(`unknown entity ${entityName}`);
  }
  return entity;
}

function parseSeedMode(value: unknown, fallback: SeedMode | undefined, owner: string): SeedMode | undefined {
  if (value === undefined) {
    return fallback;
  }
  if (value === "insert" || value === "upsert") return value;
  throw new Error(`${owner} mode must be insert or upsert`);
}

function parseConflictFields(value: unknown, index: number): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item)) {
    throw new Error(`seed record ${index + 1} by must be an array of field names`);
  }
  return value;
}

function resolveRecord(record: Record<string, unknown>, aliases: Map<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, resolveValue(value, aliases)]));
}

function validateSeedReferences(value: unknown, aliases: Set<string>): void {
  if (typeof value === "string" && value.startsWith("$")) {
    const alias = value.slice(1);
    if (!aliases.has(alias)) {
      throw new Error(`seed reference ${value} has not been inserted yet`);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      validateSeedReferences(item, aliases);
    }
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      validateSeedReferences(item, aliases);
    }
  }
}

function resolveValue(value: unknown, aliases: Map<string, unknown>): unknown {
  if (typeof value === "string" && value.startsWith("$")) {
    const alias = value.slice(1);
    if (!aliases.has(alias)) {
      throw new Error(`seed reference ${value} has not been inserted yet`);
    }
    return aliases.get(alias);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, aliases));
  }
  if (value && typeof value === "object") {
    return resolveRecord(value as Record<string, unknown>, aliases);
  }
  return value;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
