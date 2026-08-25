# @linxin666/dsh-miku-pet

[English](README.md) | 中文

只属于 Miku 的浮动桌宠插件:手绘风 PNG 帧动画 + 工作 / 商店 / 属性玩法。
与内置 dsh-pet 在 `/miku-pet` 命名空间共存(entry id `miku-pet`,宿主路由 `/miku-pet/*`)。

## 功能

- **Miku 专属帧动画**:待机(停止)、挠头、眨眼 x2、吃饭、拖拽、摔倒→站起(standup)
- **随机待机(保底)**:待机时每 5 秒掷骰,60% 概率演随机动作;连续 2 次未抽中 → 下次必演
  (由 `assets/config.jsonc` 权重驱动:idle 40 / categories 60)
- **拖拽**:按住拖动时拖拽姿势循环;松手播一次"摔倒→站起"再回待机
- **点击 / 触摸互动**:点击加随机心情 +0~3;触摸头 / 身 / 腿按部位掷骰
  (头 5% → +5、身 10% → +10、腿 10% → +30 / 90% → -5 好感),触发专属 3 秒动画与固定台词
- **被动金币收入**:每分钟 +1 金币(无条件)
- **工作玩法 + 钱包**:菜单「工作」开启连续循环,每 10s 判定一轮(+3 金币成功 / -1 失败),
  未打断持续循环,钱包余额下限 0
- **商店**:金币购买食物恢复饥饿(小份 +40 / 大份 +80);游戏币:10 金币兑换 1 个;
  幸运彩票:10 游戏币/张,全属性 +10 并立即开奖(100万/0.01%、50万/0.08%、6666/0.35%、
  1000/1.2%、50/98.36%),开奖结果独立弹层展示
- **睡觉**:菜单「睡觉」循环播放睡眠动画(入睡帧播一遍后循环睡熟帧),每 30s 活力 +4,
  点击/拖拽唤醒
- **属性彩条**:悬停显示饥 / 心 / 活(0-100)与好感度(0-500);饥饿每 60s 衰减 1(工作 5)、
  心情 0.5、活力 0.25;好感度待机每 300s 衰减 1,触摸互动可增加
- **悬停菜单 + 改名**:浅色动漫风小菜单(名字 + 改名 / 钱包 / 商店 / 工作 / 睡觉 / 玩法说明);
  玩法说明为独立页面,逐条列出规则与彩票概率、期望值;名字存 localStorage
- **拖拽自由移动**:拖到哪停哪,位置持久化(localStorage),菜单提供「回角落」
- **多开 + 可配置**:设置页可加宠物、改大小与位置,保存即时生效

## 安装

### 从仓库(开发方式)

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-miku-pet
```

## 配置

玩法池与权重在 `assets/config.jsonc`(idle 40 / categories 60、5s 掷骰、保底、drag /
standup / clicks 池、台词 phrases)。

## 已知限制

- 帧素材为 WebP(q90,1024px);DSH home 动画目录里用户自放的 PNG 帧仍兼容。
- 工作 / 商店 / 属性等自定义玩法为插件特性,不映射到内置 dsh-pet 宠物注册表模型。

## 许可

MIT。本包改编自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)(MIT),
Miku 形象素材与玩法代码为本包新增。
初音ミク(Hatsune Miku)的角色名称、形象与肖像权归 Crypton Future Media, INC. 所有;
角色使用边界与 Piapro Character License 链接见 [NOTICE.md](NOTICE.md)。
