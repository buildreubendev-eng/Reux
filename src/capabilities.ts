import { readFileSync } from "node:fs";

export interface ReuxCapabilityGroup {
  name: string;
  status: "live" | "active" | "prototype-complete" | "planned";
  summary: string;
  capabilities: string[];
}

export interface ReuxCapabilities {
  project: string;
  updatedAt: string;
  headline: string;
  status: {
    demoReadinessPercent: number;
    fullCompletionPercent: number;
    releaseTrack: string;
    summary: string;
  };
  positioning: string[];
  capabilityGroups: ReuxCapabilityGroup[];
  notYet: string[];
  nextResearchTracks: string[];
}

export function getReuxCapabilities(): ReuxCapabilities {
  return JSON.parse(readFileSync(new URL("../docs/public/reux-capabilities.json", import.meta.url), "utf8")) as ReuxCapabilities;
}

export function emitReuxCapabilitiesJson(): string {
  return `${JSON.stringify(getReuxCapabilities(), null, 2)}\n`;
}

export function formatReuxCapabilitiesMarkdown(capabilities: ReuxCapabilities = getReuxCapabilities()): string {
  const lines = [
    `# ${capabilities.project} Capabilities`,
    "",
    capabilities.headline,
    "",
    `Updated: ${capabilities.updatedAt}`,
    "",
    "## Status",
    "",
    `- Demo readiness: roughly ${capabilities.status.demoReadinessPercent}%.`,
    `- Full platform completion: roughly ${capabilities.status.fullCompletionPercent}%.`,
    `- Release track: ${capabilities.status.releaseTrack}.`,
    `- ${capabilities.status.summary}`,
    "",
    "## Positioning",
    "",
    ...capabilities.positioning.map((item) => `- ${item}`),
    "",
    "## Capability Groups",
    "",
  ];

  for (const group of capabilities.capabilityGroups) {
    lines.push(`### ${group.name}`, "", `Status: ${group.status}.`, "", group.summary, "");
    for (const capability of group.capabilities) {
      lines.push(`- ${capability}`);
    }
    lines.push("");
  }

  lines.push("## Not Yet", "", ...capabilities.notYet.map((item) => `- ${item}`), "", "## Next Research Tracks", "");
  for (const track of capabilities.nextResearchTracks) {
    lines.push(`- ${track}`);
  }

  return `${lines.join("\n")}\n`;
}
