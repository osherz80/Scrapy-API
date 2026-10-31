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
npm run build --prefix services/api
npm start --prefix services/api
```

`npm run dev` and `npm start` listen on `0.0.0.0` and `PORT` (default 3000). The process reads configuration from the environment only. It does not load `.env`.

Database migration, integration tests, search, and refresh commands are added with those tasks. They are listed in `tasks/todo.md`.

## Configuration

Copy `services/api/.env.example` only as a name checklist. Required values:

| Name | Purpose |
| --- | --- |
| `DATABASE_READ_URL` | Read-only catalog connection |
| `DATABASE_CONTROL_URL` | Run and lease connection |
| `SEARCH_API_KEY` | Bearer credential for search, at least 32 characters |
| `ADMIN_API_KEY` | Bearer credential for refresh and status, different from the search key |
| `GITHUB_REPOSITORY` | `owner/name` used for workflow dispatch |
| `GITHUB_WORKFLOW_ID` | Workflow file or id |
| `GITHUB_REF` | Git ref dispatched for a refresh |
| `GITHUB_TOKEN` | Scoped token that can dispatch that workflow |

`DATABASE_URL` is not a substitute for the two connection strings. Non-local database URLs must not use `sslmode=disable`.

Optional values default to a 48-hour stale window, 60 search requests per minute, 5 refresh triggers per minute, a 15-second database statement timeout, a 30-second request budget, and database concurrency of 2. `LOG_ENV=production` forces the log level to at least `info`.

## HTTP

`GET /health/live` is unauthenticated and reports process liveness only. Other routes are added in later tasks. Error bodies use `{ "error": { "code", "message" }, "requestId" }`. The request id is also returned in `x-request-id`.

## Logging

Call sites use the `Logger` interface. A facade filters by level, stamps `service`, `environment`, and `version`, and redacts authorization headers, cookies, passwords, and tokens. The console transport writes one JSON line. Tests use the in-memory transport.
