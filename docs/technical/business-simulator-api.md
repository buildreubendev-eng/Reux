# Business Simulator API Contract

This contract is the handoff point between the Business Simulator frontend and the Reux backend. The frontend can mock these shapes today, then swap the mock service for hosted Reux endpoints later.

The TypeScript source of truth lives in `src/business-simulator-contract.ts`.
The first Reux model that matches this contract lives in `examples/simulations/business_simulator.reux`.
Runtime request validators live in `src/business-simulator-validation.ts`.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/simulations` | List available business simulation templates. |
| `GET /api/simulations/:id` | Load one simulation template, its default assumptions, and starter scenarios. |
| `POST /api/simulations/run` | Run a baseline plus one or more scenarios and return metrics, timeline, and recommendation output. |
| `GET /api/simulation-runs` | List recent simulation run summaries for the current visitor session. |
| `GET /api/simulation-runs/:id` | Load one saved simulation run by its shareable run ID. |
| `POST /api/scenarios/compare` | Compare already-run scenario results without rerunning the simulation model. |

The hosted demo server exposes these routes from `demo/pilot-app/server.mjs`. The first implementation is intentionally a thin HTTP wrapper around the adapter functions so the frontend can switch from mock data to live backend calls without changing its data model.

## Core Assumptions

The first Business Simulator model should cover the controls the frontend is building:

- `employees`
- `averageHourlyCost`
- `weeklyDemand`
- `averageOrderValue`
- `grossMarginRate`
- `productivityGainRate`
- `overtimeReductionRate`
- `supplierDelayRiskRate`
- `defectRate`
- `forecastPeriods`
- `forecastUnit`

Rate values use decimal form. For example, `0.08` means 8%.

## Run Request

```json
{
  "name": "Q2 Workforce Planning",
  "simulationId": "operations-decision",
  "baseline": {
    "employees": 50,
    "averageHourlyCost": 32,
    "weeklyDemand": 1200,
    "averageOrderValue": 85,
    "grossMarginRate": 0.42,
    "productivityGainRate": 0.08,
    "overtimeReductionRate": 0.1,
    "supplierDelayRiskRate": 0.12,
    "defectRate": 0.025,
    "forecastPeriods": 12,
    "forecastUnit": "week"
  },
  "scenarios": [
    {
      "id": "process-improvement",
      "name": "Process Improvement",
      "description": "Higher productivity and lower overtime after workflow cleanup.",
      "assumptions": {
        "productivityGainRate": 0.12,
        "overtimeReductionRate": 0.18
      }
    }
  ],
  "options": {
    "includeTimeline": true,
    "includeReuxSource": true
  }
}
```

## Run Response

`POST /api/simulations/run` returns:

- `run`: optional hosted-demo run metadata when the server persists the response.
- `simulation`: template metadata.
- `baseline`: baseline scenario result.
- `scenarios`: scenario results.
- `comparison`: deltas and recommendation.
- `reuxSource`: optional read-only Reux source used for transparency panels.
- `generatedAt`: ISO timestamp.

Recommendation payloads are intentionally frontend-friendly. `comparison.recommendation` includes:

- `scenarioId` and `scenarioName`: the recommended scenario.
- `score`: deterministic blended score across margin, productivity, operating cost, and risk.
- `summary`: short recommendation headline.
- `whyThisWon`: one plain-language sentence suitable for a result page.
- `whatChangedFromBaseline`: stable bullet strings describing important assumption and metric changes.
- `keyMetricDeltas`: direct deltas for margin, productivity, operating cost, and risk so frontends do not need to mine `metricDeltasByScenario`.
- `riskSummary`: plain-language risk movement against baseline.
- `tradeoffSummary`: the most important unfavorable movement, or a no-major-tradeoff message.
- `reasons` and `tradeoffs`: supporting bullets for expanded result details.

Metric snapshots include:

- `revenue`
- `operatingCost`
- `laborCost`
- `productivity`
- `workforceLoad`
- `margin`
- `marginDelta`
- `riskScore`
- `defectCost`

The source of truth also exports `businessSimulatorForecastUnits` and `businessSimulatorMetricNames` so product apps can build controls and charts without hand-copying enum values.
It also exports `businessSimulatorErrorCodes`, `BusinessSimulatorErrorResponse`, `BusinessSimulatorValidationErrorResponse`, and `businessSimulatorLimits` so clients can handle backend failures and mirror public-demo limits without inventing their own envelope or constraints.

`options.includeTimeline` defaults to `true`. Set it to `false` for lighter responses that keep `finalMetrics` and comparison/recommendation output while returning empty `timeline` arrays. `options.includeReuxSource` defaults to `false`; set it to `true` only when a UI needs the Reux transparency panel.

## Frontend Integration Notes

- The frontend should keep using a mock service until the backend endpoint exists.
- Mock data should use the exact TypeScript types from `src/business-simulator-contract.ts`.
- UI labels can display rate values as percentages, but requests should send decimal values.
- Scenario IDs should be stable slugs because they are used as keys in comparison maps.
- The `reuxSource` field is read-only display text for the Reux transparency panel.

For a deterministic frontend/backend handoff artifact, run:

```bash
node dist/cli.js business-simulator-contract
```

That command emits the endpoint map, template response, sample run request, sample run response, sample compare request, sample compare response, and frontend mapping notes. It is useful when checking that a website mock, API client, or demo fixture still matches the Reux backend contract.
The same fixture includes `invalidRunResponse`, a deterministic example of the validation error envelope the hosted API returns for malformed simulator inputs.

For public API handlers, call `assertBusinessSimulatorRunRequest(body)` before running a simulation and `assertBusinessSimulatorCompareRequest(body)` before comparing existing results. Validation failures throw `BusinessSimulatorValidationError` with stable `issues[].path` values such as `$.baseline.grossMarginRate`, which lets frontends display field-level errors instead of a generic failed request.

Run requests also reject unsupported `simulationId` values and duplicate scenario IDs. Compare requests reject duplicate scenario result IDs and metric snapshots with unknown or non-numeric metrics. Scenario IDs should be unique because comparison results are keyed by scenario ID.

Public-demo limits are intentionally conservative:

| Limit | Value |
| --- | ---: |
| Run request scenarios | 8 |
| Compare request scenario results | 12 |
| Forecast periods | 52 |
| Timeline points per scenario result | 52 |
| Scenario ID length | 64 |
| Scenario name length | 120 |
| Scenario description length | 500 |

Scenario IDs must use letters, numbers, underscores, or hyphens and must start with a letter or number. These limits keep the public demo responsive and make validation errors predictable for frontend field-level UI.

The hosted demo server serializes those failures as `400` responses:

```json
{
  "ok": false,
  "error": "$.baseline.grossMarginRate: must be between 0 and 1",
  "message": "$.baseline.grossMarginRate: must be between 0 and 1",
  "code": "business_simulator_validation_failed",
  "issues": [
    {
      "path": "$.baseline.grossMarginRate",
      "message": "must be between 0 and 1"
    }
  ]
}
```

Frontend clients should prefer `issues` for field-level UI and fall back to `message` or `error` for a page-level alert.

## Saved Run Records

The hosted demo stores recent Business Simulator runs in PostgreSQL with a bounded in-memory fallback. This is a product-facing contract, not a full account system yet: it gives frontend result pages and share links a stable backend lookup path while keeping the first public implementation operationally simple.

`POST /api/simulations/run` includes a `run` summary when the hosted server saves the result:

```json
{
  "run": {
    "id": "live_4f6c9f1a20b3448d",
    "name": "Q2 Workforce Planning",
    "simulationId": "operations-decision",
    "createdAt": "2026-05-02T00:00:00.000Z",
    "expiresAt": "2026-05-03T00:00:00.000Z",
    "displayTitle": "Q2 Workforce Planning",
    "displaySubtitle": "2 scenarios compared. Recommended: Process Improvement.",
    "shareLabel": "Business Simulator result: Q2 Workforce Planning",
    "resultSummary": "Process Improvement is recommended because productivity improves while risk stays flat.",
    "scenarioCount": 2,
    "keyMetric": {
      "metric": "margin",
      "label": "Best margin",
      "value": 23164,
      "unit": "USD",
      "scenarioName": "Process Improvement"
    },
    "bestMargin": 23164,
    "bestMarginScenario": "Process Improvement",
    "riskRange": [18.4, 24.8],
    "recommendedScenarioId": "process-improvement",
    "recommendedScenarioName": "Process Improvement",
    "expiryNote": "Temporary result expires at 2026-05-03T00:00:00.000Z."
  }
}
```

`GET /api/simulation-runs` returns session-scoped summaries with display title, subtitle, share label, result summary, scenario count, key metric, best margin, best-margin scenario, risk range, recommendation metadata, expiry note, and expiry time so a visitor can revisit recent work without seeing another visitor's run list. `GET /api/simulation-runs/:id` loads the full request and response for a known run ID, which is the shareable result-page path the frontend can use.

The persisted demo store is configured with:

| Environment variable | Default | Purpose |
| --- | ---: | --- |
| `REUX_DEMO_MAX_SIMULATION_RUNS` | `200` | Maximum saved run records before oldest records are evicted. |
| `REUX_DEMO_SIMULATION_RUN_TTL_MS` | `86400000` | How long saved runs remain available. |

The future production version should add tenant/user ownership, retention controls, and admin cleanup views, but the response shapes should stay compatible.

## Backend Integration Notes

The first backend implementation can adapt the existing Reux simulation runner:

1. Start from `examples/simulations/business_simulator.reux`.
2. Convert `baseline` and each scenario override into Reux assumption values.
3. Run the simulation through the Reux simulation runtime.
4. Normalize Reux output into `BusinessSimulatorRunResponse`.
5. Keep recommendation scoring deterministic and explainable.

The initial model maps API assumptions to Reux assumptions directly:

| API field | Reux assumption |
| --- | --- |
| `employees` | `employees` |
| `averageHourlyCost` | `averageHourlyCost` |
| `weeklyDemand` | `weeklyDemand` |
| `averageOrderValue` | `averageOrderValue` |
| `grossMarginRate` | `grossMarginRate` |
| `productivityGainRate` | `productivityGainRate` |
| `overtimeReductionRate` | `overtimeReductionRate` |
| `supplierDelayRiskRate` | `supplierDelayRiskRate` |
| `defectRate` | `defectRate` |

The model emits these frontend-facing metric names:

- `revenue`
- `operatingCost`
- `laborCost`
- `productivity`
- `workforceLoad`
- `margin`
- `marginDelta`
- `riskScore`
- `defectCost`

The endpoint should not require admin tokens. Public demos can rate-limit and session-isolate requests separately from this contract.

## Adapter

The backend adapter lives in `src/business-simulator-adapter.ts`.

It provides:

- `listBusinessSimulations()`
- `getBusinessSimulation(id)`
- `runBusinessSimulator(request)`
- `compareBusinessSimulatorScenarios(request)`
- `buildBusinessSimulatorSource(request)`
- `createBusinessSimulatorContractFixture()`
- `emitBusinessSimulatorContractFixture()`
- `assertBusinessSimulatorRunRequest(body)`
- `assertBusinessSimulatorCompareRequest(body)`

The adapter turns frontend contract requests into a temporary Reux simulation source, runs it through the Reux simulation runtime, and normalizes the result back into `BusinessSimulatorRunResponse`.

Recommendation scoring is deterministic. It rewards:

- Higher `marginDelta`.
- Higher `productivity`.
- Lower `operatingCost`.
- Lower `riskScore`.

The output includes a recommended scenario, reasons, and tradeoffs so the frontend can show a clear decision summary without inventing its own scoring logic.

## Demo Server Behavior

- `GET /api/simulations` returns `ListBusinessSimulationsResponse`.
- `GET /api/simulations/operations-decision` returns the default assumptions and starter scenarios.
- `POST /api/simulations/run` accepts `BusinessSimulatorRunRequest`.
- `GET /api/simulation-runs` returns recent run summaries for the current visitor session.
- `GET /api/simulation-runs/:id` returns a saved run record with the original request and normalized response.
- `POST /api/scenarios/compare` accepts `BusinessSimulatorCompareRequest`.
- Unknown simulation IDs return `404`.
- Malformed run/compare requests return `400`.
- Malformed Business Simulator requests include `code: "business_simulator_validation_failed"` and stable `issues[].path` entries for field-level display.
