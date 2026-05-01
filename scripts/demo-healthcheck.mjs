const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npm run demo:healthcheck -- [url] [--deep] [--smoke] [--allow-shared-smoke]

Modes:
  default              Check /api/health only.
  --deep              Also check commerce and logistics outbox stats endpoints.
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
  let smokeReport = null;
  if (deep) {
    checks.push(await fetchJson(baseUrl, "/api/outbox/stats"));
    checks.push(await fetchJson(baseUrl, "/api/logistics/outbox/stats"));
  }
  if (smoke) {
    smokeReport = await runSmokeCheck(baseUrl, health.body);
    checks.push(...smokeReport.checks);
  }
  const diagnostics = [
    ...validateHealth(health.response, health.body),
    ...(deep ? validateOutboxStats(checks[1]?.response, checks[1]?.body, "commerce") : []),
    ...(deep ? validateOutboxStats(checks[2]?.response, checks[2]?.body, "logistics") : []),
    ...(smokeReport?.diagnostics ?? []),
  ];
  const report = {
    ok: diagnostics.length === 0,
    url: baseUrl.toString(),
    mode: smoke ? "smoke" : deep ? "deep" : "health",
    latencyMs: Date.now() - startedAt,
    diagnostics,
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

function validateHealth(response, body) {
  const diagnostics = [];
  if (!response.ok) diagnostics.push(`expected 2xx health response, got ${response.status}`);
  if (body?.ok !== true) diagnostics.push("health body did not include ok=true");
  if (body?.module !== "pilot") diagnostics.push("health body did not identify the pilot module");
  if (!Array.isArray(body?.domains) || !body.domains.includes("commerce") || !body.domains.includes("logistics")) {
    diagnostics.push("health body did not list both commerce and logistics domains");
  }
  if (!body?.databaseUrlEnv) diagnostics.push("health body did not include databaseUrlEnv");
  if (!body?.sessionMode) diagnostics.push("health body did not include sessionMode");
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
