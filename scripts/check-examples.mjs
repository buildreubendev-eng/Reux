import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { compileSource } from "../dist/compiler.js";

const cli = ["dist/cli.js"];
const requiredSimulationDimensions = ["product", "domain", "audience"];

const workflowExamples = [
  {
    label: "commerce pilot",
    source: "examples/pilot_reux.dl",
    moduleName: "pilot",
    doc: "docs/technical/pilot-application.md",
    seed: "pilot/seeds/smoke.json",
    demoCommand: "npm run demo:pilot",
    queries: ["openOrders", "accountBalances", "accountOrders", "orderPayments", "accountOrderSummary"],
    transactions: ["capturePayment", "markOrderPaid", "creditAccount"],
    transitionTargets: ["Order.status", "Payment.status"],
  },
  {
    label: "logistics pilot",
    source: "examples/logistics_reux.dl",
    moduleName: "logistics",
    doc: "docs/technical/logistics-pilot.md",
    seed: "examples/seeds/logistics_smoke.json",
    demoCommand: "npm run demo:logistics",
    queries: ["activeShipments", "driverManifest", "shipmentStatusSummary"],
    transactions: ["startShipment", "markDelivered", "creditDriver"],
    transitionTargets: ["Shipment.status"],
  },
  {
    label: "clinic pilot",
    source: "examples/clinic_reux.dl",
    moduleName: "clinic",
    doc: "docs/technical/clinic-pilot.md",
    seed: "examples/seeds/clinic_smoke.json",
    demoCommand: "npm run demo:clinic",
    queries: ["upcomingVisits", "clinicianTaskLoad", "visitStatusSummary"],
    transactions: ["checkInVisit", "completeVisit", "assignCareTask", "closeCareTask"],
    transitionTargets: ["Visit.status", "CareTask.status"],
  },
];

const simulationExamples = [
  {
    source: "examples/simulations/personal_finance.reux",
    moduleName: "personal_life",
    simulationName: "personal_finance",
    dimensions: { product: "PLOS", domain: "finance", audience: "personal" },
  },
  {
    source: "examples/simulations/habit_consistency.reux",
    moduleName: "personal_life",
    simulationName: "habit_consistency",
    dimensions: { product: "PLOS", domain: "habits", audience: "personal" },
  },
  {
    source: "examples/simulations/workforce_change.reux",
    moduleName: "business_ops",
    simulationName: "workforce_change",
    dimensions: { product: "business_simulation", domain: "workforce", audience: "enterprise" },
  },
  {
    source: "examples/simulations/operations_throughput.reux",
    moduleName: "business_operations",
    simulationName: "operations_throughput",
    dimensions: { product: "business_simulation", domain: "operations", audience: "enterprise" },
  },
  {
    source: "examples/simulations/business_simulator.reux",
    moduleName: "business_simulator",
    simulationName: "operations_decision",
    dimensions: { product: "business_simulation", domain: "operations", audience: "enterprise" },
  },
];

const failures = [];

for (const example of workflowExamples) {
  checkWorkflowExample(example);
}

for (const example of simulationExamples) {
  checkSimulationExample(example);
}

