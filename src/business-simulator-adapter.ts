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
  BusinessSimulatorRecommendationConfidence,
  BusinessSimulatorRunRequest,
  BusinessSimulatorRunResponse,
  BusinessSimulatorScenarioInput,
  BusinessSimulatorScenarioResult,
  BusinessSimulatorSummary,
  GetBusinessSimulationResponse,
  ListBusinessSimulationsResponse,
} from "./business-simulator-contract.js";
import { assertBusinessSimulatorCompareRequest, assertBusinessSimulatorRunRequest } from "./business-simulator-validation.js";

interface BusinessSimulatorTemplate {
  summary: BusinessSimulatorSummary;
  defaultAssumptions: BusinessSimulatorAssumptions;
  exampleScenarios: BusinessSimulatorScenarioInput[];
}

const businessSimulatorTemplates: BusinessSimulatorTemplate[] = [
  {
    summary: {
      id: "operations-decision",
      name: "Operations Decision Simulator",
      description: "Compare cost, margin, productivity, workforce load, and risk scenarios before an operational change.",
      domain: "operations",
      status: "ready",
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
    defaultAssumptions: businessSimulatorDefaultAssumptions,
    exampleScenarios: [
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
    ],
  },
  {
    summary: {
      id: "capacity-planning",
      name: "Capacity Planning Simulator",
      description: "Compare staffing, demand, productivity, and quality tradeoffs before scaling an operation.",
      domain: "operations",
      status: "ready",
      updatedAt: "2026-05-02T00:00:00.000Z",
    },
    defaultAssumptions: {
      ...businessSimulatorDefaultAssumptions,
      employees: 42,
      averageHourlyCost: 36,
      weeklyDemand: 980,
      averageOrderValue: 110,
      grossMarginRate: 0.48,
      productivityGainRate: 0.05,
      overtimeReductionRate: 0.06,
      supplierDelayRiskRate: 0.1,
      defectRate: 0.018,
      forecastPeriods: 16,
      forecastUnit: "week",
    },
    exampleScenarios: [
      {
        id: "add-shift",
        name: "Add Shift",
        description: "Add capacity with more staff while reducing overtime pressure.",
        assumptions: {
          employees: 50,
          weeklyDemand: 1120,
          overtimeReductionRate: 0.16,
        },
      },
      {
        id: "automation-assist",
        name: "Automation Assist",
        description: "Improve productivity without adding headcount.",
        assumptions: {
          productivityGainRate: 0.14,
          overtimeReductionRate: 0.12,
        },
      },
      {
        id: "quality-investment",
        name: "Quality Investment",
        description: "Reduce defects while protecting margin.",
        assumptions: {
          defectRate: 0.01,
          supplierDelayRiskRate: 0.08,
          averageHourlyCost: 38,
        },
      },
      {
        id: "demand-spike",
        name: "Demand Spike",
        description: "Model demand growth with added supplier-delay exposure.",
        assumptions: {
          weeklyDemand: 1250,
          supplierDelayRiskRate: 0.16,
        },
      },
    ],
  },
  {
    summary: {
      id: "staffing-plan",
      name: "Staffing Plan Simulator",
      description: "Compare hiring, overtime, automation, and demand-coverage choices before changing the workforce plan.",
      domain: "workforce",
      status: "ready",
      updatedAt: "2026-05-03T00:00:00.000Z",
    },
    defaultAssumptions: {
      ...businessSimulatorDefaultAssumptions,
      employees: 34,
      averageHourlyCost: 41,
      weeklyDemand: 760,
      averageOrderValue: 135,
      grossMarginRate: 0.46,
      productivityGainRate: 0.04,
      overtimeReductionRate: 0.05,
      supplierDelayRiskRate: 0.08,
      defectRate: 0.016,
      forecastPeriods: 12,
      forecastUnit: "week",
    },
    exampleScenarios: [
      {
        id: "hire-team",
        name: "Hire Team",
        description: "Add staff to cover demand while reducing overtime pressure.",
        assumptions: {
          employees: 40,
          overtimeReductionRate: 0.18,
          weeklyDemand: 820,
        },
      },
      {
        id: "cross-train",
        name: "Cross Train",
        description: "Improve productivity with the existing team before adding headcount.",
        assumptions: {
          productivityGainRate: 0.13,
          overtimeReductionRate: 0.11,
        },
      },
      {
        id: "automation-buffer",
        name: "Automation Buffer",
        description: "Use process automation to handle more demand without the full hiring plan.",
        assumptions: {
          productivityGainRate: 0.18,
          weeklyDemand: 860,
          averageHourlyCost: 43,
        },
      },
      {
        id: "lean-coverage",
        name: "Lean Coverage",
        description: "Hold headcount flat and test the risk of tighter labor coverage.",
        assumptions: {
          weeklyDemand: 840,
          supplierDelayRiskRate: 0.13,
          defectRate: 0.024,
        },
      },
    ],
  },
];

const defaultBusinessSimulatorTemplate = businessSimulatorTemplates[0];

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
  return { simulations: businessSimulatorTemplates.map((template) => template.summary) };
}

