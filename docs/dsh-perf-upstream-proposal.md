# DSH 性能优化上游提案（终稿）

> 基于 2026-08-25/26 的 10 份研究报告（索引见 §6），目标环境：DSH 0.1.1-rc.2、macOS 10 核 / 16GB、多会话 + 多 subagent 流式场景。

## 0. 问题与实测基线

卡顿链路：每 token 一条事件（assistant/chunk/reasoning-chunks）→ session firehose 扇出 ~15-20 个同步 listener（持久化 structuredClone + 投影 eager drive + 每 mux 连接一个 api-proxy listener + 前端逐帧 push）→ 浏览器逐帧 double-zod parse + 全树 assemble。

实测（dsh-perf HUD / capture 脚本）：

| 场景 | events/s | 服务端 EL p99 | 备注 |
| --- | --- | --- | --- |
| 2 个流式会话 | ~18 | **21ms** | 基线（健康） |
| 5 个会话（2 主 + 3 sub） | ~168 | **129ms** | 放大 ~8× |
| 11 个会话（10 subagent） | **907/s** | **163ms** | 每个流式 subagent 贡献 ~90-115 events/s |

fsync 单批成本分解：open 0.09ms + write 0.14ms + **fsync 3.75ms（占 92%）** + close 0.05ms = 4.08ms/批；8 会话 × 500ms 批 = 60ms/s 线程池；慢盘/网络卷上线性放大（100ms fsync × 16/s 即池饱和）——这才是"拖累事件循环"的真实机制。

## 1. 提案总览（18 项，按波次）

| # | 波次 | 项目 | 要点 | 收益 | 风险 | 来源 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | W1 | fsyncEveryNBatches | jsonl 后端配置项（默认 1=现状，推荐 4），检查点/append 服务/commitRepair 恒 durable | fsync 率 16/s→4/s；N=1 时逐字节等价 | 低（断电窗口 ≤4 批 ~2s，恢复路径已有 torn-tail 兜底） | fsync 报告 |
| 2 | W1 | persistence 去 structuredClone | enqueue 引用持有（事件已 deepFreeze 不可变）；超大 payload 按体积分级 | 消除每事件深拷贝；MB 级 tool/result 同步拷贝归零 | 低 | 优化点报告 S2 |
| 3 | W1 | 客户端 WS 帧校验快路径 | 按 payload.type 极简形状检查，完整 zod 降级 DEV/未知帧 | 每帧省 ~2.2-3.3µs | 低（同源 WS） | S?/F1 |
| 4 | W1 | push 帧 rpcId 复用 | 非应答帧共享 PUSH_RPC_ID（approval/question 保持 mint） | 每 token 省 randomUUID | 低 | S6 |
| 5 | W1 | 投影 drive 类型分桶 + 惰性视图 | unit 声明 matches(event)，chunk 只路由关心它的 unit；onChanged 才 parse | 每事件省 N 次 apply+zod | 低-中 | S8 |
| 6 | W1 | 写批窗公开配置 + zstd level 配置 | maxDelayMs 提为公开配置（默认 200 不变），zstd level 1 选项 | 治理可声明、减线程池争抢 | 低 | S3（调度器后置） |
| 7 | W1 | publication 默认帧级 | dsh-client-runtime 两处 ?? "immediate" → "animation-frame"（约 11 个未声明定义统一帧级） | 旧构建每 token 渲染降 40-70%；当前版本语义对齐 | 低（受控输入路径禁改） | 渲染热路径 |
| 8 | W1 | 流式长文本分块渲染 + block 级 memo | 段落边界切 assistant blocks；AssistantMarkdown 的 blocks 引用稳定化 + ReasoningRow 尾窗 | 长单段 O(n²)→O(n)，30-60% 主线程 | 中（跨块 markdown 连续性需保留合并逻辑） | F3/F4 |
| 9 | W1 | history 页事件体积上限 | paginate 加 maxEventsPerPage/maxBytes（切点按事件组边界） | 打开大会话的启动尖峰削平 | 低-中（hasMore 兜底） | F6 |
| 10 | W2 | assistant/chunk 免深拷贝快路径 | appendChunk 专用路径：一次校验 + 顶层冻结，不可变性责任移交生产者 | 每 token 3 次整图遍历→1 次浅操作 | 中 | S1 |
| 11 | W2 | tool/result 大 payload 落盘引用 | 超阈值（如 1MB）入 log 前落盘为 {ref, bytes, preview}，复用 dsh-spill | 单事件同步尖峰消除 | 中（回放/导出需解引用） | S9 |
| 12 | W2 | 窗口 chunk 折叠 | installWindow/prepend 对已 settled chunk 折叠（sourceEventSeqs 保留 + 占位） | 窗口事件量降 1-2 个数量级 | 中（审计 retry/投影 seq 依赖） | F5 |
| 13 | W2 | api-proxy 共享 fanout + 按会话过滤 | 全局一个 listener + sessionId→queue 分发（broadcast 先例）；连接只注册队列 | 消除 N×listener 重复工作 | 低-中 | S5 |
| 14 | W2 | 会话休眠 micro-patch + 分层冻结 | ISessions.sleep(id)/touch(id) + 驻留谓词细化（~30-50 行，与 pruneScopes 同构）；L1 可见性 → L2 LRU（默认开：10min/8 驻留/30s 防抖）→ L3 服务端回收（默认关） | 前端 1.2GB/114% 主因（实例驻留 + events 只增不减） | 中（current/running/pending 恒驻留；不裁部分窗口——assembler 契约） | 休眠 + 前端内存 |
| 15 | W2 | agent 空闲降载（dormant + goals.disarm） | 判定=agent/status idle + whenIdle settle + inbox 空 + 无 armed 唤醒；只做 dormant 标记 + disarm，不释放对象 | 切断自动唤醒源 + 可观测 | 中（maintenance/竞争窗口） | 空闲降载 |
| 16 | W3 | session/events 批量帧 | 服务端 30-50ms 合并（每批 1 UUID/stringify/send，共享 ticker；assistant/chunk 入批，step/tool/边界事件立即 flush；approval/question/queue/jobs/projection 绝不入批）；客户端 2 个 case 逐项走原 acceptLiveEvent | 帧数降 5×-40×；两端逐帧固定成本同步压缩；SSE/Electron 白得 | 中（新帧类型版本耦合；批内丢失粒度=1 批，history 回拉恢复） | WS 帧聚合 S7 |
| 17 | W3 | 前端可见性感知组装 | 非聚焦 session 只做轻量元数据 + liveBuffer 缓冲，切回 installWindow 式补拉 | 前端每 token 成本 ×N 会话 → ×1 | 高（接口不变，UX 需配置） | F2 |
| 18 | W3 | 服务端闲置回收（L3） | AgentRegistry 加按 id dispose 公开入口 + session/sleep RPC + 客户端行联动（dormant 徽标） | 唯一能减 SSE 广播与宿主内存的路径 | 高 | 休眠/空闲降载 |

