export function normalizeSessionId(raw) {
  if (!raw) return "";
  const normalized = String(raw).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
  return normalized.length >= 8 ? normalized : "";
}

export function sessionIdFromHeader(rawHeader) {
  return normalizeSessionId(Array.isArray(rawHeader) ? rawHeader[0] : rawHeader);
}

export function assertPostgresIdentifier(value, message = "value must be a PostgreSQL identifier") {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(message);
  }
}

export function sessionSchema(baseSchema, sessionId) {
  assertPostgresIdentifier(baseSchema, "demo schema must be a PostgreSQL identifier");
  if (!sessionId) return baseSchema;
  return `${baseSchema}_s_${sessionId}`;
}

export function sessionInfo(context) {
  return {
    id: context.sessionId,
    isolated: Boolean(context.sessionId),
    schema: context.schema,
  };
}

export function databaseUrlWithSearchPath(value, schema, envName) {
  if (!value) {
    throw new Error(`database URL environment variable ${envName} is not set`);
  }
  assertPostgresIdentifier(schema, "REUX_DEMO_SCHEMA must be a PostgreSQL identifier");

  const url = new URL(value);
  const options = url.searchParams.get("options");
  const searchPath = `-c search_path=${schema},public`;
  url.searchParams.set("options", options ? `${options} ${searchPath}` : searchPath);
  return url.toString();
}

export function quoteIdentifier(value) {
  return `"${value.replace(/"/g, '""')}"`;
}
