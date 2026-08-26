# Agent Note: dispose previous skin activation before applying new skin hooks

Status: implemented

## Problem

When dynamically switching skins (or applying a skin from try-on preview), the runtime previously executed installHooks on the new activation before calling ledger.disposeActivation(previous). Consequently, the previous activation teardown closures ran after the new skin had already mounted its DOM nodes, attached observers, and set body attributes. For skins with teardown closures that clean up document-level attributes or DOM nodes (such as orca-link, maid-atelier, or miku), the previous activation disposal stripped global attributes (data-dsh-orca-link, data-orca-settings-open, data-orca-sidebar-wide) and removed newly mounted chrome nodes (such as the DSH wordmark, character mascot, and headline typewriter), leaving the interface in a corrupted or unstyled state until the page was reloaded. Furthermore, data-dsh-skin was set on documentElement after installHooks, preventing hook logic from querying CSS-styled dimensions during initial hook execution.

## Decision

In skin-controller.ts:
1. The new skin stylesheets continue to pre-load first into the document head to avoid unstyled flashes.
2. Once the new stylesheet is ready, the previous activation is disposed (ledger.disposeActivation(previous)) before the new skin hooks and DOM mutations execute.
3. The data-dsh-skin attribute is set on document.documentElement immediately after disposing the old activation so that all CSS rules scoped to html[data-dsh-skin] are active when the new skin background and hooks are installed.
4. installBackground and installHooks execute cleanly on the reset DOM.

## Alternatives considered

- Patching individual skin hooks to check whether another activation of the same skin is currently mounted was rejected because hooks are distributed as isolated ESM modules that do not and should not track cross-activation controller state, and cross-skin attribute cleanups (like global class or style cleanups) would still conflict.
- Deferring previous activation disposal until after a timeout was rejected because asynchronous teardown produces non-deterministic race conditions during rapid skin switching.

## Consequences

Dynamic skin switching, try-on preview, and repeat applications now cleanly tear down the previous skin before mounting the new skin. Global attributes and DOM chrome mounted by the new skin hooks remain fully intact without requiring a browser refresh. All tests pass across the monorepo, and a dedicated test in skin-runtime.spec.ts pins the strict previous:cleanup -> next:apply lifecycle ordering.
