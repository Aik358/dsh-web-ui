# Agent Note: Telemetry users badge stays servable under D1 overload

Status: implemented

## Problem

README 的 "users" shields 端点徽章渲染为 "inaccessible"。shields 在 D1 过载窗口抓取 `/api/telemetry/badge/users` 时，Worker 以未捕获异常 `D1_ERROR: D1 DB is overloaded. Requests queued for too long.` 崩溃，shields 拿到的是 Cloudflare 1101 错误页（HTTP 500）而非徽章 JSON。一次生产流量下的 `wrangler tail` 在十分钟内捕获到数百个失败请求——包括徽章本身、`/api/stats` 读取与遥测写入。徽章计数是对 `telemetry_events` 的全表 `COUNT(DISTINCT)` 扫描，过载窗口内的读取几乎都可能抛异常。

## Decision

- `handleTelemetryUsersBadge`（`market/worker/src/telemetry.js`）把响应以 Cache API 缓存在边缘 30 分钟（与既有 `cache-control` 头一致），并在另一个缓存键下保留一份 24 小时的 stale 副本。D1 出错时返回 stale 副本；没有 stale 副本时返回合法的 `{"schemaVersion":1,"label":"users","message":"unavailable","color":"lightgrey"}` 200 JSON。该 handler 不可能再产生 5xx，README 徽章在故障时退化为灰色 "unavailable" 而非 "inaccessible"。
- `handleTelemetryPost` 捕获 D1 写入错误并返回 `503 {"ok":false,"error":"storage-unavailable"}`——与既有缺绑定分支同构——而非未捕获异常页。客户端把未接受视为「下次挂载再补报」，与 docs/telemetry.md 记录的 fire-and-forget 契约一致。
- 公开契约文本同步了同样的事实：docs/telemetry.md（徽章条目与客户端补报段落）、api-doc.js 端点表（徽章缓存、事件 503）与 OpenAPI 描述。

## Testing

本地 `wrangler dev` 加本地 D1：徽章计算出种子数据的去重访客数；再插入一个访客后返回值保持缓存值（边缘命中）；表存在时删掉 `telemetry_events` 仍返回缓存计数；清空缓存后返回 200 "unavailable" JSON；重建表后恢复实时计数；删表状态下 POST 返回 503 JSON，恢复后重新成功。

## Alternatives considered

- 维护计数表（去重访客行加总计计数器）让徽章读单行而不是全表扫描：消除扫描但要增加 schema、迁移与写入路径复杂度，而该查询现在每 colo 至多每 30 分钟执行一次。以不成比例为由否决。
- 只调 shields 侧 `cacheSeconds`：shields 的服务端缓存不受我们控制，过载期间任何直接抓取仍会拿到异常，徽章依旧是坏的。否决。
- 对心跳写入做采样或限流以消除过载本身：这是遥测架构决策（频率、聚合、存储档位），应当单独立项；本变更只负责让徽章与写入路径不再把裸异常暴露出去。

## Consequences

- 徽章数值最多旧 30 分钟，外加一个故障窗口；对全量累计数可以接受。
- 若 D1 在最后一次成功计算之后持续不可用超过 24 小时，徽章显示灰色 "unavailable" 而非数字。
- `/api/stats` 与 `/api/telemetry/summary` 在 D1 过载时仍以 Worker 异常浮出；它们是站点/仪表盘输入而非 shields 输入，需要单独决策。
- 过载期间遥测发送方会收到 503 并在下次挂载时补报；补报量以每浏览器一天为上界。
