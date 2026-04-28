# Release And Packaging

Reux is currently packaged as a Node CLI prototype with two executable names:

```bash
reux version
dl version
```

Both commands resolve to `dist/cli.js`.

## Local Package Check

Build and inspect the package contents before sharing a tarball or publishing:

```bash
npm run build
npm run verify
npm run verify:package
```

`npm run build` first clears `dist/` so stale compiled files cannot leak into the package. `verify:package` runs `npm pack --dry-run`, which lists the files that would be included in the npm package without creating a permanent release artifact.

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
4. Check `docs/technical/phase-status.md`.
5. Check `docs/technical/cli.md` for new or changed commands.
6. Update `README.md` if setup or demo commands changed.
7. Tag the commit after the repository is pushed.

The package remains marked `private` until the public package name and distribution policy are final.
