import { readFileSync } from "node:fs";

const contractPath = "docs/public/reux-demo-api-contract.json";
const docsPath = "docs/technical/public-demo-api.md";

const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const docs = readFileSync(docsPath, "utf8");
const failures = [];

const requiredRoutes = [
  "GET /api/health",
  "GET /api/ops",
  "GET /api/simulations",
  "GET /api/simulations/operations-decision",
  "POST /api/simulations/run",
  "POST /api/scenarios/compare",
  "GET /api/reux/simulations",
  "GET /api/reux/simulations/:name",
  "POST /api/reux/simulations/:name/run",
  "GET /api/dashboard",
  "POST /api/session/reset",
  "POST /api/setup",
  "POST /api/actions/capture-payment",
  "POST /api/actions/mark-paid",
  "POST /api/actions/credit-account",
  "POST /api/outbox/process",
  "GET /api/outbox/stats",
  "GET /api/logistics/dashboard",
  "POST /api/logistics/session/reset",
  "POST /api/logistics/setup",
  "POST /api/logistics/actions/start-shipment",
  "POST /api/logistics/actions/mark-delivered",
  "POST /api/logistics/actions/credit-driver",
  "POST /api/logistics/outbox/process",
  "GET /api/logistics/outbox/stats",
];

if (contract.project !== "Reux") failures.push("contract project must be Reux");
if (contract.contract !== "public-demo-api") failures.push("contract id must be public-demo-api");
if (!contract.version || !docs.includes(`Contract version: \`${contract.version}\``)) {
  failures.push("docs must include the contract version");
}
if (!contract.baseUrlEnv || !docs.includes(contract.baseUrlEnv)) {
  failures.push("docs must include the base URL environment variable");
}

const routes = new Set((contract.routes ?? []).map((route) => `${route.method} ${route.path}`));
for (const route of requiredRoutes) {
  if (!routes.has(route)) failures.push(`contract missing route: ${route}`);
  if (!docs.includes(route)) failures.push(`docs missing route: ${route}`);
}

for (const code of contract.errorCodes ?? []) {
  if (!docs.includes(code)) failures.push(`docs missing error code: ${code}`);
}

for (const [key, value] of Object.entries(contract.limits ?? {})) {
  if (value === undefined || value === null) failures.push(`contract limit ${key} must have a value`);
}

if ((contract.routes ?? []).some((route) => !route.name || !route.method || !route.path || !route.purpose)) {
  failures.push("every contract route must include name, method, path, and purpose");
}

if (failures.length > 0) {
  console.error("demo API contract check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`demo API contract ok: ${contract.contract}@${contract.version}`);
console.log(`${contract.routes.length} routes documented`);
