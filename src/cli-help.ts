export type CliCommandCategory =
  | "Getting started"
  | "Source inspection"
  | "Project workflow"
  | "Generation"
  | "Database"
  | "Migrations"
  | "Seeds"
  | "Simulation"
  | "Outbox"
  | "Demo support";

export interface CliCommandInfo {
  name: string;
  category: CliCommandCategory;
  summary: string;
  usage: string;
  examples?: string[];
}

const commandNames = [
  "help",
  "version",
  "business-simulator-contract",
  "format",
  "diagnose",
  "check",
  "project-format",
  "project-diagnose",
  "project-check",
  "project-summary",
  "project-doctor",
  "project-sql",
  "project-manifest",
  "project-manifest-write",
  "project-transition-rules",
  "project-api-ts",
  "project-api-server-ts",
  "project-worker-ts",
  "project-simulation-types-ts",
  "project-simulation-packs",
  "project-migrate-plan",
  "project-migrate-check",
  "project-migrate-diff-create",
  "project-query-ir",
  "project-query-sql",
  "project-query-run",
  "project-explain",
  "project-tx-ir",
  "project-tx-sql",
  "project-tx-run",
  "project-simulation-ir",
  "project-simulation-run",
  "project-data-insert",
  "project-data-insert-sql",
  "project-seed-run",
  "project-seed-dry-run",
  "project-seed-check",
  "project-seed-delete",
  "project-seed-reset",
  "sql",
  "manifest",
  "transition-rules",
  "api-ts",
  "api-server-ts",
  "worker-ts",
  "simulation-types-ts",
  "simulation-packs",
  "manifest-write",
  "query-ir",
  "query-sql",
  "query-run",
  "data-insert",
  "data-insert-sql",
  "seed-run",
  "seed-dry-run",
  "seed-check",
  "seed-delete",
  "seed-reset",
  "tx-ir",
  "tx-sql",
  "tx-run",
  "simulation-ir",
  "simulation-run",
  "explain",
  "migrate-create",
  "migrate-plan",
  "migrate-check",
  "migrate-diff-create",
  "migrate-status",
  "migrate-apply",
  "outbox-list",
  "outbox-stats",
  "outbox-claim",
  "outbox-mark-processed",
  "outbox-mark-failed",
  "outbox-requeue",
  "outbox-requeue-stale",
] as const;

