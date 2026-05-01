import { parseProgram } from "./parser.js";
import { buildSimulationCatalog, runSimulationIr, SimulationRunResult, SimulationScenarioRunResult } from "./simulation-ir.js";
import {
  businessSimulatorDefaultAssumptions,
  businessSimulatorMetricNames,
  BusinessSimulatorAssumptions,
  BusinessSimulatorCompareRequest,
  BusinessSimulatorCompareResponse,
  BusinessSimulatorComparison,
  BusinessSimulatorMetricDelta,
  BusinessSimulatorMetricName,
  BusinessSimulatorMetricSnapshot,
  BusinessSimulatorRecommendation,
  BusinessSimulatorRunRequest,
  BusinessSimulatorRunResponse,
  BusinessSimulatorScenarioInput,
  BusinessSimulatorScenarioResult,
  BusinessSimulatorSummary,
  GetBusinessSimulationResponse,
  ListBusinessSimulationsResponse,
} from "./business-simulator-contract.js";
import { assertBusinessSimulatorCompareRequest, assertBusinessSimulatorRunRequest } from "./business-simulator-validation.js";

const businessSimulatorSummary: BusinessSimulatorSummary = {
  id: "operations-decision",
  name: "Operations Decision Simulator",
  description: "Compare cost, margin, productivity, workforce load, and risk scenarios before an operational change.",
  domain: "operations",
  status: "ready",
  updatedAt: "2026-05-01T00:00:00.000Z",
};

const exampleScenarios: BusinessSimulatorScenarioInput[] = [
  {
    id: "process-improvement",
    name: "Process Improvement",
    description: "Higher productivity and lower overtime after workflow cleanup.",
    assumptions: {
      productivityGainRate: 0.12,
      overtimeReductionRate: 0.18,
    },
  },
  {
    id: "demand-increase",
    name: "Demand Increase",
    description: "Higher demand with slightly higher supplier delay risk.",
    assumptions: {
      weeklyDemand: 1450,
      supplierDelayRiskRate: 0.15,
    },
  },
  {
    id: "quality-issue",
    name: "Quality Issue",
    description: "Higher defect and supplier delay rates.",
    assumptions: {
      defectRate: 0.06,
      supplierDelayRiskRate: 0.18,
    },
  },
  {
    id: "staffing-increase",
    name: "Staffing Increase",
    description: "More staff with lower overtime pressure.",
    assumptions: {
      employees: 56,
      overtimeReductionRate: 0.2,
    },
  },
];

const metricUnits: Partial<Record<BusinessSimulatorMetricName, BusinessSimulatorMetricDelta["unit"]>> = {
  revenue: "USD",
  operatingCost: "USD",
  laborCost: "USD",
  margin: "USD",
  marginDelta: "USD",
  riskScore: "percent",
  defectCost: "USD",
  productivity: "index",
  workforceLoad: "count",
};

export function listBusinessSimulations(): ListBusinessSimulationsResponse {
  return { simulations: [businessSimulatorSummary] };
}

export function getBusinessSimulation(id = businessSimulatorSummary.id): GetBusinessSimulationResponse {
  if (id !== businessSimulatorSummary.id) {
    throw new Error(`business simulation '${id}' was not found`);
  }
  return {
    simulation: businessSimulatorSummary,
    defaultAssumptions: businessSimulatorDefaultAssumptions,
    exampleScenarios,
  };
}

export function runBusinessSimulator(request: BusinessSimulatorRunRequest, now: Date = new Date()): BusinessSimulatorRunResponse {
  assertBusinessSimulatorRunRequest(request);
  const normalized = normalizeRunRequest(request);
  const reuxScenarioNames = scenarioNamesFor(normalized.scenarios);
  const scenarioNames = new Map(normalized.scenarios.map((scenario, index) => [reuxScenarioNames[index], scenario]));
  const reuxSource = buildBusinessSimulatorSource(normalized);
  const simulation = buildSimulationCatalog(parseProgram(reuxSource))[0];
  const run = runSimulationIr(simulation);
  const baselineRun = findScenarioRun(run, "baseline");
  const scenarioRuns = [...scenarioNames.entries()].map(([reuxName, input]) => ({ input, run: findScenarioRun(run, reuxName) }));
  const includeTimeline = request.options?.includeTimeline !== false;
  const baseline = toScenarioResult("baseline", "Baseline", undefined, normalized.baseline, baselineRun, includeTimeline);
  const scenarios = scenarioRuns.map(({ input, run: scenarioRun }) =>
    toScenarioResult(input.id, input.name, input.description, mergeAssumptions(normalized.baseline, input.assumptions), scenarioRun, includeTimeline),
  );

  return {
    simulation: {
      ...businessSimulatorSummary,
      updatedAt: now.toISOString(),
    },
    baseline,
    scenarios,
    comparison: compareBusinessSimulatorScenarioResults(baseline, scenarios),
    ...(request.options?.includeReuxSource ? { reuxSource } : {}),
    generatedAt: now.toISOString(),
  };
}

