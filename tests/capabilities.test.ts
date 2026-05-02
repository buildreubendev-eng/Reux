import { describe, expect, it } from "vitest";
import { emitReuxCapabilitiesJson, formatReuxCapabilitiesMarkdown, getReuxCapabilities } from "../src/capabilities.js";

describe("public capabilities", () => {
  it("loads the public capability manifest", () => {
    const capabilities = getReuxCapabilities();

    expect(capabilities.project).toBe("Reux");
    expect(capabilities.status.demoReadinessPercent).toBeGreaterThanOrEqual(99);
    expect(capabilities.status.fullCompletionPercent).toBeGreaterThanOrEqual(100);
    expect(capabilities.capabilityGroups.map((group) => group.name)).toEqual([
      "Language Core",
      "Runtime And Database",
      "Developer Experience",
      "Public Demo",
      "Pilots And Validation",
    ]);
  });

  it("emits stable JSON for CLI and website consumers", () => {
    const emitted = JSON.parse(emitReuxCapabilitiesJson());

    expect(emitted.project).toBe("Reux");
    expect(emitted.capabilityGroups).toHaveLength(5);
    expect(emitted.nextResearchTracks).toContain("Product-facing simulation execution APIs");
  });

  it("renders a concise markdown capability brief", () => {
    const markdown = formatReuxCapabilitiesMarkdown();

    expect(markdown).toContain("# Reux Capabilities");
    expect(markdown).toContain("Demo readiness: roughly 100%.");
    expect(markdown).toContain("### Public Demo");
    expect(markdown).toContain("## Next Research Tracks");
  });
});
