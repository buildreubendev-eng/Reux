import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface DlConfig {
  backend: "postgres";
  databaseUrlEnv: string;
  migrationsDir: string;
  schemaManifest: string;
  sources: string[];
}

export const defaultConfig: DlConfig = {
  backend: "postgres",
  databaseUrlEnv: "DATABASE_URL",
  migrationsDir: "migrations",
  schemaManifest: ".dl/schema-manifest.json",
  sources: ["src/**/*.dl"],
};

export function loadConfig(cwd = process.cwd(), configPath = process.env.REUX_CONFIG || "dl.json"): DlConfig {
  const resolved = resolve(cwd, configPath);
  if (!existsSync(resolved)) {
    return defaultConfig;
  }

  const parsed = JSON.parse(readFileSync(resolved, "utf8")) as Partial<DlConfig>;
  if (parsed.backend && parsed.backend !== "postgres") {
    throw new Error(`unsupported backend '${parsed.backend}'`);
  }

  return {
    backend: parsed.backend ?? defaultConfig.backend,
    databaseUrlEnv: parsed.databaseUrlEnv ?? defaultConfig.databaseUrlEnv,
    migrationsDir: parsed.migrationsDir ?? defaultConfig.migrationsDir,
    schemaManifest: parsed.schemaManifest ?? defaultConfig.schemaManifest,
    sources: parsed.sources ?? defaultConfig.sources,
  };
}

export function databaseUrl(config: DlConfig, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[config.databaseUrlEnv];
  if (!value) {
    throw new Error(`database URL environment variable ${config.databaseUrlEnv} is not set`);
  }
  return value;
}
