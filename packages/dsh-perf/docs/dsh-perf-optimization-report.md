# DSH 性能优化研究报告（dsh-perf 插件配套）

> 基于 2026-08-25/26 的 10 份研究报告（索引见 §6），目标环境：DSH 0.1.1-rc.2、macOS 10 核 / 16GB、多会话 + 多 subagent 流式场景。\n>\n> 定位：内部优化研究与插件增强依据（上游 PR 路线已终止，见 dsh-perf README「边界」）；报告中信号标为「上游」的项保留为实施事实记录，实际落地以插件侧能力为准。

## 0. 问题与实测基线

卡顿链路：每 token 一条事件（assistant/chunk/reasoning-chunks）→ session firehose 扇出 ~15-20 个同步 listener（持久化 structuredClone + 投影 eager drive + 每 mux 连接一个 api-proxy listener + 前端逐帧 push）→ 浏览器逐帧 double-zod parse + 全树 assemble。

实测（dsh-perf HUD / capture 脚本）：

| 场景 | events/s | 服务端 EL p99 | 备注 |
| --- | --- | --- | --- |