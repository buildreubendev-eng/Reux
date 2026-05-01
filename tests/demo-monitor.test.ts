import { spawn } from "node:child_process";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

let server: http.Server | undefined;
let childCleanup: (() => void) | undefined;

afterEach(() => {
  childCleanup?.();
  childCleanup = undefined;
  server?.close();
  server = undefined;
});

describe("demo monitor alerts", () => {
  it("posts a failure alert when a one-shot check fails", async () => {
    const alerts: unknown[] = [];
    server = http.createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        alerts.push(JSON.parse(body || "{}"));
        response.writeHead(204).end();
      });
    });

    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected local alert server address");
    }

    const result = await runMonitor([
      "http://127.0.0.1:9",
      "--once",
      "--alert-webhook-url",
      `http://127.0.0.1:${address.port}/alert`,
    ]);

    expect(result.exitCode).toBe(1);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      event: "reux.demo_monitor.failed",
      url: "http://127.0.0.1:9",
      mode: "health",
      consecutiveFailures: 1,
      check: {
        ok: false,
      },
    });
  });

  it("posts a recovery alert after a transient failure clears", async () => {
    const alerts: unknown[] = [];
    let healthRequests = 0;
    server = http.createServer((request, response) => {
      if (request.url === "/alert") {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => {
          body += chunk;
        });
        request.on("end", () => {
          alerts.push(JSON.parse(body || "{}"));
          response.writeHead(204).end();
        });
        return;
      }

      if (request.url === "/api/health") {
        healthRequests += 1;
        if (healthRequests === 1) {
          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify({ ok: false }));
          return;
        }

        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          ok: true,
          module: "pilot",
          domains: ["commerce", "logistics"],
          databaseUrlEnv: "DATABASE_URL",
          sessionMode: "isolated",
        }));
        return;
      }

      response.writeHead(404).end();
    });

    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected local monitor server address");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const child = spawn(process.execPath, [
      "scripts/demo-monitor.mjs",
      baseUrl,
      "--interval-seconds",
      "0.1",
      "--max-failures",
      "3",
      "--alert-webhook-url",
      `${baseUrl}/alert`,
    ], {
      cwd: process.cwd(),
      stdio: ["ignore", "ignore", "ignore"],
    });
    childCleanup = () => {
      if (!child.killed) child.kill();
    };

    await waitFor(() => alerts.length === 1, 5000);
    expect(alerts[0]).toMatchObject({
      event: "reux.demo_monitor.recovered",
      url: baseUrl,
      mode: "health",
      previousFailures: 1,
      check: {
        ok: true,
      },
    });
  });
});

function runMonitor(args: string[]): Promise<{ exitCode: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/demo-monitor.mjs", ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (exitCode) => {
      resolve({ exitCode, stderr, stdout });
    });
  });
}

async function waitFor(predicate: () => boolean, timeoutMs: number) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
