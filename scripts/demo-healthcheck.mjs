const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npm run demo:healthcheck -- [url] [--deep] [--smoke] [--allow-shared-smoke]

Modes:
  default              Check /api/health only.
  --deep              Also check outbox stats, CORS, saved runs, and simulation API endpoints.
  --smoke             Run deep checks plus a public reset/transaction/outbox smoke in an isolated session.

Options:
  --allow-shared-smoke  Allow smoke mode against shared-session local demos. Avoid this for public deployments.
  --session-id=<id>      Isolated smoke session id. Defaults to healthcheck.

Environment:
  REUX_HEALTHCHECK_TIMEOUT_MS  Per-request timeout in milliseconds. Defaults to 10000.
  REUX_HEALTHCHECK_SESSION_ID  Isolated smoke session id. Defaults to healthcheck.
`);
  process.exit(0);
}
const target = args.find((arg) => !arg.startsWith("--")) ?? `http://127.0.0.1:${process.env.REUX_DEMO_PORT ?? "4173"}`;
const smoke = args.includes("--smoke");
const deep = args.includes("--deep") || smoke;
const allowSharedSmoke = args.includes("--allow-shared-smoke");
const smokeSessionId = normalizeSessionId(
  args.find((arg) => arg.startsWith("--session-id="))?.slice("--session-id=".length) ??
    process.env.REUX_HEALTHCHECK_SESSION_ID ??
    "healthcheck",
);
const timeoutMs = Number.parseInt(process.env.REUX_HEALTHCHECK_TIMEOUT_MS ?? "10000", 10);
const startedAt = Date.now();

try {
  const baseUrl = new URL(target);
  const health = await fetchJson(baseUrl, "/api/health");
  const checks = [health];
  let commerceOutbox = null;
  let logisticsOutbox = null;
  let businessReport = null;
  let reuxSimulationReport = null;
  let smokeReport = null;
  if (deep) {
    commerceOutbox = await fetchJson(baseUrl, "/api/outbox/stats");
    logisticsOutbox = await fetchJson(baseUrl, "/api/logistics/outbox/stats");
    businessReport = await runBusinessSimulatorApiCheck(baseUrl);
    reuxSimulationReport = await runReuxSimulationApiCheck(baseUrl);
    checks.push(commerceOutbox, logisticsOutbox, ...businessReport.checks, ...reuxSimulationReport.checks);
  }
  if (smoke) {
    smokeReport = await runSmokeCheck(baseUrl, health.body);
    checks.push(...smokeReport.checks);
  }
  const diagnostics = [
    ...validateHealth(health.response, health.body),
    ...(deep ? validateOutboxStats(commerceOutbox?.response, commerceOutbox?.body, "commerce") : []),
    ...(deep ? validateOutboxStats(logisticsOutbox?.response, logisticsOutbox?.body, "logistics") : []),
    ...(businessReport?.diagnostics ?? []),
    ...(reuxSimulationReport?.diagnostics ?? []),
    ...(smokeReport?.diagnostics ?? []),
  ];
  const report = {
    ok: diagnostics.length === 0,
    url: baseUrl.toString(),
    mode: smoke ? "smoke" : deep ? "deep" : "health",
    latencyMs: Date.now() - startedAt,
    diagnostics,
    businessSimulator: businessReport?.summary,
    reuxSimulations: reuxSimulationReport?.summary,
    smoke: smokeReport?.summary,
    checks: checks.map((check) => ({
      path: check.path,
      status: check.response.status,
      body: check.body,
    })),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    url: target,
    latencyMs: Date.now() - startedAt,
    diagnostics: [error instanceof Error ? error.message : String(error)],
  }, null, 2));
  process.exitCode = 1;
}

