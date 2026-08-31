# Agent Note：会话归档管理后续修复（标题、开关、默认值）

Status: implemented

## Problem

`dsh-session-archive` 首轮真实使用暴露三个缺陷：

1. **归档会话标题未解析。** 清单只从聚合投影缓存索引
   （`storages/session_projcache.json`）补充标题，而该索引只覆盖近期会话。
   较老与已归档的会话即使 per-session 投影缓存文件
   （`storages/session_projcache/sessions/<id>.json`，version 4 `record` 结构）
   中仍保有 `record.rows.title.val` 与 `record.identity`，也一律显示
   `（无标题）`。
2. **自动维护两个开关看起来点不动。** `AutoSettingsPanel` 在渲染时读取
   `settings.getSnapshot()`，但 `useSyncExternalStore` 只订阅了 controller
   store。settings 镜像在每次写入被接受后都会替换快照对象；缺少订阅时受控
   checkbox 永远不重渲染，宿主写入成功在视觉上不可见。（`dsh-usage` 的同款
   写法被它的轮询重渲染掩盖了。）
3. **天数默认 30/90 太重**，两个默认值都应改为 7 天。

## Decision

1. `buildInventory` 在索引补充之后追加一次有界回退：仍缺 title/createdAt/cwd
   的行读取各自的 per-session 投影缓存文件（`readProjcacheFile`，容忍损坏/
   缺失文件，`record ?? parsed` 兼容结构漂移）。文件永不制造行（无幽灵）；
   归档服务用 per-id 缓存（`InventorySources.projcacheFiles`）记忆文件事实，
   避免重复清单遍历反复读盘。索引事实保持优先（先应用）。
2. `AutoSettingsPanel` 改用
   `useSyncExternalStore(props.settings.subscribe, props.settings.getSnapshot)`
   订阅，开关立即反映被接受的宿主写入。
3. `DEFAULT_AUTO_CONFIG.autoArchiveDays`/`autoDeleteDays` 与宿主 schemastery
   schema 默认值 30/90 → 7/7（config.ts + index.ts + README 双语 +
   auto-rules.spec 回退断言）。

## Alternatives considered

- **从会话日志读标题**：legacy `session.jsonl.zstd` 是压缩格式，为投影缓存
  已有的事实引入 zstd 依赖不划算。否决。
- **非法天数输入钳制保存**：此前已否决（非法值绝不保存）；维持不变。

## Consequences

- 存在 per-session 投影缓存文件的老会话/归档会话能解析出真实标题；目录、
  feed、文件三者皆无的行保持 `（无标题）` 并带 `no-data` 标记（真幽灵）。
- 两个自动维护开关完整回路：点击 → 宿主写入 → 镜像快照 → 重渲染；状态
  跨刷新保持。
- 全新安装两个阈值默认 7 天；用户已显式保存的值不受影响（schema 默认只填充
  缺失字段）。
- 已在沙箱 QA 实例（全新 `DSH_HOME`，端口 3999）验证：仅有投影缓存文件的
  播种会话解析出 `早安测试`，索引优先于文件（`索引标题二`），仅有目录的
  会话保持 `（无标题）` 并带异常标记；两个开关可勾选且跨刷新保持；天数输入
  显示 7/7。证据：`/tmp/qa-evidence/22..24-*.png`。宿主半区改动需用户侧重启
  DSH 后在真实实例生效；客户端半区的开关修复刷新页面即送达。

## 同日后续：删除后的选择集幽灵与跳过呈现

**Problem.** 真实实例上一轮 371 个目标的批量删除后，5 条已归档行仍然可见，
选择条停在「已选 371 项」。对真实 home 的取证：这 5 个会话从未被删除——
存储目录完好，`archivedSessionIds` 恰好剩这 5 条——因为它们仍被运行中的
DSH 进程持有（活跃 SessionStore 成员）。批量对话框确实报告了跳过，但用的
是 `running` 原因（「会话正在运行」），对闲置挂载的会话是错误文案；而且
删除后的清单刷新没有剪枝选择集（371 个 id 里 366 个已不存在），摘要行还
声称有 366 项在筛选结果之外。

**Decision.**

1. `setInventory` 把选择集剪枝到仍存在于新行中的 id。跨筛选变化保留选择的
   语义不变；只丢掉清单已不再知道的 id。
2. 新增稳定原因码 `attached` 表示进程持有成员；feed 报告运行中的行仍用
   `running`。文案：zh「会话仍被 DSH 进程占用，重启服务或关闭该会话后可
   删除」/ en / ru（中央包）。
3. 完成态的批量对话框按原因聚合跳过项（`跳过明细：… ×n · …`），371 规模的
   结果一眼可读；per-id 明细列表保留。

**Consequences.** 保护语义不变——被运行中 DSH 进程持有的会话在服务重启或
会话关闭前仍不可删除；变的是 UI 现在如实说明原因，选择计数反映真实。QA
已验证：全选 3 条播种会话 → 批量删除 → 对话框 `成功：3 / 跳过：0`，选择
计数剪枝为 `已选 0 项`。证据：`/tmp/qa-evidence/25..27-*.png`。

## 同日后续 2：裸 UUID 的 harness id 让所有批量操作失败

**Problem.** 用户重启后，213 个目标的批量删除每个分片都报 400
`no session ids`。对真实 home 的诊断：这台安装的 harness 原生混用两种 id
拼写——feed、注册表归档集合与会话存储对大量会话持有**裸 UUID**（feed
741 行中 309 行；归档集合与插件台账当时 100% 是裸 id），其余行则是
`session-<uuid>`。路由的 id 校验只接受带前缀拼写，于是每个 id 都被丢弃、
空数组守卫回了 400。更早的 371 规模删除能成功，是因为当时部署的构建还没
有这个严格校验。

**Decision.** 插件内部统一一种规范形式，harness 边界使用原生拼写：

1. `buildInventory` 把它产出的每个 id（feed 行、父子链接、工作区成员、
   归档集合成员、台账查找）经 `canonicalSessionId` 规范为 `session-<uuid>`，
   并为见过的每个非规范拼写记录 canonical→native 映射
   （`BuiltInventory.nativeIds`）。
2. `routes.idList` 接受两种拼写，拒绝路径不安全字符串（id 会进入文件名），
   并在服务层看到之前规范化。
3. 面向 harness 的调用传原生 id：`archiveSession`、`inspect`（预览）、rdb
   删除（双拼写尝试）、归档集合取消与工作区行移除按规范等价比较并原样
   保留其余存储条目。
4. 归档台账与投影缓存清理写规范键、双拼写清理（现存 207 个裸 id 台账键
   经双格式查找继续可读并自然退役）。

**Consequences.** 混拼写的安装端到端可用；wire 格式统一为规范形式；遗留
裸 id 台账键可读并自然清理。修复前页面里的选择（裸 id）会被清单刷新剪枝
（行已是规范形式），用户重新全选即可。单测覆盖：裸 feed id → 规范行 +
父子链接 + 归档标记；裸 id 走删除路由清理裸归档集合条目；路径不安全 id
仍 400。
