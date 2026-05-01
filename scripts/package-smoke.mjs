import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const expectedPaths = [
  pkg.bin?.reux,
  pkg.bin?.dl,
  pkg.types,
  pkg.exports?.["."]?.import,
  pkg.exports?.["."]?.types,
  pkg.exports?.["./runtime"]?.import,
  pkg.exports?.["./runtime"]?.types,
  pkg.exports?.["./business-simulator"]?.import,
  pkg.exports?.["./business-simulator"]?.types,
  "docs/technical/business-simulator-api.md",
  "docs/technical/package-distribution.md",
  "docs/technical/public-release-plan.md",
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

console.log(`package smoke ok: ${pack.filename} includes ${pack.files.length} files`);
