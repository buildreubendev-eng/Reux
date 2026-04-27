import { readFileSync } from "node:fs";
import { compileSource, emitInsertStatement } from "./compiler.js";
import { Database, runSqlQuery } from "./runtime.js";
import { EntityIr, findEntity } from "./schema.js";

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

export interface SeedInsertedRecord {
  entity: string;
  as?: string;
  id?: unknown;
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

function seedUpsertStatement(entity: EntityIr, record: Record<string, unknown>, conflictFields?: string[]): { sql: string; params: unknown[] } {
  const insert = insertColumns(entity, record);
  const fields = conflictFields ?? defaultConflictFields(entity);
  if (fields.length === 0) {
    throw new Error(`seed upsert for ${entity.name} needs a by field because the entity has no unique non-generated field`);
  }
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

function insertColumns(entity: EntityIr, record: Record<string, unknown>): { columns: string[]; placeholders: string[]; params: unknown[] } {
  const knownFields = new Set(entity.fields.map((field) => field.name));
  for (const key of Object.keys(record)) {
    if (!knownFields.has(key)) {
      throw new Error(`entity ${entity.name} has no field ${key}`);
    }
  }

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
  const entity = findEntity({ moduleName: "seed", enums: [], entities }, entityName);
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