export function compareBusinessSimulatorScenarios(request: BusinessSimulatorCompareRequest, now: Date = new Date()): BusinessSimulatorCompareResponse {
  assertBusinessSimulatorCompareRequest(request);
  return {
    comparison: compareBusinessSimulatorScenarioResults(request.baseline, request.scenarios),
    generatedAt: now.toISOString(),
  };
}

export function compareBusinessSimulatorScenarioResults(
  baseline: BusinessSimulatorScenarioResult,
  scenarios: BusinessSimulatorScenarioResult[],
): BusinessSimulatorComparison {
  const metricDeltasByScenario = Object.fromEntries(
    scenarios.map((scenario) => [scenario.id, businessSimulatorMetricNames.map((metric) => metricDelta(metric, baseline.finalMetrics, scenario.finalMetrics))]),
  );
  const recommendation = recommendScenario(scenarios, metricDeltasByScenario);

  return {
    baselineScenarioId: baseline.id,
    metricDeltasByScenario,
    ...(recommendation ? { recommendedScenarioId: recommendation.scenarioId, recommendation } : {}),
  };
}

export function buildBusinessSimulatorSource(request: BusinessSimulatorRunRequest): string {
  const normalized = normalizeRunRequest(request);
  const scenarioNames = scenarioNamesFor(normalized.scenarios);

  return [
    "module business_simulator",
    "",
    "simulate operations_decision {",
    "  dimension product = business_simulation",
    "  dimension domain = operations",
    "  dimension audience = enterprise",
    "",
    ...businessAssumptionLines(normalized.baseline).map((line) => `  ${line}`),
    "",
    "  formula revenue = weeklyDemand * averageOrderValue",
    "  formula laborCost = employees * averageHourlyCost",
    "  formula productivity = (weeklyDemand / employees) * (1 + productivityGainRate)",
    "  formula workforceLoad = weeklyDemand / (employees * (1 + productivityGainRate))",
    "  formula defectCost = revenue * defectRate",
    "  formula operatingCost = (laborCost * (1 - overtimeReductionRate)) + defectCost",
    "  formula margin = (revenue * grossMarginRate) - operatingCost",
    "  formula marginDelta = margin",
    "  formula riskScore = (supplierDelayRiskRate + defectRate) * 100",
    "",
    "  objective maximize marginDelta",
    "  objective maximize productivity",
    "  objective minimize operatingCost",
    "  objective minimize riskScore",
    "",
    ...normalized.scenarios.flatMap((scenario, index) => scenarioBlock(scenarioNames[index], scenario)),
    `  forecast ${normalized.baseline.forecastPeriods} ${pluralizeForecastUnit(normalized.baseline.forecastUnit, normalized.baseline.forecastPeriods)}`,
    "}",
    "",
  ].join("\n");
}

function normalizeRunRequest(request: BusinessSimulatorRunRequest): BusinessSimulatorRunRequest {
  const baseline = normalizeAssumptions(request.baseline);
  return {
    ...request,
    baseline,
    scenarios: request.scenarios.map((scenario) => ({
      ...scenario,
      assumptions: normalizeScenarioAssumptions(scenario.assumptions),
    })),
  };
}

function normalizeAssumptions(assumptions: BusinessSimulatorAssumptions): BusinessSimulatorAssumptions {
  return {
    ...assumptions,
    employees: positiveNumber("employees", assumptions.employees),
    averageHourlyCost: positiveNumber("averageHourlyCost", assumptions.averageHourlyCost),
    weeklyDemand: positiveNumber("weeklyDemand", assumptions.weeklyDemand),
    averageOrderValue: positiveNumber("averageOrderValue", assumptions.averageOrderValue),
    grossMarginRate: rate("grossMarginRate", assumptions.grossMarginRate),
    productivityGainRate: rate("productivityGainRate", assumptions.productivityGainRate),
    overtimeReductionRate: rate("overtimeReductionRate", assumptions.overtimeReductionRate),
    supplierDelayRiskRate: rate("supplierDelayRiskRate", assumptions.supplierDelayRiskRate),
    defectRate: rate("defectRate", assumptions.defectRate),
    forecastPeriods: positiveInteger("forecastPeriods", assumptions.forecastPeriods),
    forecastUnit: assumptions.forecastUnit,
  };
}

