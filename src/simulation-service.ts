import { parseProgram } from "./parser.js";
import {
  buildSimulationCatalog,
  runSimulationIr,
  SimulationChangeIr,
  SimulationIr,
  SimulationRunResult,
} from "./simulation-ir.js";

export type ReuxSimulationExecutionValue = boolean | number | string;

export const reuxSimulationExecutionLimits = {
  maxScenarios: 12,
  maxChangesPerScenario: 24,
  maxOverrideEntries: 64,
  maxScenarioNameLength: 120,
} as const;

export interface ReuxSimulationExecutionChangeInput {
  period: number;
  unit?: SimulationIr["forecast"]["unit"];
  overrides: Record<string, ReuxSimulationExecutionValue>;
}

export interface ReuxSimulationExecutionScenarioInput {
  name: string;
  overrides?: Record<string, ReuxSimulationExecutionValue>;
  changes?: ReuxSimulationExecutionChangeInput[];
}

export interface ReuxSimulationExecutionRequest {
  simulationName?: string;
  assumptions?: Record<string, ReuxSimulationExecutionValue>;
  scenarios?: ReuxSimulationExecutionScenarioInput[];
}

export interface ReuxSimulationMetadata {
  name: string;
  dimensions: Record<string, string>;
  forecast: SimulationIr["forecast"];
  assumptions: Array<{ name: string; type: "boolean" | "number" | "string"; value: ReuxSimulationExecutionValue; unit?: string }>;
  metrics: string[];
  objectives: SimulationIr["objectives"];
  scenarios: string[];
}

export interface ReuxSimulationListResponse {
  simulations: ReuxSimulationMetadata[];
}

export interface ReuxSimulationGetResponse {
  simulation: ReuxSimulationMetadata;
}

export interface ReuxSimulationExecutionResponse {
  simulation: ReuxSimulationMetadata;
  run: SimulationRunResult;
  generatedAt: string;
}

export interface ReuxSimulationExecutionIssue {
  path: string;
  message: string;
}

export class ReuxSimulationExecutionError extends Error {
  readonly code = "simulation_execution_validation_failed";
  readonly statusCode = 400;
  readonly issues: ReuxSimulationExecutionIssue[];

  constructor(issues: ReuxSimulationExecutionIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "ReuxSimulationExecutionError";
    this.issues = issues;
  }
}

export function listReuxSimulations(source: string): ReuxSimulationListResponse {
  return { simulations: compileSimulations(source).map((simulation) => simulationMetadata(simulation)) };
}

export function getReuxSimulation(source: string, simulationName?: string): ReuxSimulationGetResponse {
  return { simulation: simulationMetadata(selectSimulation(compileSimulations(source), simulationName)) };
}

export function runReuxSimulation(source: string, request: ReuxSimulationExecutionRequest = {}, now: Date = new Date()): ReuxSimulationExecutionResponse {
  assertExecutionRequest(request);
  const simulation = selectSimulation(compileSimulations(source), request.simulationName);
  const executable = applyExecutionRequest(simulation, request);
  const run = runSimulationIr(executable);

  return {
    simulation: simulationMetadata(executable, run),
    run,
    generatedAt: now.toISOString(),
  };
}

function compileSimulations(source: string): SimulationIr[] {
  return buildSimulationCatalog(parseProgram(source));
}

function selectSimulation(simulations: SimulationIr[], simulationName?: string): SimulationIr {
  if (!simulationName) {
    const first = simulations[0];
    if (!first) throw new Error("no simulations found");
    return first;
  }
  const simulation = simulations.find((candidate) => candidate.name === simulationName);
  if (!simulation) throw new Error(`simulation '${simulationName}' was not found`);
  return simulation;
}

function applyExecutionRequest(simulation: SimulationIr, request: ReuxSimulationExecutionRequest): SimulationIr {
  const issues: ReuxSimulationExecutionIssue[] = [];
  const assumptions = applyAssumptionOverrides(simulation, request.assumptions ?? {}, "$.assumptions", issues);
  const baseForScenarioValidation = new Map(assumptions.map((assumption) => [assumption.name, assumption]));
  const scenarios = request.scenarios === undefined
    ? simulation.scenarios
    : request.scenarios.map((scenario, index) => ({
        name: scenario.name,
        overrides: Object.entries(scenario.overrides ?? {}).map(([name, value]) =>
          buildOverride(name, value, baseForScenarioValidation, `$.scenarios[${index}].overrides.${name}`, issues),
        ).filter((override): override is SimulationIr["assumptions"][number] => Boolean(override)),
        changes: (scenario.changes ?? []).map((change, changeIndex) =>
          buildChange(change, baseForScenarioValidation, simulation.forecast, `$.scenarios[${index}].changes[${changeIndex}]`, issues),
        ),
      }));

  for (const duplicate of duplicates(scenarios.map((scenario) => scenario.name))) {
    issues.push({ path: "$.scenarios", message: `duplicate scenario name '${duplicate}'` });
  }

  if (issues.length > 0) throw new ReuxSimulationExecutionError(issues);

  return {
    ...simulation,
    assumptions,
    scenarios,
  };
}

