import {
  EntityDeclaration,
  EnumDeclaration,
  FieldAttributes,
  FieldDeclaration,
  IndexDeclaration,
  Program,
  QueryBody,
  QueryDeclaration,
  QueryParameter,
  QueryProjection,
  TransitionDeclaration,
  TransactionDeclaration,
  TypeRef,
} from "./ast.js";
import { DlError } from "./errors.js";

const declarationStart = /^(entity|enum|query|transition|transaction\s+function)\s+/;

export function parseProgram(source: string): Program {
  const lines = normalizeLines(source);
  const moduleLine = lines.find((line) => line.text.trim().length > 0);
  if (!moduleLine) {
    throw new DlError("expected module declaration");
  }

  const moduleMatch = moduleLine.text.trim().match(/^module\s+([A-Za-z_][A-Za-z0-9_]*)$/);
  if (!moduleMatch) {
    throw new DlError(`line ${moduleLine.number}: expected 'module <name>'`);
  }

  const declarations: Program["declarations"] = [];
  let index = lines.indexOf(moduleLine) + 1;

  while (index < lines.length) {
    const current = lines[index];
    const text = current.text.trim();
    if (!text) {
      index += 1;
      continue;
    }

    if (text.startsWith("entity ")) {
      const parsed = parseEntity(lines, index);
      declarations.push(parsed.declaration);
      index = parsed.nextIndex;
      continue;
    }

    if (text.startsWith("enum ")) {
      const parsed = parseEnum(lines, index);
      declarations.push(parsed.declaration);
      index = parsed.nextIndex;
      continue;
    }

    if (text.startsWith("query ")) {
      const parsed = parseQuery(lines, index);
      declarations.push(parsed.declaration);
      index = parsed.nextIndex;
      continue;
    }

    if (text.startsWith("transition ")) {
      const parsed = parseTransition(lines, index);
      declarations.push(parsed.declaration);
      index = parsed.nextIndex;
      continue;
    }

    if (text.startsWith("transaction function ")) {
      const parsed = parseTransaction(lines, index);
      declarations.push(parsed.declaration);
      index = parsed.nextIndex;
      continue;
    }

    throw new DlError(`line ${current.number}: unexpected declaration '${text}'`);
  }

  return {
    moduleName: moduleMatch[1],
    declarations,
  };
}

function parseTransition(lines: SourceLine[], start: number): { declaration: TransitionDeclaration; nextIndex: number } {
  const header = lines[start].text.trim();
  const match = header.match(/^transition\s+([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*\{$/);
  if (!match) {
    throw new DlError(`line ${lines[start].number}: expected 'transition Entity.field {'`);
  }

  const rules: TransitionDeclaration["rules"] = [];
  let index = start + 1;
  while (index < lines.length) {
    const text = lines[index].text.trim();
    if (!text) {
      index += 1;
      continue;
    }
    if (text === "}") {
      return {
        declaration: {
          kind: "transition",
          entity: match[1],
          field: match[2],
          rules,
        },
        nextIndex: index + 1,
      };
    }
    const rule = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)$/);
    if (!rule) {
      throw new DlError(`line ${lines[index].number}: expected transition rule like 'Pending -> Paid'`);
    }
    rules.push({ from: rule[1], to: rule[2] });
    index += 1;
  }

  throw new DlError(`line ${lines[start].number}: transition '${match[1]}.${match[2]}' is missing a closing brace`);
}

function parseTransaction(lines: SourceLine[], start: number): { declaration: TransactionDeclaration; nextIndex: number } {
  const collected: string[] = [];
  let depth = 0;
  let startedBody = false;
  let index = start;

  while (index < lines.length) {
    const trimmed = lines[index].text.trim();
    if (trimmed) {
      collected.push(trimmed);
      for (const char of trimmed) {
        if (char === "{") {
          depth += 1;
          startedBody = true;
        } else if (char === "}") {
          depth -= 1;
        }
      }
    }
    index += 1;
    if (startedBody && depth === 0) break;
  }

  const source = collected.join("\n");
  const match = source.match(
    /^transaction\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\(([^)]*)\)\s+writes\s+([A-Za-z0-9_,\s]+?)(?:\s+retry(?:\s+(\d+))?)?\s*\{([\s\S]*)\}$/u,
  );
  if (!match) {
    throw new DlError(`line ${lines[start].number}: could not parse transaction function declaration`);
  }

  return {
    declaration: {
      kind: "transaction",
      name: match[1],
      parameters: parseQueryParameters(match[2]),
      writes: match[3].split(",").map((write) => write.trim()).filter(Boolean),
      retry: match[4] ? { attempts: Number.parseInt(match[4], 10) } : undefined,
      body: match[5].trim(),
    },
    nextIndex: index,
  };
}

