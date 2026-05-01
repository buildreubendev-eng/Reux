import { spawn } from "node:child_process";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

let server: http.Server | undefined;

afterEach(() => {
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
