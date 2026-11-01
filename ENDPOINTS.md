# Scrapy-API — Exposed Endpoints

Base URL: process-wide (no HTTP credentials required). OpenAPI spec available at `GET /openapi.json`.

## Health

### `GET /health/live`
- **Params:** none
- **Response 200:**
  ```json
  { "status": "ok" }
  ```

### `GET /health/ready`
- **Params:** none
- **Response 200:**
  ```json
  { "status": "ok" }
  ```
- **Response 503:** database unavailable (error body)

## Search

### `GET /v1/search`
- **Query params:**
  - `queryType` (required): `"name"` | `"sku"`
  - `q` (required): string, 1–200 chars
  - `limitPerChain` (optional): integer 1–10, default `1`
- **Response 200:** array of scored product objects. Each object is a camelCase `public.products` row (excluding `runId`, `updatedAt`, `nameTokens`, `normalizedName`) plus `score`.
  ```json
  [
    {
      "chainId": "string",
      "itemCode": "string",
      "name": "string",
      "manufacturer": "string | null",
      "currency": "ILS",
      "price": "number (numeric)",
      "packageQuantity": "number | null",
      "packageUnit": "g | ml | unit | null",
      "sourceQuantity": "number | null",
      "sourceUnitQty": "string | null",
      "itemPriceUpdatedAt": "ISO timestamp | null",
      "isWeighted": "boolean",
      "sampleCount": "integer (1-3)",
      "sourceUpdatedAt": "ISO timestamp",
      "newestSourceUpdatedAt": "ISO timestamp",
      "compatibilityMetadata": "object",
      "score": "number"
    }
  ]
  ```
  - Zero matches → `[]`.
- **Errors:** 400 validation, 429 rate-limited, 503 database unavailable.

### `POST /v1/search/batch`
- **Query params:** `limitPerChain` (optional, 1–10, default 1)
- **Body:**
  ```json
  { "queries": [ { "id": "string (1-64 chars)", "queryType": "name|sku", "q": "string" } ] }
  ```
  - 1–10 queries, unique ids.
- **Response 200:**
  ```json
  {
    "results": [
      {
        "id": "string",
        "items": [ /* same scored product objects as GET /v1/search */ ]
      }
    ]
  }
  ```
  - Results returned in request order.
- **Errors:** 400 validation, 429 rate-limited, 503 database unavailable.

## Refreshes

### `POST /v1/refreshes`
- **Body (optional):**
  ```json
  { "chains": ["shufersal", "carrefour", "..."] }
  ```
  - Omit `chains` → defaults to all 10 chains. Non-empty array of valid chain ids.
  - Valid chain ids: `shufersal, carrefour, rami-levy, yochananof, osher-ad, victory, mahsanei-hashuk, hatzi-hinam, tiv-taam, keshet-teamim`
- **Response 202:**
  ```json
  {
    "runId": "uuid",
    "status": "PENDING",
    "statusUrl": "/v1/refreshes/{runId}",
    "dispatchState": "ACKNOWLEDGED | UNCERTAIN"
  }
  ```
- **Errors:** 400 validation, 409 conflict (chain already has active run), 429 rate-limited, 503 dispatch unavailable/rejected.

### `GET /v1/refreshes/{runId}`
- **Path param:** `runId` — UUID (36 hex/dash chars)
- **Response 200:**
  ```json
  {
    "runId": "uuid",
    "origin": "string",
    "status": "string",
    "dispatchState": "string",
    "createdAt": "ISO timestamp",
    "startedAt": "ISO timestamp | null",
    "finishedAt": "ISO timestamp | null",
    "githubRunId": "string | null",
    "requestedChains": ["string"],
    "chains": [
      {
        "chainId": "string",
        "status": "string",
        "attemptCount": "integer",
        "successfulBranchCount": "integer",
        "productCount": "integer",
        "errorCode": "string | null",
        "errorMessage": "string | null"
      }
    ]
  }
  ```
- **Response 404:** unknown run

## Chains

### `GET /v1/chains`
- **Params:** none
- **Response 200:**
  ```json
  {
    "chains": [
      {
        "id": "string",
        "displayName": "string",
        "productCount": "integer",
        "catalogUpdatedAt": "ISO timestamp | null",
        "sourceUpdatedAt": "ISO timestamp | null",
        "isStale": "boolean",
        "latestStatus": "string | null",
        "activeRunId": "uuid | null"
      }
    ]
  }
  ```

## Error Envelope

All errors return:
```json
{ "error": { "code": "string", "message": "string", "details": [...] }, "requestId": "uuid" }
```
Common codes: `VALIDATION_ERROR`, `RATE_LIMITED`, `UNAVAILABLE`, `REFRESH_CONFLICT`, `DISPATCH_UNAVAILABLE`, `NOT_FOUND`.

- Rate-limited responses include a `retry-after` header.
- All responses include an `x-request-id` header.
