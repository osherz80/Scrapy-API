# Supermarket API tasks

Plan: `tasks/plan.md`. Spec: `SPEC-supermarket-api.md`.

Definition of done for every task: acceptance criteria below, plus tests that fail without the change, `npm run typecheck`, `npm run lint`, and `npm test`.

## Task 1: API workspace and command scripts

**Description:** Create the TypeScript package at the repository root with pinned Fastify 5 and Node 24 toolchains, ESM source, and the root commands the spec requires for typecheck, lint, unit test, and build. No route behavior beyond what later tasks add.

**Acceptance criteria:**
- [x] `package.json` is `"type": "module"`, engines require Node 24, and dependencies are exact-pinned in the lockfile
- [x] `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` work from the repository root
- [x] `.env.example` contains placeholders only

**Verification:**
- [x] Tests pass: `npm test`
- [x] Build succeeds: `npm run build`
- [x] Manual check: `dist/server.js` is emitted and imports use `.js` extensions

**Dependencies:** None

**Files likely touched:**
- `package.json`
- `tsconfig.json`
- `tsconfig.build.json`
- `eslint.config.js`
- `.env.example`
- `README.md`

**Estimated scope:** Medium: 3-5 files

## Task 2: Environment configuration validation

**Description:** Load the spec's runtime settings from a caller-supplied environment object. Reject missing or malformed values without reading files and without including secret values in the error.

**Acceptance criteria:**
- [x] The only required name is `DATABASE_URL`. GitHub dispatch settings are optional and must be set together
- [x] Defaults match the spec: stale window 48 hours, search limit 60/minute, refresh limit 5/minute, query timeout 15s, request budget 30s, batch DB concurrency 2
- [x] Non-local database URLs must not set `sslmode=disable`. There is no search or admin API key
- [x] Production log environment cannot stay below `info`

**Verification:**
- [x] Tests pass: `npm test`
- [x] Build succeeds: `npm run build`
- [x] Manual check: a unit test passes `{}` and asserts the missing names, not any secret

**Dependencies:** Task 1

**Files likely touched:**
- `src/config.ts`
- `test/unit/config.test.ts`

**Estimated scope:** Small: 1-2 files

## Task 3: Logger facade and transports

**Description:** Add the three-layer logger: call-site methods, a filtering/redacting facade, a console JSON transport, and an in-memory transport. Handlers must not call `console` directly.

**Acceptance criteria:**
- [x] `debug`, `info`, `warn`, `error`, and `fatal` accept message-then-meta, meta-then-message, and Error-then-meta
- [x] Records always include `service: "api"`, `environment`, and `version`
- [x] Authorization, cookies, passwords, and tokens are redacted before the transport. Error records contain name and message only
- [x] Keys `q` and `query` are removed. `fatal` writes with `console.error`. `flush` on the console transport is a no-op and factory shutdown is idempotent

**Verification:**
- [x] Tests pass: `npm test`
- [x] Build succeeds: `npm run build`
- [x] Manual check: memory-transport tests assert redaction and level filtering

**Dependencies:** Task 1

**Files likely touched:**
- `src/logger/types.ts`
- `src/logger/redact.ts`
- `src/logger/logger.ts`
- `src/logger/factory.ts`
- `src/logger/transports/console.ts`
- `src/logger/transports/memory.ts`
- `test/unit/logger.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 4: App factory, error shape, and liveness

**Description:** Export Fastify app construction separately from listening. Serve unauthenticated liveness, a stable JSON error body, and a request log line. Do not open a database connection.

**Acceptance criteria:**
- [x] `GET /health/live` returns 200 `{ "status": "ok" }` with no catalog or secret fields
- [x] Unknown routes and invalid JSON use `{ error: { code, message }, requestId }`
- [x] Body limit is 64 KiB and oversize bodies return `400` with `VALIDATION_ERROR`
- [x] Each response log includes `requestId`, endpoint, duration, and status
- [x] The process listens on `PORT` and `0.0.0.0` only from `server.ts`

**Verification:**
- [x] Tests pass: `npm test`
- [x] Build succeeds: `npm run build`
- [x] Manual check: inject tests cover liveness, 404, malformed JSON, and the 64 KiB limit

**Dependencies:** Tasks 2 and 3

**Files likely touched:**
- `src/app.ts`
- `src/server.ts`
- `src/http/errors.ts`
- `test/unit/health.test.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 1-4
- [x] All foundation tests pass
- [x] Application builds without errors
- [x] Liveness works without a database
- [ ] Review with human before deploy (local implementation may continue)

