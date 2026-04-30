# Editor Tooling

Reux now has a first editor-support slice:

- CLI formatter for `.dl` and `.reux` files.
- Project-scoped formatter for the single-source `dl.json` workflow.
- Local VS Code syntax package under `editors/vscode`.

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

It provides `.reux` and `.dl` file association, syntax highlighting, and bracket/quote pairing. It does not yet run compiler diagnostics in the editor.

Use the CLI for validation:

```bash
node dist/cli.js diagnose examples/pilot_reux.dl --json
node dist/cli.js check examples/pilot_reux.dl
```

## Next Editor Work

The next editor milestone is a small language server that shells out to the compiler diagnostics path, then adds document formatting, go-to-definition for declarations, and hover text for fields and transaction parameters.
