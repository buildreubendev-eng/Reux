const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npm run demo:pilot-leads -- [url] [--token=<REUX_DEMO_SETUP_TOKEN>]

Checks the Founder Pilot lead workflow against a running Reux demo service.

Environment:
  REUX_DEMO_SETUP_TOKEN       Admin token used for operator routes.
  REUX_PILOT_LEADS_TOKEN      Alternate admin token env var for this smoke script.
  REUX_PILOT_LEADS_TIMEOUT_MS Per-request timeout in milliseconds. Defaults to 10000.

Examples:
  npm run demo:pilot-leads -- http://127.0.0.1:4173 --token=local-token
  $env:REUX_DEMO_SETUP_TOKEN='...'; npm run demo:pilot-leads -- https://reux-pilot-demo-production.up.railway.app
`);
  process.exit(0);
}

const target = args.find((arg) => !arg.startsWith("--")) ?? `http://127.0.0.1:${process.env.REUX_DEMO_PORT ?? "4173"}`;
const token = argValue("--token=") ?? process.env.REUX_PILOT_LEADS_TOKEN ?? process.env.REUX_DEMO_SETUP_TOKEN ?? "";
const timeoutMs = positiveInteger(Number.parseInt(process.env.REUX_PILOT_LEADS_TIMEOUT_MS ?? "10000", 10), 10000);
const startedAt = Date.now();