## 2. Wave 1（建议一个迭代内完成：1-9）

关键实现点（函数级，详见各来源报告）：
- **1**：dsh-session-persistence-jsonl Config 增 fsyncEveryNBatches（默认 1）；appendLines 计数+条件 sync；coordinator 侧 startWrite/append 服务/commitRepair 传 durable 标记——共 10 处小改动，N=1 逐字节等价；慢盘部署保持 N=1。
- **2**：SessionWriteBehind.enqueue 取消 structuredClone（事件已冻结；log 本身持引用）；MB 级 event 写前压缩或走 spill。
- **7**：dsh-client-runtime/client.js :6520 与 :6586 两行默认值；replaceWindow/受控输入路径明确不动。
- **9**：dsh-host-apiproxy paginate（:969）在消息计数外增加体积/事件数上限，切点用既有 groupStart 逻辑。

## 3. Wave 2（6-13）

核心是"内存与尖峰"：休眠 micro-patch（14）与窗口折叠（12）相互独立；大 payload 引用（11）与 S2（2）配合使用。休眠的验收标准（13 条）见 docs/dsh-sleeping-tabs-research.md §10（含休眠中被审批、被 doctor 插件 prompt、重连唤醒、loadOlder 无重复等用例）。

## 4. Wave 3（14-16 架构级）

批量帧（16）是"对 21ms→163ms 最对症且可灰度"的一项：只动 events.mux 内一个 listener + schema 一个分支 + 客户端两个 case，不改 FrameQueue/WS 泵/Notifier/窗口/重连；批量帧内每项保留原 event.seq，去重/缺口/缝合逐事件不变；30ms 窗口 + 边界事件立即 flush 保住 TTFT 手感。附带可选：api-proxy listener 改 broadcast（13）可再砍 N 消费者重复成本。

## 5. 测量与验收（dsh-perf 插件担任验证器）

- 测量口径：每 token 事件平均固定开销 + EL p99（现有 HUD/capture 脚本已支持：```node /tmp/dsh-perf-capture.mjs --seconds 60 --interval 2```）。
- 每个 Wave 合并前后各跑一轮：同场景（2 会话 / 5 会话 / 11 会话）对比 events/s、EL p99、RSS、HUD 告警状态。
- 回归：fsyncEveryNBatches=1 逐字节等价；批量帧的 e2e 断言按批适配；休眠的 13 条验收。

## 6. 报告索引

| # | 报告 | 路径 |
| --- | --- | --- |
| 1 | 性能采集脚本 | /tmp/dsh-perf-capture.mjs |
| 2 | 前端会话实例内存剖析 | /tmp/dsh-frontend-memory-report.md |
| 3 | 写批 fsync 成本分析 | /tmp/dsh-fsync-report.md |
| 4 | 流式渲染链路 | （渲染热路径报告，含行号锚点） |
| 5 | dsh-perf 插件代码审计 | （M1-M4/L1-L2 已修复于 dev） |
| 6 | 消息窗口/UI 增强评估 | （P0 CSS 已入插件；P1 slot-shadow 待做） |
| 7 | DSH core 优化点深挖（S1-S9/F1-F6） | /tmp/dsh-core-perf-optimization-report.md |
| 8 | 服务端 agent 空闲降载 | /tmp/dsh-report-agent-idle-dormancy.md |
| 9 | USB 休眠机制设计 | docs/dsh-sleeping-tabs-research.md |
| 10 | WS 推送侧批量聚合 | （本提案 §4 依据，含 338B 帧实测） |

## 7. 插件侧现状（@linxin666/dsh-perf「性能引擎」）

已落地（dev，刷新即生效）：HUD（events/s、EL p99、FPS、Longtask、RSS、写批延迟）、逐会话告警（阈值 5 会话/300 events/s）、写批延迟 patch 500ms（可选治理）、P0 content-visibility 降载、设置卡（性能引擎）+ 总开关全栈联动、审计 M1-M4/L1-L2 修复。

插件上游价值 = 开关 + 验证器：Wave 1-3 每项合入后由 HUD/capture 提供前后对比；**P1（assistant-step shadow 懒高亮）为插件侧下一项**，无需上游。
