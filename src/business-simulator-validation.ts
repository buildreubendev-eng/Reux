import {
  businessSimulatorForecastUnits,
  businessSimulatorMetricNames,
  BusinessSimulatorAssumptions,
  BusinessSimulatorCompareRequest,
  BusinessSimulatorForecastUnit,
  BusinessSimulatorMetricName,
  BusinessSimulatorRunRequest,
  BusinessSimulatorScenarioResult,
  BusinessSimulatorValidationIssue,
} from "./business-simulator-contract.js";

export class BusinessSimulatorValidationError extends Error {
  readonly issues: BusinessSimulatorValidationIssue[];

  constructor(issues: BusinessSimulatorValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "BusinessSimulatorValidationError";
    this.issues = issues;
  }
}

const assumptionFields = [
  "employees",
  "averageHourlyCost",
  "weeklyDemand",
  "averageOrderValue",
  "grossMarginRate",
  "productivityGainRate",
  "overtimeReductionRate",
  "supplierDelayRiskRate",
  "defectRate",
  "forecastPeriods",
  "forecastUnit",
] as const satisfies readonly (keyof BusinessSimulatorAssumptions)[];

const rateFields = new Set<keyof BusinessSimulatorAssumptions>([
  "grossMarginRate",
  "productivityGainRate",
  "overtimeReductionRate",
  "supplierDelayRiskRate",
  "defectRate",
]);

export function assertBusinessSimulatorRunRequest(value: unknown): asserts value is BusinessSimulatorRunRequest {
  const issues: BusinessSimulatorValidationIssue[] = [];
  if (!isRecord(value)) {
    throw new BusinessSimulatorValidationError([{ path: "$", message: "request body must be an object" }]);
  }

  validateAssumptions(value.baseline, "$.baseline", issues);
  validateScenarioInputs(value.scenarios, "$.scenarios", issues);

  if (value.simulationId !== undefined && !isNonEmptyString(value.simulationId)) {
    issues.push({ path: "$.simulationId", message: "must be a non-empty string when provided" });
  }
  if (value.options !== undefined) {
    validateOptions(value.options, "$.options", issues);
  }

  throwIfIssues(issues);
}

export function assertBusinessSimulatorCompareRequest(value: unknown): asserts value is BusinessSimulatorCompareRequest {
  const issues: BusinessSimulatorValidationIssue[] = [];
  if (!isRecord(value)) {
    throw new BusinessSimulatorValidationError([{ path: "$", message: "request body must be an object" }]);
  }

  validateScenarioResult(value.baseline, "$.baseline", issues);
  if (!Array.isArray(value.scenarios) || value.scenarios.length === 0) {
    issues.push({ path: "$.scenarios", message: "must contain at least one scenario result" });
  } else {
    value.scenarios.forEach((scenario, index) => validateScenarioResult(scenario, `$.scenarios[${index}]`, issues));
  }

  throwIfIssues(issues);
}

function validateAssumptions(value: unknown, path: string, issues: BusinessSimulatorValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "must be an object" });
    return;
  }

  for (const field of assumptionFields) {
    if (!(field in value)) {
      issues.push({ path: `${path}.${field}`, message: "is required" });
      continue;
    }
    validateAssumptionValue(field, value[field], `${path}.${field}`, issues);
  }

  for (const field of Object.keys(value)) {
    if (!assumptionFields.includes(field as keyof BusinessSimulatorAssumptions)) {
      issues.push({ path: `${path}.${field}`, message: "is not a supported assumption" });
    }
  }
}

function validateScenarioInputs(value: unknown, path: string, issues: BusinessSimulatorValidationIssue[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ path, message: "must contain at least one scenario" });
    return;
  }

  value.forEach((scenario, index) => {
    const scenarioPath = `${path}[${index}]`;
    if (!isRecord(scenario)) {
      issues.push({ path: scenarioPath, message: "must be an object" });
      return;
    }
    if (!isNonEmptyString(scenario.id)) {
      issues.push({ path: `${scenarioPath}.id`, message: "must be a non-empty string" });
    }
    if (!isNonEmptyString(scenario.name)) {
      issues.push({ path: `${scenarioPath}.name`, message: "must be a non-empty string" });
    }
    if (scenario.description !== undefined && typeof scenario.description !== "string") {
      issues.push({ path: `${scenarioPath}.description`, message: "must be a string when provided" });
    }
    validateScenarioAssumptions(scenario.assumptions, `${scenarioPath}.assumptions`, issues);
  });
}

