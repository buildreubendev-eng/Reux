import { columnSql, quoteLiteral, schemaToPostgres } from "./postgres.js";
import { EntityIr, FieldIr, findEntity, IndexIr, SchemaIr, snakeCase } from "./schema.js";

export interface MigrationArtifact {
  filename: string;
  sql: string;
}

export interface MigrationPlan {
  kind: "initial" | "diff";
  moduleName: string;
  operations: MigrationOperation[];
  sql: string;
  diagnostics: string[];
  review: MigrationReview;
  summary: {
    safe: number;
    unsafe: number;
    destructive: number;
  };
}

export type MigrationSafety = "safe" | "unsafe" | "destructive";

export interface MigrationReview {
  required: boolean;
  warnings: string[];
  rollback: string[];
  checklist: string[];
}

export interface MigrationOperation {
  kind:
    | "create_enum"
    | "add_enum_value"
    | "create_entity"
    | "drop_entity"
    | "add_field"
    | "drop_field"
    | "alter_field"
    | "create_index"
    | "drop_index";
  safety: MigrationSafety;
  description: string;
  sql?: string[];
}

export function createInitialMigration(schema: SchemaIr, name: string, now = new Date()): MigrationArtifact {
  const stamp = migrationStamp(now);
  const slug = slugify(name);
  return {
    filename: `${stamp}_${slug}.sql`,
    sql: [
      `-- Reux migration: ${name}`,
      `-- Kind: initial schema`,
      `-- Module: ${schema.moduleName}`,
      "",
      schemaToPostgres(schema),
      "",
    ].join("\n"),
  };
}

