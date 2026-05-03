import { describe, expect, it } from "vitest";
import { demoErrorHeaders, demoErrorResponseBody } from "../demo/pilot-app/error-response.mjs";
import { RateLimitExceededError } from "../demo/pilot-app/rate-limit.mjs";

describe("demo public error responses", () => {
  it("does not leak internal 500 error messages", () => {
    const error = new Error("password authentication failed for user datalang");

    expect(demoErrorResponseBody(error, 500)).toEqual({
      ok: false,
      error: "request failed",
      message: "request failed",
      code: "request_failed",
      category: "server",
      retryable: true,
      userAction: "Try again later.",
    });
  });

  it("keeps public not-found and expired saved-run details", () => {
    const notFound = new Error("simulation run 'live_missing' was not found");
    notFound.code = "not_found";

    expect(demoErrorResponseBody(notFound, 404)).toEqual({
      ok: false,
      error: "simulation run 'live_missing' was not found",
      message: "simulation run 'live_missing' was not found",
      code: "not_found",
      category: "not_found",
      retryable: false,
      userAction: "Check the link or create a new result.",
    });

    const expired = new Error("simulation run 'live_old' expired at 2026-05-03T00:00:00.000Z");
    expired.code = "saved_run_expired";
    expired.expiresAt = "2026-05-03T00:00:00.000Z";

    expect(demoErrorResponseBody(expired, 410)).toEqual({
      ok: false,
      error: "simulation run 'live_old' expired at 2026-05-03T00:00:00.000Z",
      message: "simulation run 'live_old' expired at 2026-05-03T00:00:00.000Z",
      code: "saved_run_expired",
      category: "expired",
      retryable: false,
      userAction: "Start a new simulation run.",
      expiresAt: "2026-05-03T00:00:00.000Z",
    });
  });

  it("preserves rate-limit body and retry headers", () => {
    const error = new RateLimitExceededError({
      limit: 10,
      remaining: 0,
      resetAt: "2026-05-03T00:01:00.000Z",
      retryAfterSeconds: 30,
    });

    expect(demoErrorResponseBody(error, 429)).toMatchObject({
      ok: false,
      code: "rate_limited",
      category: "rate_limit",
      retryable: true,
      retryAfterSeconds: 30,
    });
    expect(demoErrorHeaders(error)).toEqual({
      "retry-after": "30",
      "x-ratelimit-limit": "10",
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": "2026-05-03T00:01:00.000Z",
    });
  });

  it("preserves field-level validation envelopes", () => {
    class DemoValidationError extends Error {
      issues = [{ path: "$.baseline.grossMarginRate", message: "must be between 0 and 1" }];
    }

    const error = new DemoValidationError("$.baseline.grossMarginRate: must be between 0 and 1");

    expect(
      demoErrorResponseBody(error, 400, {
        BusinessSimulatorValidationError: DemoValidationError,
      }),
    ).toEqual({
      ok: false,
      error: "$.baseline.grossMarginRate: must be between 0 and 1",
      message: "$.baseline.grossMarginRate: must be between 0 and 1",
      code: "business_simulator_validation_failed",
      category: "validation",
      retryable: false,
      userAction: "Fix the request fields and try again.",
      issues: [{ path: "$.baseline.grossMarginRate", message: "must be between 0 and 1" }],
    });
  });
});
