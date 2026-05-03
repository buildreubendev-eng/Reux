# Public Demo API Contract

This document is the integration guide for website frontends, demo clients, and agents wiring the Reuben website to the hosted Reux demo.

Machine-readable contract: `docs/public/reux-demo-api-contract.json`

Contract version: `2026-05-02`

## Base URL

Production website clients should read the hosted demo URL from:

```text
NEXT_PUBLIC_REUX_DEMO_URL
```

Current hosted demo:

```text
https://reux-pilot-demo-production.up.railway.app
```

Do not hard-code the hosted URL in reusable clients. Keep it in environment configuration so Railway/Vercel replacements can happen without changing source.

## Headers

| Header | Required | Purpose |
| --- | --- | --- |
| `content-type: application/json` | `POST` requests | Tells the demo server to parse JSON bodies. |
| `x-reux-demo-session` | Visitor workflow routes | Keeps Commerce and Logistics state isolated per browser. |
| `x-reux-demo-token` | Admin setup routes when configured | Private token for shared/admin reset actions. |

The browser-facing website should generate one stable session id and reuse it. The server normalizes session ids to 8-16 alphanumeric characters before deriving an isolated schema.

## Public Health And Operations

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Deployment health, active domains, limits, request counters, `jsonBodyLimitBytes`, and `sessionCache` counters. |
| `GET /api/ops` | Cross-domain queue health for the active session. |

`/api/health` is the safest first call after a deploy. It should return `ok: true`, `module: "pilot"`, `apiVersion`, `packageVersion`, `build`, both `commerce` and `logistics` in `domains`, the active request-body limit, rate-limit config, request counters, session-cache stats, and saved simulation-run storage stats.

Public API responses also include:

| Header | Purpose |
| --- | --- |
| `cache-control: no-store` | Keeps visitor dashboards, simulations, and health checks from being cached as stale state. |
| `x-reux-api-version` | Reports the public demo API contract version served by the deployment. |
| `x-reux-build` | Reports a short build or commit identifier for hosted troubleshooting. |
| `retry-after` | Present on `429` responses; tells clients when to retry. |

## Business Simulator Routes

| Route | Purpose |
| --- | --- |
| `GET /api/simulations` | List available Business Simulator templates. |
| `GET /api/simulations/operations-decision` | Load the current operations-decision template. |
| `GET /api/simulations/capacity-planning` | Load the capacity-planning template. |
| `GET /api/simulations/staffing-plan` | Load the staffing-plan template. |
| `GET /api/simulations/pricing-strategy` | Load the pricing-strategy template. |
| `POST /api/simulations/run` | Run a baseline plus scenarios and return metrics, timeline, frontend-ready recommendation summaries, and optional Reux source. |
| `GET /api/simulation-runs` | List recent saved run summaries for the current visitor session. |
| `GET /api/simulation-runs/:id` | Load one saved Business Simulator run by ID for result pages or sharing. |
| `POST /api/scenarios/compare` | Compare already-run scenario results. |

These routes are public and do not require an admin token or visitor session. They are the contract the Reuben website Business Simulator should use. The ready templates share the same response shape, so the frontend can present `operations-decision`, `capacity-planning`, `staffing-plan`, and `pricing-strategy` as product choices without a separate adapter.

`POST /api/simulations/run` saves the hosted-demo result in PostgreSQL with a bounded in-memory fallback and includes a `run` summary with a `live_...` ID. The recommendation payload includes direct `decisionSummary`, `recommendedAction`, `confidence`, `confidenceSummary`, `whyThisWon`, `whatChangedFromBaseline`, `keyMetricDeltas`, `scoreBreakdown`, `riskSummary`, `tradeoffSummary`, and `watchouts` fields so result pages can render the sellable-product explanation without deriving copy from raw deltas. `comparison.scenarioRanking` lists every compared scenario in backend score order with rank, score gap, recommendation flag, and summary text for comparison cards. Saved-run summaries include `displayTitle`, `displaySubtitle`, `shareLabel`, `resultSummary`, `keyMetric`, `expiryNote`, and `storage` so list cards, shared result pages, and status panels do not have to synthesize product copy or guess persistence state. `storage` is either `postgres` or `memory`; memory fallback summaries include `persistenceWarning`. The run-list route is session-scoped; direct lookup by ID is public so result pages can be shared. Saved runs are intentionally temporary in the public demo and can expire; expired run lookups return `410` with `code: "saved_run_expired"` and `expiresAt` when the backend can still identify the expired record.

## Generic Reux Simulation Routes

| Route | Purpose |
| --- | --- |
| `GET /api/reux/simulations` | List executable Reux simulation examples with dimensions, assumptions, metrics, objectives, and source file names. |
| `GET /api/reux/simulations/:name` | Load one Reux simulation model by name. |
| `POST /api/reux/simulations/:name/run` | Execute one Reux simulation with optional runtime baseline assumptions and runtime scenarios. |

