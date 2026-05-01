import { Program, QueryDeclaration, TransactionDeclaration } from "./ast.js";
import { insertEntityStatement, InsertStatement } from "./data.js";
import { formatSource } from "./formatter.js";
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
import { buildSchema, SchemaIr, TransitionIr } from "./schema.js";
import { buildTransactionIr } from "./transaction-ir.js";
import { buildSimulationCatalog, runSimulationIr, SimulationIr } from "./simulation-ir.js";
import { describeSimulationPacks, formatSimulationPackReports } from "./simulation-packs.js";
import { DlAggregateError } from "./errors.js";
import {
  emitTypeScriptApi,
  emitTypeScriptApiServer,
  emitTypeScriptWorker,
  TypeScriptApiOptions,
  TypeScriptApiServerOptions,
  TypeScriptWorkerOptions,
} from "./api-generator.js";
import { emitTypeScriptSimulationContracts } from "./simulation-generator.js";

export {
  businessSimulatorContractVersion,
  businessSimulatorDefaultAssumptions,
  businessSimulatorEndpoints,
} from "./business-simulator-contract.js";
export type {
  BusinessSimulatorAssumptions,
  BusinessSimulatorCompareRequest,
  BusinessSimulatorCompareResponse,
  BusinessSimulatorComparison,
  BusinessSimulatorEndpointName,
  BusinessSimulatorForecastUnit,
  BusinessSimulatorMetricDelta,
  BusinessSimulatorMetricName,
  BusinessSimulatorMetricSnapshot,
  BusinessSimulatorRecommendation,
  BusinessSimulatorRunRequest,
  BusinessSimulatorRunResponse,
  BusinessSimulatorScenarioInput,
  BusinessSimulatorScenarioResult,
  BusinessSimulatorSummary,
  BusinessSimulatorTimelinePoint,
  GetBusinessSimulationResponse,
  ListBusinessSimulationsResponse,
} from "./business-simulator-contract.js";

export interface CompileResult {
  program: Program;
  schema: SchemaIr;
  simulations: SimulationIr[];
}

export interface DiagnosticReport {
  ok: boolean;
  diagnostics: Diagnostic[];
  summary?: {
    moduleName: string;
    entities: number;
    enums: number;
    queries: number;
    simulations: number;
    transactions: number;
    transitions: number;
  };
}

export interface Diagnostic {
  severity: "error";
  message: string;
}

export interface MigrationSafetyOptions {
  allowUnsafe?: boolean;
  allowDestructive?: boolean;
  environment?: "development" | "staging" | "production";
  allowProduction?: boolean;
}

export interface MigrationSafetyCheck {
  ok: boolean;
  allowed: MigrationSafetyOptions;
  summary: {
    safe: number;
    unsafe: number;
    destructive: number;
  };
  diagnostics: string[];
  review: {
    required: boolean;
    warnings: string[];
    rollback: string[];
    checklist: string[];
  };
}

export function compileSource(source: string): CompileResult {
  const program = parseProgram(source);
  const schema = buildSchema(program);
  const simulations = buildSimulationCatalog(program);
  return { program, schema, simulations };
}

export function diagnoseSource(source: string): DiagnosticReport {
  try {
    const result = compileSource(source);
    return {
      ok: true,
      diagnostics: [],
      summary: {
        moduleName: result.program.moduleName,
        entities: result.schema.entities.length,
        enums: result.schema.enums.length,
        queries: result.program.declarations.filter((declaration) => declaration.kind === "query").length,
        simulations: result.simulations.length,
        transactions: result.program.declarations.filter((declaration) => declaration.kind === "transaction").length,
        transitions: result.program.declarations.filter((declaration) => declaration.kind === "transition").length,
      },
    };
  } catch (error) {
    if (error instanceof DlAggregateError) {
      return {
        ok: false,
        diagnostics: error.diagnostics.map((message) => ({ severity: "error", message })),
      };
    }
    return {
      ok: false,
      diagnostics: [{ severity: "error", message: error instanceof Error ? error.message : String(error) }],
    };
  }
}

export function formatReuxSource(source: string): string {
  return formatSource(source);
}

