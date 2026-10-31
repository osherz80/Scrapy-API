# Implementation Plan: Supermarket search and control API

## Overview

Build the standalone Fastify/TypeScript service in this repository that Neuton will call for sampled retail price estimates. The service reads the shared `supermarket` PostgreSQL catalog, scores name matches with the existing Neuton scorer, and exposes search, batch search, manual refresh, and admin status. Ingestion remains a separate deployable. This plan covers the API only. It does not modify Neuton-Back or the Scrapy ingestor.

Source of truth: `SPEC-supermarket-api.md`, with schema, leases, and field storage owned by `SPEC-supermarket-scraper.md`. Adopted scoring source, read on 2026-10-31 and not modified: `Neuton-Back/src/lib/supermarket/prices.ts` functions `normalizeQuery`, `tokenize`, `scoreMatch`, and `SEARCH_MIN_SCORE` (2500, accept only when score is strictly greater). Conversion compatibility is checked against the behavior of `normalizeProductPrice` and `setUnitsData`.

## Architecture Decisions

- `npm run dev`, `npm start`, and `npm run db:migrate` load a root `.env` when the file exists. A variable already set in the environment wins. Tests do not load the file. Missing names are reported; values are not printed.
- One `DATABASE_URL` serves catalog reads and refresh control. There are no separate database roles and no `SEARCH_API_KEY` or `ADMIN_API_KEY`. Search, refresh, and status are not gated by an HTTP credential.
- Application code uses parameterized SQL through small repository functions. No ORM and no Redis.
- The scorer is a pure TypeScript module copied from the adopted Neuton source. Python and SQL do not rank matches. `normalized_name` and `name_tokens` must be produced with these same functions.
- Stable ordering after scoring is an API rule on top of unchanged scores: score descending, then chain id ascending, then item code ascending. The original Neuton search sorted by score only.
- Search reads every chain that has catalog rows. `chains.enabled` is an ingestion switch and does not hide published rows. A refresh with omitted `chains` reserves all ten canonical chain ids, including chains currently marked disabled in the seed migration.
- `isStale` is true only when `sourceUpdatedAt` is strictly older than `STALE_AFTER_HOURS` (default 48). `updatedAt` is the publication time and does not refresh source age.
- Legacy `ItemPrice` is the averaged price rendered with four decimal places. Canonical `price` is that same value as a JSON number. `Quantity` is the selected observation's `source_quantity` as a decimal string without forced scale. `PriceUpdateTime` is `item_price_updated_at` in UTC ISO-8601, or `""` when null. Empty legacy fields stay empty strings.
- Comparison fields `UnitOfMeasure` and `UnitOfMeasurePrice` are derived only for package units `g`, `ml`, and `unit` (per 100 g, per 100 ml, per 1 unit). Money for the comparison price uses half-up rounding to two decimal places. Unknown package data leaves both strings empty. `UnitQty` and `Quantity` always come from the same stored observation and are never filled from `UnitOfMeasure`.
- HTTP errors use the spec's status set. A body over 64 KiB is `400 VALIDATION_ERROR`. Fastify's default error JSON is replaced. Database failures are `503`, never an empty `200` match list.
- Handlers call search and refresh services directly. No customer onboarding, API keys, x402, or MCP server is added.
- CORS stays off. Rate limits are in-process guardrails (60 searches/minute, 5 refresh triggers/minute) for the whole process.
- Logging has three layers: call-site `Logger`, a facade that filters, merges context, stamps `service`/`environment`/`version`, and redacts, and a transport. The first transport is one JSON line on the matching console method. Tests use an in-memory transport. Raw `q` / `query` values are dropped. Errors log name and message only.
- Catalog SQL lives in `db/migrations/001_catalog.sql` and `db/rollback/001_catalog.sql`. It matches the shared table contract and uses the `supermarket.schema_migrations` checksum protocol (advisory lock `1397900112, 1`). It does not create database roles. A hosted database already migrated by Scrapy under a different checksum must fail closed rather than be rewritten.
- Integration tests accept only a local PostgreSQL URL whose database name starts with `supermarket_api_test`. They do not use the hosted database.
- Node.js 24, TypeScript strict, Fastify 5.12.7, `pg` 8.23.1. TypeScript 7.0.2 is published, but `typescript-eslint` 8.72.1 only accepts TypeScript `>=4.8.4 <6.1.0`, so the compiler is locked at 6.0.3. Versions are locked in `package-lock.json`. TypeScript is executed by Node's type stripper in dev/test and compiled with `rewriteRelativeImportExtensions` for `npm start`.

