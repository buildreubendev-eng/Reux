# Release And Packaging

Reux is currently packaged as a Node CLI prototype with two executable names:

```bash
reux version
dl version
```

Both commands resolve to `dist/cli.js`.

The package also exposes typed ESM entrypoints for application integration:

```ts
import { compileSource } from "reux-prototype";
import { createPostgresDatabase } from "reux-prototype/runtime";
```

The local editor package under `editors/vscode` is included in package dry runs so early adopters can test syntax highlighting alongside the CLI.

## Local Package Check

Build and inspect the package contents before sharing a tarball or publishing:

```bash
npm run build
npm run verify
npm run verify:package
npm run release:preflight
npm run release:pack-dry-run
```

`npm run build` first clears `dist/` so stale compiled files cannot leak into the package. `verify:package` runs a package smoke check around `npm pack --dry-run --json`; it fails if exported JavaScript files, generated declaration files, docs, or editor assets are missing from disk or missing from the dry-run tarball.

`npm run release:preflight` is the final local release gate. It runs the normal verification and package smoke check, then confirms that release docs exist, package entrypoints are present, public roadmap percentages are synchronized between Markdown and JSON, and the working tree is clean. During development, the script itself can be tested without the clean-tree gate:

```bash
node scripts/release-preflight.mjs --allow-dirty
```

`npm run release:pack-dry-run` rebuilds the project and asks npm to show the tarball contents without publishing.

## Versioning

The package version in `package.json` is the CLI version returned by `reux version`. For prototype releases, bump versions conservatively:

- patch for docs, diagnostics, and bug fixes;
- minor for new language or CLI features;
- major only for breaking manifest, migration, or source syntax changes.

Schema manifests keep their own format marker, currently `dl.schema.v1`. A release that changes manifest shape incompatibly must either migrate existing manifests or introduce a new manifest format marker.

## Install From A Tarball

After a clean verification pass:

```bash
npm run build
npm pack
npm install -g ./reux-prototype-0.1.0.tgz
reux version
```

For another machine, push the repo or share the generated tarball, then install it with `npm install -g`.

## Release Checklist

Before tagging a prototype release:

1. Run `npm run verify`, including CLI smoke checks for the root commerce seed and pilot seed fixture.
2. Run `npm run verify:postgres:full` against a live PostgreSQL database.
3. Run `npm run verify:package`.
4. Run `npm run release:preflight`.
5. Run `npm run release:pack-dry-run`.
6. Check `docs/technical/package-distribution.md`.
7. Check `docs/technical/public-release-plan.md`.
8. Check `docs/technical/phase-status.md`.
9. Check `docs/technical/cli.md` for new or changed commands.
10. Update `README.md` if setup or demo commands changed.
11. Tag the commit after the repository is pushed.

The package remains marked `private` until the public package name and distribution policy are final.
