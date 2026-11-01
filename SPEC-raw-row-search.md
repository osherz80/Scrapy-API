# Spec: Raw-row search contract and read-only schema alignment

Status: draft for human approval. Revision 2 (camelCase flow). Date: 2026-11-01.
Supersedes the response-mapping parts of `SPEC-supermarket-api.md` (sections 3, 4 search bodies, 5 search implementation, 8 field style, 9 product-result tests). Everything else in that spec remains in force unless listed under "Out of scope".

## 0. Scope check

This is one capability: make search read the scraper-owned `public.products` table and return scored rows without legacy mapping. The read-only schema alignment is part of the same capability because raw-row search against the old `supermarket.products` shape cannot work.

Refresh dispatch payload/locking work is a separate capability. It is listed under "Out of scope" and should get its own spec.

## 1. Objective

Scrapy-API stops translating database rows into Neuton's legacy `PriceResult` shape. For `GET /v1/search` and `POST /v1/search/batch`, the API:

1. Retrieves candidates from the scraper-owned `public.products` table.
2. Converts `pg` rows to `camelCase` keys once, at the repository boundary.
3. Scores them with the unchanged scorer and threshold.
4. Returns each qualifying row as a flat object:

```json
{ "score": 9500, "...": "every public column except the internal denylist" }
```

The consumer owns semantic mapping (which field means what). Adding a new non-internal scraper column must not require an API code change or deploy.

Success means search works against the scraper's current schema (migrations 001–005), the whole application flow uses `camelCase` field names, and the response carries no legacy aliases or derived Neuton fields.

## 2. Confirmed decisions

| Id | Decision |
| --- | --- |
| D1 | Response result is flat `{ ...row, score }`. `score` is the only non-DB field. |
| D2 | Columns are discovered with `SELECT *`; a single denylist is stripped in code. Exposure is fail-open for future columns. |
| D3 | Internal columns are `run_id`, `updated_at`, `name_tokens`. `normalized_name` is added to the denylist defensively in case the scraper restores it later. |
| D4 | `subchain_id` and `store_id` stay in the response. |
| D5 | Both single and batch search use the raw-row shape. |
| D6 | No legacy mapping: no `ItemCode`, `ItemName`, `ItemPrice`, `UnitQty`, `Quantity`, `isStale`, `price`, `currency`, `sourceUpdatedAt`, `UnitOfMeasurePrice`-style formatting, and no derived comparison fields. |
| D7 | Values are DB-native: `text` stays text, `numeric` arrives as a string from `pg`, `integer` as a number, `timestamptz` as an ISO string in JSON. The API does not format money or quantities. |
| D8 | Exact-name recall uses option B: `lower(btrim(item_name)) = normalizeQuery(query)` in addition to `item_code` equality and `name_tokens` overlap. |
| D9 | Scrapy-API never issues DDL and never owns migrations: no schema creation, no `db:migrate`. |
| D10 | Response keys are `camelCase`, and the whole application flow (row type, scorer, ranker, result builder, routes, tests) uses `camelCase`. |
| D11 | `score` is assigned last so a future DB column named `score` cannot override it. The current schema has no such column. |
| D12 | Key renaming happens in TypeScript, not SQL. A generic `camelizeRow()` converts every returned column, so unknown future columns are renamed too and no explicit `SELECT` alias list is needed. SQL continues to reference real DB column names. |
| D13 | The API may trigger the scraper. Read-only refers to schema and catalog data, not to starting a refresh. |
| D14 | `db:migrate` is deleted entirely, along with `src/db/migrate*.ts`, `db/migrations/`, and `db/rollback/`. Tests use the vendored scraper migrations. |

## 3. Assumptions to correct before implementation

1. **"Read-only" means no schema ownership, and triggering the scraper is allowed.** The API never issues DDL and owns no migrations. `POST /v1/refreshes` survives as a trigger endpoint. Which side creates the `refresh_runs` / `refresh_run_chains` rows is decided by the refresh spec, not this one; until that lands, `src/refresh/store.ts` keeps its current DML and only changes `supermarket.` → `public.`.
2. **The target database is the scraper's current schema**, not one the API creates. The API never runs migrations against a shared/hosted database.
3. **Integration tests may vendor a read-only copy of the scraper migrations** (`test/fixtures/scraper-schema/`) to build a disposable local database. Vendoring test DDL is not production schema ownership.
4. **Neuton is not a current consumer** of this API (no client call exists in `Neuton-Back`). The breaking response change is therefore safe to land before a Neuton client is written.
5. **Only search is in this spec.** `/v1/chains`, `/v1/refreshes`, `/health/*`, rate limits, logging, and error shapes keep their current behavior except the `supermarket.*` → `public.*` rename needed to run at all.
6. **`camelCase` applies to keys, not values.** `item_price: "10.90"` and `sample_count: 1` become `itemPrice: "10.90"` and `sampleCount: 1`; no number parsing, no unit conversion.
7. **The API is the only place that knows DB names.** After `camelizeRow()`, nothing downstream — scorer, ranker, routes, logs about products, tests — should use `snake_case` product fields. Only SQL strings contain `snake_case`.

