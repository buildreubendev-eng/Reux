import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const allowDirty = process.argv.includes("--allow-dirty");

const requiredDocs = [
  "README.md",
  "docs/technical/release.md",
  "docs/technical/package-distribution.md",
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
  "release:preflight",
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

if (!pkg.exports?.["."]?.import || !pkg.exports?.["./runtime"]?.import) {
  failures.push("package exports must include compiler and runtime entrypoints");
}

const status = roadmap.status ?? {};
if (Number(status.demoReadinessPercent) < 99) {
  failures.push("public roadmap demo readiness must be at least 99 before this release track");
}
if (Number(status.fullCompletionPercent) < 93) {
  failures.push("public roadmap full completion must be at least 93 before this release track");
}

const roadmapMarkdown = readFileSync("docs/public/reux-roadmap.md", "utf8");
if (!roadmapMarkdown.includes(`Demo readiness: roughly ${status.demoReadinessPercent}%`)) {
  failures.push("public roadmap markdown demo percentage does not match roadmap JSON");
}
if (!roadmapMarkdown.includes(`Full platform completion: roughly ${status.fullCompletionPercent}%`)) {
  failures.push("public roadmap markdown full-completion percentage does not match roadmap JSON");
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
