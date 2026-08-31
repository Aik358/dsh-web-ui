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
