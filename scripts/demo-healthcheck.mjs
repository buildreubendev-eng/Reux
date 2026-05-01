const target = process.argv[2] ?? `http://127.0.0.1:${process.env.REUX_DEMO_PORT ?? "4173"}`;
const timeoutMs = Number.parseInt(process.env.REUX_HEALTHCHECK_TIMEOUT_MS ?? "10000", 10);
const startedAt = Date.now();

try {
  const baseUrl = new URL(target);
  const healthUrl = new URL("/api/health", baseUrl);
  const response = await fetch(healthUrl, { signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : 10000) });
  const body = await readJson(response);
  const diagnostics = validateHealth(response, body);
  const report = {
    ok: diagnostics.length === 0,
    url: healthUrl.toString(),
    status: response.status,
    latencyMs: Date.now() - startedAt,
    diagnostics,
    body,
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
