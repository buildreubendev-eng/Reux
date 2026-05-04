import { spawn } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;
const port = process.env.REUX_DEMO_SMOKE_PORT ?? "4185";
const sessionId = process.env.REUX_HEALTHCHECK_SESSION_ID ?? "healthcheckci";
const baseUrl = `http://127.0.0.1:${port}`;
const startupTimeoutMs = Number.parseInt(process.env.REUX_DEMO_SMOKE_STARTUP_TIMEOUT_MS ?? "30000", 10);
const adminToken = process.env.REUX_DEMO_SETUP_TOKEN ?? process.env.REUX_DEMO_SMOKE_ADMIN_TOKEN ?? "local-smoke-admin-token";

if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Example: postgres://datalang:datalang@127.0.0.1:5432/datalang_dev");
  process.exit(1);
}

const server = spawn(process.execPath, ["./demo/pilot-app/server.mjs"], {
  env: {
    ...process.env,
    PORT: port,
    REUX_DEMO_PORT: port,
    REUX_DEMO_SESSION_MODE: "isolated",
    REUX_DEMO_SETUP_TOKEN: adminToken,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
server.stdout.on("data", (chunk) => {
  stdout += chunk;
});
server.stderr.on("data", (chunk) => {
  stderr += chunk;
});

try {
  await waitForHealth(baseUrl);
  await runHealthcheck(baseUrl, sessionId);
  await runPilotLeadSmoke(baseUrl, adminToken);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (stdout.trim()) console.error(`\nDemo server stdout:\n${stdout.trim()}`);
  if (stderr.trim()) console.error(`\nDemo server stderr:\n${stderr.trim()}`);
  process.exitCode = 1;
} finally {
  await stopServer();
}

async function waitForHealth(url) {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`demo server exited before healthcheck; exitCode=${server.exitCode}`);
    }
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) });
      const body = await response.json();
      if (response.ok && body?.ok === true) return;
      lastError = `health returned status=${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`demo server did not become healthy within ${startupTimeoutMs}ms: ${lastError}`);
}

async function runHealthcheck(url, smokeSessionId) {
  const result = await runCommand(process.execPath, [
    "./scripts/demo-healthcheck.mjs",
    url,
    "--smoke",
    `--session-id=${smokeSessionId}`,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`demo smoke healthcheck failed with exit code ${result.exitCode}\n${result.output.trim()}`);
  }
  const report = JSON.parse(result.output);
  console.log(
    `demo smoke ok: session=${report.smoke.sessionId} commerce=${report.smoke.commerce.afterAction.health}->${report.smoke.commerce.afterProcess.health} logistics=${report.smoke.logistics.afterAction.health}->${report.smoke.logistics.afterProcess.health}`,
  );
}

async function runPilotLeadSmoke(url, token) {
  const result = await runCommand(process.execPath, [
    "./scripts/demo-pilot-leads.mjs",
    url,
    `--token=${token}`,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`demo pilot lead smoke failed with exit code ${result.exitCode}\n${result.output.trim()}`);
  }
  const report = JSON.parse(result.output);
  console.log(
    `demo pilot leads ok: request=${report.summary.requestId} status=${report.summary.operatorStatus} storage=${report.summary.storage}`,
  );
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode, output });
    });
  });
}

async function stopServer() {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  const stopped = await Promise.race([
    new Promise((resolve) => server.once("close", () => resolve(true))),
    sleep(5000).then(() => false),
  ]);
  if (!stopped && server.exitCode === null) {
    server.kill("SIGKILL");
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
