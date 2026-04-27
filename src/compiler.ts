import { Program, QueryDeclaration, TransactionDeclaration } from "./ast.js";
import { insertEntityStatement, InsertStatement } from "./data.js";
import { parseSchemaManifest, schemaManifestJson } from "./manifest.js";
import {
  createDiffMigration,
  createInitialMigration,
  MigrationArtifact,
  migrationPlanJson,
  migrationPlanText,
  planMigration,
} from "./migration.js";
import { parseProgram } from "./parser.js";
import { queryToPostgres, schemaToPostgres, transactionToPostgres } from "./postgres.js";
import { buildQueryIr } from "./query-ir.js";
import { buildSchema, SchemaIr } from "./schema.js";
import { buildTransactionIr } from "./transaction-ir.js";

export interface CompileResult {
  program: Program;
  schema: SchemaIr;
}

export function compileSource(source: string): CompileResult {
  const program = parseProgram(source);
  const schema = buildSchema(program);
  return { program, schema };
}

export function emitPostgresSchema(source: string): string {
  const { schema } = compileSource(source);
  return schemaToPostgres(schema);
}

export function emitSchemaManifest(source: string): string {
  const { schema } = compileSource(source);
  return schemaManifestJson(schema);
}

export function emitQueryIr(source: string, queryName: string): string {
  const { program, schema } = compileSource(source);
  return `${JSON.stringify(buildQueryIr(schema, findQuery(program, queryName)), null, 2)}\n`;
}

export function emitQuerySql(source: string, queryName: string): string {
  const { program, schema } = compileSource(source);
  return queryToPostgres(schema, findQuery(program, queryName));
}

export function emitInsertStatement(source: string, entityName: string, record: Record<string, unknown>): InsertStatement {
  const { schema } = compileSource(source);
  return insertEntityStatement(schema, entityName, record);
}

export function emitTransactionIr(source: string, transactionName: string): string {
  const { program, schema } = compileSource(source);
  return `${JSON.stringify(buildTransactionIr(schema, findTransaction(program, transactionName)), null, 2)}\n`;
}

export function emitTransactionSql(source: string, transactionName: string): string {
  const { program, schema } = compileSource(source);
  return transactionToPostgres(schema, findTransaction(program, transactionName));
}

export function transactionRetryAttempts(source: string, transactionName: string): number {
  const { program } = compileSource(source);
  return findTransaction(program, transactionName).retry?.attempts ?? 1;
}

export function emitInitialMigration(source: string, name: string): MigrationArtifact {
  const { schema } = compileSource(source);
  return createInitialMigration(schema, name);
}

export function emitMigrationPlan(previousManifestSource: string, currentSource: string, format: "text" | "json" = "text"): string {
  const previous = parseSchemaManifest(previousManifestSource).schema;
  const current = compileSource(currentSource).schema;
  const plan = planMigration(previous, current);
  return format === "json" ? migrationPlanJson(plan) : migrationPlanText(plan);
}

export function emitDiffMigration(previousManifestSource: string, currentSource: string, name: string): MigrationArtifact {
  const previous = parseSchemaManifest(previousManifestSource).schema;
  const current = compileSource(currentSource).schema;
  return createDiffMigration(planMigration(previous, current), name);
}

export function explainQuery(source: string, queryName: string): string {
  const { program, schema } = compileSource(source);
  const query = findQuery(program, queryName);
  const queryIr = buildQueryIr(schema, query);

  return [
    `Reux query: ${query.name}`,
    `Result type: ${query.resultType}`,
    "Backend: PostgreSQL",
    "Query IR:",
    indent(JSON.stringify(queryIr.root, null, 2)),
    "Generated SQL:",
    indent(queryToPostgres(schema, query)),
  ].join("\n");
}

function findQuery(program: Program, queryName: string): QueryDeclaration {
  const query = program.declarations.find(
    (declaration): declaration is QueryDeclaration => declaration.kind === "query" && declaration.name === queryName,
  );
  if (!query) {
    throw new Error(`query '${queryName}' was not found`);
  }
  return query;
}

function findTransaction(program: Program, transactionName: string): TransactionDeclaration {
  const transaction = program.declarations.find(
    (declaration): declaration is TransactionDeclaration =>
      declaration.kind === "transaction" && declaration.name === transactionName,
  );
  if (!transaction) {
    throw new Error(`transaction '${transactionName}' was not found`);
  }
  return transaction;
}

function indent(value: string): string {
  return value.split("\n").map((line) => `  ${line}`).join("\n");
}
