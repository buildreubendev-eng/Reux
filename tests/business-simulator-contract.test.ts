import { describe, expect, it } from "vitest";
import {
  businessSimulatorContractVersion,
  businessSimulatorDefaultAssumptions,
  businessSimulatorEndpoints,
  type BusinessSimulatorRunRequest,
} from "../src/business-simulator-contract.js";

describe("business simulator API contract", () => {
  it("defines the first public endpoint set", () => {
    expect(businessSimulatorEndpoints).toEqual({
      listSimulations: "GET /api/simulations",
      getSimulation: "GET /api/simulations/:id",
      runSimulation: "POST /api/simulations/run",
      compareScenarios: "POST /api/scenarios/compare",
    });
  });

  it("keeps frontend assumption defaults in the public contract", () => {
    expect(businessSimulatorDefaultAssumptions).toMatchObject({
      employees: 50,
      averageHourlyCost: 32,
      weeklyDemand: 1200,
      productivityGainRate: 0.08,
      overtimeReductionRate: 0.1,
      supplierDelayRiskRate: 0.12,
      defectRate: 0.025,
      forecastPeriods: 12,
      forecastUnit: "week",
    });
  });

  it("accepts a baseline plus scenario override request shape", () => {
    const request = {
      baseline: businessSimulatorDefaultAssumptions,
      scenarios: [
        {
          id: "process-improvement",
          name: "Process Improvement",
          assumptions: {
            productivityGainRate: 0.12,
            overtimeReductionRate: 0.18,
          },
        },
      ],
      options: {
        includeTimeline: true,
        includeReuxSource: true,
      },
    } satisfies BusinessSimulatorRunRequest;

    expect(request.scenarios[0].assumptions.productivityGainRate).toBe(0.12);
    expect(businessSimulatorContractVersion).toBe("2026-05-01");
  });
});
