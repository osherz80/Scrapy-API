# Specification: supermarket search and control API

Status: implementation-ready design for review; documentation only. Date: 2026-10-30.
Companion: [Ingestion specification](SPEC-supermarket-scraper.md). Read both. That document owns shared schema, catalog publication, leases, and ingestion; this document owns HTTP behavior, search, security, and consumer compatibility. Together these two files are the implementation handoff and plan. Search response mapping is superseded by [SPEC-raw-row-search.md](SPEC-raw-row-search.md) (2026-11-01): search returns scored raw camelCase `public.products` rows, not `ProductResult`.

## 1. Objective, users, and scope

Give Neuton's backend trustworthy sampled retail price estimates for ingredient/recipe costing and product enrichment. Neuton is the only launch client. The service is independently deployed, not embedded in the existing application. This version has no HTTP API keys and no separate database roles. Public customer accounts, billing, and MCP are out of scope.

Serve ten chains: shufersal, carrefour, rami-levy, yochananof, osher-ad, victory, mahsanei-hashuk, hatzi-hinam, tiv-taam, keshet-teamim. Each daily ingestion randomly samples three branches anew, with bounded replacement attempts, and persists only a per-product/per-chain mean and metadata. A product may have only one contributing branch. The API must describe these as estimates, not guaranteed chain prices or stock availability.

Required capabilities: single name or exact-code search, batch search capped at ten, one qualifying result per chain by default and up to ten, refresh dispatch and status, and stale-data visibility on returned products. No search filters beyond query type/text and per-chain limit. No per-chain coverage summary in search responses. No matches returns arrays, never strings or null.

## 2. Architecture and technologies

```
Neuton --HTTPS--> Fastify/TypeScript API on Render
                                    | reads catalogs / controls runs
                              Supabase PostgreSQL
                                    ^ writes averaged catalogs
                          Python job in GitHub Actions
```

Node.js 24 LTS baseline, TypeScript strict mode, Fastify 5, `pg` connection pool, JSON Schema validation, the layered logger in section 7, Node test runner, Fastify inject, and real PostgreSQL integration tests. Verify supported releases and lock exact versions at bootstrap; do not use unpinned latest production images. Use parameterized SQL and SQL migrations shared with ingestion. Small explicit SQL repository functions are sufficient; no Redis or ORM is required.

The API is a standalone service: its own repository and its own Render web service, not a module inside Neuton-Back and not a Cloudflare Worker. Ingestion lives in that same future repository as a separate deployable, and they share schema and contract fixtures. Render hosts only the API. It does not execute collection in an HTTP handler or depend on an in-process daily scheduler. Accept free-host cold starts initially. Supabase is the PostgreSQL host, not a browser-accessible database API for clients.

## 3. Existing code reuse and compatibility

Authoritative reference at design time: `C:/Users/Osherz/Desktop/Neuton/Neuton-Back/src/lib/supermarket/prices.ts`, specifically normalizeQuery, tokenize, scoreMatch, SEARCH_MIN_SCORE, PriceResult, FoundItem, and PRICE_ITEM_FIELDS. Inspect downstream conversion code in the same directory before defining the response adapter. The original function is TypeScript; extract matching into a pure module rather than porting it to Python or substituting SQL similarity ranking.

Observed baseline: exact barcode score 10000; exact name score 9500; token overlap, substring/prefix bonuses, manufacturer overlap, length penalty; acceptance is strictly score > 2500. Preserve the actual source behavior with golden fixtures including Math.round and Hebrew punctuation. If the source has changed, record and test the version being adopted. Do not mutate the original Neuton code during service construction.

Name searches use existing scoring. SKU searches are exact string equality only, no name fallback or leading-zero removal. Internal codes remain scoped to chain in output; a cross-chain exact-code query may legitimately return unrelated products sharing an internal code. Do not treat their averages as a single global product.

