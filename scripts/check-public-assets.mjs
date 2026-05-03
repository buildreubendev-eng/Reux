import { readFileSync, writeFileSync } from "node:fs";

const args = new Set(process.argv.slice(2));
const write = args.has("--write");

const roadmap = readJson("docs/public/reux-roadmap.json");
const capabilities = readJson("docs/public/reux-capabilities.json");

const snapshot = buildSnapshot(roadmap, capabilities);
const backlog = buildBacklog(roadmap, capabilities);

const expectedFiles = [
  ["docs/public/reux-public-snapshot.json", `${JSON.stringify(snapshot, null, 2)}\n`],
  ["docs/public/reux-public-snapshot.md", formatSnapshotMarkdown(snapshot)],
  ["docs/technical/next-backlog.json", `${JSON.stringify(backlog, null, 2)}\n`],
  ["docs/technical/next-backlog.md", formatBacklogMarkdown(backlog)],
];

const failures = [];
for (const [path, expected] of expectedFiles) {
  if (write) {
    writeFileSync(path, expected);
    continue;
  }

  const actual = normalizeNewlines(readFileSync(path, "utf8"));
  if (actual !== expected) failures.push(`${path} is out of sync; run npm run public:write`);
}

if (roadmap.status?.demoReadinessPercent !== capabilities.status?.demoReadinessPercent) {
  failures.push("roadmap and capabilities demo readiness percentages differ");
}
if (roadmap.status?.fullCompletionPercent !== capabilities.status?.fullCompletionPercent) {
  failures.push("roadmap and capabilities full completion percentages differ");
}
if (!snapshot.links.capabilitiesJson.endsWith("reux-capabilities.json")) {
  failures.push("public snapshot must link to capabilities JSON");
}
if (!backlog.items.some((item) => item.priority === "P1")) {
  failures.push("next backlog must include at least one P1 item");
}

if (failures.length > 0) {
  console.error("public asset check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(write ? "public assets regenerated" : "public assets ok");

function normalizeNewlines(value) {
  return value.replace(/\r\n/g, "\n");
}

function buildSnapshot(roadmap, capabilities) {
  return {
    project: "Reux",
    updatedAt: capabilities.updatedAt,
    headline: capabilities.headline,
    status: capabilities.status,
    liveNow: roadmap.liveNow,
    capabilityGroups: capabilities.capabilityGroups.map((group) => ({
      name: group.name,
      status: group.status,
      summary: group.summary,
      capabilityCount: group.capabilities.length,
    })),
    nextMilestones: roadmap.milestones.map((milestone, index) => ({
      order: index + 1,
      title: milestone.title,
      goal: milestone.goal,
      itemCount: milestone.items.length,
    })),
    nextResearchTracks: capabilities.nextResearchTracks,
    notYet: capabilities.notYet,
    links: {
      roadmapMarkdown: "docs/public/reux-roadmap.md",
      roadmapJson: "docs/public/reux-roadmap.json",
      capabilitiesMarkdown: "docs/public/reux-capabilities.md",
      capabilitiesJson: "docs/public/reux-capabilities.json",
      demoApiContract: "docs/public/reux-demo-api-contract.json",
      demoTestingGuide: "docs/public/reux-demo-testing-guide.md",
      developerAccess: "docs/public/reux-developer-access.md",
      positioningGuide: "docs/public/reux-positioning.md",
      businessSimulatorProductBrief: "docs/public/business-simulator-product-brief.md",
      businessSimulatorFrontendRoadmap: "docs/public/business-simulator-frontend-roadmap.md",
      businessSimulatorBackendRoadmap: "docs/public/business-simulator-backend-roadmap.md",
    },
  };
}

function buildBacklog(roadmap, capabilities) {
  const milestoneItems = roadmap.milestones.flatMap((milestone, milestoneIndex) =>
    milestone.items.map((item, itemIndex) => ({
      priority: priorityFor(milestoneIndex, itemIndex),
      ownerTrack: milestone.title,
      title: item,
      why: milestone.goal,
      source: "public-roadmap",
    })),
  );
  const researchItems = capabilities.nextResearchTracks.map((track, index) => ({
    priority: index < 2 ? "P1" : index < 4 ? "P2" : "P3",
    ownerTrack: inferTrackOwner(track),
    title: track,
    why: "Move beyond prototype completion into deeper product and language capability.",
    source: "capability-research-track",
  }));

  return {
    project: "Reux",
    updatedAt: capabilities.updatedAt,
    summary: "The prototype bar is complete. This backlog tracks the next work that should make Reux more useful, marketable, and product-backed.",
    items: [...researchItems, ...milestoneItems],
  };
}

function formatSnapshotMarkdown(snapshot) {
  const lines = [
    "# Reux Public Snapshot",
    "",
    snapshot.headline,
    "",
    `Updated: ${snapshot.updatedAt}`,
    "",
    "## Status",
    "",
    `- Demo readiness: roughly ${snapshot.status.demoReadinessPercent}%.`,
    `- Full platform completion: roughly ${snapshot.status.fullCompletionPercent}%.`,
    `- Release track: ${snapshot.status.releaseTrack}.`,
    `- ${snapshot.status.summary}`,
    "",
    "## Capability Groups",
    "",
  ];

  for (const group of snapshot.capabilityGroups) {
    lines.push(`- ${group.name}: ${group.status}. ${group.summary} (${group.capabilityCount} capabilities)`);
  }

  lines.push("", "## Next Milestones", "");
  for (const milestone of snapshot.nextMilestones) {
    lines.push(`${milestone.order}. ${milestone.title}: ${milestone.goal} (${milestone.itemCount} items)`);
  }

  lines.push("", "## Website Data Links", "");
  for (const [label, path] of Object.entries(snapshot.links)) {
    lines.push(`- ${label}: \`${path}\``);
  }

  return `${lines.join("\n")}\n`;
}

function formatBacklogMarkdown(backlog) {
  const lines = [
    "# Reux Next Backlog",
    "",
    backlog.summary,
    "",
    `Updated: ${backlog.updatedAt}`,
    "",
    "## Items",
    "",
  ];

  for (const item of backlog.items) {
    lines.push(`- ${item.priority} | ${item.ownerTrack} | ${item.title}`);
    lines.push(`  Why: ${item.why}`);
    lines.push(`  Source: ${item.source}`);
  }

  return `${lines.join("\n")}\n`;
}

function priorityFor(milestoneIndex, itemIndex) {
  if (milestoneIndex <= 1 && itemIndex <= 1) return "P1";
  if (milestoneIndex <= 3) return "P2";
  return "P3";
}

function inferTrackOwner(track) {
  const normalized = track.toLowerCase();
  if (normalized.includes("transaction") || normalized.includes("expression") || normalized.includes("query")) return "Language Core";
  if (normalized.includes("simulation")) return "Simulation Foundation";
  if (normalized.includes("language-server")) return "Developer Experience";
  return "Product Ecosystem";
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
