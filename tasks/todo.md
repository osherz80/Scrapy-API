# Supermarket API tasks

Plan: `tasks/plan.md`. Spec: `SPEC-supermarket-api.md`.

Definition of done for every task: acceptance criteria below, plus tests that fail without the change, `npm run typecheck --prefix services/api`, `npm run lint --prefix services/api`, and `npm test --prefix services/api`.

## Task 1: API workspace and command scripts

**Description:** Create the `services/api` TypeScript package with pinned Fastify 5 and Node 24 toolchains, ESM source, and the root commands the spec requires for typecheck, lint, unit test, and build. No route behavior beyond what later tasks add.

**Acceptance criteria:**
- [x] `services/api/package.json` is `"type": "module"`, engines require Node 24, and dependencies are exact-pinned in the lockfile
- [x] `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` work with `--prefix services/api`
- [x] `.env.example` contains placeholders only

**Verification:**
- [x] Tests pass: `npm test --prefix services/api`
- [x] Build succeeds: `npm run build --prefix services/api`
- [x] Manual check: `dist/server.js` is emitted and imports use `.js` extensions

**Dependencies:** None

**Files likely touched:**
- `services/api/package.json`
- `services/api/tsconfig.json`
- `services/api/tsconfig.build.json`
- `services/api/eslint.config.js`
- `services/api/.env.example`
- `README.md`

**Estimated scope:** Medium: 3-5 files

## Task 2: Environment configuration validation

**Description:** Load the spec's runtime settings from a caller-supplied environment object. Reject missing or malformed values without reading files and without including secret values in the error.

**Acceptance criteria:**
- [x] Required names are `DATABASE_READ_URL`, `DATABASE_CONTROL_URL`, `SEARCH_API_KEY`, `ADMIN_API_KEY`, `GITHUB_REPOSITORY`, `GITHUB_WORKFLOW_ID`, `GITHUB_REF`, and `GITHUB_TOKEN`
- [x] Defaults match the spec: stale window 48 hours, search limit 60/minute, refresh limit 5/minute, query timeout 15s, request budget 30s, batch DB concurrency 2
- [x] Non-local database URLs must not set `sslmode=disable`. The two API keys must differ and be at least 32 characters
- [x] Production log environment cannot stay below `info`

**Verification:**
- [x] Tests pass: `npm test --prefix services/api`
- [x] Build succeeds: `npm run build --prefix services/api`
- [x] Manual check: a unit test passes `{}` and asserts the missing names, not any secret

**Dependencies:** Task 1

**Files likely touched:**
- `services/api/src/config.ts`
- `services/api/test/unit/config.test.ts`

**Estimated scope:** Small: 1-2 files

## Task 3: Logger facade and transports

**Description:** Add the three-layer logger: call-site methods, a filtering/redacting facade, a console JSON transport, and an in-memory transport. Handlers must not call `console` directly.

**Acceptance criteria:**
- [x] `debug`, `info`, `warn`, `error`, and `fatal` accept message-then-meta, meta-then-message, and Error-then-meta
- [x] Records always include `service: "api"`, `environment`, and `version`
- [x] Authorization, cookies, passwords, and tokens are redacted before the transport. Error records contain name and message only
- [x] Keys `q` and `query` are removed. `fatal` writes with `console.error`. `flush` on the console transport is a no-op and factory shutdown is idempotent

**Verification:**
- [x] Tests pass: `npm test --prefix services/api`
- [x] Build succeeds: `npm run build --prefix services/api`
- [x] Manual check: memory-transport tests assert redaction and level filtering

**Dependencies:** Task 1

**Files likely touched:**
- `services/api/src/logger/types.ts`
- `services/api/src/logger/redact.ts`
- `services/api/src/logger/logger.ts`
- `services/api/src/logger/factory.ts`
- `services/api/src/logger/transports/console.ts`
- `services/api/src/logger/transports/memory.ts`
- `services/api/test/unit/logger.test.ts`

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
- [x] Tests pass: `npm test --prefix services/api`
- [x] Build succeeds: `npm run build --prefix services/api`
- [x] Manual check: inject tests cover liveness, 404, malformed JSON, and the 64 KiB limit