## Task 5: Pure scorer and normalization

**Description:** Port `normalizeQuery`, `tokenize`, and `scoreMatch` verbatim from the adopted Neuton source, including `Math.round` and the Hebrew punctuation replacements. Export the strict threshold.

**Acceptance criteria:**
- [x] Exact barcode scores 10000 and exact name scores 9500
- [x] Score 2500 is rejected and 2501 would be accepted; zero name-token overlap scores 0
- [x] Golden fixtures cover Hebrew names, geresh/gershayim, decimal numbers, manufacturer overlap, and the length penalty
- [x] Token vectors for the shared catalog fixtures are stored under `contracts/fixtures/`

**Verification:**
- [x] Tests pass: `npm test`
- [x] Build succeeds: `npm run build`
- [x] Manual check: one golden expected value is recomputed from the written formula, not copied from the function output blindly

**Dependencies:** Task 1

**Files likely touched:**
- `src/search/score.ts`
- `test/unit/score.test.ts`
- `contracts/fixtures/normalization.json`

**Estimated scope:** Small: 1-2 files

## Task 6: ProductResult field mapping

**Description:** Map a catalog row plus a score into the legacy price fields Neuton already reads, and add the canonical price, currency, sample count, timestamps, and stale flag.

**Acceptance criteria:**
- [x] Field mapping matches spec section 3 and scraper spec section 7.1, including empty strings for unpersisted XML fields
- [x] The 60 ml Tabasco row returns `UnitQty` `מיליליטר`, `Quantity` `"60"`, and `ItemPrice` `"10.9000"`
- [x] Running that result through the frozen Neuton `setUnitsData` / `normalizeProductPrice` snapshot yields base unit ml, amount 60.000, and cost 0.181667
- [x] A second SKU stays a different result. Missing package data stays searchable and leaves conversion strings empty
- [x] `UnitOfMeasure` `100 מיליליטר` is a derived comparison basis, not the package quantity

**Verification:**
- [x] Tests pass: `npm test`
- [x] Build succeeds: `npm run build`
- [x] Manual check: stale boundary tests at exactly 48 hours and one millisecond past it

**Dependencies:** Task 5

**Files likely touched:**
- `src/search/product-result.ts`
- `src/contracts/chains.ts`
- `test/unit/product-result.test.ts`
- `test/fixtures/neuton-units.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 5-6
- [x] Scorer and adapter tests pass
- [x] No Neuton-Back files were modified

## Task 7: Vendored migration runner

**Description:** Apply `db/migrations/001_catalog.sql` with the checksum history table. The SQL matches the shared catalog contract and creates no database roles. A hosted database already migrated by Scrapy under a different checksum must fail closed.

**Acceptance criteria:**
- [x] The runner records SHA-256 checksums and applies pending versions inside the advisory transaction lock
- [x] `npm run db:migrate` reads `DATABASE_URL` from the environment, or from a root `.env` when that file exists
- [x] Drift and a missing rollback are refused
- [x] Integration tests use only a local database whose name starts with `supermarket_api_test`

**Verification:**
- [x] Tests pass: `npm test`
- [x] Build succeeds: `npm run build`
- [x] Manual check: integration test migrates a local `supermarket_api_test` database and records version `001`

**Dependencies:** Task 2

**Files likely touched:**
- `db/migrations/001_catalog.sql`
- `db/rollback/001_catalog.sql`
- `src/db/migrate.ts`
- `test/integration/migrate.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 8: Read pool and exact SKU lookup

**Description:** Open a small read pool and return exact `item_code` matches across chains with score 10000. Leading zeros are significant. There is no name fallback.

**Acceptance criteria:**
- [x] Equality is indexed `item_code` comparison, parameterized
- [x] A code that exists in two chains returns two rows and does not merge them
- [x] Statement timeout is 15 seconds
- [x] The pool uses `DATABASE_URL` and does not open a second role-specific connection

