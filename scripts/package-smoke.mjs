import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const expectedPaths = [
  pkg.bin?.reux,
  pkg.bin?.dl,
  pkg.types,
  pkg.exports?.["."]?.import,
  pkg.exports?.["."]?.types,
  pkg.exports?.["./runtime"]?.import,
  pkg.exports?.["./runtime"]?.types,
  pkg.exports?.["./simulation"]?.import,
  pkg.exports?.["./simulation"]?.types,
  pkg.exports?.["./business-simulator"]?.import,
  pkg.exports?.["./business-simulator"]?.types,
  "docs/technical/business-simulator-api.md",
  "docs/technical/demo-deployment.md",
  "docs/technical/examples.md",
  "docs/technical/package-distribution.md",
  "docs/technical/beta-readiness.md",
  "docs/technical/public-release-plan.md",
  "docs/technical/developer-onboarding.md",
  "docs/technical/clinic-pilot.md",
  "docs/public/reux-capabilities.md",
  "docs/public/reux-capabilities.json",
  "docs/public/reux-public-snapshot.md",
  "docs/public/reux-public-snapshot.json",
  "docs/technical/next-backlog.md",
  "docs/technical/next-backlog.json",
  "examples/clinic_reux.dl",
  "examples/seeds/clinic_smoke.json",
  "docs/technical/editor-tooling.md",
  "editors/vscode/extension.js",
  "editors/vscode/package.json",
].filter(Boolean).map((path) => path.replace(/^\.\//, ""));

const missing = expectedPaths.filter((path) => !existsSync(path));
if (missing.length > 0) {
  console.error("Package smoke check failed. Missing expected files:");
  for (const path of missing) console.error(`- ${path}`);
  process.exit(1);
}

const packOutput = execFileSync("npm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
  shell: process.platform === "win32",
});
const [pack] = JSON.parse(packOutput);
const packagedFiles = new Set(pack.files.map((file) => file.path));
const missingFromPack = expectedPaths.filter((path) => !packagedFiles.has(path));

if (missingFromPack.length > 0) {
  console.error("Package smoke check failed. Files exist but are not included in npm pack:");
  for (const path of missingFromPack) console.error(`- ${path}`);
  process.exit(1);
}

const tempRoot = mkdtempSync(join(tmpdir(), "reux-package-smoke-"));
try {
  const packInstallOutput = execFileSync("npm", ["pack", "--json", "--pack-destination", tempRoot], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const [packedArtifact] = JSON.parse(packInstallOutput);
  const tarballPath = join(tempRoot, packedArtifact.filename);
  writeFileSync(join(tempRoot, "package.json"), JSON.stringify({ type: "module" }));
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath], {
    cwd: tempRoot,
    encoding: "utf8",
    stdio: "pipe",
    shell: process.platform === "win32",
  });

  const binPath = join(tempRoot, "node_modules", ".bin", process.platform === "win32" ? "reux.cmd" : "reux");
  const versionOutput = execFileSync(binPath, ["version"], {
    cwd: tempRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  }).trim();
  if (versionOutput !== `${pkg.name} ${pkg.version}`) {
    console.error(`Package smoke check failed. Expected CLI version "${pkg.name} ${pkg.version}", got "${versionOutput}".`);
    process.exit(1);
  }

  const capabilitiesOutput = execFileSync(binPath, ["capabilities"], {
    cwd: tempRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const capabilities = JSON.parse(capabilitiesOutput);
  if (capabilities.project !== "Reux" || !Array.isArray(capabilities.capabilityGroups)) {
    console.error("Package smoke check failed. Installed CLI did not emit the public Reux capabilities manifest.");
    process.exit(1);
  }

  writeFileSync(
    join(tempRoot, "consumer-smoke.mjs"),
    `import { compileSource, emitPostgresSchema, getReuxCapabilities } from "${pkg.name}";
import { businessSimulatorContractVersion } from "${pkg.name}/business-simulator";
import { createPostgresDatabase } from "${pkg.name}/runtime";
import { runReuxSimulation } from "${pkg.name}/simulation";

const source = \`module smoke

entity Account {
  id: Id<Account> primary generated
  email: String unique
}

simulate cash {
  income = 100 USD
  rent = 40 USD
  formula cash_flow = income - rent
  forecast 1 month
}
\`;
const compiled = compileSource(source);
const sql = emitPostgresSchema(source);
const simulation = runReuxSimulation(source, { simulationName: "cash", assumptions: { income: 120 } });
if (compiled.schema.entities.length !== 1) throw new Error("compiler import failed");
if (!sql.includes("CREATE TABLE accounts")) throw new Error("schema emitter import failed");
if (getReuxCapabilities().project !== "Reux") throw new Error("capabilities export failed");
if (typeof businessSimulatorContractVersion !== "string") throw new Error("business simulator export failed");
if (typeof createPostgresDatabase !== "function") throw new Error("runtime export failed");
if (simulation.run.periods[0].metrics.cash_flow !== 80) throw new Error("simulation export failed");
console.log("consumer import smoke ok");
`,
  );
  const importOutput = execFileSync(process.execPath, ["consumer-smoke.mjs"], {
    cwd: tempRoot,
    encoding: "utf8",
  }).trim();
  if (importOutput !== "consumer import smoke ok") {
    console.error(`Package smoke check failed. Unexpected consumer import output: ${importOutput}`);
    process.exit(1);
  }

  console.log(`package smoke ok: ${pack.filename} includes ${pack.files.length} files; installed CLI/import smoke passed`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
