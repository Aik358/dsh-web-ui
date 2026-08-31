# 会话归档管理端到端验证快照（2026-08-31）

Status: validated on a real DSH Web instance. English summary at the bottom.

## 验证环境

- 提交：`dev` 分支 `e1d650976`（feat(session-archive)）+ 本次修复提交。
- QA 实例：独立沙箱 `DSH_HOME=/tmp/dsh-qa-home`，profile `session-archive-qa`（复制自
  `web` profile，`autoTunnel: false`），`dsh --profile session-archive-qa --port 3999`。
  真实运行中的 DSH 服务（端口 3080）全程未重启、未受影响。
- 证据截图：`/tmp/qa-evidence/01..17*.png`（空态、列表、预览、批量进度、删除确认、
  跳过原因、自动维护校验、移动端、控制台无报错）。

## 覆盖场景（对应任务验收清单）

1. 单会话归档/恢复/物理删除：GUI 批量归档 2/2 成功、行级取消归档成功、行级删除
   成功（磁盘目录、workspace.json 行、archivedSessionIds、projcache、台账五处同步清除，
   幽灵行计数为 0）。
2. 多选/全选：全选覆盖完整筛选结果（服务端以 `expectedTotal` 复核，仅在实际将删除
   更多时 409；保护导致的缩小以 skipped 结果呈现）。
3. 保护规则：当前会话（`会话当前正在查看`）、运行中会话（`会话正在运行`）、活跃
   SessionStore 成员（feed running=false 但仍 attached）均被跳过且原因明确；批量
   统计 2/2 跳过准确。
4. 强确认：全选大批量删除（952 行场景）时确认按钮禁用，勾选"我已知晓"后才可用
   —— 该门禁在实际事故中阻止了一次自动化脚本对真实实例的误删。
5. 自动维护：默认关闭；天数输入 0 被拒绝并显示"天数必须是 1 到 3650 之间的整数"，
   settings.yaml 不落盘（修复前曾发生 clamp 静默保存 1 的缺陷，已修复）；合法值 30
   即时保存；预览计数、立即执行、上次运行/下次检查展示正常。
6. 重启持久性：QA 实例三轮重启后台账、运行状态、设置均保持。
7. i18n：zh 全量、en 对照（i18n:check 16 命名空间 1298 键全绿）；卡片内动态原因/
   异常标签键修复为 kebab-case 与 wire code 对齐；ru 由 dsh-i18n 集中承载（家族
   设置卡惯例：卡片正文 zh/en 回退，槽位标签走 locale.bind）。
8. 移动端：390px 视口下 shell 移动抽屉可达该区块，全部控件存在于 DOM（语义属性
   `data-dsh-plugin="session-archive"` + `data-dsh-part`）；卡片自身 CSS 有 640px
   断点（批量按钮整行、行操作横排）。
9. 控制台：全程 window error / unhandledrejection 监听为零报错。
10. 真实实例：用户侧 20:04 的 `dsh web` 重启已自动挂载本插件（web profile link 闭包
    + 聚合行），`/api/dsh-session-archive/inventory` 200，调度器已布防
    （`~/.dsh/dsh-session-archive/state.json`），真实数据未被测试触碰。

## E2E 中发现并修复的缺陷

- `ctx.workspaceRegistry` 属性访问需要 `inject` 声明（`cannot get property without
  inject`）→ host inject 增加 `workspaceRegistry`。
- 计划不符校验由"不相等即 409"改为"仅当宿主将删除更多时 409"，保护性缩小走
  skipped 结果（避免当前会话保护把整批打成 409）。
- 确认对话框"因父子关系一并删除"在目标数小于直接选中数时出现负数 → 改为按
  targets 集合计数。
- 天数输入 blur 时 clamp 静默保存非法值 → 改为仅保存合法整数，非法值留在输入框
  并显示错误。
- API 错误信息透传服务端 error 详情，批量失败可见真实原因。

---

English summary: end-to-end validated on a sandboxed real DSH Web instance
(fresh DSH_HOME, official `dsh --profile` boot): inventory, filters/search/sort,
full-result-set select-all, batch archive (2/2), row unarchive (ledger reset),
single and batch physical delete (all five storage traces removed, no ghosts),
protected-session skips with reasons (current / running / live-attached),
strong-confirm gate on large deletes (which factually blocked an automation
misclick against the real instance), default-off auto policies with strict day
validation (invalid values rejected, never saved), restart persistence, zero
console errors, and the plugin auto-mounted on the user's real instance after
its 20:04 restart. Five defects found during E2E were fixed and re-verified
(see list above); screenshots in /tmp/qa-evidence/.