function assertExecutionRequest(value: unknown): asserts value is ReuxSimulationExecutionRequest {
  const issues: ReuxSimulationExecutionIssue[] = [];
  if (!isObject(value)) {
    throw new ReuxSimulationExecutionError([{ path: "$", message: "must be an object" }]);
  }
  if (value.simulationName !== undefined && !isNonEmptyString(value.simulationName)) {
    issues.push({ path: "$.simulationName", message: "must be a non-empty string when provided" });
  }
  if (value.assumptions !== undefined && !isPlainRecord(value.assumptions)) {
    issues.push({ path: "$.assumptions", message: "must be an object when provided" });
  } else if (value.assumptions !== undefined && Object.keys(value.assumptions).length > reuxSimulationExecutionLimits.maxOverrideEntries) {
    issues.push({ path: "$.assumptions", message: `must include at most ${reuxSimulationExecutionLimits.maxOverrideEntries} entries` });
  }
  if (value.scenarios !== undefined) {
    if (!Array.isArray(value.scenarios)) {
      issues.push({ path: "$.scenarios", message: "must be an array when provided" });
    } else if (value.scenarios.length > reuxSimulationExecutionLimits.maxScenarios) {
      issues.push({ path: "$.scenarios", message: `must include at most ${reuxSimulationExecutionLimits.maxScenarios} scenarios` });
    } else {
      value.scenarios.forEach((scenario, index) => validateScenarioInput(scenario, index, issues));
    }
  }
  if (issues.length > 0) throw new ReuxSimulationExecutionError(issues);
}

function validateScenarioInput(value: unknown, index: number, issues: ReuxSimulationExecutionIssue[]): void {
  const path = `$.scenarios[${index}]`;
  if (!isObject(value)) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  if (!isNonEmptyString(value.name)) {
    issues.push({ path: `${path}.name`, message: "must be a non-empty string" });
  } else if (value.name.length > reuxSimulationExecutionLimits.maxScenarioNameLength) {
    issues.push({ path: `${path}.name`, message: `must be at most ${reuxSimulationExecutionLimits.maxScenarioNameLength} characters` });
  }
  if (value.overrides !== undefined && !isPlainRecord(value.overrides)) {
    issues.push({ path: `${path}.overrides`, message: "must be an object when provided" });
  } else if (value.overrides !== undefined && Object.keys(value.overrides).length > reuxSimulationExecutionLimits.maxOverrideEntries) {
    issues.push({ path: `${path}.overrides`, message: `must include at most ${reuxSimulationExecutionLimits.maxOverrideEntries} entries` });
  }
  if (value.changes !== undefined) {
    if (!Array.isArray(value.changes)) {
      issues.push({ path: `${path}.changes`, message: "must be an array when provided" });
    } else if (value.changes.length > reuxSimulationExecutionLimits.maxChangesPerScenario) {
      issues.push({ path: `${path}.changes`, message: `must include at most ${reuxSimulationExecutionLimits.maxChangesPerScenario} changes` });
    } else {
      value.changes.forEach((change, changeIndex) => validateChangeInput(change, `${path}.changes[${changeIndex}]`, issues));
    }
  }
}

function validateChangeInput(value: unknown, path: string, issues: ReuxSimulationExecutionIssue[]): void {
  if (!isObject(value)) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  if (typeof value.period !== "number" || !Number.isInteger(value.period) || value.period < 1) {
    issues.push({ path: `${path}.period`, message: "must be a positive integer" });
  }
  if (value.unit !== undefined && !["day", "week", "month", "quarter", "year"].includes(String(value.unit))) {
    issues.push({ path: `${path}.unit`, message: "must be one of day, week, month, quarter, year" });
  }
  if (!isPlainRecord(value.overrides)) {
    issues.push({ path: `${path}.overrides`, message: "must be an object" });
  } else if (Object.keys(value.overrides).length > reuxSimulationExecutionLimits.maxOverrideEntries) {
    issues.push({ path: `${path}.overrides`, message: `must include at most ${reuxSimulationExecutionLimits.maxOverrideEntries} entries` });
  }
}

