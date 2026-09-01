# @linxin666/dsh-skin-starry-nocturne

English | [中文](README.zh.md)

Starry Nocturne (星夜夜曲) — a gothic-lace starry-night skin for the dsh web
GUI, shipped as a pure asset directory inside the skin-center package, built
around the contributor's blue-haired heterochromia character illustration.

## What it is

- **Pure assets**: `skin.json` (v2 manifest) + `skin.css` (full token remap) +
  `hooks.mjs` (ambient particles, reviewed) + `assets/` (light/dark backdrop
  art) + `preview/` (light/dark screenshots). No package.json, no build step;
  the skin-center package is the only loader.
- **Backdrop**: a lace-white canvas with the starry-gown illustration (light),
  turning into a full starry-night scene with silver dust motes adrift (dark),
  declarative via `contributes.backgroundMedia` (light/dark scrims), owned by
  the skin-center background control; the scrim flips live with the light/dark
  theme.
- **Token-first**: light values on `:root` (lace white, velvet midnight
  accents), dark values under `body[data-ds-dark-theme]` (velvet midnight,
  amethyst starlight); the loader scopes every selector under
  `html[data-dsh-skin="starry-nocturne"]`. Royal blue-violet `#5B5FC7`
  carries the token layer, with a faint red-ribbon glint as a hidden
  signature.
- **Hooks**: `hooks.mjs` renders 16 drifting silver dust motes through the
  skin-center hooks contract (`x-org.linxin666.skin-center/v1alpha1`):
  decorative only, no network or storage access, cleaned up through
  `ctx.onCleanup`, and disabled to a static dim state under
  `prefers-reduced-motion`.

## Preview

```sh
pnpm market:build                              # refresh market/dist
open market/dist/preview.html?skin=starry-nocturne&theme=light
```

## License

The skin code (skin CSS and hooks) and the character illustration are created
and owned by the contributor (theater / Theater-ahyeon) and released under
[CC-BY-NC-SA-4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). See
the `license` / `attribution` fields in `skin.json`.
