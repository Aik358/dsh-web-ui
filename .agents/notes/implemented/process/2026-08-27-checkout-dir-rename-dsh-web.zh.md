# Agent Note: 本机检出目录更名为 dsh-web

Status: implemented

## Problem

开发检出一直放在 `/Users/zcl/code/dsh-web-ui`，而远程仓库、文档与技能早已统一为 `zhu1090093659/dsh-web`（见[产品更名](../architecture/2026-08-24-product-rename-dsh-web.zh.md)）。过期的目录名让本机运行手册、测试夹具和发版命令不断偏离真实路径。

单纯 `mv` 并不够：引用伸到了仓库之外。DSH profile 通过软链接挂载本仓的包（`~/.dsh/profiles/**` 下数十条链接都爬回旧路径）；一个外部链接 worktree 用绝对路径登记了本仓库的 gitdir；仓库内受跟踪文本也内嵌旧绝对路径。不做准备直接搬走后，运行中的 DSH 实例在下一次懒加载或重启时插件解析会失败，外部 worktree 直接报废。

## Decision

- 检出现在位于 `/Users/zcl/code/dsh-web`；保留兼容软链接 `/Users/zcl/code/dsh-web-ui -> dsh-web`，在后续清理把 DSH profile 依赖重指向新根之前，所有既有消费方都能继续解析。
- 外部 worktree `/Users/zcl/remote-e2e/pr-970` 的 `.git` 指针已改写到新位置，不再依赖兼容软链接；`/private/tmp` 下遗留的临时推送 worktree 已从注册表清理。
- 同一变更内更新受跟踪文本：发版技能运行手册的路径与其 `cd`、dsh-pet 安装示例注释、以及代表本机检出路径的 plugin-manager 迁移夹具。
- 冻结的运行时标识符保持不动：`@linxin666/dsh-web-ui-all` npm 包名与遥测/产品字符串仍按[产品更名](../architecture/2026-08-24-product-rename-dsh-web.zh.md)划定的边界处理，不被本次搬迁波及。
- 顺带移除了指向 JAVA-LW/dsh-web-ui 的本地遗留远程 `java-lw`；`origin` 是唯一远程。

## Testing

- 搬迁完成后立即验证：`git status` 在 `dev` 上干净、两个 stash 完好、worktree 列表健康、3080 端口运行中的 GUI HTTP 探测返回 200。
- 包路径可穿过兼容软链接解析（经旧路径可达 `packages/dsh-perf`、`packages/dsh-web-all`）。
- `@linxin666/dsh-client-ui-plugin-manager` 的 `vitest run tests/gateway-jobs.spec.ts tests/update-route.spec.ts` 通过。

## Alternatives considered

不留兼容软链接的一次性彻底迁移：搬迁后立刻改写每个 profile 的依赖声明并逐个重装受影响的 DSH profile。本次未采纳：消费方横跨多个 profile 且软链来源混杂，GUI 正在运行时逐步重建存在插件加载中断风险；软链接能以零运行时暴露获得同样的解析结果，并自带明确的摘除条件。

让目录永远叫 `dsh-web-ui`：已否决——名称错位会让技能、夹具和文档持续累积错误路径漂移，与产品更名已记录的方向相悖。

## Consequences

- 搬迁不影响 Git 历史、分支、tag 与 stash；没有提交被改写。
- 兼容软链接成为后续清理必须记住的事实：把所有 DSH profile 依赖重指到 `/Users/zcl/code/dsh-web`、重装这些 profile，然后在同一变更中摘除软链接。本仓库受跟踪的内容已经全部指向新根。
- 新会话应绑定到 `/Users/zcl/code/dsh-web`；按旧 cwd 记录的会话存储是历史数据，无需迁移。
