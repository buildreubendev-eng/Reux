# Package Distribution

Reux is still marked private while the public package name and publishing policy are being decided, but the package now has the shape needed for local and private distribution.

For the current public-beta gate, see [Beta readiness](beta-readiness.md). The short version: `verify:package` proves the tarball works, while `release:beta-readiness` proves the package is safe to publish publicly.

## Entrypoints

The package exposes:

- `reux` and `dl` CLI binaries through `dist/cli.js`.
- `reux-prototype` compiler APIs through `dist/compiler.js`.
- `reux-prototype/runtime` runtime APIs through `dist/runtime.js`.
- Type declarations from the generated `dist/*.d.ts` files.
- `reux-prototype/simulation` product-facing simulation APIs through `dist/simulation.js`.
- `reux-prototype/business-simulator` public Business Simulator APIs through `dist/business-simulator.js`.

Example import from another TypeScript project after installing the package:

```ts
import { compileSource, emitPostgresSchema } from "reux-prototype";
import { createPostgresDatabase, runRule, runRuleWorker, runRules, runSqlQuery, runView } from "reux-prototype/runtime";
import { runReuxSimulation } from "reux-prototype/simulation";
```

`runReuxSimulation(source, request)` is the generic backend path for PLOS and business-product prototypes. It accepts runtime baseline/scenario overrides as primitives or `{ value, unit }` inputs, preserves declared Reux units and objectives, and returns a typed run/comparison result plus direct baseline/scenario shortcuts without requiring a custom adapter for every product.

`runView(db, source, viewName)`, `runRule(db, source, ruleName)`, `runRules(db, source, ruleNames?)`, and `runRuleWorker(db, source, options)` are the backend paths for operating-model read models, rule actions, batch rule application, and long-running rule hygiene. They compile Reux view/rule declarations and execute them through the shared PostgreSQL runtime without shelling out to the CLI. Generated TypeScript APIs also expose `api.views.<view>()` and `api.rules.<rule>()` methods for app code that prefers generated wrappers.

## Local Tarball

Use this path for testing on another machine before public publishing:

```bash
npm run verify
npm run build
npm run verify:package
npm run release:beta-status
node scripts/release-preflight.mjs --allow-dirty
npm run release:pack-dry-run
npm pack
npm install -g ./reux-prototype-0.1.0.tgz
reux version
```

`npm run verify:package` runs a package smoke check. It verifies that the exported JavaScript files, generated declaration files, docs, examples, and editor assets exist and are included in the npm tarball dry run. It then creates a real tarball in a temporary directory, installs that tarball into a temporary consumer project, runs the shipped `reux` binary, and imports the compiler, runtime, simulation, and business-simulator entrypoints from the installed package. `release:beta-status` reports whether public npm blockers remain without failing on intentional blockers such as `private: true`. `release-preflight.mjs` checks release documentation, package entrypoints, public roadmap status synchronization, and clean-tree readiness. `release:pack-dry-run` rebuilds and prints the npm tarball contents without publishing. The package includes `dist`, `docs`, `editors`, `examples`, `pilot`, migrations, root config, and the README.

## Private Consumption

For a private application repo, install from a tarball or a GitHub package once publishing is enabled. Keep generated application code pinned to a known Reux package version, and regenerate API/server/worker files when upgrading.

See [Public release plan](public-release-plan.md) for the package-name decision, publish gate, and cross-repo upgrade flow.

## Upgrade Policy

Until Reux reaches a stable public release, treat all language syntax, manifest shape, and runtime SQL behavior as prototype APIs. Use:

- patch versions for bug fixes and docs;
- minor versions for new additive language/tooling features;
- major versions for source syntax, manifest, migration, or runtime contract breaks.
