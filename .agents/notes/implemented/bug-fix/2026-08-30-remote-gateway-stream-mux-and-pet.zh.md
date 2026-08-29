# Agent Note: 网关流复用通道门控，手机镜像保留桌面宠物

Status: implemented

## Problem

官方界面适配改造后，扫码进入 `/pair-app` 的手机端并没有镜像 PC 上运行的 DSH：

1. **远程侧工作区/会话为空。** 应用要求用户重新选择工作区、会话列表显示"暂无会话"——与全新实例的形态完全一致。工作区注册表与会话存储都在主机侧，任意同主机浏览器看到的都是同一份数据；数据存在，但手机端客户端没有收到。
2. **桌面宠物在手机上不显示。** `@linxin666/dsh-pet` 已安装且启用，但竖屏触控适配层把它隐藏了。

## Decision

**门控通道现在覆盖官方流套接字。** 钉定的 0.1.2-alpha.1 线上客户端只打开一条常驻 WebSocket——Typert 网关多路复用流 `/api/remote.mux`——所有 Remote 流（工作区 follow、会话 feed、子代理谱系等）都走这条套接字。通道重写表里残留的是该版本已不存在的旧路径（`/api/events.mux`、`/api/events.host`），因此手机的 mux 从未被重写到 `/remote/api/remote.mux`：它直连隧道源站，被连接插件围栏与浏览器认证 cookie 拒绝（手机无 cookie 也无围栏信任），全部流随之失效。修复：

- `wsPaths` 现在包含 `/api/remote.mux`（外加侧边栏/ssh 终端）；解析期引导补丁与运行时补丁共用同一规则表。
- 主机注册精确升级路由 `/remote/api/remote.mux`，映射回内环 `/api/remote.mux`，保留无 cookie 凭据所依赖的 `device` 查询参数。
- 删除过时的 `events.*` 常量；契约钉定测试断言 mux 路径。

**竖屏触控层保留宠物。** `mobile-adapt.ts` 曾在"不适合手机的插件表面"列表里把 `[data-dsh-plugin="pet"]` 置为 `display:none`。宠物是全局浮动表面——固定定位、指针拖拽重定位（触屏可拖）、点击交互——不需要在应用布局里占位，因此隐藏它只是删掉了可用能力，而不是把桌面面板塞进手机。宠物行已从抑制规则中移除；其余抑制项（ssh、skill-explorer、task-board、git-graph、perf、usage）保持不变。

## Alternatives considered

- **不再列精确路径，而是代理 `/api` 下所有 WS 升级。** 否决：webserver 按精确路径派发升级，连接插件拥有 `/api/remote.mux` 路径；通用前缀代理会与网关自身升级路由竞争。精确镜像保证每条套接字一个路由，且每条前面都有设备门。
- **继续隐藏宠物并把它声明为仅桌面可用。** 否决：用户需求是手机对运行中桌面的明确镜像；宠物是主机全局表面，mux 走门控通道后数据链路本已通畅，本 cohort 上没有技术上隐藏它的依据。

## Consequences

- 手机端工作区/会话 feed 经门控通道送达；镜像与 PC 显示相同的工作区与会话，宠物也在手机上绘制（可拖拽，复用主机侧显示配置）。
- 引导脚本多一条路径项；环回源不受影响。
- 通道覆盖面与 cohort 精确对齐：未来 SDK 若更换流套接字路径，必须同步更新 `wsPaths` 与 `REMOTE_UPGRADE_PATHS`（两者出自同一规则表）——契约钉定测试会在漂移时失败。

## Testing

- 单元：mux 路径重写规则（运行时补丁 + 引导脚本）、精确升级路由 `/remote/api/remote.mux` → 内环 `/api/remote.mux` 且保留 `?device=`、移动适配样式表不再抑制宠物（其余抑制项保持）。包套件：283 个测试 / 26 个文件全绿。
- 实测（QA 实例 :3191，DSH_HOME=/Users/zcl/dsh-qa-home）：全新浏览器上下文 + iPhone 仿真经 LAN 源配对后落地 `/pair-app`；工作区列表与会话加载成功，`[data-dsh-plugin="pet"]` 的计算 display 为 block（见会话记录）。
