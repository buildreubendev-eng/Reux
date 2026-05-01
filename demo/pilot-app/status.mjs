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
