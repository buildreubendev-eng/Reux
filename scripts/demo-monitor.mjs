import { spawnSync } from "node:child_process";

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const targetUrl = options.url ?? process.env.REUX_DEMO_MONITOR_URL;
if (!targetUrl) {
  console.error("usage: node scripts/demo-monitor.mjs <url> [--deep] [--once] [--interval-seconds N] [--max-failures N]");
  process.exit(1);
}

let consecutiveFailures = 0;

while (true) {
  const ok = runHealthcheck(targetUrl, options.healthcheckFlags);
  consecutiveFailures = ok ? 0 : consecutiveFailures + 1;

  if (options.once) {
    process.exit(ok ? 0 : 1);
  }

  if (consecutiveFailures >= options.maxFailures) {
    console.error(`[${new Date().toISOString()}] demo monitor failed after ${consecutiveFailures} consecutive failed check(s)`);
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
    return true;
  }

  process.stderr.write(`[${stamp}] demo monitor failed (${elapsedMs}ms)\n`);
  if (result.stdout.trim()) process.stderr.write(result.stdout);
  if (result.stderr.trim()) process.stderr.write(result.stderr);
  return false;
}

function parseArgs(args) {
  const parsed = {
    url: undefined,
    once: false,
    help: false,
    intervalSeconds: numberFromEnv("REUX_DEMO_MONITOR_INTERVAL_SECONDS", 60),
    maxFailures: numberFromEnv("REUX_DEMO_MONITOR_MAX_FAILURES", 3),
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
    } else if (!parsed.url) {
      parsed.url = arg;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }

  return parsed;
}

function positiveNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive number`);
  }
  return parsed;
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

Environment:
  REUX_DEMO_MONITOR_URL
  REUX_DEMO_MONITOR_INTERVAL_SECONDS
  REUX_DEMO_MONITOR_MAX_FAILURES`);
}
