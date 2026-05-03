import {
  businessSimulatorForecastUnits,
  businessSimulatorLimits,
  businessSimulatorMetricNames,
  businessSimulatorSimulationIds,
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
const supportedSimulationIds = new Set<string>(businessSimulatorSimulationIds);
const scenarioIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function assertBusinessSimulatorRunRequest(value: unknown): asserts value is BusinessSimulatorRunRequest {
  const issues: BusinessSimulatorValidationIssue[] = [];
  if (!isRecord(value)) {
    throw new BusinessSimulatorValidationError([{ path: "$", message: "request body must be an object" }]);
  }

  validateAssumptions(value.baseline, "$.baseline", issues);
  validateScenarioInputs(value.scenarios, "$.scenarios", issues);

  validateOptionalBoundedString(
    value.name,
    "$.name",
    "name",
    businessSimulatorLimits.maxScenarioNameLength,
    issues,
  );
  if (value.simulationId !== undefined) {
    if (!isNonEmptyString(value.simulationId)) {
      issues.push({ path: "$.simulationId", message: "must be a non-empty string when provided" });
    } else if (!supportedSimulationIds.has(value.simulationId)) {
      issues.push({ path: "$.simulationId", message: `must be one of ${[...supportedSimulationIds].join(", ")}` });
    }
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
    if (value.scenarios.length > businessSimulatorLimits.maxCompareScenarios) {
      issues.push({ path: "$.scenarios", message: `must contain ${businessSimulatorLimits.maxCompareScenarios} or fewer scenario results` });
    }
    const seenScenarioIds = new Set<string>();
    value.scenarios.forEach((scenario, index) => {
      validateScenarioResult(scenario, `$.scenarios[${index}]`, issues);
      if (isRecord(scenario) && isNonEmptyString(scenario.id)) {
        if (seenScenarioIds.has(scenario.id)) {
          issues.push({ path: `$.scenarios[${index}].id`, message: "must be unique" });
        }
        seenScenarioIds.add(scenario.id);
      }
    });
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
  } else if (value.length > businessSimulatorLimits.maxRunScenarios) {
    issues.push({ path, message: `must contain ${businessSimulatorLimits.maxRunScenarios} or fewer scenarios` });
  }

  const seenScenarioIds = new Set<string>();
  value.forEach((scenario, index) => {
    const scenarioPath = `${path}[${index}]`;
    if (!isRecord(scenario)) {
      issues.push({ path: scenarioPath, message: "must be an object" });
      return;
    }
    validateScenarioId(scenario.id, `${scenarioPath}.id`, issues);
    if (isNonEmptyString(scenario.id) && scenarioIdPattern.test(scenario.id) && scenario.id.length <= businessSimulatorLimits.maxScenarioIdLength) {
      if (seenScenarioIds.has(scenario.id)) {
        issues.push({ path: `${scenarioPath}.id`, message: "must be unique" });
      }
      seenScenarioIds.add(scenario.id);
    }
    validateBoundedString(scenario.name, `${scenarioPath}.name`, "name", businessSimulatorLimits.maxScenarioNameLength, issues);
    validateOptionalBoundedString(scenario.description, `${scenarioPath}.description`, "description", businessSimulatorLimits.maxScenarioDescriptionLength, issues);
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
  if (field === "forecastPeriods") {
    if (!Number.isInteger(value) || value < 1) {
      issues.push({ path, message: "must be a positive integer" });
    } else if (value > businessSimulatorLimits.maxForecastPeriods) {
      issues.push({ path, message: `must be ${businessSimulatorLimits.maxForecastPeriods} or less` });
    }
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
  validateScenarioId(value.id, `${path}.id`, issues);
  validateBoundedString(value.name, `${path}.name`, "name", businessSimulatorLimits.maxScenarioNameLength, issues);
  validateOptionalBoundedString(value.description, `${path}.description`, "description", businessSimulatorLimits.maxScenarioDescriptionLength, issues);
  validateAssumptions(value.assumptions, `${path}.assumptions`, issues);
  validateMetricSnapshot(value.finalMetrics, `${path}.finalMetrics`, issues);
  validateTimeline(value.timeline, `${path}.timeline`, issues);
}

function validateTimeline(value: unknown, path: string, issues: BusinessSimulatorValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "must be an array" });
    return;
  }
  if (value.length > businessSimulatorLimits.maxTimelinePoints) {
    issues.push({ path, message: `must contain ${businessSimulatorLimits.maxTimelinePoints} or fewer points` });
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

function validateScenarioId(value: unknown, path: string, issues: BusinessSimulatorValidationIssue[]): void {
  if (!isNonEmptyString(value)) {
    issues.push({ path, message: "must be a non-empty string" });
    return;
  }
  if (value.length > businessSimulatorLimits.maxScenarioIdLength) {
    issues.push({ path, message: `must be ${businessSimulatorLimits.maxScenarioIdLength} characters or fewer` });
  }
  if (!scenarioIdPattern.test(value)) {
    issues.push({ path, message: "must use letters, numbers, underscores, or hyphens and start with a letter or number" });
  }
}

function validateBoundedString(
  value: unknown,
  path: string,
  label: string,
  maxLength: number,
  issues: BusinessSimulatorValidationIssue[],
): void {
  if (!isNonEmptyString(value)) {
    issues.push({ path, message: `must be a non-empty ${label}` });
    return;
  }
  if (value.length > maxLength) {
    issues.push({ path, message: `must be ${maxLength} characters or fewer` });
  }
}

function validateOptionalBoundedString(
  value: unknown,
  path: string,
  label: string,
  maxLength: number,
  issues: BusinessSimulatorValidationIssue[],
): void {
  if (value === undefined) return;
  if (typeof value !== "string") {
    issues.push({ path, message: `must be a string when provided` });
    return;
  }
  if (value.length > maxLength) {
    issues.push({ path, message: `${label} must be ${maxLength} characters or fewer` });
  }
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
