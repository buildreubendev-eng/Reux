import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const allowDirty = process.argv.includes("--allow-dirty");

const requiredDocs = [
  "README.md",
  "docs/technical/business-simulator-api.md",
  "docs/technical/public-demo-api.md",
  "docs/technical/demo-deployment.md",
  "docs/technical/release.md",
  "docs/technical/package-distribution.md",
  "docs/technical/beta-readiness.md",
  "docs/technical/public-release-plan.md",
  "docs/technical/phase-status.md",
  "docs/technical/roadmap.md",
  "docs/public/reux-roadmap.md",
  "docs/public/reux-roadmap.json",
  "docs/public/reux-capabilities.md",
  "docs/public/reux-capabilities.json",
  "docs/public/reux-public-snapshot.md",
  "docs/public/reux-public-snapshot.json",
  "docs/public/reux-demo-testing-guide.md",
  "docs/public/reux-demo-api-contract.json",
  "docs/public/business-simulator-product-brief.md",
  "docs/technical/next-backlog.md",
  "docs/technical/next-backlog.json",
];

const requiredScripts = [
  "verify",
  "verify:package",
  "verify:postgres:full",
  "verify:demo:smoke",
  "onboarding:doctor",
  "demo:healthcheck",
  "demo:monitor",
  "demo:maintenance",
  "check:demo-contract",
  "check:public",
  "public:write",
  "release:preflight",
  "release:beta-readiness",
  "release:beta-status",
  "release:pack-dry-run",
];

const failures = [];
const pkg = readJson("package.json");
const roadmap = readJson("docs/public/reux-roadmap.json");
const capabilities = readJson("docs/public/reux-capabilities.json");
const publicSnapshot = readJson("docs/public/reux-public-snapshot.json");
const nextBacklog = readJson("docs/technical/next-backlog.json");

for (const path of requiredDocs) {
  if (!existsSync(path)) failures.push(`missing release doc: ${path}`);
}

for (const script of requiredScripts) {
  if (!pkg.scripts?.[script]) failures.push(`missing package script: ${script}`);
}

if (!pkg.bin?.reux || !pkg.bin?.dl) {
  failures.push("package must expose both reux and dl binaries");
}

if (!pkg.exports?.["."]?.import || !pkg.exports?.["./runtime"]?.import || !pkg.exports?.["./simulation"]?.import || !pkg.exports?.["./business-simulator"]?.import) {
  failures.push("package exports must include compiler, runtime, simulation, and business simulator entrypoints");
}

const status = roadmap.status ?? {};
if (Number(status.demoReadinessPercent) < 99) {
  failures.push("public roadmap demo readiness must be at least 99 before this release track");
}
if (Number(status.fullCompletionPercent) < 100) {
  failures.push("public roadmap full completion must be at least 100 before this release track");
}

const roadmapMarkdown = readFileSync("docs/public/reux-roadmap.md", "utf8");
const capabilitiesMarkdown = readFileSync("docs/public/reux-capabilities.md", "utf8");
const demoDeploymentMarkdown = readFileSync("docs/technical/demo-deployment.md", "utf8");
const demoTestingMarkdown = readFileSync("docs/public/reux-demo-testing-guide.md", "utf8");
const publicDemoApiMarkdown = readFileSync("docs/technical/public-demo-api.md", "utf8");
const publicDemoApiContract = readJson("docs/public/reux-demo-api-contract.json");
if (!roadmapMarkdown.includes(`Demo readiness: roughly ${status.demoReadinessPercent}%`)) {
  failures.push("public roadmap markdown demo percentage does not match roadmap JSON");
}
if (!roadmapMarkdown.includes(`Full platform completion: roughly ${status.fullCompletionPercent}%`)) {
  failures.push("public roadmap markdown full-completion percentage does not match roadmap JSON");
}
if (!demoDeploymentMarkdown.includes("REUX_DEMO_MONITOR_ALERT_WEBHOOK_URL")) {
  failures.push("demo deployment docs must document monitor alert webhook configuration");
}
if (!demoDeploymentMarkdown.includes("demo:maintenance")) {
  failures.push("demo deployment docs must document demo maintenance cleanup");
}
if (!demoTestingMarkdown.includes("--alert-webhook-url")) {
  failures.push("public demo testing guide must document monitor alert webhook usage");
}
if (publicDemoApiContract.contract !== "public-demo-api" || !publicDemoApiMarkdown.includes(publicDemoApiContract.version)) {
  failures.push("public demo API contract docs must match the JSON contract version");
}
if (!publicDemoApiContract.routes?.some((route) => route.path === "/api/simulations/run" && route.method === "POST")) {
  failures.push("public demo API contract must document the simulator run endpoint");
}
if (!roadmap.liveNow?.some((item) => String(item).includes("webhook alerts"))) {
  failures.push("public roadmap JSON must list monitor webhook alerts as live");
}
if (JSON.stringify(roadmap.milestones ?? []).includes("Add external alert delivery")) {
  failures.push("public roadmap JSON still lists monitor alert delivery as future work");
}
if (capabilities.project !== "Reux" || !Array.isArray(capabilities.capabilityGroups)) {
  failures.push("public capabilities JSON must identify Reux and include capability groups");
}
if (Number(capabilities.status?.demoReadinessPercent) !== Number(status.demoReadinessPercent)) {
  failures.push("public capabilities JSON demo readiness must match roadmap JSON");
}
if (Number(capabilities.status?.fullCompletionPercent) !== Number(status.fullCompletionPercent)) {
  failures.push("public capabilities JSON full completion must match roadmap JSON");
}
if (!capabilities.capabilityGroups?.some((group) => group.name === "Public Demo" && group.status === "live")) {
  failures.push("public capabilities JSON must include a live Public Demo capability group");
}
if (!capabilitiesMarkdown.includes("## Capability Groups") || !capabilitiesMarkdown.includes("### Public Demo")) {
  failures.push("public capabilities markdown must include capability groups and the public demo section");
}
if (publicSnapshot.status?.demoReadinessPercent !== status.demoReadinessPercent) {
  failures.push("public snapshot demo readiness must match roadmap JSON");
}
if (!publicSnapshot.links?.capabilitiesJson?.endsWith("reux-capabilities.json")) {
  failures.push("public snapshot must link to the public capabilities JSON");
}
if (!nextBacklog.items?.some((item) => item.priority === "P1")) {
  failures.push("next backlog must include at least one P1 item");
}
const publicAssetCheck = spawnSync(process.execPath, ["scripts/check-public-assets.mjs"], { encoding: "utf8" });
if (publicAssetCheck.status !== 0) {
  const output = `${publicAssetCheck.stdout ?? ""}${publicAssetCheck.stderr ?? ""}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  failures.push(...(output.length > 0 ? output : ["public asset check failed"]));
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
