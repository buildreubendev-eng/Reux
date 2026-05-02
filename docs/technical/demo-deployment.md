# Pilot Demo Deployment

The browser demo in `demo/pilot-app` can run as a hosted Node service backed by PostgreSQL. It serves the static console and executes Reux pilot queries/transactions through the built runtime.

## Required Build Settings

The repo includes `railway.json` and `render.yaml` for hosted deployments. For any Node-capable host, use these settings:

```text
Build command: npm install && npm run build
Start command: npm run start:demo
Health check: /api/health
```

The service reads the platform `PORT` variable automatically and binds to `0.0.0.0` by default so public hosts can route traffic to it.

You can verify a hosted deployment from a terminal with:

```bash
npm run demo:healthcheck -- https://your-demo-host.example.com
```

The health check calls `/api/health`, verifies the service identifies the pilot module, confirms both `commerce` and `logistics` domains are listed, confirms the API version/build headers are present, and exits nonzero if the deployment is not ready.

After a deploy that includes the queue stats endpoints, run a deeper smoke check with:

```bash
npm run demo:healthcheck -- https://your-demo-host.example.com --deep
```

Deep mode also checks `/api/outbox/stats`, `/api/logistics/outbox/stats`, the Business Simulator CORS preflight, and the public Business Simulator API flow:

```text
GET /api/simulations
GET /api/simulations/operations-decision
POST /api/simulations/run
POST /api/scenarios/compare
POST /api/simulations/run with invalid input
GET /api/reux/simulations
GET /api/reux/simulations/personal_finance
POST /api/reux/simulations/personal_finance/run
POST /api/reux/simulations/personal_finance/run with invalid input
```

This is the quickest backend-side check that the Reuben website can still run the public simulator after a deploy. The invalid-input checks confirm the specialized Business Simulator API returns `400` with `code: "business_simulator_validation_failed"` and the generic Reux simulation API returns `400` with `code: "simulation_execution_validation_failed"`. Both include stable `issues[].path` entries, which product frontends can use for helpful field-level errors.

The hosted service also exposes a small operations dashboard:

```bash
https://your-demo-host.example.com/ops.html
https://your-demo-host.example.com/api/ops
```

The dashboard summarizes commerce and logistics queue health for the active visitor/session, including pending, processing, processed, failed, dead-lettered, and attempt counts.

For lightweight uptime watching, run:

```bash
npm run demo:monitor -- https://your-demo-host.example.com --deep --interval-seconds 60 --max-failures 3
```

The monitor wraps `demo:healthcheck`, records timestamped pass/fail output, and exits nonzero after the configured number of consecutive failures. Use `--once` for cron-style checks, or set `REUX_DEMO_MONITOR_URL`, `REUX_DEMO_MONITOR_INTERVAL_SECONDS`, and `REUX_DEMO_MONITOR_MAX_FAILURES` in the environment.

For external alerting, pass a webhook URL:

```bash
npm run demo:monitor -- https://your-demo-host.example.com --deep --max-failures 3 --alert-webhook-url https://alerts.example.com/reux
```

You can also set `REUX_DEMO_MONITOR_ALERT_WEBHOOK_URL` and optional `REUX_DEMO_MONITOR_ALERT_TIMEOUT_MS`. The monitor sends a JSON `POST` when a one-shot check fails, when a continuous check reaches the configured failure threshold, and when a continuous check recovers after transient failures. The payload includes the target URL, check mode, timestamp, failure counts, elapsed time, and truncated healthcheck stdout/stderr for debugging.

For periodic hosted demo database cleanup, run maintenance in dry-run mode first:

```bash
npm run demo:maintenance
```

The maintenance command lists managed isolated visitor schemas matching `REUX_DEMO_SCHEMA_s_<session>`, keeps `healthcheck` and `healthcheckci` by default, and does not change the database unless `--apply` is passed. To drop the listed candidates after reviewing them:

```bash
npm run demo:maintenance -- --apply
```

Use `--keep=session1,session2` or `REUX_DEMO_MAINTENANCE_KEEP_SESSIONS` for sessions that should survive cleanup. The command only targets normalized session schemas such as `reux_demo_s_public123` and refuses invalid base schema names.

For release validation after a production redeploy, run the full public smoke path:

```bash
npm run demo:healthcheck -- https://your-demo-host.example.com --smoke
```

Smoke mode runs the health and deep checks, uses an isolated `healthcheck` browser session, resets commerce and logistics demo data, runs one transaction in each domain, confirms queue health moves to `working`, processes outbox events, and confirms queue health returns to `clear`. Because deep checks include the Business Simulator API, smoke mode now validates both the website-facing simulation contract and the PostgreSQL-backed workflow demo. Reusing the `healthcheck` session prevents each redeploy check from creating a new schema forever. Override the session with `--session-id=<id>` or `REUX_HEALTHCHECK_SESSION_ID` if needed. Smoke mode refuses to run against shared-session demos unless `--allow-shared-smoke` is passed, because shared smoke would mutate the shared demo state.

