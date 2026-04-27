export interface DlDatabaseError {
  name: string;
  message: string;
  retryable: boolean;
  detail?: string;
}

export function mapDatabaseError(error: unknown): DlDatabaseError | undefined {
  if (!isPgLikeError(error)) return undefined;

  switch (error.code) {
    case "23505":
      return {
        name: "UniqueViolation",
        message: error.constraint ? `unique constraint failed: ${error.constraint}` : "unique constraint failed",
        retryable: false,
        detail: error.detail,
      };
    case "23503":
      return {
        name: "ReferenceViolation",
        message: error.constraint ? `foreign key constraint failed: ${error.constraint}` : "foreign key constraint failed",
        retryable: false,
        detail: error.detail,
      };
    case "23514":
      return {
        name: "ConstraintViolation",
        message: error.constraint ? `check constraint failed: ${error.constraint}` : "check constraint failed",
        retryable: false,
        detail: error.detail,
      };
    case "40001":
      return {
        name: "RetryableTransactionConflict",
        message: "transaction serialization conflict",
        retryable: true,
        detail: error.detail,
      };
    case "40P01":
      return {
        name: "RetryableDeadlock",
        message: "transaction deadlock detected",
        retryable: true,
        detail: error.detail,
      };
    default:
      return undefined;
  }
}

function isPgLikeError(error: unknown): error is { code: string; constraint?: string; detail?: string } {
  return Boolean(error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string");
}