async function runReuxSimulationApiCheck(baseUrl) {
  const diagnostics = [];
  const checks = [];

  const list = await fetchJson(baseUrl, "/api/reux/simulations");
  checks.push(list);
  diagnostics.push(...validateReuxSimulationList(list.response, list.body));

  const templateId = list.body?.simulations?.find((simulation) => simulation.name === "personal_finance")?.name ?? "personal_finance";
  const template = await fetchJson(baseUrl, `/api/reux/simulations/${encodeURIComponent(templateId)}`);
  checks.push(template);
  diagnostics.push(...validateReuxSimulationTemplate(template.response, template.body, templateId));

  const run = await fetchJson(baseUrl, `/api/reux/simulations/${encodeURIComponent(templateId)}/run`, {
    method: "POST",
    body: {
      assumptions: {
        income: 6200,
      },
      scenarios: [
        {
          name: "lower_rent_healthcheck",
          overrides: {
            rent: 1100,
          },
        },
      ],
    },
  });
  checks.push(run);
  diagnostics.push(...validateReuxSimulationRun(run.response, run.body, templateId));

  const invalidRun = await fetchJson(baseUrl, `/api/reux/simulations/${encodeURIComponent(templateId)}/run`, {
    method: "POST",
    body: {
      assumptions: {
        income: "too much",
      },
    },
  });
  checks.push(invalidRun);
  diagnostics.push(...validateReuxSimulationValidationError(invalidRun.response, invalidRun.body, "$.assumptions.income"));

  return {
    diagnostics,
    checks,
    summary: {
      simulationCount: list.body?.simulations?.length ?? 0,
      templateId,
      scenarioCount: run.body?.run?.scenarios?.length ?? 0,
      validationIssues: invalidRun.body?.issues?.length ?? 0,
    },
  };
}

