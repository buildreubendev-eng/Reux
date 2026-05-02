import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const dirtyProbePath = ".release-preflight-dirty-test";

afterEach(() => {
  if (existsSync(dirtyProbePath)) rmSync(dirtyProbePath);
});

describe("release preflight script", () => {
  it("passes the documented release metadata checks when dirty-tree gating is disabled", () => {
    const output = execFileSync(process.execPath, ["scripts/release-preflight.mjs", "--allow-dirty"], {
      encoding: "utf8",
    });

    expect(output).toContain("release preflight ok: reux-prototype@0.1.0");
    expect(output).toContain("demo readiness 100%, full completion 100%");
    expect(output).toContain("distribution mode: private/local tarball");
  });

  it("fails the clean-tree gate when uncommitted files are present", () => {
    writeFileSync(dirtyProbePath, "temporary dirty-tree probe\n");

    const result = spawnSync(process.execPath, ["scripts/release-preflight.mjs"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("working tree is not clean");
  });

  it("reports public asset drift without masking the clean-tree gate", () => {
    const generatedPath = "docs/public/reux-public-snapshot.md";
    const original = readFileSync(generatedPath, "utf8");
    writeFileSync(generatedPath, `${original}\n`);

    try {
      const result = spawnSync(process.execPath, ["scripts/release-preflight.mjs"], {
        encoding: "utf8",
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("public asset check failed");
      expect(result.stderr).toContain("working tree is not clean");
    } finally {
      writeFileSync(generatedPath, original);
    }
  });

  it("accepts generated public assets with CRLF checkout newlines", () => {
    const generatedPath = "docs/public/reux-public-snapshot.md";
    const original = readFileSync(generatedPath, "utf8");
    writeFileSync(generatedPath, original.replace(/\r?\n/g, "\r\n"));

    try {
      const output = execFileSync(process.execPath, ["scripts/check-public-assets.mjs"], {
        encoding: "utf8",
      });

      expect(output).toContain("public assets ok");
    } finally {
      writeFileSync(generatedPath, original);
    }
  });
});
