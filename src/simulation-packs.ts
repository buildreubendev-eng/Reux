import { SimulationIr } from "./simulation-ir.js";

export interface SimulationDomainPack {
  id: string;
  title: string;
  product: string;
  domain: string;
  audience: string;
  description: string;
  suggestedAssumptions: string[];
  suggestedMetrics: string[];
  suggestedScenarios: SimulationScenarioSuggestion[];
  suggestedObjectives: SimulationObjectiveSuggestion[];
}

export interface SimulationScenarioSuggestion {
  name: string;
  purpose: string;
}

export interface SimulationObjectiveSuggestion {
  metric: string;
  direction: "maximize" | "minimize";
}

export interface SimulationPackReport {
  simulation: string;
  dimensions: Record<string, string>;
  pack?: Pick<SimulationDomainPack, "id" | "title" | "description">;
  coverage: SimulationPackCoverage;
  missingDimensions: string[];
  missingSuggestedAssumptions: string[];
  missingSuggestedMetrics: string[];
  missingSuggestedScenarios: SimulationScenarioSuggestion[];
  missingSuggestedObjectives: SimulationObjectiveSuggestion[];
  notes: string[];
}

export interface SimulationPackCoverage {
  overallPercent: number;
  dimensions: SimulationCoverageSection;
  assumptions: SimulationCoverageSection;
  metrics: SimulationCoverageSection;
  scenarios: SimulationCoverageSection;
  objectives: SimulationCoverageSection;
}

export interface SimulationCoverageSection {
  present: number;
  total: number;
}

export const simulationDomainPacks: SimulationDomainPack[] = [
  {
    id: "plos.finance.personal",
    title: "PLOS personal finance",
    product: "PLOS",
    domain: "finance",
    audience: "personal",
    description: "Personal cash-flow, debt, savings, and goal-planning simulations.",
    suggestedAssumptions: ["income", "rent", "debt_payment", "savings_rate", "emergency_fund"],
    suggestedMetrics: ["net_cash_flow", "projected_savings", "debt_paydown", "goal_gap"],
    suggestedScenarios: [
      { name: "lower_rent", purpose: "Compare housing-cost reduction against the baseline plan." },
      { name: "debt_free", purpose: "Show the cash-flow impact once recurring debt payments end." },
      { name: "income_loss", purpose: "Stress-test the plan against a temporary income drop." },
      { name: "emergency_expense", purpose: "Measure how a surprise expense affects runway and goals." },
    ],
    suggestedObjectives: [
      { metric: "net_cash_flow", direction: "maximize" },
      { metric: "projected_savings", direction: "maximize" },
      { metric: "debt_paydown", direction: "maximize" },
      { metric: "goal_gap", direction: "minimize" },
    ],
  },
  {
    id: "business_simulation.workforce.enterprise",
    title: "Business workforce simulation",
    product: "business_simulation",
    domain: "workforce",
    audience: "enterprise",
    description: "Workforce, productivity, overtime, and staffing-decision simulations.",
    suggestedAssumptions: ["employees", "productivity_gain", "overtime_reduction", "average_hourly_cost"],
    suggestedMetrics: ["productivity_index", "operating_relief", "labor_cost_delta", "capacity_delta"],
    suggestedScenarios: [
      { name: "stronger_training", purpose: "Compare deeper enablement against the baseline productivity plan." },
      { name: "no_overtime_change", purpose: "Separate productivity improvement from overtime reduction." },
      { name: "automation", purpose: "Estimate whether automation reduces labor cost or increases capacity." },
      { name: "hiring_plan", purpose: "Compare new headcount against productivity and overtime alternatives." },
    ],
    suggestedObjectives: [
      { metric: "productivity_index", direction: "maximize" },
      { metric: "operating_relief", direction: "maximize" },
      { metric: "labor_cost_delta", direction: "minimize" },
      { metric: "capacity_delta", direction: "maximize" },
    ],
  },
  {
    id: "business_simulation.operations.enterprise",
    title: "Business operations simulation",
    product: "business_simulation",
    domain: "operations",
    audience: "enterprise",
    description: "Operational throughput, cost, risk, and scenario-comparison simulations.",
    suggestedAssumptions: ["volume", "unit_cost", "cycle_time", "failure_rate"],
    suggestedMetrics: ["throughput", "operating_cost", "risk_score", "margin_delta"],
    suggestedScenarios: [
      { name: "higher_volume", purpose: "Stress-test throughput and cost under increased demand." },
      { name: "supplier_delay", purpose: "Measure operational impact from slower upstream inputs." },
      { name: "quality_issue", purpose: "Estimate risk and margin impact from higher failure rates." },
      { name: "process_improvement", purpose: "Compare cycle-time reduction against the baseline operation." },
    ],
    suggestedObjectives: [
      { metric: "throughput", direction: "maximize" },
      { metric: "operating_cost", direction: "minimize" },
      { metric: "risk_score", direction: "minimize" },
      { metric: "margin_delta", direction: "maximize" },
    ],
  },
];

export function describeSimulationPacks(simulations: SimulationIr[]): SimulationPackReport[] {
  return simulations.map((simulation) => describeSimulationPack(simulation));
}

