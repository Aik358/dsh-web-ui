# Agent Note：e2e 挂载冒烟仍断言被排除的外部插件挂载

Status: implemented

## Problem

v0.3.9 发布管线跑完了 tag 触发的 `build, test, gated npm publish` job 的全部门禁，并把整个家族发布到 npm。下游 `verify-release` job 的挂载冒烟通道（`scripts/e2e-mount.sh` + `tests/e2e/mount.e2e.ts`）失败，导致 GitHub Release 没创建：冒烟在等待 `[data-dsh-better-sidebar]` 时超时。

这条断言已过时。alpha.2 cohort 移除了 `dsh-better-sidebar` 与 `@mlgbnb/dsh-archive-manager` 硬依赖的 `@deepseek-ai/dsh-client-runtime` 面，两者因此从 `dsh-web-all` 聚合中排除（见 [sdk-cohort 0.1.2-alpha.2 upgrade](2026-08-30-sdk-cohort-0.1.2-alpha.2.md) 及其 "exclude alpha.2-incompatible external plugins" 提交）。`scripts/aggregate.test.mjs` 在同一个变更里已同步改为断言这两个**不得**挂载（`cordis.patch.yml` 里不得出现 `web-ui-better-sidebar` / `web-ui-archive-manager` 行），但 e2e 挂载冒烟被漏掉了：它仍要求 better-sidebar 的宿主 div 出现，与它本该冒烟验证的排除自相矛盾。npm 内容是对的，只有冒烟的「启动证明」错了。

## Decision

把 `tests/e2e/mount.e2e.ts` 改写为断言排除后的启动契约，而不是被删除的挂载：

- 启动证明锚在 `[data-dsh-frame]`——官方宿主帧，shell 总会渲染（被 dsh-web 多个插件 CSS 引用、也被聚合 shim 引用）且对 cohort 稳定、不依赖任何外部插件；
- 断言 `[data-dsh-better-sidebar]` **缺席**（count 0），而非出现；
- 保留无崩溃条 / 无 pageerror / 无插件控制台错误断言（`dsh-better-sidebar` / `archive-manager` 的崩溃前缀模式仍作为反向守卫有用）。

测试同时注明 `@morlay/better-session` 保留但默认关闭，因此没有任何 e2e 断言要求它挂载。

## Alternatives considered

- 锚在 `[data-dsh-plugin]`：拒绝——该属性只由特定插件面发出（例如 remote-web-ui 的抑制键），并非 shell/家族根，聚合应用上不出现，等待会超时。
- 保留 better-sidebar 挂载断言并重新加入插件：拒绝——会撤销刻意为之的 alpha.2 排除；该排除是为了避免 loader 启动中止。
- 锚在页面标题 / `body`：拒绝——更弱，不是 DOM 挂载契约。

## Consequences

- 挂载冒烟现在证明的是「聚合干净启动且被排除的外部插件缺席」，而非「better-sidebar 存在」，与已发布行为一致。
- 启动锚 `[data-dsh-frame]` 必须保持 cohort 稳定；若官方宿主帧属性将来变化，下次发布会响亮失败（一次漂移触发，而非静默通过）。
- `v0.3.9` 本身以修正后的 npm 内容发布；GitHub Release 在冒烟修复后手动创建，因为 tag 管线的 `verify-release` job 无法在已推送、已发布的 tag 下对改动后的树重跑。

## Testing

- 修复前的本地复现被一个环境认证门干扰：本地 `dsh` shim 跑 `dsh-v0.1.2-alpha.1` 源码检出，其 `dsh web` 在全新 scratch home 上会弹出 harness 浏览器认证栏（CI 的全局 `@deepseek-ai/dsh@0.1.2-alpha.2` 不会，依据是原本跑过的冒烟），于是本地页面显示「authentication required」而非应用。
- `scripts/aggregate.test.mjs` 依旧通过（断言排除）；新锚下 `docs:check` 通过。
- 修复在 `dev`/`main`（`e1b13cbe7`）；下次发布的挂载冒烟将在 CI（权威环境）验证它。