## 4. Target schema and key mapping

The scraper's `public.products` after migrations 001–005, with the response key each column produces:

| DB column | Response key | Internal |
| --- | --- | --- |
| `chain_id` | `chainId` | |
| `price_update_time` | `priceUpdateTime` | |
| `item_code` | `itemCode` | |
| `last_sale_date_time` | `lastSaleDateTime` | |
| `item_type` | `itemType` | |
| `item_name` | `itemName` | |
| `manufacture_name` | `manufactureName` | |
| `manufacture_country` | `manufactureCountry` | |
| `manufacture_item_description` | `manufactureItemDescription` | |
| `unit_qty` | `unitQty` | |
| `quantity` | `quantity` | |
| `unit_of_measure` | `unitOfMeasure` | |
| `b_is_weighted` | `bIsWeighted` | |
| `qty_in_package` | `qtyInPackage` | |
| `item_price` | `itemPrice` | |
| `unit_of_measure_price` | `unitOfMeasurePrice` | |
| `allow_discount` | `allowDiscount` | |
| `item_status` | `itemStatus` | |
| `is_weighted` | `isWeighted` | |
| `sample_count` | `sampleCount` | |
| `subchain_id` | `subchainId` | |
| `store_id` | `storeId` | |
| `updated_at` | `updatedAt` | yes |
| `run_id` | `runId` | yes |
| `name_tokens` | `nameTokens` | yes |

The table is documentation of the current mapping, not a code list. `camelizeRow()` derives every key generically; adding a column adds a key.

Names that were "legacy" before are now legitimate raw columns under camelCase: `itemCode`, `itemName`, `itemPrice`, `unitOfMeasure`, `unitOfMeasurePrice`, `sampleCount`. They are response fields, not aliases. What stays forbidden is the old *envelope*: PascalCase keys, `price`/`currency`, `isStale`, `sourceUpdatedAt`, and any computed/derived field.

## 5. HTTP contract

### 5.1 Single search

`GET /v1/search?queryType=name&q=milk&limitPerChain=1`

Unchanged request validation: `queryType` required (`name` or `sku`), `q` 1–200 trimmed characters, `limitPerChain` 1–10 default 1. Zero matches is `200` and `[]`.

Response is an array of scored rows:

```json
[
  {
    "score": 9500,
    "chainId": "shufersal",
    "priceUpdateTime": "2026-05-01 00:00:00",
    "itemCode": "11210000094",
    "lastSaleDateTime": null,
    "itemType": null,
    "itemName": "רוטב טבסקו 60 מ\"ל",
    "manufactureName": "מקאילהייני קו",
    "manufactureCountry": null,
    "manufactureItemDescription": null,
    "unitQty": "מיליליטר",
    "quantity": "60",
    "unitOfMeasure": "100 מ\"ל",
    "bIsWeighted": "0",
    "qtyInPackage": null,
    "itemPrice": "10.90",
    "unitOfMeasurePrice": "18.17",
    "allowDiscount": null,
    "itemStatus": null,
    "isWeighted": "0",
    "sampleCount": 1,
    "subchainId": null,
    "storeId": null
  }
]
```

Ordering is unchanged: score descending, then `chainId` ascending, then `itemCode` ascending. Per-chain top-N still applies before the global flatten.

### 5.2 Batch search

Request unchanged. Response:

```json
{
  "results": [
    { "id": "ingredient-1", "items": [ { "score": 9500, "chainId": "shufersal", "...": "..." } ] },
    { "id": "ingredient-2", "items": [] }
  ]
}
```

Input order, duplicate-id rejection, 1–10 entries, one read snapshot, and all-or-nothing validation are unchanged.

### 5.3 What must never appear

Contract failures:

