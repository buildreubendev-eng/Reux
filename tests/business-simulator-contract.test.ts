import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  businessSimulatorContractVersion,
  businessSimulatorDefaultAssumptions,
  businessSimulatorEndpoints,
  type BusinessSimulatorRunRequest,
} from "../src/business-simulator-contract.js";
import { compileSource, emitSimulationRun, runBusinessSimulator } from "../src/compiler.js";

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

  it("keeps the Reux business simulator model aligned with frontend assumptions and metrics", () => {
    const source = readFileSync("examples/simulations/business_simulator.reux", "utf8");
    const compiled = compileSource(source);
    const simulation = compiled.simulations[0];
    const assumptionNames = simulation.assumptions.map((assumption) => assumption.name);
    const metricNames = simulation.formulas.map((formula) => formula.name);

    expect(assumptionNames).toEqual([
      "employees",
      "averageHourlyCost",
      "weeklyDemand",
      "averageOrderValue",
      "grossMarginRate",
      "productivityGainRate",
      "overtimeReductionRate",
      "supplierDelayRiskRate",
      "defectRate",
    ]);
    expect(metricNames).toEqual([
      "revenue",
      "laborCost",
      "productivity",
      "workforceLoad",
      "defectCost",
      "operatingCost",
      "margin",
      "marginDelta",
      "riskScore",
    ]);

    const run = JSON.parse(emitSimulationRun(source));
    expect(run.comparison.metricRankings.some((ranking: { metric: string }) => ranking.metric === "marginDelta")).toBe(true);
    expect(run.scenarios.map((scenario: { name: string }) => scenario.name)).toEqual([
      "baseline",
      "processImprovement",
      "demandIncrease",
      "qualityIssue",
      "staffingIncrease",
    ]);
  });

  it("adapts Reux simulation output into the business simulator response contract", () => {
    const response = runBusinessSimulator(
      {
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
          {
            id: "quality-issue",
            name: "Quality Issue",
            assumptions: {
              defectRate: 0.06,
              supplierDelayRiskRate: 0.18,
            },
          },
        ],
        options: {
          includeReuxSource: true,
        },
      },
      new Date("2026-05-01T00:00:00.000Z"),
    );

    expect(response.simulation.id).toBe("operations-decision");
    expect(response.baseline.timeline).toHaveLength(12);
    expect(response.scenarios.map((scenario) => scenario.id)).toEqual(["process-improvement", "quality-issue"]);
    expect(response.comparison.metricDeltasByScenario["process-improvement"].some((delta) => delta.metric === "marginDelta")).toBe(true);
    expect(response.comparison.recommendation?.scenarioId).toBe("process-improvement");
    expect(response.reuxSource).toContain("simulate operations_decision");
    expect(response.generatedAt).toBe("2026-05-01T00:00:00.000Z");
  });
});