async function fetchJson(baseUrl, path, options = {}) {
  const url = new URL(path, baseUrl);
  const headers = {
    ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    ...(options.headers ?? {}),
  };
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : 10000),
  });
  return {
    path,
    response,
    body: await readJson(response),
  };
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function runBusinessSimulatorApiCheck(baseUrl) {
  const diagnostics = [];
  const checks = [];
  const headers = smokeSessionId ? { "x-reux-demo-session": smokeSessionId } : {};

  const preflight = await fetchJson(baseUrl, "/api/simulations/run", {
    method: "OPTIONS",
    headers: {
      origin: "https://reuben-web.vercel.app",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  checks.push(preflight);
  diagnostics.push(...validateBusinessSimulatorCors(preflight.response));

  const list = await fetchJson(baseUrl, "/api/simulations");
  checks.push(list);
  diagnostics.push(...validateSimulationList(list.response, list.body));

  const templateId = list.body?.simulations?.[0]?.id ?? "operations-decision";
  const template = await fetchJson(baseUrl, `/api/simulations/${encodeURIComponent(templateId)}`);
  checks.push(template);
  diagnostics.push(...validateSimulationTemplate(template.response, template.body, templateId));

  const capacityTemplate = await fetchJson(baseUrl, "/api/simulations/capacity-planning");
  checks.push(capacityTemplate);
  diagnostics.push(...validateSimulationTemplate(capacityTemplate.response, capacityTemplate.body, "capacity-planning"));

  const runRequest = {
    name: "Healthcheck Business Simulation",
    simulationId: templateId,
    baseline: template.body?.defaultAssumptions ?? {
      employees: 50,
      averageHourlyCost: 32,
      weeklyDemand: 1200,
      averageOrderValue: 85,
      grossMarginRate: 0.42,
      productivityGainRate: 0.08,
      overtimeReductionRate: 0.1,
      supplierDelayRiskRate: 0.12,
      defectRate: 0.025,
      forecastPeriods: 12,
      forecastUnit: "week",
    },
    scenarios: template.body?.exampleScenarios?.slice(0, 2) ?? [
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
  };
  const run = await fetchJson(baseUrl, "/api/simulations/run", {
    method: "POST",
    headers,
    body: runRequest,
  });
  checks.push(run);
  diagnostics.push(...validateSimulationRun(run.response, run.body, templateId));
  const runId = run.body?.run?.id;

  let savedRun = null;
  let savedRunList = null;
  let missingSavedRun = null;
  if (runId) {
    savedRun = await fetchJson(baseUrl, `/api/simulation-runs/${encodeURIComponent(runId)}`, { headers });
    checks.push(savedRun);
    diagnostics.push(...validateSavedSimulationRun(savedRun.response, savedRun.body, runId));

    savedRunList = await fetchJson(baseUrl, "/api/simulation-runs", { headers });
    checks.push(savedRunList);
    diagnostics.push(...validateSavedSimulationRunList(savedRunList.response, savedRunList.body, runId));
  }

  const missingRunId = "live_healthcheck_missing";
  missingSavedRun = await fetchJson(baseUrl, `/api/simulation-runs/${missingRunId}`, { headers });
  checks.push(missingSavedRun);
  diagnostics.push(...validateMissingSavedSimulationRun(missingSavedRun.response, missingSavedRun.body, missingRunId));

  const compare = await fetchJson(baseUrl, "/api/scenarios/compare", {
    method: "POST",
    body: {
      baseline: run.body?.baseline,
      scenarios: run.body?.scenarios,
    },
  });
  checks.push(compare);
  diagnostics.push(...validateScenarioCompare(compare.response, compare.body, run.body?.scenarios));

  const invalidRun = await fetchJson(baseUrl, "/api/simulations/run", {
    method: "POST",
    headers,
    body: {
      simulationId: templateId,
      baseline: {
        ...(template.body?.defaultAssumptions ?? runRequest.baseline),
        grossMarginRate: 1.5,
      },
      scenarios: [
        {
          id: "",
          name: "Invalid Scenario",
          assumptions: {
            forecastPeriods: 6,
          },
        },
      ],
    },
  });
  checks.push(invalidRun);
  diagnostics.push(...validateBusinessSimulatorValidationError(invalidRun.response, invalidRun.body, "$.baseline.grossMarginRate"));

  return {
    diagnostics,
    checks,
    summary: {
      templateId,
      templateCount: list.body?.simulations?.length ?? 0,
      capacityTemplateReady: capacityTemplate?.body?.simulation?.id === "capacity-planning",
      scenarioCount: run.body?.scenarios?.length ?? 0,
      savedRunId: runId ?? null,
      savedRunReloaded: savedRun?.body?.run?.id === runId,
      recentRunListed: Boolean(savedRunList?.body?.runs?.some((candidate) => candidate.id === runId)),
      missingRunHandled: missingSavedRun?.response?.status === 404 && missingSavedRun?.body?.code === "not_found",
      recommendedScenarioId: run.body?.comparison?.recommendedScenarioId ?? null,
      reuxSource: typeof run.body?.reuxSource === "string" && run.body.reuxSource.includes("simulate operations_decision"),
      validationIssues: invalidRun.body?.issues?.length ?? 0,
    },
  };
}

async function runSmokeCheck(baseUrl, healthBody) {
  const diagnostics = [];
  const checks = [];
  if (healthBody?.sessionMode !== "isolated" && !allowSharedSmoke) {
    return {
      diagnostics: ["smoke mode requires isolated sessions; pass --allow-shared-smoke only for disposable local demos"],
      checks,
      summary: { skipped: true, reason: "session mode is not isolated" },
    };
  }
  if (!smokeSessionId) {
    return {
      diagnostics: ["smoke mode requires a session id with at least 8 alphanumeric characters"],
      checks,
      summary: { skipped: true, reason: "invalid smoke session id" },
    };
  }

  const sessionId = smokeSessionId;
  const headers = { "x-reux-demo-session": sessionId };
  const commerce = await smokeDomain(baseUrl, {
    domain: "commerce",
    resetPath: "/api/session/reset",
    dashboardPath: "/api/dashboard",
    actionPath: "/api/actions/credit-account",
    processPath: "/api/actions/process-outbox",
    headers,
  });
  const logistics = await smokeDomain(baseUrl, {
    domain: "logistics",
    resetPath: "/api/logistics/session/reset",
    dashboardPath: "/api/logistics/dashboard",
    actionPath: "/api/logistics/actions/start-shipment",
    processPath: "/api/logistics/actions/process-outbox",
    headers,
  });

  checks.push(...commerce.checks, ...logistics.checks);
  diagnostics.push(...commerce.diagnostics, ...logistics.diagnostics);
  return {
    diagnostics,
    checks,
    summary: {
      sessionId,
      commerce: commerce.summary,
      logistics: logistics.summary,
    },
  };
}

async function smokeDomain(baseUrl, config) {
  const diagnostics = [];
  const checks = [];

  const reset = await fetchJson(baseUrl, config.resetPath, { method: "POST", body: {}, headers: config.headers });
  checks.push(reset);
  if (!reset.response.ok || reset.body?.ok !== true) {
    diagnostics.push(`${config.domain} smoke reset failed`);
  }

  const initial = await fetchJson(baseUrl, config.dashboardPath, { headers: config.headers });
  checks.push(initial);
  diagnostics.push(...validateDashboardQueue(initial.response, initial.body, config.domain, "initial", { pending: 0, active: 0, health: "clear" }));

  const action = await fetchJson(baseUrl, config.actionPath, { method: "POST", body: {}, headers: config.headers });
  checks.push(action);
  if (!action.response.ok || action.body?.ok !== true) {
    diagnostics.push(`${config.domain} smoke action failed`);
  }

  const afterAction = await fetchJson(baseUrl, config.dashboardPath, { headers: config.headers });
  checks.push(afterAction);
  diagnostics.push(...validateDashboardQueue(afterAction.response, afterAction.body, config.domain, "after action", { minPending: 1, minActive: 1, health: "working" }));

  const processed = await fetchJson(baseUrl, config.processPath, { method: "POST", body: {}, headers: config.headers });
  checks.push(processed);
  if (!processed.response.ok || processed.body?.ok !== true) {
    diagnostics.push(`${config.domain} smoke outbox processing failed`);
  }

  const afterProcess = await fetchJson(baseUrl, config.dashboardPath, { headers: config.headers });
  checks.push(afterProcess);
  diagnostics.push(...validateDashboardQueue(afterProcess.response, afterProcess.body, config.domain, "after processing", { pending: 0, active: 0, health: "clear" }));

  return {
    diagnostics,
    checks,
    summary: {
      initial: queueSummary(initial.body),
      afterAction: queueSummary(afterAction.body),
      afterProcess: queueSummary(afterProcess.body),
    },
  };
}

function validateOutboxStats(response, body, domain) {
  const diagnostics = [];
  if (!response) {
    diagnostics.push(`missing ${domain} outbox stats response`);
    return diagnostics;
  }
  if (!response.ok) diagnostics.push(`expected 2xx ${domain} outbox stats response, got ${response.status}`);
  if (body?.ok !== true) diagnostics.push(`${domain} outbox stats body did not include ok=true`);
  if (body?.domain !== domain) diagnostics.push(`${domain} outbox stats body reported domain=${body?.domain ?? "missing"}`);
  if (typeof body?.outbox?.total !== "number") diagnostics.push(`${domain} outbox stats body did not include numeric outbox.total`);
  if (!Array.isArray(body?.outbox?.byStatus)) diagnostics.push(`${domain} outbox stats body did not include outbox.byStatus`);
  if (typeof body?.summary?.active !== "number") diagnostics.push(`${domain} outbox stats body did not include numeric summary.active`);
  if (typeof body?.summary?.pending !== "number") diagnostics.push(`${domain} outbox stats body did not include numeric summary.pending`);
  if (!body?.summary?.health) diagnostics.push(`${domain} outbox stats body did not include summary.health`);
  return diagnostics;
}

function validateBusinessSimulatorCors(response) {
  const diagnostics = [];
  if (response.status !== 204) diagnostics.push(`business simulator CORS preflight expected 204, got ${response.status}`);
  const allowOrigin = response.headers.get("access-control-allow-origin");
  if (!allowOrigin) diagnostics.push("business simulator CORS preflight did not include access-control-allow-origin");
  const allowMethods = response.headers.get("access-control-allow-methods") ?? "";
  if (!allowMethods.includes("POST") || !allowMethods.includes("OPTIONS")) {
    diagnostics.push("business simulator CORS preflight did not allow POST and OPTIONS");
  }
  const allowHeaders = response.headers.get("access-control-allow-headers") ?? "";
  if (!allowHeaders.toLowerCase().includes("content-type")) {
    diagnostics.push("business simulator CORS preflight did not allow content-type");
  }
  return diagnostics;
}

function validateSimulationList(response, body) {
  const diagnostics = [];
  if (!response.ok) diagnostics.push(`business simulator list expected 2xx, got ${response.status}`);
  if (!Array.isArray(body?.simulations) || body.simulations.length === 0) {
    diagnostics.push("business simulator list did not include simulations");
  }
  if (!body?.simulations?.some((simulation) => simulation.id === "operations-decision")) {
    diagnostics.push("business simulator list did not include operations-decision");
  }
  if (!body?.simulations?.some((simulation) => simulation.id === "capacity-planning")) {
    diagnostics.push("business simulator list did not include capacity-planning");
  }
  return diagnostics;
}

function validateReuxSimulationList(response, body) {
  const diagnostics = [];
  if (!response.ok) diagnostics.push(`Reux simulation list expected 2xx, got ${response.status}`);
  if (!Array.isArray(body?.simulations) || body.simulations.length === 0) {
    diagnostics.push("Reux simulation list did not include simulations");
  }
  if (!body?.simulations?.some((simulation) => simulation.name === "personal_finance")) {
    diagnostics.push("Reux simulation list did not include personal_finance");
  }
  if (!body?.simulations?.some((simulation) => simulation.name === "operations_throughput")) {
    diagnostics.push("Reux simulation list did not include operations_throughput");
  }
  return diagnostics;
}

function validateReuxSimulationTemplate(response, body, expectedName) {
  const diagnostics = [];
  if (!response.ok) diagnostics.push(`Reux simulation template expected 2xx, got ${response.status}`);
  if (body?.simulation?.name !== expectedName) {
    diagnostics.push(`Reux simulation template expected name=${expectedName}, got ${body?.simulation?.name ?? "missing"}`);
  }
  if (!Array.isArray(body?.simulation?.assumptions) || body.simulation.assumptions.length === 0) {
    diagnostics.push("Reux simulation template did not include assumptions");
  }
  if (!Array.isArray(body?.simulation?.metrics) || body.simulation.metrics.length === 0) {
    diagnostics.push("Reux simulation template did not include metrics");
  }
  if (!body?.sourceFile) diagnostics.push("Reux simulation template did not include sourceFile");
  return diagnostics;
}

function validateReuxSimulationRun(response, body, expectedName) {
  const diagnostics = [];
  if (!response.ok) diagnostics.push(`Reux simulation run expected 2xx, got ${response.status}`);
  if (body?.simulation?.name !== expectedName) {
    diagnostics.push(`Reux simulation run expected name=${expectedName}, got ${body?.simulation?.name ?? "missing"}`);
  }
  if (!Array.isArray(body?.run?.periods) || body.run.periods.length === 0) {
    diagnostics.push("Reux simulation run did not include periods");
  }
  if (!Array.isArray(body?.run?.scenarios) || body.run.scenarios.length < 2) {
    diagnostics.push("Reux simulation run did not include baseline and runtime scenario");
  }
  if (!body?.run?.comparison?.metricRankings?.length) {
    diagnostics.push("Reux simulation run did not include comparison metric rankings");
  }
  if (!body?.generatedAt) diagnostics.push("Reux simulation run did not include generatedAt");
  return diagnostics;
}

function validateReuxSimulationValidationError(response, body, expectedPath) {
  const diagnostics = [];
  if (response.status !== 400) diagnostics.push(`Reux simulation invalid run expected 400, got ${response.status}`);
  if (body?.ok !== false) diagnostics.push("Reux simulation validation error did not include ok=false");
  if (body?.code !== "simulation_execution_validation_failed") {
    diagnostics.push(`Reux simulation validation error had unexpected code=${body?.code ?? "missing"}`);
  }
  if (!Array.isArray(body?.issues) || body.issues.length === 0) {
    diagnostics.push("Reux simulation validation error did not include issues");
  }
  if (!body?.issues?.some((issue) => issue.path === expectedPath)) {
    diagnostics.push(`Reux simulation validation error did not include issue path ${expectedPath}`);
  }
  return diagnostics;
}

function validateSimulationTemplate(response, body, expectedId) {
  const diagnostics = [];
  if (!response.ok) diagnostics.push(`business simulator template expected 2xx, got ${response.status}`);
  if (body?.simulation?.id !== expectedId) {
    diagnostics.push(`business simulator template expected id=${expectedId}, got ${body?.simulation?.id ?? "missing"}`);
  }
  for (const field of ["employees", "averageHourlyCost", "weeklyDemand", "averageOrderValue", "grossMarginRate", "forecastPeriods", "forecastUnit"]) {
    if (body?.defaultAssumptions?.[field] === undefined) {
      diagnostics.push(`business simulator template defaultAssumptions missing ${field}`);
    }
  }
  if (!Array.isArray(body?.exampleScenarios) || body.exampleScenarios.length === 0) {
    diagnostics.push("business simulator template did not include exampleScenarios");
  }
  return diagnostics;
}

function validateSimulationRun(response, body, expectedId) {
  const diagnostics = [];
  if (!response.ok) diagnostics.push(`business simulator run expected 2xx, got ${response.status}`);
  if (body?.simulation?.id !== expectedId) {
    diagnostics.push(`business simulator run expected simulation id=${expectedId}, got ${body?.simulation?.id ?? "missing"}`);
  }
  if (body?.baseline?.id !== "baseline") diagnostics.push("business simulator run did not include baseline result");
  if (!Array.isArray(body?.baseline?.timeline) || body.baseline.timeline.length === 0) {
    diagnostics.push("business simulator run baseline did not include a timeline");
  }
  if (!Array.isArray(body?.scenarios) || body.scenarios.length === 0) {
    diagnostics.push("business simulator run did not include scenario results");
  }
  if (!body?.comparison?.recommendedScenarioId) {
    diagnostics.push("business simulator run did not include a recommended scenario");
  }
  diagnostics.push(...validateRecommendationGuidance(body?.comparison?.recommendation));
  if (typeof body?.reuxSource !== "string" || !body.reuxSource.includes("simulate operations_decision")) {
    diagnostics.push("business simulator run did not include Reux source transparency output");
  }
  if (typeof body?.run?.id !== "string" || !body.run.id.startsWith("live_")) {
    diagnostics.push("business simulator run did not include a live_ saved-run id");
  }
  if (body?.run?.simulationId !== expectedId) {
    diagnostics.push(`business simulator saved-run metadata expected simulationId=${expectedId}, got ${body?.run?.simulationId ?? "missing"}`);
  }
  if (!body?.generatedAt) diagnostics.push("business simulator run did not include generatedAt");
  return diagnostics;
}

function validateRecommendationGuidance(recommendation) {
  const diagnostics = [];
  if (!recommendation) {
    diagnostics.push("business simulator run did not include recommendation guidance");
    return diagnostics;
  }
  for (const field of ["decisionSummary", "recommendedAction", "confidenceSummary", "whyThisWon", "riskSummary", "tradeoffSummary"]) {
    if (typeof recommendation[field] !== "string" || recommendation[field].length === 0) {
      diagnostics.push(`business simulator recommendation did not include ${field}`);
    }
  }
  if (!["low", "medium", "high"].includes(recommendation.confidence)) {
    diagnostics.push("business simulator recommendation did not include a valid confidence value");
  }
  if (!Array.isArray(recommendation.watchouts) || recommendation.watchouts.length === 0) {
    diagnostics.push("business simulator recommendation did not include watchouts");
  }
  return diagnostics;
}

function validateSavedSimulationRun(response, body, expectedId) {
  const diagnostics = [];
  if (!response.ok) diagnostics.push(`saved simulation run expected 2xx, got ${response.status}`);
  if (body?.run?.id !== expectedId) {
    diagnostics.push(`saved simulation run expected id=${expectedId}, got ${body?.run?.id ?? "missing"}`);
  }
  if (body?.run?.response?.run?.id !== expectedId) {
    diagnostics.push("saved simulation run response did not include matching run metadata");
  }
  diagnostics.push(...validateSavedSimulationRunSummary(body?.run, expectedId, "saved simulation run"));
  diagnostics.push(...validateSavedSimulationRunSummary(body?.run?.response?.run, expectedId, "saved simulation run response metadata"));
  if (!body?.run?.request?.baseline) {
    diagnostics.push("saved simulation run did not include original request baseline");
  }
  if (!body?.run?.response?.comparison?.recommendedScenarioId) {
    diagnostics.push("saved simulation run did not include response recommendation");
  }
  return diagnostics;
}

function validateSavedSimulationRunList(response, body, expectedId) {
  const diagnostics = [];
  if (!response.ok) diagnostics.push(`saved simulation run list expected 2xx, got ${response.status}`);
  if (!Array.isArray(body?.runs)) {
    diagnostics.push("saved simulation run list did not include runs array");
    return diagnostics;
  }
  if (!body.runs.some((run) => run.id === expectedId)) {
    diagnostics.push(`saved simulation run list did not include ${expectedId}`);
  }
  const listedRun = body.runs.find((run) => run.id === expectedId);
  diagnostics.push(...validateSavedSimulationRunSummary(listedRun, expectedId, "saved simulation run list summary"));
  return diagnostics;
}

function validateMissingSavedSimulationRun(response, body, expectedId) {
  const diagnostics = [];
  if (response.status !== 404) diagnostics.push(`missing saved simulation run expected 404, got ${response.status}`);
  if (body?.ok !== false) diagnostics.push("missing saved simulation run error did not include ok=false");
  if (body?.code !== "not_found") {
    diagnostics.push(`missing saved simulation run error had unexpected code=${body?.code ?? "missing"}`);
  }
  if (typeof body?.message !== "string" || !body.message.includes(expectedId)) {
    diagnostics.push("missing saved simulation run error message did not include the run id");
  }
  return diagnostics;
}

function validateSavedSimulationRunSummary(summary, expectedId, label) {
  const diagnostics = [];
  if (!summary) {
    diagnostics.push(`${label} was missing`);
    return diagnostics;
  }
  if (summary.id !== expectedId) diagnostics.push(`${label} expected id=${expectedId}, got ${summary.id ?? "missing"}`);
  if (typeof summary.name !== "string" || summary.name.length === 0) diagnostics.push(`${label} did not include a display name`);
  if (summary.simulationId !== "operations-decision") diagnostics.push(`${label} had unexpected simulationId=${summary.simulationId ?? "missing"}`);
  if (typeof summary.displayTitle !== "string" || summary.displayTitle.length === 0) diagnostics.push(`${label} did not include displayTitle`);
  if (typeof summary.displaySubtitle !== "string" || !summary.displaySubtitle.includes("scenarios compared")) {
    diagnostics.push(`${label} did not include a scenario comparison displaySubtitle`);
  }
  if (typeof summary.shareLabel !== "string" || !summary.shareLabel.startsWith("Business Simulator result:")) {
    diagnostics.push(`${label} did not include a shareLabel`);
  }
  if (typeof summary.resultSummary !== "string" || summary.resultSummary.length === 0) diagnostics.push(`${label} did not include resultSummary`);
  if (summary.keyMetric?.metric !== "margin" || typeof summary.keyMetric?.value !== "number") {
    diagnostics.push(`${label} did not include a margin keyMetric`);
  }
  if (typeof summary.scenarioCount !== "number" || summary.scenarioCount < 2) diagnostics.push(`${label} did not include baseline plus scenario count`);
  if (typeof summary.bestMargin !== "number") diagnostics.push(`${label} did not include numeric bestMargin`);
  if (typeof summary.bestMarginScenario !== "string" || summary.bestMarginScenario.length === 0) diagnostics.push(`${label} did not include bestMarginScenario`);
  if (!Array.isArray(summary.riskRange) || summary.riskRange.length !== 2) diagnostics.push(`${label} did not include riskRange`);
  if (typeof summary.recommendedScenarioId !== "string" || summary.recommendedScenarioId.length === 0) diagnostics.push(`${label} did not include recommendedScenarioId`);
  if (typeof summary.recommendedScenarioName !== "string" || summary.recommendedScenarioName.length === 0) diagnostics.push(`${label} did not include recommendedScenarioName`);
  if (typeof summary.expiresAt !== "string" || Number.isNaN(Date.parse(summary.expiresAt))) diagnostics.push(`${label} did not include a valid expiresAt timestamp`);
  if (typeof summary.expiryNote !== "string" || !summary.expiryNote.includes(summary.expiresAt)) {
    diagnostics.push(`${label} did not include expiryNote with expiresAt`);
  }
  return diagnostics;
}

function validateScenarioCompare(response, body, scenarios) {
  const diagnostics = [];
  if (!response.ok) diagnostics.push(`business simulator compare expected 2xx, got ${response.status}`);
  if (body?.comparison?.baselineScenarioId !== "baseline") {
    diagnostics.push("business simulator compare did not identify baseline");
  }
  for (const scenario of scenarios ?? []) {
    if (!Array.isArray(body?.comparison?.metricDeltasByScenario?.[scenario.id])) {
      diagnostics.push(`business simulator compare did not include deltas for ${scenario.id}`);
    }
  }
  if (!body?.generatedAt) diagnostics.push("business simulator compare did not include generatedAt");
  return diagnostics;
}

function validateBusinessSimulatorValidationError(response, body, expectedPath) {
  const diagnostics = [];
  if (response.status !== 400) diagnostics.push(`business simulator invalid run expected 400, got ${response.status}`);
  if (body?.ok !== false) diagnostics.push("business simulator validation error did not include ok=false");
  if (body?.code !== "business_simulator_validation_failed") {
    diagnostics.push(`business simulator validation error had unexpected code=${body?.code ?? "missing"}`);
  }
  if (!Array.isArray(body?.issues) || body.issues.length === 0) {
    diagnostics.push("business simulator validation error did not include issues");
  }
  if (!body?.issues?.some((issue) => issue.path === expectedPath)) {
    diagnostics.push(`business simulator validation error did not include issue path ${expectedPath}`);
  }
  if (typeof body?.message !== "string" || !body.message.includes(expectedPath)) {
    diagnostics.push("business simulator validation error message did not include the expected issue path");
  }
  return diagnostics;
}

function validateHealth(response, body) {
  const diagnostics = [];
  if (!response.ok) diagnostics.push(`expected 2xx health response, got ${response.status}`);
  if (body?.ok !== true) diagnostics.push("health body did not include ok=true");
  if (body?.module !== "pilot") diagnostics.push("health body did not identify the pilot module");
  const apiVersionHeader = response.headers.get("x-reux-api-version");
  const buildHeader = response.headers.get("x-reux-build");
  if (!body?.apiVersion) diagnostics.push("health body did not include apiVersion");
  if (!body?.packageVersion) diagnostics.push("health body did not include packageVersion");
  if (!body?.build) diagnostics.push("health body did not include build");
  if (!apiVersionHeader) diagnostics.push("health response did not include x-reux-api-version");
  if (!buildHeader) diagnostics.push("health response did not include x-reux-build");
  if ((response.headers.get("cache-control") ?? "").toLowerCase() !== "no-store") {
    diagnostics.push("health response did not include cache-control=no-store");
  }
  if (apiVersionHeader && body?.apiVersion && apiVersionHeader !== body.apiVersion) {
    diagnostics.push("health apiVersion header did not match body");
  }
  if (buildHeader && body?.build && buildHeader !== body.build) {
    diagnostics.push("health build header did not match body");
  }
  if (!Array.isArray(body?.domains) || !body.domains.includes("commerce") || !body.domains.includes("logistics")) {
    diagnostics.push("health body did not list both commerce and logistics domains");
  }
  if (!body?.databaseUrlEnv) diagnostics.push("health body did not include databaseUrlEnv");
  if (!body?.sessionMode) diagnostics.push("health body did not include sessionMode");
  if (!body?.rateLimit || typeof body.rateLimit.maxRequests !== "number" || typeof body.rateLimit.writeMaxRequests !== "number") {
    diagnostics.push("health body did not include rateLimit max request metadata");
  }
  if (!body?.requests || typeof body.requests.total !== "number" || !Array.isArray(body.requests.routes)) {
    diagnostics.push("health body did not include request counter metadata");
  }
  if (!body?.simulationRuns || typeof body.simulationRuns.records !== "number" || !body.simulationRuns.storage) {
    diagnostics.push("health body did not include saved simulation-run storage metadata");
  }
  return diagnostics;
}

function validateDashboardQueue(response, body, domain, stage, expected) {
  const diagnostics = [];
  if (!response.ok) diagnostics.push(`${domain} ${stage} dashboard expected 2xx, got ${response.status}`);
  if (body?.domain !== domain) diagnostics.push(`${domain} ${stage} dashboard reported domain=${body?.domain ?? "missing"}`);
  const queue = queueSummary(body);
  for (const key of ["pending", "processing", "failed", "dead", "active"]) {
    if (!Number.isFinite(queue[key])) {
      diagnostics.push(`${domain} ${stage} queue ${key} was not numeric`);
    }
  }
  if (expected.health && queue.health !== expected.health) {
    diagnostics.push(`${domain} ${stage} queue health expected ${expected.health}, got ${queue.health}`);
  }
  if (expected.pending !== undefined && queue.pending !== expected.pending) {
    diagnostics.push(`${domain} ${stage} queue pending expected ${expected.pending}, got ${queue.pending}`);
  }
  if (expected.active !== undefined && queue.active !== expected.active) {
    diagnostics.push(`${domain} ${stage} queue active expected ${expected.active}, got ${queue.active}`);
  }
  if (expected.minPending !== undefined && queue.pending < expected.minPending) {
    diagnostics.push(`${domain} ${stage} queue pending expected at least ${expected.minPending}, got ${queue.pending}`);
  }
  if (expected.minActive !== undefined && queue.active < expected.minActive) {
    diagnostics.push(`${domain} ${stage} queue active expected at least ${expected.minActive}, got ${queue.active}`);
  }
  return diagnostics;
}

function queueSummary(body) {
  return {
    health: body?.queue?.health ?? "missing",
    pending: Number(body?.queue?.pending ?? NaN),
    processing: Number(body?.queue?.processing ?? NaN),
    failed: Number(body?.queue?.failed ?? NaN),
    dead: Number(body?.queue?.dead ?? NaN),
    active: Number(body?.queue?.active ?? NaN),
  };
}

function normalizeSessionId(raw) {
  if (!raw) return "";
  const normalized = String(raw).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
  return normalized.length >= 8 ? normalized : "";
}
