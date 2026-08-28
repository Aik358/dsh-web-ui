# Agent Note: Telemetry users badge stays servable under D1 overload

Status: implemented

## Problem

The README "users" shields endpoint badge rendered "inaccessible". shields fetched `/api/telemetry/badge/users` during D1 overload windows, the worker died with an unhandled `D1_ERROR: D1 DB is overloaded. Requests queued for too long.` exception, and shields received the Cloudflare 1101 error page (HTTP 500) instead of badge JSON. A live `wrangler tail` session captured hundreds of failing requests in ten minutes of production traffic — the badge itself, `/api/stats` reads, and telemetry writes. The badge count is a full-table `COUNT(DISTINCT)` scan over `telemetry_events`, so essentially every read during an overload window could throw.

## Decision

- `handleTelemetryUsersBadge` (`market/worker/src/telemetry.js`) caches its response in the edge Cache API for 30 minutes (matching the pre-existing `cache-control` header) and keeps a second stale copy for 24 hours under a separate cache key. On a D1 error it serves the stale copy; with no stale copy available it returns a valid `{"schemaVersion":1,"label":"users","message":"unavailable","color":"lightgrey"}` 200 JSON. The handler can no longer produce a 5xx, so the README badge degrades to a grey "unavailable" instead of "inaccessible".
- `handleTelemetryPost` catches D1 write errors and returns `503 {"ok":false,"error":"storage-unavailable"}` — the same shape as the existing missing-binding branch — instead of an unhandled exception page. Clients treat non-acceptance as "retry on the next mount", which matches the documented fire-and-forget contract in docs/telemetry.md.
- The public contract text gained the same facts: docs/telemetry.md (badge bullet and client retry paragraph), the api-doc.js endpoint table (badge caching, event 503) and the OpenAPI summaries.

## Testing

Local `wrangler dev` with local D1: the badge computes the seeded distinct-visitor count; after inserting another visitor the served count stays cached (edge hit); dropping `telemetry_events` with a warm cache still serves the cached count; with an emptied cache it serves the 200 "unavailable" JSON; recreating the table restores the live count; POST with the table dropped returns the 503 JSON and succeeds again after recovery.

## Alternatives considered

- Maintaining a counter table (deduplicated visitor rows plus a totals counter) so the badge reads one row instead of scanning: it removes the full scan but adds schema, migration, and write-path complexity for a query that now runs at most once per 30 minutes per colo. Declined as disproportionate.
- Adjusting only the shields-side `cacheSeconds`: shields' server cache is outside our control, the worker would still throw for every direct fetch during an overload, and the badge stays broken. Declined.
- Sampling or rate-limiting heartbeat writes to remove the overload itself: a telemetry-architecture decision (cadence, aggregation, storage tier) that deserves its own proposal; this change only stops the badge and the write path from surfacing raw exceptions.

## Consequences

- The badge may show a count up to 30 minutes old, plus one outage window; acceptable for an all-time cumulative number.
- If D1 stays unavailable for more than 24 hours past the last good computation, the badge shows the grey "unavailable" state rather than a number.
- `/api/stats` and `/api/telemetry/summary` still surface D1 overload as worker exceptions; they are site/dashboard inputs rather than shields inputs and need their own decision.
- During overloads telemetry senders now receive 503 responses and retry on the next mount; retry volume is bounded by one pending day per browser.
