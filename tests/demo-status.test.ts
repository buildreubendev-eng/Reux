import { describe, expect, it } from "vitest";
import { emptyOutboxSummary, summarizeOutboxStats } from "../demo/pilot-app/status.mjs";

describe("demo queue status summaries", () => {
  it("normalizes empty outbox stats into a clear queue summary", () => {
    expect(emptyOutboxSummary()).toEqual({
      total: 0,
      active: 0,
      pending: 0,
      processing: 0,
      processed: 0,
      failed: 0,
      dead: 0,
      attempts: 0,
      oldestCreatedAt: null,
      newestCreatedAt: null,
      health: "clear",
    });
  });

  it("summarizes active, processed, and retry states", () => {
    expect(
      summarizeOutboxStats({
        total: 7,
        byStatus: [
          {
            status: "pending",
            count: 2,
            attempts: 0,
            oldestCreatedAt: "2026-04-25T00:01:00.000Z",
            newestCreatedAt: "2026-04-25T00:02:00.000Z",
          },
          {
            status: "processed",
            count: 3,
            attempts: 3,
            oldestCreatedAt: "2026-04-25T00:03:00.000Z",
            newestCreatedAt: "2026-04-25T00:04:00.000Z",
          },
          {
            status: "failed",
            count: 2,
            attempts: 4,
            oldestCreatedAt: "2026-04-25T00:05:00.000Z",
            newestCreatedAt: "2026-04-25T00:06:00.000Z",
          },
        ],
      }),
    ).toEqual({
      total: 7,
      active: 4,
      pending: 2,
      processing: 0,
      processed: 3,
      failed: 2,
      dead: 0,
      attempts: 7,
      oldestCreatedAt: "2026-04-25T00:01:00.000Z",
      newestCreatedAt: "2026-04-25T00:06:00.000Z",
      health: "needs retry",
    });
  });

  it("treats dead-lettered events as blocked", () => {
    expect(
      summarizeOutboxStats({
        total: 1,
        byStatus: [
          {
            status: "dead",
            count: 1,
            attempts: 5,
            oldestCreatedAt: "2026-04-25T00:01:00.000Z",
            newestCreatedAt: "2026-04-25T00:01:00.000Z",
          },
        ],
      }).health,
    ).toBe("blocked");
  });
});