Search responses are owned by `SPEC-raw-row-search.md` since 2026-11-01. `GET /v1/search` and `POST /v1/search/batch` return each scored product as a flat object: the full `public.products` row converted to camelCase, minus the internal columns `runId`, `updatedAt`, `nameTokens`, and `normalizedName`, plus `score`. There is no legacy `ProductResult` envelope. `ItemCode`, `ItemName`, and `ItemPrice` no longer exist; the raw columns arrive as `itemCode`, `itemName`, and `itemPrice`. The consumer owns semantic mapping and unit conversion.

Values are database-native: `text` stays text, `numeric` arrives as a string from `pg`, `integer` as a number, `timestamptz` as an ISO string. The API does not format money or derive comparison fields; `unitOfMeasure` and `unitOfMeasurePrice` are stored XML values, not computed ones. `subchainId` and `storeId` are returned because they are part of the row.

The old forwarding mapping, `isStale`, `currency`, and the Neuton `normalizeProductPrice` compatibility tests were removed with `src/search/product-result.ts`. Column discovery is `SELECT *` plus one denylist, so a new non-internal scraper column appears without an API change. Timestamp meaning stays exactly as stored; the API does not conflate price-change time with publication time.

## 4. HTTP contract

All endpoints use HTTPS, `/v1` prefix except minimal health endpoints, JSON, camelCase property names (search rows use the camelCase form of raw column names), and UTC ISO 8601 timestamps. Unknown fields and invalid types are rejected. Set body limit 64 KiB. Query strings are trimmed, 1–200 characters; SKU remains a string. Error codes are stable uppercase identifiers.

### Single search

`GET /v1/search?queryType=name&q=milk&limitPerChain=1`

- queryType required: name or sku. q required nonblank string. No automatic numeric detection.
- limitPerChain optional integer 1..10, default 1. Invalid input is 400, not silently clamped.
- Search every configured chain with available data; no client chain/brand/package filters.
- 200 body: `SearchResult[]` (`{ score, ...row }`); zero qualifying matches returns `[]`.
- Select top N within each chain; flatten results ordered score descending, then chain ID and item code ascending for stable ties. Maximum 100 results. Scores are not price ranking.

### Batch search

`POST /v1/search/batch?limitPerChain=1`
```json
{
  "queries": [
    {"id": "ingredient-1", "queryType": "name", "q": "milk"},
    {"id": "ingredient-2", "queryType": "sku", "q": "7290000000000"}
  ]
}
```
```json
{
  "results": [
    {"id": "ingredient-1", "items": []},
    {"id": "ingredient-2", "items": []}
  ]
}
```

1..10 query entries, unique nonempty IDs up to 64 characters. Preserve input order and IDs. Limit is request-wide, same validation as single search. Duplicate query texts are allowed and may share computation. Validate the entire batch before work; invalid entry rejects request with 400 and field path. A backend failure returns an error for the request, never false empty matches. Use bounded database concurrency, initially 2, and one consistent PostgreSQL read snapshot for the whole batch. No background batch jobs or batch polling in v1.

### Refresh trigger

`POST /v1/refreshes`
```json
{}
```
Means all ten configured chains. Optional selection:
```json
{"chains": ["shufersal", "rami-levy", "victory"]}
```

Omitted chains selects all; empty array or unknown ID returns 400; duplicate IDs deduplicate. Reserve requested chain set atomically. Any overlap returns 409 for the entire request with active run IDs; do not dispatch a partial subset. Disjoint sets may run independently.

202 example:
```json
{"runId": "00000000-0000-4000-8000-000000000001", "status": "PENDING", "statusUrl": "/v1/refreshes/00000000-0000-4000-8000-000000000001"}
```

Create the run before GitHub dispatch, dispatch its runId, and return promptly after acknowledgement. Request retries cannot bypass active-chain exclusion. A timeout whose dispatch outcome is unknown keeps its reservation and returns 202 with dispatch state visible in admin status. Definitive dispatch rejection returns 503 after marking the run failed and releasing reservations. Follow the companion's leases, fencing, and expiration rules; process-local locks are insufficient on Render restarts.

