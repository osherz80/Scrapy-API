# Supermarket API

Standalone HTTP service for sampled supermarket price estimates. Neuton calls it server-to-server. Ingestion is a separate process and is not part of this service.

The design is in `SPEC-supermarket-api.md`. Shared catalog rules are in `SPEC-supermarket-scraper.md`. The implementation plan is in `tasks/plan.md`.

## Commands

Run these from the repository root:

```
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
npm start
```

`npm run dev` and `npm start` listen on `0.0.0.0` and `PORT` (default 3000). Both load a root `.env` when that file exists. A variable already set in the environment wins over the file. Tests do not load `.env`.

This service owns no schema and has no migration command. It reads the scraper-owned `public.products` tables and never issues DDL. Integration tests apply a read-only copy of the scraper's migrations 001–005 from `test/fixtures/scraper-schema/` to a disposable PostgreSQL cluster under `Temp/pg-api`, and delete it when they finish. They refuse any URL whose database name does not start with `supermarket_api_test`.

## Configuration

Copy `.env.example` only as a name checklist. The only value required to boot is `DATABASE_URL`. This version has no `SEARCH_API_KEY`, no `ADMIN_API_KEY`, and no separate database roles. A non-local database URL must not use `sslmode=disable`.

If the database uses a CA outside Node's default trust store, provision its CA certificate and set `DATABASE_SSLROOTCERT=certs/supabase-ca.crt` in `.env`. Use the same certificate as the scraper. Relative paths resolve from the process working directory; absolute paths also work. The API enforces certificate and hostname verification for remote databases, including when the URL contains `sslmode=require`. It also supports a URL `sslrootcert` when the environment setting is absent. Certificate files under `certs/` are ignored by Git.

For Render, upload the CA as a secret file (for example `supabase-ca.crt`) and set `DATABASE_SSLROOTCERT=/etc/secrets/supabase-ca.crt`, then redeploy with the updated API. Keep the existing `DATABASE_URL`. A local certificate file is not automatically available on Render.

Connection and query failures log `phase` and `databaseCode` without driver messages, credentials, or query text. `SELF_SIGNED_CERT_IN_CHAIN` means the database CA needs configuring. `/health/ready` checks connectivity; `/health/live` only checks that the process is running.

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

URL-encode Hebrew search text when using curl from Windows. For example, this searches for `חלב` without depending on the terminal's text encoding:

```powershell
curl.exe "http://localhost:3000/v1/search?queryType=name&q=%D7%97%D7%9C%D7%91&limitPerChain=3"
```

## Search results

Since 2026-11-01 search returns raw rows, not Neuton's legacy price envelope. Each item is a flat object:

```json
{ "score": 9500, "chainId": "shufersal", "itemCode": "11210000094", "itemName": "רוטב טבסקו 60 מ\"ל", "...": "every other column" }
```

The keys are the camelCase form of the `public.products` columns. The API strips `runId`, `updatedAt`, `nameTokens`, and (defensively) `normalizedName`. `subchainId` and `storeId` stay. Values are database-native: `itemPrice` is the stored text, `sampleCount` is a number, timestamps are ISO strings. The API does not format money, convert units, or compute comparison prices — the consumer owns that mapping.

Columns are discovered with `SELECT *` plus that one denylist, so a new non-internal scraper column appears without an API change. Name recall matches an exact `itemCode`, an exact normalized `itemName` (`lower(btrim(item_name))`), or a `nameTokens` overlap. Name matches must score above 2500. SKU matches are exact `itemCode` equality, score 10000, and leading zeros are significant.

## Render

`render.yaml` describes a free web service. Build is `npm ci` then `npm run build` from the repository root. Start is `npm start`, which listens on `0.0.0.0`. Leave Render's root directory empty. The health check path is `/health/live`. Node is pinned to 24.14.0. This file is not a deploy, and no Neuton client URL is changed here.

On 2026-10-31 a warm name lookup against the local fixture (about 30 products, local PostgreSQL 18) averaged 2.2 ms, and ten lookups in one snapshot took 12.7 ms. That fixture is not the free-tier catalog, so the 2 second and 10 second budgets are not claimed for Render. Starting the disposable database is excluded from those warm figures.

## Logging

Call sites use the `Logger` interface. A facade filters by level, stamps `service`, `environment`, and `version`, and redacts authorization headers, cookies, passwords, and tokens. The console transport writes one JSON line. Tests use the in-memory transport.
