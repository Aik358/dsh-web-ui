# @linxin666/dsh-skin-stellar-diva

English | [中文](README.zh.md)

Stellar Diva (星海歌姬) — a pearl-white idol skin for the dsh web GUI, shipped
as a pure asset directory inside the skin-center package, built around the
contributor's blue-haired heterochromia character illustration.

## What it is

- **Pure assets**: `skin.json` (v2 manifest) + `skin.css` (full token remap) +
  `hooks.mjs` (ambient particles, reviewed) + `assets/` (light/dark backdrop
  art) + `preview/` (light/dark screenshots). No package.json, no build step;
  the skin-center package is the only loader.
- **Backdrop**: a pearl-white stage with the idol illustration baked into a
  soft sapphire gradient canvas (light), turning into a midnight star field
  with the same figure (dark), declarative via
  `contributes.backgroundMedia` (light/dark scrims), owned by the
  skin-center background control; the scrim flips live with the light/dark
  theme.
- **Token-first**: light values on `:root` (pearl canvas, sapphire aurora
  accents), dark values under `body[data-ds-dark-theme]` (midnight star
  field); the loader scopes every selector under
  `html[data-dsh-skin="stellar-diva"]`. Sapphire blue `#3D6FD6` leads the
  accent family and replaces the blue/deepseek tokens throughout.
- **Hooks**: `hooks.mjs` renders 18 drifting star dust motes through the
  skin-center hooks contract (`x-org.linxin666.skin-center/v1alpha1`):
  decorative only, no network or storage access, cleaned up through
  `ctx.onCleanup`, and disabled to a static dim state under
  `prefers-reduced-motion`.

## Preview

```sh
pnpm market:build                              # refresh market/dist
open market/dist/preview.html?skin=stellar-diva&theme=light
```

## License

The skin code (skin CSS and hooks) and the character illustration are created
and owned by the contributor (theater / Theater-ahyeon) and released under
[CC-BY-NC-SA-4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). See
the `license` / `attribution` fields in `skin.json`.