### Operational status

- `GET /v1/refreshes/:runId`: Run ID, origin, overall status, dispatchState, start/finish times, requested chains, per-chain status/attempts/successfulBranchCount/productCount/error code, GitHub execution ID when known. Unknown run returns 404.
- `GET /v1/chains`: Configured ID/name, current product count, last publication time, source watermark, isStale, latest attempt outcome, active run ID if any. A never-published chain has null timestamps and zero count.
- `GET /health/live`: unauthenticated minimal process liveness, no secrets or catalog details.
- `GET /health/ready`: minimal readiness with short DB check; 503 if unavailable. Do not require every chain to have data.

Status records may contain operational errors sanitized of credentials, signed URLs, and raw source content. No search response coverage summary is added.

### Errors

```json
{"error": {"code": "VALIDATION_ERROR", "message": "limitPerChain must be between 1 and 10", "details": [{"path": "limitPerChain"}]}, "requestId": "opaque-id"}
```
400 invalid request; 404 unknown run; 409 active refresh conflict; 429 rate limit; 503 DB/dispatch unavailable; 500 unexpected failure. No stack traces. Include Retry-After where meaningful. Empty matches are 200 `[]`, not 404. There is no credential check, so this version does not return 401 or 403.

## 5. Search implementation and candidate correctness

`name_tokens` is produced by the scraper with the same normalization rules as the TypeScript scorer. The API reads it and never writes it. Parity fixtures stay in `contracts/fixtures/normalization.json`; porting normalization requires those fixtures.

SKU: indexed equality on item_code across chains. Return score 10000 for exact matches.

Name: retrieve the union of candidates with an exact `item_code`, an exact normalized `item_name` (`lower(btrim(item_name)) = $2`), or at least one shared `name_tokens` token. `normalized_name` no longer exists, so the exact-name path is a SQL expression, not a stored column. Manufacturer-only candidates need not be included because the baseline scorer exits at zero name-token overlap. Validate this reasoning against the extracted source version.

Do not impose an arbitrary SQL LIMIT before TypeScript scoring: it can discard the actual best match. Process broad candidate sets in chunks within a consistent snapshot, maintain bounded per-chain top-N heaps, and score every eligible candidate. Optional trigram candidate acceleration is permitted only if proven to preserve golden/exhaustive baseline recall. Do not replace token matching with a generic full-text language stemmer.

After scoring, enforce strict threshold and per-chain limit, then deterministic ordering. Test the optimized path against exhaustive scoring of fixture catalogs over Hebrew text, punctuation, numbers, short words, manufacturer terms, and missing terms. No silently weaker matching to fit a latency budget.

Initial engineering targets, to validate on actual free infrastructure: warm single-search p95 <=2 seconds and ten-query batch <=10 seconds on a representative seeded catalog. Exclude cold start from warm latency metrics and report it separately. Query DB timeout 15 seconds, endpoint processing budget 30 seconds initially. Fail explicitly on timeout; do not return a falsely complete truncated result set. If benchmarks fail, report measurements and optimize indexing/processing before changing business semantics.

## 6. Operational safety

No HTTP API keys in this version. Search, refresh, and status routes are not gated by a bearer credential. Disable browser CORS by default; Neuton calls server-to-server. Never put secrets in URLs.

Use one `DATABASE_URL` for catalog reads and refresh control. Do not create separate search, control, or ingestion database roles. Do not expose that URL to clients. Use a small pool compatible with Supabase's connection allowance, and validate transaction behavior and SSL verification. Parameterize all queries, bound inputs, sanitize logs. Rate limits are configurable initial defaults: 60 search requests/minute and 5 refresh triggers/minute for the process; batch body cap remains ten. These are guardrails, not paid quotas, and must be load-tested with Neuton.

HTTP handlers call transport-independent search and refresh services. Public customer keys, quota accounting, payment authorization, and MCP are out of scope. Do not add 401/403 credential checks, fake 402 responses, wallet handling, payment code, or a dormant MCP server.

