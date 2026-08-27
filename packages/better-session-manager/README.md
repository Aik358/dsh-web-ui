# @linxin666/dsh-client-ui-better-session-manager

English | [中文](README.zh.md)

The management card for the inactive-by-default `@morlay/better-session` integration shipped inside the `@linxin666/dsh-web-all` aggregate. It lives under Settings → Web 插件 → Better Session, declares the third-party origin on the card itself, and drives the opt-in switch plus the one-shot legacy migration through loopback-fenced host routes.

## What it does

- **Card (browser half)**: registers one entry in the Web Plugins group (`web-ui.plugin.item`, order 145). It shows the live posture — inactive (stock jsonl storage) vs enabled (SQLite storage) — the legacy session count per project, and the store counters once enabled.
- **Third-party declaration**: the card names the upstream project ([morlay/better-session](https://github.com/morlay/better-session), MIT) explicitly; the integration is not authored in this repository.
- **Enable with automatic migration**: confirming the switch first imports every legacy `<sessions>/<project>/<segment>/session.jsonl.zstd` log into the RDB store (`sessions.sqlite`), then flips the managed override block in the boot profile's patch file. The import runs as a child process; the profile write only happens when it succeeds. Existing stores are backed up first. The patch layer hot-reloads on long-lived hosts, so no restart is required — refresh the page afterwards to see new UI halves.
- **Disable**: removes the managed block (profile-only). Sessions created while enabled stay in SQLite and disappear from the list until re-enabled or re-imported.
- **Maintenance CLI**: `scripts/dsh-better-session.mjs` (status / migrate / enable / disable) shares this package's core through `lib/better-session-import.mjs`.

## Migration semantics

Byte-faithful port of `@morlay/session-rdb@0.0.11` ingestion: drop `assistant/chunk`, `ignorable` events and packed chunk rows; keep upstream seqs as `f_original_seq`; prune surface provenance referencing dropped seqs; chain event ids and number bridges densely from 0. Unique anchors make reruns converge (created-under-jsonl sessions added later are picked up by a rerun; tails of already-imported sessions are not re-synced).

Pros/cons of enabling, and why the integration ships inactive by default: see the dsh-web-all README ("Opting into better-session").

## Install

Shipped as part of `@linxin666/dsh-web-all`. Standalone install:

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-better-session-manager@latest
# Restart dsh web once so the package loads; the card appears afterwards.
dsh web
```

## Known limitations

- Open browser tabs do not mount newly enabled client halves automatically; refresh after switching.
- The automatic import covers whole legacy logs. Tail appends made during a running import require another pass later.
- PostgreSQL rdb backends are out of scope for the migration tool (SQLite only).
