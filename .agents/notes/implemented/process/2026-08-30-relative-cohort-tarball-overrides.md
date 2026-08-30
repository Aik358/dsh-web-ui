# Agent Note: relative cohort tarball overrides and local harness detection

Status: implemented

## Problem

The previous [preview cohort overrides](2026-08-28-preview-cohort-tarball-overrides.md) and [CI store rebuild](2026-08-29-ci-rebuilds-cohort-tarball-store.md) configuration hardcoded the author's absolute path `file:/Users/zcl/.dsh-cohorts/0.1.2-alpha.1/` inside `pnpm-workspace.yaml`. On any second developer's machine or environment where the username is different (such as Windows `C:\Users\A\`), `pnpm install` failed with `ENOENT` because pnpm attempted to resolve the hardcoded `/Users/zcl/` directory during dependency verification. In addition, developers building cohort tarballs from an existing local `deepseek-harness` clone had to supply explicit CLI arguments each time.

## Decision

The `overrides:` block in `pnpm-workspace.yaml` and the corresponding importer specifiers in `pnpm-lock.yaml` are rewritten to use relative path specifiers (`file:../../.dsh-cohorts/0.1.2-alpha.1/...`). Because checkouts sit at the workspace root, two directory levels up universally maps to `.dsh-cohorts/` in the user's home directory across different usernames and platforms without baking developer-specific absolute paths into version-controlled manifests.

`scripts/build-cohort-tarballs.mjs` is updated to automatically detect a sibling local `deepseek-harness` repository (`../deepseek-harness` or `../../deepseek-harness`) and honor `DSH_HARNESS_DIR`, avoiding redundant remote clones when local source checkouts are already present. A `--skip-commit-check` flag is added to allow testing against custom local harness revisions.

## Alternatives considered

- Retaining absolute overrides and requiring each developer to edit `pnpm-workspace.yaml` locally: rejected; this caused dirty worktrees, accidental commits of local paths, and broken frozen installs.
- Removing overrides and pointing directly to npm: rejected as a prerequisite step; while `0.1.2-alpha.2` has surfaced upstream, preserving self-contained relative resolution allows offline development and multi-developer collaboration across custom cohorts.

## Consequences

Multiple developers can check out the repository, run `node scripts/build-cohort-tarballs.mjs`, and execute `pnpm install --frozen-lockfile` without encountering hardcoded machine path errors or requiring manual workspace manifest changes.