function parseEntity(lines: SourceLine[], start: number): { declaration: EntityDeclaration; nextIndex: number } {
  const header = lines[start].text.trim();
  const match = header.match(/^entity\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{$/);
  if (!match) {
    throw new DlError(`line ${lines[start].number}: expected 'entity Name {'`);
  }

  const fields: FieldDeclaration[] = [];
  const indexes: IndexDeclaration[] = [];
  let index = start + 1;
  while (index < lines.length) {
    const line = lines[index];
    const text = line.text.trim();
    if (!text) {
      index += 1;
      continue;
    }

    if (text === "}") {
      return {
        declaration: {
          kind: "entity",
          name: match[1],
          fields,
          indexes,
        },
        nextIndex: index + 1,
      };
    }

    if (text.startsWith("index ")) {
      indexes.push(parseIndex(text, line.number));
    } else {
      fields.push(parseField(text, line.number));
    }
    index += 1;
  }

  throw new DlError(`line ${lines[start].number}: entity '${match[1]}' is missing a closing brace`);
}

function parseField(text: string, lineNumber: number): FieldDeclaration {
  const separator = text.indexOf(":");
  if (separator < 0) {
    throw new DlError(`line ${lineNumber}: expected field declaration '<name>: <type>'`);
  }

  const name = text.slice(0, separator).trim();
  if (!isIdentifier(name)) {
    throw new DlError(`line ${lineNumber}: invalid field name '${name}'`);
  }

  const rest = text.slice(separator + 1).trim();
  const typeEnd = findTypeEnd(rest);
  const typeSource = rest.slice(0, typeEnd).trim();
  const modifiers = rest.slice(typeEnd).trim();

  if (!typeSource) {
    throw new DlError(`line ${lineNumber}: field '${name}' is missing a type`);
  }

  return {
    name,
    type: parseTypeRef(typeSource),
    attributes: parseFieldAttributes(modifiers),
    source: text,
  };
}

function findTypeEnd(rest: string): number {
  let depth = 0;
  for (let index = 0; index < rest.length; index += 1) {
    const char = rest[index];
    if (char === "<") depth += 1;
    if (char === ">") depth -= 1;
    if (depth === 0 && /\s/.test(char)) {
      return index;
    }
  }
  return rest.length;
}

function parseFieldAttributes(source: string): FieldAttributes {
  const attributes: FieldAttributes = {
    primary: false,
    generated: false,
    required: false,
    unique: false,
  };

  const words = source.split(/\s+/).filter(Boolean);
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (word === "primary") {
      attributes.primary = true;
      index += 1;
      continue;
    }
    if (word === "generated") {
      attributes.generated = true;
      index += 1;
      continue;
    }
    if (word === "required") {
      attributes.required = true;
      index += 1;
      continue;
    }
    if (word === "unique") {
      attributes.unique = true;
      index += 1;
      continue;
    }
    if (word === "default") {
      const checkIndex = words.indexOf("check", index + 1);
      const end = checkIndex === -1 ? words.length : checkIndex;
      attributes.defaultValue = words.slice(index + 1, end).join(" ");
      index = end;
      continue;
    }
    if (word === "check") {
      attributes.check = words.slice(index + 1).join(" ");
      break;
    }
    throw new DlError(`unknown field modifier '${word}' in '${source}'`);
  }

  return attributes;
}

