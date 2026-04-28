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

## Railway

1. Create a new Railway project from `benn4105/Reux`.
2. Add a PostgreSQL service to the same Railway project.
3. On the Reux service, set:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
REUX_DEMO_SCHEMA=reux_demo
REUX_DEMO_SETUP_TOKEN=<private admin token>
```

`railway.json` sets the build command, start command, `/api/health` health check, and restart policy. Railway reads this file during deployment.

## Render

Use the repo Blueprint (`render.yaml`) to create the web service and a managed PostgreSQL database together. The Blueprint wires `DATABASE_URL` from the database, sets `REUX_DEMO_SCHEMA`, and generates `REUX_DEMO_SETUP_TOKEN`.

If creating the Render service manually instead of through the Blueprint, use the build/start settings above and add the three environment variables manually.

## Environment Variables

```text
DATABASE_URL=postgres://...
REUX_DEMO_SCHEMA=reux_demo
REUX_DEMO_SETUP_TOKEN=<private admin token>
```

`DATABASE_URL` is required. `REUX_DEMO_SCHEMA` defaults to `reux_demo`, which keeps demo objects separate from other tables in the same database. `REUX_DEMO_SETUP_TOKEN` is optional for local development but should be set on public deployments; when set, the setup/reset endpoint requires the token before applying migrations or resetting seed data.

## First Setup

After deployment:

1. Open the deployed demo URL.
2. Enter the private admin token if `REUX_DEMO_SETUP_TOKEN` is set.
3. Click `Apply Migrations + Reset Seed`.
4. Confirm `/api/dashboard` returns seeded orders, payments, balances, and outbox events.

Regular visitors can use the dashboard and transaction buttons after setup. Keep the token private so the shared demo database cannot be reset by everyone visiting the public site.

## Website Integration

Point the marketing/docs website at the hosted demo URL with an environment variable such as:

```text
NEXT_PUBLIC_REUX_DEMO_URL=https://your-demo-host.example.com
```

Use a normal link for the safest launch path. An iframe also works because the demo app does not set frame-blocking headers, but a full-page link is easier to debug across hosting providers.
