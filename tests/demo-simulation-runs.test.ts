import { describe, expect, it } from "vitest";
import { createSimulationRunStore, recordSummary } from "../demo/pilot-app/simulation-runs.mjs";

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
          whyThisWon: "Process Improvement is recommended because margin improved with lower risk.",
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
      displayTitle: "Operations Decision Simulator",
      displaySubtitle: "2 scenarios compared. Recommended: Process Improvement.",
      shareLabel: "Business Simulator result: Operations Decision Simulator",
      resultSummary: "Process Improvement is recommended because margin improved with lower risk.",
      scenarioCount: 2,
      bestMargin: 1400,
      bestMarginScenario: "Process Improvement",
      keyMetric: {
        metric: "margin",
        label: "Best margin",
        value: 1400,
        unit: "USD",
        scenarioName: "Process Improvement",
      },
      riskRange: [16, 20],
      recommendedScenarioId: "process-improvement",
      recommendedScenarioName: "Process Improvement",
      expiryNote: "Temporary result expires at 2026-05-02T00:01:00.000Z.",
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

  it("preserves saved-run storage status in summary metadata", () => {
    const summary = recordSummary({
      id: "live_storage",
      simulationId: "operations-decision",
      createdAt: "2026-05-02T00:00:00.000Z",
      expiresAt: "2026-05-03T00:00:00.000Z",
      session: { id: "sessionone", isolated: true },
      request: { name: "Fallback Run" },
      response: {
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
            decisionSummary: "Process Improvement is recommended.",
          },
        },
        run: {
          storage: "memory",
          persistenceWarning: "Saved run is using temporary in-memory fallback storage.",
        },
      },
    });

    expect(summary).toMatchObject({
      id: "live_storage",
      storage: "memory",
      persistenceWarning: "Saved run is using temporary in-memory fallback storage.",
      resultSummary: "Process Improvement is recommended.",
    });
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

  it("distinguishes expired run IDs from missing run IDs", () => {
    let current = new Date("2026-05-02T00:00:00.000Z");
    const store = createSimulationRunStore({
      maxRecords: 5,
      ttlMs: 1_000,
      now: () => current,
      createId: () => "live_expired",
    });

    store.save({ request: {}, response: { simulation: { id: "operations-decision" }, scenarios: [] }, session: {} });
    current = new Date("2026-05-02T00:00:02.000Z");

    expect(store.getStatus("live_expired")).toEqual({
      status: "expired",
      expiresAt: "2026-05-02T00:00:01.000Z",
    });
    expect(store.getStatus("live_missing")).toEqual({ status: "missing" });
  });
});
