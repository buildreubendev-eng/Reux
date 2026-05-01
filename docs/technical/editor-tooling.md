# Editor Tooling

Reux now has a first editor-support slice:

- CLI formatter for `.dl` and `.reux` files.
- Project-scoped formatter for the single-source `dl.json` workflow.
- Local VS Code syntax package under `editors/vscode`.
- CLI-backed VS Code diagnostics with line-aware ranges when compiler messages include a source line.
- VS Code document formatting backed by the Reux CLI.
- Lightweight VS Code completions, hover text, and current-file go-to-definition.

## Formatting

Build the CLI, then format a file to stdout:

```bash
npm run build
node dist/cli.js format examples/pilot_reux.dl
node dist/cli.js format examples/simulations/personal_finance.reux
```

For a project with exactly one configured source in `dl.json`:

```bash
node dist/cli.js project-format
```

The formatter is intentionally conservative. It normalizes indentation, trims line edges, collapses repeated blank lines, and preserves source order and expressions. It does not rewrite syntax or reorder declarations.

## VS Code

The local VS Code language package lives at:

```text
editors/vscode
```

It provides `.reux` and `.dl` file association, syntax highlighting, bracket/quote pairing, compiler diagnostics, document formatting, lightweight completions, hover text, and current-file go-to-definition. Diagnostics run:

```bash
reux diagnose <file> --json
```

Set `reux.cliPath` in VS Code settings when the `reux` command is not on `PATH` or when you want to point at a local development build.

Formatting runs:

```bash
reux format <file>
```

Use the CLI for validation:

```bash
node dist/cli.js diagnose examples/pilot_reux.dl --json
node dist/cli.js check examples/pilot_reux.dl
```

Current editor intelligence includes:

- Keyword completions for schema, query, transaction, and simulation syntax.
- Current-file symbol completions and go-to-definition.
- Dotted field completions for transaction bindings such as `account.` after `let account = load accountRef for update`.
- Dotted field completions for query range aliases such as `order.` and `account.` inside query bodies.
- Object-field completions inside `insert Entity { ... }` and `enqueue Event { ... }` payloads.

## Next Editor Work

The next editor milestone is a proper language-server process with compiler-backed semantic completion, cross-file navigation, rename, and expression-aware diagnostic ranges.
