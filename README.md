# Supermarket API

Standalone HTTP service for sampled supermarket price estimates. Neuton calls it server-to-server. Ingestion is a separate process and is not part of this service.

The design is in `SPEC-supermarket-api.md`. Shared catalog rules are in `SPEC-supermarket-scraper.md`. The implementation plan is in `tasks/plan.md`.

## Commands

Run these from the repository root:

```
npm ci --prefix services/api
npm run dev --prefix services/api
npm run typecheck --prefix services/api
npm run lint --prefix services/api
npm test --prefix services/api
npm run test:integration --prefix services/api
npm run build --prefix services/api
npm start --prefix services/api
npm run db:migrate --prefix services/api
```

`npm run dev` and `npm start` listen on `0.0.0.0` and `PORT` (default 3000). The process reads configuration from the environment only. It does not load `.env`.

`db:migrate` applies `db/migrations` to `DATABASE_URL` and records SHA-256 checksums in `supermarket.schema_migrations`. Do not point it at a database that Scrapy already migrated: a different checksum fails closed and does not rewrite data. Integration tests start a disposable PostgreSQL cluster under `Temp/pg-api` and delete it when they finish. They refuse any URL whose database name does not start with `supermarket_api_test`.

## Configuration

Copy `services/api/.env.example` only as a name checklist. The only value required to boot is `DATABASE_URL`. This version has no `SEARCH_API_KEY`, no `ADMIN_API_KEY`, and no separate database roles. A non-local database URL must not use `sslmode=disable`.

`POST /v1/refreshes` is implemented. It admits a run only when all four GitHub settings below are present, then asks GitHub to dispatch a workflow. The scraper does not yet have a manual-run path, so a successful dispatch does not finish ingestion. Without those settings the route returns `503 DISPATCH_UNAVAILABLE` and does not create a run.

These four are required together only for dispatch:

| Name | Where it comes from |
| --- | --- |
| `GITHUB_REPOSITORY` | `owner/name` of the repo that will contain the ingestion workflow. This repo's GitHub remote is `osherz80/Scrapy-API`. |
| `GITHUB_WORKFLOW_ID` | The workflow file name, such as `refresh.yml`, or the numeric id shown on that workflow's Actions page. This repo does not have that file yet. |
| `GITHUB_REF` | The git ref to run. For this repo's default branch that is `refs/heads/main`. |
| `GITHUB_TOKEN` | A token you create under GitHub Settings → Developer settings → Personal access tokens, with permission to dispatch Actions on that repository. GitHub shows it once. |

Optional values default to a 48-hour stale window, 60 search requests per minute, 5 refresh triggers per minute, a 15-second database statement timeout, a 30-second request budget, and database concurrency of 2. `LOG_ENV=production` forces the log level to at least `info`.

## HTTP

There is no bearer token. `GET /openapi.json` lists the routes.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/health/live` | `200` when the process is up. No database call. |
| GET | `/health/ready` | `200` after `SELECT 1`. `503` and `Retry-After: 5` when the database check fails. |
| GET | `/v1/search` | `queryType` `name` or `sku`, `q` of 1–200 characters, `limitPerChain` 1–10 (default 1). Zero matches is `200` and `[]`. |
| POST | `/v1/search/batch` | 1–10 queries, unique ids, one snapshot, original order. |
| POST | `/v1/refreshes` | `202` when a run is admitted. `409` when a chain is already reserved. `503` when dispatch is unavailable. |
| GET | `/v1/refreshes/:runId` | Run and per-chain status. Unknown id is `404`. |
| GET | `/v1/chains` | Product count, publication time, source watermark, stale flag, active run. |

Search is limited to 60 requests per minute and refresh triggers to 5 per minute, for the whole process. Over the limit is `429` with `Retry-After`. Error bodies use `{ "error": { "code", "message" }, "requestId" }`. The request id is also returned in `x-request-id`.

## Field mapping

Each result keeps Neuton's legacy price names and adds canonical fields. `ItemPrice` is the averaged price with four decimal places. `price` is that same value as a JSON number, with `currency` `ILS`. `Quantity` and `UnitQty` come from the stored observation. `UnitOfMeasure` and `UnitOfMeasurePrice` are comparison fields only (`100 g`, `100 ml`, or `1 unit`) and are empty when the package unit is missing. `PriceUpdateTime` is the item price-change time, or `""`. `sourceUpdatedAt` is catalog freshness. `isStale` is true only when that timestamp is strictly older than 48 hours. Name matches must score above 2500. SKU matches are exact `item_code` equality, score 10000, and leading zeros are significant.

## Render

`render.yaml` describes a free web service. Build is `npm ci` then `npm run build` in `services/api`. Start is `npm start`, which listens on `0.0.0.0`. The health check path is `/health/live`. Node is pinned to 24.14.0. This file is not a deploy, and no Neuton client URL is changed here.

On 2026-10-31 a warm name lookup against the local fixture (about 30 products, local PostgreSQL 18) averaged 2.2 ms, and ten lookups in one snapshot took 12.7 ms. That fixture is not the free-tier catalog, so the 2 second and 10 second budgets are not claimed for Render. Starting the disposable database is excluded from those warm figures.

## Logging

Call sites use the `Logger` interface. A facade filters by level, stamps `service`, `environment`, and `version`, and redacts authorization headers, cookies, passwords, and tokens. The console transport writes one JSON line. Tests use the in-memory transport.
