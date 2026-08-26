# Agent Note: Paginated telemetry dashboard at tv.dsh-market.com

Status: implemented

## Problem

The private telemetry dashboard rendered the summary aggregate as static server-side tables with no charts and hard truncation: the summary API capped hot paths at LIMIT 20 and heartbeat items at LIMIT 200 with no way to read past the cap, so growing traffic made the two most interesting listings permanently incomplete. The page also forbade scripts under CSP, ruling out trend charts and in-place pagination.

## Decision

The summary API paginates server-side and the dashboard became a self-rendering dark client:

- `GET /api/telemetry/summary` accepts `paths_limit`/`paths_offset` (default 20, max 100) and `items_limit`/`items_offset` (default 200, max 200); responses carry `site.paths_total` and `plugins.totals.items` (now an exact distinct-subject count rather than a capped page length) plus echoed `*_page` windows. Defaults reproduce the pre-pagination response, so existing readers are unaffected. The per-item channel/version breakdowns stay full-cardinality scans (their size is bounded by the plugin catalog, not traffic) and are joined onto the returned page in memory, keeping one D1 batch of nine statements.
- `market/telemetry-view` splits into `src/index.js` (Access JWT verification, routing) and `src/page.js` (the document). The page embeds one boot JSON and renders entirely client-side: KPI cards with day-over-day deltas, a hand-rolled SVG PV/UV trend chart with hover crosshair, and hot-path / plugin tables with pagers (page numbers plus 10/20/50 size selector). Range switches and pagination refetch through a same-origin `/data` proxy that applies the same Access verification and forwards the pagination window, so interactions never reload the page.
- CSP opened from no-scripts to `script-src 'unsafe-inline'; connect-src 'self'`: all JavaScript remains inline (no CDN), and the embedded boot JSON escapes `<` as \\u003c so data cannot terminate the script element.
- Both workers deploy with plain `wrangler deploy`; no D1 migration is involved.

This note extends [Anonymous install telemetry via the market edge API](2026-08-24-anonymous-install-telemetry.md), which owns the collection pipeline and privacy contract; nothing there changes.

## Alternatives considered

- Client-side pagination over the old fixed-cap response: zero API risk, but hot paths would remain capped at 20 forever, making the pager cosmetic. Rejected because the point of pagination is reaching the full grouping.
- Filtering the channel/version queries to the current page's subjects (second D1 batch with a dynamic IN list): saves nothing at catalog-scale cardinality and adds a round trip; the join-in-memory design keeps one batch.
- Charting via a CDN library (Chart.js/ECharts): rejected to keep the Access-gated page fully self-contained; the hand-rolled SVG chart is about 80 lines and has no supply-chain surface.
- Zero-script pagination via URL parameters and full reloads: keeps the strictest CSP, but loses the trend chart and forces a full upstream refetch per click; the inline-script CSP with escaped boot JSON keeps the XSS surface equivalent (data was always server-escaped into HTML before).

## Consequences

- `plugins.totals.items` semantics improved from "page length (<= 200)" to "exact distinct heartbeat subjects in range"; consumers that treated it as the items array length see the same value until catalog size exceeds 200.
- The summary batch grew from 7 to 9 D1 statements (two COUNT DISTINCT totals); each remains an indexed aggregate over the same range.
- tv.dsh-market.com now executes inline JavaScript under `script-src 'unsafe-inline'`; the page still loads no external assets and the Access JWT gate is unchanged for `/` and `/data`.
- Test coverage: `scripts/market-worker.test.mjs` asserts the pagination bindings, clamps, and totals; `scripts/telemetry-view.test.mjs` covers the Access gate and boot-JSON escaping.

## Testing

`node --test scripts/market-worker.test.mjs scripts/telemetry-view.test.mjs` (28 tests) plus a local HTTP harness driving the rendered page with Playwright: pager clicks issue the expected `/data` windows, range switching resets both offsets, the chart tooltip appears on hover, and no console errors occur. Desktop and mobile screenshots verified.