export function getBusinessSimulation(id = defaultBusinessSimulatorTemplate.summary.id): GetBusinessSimulationResponse {
  const template = findBusinessSimulatorTemplate(id);
  if (!template) {
    throw new Error(`business simulation '${id}' was not found`);
  }
  return {
    simulation: template.summary,
    defaultAssumptions: template.defaultAssumptions,
    exampleScenarios: template.exampleScenarios,
  };
}

export function runBusinessSimulator(request: BusinessSimulatorRunRequest, now: Date = new Date()): BusinessSimulatorRunResponse {
  assertBusinessSimulatorRunRequest(request);
  const template = findBusinessSimulatorTemplate(request.simulationId ?? defaultBusinessSimulatorTemplate.summary.id) ?? defaultBusinessSimulatorTemplate;
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
      ...template.summary,
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
  const recommendation = recommendScenario(baseline, scenarios, metricDeltasByScenario);

  return {
    baselineScenarioId: baseline.id,
    metricDeltasByScenario,
    ...(recommendation ? { recommendedScenarioId: recommendation.scenarioId, recommendation } : {}),
  };
}

export function buildBusinessSimulatorSource(request: BusinessSimulatorRunRequest): string {
  const normalized = normalizeRunRequest(request);
  const scenarioNames = scenarioNamesFor(normalized.scenarios);
  const simulationName = toIdentifier(normalized.simulationId ?? defaultBusinessSimulatorTemplate.summary.id);

  return [
    "module business_simulator",
    "",
    `simulate ${simulationName} {`,
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
  baseline: BusinessSimulatorScenarioResult,
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
  const runnerUp = scored[1];
  const confidence = recommendationConfidence(best.score, runnerUp?.score, best.deltas);

  return {
    scenarioId: best.scenario.id,
    scenarioName: best.scenario.name,
    score: best.score,
    summary: `${best.scenario.name} has the strongest blended score across margin, productivity, operating cost, and risk.`,
    decisionSummary: decisionSummary(best.scenario, best.deltas, confidence),
    recommendedAction: recommendedAction(best.scenario, best.deltas, confidence, runnerUp?.scenario.name),
    confidence,
    confidenceSummary: confidenceSummary(confidence, best.score, runnerUp),
    whyThisWon: recommendationRationale(best.scenario, best.deltas),
    whatChangedFromBaseline: baselineChangeSummary(baseline.assumptions, best.scenario.assumptions, best.deltas),
    keyMetricDeltas: keyMetricDeltas(best.deltas),
    riskSummary: riskSummary(best.deltas),
    tradeoffSummary: tradeoffSummary(best.deltas),
    reasons: recommendationReasons(best.deltas),
    tradeoffs: recommendationTradeoffs(best.deltas),
    watchouts: recommendationWatchouts(best.deltas),
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

function recommendationWatchouts(deltas: BusinessSimulatorMetricDelta[]): string[] {
  const watchouts = unfavorableDecisionDeltas(deltas)
    .map((delta) => watchoutFor(delta))
    .slice(0, 3);
  return watchouts.length > 0
    ? watchouts
    : [
        "No major metric-level watchout surfaced in margin, productivity, cost, or risk.",
        "Validate that the modeled assumption changes are achievable before committing.",
      ];
}

function recommendationRationale(
  scenario: BusinessSimulatorScenarioResult,
  deltas: BusinessSimulatorMetricDelta[],
): string {
  const positives = recommendationReasons(deltas);
  const tradeoffs = recommendationTradeoffs(deltas);
  const positiveText = positives[0] ?? "it has the best overall balance in the primary decision metrics";
  const tradeoffText = tradeoffs[0] ?? "no major negative tradeoff appears in the primary decision metrics";
  return `${scenario.name} is recommended because ${positiveText}. ${tradeoffText}`;
}

function decisionSummary(
  scenario: BusinessSimulatorScenarioResult,
  deltas: BusinessSimulatorMetricDelta[],
  confidence: BusinessSimulatorRecommendationConfidence,
): string {
  const margin = deltas.find((delta) => delta.metric === "marginDelta");
  const productivity = deltas.find((delta) => delta.metric === "productivity");
  const cost = deltas.find((delta) => delta.metric === "operatingCost");
  const risk = deltas.find((delta) => delta.metric === "riskScore");
  const marginText = margin && margin.delta !== 0
    ? `${margin.delta > 0 ? "adds" : "reduces"} ${formatDelta(margin)} in modeled margin`
    : "keeps modeled margin roughly flat";
  const productivityText = productivity && productivity.delta !== 0
    ? `${productivity.delta > 0 ? "improves" : "reduces"} productivity by ${formatDelta(productivity)}`
    : "keeps productivity roughly flat";
  const costText = cost && cost.delta !== 0
    ? `${cost.delta < 0 ? "lowers" : "raises"} operating cost by ${formatDelta(cost)}`
    : "keeps operating cost roughly flat";
  const riskText = risk && risk.delta !== 0
    ? `${risk.delta < 0 ? "lowers" : "raises"} risk by ${formatDelta(risk)}`
    : "keeps risk roughly flat";
  return `${scenario.name} is the ${confidence}-confidence recommendation because it ${marginText}, ${productivityText}, ${costText}, and ${riskText}.`;
}

function recommendedAction(
  scenario: BusinessSimulatorScenarioResult,
  deltas: BusinessSimulatorMetricDelta[],
  confidence: BusinessSimulatorRecommendationConfidence,
  runnerUpName: string | undefined,
): string {
  const watchouts = recommendationWatchouts(deltas);
  const primaryWatchout = watchouts[0].startsWith("No major metric-level watchout")
    ? "the operating assumptions"
    : watchouts[0].replace(/\.$/, "").toLowerCase();
  if (confidence === "high") {
    return `Use ${scenario.name} as the lead plan and validate ${primaryWatchout} before rollout.`;
  }
  if (confidence === "medium") {
    return `Use ${scenario.name} as the working plan, then compare it against ${runnerUpName ?? "the next-best scenario"} with real operating constraints before committing.`;
  }
  return `Treat ${scenario.name} as a promising option, but run another sensitivity pass before using it as the final plan.`;
}

function recommendationConfidence(
  bestScore: number,
  runnerUpScore: number | undefined,
  deltas: BusinessSimulatorMetricDelta[],
): BusinessSimulatorRecommendationConfidence {
  const scoreGap = runnerUpScore === undefined ? Math.abs(bestScore) : bestScore - runnerUpScore;
  const majorWatchoutCount = unfavorableDecisionDeltas(deltas).length;
  if (scoreGap >= 20 && majorWatchoutCount <= 1) return "high";
  if (scoreGap >= 5 || majorWatchoutCount <= 1) return "medium";
  return "low";
}

function confidenceSummary(
  confidence: BusinessSimulatorRecommendationConfidence,
  bestScore: number,
  runnerUp: { scenario: BusinessSimulatorScenarioResult; score: number } | undefined,
): string {
  if (!runnerUp) {
    return `${capitalize(confidence)} confidence because this is the only scenario with a complete score.`;
  }
  const gap = Number((bestScore - runnerUp.score).toFixed(4));
  return `${capitalize(confidence)} confidence because the recommendation leads ${runnerUp.scenario.name} by ${gap} blended-score points.`;
}

function baselineChangeSummary(
  baseline: BusinessSimulatorAssumptions,
  scenario: BusinessSimulatorAssumptions,
  deltas: BusinessSimulatorMetricDelta[],
): string[] {
  const importantMetrics = keyMetricDeltas(deltas)
    .filter((delta) => delta.direction !== "flat")
    .map((delta) => `${formatMetricName(delta.metric)} ${delta.direction === "decrease" ? "decreased" : "increased"} by ${formatDelta(delta)}`);
  const assumptionSignals = [
    scenario.productivityGainRate !== baseline.productivityGainRate
      ? `productivity gain rate ${changeVerb(scenario.productivityGainRate - baseline.productivityGainRate)} to ${formatRate(scenario.productivityGainRate)}`
      : undefined,
    scenario.overtimeReductionRate !== baseline.overtimeReductionRate
      ? `overtime reduction rate ${changeVerb(scenario.overtimeReductionRate - baseline.overtimeReductionRate)} to ${formatRate(scenario.overtimeReductionRate)}`
      : undefined,
    scenario.supplierDelayRiskRate !== baseline.supplierDelayRiskRate
      ? `supplier delay risk ${changeVerb(scenario.supplierDelayRiskRate - baseline.supplierDelayRiskRate)} to ${formatRate(scenario.supplierDelayRiskRate)}`
      : undefined,
    scenario.defectRate !== baseline.defectRate
      ? `defect rate ${changeVerb(scenario.defectRate - baseline.defectRate)} to ${formatRate(scenario.defectRate)}`
      : undefined,
    scenario.employees !== baseline.employees
      ? `staffing changed to ${scenario.employees} employees`
      : undefined,
    scenario.weeklyDemand !== baseline.weeklyDemand
      ? `weekly demand changed to ${scenario.weeklyDemand}`
      : undefined,
  ].filter((value): value is string => Boolean(value));
  return [...assumptionSignals, ...importantMetrics].slice(0, 6);
}

function keyMetricDeltas(deltas: BusinessSimulatorMetricDelta[]): BusinessSimulatorMetricDelta[] {
  const keyMetrics: BusinessSimulatorMetricName[] = ["marginDelta", "productivity", "operatingCost", "riskScore"];
  return keyMetrics.flatMap((metric) => deltas.find((delta) => delta.metric === metric) ?? []);
}

function riskSummary(deltas: BusinessSimulatorMetricDelta[]): string {
  const risk = deltas.find((delta) => delta.metric === "riskScore");
  if (!risk || risk.delta === 0) return "Risk stays flat against the baseline.";
  return risk.delta < 0
    ? `Risk improves by ${formatDelta(risk)} against the baseline.`
    : `Risk increases by ${formatDelta(risk)} against the baseline.`;
}

function watchoutFor(delta: BusinessSimulatorMetricDelta): string {
  switch (delta.metric) {
    case "operatingCost":
      return `Operating cost rises by ${formatDelta(delta)}; confirm the extra spend is acceptable.`;
    case "riskScore":
      return `Risk rises by ${formatDelta(delta)}; define mitigation before committing.`;
    case "marginDelta":
      return `Modeled margin falls by ${formatDelta(delta)}; check whether the strategic benefit justifies it.`;
    case "productivity":
      return `Productivity falls by ${formatDelta(delta)}; confirm the team can absorb the load.`;
    default:
      return `${formatMetricName(delta.metric)} moves unfavorably by ${formatDelta(delta)}.`;
  }
}

function unfavorableDecisionDeltas(deltas: BusinessSimulatorMetricDelta[]): BusinessSimulatorMetricDelta[] {
  return deltas.filter((delta) =>
    (delta.metric === "operatingCost" && delta.delta > 0) ||
    (delta.metric === "riskScore" && delta.delta > 0) ||
    (delta.metric === "marginDelta" && delta.delta < 0) ||
    (delta.metric === "productivity" && delta.delta < 0),
  );
}

function tradeoffSummary(deltas: BusinessSimulatorMetricDelta[]): string {
  const tradeoffs = recommendationTradeoffs(deltas);
  return tradeoffs[0] ?? "No major negative tradeoff appears in the primary decision metrics.";
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

function formatRate(value: number): string {
  return `${Number((value * 100).toFixed(6))}%`;
}

function changeVerb(delta: number): "increased" | "decreased" {
  return delta > 0 ? "increased" : "decreased";
}

function pluralizeForecastUnit(unit: BusinessSimulatorAssumptions["forecastUnit"], count: number): string {
  return count === 1 ? unit : `${unit}s`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function findBusinessSimulatorTemplate(id: string): BusinessSimulatorTemplate | undefined {
  return businessSimulatorTemplates.find((template) => template.summary.id === id);
}
