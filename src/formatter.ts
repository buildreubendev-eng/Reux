export interface FormatOptions {
  indent?: string;
}

export function formatSource(source: string, options: FormatOptions = {}): string {
  const indent = options.indent ?? "  ";
  const output: string[] = [];
  let depth = 0;
  let blank = false;

  for (const rawLine of source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      blank = pushBlank(output, blank);
      continue;
    }

    const leadingCloses = leadingClosingBraces(line);
    if (leadingCloses > 0) depth = Math.max(0, depth - leadingCloses);
    output.push(`${indent.repeat(depth)}${line}`);
    blank = false;

    const opens = countBraces(line, "{");
    const closes = countBraces(line, "}");
    depth = Math.max(0, depth + opens - closes + leadingCloses);
  }

  while (output.at(-1) === "") output.pop();
  return `${output.join("\n")}\n`;
}

function pushBlank(output: string[], previousBlank: boolean): boolean {
  if (output.length === 0 || previousBlank) return true;
  output.push("");
  return true;
}

function countBraces(line: string, brace: "{" | "}"): number {
  let count = 0;
  let quote: string | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote && line[index - 1] !== "\\") quote = undefined;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === brace) count += 1;
  }
  return count;
}

function leadingClosingBraces(line: string): number {
  return line.match(/^}+/)?.[0].length ?? 0;
}
