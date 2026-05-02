import { Program, SimulationDeclaration } from "./ast.js";
import { DlAggregateError } from "./errors.js";

export interface SimulationIr {
  name: string;
  dimensions: SimulationDimensionIr[];
  assumptions: SimulationAssumptionIr[];
  formulas: SimulationFormulaIr[];
  objectives: SimulationObjectiveIr[];
  scenarios: SimulationScenarioIr[];
  changes: SimulationChangeIr[];
  forecast: {
    periods: number;
    unit: SimulationDeclaration["forecast"]["unit"];
  };
}

export interface SimulationDimensionIr {
  name: string;
  value: string;
}

export interface SimulationAssumptionIr {
  name: string;
  type: "boolean" | "number" | "string";
  value: boolean | number | string;
  unit?: string;
}

export interface SimulationFormulaIr {
  name: string;
  expression: string;
  references: string[];
  unit?: string;
}

export interface SimulationObjectiveIr {
  metric: string;
  direction: "maximize" | "minimize";
}

export interface SimulationScenarioIr {
  name: string;
  overrides: SimulationAssumptionIr[];
  changes: SimulationChangeIr[];
}

export interface SimulationChangeIr {
  period: number;
  unit: SimulationDeclaration["forecast"]["unit"];
  overrides: SimulationAssumptionIr[];
}

export interface SimulationRunResult {
  name: string;
  model: "prototype-formula-forecast";
  dimensions: Record<string, string>;
  forecast: SimulationIr["forecast"];
  objectives: SimulationObjectiveIr[];
  periods: SimulationPeriodResult[];
  scenarios?: SimulationScenarioRunResult[];
  comparison?: SimulationComparisonResult;
}

export interface SimulationPeriodResult {
  period: number;
  label: string;
  assumptions: Record<string, boolean | number | string>;
  assumptionUnits: Record<string, string>;
  assumptionDeltas: Record<string, SimulationAssumptionDelta>;
  appliedChanges: Array<{ period: number; unit: SimulationDeclaration["forecast"]["unit"] }>;
  metrics: Record<string, number>;
  metricUnits: Record<string, string>;
}

export interface SimulationAssumptionDelta {
  name: string;
  baseline: boolean | number | string;
  previous: boolean | number | string;
  current: boolean | number | string;
  changedFromPrevious: boolean;
  changedFromBaseline: boolean;
  deltaFromPrevious?: number;
  deltaFromBaseline?: number;
  unit?: string;
}

export interface SimulationScenarioRunResult {
  name: string;
  periods: SimulationPeriodResult[];
}

export interface SimulationComparisonResult {
  baseline: string;
  finalPeriod: number;
  scenarios: Array<{
    name: string;
    metricDeltas: Record<string, number>;
    metricUnits: Record<string, string>;
    firstDivergence?: SimulationPeriodDelta;
    periodDeltas: SimulationPeriodDelta[];
  }>;
  metricRankings: SimulationMetricRanking[];
  explanations: SimulationExplanation[];
}

export interface SimulationPeriodDelta {
  period: number;
  label: string;
  metricDeltas: Record<string, number>;
  metricUnits: Record<string, string>;
}

export interface SimulationMetricRanking {
  metric: string;
  unit?: string;
  objective?: "maximize" | "minimize";
  direction: "descending_delta" | "ascending_delta";
  scenarios: Array<{
    name: string;
    delta: number;
    rank: number;
  }>;
}

export interface SimulationExplanation {
  metric: string;
  unit?: string;
  objective?: "maximize" | "minimize";
  preferredScenario?: string;
  preferredDelta?: number;
  firstDivergence?: {
    scenario: string;
    period: number;
    label: string;
  };
  summary: string;
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
  const assumptionUnits = Object.fromEntries(simulation.assumptions.filter((assumption) => assumption.unit).map((assumption) => [assumption.name, assumption.unit as string]));
  const periods = runScenarioPeriods(simulation, assumptions, assumptionUnits);
  const scenarios = simulation.scenarios.length > 0
    ? [
        { name: "baseline", periods },
        ...simulation.scenarios.map((scenario) => ({
          name: scenario.name,
          periods: runScenarioPeriods(
            simulation,
            mergeAssumptions(assumptions, scenario.overrides),
            mergeAssumptionUnits(assumptionUnits, scenario.overrides),
            scenario.changes,
          ),
        })),
      ]
    : undefined;