**Dependencies:** Tasks 2 and 3

**Files likely touched:**
- `services/api/src/app.ts`
- `services/api/src/server.ts`
- `services/api/src/http/errors.ts`
- `services/api/test/unit/health.test.ts`

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
- [x] Tests pass: `npm test --prefix services/api`
- [x] Build succeeds: `npm run build --prefix services/api`
- [x] Manual check: one golden expected value is recomputed from the written formula, not copied from the function output blindly

**Dependencies:** Task 1

**Files likely touched:**
- `services/api/src/search/score.ts`
- `services/api/test/unit/score.test.ts`
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
- [x] Tests pass: `npm test --prefix services/api`
- [x] Build succeeds: `npm run build --prefix services/api`
- [x] Manual check: stale boundary tests at exactly 48 hours and one millisecond past it

**Dependencies:** Task 5

**Files likely touched:**
- `services/api/src/search/product-result.ts`
- `services/api/src/contracts/chains.ts`
- `services/api/test/unit/product-result.test.ts`
- `services/api/test/fixtures/neuton-units.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 5-6
- [x] Scorer and adapter tests pass
- [x] No Neuton-Back files were modified

## Task 7: Vendored migration runner

**Description:** Vendor the ingestor's `001_ingestion.sql` and rollback without edits, and apply them with the existing checksum history table so this repo and Scrapy cannot silently diverge.

**Acceptance criteria:**
- [ ] Forward and rollback bytes match the Scrapy files, and the runner records SHA-256 checksums
- [ ] `npm run db:migrate --prefix services/api` applies pending versions inside the advisory transaction lock
- [ ] Drift, missing rollback, and a non-local URL are refused
- [ ] The command reads `DATABASE_CONTROL_URL` from the environment and never a dotenv file

**Verification:**
- [ ] Tests pass: `npm test --prefix services/api`
- [ ] Build succeeds: `npm run build --prefix services/api`
- [ ] Manual check: integration test migrates a local `supermarket_api_test` database and records version `001`

**Dependencies:** Task 2

**Files likely touched:**
- `db/migrations/001_ingestion.sql`
- `db/rollback/001_ingestion.sql`
- `services/api/src/db/migrate.ts`
- `services/api/test/integration/migrate.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 8: Read pool and exact SKU lookup

**Description:** Open a small read pool and return exact `item_code` matches across chains with score 10000. Leading zeros are significant. There is no name fallback.

**Acceptance criteria:**
- [ ] Equality is indexed `item_code` comparison, parameterized
- [ ] A code that exists in two chains returns two rows and does not merge them
- [ ] Statement timeout is 15 seconds
- [ ] The search role is not given a connection that can insert products

**Verification:**
- [ ] Tests pass: `npm run test:integration --prefix services/api`
- [ ] Build succeeds: `npm run build --prefix services/api`
- [ ] Manual check: a leading-zero code does not match the same digits without those zeros

**Dependencies:** Tasks 6 and 7

