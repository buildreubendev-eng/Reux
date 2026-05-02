import { existsSync, readFileSync } from "node:fs";

const allowBlockers = process.argv.includes("--allow-blockers");
const json = process.argv.includes("--json");

const pkg = readJson("package.json");
const checks = [];
const blockers = [];
const warnings = [];

check("package has a name", Boolean(pkg.name));
check("package has a semver version", /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(pkg.version ?? ""));
check("package is ESM", pkg.type === "module");
check("Node engine requires Node 22 or newer", String(pkg.engines?.node ?? "").includes(">=22"));
check("package exposes reux CLI", pkg.bin?.reux === "./dist/cli.js");
check("package exposes dl compatibility CLI", pkg.bin?.dl === "./dist/cli.js");
check("compiler export is present", Boolean(pkg.exports?.["."]?.import && pkg.exports?.["."]?.types));
check("runtime export is present", Boolean(pkg.exports?.["./runtime"]?.import && pkg.exports?.["./runtime"]?.types));
check("business simulator export is present", Boolean(pkg.exports?.["./business-simulator"]?.import && pkg.exports?.["./business-simulator"]?.types));
check("verify:package script exists", Boolean(pkg.scripts?.["verify:package"]));
check("release:preflight script exists", Boolean(pkg.scripts?.["release:preflight"]));
check("release:pack-dry-run script exists", Boolean(pkg.scripts?.["release:pack-dry-run"]));
check("release docs exist", existsSync("docs/technical/release.md"));
check("package distribution docs exist", existsSync("docs/technical/package-distribution.md"));
check("public release plan exists", existsSync("docs/technical/public-release-plan.md"));
check("beta readiness docs exist", existsSync("docs/technical/beta-readiness.md"));

if (pkg.private === true) {
  blockers.push("package.json is still private; set private=false only after the final package name/account decision");
}

if (pkg.name === "reux-prototype" || String(pkg.name ?? "").includes("prototype")) {
  blockers.push("package name is still a prototype placeholder; choose reux, @reuben/reux, or another final public name");
}

if (!pkg.license || pkg.license === "UNLICENSED") {
  blockers.push("license is not ready for public npm distribution; choose the intended public license or keep the package private");
}

if (!pkg.repository?.url) {
  warnings.push("repository.url is missing; add it before public npm distribution for package discoverability");
}

if (!pkg.bugs?.url) {
  warnings.push("bugs.url is missing; add it before public npm distribution for issue routing");
}

if (!pkg.homepage) {
  warnings.push("homepage is missing; add the Reuben/Reux public page before public npm distribution");
}

if (!Array.isArray(pkg.keywords) || pkg.keywords.length < 3) {
  warnings.push("keywords are sparse; add searchable npm keywords before public beta");
}

const result = {
  package: `${pkg.name}@${pkg.version}`,
  tarballReady: checks.every((item) => item.ok),
  publishReady: checks.every((item) => item.ok) && blockers.length === 0,
  checks,
  blockers,
  warnings,
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`beta readiness: ${result.package}`);
  printGroup("checks", checks.map((item) => `${item.ok ? "ok" : "fail"} - ${item.label}`));
  printGroup("publish blockers", blockers.length > 0 ? blockers : ["none"]);
  printGroup("warnings", warnings.length > 0 ? warnings : ["none"]);
  console.log(result.publishReady ? "status: publish ready" : "status: not publish ready");
}

if (!result.tarballReady || (blockers.length > 0 && !allowBlockers)) {
  process.exit(1);
}

function check(label, ok) {
  checks.push({ label, ok: Boolean(ok) });
}

function printGroup(title, lines) {
  console.log(`\n${title}:`);
  for (const line of lines) console.log(`- ${line}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
