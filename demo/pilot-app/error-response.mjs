import { RateLimitExceededError, rateLimitErrorBody } from "./rate-limit.mjs";

export function demoErrorResponseBody(error, statusCode, options = {}) {
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof RateLimitExceededError) {
    return rateLimitErrorBody(error);
  }
  if (options.BusinessSimulatorValidationError && error instanceof options.BusinessSimulatorValidationError) {
    const code = "business_simulator_validation_failed";
    return {
      ok: false,
      error: message,
      message,
      code,
      ...errorMetadata(code),
      issues: error.issues,
    };
  }
  if (options.ReuxSimulationExecutionError && error instanceof options.ReuxSimulationExecutionError) {
    return {
      ok: false,
      error: message,
      message,
      code: error.code,
      ...errorMetadata(error.code),
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
    ...errorMetadata(code, statusCode),
    ...(error?.expiresAt ? { expiresAt: error.expiresAt } : {}),
    ...(Array.isArray(error?.issues) ? { issues: error.issues } : {}),
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

export function errorMetadata(code, statusCode) {
  switch (code) {
    case "business_simulator_validation_failed":
    case "simulation_execution_validation_failed":
    case "pilot_request_validation_failed":
    case "invalid_json":
    case "request_too_large":
      return {
        category: "validation",
        retryable: false,
        userAction: "Fix the request fields and try again.",
      };
    case "rate_limited":
      return {
        category: "rate_limit",
        retryable: true,
        userAction: "Wait until the retry window opens, then try again.",
      };
    case "saved_run_expired":
      return {
        category: "expired",
        retryable: false,
        userAction: "Start a new simulation run.",
      };
    case "not_found":
      return {
        category: "not_found",
        retryable: false,
        userAction: "Check the link or create a new result.",
      };
    case "method_not_allowed":
      return {
        category: "method",
        retryable: false,
        userAction: "Use one of the documented methods for this route.",
      };
    default:
      return {
        category: statusCode >= 500 ? "server" : "request",
        retryable: statusCode >= 500,
        userAction: statusCode >= 500 ? "Try again later." : "Check the request and try again.",
      };
  }
}
