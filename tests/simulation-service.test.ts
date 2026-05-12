import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compareReuxSimulation,
  createReuxSimulationService,
  getReuxSimulation,
  createReuxSimulationExecutionFixture,
  listReuxSimulations,
  ReuxSimulationExecutionError,
  reuxSimulationExecutionLimits,
  runReuxSimulation,
} from "../src/simulation-service.js";

const financeSource = () => readFileSync("examples/simulations/personal_finance.reux", "utf8");

describe("product-facing simulation service", () => {
  it("lists product-facing simulation metadata", () => {
    const response = listReuxSimulations(financeSource());

    expect(response.simulations).toHaveLength(1);
    expect(response.simulations[0]).toMatchObject({
      name: "personal_finance",
      dimensions: {
        product: "PLOS",
        domain: "finance",
        audience: "personal",
      },
      forecast: {
        periods: 12,
        unit: "month",
      },
    });
    expect(response.simulations[0]?.metrics).toContain("annual_surplus");
  });

  it("loads one simulation by name", () => {
    const response = getReuxSimulation(financeSource(), "personal_finance");

    expect(response.simulation.name).toBe("personal_finance");
    expect(response.simulation.assumptions.find((assumption) => assumption.name === "income")).toMatchObject({
      type: "number",
      value: 5000,
      unit: "USD",
    });
  });

  it("runs a simulation with runtime assumption and scenario overrides", () => {
    const response = runReuxSimulation(
      financeSource(),
      {
        simulationName: "personal_finance",
        assumptions: {
          income: { value: 6200, unit: "USD" },
        },
        scenarios: [
          {
            name: "lower_rent_runtime",
            overrides: {
              rent: { value: 1100, unit: "USD" },
            },
            changes: [
              {
                period: 6,
                overrides: {
                  debt_payment: { value: 0, unit: "USD" },
                },
              },
            ],
          },
        ],
      },
      new Date("2026-05-02T00:00:00.000Z"),
    );

    expect(response.generatedAt).toBe("2026-05-02T00:00:00.000Z");
    expect(response.simulation.scenarios).toEqual(["baseline", "lower_rent_runtime"]);
    expect(response.run.scenarios?.map((scenario) => scenario.name)).toEqual(["baseline", "lower_rent_runtime"]);
    expect(response.baseline.name).toBe("baseline");
    expect(response.scenarios.map((scenario) => scenario.name)).toEqual(["lower_rent_runtime"]);
    expect(response.run.scenarios?.[0]?.periods[0]?.assumptions.income).toBe(6200);
    expect(response.run.scenarios?.[1]?.periods[0]?.assumptions.rent).toBe(1100);
    expect(response.run.scenarios?.[1]?.periods[5]?.assumptions.debt_payment).toBe(0);
    expect(response.run.timeSeries.assumptions.find((series) => series.name === "income")).toMatchObject({
      name: "income",
      unit: "USD",
      points: expect.arrayContaining([
        expect.objectContaining({ period: 1, value: 6200, changedFromPrevious: false, changedFromBaseline: false }),
      ]),
    });
    expect(response.run.scenarios?.[1]?.timeSeries.assumptions.find((series) => series.name === "debt_payment")).toMatchObject({
      name: "debt_payment",
      unit: "USD",
      points: expect.arrayContaining([
        expect.objectContaining({ period: 6, value: 0, changedFromPrevious: true, changedFromBaseline: true, deltaFromPrevious: -500 }),
      ]),
    });
    expect(response.run.comparison?.metricRankings.some((ranking) => ranking.metric === "annual_surplus")).toBe(true);
  });

  it("compares runtime scenarios through the product-facing comparison API", () => {
    const response = compareReuxSimulation(
      financeSource(),
      {
        simulationName: "personal_finance",
        scenarios: [
          {
            name: "lower_rent_runtime",
            overrides: {
              rent: { value: 1100, unit: "USD" },
            },
          },
        ],
      },
      new Date("2026-05-02T00:00:00.000Z"),
    );

    expect(response.generatedAt).toBe("2026-05-02T00:00:00.000Z");
    expect(response.baseline.name).toBe("baseline");
    expect(response.scenarios.map((scenario) => scenario.name)).toEqual(["lower_rent_runtime"]);
    expect(response.comparison?.scenarios[0]).toMatchObject({
      name: "lower_rent_runtime",
    });
    expect(response.comparison?.metricRankings.some((ranking) => ranking.metric === "cash_flow")).toBe(true);
  });

  it("creates a reusable no-throw simulation service for product backends", () => {
    const service = createReuxSimulationService(financeSource(), {
      requestIdFactory: () => "sim_test_001",
      clock: () => new Date("2026-05-02T00:00:00.000Z"),
      durationMs: () => 7,
    });

    expect(service.list().simulations[0]?.name).toBe("personal_finance");
    expect(service.get("personal_finance").simulation.forecast.periods).toBe(12);

    const run = service.runEnvelope({
      simulationName: "personal_finance",
      assumptions: {
        income: { value: 6200, unit: "USD" },
      },
    });

    expect(run).toMatchObject({
      ok: true,
      requestId: "sim_test_001",
      generatedAt: "2026-05-02T00:00:00.000Z",
      durationMs: 7,
      data: {
        simulation: {
          name: "personal_finance",
        },
      },
    });

    const comparison = service.compareEnvelope({
      simulationName: "personal_finance",
      scenarios: [
        {
          name: "lower_rent_runtime",
          overrides: {
            rent: { value: 1100, unit: "USD" },
          },
        },
      ],
    });

    expect(comparison).toMatchObject({
      ok: true,
      requestId: "sim_test_001",
      data: {
        comparison: {
          scenarios: [
            {
              name: "lower_rent_runtime",
            },
          ],
        },
      },
    });
  });

  it("returns stable validation envelopes from the reusable service", () => {
    const service = createReuxSimulationService(financeSource(), {
      requestIdFactory: () => "sim_test_bad",
      clock: () => new Date("2026-05-02T00:00:00.000Z"),
      durationMs: () => 3,
    });

    expect(service.runEnvelope({ simulationName: "missing_simulation" })).toEqual({
      ok: false,
      requestId: "sim_test_bad",
      generatedAt: "2026-05-02T00:00:00.000Z",
      durationMs: 3,
      error: "$.simulationName: simulation 'missing_simulation' was not found",
      message: "$.simulationName: simulation 'missing_simulation' was not found",
      code: "simulation_execution_validation_failed",
      category: "validation",
      retryable: false,
      userAction: "Fix the request fields and try again.",
      issues: [
        {
          path: "$.simulationName",
          message: "simulation 'missing_simulation' was not found",
        },
      ],
    });
  });

  it("rejects runtime override unit mismatches with field-level issue paths", () => {
    try {
      runReuxSimulation(financeSource(), {
        assumptions: {
          income: { value: 6200, unit: "EUR" },
        },
        scenarios: [
          {
            name: "bad_unit",
            overrides: {
              rent: { value: 1000, unit: "EUR" },
            },
          },
        ],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ReuxSimulationExecutionError);
      expect((error as ReuxSimulationExecutionError).issues).toEqual(
        expect.arrayContaining([
          { path: "$.assumptions.income.unit", message: "must match declared unit USD for assumption 'income'" },
          { path: "$.scenarios[0].overrides.rent.unit", message: "must match declared unit USD for assumption 'rent'" },
        ]),
      );
      return;
    }

    throw new Error("expected unit mismatch request to fail");
  });

  it("rejects invalid runtime overrides with stable issue paths", () => {
    expect(() =>
      runReuxSimulation(financeSource(), {
        assumptions: {
          income: "too much",
          made_up: 1,
        },
        scenarios: [
          {
            name: "bad",
            changes: [
              {
                period: 99,
                unit: "week",
                overrides: {
                  rent: 1000,
                },
              },
            ],
          },
        ],
      }),
    ).toThrowError(ReuxSimulationExecutionError);

    try {
      runReuxSimulation(financeSource(), {
        assumptions: {
          income: "too much",
          made_up: 1,
        },
        scenarios: [
          {
            name: "bad",
            changes: [
              {
                period: 99,
                unit: "week",
                overrides: {
                  rent: 1000,
                },
              },
            ],
          },
        ],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ReuxSimulationExecutionError);
      expect((error as ReuxSimulationExecutionError).issues).toEqual(
        expect.arrayContaining([
          { path: "$.assumptions.income", message: "must be a number for assumption 'income'" },
          { path: "$.assumptions.made_up", message: "references an unknown assumption" },
          { path: "$.scenarios[0].changes[0].unit", message: "must match forecast unit 'month'" },
          { path: "$.scenarios[0].changes[0].period", message: "must be within the forecast window" },
        ]),
      );
    }
  });

  it("rejects oversized execution requests before running the model", () => {
    try {
      runReuxSimulation(financeSource(), {
        assumptions: Object.fromEntries(Array.from({ length: reuxSimulationExecutionLimits.maxOverrideEntries + 1 }, (_, index) => [`field_${index}`, index])),
        scenarios: Array.from({ length: reuxSimulationExecutionLimits.maxScenarios + 1 }, (_, index) => ({
          name: `scenario_${index}`,
        })),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ReuxSimulationExecutionError);
      expect((error as ReuxSimulationExecutionError).statusCode).toBe(400);
      expect((error as ReuxSimulationExecutionError).issues).toEqual(
        expect.arrayContaining([
          { path: "$.assumptions", message: `must include at most ${reuxSimulationExecutionLimits.maxOverrideEntries} entries` },
          { path: "$.scenarios", message: `must include at most ${reuxSimulationExecutionLimits.maxScenarios} scenarios` },
        ]),
      );
      return;
    }

    throw new Error("expected oversized request to fail");
  });

  it("emits a deterministic execution fixture for frontend/backend handoff", () => {
    const fixture = createReuxSimulationExecutionFixture(financeSource(), "personal_finance");

    expect(fixture).toMatchObject({
      contract: "reux-simulation-execution",
      version: "2026-05-12",
      generatedAt: "2026-05-02T00:00:00.000Z",
      runRequest: {
        simulationName: "personal_finance",
      },
      invalidRunResponse: {
        ok: false,
        code: "simulation_execution_validation_failed",
      },
    });
    expect(fixture.limits.maxScenarios).toBe(reuxSimulationExecutionLimits.maxScenarios);
    expect(fixture.runResponse.run.name).toBe("personal_finance");
    expect(fixture.invalidRunResponse.issues[0]?.path).toBe("$.assumptions.income");
    expect(fixture.serviceRunEnvelope).toMatchObject({
      ok: true,
      requestId: "sim_fixture_0001",
      data: {
        run: {
          name: "personal_finance",
        },
      },
    });
    expect(fixture.serviceCompareEnvelope.data.comparison?.metricRankings.some((ranking) => ranking.metric === "annual_surplus")).toBe(true);
  });
});
