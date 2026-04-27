import { DlError } from "./errors.js";

export interface ObjectLiteralField {
  name: string;
  value: string;
}

export function parseObjectLiteral(source: string): ObjectLiteralField[] {
  const trimmed = source.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new DlError(`expected object literal, got '${source}'`);
  }

  const body = trimmed.slice(1, -1).trim();
  if (!body) return [];

  return splitTopLevel(body, ",").map((part) => {
    const separator = part.indexOf(":");
    if (separator < 0) {
      throw new DlError(`object literal field must be '<name>: <value>'`);
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new DlError(`invalid object literal field name '${name}'`);
    }
    if (!value) {
      throw new DlError(`object literal field '${name}' is missing a value`);
    }
    return { name, value };
  });
}

function splitTopLevel(source: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote && source[index - 1] !== "\\") quote = undefined;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "(" || char === "[") depth += 1;
    if (char === "}" || char === ")" || char === "]") depth -= 1;
    if (depth === 0 && char === separator) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}
