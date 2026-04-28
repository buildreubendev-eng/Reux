import { describe, expect, it } from "vitest";
import {
  databaseUrlWithSearchPath,
  normalizeSessionId,
  quoteIdentifier,
  sessionIdFromHeader,
  sessionInfo,
  sessionSchema,
} from "../demo/pilot-app/session.mjs";

describe("demo session helpers", () => {
  it("normalizes browser session ids into bounded schema suffixes", () => {
    expect(normalizeSessionId("ABC-123_def!4567890")).toBe("abc123def4567890");
    expect(normalizeSessionId("short")).toBe("");
  });

  it("uses the first header value when multiple session headers are present", () => {
    expect(sessionIdFromHeader(["PUBLIC-SESSION-1", "ignored-session"])).toBe("publicsession1");
  });

  it("derives shared and isolated schema names from a validated base schema", () => {
    expect(sessionSchema("reux_demo", "")).toBe("reux_demo");
    expect(sessionSchema("reux_demo", "public01")).toBe("reux_demo_s_public01");
    expect(() => sessionSchema("bad-schema", "public01")).toThrow("demo schema must be a PostgreSQL identifier");
  });

  it("describes the active session without exposing implementation details", () => {
    expect(sessionInfo({ sessionId: "", schema: "reux_demo" })).toEqual({
      id: "",
      isolated: false,
      schema: "reux_demo",
    });
    expect(sessionInfo({ sessionId: "public01", schema: "reux_demo_s_public01" })).toEqual({
      id: "public01",
      isolated: true,
      schema: "reux_demo_s_public01",
    });
  });

  it("adds the schema search path while preserving existing connection options", () => {
    const updated = new URL(databaseUrlWithSearchPath("postgres://user:pass@example.test/db?sslmode=require&options=-c%20statement_timeout%3D5000", "reux_demo_s_public01", "DATABASE_URL"));

    expect(updated.searchParams.get("sslmode")).toBe("require");
    expect(updated.searchParams.get("options")).toBe("-c statement_timeout=5000 -c search_path=reux_demo_s_public01,public");
  });

  it("quotes PostgreSQL identifiers for generated SQL fragments", () => {
    expect(quoteIdentifier("reux_demo")).toBe("\"reux_demo\"");
    expect(quoteIdentifier("schema\"name")).toBe("\"schema\"\"name\"");
  });
});