try {
  const baseUrl = new URL(target);
  if (!token) {
    throw new Error("operator lead smoke requires an admin token; pass --token=... or set REUX_DEMO_SETUP_TOKEN");
  }

  const report = await runPilotLeadSmoke(baseUrl, token);
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

async function runPilotLeadSmoke(baseUrl, adminToken) {
  const diagnostics = [];
  const checks = [];
  const unique = Date.now().toString(36);
  const notes = `Smoke checked operator workflow at ${new Date().toISOString()}.`;

  const health = await fetchJson(baseUrl, "/api/health");
  checks.push(health);
  diagnostics.push(...validateHealth(health.response, health.body));

  const create = await fetchJson(baseUrl, "/api/pilot-requests", {
    method: "POST",
    body: {
      name: "Reux Smoke Lead",
      email: `reux-smoke-${unique}@example.com`,
      company: "Reuben Internal",
      role: "Smoke Test",
      decision: "We need to verify that founder pilot lead intake, operator listing, and backend status notes all work after deployment.",
      sourceRunId: `smoke_${unique}`,
      pageUrl: "https://reuben-web.vercel.app/simulator",
    },
  });
  checks.push(create);
  diagnostics.push(...validateCreateLead(create.response, create.body));
  const requestId = create.body?.request?.id;

  const adminHeaders = { "x-reux-demo-token": adminToken };
  const list = await fetchJson(baseUrl, "/api/pilot-requests?limit=25", { headers: adminHeaders });
  checks.push(list);
  diagnostics.push(...validateLeadList(list.response, list.body, requestId));

  const detail = await fetchJson(baseUrl, `/api/pilot-requests/${encodeURIComponent(requestId ?? "")}`, { headers: adminHeaders });
  checks.push(detail);
  diagnostics.push(...validateLeadDetail(detail.response, detail.body, requestId));

  const update = await fetchJson(baseUrl, `/api/pilot-requests/${encodeURIComponent(requestId ?? "")}/operator`, {
    method: "PATCH",
    headers: adminHeaders,
    body: {
      status: "scoping",
      notes,
    },
  });
  checks.push(update);
  diagnostics.push(...validateOperatorUpdate(update.response, update.body, requestId, notes));

  const updatedDetail = await fetchJson(baseUrl, `/api/pilot-requests/${encodeURIComponent(requestId ?? "")}`, { headers: adminHeaders });
  checks.push(updatedDetail);
  diagnostics.push(...validateOperatorUpdate(updatedDetail.response, updatedDetail.body, requestId, notes));

  const invalidUpdate = await fetchJson(baseUrl, `/api/pilot-requests/${encodeURIComponent(requestId ?? "")}/operator`, {
    method: "PATCH",
    headers: adminHeaders,
    body: {
      status: "waiting",
    },
  });
  checks.push(invalidUpdate);
  diagnostics.push(...validateInvalidOperatorUpdate(invalidUpdate.response, invalidUpdate.body));

  return {
    ok: diagnostics.length === 0,
    url: baseUrl.toString(),
    latencyMs: Date.now() - startedAt,
    diagnostics,
    summary: {
      requestId: requestId ?? null,
      deliveryStatus: create.body?.delivery?.status ?? null,
      storage: create.body?.storage ?? detail.body?.request?.storage ?? null,
      operatorStatus: updatedDetail.body?.request?.operatorStatus ?? null,
      operatorUpdatedAt: updatedDetail.body?.request?.operatorUpdatedAt ?? null,
      listed: Boolean(list.body?.requests?.some((request) => request.id === requestId)),
    },
    checks: checks.map((check) => ({
      path: check.path,
      status: check.response.status,
      ok: check.response.ok,
      code: check.body?.code,
    })),
  };
}

async function fetchJson(baseUrl, path, options = {}) {
  const headers = {
    ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    ...(options.headers ?? {}),
  };
  const response = await fetch(new URL(path, baseUrl), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(timeoutMs),
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

function validateHealth(response, body) {
  const diagnostics = [];
  if (!response.ok) diagnostics.push(`health expected 2xx, got ${response.status}`);
  if (body?.ok !== true) diagnostics.push("health body did not include ok=true");
  if (!body?.pilotRequests) diagnostics.push("health body did not include pilotRequests status");
  return diagnostics;
}

function validateCreateLead(response, body) {
  const diagnostics = [];
  if (response.status !== 202) diagnostics.push(`create pilot request expected 202, got ${response.status}`);
  if (body?.ok !== true) diagnostics.push("create pilot request body did not include ok=true");
  if (typeof body?.request?.id !== "string" || !body.request.id.startsWith("pilot_")) {
    diagnostics.push("create pilot request did not return a pilot_ request id");
  }
  if (!["sent", "disabled"].includes(body?.delivery?.status)) {
    diagnostics.push(`create pilot request returned unexpected delivery status=${body?.delivery?.status ?? "missing"}`);
  }
  if (!["postgres", "memory"].includes(body?.storage)) {
    diagnostics.push(`create pilot request returned unexpected storage=${body?.storage ?? "missing"}`);
  }
  return diagnostics;
}

function validateLeadList(response, body, requestId) {
  const diagnostics = [];
  if (!response.ok) diagnostics.push(`pilot request list expected 2xx, got ${response.status}`);
  if (!Array.isArray(body?.requests)) diagnostics.push("pilot request list did not include requests array");
  if (requestId && !body?.requests?.some((request) => request.id === requestId)) {
    diagnostics.push(`pilot request list did not include newly-created request ${requestId}`);
  }
  return diagnostics;
}

function validateLeadDetail(response, body, requestId) {
  const diagnostics = [];
  if (!response.ok) diagnostics.push(`pilot request detail expected 2xx, got ${response.status}`);
  if (requestId && body?.request?.id !== requestId) {
    diagnostics.push(`pilot request detail expected id=${requestId}, got ${body?.request?.id ?? "missing"}`);
  }
  if (typeof body?.request?.decision !== "string" || body.request.decision.length === 0) {
    diagnostics.push("pilot request detail did not include decision text");
  }
  return diagnostics;
}

function validateOperatorUpdate(response, body, requestId, notes) {
  const diagnostics = validateLeadDetail(response, body, requestId);
  if (body?.request?.operatorStatus !== "scoping") {
    diagnostics.push(`operator update expected status=scoping, got ${body?.request?.operatorStatus ?? "missing"}`);
  }
  if (body?.request?.operatorNotes !== notes) {
    diagnostics.push("operator update did not persist notes");
  }
  if (typeof body?.request?.operatorUpdatedAt !== "string" || Number.isNaN(Date.parse(body.request.operatorUpdatedAt))) {
    diagnostics.push("operator update did not return a valid operatorUpdatedAt");
  }
  return diagnostics;
}

function validateInvalidOperatorUpdate(response, body) {
  const diagnostics = [];
  if (response.status !== 400) diagnostics.push(`invalid operator update expected 400, got ${response.status}`);
  if (body?.code !== "pilot_request_operator_update_failed") {
    diagnostics.push(`invalid operator update expected pilot_request_operator_update_failed, got ${body?.code ?? "missing"}`);
  }
  if (!Array.isArray(body?.issues) || !body.issues.some((issue) => issue.path === "$.status")) {
    diagnostics.push("invalid operator update did not include $.status validation issue");
  }
  return diagnostics;
}

function argValue(prefix) {
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
