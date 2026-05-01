const args = process.argv.slice(2);
const target = args.find((arg) => !arg.startsWith("--")) ?? `http://127.0.0.1:${process.env.REUX_DEMO_PORT ?? "4173"}`;
const deep = args.includes("--deep");
const timeoutMs = Number.parseInt(process.env.REUX_HEALTHCHECK_TIMEOUT_MS ?? "10000", 10);
const startedAt = Date.now();

try {
  const baseUrl = new URL(target);
  const health = await fetchJson(baseUrl, "/api/health");
  const checks = [health];
  if (deep) {
    checks.push(await fetchJson(baseUrl, "/api/outbox/stats"));
    checks.push(await fetchJson(baseUrl, "/api/logistics/outbox/stats"));
  }
  const diagnostics = [
    ...validateHealth(health.response, health.body),
    ...(deep ? validateOutboxStats(checks[1]?.response, checks[1]?.body, "commerce") : []),
    ...(deep ? validateOutboxStats(checks[2]?.response, checks[2]?.body, "logistics") : []),
  ];
  const report = {
    ok: diagnostics.length === 0,
    url: baseUrl.toString(),
    mode: deep ? "deep" : "health",
    latencyMs: Date.now() - startedAt,
    diagnostics,
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

async function fetchJson(baseUrl, path) {
  const url = new URL(path, baseUrl);
  const response = await fetch(url, { signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : 10000) });
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