**Files likely touched:**
- `services/api/src/db/pool.ts`
- `services/api/src/db/products.ts`
- `services/api/test/integration/sku.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 9: Readiness check

**Description:** Add `GET /health/ready`, which runs a short database check and returns 503 when the database is unavailable. It does not require every chain to have products.

**Acceptance criteria:**
- [ ] Ready response contains no secrets or catalog samples
- [ ] A failed check is 503 with `Retry-After`
- [ ] Liveness still succeeds when the database is down

**Verification:**
- [ ] Tests pass: `npm test --prefix services/api`
- [ ] Build succeeds: `npm run build --prefix services/api`
- [ ] Manual check: inject test with a failing check function returns 503

**Dependencies:** Task 8

**Files likely touched:**
- `services/api/src/routes/health.ts`
- `services/api/test/unit/ready.test.ts`

**Estimated scope:** Small: 1-2 files

## Checkpoint: After Tasks 7-9
- [ ] Local integration migration and SKU lookup pass
- [ ] Hosted database was not used

## Task 10: Recall-safe name retrieval and per-chain top-N

**Description:** Retrieve name-search candidates by token overlap, exact normalized name, and exact item code. Score every candidate in chunks inside one snapshot, then keep the top N per chain above the threshold.

**Acceptance criteria:**
- [ ] SQL has no limit applied before scoring
- [ ] Manufacturer-only overlap is not a candidate path
- [ ] Ordering is score descending, chain id ascending, item code ascending
- [ ] An exhaustive scorer over a fixture catalog returns the same ids as the chunked path
- [ ] Timeout returns an error and not a shortened 200 body

**Verification:**
- [ ] Tests pass: `npm run test:integration --prefix services/api`
- [ ] Build succeeds: `npm run build --prefix services/api`
- [ ] Manual check: a catalog where the best match would fall outside a naive SQL limit still wins

**Dependencies:** Tasks 5 and 8

**Files likely touched:**
- `services/api/src/search/rank.ts`
- `services/api/src/db/candidates.ts`
- `services/api/test/integration/name-search.test.ts`
- `contracts/fixtures/catalog-search.json`

**Estimated scope:** Medium: 3-5 files

## Task 11: Single and batch search routes

**Description:** Add `GET /v1/search` and `POST /v1/search/batch` with schema validation, the shared per-chain limit, and one read snapshot for the whole batch.

**Acceptance criteria:**
- [ ] `queryType` is required and is not inferred from the text. `q` is 1–200 trimmed characters
- [ ] `limitPerChain` defaults to 1, allows 1..10, and rejects anything else with 400
- [ ] Batch accepts 1..10 entries, unique ids up to 64 characters, preserves order, and rejects the entire body when one entry is invalid
- [ ] Zero matches is `200` and an array. A database error fails the whole request

**Verification:**
- [ ] Tests pass: `npm test --prefix services/api`
- [ ] Build succeeds: `npm run build --prefix services/api`
- [ ] Manual check: contract tests cover empty results, duplicate ids, and limit boundaries

**Dependencies:** Tasks 4 and 10

**Files likely touched:**
- `services/api/src/routes/search.ts`
- `services/api/src/search/service.ts`
- `services/api/test/contract/search.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 12: Credentials, scopes, and rate limits

**Description:** Require separate search and admin bearer tokens, compare them in constant time, and attach a principal. Enforce the initial per-credential rate limits.

**Acceptance criteria:**
- [ ] Missing or unknown credentials return 401. A valid search credential on an admin route returns 403
- [ ] Search routes accept only the search scope. Admin routes accept only the admin scope
- [ ] Search is limited to 60 requests per minute and refresh triggers to 5 per minute, with 429 and `Retry-After`
- [ ] Secrets do not appear in URLs or logs

**Verification:**
- [ ] Tests pass: `npm test --prefix services/api`
- [ ] Build succeeds: `npm run build --prefix services/api`
- [ ] Manual check: swapping the two valid keys changes 200/403 as specified

**Dependencies:** Task 4

**Files likely touched:**
- `services/api/src/auth/principal.ts`
- `services/api/src/auth/rate-limit.ts`
- `services/api/test/contract/auth.test.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 10-12
- [ ] Search contract tests pass
- [ ] Exhaustive and chunked name search agree on the fixture catalog

## Task 13: Atomic refresh admission

**Description:** `POST /v1/refreshes` creates one manual run and reserves every requested chain in a single transaction. Any overlap rejects the whole request.

**Acceptance criteria:**
- [ ] Omitted `chains` means all ten ids. An empty array or unknown id is 400. Duplicates are deduped
- [ ] Conflict returns 409 and the active run ids, with no new leases
- [ ] Disjoint chain sets can both be admitted
- [ ] The run row exists as `PENDING` before any GitHub call

**Verification:**
- [ ] Tests pass: `npm run test:integration --prefix services/api`
- [ ] Build succeeds: `npm run build --prefix services/api`
- [ ] Manual check: two concurrent overlapping requests produce one 202 and one 409

**Dependencies:** Tasks 7 and 12

**Files likely touched:**
- `services/api/src/refresh/admit.ts`
- `services/api/src/routes/refreshes.ts`
- `services/api/test/integration/admit.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 14: GitHub dispatch and uncertainty