**Verification:**
- [x] Tests pass: `npm run test:integration`
- [x] Build succeeds: `npm run build`
- [x] Manual check: a leading-zero code does not match the same digits without those zeros

**Dependencies:** Tasks 6 and 7

**Files likely touched:**
- `src/db/pool.ts`
- `src/db/products.ts`
- `test/integration/sku.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 9: Readiness check

**Description:** Add `GET /health/ready`, which runs a short database check and returns 503 when the database is unavailable. It does not require every chain to have products.

**Acceptance criteria:**
- [x] Ready response contains no secrets or catalog samples
- [x] A failed check is 503 with `Retry-After`
- [x] Liveness still succeeds when the database is down

**Verification:**
- [x] Tests pass: `npm test`
- [x] Build succeeds: `npm run build`
- [x] Manual check: inject test with a failing check function returns 503

**Dependencies:** Task 8

**Files likely touched:**
- `src/routes/health.ts`
- `test/unit/ready.test.ts`

**Estimated scope:** Small: 1-2 files

## Checkpoint: After Tasks 7-9
- [x] Local integration migration and SKU lookup pass
- [x] Hosted database was not used

## Task 10: Recall-safe name retrieval and per-chain top-N

**Description:** Retrieve name-search candidates by token overlap, exact normalized name, and exact item code. Score every candidate in chunks inside one snapshot, then keep the top N per chain above the threshold.

**Acceptance criteria:**
- [x] SQL has no limit applied before scoring
- [x] Manufacturer-only overlap is not a candidate path
- [x] Ordering is score descending, chain id ascending, item code ascending
- [x] An exhaustive scorer over a fixture catalog returns the same ids as the chunked path
- [x] Timeout returns an error and not a shortened 200 body

**Verification:**
- [x] Tests pass: `npm run test:integration`
- [x] Build succeeds: `npm run build`
- [x] Manual check: a catalog where the best match would fall outside a naive SQL limit still wins

**Dependencies:** Tasks 5 and 8

**Files likely touched:**
- `src/search/rank.ts`
- `src/db/candidates.ts`
- `test/integration/name-search.test.ts`
- `contracts/fixtures/catalog-search.json`

**Estimated scope:** Medium: 3-5 files

## Task 11: Single and batch search routes

**Description:** Add `GET /v1/search` and `POST /v1/search/batch` with schema validation, the shared per-chain limit, and one read snapshot for the whole batch.

**Acceptance criteria:**
- [x] `queryType` is required and is not inferred from the text. `q` is 1–200 trimmed characters
- [x] `limitPerChain` defaults to 1, allows 1..10, and rejects anything else with 400
- [x] Batch accepts 1..10 entries, unique ids up to 64 characters, preserves order, and rejects the entire body when one entry is invalid
- [x] Zero matches is `200` and an array. A database error fails the whole request

**Verification:**
- [x] Tests pass: `npm test`
- [x] Build succeeds: `npm run build`
- [x] Manual check: contract tests cover empty results, duplicate ids, and limit boundaries

**Dependencies:** Tasks 4 and 10

**Files likely touched:**
- `src/routes/search.ts`
- `src/search/service.ts`
- `test/contract/search.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 12: Process-wide rate limits

**Description:** Limit search to 60 requests per minute and refresh triggers to 5 per minute for the process. This version has no HTTP credentials, so there is no 401, 403, or per-key bucket.

**Acceptance criteria:**
- [x] Search routes do not require a bearer token
- [x] Exceeding the search or refresh limit returns 429 and `Retry-After`
- [x] Secrets do not appear in URLs or logs

**Verification:**
- [x] Tests pass: `npm test`
- [x] Build succeeds: `npm run build`
- [x] Manual check: a burst past the limit returns 429 without reading an API key

**Dependencies:** Task 4

**Files likely touched:**
- `src/http/rate-limit.ts`
- `test/contract/rate-limit.test.ts`

**Estimated scope:** Small: 1-2 files

## Checkpoint: After Tasks 10-12
- [x] Search contract tests pass
- [x] Exhaustive and chunked name search agree on the fixture catalog

