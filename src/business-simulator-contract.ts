export const businessSimulatorEndpoints = {
  listSimulations: "GET /api/simulations",
  getSimulation: "GET /api/simulations/:id",
  runSimulation: "POST /api/simulations/run",
  compareScenarios: "POST /api/scenarios/compare",
} as const;

export type BusinessSimulatorEndpointName = keyof typeof businessSimulatorEndpoints;
export type BusinessSimulatorForecastUnit = "week" | "month" | "quarter";
export type BusinessSimulatorMetricName =
  | "revenue"
  | "operatingCost"
  | "laborCost"
  | "productivity"
  | "workforceLoad"
  | "margin"
  | "marginDelta"
  | "riskScore"
  | "defectCost";

export interface BusinessSimulatorAssumptions {
  employees: number;
  averageHourlyCost: number;
  weeklyDemand: number;
  averageOrderValue: number;
  grossMarginRate: number;
  productivityGainRate: number;
  overtimeReductionRate: number;
  supplierDelayRiskRate: number;
  defectRate: number;
  forecastPeriods: number;
  forecastUnit: BusinessSimulatorForecastUnit;
}

export interface BusinessSimulatorScenarioInput {
  id: string;
  name: string;
  description?: string;
  assumptions: Partial<BusinessSimulatorAssumptions>;
}

export interface BusinessSimulatorRunRequest {
  simulationId?: string;
  baseline: BusinessSimulatorAssumptions;
  scenarios: BusinessSimulatorScenarioInput[];
  options?: {
    includeTimeline?: boolean;
    includeReuxSource?: boolean;
  };
}

export interface BusinessSimulatorCompareRequest {
  baseline: BusinessSimulatorScenarioResult;
  scenarios: BusinessSimulatorScenarioResult[];
}

export interface BusinessSimulatorMetricSnapshot {
  revenue: number;
  operatingCost: number;
  laborCost: number;
  productivity: number;
  workforceLoad: number;
  margin: number;
  marginDelta: number;
  riskScore: number;
  defectCost: number;
}

export interface BusinessSimulatorTimelinePoint {
  period: number;
  label: string;
  metrics: BusinessSimulatorMetricSnapshot;
}

export interface BusinessSimulatorScenarioResult {
  id: string;
  name: string;
  description?: string;
  assumptions: BusinessSimulatorAssumptions;
  finalMetrics: BusinessSimulatorMetricSnapshot;
  timeline: BusinessSimulatorTimelinePoint[];
}

export interface BusinessSimulatorMetricDelta {
  metric: BusinessSimulatorMetricName;
  baseline: number;
  scenario: number;
  delta: number;
  direction: "increase" | "decrease" | "flat";
  unit?: "USD" | "percent" | "count" | "index";
}

export interface BusinessSimulatorRecommendation {
  scenarioId: string;
  scenarioName: string;
  score: number;
  summary: string;
  reasons: string[];
  tradeoffs: string[];
}

export interface BusinessSimulatorComparison {
  baselineScenarioId: string;
  recommendedScenarioId?: string;
  metricDeltasByScenario: Record<string, BusinessSimulatorMetricDelta[]>;
  recommendation?: BusinessSimulatorRecommendation;
}

export interface BusinessSimulatorRunResponse {
  simulation: BusinessSimulatorSummary;
  baseline: BusinessSimulatorScenarioResult;
  scenarios: BusinessSimulatorScenarioResult[];
  comparison: BusinessSimulatorComparison;
  reuxSource?: string;
  generatedAt: string;
}

export interface BusinessSimulatorCompareResponse {
  comparison: BusinessSimulatorComparison;
  generatedAt: string;
}

export interface BusinessSimulatorSummary {
  id: string;
  name: string;
  description: string;
  domain: "operations" | "workforce" | "finance" | "custom";
  status: "draft" | "ready" | "archived";
  updatedAt: string;
}

export interface ListBusinessSimulationsResponse {
  simulations: BusinessSimulatorSummary[];
}

export interface GetBusinessSimulationResponse {
  simulation: BusinessSimulatorSummary;
  defaultAssumptions: BusinessSimulatorAssumptions;
  exampleScenarios: BusinessSimulatorScenarioInput[];
}

export const businessSimulatorDefaultAssumptions: BusinessSimulatorAssumptions = {
  employees: 50,
  averageHourlyCost: 32,
  weeklyDemand: 1200,
  averageOrderValue: 85,
  grossMarginRate: 0.42,
  productivityGainRate: 0.08,
  overtimeReductionRate: 0.1,
  supplierDelayRiskRate: 0.12,
  defectRate: 0.025,
  forecastPeriods: 12,
  forecastUnit: "week",
};

export const businessSimulatorContractVersion = "2026-05-01";
