import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const allowDirty = process.argv.includes("--allow-dirty");

const requiredDocs = [
  "README.md",
  "docs/technical/business-simulator-api.md",
  "docs/technical/demo-deployment.md",
  "docs/technical/release.md",
  "docs/technical/package-distribution.md",
  "docs/technical/public-release-plan.md",
  "docs/technical/phase-status.md",
  "docs/technical/roadmap.md",
  "docs/public/reux-roadmap.md",
  "docs/public/reux-roadmap.json",
  "docs/public/reux-demo-testing-guide.md",
];

const requiredScripts = [
  "verify",
  "verify:package",
  "verify:postgres:full",
  "verify:demo:smoke",
  "demo:healthcheck",
  "demo:monitor",
  "release:preflight",
  "release:pack-dry-run",
];

const failures = [];
const pkg = readJson("package.json");
const roadmap = readJson("docs/public/reux-roadmap.json");

for (const path of requiredDocs) {
  if (!existsSync(path)) failures.push(`missing release doc: ${path}`);
}

for (const script of requiredScripts) {
  if (!pkg.scripts?.[script]) failures.push(`missing package script: ${script}`);
}

if (!pkg.bin?.reux || !pkg.bin?.dl) {
  failures.push("package must expose both reux and dl binaries");
}

if (!pkg.exports?.["."]?.import || !pkg.exports?.["./runtime"]?.import || !pkg.exports?.["./business-simulator"]?.import) {
  failures.push("package exports must include compiler, runtime, and business simulator entrypoints");
}

const status = roadmap.status ?? {};
if (Number(status.demoReadinessPercent) < 99) {
  failures.push("public roadmap demo readiness must be at least 99 before this release track");
}
if (Number(status.fullCompletionPercent) < 100) {
  failures.push("public roadmap full completion must be at least 100 before this release track");
}

const roadmapMarkdown = readFileSync("docs/public/reux-roadmap.md", "utf8");
const demoDeploymentMarkdown = readFileSync("docs/technical/demo-deployment.md", "utf8");
const demoTestingMarkdown = readFileSync("docs/public/reux-demo-testing-guide.md", "utf8");
if (!roadmapMarkdown.includes(`Demo readiness: roughly ${status.demoReadinessPercent}%`)) {
  failures.push("public roadmap markdown demo percentage does not match roadmap JSON");
}
if (!roadmapMarkdown.includes(`Full platform completion: roughly ${status.fullCompletionPercent}%`)) {
  failures.push("public roadmap markdown full-completion percentage does not match roadmap JSON");
}
if (!demoDeploymentMarkdown.includes("REUX_DEMO_MONITOR_ALERT_WEBHOOK_URL")) {
  failures.push("demo deployment docs must document monitor alert webhook configuration");
}
if (!demoTestingMarkdown.includes("--alert-webhook-url")) {
  failures.push("public demo testing guide must document monitor alert webhook usage");
}
if (!roadmap.liveNow?.some((item) => String(item).includes("webhook alerts"))) {
  failures.push("public roadmap JSON must list monitor webhook alerts as live");
}
if (JSON.stringify(roadmap.milestones ?? []).includes("Add external alert delivery")) {
  failures.push("public roadmap JSON still lists monitor alert delivery as future work");
}

if (!allowDirty) {
  const statusOutput = execFileSync("git", ["status", "--short"], { encoding: "utf8" }).trim();
  if (statusOutput) failures.push("working tree is not clean; commit or stash changes before release");
}

if (failures.length > 0) {
  console.error("release preflight failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`release preflight ok: ${pkg.name}@${pkg.version}`);
console.log(`demo readiness ${status.demoReadinessPercent}%, full completion ${status.fullCompletionPercent}%`);
console.log(pkg.private ? "distribution mode: private/local tarball" : "distribution mode: publishable package");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
