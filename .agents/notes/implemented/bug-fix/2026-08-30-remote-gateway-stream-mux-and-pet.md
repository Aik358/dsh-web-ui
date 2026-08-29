# Agent Note: Gate the gateway stream mux and keep the pet on the phone mirror

Status: implemented

## Problem

After the official-UI adaptation round, a paired phone landing on `/pair-app` did not mirror the PC's running DSH:

1. **The remote showed an empty workspace/session state.** The app asked the user to re-select a workspace and reported no sessions — exactly the shape of a fresh instance, not a mirror. Everything host-side (workspace registry, session store) is public to any browser on the same host, so the data was there; the phone's client was not receiving it.
2. **The desktop pet was invisible on the phone.** `@linxin666/dsh-pet` was installed and active, but the portrait-touch adaptation layer suppressed it.

## Decision

**The gated channel now covers the official stream socket.** On the pinned 0.1.2-alpha.1 line the client opens exactly ONE persistent WebSocket — the Typert gateway mux at `/api/remote.mux` — and every Remote stream (workspace follow, session feed, subagent lineage, ...) rides that socket. The channel's rewrite tables had stale legacy paths (`/api/events.mux`, `/api/events.host` — neither exists in this cohort), so the phone's mux was never rewritten to `/remote/api/remote.mux`; it connected straight to the tunnel origin, where the connection fence plus the browser-auth cookie reject the upgrade (the cookieless phone carries neither), and all streams died. The fix:

- `wsPaths` now lists `/api/remote.mux` (plus the sidebar/ssh terminals); both the parse-time boot patch and the runtime patch consume the same rules.
- The host registers the exact upgrade route `/remote/api/remote.mux`, mapping back to the inner `/api/remote.mux`, preserving the `device` query the cookieless credential rides on.
- The stale `events.*` constants are gone; the contract-pin tests assert the mux path.

**The pet stays visible in the portrait-touch layer.** `mobile-adapt.ts` hid `[data-dsh-plugin="pet"]` in the desktop-oriented suppressor list. The pet is a global floating surface — fixed-positioned, pointer-drag repositionable (drag works on touch), tap to interact — it needs no room in the app layout, so the suppression removed a usable capability rather than fitting a desktop panel onto a phone. The pet row is removed from the suppressor rule; the other suppressors (ssh, skill-explorer, task-board, git-graph, perf, usage) stay.

## Alternatives considered

- **Proxy every WS upgrade under `/api` instead of listing exact paths.** Rejected: the webserver dispatches upgrades by exact path and the connection plugin owns the `/api/remote.mux` path; a generic prefix proxy would race the gateway's own upgrade route. Exact mirrors keep one route per socket and keep the device gate in front of each.
- **Keep the pet hidden and document it as desktop-only.** Rejected: the user's requirement is an explicit phone mirror of the running desktop; the pet is a host-global surface with data flowing fine through the gated channel once the mux rides it, so hiding it had no technical basis on this cohort.

## Consequences

- The phone client's workspace/session feeds arrive over the gated channel; the mirror shows the same workspaces and sessions as the PC, and the pet paints on the phone (draggable, same host-side display config).
- The boot script is bigger by one path entry; loopback origins are untouched.
- The channel's coverage is now cohort-exact: any future SDK stream-socket change must update `wsPaths` and `REMOTE_UPGRADE_PATHS` together (both derive from the same rules tables) — the contract-pin tests fail on drift.

## Testing

- Unit: mux path rewrite rules (runtime patch + boot script), the exact upgrade route mapping `/remote/api/remote.mux` → inner `/api/remote.mux` while preserving `?device=`, and the mobile-adapt stylesheet no longer suppressing the pet (with the other suppressors intact). Package suite: 283 tests / 26 files green.
- Live (QA instance on :3191, DSH_HOME=/Users/zcl/dsh-qa-home): fresh browser context with iPhone emulation paired over the LAN origin, landing on `/pair-app`; the workspace list and sessions loaded, and `[data-dsh-plugin="pet"]` computed display was block (see the session record).
