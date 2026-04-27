import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { compileSource } from "./compiler.js";
import { DlConfig } from "./config.js";

export interface ProjectSourceFile {
  path: string;
  relativePath: string;
}

export interface ProjectSummary {
  files: ProjectFileSummary[];
  diagnostics: string[];
  totals: {
    files: number;
    entities: number;
    enums: number;
    queries: number;
    transactions: number;
    transitions: number;
  };
}

export interface ProjectFileSummary {
  path: string;
  moduleName: string;
  entities: string[];
  enums: string[];
  queries: string[];
  transactions: string[];
  transitions: string[];
}

export function discoverSourceFiles(config: DlConfig, cwd = process.cwd()): ProjectSourceFile[] {
  const files = new Map<string, ProjectSourceFile>();
  for (const pattern of config.sources) {
    for (const file of discoverPattern(pattern, cwd)) {
      files.set(file.path, file);
    }
  }
  return [...files.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function summarizeProject(config: DlConfig, cwd = process.cwd()): ProjectSummary {
  const files = discoverSourceFiles(config, cwd).map((sourceFile) => {
    const result = compileSource(readFileSync(sourceFile.path, "utf8"));
    return {
      path: sourceFile.relativePath,
      moduleName: result.program.moduleName,
      entities: result.schema.entities.map((entity) => entity.name),
      enums: result.schema.enums.map((enumeration) => enumeration.name),
      queries: result.program.declarations
        .filter((declaration) => declaration.kind === "query")
        .map((declaration) => declaration.name),
      transactions: result.program.declarations
        .filter((declaration) => declaration.kind === "transaction")
        .map((declaration) => declaration.name),
      transitions: result.program.declarations
        .filter((declaration) => declaration.kind === "transition")
        .map((declaration) => `${declaration.entity}.${declaration.field}`),
    };
  });

  return {
    files,
    diagnostics: projectDiagnostics(files),
    totals: {
      files: files.length,
      entities: sum(files, (file) => file.entities.length),
      enums: sum(files, (file) => file.enums.length),
      queries: sum(files, (file) => file.queries.length),
      transactions: sum(files, (file) => file.transactions.length),
      transitions: sum(files, (file) => file.transitions.length),
    },
  };
}

function projectDiagnostics(files: ProjectFileSummary[]): string[] {
  const diagnostics: string[] = [];
  diagnostics.push(...duplicateDeclarations(files, "entity", (file) => file.entities));
  diagnostics.push(...duplicateDeclarations(files, "enum", (file) => file.enums));
  diagnostics.push(...duplicateDeclarations(files, "query", (file) => file.queries));
  diagnostics.push(...duplicateDeclarations(files, "transaction", (file) => file.transactions));
  diagnostics.push(...duplicateDeclarations(files, "transition", (file) => file.transitions));
  return diagnostics;
}

function duplicateDeclarations(
  files: ProjectFileSummary[],
  label: string,
  selector: (file: ProjectFileSummary) => string[],
): string[] {
  const locations = new Map<string, string[]>();
  for (const file of files) {
    for (const name of selector(file)) {
      const key = `${file.moduleName}.${name}`;
      const existing = locations.get(key) ?? [];
      existing.push(file.path);
      locations.set(key, existing);
    }
  }

  return [...locations.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([name, paths]) => `duplicate ${label} ${name} across ${paths.join(", ")}`);
}

function discoverPattern(pattern: string, cwd: string): ProjectSourceFile[] {
  const normalizedPattern = normalizePath(pattern);
  const absoluteCwd = resolve(cwd);
  const wildcardIndex = firstWildcardIndex(normalizedPattern);

  if (wildcardIndex < 0) {
    const absolutePath = resolve(absoluteCwd, pattern);
    if (!existsSync(absolutePath)) return [];
    return [
      {
        path: absolutePath,
        relativePath: normalizePath(relative(absoluteCwd, absolutePath)),
      },
    ];
  }

  const staticPrefix = normalizedPattern.slice(0, wildcardIndex);
  const basePattern = staticPrefix.includes("/") ? staticPrefix.slice(0, staticPrefix.lastIndexOf("/")) : ".";
  const baseDir = resolve(absoluteCwd, denormalizePath(basePattern || "."));
  if (!existsSync(baseDir)) return [];

  const matcher = globMatcher(normalizedPattern);
  return walk(baseDir)
    .map((path) => ({
      path,
      relativePath: normalizePath(relative(absoluteCwd, path)),
    }))
    .filter((file) => matcher(file.relativePath));
}

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    if (entry.isFile()) return [path];
    return [];
  });
}

function globMatcher(pattern: string): (path: string) => boolean {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*" && pattern[index + 2] === "/") {
      source += "(?:.*/)?";
      index += 2;
    } else if (char === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += escapeRegExp(char);
    }
  }
  const regex = new RegExp(`^${source}$`);
  return (path: string) => regex.test(path);
}

function firstWildcardIndex(value: string): number {
  const star = value.indexOf("*");
  return star;
}

function normalizePath(value: string): string {
  return value.split(sep).join("/");
}

function denormalizePath(value: string): string {
  return value.split("/").join(sep);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function sum<T>(values: T[], selector: (value: T) => number): number {
  return values.reduce((total, value) => total + selector(value), 0);
}