## Dependency graph

```
config, logger, chain ids, error shape
    ├── health/live and app factory
    ├── scorer + normalization fixtures
    │       └── ProductResult adapter
    ├── vendored migrations + pools
    │       ├── SKU lookup
    │       ├── name candidate retrieval + top-N
    │       │       └── single and batch search routes
    │       └── lease admission + refresh status
    └── OpenAPI, Render config, readiness, metrics
```

## Task List

### Phase 1: Foundation
- [x] Task 1: API workspace and command scripts
- [x] Task 2: Environment configuration validation
- [x] Task 3: Logger facade and transports
- [x] Task 4: App factory, error shape, and liveness

### Checkpoint: Foundation
- [x] `npm run typecheck`, `npm run lint`, and `npm test` pass from the repository root
- [x] `GET /health/live` returns 200 through Fastify inject with no database

### Phase 2: Matching and response compatibility
- [x] Task 5: Pure scorer and normalization
- [x] Task 6: ProductResult field mapping

### Checkpoint: Compatibility
- [x] Golden scores match the adopted Neuton scorer, including Hebrew punctuation and `Math.round`
- [x] Tabasco 60 ml adapter output converts to 0.181667 ILS/ml through the unchanged Neuton unit functions

### Phase 3: Database access
- [x] Task 7: Catalog migration runner
- [x] Task 8: Read pool and exact SKU lookup
- [x] Task 9: Readiness check

### Checkpoint: Database
- [x] Local PostgreSQL integration test applies the catalog migration and finds an exact SKU in two chains
- [x] Readiness returns 503 when the database check fails

### Phase 4: Name search and HTTP search
- [x] Task 10: Recall-safe name retrieval and per-chain top-N
- [x] Task 11: Single and batch search routes
- [x] Task 12: Process-wide rate limits

### Checkpoint: Search
- [x] Contract tests cover limits, empty arrays, duplicate batch ids, and process-wide rate limits
- [x] Chunked ranking matches a full pass on the fixture catalog

### Phase 5: Refresh control
- [x] Task 13: Atomic refresh admission
- [x] Task 14: GitHub dispatch and uncertainty
- [x] Task 15: Run and chain status

### Checkpoint: Refresh
- [x] Overlapping chain sets return 409 with no partial reservation
- [x] Unknown dispatch outcome keeps the reservation; a rejected dispatch returns 503 and releases it

### Phase 6: Operability
- [x] Task 16: Request metrics, OpenAPI, and Render/deploy notes

### Checkpoint: Complete
- [x] Local fixture timings are recorded. Render warm-path budgets are not claimed
- [x] Required root commands exist and are documented
- [ ] Ready for human review before any deploy or Neuton client change

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| The hosted database login can change catalogs as well as read them | Med | Accepted for this version. One `DATABASE_URL` is the only database credential. |
| This repo's migration checksum differs from Scrapy's `001_ingestion.sql` | High | Do not run `db:migrate` against the hosted database. The runner refuses checksum drift. |
| Candidate SQL drops the true best name match | High | No `LIMIT` before TypeScript scoring. Test optimized recall against exhaustive scoring. |
| JS and Python tokenization diverge | High | API owns the normalization functions and fixture vectors the importer must use. |
| Supabase pool or free-tier latency is too small | Med | Small pools, 15s statement timeout, explicit timeout errors, measure before changing semantics. |
| GitHub dispatch credential or workflow id is absent | Med | Mock HTTP in tests. Real dispatch stays config-gated and is not required for search tests. |
| Float rendering changes money strings | Med | Format `ItemPrice` from the numeric string with a fixed 4-decimal scale, not binary float math. |

## Open Questions

- `GITHUB_REPOSITORY`, `GITHUB_WORKFLOW_ID`, `GITHUB_REF`, and `GITHUB_TOKEN` are required together only when a refresh is dispatched. They are unset until that workflow file exists. This repo's GitHub name is `osherz80/Scrapy-API`, and it has no workflow file yet.
- `shufersal` and `carrefour` are inserted `enabled=false` by the current ingestor migration. This plan still treats all ten ids as configured. Change that only if product requirements say disabled chains must be omitted from refresh-all.

## Out of scope

Public signup, billing, x402, MCP, CORS, search filters, coverage summaries, in-process catalog collection, and any edit to Neuton production or the Scrapy ingestor.
