# AGENTS.md — dsh-miku-pet

DSH web GUI plugin @linxin666/dsh-miku-pet. 包级规则:只写本包特有约定,不重复根 AGENTS.md
与 packages/AGENTS.md 的全局 / 包级规则。

## 本包要点

- 一只 Miku 桌宠:host 半区注册 `/miku-pet/*` 路由(帧清单/配置/thumb),client 半区渲染
  宠物 overlay + 设置页「桌宠配置」。
- 玩法池与权重全部在 `assets/config.jsonc`(idle / categories / drag / standup / clicks /
  phrases);新增动作素材 = 放进 `assets/thumb/<key>/` + 接入 config.jsonc 对应池。
- 帧素材为 WebP(host frames 过滤支持 png|webp);路由前缀与 entry id 固定 `miku-pet`,
  不得改回 `pet` / `web-ui-*`(与内置 dsh-pet 共存)。
- 客户端样式直接内联在 CSS 字符串里;商店/菜单类名避开 `menu` / `panel` 子串并用
  `.miku-pet-root` 前缀 + `!important` 稳压 miku 皮肤 patches。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-miku-pet typecheck
pnpm --filter @linxin666/dsh-miku-pet test
pnpm --filter @linxin666/dsh-miku-pet build
```