## 7. Deployment and observability

Render free web service with a pinned Node runtime or container. Build/install from lockfile; bind to platform PORT and 0.0.0.0. Stateless process; Supabase is authoritative. Accept cold starts and restarts. GitHub Actions hosts ingestion because native Render cron has a minimum charge. No refresh work continues as a fire-and-forget HTTP process task.

Configuration: DATABASE_URL, GITHUB_REPOSITORY, GITHUB_WORKFLOW_ID, GITHUB_REF, GITHUB_TOKEN, PORT, LOG_LEVEL, LOG_ENV, APP_VERSION, STALE_AFTER_HOURS=48, timeouts/rate limits. `DATABASE_URL` is required to boot. The four GitHub values are required only to dispatch a refresh. There is no `SEARCH_API_KEY` or `ADMIN_API_KEY`. Use deployment secrets; provide .env.example with placeholders only.

### Logging

Same three layers as Neuton-Back, so the provider can be replaced without touching handlers.

1. Call sites depend only on a `Logger`: `debug`, `info`, `warn`, `error`, `fatal`, plus `child(context)`. Accepted call shapes are message-then-meta, meta-then-message, and Error-then-meta. Handlers, repositories, and services do not call `console` or a vendor SDK.
2. The facade filters by `LOG_LEVEL`, merges child context, and stamps `service: "api"`, `environment`, and `version` on every record. It redacts authorization headers, cookies, passwords, and tokens before the record reaches a transport. Raw query text stays off by default. An Error becomes a field with name and message, not a credential-bearing stack. Production minimum level is `info`; development is `debug`.
3. A transport implements `write(level, message, meta)` and an optional `flush`. The factory is the only place that chooses an implementation. The process flushes every transport once on shutdown.

The first deployed transport writes one JSON line to `console.debug`, `console.info`, `console.warn`, or `console.error` (`fatal` uses `console.error`). That is the whole provider. Render shows those lines in the service log stream; they are not stored in a queryable system and they are not a substitute for Grafana or PostHog. Tests use an in-memory transport so they can assert fields. The console transport's `flush` is a no-op.

A later provider is a new transport plus a factory choice. It must accept the same record and the same redaction. Do not import that SDK from a route. If the future transport batches, flush it during the same shutdown path Neuton-Back uses.

Every request log includes `requestId`, endpoint, duration, status, query type, and result count. Refresh logs include `runId` and chain outcomes. Also measure database time, candidates scored, API latency, ingestion age/failure counts, pool saturation, and storage size. Run/status endpoints are operational visibility; no dashboard is required. Retain source timestamps even when a runner downloads an older file successfully.

## 8. Project structure, commands, and code style

```
src/{app,server,config}.ts
src/{routes,search,refresh,db,contracts,logger}/
src/db/rows.ts                 database row -> camelCase keys
src/search/row-result.ts       denylist + { ...row, score }
src/logger/transports/{console,memory}.ts
test/{unit,integration,contract}/
test/fixtures/scraper-schema/  read-only copy of scraper migrations 001-005
package.json
contracts/fixtures/
```

Required commands, from repository root (no migration command; the API owns no schema):
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

ES modules, strict TypeScript, camelCase fields (search rows use the camelCase form of raw column names), typed repository boundaries, no any-based transport contracts. Export app construction separately from server listening for inject tests. Example style:
```typescript
type QueryType = 'name' | 'sku';
interface SearchQuery { queryType: QueryType; q: string }
async function searchProducts(
  query: SearchQuery,
  limitPerChain: number,
  repository: ProductRepository,
): Promise<SearchResult[]> {
  const candidates = repository.iterateCandidates(query);
  return rankCandidates(candidates, query, limitPerChain);
}
```

The snippet communicates boundaries, not an instruction to collect the full database into memory. Document all scripts, configuration, field mappings, and OpenAPI examples in the future repository. Generate OpenAPI from the same route schemas where possible.

