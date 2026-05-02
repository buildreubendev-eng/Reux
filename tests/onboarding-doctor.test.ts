import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("onboarding doctor", () => {
  it("passes the source onboarding prerequisite checks", () => {
    const output = execFileSync(process.execPath, ["scripts/onboarding-doctor.mjs"], {
      encoding: "utf8",
    });

    expect(output).toContain("onboarding doctor ok");
    expect(output).toContain("next: npm run onboarding:smoke");
  });

  it("can emit machine-readable onboarding status", () => {
    const output = execFileSync(process.execPath, ["scripts/onboarding-doctor.mjs", "--json"], {
      encoding: "utf8",
    });
    const result = JSON.parse(output);

    expect(result.status).toBe("ok");
    expect(result.nextCommand).toBe("npm run onboarding:smoke");
    expect(result.checks.some((check: { label: string; ok: boolean }) => check.label === "Node.js 22 or newer" && check.ok)).toBe(true);
  });
});
