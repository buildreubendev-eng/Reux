const childProcess = require("node:child_process");
const vscode = require("vscode");

const languageId = "reux";

function activate(context) {
  const output = vscode.window.createOutputChannel("Reux");
  const diagnostics = vscode.languages.createDiagnosticCollection("reux");
  const runner = new ReuxDiagnosticsRunner(diagnostics, output);
  const formatter = new ReuxFormatter(output);
  const intelligence = new ReuxLanguageIntelligence();

  context.subscriptions.push(output, diagnostics);
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => runner.schedule(document)));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => runner.schedule(event.document)));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => runner.schedule(document, 0)));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("reux")) runner.refreshOpenDocuments();
  }));
  context.subscriptions.push(vscode.commands.registerCommand("reux.restartDiagnostics", () => runner.refreshOpenDocuments()));
  context.subscriptions.push(vscode.commands.registerCommand("reux.formatDocument", () => formatter.formatActiveDocument()));
  context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(languageId, formatter));
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(languageId, intelligence, ".", " "));
  context.subscriptions.push(vscode.languages.registerDefinitionProvider(languageId, intelligence));
  context.subscriptions.push(vscode.languages.registerHoverProvider(languageId, intelligence));

  runner.refreshOpenDocuments();
}

function deactivate() {}

class ReuxDiagnosticsRunner {
  constructor(diagnostics, output) {
    this.diagnostics = diagnostics;
    this.output = output;
    this.pending = new Map();
  }

  refreshOpenDocuments() {
    for (const document of vscode.workspace.textDocuments) {
      this.schedule(document, 0);
    }
  }

  schedule(document, delay) {
    if (!isReuxDocument(document)) return;
    const configuredDelay = vscode.workspace.getConfiguration("reux").get("diagnosticsDelayMs", 350);
    const debounceDelay = delay ?? configuredDelay;
    const key = document.uri.toString();
    const pending = this.pending.get(key);
    if (pending) clearTimeout(pending);
    this.pending.set(key, setTimeout(() => {
      this.pending.delete(key);
      this.run(document);
    }, debounceDelay));
  }

  run(document) {
    if (!isReuxDocument(document)) return;
    if (document.uri.scheme !== "file") {
      this.diagnostics.set(document.uri, [fileDiagnostic(document, "Reux diagnostics only run for saved files.")]);
      return;
    }

    const cliPath = vscode.workspace.getConfiguration("reux").get("cliPath", "reux");
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const child = childProcess.spawn(cliPath, ["diagnose", document.uri.fsPath, "--json"], {
      cwd: workspaceFolder?.uri.fsPath,
      shell: true,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      this.output.appendLine(error.message);
      this.diagnostics.set(document.uri, [
        fileDiagnostic(document, `Unable to run Reux diagnostics with '${cliPath}'. Set reux.cliPath to a working CLI command.`),
      ]);
    });
    child.on("close", () => {
      this.applyDiagnostics(document, stdout, stderr, cliPath);
    });
  }

  applyDiagnostics(document, stdout, stderr, cliPath) {
    const parsed = parseDiagnosticReport(stdout);
    if (!parsed) {
      if (stderr.trim()) this.output.appendLine(stderr.trim());
      this.diagnostics.set(document.uri, [
        fileDiagnostic(document, `Unable to parse Reux diagnostics from '${cliPath}'. See the Reux output channel.`),
      ]);
      return;
    }

    if (parsed.ok) {
      this.diagnostics.delete(document.uri);
      return;
    }

    this.diagnostics.set(
      document.uri,
      parsed.diagnostics.map((diagnostic) => fileDiagnostic(document, diagnostic.message)),
    );
  }
}

class ReuxFormatter {
  constructor(output) {
    this.output = output;
  }

