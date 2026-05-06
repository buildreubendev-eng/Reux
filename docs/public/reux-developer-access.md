# Reux Developer Access

This is the public developer path for trying Reux before the packaged npm beta is finalized.

## Status

- Public source repository: available.
- Local CLI from source: available.
- VS Code extension source: available in `editors/vscode`.
- Hosted public demo: available through the Reuben website and Railway demo service.
- Published npm beta package: planned.
- Stable external API guarantee: planned for beta.

## Fastest Local Path

From a fresh clone:

```bash
git clone https://github.com/buildreubendev-eng/Reux.git
cd Reux
npm install
npm run onboarding:doctor
npm run onboarding:smoke
```

`onboarding:smoke` is intentionally database-free. It proves the compiler, CLI, examples, seed validation, SQL emitters, and simulation runner are usable locally.

## What To Try First

```bash
npm run build
node dist/cli.js capabilities
node dist/cli.js check examples/pilot_reux.dl
node dist/cli.js query-sql examples/pilot_reux.dl accountOrders
node dist/cli.js tx-sql examples/pilot_reux.dl capturePayment
node dist/cli.js simulation-run examples/simulations/business_simulator.reux
node dist/cli.js simulation-run examples/simulations/personal_finance.reux
```

Use `npm run reux -- <command>` when you want npm to resolve the local CLI wrapper:

```bash
npm run reux -- simulation-run examples/simulations/workforce_change.reux
```

## Editor Access

The VS Code extension source lives in:

```text
editors/vscode
```

It currently provides file associations, syntax highlighting, diagnostics, formatting, completions, hover text, and current-file definition jumps for `.dl` and `.reux` files.

Point the extension at your local CLI build:

```json
{
  "reux.cliPath": "C:\\path\\to\\Reux\\dist\\cli.js"
}
```

After changing compiler or CLI code, run:

```bash
npm run build
```

Then reload VS Code if diagnostics still reflect an older build.

## Hosted API Access

The public hosted demo exposes health, commerce/logistics workflow endpoints, and generic Reux simulation endpoints.

```bash
npm run demo:healthcheck -- https://reux-pilot-demo-production.up.railway.app --deep
```

The generic simulation API is the product-facing integration path:

```text
GET  /api/reux/simulations
GET  /api/reux/simulations/:name
POST /api/reux/simulations/:name/run
```

See `docs/technical/public-demo-api.md` for the full contract.

## What Reux Is Today

Reux is a prototype backend language for data-aware workflows and simulation-driven applications. It is strongest today at:

- schemas and typed queries;
- guarded transaction functions;
- durable event/outbox workflows;
- conservative migration planning;
- TypeScript artifact generation;
- simulation declarations, scenarios, and forecasts.

## What Reux Is Not Yet

Reux is not a finished general-purpose language, a mature package ecosystem, or a replacement for frontend frameworks. Product interfaces should still be built with normal web technology. Reux is the backend decision, workflow, and simulation layer underneath those products.

## Recommended Review Order

1. Run `npm run onboarding:smoke`.
2. Read `examples/simulations/business_simulator.reux`.
3. Read `examples/pilot_reux.dl`.
4. Try the hosted Business Simulator on the Reuben website.
5. Read `docs/public/reux-positioning.md` to understand the public product story.
