import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cliCommands,
  commandUsage,
  formatCommandHelp,
  formatMainHelp,
  formatUnknownCommand,
  isKnownCommand,
  suggestCommand,
} from "../src/cli-help.js";

describe("cli help", () => {
  it("groups commands in the main help output", () => {
    const help = formatMainHelp();

    expect(help).toContain("Reux CLI");
    expect(help).toContain("Getting started:");
    expect(help).toContain("Project workflow:");
    expect(help).toContain("Simulation:");
    expect(help).toContain("reux help [command]");
  });

  it("prints command-specific usage and examples", () => {
    const help = formatCommandHelp("project-query-sql");

    expect(help).toContain("reux project-query-sql <query-name>");
    expect(help).toContain("Examples:");
    expect(help).toContain("reux project-query-sql highValueUsers");
  });

  it("recognizes implemented commands", () => {
    expect(isKnownCommand("check")).toBe(true);
    expect(isKnownCommand("project-check")).toBe(true);
    expect(isKnownCommand("chek")).toBe(false);
  });

  it("suggests close command names for typos", () => {
    expect(suggestCommand("chek")).toBe("check");
    expect(suggestCommand("project-querry-sql")).toBe("project-query-sql");
  });

  it("formats unknown command guidance", () => {
    const message = formatUnknownCommand("chek");

    expect(message).toContain("unknown command: chek");
    expect(message).toContain("Did you mean `check`?");
    expect(message).toContain("reux help check");
  });

  it("returns usage for known commands", () => {
    expect(commandUsage("query-sql")).toBe("reux query-sql <source.dl|source.reux> <query-name>");
    expect(commandUsage("not-real")).toBeUndefined();
  });

  it("keeps help metadata aligned with CLI command dispatch", () => {
    const source = readFileSync("src/cli.ts", "utf8");
    const implemented = new Set([...source.matchAll(/command === "([^"]+)"/g)].map((match) => match[1]));
    const aliases = new Set(["--help", "-h", "--version", "-v"]);

    for (const command of cliCommands) {
      expect(implemented.has(command.name), `${command.name} should be implemented by src/cli.ts`).toBe(true);
    }

    for (const command of implemented) {
      if (!aliases.has(command)) {
        expect(isKnownCommand(command), `${command} should be documented in cliCommands`).toBe(true);
      }
    }
  });
});
