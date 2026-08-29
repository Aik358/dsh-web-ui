# dsh-usage

[English](README.md) | 中文

dsh Web GUI 的使用统计插件：多 provider 余额与编程套餐用量检测，外加实时 token 用量台账，并通过宠物插件的专用公告气泡展示当前提供方状态。

## 功能

插件由宿主侧服务与设置页一级分区（使用统计，位于创意工坊下方）组成：

- **用量页签**：今日 token 分桶合计（输入 / 输出 / 缓存读 / 缓存写，按 provider 上报口径互不相加），分 provider 与模型细分，近 30 天以「提供方-模型」水平条形图展示，以及所有已配置 provider 的余额。台账从 `session/event` 实时流折叠（`request/header` 归因路由 + `assistant/message` 用量），持久化到 `$DSH_HOME/dsh-usage/usage-ledger.json`，按本地日保留；统计自插件首次启用起计。
- **个人套餐页签**：每个已配置且暴露套餐端点的 provider 的配额窗口——已用百分比与重置时间（Kimi For Coding 5 小时/每周、GLM 编程计划 5 小时/每周、OpenCode Go 滚动/每周/每月、MiniMax 5 小时/每周、Codex / ChatGPT 订阅 5 小时/每周）。没有真实套餐/订阅体系的厂商（DeepSeek、ZenMux、Moonshot、OpenRouter、SiliconFlow）不出现在此页签，其余额显示在用量页签。
- **宠物联动**：宠物渲染一只专用公告气泡（独立玻璃样式、色调描边、微型配额计量条），展示当前提供方的余额或最紧的套餐窗口。`bubbleMode` 控制行为：常驻 / 仅变化时 / 关闭。
- 探测完全在宿主侧按轮询周期执行（默认 60 秒，可手动刷新）；API key 经宿主凭据缝解析（`llm-pi-ai` 记录、`apiKeyEnv` 引用），永不进入浏览器。

支持的余额端点：DeepSeek、Moonshot（国内/国际）、OpenRouter、SiliconFlow（国内/国际）、ZenMux。支持的套餐端点：Kimi For Coding、GLM 编程计划（国内 open.bigmodel.cn、国际 api.z.ai）、OpenCode Go、MiniMax、Codex / ChatGPT 订阅（OAuth access token 取自 pi-ai grant；token 过期时显示错误行，宿主下次跑 Codex 请求自动刷新后恢复）。没有程序化端点的 provider（Qwen token 套餐、OpenCode Zen 按量、Anthropic、OpenAI）仅列出，不展示数据。

## 安装

要求 DSH 0.1.2-alpha.1 或更高：插件基于 0.1.2-alpha.1 DSH cohort 开发，其 `@deepseek-ai/*` 运行时导入由宿主本体提供。

在 profile（如 `~/.dsh/profiles/web`）中：

```bash
pnpm add @linxin666/dsh-usage
```

并插入 `cordis.patch.yml`（或使用 bundle patch）：

```yaml
- insert:
    - id: usage
      name: '@linxin666/dsh-usage'
```

宿主半区需要重启 `dsh web`；客户端半区刷新页面即生效。分区入口在 `设置 -> 使用统计`。

## 配置

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 总开关；关闭后不监听、不探测、不注册路由 |
| `pollIntervalSec` | `60` | provider 探测周期（30-3600 秒，热切换） |
| `bubbleMode` | `always` | 宠物公告气泡：`always`（每次轮询即刷新）/ `change`（仅数值变化时）/ `off` |
| `retainDays` | `180` | 台账按本地日保留天数（7-730） |

## 已知限制

- 用量统计自插件首次启用起计，不回填历史会话。
- OAuth 类路由（如 qwen OAuth 授权）仅识别类型，不做探测；插件不消耗第三方 OAuth 额度。
- 探测失败时保留上一次数据并展示错误行；过于频繁的轮询可能触发 provider 限流。
- 宠物气泡需要 dsh-pet 插件；未安装时分区功能不受影响。