const commandDetails: Record<string, Partial<CliCommandInfo>> = {
  help: {
    category: "Getting started",
    summary: "Show the main help screen or command-specific help.",
    usage: "reux help [command]",
    examples: ["reux help", "reux help project-check"],
  },
  version: {
    category: "Getting started",
    summary: "Print the installed Reux package version.",
    usage: "reux version",
    examples: ["reux version"],
  },
  "business-simulator-contract": {
    category: "Demo support",
    summary: "Emit the deterministic Business Simulator API contract fixture.",
    usage: "reux business-simulator-contract",
    examples: ["reux business-simulator-contract"],
  },
  diagnose: {
    category: "Source inspection",
    summary: "Parse and validate one Reux source file with diagnostics.",
    usage: "reux diagnose <source.dl|source.reux> [--json]",
    examples: ["reux diagnose examples/commerce.dl", "reux diagnose examples/commerce.dl --json"],
  },
  check: {
    category: "Source inspection",
    summary: "Compile one Reux source file and print a success summary.",
    usage: "reux check <source.dl|source.reux>",
    examples: ["reux check examples/pilot_reux.dl"],
  },
  format: {
    category: "Source inspection",
    summary: "Format one Reux source file and write it to stdout.",
    usage: "reux format <source.dl|source.reux>",
    examples: ["reux format examples/pilot_reux.dl"],
  },
  "project-diagnose": {
    category: "Project workflow",
    summary: "Diagnose every source file matched by dl.json.",
    usage: "reux project-diagnose [--json]",
    examples: ["reux project-diagnose", "reux project-diagnose --json"],
  },
  "project-check": {
    category: "Project workflow",
    summary: "Compile every source file matched by dl.json.",
    usage: "reux project-check",
    examples: ["reux project-check"],
  },
  "project-format": {
    category: "Project workflow",
    summary: "Format the single source file matched by dl.json.",
    usage: "reux project-format",
    examples: ["reux project-format"],
  },
  "project-summary": {
    category: "Project workflow",
    summary: "Inventory configured files, declarations, and duplicate diagnostics.",
    usage: "reux project-summary [--json]",
    examples: ["reux project-summary", "reux project-summary --json"],
  },
  "project-doctor": {
    category: "Project workflow",
    summary: "Check project configuration, manifests, migrations, and optional database status.",
    usage: "reux project-doctor [--db] [--json]",
    examples: ["reux project-doctor", "reux project-doctor --db --json"],
  },
  "project-seed-check": {
    category: "Seeds",
    summary: "Validate a seed file against the configured project source.",
    usage: "reux project-seed-check <seed.json>",
    examples: ["reux project-seed-check pilot/seeds/smoke.json"],
  },
  "project-seed-dry-run": {
    category: "Seeds",
    summary: "Dry-run a seed file against the configured project source.",
    usage: "reux project-seed-dry-run <seed.json>",
    examples: ["reux project-seed-dry-run pilot/seeds/smoke.json"],
  },
  "project-seed-run": {
    category: "Seeds",
    summary: "Run a seed file against the configured project source.",
    usage: "reux project-seed-run <seed.json>",
    examples: ["reux project-seed-run pilot/seeds/smoke.json"],
  },
  "project-seed-delete": {
    category: "Seeds",
    summary: "Delete seed records for the configured project source.",
    usage: "reux project-seed-delete <seed.json>",
    examples: ["reux project-seed-delete pilot/seeds/smoke.json"],
  },
  "project-seed-reset": {
    category: "Seeds",
    summary: "Reset and rerun a seed file for the configured project source.",
    usage: "reux project-seed-reset <seed.json>",
    examples: ["reux project-seed-reset pilot/seeds/smoke.json"],
  },
  sql: {
    category: "Generation",
    summary: "Emit PostgreSQL schema SQL for one source file.",
    usage: "reux sql <source.dl|source.reux>",
    examples: ["reux sql examples/commerce.dl"],
  },
  manifest: {
    category: "Generation",
    summary: "Emit a schema manifest JSON document for one source file.",
    usage: "reux manifest <source.dl|source.reux>",
    examples: ["reux manifest examples/commerce.dl"],
  },
  "manifest-write": {
    category: "Generation",
    summary: "Write a schema manifest for one source file.",
    usage: "reux manifest-write <source.dl|source.reux>",
    examples: ["reux manifest-write examples/commerce.dl"],
  },
  "project-sql": {
    category: "Generation",
    summary: "Emit PostgreSQL schema SQL for the configured project source.",
    usage: "reux project-sql",
    examples: ["reux project-sql"],
  },
  "project-manifest": {
    category: "Generation",
    summary: "Emit a schema manifest for the configured project source.",
    usage: "reux project-manifest",
    examples: ["reux project-manifest"],
  },
  "project-manifest-write": {
    category: "Generation",
    summary: "Write a schema manifest for the configured project source.",
    usage: "reux project-manifest-write",
    examples: ["reux project-manifest-write"],
  },
  "query-ir": {
    category: "Generation",
    summary: "Emit Query IR for one named query in a source file.",
    usage: "reux query-ir <source.dl|source.reux> <query-name>",
    examples: ["reux query-ir examples/commerce.dl highValueUsers"],
  },
  "query-sql": {
    category: "Generation",
    summary: "Emit SQL for one named query in a source file.",
    usage: "reux query-sql <source.dl|source.reux> <query-name>",
    examples: ["reux query-sql examples/commerce.dl highValueUsers"],
  },
  "project-query-ir": {
    category: "Generation",
    summary: "Emit Query IR for one named query in the configured project source.",
    usage: "reux project-query-ir <query-name>",
    examples: ["reux project-query-ir highValueUsers"],
  },
  "project-query-sql": {
    category: "Generation",
    summary: "Emit SQL for one named query in the configured project source.",
    usage: "reux project-query-sql <query-name>",
    examples: ["reux project-query-sql highValueUsers"],
  },
  explain: {
    category: "Generation",
    summary: "Explain how a named query lowers from Reux to SQL.",
    usage: "reux explain <source.dl|source.reux> <query-name>",
    examples: ["reux explain examples/commerce.dl highValueUsers"],
  },
  "project-explain": {
    category: "Generation",
    summary: "Explain how a named project query lowers from Reux to SQL.",
    usage: "reux project-explain <query-name>",
    examples: ["reux project-explain highValueUsers"],
  },
  "tx-ir": {
    category: "Generation",
    summary: "Emit Transaction IR for one transaction function in a source file.",
    usage: "reux tx-ir <source.dl|source.reux> <transaction-name>",
    examples: ["reux tx-ir examples/commerce_v2.dl rewardUser"],
  },
  "tx-sql": {
    category: "Generation",
    summary: "Emit SQL for one transaction function in a source file.",
    usage: "reux tx-sql <source.dl|source.reux> <transaction-name>",
    examples: ["reux tx-sql examples/commerce_v2.dl rewardUser"],
  },
  "project-tx-ir": {
    category: "Generation",
    summary: "Emit Transaction IR for one configured project transaction.",
    usage: "reux project-tx-ir <transaction-name>",
    examples: ["reux project-tx-ir rewardUser"],
  },
  "project-tx-sql": {
    category: "Generation",
    summary: "Emit SQL for one configured project transaction.",
    usage: "reux project-tx-sql <transaction-name>",
    examples: ["reux project-tx-sql rewardUser"],
  },
  "project-simulation-ir": {
    category: "Simulation",
    summary: "Emit Simulation IR from the configured project source.",
    usage: "reux project-simulation-ir [simulation-name]",
    examples: ["reux project-simulation-ir personal_finance"],
  },
  "project-simulation-run": {
    category: "Simulation",
    summary: "Run a simulation from the configured project source.",
    usage: "reux project-simulation-run [simulation-name]",
    examples: ["reux project-simulation-run personal_finance"],
  },
  "project-simulation-types-ts": {
    category: "Simulation",
    summary: "Generate TypeScript types for simulations in the configured project source.",
    usage: "reux project-simulation-types-ts",
    examples: ["reux project-simulation-types-ts"],
  },
  "project-simulation-packs": {
    category: "Simulation",
    summary: "Emit scenario pack metadata for configured project simulations.",
    usage: "reux project-simulation-packs [target] [--json]",
    examples: ["reux project-simulation-packs --json"],
  },
  "transition-rules": {
    category: "Generation",
    summary: "Inspect state transition rules from one source file.",
    usage: "reux transition-rules <source.dl|source.reux> [Entity.field]",
    examples: ["reux transition-rules examples/pilot_reux.dl", "reux transition-rules examples/pilot_reux.dl Order.status"],
  },
  "project-transition-rules": {
    category: "Generation",
    summary: "Inspect state transition rules from the configured project source.",
    usage: "reux project-transition-rules [Entity.field]",
    examples: ["reux project-transition-rules", "reux project-transition-rules Order.status"],
  },
  "api-ts": {
    category: "Generation",
    summary: "Generate a TypeScript API client from one source file.",
    usage: "reux api-ts <source.dl|source.reux> [runtime-import]",
    examples: ["reux api-ts examples/pilot_reux.dl ./runtime.js"],
  },
  "project-api-ts": {
    category: "Generation",
    summary: "Generate a TypeScript API client from the configured project source.",
    usage: "reux project-api-ts [runtime-import]",
    examples: ["reux project-api-ts ./runtime.js"],
  },
  "api-server-ts": {
    category: "Generation",
    summary: "Generate a small HTTP server scaffold around a generated API client.",
    usage: "reux api-server-ts <source.dl|source.reux> [api-import] [config-import] [runtime-import]",
    examples: ["reux api-server-ts examples/pilot_reux.dl ./api.js ./config.js ./runtime.js"],
  },
  "project-api-server-ts": {
    category: "Generation",
    summary: "Generate a small HTTP server scaffold from the configured project source.",
    usage: "reux project-api-server-ts [api-import] [config-import] [runtime-import]",
    examples: ["reux project-api-server-ts ./api.js ./config.js ./runtime.js"],
  },
  "worker-ts": {
    category: "Generation",
    summary: "Generate a worker scaffold for outbox events and after-commit hooks.",
    usage: "reux worker-ts <source.dl|source.reux> [config-import] [runtime-import]",
    examples: ["reux worker-ts examples/pilot_reux.dl ./config.js ./runtime.js"],
  },
  "project-worker-ts": {
    category: "Generation",
    summary: "Generate a worker scaffold from the configured project source.",
    usage: "reux project-worker-ts [config-import] [runtime-import]",
    examples: ["reux project-worker-ts ./config.js ./runtime.js"],
  },
  "query-run": {
    category: "Database",
    summary: "Run a named query against PostgreSQL.",
    usage: "reux query-run <source.dl|source.reux> <query-name> [json-params|@params.json]",
    examples: ["reux query-run examples/commerce.dl highValueUsers '[1000]'"],
  },
  "project-query-run": {
    category: "Database",
    summary: "Run a named project query against PostgreSQL.",
    usage: "reux project-query-run <query-name> [json-params|@params.json]",
    examples: ["reux project-query-run highValueUsers '[1000]'"],
  },
  "tx-run": {
    category: "Database",
    summary: "Run a transaction function against PostgreSQL.",
    usage: "reux tx-run <source.dl|source.reux> <transaction-name> [json-params|@params.json]",
    examples: ["reux tx-run examples/commerce_v2.dl rewardUser '[\"user-id\",\"100\"]'"],
  },
  "project-tx-run": {
    category: "Database",
    summary: "Run a project transaction function against PostgreSQL.",
    usage: "reux project-tx-run <transaction-name> [json-params|@params.json]",
    examples: ["reux project-tx-run rewardUser '[\"user-id\",\"100\"]'"],
  },
  "data-insert": {
    category: "Database",
    summary: "Insert one entity row into PostgreSQL.",
    usage: "reux data-insert <source.dl|source.reux> <Entity> <json-object|@row.json>",
    examples: ["reux data-insert examples/commerce.dl User '{\"name\":\"Ada\",\"email\":\"ada@example.com\"}'"],
  },
  "data-insert-sql": {
    category: "Database",
    summary: "Preview insert SQL without opening a database connection.",
    usage: "reux data-insert-sql <source.dl|source.reux> <Entity> <json-object|@row.json>",
    examples: ["reux data-insert-sql examples/commerce.dl User @seed/user.json"],
  },
  "project-data-insert": {
    category: "Database",
    summary: "Insert one entity row using the configured project source.",
    usage: "reux project-data-insert <Entity> <json-object|@row.json>",
    examples: ["reux project-data-insert User '{\"name\":\"Ada\",\"email\":\"ada@example.com\"}'"],
  },
  "project-data-insert-sql": {
    category: "Database",
    summary: "Preview project insert SQL without opening a database connection.",
    usage: "reux project-data-insert-sql <Entity> <json-object|@row.json>",
    examples: ["reux project-data-insert-sql User @seed/user.json"],
  },
  "migrate-create": {
    category: "Migrations",
    summary: "Create an initial migration from one source file.",
    usage: "reux migrate-create <source.dl|source.reux> [migration-name]",
    examples: ["reux migrate-create examples/commerce.dl initial_schema"],
  },
  "migrate-plan": {
    category: "Migrations",
    summary: "Plan a migration from an old manifest to current source.",
    usage: "reux migrate-plan <old-manifest.json> <source.dl|source.reux> [--json]",
    examples: ["reux migrate-plan old-manifest.json examples/commerce_v2.dl"],
  },
  "migrate-check": {
    category: "Migrations",
    summary: "Run safety checks for a migration plan.",
    usage: "reux migrate-check <old-manifest.json> <source.dl|source.reux> [--env development|staging|production] [--allow-unsafe] [--allow-destructive] [--allow-production] [--json]",
    examples: ["reux migrate-check old-manifest.json examples/commerce_v2.dl --env staging"],
  },
  "migrate-diff-create": {
    category: "Migrations",
    summary: "Create a diff migration after passing migration safety checks.",
    usage: "reux migrate-diff-create <old-manifest.json> <source.dl|source.reux> [migration-name]",
    examples: ["reux migrate-diff-create old-manifest.json examples/commerce_v2.dl commerce_v2"],
  },
  "project-migrate-plan": {
    category: "Migrations",
    summary: "Plan a migration from the configured manifest to the configured project source.",
    usage: "reux project-migrate-plan [--json]",
    examples: ["reux project-migrate-plan", "reux project-migrate-plan --json"],
  },
  "project-migrate-check": {
    category: "Migrations",
    summary: "Run safety checks for the configured project migration plan.",
    usage: "reux project-migrate-check [--env development|staging|production] [--allow-unsafe] [--allow-destructive] [--allow-production] [--json]",
    examples: ["reux project-migrate-check --env staging"],
  },
  "project-migrate-diff-create": {
    category: "Migrations",
    summary: "Create a project diff migration after passing safety checks.",
    usage: "reux project-migrate-diff-create [migration-name]",
    examples: ["reux project-migrate-diff-create commerce_next"],
  },
  "migrate-status": {
    category: "Migrations",
    summary: "Show applied and pending PostgreSQL migrations.",
    usage: "reux migrate-status [--json]",
    examples: ["reux migrate-status", "reux migrate-status --json"],
  },
  "migrate-apply": {
    category: "Migrations",
    summary: "Apply pending migrations against PostgreSQL.",
    usage: "reux migrate-apply",
    examples: ["reux migrate-apply"],
  },
  "seed-check": {
    category: "Seeds",
    summary: "Validate a seed file without opening a database connection.",
    usage: "reux seed-check <source.dl|source.reux> <seed.json>",
    examples: ["reux seed-check examples/pilot_reux.dl pilot/seeds/smoke.json"],
  },
  "seed-dry-run": {
    category: "Seeds",
    summary: "Run a seed inside a transaction that always rolls back.",
    usage: "reux seed-dry-run <source.dl|source.reux> <seed.json>",
    examples: ["reux seed-dry-run examples/pilot_reux.dl pilot/seeds/smoke.json"],
  },
  "seed-run": {
    category: "Seeds",
    summary: "Run an ordered seed file against PostgreSQL.",
    usage: "reux seed-run <source.dl|source.reux> <seed.json>",
    examples: ["reux seed-run examples/pilot_reux.dl pilot/seeds/smoke.json"],
  },
  "seed-delete": {
    category: "Seeds",
    summary: "Delete records described by a seed file.",
    usage: "reux seed-delete <source.dl|source.reux> <seed.json>",
    examples: ["reux seed-delete examples/pilot_reux.dl pilot/seeds/smoke.json"],
  },
  "seed-reset": {
    category: "Seeds",
    summary: "Reset and rerun a seed file in one database transaction.",
    usage: "reux seed-reset <source.dl|source.reux> <seed.json>",
    examples: ["reux seed-reset examples/pilot_reux.dl pilot/seeds/smoke.json"],
  },
  "simulation-ir": {
    category: "Simulation",
    summary: "Emit Simulation IR from one source file.",
    usage: "reux simulation-ir <source.dl|source.reux> [simulation-name]",
    examples: ["reux simulation-ir examples/simulations/personal_finance.reux"],
  },
  "simulation-run": {
    category: "Simulation",
    summary: "Run a simulation from one source file.",
    usage: "reux simulation-run <source.dl|source.reux> [simulation-name]",
    examples: ["reux simulation-run examples/simulations/workforce_change.reux"],
  },
  "simulation-types-ts": {
    category: "Simulation",
    summary: "Generate TypeScript types for simulations in one source file.",
    usage: "reux simulation-types-ts <source.dl|source.reux>",
    examples: ["reux simulation-types-ts examples/simulations/workforce_change.reux"],
  },
  "simulation-packs": {
    category: "Simulation",
    summary: "Emit scenario pack metadata for simulations in one source file.",
    usage: "reux simulation-packs <source.dl|source.reux> [target] [--json]",
    examples: ["reux simulation-packs examples/simulations/workforce_change.reux --json"],
  },
  "outbox-list": {
    category: "Outbox",
    summary: "List outbox events by status.",
    usage: "reux outbox-list [pending|processing|processed|failed|dead|all] [limit]",
    examples: ["reux outbox-list", "reux outbox-list failed 10"],
  },
  "outbox-stats": {
    category: "Outbox",
    summary: "Summarize outbox event counts by status.",
    usage: "reux outbox-stats",
    examples: ["reux outbox-stats"],
  },
  "outbox-claim": {
    category: "Outbox",
    summary: "Claim pending outbox events for a worker.",
    usage: "reux outbox-claim [limit]",
    examples: ["reux outbox-claim 10"],
  },
  "outbox-mark-processed": {
    category: "Outbox",
    summary: "Mark an outbox event processed.",
    usage: "reux outbox-mark-processed <event-id>",
    examples: ["reux outbox-mark-processed <event-id>"],
  },
  "outbox-mark-failed": {
    category: "Outbox",
    summary: "Mark an outbox event failed with a message.",
    usage: "reux outbox-mark-failed <event-id> [message]",
    examples: ["reux outbox-mark-failed <event-id> \"smtp unavailable\""],
  },
  "outbox-requeue": {
    category: "Outbox",
    summary: "Requeue a failed or processing outbox event.",
    usage: "reux outbox-requeue <event-id>",
    examples: ["reux outbox-requeue <event-id>"],
  },
  "outbox-requeue-stale": {
    category: "Outbox",
    summary: "Requeue processing events abandoned by a worker.",
    usage: "reux outbox-requeue-stale [older-than-seconds] [limit]",
    examples: ["reux outbox-requeue-stale 300 50"],
  },
};

