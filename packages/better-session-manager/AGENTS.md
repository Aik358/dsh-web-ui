# AGENTS.md — better-session-manager

DSH web GUI card managing the inactive-by-default `@morlay/better-session`
aggregate integration (Settings → Web 插件 → Better Session). 包级规则：只写本包
特有约定，不重复根 AGENTS.md 与 packages/AGENTS.md 的全局/包级规则。

## 本包要点

- 状态真源是 profile cordis.patch.yml 中的托管覆盖块（`# >>> better-session opt-in`）
  与 dsh-web-all 生成产物里的 disabled 行；**没有 settings.yaml 命名空间**——
  本卡没有任何可保存的偏好字段，不要给 host 半区加 installSettingsSection。
- 会写 profile 文件的动作（enable/disable）必须走 `writePatchAtomicSync`
  （`.bak-better-session-manager` 备份 + tmp + rename）；迁移必须先成功、
  后改 profile；两个 POST 路由都必须 loopback 拦截。
- 迁移入口唯一：`lib/better-session-import.mjs`（tsdown companions 从
  `src/core/import-worker-entry.ts` 构建）。host 用子进程执行它，CLI 直接
  import；语义改动只允许发生在 `src/core/*`，不得在脚本或路由里另写一份。
- core 层的 drop/剪枝/稠密编号语义是对 `@morlay/session-rdb@0.0.11` 的逐字
  镜像；升级上游版本时同步核对 `EPHEMERAL_EVENT_TYPES`、`eventDimensions`、
  `SCHEMA_VERSION`、application id 四处常量。
- client 半区禁止 import `src/core/*`（node:sqlite / node:fs 不可进浏览器）。

## 提交前门禁

```sh
pnpm --filter @linxin666/dsh-client-ui-better-session-manager typecheck test build
pnpm test:scripts docs:check aggregate:check
```
