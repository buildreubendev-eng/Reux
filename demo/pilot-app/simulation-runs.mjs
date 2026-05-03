import { randomUUID } from "node:crypto";

export const defaultMaxSimulationRunRecords = 200;
export const defaultSimulationRunTtlMs = 24 * 60 * 60 * 1000;

export function createSimulationRunStore(options = {}) {
  const records = new Map();
  const maxRecords = positiveInteger(options.maxRecords, defaultMaxSimulationRunRecords);
  const ttlMs = positiveInteger(options.ttlMs, defaultSimulationRunTtlMs);
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const createId = typeof options.createId === "function" ? options.createId : defaultRunId;

  function save({ request, response, session }) {
    prune();
    const createdAt = now();
    const record = {
      id: createId(),
      simulationId: response?.simulation?.id ?? request?.simulationId ?? "operations-decision",
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
      session: normalizeSession(session),
      request,
      response,
    };
    record.response = {
      ...response,
      run: recordSummary(record),
    };
    records.set(record.id, record);
    enforceLimit();
    return record;
  }

  function get(id) {
    prune();
    return records.get(id) ?? null;
  }

  function list({ sessionId } = {}) {
    prune();
    return [...records.values()]
      .filter((record) => !sessionId || record.session.id === sessionId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(recordSummary);
  }

  function stats() {
    prune();
    return {
      records: records.size,
      maxRecords,
      ttlMs,
      oldestCreatedAt: [...records.values()].at(0)?.createdAt ?? null,
      newestCreatedAt: [...records.values()].at(-1)?.createdAt ?? null,
    };
  }

  function prune() {
    const current = now().getTime();
    for (const [id, record] of records) {
      if (Date.parse(record.expiresAt) <= current) {
        records.delete(id);
      }
    }
  }

  function enforceLimit() {
    while (records.size > maxRecords) {
      const oldestId = records.keys().next().value;
      if (!oldestId) return;
      records.delete(oldestId);
    }
  }

  return {
    save,
    get,
    list,
    stats,
  };
}

export function recordSummary(record) {
  const recommendation = record.response?.comparison?.recommendation;
  const scenarioResults = [
    record.response?.baseline,
    ...(Array.isArray(record.response?.scenarios) ? record.response.scenarios : []),
  ].filter(Boolean);
  const margins = scenarioResults
    .map((scenario) => Number(scenario?.finalMetrics?.margin))
    .filter(Number.isFinite);
  const risks = scenarioResults
    .map((scenario) => Number(scenario?.finalMetrics?.riskScore))
    .filter(Number.isFinite);
  const bestMargin = margins.length > 0 ? Math.max(...margins) : undefined;
  const bestMarginScenario = bestMargin === undefined
    ? undefined
    : scenarioResults.find((scenario) => Number(scenario?.finalMetrics?.margin) === bestMargin)?.name;
  const name = record.request?.name ?? record.response?.simulation?.name ?? record.simulationId;
  const scenarioCount = scenarioResults.length || record.response?.scenarios?.length || 0;
  const recommendedScenarioName = recommendation?.scenarioName;
  const displaySubtitle = recommendedScenarioName
    ? `${scenarioCount} scenarios compared. Recommended: ${recommendedScenarioName}.`
    : `${scenarioCount} scenarios compared.`;
  const keyMetric = bestMargin === undefined
    ? undefined
    : {
        metric: "margin",
        label: "Best margin",
        value: bestMargin,
        unit: "USD",
        ...(bestMarginScenario ? { scenarioName: bestMarginScenario } : {}),
      };

  return {
    id: record.id,
    name,
    simulationId: record.simulationId,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    displayTitle: name,
    displaySubtitle,
    shareLabel: `Business Simulator result: ${name}`,
    ...(recommendation?.whyThisWon || recommendation?.summary ? { resultSummary: recommendation.whyThisWon ?? recommendation.summary } : {}),
    ...(keyMetric ? { keyMetric } : {}),
    ...(record.expiresAt ? { expiryNote: `Temporary result expires at ${record.expiresAt}.` } : {}),
    session: record.session,
    scenarioCount,
    ...(bestMargin !== undefined ? { bestMargin } : {}),
    ...(bestMarginScenario ? { bestMarginScenario } : {}),
    ...(risks.length > 0 ? { riskRange: [Math.min(...risks), Math.max(...risks)] } : {}),
    recommendedScenarioId: recommendation?.scenarioId,
    recommendedScenarioName,
  };
}

function normalizeSession(session) {
  return {
    id: session?.id ?? "",
    isolated: Boolean(session?.id),
    schema: session?.schema,
  };
}

function defaultRunId() {
  return `live_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