These routes are public and do not require an admin token or visitor session. They are the generic product-facing path for PLOS and business-product prototypes that want Reux-backed simulation execution without using the specialized Business Simulator contract.

Runtime execution request:

```json
{
  "assumptions": {
    "income": 6200
  },
  "scenarios": [
    {
      "name": "lower_rent_runtime",
      "overrides": {
        "rent": 1100
      },
      "changes": [
        {
          "period": 6,
          "overrides": {
            "debt_payment": 0
          }
        }
      ]
    }
  ]
}
```

Runtime overrides must reference declared assumptions, keep their original primitive type, preserve declared units, and keep changes inside the forecast window. Invalid requests return `400` with `code: "simulation_execution_validation_failed"` and stable `issues[].path` entries such as `$.assumptions.income`.

The hosted generic simulation API follows the package execution limits: at most 12 runtime scenarios, 24 changes per runtime scenario, 64 entries in an override object, and 120 characters per runtime scenario name.

## Commerce Workflow Routes

| Route | Purpose |
| --- | --- |
| `GET /api/dashboard` | Read commerce state and queue health. |
| `POST /api/session/reset` | Reset the caller's isolated commerce seed data. |
| `POST /api/setup` | Admin setup/reset route. |
| `POST /api/actions/capture-payment` | Run payment capture. |
| `POST /api/actions/mark-paid` | Mark the seeded order paid. |
| `POST /api/actions/credit-account` | Credit the seeded account. |
| `POST /api/outbox/process` | Process commerce outbox events. |
| `GET /api/outbox/stats` | Read commerce outbox totals. |

Public visitors should use `POST /api/session/reset`, not the admin setup route.

## Logistics Workflow Routes

| Route | Purpose |
| --- | --- |
| `GET /api/logistics/dashboard` | Read logistics state and queue health. |
| `POST /api/logistics/session/reset` | Reset the caller's isolated logistics seed data. |
| `POST /api/logistics/setup` | Admin setup/reset route. |
| `POST /api/logistics/actions/start-shipment` | Start the seeded shipment. |
| `POST /api/logistics/actions/mark-delivered` | Mark the seeded shipment delivered. |
| `POST /api/logistics/actions/credit-driver` | Credit the seeded driver. |
| `POST /api/logistics/outbox/process` | Process logistics outbox events. |
| `GET /api/logistics/outbox/stats` | Read logistics outbox totals. |

Public visitors should use `POST /api/logistics/session/reset`, not the admin setup route.

## Error Envelope

Public errors use a stable JSON envelope:

```json
{
  "ok": false,
  "error": "human-readable message",
  "message": "human-readable message",
  "code": "request_failed",
  "category": "server",
  "retryable": true,
  "userAction": "Try again later."
}
```

Known public error codes:

| Code | HTTP status | Meaning |
| --- | ---: | --- |
| `business_simulator_validation_failed` | `400` | Run/compare request failed contract validation. |
| `simulation_execution_validation_failed` | `400` | Generic Reux simulation execution request failed validation. |
| `invalid_json` | `400` | Request body was not valid JSON. |
| `request_too_large` | `413` | JSON body exceeded `REUX_DEMO_JSON_BODY_LIMIT_BYTES`. |
| `rate_limited` | `429` | Visitor exceeded the public demo request limit. |
| `not_found` | `404` | Route or simulation id was not found. |
| `saved_run_expired` | `410` | Saved Business Simulator run expired before it was loaded. |
| `method_not_allowed` | `405` | Route exists but does not support the method. |
| `request_failed` | varies | General fallback for unexpected failures. |

Unexpected server failures with HTTP `500` intentionally return the generic message `request failed`. Do not rely on internal exception text reaching browser clients. Public-safe, user-actionable failures such as validation errors, missing saved runs, expired saved runs, and rate limits keep their specific codes and fields. Frontend clients can use `category`, `retryable`, and `userAction` for page-level UI states without parsing `message`.

Business Simulator validation errors also include:

```json
{
  "issues": [
    {
      "path": "$.baseline.grossMarginRate",
      "message": "must be between 0 and 1"
    }
  ]
}
```

Frontend clients should prefer `issues` for field-level UI and fall back to `message` for page-level alerts.

Common frontend failure examples:

