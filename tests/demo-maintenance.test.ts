import { describe, expect, it } from "vitest";
import {
  isManagedSessionSchema,
  maintenanceKeepSessions,
  normalizeSessionId,
  optionValue,
  planSimulationRunMaintenance,
  quoteIdentifier,
  sessionIdFromSchema,
  simulationRunTable,
} from "../scripts/demo-maintenance.mjs";

describe("demo maintenance helpers", () => {
  it("normalizes keep sessions and recognizes managed session schemas", () => {
    expect(normalizeSessionId("Health Check!!")).toBe("healthcheck");
    expect([...maintenanceKeepSessions("Steve One,Public_123")]).toEqual([
      "healthcheck",
      "healthcheckci",
      "steveone",
      "public123",
    ]);
    expect(isManagedSessionSchema("reux_demo", "reux_demo_s_public123")).toBe(true);
    expect(isManagedSessionSchema("reux_demo", "reux_demo_s_short")).toBe(false);
    expect(isManagedSessionSchema("reux_demo", "other_s_public123")).toBe(false);
    expect(sessionIdFromSchema("reux_demo", "reux_demo_s_public123")).toBe("public123");
  });

  it("quotes identifiers and parses CLI option values", () => {
    expect(quoteIdentifier('reux"demo')).toBe('"reux""demo"');
    expect(simulationRunTable("reux_demo")).toBe('"reux_demo"._reux_simulation_runs');
    expect(optionValue(["--schema=reux_demo", "--apply"], "--schema")).toBe("reux_demo");
    expect(optionValue(["--schema", "reux_demo"], "--schema")).toBeUndefined();
  });

  it("plans expired and overflow saved-run cleanup", async () => {
    const client = mockClient({
      tableExists: true,
      expiredIds: ["live_expired"],
      overflowIds: ["live_old"],
      activeCount: 4,
    });

    await expect(planSimulationRunMaintenance(client, "reux_demo", 2)).resolves.toEqual({
      tableExists: true,
      activeCount: 4,
      expiredIds: ["live_expired"],
      overflowIds: ["live_old"],
      candidateIds: ["live_expired", "live_old"],
    });
    expect(client.queries.map((query) => query.sql.replace(/\s+/g, " ").trim())).toEqual([
      "SELECT to_regclass($1) AS name;",
      'SELECT id FROM "reux_demo"._reux_simulation_runs WHERE expires_at <= now() ORDER BY expires_at ASC, created_at ASC;',
      'SELECT id FROM "reux_demo"._reux_simulation_runs WHERE expires_at > now() ORDER BY created_at DESC OFFSET $1;',
      'SELECT count(*) AS count FROM "reux_demo"._reux_simulation_runs WHERE expires_at > now();',
    ]);
  });

  it("handles a missing saved-run table as an empty maintenance plan", async () => {
    const client = mockClient({
      tableExists: false,
      expiredIds: [],
      overflowIds: [],
      activeCount: 0,
    });

    await expect(planSimulationRunMaintenance(client, "reux_demo", 2)).resolves.toEqual({
      tableExists: false,
      activeCount: 0,
      expiredIds: [],
      overflowIds: [],
      candidateIds: [],
    });
    expect(client.queries).toHaveLength(1);
  });
});

function mockClient(options: {
  tableExists: boolean;
  expiredIds: string[];
  overflowIds: string[];
  activeCount: number;
}) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    queries,
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      if (sql.includes("to_regclass")) {
        return { rows: [{ name: options.tableExists ? "reux_demo._reux_simulation_runs" : null }] };
      }
      if (sql.includes("expires_at <= now()")) {
        return { rows: options.expiredIds.map((id) => ({ id })) };
      }
      if (sql.includes("OFFSET")) {
        return { rows: options.overflowIds.map((id) => ({ id })) };
      }
      if (sql.includes("count(*)")) {
        return { rows: [{ count: String(options.activeCount) }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}
