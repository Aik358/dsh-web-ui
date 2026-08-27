# @linxin666/dsh-client-ui-better-session-manager

[English](README.md) | 中文

`@linxin666/dsh-web-all` 聚合包内置的 `@morlay/better-session`（默认关闭）管理卡片：位于 设置 → Web 插件 → Better Session，卡片本身声明第三方来源，并通过仅限回环地址的宿主路由驱动启用开关与一次性旧会话迁移。

## 功能

- **卡片（浏览器半区）**：在 Web 插件组注册一个入口（`web-ui.plugin.item`，order 145）。实时显示当前状态——未启用（官方 jsonl 存储）/ 已启用（SQLite 存储）——以及旧会话按项目计数和启用后的库内会话/事件数量。
- **第三方声明**：卡片明示上游项目（[morlay/better-session](https://github.com/morlay/better-session)，MIT）；该集成并非本仓库出品。
- **启用并自动迁移**：确认开关后先把全部旧版 `<sessions>/<项目>/<segment>/session.jsonl.zstd` 日志导入 RDB 库（`sessions.sqlite`），再写启动 profile 的托管覆盖块。导入跑在子进程；只有成功才改 profile。现有库先自动备份。补丁层支持热重载，无需重启宿主——切换后刷新一次页面即可看到新 UI。
- **停用**：移除托管块（只动 profile）。启用期间创建的会话留在 SQLite 中，重新启用或再次导入前不在列表中显示。
- **维护 CLI**：`scripts/dsh-better-session.mjs`（status / migrate / enable / disable）经 `lib/better-session-import.mjs` 复用本包核心。

## 迁移语义

逐条对照 `@morlay/session-rdb@0.0.11` 的接入语义：丢弃 `assistant/chunk`、`ignorable` 与 packed chunk 行；上游 seq 存入 `f_original_seq`；对被丢弃 seq 做 surface provenance 剪枝；事件 id 成链、桥接行从 0 稠密编号。唯一锚点保证重跑收敛（之后新建的 jsonl 会话会被下一次导入补上；已导入会话的后续追加不会自动同步）。

启用的收益与代价、为什么本集成默认关闭：见 dsh-web-all README「启用 better-session」一节。

## 安装

随 `@linxin666/dsh-web-all` 分发。独立安装：

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-better-session-manager@latest
# 重启一次 dsh web 载入本包后才会出现卡片
dsh web
```

## 已知限制

- 已打开的页面不会自动挂载新启用的 client 半区；切换后请刷新页面。
- 自动迁移以整份日志为单位；导入运行期间的尾部追加需要稍后再跑一次导入补齐。
- 迁移工具不支持 PostgreSQL 后端（仅 SQLite）。
