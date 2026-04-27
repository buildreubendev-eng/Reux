import { readFileSync } from "node:fs";
import { emitInsertStatement } from "./compiler.js";
import { Database, runSqlQuery } from "./runtime.js";

export interface SeedSpec {
  records: SeedRecord[];
}

export interface SeedRecord {
  entity: string;
  as?: string;
  data: Record<string, unknown>;
}

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

  const aliases = new Set<string>();
  return {
    records: records.map((record, index) => parseSeedRecord(record, index, aliases)),
  };
}

export async function runSeed(db: Database, source: string, spec: SeedSpec): Promise<SeedRunResult> {
  const aliases = new Map<string, unknown>();
  const inserted: SeedInsertedRecord[] = [];

  for (const record of spec.records) {
    const data = resolveRecord(record.data, aliases);
    const statement = emitInsertStatement(source, record.entity, data);
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
    data: candidate.data as Record<string, unknown>,
  };
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
