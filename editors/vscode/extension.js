const childProcess = require("node:child_process");
const vscode = require("vscode");

const languageId = "reux";

function activate(context) {
  const output = vscode.window.createOutputChannel("Reux");
  const diagnostics = vscode.languages.createDiagnosticCollection("reux");
  const runner = new ReuxDiagnosticsRunner(diagnostics, output);

  context.subscriptions.push(output, diagnostics);
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => runner.schedule(document)));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => runner.schedule(event.document)));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => runner.schedule(document, 0)));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("reux")) runner.refreshOpenDocuments();
  }));
  context.subscriptions.push(vscode.commands.registerCommand("reux.restartDiagnostics", () => runner.refreshOpenDocuments()));

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
  const range = firstLineRange(document);
  const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
  diagnostic.source = "reux";
  return diagnostic;
}

function firstLineRange(document) {
  const line = document.lineAt(Math.min(document.lineCount - 1, 0));
  return new vscode.Range(line.range.start, line.range.end);
}

module.exports = {
  activate,
  deactivate,
};
