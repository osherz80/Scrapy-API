# Implementation Plan: Supermarket search and control API

## Overview

Build the standalone Fastify/TypeScript service in this repository that Neuton will call for sampled retail price estimates. The service reads the scraper-owned `public` PostgreSQL catalog, scores name matches with the existing Neuton scorer, and exposes search, batch search, manual refresh, and admin status. Ingestion remains a separate deployable. This plan covers the API only. It does not modify Neuton-Back or the Scrapy ingestor.

Source of truth: `SPEC-supermarket-api.md`, with search response shape superseded by `SPEC-raw-row-search.md` (2026-11-01). Schema, leases, and field storage are owned by `SPEC-supermarket-scraper.md`. Adopted scoring source, read on 2026-10-31 and not modified: `Neuton-Back/src/lib/supermarket/prices.ts` functions `normalizeQuery`, `tokenize`, `scoreMatch`, and `SEARCH_MIN_SCORE` (2500, accept only when score is strictly greater). Search responses are raw scored rows; Neuton's `normalizeProductPrice` compatibility is no longer an API concern.

## Architecture Decisions

- `npm run dev` and `npm start` load a root `.env` when the file exists. A variable already set in the environment wins. Tests do not load the file. Missing names are reported; values are not printed. There is no migration command.
- One `DATABASE_URL` serves catalog reads and refresh control. There are no separate database roles and no `SEARCH_API_KEY` or `ADMIN_API_KEY`. Search, refresh, and status are not gated by an HTTP credential.
- Application code uses parameterized SQL through small repository functions. No ORM and no Redis.
- The scorer is a pure TypeScript module copied from the adopted Neuton source. Python and SQL do not rank matches. The scraper owns `name_tokens`; the API only reads it. `normalized_name` does not exist in the scraper schema.
- Stable ordering after scoring is an API rule on top of unchanged scores: score descending, then chain id ascending, then item code ascending. The original Neuton search sorted by score only.
- Search reads every chain that has catalog rows. `chains.enabled` is an ingestion switch and does not hide published rows. A refresh with omitted `chains` reserves all ten canonical chain ids, including chains currently marked disabled in the seed migration.
- Both search endpoints return a flat `{ score, ...row }`. The row is the full `public.products` row converted to camelCase, minus the internal columns `runId`, `updatedAt`, `nameTokens`, and (defensively) `normalizedName`. `score` is assigned last so a future DB `score` column cannot override it. `subchainId` and `storeId` stay.
- Search values are DB-native. `text` stays text, `numeric` arrives as a string from `pg`, `integer` as a number, and `timestamptz` as an ISO string. The API does not format money, convert units, or derive comparison fields; the consumer owns semantic mapping.
- Column discovery is `SELECT *` plus one camelCase denylist in `src/search/row-result.ts`, so a new non-internal scraper column appears without an API change. Key renaming happens in TypeScript (`camelizeRow`), never SQL aliases, because SQL aliases would defeat fail-open discovery.
- HTTP errors use the spec's status set. A body over 64 KiB is `400 VALIDATION_ERROR`. Fastify's default error JSON is replaced. Database failures are `503`, never an empty `200` match list.
- Handlers call search and refresh services directly. No customer onboarding, API keys, x402, or MCP server is added.
- CORS stays off. Rate limits are in-process guardrails (60 searches/minute, 5 refresh triggers/minute) for the whole process.
- Logging has three layers: call-site `Logger`, a facade that filters, merges context, stamps `service`/`environment`/`version`, and redacts, and a transport. The first transport is one JSON line on the matching console method. Tests use an in-memory transport. Raw `q` / `query` values are dropped. Errors log name and message only.
- Catalog tables, leases, and migration history belong to the scraper in `public.*`. The API issues no DDL, owns no migrations, and has no checksum protocol. Runtime SQL only reads catalog tables (plus refresh-control DML that a later refresh spec will place).
- Integration tests accept only a local PostgreSQL URL whose database name starts with `supermarket_api_test`. They do not use the hosted database.
- Node.js 24, TypeScript strict, Fastify 5.12.7, `pg` 8.23.1. TypeScript 7.0.2 is published, but `typescript-eslint` 8.72.1 only accepts TypeScript `>=4.8.4 <6.1.0`, so the compiler is locked at 6.0.3. Versions are locked in `package-lock.json`. TypeScript is executed by Node's type stripper in dev/test and compiled with `rewriteRelativeImportExtensions` for `npm start`.

## Dependency graph

```
config, logger, chain ids, error shape
    ├── health/live and app factory
    ├── scorer + normalization fixtures
    │       └── camelCase row contract + scored-row builder
    ├── read pool + scraper-owned public schema
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

### Phase 2: Matching and response contract
- [x] Task 5: Pure scorer and normalization
- [x] Task 6: camelCase raw-row search contract

### Checkpoint: Contract
- [x] Golden scores match the adopted Neuton scorer, including Hebrew punctuation and `Math.round`
- [x] Search results are `{ score, ...row }` with camelCase keys, no internal columns, and no legacy mapping

### Phase 3: Database access
- [x] Task 7: Read the scraper-owned schema (no migration runner)
- [x] Task 8: Read pool and exact SKU lookup
- [x] Task 9: Readiness check

### Checkpoint: Database
- [x] Local PostgreSQL integration test applies vendored scraper migrations 001–005 and finds an exact SKU in two chains
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
| The API cannot create or migrate its schema | High | Schema is scraper-owned in `public.*`. The API issues no DDL and fails loudly on a missing or wrong table shape. |
| Candidate SQL drops the true best name match | High | No `LIMIT` before TypeScript scoring. Test optimized recall against exhaustive scoring. |
| JS and Python tokenization diverge | High | The scraper owns `name_tokens`; parity fixtures in `contracts/fixtures/normalization.json` stay the contract between them. |
| Supabase pool or free-tier latency is too small | Med | Small pools, 15s statement timeout, explicit timeout errors, measure before changing semantics. |
| GitHub dispatch credential or workflow id is absent | Med | Mock HTTP in tests. Real dispatch stays config-gated and is not required for search tests. |
| A future scraper column is accidentally exposed | Low | Fail-open is intentional for non-internal columns. Internal additions must be added to the single denylist. |

## Open Questions

- `GITHUB_REPOSITORY`, `GITHUB_WORKFLOW_ID`, `GITHUB_REF`, and `GITHUB_TOKEN` are required together only when a refresh is dispatched. They are unset until that workflow file exists. This repo's GitHub name is `osherz80/Scrapy-API`, and it has no workflow file yet.
- `shufersal` and `carrefour` are inserted `enabled=false` by the current ingestor migration. This plan still treats all ten ids as configured. Change that only if product requirements say disabled chains must be omitted from refresh-all.
- Should the API assert at startup that `public.products` exists and is readable, failing readiness rather than search? Not decided; today a missing table surfaces as a `503` on search.
- Who writes the `refresh_runs` / `refresh_run_chains` rows once the refresh spec lands: the API before dispatch, or the scraper after receiving the trigger? Until decided, the API keeps writing them and the raw-row spec only renames the schema.

## Out of scope

Public signup, billing, x402, MCP, CORS, search filters, coverage summaries, in-process catalog collection, and any edit to Neuton production or the Scrapy ingestor.
