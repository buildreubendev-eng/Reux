# Package Distribution

Reux is still marked private while the public package name and publishing policy are being decided, but the package now has the shape needed for local and private distribution.

## Entrypoints

The package exposes:

- `reux` and `dl` CLI binaries through `dist/cli.js`.
- `reux-prototype` compiler APIs through `dist/compiler.js`.
- `reux-prototype/runtime` runtime APIs through `dist/runtime.js`.
- Type declarations from the generated `dist/*.d.ts` files.

Example import from another TypeScript project after installing the package:

```ts
import { compileSource, emitPostgresSchema } from "reux-prototype";
import { createPostgresDatabase, runSqlQuery } from "reux-prototype/runtime";
```

## Local Tarball

Use this path for testing on another machine before public publishing:

```bash
npm run verify
npm run build
npm run verify:package
npm pack
npm install -g ./reux-prototype-0.1.0.tgz
reux version
```

The package includes `dist`, `docs`, `editors`, `examples`, `pilot`, migrations, root config, and the README.

## Private Consumption

For a private application repo, install from a tarball or a GitHub package once publishing is enabled. Keep generated application code pinned to a known Reux package version, and regenerate API/server/worker files when upgrading.

## Upgrade Policy

Until Reux reaches a stable public release, treat all language syntax, manifest shape, and runtime SQL behavior as prototype APIs. Use:

- patch versions for bug fixes and docs;
- minor versions for new additive language/tooling features;
- major versions for source syntax, manifest, migration, or runtime contract breaks.
