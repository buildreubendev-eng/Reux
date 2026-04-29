import { Program, SimulationDeclaration } from "./ast.js";
import { DlAggregateError } from "./errors.js";

export interface SimulationIr {
  name: string;
  assumptions: SimulationAssumptionIr[];
  forecast: {
    periods: number;
    unit: SimulationDeclaration["forecast"]["unit"];
  };
}

export interface SimulationAssumptionIr {
  name: string;
  type: "boolean" | "number" | "string";
  value: boolean | number | string;
}

export interface SimulationRunResult {
  name: string;
  model: "prototype-static-forecast";
  forecast: SimulationIr["forecast"];
  periods: SimulationPeriodResult[];
}

export interface SimulationPeriodResult {
  period: number;
  label: string;
  assumptions: Record<string, boolean | number | string>;
  metrics: Record<string, number>;
}

export function buildSimulationCatalog(program: Program): SimulationIr[] {
  const diagnostics: string[] = [];
  const simulations = program.declarations.filter((declaration): declaration is SimulationDeclaration => declaration.kind === "simulation");

  for (const duplicate of duplicates(simulations.map((simulation) => simulation.name))) {
    diagnostics.push(`duplicate simulation declaration ${duplicate}`);
  }

  const catalog = simulations.map((simulation) => buildSimulationIr(simulation, diagnostics));
  if (diagnostics.length > 0) {
    throw new DlAggregateError(diagnostics);
  }
  return catalog;
}

export function runSimulationIr(simulation: SimulationIr): SimulationRunResult {
  const assumptions = Object.fromEntries(simulation.assumptions.map((assumption) => [assumption.name, assumption.value]));
  const metrics = derivedMetrics(simulation.assumptions);
  const periods: SimulationPeriodResult[] = [];

  for (let period = 1; period <= simulation.forecast.periods; period += 1) {
    const periodMetrics: Record<string, number> = {};
    if (metrics.netCashFlow !== undefined) {
      periodMetrics.netCashFlow = metrics.netCashFlow;
      periodMetrics.cumulativeNetCashFlow = metrics.netCashFlow * period;
    }
    if (metrics.changeRate !== undefined) {
      periodMetrics.changeRate = metrics.changeRate;
      periodMetrics.projectedIndex = Number((100 * Math.pow(1 + metrics.changeRate, period)).toFixed(4));
    }

    periods.push({
      period,
      label: `${period} ${pluralize(simulation.forecast.unit, period)}`,
      assumptions,
      metrics: periodMetrics,
    });
  }

  return {
    name: simulation.name,
    model: "prototype-static-forecast",
    forecast: simulation.forecast,
    periods,
  };
}

function buildSimulationIr(simulation: SimulationDeclaration, diagnostics: string[]): SimulationIr {
  for (const duplicate of duplicates(simulation.assumptions.map((assumption) => assumption.name))) {
    diagnostics.push(`simulation ${simulation.name} declares duplicate assumption ${duplicate}`);
  }

  return {
    name: simulation.name,
    assumptions: simulation.assumptions.map((assumption) => ({
      name: assumption.name,
      ...parseSimulationValue(simulation.name, assumption, diagnostics),
    })),
    forecast: simulation.forecast,
  };
}

function parseSimulationValue(
  simulationName: string,
  assumption: SimulationDeclaration["assumptions"][number],
  diagnostics: string[],
): Pick<SimulationAssumptionIr, "type" | "value"> {
  const value = assumption.value.trim();
  if (value === "true" || value === "false") {
    return { type: "boolean", value: value === "true" };
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return { type: "number", value: Number(value) };
  }
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return { type: "string", value: value.slice(1, -1) };
  }
  diagnostics.push(`simulation ${simulationName} assumption ${assumption.name} must be a number, boolean, or quoted string`);
  return { type: "string", value };
}

function derivedMetrics(assumptions: SimulationAssumptionIr[]): { netCashFlow?: number; changeRate?: number } {
  const numeric = assumptions.filter((assumption): assumption is SimulationAssumptionIr & { value: number } => assumption.type === "number");
  const income = numeric.find((assumption) => assumption.name === "income");
  const rateValues = numeric.filter((assumption) => isRateAssumption(assumption.name));

  return {
    netCashFlow: income
      ? income.value - numeric.filter((assumption) => assumption.name !== "income" && !isRateAssumption(assumption.name)).reduce((total, assumption) => total + assumption.value, 0)
      : undefined,
    changeRate: rateValues.length > 0 ? rateValues.reduce((total, assumption) => total + assumption.value, 0) : undefined,
  };
}

function isRateAssumption(name: string): boolean {
  return /(?:rate|gain|reduction|growth|lift|improvement)$/i.test(name);
}

function pluralize(unit: SimulationIr["forecast"]["unit"], count: number): string {
  if (count === 1) return unit;
  return `${unit}s`;
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}