  async formatActiveDocument() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isReuxDocument(editor.document)) {
      vscode.window.showWarningMessage("Open a Reux .dl or .reux file before formatting.");
      return;
    }
    const edits = await this.provideDocumentFormattingEdits(editor.document);
    if (!edits || edits.length === 0) return;
    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const edit of edits) {
      workspaceEdit.replace(editor.document.uri, edit.range, edit.newText);
    }
    await vscode.workspace.applyEdit(workspaceEdit);
  }

  provideDocumentFormattingEdits(document) {
    if (!isReuxDocument(document)) return [];
    if (document.uri.scheme !== "file") {
      vscode.window.showWarningMessage("Reux formatting only runs for saved files.");
      return [];
    }

    return new Promise((resolve) => {
      const cliPath = vscode.workspace.getConfiguration("reux").get("cliPath", "reux");
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      const child = childProcess.spawn(cliPath, ["format", document.uri.fsPath], {
        cwd: workspaceFolder?.uri.fsPath,
        shell: true,
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        this.output.appendLine(error.message);
        vscode.window.showErrorMessage(`Unable to run Reux formatter with '${cliPath}'. Set reux.cliPath to a working CLI command.`);
        resolve([]);
      });
      child.on("close", (code) => {
        if (code !== 0) {
          if (stderr.trim()) this.output.appendLine(stderr.trim());
          vscode.window.showErrorMessage("Reux formatter failed. See the Reux output channel.");
          resolve([]);
          return;
        }
        resolve([vscode.TextEdit.replace(fullDocumentRange(document), stdout)]);
      });
    });
  }
}

class ReuxLanguageIntelligence {
  provideCompletionItems(document, position) {
    if (!isReuxDocument(document)) return [];
    const symbols = parseDocumentSymbols(document);
    const completions = keywordCompletions();
    for (const symbol of symbols) {
      const item = new vscode.CompletionItem(symbol.name, symbol.kind === "function" ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Class);
      item.detail = `Reux ${symbol.kind}`;
      item.documentation = symbol.detail;
      completions.push(item);
    }

    const fieldTarget = fieldCompletionTarget(document, position, symbols);
    if (fieldTarget) {
      return fieldTarget.fields.map((field) => {
        const item = new vscode.CompletionItem(field.name, vscode.CompletionItemKind.Field);
        item.detail = field.detail;
        return item;
      });
    }

    const objectTarget = objectLiteralCompletionTarget(document, position, symbols);
    if (objectTarget) {
      return objectTarget.fields.map((field) => {
        const item = new vscode.CompletionItem(field.name, vscode.CompletionItemKind.Field);
        item.detail = `${objectTarget.name}.${field.name}: ${field.detail}`;
        item.insertText = `${field.name}: `;
        return item;
      });
    }

    return completions;
  }

  provideDefinition(document, position) {
    if (!isReuxDocument(document)) return undefined;
    const word = wordAt(document, position);
    if (!word) return undefined;
    const symbol = parseDocumentSymbols(document).find((candidate) => candidate.name === word);
    if (!symbol) return undefined;
    return new vscode.Location(document.uri, symbol.range);
  }

  provideHover(document, position) {
    if (!isReuxDocument(document)) return undefined;
    const word = wordAt(document, position);
    if (!word) return undefined;
    const symbol = parseDocumentSymbols(document).find((candidate) => candidate.name === word);
    if (symbol) {
      return new vscode.Hover(new vscode.MarkdownString(`**${symbol.name}**\n\n${symbol.detail}`), symbol.range);
    }
    const keyword = keywordDetails.get(word);
    if (!keyword) return undefined;
    return new vscode.Hover(new vscode.MarkdownString(`**${word}**\n\n${keyword}`));
  }
}

