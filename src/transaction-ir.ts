import { TransactionDeclaration } from "./ast.js";
import { SchemaIr } from "./schema.js";

export interface TransactionIr {
  name: string;
  parameters: {
    name: string;
    type: string;
  }[];
  writes: string[];
  retry?: {
    attempts: number;
  };
  steps: TransactionStepIr[];
}

export type TransactionStepIr =
  | LoadForUpdateStepIr
  | SaveStepIr
  | InsertStepIr
  | EnqueueStepIr
  | IdempotencyKeyStepIr
  | RequireStepIr
  | ConditionalAbortStepIr
  | ConditionalMutationStepIr
  | ConditionalEnqueueStepIr
  | ConditionalAfterCommitStepIr
  | AfterCommitStepIr
  | ExternalCallStepIr
  | MutationStepIr
  | AbortStepIr
  | RawStepIr;

export interface LoadForUpdateStepIr {
  kind: "LoadForUpdate";
  target: string;
  source: string;
}

export interface SaveStepIr {
  kind: "Save";
  target: string;
}

export interface InsertStepIr {
  kind: "Insert";
  entity: string;
  source: string;
  target?: string;
}

export interface EnqueueStepIr {
  kind: "Enqueue";
  event: string;
  source: string;
}

export interface IdempotencyKeyStepIr {
  kind: "IdempotencyKey";
  expression: string;
}

export interface RequireStepIr {
  kind: "Require";
  condition: string;
  error: string;
}

export interface ConditionalAbortStepIr {
  kind: "ConditionalAbort";
  condition: string;
  error: string;
}

export interface ConditionalMutationStepIr {
  kind: "ConditionalMutation";
  condition: string;
  target: string;
  operator: "+=" | "-=" | "=";
  expression: string;
}

export interface ConditionalEnqueueStepIr {
  kind: "ConditionalEnqueue";
  condition: string;
  event: string;
  source: string;
}

export interface ConditionalAfterCommitStepIr {
  kind: "ConditionalAfterCommit";
  condition: string;
  call: string;
}

export interface AfterCommitStepIr {
  kind: "AfterCommit";
  call: string;
}

export interface ExternalCallStepIr {
  kind: "ExternalCall";
  call: string;
}

export interface MutationStepIr {
  kind: "Mutation";
  target: string;
  operator: "+=" | "-=" | "=";
  expression: string;
}

export interface AbortStepIr {
  kind: "Abort";
  error: string;
}

export interface RawStepIr {
  kind: "Raw";
  source: string;
}

export function buildTransactionIr(_schema: SchemaIr, transaction: TransactionDeclaration): TransactionIr {
  return {
    name: transaction.name,
    parameters: transaction.parameters.map((parameter) => ({
      name: parameter.name,
      type: parameter.type.raw,
    })),
    writes: transaction.writes,
    retry: transaction.retry,
    steps: parseSteps(transaction.body),
  };
}

function parseSteps(body: string): TransactionStepIr[] {
  return transactionBodyLines(body).map(parseStep);
}

function parseStep(line: string): TransactionStepIr {
  const idempotency = line.match(/^idempotency\s+key\s+(.+)$/);
  if (idempotency) {
    return {
      kind: "IdempotencyKey",
      expression: idempotency[1],
    };
  }

  const require = line.match(/^require\s+(.+)\s+else\s+abort\s+([A-Za-z_][A-Za-z0-9_]*)$/);
  if (require) {
    return {
      kind: "Require",
      condition: require[1],
      error: require[2],
    };
  }

  const conditionalAbort = line.match(/^if\s+(.+)\s+then\s+abort\s+([A-Za-z_][A-Za-z0-9_]*)$/);
  if (conditionalAbort) {
    return {
      kind: "ConditionalAbort",
      condition: conditionalAbort[1],
      error: conditionalAbort[2],
    };
  }

  const conditionalMutation = line.match(
    /^if\s+(.+)\s+then\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\s*(\+=|-=|=)\s*(.+)$/,
  );
  if (conditionalMutation) {
    return {
      kind: "ConditionalMutation",
      condition: conditionalMutation[1],
      target: conditionalMutation[2],
      operator: conditionalMutation[3] as "+=" | "-=" | "=",
      expression: conditionalMutation[4],
    };
  }

  const conditionalEnqueue = line.match(/^if\s+(.+)\s+then\s+enqueue\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/);
  if (conditionalEnqueue) {
    return {
      kind: "ConditionalEnqueue",
      condition: conditionalEnqueue[1],
      event: conditionalEnqueue[2],
      source: conditionalEnqueue[3],
    };
  }

  const conditionalAfterCommit = line.match(/^if\s+(.+)\s+then\s+after\s+commit\s+(.+\([^)]*\))$/);
  if (conditionalAfterCommit) {
    return {
      kind: "ConditionalAfterCommit",
      condition: conditionalAfterCommit[1],
      call: conditionalAfterCommit[2],
    };
  }

  const load = line.match(/^let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*load\s+(.+)\s+for\s+update$/);
  if (load) {
    return {
      kind: "LoadForUpdate",
      target: load[1],
      source: load[2],
    };
  }

  const save = line.match(/^save\s+([A-Za-z_][A-Za-z0-9_]*)$/);
  if (save) {
    return {
      kind: "Save",
      target: save[1],
    };
  }

  const boundInsert = line.match(/^let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*insert\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/);
  if (boundInsert) {
    return {
      kind: "Insert",
      target: boundInsert[1],
      entity: boundInsert[2],
      source: boundInsert[3],
    };
  }

  const insert = line.match(/^insert\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/);
  if (insert) {
    return {
      kind: "Insert",
      entity: insert[1],
      source: insert[2],
    };
  }

  const enqueue = line.match(/^enqueue\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/);
  if (enqueue) {
    return {
      kind: "Enqueue",
      event: enqueue[1],
      source: enqueue[2],
    };
  }

  const afterCommit = line.match(/^after\s+commit\s+(.+\([^)]*\))$/);
  if (afterCommit) {
    return {
      kind: "AfterCommit",
      call: afterCommit[1],
    };
  }

  const mutation = line.match(/^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\s*(\+=|-=|=)\s*(.+)$/);
  if (mutation) {
    return {
      kind: "Mutation",
      target: mutation[1],
      operator: mutation[2] as "+=" | "-=" | "=",
      expression: mutation[3],
    };
  }

  const abort = line.match(/^abort\s+([A-Za-z_][A-Za-z0-9_]*)$/);
  if (abort) {
    return {
      kind: "Abort",
      error: abort[1],
    };
  }

  const externalCall = line.match(/^([A-Za-z_][A-Za-z0-9_]*\([^)]*\))$/);
  if (externalCall) {
    return {
      kind: "ExternalCall",
      call: externalCall[1],
    };
  }

  return {
    kind: "Raw",
    source: line,
  };
}

function transactionBodyLines(body: string): string[] {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const expanded: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const block = lines[index].match(/^if\s+(.+?)\s*\{$/);
    if (!block) {
      expanded.push(lines[index]);
      continue;
    }

    const condition = block[1];
    let closed = false;
    for (index += 1; index < lines.length; index += 1) {
      if (lines[index] === "}") {
        closed = true;
        break;
      }
      expanded.push(`if ${condition} then ${lines[index]}`);
    }
    if (!closed) {
      expanded.push(lines[index - 1] ?? `if ${condition} {`);
    }
  }

  return expanded;
}
