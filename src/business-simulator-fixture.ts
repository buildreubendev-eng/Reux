import {
  businessSimulatorContractVersion,
  businessSimulatorEndpoints,
  businessSimulatorLimits,
  BusinessSimulatorValidationErrorResponse,
  BusinessSimulatorCompareRequest,
  BusinessSimulatorCompareResponse,
  BusinessSimulatorRunRequest,
  BusinessSimulatorRunResponse,
  GetBusinessSimulationResponse,
  ListBusinessSimulationsResponse,
} from "./business-simulator-contract.js";
import {
  compareBusinessSimulatorScenarios,
  getBusinessSimulation,
  listBusinessSimulations,
  runBusinessSimulator,
} from "./business-simulator-adapter.js";

export interface BusinessSimulatorContractFixture {
  contractVersion: string;
  generatedAt: string;
  endpoints: typeof businessSimulatorEndpoints;
  limits: typeof businessSimulatorLimits;
  listResponse: ListBusinessSimulationsResponse;
  templateResponse: GetBusinessSimulationResponse;
  runRequest: BusinessSimulatorRunRequest;
  runResponse: BusinessSimulatorRunResponse;
  compareRequest: BusinessSimulatorCompareRequest;
  compareResponse: BusinessSimulatorCompareResponse;
  frontendMapping: {
    ratesAreDecimals: true;
    forecastUnits: string[];
    scenarioOverridesArePartial: true;
    reuxSourceField: "reuxSource";
  };
  invalidRunResponse: BusinessSimulatorValidationErrorResponse;
}

export const businessSimulatorContractFixtureDate = "2026-05-01T00:00:00.000Z";

export function createBusinessSimulatorContractFixture(now: Date = new Date(businessSimulatorContractFixtureDate)): BusinessSimulatorContractFixture {
  const listResponse = listBusinessSimulations();
  const templateId = listResponse.simulations[0]?.id ?? "operations-decision";
  const templateResponse = getBusinessSimulation(templateId);
  const runRequest: BusinessSimulatorRunRequest = {
    name: "Contract Fixture Business Simulation",
    simulationId: templateId,
    baseline: templateResponse.defaultAssumptions,
    scenarios: templateResponse.exampleScenarios.slice(0, 2),
    options: {
      includeTimeline: true,
      includeReuxSource: true,
    },
  };
  const runResponse = runBusinessSimulator(runRequest, now);
  const compareRequest: BusinessSimulatorCompareRequest = {
    baseline: runResponse.baseline,
    scenarios: runResponse.scenarios,
  };

  return {
    contractVersion: businessSimulatorContractVersion,
    generatedAt: now.toISOString(),
    endpoints: businessSimulatorEndpoints,
    limits: businessSimulatorLimits,
    listResponse,
    templateResponse,
    runRequest,
    runResponse,
    compareRequest,
    compareResponse: compareBusinessSimulatorScenarios(compareRequest, now),
    frontendMapping: {
      ratesAreDecimals: true,
      forecastUnits: ["week", "month", "quarter"],
      scenarioOverridesArePartial: true,
      reuxSourceField: "reuxSource",
    },
    invalidRunResponse: {
      ok: false,
      error: "$.baseline.grossMarginRate: must be between 0 and 1",
      message: "$.baseline.grossMarginRate: must be between 0 and 1",
      code: "business_simulator_validation_failed",
      issues: [
        {
          path: "$.baseline.grossMarginRate",
          message: "must be between 0 and 1",
        },
      ],
    },
  };
}

export function emitBusinessSimulatorContractFixture(now?: Date): string {
  return `${JSON.stringify(createBusinessSimulatorContractFixture(now), null, 2)}\n`;
}
