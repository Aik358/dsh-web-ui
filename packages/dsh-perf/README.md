# dsh-perf

English | [中文](README.zh.md)

Performance observability and governance plugin for DSH Web: streaming and multi-session performance engine of the dsh-web family.

## What it does

Everything ships as a plugin (no core fork, no runtime magic), in three layers:

1. **Observe**: host `PerfMeter` subscribes to the cordis `session/event` bus (event rate per session / total / type distribution), the `agent/status` migration stream (idle/running timeline), event-loop delay (`perf_hooks`) and memory; a loopback-fenced `GET /api/dsh-perf/stats` exposes aggregates; the browser HUD panel (off by default) shows server metrics plus local FPS / Longtask sampling.
2. **Govern**: `cordis.patch.yml` declares the write-batch delay of `session-persistence-jsonl` (200ms -> 500ms, ~2.5x fewer fsync batches while streaming); `mode: off | balanced | aggressive` and alert presets (light / standard / strict) hot-swap via Settings.
3. **Down-load**: proxied assistant-step shadow (`priority:-1`, forwards the official renderer for light nodes) collapses and lazily highlights heavy assistant messages (>20KB, or streaming-style rendering without the Shiki spike); `content-visibility:auto` on message rows approximates virtualization; agent idle badges.

## Install

In your profile (e.g. `~/.dsh/profiles/web`):

```bash
pnpm add @linxin666/dsh-perf
```

and insert into `cordis.patch.yml` (or use the bundle patch):

```yaml
- insert:
    - id: dsh-perf
      name: '@linxin666/dsh-perf'
      config:
        enabled: true
        mode: balanced
        meterIntervalMs: 2000
        statsWindowSeconds: 120
        alertPreset: standard
        hudEnabled: false
        renderDegrade: true
```

Restart `dsh web` (Web mode does not enable HMR at load time) for the host half; the client half applies on refresh. Enable the HUD panel and toggles from `Settings -> Web Plugins -> Performance Engine`.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch; off = host stops subscribing/sampling, HUD hidden, CSS degrade off |
| `mode` | `balanced` | `off` / `balanced` / `aggressive` |
| `meterIntervalMs` | `2000` | Sampling period (1s-60s, hot-swappable) |
| `statsWindowSeconds` | `120` | Rate window (10s-1h) |
| `alertPreset` | `standard` | `light` (10 sessions / 1000 ev/s) `standard` (5 / 300) `strict` (3 / 150) |
| `hudEnabled` | `false` | HUD panel (browser) |
| `renderDegrade` | `true` | Proxied assistant-step shadow (heavy message collapse + lazy highlight) |

## HUD / panel

- Server side: events/s, active sessions, event-loop p99/mean latency, RSS/Heap, applied write-batch delay (read from the live persistence service).
- Browser: FPS (last 1s), Longtask (last 60s); × collapses the panel to a small tab (click to expand).
- The host endpoint auto-hides the HUD after 3 consecutive failures (silent degradation when the host half is absent).
- Idle agents get a `·idle` badge on their session row (from `agent/status` migration events, zero upstream changes).

## Boundaries / upstream

- `/api/dsh-perf/stats` serves aggregates only (no session content); loopback guard from shared/host/loopback.ts (same-origin + 127/8 + sec-fetch markers).
- Emission-side aggregation and push-frame batching live in core (agent-loop / client-runtime) — out of the plugin scope by design; measured evidence lives in docs/dsh-perf-upstream-proposal.md (internal research, not upstream PRs).

