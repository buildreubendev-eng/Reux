export const OUTBOX_STATUSES = ["pending", "processing", "processed", "failed", "dead"];

export function summarizeOutboxStats(stats) {
  const byStatus = Object.fromEntries(OUTBOX_STATUSES.map((status) => [status, 0]));
  let attempts = 0;
  let oldestCreatedAt = null;
  let newestCreatedAt = null;

  for (const row of stats?.byStatus ?? []) {
    const status = String(row.status ?? "");
    const count = Number(row.count ?? 0);
    byStatus[status] = count;
    attempts += Number(row.attempts ?? 0);
    oldestCreatedAt = earliestTimestamp(oldestCreatedAt, row.oldestCreatedAt);
    newestCreatedAt = latestTimestamp(newestCreatedAt, row.newestCreatedAt);
  }

  const pending = byStatus.pending ?? 0;
  const processing = byStatus.processing ?? 0;
  const failed = byStatus.failed ?? 0;
  const dead = byStatus.dead ?? 0;
  const processed = byStatus.processed ?? 0;
  const active = pending + processing + failed + dead;

  return {
    total: Number(stats?.total ?? active + processed),
    active,
    pending,
    processing,
    processed,
    failed,
    dead,
    attempts,
    oldestCreatedAt,
    newestCreatedAt,
    health: queueHealth({ pending, processing, failed, dead }),
  };
}

export function emptyOutboxSummary() {
  return summarizeOutboxStats({ total: 0, byStatus: [] });
}

export function summarizeOperationalDashboard(domains) {
  const summaries = domains.map((domain) => ({
    domain: domain.domain,
    title: domain.title,
    queue: summarizeOutboxStats(domain.outbox),
  }));
  const totals = summaries.reduce(
    (current, domain) => ({
      total: current.total + domain.queue.total,
      active: current.active + domain.queue.active,
      pending: current.pending + domain.queue.pending,
      processing: current.processing + domain.queue.processing,
      processed: current.processed + domain.queue.processed,
      failed: current.failed + domain.queue.failed,
      dead: current.dead + domain.queue.dead,
      attempts: current.attempts + domain.queue.attempts,
    }),
    { total: 0, active: 0, pending: 0, processing: 0, processed: 0, failed: 0, dead: 0, attempts: 0 },
  );

  return {
    generatedAt: new Date().toISOString(),
    health: queueHealth(totals),
    totals,
    domains: summaries,
  };
}

function queueHealth({ pending, processing, failed, dead }) {
  if (dead > 0) return "blocked";
  if (failed > 0) return "needs retry";
  if (pending > 0 || processing > 0) return "working";
  return "clear";
}

function earliestTimestamp(current, value) {
  if (!value) return current;
  if (!current) return String(value);
  return Date.parse(String(value)) < Date.parse(current) ? String(value) : current;
}

function latestTimestamp(current, value) {
  if (!value) return current;
  if (!current) return String(value);
  return Date.parse(String(value)) > Date.parse(current) ? String(value) : current;
}
