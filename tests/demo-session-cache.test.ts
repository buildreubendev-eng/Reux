import { describe, expect, it } from "vitest";
import {
  collectSessionContextEvictions,
  parsePositiveInteger,
  sessionCacheStats,
  touchSessionContext,
} from "../demo/pilot-app/session-cache.mjs";

describe("demo session cache helpers", () => {
  it("parses positive integer configuration with a fallback", () => {
    expect(parsePositiveInteger("25", 10)).toBe(25);
    expect(parsePositiveInteger("0", 10)).toBe(10);
    expect(parsePositiveInteger("nope", 10)).toBe(10);
  });

  it("touches contexts when they are used", () => {
    const context = { schema: "reux_demo_s_public01" };
    expect(touchSessionContext(context, 1234)).toEqual({
      schema: "reux_demo_s_public01",
      lastAccessedAt: 1234,
    });
  });

  it("summarizes shared, isolated, and idle session contexts", () => {
    const contexts = new Map([
      ["reux_demo", { schema: "reux_demo", sessionId: "", lastAccessedAt: 150 }],
      ["reux_demo_s_public01", { schema: "reux_demo_s_public01", sessionId: "public01", lastAccessedAt: 50 }],
    ]);

    expect(sessionCacheStats(contexts, { now: 200, idleMs: 75, maxContexts: 5 })).toEqual({
      contexts: 2,
      isolatedContexts: 1,
      sharedContexts: 1,
      idleContexts: 1,
      maxContexts: 5,
      idleMs: 75,
    });
  });

  it("evicts idle contexts without evicting the active schema", () => {
    const contexts = new Map([
      ["reux_demo_s_old", { schema: "reux_demo_s_old", lastAccessedAt: 100 }],
      ["reux_demo_s_active", { schema: "reux_demo_s_active", lastAccessedAt: 100 }],
    ]);

    expect(collectSessionContextEvictions(contexts, { now: 500, idleMs: 200, maxContexts: 10, keepSchema: "reux_demo_s_active" })).toEqual([
      "reux_demo_s_old",
    ]);
  });

  it("evicts oldest contexts when the cache is over the configured maximum", () => {
    const contexts = new Map([
      ["reux_demo_s_oldest", { schema: "reux_demo_s_oldest", lastAccessedAt: 100 }],
      ["reux_demo_s_middle", { schema: "reux_demo_s_middle", lastAccessedAt: 200 }],
      ["reux_demo_s_newest", { schema: "reux_demo_s_newest", lastAccessedAt: 300 }],
    ]);

    expect(collectSessionContextEvictions(contexts, { now: 350, idleMs: 1000, maxContexts: 2, keepSchema: "reux_demo_s_newest" })).toEqual([
      "reux_demo_s_oldest",
    ]);
  });
});