function parseDiagnosticReport(stdout) {
  try {
    const value = JSON.parse(stdout);
    if (typeof value?.ok !== "boolean" || !Array.isArray(value.diagnostics)) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function isReuxDocument(document) {
  return document.languageId === languageId || document.fileName.endsWith(".reux") || document.fileName.endsWith(".dl");
}

function fileDiagnostic(document, message) {
  const range = diagnosticRange(document, message);
  const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
  diagnostic.source = "reux";
  return diagnostic;
}

function diagnosticRange(document, message) {
  const lineMatch = message.match(/\bline\s+(\d+)\b/i);
  if (lineMatch) {
    const lineNumber = Math.max(0, Math.min(document.lineCount - 1, Number.parseInt(lineMatch[1], 10) - 1));
    return trimmedLineRange(document, lineNumber);
  }
  const inferredRange = inferredDiagnosticRange(document, message);
  return inferredRange ?? firstLineRange(document);
}

function firstLineRange(document) {
  const line = document.lineAt(Math.min(document.lineCount - 1, 0));
  return new vscode.Range(line.range.start, line.range.end);
}

function trimmedLineRange(document, lineNumber) {
  const line = document.lineAt(lineNumber);
  const firstNonWhitespace = line.text.search(/\S/);
  if (firstNonWhitespace < 0) return line.range;
  return new vscode.Range(new vscode.Position(lineNumber, firstNonWhitespace), line.range.end);
}

function inferredDiagnosticRange(document, message) {
  for (const token of diagnosticTokens(message)) {
    const range = findTokenRange(document, token);
    if (range) return range;
  }
  return undefined;
}

function diagnosticTokens(message) {
  const tokens = [];
  for (const dotted of message.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    tokens.push(dotted[1]);
  }
  for (const word of message.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    if (!diagnosticStopWords.has(word[1])) tokens.push(word[1]);
  }
  return [...new Set(tokens)];
}

function findTokenRange(document, token) {
  const parts = token.split(".");
  if (parts.length === 2) {
    const fieldRange = findFieldRange(document, parts[0], parts[1]);
    if (fieldRange) return fieldRange;
  }
  const pattern = new RegExp(`\\b${escapeRegExp(token)}\\b`);
  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
    const text = document.lineAt(lineNumber).text;
    const index = text.search(pattern);
    if (index >= 0) {
      return new vscode.Range(new vscode.Position(lineNumber, index), new vscode.Position(lineNumber, index + token.length));
    }
  }
  return undefined;
}

function findFieldRange(document, ownerName, fieldName) {
  let inOwner = false;
  let depth = 0;
  const declarationPattern = new RegExp(`^\\s*(entity|event|simulate)\\s+${escapeRegExp(ownerName)}\\b`);
  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
    const text = document.lineAt(lineNumber).text;
    if (!inOwner && declarationPattern.test(text)) inOwner = true;
    if (!inOwner) continue;
    depth += countChar(text, "{");
    depth -= countChar(text, "}");
    const index = text.search(new RegExp(`\\b${escapeRegExp(fieldName)}\\b`));
    if (index >= 0) {
      return new vscode.Range(new vscode.Position(lineNumber, index), new vscode.Position(lineNumber, index + fieldName.length));
    }
    if (lineNumber > 0 && depth <= 0) inOwner = false;
  }
  return undefined;
}

function fullDocumentRange(document) {
  const lastLine = document.lineAt(Math.max(document.lineCount - 1, 0));
  return new vscode.Range(new vscode.Position(0, 0), lastLine.range.end);
}

