import { spawnSync } from "node:child_process";

const cli = ["dist/cli.js"];
const env = {
  ...process.env,
  REUX_CONFIG: "pilot/dl.json",
};

run("Clean generated build output", process.execPath, ["scripts/clean-dist.mjs"], process.env);
run("Build the CLI", process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], process.env);

for (const step of [
  ["Compile and summarize the pilot", ["project-diagnose", "--json"]],
  ["Check project health without a database", ["project-doctor", "--json"]],
  ["Inspect order transition rules", ["project-transition-rules", "Order.status"]],
  ["Plan schema drift from the pilot manifest", ["project-migrate-plan", "--json"]],
  ["Emit the summary query SQL", ["project-query-sql", "accountOrderSummary"]],
  ["Emit the guarded order transaction SQL", ["project-tx-sql", "markOrderPaid"]],
  ["Emit the generated TypeScript API client", ["project-api-ts", "./runtime.js"]],
  ["Emit the generated HTTP server scaffold", ["project-api-server-ts", "./api.js", "./config.js", "./runtime.js"]],
  ["Emit the generated worker scaffold", ["project-worker-ts", "./config.js", "./runtime.js"]],
  ["Validate the pilot seed fixture", ["project-seed-check", "pilot/seeds/smoke.json"]],
]) {
  run(step[0], process.execPath, [...cli, ...step[1]], env);
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
