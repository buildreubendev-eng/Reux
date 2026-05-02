export const defaultMaxSessionContexts = 100;
export const defaultSessionIdleMs = 30 * 60 * 1000;

export function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function touchSessionContext(context, now = Date.now()) {
  context.lastAccessedAt = now;
  return context;
}

export function sessionCacheStats(contexts, { now = Date.now(), idleMs = defaultSessionIdleMs, maxContexts = defaultMaxSessionContexts } = {}) {
  let isolatedContexts = 0;
  let sharedContexts = 0;
  let idleContexts = 0;

  for (const context of contexts.values()) {
    if (context.sessionId) {
      isolatedContexts += 1;
    } else {
      sharedContexts += 1;
    }
    if (now - (context.lastAccessedAt ?? now) > idleMs) {
      idleContexts += 1;
    }
  }

  return {
    contexts: contexts.size,
    isolatedContexts,
    sharedContexts,
    idleContexts,
    maxContexts,
    idleMs,
  };
}

export function collectSessionContextEvictions(contexts, { now = Date.now(), idleMs = defaultSessionIdleMs, maxContexts = defaultMaxSessionContexts, keepSchema = "" } = {}) {
  const evictions = new Set();
  const candidates = [...contexts.values()].filter((context) => context.schema !== keepSchema);

  for (const context of candidates) {
    if (now - (context.lastAccessedAt ?? now) > idleMs) {
      evictions.add(context.schema);
    }
  }

  const remainingContexts = contexts.size - evictions.size;
  const overage = remainingContexts - maxContexts;
  if (overage > 0) {
    const oldestFirst = candidates
      .filter((context) => !evictions.has(context.schema))
      .sort((left, right) => (left.lastAccessedAt ?? 0) - (right.lastAccessedAt ?? 0));

    for (const context of oldestFirst.slice(0, overage)) {
      evictions.add(context.schema);
    }
  }

  return [...evictions];
}