| Example | HTTP status | Code | Field path |
| --- | ---: | --- | --- |
| `invalidBusinessSimulatorField` | `400` | `business_simulator_validation_failed` | `$.baseline.grossMarginRate` |
| `tooManyBusinessSimulatorScenarios` | `400` | `business_simulator_validation_failed` | `$.scenarios` |
| `invalidReuxSimulationUnit` | `400` | `simulation_execution_validation_failed` | `$.assumptions.income` |
| `expiredBusinessSimulatorRun` | `410` | `saved_run_expired` | n/a |
| `missingBusinessSimulatorRun` | `404` | `not_found` | n/a |
| `rateLimited` | `429` | `rate_limited` | n/a |

These same examples are available in `docs/public/reux-demo-api-contract.json` under `errorExamples` so frontend clients can mock error states without reading backend source.

Too many Business Simulator scenarios:

```json
{
  "ok": false,
  "error": "$.scenarios: must contain 8 or fewer scenarios",
  "message": "$.scenarios: must contain 8 or fewer scenarios",
  "code": "business_simulator_validation_failed",
  "category": "validation",
  "retryable": false,
  "userAction": "Fix the request fields and try again.",
  "issues": [
    {
      "path": "$.scenarios",
      "message": "must contain 8 or fewer scenarios"
    }
  ]
}
```

Generic Reux simulation unit mismatch:

```json
{
  "ok": false,
  "error": "$.assumptions.income: must preserve declared unit USD",
  "message": "$.assumptions.income: must preserve declared unit USD",
  "code": "simulation_execution_validation_failed",
  "category": "validation",
  "retryable": false,
  "userAction": "Fix the request fields and try again.",
  "issues": [
    {
      "path": "$.assumptions.income",
      "message": "must preserve declared unit USD"
    }
  ]
}
```

Saved-run expiration errors include the expiry timestamp when it is still available:

```json
{
  "ok": false,
  "error": "simulation run 'live_4f6c9f1a20b3448d' expired at 2026-05-03T00:00:00.000Z",
  "message": "simulation run 'live_4f6c9f1a20b3448d' expired at 2026-05-03T00:00:00.000Z",
  "code": "saved_run_expired",
  "category": "expired",
  "retryable": false,
  "userAction": "Start a new simulation run.",
  "expiresAt": "2026-05-03T00:00:00.000Z"
}
```

Missing saved-run lookups return `404`:

```json
{
  "ok": false,
  "error": "simulation run 'live_missing' was not found",
  "message": "simulation run 'live_missing' was not found",
  "code": "not_found",
  "category": "not_found",
  "retryable": false,
  "userAction": "Check the link or create a new result."
}
```

## Operational Limits

| Limit | Default | Environment variable |
| --- | ---: | --- |
| JSON body limit | `65536` bytes | `REUX_DEMO_JSON_BODY_LIMIT_BYTES` |
| API rate-limit window | `60000` ms | `REUX_DEMO_RATE_LIMIT_WINDOW_MS` |
| API requests per client/window | `240` | `REUX_DEMO_RATE_LIMIT_MAX_REQUESTS` |
| Mutating API requests per client/window | `60` | `REUX_DEMO_WRITE_RATE_LIMIT_MAX_REQUESTS` |
| Cached session contexts | `100` | `REUX_DEMO_MAX_SESSION_CONTEXTS` |
| Session idle window | `1800000` ms | `REUX_DEMO_SESSION_IDLE_MS` |
| Business Simulator run scenarios | `8` | source contract |
| Business Simulator compare scenarios | `12` | source contract |
| Business Simulator forecast periods | `52` | source contract |
| Business Simulator employees | positive integer, max `10000` | source contract |
| Business Simulator weekly demand | max `1000000` | source contract |
| Business Simulator average hourly cost | greater than `0`, max `1000` | source contract |
| Business Simulator average order value | greater than `0`, max `1000000` | source contract |

The health response reports active body, rate-limit, request-counter, session-cache, and saved-run limits, so host config can be verified after redeploy. Rate-limited responses use `429`, `code: "rate_limited"`, `retryAfterSeconds`, and `resetAt`; frontend clients should show a calm retry message instead of treating this as a broken backend. Operators can prune expired or over-limit saved runs with `npm run demo:maintenance`.

## Verification

Run the contract/doc drift check:

```bash
npm run check:demo-contract
```

Run hosted checks:

```bash
npm run demo:healthcheck -- https://your-demo-host.example.com
npm run demo:healthcheck -- https://your-demo-host.example.com --deep
npm run demo:healthcheck -- https://your-demo-host.example.com --smoke
```

Deep mode validates CORS, queue stats, Business Simulator run/compare/validation behavior, scenario ranking, recommendation score breakdown, runner-up score gap metadata, saved-run creation and reload, recent-run listing, missing-run handling, frontend-ready saved-run metadata, generic Reux simulation execution, rate-limit metadata, request counters, health-level saved-run storage metadata, and per-run storage status.

For Business Simulator fixture parity:

```bash
node dist/cli.js business-simulator-contract
```