function normalizeScenarioAssumptions(
  assumptions: Partial<BusinessSimulatorAssumptions>,
): Partial<BusinessSimulatorAssumptions> {
  const normalized: Partial<BusinessSimulatorAssumptions> = {};
  for (const [key, value] of Object.entries(assumptions) as Array<[keyof BusinessSimulatorAssumptions, BusinessSimulatorAssumptions[keyof BusinessSimulatorAssumptions]]>) {
    if (value === undefined) continue;
    if (key === "forecastPeriods" || key === "forecastUnit") continue;
    normalized[key] = value as never;
  }
  return normalized;
}

function businessAssumptionLines(assumptions: BusinessSimulatorAssumptions): string[] {
  return [
    `employees = ${assumptions.employees}`,
    `averageHourlyCost = ${assumptions.averageHourlyCost} USD`,
    `weeklyDemand = ${assumptions.weeklyDemand}`,
    `averageOrderValue = ${assumptions.averageOrderValue} USD`,
    `grossMarginRate = ${toPercentQuantity(assumptions.grossMarginRate)} percent`,
    `productivityGainRate = ${toPercentQuantity(assumptions.productivityGainRate)} percent`,
    `overtimeReductionRate = ${toPercentQuantity(assumptions.overtimeReductionRate)} percent`,
    `supplierDelayRiskRate = ${toPercentQuantity(assumptions.supplierDelayRiskRate)} percent`,
    `defectRate = ${toPercentQuantity(assumptions.defectRate)} percent`,
  ];
}

function scenarioBlock(reuxName: string, scenario: BusinessSimulatorScenarioInput): string[] {
  const lines = Object.entries(scenario.assumptions)
    .filter(([key]) => key !== "forecastPeriods" && key !== "forecastUnit")
    .map(([key, value]) => `    ${key} = ${formatAssumptionValue(key as keyof BusinessSimulatorAssumptions, value as number)}`);
  return [
    `  scenario ${reuxName} {`,
    ...lines,
    "  }",
    "",
  ];
}

function formatAssumptionValue(key: keyof BusinessSimulatorAssumptions, value: number): string {
  if (key === "averageHourlyCost" || key === "averageOrderValue") return `${positiveNumber(key, value)} USD`;
  if (key.endsWith("Rate")) return `${toPercentQuantity(rate(key, value))} percent`;
  return String(positiveNumber(key, value));
}

function toScenarioResult(
  id: string,
  name: string,
  description: string | undefined,
  assumptions: BusinessSimulatorAssumptions,
  scenario: SimulationScenarioRunResult,
  includeTimeline = true,
): BusinessSimulatorScenarioResult {
  const finalPeriod = scenario.periods.at(-1);
  if (!finalPeriod) throw new Error(`scenario '${scenario.name}' did not produce any periods`);
  return {
    id,
    name,
    ...(description ? { description } : {}),
    assumptions,
    finalMetrics: toMetricSnapshot(finalPeriod.metrics),
    timeline: includeTimeline
      ? scenario.periods.map((period) => ({
          period: period.period,
          label: period.label,
          metrics: toMetricSnapshot(period.metrics),
        }))
      : [],
  };
}

function toMetricSnapshot(metrics: Record<string, number>): BusinessSimulatorMetricSnapshot {
  return Object.fromEntries(businessSimulatorMetricNames.map((metric) => [metric, metrics[metric] ?? 0])) as unknown as BusinessSimulatorMetricSnapshot;
}

function metricDelta(
  metric: BusinessSimulatorMetricName,
  baseline: BusinessSimulatorMetricSnapshot,
  scenario: BusinessSimulatorMetricSnapshot,
): BusinessSimulatorMetricDelta {
  const baselineValue = baseline[metric];
  const scenarioValue = scenario[metric];
  const delta = Number((scenarioValue - baselineValue).toFixed(6));
  return {
    metric,
    baseline: baselineValue,
    scenario: scenarioValue,
    delta,
    direction: delta > 0 ? "increase" : delta < 0 ? "decrease" : "flat",
    ...(metricUnits[metric] ? { unit: metricUnits[metric] } : {}),
  };
}

