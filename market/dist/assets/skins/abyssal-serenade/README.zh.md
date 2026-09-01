# @linxin666/dsh-skin-abyssal-serenade

[English](README.md) | 中文

深海人鱼谣（Abyssal Serenade）—— dsh web GUI 的深海人鱼皮肤，以纯资产目录
形态收录在皮肤中心内，围绕贡献者本人的蓝发异色瞳角色插画制作。

## 是什么

- **纯资产**：`skin.json`（v2 清单）+ `skin.css`（全量 token 重映射）+
  `hooks.mjs`（环境粒子，已复核）+ `assets/`（亮/暗背景画）+ `preview/`
  （亮/暗截图）。无 package.json、无构建步骤；皮肤中心包是唯一加载器。
- **背景**：海沫白浅滩上的浮游人鱼立绘与上浮气泡（亮色），暗色沉入深渊青
  渐变与光柱、气泡自底部升起，通过 `contributes.backgroundMedia` 声明
  （亮/暗遮罩），由皮肤中心背景控件拥有；遮罩随亮/暗主题实时切换。
- **token 优先**：亮色值挂在 `:root`（海沫白、浅滩强调），暗色值挂在
  `body[data-ds-dark-theme]`（深渊青、深水微光）；加载器把每条选择器作用域到
  `html[data-dsh-skin="abyssal-serenade"]`。水色青绿 `#189EB4`
  贯穿令牌层。
- **Hooks**：`hooks.mjs` 通过皮肤中心 hooks 契约
  （`x-org.linxin666.skin-center/v1alpha1`）渲染 16 颗上浮气泡：纯装饰、
  无网络与存储访问，经 `ctx.onCleanup` 清理，并在 `prefers-reduced-motion`
  下退化为静态微光。

## 预览

```sh
pnpm market:build                              # 刷新市场产物（market/dist）
open market/dist/preview.html?skin=abyssal-serenade&theme=light
```

## 许可与素材来源

皮肤代码（皮肤 CSS 与 hooks）与角色插画均由贡献者（theater /
Theater-ahyeon）创作并持有，以
[CC-BY-NC-SA-4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 发布。
详见 `skin.json` 的 `license` / `attribution` 字段。