**Description:** After admission, dispatch the configured workflow with the run id only. Keep the reservation when the outcome is unknown. Release it when GitHub definitely rejects the dispatch.

**Acceptance criteria:**
- [ ] 202 body contains `runId`, `status: "PENDING"`, and `statusUrl`
- [ ] Timeout or a network failure stores dispatch state `UNCERTAIN` and still returns 202
- [ ] HTTP rejection from GitHub marks the run failed, releases leases, and returns 503
- [ ] Tests mock GitHub. No test calls the real GitHub API

**Verification:**
- [ ] Tests pass: `npm run test:integration --prefix services/api`
- [ ] Build succeeds: `npm run build --prefix services/api`
- [ ] Manual check: mocked timeout and mocked 422 cover both outcomes

**Dependencies:** Task 13

**Files likely touched:**
- `services/api/src/refresh/dispatch.ts`
- `services/api/test/integration/dispatch.test.ts`

**Estimated scope:** Small: 1-2 files

## Task 15: Admin run and chain status

**Description:** Add admin-only run status and chain status. Sanitize operational errors. Unknown runs are 404.

**Acceptance criteria:**
- [ ] Run status includes origin, status, dispatch state, times, requested chains, per-chain counts, and the GitHub execution id when known
- [ ] Chain status includes product count, publication time, source watermark, stale flag, latest outcome, and active run id
- [ ] A never-published chain has null timestamps and product count 0
- [ ] Error text cannot contain credential material, signed URLs, or raw source payloads

**Verification:**
- [ ] Tests pass: `npm run test:integration --prefix services/api`
- [ ] Build succeeds: `npm run build --prefix services/api`
- [ ] Manual check: a planted error string with a bearer token is stored and returned redacted

**Dependencies:** Task 13

**Files likely touched:**
- `services/api/src/routes/status.ts`
- `services/api/src/refresh/status.ts`
- `services/api/test/contract/status.test.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 13-15
- [ ] Admission, dispatch uncertainty, and status tests pass
- [ ] Search credentials cannot read or trigger admin routes

## Task 16: Request metrics, OpenAPI, and Render/deploy notes

**Description:** Record the operational fields the spec asks for, generate OpenAPI from the route schemas, and document the Render web service without deploying it.

**Acceptance criteria:**
- [ ] Search logs include query type, result count, database time, and candidates scored
- [ ] OpenAPI lists the v1 routes, error model, and auth distinction
- [ ] README documents every root command, the environment table, and the field mapping
- [ ] A Render blueprint or documented service settings pin Node 24, `npm ci`, health path `/health/live`, and host `0.0.0.0`
- [ ] No deploy is performed and no Neuton client URL is changed

**Verification:**
- [ ] Tests pass: `npm test --prefix services/api`
- [ ] Build succeeds: `npm run build --prefix services/api`
- [ ] Manual check: OpenAPI JSON includes `/v1/search` and `/v1/refreshes`

**Dependencies:** Tasks 11, 12, and 15

**Files likely touched:**
- `services/api/src/openapi.ts`
- `services/api/test/contract/openapi.test.ts`
- `render.yaml`
- `README.md`

**Estimated scope:** Medium: 3-5 files

## Checkpoint: Complete
- [ ] All acceptance criteria met
- [ ] Typecheck, lint, unit tests, and local integration tests pass
- [ ] Warm single-search and batch timings are measured and written down, or the budget miss is reported
- [ ] Ready for human review
