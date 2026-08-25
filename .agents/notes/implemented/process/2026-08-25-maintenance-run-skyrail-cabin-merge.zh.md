# Agent Note: 维护运行合并 Skyrail Cabin 皮肤并把守社区插件证据门槛

Status: implemented

## Problem

2026-08-25 的 /pr-issue-maintenance 运行覆盖 zhu1090093659/dsh-web 的开放 PR 队列（用户指示只处理 PR，默认范围：assignees 明确包含 zhu1090093659 的 PR）。当时开放 7 个 PR，除一个外全部在等待作者回应既有 CHANGES_REQUESTED 评审。社区插件登记 PR 是既定审查类型，要求提供实用性、上游稳定性与插件体系兼容性的证据。

## Decision

- PR #1087（Skyrail Cabin 皮肤）通过全部闸门并合并（squash，合并提交 42def344）。owner 评审早已批准；本次运行审批了最后一个 head（3d700112）上待运行 CI 与 agent-notes-guard 工作流，把 head rebase 到 origin/dev 后在本地重跑门禁（frozen-lockfile 安装、全仓 typecheck、全量测试含 skin-center 552/552 与 dsh-web-all 6/6、dsh-skin validate future-window PASS v1.4.3、skin-center/market/gallery/aggregate/docs 检查全绿），然后 squash 合并。四项必需检查（CI checks、plugin-mount、guard-agent-notes、Validate PR contribution evidence）在合并 head 上均为 success。
- PR #1098（dsh-agent-plugins-market）：核实上游证据后发出复审回复。安装确认已存在（InstallConfirmModal 展示 surface 数量、版本与可执行警告；取消不发请求；catalog.install() 确认后写入 enabled），npm 0.5.2 已发布。review 判定保持 CHANGES_REQUESTED，因为「拒绝/取消后不得启用或启动进程」回归测试缺失，确认弹窗未展示锁定来源提交，且 Windows 与可复现运行证据仍空白。
- PR #1118、#1100、#1093、#1070、#1031：未发表任何评论。既有 changes-requested 评审保持有效；作者未推送或回复。上游 dsh-fulltext-search 已发布安全修复（仅用服务端会话 cwd、security-test.mjs、CI 矩阵、v0.1.1），但 PR 证据未更新。dsh-archive-button 仍使用已被否决的 host 伺服字符串补丁架构。

## Alternatives considered

- 对已批准的 #1087 重新评审：否决，批准后的提交只是从 diff 移除 Agent Note 文件并重新生成 market 产物，本地验证已覆盖最终 head 与最新 dev。
- 自动关闭 #1100 / #1093 / #1070 / #1118 / #1031：否决，自动关闭仅适用于无维护者回复的新功能 PR；这些都有既有维护者评审。
- 按作者回复合并 #1098：否决，两项评审要求的证据仍无法核实。
- 本次运行评审开放 Issue：用户显式限定范围（只处理 PR），排除在外。

## Consequences

dev 现已发布 Skyrail Cabin 皮肤；Skin Center client 获得 data-dsh-part="new-session" 契约及其语义适配覆盖，market 与 gallery 产物已重新生成。四个待定社区插件在作者证据到位前保持未收录。Skill 默认范围配置已从不存在的 zhu1090093659/dsh-web-ui 修正为 zhu1090093659/dsh-web（用户配置，位于本仓库之外）。