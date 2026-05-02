export function createRequestStats(options = {}) {
  const maxRoutes = positiveInteger(options.maxRoutes, 80);
  const routes = new Map();
  let total = 0;

  function record({ method, pathname, statusCode, durationMs }) {
    if (!pathname.startsWith("/api/")) return;
    total += 1;
    const key = `${method} ${normalizeRoute(pathname)}`;
    let entry = routes.get(key);
    if (!entry) {
      entry = {
        route: key,
        count: 0,
        status: {},
        totalDurationMs: 0,
        maxDurationMs: 0,
      };
      routes.set(key, entry);
    }
    entry.count += 1;
    entry.status[String(statusCode)] = (entry.status[String(statusCode)] ?? 0) + 1;
    entry.totalDurationMs += durationMs;
    entry.maxDurationMs = Math.max(entry.maxDurationMs, durationMs);
    prune();
  }

  function summary() {
    const byRoute = [...routes.values()]
      .sort((left, right) => right.count - left.count || left.route.localeCompare(right.route))
      .map((entry) => ({
        route: entry.route,
        count: entry.count,
        status: entry.status,
        averageDurationMs: Number((entry.totalDurationMs / entry.count).toFixed(2)),
        maxDurationMs: entry.maxDurationMs,
      }));

    return {
      total,
      routes: byRoute,
    };
  }

  function prune() {
    if (routes.size <= maxRoutes) return;
    const oldest = routes.keys().next().value;
    if (oldest) routes.delete(oldest);
  }

  return {
    record,
    summary,
  };
}

export function normalizeRoute(pathname) {
  if (pathname.startsWith("/api/simulation-runs/")) return "/api/simulation-runs/:id";
  if (pathname.startsWith("/api/simulations/")) return "/api/simulations/:id";
  if (pathname.startsWith("/api/reux/simulations/") && pathname.endsWith("/run")) return "/api/reux/simulations/:name/run";
  if (pathname.startsWith("/api/reux/simulations/")) return "/api/reux/simulations/:name";
  return pathname;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