## 9. Testing and success criteria

Unit tests: unchanged scorer golden outputs, strict threshold, token normalization, exact SKU semantics, stable sorting, top-N per chain, camelCase key conversion, the raw-row denylist, and input validation. Fixtures must include Hebrew names; unit conversion is no longer an API concern.

Contract tests: default one/result-per-chain, limit 1..10, batch 1..10, duplicate IDs rejected, empty successful results as arrays, all/selected refresh bodies, zero matches vs DB failure, error shapes, and sanitized status.

Real PostgreSQL tests: candidate results equal exhaustive baseline, stable read snapshot while importer replaces catalogs, concurrent refresh conflicts, all-or-nothing lease acquisition, duplicate workflow delivery, dispatch uncertainty and expiry, fencing against late workers. Mock GitHub HTTP boundaries; one opt-in deployment smoke validates actual dispatch without coupling ordinary tests to external portals.

End-to-end: daily or manual run publishes rows into `public.products`; the API returns the stored row fields unchanged plus `score`; absent products disappear; zero-success chain retains old products; all queries retain original scoring. Load test representative catalog and worst allowed batch, record storage including indexes and staging headroom under Supabase free limits. Do not claim production readiness solely from mocked tests.

## 10. Implementation plan

1. Bootstrap the standalone API workspace, runtime/configuration validation, logger facade with console and in-memory transports, test harness, and route schemas. Establish shared IDs/contract fixtures with ingestion. Verify build/typecheck/test scripts.
2. Extract the existing scorer and normalization into pure modules with golden tests; define the raw scored-row contract with a single internal-column denylist. Gate: representative original and extracted scores are identical.
3. Read the scraper-owned `public.products` schema; implement pooled access and exact SKU lookup. Gate: real PostgreSQL integration against the scraper's migrations passes.
4. Implement recall-preserving name candidate retrieval, chunked scoring, stable top-N, and freshness. Gate: compare against exhaustive baseline over fixture catalogs; no arbitrary pre-scoring truncation.
5. Add single/batch routes, validation, error shapes, and limits. Gate: contract tests for ten-query cap and all empty-result behavior pass.
6. Implement manual refresh controller, atomic admission, dispatch correlation, uncertainty recovery, and protected status. Reuse companion lease protocol. Gate: concurrency, timeout, and late-worker tests pass.
7. Add observability, health checks, OpenAPI, Render configuration, and secret setup documentation. Gate: deployment smoke and warm/cold performance measurements.
8. Integrate both services in a controlled environment and measure free-tier resource fit. Document Neuton client migration separately: new endpoint, batch chunk size ten, explicit queryType, cold-start timeout/retries, and response adapter. Existing Neuton production integration requires its own authorized change.

## 11. Boundaries and remaining gates

Always preserve scoring/threshold semantics, use canonical shared chain IDs, keep source age honest, and use database fencing for refresh publication. Implementation authorization will include necessary code/dependency/CI/schema work for this new service; do not ask again for each routine implementation detail.

Ask before costs, changing search/averaging semantics, adding public customers or payment features, increasing source scope, or modifying Neuton production. Never expose service credentials, suppress failing checks, silently omit qualifying candidates for speed, report DB outages as no matches, persist original source files, or claim hosted reachability without tests.

Remaining validation gates rather than new business questions: scraper selection/reachability, actual database capacity, query/normalization parity, cold-start behavior, dispatch permissions, and deployment account values. Engineering defaults (48-hour stale threshold, timeouts, rate limits, runtime versions, console logging) are explicit and configurable. If a default cannot satisfy the agreed behavior, report evidence and propose a revision.

References: [Fastify](https://fastify.dev/docs/latest/), [Render free hosting](https://render.com/docs/free), [Render cron pricing](https://render.com/docs/cronjobs), [Supabase limits](https://supabase.com/pricing), [GitHub workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows). Validate current versions and quotas during implementation; prior storage estimates are not guarantees.