function parseDocumentSymbols(document) {
  const symbols = [];
  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
    const text = document.lineAt(lineNumber).text;
    const range = document.lineAt(lineNumber).range;
    const declaration = text.match(/^\s*(entity|enum|event|simulate)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (declaration) {
      symbols.push({
        kind: declaration[1],
        name: declaration[2],
        range,
        detail: `${declaration[1]} declared in this file.`,
        fields: parseBlockFields(document, lineNumber),
      });
      continue;
    }

    const transition = text.match(/^\s*transition\s+([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (transition) {
      symbols.push({
        kind: "transition",
        name: `${transition[1]}.${transition[2]}`,
        range,
        detail: `Transition rules for ${transition[1]}.${transition[2]}.`,
        fields: [],
      });
      continue;
    }

    const query = text.match(/^\s*query(?:\s+fragment)?\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (query) {
      symbols.push({
        kind: "query",
        name: query[1],
        range,
        detail: "Query declaration.",
        fields: [],
      });
      continue;
    }

    const transaction = text.match(/^\s*transaction\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (transaction) {
      symbols.push({
        kind: "function",
        name: transaction[1],
        range,
        detail: "Transaction function.",
        fields: [],
      });
    }
  }
  return symbols;
}

function parseBlockFields(document, startLine) {
  const fields = [];
  let depth = 0;
  for (let lineNumber = startLine; lineNumber < document.lineCount; lineNumber += 1) {
    const text = document.lineAt(lineNumber).text;
    depth += countChar(text, "{");
    depth -= countChar(text, "}");
    if (lineNumber > startLine && depth <= 0) break;
    const field = text.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^,\n]+)/);
    if (field) {
      fields.push({
        name: field[1],
        detail: field[2].trim(),
      });
    }
  }
  return fields;
}

function fieldCompletionTarget(document, position, symbols) {
  const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
  const match = linePrefix.match(/\b([A-Za-z_][A-Za-z0-9_]*)\.$/);
  if (!match) return undefined;
  const localType = localBindingType(document, position.line, match[1]);
  if (!localType) return undefined;
  return symbols.find((symbol) => symbol.kind === "entity" && symbol.name === localType);
}

function objectLiteralCompletionTarget(document, position, symbols) {
  const source = currentStatementPrefix(document, position);
  const insert = source.match(/\binsert\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{[^}]*$/);
  if (insert) {
    return symbols.find((symbol) => symbol.kind === "entity" && symbol.name === insert[1]);
  }
  const enqueue = source.match(/\benqueue\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{[^}]*$/);
  if (enqueue) {
    return symbols.find((symbol) => symbol.kind === "event" && symbol.name === enqueue[1]);
  }
  return undefined;
}

function currentStatementPrefix(document, position) {
  const lines = [];
  for (let lineNumber = position.line; lineNumber >= 0; lineNumber -= 1) {
    const text = document.lineAt(lineNumber).text;
    const slice = lineNumber === position.line ? text.slice(0, position.character) : text;
    lines.unshift(slice);
    if (lineNumber !== position.line && /^\s*(transaction\s+function|query|simulate|entity|event|enum|transition)\b/.test(text)) break;
    if (lineNumber !== position.line && text.includes("{")) break;
  }
  return lines.join("\n");
}

function localBindingType(document, beforeLine, localName) {
  for (let lineNumber = beforeLine; lineNumber >= 0; lineNumber -= 1) {
    const text = document.lineAt(lineNumber).text;
    const load = text.match(new RegExp(`\\blet\\s+${escapeRegExp(localName)}\\s*=\\s*load\\s+([A-Za-z_][A-Za-z0-9_]*)\\s+for\\s+update\\b`));
    if (load) return parameterTypeNear(document, lineNumber, load[1]);
    const insert = text.match(new RegExp(`\\blet\\s+${escapeRegExp(localName)}\\s*=\\s*insert\\s+([A-Za-z_][A-Za-z0-9_]*)\\b`));
    if (insert) return insert[1];
    const alias = queryAliasType(document, lineNumber, localName);
    if (alias) return alias;
  }
  return undefined;
}

function queryAliasType(document, beforeLine, localName) {
  const startLine = nearestQueryStart(document, beforeLine);
  if (startLine === undefined) return undefined;
  for (let lineNumber = startLine; lineNumber <= beforeLine; lineNumber += 1) {
    const text = document.lineAt(lineNumber).text;
    const from = text.match(new RegExp(`\\bfrom\\s+${escapeRegExp(localName)}\\s+in\\s+([A-Za-z_][A-Za-z0-9_]*)\\b`));
    if (from) return from[1];
    const join = text.match(new RegExp(`\\bjoin\\s+${escapeRegExp(localName)}\\s+in\\s+([A-Za-z_][A-Za-z0-9_]*)\\b`));
    if (join) return join[1];
    const leftJoin = text.match(new RegExp(`\\bleft\\s+join\\s+${escapeRegExp(localName)}\\s+in\\s+([A-Za-z_][A-Za-z0-9_]*)\\b`));
    if (leftJoin) return leftJoin[1];
  }
  return undefined;
}

function nearestQueryStart(document, beforeLine) {
  for (let lineNumber = beforeLine; lineNumber >= 0; lineNumber -= 1) {
    const text = document.lineAt(lineNumber).text;
    if (/^\s*query(?:\s+fragment)?\s+/.test(text)) return lineNumber;
    if (/^\s*(transaction\s+function|simulate|entity|event|enum|transition)\b/.test(text)) return undefined;
  }
  return undefined;
}

function parameterTypeNear(document, beforeLine, parameterName) {
  for (let lineNumber = beforeLine; lineNumber >= 0; lineNumber -= 1) {
    const text = document.lineAt(lineNumber).text;
    const transaction = text.match(/transaction\s+function\s+[A-Za-z_][A-Za-z0-9_]*\(([^)]*)\)/);
    if (!transaction) continue;
    for (const parameter of transaction[1].split(",")) {
      const match = parameter.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/);
      if (match && match[1] === parameterName) return match[2];
    }
  }
  return undefined;
}