function applyAssumptionOverrides(
  simulation: SimulationIr,
  overrides: Record<string, ReuxSimulationExecutionValue>,
  path: string,
  issues: ReuxSimulationExecutionIssue[],
): SimulationIr["assumptions"] {
  const assumptionsByName = new Map(simulation.assumptions.map((assumption) => [assumption.name, assumption]));
  for (const name of Object.keys(overrides)) {
    if (!assumptionsByName.has(name)) {
      issues.push({ path: `${path}.${name}`, message: "references an unknown assumption" });
    }
  }
  return simulation.assumptions.map((assumption) => ({
    ...assumption,
    value: overrides[assumption.name] !== undefined
      ? checkedValue(assumption.name, overrides[assumption.name], assumption, `${path}.${assumption.name}`, issues)
      : assumption.value,
  }));
}

function buildOverride(
  name: string,
  value: ReuxSimulationExecutionValue,
  assumptionsByName: Map<string, SimulationIr["assumptions"][number]>,
  path: string,
  issues: ReuxSimulationExecutionIssue[],
): SimulationIr["assumptions"][number] | undefined {
  const base = assumptionsByName.get(name);
  if (!base) {
    issues.push({ path, message: "references an unknown assumption" });
    return undefined;
  }
  return {
    ...base,
    value: checkedValue(name, value, base, path, issues),
  };
}

function buildChange(
  value: ReuxSimulationExecutionChangeInput,
  assumptionsByName: Map<string, SimulationIr["assumptions"][number]>,
  forecast: SimulationIr["forecast"],
  path: string,
  issues: ReuxSimulationExecutionIssue[],
): SimulationChangeIr {
  const unit = value.unit ?? forecast.unit;
  if (unit !== forecast.unit) {
    issues.push({ path: `${path}.unit`, message: `must match forecast unit '${forecast.unit}'` });
  }
  if (value.period > forecast.periods) {
    issues.push({ path: `${path}.period`, message: "must be within the forecast window" });
  }
  return {
    period: value.period,
    unit,
    overrides: Object.entries(value.overrides).map(([name, override]) =>
      buildOverride(name, override, assumptionsByName, `${path}.overrides.${name}`, issues),
    ).filter((override): override is SimulationIr["assumptions"][number] => Boolean(override)),
  };
}

function checkedValue(
  name: string,
  value: ReuxSimulationExecutionValue,
  assumption: SimulationIr["assumptions"][number],
  path: string,
  issues: ReuxSimulationExecutionIssue[],
): ReuxSimulationExecutionValue {
  if (typeof value !== assumption.type) {
    issues.push({ path, message: `must be ${article(assumption.type)} ${assumption.type} for assumption '${name}'` });
    return assumption.value;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    issues.push({ path, message: `must be a finite number for assumption '${name}'` });
    return assumption.value;
  }
  return value;
}

function simulationMetadata(simulation: SimulationIr, run = runSimulationIr(simulation)): ReuxSimulationMetadata {
  return {
    name: simulation.name,
    dimensions: Object.fromEntries(simulation.dimensions.map((dimension) => [dimension.name, dimension.value])),
    forecast: simulation.forecast,
    assumptions: simulation.assumptions.map((assumption) => ({
      name: assumption.name,
      type: assumption.type,
      value: assumption.value,
      ...(assumption.unit ? { unit: assumption.unit } : {}),
    })),
    metrics: metricNames(run),
    objectives: simulation.objectives,
    scenarios: run.scenarios?.map((scenario) => scenario.name) ?? ["baseline"],
  };
}

function metricNames(run: SimulationRunResult): string[] {
  const names = new Set<string>();
  for (const period of run.periods) {
    for (const metric of Object.keys(period.metrics)) names.add(metric);
  }
  for (const scenario of run.scenarios ?? []) {
    for (const period of scenario.periods) {
      for (const metric of Object.keys(period.metrics)) names.add(metric);
    }
  }
  return [...names].sort();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, ReuxSimulationExecutionValue> {
  return isObject(value) && Object.values(value).every((entry) => ["boolean", "number", "string"].includes(typeof entry));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

function article(type: string): string {
  return /^[aeiou]/.test(type) ? "an" : "a";
}