function parseIndex(text: string, lineNumber: number): IndexDeclaration {
  const match = text.match(/^index\s+([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/);
  if (!match) {
    throw new DlError(`line ${lineNumber}: expected index declaration like 'index byName(field desc)'`);
  }

  const fields = splitTopLevel(match[2], ",").map((part) => {
    const [name, direction] = part.trim().split(/\s+/);
    if (!isIdentifier(name)) {
      throw new DlError(`line ${lineNumber}: invalid index field '${part}'`);
    }
    if (direction && direction !== "asc" && direction !== "desc") {
      throw new DlError(`line ${lineNumber}: index direction must be 'asc' or 'desc'`);
    }
    return {
      name,
      direction: direction as "asc" | "desc" | undefined,
    };
  });

  return { name: match[1], fields };
}

function parseEnum(lines: SourceLine[], start: number): { declaration: EnumDeclaration; nextIndex: number } {
  const header = lines[start].text.trim();
  const singleLine = header.match(/^enum\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{(.+)\}$/);
  if (singleLine) {
    return {
      declaration: {
        kind: "enum",
        name: singleLine[1],
        values: singleLine[2].split(/\s+/).filter(Boolean),
      },
      nextIndex: start + 1,
    };
  }

  const match = header.match(/^enum\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{$/);
  if (!match) {
    throw new DlError(`line ${lines[start].number}: expected 'enum Name {'`);
  }

  const values: string[] = [];
  let index = start + 1;
  while (index < lines.length) {
    const text = lines[index].text.trim();
    if (!text) {
      index += 1;
      continue;
    }
    if (text === "}") {
      return {
        declaration: {
          kind: "enum",
          name: match[1],
          values,
        },
        nextIndex: index + 1,
      };
    }
    if (!isIdentifier(text)) {
      throw new DlError(`line ${lines[index].number}: invalid enum value '${text}'`);
    }
    values.push(text);
    index += 1;
  }

  throw new DlError(`line ${lines[start].number}: enum '${match[1]}' is missing a closing brace`);
}

function parseQuery(lines: SourceLine[], start: number): { declaration: QueryDeclaration; nextIndex: number } {
  const collected: string[] = [];
  let index = start;
  while (index < lines.length) {
    const trimmed = lines[index].text.trim();
    if (index !== start && declarationStart.test(trimmed)) break;
    if (trimmed) collected.push(trimmed);
    index += 1;
  }

  const source = collected.join(" ");
  const match = source.match(
    /^query\s+([A-Za-z_][A-Za-z0-9_]*)\((.*)\):\s*(.+?)\s*=\s*(from\s+.+)$/u,
  );
  if (!match) {
    throw new DlError(`line ${lines[start].number}: could not parse query declaration`);
  }

  return {
    declaration: {
      kind: "query",
      name: match[1],
      parameters: parseQueryParameters(match[2]),
      resultType: match[3].trim(),
      body: parseQueryBody(match[4], lines[start].number),
    },
    nextIndex: index,
  };
}

function parseQueryParameters(source: string): QueryParameter[] {
  if (!source.trim()) return [];
  return splitTopLevel(source, ",").map((part) => {
    const [name, typeSource] = part.split(":").map((piece) => piece.trim());
    if (!isIdentifier(name) || !typeSource) {
      throw new DlError(`invalid query parameter '${part}'`);
    }
    return { name, type: parseTypeRef(typeSource) };
  });
}

function parseQueryBody(source: string, lineNumber: number): QueryBody {
  const fromMatch = source.match(/^from\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_]*)(.*)$/u);
  if (!fromMatch) {
    throw new DlError(`line ${lineNumber}: expected query body to start with 'from <name> in <Entity>'`);
  }

  const rest = fromMatch[3].trim();
  const selectIndex = findKeyword(rest, "select");
  if (selectIndex < 0) {
    throw new DlError(`line ${lineNumber}: query is missing select clause`);
  }

  const beforeSelect = rest.slice(0, selectIndex).trim();
  const selectSource = rest.slice(selectIndex + "select".length).trim();
  const orderIndex = findKeyword(beforeSelect, "order by");
  const groupIndex = findKeyword(beforeSelect, "group by");
  const whereIndex = findKeyword(beforeSelect, "where");
  const limitIndex = findKeyword(beforeSelect, "limit");
  const firstClauseIndex = minDefined(whereIndex, groupIndex, orderIndex, limitIndex) ?? beforeSelect.length;
  const joinsSource = beforeSelect.slice(0, firstClauseIndex).trim();
  const clauseSource = beforeSelect.slice(firstClauseIndex).trim();
  const clauseOrderIndex = findKeyword(clauseSource, "order by");
  const clauseGroupIndex = findKeyword(clauseSource, "group by");
  const clauseWhereIndex = findKeyword(clauseSource, "where");
  const clauseLimitIndex = findKeyword(clauseSource, "limit");

  let where: string | undefined;
  let groupBy: string[] = [];
  let orderBy: QueryBody["orderBy"];
  let limit: string | undefined;

  if (clauseWhereIndex >= 0) {
    const whereEnd = minDefinedAfter(clauseWhereIndex, clauseGroupIndex, clauseOrderIndex, clauseLimitIndex) ?? clauseSource.length;
    where = clauseSource.slice(clauseWhereIndex + "where".length, whereEnd).trim();
  }

  if (clauseGroupIndex >= 0) {
    const groupEnd = minDefinedAfter(clauseGroupIndex, clauseOrderIndex, clauseLimitIndex) ?? clauseSource.length;
    groupBy = splitTopLevel(clauseSource.slice(clauseGroupIndex + "group by".length, groupEnd).trim(), ",");
  }

  if (clauseOrderIndex >= 0) {
    const orderEnd = minDefinedAfter(clauseOrderIndex, clauseLimitIndex) ?? clauseSource.length;
    const orderSource = clauseSource.slice(clauseOrderIndex + "order by".length, orderEnd).trim();
    const orderMatch = orderSource.match(/^(.+)\s+(asc|desc)$/);
    if (!orderMatch) {
      throw new DlError(`line ${lineNumber}: order by must end with 'asc' or 'desc'`);
    }
    orderBy = {
      expression: orderMatch[1].trim(),
      direction: orderMatch[2] as "asc" | "desc",
    };
  }

  if (clauseLimitIndex >= 0) {
    limit = clauseSource.slice(clauseLimitIndex + "limit".length).trim();
    if (!limit) {
      throw new DlError(`line ${lineNumber}: limit clause requires a value`);
    }
  }

  return {
    rangeName: fromMatch[1],
    sourceEntity: fromMatch[2],
    joins: parseJoins(joinsSource, lineNumber),
    where,
    groupBy,
    orderBy,
    limit,
    select: parseProjection(selectSource, lineNumber),
  };
}

function parseJoins(source: string, lineNumber: number): QueryBody["joins"] {
  if (!source) return [];
  const joins: QueryBody["joins"] = [];
  const pattern =
    /\bjoin\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_]*)\s+on\s+([\s\S]*?)(?=\s+\bjoin\s+[A-Za-z_][A-Za-z0-9_]*\s+in\s+[A-Za-z_][A-Za-z0-9_]*\s+on\s+|$)/gu;
  let lastIndex = 0;
  let remainder = "";
  for (const match of source.matchAll(pattern)) {
    remainder += source.slice(lastIndex, match.index);
    lastIndex = match.index + match[0].length;
    joins.push({
      rangeName: match[1],
      sourceEntity: match[2],
      on: match[3].trim(),
    });
  }
  remainder += source.slice(lastIndex);
  if (remainder.trim()) {
    throw new DlError(`line ${lineNumber}: could not parse join clause '${source}'`);
  }
  return joins;
}

