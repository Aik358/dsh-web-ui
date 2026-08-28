# Agent Note: dual-cohort snapshot-store engine shim

Status: implemented

## Problem

After the 0.1.2-alpha.1 preview cohort migration landed on `dev`, the live GUI refused to load the family plugins:

```
failed to import loader entry 47c06ebb (@linxin666/dsh-client-ui-web-ui-settings):
client-modules: require("@deepseek-ai/dsh-client-store") missed the module table —
not a platform seed word, not a materialized module, and no registered package factory
```

The migration made `dsh-client-store` a frozen platform module and the shared client preset externalized it, so every rebuilt client bundle hard-required it at bundle evaluation. The running host, however, is 0.1.1-rc.2 — the newest npm-published release (the preview cohort returns 404 and cannot be installed) — and the rc.2 frozen module table has no `dsh-client-store` row. The loader therefore rejected every family client entry that value-imports the store engine (the settings-form family and the web-ui-settings compat binder, plus the pet store).

The engine contract is identical across cohorts: rc.2's `@deepseek-ai/dsh-client-runtime/client` exports the same `createSnapshotStore` / `defineStore` / `shallowEqual` (literally the same `contract/store.ts` rehomed into `dsh-client-store` upstream), and rc.2 materializes it as the `dsh-client-runtime` inject module's `./client` face — the specifier the former RUNTIME_STORE_EXEMPTION served.

## Decision

Resolve the store engine across host cohorts inside the shared client preset ([shared/tsdown.client.ts](../../../../shared/tsdown.client.ts)):

- Value imports of `@deepseek-ai/dsh-client-store` are no longer external. The bundle purity plugin redirects them to a generated shim module that resolves the engine through the loader's injected `require` at bundle evaluation: the platform module first, the legacy `@deepseek-ai/dsh-client-runtime/client` face second. One artifact serves both host cohorts; on 0.1.2 hosts nothing changes (the platform module answers first), on rc.2 the fallback answers.
- The shim's specifiers are built with `join('')` so the static resolver cannot see them and the require calls are emitted verbatim into the factory scope, where the loader require answers them from the host module table.
- The shim forwards exactly the value surface both engines share. `notifySubscribers` exists only in the cohort package and must never be re-exported; a future value import of it fails the build with a missing-export error instead of silently breaking rc.2.
- Type-only imports are untouched: they are erased before bundling and keep importing the published 0.1.2 declarations, so no type source changes.

Related: [preview SDK cohort via source-built tarball overrides](../process/2026-08-28-preview-cohort-tarball-overrides.md) (the migration that introduced the duality).

## Alternatives considered

- **Keep the hard external require and require a host upgrade**: rejected — the 0.1.2-alpha.1 cohort is an unpublished preview, so the running rc.2 host cannot be upgraded to it; the family would stay broken in the only installable environment.
- **Revert `dev` to the rc.2 cohort**: rejected — undoes the deliberate migration; the sources already import the 0.1.2 faces.
- **Per-consumer try/catch requires in each package source**: rejected — duplicates the compat logic across nine packages and pollutes client sources; the preset is the single build-time seam every bundle already shares.
- **Build-time cohort selection (per-host artifacts)**: rejected — one binary artifact per host cohort reintroduces stateful builds and guarantees the next drift.

## Consequences

- rc.2 hosts import the family client bundles again; 0.1.2-alpha.1 hosts keep the platform-module path.
- The `engines.dsh >=0.1.2-alpha.1` floors and the README DSH badge now overstate the client-half requirement (the shim tolerates rc.2), while the host halves still use the 0.1.2 faces. Lowering the declared floor back to rc.2 is a maintainer cohort-policy decision and was not made here.
- The inject contract's `dsh-client-store` row stays correct for 0.1.2 hosts; on rc.2 the host has no such package to inject and the shim's fallback carries the load instead.

## Verification

- Rebuilt every workspace client bundle: zero hard `require("@deepseek-ai/dsh-client-store")` remain; the shim appears in exactly the nine bundles that value-import the store (desktop-launcher, doctor, market, perf, pet, remote-web-ui, task-board, tool-describe-image, web-ui-settings).
- The live rc.2 host serves the fixed bundle (fetched `http://127.0.0.1:3080/plugins/@linxin666/dsh-client-ui-web-ui-settings/client.js`: the dual require fallback is present, HTTP 200).
- The rc.2 host tree's `dsh-client-runtime/lib/client.js` verified to export `createSnapshotStore` and `defineStore` (the fallback answers).
- `pnpm typecheck`, `pnpm test` (19 suites), `pnpm test:scripts` (226 pass), `pnpm docs:check`, `pnpm aggregate:check`, `pnpm market:check`, `pnpm skin-center:check` all pass.
