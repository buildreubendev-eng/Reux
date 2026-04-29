import { spawnSync } from "node:child_process";

const cli = ["dist/cli.js"];
const source = "examples/logistics_reux.dl";
const seed = "examples/seeds/logistics_smoke.json";

run("Clean generated build output", process.execPath, ["scripts/clean-dist.mjs"], process.env);
run("Build the CLI", process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], process.env);

for (const step of [
  ["Compile and diagnose the logistics pilot", ["diagnose", source, "--json"]],
  ["Check logistics source", ["check", source]],
  ["Inspect shipment transition rules", ["transition-rules", source, "Shipment.status"]],
  ["Emit active shipment query SQL", ["query-sql", source, "activeShipments"]],
  ["Emit driver manifest query SQL", ["query-sql", source, "driverManifest"]],
  ["Emit status summary query SQL", ["query-sql", source, "shipmentStatusSummary"]],
  ["Emit guarded start transaction SQL", ["tx-sql", source, "startShipment"]],
  ["Emit guarded delivery transaction SQL", ["tx-sql", source, "markDelivered"]],
  ["Emit payout credit transaction SQL", ["tx-sql", source, "creditDriver"]],
  ["Emit generated TypeScript API client", ["api-ts", source, "./runtime.js"]],
  ["Emit generated HTTP server scaffold", ["api-server-ts", source, "./api.js", "./config.js", "./runtime.js"]],
  ["Emit generated worker scaffold", ["worker-ts", source, "./config.js", "./runtime.js"]],
  ["Validate logistics seed fixture", ["seed-check", source, seed]],
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
