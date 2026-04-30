# Reux VS Code Language Support

This folder contains the first local VS Code language package for Reux.

It currently provides:

- `.reux` and `.dl` file association.
- Syntax highlighting for declarations, keywords, strings, numbers, and built-in types.
- Basic bracket and quote pairing.
- File-level compiler diagnostics by running `reux diagnose <file> --json`.

It does not yet provide completion, rename, hover, or go-to-definition.

```bash
npm run build
node dist/cli.js check examples/pilot_reux.dl
node dist/cli.js format examples/pilot_reux.dl
```

Diagnostics use the `reux` command on your `PATH` by default. If you are working from the repository instead of a global install, set `reux.cliPath` in VS Code settings to the built CLI command you want the extension to run.

For local development, copy or symlink this folder into your VS Code extensions directory, then reload VS Code.
