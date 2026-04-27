import { createHash } from "node:crypto";
import { SchemaIr } from "./schema.js";

export interface SchemaManifest {
  format: "dl.schema.v1";
  schemaHash: string;
  schema: SchemaIr;
}

export function buildSchemaManifest(schema: SchemaIr): SchemaManifest {
  const normalizedSchema = normalize(schema);
  return {
    format: "dl.schema.v1",
    schemaHash: hashJson(normalizedSchema),
    schema: normalizedSchema,
  };
}

export function schemaManifestJson(schema: SchemaIr): string {
  return `${JSON.stringify(buildSchemaManifest(schema), null, 2)}\n`;
}

export function parseSchemaManifest(source: string): SchemaManifest {
  const parsed = JSON.parse(source) as SchemaManifest;
  if (parsed.format !== "dl.schema.v1" || !parsed.schema || typeof parsed.schemaHash !== "string") {
    throw new Error("expected a dl.schema.v1 schema manifest");
  }
  return parsed;
}

function normalize(schema: SchemaIr): SchemaIr {
  return {
    moduleName: schema.moduleName,
    enums: [...schema.enums].sort((left, right) => left.name.localeCompare(right.name)),
    entities: [...schema.entities]
      .map((entity) => ({
        ...entity,
        fields: [...entity.fields].sort((left, right) => left.name.localeCompare(right.name)),
        indexes: [...entity.indexes].sort((left, right) => left.name.localeCompare(right.name)),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