function recommendScenario(
  scenarios: BusinessSimulatorScenarioResult[],
  metricDeltasByScenario: Record<string, BusinessSimulatorMetricDelta[]>,
): BusinessSimulatorRecommendation | undefined {
  const scored = scenarios
    .map((scenario) => {
      const deltas = metricDeltasByScenario[scenario.id] ?? [];
      const score = recommendationScore(deltas);
      return { scenario, deltas, score };
    })
    .sort((left, right) => right.score - left.score || left.scenario.name.localeCompare(right.scenario.name));
  const best = scored[0];
  if (!best) return undefined;

  return {
    scenarioId: best.scenario.id,
    scenarioName: best.scenario.name,
    score: best.score,
    summary: `${best.scenario.name} has the strongest blended score across margin, productivity, operating cost, and risk.`,
    reasons: recommendationReasons(best.deltas),
    tradeoffs: recommendationTradeoffs(best.deltas),
  };
}

function recommendationScore(deltas: BusinessSimulatorMetricDelta[]): number {
  const byMetric = new Map(deltas.map((delta) => [delta.metric, delta.delta]));
  const score =
    normalized(byMetric.get("marginDelta") ?? 0, 1000) * 45 +
    normalized(byMetric.get("productivity") ?? 0, 1) * 25 +
    normalized(-(byMetric.get("operatingCost") ?? 0), 250) * 20 +
    normalized(-(byMetric.get("riskScore") ?? 0), 1) * 10;
  return Number(score.toFixed(4));
}

function recommendationReasons(deltas: BusinessSimulatorMetricDelta[]): string[] {
  return deltas
    .filter((delta) =>
      (delta.metric === "marginDelta" && delta.delta > 0) ||
      (delta.metric === "productivity" && delta.delta > 0) ||
      (delta.metric === "operatingCost" && delta.delta < 0) ||
      (delta.metric === "riskScore" && delta.delta < 0),
    )
    .map((delta) => `${formatMetricName(delta.metric)} ${delta.direction === "decrease" ? "improves by lowering" : "improves by increasing"} ${formatDelta(delta)}`)
    .slice(0, 4);
}

function recommendationTradeoffs(deltas: BusinessSimulatorMetricDelta[]): string[] {
  const tradeoffs = deltas
    .filter((delta) =>
      (delta.metric === "marginDelta" && delta.delta < 0) ||
      (delta.metric === "productivity" && delta.delta < 0) ||
      (delta.metric === "operatingCost" && delta.delta > 0) ||
      (delta.metric === "riskScore" && delta.delta > 0),
    )
    .map((delta) => `${formatMetricName(delta.metric)} moves unfavorably by ${formatDelta(delta)}`)
    .slice(0, 4);
  return tradeoffs.length > 0 ? tradeoffs : ["No major negative tradeoff appears in the primary decision metrics."];
}

function findScenarioRun(run: SimulationRunResult, name: string): SimulationScenarioRunResult {
  const scenario = run.scenarios?.find((candidate) => candidate.name === name);
  if (!scenario) throw new Error(`scenario '${name}' was not produced by the Reux simulation`);
  return scenario;
}

function scenarioNamesFor(scenarios: BusinessSimulatorScenarioInput[]): string[] {
  const used = new Set<string>();
  return scenarios.map((scenario, index) => {
    const base = toIdentifier(scenario.id || scenario.name || `scenario_${index + 1}`);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  });
}

function mergeAssumptions(
  baseline: BusinessSimulatorAssumptions,
  overrides: Partial<BusinessSimulatorAssumptions>,
): BusinessSimulatorAssumptions {
  return normalizeAssumptions({ ...baseline, ...overrides });
}

function toIdentifier(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!normalized) return "scenario";
  return /^[A-Za-z_]/.test(normalized) ? normalized : `scenario_${normalized}`;
}

function toPercentQuantity(value: number): number {
  return Number((value * 100).toFixed(6));
}

function positiveNumber(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative finite number`);
  return value;
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function rate(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1`);
  return value;
}

function normalized(value: number, scale: number): number {
  return value / scale;
}

function formatMetricName(metric: BusinessSimulatorMetricName): string {
  return metric.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
}

function formatDelta(delta: BusinessSimulatorMetricDelta): string {
  const absolute = Math.abs(Number(delta.delta.toFixed(6)));
  return delta.unit ? `${absolute} ${delta.unit}` : String(absolute);
}

function pluralizeForecastUnit(unit: BusinessSimulatorAssumptions["forecastUnit"], count: number): string {
  return count === 1 ? unit : `${unit}s`;
}
