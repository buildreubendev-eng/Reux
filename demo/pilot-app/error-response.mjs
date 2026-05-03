import { RateLimitExceededError, rateLimitErrorBody } from "./rate-limit.mjs";

export function demoErrorResponseBody(error, statusCode, options = {}) {
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof RateLimitExceededError) {
    return rateLimitErrorBody(error);
  }
  if (options.BusinessSimulatorValidationError && error instanceof options.BusinessSimulatorValidationError) {
    return {
      ok: false,
      error: message,
      message,
      code: "business_simulator_validation_failed",
      issues: error.issues,
    };
  }
  if (options.ReuxSimulationExecutionError && error instanceof options.ReuxSimulationExecutionError) {
    return {
      ok: false,
      error: message,
      message,
      code: error.code,
      issues: error.issues,
    };
  }

  const code = error?.code ?? fallbackErrorCode(statusCode);
  const publicMessage = statusCode >= 500 ? "request failed" : message;

  return {
    ok: false,
    error: publicMessage,
    message: publicMessage,
    code,
    ...(error?.expiresAt ? { expiresAt: error.expiresAt } : {}),
  };
}

export function demoErrorHeaders(error) {
  if (error instanceof RateLimitExceededError) {
    return {
      "retry-after": String(error.retryAfterSeconds),
      "x-ratelimit-limit": String(error.limit),
      "x-ratelimit-remaining": String(error.remaining),
      "x-ratelimit-reset": error.resetAt,
    };
  }
  return {};
}

function fallbackErrorCode(statusCode) {
  if (statusCode === 404) return "not_found";
  if (statusCode === 405) return "method_not_allowed";
  return "request_failed";
}