## Task 13: Atomic refresh admission

**Description:** `POST /v1/refreshes` creates one manual run and reserves every requested chain in a single transaction. Any overlap rejects the whole request.

**Acceptance criteria:**
- [x] Omitted `chains` means all ten ids. An empty array or unknown id is 400. Duplicates are deduped
- [x] Conflict returns 409 and the active run ids, with no new leases
- [x] Disjoint chain sets can both be admitted
- [x] The run row exists as `PENDING` before any GitHub call

**Verification:**
- [x] Tests pass: `npm run test:integration`
- [x] Build succeeds: `npm run build`
- [x] Manual check: two concurrent overlapping requests produce one 202 and one 409

**Dependencies:** Tasks 7 and 12

**Files likely touched:**
- `src/refresh/admit.ts`
- `src/routes/refreshes.ts`
- `test/integration/admit.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 14: GitHub dispatch and uncertainty

**Description:** After admission, dispatch the configured workflow with the run id only. Keep the reservation when the outcome is unknown. Release it when GitHub definitely rejects the dispatch.

**Acceptance criteria:**
- [x] 202 body contains `runId`, `status: "PENDING"`, and `statusUrl`
- [x] Timeout or a network failure stores dispatch state `UNCERTAIN` and still returns 202
- [x] HTTP rejection from GitHub marks the run failed, releases leases, and returns 503
- [x] Tests mock GitHub. No test calls the real GitHub API

**Verification:**
- [x] Tests pass: `npm run test:integration`
- [x] Build succeeds: `npm run build`
- [x] Manual check: mocked timeout and mocked 422 cover both outcomes

**Dependencies:** Task 13

**Files likely touched:**
- `src/refresh/dispatch.ts`
- `test/integration/dispatch.test.ts`

**Estimated scope:** Small: 1-2 files

## Task 15: Admin run and chain status

**Description:** Add run status and chain status. Sanitize operational errors. Unknown runs are 404. There is no separate admin credential.

**Acceptance criteria:**
- [x] Run status includes origin, status, dispatch state, times, requested chains, per-chain counts, and the GitHub execution id when known
- [x] Chain status includes product count, publication time, source watermark, stale flag, latest outcome, and active run id
- [x] A never-published chain has null timestamps and product count 0
- [x] Error text cannot contain credential material, signed URLs, or raw source payloads

**Verification:**
- [x] Tests pass: `npm run test:integration`
- [x] Build succeeds: `npm run build`
- [x] Manual check: a planted error string with a bearer token is stored and returned redacted

**Dependencies:** Task 13

**Files likely touched:**
- `src/routes/status.ts`
- `src/refresh/status.ts`
- `test/contract/status.test.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 13-15
- [x] Admission, dispatch uncertainty, and status tests pass
- [x] Search and refresh stay reachable without a bearer token

## Task 16: Request metrics, OpenAPI, and Render/deploy notes

**Description:** Record the operational fields the spec asks for, generate OpenAPI from the route schemas, and document the Render web service without deploying it.

**Acceptance criteria:**
- [x] Search logs include query type, result count, database time, and candidates scored
- [x] OpenAPI lists the v1 routes, error model, and auth distinction
- [x] README documents every root command, the environment table, and the field mapping
- [x] A Render blueprint or documented service settings pin Node 24, `npm ci`, health path `/health/live`, and host `0.0.0.0`
- [x] No deploy is performed and no Neuton client URL is changed

**Verification:**
- [x] Tests pass: `npm test`
- [x] Build succeeds: `npm run build`
- [x] Manual check: OpenAPI JSON includes `/v1/search` and `/v1/refreshes`

**Dependencies:** Tasks 11, 12, and 15

**Files likely touched:**
- `src/openapi.ts`
- `test/contract/openapi.test.ts`
- `render.yaml`
- `README.md`

**Estimated scope:** Medium: 3-5 files

## Checkpoint: Complete
- [x] All acceptance criteria met
- [x] Typecheck, lint, unit tests, and local integration tests pass
- [x] Warm single-search and batch timings are measured and written down, or the budget miss is reported
- [ ] Ready for human review
