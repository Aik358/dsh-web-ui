# Agent Note: Maintenance run lands four registrations and pins the clean-clone stability bar

Status: implemented

## Problem

2026-08-31 维护轮共有九个 PR 关联到 owner：七个社区插件索引登记、一个四皮肤内容 PR、一个带着作者侧阻塞项停摆的登记。本轮要解决一个此前运行没遇到的闸门冲突——clean-checkout `market-build --check` 脚本测试现在跑在每个 PR 的 merge ref 上，不带重新生成 `market/dist` 的内容 PR 会挂 CI，而 #1239 时代的先例是合并后由维护者在 dev 上重建 dist；同时还要对上游没有 CI 的插件登记 PR 给出一致的稳定性标准。

## Decision

- 四个登记经正常 PR 流程落地，均为 squash 合并、必需检查全绿并有批准评审：#1245（tokyo-night 皮肤，d77b75d18）、#1282（dsh-prompt-enhance，7bd7c786e）、#1285（dsh-completion-guard，be426dacb）、#1309（dsh-session-enhance，a5890951d）。每一项都由维护者把最新 dev 合进 PR 分支，把 `community.json` 规范化到当前契约（源码条目不带 `rank` 字段——清单按位置分配 rank，解决冲突时丢弃 PR 携带的 rank 字段），用 `scripts/market-build` 重新生成 `market/dist`，再通过一次性命名 remote 把结果推到 fork 的 PR 分支。重建的 dist 随 PR 落地，取代 #1240/#1299 的"先合并再在 dev 重建"形态：这是让 clean-checkout 闸门不经 bypass 合并就变绿的办法，也让 dev 在两次推送之间从未变红。
- 插件登记的稳定性标准是干净克隆验证，而非自报证据：维护者克隆上游仓库并运行其接线的门禁。#1309 按该证据落地（干净克隆 41 个上游测试全过、打标签发布工作流强制跑测试、LICENSE 文件在位、storage-sweep 删除层做精确 sessionId 剥离、原子写、失败降级）。#1306（dsh-audiogen）与 #1318（dsh-git-badge）退回作者：干净克隆 typecheck 与 build 通过，但两个仓库都没有接测试 runner（无 test 脚本、无 CI；#1306 唯一的测试文件是孤儿，#1318 根本没有）——对暴露本地 HTTP/SSE 路由或执行 git 的插件，常设门禁是必需的，与 #1144 立下的标准一致。#1321（dsh-memory）因来源问题退回：登记仓库里的实现与已发布的 npm 产物不同（JSON 文件加关键词评分、默认路径硬编码 `D:\\插件\\memory`，对比 npm 包的 `node:sqlite` FTS5 存储与 `dshHomePath`），而索引条目的 repo 链接必须是用户安装产物的源码。
- Fork PR 的 `pull_request` workflow 运行（CI、agent-notes-guard、plugin-mount）在维护者按 head SHA 逐个批准前处于 `action_required`；每个新推送的 head 都会重新进入该状态，读门禁前先批准。
- #1316（四皮肤）留给作者：四套皮肤 `dsh-skin validate` 全过，hooks 是纯装饰粒子且已被 reviewed-hooks 注册表覆盖，CC-BY-NC-SA-4.0 资产授权沿用 maid-atelier/orca-link 先例，但四个皮肤目录全部缺少必需的中英双语 README，且正文里的本地验证与证据两节已损坏（截图发在评论区不满足只读正文的检查器）。#1144（dsh-deepsea）按 2026-08-25 的 CHANGES_REQUESTED 继续停摆；上游无动静。
- 两处基础设施红灯按重跑处理而非判定为 PR 缺陷：plugin-mount 钉版安装 `@deepseek-ai/dsh@0.1.2-alpha.2` 时对 `@deepseek-ai/dsh-session-turn-outline` 得到 404，随后该包发布 0.1.2-alpha.3 使范围解析恢复；一次 actionlint 步骤 Docker 拉取失败。两次重跑都转绿。
- 有意不塞进内容 PR 的已知欠账：已提交的 `market/dist/tryon` 树仍反映 2026-08-24 重构前的 shell 构建（2026-08-27 的 shell 重构从未传播——上一次 dist 重建走了无 shell dist 的 preserve 路径）。维护侧在 dev 上做 shell 重建加 dist 重建是后续事项，本轮刻意排除在内容 PR 之外以保持其 diff 最小。

## Alternatives considered

- 对 #1245 保持"先合并再在 dev 重建"形态：否决——它需要对一个明知是红的必需检查做 bypass 合并，且让 dev 在两次推送之间变红；把重建的 dist 推到 fork 让每个闸门都保持诚实，也不增加额外往返。
- 把 tryon shell 刷新一并塞进 #1245 的 dist 重建：否决——内容 PR 里出现 379 个哈希 bundle 的变动；该刷新是 dev 上的维护侧任务。
- 仅凭维护者一次性干净克隆 typecheck/build 就接受 #1306 与 #1318：否决——一次性检查管不住后续提交，且两个插件都带安全敏感面（上游音频代理与 API 密钥处理；HTTP/SSE 路由后的本地 git 执行），常设 CI 是更便宜的长期控制。
- 由维护者直接替 #1316 修改损坏的证据小节：否决——勾选项是贡献者的自测声明，维护者不替他人背书证据。

## Consequences

- 账本达到 52 条；四处落地均已在 origin/dev 确认，携带它们的 dev CI 全绿。
- 后续登记默认由维护者解决 dev 冲突，并在 fork 允许维护者编辑（`maintainerCanModify`）时经 PR 本身携带重建的 dist；对 fork 分支的 amend 推送使用钉住先前确切 head 的 `--force-with-lease`。
- #1306、#1318、#1321 与 #1316 带着评审中记录的具体阻塞项等待作者；#1144 维持既有评审继续停摆。
- tryon/shell 漂移在维护侧重建落到 dev 前持续存在；期间已提交的 dist 保持内部自洽（哈希清单与文件一致），clean-checkout 闸门继续通过。