- Any PascalCase envelope key: `ItemCode`, `ItemName`, `ItemPrice`, `UnitQty`, `Quantity`, `UnitOfMeasure`, `UnitOfMeasurePrice`, `SampleCount`.
- The old derived fields: `price`, `currency`, `isStale`, `sourceUpdatedAt`.
- Any internal column under either spelling: `runId`/`run_id`, `updatedAt`/`updated_at`, `nameTokens`/`name_tokens`, `normalizedName`/`normalized_name`.
- Any `snake_case` product key at all — `item_code`, `unit_of_measure_price`, etc. A snake_case key means `camelizeRow()` was bypassed.

`sampleCount`, `itemCode`, `itemName`, `itemPrice`, `unitOfMeasure`, and `unitOfMeasurePrice` are expected and correct, because they are the camelCase form of current raw columns.

## 6. Implementation

### 6.1 Candidate SQL

`src/search/candidates.ts` — SQL names stay as the database defines them; this is the only layer allowed to use `snake_case` product names:

```sql
-- name
SELECT *
FROM public.products
WHERE item_code = $1
   OR lower(btrim(item_name)) = $2
   OR name_tokens && $3::text[];

-- sku
SELECT *
FROM public.products
WHERE item_code = $1;
```

Parameters for the name query: `$1 = query.trim()`, `$2 = normalizeQuery(query)` (trim + lowercase), `$3 = tokenize(query)`. Parameterized only; no interpolation.

No SQL aliases. `SELECT *` plus `camelizeRow()` is what keeps new columns flowing through.

`matchesStoredCandidate` mirrors the SQL but operates on camelCase fields:

```ts
const q = query.trim();
if (q.length === 0) return false;
if (product.itemCode === q) return true;
if (product.itemName !== null && normalizeQuery(product.itemName) === normalizeQuery(q)) return true;
return tokenize(q).some((token) => product.nameTokens.includes(token));
```

`normalizedName` is removed from all candidate paths.

### 6.2 Row type, camelization, and store

`src/db/rows.ts` (new):

```ts
const INTERNAL_COLUMNS = new Set(['runId', 'updatedAt', 'nameTokens', 'normalizedName']);

export function toCamelCase(column: string): string {
  const parts = column.split('_').filter((part) => part.length > 0);
  const [first, ...rest] = parts;
  if (first === undefined) return column;
  return first + rest.map((part) => part[0]!.toUpperCase() + part.slice(1)).join('');
}

/** Renames every key once, at the DB boundary. */
export function camelizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    result[toCamelCase(column)] = value;
  }
  return result;
}
```

`src/db/catalog.ts`:

```ts
export interface StoredProduct {
  itemCode: string;
  itemName: string | null;
  manufactureName: string | null;
  nameTokens: string[];
  [column: string]: unknown;
}
```

- `ProductRow` and `mapRow()` are deleted. There is no per-column mapping, no unit conversion, no formatting, and no `isChainId` assertion on rows.
- Rows are `camelizeRow(raw)` output, returned as `pg` produced the values (strings/numbers/ISO dates).
- `nameTokens` stays on `StoredProduct` because candidate matching needs it; it is stripped at the response boundary only.
- The reader applies `camelizeRow()` to every returned row. No collision handling: the current schema has no two columns that map to one key, and the scraper owns names.
- `CatalogReader` keeps `findBySku` / `findNameCandidates`. `runSearch` loses `now` and `staleAfterHours`.

`src/search/candidates.ts` also updates its `StoredCandidate` type to `{ itemCode, itemName, nameTokens }`.

### 6.3 Scoring

`src/search/rank.ts` keeps the algorithm and threshold verbatim. Field names change:

```ts
const score = query.queryType === 'sku'
  ? product.itemCode === query.q ? 10000 : 0
  : scoreMatch(product.itemName ?? '', product.itemCode, product.manufactureName ?? '', query.q);
```

`createRanker(limitPerChain)` no longer takes `now` or `staleAfterHours`. Chunking, per-chain top-N, ordering (`score`, `chainId`, `itemCode`), and the `> 2500` threshold are unchanged. `finish()` maps each selected row through `toSearchResult`.

### 6.4 Result builder

`src/search/product-result.ts` becomes `src/search/row-result.ts`:

```ts
const INTERNAL_COLUMNS = new Set(['runId', 'updatedAt', 'nameTokens', 'normalizedName']);

export type SearchResult = Record<string, unknown> & { score: number };

export function toSearchResult(row: Record<string, unknown>, score: number): SearchResult {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!INTERNAL_COLUMNS.has(key)) result[key] = value;
  }
  result.score = score; // assigned last; see D11
  return result as SearchResult;
}
```

