# Reux VS Code Language Support

This folder contains the first local VS Code language package for Reux.

It currently provides:

- `.reux` and `.dl` file association.
- Syntax highlighting for declarations, keywords, strings, numbers, and built-in types.
- Basic bracket and quote pairing.

It does not yet provide language-server diagnostics, completion, rename, or go-to-definition. Use the CLI for those checks:

```bash
npm run build
node dist/cli.js check examples/pilot_reux.dl
node dist/cli.js format examples/pilot_reux.dl
```

For local development, copy or symlink this folder into your VS Code extensions directory, then reload VS Code.
