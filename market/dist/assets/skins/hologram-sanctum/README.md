# @linxin666/dsh-skin-hologram-sanctum

English | [中文](README.zh.md)

Hologram Sanctum (虚数圣所) — a cyber-hologram skin for the dsh web GUI,
shipped as a pure asset directory inside the skin-center package, built around
the contributor's blue-haired heterochromia character illustration.

## What it is

- **Pure assets**: `skin.json` (v2 manifest) + `skin.css` (full token remap) +
  `hooks.mjs` (ambient particles, reviewed) + `assets/` (light/dark backdrop
  art) + `preview/` (light/dark screenshots). No package.json, no build step;
  the skin-center package is the only loader.
- **Backdrop**: a void-black sanctum where the seated illustration floats via
  screen blending with slow cyan data-stream motes (dark), and a cold silver
  sanctum with a pale violet curtain (light), declarative via
  `contributes.backgroundMedia` (light/dark scrims), owned by the
  skin-center background control; the scrim flips live with the light/dark
  theme.
- **Token-first**: light values on `:root` (cold silver, pale violet
  accents), dark values under `body[data-ds-dark-theme]` (void black,
  hologram cyan); the loader scopes every selector under
  `html[data-dsh-skin="hologram-sanctum"]`. Grid glimmer and hologram cyan
  `#0FA0BE` accent lines carry the token layer throughout.
- **Hooks**: `hooks.mjs` renders 14 slow-drifting hologram motes through the
  skin-center hooks contract (`x-org.linxin666.skin-center/v1alpha1`):
  decorative only, no network or storage access, cleaned up through
  `ctx.onCleanup`, and disabled to a static dim state under
  `prefers-reduced-motion`.

## Preview

```sh
pnpm market:build                              # refresh market/dist
open market/dist/preview.html?skin=hologram-sanctum&theme=light
```

## License

The skin code (skin CSS and hooks) and the character illustration are created
and owned by the contributor (theater / Theater-ahyeon) and released under
[CC-BY-NC-SA-4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). See
the `license` / `attribution` fields in `skin.json`.
