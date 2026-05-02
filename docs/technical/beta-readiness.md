# Beta Readiness

This document separates two release questions that are easy to blur together:

1. Can Reux be packed, installed, and smoke-tested as a Node package?
2. Is Reux ready to be published as a public npm beta?

The first question is already automated. The second still has intentional blockers until naming, ownership, and licensing are final.

## Commands

Use the status command during active development:

```bash
npm run release:beta-status
```

This prints the package readiness checks, public publish blockers, and non-blocking metadata warnings. It exits successfully even when known publish blockers remain.

Use the strict readiness command when preparing a real public beta:

```bash
npm run release:beta-readiness
```

This fails when public publish blockers remain. It should pass before setting a public beta tag or running `npm publish`.

For machine-readable output:

```bash
node scripts/beta-readiness.mjs --json --allow-blockers
```

## Current Expected State

The package is expected to be tarball-ready but not public-publish-ready while:

- `package.json` has `private: true`;
- the package name remains `reux-prototype`;
- the license remains `UNLICENSED`.

Those are deliberate guardrails. They keep local and cross-machine testing moving without accidentally publishing the prototype under the wrong name, account, or license.

## Public Beta Exit Criteria

Before public npm beta:

1. Choose the final package name.
2. Confirm the npm account or organization that owns the name.
3. Choose and document the public license.
4. Update `package.json` name, `private`, license, homepage, repository, bugs, and keywords if needed.
5. Update README and package docs so install examples use the final package name.
6. Run `npm run verify:package`.
7. Run `npm run release:preflight`.
8. Run `npm run release:beta-readiness`.
9. Run `npm run release:pack-dry-run`.
10. Publish with an explicit beta tag.

Suggested publish command after all gates pass:

```bash
npm publish --tag beta
```

Do not publish from a dirty working tree or from an unverified local build.
