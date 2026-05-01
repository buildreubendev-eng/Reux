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
}

export interface SimulationPackReport {
  simulation: string;
  dimensions: Record<string, string>;
  pack?: Pick<SimulationDomainPack, "id" | "title" | "description">;
  missingDimensions: string[];
  missingSuggestedAssumptions: string[];
  missingSuggestedMetrics: string[];
  notes: string[];
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
  const notes: string[] = [];

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
    missingDimensions,
    missingSuggestedAssumptions: pack?.suggestedAssumptions.filter((assumption) => !assumptionNames.has(assumption)) ?? [],
    missingSuggestedMetrics: pack?.suggestedMetrics.filter((metric) => !metricNames.has(metric)) ?? [],
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
  lines.push(`  missing dimensions: ${formatList(report.missingDimensions)}`);
  lines.push(`  suggested assumptions to add: ${formatList(report.missingSuggestedAssumptions)}`);
  lines.push(`  suggested metrics to add: ${formatList(report.missingSuggestedMetrics)}`);
  for (const note of report.notes) lines.push(`  note: ${note}`);
  return lines.join("\n");
}

function formatDimensions(dimensions: Record<string, string>): string {
  const entries = Object.entries(dimensions);
  return entries.length === 0 ? "-" : entries.map(([name, value]) => `${name}=${value}`).join(", ");
}

function formatList(values: string[]): string {
  return values.length === 0 ? "-" : values.join(", ");
}
