# Agent Note: 快照存储引擎的双 cohort 解析 shim

Status: implemented

## 问题

0.1.2-alpha.1 预览 cohort 迁移合入 `dev` 后，线上 GUI 拒绝加载家族插件：

```
failed to import loader entry 47c06ebb (@linxin666/dsh-client-ui-web-ui-settings):
client-modules: require("@deepseek-ai/dsh-client-store") missed the module table —
not a platform seed word, not a materialized module, and no registered package factory
```

迁移把 `dsh-client-store` 定为冻结平台模块，共享客户端构建预设将其 externalize，于是每个重建的客户端 bundle 都在求值期硬 require 它。而正在运行的宿主是 0.1.1-rc.2——npm 最新可安装版本（预览 cohort 未发布，返回 404）——其冻结模块表没有 `dsh-client-store` 行。loader 因此拒绝了所有值导入 store 引擎的家族客户端入口（settings-form 家族与 web-ui-settings 兼容绑定器，以及宠物商店）。

引擎契约跨 cohort 完全一致：rc.2 的 `@deepseek-ai/dsh-client-runtime/client` 导出同样的 `createSnapshotStore` / `defineStore` / `shallowEqual`（就是上游搬进 `dsh-client-store` 的同一份 `contract/store.ts`），且 rc.2 将其物化为 `dsh-client-runtime` 注入模块的 `./client` 面——正是旧 RUNTIME_STORE_EXEMPTION 服务的那个 specifier。

## 决策

在共享客户端预设（[shared/tsdown.client.ts](../../../../shared/tsdown.client.ts)）内做跨 cohort 的引擎解析：

- `@deepseek-ai/dsh-client-store` 的值导入不再 external。bundle 纯度插件把它们重定向到生成的 shim 模块，shim 在 bundle 求值期通过 loader 注入的 `require` 解析引擎：先试平台模块，回落到旧 `@deepseek-ai/dsh-client-runtime/client` 面。一份产物同时服务两种宿主；0.1.2 宿主行为不变（平台模块先答），rc.2 由回落作答。
- shim 里的 specifier 用 `join('')` 拼出，静态解析器不可见，require 调用原样落进 factory 作用域，由宿主模块表作答。
- shim 只转发两个引擎共有的值面。`notifySubscribers` 仅存在于 cohort 包，绝不转发；未来对它的值导入会在构建期以缺导出报错，而不是在 rc.2 上静默坏掉。
- type-only 导入不受影响：打包前已被擦除，类型仍来自已发布的 0.1.2 声明，类型源不变。

相关：[preview SDK cohort via source-built tarball overrides](../process/2026-08-28-preview-cohort-tarball-overrides.zh.md)（引入这一双轨的迁移）。

## 落选方案

- **保留硬 external require，要求升级宿主**：拒绝——0.1.2-alpha.1 cohort 未发布，正在运行的 rc.2 宿主无法升到它；家族会在唯一可安装的环境里持续坏掉。
- **把 `dev` 回退到 rc.2 cohort**：拒绝——推翻既定迁移；源码已改用 0.1.2 面。
- **在各包源码里各自写 try/catch require**：拒绝——兼容逻辑在九个包里重复、污染客户端源码；预设是所有 bundle 共享的唯一构建期接缝。
- **构建期选择 cohort（每宿主一份产物）**：拒绝——按宿主分产物重新引入有状态构建，必然再次漂移。

## 后果

- rc.2 宿主恢复加载家族客户端 bundle；0.1.2-alpha.1 宿主继续走平台模块路径。
- `engines.dsh >=0.1.2-alpha.1` 下限与 README 的 DSH 徽章现在高估了客户端半区的实际要求（shim 容忍 rc.2），而 host 半区仍使用 0.1.2 面。是否把声明下限降回 rc.2 是维护者的 cohort 政策决定，此处不做。
- inject 契约中的 `dsh-client-store` 行对 0.1.2 宿主仍然正确；rc.2 宿主没有该包可注入，由 shim 回落承担。

## 验证

- 重建全部工作区客户端 bundle：硬 `require("@deepseek-ai/dsh-client-store")` 清零；shim 恰好出现在九个值导入 store 的 bundle（desktop-launcher、doctor、market、perf、pet、remote-web-ui、task-board、tool-describe-image、web-ui-settings）。
- 线上 rc.2 宿主已服务修复后的 bundle（抓取 `http://127.0.0.1:3080/plugins/@linxin666/dsh-client-ui-web-ui-settings/client.js`：双 require 回落存在，HTTP 200）。
- rc.2 宿主树的 `dsh-client-runtime/lib/client.js` 验证导出 `createSnapshotStore` 与 `defineStore`（回落可答）。
- `pnpm typecheck`、`pnpm test`（19 套件）、`pnpm test:scripts`（226 通过）、`pnpm docs:check`、`pnpm aggregate:check`、`pnpm market:check`、`pnpm skin-center:check` 全部通过。