  return {
    name: simulation.name,
    model: "prototype-formula-forecast",
    dimensions: Object.fromEntries(simulation.dimensions.map((dimension) => [dimension.name, dimension.value])),
    forecast: simulation.forecast,
    objectives: simulation.objectives,
    periods,
    ...(scenarios ? { scenarios, comparison: compareScenarios(scenarios, simulation.objectives) } : {}),
  };
}

function buildSimulationIr(simulation: SimulationDeclaration, diagnostics: string[]): SimulationIr {
  for (const duplicate of duplicates(simulation.assumptions.map((assumption) => assumption.name))) {
    diagnostics.push(`simulation ${simulation.name} declares duplicate assumption ${duplicate}`);
  }
  for (const duplicate of duplicates(simulation.dimensions.map((dimension) => dimension.name))) {
    diagnostics.push(`simulation ${simulation.name} declares duplicate dimension ${duplicate}`);
  }
  const dimensionNames = new Set(simulation.dimensions.map((dimension) => dimension.name));
  for (const assumption of simulation.assumptions) {
    if (dimensionNames.has(assumption.name)) {
      diagnostics.push(`simulation ${simulation.name} assumption ${assumption.name} conflicts with a dimension`);
    }
  }
  for (const duplicate of duplicates(simulation.formulas.map((formula) => formula.name))) {
    diagnostics.push(`simulation ${simulation.name} declares duplicate formula ${duplicate}`);
  }
  for (const duplicate of duplicates(simulation.scenarios.map((scenario) => scenario.name))) {
    diagnostics.push(`simulation ${simulation.name} declares duplicate scenario ${duplicate}`);
  }
  const assumptionNames = new Set(simulation.assumptions.map((assumption) => assumption.name));
  for (const formula of simulation.formulas) {
    if (assumptionNames.has(formula.name)) {
      diagnostics.push(`simulation ${simulation.name} formula ${formula.name} conflicts with an assumption`);
    }
  }

  const assumptions = simulation.assumptions.map((assumption) => ({
    name: assumption.name,
    ...parseSimulationValue(simulation.name, assumption, diagnostics),
  }));
  const formulas = buildFormulaIr(simulation, assumptions, diagnostics);
  const objectives = buildObjectiveIr(simulation, formulas, diagnostics);
  const scenarios = buildScenarioIr(simulation, assumptions, diagnostics);
  const changes = buildChangeIr(simulation, assumptions, diagnostics, {
    duplicateSource: `simulation ${simulation.name}`,
    valueSource: (change) => `${simulation.name} change at ${change.period} ${change.unit}s`,
    validationSource: (change) => `change at ${change.period} ${change.unit}s`,
  });

  return {
    name: simulation.name,
    dimensions: simulation.dimensions.map((dimension) => ({ name: dimension.name, value: dimension.value })),
    assumptions,
    formulas,
    objectives,
    scenarios,
    changes,
    forecast: simulation.forecast,
  };
}