export function createDiffMigration(plan: MigrationPlan, name: string, now = new Date()): MigrationArtifact {
  const stamp = migrationStamp(now);
  const slug = slugify(name);
  const unsafeBlocks = plan.operations
    .filter((operation) => operation.safety !== "safe")
    .map((operation) => `-- ${operation.safety.toUpperCase()}: ${operation.description}`);
  const sqlStatements = plan.operations.flatMap((operation) => operation.sql ?? []);
  return {
    filename: `${stamp}_${slug}.sql`,
    sql: [
      `-- Reux migration: ${name}`,
      `-- Kind: schema diff`,
      `-- Module: ${plan.moduleName}`,
      `-- Safe: ${plan.summary.safe}, unsafe: ${plan.summary.unsafe}, destructive: ${plan.summary.destructive}`,
      `-- Review required: ${plan.review.required ? "yes" : "no"}`,
      "",
      ...unsafeBlocks,
      unsafeBlocks.length ? "" : undefined,
      ...plan.review.rollback.map((note) => `-- Rollback: ${note}`),
      plan.review.rollback.length ? "" : undefined,
      ...sqlStatements,
      "",
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n"),
  };
}

export function planMigration(previous: SchemaIr, current: SchemaIr): MigrationPlan {
  const operations: MigrationOperation[] = [
    ...enumOperations(previous, current),
    ...entityOperations(previous, current),
  ];
  const diagnostics = operations
    .filter((operation) => operation.safety !== "safe")
    .map((operation) => `${operation.safety}: ${operation.description}`);
  const sql = operations.flatMap((operation) => operation.sql ?? []).join("\n");
  const summary = {
    safe: operations.filter((operation) => operation.safety === "safe").length,
    unsafe: operations.filter((operation) => operation.safety === "unsafe").length,
    destructive: operations.filter((operation) => operation.safety === "destructive").length,
  };

  return {
    kind: "diff",
    moduleName: current.moduleName,
    operations,
    sql,
    diagnostics,
    review: migrationReview(operations, summary),
    summary,
  };
}

export function migrationPlanJson(plan: MigrationPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

export function migrationPlanText(plan: MigrationPlan): string {
  const lines = [
    `Migration plan for module ${plan.moduleName}`,
    `Safe: ${plan.summary.safe}, unsafe: ${plan.summary.unsafe}, destructive: ${plan.summary.destructive}`,
    `Review required: ${plan.review.required ? "yes" : "no"}`,
    "",
    ...plan.operations.map((operation) => {
      const sql = operation.sql?.length ? `\n  SQL:\n${operation.sql.map((line) => `    ${line}`).join("\n")}` : "";
      return `- [${operation.safety}] ${operation.description}${sql}`;
    }),
    "",
    "Review notes:",
    ...formatReviewLines(plan.review.warnings),
    "",
    "Rollback notes:",
    ...formatReviewLines(plan.review.rollback),
    "",
    "Deployment checklist:",
    ...formatReviewLines(plan.review.checklist),
  ];

  return `${lines.join("\n")}\n`;
}

function migrationReview(
  operations: MigrationOperation[],
  summary: MigrationPlan["summary"],
): MigrationReview {
  const warnings = operations
    .filter((operation) => operation.safety !== "safe")
    .map((operation) => `${operation.safety}: ${operation.description}`);
  const rollback = operations.length === 0
    ? ["No schema operations are planned."]
    : operations.map((operation) => rollbackNote(operation));
  return {
    required: summary.unsafe > 0 || summary.destructive > 0,
    warnings,
    rollback,
    checklist: [
      "Run migrate-check before creating or applying the migration.",
      "Run the generated SQL against a disposable database or staging clone.",
      "Back up production data before applying unsafe or destructive operations.",
      "Regenerate and commit the schema manifest after a successful apply.",
    ],
  };
}

function rollbackNote(operation: MigrationOperation): string {
  if (operation.safety === "destructive") {
    return `${operation.description}: restore dropped data from backup or a pre-migration snapshot.`;
  }
  if (operation.safety === "unsafe") {
    return `${operation.description}: write and test a manual rollback before applying.`;
  }
  if (operation.kind === "create_entity") return `${operation.description}: drop the created table if rollback is required before data is written.`;
  if (operation.kind === "add_field") return `${operation.description}: drop the added column if rollback is required.`;
  if (operation.kind === "create_index") return `${operation.description}: drop the created index if rollback is required.`;
  if (operation.kind === "add_enum_value") return `${operation.description}: PostgreSQL enum value rollback requires a manual type rebuild.`;
  return `${operation.description}: verify whether a reverse SQL statement is needed.`;
}

function formatReviewLines(lines: string[]): string[] {
  return lines.length > 0 ? lines.map((line) => `- ${line}`) : ["- none"];
}

function enumOperations(previous: SchemaIr, current: SchemaIr): MigrationOperation[] {
  const operations: MigrationOperation[] = [];
  for (const currentEnum of current.enums) {
    const previousEnum = previous.enums.find((candidate) => candidate.name === currentEnum.name);
    if (!previousEnum) {
      operations.push({
        kind: "create_enum",
        safety: "safe",
        description: `create enum ${currentEnum.name}`,
        sql: [`CREATE TYPE ${snakeCase(currentEnum.name)} AS ENUM (${currentEnum.values.map(quoteLiteral).join(", ")});`],
      });
      continue;
    }

    for (const value of currentEnum.values) {
      if (!previousEnum.values.includes(value)) {
        operations.push({
          kind: "add_enum_value",
          safety: "safe",
          description: `add enum value ${currentEnum.name}.${value}`,
          sql: [`ALTER TYPE ${snakeCase(currentEnum.name)} ADD VALUE ${quoteLiteral(value)};`],
        });
      }
    }

    for (const value of previousEnum.values) {
      if (!currentEnum.values.includes(value)) {
        operations.push({
          kind: "alter_field",
          safety: "unsafe",
          description: `remove enum value ${currentEnum.name}.${value}; PostgreSQL enum value removal requires a manual type rebuild`,
        });
      }
    }
  }
  return operations;
}

function entityOperations(previous: SchemaIr, current: SchemaIr): MigrationOperation[] {
  const operations: MigrationOperation[] = [];

  for (const currentEntity of current.entities) {
    const previousEntity = findEntity(previous, currentEntity.name);
    if (!previousEntity) {
      operations.push({
        kind: "create_entity",
        safety: "safe",
        description: `create entity ${currentEntity.name}`,
        sql: createEntitySql(current, currentEntity),
      });
      continue;
    }

    operations.push(...fieldOperations(previousEntity, currentEntity, current));
    operations.push(...indexOperations(previousEntity, currentEntity));
  }

  for (const previousEntity of previous.entities) {
    if (!findEntity(current, previousEntity.name)) {
      operations.push({
        kind: "drop_entity",
        safety: "destructive",
        description: `drop entity ${previousEntity.name}`,
        sql: [`DROP TABLE ${previousEntity.tableName};`],
      });
    }
  }

  return operations;
}

function fieldOperations(previousEntity: EntityIr, currentEntity: EntityIr, currentSchema: SchemaIr): MigrationOperation[] {
  const operations: MigrationOperation[] = [];

  for (const currentField of currentEntity.fields) {
    const previousField = previousEntity.fields.find((candidate) => candidate.name === currentField.name);
    if (!previousField) {
      const safety = addFieldSafety(currentField);
      const sql = [`ALTER TABLE ${currentEntity.tableName} ADD COLUMN ${columnSql(currentSchema, currentField)};`];
      if (currentField.reference) {
        const referenced = findEntity(currentSchema, currentField.reference.entity);
        if (referenced) {
          sql.push(
            `ALTER TABLE ${currentEntity.tableName} ADD CONSTRAINT ${currentEntity.tableName}_${currentField.columnName}_fkey FOREIGN KEY (${currentField.columnName}) REFERENCES ${referenced.tableName}(id);`,
          );
        }
      }
      operations.push({
        kind: "add_field",
        safety,
        description: `add field ${currentEntity.name}.${currentField.name}${safety === "unsafe" ? " requires backfill or default validation" : ""}`,
        sql: safety === "safe" ? sql : undefined,
      });
      continue;
    }

    if (fieldSignature(previousField) !== fieldSignature(currentField)) {
      operations.push({
        kind: "alter_field",
        safety: "unsafe",
        description: `alter field ${currentEntity.name}.${currentField.name}; type/nullability/constraint changes need a reviewed migration`,
      });
    }
  }

  for (const previousField of previousEntity.fields) {
    if (!currentEntity.fields.some((candidate) => candidate.name === previousField.name)) {
      operations.push({
        kind: "drop_field",
        safety: "destructive",
        description: `drop field ${previousEntity.name}.${previousField.name}`,
        sql: [`ALTER TABLE ${previousEntity.tableName} DROP COLUMN ${previousField.columnName};`],
      });
    }
  }

  return operations;
}

function indexOperations(previousEntity: EntityIr, currentEntity: EntityIr): MigrationOperation[] {
  const operations: MigrationOperation[] = [];
  for (const currentIndex of currentEntity.indexes) {
    if (!previousEntity.indexes.some((candidate) => indexSignature(candidate) === indexSignature(currentIndex))) {
      const columns = currentIndex.fields
        .map((field) => `${field.columnName}${field.direction ? ` ${field.direction.toUpperCase()}` : ""}`)
        .join(", ");
      operations.push({
        kind: "create_index",
        safety: "safe",
        description: `create index ${currentEntity.name}.${currentIndex.name}`,
        sql: [`CREATE INDEX ${currentEntity.tableName}_${snakeCase(currentIndex.name)} ON ${currentEntity.tableName} (${columns});`],
      });
    }
  }

  for (const previousIndex of previousEntity.indexes) {
    if (!currentEntity.indexes.some((candidate) => indexSignature(candidate) === indexSignature(previousIndex))) {
      operations.push({
        kind: "drop_index",
        safety: "destructive",
        description: `drop index ${previousEntity.name}.${previousIndex.name}`,
        sql: [`DROP INDEX ${previousEntity.tableName}_${snakeCase(previousIndex.name)};`],
      });
    }
  }
  return operations;
}

function addFieldSafety(field: FieldIr): MigrationSafety {
  if (field.nullable) return "safe";
  if (field.defaultValue !== undefined || field.generated) return "safe";
  return "unsafe";
}

function fieldSignature(field: FieldIr): string {
  return JSON.stringify({
    type: field.type.raw,
    nullable: field.nullable,
    primary: field.primary,
    generated: field.generated,
    unique: field.unique,
    defaultValue: field.defaultValue,
    check: field.check,
    reference: field.reference?.entity,
  });
}

function indexSignature(index: IndexIr): string {
  return JSON.stringify(index.fields.map((field) => [field.name, field.direction ?? "asc"]));
}

function createEntitySql(schema: SchemaIr, entity: EntityIr): string[] {
  const columns = entity.fields.map((field) => `  ${columnSql(schema, field)}`);
  const tableConstraints = entity.fields.flatMap((field) => {
    if (!field.reference) return [];
    const referenced = findEntity(schema, field.reference.entity);
    if (!referenced) return [];
    return [
      `  CONSTRAINT ${entity.tableName}_${field.columnName}_fkey FOREIGN KEY (${field.columnName}) REFERENCES ${referenced.tableName}(id)`,
    ];
  });
  const table = `CREATE TABLE ${entity.tableName} (\n${[...columns, ...tableConstraints].join(",\n")}\n);`;
  const indexes = entity.indexes.map((index) => {
    const columnsSql = index.fields
      .map((field) => `${field.columnName}${field.direction ? ` ${field.direction.toUpperCase()}` : ""}`)
      .join(", ");
    return `CREATE INDEX ${entity.tableName}_${snakeCase(index.name)} ON ${entity.tableName} (${columnsSql});`;
  });
  return [table, ...indexes];
}

function migrationStamp(now: Date): string {
  const year = now.getUTCFullYear();
  const month = pad(now.getUTCMonth() + 1);
  const day = pad(now.getUTCDate());
  const hour = pad(now.getUTCHours());
  const minute = pad(now.getUTCMinutes());
  const second = pad(now.getUTCSeconds());
  return `${year}${month}${day}${hour}${minute}${second}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug || "migration";
}