export function emitPostgresSchema(source: string): string {
  const { schema } = compileSource(source);
  return schemaToPostgres(schema);
}

export function emitSchemaManifest(source: string): string {
  const { schema } = compileSource(source);
  return schemaManifestJson(schema);
}

export function emitTransitionRules(source: string, target?: string): string {
  const { schema } = compileSource(source);
  const transitions = filterTransitions(schema.transitions, target);
  return `${JSON.stringify({ transitions }, null, 2)}\n`;
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

export function emitSimulationIr(source: string, simulationName?: string): string {
  const { simulations } = compileSource(source);
  return `${JSON.stringify(findSimulation(simulations, simulationName), null, 2)}\n`;
}

export function emitSimulationRun(source: string, simulationName?: string): string {
  const { simulations } = compileSource(source);
  return `${JSON.stringify(runSimulationIr(findSimulation(simulations, simulationName)), null, 2)}\n`;
}

export function emitSimulationTypes(source: string): string {
  return emitTypeScriptSimulationContracts(source);
}

export function emitSimulationPacks(source: string, simulationName?: string, format: "text" | "json" = "text"): string {
  const { simulations } = compileSource(source);
  const selected = simulationName ? [findSimulation(simulations, simulationName)] : simulations;
  const reports = describeSimulationPacks(selected);
  return format === "json" ? `${JSON.stringify({ simulations: reports }, null, 2)}\n` : formatSimulationPackReports(reports);
}

export function emitApiClient(source: string, options?: TypeScriptApiOptions): string {
  return emitTypeScriptApi(source, options);
}

export function emitApiServer(source: string, options?: TypeScriptApiServerOptions): string {
  return emitTypeScriptApiServer(source, options);
}

export function emitWorker(source: string, options?: TypeScriptWorkerOptions): string {
  return emitTypeScriptWorker(source, options);
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

export function checkMigrationSafety(
  previousManifestSource: string,
  currentSource: string,
  options: MigrationSafetyOptions = {},
): MigrationSafetyCheck {
  const previous = parseSchemaManifest(previousManifestSource).schema;
  const current = compileSource(currentSource).schema;
  const plan = planMigration(previous, current);
  const diagnostics = plan.operations
    .filter((operation) => {
      if (operation.safety === "safe") return false;
      if (operation.safety === "unsafe") return !options.allowUnsafe && !options.allowDestructive;
      return !options.allowDestructive;
    })
    .map((operation) => `${operation.safety}: ${operation.description}`);
  if (options.environment === "production" && !options.allowProduction && (plan.operations.length > 0 || diagnostics.length > 0)) {
    diagnostics.push("production: pass --allow-production after reviewing rollback notes and testing against staging");
  }

  return {
    ok: diagnostics.length === 0,
    allowed: {
      allowUnsafe: Boolean(options.allowUnsafe),
      allowDestructive: Boolean(options.allowDestructive),
      environment: options.environment,
      allowProduction: Boolean(options.allowProduction),
    },
    summary: plan.summary,
    diagnostics,
    review: plan.review,
  };
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

function findSimulation(simulations: SimulationIr[], simulationName?: string): SimulationIr {
  if (simulationName) {
    const simulation = simulations.find((candidate) => candidate.name === simulationName);
    if (!simulation) {
      throw new Error(`simulation '${simulationName}' was not found`);
    }
    return simulation;
  }
  if (simulations.length === 1) return simulations[0];
  if (simulations.length === 0) {
    throw new Error("no simulation declarations were found");
  }
  throw new Error("multiple simulations found; pass a simulation name");
}

function filterTransitions(transitions: TransitionIr[], target?: string): TransitionIr[] {
  if (!target) return transitions;
  const [entity, field] = target.split(".");
  if (!entity || !field || target.split(".").length !== 2) {
    throw new Error("transition target must be Entity.field");
  }
  const filtered = transitions.filter((transition) => transition.entity === entity && transition.field === field);
  if (filtered.length === 0) {
    throw new Error(`transition '${target}' was not found`);
  }
  return filtered;
}

function indent(value: string): string {
  return value.split("\n").map((line) => `  ${line}`).join("\n");
}