function keywordCompletions() {
  return [...keywordDetails.entries()].map(([keyword, detail]) => {
    const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
    item.detail = "Reux keyword";
    item.documentation = detail;
    return item;
  });
}

function wordAt(document, position) {
  const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?/);
  return range ? document.getText(range) : undefined;
}

function countChar(source, char) {
  return [...source].filter((candidate) => candidate === char).length;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const keywordDetails = new Map([
  ["module", "Declares the module name for this Reux source file."],
  ["entity", "Declares a durable data model lowered into the schema IR."],
  ["enum", "Declares a closed set of literal values."],
  ["event", "Declares a typed outbox payload contract."],
  ["query", "Declares a typed read model lowered to SQL."],
  ["simulate", "Declares a prototype simulation forecast model."],
  ["transition", "Declares allowed enum-state transitions for an entity field."],
  ["transaction", "Starts a transaction function declaration."],
  ["writes", "Declares the entities a transaction may mutate or insert."],
  ["retry", "Declares retry attempts for retryable transaction failures."],
  ["load", "Loads an entity reference for update inside a transaction."],
  ["save", "Marks a loaded transaction binding as saved."],
  ["insert", "Inserts a new entity row inside a transaction."],
  ["require", "Declares a transaction guard that aborts when false."],
  ["abort", "Rolls back the current transaction."],
  ["enqueue", "Persists a typed durable outbox event."],
  ["after", "Used with `commit` to declare a post-commit hook."],
  ["commit", "Used with `after` to declare a post-commit hook."],
  ["from", "Starts a query source range."],
  ["join", "Adds a query join."],
  ["where", "Filters query rows."],
  ["select", "Declares a query projection."],
  ["group", "Used with `by` to group query rows."],
  ["order", "Used with `by` to order query rows."],
  ["limit", "Bounds query result count."],
  ["dimension", "Adds classification metadata to a simulation."],
  ["forecast", "Declares the period length for a simulation."],
  ["change", "Declares a scheduled simulation assumption change."],
  ["scenario", "Declares an alternate simulation path."],
  ["formula", "Declares a derived simulation metric."],
  ["objective", "Declares whether a simulation metric should be maximized or minimized."],
]);

const diagnosticStopWords = new Set([
  "Add",
  "Bool",
  "CurrencyCode",
  "Decimal",
  "Duplicate",
  "Id",
  "Int",
  "PostgreSQL",
  "Query",
  "Reux",
  "String",
  "a",
  "abort",
  "add",
  "after",
  "against",
  "an",
  "and",
  "argument",
  "at",
  "be",
  "before",
  "by",
  "change",
  "changes",
  "commit",
  "condition",
  "declaration",
  "declares",
  "duplicate",
  "else",
  "enum",
  "entity",
  "field",
  "for",
  "from",
  "function",
  "in",
  "invalid",
  "is",
  "kind",
  "line",
  "missing",
  "module",
  "must",
  "not",
  "of",
  "or",
  "parameter",
  "query",
  "references",
  "requires",
  "scenario",
  "simulation",
  "source",
  "the",
  "to",
  "transaction",
  "type",
  "unknown",
  "uses",
  "value",
  "with",
]);

module.exports = {
  activate,
  deactivate,
};