export const cliCommands: CliCommandInfo[] = commandNames.map((name) => {
  const detail = commandDetails[name] ?? inferCommandDetails(name);
  return {
    name,
    category: detail.category ?? "Generation",
    summary: detail.summary ?? `Run the ${name} command.`,
    usage: detail.usage ?? inferUsage(name),
    examples: detail.examples,
  };
});

const commandMap = new Map(cliCommands.map((command) => [command.name, command]));
const commandCategories: CliCommandCategory[] = [
  "Getting started",
  "Source inspection",
  "Project workflow",
  "Generation",
  "Database",
  "Migrations",
  "Seeds",
  "Simulation",
  "Outbox",
  "Demo support",
];

export function isKnownCommand(command: string): boolean {
  return commandMap.has(command);
}

export function commandUsage(command: string): string | undefined {
  return commandMap.get(command)?.usage;
}

export function formatMainHelp(): string {
  const lines = [
    "Reux CLI",
    "",
    "Usage:",
    "  reux <command> [args]",
    "  reux help [command]",
    "",
    "Common first runs:",
    "  reux check examples/pilot_reux.dl",
    "  reux project-check",
    "  reux simulation-run examples/simulations/personal_finance.reux",
    "",
    "Commands:",
  ];

  for (const category of commandCategories) {
    const commands = cliCommands.filter((command) => command.category === category);
    if (commands.length === 0) continue;
    lines.push("", `${category}:`);
    const width = Math.max(...commands.map((command) => command.name.length));
    for (const command of commands) {
      lines.push(`  ${command.name.padEnd(width)}  ${command.summary}`);
    }
  }

  lines.push("", "Run `reux help <command>` for usage and examples.");
  return lines.join("\n");
}