function parseProjection(source: string, lineNumber: number): QueryProjection {
  if (!source.startsWith("{")) {
    return { kind: "entity", expression: source };
  }
  if (!source.endsWith("}")) {
    throw new DlError(`line ${lineNumber}: record projection is missing closing brace`);
  }
  const body = source.slice(1, -1).trim();
  return {
    kind: "record",
    fields: splitTopLevel(body, ",").map((part) => {
      const separator = part.indexOf(":");
      if (separator < 0) {
        throw new DlError(`line ${lineNumber}: projection field must be '<name>: <expression>'`);
      }
      const name = part.slice(0, separator).trim();
      const expression = part.slice(separator + 1).trim();
      if (!isIdentifier(name)) {
        throw new DlError(`line ${lineNumber}: invalid projection field name '${name}'`);
      }
      return { name, expression };
    }),
  };
}

export function parseTypeRef(source: string): TypeRef {
  const raw = source.trim();
  const optional = raw.endsWith("?");
  const withoutOptional = optional ? raw.slice(0, -1) : raw;
  const genericStart = withoutOptional.indexOf("<");

  if (genericStart >= 0) {
    if (!withoutOptional.endsWith(">")) {
      throw new DlError(`invalid type '${source}'`);
    }
    const name = withoutOptional.slice(0, genericStart);
    const argsSource = withoutOptional.slice(genericStart + 1, -1);
    return {
      name,
      optional,
      args: splitTopLevel(argsSource, ",").map(parseTypeRef),
      raw,
    };
  }

  return {
    name: withoutOptional,
    optional,
    args: [],
    raw,
  };
}

function normalizeLines(source: string): SourceLine[] {
  return source.replace(/\r\n/g, "\n").split("\n").map((text, index) => ({
    text: stripComment(text),
    number: index + 1,
  }));
}

function stripComment(line: string): string {
  const commentStart = line.indexOf("//");
  return commentStart >= 0 ? line.slice(0, commentStart) : line;
}

function findKeyword(source: string, keyword: string): number {
  return source.search(new RegExp(`\\b${keyword.replace(" ", "\\s+")}\\b`, "u"));
}

function minDefined(...values: number[]): number | undefined {
  const defined = values.filter((value) => value >= 0);
  return defined.length === 0 ? undefined : Math.min(...defined);
}

function minDefinedAfter(after: number, ...values: number[]): number | undefined {
  const defined = values.filter((value) => value > after);
  return defined.length === 0 ? undefined : Math.min(...defined);
}

function splitTopLevel(source: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "<" || char === "{" || char === "(") depth += 1;
    if (char === ">" || char === "}" || char === ")") depth -= 1;
    if (depth === 0 && char === separator) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

interface SourceLine {
  text: string;
  number: number;
}
