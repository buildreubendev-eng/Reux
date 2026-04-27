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
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseStep);
}

function parseStep(line: string): TransactionStepIr {
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