The denylist is camelCase because stripping happens after `camelizeRow()`. There is one denylist constant, and `src/db/rows.ts` + `src/search/row-result.ts` must reference the same set — export it from `row-result.ts` and import it in `catalog.ts` if `runSearch` prefers to strip before ranking, or keep stripping in one place only (`toSearchResult`) and leave internal fields on the row until then. Chosen: one definition, consumed by `toSearchResult` only.

The old `ProductResult`, `PRICE_ITEM_FIELDS`, `CatalogProduct`, `comparisonFields`, `formatDecimal`, `formatQuantity`, `isStale`, `scaleDecimal`, `divideHalfUp`, and `PackageUnit` are deleted.

### 6.5 Routes and app wiring

- `src/routes/search.ts`: `registerSearch` takes `{ rateLimit }` only. `runSearch(store, query, limitPerChain)` and `rankProducts(products, query, limitPerChain)` lose `now`/`staleAfterHours`.
- `src/app.ts`: pass only `rateLimit` to `registerSearch`. `STALE_AFTER_HOURS` stays for `/v1/chains`.
- `src/refresh/store.ts` and all other runtime SQL: replace `supermarket.` with `public.`.
- Delete `src/db/migrate.ts`, `src/db/migrate-cli.ts`, `db/migrations/`, `db/rollback/`, and the `db:migrate` script. No production path issues DDL.
- Integration tests build their disposable database from `test/fixtures/scraper-schema/`, a read-only copy of the scraper's 001–005 migrations.
- `test/fixtures/neuton-units.ts` and its compatibility assertions are deleted; Neuton mapping is no longer an API concern.

### 6.6 OpenAPI and docs

Update:

- `src/openapi.ts` search response description and examples: `camelCase` keys = raw `public.products` columns minus the denylist, plus `score`.
- `README.md` field-mapping section: the camelCase table from §4.
- `tasks/plan.md` architecture decisions 18–19 and the Task 6 description.
- `tasks/todo.md` Task 6 acceptance criteria; add a new section for this change.
- `SPEC-supermarket-api.md` sections 3, 4, 5, 8, 9.

## 7. Commands

Run from the `Scrapy-API` repository root:

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

`npm run db:migrate` is removed.

## 8. Project structure

```
src/db/rows.ts               camelCase key conversion (single generic transform)
src/search/candidates.ts     candidate SQL + recall rule
src/search/rank.ts           scoring, chunking, top-N, ordering
src/search/row-result.ts     denylist + { ...row, score } builder
src/search/score.ts          unchanged scorer
src/db/catalog.ts            pg reader, camelCase StoredProduct rows
src/routes/search.ts         single + batch route handlers
src/refresh/store.ts         public.* rename only
test/unit/rows.test.ts       camelCase key conversion tests
test/unit/row-result.test.ts denylist/score tests
test/unit/rank.test.ts       updated field names
test/integration/catalog.test.ts, name-search.test.ts
test/fixtures/scraper-schema/ read-only copy of scraper migrations 001–005
```

## 9. Code style

Strict TypeScript, ESM, parameterized SQL, typed repository boundaries, no `any` in transport contracts. Row types are explicit for the fields scoring needs and open for passthrough columns, all `camelCase`. One example:

```ts
export function rankProducts(
  products: readonly StoredProduct[],
  query: SearchQuery,
  limitPerChain: number,
): SearchResult[] {
  const ranker = createRanker(limitPerChain);
  for (let index = 0; index < products.length; index += 200) {
    ranker.add(products.slice(index, index + 200), query);
  }
  return ranker.finish();
}
```

## 10. Testing strategy

Unit — `camelizeRow`:

- `item_code` → `itemCode`, `unit_of_measure_price` → `unitOfMeasurePrice`, `b_is_weighted` → `bIsWeighted`, `quantity` → `quantity`.
- Values are untouched: `"10.90"` stays a string, `1` stays a number, `Date`/ISO values unchanged.
- Unknown future column `future_note` → `futureNote`.
- Leading/trailing/repeated underscores do not produce empty key segments.

Unit — `toSearchResult`:

- Removes `runId`, `updatedAt`, `nameTokens`, `normalizedName`; keeps `subchainId` and `storeId`.
- `score` is present and wins even if the input row contains a `score` key.
- No `snake_case` key survives (assert every output key matches `/^[a-z][A-Za-z0-9]*$/` or is a known raw fallback).
- `matchesStoredCandidate` mirrors the SQL: item code, normalized name, token overlap, null `itemName`.
- Scorer golden fixtures are unchanged.