export function describeSimulationPack(simulation: SimulationIr): SimulationPackReport {
  const dimensions = Object.fromEntries(simulation.dimensions.map((dimension) => [dimension.name, dimension.value]));
  const missingDimensions = ["product", "domain", "audience"].filter((name) => !dimensions[name]);
  const pack = simulationDomainPacks.find(
    (candidate) =>
      candidate.product === dimensions.product &&
      candidate.domain === dimensions.domain &&
      candidate.audience === dimensions.audience,
  );
  const assumptionNames = new Set(simulation.assumptions.map((assumption) => assumption.name));
  const metricNames = new Set(simulation.formulas.map((formula) => formula.name));
  const scenarioNames = new Set(simulation.scenarios.map((scenario) => scenario.name));
  const objectives = new Set(simulation.objectives.map((objective) => objectiveKey(objective)));
  const notes: string[] = [];
  const missingSuggestedAssumptions = pack?.suggestedAssumptions.filter((assumption) => !assumptionNames.has(assumption)) ?? [];
  const missingSuggestedMetrics = pack?.suggestedMetrics.filter((metric) => !metricNames.has(metric)) ?? [];
  const missingSuggestedScenarios = pack?.suggestedScenarios.filter((scenario) => !scenarioNames.has(scenario.name)) ?? [];
  const missingSuggestedObjectives = pack?.suggestedObjectives.filter((objective) => !objectives.has(objectiveKey(objective))) ?? [];

  if (missingDimensions.length > 0) {
    notes.push(`Add ${missingDimensions.join(", ")} dimension${missingDimensions.length === 1 ? "" : "s"} to classify this simulation.`);
  }
  if (!pack && missingDimensions.length === 0) {
    notes.push("No built-in domain pack matches these dimensions yet.");
  }

  return {
    simulation: simulation.name,
    dimensions,
    ...(pack ? { pack: { id: pack.id, title: pack.title, description: pack.description } } : {}),
    coverage: packCoverage({
      missingDimensions,
      missingSuggestedAssumptions,
      missingSuggestedMetrics,
      missingSuggestedScenarios,
      missingSuggestedObjectives,
      pack,
    }),
    missingDimensions,
    missingSuggestedAssumptions,
    missingSuggestedMetrics,
    missingSuggestedScenarios,
    missingSuggestedObjectives,
    notes,
  };
}

export function formatSimulationPackReports(reports: SimulationPackReport[]): string {
  if (reports.length === 0) return "no simulations found\n";
  return `${reports.map(formatSimulationPackReport).join("\n\n")}\n`;
}

function formatSimulationPackReport(report: SimulationPackReport): string {
  const lines = [`simulation ${report.simulation}`];
  lines.push(`  pack: ${report.pack ? `${report.pack.title} (${report.pack.id})` : "-"}`);
  lines.push(`  dimensions: ${formatDimensions(report.dimensions)}`);
  lines.push(`  coverage: ${report.coverage.overallPercent}%`);
  lines.push(`  missing dimensions: ${formatList(report.missingDimensions)}`);
  lines.push(`  suggested assumptions to add: ${formatList(report.missingSuggestedAssumptions)}`);
  lines.push(`  suggested metrics to add: ${formatList(report.missingSuggestedMetrics)}`);
  lines.push(`  suggested scenarios to add: ${formatScenarioSuggestions(report.missingSuggestedScenarios)}`);
  lines.push(`  suggested objectives to add: ${formatObjectiveSuggestions(report.missingSuggestedObjectives)}`);
  for (const note of report.notes) lines.push(`  note: ${note}`);
  return lines.join("\n");
}

function packCoverage(options: {
  missingDimensions: string[];
  missingSuggestedAssumptions: string[];
  missingSuggestedMetrics: string[];
  missingSuggestedScenarios: SimulationScenarioSuggestion[];
  missingSuggestedObjectives: SimulationObjectiveSuggestion[];
  pack?: SimulationDomainPack;
}): SimulationPackCoverage {
  const dimensions = sectionCoverage(3, options.missingDimensions.length);
  const assumptions = sectionCoverage(options.pack?.suggestedAssumptions.length ?? 0, options.missingSuggestedAssumptions.length);
  const metrics = sectionCoverage(options.pack?.suggestedMetrics.length ?? 0, options.missingSuggestedMetrics.length);
  const scenarios = sectionCoverage(options.pack?.suggestedScenarios.length ?? 0, options.missingSuggestedScenarios.length);
  const objectives = sectionCoverage(options.pack?.suggestedObjectives.length ?? 0, options.missingSuggestedObjectives.length);
  const sections = [dimensions, assumptions, metrics, scenarios, objectives];
  const total = sections.reduce((sum, section) => sum + section.total, 0);
  const present = sections.reduce((sum, section) => sum + section.present, 0);
  return {
    overallPercent: total === 0 ? 0 : Math.round((present / total) * 100),
    dimensions,
    assumptions,
    metrics,
    scenarios,
    objectives,
  };
}

function sectionCoverage(total: number, missing: number): SimulationCoverageSection {
  return {
    present: Math.max(0, total - missing),
    total,
  };
}

function formatDimensions(dimensions: Record<string, string>): string {
  const entries = Object.entries(dimensions);
  return entries.length === 0 ? "-" : entries.map(([name, value]) => `${name}=${value}`).join(", ");
}

function formatList(values: string[]): string {
  return values.length === 0 ? "-" : values.join(", ");
}

function formatScenarioSuggestions(values: SimulationScenarioSuggestion[]): string {
  return values.length === 0 ? "-" : values.map((scenario) => `${scenario.name} (${scenario.purpose})`).join("; ");
}

function formatObjectiveSuggestions(values: SimulationObjectiveSuggestion[]): string {
  return values.length === 0 ? "-" : values.map((objective) => objectiveKey(objective)).join(", ");
}

function objectiveKey(objective: SimulationObjectiveSuggestion): string {
  return `${objective.direction} ${objective.metric}`;
}
