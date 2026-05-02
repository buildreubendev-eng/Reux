import { describe, expect, it } from "vitest";
import {
  RateLimitExceededError,
  clientKeyFromRequest,
  createRateLimiter,
  rateLimitErrorBody,
} from "../demo/pilot-app/rate-limit.mjs";
import { createRequestStats, normalizeRoute } from "../demo/pilot-app/request-stats.mjs";

describe("demo API rate limiting", () => {
  it("allows requests until the configured window limit is exceeded", () => {
    let now = 0;
    const limiter = createRateLimiter({
      maxRequests: 2,
      windowMs: 1000,
      now: () => now,
    });

    expect(limiter.check("visitor").allowed).toBe(true);
    expect(limiter.check("visitor")).toMatchObject({
      allowed: true,
      remaining: 0,
      limit: 2,
    });

    const blocked = limiter.check("visitor");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);

    now = 1000;
    expect(limiter.check("visitor")).toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });

  it("serializes a stable 429 response body", () => {
    const error = new RateLimitExceededError({
      limit: 10,
      remaining: 0,
      resetAt: "2026-05-02T00:01:00.000Z",
      retryAfterSeconds: 30,
    });

    expect(error.statusCode).toBe(429);
    expect(rateLimitErrorBody(error)).toEqual({
      ok: false,
      error: "too many requests; please wait before trying again",
      message: "too many requests; please wait before trying again",
      code: "rate_limited",
      limit: 10,
      remaining: 0,
      resetAt: "2026-05-02T00:01:00.000Z",
      retryAfterSeconds: 30,
    });
  });

  it("uses proxy headers before socket address when identifying clients", () => {
    expect(
      clientKeyFromRequest({
        headers: {
          "x-forwarded-for": "203.0.113.10, 10.0.0.2",
        },
        socket: {
          remoteAddress: "127.0.0.1",
        },
      }),
    ).toBe("203.0.113.10");

    expect(
      clientKeyFromRequest({
        headers: {
          "x-real-ip": "203.0.113.11",
        },
        socket: {
          remoteAddress: "127.0.0.1",
        },
      }),
    ).toBe("203.0.113.11");
  });
});

describe("demo request stats", () => {
  it("normalizes dynamic API route keys and records response timing", () => {
    const stats = createRequestStats();

    expect(normalizeRoute("/api/simulation-runs/live_abc")).toBe("/api/simulation-runs/:id");
    expect(normalizeRoute("/api/reux/simulations/personal_finance/run")).toBe("/api/reux/simulations/:name/run");

    stats.record({
      method: "GET",
      pathname: "/api/simulation-runs/live_abc",
      statusCode: 200,
      durationMs: 12,
    });
    stats.record({
      method: "GET",
      pathname: "/api/simulation-runs/live_def",
      statusCode: 404,
      durationMs: 18,
    });

    expect(stats.summary()).toEqual({
      total: 2,
      routes: [
        {
          route: "GET /api/simulation-runs/:id",
          count: 2,
          status: {
            "200": 1,
            "404": 1,
          },
          averageDurationMs: 15,
          maxDurationMs: 18,
        },
      ],
    });
  });
});
