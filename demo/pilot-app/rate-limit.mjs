export const defaultRateLimitWindowMs = 60 * 1000;
export const defaultRateLimitMaxRequests = 240;
export const defaultWriteRateLimitMaxRequests = 60;

export class RateLimitExceededError extends Error {
  constructor(result) {
    super("too many requests; please wait before trying again");
    this.name = "RateLimitExceededError";
    this.statusCode = 429;
    this.code = "rate_limited";
    this.limit = result.limit;
    this.remaining = result.remaining;
    this.resetAt = result.resetAt;
    this.retryAfterSeconds = result.retryAfterSeconds;
  }
}

export function createRateLimiter(options = {}) {
  const windowMs = positiveInteger(options.windowMs, defaultRateLimitWindowMs);
  const maxRequests = positiveInteger(options.maxRequests, defaultRateLimitMaxRequests);
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const buckets = new Map();

  function check(key) {
    const current = now();
    prune(current);
    const existing = buckets.get(key);
    const bucket = existing && existing.resetAt > current
      ? existing
      : { count: 0, resetAt: current + windowMs };
    bucket.count += 1;
    buckets.set(key, bucket);

    const remaining = Math.max(0, maxRequests - bucket.count);
    const result = {
      allowed: bucket.count <= maxRequests,
      limit: maxRequests,
      remaining,
      resetAt: new Date(bucket.resetAt).toISOString(),
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - current) / 1000)),
      windowMs,
    };
    if (!result.allowed) {
      result.remaining = 0;
    }
    return result;
  }

  function stats() {
    prune(now());
    return {
      activeBuckets: buckets.size,
      maxRequests,
      windowMs,
    };
  }

  function prune(current) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= current) {
        buckets.delete(key);
      }
    }
  }

  return {
    check,
    stats,
  };
}

export function clientKeyFromRequest(request) {
  const forwardedFor = headerValue(request.headers?.["x-forwarded-for"]);
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  const realIp = headerValue(request.headers?.["x-real-ip"]);
  if (realIp) return realIp;
  return request.socket?.remoteAddress ?? "unknown";
}

export function rateLimitErrorBody(error) {
  return {
    ok: false,
    error: error.message,
    message: error.message,
    code: error.code,
    limit: error.limit,
    remaining: error.remaining,
    resetAt: error.resetAt,
    retryAfterSeconds: error.retryAfterSeconds,
  };
}

function headerValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
