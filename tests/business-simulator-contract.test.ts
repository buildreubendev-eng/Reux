import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  businessSimulatorContractVersion,
  businessSimulatorDefaultAssumptions,
  businessSimulatorEndpoints,
  businessSimulatorErrorCodes,
  businessSimulatorForecastUnits,
  businessSimulatorLimits,
  businessSimulatorMetricNames,
  businessSimulatorSimulationIds,
  type BusinessSimulatorRunRequest,
} from "../src/business-simulator-contract.js";
import {
  assertBusinessSimulatorCompareRequest,
  assertBusinessSimulatorRunRequest,
  BusinessSimulatorValidationError,
  compareBusinessSimulatorScenarios,
  createBusinessSimulatorContractFixture,
  emitBusinessSimulatorContractFixture,
  compileSource,
  emitSimulationRun,
  getBusinessSimulation,
  listBusinessSimulations,
  runBusinessSimulator,
} from "../src/compiler.js";

describe("business simulator API contract", () => {
  it("defines the first public endpoint set", () => {
    expect(businessSimulatorEndpoints).toEqual({
      listSimulations: "GET /api/simulations",
      getSimulation: "GET /api/simulations/:id",
      runSimulation: "POST /api/simulations/run",
      listSimulationRuns: "GET /api/simulation-runs",
      getSimulationRun: "GET /api/simulation-runs/:id",
      compareScenarios: "POST /api/scenarios/compare",
    });
    expect(businessSimulatorForecastUnits).toEqual(["week", "month", "quarter"]);
    expect(businessSimulatorMetricNames).toContain("marginDelta");
    expect(businessSimulatorSimulationIds).toEqual(["operations-decision", "capacity-planning", "staffing-plan", "pricing-strategy"]);
    expect(businessSimulatorErrorCodes).toEqual([
      "business_simulator_validation_failed",
      "simulation_execution_validation_failed",
      "invalid_json",
      "request_too_large",
      "rate_limited",
      "not_found",
      "saved_run_expired",
      "method_not_allowed",
      "request_failed",
    ]);
    expect(businessSimulatorLimits.maxRunScenarios).toBe(8);
    expect(businessSimulatorLimits.maxForecastPeriods).toBe(52);
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
    expect(businessSimulatorContractVersion).toBe("2026-05-02");
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
    expect(response.comparison.scenarioRanking.map((scenario) => scenario.scenarioId)).toEqual(["process-improvement", "quality-issue"]);
    expect(response.comparison.scenarioRanking[0]).toMatchObject({
      rank: 1,
      scenarioId: "process-improvement",
      recommended: true,
      scoreGapFromBest: 0,
    });
    expect(response.comparison.recommendation?.scenarioId).toBe("process-improvement");
    expect(response.comparison.recommendation?.runnerUpScenarioId).toBe("quality-issue");
    expect(response.comparison.recommendation?.scoreGap).toBeGreaterThan(0);
    expect(response.comparison.recommendation?.whyThisWon).toContain("Process Improvement is recommended because");
    expect(response.comparison.recommendation?.decisionSummary).toContain("Process Improvement is the");
    expect(response.comparison.recommendation?.recommendedAction).toContain("Process Improvement");
    expect(response.comparison.recommendation?.confidence).toMatch(/^(low|medium|high)$/);
    expect(response.comparison.recommendation?.confidenceSummary).toContain("confidence");
    expect(response.comparison.recommendation?.whatChangedFromBaseline).toEqual(
      expect.arrayContaining([
        "productivity gain rate increased to 12%",
        "overtime reduction rate increased to 18%",
      ]),
    );
    expect(response.comparison.recommendation?.keyMetricDeltas.map((delta) => delta.metric)).toEqual([
      "marginDelta",
      "productivity",
      "operatingCost",
      "riskScore",
    ]);
    expect(response.comparison.recommendation?.scoreBreakdown.map((factor) => factor.factor)).toEqual([
      "margin",
      "productivity",
      "operatingCost",
      "risk",
    ]);
    expect(response.comparison.recommendation?.scoreBreakdown[0].summary).toContain("blended-score points");
    expect(response.comparison.recommendation?.riskSummary).toContain("Risk stays flat");
    expect(response.comparison.recommendation?.tradeoffSummary).toBeTruthy();
    expect(response.comparison.recommendation?.watchouts.length).toBeGreaterThan(0);
    expect(response.reuxSource).toContain("simulate operations_decision");
    expect(response.generatedAt).toBe("2026-05-01T00:00:00.000Z");
  });

  it("honors lightweight run options without changing final metrics or comparison output", () => {
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
        ],
        options: {
          includeTimeline: false,
          includeReuxSource: false,
        },
      },
      new Date("2026-05-01T00:00:00.000Z"),
    );

    expect(response.baseline.timeline).toEqual([]);
    expect(response.scenarios[0].timeline).toEqual([]);
    expect(response.scenarios[0].finalMetrics.marginDelta).toBeGreaterThan(response.baseline.finalMetrics.marginDelta);
    expect(response.comparison.metricDeltasByScenario["process-improvement"].map((delta) => delta.metric)).toEqual(businessSimulatorMetricNames);
    expect(response.comparison.recommendation).toMatchObject({
      scenarioId: "process-improvement",
      scenarioName: "Process Improvement",
    });
    expect(response.comparison.recommendation?.reasons.length).toBeGreaterThan(0);
    expect(response.comparison.recommendation?.tradeoffs.length).toBeGreaterThan(0);
    expect(response.comparison.recommendation?.watchouts.length).toBeGreaterThan(0);
    expect(response.comparison.recommendation?.recommendedAction).toContain("Process Improvement");
    expect(response.comparison.recommendation?.keyMetricDeltas).toHaveLength(4);
    expect(response.comparison.recommendation?.whatChangedFromBaseline.length).toBeGreaterThan(0);
    expect(response).not.toHaveProperty("reuxSource");
  });

  it("lists templates, loads a template, and compares already-run scenarios", () => {
    expect(listBusinessSimulations().simulations.map((simulation) => simulation.id)).toEqual([
      "operations-decision",
      "capacity-planning",
      "staffing-plan",
      "pricing-strategy",
    ]);
    const template = getBusinessSimulation("operations-decision");
    expect(template.defaultAssumptions).toEqual(businessSimulatorDefaultAssumptions);
    expect(template.exampleScenarios.length).toBeGreaterThan(0);

    const run = runBusinessSimulator(
      {
        baseline: businessSimulatorDefaultAssumptions,
        scenarios: template.exampleScenarios.slice(0, 2),
      },
      new Date("2026-05-01T00:00:00.000Z"),
    );
    const comparison = compareBusinessSimulatorScenarios(
      {
        baseline: run.baseline,
        scenarios: run.scenarios,
      },
      new Date("2026-05-01T00:00:00.000Z"),
    );

    expect(comparison.comparison.baselineScenarioId).toBe("baseline");
    expect(comparison.comparison.recommendedScenarioId).toBeTruthy();
    expect(comparison.comparison.scenarioRanking[0]).toMatchObject({
      rank: 1,
      recommended: true,
      scoreGapFromBest: 0,
    });
    expect(comparison.comparison.recommendation?.summary).toContain("strongest blended score");
    expect(comparison.comparison.metricDeltasByScenario["process-improvement"]).toHaveLength(businessSimulatorMetricNames.length);
    expect(comparison.generatedAt).toBe("2026-05-01T00:00:00.000Z");
  });

  it("includes a capacity-planning decision template for sellable product pilots", () => {
    const template = getBusinessSimulation("capacity-planning");

    expect(template.simulation).toMatchObject({
      id: "capacity-planning",
      name: "Capacity Planning Simulator",
      domain: "operations",
      status: "ready",
    });
    expect(template.defaultAssumptions.weeklyDemand).toBe(980);
    expect(template.defaultAssumptions.forecastPeriods).toBe(16);
    expect(template.exampleScenarios.map((scenario) => scenario.id)).toEqual([
      "add-shift",
      "automation-assist",
      "quality-investment",
      "demand-spike",
    ]);

    const response = runBusinessSimulator(
      {
        name: "Capacity Pilot",
        simulationId: "capacity-planning",
        baseline: template.defaultAssumptions,
        scenarios: template.exampleScenarios.slice(0, 2),
        options: {
          includeReuxSource: true,
        },
      },
      new Date("2026-05-01T00:00:00.000Z"),
    );

    expect(response.simulation.id).toBe("capacity-planning");
    expect(response.scenarios.map((scenario) => scenario.id)).toEqual(["add-shift", "automation-assist"]);
    expect(response.comparison.recommendation?.whyThisWon).toContain("is recommended because");
    expect(response.comparison.recommendation?.decisionSummary).toContain("recommendation because");
    expect(response.comparison.recommendation?.confidenceSummary).toContain("confidence");
    expect(response.reuxSource).toContain("simulate capacity_planning");
  });

  it("includes a staffing-plan decision template for workforce pilots", () => {
    const template = getBusinessSimulation("staffing-plan");

    expect(template.simulation).toMatchObject({
      id: "staffing-plan",
      name: "Staffing Plan Simulator",
      domain: "workforce",
      status: "ready",
    });
    expect(template.defaultAssumptions.employees).toBe(34);
    expect(template.defaultAssumptions.averageHourlyCost).toBe(41);
    expect(template.exampleScenarios.map((scenario) => scenario.id)).toEqual([
      "hire-team",
      "cross-train",
      "automation-buffer",
      "lean-coverage",
    ]);

    const response = runBusinessSimulator(
      {
        name: "Staffing Pilot",
        simulationId: "staffing-plan",
        baseline: template.defaultAssumptions,
        scenarios: template.exampleScenarios.slice(0, 3),
        options: {
          includeReuxSource: true,
        },
      },
      new Date("2026-05-03T00:00:00.000Z"),
    );

    expect(response.simulation.id).toBe("staffing-plan");
    expect(response.scenarios.map((scenario) => scenario.id)).toEqual(["hire-team", "cross-train", "automation-buffer"]);
    expect(response.comparison.recommendation?.recommendedAction).toContain(response.comparison.recommendation?.scenarioName);
    expect(response.comparison.recommendation?.whatChangedFromBaseline.length).toBeGreaterThan(0);
    expect(response.reuxSource).toContain("simulate staffing_plan");
  });

  it("includes a pricing-strategy decision template for commercial pilots", () => {
    const template = getBusinessSimulation("pricing-strategy");

    expect(template.simulation).toMatchObject({
      id: "pricing-strategy",
      name: "Pricing Strategy Simulator",
      domain: "finance",
      status: "ready",
    });
    expect(template.defaultAssumptions.averageOrderValue).toBe(120);
    expect(template.defaultAssumptions.grossMarginRate).toBe(0.44);
    expect(template.exampleScenarios.map((scenario) => scenario.id)).toEqual([
      "premium-price",
      "volume-discount",
      "margin-protect",
      "market-push",
    ]);

    const response = runBusinessSimulator(
      {
        name: "Pricing Pilot",
        simulationId: "pricing-strategy",
        baseline: template.defaultAssumptions,
        scenarios: template.exampleScenarios.slice(0, 3),
        options: {
          includeReuxSource: true,
        },
      },
      new Date("2026-05-03T00:00:00.000Z"),
    );

    expect(response.simulation.id).toBe("pricing-strategy");
    expect(response.scenarios.map((scenario) => scenario.id)).toEqual(["premium-price", "volume-discount", "margin-protect"]);
    expect(response.comparison.recommendation?.keyMetricDeltas.map((delta) => delta.metric)).toEqual([
      "marginDelta",
      "productivity",
      "operatingCost",
      "riskScore",
    ]);
    expect(response.comparison.recommendation?.riskSummary).toBeTruthy();
    expect(response.reuxSource).toContain("simulate pricing_strategy");
  });

  it("emits a deterministic frontend handoff fixture", () => {
    const fixture = createBusinessSimulatorContractFixture(new Date("2026-05-01T00:00:00.000Z"));

    expect(fixture.contractVersion).toBe("2026-05-02");
    expect(fixture.endpoints.runSimulation).toBe("POST /api/simulations/run");
    expect(fixture.limits.maxRunScenarios).toBe(8);
    expect(fixture.templateResponse.simulation.id).toBe("operations-decision");
    expect(fixture.runRequest.options?.includeReuxSource).toBe(true);
    expect(fixture.runRequest.name).toBe("Contract Fixture Business Simulation");
    expect(fixture.runResponse.reuxSource).toContain("simulate operations_decision");
    expect(fixture.runResponse.comparison.recommendedScenarioId).toBeTruthy();
    expect(fixture.runResponse.comparison.recommendation?.decisionSummary).toContain("recommendation because");
    expect(fixture.runResponse.comparison.recommendation?.recommendedAction).toBeTruthy();
    expect(fixture.compareResponse.comparison.metricDeltasByScenario["process-improvement"]).toBeTruthy();
    expect(fixture.frontendMapping.ratesAreDecimals).toBe(true);
    expect(fixture.invalidRunResponse.code).toBe("business_simulator_validation_failed");
    expect(fixture.invalidRunResponse.issues[0].path).toBe("$.baseline.grossMarginRate");

    const emitted = JSON.parse(emitBusinessSimulatorContractFixture(new Date("2026-05-01T00:00:00.000Z")));
    expect(emitted.generatedAt).toBe("2026-05-01T00:00:00.000Z");
    expect(emitted.runResponse.generatedAt).toBe("2026-05-01T00:00:00.000Z");
    expect(emitted.invalidRunResponse.issues[0].message).toBe("must be between 0 and 1");
  });

  it("rejects malformed run requests with stable validation paths", () => {
    expect(() =>
      assertBusinessSimulatorRunRequest({
        baseline: {
          ...businessSimulatorDefaultAssumptions,
          grossMarginRate: 1.5,
          forecastUnit: "year",
        },
        scenarios: [
          {
            id: "",
            name: "Bad Scenario",
            assumptions: {
              forecastPeriods: 6,
              unknownField: 1,
            },
          },
        ],
        options: {
          includeTimeline: "yes",
        },
      }),
    ).toThrow(BusinessSimulatorValidationError);

    try {
      assertBusinessSimulatorRunRequest({
        baseline: {
          ...businessSimulatorDefaultAssumptions,
          grossMarginRate: 1.5,
          forecastUnit: "year",
        },
        scenarios: [
          {
            id: "",
            name: "Bad Scenario",
            assumptions: {
              forecastPeriods: 6,
              unknownField: 1,
            },
          },
        ],
        options: {
          includeTimeline: "yes",
        },
      });
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessSimulatorValidationError);
      const issues = (error as BusinessSimulatorValidationError).issues.map((issue) => issue.path);
      expect(issues).toContain("$.baseline.grossMarginRate");
      expect(issues).toContain("$.baseline.forecastUnit");
      expect(issues).toContain("$.scenarios[0].id");
      expect(issues).toContain("$.scenarios[0].assumptions.forecastPeriods");
      expect(issues).toContain("$.scenarios[0].assumptions.unknownField");
      expect(issues).toContain("$.options.includeTimeline");
    }
  });

  it("rejects unsupported simulations and duplicate scenario IDs with stable validation paths", () => {
    try {
      assertBusinessSimulatorRunRequest({
        simulationId: "unknown-simulation",
        baseline: businessSimulatorDefaultAssumptions,
        scenarios: [
          {
            id: "duplicate",
            name: "First",
            assumptions: {
              productivityGainRate: 0.12,
            },
          },
          {
            id: "duplicate",
            name: "Second",
            assumptions: {
              overtimeReductionRate: 0.2,
            },
          },
        ],
      });
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessSimulatorValidationError);
      const issueMap = new Map((error as BusinessSimulatorValidationError).issues.map((issue) => [issue.path, issue.message]));
      expect(issueMap.get("$.simulationId")).toBe("must be one of operations-decision, capacity-planning, staffing-plan, pricing-strategy");
      expect(issueMap.get("$.scenarios[1].id")).toBe("must be unique");
    }
  });

  it("rejects oversized or unstable run request inputs with stable validation paths", () => {
    try {
      assertBusinessSimulatorRunRequest({
        name: "x".repeat(businessSimulatorLimits.maxScenarioNameLength + 1),
        baseline: {
          ...businessSimulatorDefaultAssumptions,
          forecastPeriods: businessSimulatorLimits.maxForecastPeriods + 1,
        },
        scenarios: Array.from({ length: businessSimulatorLimits.maxRunScenarios + 1 }, (_, index) => ({
          id: index === 0 ? "bad id with spaces" : `scenario-${index}`,
          name: index === 1 ? "" : `Scenario ${index}`,
          description: index === 2 ? "x".repeat(businessSimulatorLimits.maxScenarioDescriptionLength + 1) : undefined,
          assumptions: {
            productivityGainRate: 0.1,
          },
        })),
      });
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessSimulatorValidationError);
      const issueMap = new Map((error as BusinessSimulatorValidationError).issues.map((issue) => [issue.path, issue.message]));
      expect(issueMap.get("$.name")).toBe("name must be 120 characters or fewer");
      expect(issueMap.get("$.baseline.forecastPeriods")).toBe("must be 52 or less");
      expect(issueMap.get("$.scenarios")).toBe("must contain 8 or fewer scenarios");
      expect(issueMap.get("$.scenarios[0].id")).toContain("must use letters");
      expect(issueMap.get("$.scenarios[1].name")).toBe("must be a non-empty name");
      expect(issueMap.get("$.scenarios[2].description")).toBe("description must be 500 characters or fewer");
    }
  });

  it("rejects malformed compare requests with stable validation paths", () => {
    const run = runBusinessSimulator(
      {
        baseline: businessSimulatorDefaultAssumptions,
        scenarios: [
          {
            id: "process-improvement",
            name: "Process Improvement",
            assumptions: {
              productivityGainRate: 0.12,
            },
          },
        ],
      },
      new Date("2026-05-01T00:00:00.000Z"),
    );

    try {
      assertBusinessSimulatorCompareRequest({
        baseline: {
          ...run.baseline,
          finalMetrics: {
            ...run.baseline.finalMetrics,
            riskScore: Number.NaN,
            unknownMetric: 10,
          },
        },
        scenarios: [
          run.scenarios[0],
          {
            ...run.scenarios[0],
            name: "",
            finalMetrics: {
              ...run.scenarios[0].finalMetrics,
              marginDelta: "bad",
            },
          },
        ],
      });
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessSimulatorValidationError);
      const issues = (error as BusinessSimulatorValidationError).issues.map((issue) => issue.path);
      expect(issues).toContain("$.baseline.finalMetrics.riskScore");
      expect(issues).toContain("$.baseline.finalMetrics.unknownMetric");
      expect(issues).toContain("$.scenarios[1].id");
      expect(issues).toContain("$.scenarios[1].name");
      expect(issues).toContain("$.scenarios[1].finalMetrics.marginDelta");
    }
  });

  it("rejects oversized compare payloads before they stress public demo clients", () => {
    const run = runBusinessSimulator(
      {
        baseline: businessSimulatorDefaultAssumptions,
        scenarios: [
          {
            id: "process-improvement",
            name: "Process Improvement",
            assumptions: {
              productivityGainRate: 0.12,
            },
          },
        ],
      },
      new Date("2026-05-01T00:00:00.000Z"),
    );
    const oversizedTimeline = Array.from({ length: businessSimulatorLimits.maxTimelinePoints + 1 }, (_, index) => ({
      period: index + 1,
      label: `${index + 1} weeks`,
      metrics: run.baseline.finalMetrics,
    }));

    try {
      assertBusinessSimulatorCompareRequest({
        baseline: {
          ...run.baseline,
          timeline: oversizedTimeline,
        },
        scenarios: Array.from({ length: businessSimulatorLimits.maxCompareScenarios + 1 }, (_, index) => ({
          ...run.scenarios[0],
          id: `scenario-${index}`,
          name: `Scenario ${index}`,
        })),
      });
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessSimulatorValidationError);
      const issueMap = new Map((error as BusinessSimulatorValidationError).issues.map((issue) => [issue.path, issue.message]));
      expect(issueMap.get("$.baseline.timeline")).toBe("must contain 52 or fewer points");
      expect(issueMap.get("$.scenarios")).toBe("must contain 12 or fewer scenario results");
    }
  });
});
