import { spawnSync } from "node:child_process";

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const targetUrl = options.url ?? process.env.REUX_DEMO_MONITOR_URL;
if (!targetUrl) {
  console.error("usage: node scripts/demo-monitor.mjs <url> [--deep] [--once] [--interval-seconds N] [--max-failures N] [--alert-webhook-url URL]");
  process.exit(1);
}

let consecutiveFailures = 0;

while (true) {
  const previousFailures = consecutiveFailures;
  const check = runHealthcheck(targetUrl, options.healthcheckFlags);
  consecutiveFailures = check.ok ? 0 : consecutiveFailures + 1;

  if (check.ok && previousFailures > 0) {
    await sendMonitorAlert(options, {
      event: "reux.demo_monitor.recovered",
      url: targetUrl,
      mode: monitorMode(options.healthcheckFlags),
      timestamp: new Date().toISOString(),
      previousFailures,
      message: `Reux demo monitor recovered after ${previousFailures} failed check(s).`,
      check: summarizeCheck(check),
    });
  }

  if (options.once) {
    if (!check.ok) {
      await sendMonitorAlert(options, {
        event: "reux.demo_monitor.failed",
        url: targetUrl,
        mode: monitorMode(options.healthcheckFlags),
        timestamp: new Date().toISOString(),
        consecutiveFailures,
        maxFailures: options.maxFailures,
        message: "Reux demo monitor one-shot check failed.",
        check: summarizeCheck(check),
      });
    }
    process.exit(check.ok ? 0 : 1);
  }

  if (consecutiveFailures >= options.maxFailures) {
    console.error(`[${new Date().toISOString()}] demo monitor failed after ${consecutiveFailures} consecutive failed check(s)`);
    await sendMonitorAlert(options, {
      event: "reux.demo_monitor.failed",
      url: targetUrl,
      mode: monitorMode(options.healthcheckFlags),
      timestamp: new Date().toISOString(),
      consecutiveFailures,
      maxFailures: options.maxFailures,
      message: `Reux demo monitor failed after ${consecutiveFailures} consecutive failed check(s).`,
      check: summarizeCheck(check),
    });
    process.exit(1);
  }

  await sleep(options.intervalSeconds * 1000);
}

function runHealthcheck(url, flags) {
  const started = Date.now();
  const result = spawnSync(process.execPath, ["scripts/demo-healthcheck.mjs", url, ...flags], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const elapsedMs = Date.now() - started;
  const stamp = new Date().toISOString();

  if (result.status === 0) {
    process.stdout.write(`[${stamp}] demo monitor ok (${elapsedMs}ms)\n`);
    if (result.stdout.trim()) process.stdout.write(result.stdout);
    return {
      ok: true,
      elapsedMs,
      stdout: result.stdout,
      stderr: result.stderr,
      status: result.status,
    };
  }

  process.stderr.write(`[${stamp}] demo monitor failed (${elapsedMs}ms)\n`);
  if (result.stdout.trim()) process.stderr.write(result.stdout);
  if (result.stderr.trim()) process.stderr.write(result.stderr);
  return {
    ok: false,
    elapsedMs,
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
  };
}

function parseArgs(args) {
  const parsed = {
    url: undefined,
    once: false,
    help: false,
    intervalSeconds: numberFromEnv("REUX_DEMO_MONITOR_INTERVAL_SECONDS", 60),
    maxFailures: numberFromEnv("REUX_DEMO_MONITOR_MAX_FAILURES", 3),
    alertWebhookUrl: process.env.REUX_DEMO_MONITOR_ALERT_WEBHOOK_URL,
    alertTimeoutMs: numberFromEnv("REUX_DEMO_MONITOR_ALERT_TIMEOUT_MS", 5000),
    healthcheckFlags: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--once") {
      parsed.once = true;
    } else if (arg === "--deep" || arg === "--smoke") {
      parsed.healthcheckFlags.push(arg);
    } else if (arg === "--interval-seconds") {
      parsed.intervalSeconds = positiveNumber(args[++index], arg);
    } else if (arg === "--max-failures") {
      parsed.maxFailures = positiveNumber(args[++index], arg);
    } else if (arg === "--alert-webhook-url") {
      parsed.alertWebhookUrl = requiredValue(args[++index], arg);
    } else if (!parsed.url) {
      parsed.url = arg;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }

  return parsed;
}

async function sendMonitorAlert(options, payload) {
  if (!options.alertWebhookUrl) return;

  try {
    const response = await fetch(options.alertWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(options.alertTimeoutMs),
    });

    if (!response.ok) {
      process.stderr.write(`[${new Date().toISOString()}] demo monitor alert webhook returned ${response.status}\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[${new Date().toISOString()}] demo monitor alert webhook failed: ${message}\n`);
  }
}

function summarizeCheck(check) {
  return {
    ok: check.ok,
    status: check.status,
    elapsedMs: check.elapsedMs,
    stdout: truncate(check.stdout),
    stderr: truncate(check.stderr),
  };
}

function truncate(value, maxLength = 4000) {
  const text = String(value ?? "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function monitorMode(flags) {
  if (flags.includes("--smoke")) return "smoke";
  if (flags.includes("--deep")) return "deep";
  return "health";
}

function positiveNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive number`);
  }
  return parsed;
}

function requiredValue(value, flag) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function numberFromEnv(name, fallback) {
  return process.env[name] ? positiveNumber(process.env[name], name) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`usage: node scripts/demo-monitor.mjs <url> [options]

Options:
  --deep                  Include queue stats checks.
  --smoke                 Include public reset, transaction, queue, and outbox smoke checks.
  --once                  Run one check and exit.
  --interval-seconds N    Seconds between checks. Default: 60.
  --max-failures N        Consecutive failures before exiting nonzero. Default: 3.
  --alert-webhook-url URL POST failure/recovery alerts to a JSON webhook.

Environment:
  REUX_DEMO_MONITOR_URL
  REUX_DEMO_MONITOR_INTERVAL_SECONDS
  REUX_DEMO_MONITOR_MAX_FAILURES
  REUX_DEMO_MONITOR_ALERT_WEBHOOK_URL
  REUX_DEMO_MONITOR_ALERT_TIMEOUT_MS`);
}