export function formatCommandHelp(commandName: string): string {
  const command = commandMap.get(commandName);
  if (!command) return formatUnknownCommand(commandName);

  const lines = [command.name, "", command.summary, "", "Usage:", `  ${command.usage}`];

  if (command.examples && command.examples.length > 0) {
    lines.push("", "Examples:");
    for (const example of command.examples) {
      lines.push(`  ${example}`);
    }
  }

  return lines.join("\n");
}

export function formatUnknownCommand(commandName: string): string {
  const suggestion = suggestCommand(commandName);
  const lines = [`unknown command: ${commandName}`];
  if (suggestion) {
    lines.push(`Did you mean \`${suggestion}\`?`, `Run \`reux help ${suggestion}\` for usage.`);
  } else {
    lines.push("Run `reux help` to list available commands.");
  }
  return lines.join("\n");
}

export function suggestCommand(input: string): string | undefined {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return undefined;

  const prefixMatch = cliCommands.find((command) => command.name.startsWith(normalized));
  if (prefixMatch) return prefixMatch.name;

  let best: { name: string; distance: number } | undefined;
  for (const command of cliCommands) {
    const distance = editDistance(normalized, command.name);
    if (!best || distance < best.distance) {
      best = { name: command.name, distance };
    }
  }

  if (!best) return undefined;
  const threshold = normalized.length <= 4 ? 1 : 3;
  return best.distance <= threshold ? best.name : undefined;
}

function inferCommandDetails(name: string): Partial<CliCommandInfo> {
  if (name.startsWith("project-seed-")) {
    return {
      category: "Seeds",
      summary: `Run project ${name.replace("project-", "").replaceAll("-", " ")} workflow.`,
      usage: `reux ${name} <seed.json>`,
      examples: [`reux ${name} pilot/seeds/smoke.json`],
    };
  }
  if (name.startsWith("project-simulation-")) {
    return {
      category: "Simulation",
      summary: "Work with simulations from the configured project source.",
      usage: `reux ${name} [simulation-name]`,
    };
  }
  return {};
}

function inferUsage(name: string): string {
  if (name.startsWith("project-")) return `reux ${name} [args]`;
  return `reux ${name} <source.dl|source.reux> [args]`;
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(previous[rightIndex] + 1, current[rightIndex - 1] + 1, previous[rightIndex - 1] + cost);
    }
    for (let index = 0; index <= right.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[right.length];
}