if (failures.length > 0) {
  console.error("example consistency check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`example consistency ok: ${workflowExamples.length} workflow examples, ${simulationExamples.length} simulation examples`);

function checkWorkflowExample(example) {
  assertFile(example.source, `${example.label} source`);
  assertFile(example.doc, `${example.label} docs`);
  assertFile(example.seed, `${example.label} seed`);

  const source = readFileSync(example.source, "utf8");
  const docs = readFileSync(example.doc, "utf8");
  const result = compileSource(source);
  const declarations = result.program.declarations;
  const queries = declarations.filter((declaration) => declaration.kind === "query").map((declaration) => declaration.name);
  const transactions = declarations.filter((declaration) => declaration.kind === "transaction");
  const transitions = declarations
    .filter((declaration) => declaration.kind === "transition")
    .map((declaration) => `${declaration.entity}.${declaration.field}`);

  expectEqual(result.program.moduleName, example.moduleName, `${example.label} module name`);
  expectAtLeast(result.schema.entities.length, 1, `${example.label} entity count`);
  expectAtLeast(result.schema.enums.length, 1, `${example.label} enum count`);
  expectAtLeast(transitions.length, 1, `${example.label} transition declarations`);
  expectIncludes(docs, example.source, `${example.label} docs source path`);
  expectIncludes(docs, example.seed, `${example.label} docs seed path`);
  expectIncludes(docs, example.demoCommand, `${example.label} docs demo command`);

  for (const query of example.queries) {
    expectArrayIncludes(queries, query, `${example.label} query ${query}`);
    expectIncludes(docs, query, `${example.label} docs query ${query}`);
    runCli(`${example.label} query ${query}`, ["query-sql", example.source, query]);
  }

  for (const transaction of example.transactions) {
    const declaration = transactions.find((candidate) => candidate.name === transaction);
    if (!declaration) {
      failures.push(`${example.label} missing transaction ${transaction}`);
      continue;
    }
    if (!declaration.retry) failures.push(`${example.label} transaction ${transaction} should declare retry attempts`);
    expectIncludes(docs, transaction, `${example.label} docs transaction ${transaction}`);
    runCli(`${example.label} transaction ${transaction}`, ["tx-sql", example.source, transaction]);
  }

  for (const target of example.transitionTargets) {
    expectArrayIncludes(transitions, target, `${example.label} transition ${target}`);
    runCli(`${example.label} transition rules ${target}`, ["transition-rules", example.source, target]);
  }

  runCli(`${example.label} source check`, ["check", example.source]);
  runCli(`${example.label} seed check`, ["seed-check", example.source, example.seed]);
  runCli(`${example.label} generated API client`, ["api-ts", example.source, "./runtime.js"]);
  runCli(`${example.label} generated worker`, ["worker-ts", example.source, "./config.js", "./runtime.js"]);
}

function checkSimulationExample(example) {
  assertFile(example.source, `${example.simulationName} source`);

  const source = readFileSync(example.source, "utf8");
  const result = compileSource(source);
  const simulation = result.simulations.find((candidate) => candidate.name === example.simulationName);
  if (!simulation) {
    failures.push(`${example.source} missing simulation ${example.simulationName}`);
    return;
  }

  expectEqual(result.program.moduleName, example.moduleName, `${example.simulationName} module name`);
  expectAtLeast(simulation.assumptions.length, 1, `${example.simulationName} assumptions`);
  expectAtLeast(simulation.formulas.length, 1, `${example.simulationName} formulas`);
  expectAtLeast(simulation.objectives.length, 1, `${example.simulationName} objectives`);
  expectAtLeast(simulation.scenarios.length, 1, `${example.simulationName} scenarios`);
  expectAtLeast(simulation.forecast.periods, 1, `${example.simulationName} forecast periods`);

  const dimensions = Object.fromEntries(simulation.dimensions.map((dimension) => [dimension.name, dimension.value]));
  for (const dimension of requiredSimulationDimensions) {
    expectEqual(dimensions[dimension], example.dimensions[dimension], `${example.simulationName} dimension ${dimension}`);
  }
  for (const objective of simulation.objectives) {
    if (!simulation.formulas.some((formula) => formula.name === objective.metric)) {
      failures.push(`${example.simulationName} objective ${objective.metric} should reference a formula metric`);
    }
  }

  runCli(`${example.simulationName} simulation IR`, ["simulation-ir", example.source, example.simulationName]);
  runCli(`${example.simulationName} simulation run`, ["simulation-run", example.source, example.simulationName]);
  runCli(`${example.simulationName} simulation pack report`, ["simulation-packs", example.source, "--json"]);
}

function runCli(label, args) {
  const result = spawnSync(process.execPath, [...cli, ...args], {
    encoding: "utf8",
    shell: false,
  });
  if (result.error) {
    failures.push(`${label}: ${result.error.message}`);
    return;
  }
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || `exit ${result.status}`).trim();
    failures.push(`${label}: ${message}`);
  }
}

function assertFile(path, label) {
  if (!existsSync(path)) failures.push(`missing ${label}: ${path}`);
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
}

function expectAtLeast(actual, minimum, label) {
  if (actual < minimum) failures.push(`${label}: expected at least ${minimum}, got ${actual}`);
}

function expectIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) failures.push(`${label}: expected to include ${needle}`);
}

function expectArrayIncludes(values, expected, label) {
  if (!values.includes(expected)) failures.push(`${label}: expected to include ${expected}`);
}
