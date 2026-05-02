import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getReuxSimulation,
  listReuxSimulations,
  ReuxSimulationExecutionError,
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
          income: 6200,
        },
        scenarios: [
          {
            name: "lower_rent_runtime",
            overrides: {
              rent: 1100,
            },
            changes: [
              {
                period: 6,
                overrides: {
                  debt_payment: 0,
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
    expect(response.run.scenarios?.[0]?.periods[0]?.assumptions.income).toBe(6200);
    expect(response.run.scenarios?.[1]?.periods[0]?.assumptions.rent).toBe(1100);
    expect(response.run.scenarios?.[1]?.periods[5]?.assumptions.debt_payment).toBe(0);
    expect(response.run.comparison?.metricRankings.some((ranking) => ranking.metric === "annual_surplus")).toBe(true);
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
});
