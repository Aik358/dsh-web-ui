# dsh-perf

DSH Web 性能观测与治理插件。把"卡顿"变成可读指标，并对可配置的环节做声明式治理。

## 它会做什么

三层能力，全部以插件形式交付（不 fork core、不做运行时黑魔法）：

1. **观测（Phase 1）**：Host 侧 `PerfMeter` 订阅 cordis `session/event` 总线，采样事件速率（总/每会话/类型分布）、事件循环延迟（perf_hooks）、内存，并通过 loopback-fenced `GET /api/dsh-perf/stats` 暴露；浏览器侧 HUD 显示服务端指标 + 本地 FPS / Longtask 采样。

2. **治理（Phase 2）**：`cordis.patch.yml` 作为 bundle patch 声明式覆盖 `session-persistence-jsonl` 行的写批延迟（200ms → 500ms，流式时批次 fsync 频率降低约 2.5 倍），并支持 `mode: off | balanced | aggressive` 与 Settings 面板热切换。

3. **策略（Phase 3）**：写批延迟即"fsync 分级"的插件化切口——持久化后端在每批提交时 fsync（core 硬编码），批延迟越大 fsync 越稀。更根本的聚合（流式 token 发射侧聚合、推送帧聚合）需要 core 支持，见"边界"。

## 安装

在你的 profile（如 `~/.dsh/profiles/web`）中：

```bash
pnpm add @linxin666/dsh-perf
```

并在 `cordis.patch.yml` 中插入：

```yaml
- insert:
    - id: dsh-perf
      name: '@linxin666/dsh-perf'
      config:
        enabled: true
        mode: balanced
        meterIntervalMs: 2000
        statsWindowSeconds: 120
```

重启 `dsh web`（Web 模式加载期不启用 HMR）后生效，右下角出现 DSH PERF HUD。

## 配置

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关。关闭时 host 不订阅事件、不采样 |
| `mode` | `balanced` | `off`（仅路由）/ `balanced` / `aggressive` |
| `meterIntervalMs` | `2000` | 采样周期（1s–60s） |
| `statsWindowSeconds` | `120` | 速率窗口（10s–1h） |

## HUD

- 服务端：events/s、活跃会话数、事件循环 p99/mean 延迟、RSS/Heap、写批延迟（显示 patch 生效值）。
- 浏览器：FPS（近 1s）、Longtask（近 60s）。× 关闭后写 localStorage（`dsh-perf-hud-visible`）。
- host 端点连续 3 次不可达时自动隐藏（无 host 半 / 未启用时静默降级）。

## 边界与上游

- `/api/dsh-perf/stats` 仅提供聚合指标，不含任何会话内容；loopback 守卫复用 shared/host/loopback.ts（同源 + 127/8 + same-origin markers）。
- 逐 token 事件的"发射侧聚合"与"推送帧聚合"在 core（agent-loop / client-runtime）硬编码，插件不做破坏性替换。若 HUD 数据显示它们值得优化，向 dsh core 提 PR，本插件退化为"开关 + 验证器"。

