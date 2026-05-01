import {
  businessSimulatorContractVersion,
  businessSimulatorEndpoints,
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
}

export const businessSimulatorContractFixtureDate = "2026-05-01T00:00:00.000Z";

export function createBusinessSimulatorContractFixture(now: Date = new Date(businessSimulatorContractFixtureDate)): BusinessSimulatorContractFixture {
  const listResponse = listBusinessSimulations();
  const templateId = listResponse.simulations[0]?.id ?? "operations-decision";
  const templateResponse = getBusinessSimulation(templateId);
  const runRequest: BusinessSimulatorRunRequest = {
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
  };
}

export function emitBusinessSimulatorContractFixture(now?: Date): string {
  return `${JSON.stringify(createBusinessSimulatorContractFixture(now), null, 2)}\n`;
}
