export class DlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DlError";
  }
}

export class DlAggregateError extends DlError {
  constructor(public readonly diagnostics: string[]) {
    super(diagnostics.join("\n"));
    this.name = "DlAggregateError";
  }
}