function parseSimulationValue(
  simulationName: string,
  assumption: SimulationDeclaration["assumptions"][number],
  diagnostics: string[],
): Pick<SimulationAssumptionIr, "type" | "value" | "unit"> {
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
  const unitValue = value.match(/^(-?\d+(?:\.\d+)?)\s+([A-Za-z][A-Za-z0-9_%/$]*)$/);
  if (unitValue) {
    const unit = normalizeUnit(unitValue[2]);
    return { type: "number", value: unit === "percent" ? Number(unitValue[1]) / 100 : Number(unitValue[1]), unit };
  }
  diagnostics.push(`simulation ${simulationName} assumption ${assumption.name} must be a number, unit quantity, boolean, or quoted string`);
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

function buildFormulaIr(
  simulation: SimulationDeclaration,
  assumptions: SimulationAssumptionIr[],
  diagnostics: string[],
): SimulationFormulaIr[] {
  const known = new Set(assumptions.map((assumption) => assumption.name));
  const formulaUnits = new Map(assumptions.filter((assumption) => assumption.unit).map((assumption) => [assumption.name, assumption.unit as string]));
  const formulas: SimulationFormulaIr[] = [];

  for (const formula of simulation.formulas) {
    const references = expressionReferences(formula.expression);
    const unknown = references.filter((reference) => !known.has(reference));
    for (const reference of unknown) {
      diagnostics.push(`simulation ${simulation.name} formula ${formula.name} references unknown value ${reference}`);
    }
    for (const reference of references) {
      const assumption = assumptions.find((candidate) => candidate.name === reference);
      if (assumption && assumption.type !== "number") {
        diagnostics.push(`simulation ${simulation.name} formula ${formula.name} references non-numeric value ${reference}`);
      }
    }
    const unitResult = analyzeFormulaUnits(formula.expression, formulaUnits);
    for (const diagnostic of unitResult.diagnostics) {
      diagnostics.push(`simulation ${simulation.name} formula ${formula.name} ${diagnostic}`);
    }
    formulas.push({
      name: formula.name,
      expression: formula.expression,
      references,
      unit: unitResult.unit,
    });
    known.add(formula.name);
    if (unitResult.unit) formulaUnits.set(formula.name, unitResult.unit);
  }

  return formulas;
}

function buildObjectiveIr(
  simulation: SimulationDeclaration,
  formulas: SimulationFormulaIr[],
  diagnostics: string[],
): SimulationObjectiveIr[] {
  for (const duplicate of duplicates(simulation.objectives.map((objective) => objective.metric))) {
    diagnostics.push(`simulation ${simulation.name} declares duplicate objective for ${duplicate}`);
  }
  const knownMetrics = new Set([...formulas.map((formula) => formula.name), ...derivedMetricNames]);
  return simulation.objectives.map((objective) => {
    if (!knownMetrics.has(objective.metric)) {
      diagnostics.push(`simulation ${simulation.name} objective references unknown metric ${objective.metric}`);
    }
    return {
      metric: objective.metric,
      direction: objective.direction,
    };
  });
}

function buildScenarioIr(
  simulation: SimulationDeclaration,
  assumptions: SimulationAssumptionIr[],
  diagnostics: string[],
): SimulationScenarioIr[] {
  const assumptionsByName = new Map(assumptions.map((assumption) => [assumption.name, assumption]));
  return simulation.scenarios.map((scenario) => {
    for (const duplicate of duplicates(scenario.overrides.map((override) => override.name))) {
      diagnostics.push(`simulation ${simulation.name} scenario ${scenario.name} declares duplicate override ${duplicate}`);
    }
    const overrides = scenario.overrides.map((override) => {
      const parsed: SimulationAssumptionIr = {
        name: override.name,
        ...parseSimulationValue(`${simulation.name} scenario ${scenario.name}`, override, diagnostics),
      };
      validateOverride(simulation.name, `scenario ${scenario.name}`, parsed, assumptionsByName, diagnostics);
      return parsed;
    });
    const changes = buildChangeIr(simulation, assumptions, diagnostics, {
      changes: scenario.changes,
      duplicateSource: `simulation ${simulation.name} scenario ${scenario.name}`,
      valueSource: (change) => `${simulation.name} scenario ${scenario.name} change at ${change.period} ${change.unit}s`,
      validationSource: (change) => `scenario ${scenario.name} change at ${change.period} ${change.unit}s`,
    });
    return {
      name: scenario.name,
      overrides,
      changes,
    };
  });
}

function buildChangeIr(
  simulation: SimulationDeclaration,
  assumptions: SimulationAssumptionIr[],
  diagnostics: string[],
  options: {
    changes?: SimulationDeclaration["changes"];
    duplicateSource: string;
    valueSource: (change: SimulationDeclaration["changes"][number]) => string;
    validationSource: (change: SimulationDeclaration["changes"][number]) => string;
  },
): SimulationChangeIr[] {
  const assumptionsByName = new Map(assumptions.map((assumption) => [assumption.name, assumption]));
  const changes = options.changes ?? simulation.changes;
  const changeKeys = changes.map((change) => `${change.period}.${change.unit}`);
  for (const duplicate of duplicates(changeKeys)) {
    diagnostics.push(`${options.duplicateSource} declares duplicate change at ${duplicate}`);
  }

  return changes.map((change) => {
    if (change.unit !== simulation.forecast.unit) {
      diagnostics.push(`${options.duplicateSource} change at ${change.period} ${change.unit}s does not match forecast unit ${simulation.forecast.unit}`);
    }
    if (change.period > simulation.forecast.periods) {
      diagnostics.push(`${options.duplicateSource} change at ${change.period} ${change.unit}s is after the forecast ends`);
    }
    for (const duplicate of duplicates(change.overrides.map((override) => override.name))) {
      diagnostics.push(`${options.duplicateSource} change at ${change.period} ${change.unit}s declares duplicate override ${duplicate}`);
    }
    return {
      period: change.period,
      unit: change.unit,
      overrides: change.overrides.map((override) => {
        const parsed: SimulationAssumptionIr = {
          name: override.name,
          ...parseSimulationValue(options.valueSource(change), override, diagnostics),
        };
        validateOverride(simulation.name, options.validationSource(change), parsed, assumptionsByName, diagnostics);
        return parsed;
      }),
    };
  });
}

function validateOverride(
  simulationName: string,
  source: string,
  override: SimulationAssumptionIr,
  assumptionsByName: Map<string, SimulationAssumptionIr>,
  diagnostics: string[],
): void {
  const base = assumptionsByName.get(override.name);
  if (!base) {
    diagnostics.push(`simulation ${simulationName} ${source} overrides unknown assumption ${override.name}`);
  } else if (base.type !== override.type) {
    diagnostics.push(`simulation ${simulationName} ${source} override ${override.name} changes type from ${base.type} to ${override.type}`);
  } else if (base.unit !== override.unit) {
    diagnostics.push(
      `simulation ${simulationName} ${source} override ${override.name} changes unit from ${base.unit ?? "unitless"} to ${override.unit ?? "unitless"}`,
    );
  }
}

function runScenarioPeriods(
  simulation: SimulationIr,
  assumptions: Record<string, boolean | number | string>,
  assumptionUnits: Record<string, string>,
  scenarioChanges: SimulationChangeIr[] = [],
): SimulationPeriodResult[] {
  const periods: SimulationPeriodResult[] = [];
  const changes = [...simulation.changes, ...scenarioChanges];
  const baselineAssumptions = { ...assumptions };
  let previousAssumptions = { ...assumptions };

  for (let period = 1; period <= simulation.forecast.periods; period += 1) {
    const periodState = applyChangesForPeriod(changes, assumptions, assumptionUnits, period);
    const formulaResult = evaluateFormulas(simulation, periodState.assumptions, periodState.assumptionUnits);
    const assumptionList = Object.entries(periodState.assumptions).map(([name, value]) => ({
      name,
      type: typeof value === "number" ? "number" as const : typeof value === "boolean" ? "boolean" as const : "string" as const,
      value,
      unit: periodState.assumptionUnits[name],
    }));
    const metrics = simulation.formulas.length > 0 ? {} : derivedMetrics(assumptionList);
    const periodMetrics: Record<string, number> = { ...formulaResult.values };
    const metricUnits: Record<string, string> = { ...formulaResult.units };
    if (metrics.netCashFlow !== undefined) {
      periodMetrics.netCashFlow = metrics.netCashFlow;
      periodMetrics.cumulativeNetCashFlow = metrics.netCashFlow * period;
      const cashUnit = assumptionUnits.income;
      if (cashUnit) {
        metricUnits.netCashFlow = cashUnit;
        metricUnits.cumulativeNetCashFlow = cashUnit;
      }
    }
    if (metrics.changeRate !== undefined) {
      periodMetrics.changeRate = metrics.changeRate;
      periodMetrics.projectedIndex = Number((100 * Math.pow(1 + metrics.changeRate, period)).toFixed(4));
      metricUnits.changeRate = "percent";
    }

    periods.push({
      period,
      label: `${period} ${pluralize(simulation.forecast.unit, period)}`,
      assumptions: periodState.assumptions,
      assumptionUnits: periodState.assumptionUnits,
      assumptionDeltas: assumptionDeltas(baselineAssumptions, previousAssumptions, periodState.assumptions, periodState.assumptionUnits),
      appliedChanges: periodState.appliedChanges,
      metrics: periodMetrics,
      metricUnits,
    });
    previousAssumptions = periodState.assumptions;
  }
  return periods;
}

function assumptionDeltas(
  baseline: Record<string, boolean | number | string>,
  previous: Record<string, boolean | number | string>,
  current: Record<string, boolean | number | string>,
  units: Record<string, string>,
): Record<string, SimulationAssumptionDelta> {
  return Object.fromEntries(
    Object.keys({ ...baseline, ...previous, ...current }).sort().flatMap((name): Array<[string, SimulationAssumptionDelta]> => {
      const baseValue = baseline[name];
      const previousValue = previous[name];
      const currentValue = current[name];
      if (baseValue === undefined || previousValue === undefined || currentValue === undefined) return [];
      const numeric = typeof baseValue === "number" && typeof previousValue === "number" && typeof currentValue === "number";
      return [
        [
          name,
          {
            name,
            baseline: baseValue,
            previous: previousValue,
            current: currentValue,
            changedFromPrevious: currentValue !== previousValue,
            changedFromBaseline: currentValue !== baseValue,
            ...(numeric ? { deltaFromPrevious: Number((currentValue - previousValue).toFixed(6)), deltaFromBaseline: Number((currentValue - baseValue).toFixed(6)) } : {}),
            ...(units[name] ? { unit: units[name] } : {}),
          },
        ],
      ];
    }),
  );
}

function applyChangesForPeriod(
  changes: SimulationChangeIr[],
  assumptions: Record<string, boolean | number | string>,
  assumptionUnits: Record<string, string>,
  period: number,
): {
  assumptions: Record<string, boolean | number | string>;
  assumptionUnits: Record<string, string>;
  appliedChanges: Array<{ period: number; unit: SimulationDeclaration["forecast"]["unit"] }>;
} {
  const applicable = [...changes].sort((left, right) => left.period - right.period).filter((change) => change.period <= period);
  return {
    assumptions: applicable.reduce((current, change) => mergeAssumptions(current, change.overrides), assumptions),
    assumptionUnits: applicable.reduce((current, change) => mergeAssumptionUnits(current, change.overrides), assumptionUnits),
    appliedChanges: uniqueAppliedChanges(applicable),
  };
}

function uniqueAppliedChanges(changes: SimulationChangeIr[]): Array<{ period: number; unit: SimulationDeclaration["forecast"]["unit"] }> {
  const seen = new Set<string>();
  return changes
    .map((change) => ({ period: change.period, unit: change.unit }))
    .filter((change) => {
      const key = `${change.period}:${change.unit}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function mergeAssumptions(
  assumptions: Record<string, boolean | number | string>,
  overrides: SimulationAssumptionIr[],
): Record<string, boolean | number | string> {
  return {
    ...assumptions,
    ...Object.fromEntries(overrides.map((override) => [override.name, override.value])),
  };
}

function mergeAssumptionUnits(
  assumptionUnits: Record<string, string>,
  overrides: SimulationAssumptionIr[],
): Record<string, string> {
  return {
    ...assumptionUnits,
    ...Object.fromEntries(overrides.filter((override) => override.unit).map((override) => [override.name, override.unit as string])),
  };
}

function compareScenarios(
  scenarios: SimulationScenarioRunResult[],
  objectives: SimulationObjectiveIr[],
): SimulationComparisonResult {
  const baseline = scenarios[0];
  const baselineFinal = baseline.periods.at(-1)?.metrics ?? {};
  const baselineUnits = baseline.periods.at(-1)?.metricUnits ?? {};
  const scenarioComparisons = scenarios.slice(1).map((scenario) => {
    const finalMetrics = scenario.periods.at(-1)?.metrics ?? {};
    const finalUnits = scenario.periods.at(-1)?.metricUnits ?? {};
    const periodDeltas = scenario.periods.map((period, index) => comparePeriodMetrics(baseline.periods[index], period));
    return {
      name: scenario.name,
      metricDeltas: compareMetricDeltas(baselineFinal, finalMetrics),
      metricUnits: compareMetricUnits(baselineFinal, finalMetrics, baselineUnits, finalUnits),
      firstDivergence: periodDeltas.find((delta) => hasMetricDelta(delta.metricDeltas)),
      periodDeltas,
    };
  });
  const metricRankings = rankScenarioMetrics(scenarioComparisons, objectives);

  return {
    baseline: baseline.name,
    finalPeriod: baseline.periods.at(-1)?.period ?? 0,
    scenarios: scenarioComparisons,
    metricRankings,
    explanations: explainScenarioMetrics(scenarioComparisons, metricRankings),
  };
}

function rankScenarioMetrics(
  scenarios: SimulationComparisonResult["scenarios"],
  objectives: SimulationObjectiveIr[],
): SimulationMetricRanking[] {
  const metrics = [...new Set(scenarios.flatMap((scenario) => Object.keys(scenario.metricDeltas)))].sort();
  const objectivesByMetric = new Map(objectives.map((objective) => [objective.metric, objective.direction]));
  return metrics.map((metric) => {
    const objective = objectivesByMetric.get(metric);
    const direction = objective === "minimize" ? "ascending_delta" : "descending_delta";
    const ranked = scenarios
      .map((scenario) => ({
        name: scenario.name,
        delta: scenario.metricDeltas[metric] ?? 0,
      }))
      .sort((left, right) => {
        const deltaOrder = direction === "ascending_delta" ? left.delta - right.delta : right.delta - left.delta;
        return deltaOrder || left.name.localeCompare(right.name);
      });

    return {
      metric,
      unit: scenarios.find((scenario) => scenario.metricUnits[metric])?.metricUnits[metric],
      ...(objective ? { objective } : {}),
      direction,
      scenarios: ranked.map((scenario, index) => ({
        ...scenario,
        rank: index + 1,
      })),
    };
  });
}

function explainScenarioMetrics(
  scenarios: SimulationComparisonResult["scenarios"],
  rankings: SimulationMetricRanking[],
): SimulationExplanation[] {
  return rankings.map((ranking) => {
    const preferred = ranking.scenarios[0];
    const firstDivergence = preferred ? firstDivergenceForMetric(scenarios, preferred.name, ranking.metric) : undefined;
    return {
      metric: ranking.metric,
      unit: ranking.unit,
      objective: ranking.objective,
      preferredScenario: preferred?.name,
      preferredDelta: preferred?.delta,
      firstDivergence,
      summary: explanationSummary(ranking, preferred, firstDivergence),
    };
  });
}

function firstDivergenceForMetric(
  scenarios: SimulationComparisonResult["scenarios"],
  scenarioName: string,
  metric: string,
): SimulationExplanation["firstDivergence"] {
  const scenario = scenarios.find((candidate) => candidate.name === scenarioName);
  const delta = scenario?.periodDeltas.find((periodDelta) => (periodDelta.metricDeltas[metric] ?? 0) !== 0);
  return delta
    ? {
        scenario: scenarioName,
        period: delta.period,
        label: delta.label,
      }
    : undefined;
}

function explanationSummary(
  ranking: SimulationMetricRanking,
  preferred: SimulationMetricRanking["scenarios"][number] | undefined,
  firstDivergence: SimulationExplanation["firstDivergence"],
): string {
  if (!preferred) return `No scenarios were available to compare for ${ranking.metric}.`;
  const objective = ranking.objective ? `${ranking.objective} objective` : "neutral ranking";
  const deltaText = formatMetricDelta(preferred.delta, ranking.unit);
  const divergenceText = firstDivergence ? ` First divergence occurs at ${firstDivergence.label}.` : "";
  return `${preferred.name} ranks first for ${ranking.metric} under the ${objective} with a final delta of ${deltaText}.${divergenceText}`;
}

function formatMetricDelta(delta: number, unit?: string): string {
  const value = Number(delta.toFixed(6));
  return unit ? `${value} ${unit}` : String(value);
}

function comparePeriodMetrics(
  baseline: SimulationPeriodResult | undefined,
  scenario: SimulationPeriodResult,
): SimulationPeriodDelta {
  return {
    period: scenario.period,
    label: scenario.label,
    metricDeltas: compareMetricDeltas(baseline?.metrics ?? {}, scenario.metrics),
    metricUnits: compareMetricUnits(baseline?.metrics ?? {}, scenario.metrics, baseline?.metricUnits ?? {}, scenario.metricUnits),
  };
}

function compareMetricDeltas(
  baselineMetrics: Record<string, number>,
  scenarioMetrics: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    Object.keys({ ...baselineMetrics, ...scenarioMetrics }).map((metric) => [
      metric,
      Number(((scenarioMetrics[metric] ?? 0) - (baselineMetrics[metric] ?? 0)).toFixed(6)),
    ]),
  );
}

function compareMetricUnits(
  baselineMetrics: Record<string, number>,
  scenarioMetrics: Record<string, number>,
  baselineUnits: Record<string, string>,
  scenarioUnits: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.keys({ ...baselineMetrics, ...scenarioMetrics })
      .map((metric) => [metric, scenarioUnits[metric] ?? baselineUnits[metric]])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

function hasMetricDelta(metricDeltas: Record<string, number>): boolean {
  return Object.values(metricDeltas).some((delta) => delta !== 0);
}

function evaluateFormulas(
  simulation: SimulationIr,
  assumptions: Record<string, boolean | number | string>,
  assumptionUnits: Record<string, string>,
): { values: Record<string, number>; units: Record<string, string> } {
  const values = new Map<string, number>();
  const units = new Map<string, string>();
  for (const [name, value] of Object.entries(assumptions)) {
    if (typeof value === "number") values.set(name, value);
  }
  for (const [name, unit] of Object.entries(assumptionUnits)) {
    units.set(name, unit);
  }
  for (const formula of simulation.formulas) {
    values.set(formula.name, evaluateNumericExpression(formula.expression, values));
    if (formula.unit) units.set(formula.name, formula.unit);
  }
  return {
    values: Object.fromEntries(simulation.formulas.map((formula) => [formula.name, values.get(formula.name) ?? 0])),
    units: Object.fromEntries(simulation.formulas.map((formula) => [formula.name, units.get(formula.name)]).filter((entry): entry is [string, string] => Boolean(entry[1]))),
  };
}

function evaluateNumericExpression(expression: string, values: Map<string, number>): number {
  const tokens = tokenizeExpression(expression);
  let index = 0;

  function parseExpression(): number {
    let value = parseTerm();
    while (tokens[index] === "+" || tokens[index] === "-") {
      const operator = tokens[index++];
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseFactor();
    while (tokens[index] === "*" || tokens[index] === "/") {
      const operator = tokens[index++];
      const right = parseFactor();
      if (operator === "/" && right === 0) throw new Error(`formula expression '${expression}' divides by zero`);
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }

  function parseFactor(): number {
    const token = tokens[index++];
    if (!token) throw new Error(`invalid formula expression '${expression}'`);
    if (token === "(") {
      const value = parseExpression();
      if (tokens[index++] !== ")") throw new Error(`invalid formula expression '${expression}'`);
      return value;
    }
    if (token === "-") return -parseFactor();
    if (/^-?\d+(?:\.\d+)?$/.test(token)) return Number(token);
    const value = values.get(token);
    if (value === undefined) throw new Error(`formula expression '${expression}' references unavailable value ${token}`);
    return value;
  }

  const value = parseExpression();
  if (index !== tokens.length) throw new Error(`invalid formula expression '${expression}'`);
  if (!Number.isFinite(value)) throw new Error(`formula expression '${expression}' produced a non-finite value`);
  return Number(value.toFixed(6));
}

function tokenizeExpression(expression: string): string[] {
  const tokens: string[] = [];
  const pattern = /\s*([A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[()+\-*/])\s*/gy;
  let index = 0;
  while (index < expression.length) {
    pattern.lastIndex = index;
    const match = pattern.exec(expression);
    if (!match) throw new Error(`invalid formula expression '${expression}'`);
    tokens.push(match[1]);
    index = pattern.lastIndex;
  }
  return tokens;
}

interface FormulaUnitResult {
  unit?: string;
  diagnostics: string[];
}

function analyzeFormulaUnits(expression: string, units: Map<string, string>): FormulaUnitResult {
  const tokens = tokenizeExpression(expression);
  let index = 0;
  const diagnostics: string[] = [];

  type UnitTerm = { unit?: string; source: string };

  function parseExpression(): UnitTerm {
    let left = parseTerm();
    while (tokens[index] === "+" || tokens[index] === "-") {
      const operator = tokens[index++];
      const right = parseTerm();
      left = combineAdditiveUnits(left, right, operator);
    }
    return left;
  }

  function parseTerm(): UnitTerm {
    let left = parseFactor();
    while (tokens[index] === "*" || tokens[index] === "/") {
      const operator = tokens[index++];
      const right = parseFactor();
      left = operator === "*" ? combineMultiplicativeUnits(left, right) : combineDivisiveUnits(left, right);
    }
    return left;
  }

  function parseFactor(): UnitTerm {
    const token = tokens[index++];
    if (!token) return { source: "missing value" };
    if (token === "(") {
      const term = parseExpression();
      index += tokens[index] === ")" ? 1 : 0;
      return term;
    }
    if (token === "-") return parseFactor();
    if (/^-?\d+(?:\.\d+)?$/.test(token)) return { source: token };
    return { unit: units.get(token), source: token };
  }

  function combineAdditiveUnits(left: UnitTerm, right: UnitTerm, operator: string): UnitTerm {
    if (left.unit === right.unit) return { unit: left.unit, source: `${left.source} ${operator} ${right.source}` };
    if (isPercentUnit(left.unit) && !right.unit) return { source: `${left.source} ${operator} ${right.source}` };
    if (!left.unit && isPercentUnit(right.unit)) return { source: `${left.source} ${operator} ${right.source}` };
    diagnostics.push(`cannot ${operator === "+" ? "add" : "subtract"} ${describeUnit(left.unit)} and ${describeUnit(right.unit)}`);
    return { source: `${left.source} ${operator} ${right.source}` };
  }

  function combineMultiplicativeUnits(left: UnitTerm, right: UnitTerm): UnitTerm {
    if (left.unit && right.unit && !isPercentUnit(left.unit) && !isPercentUnit(right.unit)) {
      diagnostics.push(`cannot multiply ${describeUnit(left.unit)} by ${describeUnit(right.unit)} until compound units are supported`);
      return { source: `${left.source} * ${right.source}` };
    }
    return { unit: nonPercentUnit(left.unit) ?? nonPercentUnit(right.unit) ?? percentResultUnit(left.unit, right.unit), source: `${left.source} * ${right.source}` };
  }

  function combineDivisiveUnits(left: UnitTerm, right: UnitTerm): UnitTerm {
    if (left.unit && right.unit) {
      if (left.unit === right.unit) return { source: `${left.source} / ${right.source}` };
      if (isPercentUnit(right.unit)) return { unit: left.unit, source: `${left.source} / ${right.source}` };
      if (isPercentUnit(left.unit) && !isPercentUnit(right.unit)) {
        diagnostics.push(`cannot divide ${describeUnit(left.unit)} by ${describeUnit(right.unit)} until compound units are supported`);
        return { source: `${left.source} / ${right.source}` };
      }
      diagnostics.push(`cannot divide ${describeUnit(left.unit)} by ${describeUnit(right.unit)} until compound units are supported`);
      return { source: `${left.source} / ${right.source}` };
    }
    return { unit: left.unit, source: `${left.source} / ${right.source}` };
  }

  const result = parseExpression();
  return {
    unit: result.unit,
    diagnostics,
  };
}

function describeUnit(unit: string | undefined): string {
  return unit ? `unit ${unit}` : "a unitless value";
}

function isPercentUnit(unit: string | undefined): boolean {
  return unit === "percent";
}

function nonPercentUnit(unit: string | undefined): string | undefined {
  return unit && !isPercentUnit(unit) ? unit : undefined;
}

function percentResultUnit(left: string | undefined, right: string | undefined): string | undefined {
  return isPercentUnit(left) || isPercentUnit(right) ? "percent" : undefined;
}

function expressionReferences(expression: string): string[] {
  const references = new Set<string>();
  for (const match of expression.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) {
    references.add(match[0]);
  }
  return [...references].sort();
}

function normalizeUnit(unit: string): string {
  const lowered = unit.toLowerCase();
  if (lowered === "%" || lowered === "percent" || lowered === "percentage") return "percent";
  if (lowered === "count" || lowered === "counts") return "count";
  return unit.toUpperCase() === unit ? unit : lowered;
}

const derivedMetricNames = ["netCashFlow", "cumulativeNetCashFlow", "changeRate", "projectedIndex"];

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
