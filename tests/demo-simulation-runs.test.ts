import { describe, expect, it } from "vitest";
import { createSimulationRunStore } from "../demo/pilot-app/simulation-runs.mjs";

describe("demo simulation run store", () => {
  it("stores shareable business simulator run records with response metadata", () => {
    const store = createSimulationRunStore({
      maxRecords: 5,
      ttlMs: 60_000,
      now: () => new Date("2026-05-02T00:00:00.000Z"),
      createId: () => "live_test_run",
    });
    const response = {
      simulation: { id: "operations-decision", name: "Operations Decision Simulator" },
      baseline: {
        id: "baseline",
        name: "Current Operations",
        finalMetrics: { margin: 1000, riskScore: 20 },
      },
      scenarios: [
        {
          id: "process-improvement",
          name: "Process Improvement",
          finalMetrics: { margin: 1400, riskScore: 16 },
        },
      ],
      comparison: {
        recommendation: {
          scenarioId: "process-improvement",
          scenarioName: "Process Improvement",
        },
      },
    };

    const record = store.save({
      request: { simulationId: "operations-decision" },
      response,
      session: { id: "abc12345", schema: "reux_demo_s_abc12345" },
    });

    expect(record.id).toBe("live_test_run");
    expect(record.response.run).toMatchObject({
      id: "live_test_run",
      name: "Operations Decision Simulator",
      simulationId: "operations-decision",
      scenarioCount: 2,
      bestMargin: 1400,
      bestMarginScenario: "Process Improvement",
      riskRange: [16, 20],
      recommendedScenarioId: "process-improvement",
      recommendedScenarioName: "Process Improvement",
      session: {
        id: "abc12345",
        isolated: true,
      },
    });
    expect(store.get("live_test_run")?.request).toEqual({ simulationId: "operations-decision" });
  });

  it("lists session-scoped summaries while allowing direct lookup by known id", () => {
    let current = new Date("2026-05-02T00:00:00.000Z");
    let counter = 0;
    const store = createSimulationRunStore({
      maxRecords: 5,
      ttlMs: 60_000,
      now: () => current,
      createId: () => `live_${++counter}`,
    });

    store.save({ request: {}, response: { simulation: { id: "operations-decision" }, scenarios: [] }, session: { id: "sessionone" } });
    current = new Date("2026-05-02T00:00:01.000Z");
    store.save({ request: {}, response: { simulation: { id: "operations-decision" }, scenarios: [] }, session: { id: "sessiontwo" } });

    expect(store.list({ sessionId: "sessionone" }).map((run) => run.id)).toEqual(["live_1"]);
    expect(store.list().map((run) => run.id)).toEqual(["live_2", "live_1"]);
    expect(store.get("live_1")?.session.id).toBe("sessionone");
  });

  it("expires old records and enforces the configured record limit", () => {
    let current = new Date("2026-05-02T00:00:00.000Z");
    let counter = 0;
    const store = createSimulationRunStore({
      maxRecords: 2,
      ttlMs: 1_000,
      now: () => current,
      createId: () => `live_${++counter}`,
    });

    store.save({ request: {}, response: { simulation: { id: "operations-decision" }, scenarios: [] }, session: {} });
    current = new Date("2026-05-02T00:00:00.500Z");
    store.save({ request: {}, response: { simulation: { id: "operations-decision" }, scenarios: [] }, session: {} });
    current = new Date("2026-05-02T00:00:00.750Z");
    store.save({ request: {}, response: { simulation: { id: "operations-decision" }, scenarios: [] }, session: {} });

    expect(store.get("live_1")).toBeNull();
    expect(store.list().map((run) => run.id)).toEqual(["live_3", "live_2"]);

    current = new Date("2026-05-02T00:00:02.000Z");
    expect(store.list()).toEqual([]);
    expect(store.stats().records).toBe(0);
  });
});