For local or CI validation against a PostgreSQL-backed demo service, use:

```bash
npm run verify:demo:smoke
```

That command starts the demo server on `REUX_DEMO_SMOKE_PORT` or `4185`, waits for `/api/health`, runs the same `--smoke` healthcheck with the `healthcheckci` session, and stops the server afterward. The GitHub Actions PostgreSQL job runs this after `npm run verify:postgres:full`, so every push verifies the compiled demo server can boot and execute the public smoke flow.

## Railway

1. Create a new Railway project from `benn4105/Reux`.
2. Add a PostgreSQL service to the same Railway project.
3. On the Reux service, set:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
REUX_DEMO_SCHEMA=reux_demo
REUX_DEMO_SETUP_TOKEN=<private admin token>
REUX_DEMO_SESSION_MODE=isolated
```

`railway.json` sets the build command, start command, `/api/health` health check, and restart policy. Railway reads this file during deployment.

For an optional Railway worker, create a second service from the same repo, set its start command to `npm run start:demo-worker`, and give it the same `DATABASE_URL` and `REUX_DEMO_SCHEMA` values. `railway.worker.json` records the matching worker build/start settings for reference.

## Render

Use the repo Blueprint (`render.yaml`) to create the web service, an optional worker service, and a managed PostgreSQL database together. The Blueprint wires `DATABASE_URL` from the database, sets `REUX_DEMO_SCHEMA`, and generates `REUX_DEMO_SETUP_TOKEN`.

If creating the Render service manually instead of through the Blueprint, use the build/start settings above and add the three environment variables manually.

## Environment Variables

```text
DATABASE_URL=postgres://...
REUX_DEMO_SCHEMA=reux_demo
REUX_DEMO_SETUP_TOKEN=<private admin token>
REUX_DEMO_SESSION_MODE=isolated
REUX_DEMO_ALLOWED_ORIGINS=*
REUX_DEMO_CORS_MAX_AGE_SECONDS=600
REUX_DEMO_JSON_BODY_LIMIT_BYTES=65536
REUX_DEMO_MAX_SESSION_CONTEXTS=100
REUX_DEMO_SESSION_IDLE_MS=1800000
REUX_DEMO_MAX_SIMULATION_RUNS=200
REUX_DEMO_SIMULATION_RUN_TTL_MS=86400000
```

`DATABASE_URL` is required. `REUX_DEMO_SCHEMA` defaults to `reux_demo`, which keeps demo objects separate from other tables in the same database. `REUX_DEMO_SESSION_MODE` defaults to `isolated`, which maps each browser session to its own schema derived from `REUX_DEMO_SCHEMA`; set it to `shared` only for local debugging. `REUX_DEMO_SETUP_TOKEN` is optional for local development but should be set on public deployments; when set, the admin setup/reset endpoint requires the token before applying migrations or resetting shared seed data.

`REUX_DEMO_ALLOWED_ORIGINS` controls browser access to `/api/*` routes. It defaults to `*` for the public demo, which lets the Reuben website call the Business Simulator endpoints from Vercel. Set it to a comma-separated allowlist such as `https://reuben-web.vercel.app,https://www.reuben.example` when the public hostnames are stable. The API also answers `OPTIONS` preflight requests for `GET`, `POST`, `content-type`, `x-reux-demo-session`, and `x-reux-demo-token`.

`REUX_DEMO_JSON_BODY_LIMIT_BYTES` defaults to `65536` and protects public `POST` routes from oversized JSON payloads. `/api/health` reports the active `jsonBodyLimitBytes` value so hosted deployments can confirm the limit after a redeploy. Malformed JSON returns `400` with `code: "invalid_json"`; oversized JSON returns `413` with `code: "request_too_large"`.

`REUX_DEMO_MAX_SESSION_CONTEXTS` defaults to `100` and limits how many shared/visitor database contexts the Node process keeps open. `REUX_DEMO_SESSION_IDLE_MS` defaults to `1800000` and lets the service close idle session contexts as new requests arrive. `/api/health` reports `sessionCache.contexts`, isolated/shared counts, idle counts, and the active limits so public-demo operators can spot runaway visitor sessions before they become a hosting problem.

`REUX_DEMO_MAX_SIMULATION_RUNS` defaults to `200` and limits the hosted Business Simulator's PostgreSQL-backed temporary saved-result store. `REUX_DEMO_SIMULATION_RUN_TTL_MS` defaults to `86400000` and controls how long `GET /api/simulation-runs/:id` can retrieve a run before it expires. `/api/health` reports `simulationRuns` counters, storage mode, and limits. If persistence has a transient problem, the demo falls back to the process-local memory store and reports the persistence error in health output.

## First Setup

After deployment:

1. Open the deployed demo URL.
2. Click `Reset My Session` to create a fresh isolated visitor schema.
3. Confirm `/api/dashboard` returns seeded orders, payments, balances, and outbox events.
4. Switch to the `Logistics` tab, click `Reset My Session`, and confirm `/api/logistics/dashboard` returns seeded shipments, driver manifest rows, status summary rows, and logistics outbox events.
5. For admin/shared setup, open the collapsed `Admin` menu, enter the private token if `REUX_DEMO_SETUP_TOKEN` is set, and click `Apply Schema + Reset Seed`.

For a quick command-line check after setup or redeploy:

```bash
npm run demo:healthcheck -- https://your-demo-host.example.com
npm run demo:healthcheck -- https://your-demo-host.example.com --deep
npm run demo:healthcheck -- https://your-demo-host.example.com --smoke
npm run demo:monitor -- https://your-demo-host.example.com --deep
```

Regular visitors can reset only their own session and use the dashboard and transaction buttons after setup. Keep the token private so the shared/admin demo database cannot be reset by everyone visiting the public site.

The public UI keeps admin setup inside a collapsed `Admin` menu and exposes `Reset My Session` for each tab. The dashboard can still load before setup and will show a setup-required state instead of failing with a database error. Public visitors do not need the token after the seeded data has been initialized. The `Process Outbox` button runs demo event handlers over pending outbox rows so visitors can see transaction events move from `pending` to `processed`. The dashboard shows a domain-scoped queue health strip for pending, processing, failed, and dead-lettered events, so testers can tell whether each tab is clear, working, retrying, or blocked. The app creates and queries `_dl_outbox` inside `REUX_DEMO_SCHEMA`, avoiding accidental reads from another schema in a shared database.

The hosted service also exposes session-scoped queue health endpoints for lightweight operations checks:

```text
GET /api/outbox/stats
GET /api/logistics/outbox/stats
```

They return the current visitor session plus outbox totals grouped by status.

The stats endpoints are domain-scoped by event type:

- `/api/outbox/stats` reports `AccountCredited`, `OrderPaid`, and `PaymentCaptured`.
- `/api/logistics/outbox/stats` reports `ShipmentStarted`, `ShipmentDelivered`, and `DriverCredited`.

For a separate worker process, deploy the same repo with:

```text
Start command: npm run start:demo-worker
```

Set the same `DATABASE_URL` and `REUX_DEMO_SCHEMA` as the web service. The worker honors `REUX_WORKER_INTERVAL_MS`, `REUX_WORKER_LIMIT`, `REUX_WORKER_MAX_ITERATIONS`, `REUX_WORKER_REQUEUE_STALE_SECONDS`, `REUX_WORKER_MAX_ATTEMPTS`, and `REUX_WORKER_RETRY_DELAY_SECONDS`. Worker logs include per-iteration `processed`, `failed`, `retried`, `dead`, and `staleRequeued` counts plus final cumulative totals.

## Website Integration

Point the marketing/docs website at the hosted demo URL with an environment variable such as:

```text
NEXT_PUBLIC_REUX_DEMO_URL=https://your-demo-host.example.com
```

Use a normal link for the safest launch path. An iframe also works because the demo app does not set frame-blocking headers, but a full-page link is easier to debug across hosting providers.

Use `?domain=logistics` to open the logistics tab directly, or `?domain=commerce` for the commerce tab.

The website can call the Business Simulator API routes directly from the browser:

```text
GET /api/simulations
GET /api/simulations/operations-decision
POST /api/simulations/run
POST /api/scenarios/compare
```

If a simulator request is malformed, the API returns a public-safe `400` response with `ok: false`, `message`, `error`, `code`, and `issues`. For Business Simulator request validation, `code` is `business_simulator_validation_failed` and every issue includes a stable path such as `$.baseline.grossMarginRate`.

The website or product prototypes can also call generic Reux simulation routes directly:

```text
GET /api/reux/simulations
GET /api/reux/simulations/personal_finance
POST /api/reux/simulations/personal_finance/run
```

Those routes expose the executable `.reux` examples as a product-facing simulation service. Runtime requests may override baseline assumptions and define temporary scenarios. Invalid requests return `code: "simulation_execution_validation_failed"` with stable field paths such as `$.assumptions.income`.

If the website is hosted on another origin, keep `REUX_DEMO_ALLOWED_ORIGINS=*` during early testing or add the website origin to the comma-separated allowlist.
