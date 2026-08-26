# Agent Note: 在应用新皮肤 hooks 前先清理旧皮肤激活

Status: implemented

## 问题

动态切换皮肤（或从试穿预览直接应用皮肤）时，运行时原先在调用 ledger.disposeActivation(previous) 之前就执行了新激活的 installHooks。这导致旧激活的清理闭包在新皮肤已经挂载 DOM 节点、注册 observer 和写入 body 属性之后才执行。对于在清理阶段会移除文档级属性或 DOM 节点的皮肤（如 orca-link、maid-atelier 或 miku），旧激活的销毁逻辑会清除全局属性（data-dsh-orca-link、data-orca-settings-open、data-orca-sidebar-wide）并移除新挂载的 chrome 节点（如 DSH 矢量标、状态操作员小人和标语打字机），导致界面停留在异常或未完成样式状态，必须刷新页面才能恢复。此外，data-dsh-skin 属性在 installHooks 之后才写入 documentElement，导致 hook 首次执行期间无法基于已生效的 CSS 尺寸进行计算。

## 决策

在 skin-controller.ts 中：
1. 新皮肤的样式表继续优先在 document head 中预加载，避免无样式闪烁。
2. 新样式表就绪后，在执行新皮肤的 hooks 和 DOM 变更之前先销毁旧激活（ledger.disposeActivation(previous)）。
3. 销毁旧激活后立即在 document.documentElement 上写入 data-dsh-skin，确保所有以 html[data-dsh-skin] 作用域限定的 CSS 规则在新皮肤安装背景和 hooks 时已经完全生效。
4. 在清理后的纯净 DOM 上安全执行 installBackground 与 installHooks。

## 考虑过的替代方案

- 否决了在每个具体皮肤 hook 内部判断是否存在同一皮肤的另一个激活实例，因为 hooks 是作为隔离的 ESM 模块分发的，不应也不需要跟踪控制器的跨激活状态，且跨皮肤属性清理（如全局 class 或 style 清理）仍会冲突。
- 否决了通过延时销毁旧激活，因为异步延迟清理会在用户快速切换皮肤时产生非确定性的竞态条件。

## 影响

动态皮肤切换、试穿预览以及重复应用操作现在会在挂载新皮肤前干净地卸载旧皮肤。新皮肤 hooks 挂载的全局属性和 DOM chrome 完好保留，无需刷新页面。全 Monorepo 测试全部通过，并在 skin-runtime.spec.ts 中增加了锁定 previous:cleanup -> next:apply 严格生命周期次序的专用测试。
