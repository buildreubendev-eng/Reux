# Public Release Plan

This project is prototype-complete, but the npm package remains private until the public package name and publishing account are final. That is intentional: it avoids burning a weak package name or publishing under the wrong ownership path.

## Package Naming

Preferred package names, in order:

1. `reux`
2. `@reuben/reux`
3. `@reux/cli`

Before publishing, confirm that the selected name is available, searchable, and owned by the intended Reuben/Reux npm organization or maintainer account.

## Publish Gate

Run the full local release gate:

```bash
npm run release:preflight
npm run release:pack-dry-run
```

`release:preflight` verifies the compiler, demo checks, editor syntax, tests, build, CLI smoke checks, package smoke check, release docs, roadmap synchronization, package entrypoints, and clean working tree. The package smoke check validates dry-run contents, installs a real tarball into a temporary consumer project, runs the shipped `reux` binary, and imports the compiler/runtime/business-simulator entrypoints. `release:pack-dry-run` rebuilds and prints the npm tarball contents without publishing.

## Publishing Steps

1. Choose the final package name and update `package.json`.
2. Set `private` to `false`.
3. Confirm `README.md`, `docs/technical/package-distribution.md`, and this file still match the package name.
4. Run `npm run release:preflight`.
5. Run `npm run release:pack-dry-run`.
6. Tag the commit after it is pushed.
7. Publish with the intended npm account or organization.

## Cross-Repo Upgrade Flow

For private app repos such as the Reuben website or future PLOS/business simulation apps:

1. Pin the installed Reux package version.
2. Regenerate API, worker, and simulation TypeScript artifacts after upgrading.
3. Run the app's build and smoke tests.
4. Commit generated artifacts with the Reux version bump.

Until public publishing is enabled, use `npm pack` tarballs or GitHub source pulls for cross-machine testing.
