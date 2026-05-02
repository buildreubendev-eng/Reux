import { spawnSync } from "node:child_process";

const cli = ["dist/cli.js"];

run("Check source onboarding prerequisites", process.execPath, ["scripts/onboarding-doctor.mjs"]);
run("Clean generated build output", process.execPath, ["scripts/clean-dist.mjs"]);
run("Build the Reux CLI", process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"]);

for (const [label, args] of [
  ["Print CLI version", ["version"]],
  ["Check the commerce pilot source", ["check", "examples/pilot_reux.dl"]],
  ["Emit a commerce worklist query as PostgreSQL", ["query-sql", "examples/pilot_reux.dl", "accountOrders"]],
  ["Emit a guarded transaction as PostgreSQL", ["tx-sql", "examples/pilot_reux.dl", "markOrderPaid"]],
  ["Validate the clinic seed fixture", ["seed-check", "examples/clinic_reux.dl", "examples/seeds/clinic_smoke.json"]],
  ["Run a Reux simulation forecast", ["simulation-run", "examples/simulations/workforce_change.reux"]],
]) {
  run(label, process.execPath, [...cli, ...args]);
}

console.log("\nOnboarding smoke path complete.");
console.log("You built the CLI, checked Reux source, emitted SQL, validated seed data, and ran a simulation without a database.");

function run(label, command, args) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, {
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
