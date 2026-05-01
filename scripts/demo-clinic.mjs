import { spawnSync } from "node:child_process";

const cli = ["dist/cli.js"];
const source = "examples/clinic_reux.dl";
const seed = "examples/seeds/clinic_smoke.json";

run("Clean generated build output", process.execPath, ["scripts/clean-dist.mjs"], process.env);
run("Build the CLI", process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], process.env);

for (const step of [
  ["Compile and diagnose the clinic pilot", ["diagnose", source, "--json"]],
  ["Check clinic source", ["check", source]],
  ["Inspect visit transition rules", ["transition-rules", source, "Visit.status"]],
  ["Inspect task transition rules", ["transition-rules", source, "CareTask.status"]],
  ["Emit upcoming visits query SQL", ["query-sql", source, "upcomingVisits"]],
  ["Emit clinician task load query SQL", ["query-sql", source, "clinicianTaskLoad"]],
  ["Emit visit status summary query SQL", ["query-sql", source, "visitStatusSummary"]],
  ["Emit check-in transaction SQL", ["tx-sql", source, "checkInVisit"]],
  ["Emit completion transaction SQL", ["tx-sql", source, "completeVisit"]],
  ["Emit care task assignment SQL", ["tx-sql", source, "assignCareTask"]],
  ["Emit care task close SQL", ["tx-sql", source, "closeCareTask"]],
  ["Emit generated TypeScript API client", ["api-ts", source, "./runtime.js"]],
  ["Emit generated HTTP server scaffold", ["api-server-ts", source, "./api.js", "./config.js", "./runtime.js"]],
  ["Emit generated worker scaffold", ["worker-ts", source, "./config.js", "./runtime.js"]],
  ["Validate clinic seed fixture", ["seed-check", source, seed]],
]) {
  run(step[0], process.execPath, [...cli, ...step[1]], process.env);
}

function run(label, command, args, commandEnv) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, {
    env: commandEnv,
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
