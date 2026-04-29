import { Program, SimulationDeclaration } from "./ast.js";
import { DlAggregateError } from "./errors.js";

export interface SimulationIr {
  name: string;
  assumptions: SimulationAssumptionIr[];
  formulas: SimulationFormulaIr[];
  scenarios: SimulationScenarioIr[];
  changes: SimulationChangeIr[];
  forecast: {
    periods: number;
    unit: SimulationDeclaration["forecast"]["unit"];
  };
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
  forecast: SimulationIr["forecast"];
  periods: SimulationPeriodResult[];
  scenarios?: SimulationScenarioRunResult[];
  comparison?: SimulationComparisonResult;
}

export interface SimulationPeriodResult {
  period: number;
  label: string;
  assumptions: Record<string, boolean | number | string>;
  assumptionUnits: Record<string, string>;
  appliedChanges: Array<{ period: number; unit: SimulationDeclaration["forecast"]["unit"] }>;
  metrics: Record<string, number>;
  metricUnits: Record<string, string>;
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
  direction: "descending_delta";
  scenarios: Array<{
    name: string;
    delta: number;
    rank: number;
  }>;
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
    forecast: simulation.forecast,
    periods,
    ...(scenarios ? { scenarios, comparison: compareScenarios(scenarios) } : {}),
  };
}

function buildSimulationIr(simulation: SimulationDeclaration, diagnostics: string[]): SimulationIr {
  for (const duplicate of duplicates(simulation.assumptions.map((assumption) => assumption.name))) {
    diagnostics.push(`simulation ${simulation.name} declares duplicate assumption ${duplicate}`);
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
  const scenarios = buildScenarioIr(simulation, assumptions, diagnostics);
  const changes = buildChangeIr(simulation, assumptions, diagnostics, {
    duplicateSource: `simulation ${simulation.name}`,
    valueSource: (change) => `${simulation.name} change at ${change.period} ${change.unit}s`,
    validationSource: (change) => `change at ${change.period} ${change.unit}s`,
  });

  return {
    name: simulation.name,
    assumptions,
    formulas,
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
    formulas.push({
      name: formula.name,
      expression: formula.expression,
      references,
    });
    known.add(formula.name);
  }

  return formulas;
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
      appliedChanges: periodState.appliedChanges,
      metrics: periodMetrics,
      metricUnits,
    });
  }
  return periods;
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
    appliedChanges: applicable.map((change) => ({ period: change.period, unit: change.unit })),
  };
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

function compareScenarios(scenarios: SimulationScenarioRunResult[]): SimulationComparisonResult {
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

  return {
    baseline: baseline.name,
    finalPeriod: baseline.periods.at(-1)?.period ?? 0,
    scenarios: scenarioComparisons,
    metricRankings: rankScenarioMetrics(scenarioComparisons),
  };
}

function rankScenarioMetrics(
  scenarios: SimulationComparisonResult["scenarios"],
): SimulationMetricRanking[] {
  const metrics = [...new Set(scenarios.flatMap((scenario) => Object.keys(scenario.metricDeltas)))].sort();
  return metrics.map((metric) => {
    const ranked = scenarios
      .map((scenario) => ({
        name: scenario.name,
        delta: scenario.metricDeltas[metric] ?? 0,
      }))
      .sort((left, right) => right.delta - left.delta || left.name.localeCompare(right.name));

    return {
      metric,
      unit: scenarios.find((scenario) => scenario.metricUnits[metric])?.metricUnits[metric],
      direction: "descending_delta" as const,
      scenarios: ranked.map((scenario, index) => ({
        ...scenario,
        rank: index + 1,
      })),
    };
  });
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
    const unit = inferExpressionUnit(formula.expression, units);
    if (unit) units.set(formula.name, unit);
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

function inferExpressionUnit(expression: string, units: Map<string, string>): string | undefined {
  const tokens = tokenizeExpression(expression);
  let index = 0;

  function parseExpression(): string | undefined {
    let unit = parseTerm();
    while (tokens[index] === "+" || tokens[index] === "-") {
      index += 1;
      const right = parseTerm();
      unit = unit && right === unit ? unit : undefined;
    }
    return unit;
  }

  function parseTerm(): string | undefined {
    let unit = parseFactor();
    while (tokens[index] === "*" || tokens[index] === "/") {
      const operator = tokens[index++];
      const right = parseFactor();
      unit = operator === "*"
        ? unit && right ? undefined : unit ?? right
        : unit && !right ? unit : undefined;
    }
    return unit;
  }

  function parseFactor(): string | undefined {
    const token = tokens[index++];
    if (!token) return undefined;
    if (token === "(") {
      const unit = parseExpression();
      index += tokens[index] === ")" ? 1 : 0;
      return unit;
    }
    if (token === "-") return parseFactor();
    if (/^-?\d+(?:\.\d+)?$/.test(token)) return undefined;
    return units.get(token);
  }

  return parseExpression();
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
