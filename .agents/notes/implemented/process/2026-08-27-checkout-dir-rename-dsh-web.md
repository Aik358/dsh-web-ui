# Agent Note: Local checkout directory renamed to dsh-web

Status: implemented

## Problem

The development checkout lived at `/Users/zcl/code/dsh-web-ui` while the remote, docs, and skills already speak of `zhu1090093659/dsh-web` (see [product rename](../architecture/2026-08-24-product-rename-dsh-web.md)). The stale folder name kept drifting local runbooks, test fixtures, and release commands away from reality.

A bare `mv` is not enough: references reach outside the repository. DSH profiles mount packages through symlinks whose targets climb into the old path (`~/.dsh/profiles/**`, dozens of links), an external linked worktree registers this repository's gitdir by absolute path, and tracked texts embed the old absolute path. After a move without preparation, running DSH instances lose plugin resolution on their next lazy load or restart, and the external worktree dies.

## Decision

- The checkout now lives at `/Users/zcl/code/dsh-web`; a compatibility symlink `/Users/zcl/code/dsh-web-ui -> dsh-web` keeps every pre-existing consumer resolving until a later cleanup re-points DSH profile dependencies to the new root.
- The external worktree `/Users/zcl/remote-e2e/pr-970` had its `.git` pointer rewritten to the new location, so it no longer depends on the compatibility symlink. The leftover temporary push worktree under `/private/tmp` was pruned from the registry.
- Tracked texts were updated in the same change: the release skill runbook path and its `cd`, the dsh-pet install example comment, and the plugin-manager legacy-migration fixtures representing this machine's checkout path.
- Frozen runtime identifiers stay untouched: `@linxin666/dsh-web-ui-all` npm names and telemetry/product strings follow the [product rename](../architecture/2026-08-24-product-rename-dsh-web.md) boundary and are not swept up by this relocation.
- The leftover local remote `java-lw` pointing at JAVA-LW/dsh-web-ui was removed; `origin` remains the only remote.

## Testing

- Immediately after the move: `git status` clean on `dev`, both stashes intact, the worktree list healthy, and an HTTP probe of the live GUI on port 3080 returned 200.
- Package paths resolve through the compatibility symlink (`packages/dsh-perf`, `packages/dsh-web-all` reachable via the old path).
- `vitest run tests/gateway-jobs.spec.ts tests/update-route.spec.ts` passes for `@linxin666/dsh-client-ui-plugin-manager`.

## Alternatives considered

One-shot full migration without the compatibility symlink: immediately rewrite every profile dependency specifier and reinstall each affected DSH profile right after the move. Rejected for this change: consumers span several profiles with mixed relative-link origins, and rebuilding them while the GUI is running risks breaking plugin loading between steps; the symlink achieves identical resolution with zero runtime exposure and defines its own removal condition.

Leaving the directory named `dsh-web-ui` indefinitely: rejected — the mismatch perpetuates wrong-path drift in skills, fixtures, and documentation, against the direction already recorded by the product rename.

## Consequences

- Git history, branches, tags, and stashes are unaffected by the move; no commit was rewritten.
- The compatibility symlink is now a fact future cleanup must honor: re-point all DSH profile dependencies to `/Users/zcl/code/dsh-web`, reinstall those profiles, then remove the symlink in that same change. Everything this repository tracks already points at the new root.
- New sessions should bind to `/Users/zcl/code/dsh-web`; session storages keyed by the old cwd are historical records and need no migration.
