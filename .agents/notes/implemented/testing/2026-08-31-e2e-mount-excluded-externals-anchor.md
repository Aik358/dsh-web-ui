# Agent Note: e2e mount smoke asserted the excluded externals still mount

Status: implemented

## Problem

The v0.3.9 release pipeline ran the tag-triggered `build, test, gated npm publish` job through its full gate and published the whole family to npm successfully. The downstream `verify-release` job's mount-smoke lane (`scripts/e2e-mount.sh` + `tests/e2e/mount.e2e.ts`) failed, so the GitHub Release was not created: the smoke timed out waiting for `[data-dsh-better-sidebar]`.

The assertion was stale. The alpha.2 cohort removed the `@deepseek-ai/dsh-client-runtime` face that `dsh-better-sidebar` and `@mlgbnb/dsh-archive-manager` hard-import, so both were excluded from the `dsh-web-all` aggregate (see [sdk-cohort 0.1.2-alpha.2 upgrade](2026-08-30-sdk-cohort-0.1.2-alpha.2.md) and its "exclude alpha.2-incompatible external plugins" commit). `scripts/aggregate.test.mjs` was updated in that same change to assert the two must NOT be mounted (the row ids `web-ui-better-sidebar` / `web-ui-archive-manager` must be absent from `cordis.patch.yml`), but the e2e mount smoke was missed: it still required the better-sidebar host div to attach, so it contradicted the very exclusion it was meant to smoke-test. The npm content was correct; only the smoke's boot proof was wrong.

## Decision

Rewrite `tests/e2e/mount.e2e.ts` to assert the post-exclusion boot contract instead of the removed mount:

- anchor the boot proof on `[data-dsh-frame]` — the official host frame the shell always renders (used across dsh-web plugin CSS and referenced by the aggregate shim), which is cohort-stable and independent of any external plugin;
- assert `[data-dsh-better-sidebar]` is ABSENT (count 0), not present;
- keep the no-crash-strip / no-pageerror / no-plugin-console-error assertions (the `dsh-better-sidebar` / `archive-manager` crash-prefix patterns stay useful as negative guards).

The test also documents that `@morlay/better-session` stays but ships inactive, so no e2e assertion requires it to mount.

## Alternatives considered

- Anchor on `[data-dsh-plugin]`: rejected — that attribute is only emitted by specific plugin surfaces (e.g. remote-web-ui suppression keys), not the shell/family root, so it does not appear for the aggregate app and the wait times out.
- Keep the better-sidebar mount assertion and re-add the plugins: rejected — that undoes the deliberate alpha.2 exclusion that exists to prevent a boot-aborting loader failure.
- Anchor on the page title / `body`: rejected — weaker, not a DOM mount contract.

## Consequences

- The mount smoke now proves "the aggregate boots cleanly and the excluded externals are absent" rather than "better-sidebar is present," matching the shipped behavior.
- The boot anchor `[data-dsh-frame]` must stay cohort-stable; if the official host frame attribute ever changes, the smoke fails loudly on the next release (a drift trip, not a silent pass).
- `v0.3.9` itself was released with the corrected npm content; the GitHub Release was created manually after the smoke fix because the tag-pipeline `verify-release` job cannot be re-run against a changed tree under an already-pushed, already-published tag.

## Testing

- Local reproduction of the pre-fix failure was confounded by an environmental auth gate: the local `dsh` shim runs the `dsh-v0.1.2-alpha.1` source checkout, whose `dsh web` serves the harness browser-auth fence on a fresh scratch home (the CI global `@deepseek-ai/dsh@0.1.2-alpha.2` does not, per the running original smoke), so the local page showed "authentication required" instead of the app.
- `scripts/aggregate.test.mjs` still passes (asserts the exclusion); `docs:check` passes with the new anchor.
- The fix is on `dev`/`main` at `e1b13cbe7`; the next release's mount smoke will validate it in CI (the authoritative environment).
