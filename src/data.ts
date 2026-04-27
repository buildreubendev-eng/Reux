import { readFileSync } from "node:fs";
import { DlError } from "./errors.js";
import { findEntity, SchemaIr } from "./schema.js";

export interface InsertStatement {
  sql: string;
  params: unknown[];
}

export function insertEntityStatement(schema: SchemaIr, entityName: string, record: Record<string, unknown>): InsertStatement {
  const entity = findEntity(schema, entityName);
  if (!entity) {
    throw new DlError(`unknown entity ${entityName}`);
  }

  const knownFields = new Set(entity.fields.map((field) => field.name));
  for (const key of Object.keys(record)) {
    if (!knownFields.has(key)) {
      throw new DlError(`entity ${entityName} has no field ${key}`);
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

  if (columns.length === 0) {
    return {
      sql: `INSERT INTO ${entity.tableName} DEFAULT VALUES RETURNING *;`,
      params: [],
    };
  }

  const placeholders = params.map((_param, index) => `$${index + 1}`);
  return {
    sql: `INSERT INTO ${entity.tableName} (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *;`,
    params,
  };
}

export function parseJsonObject(source: string): Record<string, unknown> {
  const json = source.startsWith("@") ? readFileSync(source.slice(1), "utf8") : source;
  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("expected a JSON object");
  }
  return parsed as Record<string, unknown>;
}