Contract:

- Single search returns `{ score, ...row }` with camelCase keys and no PascalCase or legacy keys.
- Batch preserves order, ids, and the same result shape.
- Zero matches is `200 []`; invalid input is `400`; DB failure is `503`, never an empty success.

Integration (real PostgreSQL, scraper 001–005):

- Exact SKU match scores 10000; leading zeros are significant.
- Name search finds the Tabasco row and returns `itemName`, `quantity`, `unitQty`, `itemPrice` exactly as stored.
- Punctuation-only exact name (e.g. `!!!`) is found through the `lower(btrim(item_name))` path, proving option B.
- A row with `item_name = null` and empty `name_tokens` is retrievable by SKU and does not crash name search.
- After `ALTER TABLE public.products ADD COLUMN future_note text`, a search result contains `futureNote` with no code change.
- Internal columns are absent from every response in both spellings.
- New assertion: no runtime SQL string contains `supermarket.`.

## 11. Boundaries

Always:

- Use parameterized SQL and `SELECT` only in search paths.
- Keep the scorer, threshold, per-chain limit, and ordering unchanged.
- Convert keys once, in `camelizeRow()`, before anything else sees a row.
- Strip the denylist on every search result.
- Assign `score` last.
- Keep search results `camelCase` and DB-native in value.

Ask first:

- Removing or relocating the refresh-control write paths.
- Changing the denylist beyond `runId`, `updatedAt`, `nameTokens`, `normalizedName`.
- Changing the camelCase conversion rule.
- Adding a database index or changing the scraper schema.
- Changing the exact-name recall rule.

Never:

- Expose `runId`, `updatedAt`, `nameTokens`, or `normalizedName` in either spelling.
- Reintroduce PascalCase aliases or derived Neuton fields into search responses.
- Add per-column `AS "camelCase"` aliases to the search `SELECT`.
- Issue DDL or run migrations against a shared/hosted database from the API.
- Add an explicit column list to the search `SELECT` that must be edited per schema change.
- Return an empty success for a database failure.
- Modify `Neuton-Back` in this change.

## 12. Success criteria

1. `GET /v1/search` and `POST /v1/search/batch` return flat `{ score, ...row }` objects.
2. Every response key is the camelCase form of a real `public.products` column, except `score`.
3. No response key is `snake_case`; no PascalCase or derived legacy key appears.
4. `runId`, `updatedAt`, `nameTokens`, and `normalizedName` never appear.
5. `subchainId` and `storeId` appear when non-null in the row.
6. A newly added non-internal column appears as a camelCase key without an API code change (integration test).
7. A punctuation-only exact name is found with score 9500.
8. SKU search still scores exact matches 10000 and preserves leading zeros.
9. Scorer golden scores are unchanged.
10. No `supermarket.*` references remain in runtime SQL.
11. No production DDL or `db:migrate` path remains.
12. `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration`, and `npm run build` pass.

## 13. Out of scope

- Updating Neuton's client or `normalizeProductPrice`.
- Any legacy `PriceResult` compatibility layer.
- `UnitOfMeasure`/`UnitOfMeasurePrice` derivation and `isStale` staleness.
- Snake-case response compatibility or a `?format=snake_case` switch.
- Refresh dispatch payload (`{ mode: "refresh", run_id }`), admission/recovery locking, and which side writes the refresh run rows — separate spec.
- Changes to the scraper repository.
- Pagination, new query types, filtering, or response field selection.
- Per-field hiding beyond the fixed denylist.

## 14. Resolved and open questions

Resolved 2026-11-01:

- **Read-only scope.** The API issues no DDL and owns no migrations, but it may trigger the scraper. `POST /v1/refreshes` stays as a trigger endpoint.
- **`db:migrate`.** Deleted, not kept as a dev helper. Integration tests build their database from `test/fixtures/scraper-schema/`.

Open:

1. Which side writes the `refresh_runs` / `refresh_run_chains` rows once the refresh spec lands: the API before dispatching, or the scraper after receiving the trigger? Until decided, the API keeps writing them and this spec only renames the schema.
2. Is `/v1/chains` known to work against the scraper's `public.chains` columns (`source_updated_at`, `catalog_updated_at`, `product_count`)? It should be verified during implementation.
3. Should the API assert at startup that `public.products` exists and is readable, failing readiness rather than search? Not specified here.
