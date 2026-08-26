# dsh-perf

[English](README.md) | 中文

DSH Web 性能观测与治理插件：流式/多会话场景的「性能引擎」，dsh-web 全家桶第一位功能插件。

## 它会做什么

全部能力以插件形式交付（不 fork core、不做运行时黑魔法），分三层：

1. **观测**：Host 侧 `PerfMeter` 订阅 cordis `session/event` 总线（每会话/总事件速率、类型分布）、`agent/status` 迁移流（idle/running 时间线）、事件循环延迟（perf_hooks）与内存；loopback-fenced `GET /api/dsh-perf/stats` 暴露聚合；浏览器 HUD 面板（默认关闭）显示服务端指标 + 本地 FPS / Longtask 采样。
2. **治理**：`cordis.patch.yml` 声明式覆盖 `session-persistence-jsonl` 的写批延迟（200ms → 500ms，流式期 fsync 批次约降 2.5 倍）；`mode: off | balanced | aggressive` 与告警预设（轻/标准/严格）在 Settings 面板热切换。
3. **降载与取证**：呈现与官方逐像素一致的 assistant-step shadow（轻节点直接转发官方渲染器，无折叠、无按钮）；heavy 判定从纯字符数升级为加权分（代码围栏字符双倍、每个数学公式按固定成本、reasoning/tool-call 低权重），覆盖「多代码块中等消息」这类旧阈值漏网场景；多条 heavy 消息的 settled 翻转走全局串行队列（默认间隔 120ms），会话打开/多步回合不再同帧集体触发全量解析+shiki+KaTeX 突发；会话列表 store 发布门控把流式期间「仅投影身份变化」（usage/token 计数等）的 flush 合并到约 1Hz 尾部补发（可见字段变化仍立即发布），实测 30 秒 30 次无效整树重渲染降为 3 次；流式转发冷却（`dsh-perf-stream-cooldown`，默认关闭的实验项）；消息行 `content-visibility:auto` 近似虚拟化（已修复选择器语法错误，HUD 关闭时也独立生效）；`会话尾部完整性观察探针`在真实 GUI 中监听回合结束边沿，核对最终消息 finalNode、窗口尾与主机 history 尾部的 seq 一致性、编辑框残留（忙碌态点「停止」后草稿保留的签名），发现写入 localStorage 环形缓冲并 console.warn，用于定位「跑完不显示最终内容」一类现场；agent 空闲徽标。

## 安装

在你的 profile（如 `~/.dsh/profiles/web`）中：

```bash
pnpm add @linxin666/dsh-perf
```

并在 `cordis.patch.yml`（或 bundle patch）中插入：

```yaml
- insert:
    - id: dsh-perf
      name: '@linxin666/dsh-perf'
      config:
        enabled: true
        mode: balanced
        meterIntervalMs: 2000
        statsWindowSeconds: 120
        alertPreset: standard
        hudEnabled: false
        renderDegrade: true
```

重启 `dsh web`（Web 模式加载期不启用 HMR）使 host 半生效；客户端半刷新页面即生效。HUD 面板与各开关在「设置 → Web 插件 → 性能引擎」卡片中开启。

## 配置

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关；关闭后 host 停止订阅/采样、HUD 隐藏、CSS 降载停用 |
| `mode` | `balanced` | `off` / `balanced` / `aggressive` |
| `meterIntervalMs` | `2000` | 采样周期（1s-60s，热切换） |
| `statsWindowSeconds` | `120` | 速率窗口（10s-1h） |
| `alertPreset` | `standard` | `light`（10 会话 / 1000 ev·s⁻¹）/ `standard`（5 / 300）/ `strict`（3 / 150） |
| `hudEnabled` | `false` | HUD 检测面板（浏览器侧） |
| `renderDegrade` | `true` | 渲染降载（assistant-step shadow 懒高亮 + 翻转串行队列 + 列表发布门控；逐像素一致，无折叠） |

## HUD / 面板

- 服务端：events/s、活跃会话数、事件循环 p99/mean 延迟、RSS/Heap、实际写批延迟（从运行时持久化服务读取）。
- 浏览器：FPS（近 1s）、Longtask（近 60s）；× 将面板收缩为小标签（点击展开）。
- host 端点连续 3 次不可达时自动隐藏（host 半缺失时静默降级）。
- 空闲 agent 在会话行尾显示 `·idle` 徽标（来自 `agent/status` 迁移事件，零上游改动）。

## 边界与上游

- `/api/dsh-perf/stats` 仅提供聚合指标（不含会话内容）；loopback 守卫复用 shared/host/loopback.ts（同源 + 127/8 + sec-fetch 标记）。
- 发射侧聚合与推送帧批量在 core（agent-loop / client-runtime），插件不做破坏性替换；实测证据在 repo 的 docs/dsh-perf-optimization-report.md（内部研究，不走上游 PR）。
