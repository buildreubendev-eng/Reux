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
  "simulationId": "operations-throughput",
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

- `simulation`: template metadata.
- `baseline`: baseline scenario result.
- `scenarios`: scenario results.
- `comparison`: deltas and recommendation.
- `reuxSource`: optional read-only Reux source used for transparency panels.
- `generatedAt`: ISO timestamp.

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

For public API handlers, call `assertBusinessSimulatorRunRequest(body)` before running a simulation and `assertBusinessSimulatorCompareRequest(body)` before comparing existing results. Validation failures throw `BusinessSimulatorValidationError` with stable `issues[].path` values such as `$.baseline.grossMarginRate`, which lets frontends display field-level errors instead of a generic failed request.

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
- `POST /api/scenarios/compare` accepts `BusinessSimulatorCompareRequest`.
- Unknown simulation IDs return `404`.
- Malformed run/compare requests return `400`.
- Malformed Business Simulator requests include `code: "business_simulator_validation_failed"` and stable `issues[].path` entries for field-level display.