function validateScenarioAssumptions(value: unknown, path: string, issues: BusinessSimulatorValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "must be an object" });
    return;
  }

  for (const [field, fieldValue] of Object.entries(value)) {
    if (field === "forecastPeriods" || field === "forecastUnit") {
      issues.push({ path: `${path}.${field}`, message: "can only be set on baseline assumptions" });
      continue;
    }
    if (!assumptionFields.includes(field as keyof BusinessSimulatorAssumptions)) {
      issues.push({ path: `${path}.${field}`, message: "is not a supported assumption override" });
      continue;
    }
    validateAssumptionValue(field as keyof BusinessSimulatorAssumptions, fieldValue, `${path}.${field}`, issues);
  }
}

function validateAssumptionValue(
  field: keyof BusinessSimulatorAssumptions,
  value: unknown,
  path: string,
  issues: BusinessSimulatorValidationIssue[],
): void {
  if (field === "forecastUnit") {
    if (!businessSimulatorForecastUnits.includes(value as BusinessSimulatorForecastUnit)) {
      issues.push({ path, message: `must be one of ${businessSimulatorForecastUnits.join(", ")}` });
    }
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push({ path, message: "must be a finite number" });
    return;
  }
  if (field === "forecastPeriods" && (!Number.isInteger(value) || value < 1)) {
    issues.push({ path, message: "must be a positive integer" });
    return;
  }
  if (rateFields.has(field) && (value < 0 || value > 1)) {
    issues.push({ path, message: "must be between 0 and 1" });
    return;
  }
  if (value < 0) {
    issues.push({ path, message: "must be non-negative" });
  }
}

function validateOptions(value: unknown, path: string, issues: BusinessSimulatorValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  for (const field of ["includeTimeline", "includeReuxSource"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "boolean") {
      issues.push({ path: `${path}.${field}`, message: "must be a boolean when provided" });
    }
  }
}

function validateScenarioResult(value: unknown, path: string, issues: BusinessSimulatorValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  if (!isNonEmptyString(value.id)) issues.push({ path: `${path}.id`, message: "must be a non-empty string" });
  if (!isNonEmptyString(value.name)) issues.push({ path: `${path}.name`, message: "must be a non-empty string" });
  if (value.description !== undefined && typeof value.description !== "string") {
    issues.push({ path: `${path}.description`, message: "must be a string when provided" });
  }
  validateAssumptions(value.assumptions, `${path}.assumptions`, issues);
  validateMetricSnapshot(value.finalMetrics, `${path}.finalMetrics`, issues);
  validateTimeline(value.timeline, `${path}.timeline`, issues);
}

function validateTimeline(value: unknown, path: string, issues: BusinessSimulatorValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "must be an array" });
    return;
  }
  value.forEach((point, index) => {
    const pointPath = `${path}[${index}]`;
    if (!isRecord(point)) {
      issues.push({ path: pointPath, message: "must be an object" });
      return;
    }
    if (typeof point.period !== "number" || !Number.isInteger(point.period) || point.period < 1) {
      issues.push({ path: `${pointPath}.period`, message: "must be a positive integer" });
    }
    if (!isNonEmptyString(point.label)) {
      issues.push({ path: `${pointPath}.label`, message: "must be a non-empty string" });
    }
    validateMetricSnapshot(point.metrics, `${pointPath}.metrics`, issues);
  });
}

function validateMetricSnapshot(value: unknown, path: string, issues: BusinessSimulatorValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  for (const metric of businessSimulatorMetricNames) {
    const metricValue = value[metric];
    if (typeof metricValue !== "number" || !Number.isFinite(metricValue)) {
      issues.push({ path: `${path}.${metric}`, message: "must be a finite number" });
    }
  }
  for (const metric of Object.keys(value)) {
    if (!businessSimulatorMetricNames.includes(metric as BusinessSimulatorMetricName)) {
      issues.push({ path: `${path}.${metric}`, message: "is not a supported metric" });
    }
  }
}

function throwIfIssues(issues: BusinessSimulatorValidationIssue[]): void {
  if (issues.length > 0) throw new BusinessSimulatorValidationError(issues);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
