export const businessSimulatorEndpoints = {
  listSimulations: "GET /api/simulations",
  getSimulation: "GET /api/simulations/:id",
  runSimulation: "POST /api/simulations/run",
  listSimulationRuns: "GET /api/simulation-runs",
  getSimulationRun: "GET /api/simulation-runs/:id",
  compareScenarios: "POST /api/scenarios/compare",
} as const;

export type BusinessSimulatorEndpointName = keyof typeof businessSimulatorEndpoints;
export type BusinessSimulatorErrorCode =
  | "business_simulator_validation_failed"
  | "simulation_execution_validation_failed"
  | "invalid_json"
  | "request_too_large"
  | "rate_limited"
  | "not_found"
  | "saved_run_expired"
  | "method_not_allowed"
  | "request_failed";
export const businessSimulatorErrorCodes = [
  "business_simulator_validation_failed",
  "simulation_execution_validation_failed",
  "invalid_json",
  "request_too_large",
  "rate_limited",
  "not_found",
  "saved_run_expired",
  "method_not_allowed",
  "request_failed",
] as const satisfies readonly BusinessSimulatorErrorCode[];

export type BusinessSimulatorForecastUnit = "week" | "month" | "quarter";
export const businessSimulatorForecastUnits = ["week", "month", "quarter"] as const satisfies readonly BusinessSimulatorForecastUnit[];

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
export const businessSimulatorMetricNames = [
  "revenue",
  "operatingCost",
  "laborCost",
  "productivity",
  "workforceLoad",
  "margin",
  "marginDelta",
  "riskScore",
  "defectCost",
] as const satisfies readonly BusinessSimulatorMetricName[];

export const businessSimulatorLimits = {
  maxRunScenarios: 8,
  maxCompareScenarios: 12,
  maxForecastPeriods: 52,
  maxTimelinePoints: 52,
  maxScenarioIdLength: 64,
  maxScenarioNameLength: 120,
  maxScenarioDescriptionLength: 500,
} as const;

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

export interface BusinessSimulatorValidationIssue {
  path: string;
  message: string;
}

export interface BusinessSimulatorErrorResponse {
  ok: false;
  error: string;
  message: string;
  code: BusinessSimulatorErrorCode;
}

export interface BusinessSimulatorValidationErrorResponse extends BusinessSimulatorErrorResponse {
  code: "business_simulator_validation_failed";
  issues: BusinessSimulatorValidationIssue[];
}

export interface BusinessSimulatorSavedRunExpiredErrorResponse extends BusinessSimulatorErrorResponse {
  code: "saved_run_expired";
  expiresAt?: string;
}

export interface BusinessSimulatorScenarioInput {
  id: string;
  name: string;
  description?: string;
  assumptions: Partial<BusinessSimulatorAssumptions>;
}

export interface BusinessSimulatorRunRequest {
  name?: string;
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
  whyThisWon: string;
  whatChangedFromBaseline: string[];
  keyMetricDeltas: BusinessSimulatorMetricDelta[];
  riskSummary: string;
  tradeoffSummary: string;
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
  run?: BusinessSimulatorRunSummary;
  simulation: BusinessSimulatorSummary;
  baseline: BusinessSimulatorScenarioResult;
  scenarios: BusinessSimulatorScenarioResult[];
  comparison: BusinessSimulatorComparison;
  reuxSource?: string;
  generatedAt: string;
}

export interface BusinessSimulatorRunSummary {
  id: string;
  name?: string;
  simulationId: string;
  createdAt: string;
  expiresAt?: string;
  displayTitle: string;
  displaySubtitle: string;
  shareLabel: string;
  resultSummary?: string;
  keyMetric?: BusinessSimulatorRunKeyMetric;
  expiryNote?: string;
  session?: {
    id: string;
    isolated: boolean;
    schema?: string;
  };
  scenarioCount: number;
  bestMargin?: number;
  bestMarginScenario?: string;
  riskRange?: [number, number];
  recommendedScenarioId?: string;
  recommendedScenarioName?: string;
}

export interface BusinessSimulatorRunKeyMetric {
  metric: BusinessSimulatorMetricName;
  label: string;
  value: number;
  unit?: BusinessSimulatorMetricDelta["unit"];
  scenarioName?: string;
}

export interface BusinessSimulatorRunRecord extends BusinessSimulatorRunSummary {
  request: BusinessSimulatorRunRequest;
  response: BusinessSimulatorRunResponse;
}

export interface ListBusinessSimulatorRunsResponse {
  runs: BusinessSimulatorRunSummary[];
}

export interface GetBusinessSimulatorRunResponse {
  run: BusinessSimulatorRunRecord;
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

export const businessSimulatorContractVersion = "2026-05-02";
