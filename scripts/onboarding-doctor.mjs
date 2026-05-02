import { existsSync, readFileSync } from "node:fs";

const json = process.argv.includes("--json");

const pkg = readJson("package.json");
const checks = [];
const warnings = [];

check("Node.js 22 or newer", nodeMajor(process.versions.node) >= 22, `current ${process.versions.node}`);
check("package-lock.json exists", existsSync("package-lock.json"));
check("TypeScript config exists", existsSync("tsconfig.json"));
check("source compiler entrypoint exists", existsSync("src/compiler.ts"));
check("source CLI entrypoint exists", existsSync("src/cli.ts"));
check("onboarding smoke script exists", existsSync("scripts/onboarding-smoke.mjs"));
check("build script exists", Boolean(pkg.scripts?.build));
check("onboarding:smoke script exists", Boolean(pkg.scripts?.["onboarding:smoke"]));
check("examples:check script exists", Boolean(pkg.scripts?.["examples:check"]));
check("package smoke script exists", Boolean(pkg.scripts?.["verify:package"]));
check("beta status script exists", Boolean(pkg.scripts?.["release:beta-status"]));
check("commerce pilot example exists", existsSync("examples/pilot_reux.dl"));
check("logistics pilot example exists", existsSync("examples/logistics_reux.dl"));
check("clinic pilot example exists", existsSync("examples/clinic_reux.dl"));
check("business simulation example exists", existsSync("examples/simulations/business_simulator.reux"));
check("clinic smoke seed exists", existsSync("examples/seeds/clinic_smoke.json"));
check("developer onboarding docs exist", existsSync("docs/technical/developer-onboarding.md"));
check("local PostgreSQL docs exist", existsSync("docs/technical/local-postgres.md"));
check("VS Code extension manifest exists", existsSync("editors/vscode/package.json"));
check("VS Code extension runtime exists", existsSync("editors/vscode/extension.js"));

if (process.env.DATABASE_URL) {
  warnings.push("DATABASE_URL is set; onboarding:smoke does not use PostgreSQL, but database tests will use this value");
}

const failed = checks.filter((item) => !item.ok);
const result = {
  status: failed.length === 0 ? "ok" : "failed",
  checks,
  warnings,
  nextCommand: failed.length === 0 ? "npm run onboarding:smoke" : null,
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log("onboarding doctor");
  for (const item of checks) {
    const suffix = item.detail ? ` (${item.detail})` : "";
    console.log(`- ${item.ok ? "ok" : "fail"} - ${item.label}${suffix}`);
  }
  if (warnings.length > 0) {
    console.log("\nwarnings:");
    for (const warning of warnings) console.log(`- ${warning}`);
  }
  console.log(result.status === "ok" ? "\nonboarding doctor ok" : "\nonboarding doctor failed");
  if (result.nextCommand) console.log(`next: ${result.nextCommand}`);
}

if (failed.length > 0) {
  process.exit(1);
}

function check(label, ok, detail) {
  checks.push({ label, ok: Boolean(ok), ...(detail ? { detail } : {}) });
}

function nodeMajor(version) {
  return Number(version.split(".")[0]);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
