// 宠物页面：单个宠物实例（PetCard）+ 多开容器（PetMulti）。
// 工厂形态与 settings.ts 一致：client 半侧不能顶层 import react，
// react 能力由 DSH 运行时注入（rt），组件在工厂内制造。
// 动作配置在本模块持有：PetMulti 加载后赋值，PetCard 只读（单一事实来源 = config.jsonc）。
import { pick, rollKind, pickCategoryAction } from './pickers';
import { planMove } from './motion';
import { assertClientConfig, EMPTY_CONF, applyUserOverrides, stripJsonc, type UserOverrides } from './config';
import { CANVAS_H, FEET_Y, HIT_BOX, DRAG_THRESHOLD } from './constants';
import { petBridge } from './settings';
import type { ClientConfig, Corner, Pet } from './types';
import type * as ReactNS from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

/** 运行时配置（PetMulti 加载后赋值；PetCard 只读） */
let config: ClientConfig = EMPTY_CONF;

/** 内联 CSS —— 注入一次（官方插件标准做法） */
const css = [
  '.miku-pet-root{position:fixed;z-index:40;pointer-events:none;user-select:none}',
  '.miku-pet-root[data-corner="bottom-right"]{right:var(--miku-pet-mx,24px);bottom:var(--miku-pet-my,0)}',
  '.miku-pet-root[data-corner="bottom-left"]{left:var(--miku-pet-mx,24px);bottom:var(--miku-pet-my,0)}',
  '.miku-pet-root[data-corner="top-right"]{right:var(--miku-pet-mx,24px);top:var(--miku-pet-my,0)}',
  '.miku-pet-root[data-corner="top-left"]{left:var(--miku-pet-mx,24px);top:var(--miku-pet-my,0)}',
  '.miku-pet-stage{position:relative;width:var(--miku-pet-size,240px);height:var(--miku-pet-size,240px);pointer-events:none}',
  '.miku-pet-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;opacity:0;transition:opacity .18s ease;transform-origin:center}',
  '.miku-pet-video.is-front{opacity:1}',
  '.miku-pet-hit{position:absolute;pointer-events:auto;cursor:default;z-index:1}',
  '.miku-pet-hit.dragging{cursor:grabbing}',
  // 悬停菜单(宠物下方小卡片;浅色动漫风,与商店一致;悬停出现,可改名)
  '.miku-pet-menu{position:absolute;z-index:6;left:50%;transform:translateX(-50%);top:calc(100% + 16px);pointer-events:auto;display:flex;flex-direction:column;gap:5px;min-width:130px;max-width:210px;background:linear-gradient(165deg,#ffffff 0%,#fff6fa 50%,#fdeff6 100%);border:1.5px solid rgba(255,150,190,.5);border-radius:14px;padding:6px 8px;font-size:12px;line-height:18px;color:#5a4652;box-shadow:0 8px 22px rgba(150,40,90,.22),0 0 0 3px rgba(255,200,222,.25)}',
  '.miku-pet-menu b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c2407c}',
  '.miku-pet-menu-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
  // 菜单按钮两列网格(金币/商店/工作/睡觉);回角落与说明单独一行
  // 注意:类名避开 menu/panel 子串 —— GUI 皮肤有 html[data-dsh-skin] [class*=menu]/[class*=panel]{深色!important} 补丁
  '.miku-pet-actions-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px}',
  '.miku-pet-actions-grid button{width:100%;text-align:center}',
  '.miku-pet-menu input{margin:0;flex:1;min-width:0;background:#ffffff;border:1.5px solid rgba(255,140,180,.55);border-radius:999px;color:#5a4652;font-size:12px;padding:3px 10px;outline:none}',
  '.miku-pet-menu input:focus{border-color:#ff6ea8}',
  '.miku-pet-menu button{appearance:none;border:1.5px solid rgba(255,140,180,.5);background:rgba(255,235,244,.92);color:#c2407c;border-radius:999px;font-size:12px;font-weight:700;padding:3px 12px;cursor:pointer;transition:transform .12s ease,box-shadow .12s ease,background .12s ease}',
  '.miku-pet-menu button:hover{transform:translateY(-1px);background:#ffe3ee}',
  '.miku-pet-menu button.primary{background:linear-gradient(135deg,#ff7eb3,#ff5f9e);border:none;color:#ffffff;box-shadow:0 4px 10px rgba(255,95,158,.35)}',
  '.miku-pet-menu button.primary:hover{background:linear-gradient(135deg,#ff8cbc,#ff6ca8)}',
  '.miku-pet-menu button:disabled{opacity:.55;cursor:default;transform:none}',
  // 对话气泡(点击/随机动作按动作弹出对应台词;贴近头顶上方)
  '.miku-pet-bubble{position:absolute;z-index:5;left:50%;transform:translateX(-50%);bottom:calc(100% + 4px);max-width:180px;background:rgba(255,255,255,.96);border:1.5px solid #17a8c9;border-radius:12px 12px 12px 3px;color:#0b5c6d;font-size:12px;line-height:1.4;padding:5px 9px;pointer-events:none;box-shadow:0 2px 10px rgba(23,168,201,.3);animation:miku-bubble-in .18s ease-out;text-align:center;white-space:normal}',
  '@keyframes miku-bubble-in{from{transform:translateX(-50%) scale(.6);opacity:0}to{transform:translateX(-50%) scale(1);opacity:1}}',
  // 互动飘字(点击等操作:头顶弹出,上飘淡出)
  '.miku-pet-float{position:absolute;z-index:7;left:50%;bottom:calc(100% + 26px);transform:translateX(-50%);color:#ff5f9e;font-size:15px;font-weight:800;letter-spacing:.5px;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.35),0 0 8px rgba(255,255,255,.35);pointer-events:none;animation:miku-float-up .95s ease-out forwards}',
  '@keyframes miku-float-up{0%{opacity:0;transform:translate(-50%,6px) scale(.9)}20%{opacity:1;transform:translate(-50%,0) scale(1.05)}100%{opacity:0;transform:translate(-50%,-20px) scale(1)}}',
  // 左侧属性彩条(饥饿/心情/活力/好感度;浅色动漫风;悬停时与菜单一起显示)
  '.miku-pet-stats{position:absolute;z-index:4;right:calc(100% + 6px);top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:3px;pointer-events:none;background:linear-gradient(160deg,#fff6fa 0%,#fdeff6 100%);border:1px solid rgba(255,150,190,.4);border-radius:10px;padding:5px 6px;min-width:88px;box-shadow:0 4px 12px rgba(150,40,90,.15)}',
  '.miku-pet-stat{display:flex;align-items:center;gap:4px;font-size:10px;line-height:12px;color:#2a2f38;white-space:nowrap}',
  '.miku-pet-stat-label{text-align:left;color:#c2407c;font-weight:600}',
  '.miku-pet-stat-track{flex:1;height:5px;min-width:34px;background:rgba(255,150,190,.22);border-radius:3px;overflow:hidden}',
  '.miku-pet-stat-fill{display:block;height:100%;border-radius:3px;transition:width .25s ease}',
  '.miku-pet-stat-num{width:30px;text-align:right;color:#8b93a5;font-variant-numeric:tabular-nums}',
  // 商店独立窗口(网页中央模态;动漫风格子商店:标题居中/格子物品/右下角钱包)
  // 选择器统一带 .miku-pet-root 前缀:皮肤有 html[data-dsh-skin="miku"] *{border-radius:6px!important}(0,1,1)
  // 与 html[data-dsh-skin="miku"] button{border-radius:8px!important}(0,1,2),前缀后特异性 (0,2,1)+ 稳压
  '.miku-pet-root .miku-pet-shop-overlay{position:fixed;inset:0;z-index:60;background:rgba(26,16,34,.55);display:flex;align-items:center;justify-content:center;pointer-events:auto}',
  '.miku-pet-root .miku-pet-shop-window{pointer-events:auto;position:relative;background:linear-gradient(165deg,#ffffff 0%,#fff6fa 50%,#fdeff6 100%);border:1.5px solid rgba(255,150,190,.45);border-radius:22px!important;padding:20px 22px 16px;min-width:400px;max-width:520px;display:flex;flex-direction:column;gap:14px;box-shadow:0 20px 54px rgba(150,40,90,.28),0 0 0 5px rgba(255,200,222,.28);animation:miku-shop-in .16s ease-out}',
  '.miku-pet-root .miku-pet-shop-head{display:flex;align-items:center;justify-content:center;gap:10px;user-select:none}',
  '.miku-pet-root .miku-pet-shop-head-deco{color:#ff9ec4;font-size:15px;text-shadow:0 0 8px rgba(255,120,170,.6)}',
  '.miku-pet-root .miku-pet-shop-title{font-size:21px;font-weight:800;letter-spacing:3px;background:linear-gradient(90deg,#ff6ea8,#ff9ec4 45%,#39c5bb);-webkit-background-clip:text;background-clip:text;color:transparent}',
  '.miku-pet-root .miku-pet-shop-close{position:absolute;top:10px;right:12px;width:26px;height:26px;padding:0;border-radius:50%!important;border:1.5px solid rgba(255,140,180,.5);background:rgba(255,235,244,.92)!important;background-color:rgba(255,235,244,.92)!important;color:#d4527e;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .12s ease,background .12s ease}',
  '.miku-pet-root .miku-pet-shop-close:hover{transform:rotate(90deg);background:#ffe3ee!important;background-color:#ffe3ee!important}',
  '.miku-pet-root .miku-pet-shop-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
  '.miku-pet-root .miku-pet-shop-cell{display:flex;flex-direction:column;align-items:center;gap:5px;background:#ffffff;border:1.5px solid #ffd7e6;border-radius:16px!important;padding:12px 10px 11px;box-shadow:0 5px 14px rgba(255,150,190,.16);transition:transform .14s ease,box-shadow .14s ease}',
  '.miku-pet-root .miku-pet-shop-cell:hover{transform:translateY(-3px);box-shadow:0 10px 20px rgba(255,130,175,.26)}',
  '.miku-pet-root .miku-pet-shop-img{width:66px;height:66px;object-fit:contain;border-radius:14px!important;background:linear-gradient(160deg,#ffeaf3,#eafbf8)!important;background-color:linear-gradient(160deg,#ffeaf3,#eafbf8)!important;padding:7px;flex:none;border:1px solid rgba(255,170,200,.35)}',
  '.miku-pet-root .miku-pet-shop-cell-name{font-size:13px;line-height:17px;color:#5a4652;text-align:center;min-height:34px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
  '.miku-pet-root .miku-pet-shop-cell-meta{font-size:11px;font-weight:700;color:#c2407c}',
  '.miku-pet-root .miku-pet-shop-cell button{margin-top:2px;font-size:13px;font-weight:700;padding:6px 22px;border-radius:999px!important;border:none;background:linear-gradient(135deg,#ff7eb3,#ff5f9e)!important;background-image:linear-gradient(135deg,#ff7eb3,#ff5f9e)!important;color:#fff;cursor:pointer;box-shadow:0 4px 10px rgba(255,95,158,.35)!important;transition:transform .12s ease,box-shadow .12s ease}',
  '.miku-pet-root .miku-pet-shop-cell button:hover{transform:translateY(-1px);box-shadow:0 6px 14px rgba(255,95,158,.45)!important}',
  '.miku-pet-root .miku-pet-shop-cell button:active{transform:translateY(0)}',
  '.miku-pet-root .miku-pet-shop-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:2px}',
  '.miku-pet-root .miku-pet-shop-coins{font-size:13px;font-weight:800;color:#d4527e;background:linear-gradient(120deg,#fff0f6,#ffe9f1)!important;background-color:linear-gradient(120deg,#fff0f6,#ffe9f1)!important;border:1.5px solid #ffc9dd;border-radius:999px!important;padding:4px 14px;box-shadow:0 2px 8px rgba(255,150,190,.25);letter-spacing:.5px}',
  '.miku-pet-root .miku-pet-shop-foot button{font-size:13px;font-weight:700;padding:6px 18px;border-radius:999px!important;border:1.5px solid rgba(255,140,180,.45);background:rgba(255,235,244,.92)!important;background-color:rgba(255,235,244,.92)!important;color:#c2407c;cursor:pointer;transition:background .12s ease}',
  '.miku-pet-root .miku-pet-shop-foot button:hover{background:#ffe3ee!important;background-color:#ffe3ee!important}',
  // 彩票中奖弹层(商店页之上的独立提示,不走气泡)
  '.miku-pet-root .miku-pet-lottery-prize{font-size:30px;font-weight:800;color:#ff5f9e;text-align:center;letter-spacing:1px;text-shadow:0 2px 10px rgba(255,95,158,.35)}',
  '.miku-pet-root .miku-pet-lottery-sub{font-size:12px;color:#c2407c;text-align:center;margin-top:-6px}',
  '.miku-pet-root .miku-pet-lottery-actions{display:flex;justify-content:center;margin-top:8px}',
  // 玩法说明页(动漫风,与商店同质感)
  '.miku-pet-root .miku-pet-help-body{max-height:min(62vh,440px);overflow-y:auto;padding:2px 4px;display:flex;flex-direction:column;gap:8px;text-align:left;font-size:12px;line-height:19px;color:#5a4652}',
  '.miku-pet-root .miku-pet-help-block{border:1px solid rgba(255,170,200,.45);border-radius:12px;padding:8px 10px;background:rgba(255,250,252,.65)}',
  '.miku-pet-root .miku-pet-help-block b{color:#c2407c}',
  '.miku-pet-root .miku-pet-help-table{width:100%;border-collapse:collapse;font-size:11px;margin-top:4px}',
  '.miku-pet-root .miku-pet-help-table th,.miku-pet-root .miku-pet-help-table td{border:1px solid rgba(255,170,200,.4);padding:2px 6px;text-align:center}',
  '.miku-pet-root .miku-pet-help-table th{background:rgba(255,220,236,.55);color:#c2407c}',
  '.miku-pet-root .miku-pet-help-ev{color:#ff5f9e;font-weight:800;margin-top:6px}',
  '@keyframes miku-shop-in{from{opacity:0;transform:translateY(8px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}',
  // 明亮主题适配:面板白底黑字。
  // 前缀 html body .miku-pet-root[data-miku-lit][data-miku-root] 特异性 (0,4,2)+,
  // 且各面板自身带 [data-miku-lit]((0,5,2)+),稳压皮肤 patches 的
  // html[data-dsh-skin] body[data-ds-dark-theme] [class*=menu](0,3,2) !important 深蓝渐变;
  // 同时写 background + background-color 双属性。
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit]{background:linear-gradient(165deg,#ffffff 0%,#fff6fa 50%,#fdeff6 100%)!important;background-color:transparent!important;background-image:linear-gradient(165deg,#ffffff 0%,#fff6fa 50%,#fdeff6 100%)!important;border:1.5px solid rgba(255,150,190,.5)!important;border-color:rgba(255,150,190,.5)!important;border-radius:14px!important;color:#5a4652!important;box-shadow:0 8px 22px rgba(150,40,90,.22),0 0 0 3px rgba(255,200,222,.25)!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] .miku-pet-menu-row{background:transparent!important;background-color:transparent!important;background-image:none!important;box-shadow:none!important;border:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;color:#5a4652!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] .miku-pet-menu-row b{color:#c2407c!important;font-weight:700}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] input{background:#fff!important;background-color:#fff!important;border:1.5px solid rgba(255,140,180,.55)!important;border-color:rgba(255,140,180,.55)!important;border-radius:999px!important;color:#5a4652!important;padding:3px 10px!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] input:focus{border-color:#ff6ea8!important;outline:none}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] button{font-size:12px!important;font-weight:700!important;padding:4px 14px!important;border-radius:999px!important;border:1.5px solid rgba(255,140,180,.5)!important;background:rgba(255,235,244,.92)!important;background-color:rgba(255,235,244,.92)!important;color:#c2407c!important;box-shadow:0 2px 6px rgba(255,150,190,.25)!important;transition:transform .12s ease,box-shadow .12s ease,background .12s ease}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] button:hover{transform:translateY(-1px);background:#ffe3ee!important;background-color:#ffe3ee!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] button.primary{background:linear-gradient(135deg,#ff7eb3,#ff5f9e)!important;background-color:transparent!important;background-image:linear-gradient(135deg,#ff7eb3,#ff5f9e)!important;border:none!important;color:#fff!important;box-shadow:0 4px 10px rgba(255,95,158,.35)!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] button.primary:hover{transform:translateY(-1px);background:linear-gradient(135deg,#ff8cbc,#ff6ca8)!important;background-color:transparent!important;background-image:linear-gradient(135deg,#ff8cbc,#ff6ca8)!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] button:disabled{opacity:.55!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-stats[data-miku-lit]{background:linear-gradient(160deg,#fff6fa,#fdeff6)!important;background-color:transparent!important;background-image:linear-gradient(160deg,#fff6fa,#fdeff6)!important;border:1px solid rgba(255,150,190,.4)!important;border-color:rgba(255,150,190,.4)!important;border-radius:10px!important;box-shadow:0 4px 12px rgba(150,40,90,.15)!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-stats[data-miku-lit] .miku-pet-stat{color:#2a2f38!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-stats[data-miku-lit] .miku-pet-stat-label{color:#c2407c!important;font-weight:600}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-stats[data-miku-lit] .miku-pet-stat-track{background:rgba(255,150,190,.22)!important;background-color:rgba(255,150,190,.22)!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-stats[data-miku-lit] .miku-pet-stat-num{color:#d4527e!important}',
  '@media (prefers-reduced-motion: reduce){.miku-pet-video{transition:none}}',
].join('\n');
const cssTag = 'miku-pet/style.css';
function injectCss(): void {
  if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + cssTag + '"]') === null) {
    const tag = document.createElement('style');
    tag.dataset.plugin = 'miku-pet';
    tag.dataset.pluginCss = cssTag;
    tag.textContent = css;
    document.head.appendChild(tag);
  }
}

/** 随机待机规则（与桌面版 desktop-pet 一致）：待机时每 ROLL_INTERVAL_MS 判定一次，
 * 演动作概率 = animationWeights 的 action 档占比（config 默认 idle 40 / categories 60 → 60%）；
 * 连续 MAX_MISS 次未抽中 → 下次 100% 必演；演出成功或离开待机时计数清零。 */
const ROLL_INTERVAL_MS = 5_000;
const MAX_MISS = 2;
/** 帧/清单缓存破坏:每次页面加载一个时间戳 → 刷新页面必拿最新素材(宿主对 thumb 是 max-age=3600) */
const FRAME_V = Date.now();

// 左侧属性彩条定义(饥饿/心情/活力 0-100 + 好感度 0-500;max 决定条宽与数值上限;悬停才显示)
const STAT_DEFS = [
  { key: 'hunger', label: '饥饿值', color: '#ff9f43', max: 100 },
  { key: 'mood', label: '心情值', color: '#ff6b81', max: 100 },
  { key: 'energy', label: '活力值', color: '#2ed573', max: 100 },
  { key: 'affection', label: '好感度', color: '#ffd93d', max: 500 },
] as const;
type StatKey = (typeof STAT_DEFS)[number]['key'];

/** 触摸互动结果(概率/好感度变化/动画/时长/固定气泡) */
interface TouchOutcome {
  prob: number;
  delta: number;
  anim: string;
  ms: number;
  bubble: string;
}

// 触摸互动部位判定:按点击框(HIT_BOX)纵向分 3 区(用户定义:0-55 头 / 55-75 身 / 75 以下腿)。
// success = 命中概率 + 好感度变化 + 动作(循环播到 ms 结束回 idle)+ 固定气泡;
// fail 仅腿部(未命中 success 时触发;0.3+0.7=1 全覆盖)。动画 key 对应 frames 素材目录。
const CLICK_ZONES: {
  id: string;
  label: string;
  y0: number;
  y1: number;
  success: TouchOutcome;
  fail?: TouchOutcome;
}[] = [
  {
    id: 'head',
    label: '头部',
    y0: 0.0,
    y1: 0.55,
    success: { prob: 0.05, delta: 5, anim: 'happy', ms: 3000, bubble: '*我好开心！*' },
  },
  {
    id: 'body',
    label: '身体',
    y0: 0.55,
    y1: 0.75,
    success: { prob: 0.1, delta: 10, anim: 'shy', ms: 3000, bubble: '**色狼**你干嘛！**' },
  },
  {
    id: 'legs',
    label: '腿部',
    y0: 0.75,
    y1: 1.0,
    success: { prob: 0.1, delta: 30, anim: 'flirty', ms: 3000, bubble: '***是你想要我主动一点吗？***' },
    fail: { prob: 0.9, delta: -5, anim: 'angry', ms: 3000, bubble: '哼！' },
  },
];

// 商店物品:食物(金币→恢复饥饿)+ 游戏币(10 金币兑换 1 个)+ 幸运彩票(50 金币,全属性+10,买即开奖)
const SHOP_ITEMS = [
  { id: 'food1', img: '/miku-pet/thumb/shop/miku-pet-shop1.webp', price: 5, hunger: 40, label: '香浓可口的超级无敌黄油面包' },
  { id: 'food2', img: '/miku-pet/thumb/shop/miku-pet-shop2.webp', price: 10, hunger: 80, label: '闪闪发亮新鲜出炉的红豆沙包' },
  { id: 'gamecoin', img: '/miku-pet/thumb/shop/miku-pet-shop4.webp', price: 10, gameCoins: 1, label: '游戏币' },
  { id: 'lottery', img: '/miku-pet/thumb/shop/miku-pet-shop6.webp', price: 10, lottery: true, label: '幸运彩票' },
];

// 幸运彩票奖池:[奖金, 概率%];合计 100%;按累计概率开奖
const LOTTERY_TIERS = [
  { prize: 1_000_000, pct: 0.01 },
  { prize: 500_000, pct: 0.08 },
  { prize: 6_666, pct: 0.35 },
  { prize: 1_000, pct: 1.2 },
  { prize: 50, pct: 98.36 },
] as const;
const drawLottery = (): number => {
  const roll = Math.random() * 100;
  let acc = 0;
  for (const t of LOTTERY_TIERS) {
    acc += t.pct;
    if (roll < acc) return t.prize;
  }
  return LOTTERY_TIERS[LOTTERY_TIERS.length - 1].prize;
};
/** 彩票期望收益(每张,金币):sum(奖金 × 概率%)——玩法说明页展示 */
const LOTTERY_EV = LOTTERY_TIERS.reduce((s, t) => s + (t.prize * t.pct) / 100, 0);

/** 属性值夹取:低于 0 → 0,高于 max(默认 100) → max */
const clampStat = (v: number, max = 100) => Math.min(max, Math.max(0, Math.round(v)));

/** 各属性上限速查(好感度 500,其余 100) */
const STAT_MAX = Object.fromEntries(STAT_DEFS.map((d) => [d.key, d.max])) as Record<StatKey, number>;

/**
 * 制造宠物页面组件（工厂，与 makePetConfigSection 同理：react 由运行时注入）。
 * @param rt 运行时注入的 react 能力（h=jsx / useState / useEffect / useRef）
 * @returns PetMulti 多开容器组件（内部渲染多个 PetCard）
 */
export function makePetUI(rt: {
  h: (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => ReactNode;
  useState: <T>(init: T | (() => T)) => [T, Dispatch<SetStateAction<T>>];
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => void;
  useRef: <T>(initial: T) => { current: T };
}): () => ReactNode {
  const { h, useState, useEffect, useRef } = rt;
  injectCss();

  /** 单个宠物实例（配置由容器 PetMulti 传入） */
  function PetCard({ cfg }: { cfg: Pet }) {
    // ---- 尺寸（由配置传入；容器/设置页更新后即时跟随）----
    const [size, setSize] = useState(cfg.size);
    const halfW = size / 2;
    const halfH = size / 2;

    // ---- React 状态 ----
    const [anim, setAnim] = useState(config.animations.idle[0] ?? '');
    // 初始待机 = idle 循环(once=false 循环播放;随机演出由 5s 掷骰驱动)
    const [once, setOnce] = useState(false);
    const [facing, setFacing] = useState('left' as 'left' | 'right');
    const [dragging, setDragging] = useState(false);
    // 自由位置(拖拽后停在哪;rx/ry 为视口比例,corner 记录拖动时的角落,角落配置变更即失效)
    // 持久化:localStorage key miku-pet:pos:<id>,刷新后保持,与桌面版 pet-state.json 行为一致
    const posKey = 'miku-pet:pos:' + cfg.id;
    const [customPos, setCustomPos] = useState<null | { rx: number; ry: number; corner: Corner }>(() => {
      try {
        const raw = JSON.parse(window.localStorage.getItem(posKey) ?? 'null');
        if (raw && typeof raw.rx === 'number' && typeof raw.ry === 'number') {
          return { rx: raw.rx, ry: raw.ry, corner: (raw.corner as Corner) ?? cfg.position.corner };
        }
      } catch {
        /* 损坏数据按无自由位置处理 */
      }
      return null;
    });
    // 初始角落与边距（来自配置；可被容器更新覆盖）
    const [corner, setCorner] = useState<Corner>(cfg.position.corner);
    const [margin, setMargin] = useState({ x: cfg.position.marginX, y: cfg.position.marginY });

    // 配置变化即时跟随（容器重新合并 / 设置页保存后通过 petBridge.sync 触发）
    useEffect(() => {
      setSize(cfg.size);
      setCorner(cfg.position.corner);
      setMargin({ x: cfg.position.marginX, y: cfg.position.marginY });
      // 角落配置变更 → 自由位置失效(回到配置角落)
      setCustomPos((prev) => (prev && prev.corner !== cfg.position.corner ? null : prev));
    }, [cfg.size, cfg.position.corner, cfg.position.marginX, cfg.position.marginY]);
    // 自由位置持久化(刷新后保持;清空时删除存档)
    useEffect(() => {
      try {
        if (customPos) window.localStorage.setItem(posKey, JSON.stringify(customPos));
        else window.localStorage.removeItem(posKey);
      } catch {
        /* 忽略 */
      }
    }, [customPos, posKey]);
    const [seq, setSeq] = useState(0);

    // ---- 左侧属性彩条(饥饿/心情/活力 + 好感度,各按 max 夹取,存 localStorage)----
    const STATS_KEY = 'miku-pet:stats';
    const [stats, setStats] = useState<Record<StatKey, number>>(() => {
      const clamp = (key: StatKey, v: unknown, def: number) => {
        const max = STAT_DEFS.find((d) => d.key === key)?.max ?? 100;
        return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : def;
      };
      try {
        const raw = JSON.parse(
          window.localStorage.getItem(STATS_KEY) ?? '{"hunger":100,"mood":100,"energy":100,"affection":100}',
        );
        return {
          hunger: clamp('hunger', raw?.hunger, 100),
          mood: clamp('mood', raw?.mood, 100),
          energy: clamp('energy', raw?.energy, 100),
          affection: clamp('affection', raw?.affection, 100),
        };
      } catch {
        return { hunger: 100, mood: 100, energy: 100, affection: 100 };
      }
    });
    useEffect(() => {
      try {
        window.localStorage.setItem(STATS_KEY, JSON.stringify(stats));
      } catch {
        /* 忽略 */
      }
    }, [stats]);

    // ---- 属性衰减:每 60s 掉点(饥饿平时 -1/工作 -5;心情 -0.5;活力 -0.25),下限 0 ----
    const HUNGER_DECAY_MS = 60_000;
    const HUNGER_DECAY_NORMAL = 1;
    const HUNGER_DECAY_WORKING = 5;
    const MOOD_DECAY_PER_MIN = 0.5;
    const ENERGY_DECAY_PER_MIN = 0.25;
    // 点击互动:心情值随机 +0~3(整数,0-100 夹取)
    const clickMoodBoost = () => Math.floor(Math.random() * 4);
    useEffect(() => {
      const timer = window.setInterval(() => {
        setStats((prev) => {
          const decay = workingRef.current ? HUNGER_DECAY_WORKING : HUNGER_DECAY_NORMAL;
          const hunger = prev.hunger > 0 ? Math.max(0, prev.hunger - decay) : prev.hunger;
          const mood = prev.mood > 0 ? Math.max(0, prev.mood - MOOD_DECAY_PER_MIN) : prev.mood;
          const energy = prev.energy > 0 ? Math.max(0, prev.energy - ENERGY_DECAY_PER_MIN) : prev.energy;
          if (hunger === prev.hunger && mood === prev.mood && energy === prev.energy) return prev;
          return { ...prev, hunger, mood, energy };
        });
      }, HUNGER_DECAY_MS);
      return () => window.clearInterval(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- 被动金币收入:每分钟 +1(无条件,立即持久化)----
    useEffect(() => {
      const timer = window.setInterval(() => {
        const next = coinsRef.current + 1;
        coinsRef.current = next;
        setCoins(next);
        try {
          window.localStorage.setItem(COINS_KEY, String(next));
        } catch {
          /* 忽略 */
        }
      }, 60_000);
      return () => window.clearInterval(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- 好感度空闲衰减:待机(idle 循环且非工作/睡觉/拖拽)每满 300s -1,下限 0 ----
    const AFFECTION_IDLE_DECAY_MS = 300_000;
    useEffect(() => {
      const timer = window.setInterval(() => {
        const cur = animRef.current;
        if (!cur || !config.animations.idle.includes(cur)) return; // 非待机不衰减
        if (workingRef.current || sleepingRef.current || dragRef.current.active) return;
        setStats((prev) => (prev.affection > 0 ? { ...prev, affection: prev.affection - 1 } : prev));
      }, AFFECTION_IDLE_DECAY_MS);
      return () => window.clearInterval(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- 悬停菜单 / 改名（名字存 localStorage，key 按宠物 id；零宿主依赖，改完即生效）----
    const nameKey = 'miku-pet:name:' + cfg.id;
    const [petName, setPetName] = useState(() => {
      try {
        return window.localStorage.getItem(nameKey) ?? cfg.name ?? '';
      } catch {
        return cfg.name ?? '';
      }
    });
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuView, setMenuView] = useState<'root' | 'rename' | 'wallet'>('root');
    // 商店为网页中央的独立窗口(模态),不进小菜单二级
    const [shopOpen, setShopOpen] = useState(false);
    // 玩法说明页(独立动漫风弹层)
    const [helpOpen, setHelpOpen] = useState(false);
    // 彩票开奖结果(独立弹层提示,不走气泡);null = 未开奖
    const [lotteryResult, setLotteryResult] = useState<null | { prize: number; gameCoins: number }>(null);
    const menuOpenRef = useRef(false);
    const [nameDraft, setNameDraft] = useState('');
    const menuTimerRef = useRef<number | null>(null);
    useEffect(() => {
      try {
        const saved = window.localStorage.getItem(nameKey);
        setPetName(saved ?? cfg.name ?? '');
      } catch {
        setPetName(cfg.name ?? '');
      }
    }, [nameKey, cfg.name]);

    // ---- 对话气泡:按动作名弹对应台词 ----
    const [bubble, setBubble] = useState('');
    const bubbleTimerRef = useRef<number | null>(null);
    const showBubble = (action: string) => {
      const pool = config.phrases?.[action];
      if (!pool || !pool.length) return;
      const text = pool[Math.floor(Math.random() * pool.length)];
      setBubble(text);
      if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
      bubbleTimerRef.current = window.setTimeout(() => setBubble(''), 2600);
    };
    /** 固定文案气泡(触摸互动用;时长随动作 3s) */
    const showBubbleText = (text: string, ms = 2600) => {
      setBubble(text);
      if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
      bubbleTimerRef.current = window.setTimeout(() => setBubble(''), ms);
    };

    // ---- 互动飘字(点击等操作在宠物头顶弹出,上飘淡出)----
    const [floatMsg, setFloatMsg] = useState('');
    const [floatKey, setFloatKey] = useState(0);
    const floatTimerRef = useRef<number | null>(null);
    const showFloat = (text: string) => {
      setFloatMsg(text);
      setFloatKey((k) => k + 1); // 每次触发重放上飘动画
      if (floatTimerRef.current !== null) window.clearTimeout(floatTimerRef.current);
      floatTimerRef.current = window.setTimeout(() => setFloatMsg(''), 1000);
    };

    // ---- 钱包(工作玩法):金币存 localStorage,余额下限 0;工作=循环判定(未被打断不停止) ----
    const COINS_KEY = 'miku-pet:coins';
    const WORK_DURATION_MS = 10_000; // 每轮工作 10s 判定一次,判定后继续下一轮
    const coinsRef = useRef(0);
    const [coins, setCoins] = useState(() => {
      try {
        const v = Number(window.localStorage.getItem(COINS_KEY));
        return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
      } catch {
        return 0;
      }
    });
    coinsRef.current = coins;
    // ---- 游戏币钱包(商店兑换品:10 金币 = 1 个;localStorage 持久化)----
    const GAMECOINS_KEY = 'miku-pet:gamecoins';
    const gameCoinsRef = useRef(0);
    const [gameCoins, setGameCoins] = useState(() => {
      try {
        const v = Number(window.localStorage.getItem(GAMECOINS_KEY));
        return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
      } catch {
        return 0;
      }
    });
    gameCoinsRef.current = gameCoins;
    const [working, setWorking] = useState(false);
    const workingRef = useRef(false);
    const workTimerRef = useRef<number | null>(null);
    // 睡觉:菜单触发,循环播放睡眠动作,每 30s 恢复 4 活力;点击/拖拽醒来
    const SLEEP_RESTORE_MS = 30_000;
    const SLEEP_RESTORE_ENERGY = 4;
    // 睡觉动作:前 3 帧"入睡"完整播一遍后,仅循环第 4 帧起("睡熟"姿态,直到被拖拽/点击唤醒)
    const SLEEP_LOOP_FROM = 3;
    const [sleeping, setSleeping] = useState(false);
    const sleepingRef = useRef(false);
    const sleepTimerRef = useRef<number | null>(null);
    // 触摸互动动画计时器(3s 后回 idle);播放期间点击只计心情,不触发回退/重复触摸
    const touchTimerRef = useRef<number | null>(null);
    const touchingRef = useRef(false);
    const workPlay = (next: string, once: boolean) => {
      setAnim(next);
      setOnce(once);
      setSeq((s) => s + 1);
    };
    // 一轮:工作中循环 10s → 判定成败(+3/-1) → 播成败动画 → 继续下一轮(除非被打断)
    const workCycle = () => {
      if (!workingRef.current) return;
      workPlay(config.animations.work?.[0] ?? 'work', false);
      if (workTimerRef.current !== null) window.clearTimeout(workTimerRef.current);
      workTimerRef.current = window.setTimeout(() => {
        if (!workingRef.current) return; // 已打断,本轮不作判定
        const ok = Math.random() < 0.5;
        const result = ok ? 'success' : 'fail';
        workPlay(config.animations[result as 'success']?.[0] ?? result, true);
        const nextCoins = Math.max(0, coinsRef.current + (ok ? 3 : -1));
        coinsRef.current = nextCoins;
        setCoins(nextCoins);
        try {
          window.localStorage.setItem(COINS_KEY, String(nextCoins));
        } catch {
          /* 忽略 */
        }
        showBubble(result);
        if (workTimerRef.current !== null) window.clearTimeout(workTimerRef.current);
        workTimerRef.current = window.setTimeout(() => {
          workCycle(); // 判定后不停止,继续下一轮
        }, ok ? 1300 : 1900);
      }, WORK_DURATION_MS);
    };
    const doWork = () => {
      if (workingRef.current || dragRef.current.active) return; // 已在工作/拖拽中才挡
      if (sleepingRef.current) stopSleep(); // 睡觉中点工作 → 先醒来再开工
      workingRef.current = true;
      setWorking(true);
      closeMenuNow();
      workCycle();
    };
    const stopWork = () => {
      // 打断:立即停止循环(本轮回合不作判定),回待机;之后的点击/拖拽照常处理
      if (!workingRef.current) return;
      workingRef.current = false;
      setWorking(false);
      if (workTimerRef.current !== null) window.clearTimeout(workTimerRef.current);
      backToIdle();
    };
    // 睡觉:循环播睡眠动作,每 30s 活力 +4(0-100 夹取);菜单再次点「睡觉」不可用,靠点击/拖拽醒来
    const doSleep = () => {
      if (sleepingRef.current || dragRef.current.active) return;
      if (workingRef.current) stopWork(); // 工作中点睡觉 → 先收工再睡
      sleepingRef.current = true;
      setSleeping(true);
      closeMenuNow();
      setAnim(config.animations.sleep?.[0] ?? 'sleep');
      setOnce(false);
      setSeq((s) => s + 1);
      showBubble(config.animations.sleep?.[0] ?? 'sleep');
      if (sleepTimerRef.current !== null) window.clearInterval(sleepTimerRef.current);
      sleepTimerRef.current = window.setInterval(() => {
        if (!sleepingRef.current) return;
        setStats((prev) => ({ ...prev, energy: Math.min(100, prev.energy + SLEEP_RESTORE_ENERGY) }));
        showFloat('活力 +4'); // 每 30s 恢复反馈
      }, SLEEP_RESTORE_MS);
    };
    const stopSleep = () => {
      // 醒来:停止恢复计时,回待机(与工作/拖拽互斥由调用处保证)
      if (!sleepingRef.current) return;
      sleepingRef.current = false;
      setSleeping(false);
      if (sleepTimerRef.current !== null) {
        window.clearInterval(sleepTimerRef.current);
        sleepTimerRef.current = null;
      }
      backToIdle();
    };
    // 商店购买:彩票付游戏币(见 lottery 分支);其余付金币;成功 → 食物恢复饥饿 / 游戏币 +1(均持久化)
    const buyItem = (item: { price: number; hunger?: number; gameCoins?: number; lottery?: boolean }) => {
      if (item.lottery) {
        // 幸运彩票:10 游戏币/张;全属性 +10;立即开奖,奖金入金币;中奖用独立弹层提示(不走气泡)
        if (gameCoinsRef.current < item.price) {
          showBubble('游戏币不足…');
          return;
        }
        const gc = gameCoinsRef.current - item.price;
        gameCoinsRef.current = gc;
        setGameCoins(gc);
        try {
          window.localStorage.setItem(GAMECOINS_KEY, String(gc));
        } catch {
          /* 忽略 */
        }
        setStats((s) => ({
          hunger: clampStat(s.hunger + 10),
          mood: clampStat(s.mood + 10),
          energy: clampStat(s.energy + 10),
          affection: clampStat(s.affection + 10, 500),
        }));
        const prize = drawLottery();
        const total = coinsRef.current + prize;
        coinsRef.current = total;
        setCoins(total);
        try {
          window.localStorage.setItem(COINS_KEY, String(total));
        } catch {
          /* 忽略 */
        }
        setLotteryResult({ prize, gameCoins: gc });
        return;
      }
      if (coinsRef.current < item.price) {
        showBubble('金币不足…');
        return;
      }
      const next = coinsRef.current - item.price;
      coinsRef.current = next;
      setCoins(next);
      try {
        window.localStorage.setItem(COINS_KEY, String(next));
      } catch {
        /* 忽略 */
      }
      if (item.hunger) {
        setStats((s) => ({ ...s, hunger: clampStat(s.hunger + (item.hunger as number)) }));
        showBubble(item.hunger >= 80 ? '大份下肚,精神满满~' : '吃饱饱啦~');
      } else if (item.gameCoins) {
        const gc = gameCoinsRef.current + item.gameCoins;
        gameCoinsRef.current = gc;
        setGameCoins(gc);
        try {
          window.localStorage.setItem(GAMECOINS_KEY, String(gc));
        } catch {
          /* 忽略 */
        }
        showBubble('兑换游戏币 +' + item.gameCoins + '~');
      }
    };
    const openMenu = () => {
      if (dragRef.current.active || justDraggedRef.current) return;
      if (menuTimerRef.current !== null) window.clearTimeout(menuTimerRef.current);
      if (!menuOpenRef.current) setMenuView('root'); // 仅"重新打开"时回到一级;已打开的悬停不下钻状态
      menuOpenRef.current = true;
      setMenuOpen(true);
    };
    const closeMenuNow = () => {
      menuOpenRef.current = false;
      setMenuView('root');
      setMenuOpen(false);
    };
    const closeMenu = () => {
      if (menuView === 'rename') return; // 改名输入中不自动收起（避免打字时被指针离开误关）
      if (menuTimerRef.current !== null) window.clearTimeout(menuTimerRef.current);
      menuTimerRef.current = window.setTimeout(() => {
        closeMenuNow();
      }, 260);
    };
    const startRename = () => {
      setNameDraft(petName);
      setMenuView('rename');
    };
    const saveName = () => {
      const v = (nameDraft || '').trim().slice(0, 32);
      if (v) {
        try {
          window.localStorage.setItem(nameKey, v);
        } catch {
          /* 隐私模式等忽略 */
        }
        setPetName(v);
      }
      closeMenuNow();
    };

    // ---- DOM / 状态 refs ----
    const rootRef = useRef<HTMLDivElement | null>(null);
    const stageRef = useRef<HTMLDivElement | null>(null);
    // 帧序列播放:单 <img> + 定时器(替换原双 <video> webm 播放)
    const imgRef = useRef<HTMLImageElement | null>(null);
    const frameListRef = useRef<{ name: string; ms: number }[]>([]);
    const frameIdxRef = useRef(0);
    const frameTimerRef = useRef<number | null>(null);
    // 播放心跳:每次换帧记录时间;看门狗据此判断帧链是否停滞(>1.2s 未换帧 = 链断)并自愈回待机
    const lastFrameAtRef = useRef(Date.now());
    const stallHandledAtRef = useRef(0);
    // 循环起点:0 = 从头循环;睡觉 = SLEEP_LOOP_FROM(入睡帧播过一遍后只循环睡熟帧)
    const loopFromRef = useRef(0);
    const onceRef = useRef(true);
    const curActionRef = useRef('');
    const genRef = useRef(0);
    const dragRef = useRef({ active: false, dragging: false, sx: 0, sy: 0, offX: 0, offY: 0 });
    const justDraggedRef = useRef(false);
    const idleMissRef = useRef(0); // 连续未抽中计数(连漏 MAX_MISS 次 → 下次必演)
    const animRef = useRef(anim);
    animRef.current = anim;

    /** 帧推进:按帧时长定时切换 img.src;一次性动作播完触发 handleEnded;
     *  循环动作到末尾后从 loopFromRef 所指帧重新开始(默认第 1 帧;睡觉只循环睡熟帧)。 */
    const playFrame = (gen: number) => {
      const list = frameListRef.current;
      if (!list.length) return;
      if (frameIdxRef.current >= list.length) {
        if (onceRef.current) {
          handleEnded();
          return;
        }
        frameIdxRef.current = loopFromRef.current;
      }
      const f = list[frameIdxRef.current];
      frameIdxRef.current += 1;
      lastFrameAtRef.current = Date.now();
      const img = imgRef.current;
      if (img) img.src = '/miku-pet/thumb/' + encodeURIComponent(curActionRef.current) + '/' + encodeURIComponent(f.name) + '?v=' + FRAME_V;
      if (frameTimerRef.current !== null) window.clearTimeout(frameTimerRef.current);
      frameTimerRef.current = window.setTimeout(() => playFrame(gen), f.ms);
    };

    const switchTo = (next: string, nextOnce: boolean) => {
      if (!next) return;
      const gen = ++genRef.current;
      curActionRef.current = next;
      onceRef.current = nextOnce;
      // 睡觉:入睡帧播过一遍后只循环睡熟帧(其余动作从头循环)
      loopFromRef.current =
        !nextOnce && next === (config.animations.sleep?.[0] ?? 'sleep') ? SLEEP_LOOP_FROM : 0;
      if (frameTimerRef.current !== null) window.clearTimeout(frameTimerRef.current);
      frameTimerRef.current = null;
      void fetch('/miku-pet/frames/' + encodeURIComponent(next) + '?v=' + FRAME_V)
        .then((r) => (r.ok ? r.json() : { frames: [] }))
        .then((data) => {
          if (gen !== genRef.current) return; // 过期请求丢弃
          const list = (data.frames || []) as { name: string; ms: number }[];
          frameListRef.current = list;
          frameIdxRef.current = 0;
          if (!list.length) {
            // 帧清单为空(网络抖动/动作无素材)→ 不能静默停播(会"卡住"):回待机循环
            console.warn('[miku-pet] 无帧清单,回待机:', next);
            if (config.animations.idle.length) {
              setAnim(pick(config.animations.idle, next));
              setOnce(false);
              setSeq((s) => s + 1);
            }
            return;
          }
          playFrame(gen);
        })
        .catch(() => {
          if (gen !== genRef.current) return;
          console.warn('[miku-pet] 帧清单加载失败,回待机:', next);
          if (config.animations.idle.length) {
            setAnim(pick(config.animations.idle, next));
            setOnce(false);
            setSeq((s) => s + 1);
          }
        });
    };

    // ---- 状态驱动播放 ----
    useEffect(() => {
      switchTo(anim, once);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [anim, once, seq]);
    // 帧链看门狗:正常播放每帧 ≤ ~200ms 就会换帧;超过 1.2s 未换帧视为帧链中断(卡住)→ 强制回待机自愈
    useEffect(() => {
      const wd = window.setInterval(() => {
        if (Date.now() - lastFrameAtRef.current > 1200) {
          if (Date.now() - stallHandledAtRef.current < 3000) return; // 3s 内已自愈过:防止帧路由持续失败时的热循环
          stallHandledAtRef.current = Date.now();
          console.warn('[miku-pet] 帧链停滞(>1.2s 未换帧),自动回待机');
          backToIdle();
        }
      }, 500);
      return () => window.clearInterval(wd);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => () => {
      stopMove();
      if (menuTimerRef.current !== null) window.clearTimeout(menuTimerRef.current);
      if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
      if (workTimerRef.current !== null) window.clearTimeout(workTimerRef.current);
      if (sleepTimerRef.current !== null) window.clearInterval(sleepTimerRef.current);
      if (touchTimerRef.current !== null) window.clearTimeout(touchTimerRef.current);
    }, []);
    useEffect(() => {
      const onResize = () => setCustomPos((prev) => (prev ? { ...prev } : prev));
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }, []);

    // ---- 待机收尾：一切非待机动作播完都回到 idle 循环（随机演出交给 5s 掷骰）----
    const backToIdle = () => {
      idleMissRef.current = 0; // 演出成功/被打断 → 计数清零（桌面版一致）
      if (config.animations.idle.length) {
        setAnim(pick(config.animations.idle, animRef.current));
        setOnce(false);
        setSeq((s) => s + 1);
      }
    };

    const handleEnded = () => {
      const { animations } = config;
      if (dragRef.current.active) return;
      if (animations.turn.includes(animRef.current)) {
        const next = facing === 'left' ? 'right' : 'left';
        setFacing(next);
        facingRef.current = next; // 立即同步：翻转后的随机演出用新朝向过滤 noMirror（右侧不选文字类）
        backToIdle();
        return;
      }
      backToIdle(); // drag / clicks / 分类动作（挠头/眨眼/吃饭）播完一律回 idle 循环
    };

    // ---- 移动系统 ----
    const moveRef = useRef<number | null>(null);
    const moveTokenRef = useRef(0);
    const pendingMoveRef = useRef<null | {
      startRatio: number;
      startYRatio: number;
      targetRatio: number;
      dir: number;
      totalRatio: number;
      leadSec: number;
      tailSec: number;
    }>(null);
    const customPosRef = useRef(customPos);
    customPosRef.current = customPos;

    const currentCenterX = () => {
      const cp = customPosRef.current;
      if (cp) return cp.rx * window.innerWidth;
      const rootEl = rootRef.current;
      if (rootEl) return rootEl.getBoundingClientRect().left + halfW;
      return window.innerWidth - 24 - halfW;
    };
    const currentCenterY = () => {
      const cp = customPosRef.current;
      if (cp) return cp.ry * window.innerHeight;
      const rootEl = rootRef.current;
      if (rootEl) return rootEl.getBoundingClientRect().top + halfH;
      return window.innerHeight - 20 - halfH;
    };

    const startMoveDrive = (el: HTMLVideoElement) => {
      const pm = pendingMoveRef.current;
      if (!pm || moveRef.current !== null) return;
      pendingMoveRef.current = null;
      const { startRatio, startYRatio, targetRatio, dir, totalRatio, leadSec, tailSec } = pm;
      const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 10.09;
      const travelWindow = Math.max(0.1, duration - leadSec - tailSec);
      const token = ++moveTokenRef.current;
      const step = () => {
        if (moveTokenRef.current !== token) return;
        const t = el.currentTime || 0;
        const rootEl = rootRef.current;
        if (rootEl) {
          const W = window.innerWidth;
          const H = window.innerHeight;
          let ratioX;
          if (t <= leadSec) ratioX = startRatio;
          else if (t >= duration - tailSec) ratioX = targetRatio;
          else ratioX = startRatio + dir * totalRatio * ((t - leadSec) / travelWindow);
          const px = ratioX * W;
          const py = startYRatio * H;
          rootEl.style.left = px - halfW + 'px';
          rootEl.style.top = py - halfH + 'px';
          rootEl.style.right = 'auto';
          rootEl.style.bottom = 'auto';
        }
        if (t < duration - tailSec) moveRef.current = requestAnimationFrame(step);
        else {
          moveRef.current = null;
          setCustomPos({ rx: targetRatio, ry: startYRatio, corner });
        }
      };
      moveRef.current = requestAnimationFrame(step);
    };

    const tryMove = () => {
      if (moveRef.current !== null || pendingMoveRef.current) return true;
      const moves = config.animations.moves;
      const actions = moves.actions;
      if (!actions.length) return false;
      const chosen = actions[Math.floor(Math.random() * actions.length)];
      const mp = Object.assign({}, moves.default, chosen.params || {});
      const dir = (facingRef.current === 'right') !== config.animations.turn.includes(animRef.current) ? 1 : -1;
      const W = window.innerWidth;
      const plan = planMove({
        cx: currentCenterX(),
        cy: currentCenterY(),
        W,
        H: window.innerHeight,
        dir,
        minDist: mp.minDist,
        maxDist: mp.maxDist,
        margin: mp.margin,
        halfW,
      });
      if (!plan) return false;
      pendingMoveRef.current = {
        ...plan,
        dir,
        leadSec: mp.leadSec,
        tailSec: mp.tailSec,
      };
      setOnce(true);
      setAnim(chosen.name);
      return true;
    };
    const stopMove = () => {
      pendingMoveRef.current = null;
      moveTokenRef.current++;
      if (moveRef.current !== null) {
        cancelAnimationFrame(moveRef.current);
        moveRef.current = null;
      }
    };

    const facingRef = useRef<'left' | 'right'>(facing);
    facingRef.current = facing;
    // 最新的 tryMove（5s 掷骰用；避免 interval 闭包捕获首帧渲染的旧 halfW/尺寸）
    const tryMoveRef = useRef(tryMove);
    tryMoveRef.current = tryMove;

    // ---- 随机待机表演：每 5s 判定一次（与桌面版 pet2d.js 一致）----
    // idle 循环播放；掷骰概率取 animationWeights（idle 40 / categories 60 → 60% 演）；
    // 连漏 MAX_MISS 次 → 下次必演；非待机（拖拽/移动/演出中）跳过且不记失败。
    useEffect(() => {
      const timer = window.setInterval(() => {
        const { animations, animationWeights } = config;
        if (dragRef.current.active || moveRef.current !== null || pendingMoveRef.current) return;
        const cur = animRef.current;
        if (!cur || !animations.idle.includes(cur)) return; // 仅待机（idle 循环）时判定
        const force = idleMissRef.current >= MAX_MISS;
        const roll = Math.random();
        const k = rollKind(roll, animationWeights);
        if (!force && k === 'idle') {
          idleMissRef.current += 1; // 未抽中 → 连漏计数
          return;
        }
        idleMissRef.current = 0;
        let kind: string;
        let next: string;
        if (k === 'turn' && animations.turn.length) {
          kind = 'TURN';
          next = pick(animations.turn, cur);
        } else if (k === 'move' && tryMoveRef.current()) {
          return; // 移动已接管播放（收尾回 idle 由 handleEnded 负责）
        } else {
          const act = pickCategoryAction(animations.categories, animations.idle, facingRef.current, cur);
          kind = act.id;
          next = act.name;
        }
        console.log(
          '[miku-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            cfg.id +
            ' facing=' +
            facingRef.current +
            ' roll=' +
            roll.toFixed(4) +
            ' -> [' +
            kind +
            '] ' +
            next,
        );
        setAnim(next);
        setOnce(true);
        setSeq((s) => s + 1);
        showBubble(next); // 随机动作 → 按动作弹对应气泡（无词库的动作自动忽略）
      }, ROLL_INTERVAL_MS);
      return () => window.clearInterval(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- 点击 vs 拖拽 ----
    const handlePointerDown = (e: ReactNS.PointerEvent<HTMLDivElement>) => {
      if (workingRef.current) stopWork(); // 点击/拖拽宠物 = 打断工作循环(之后照常处理)
      if (sleepingRef.current) stopSleep(); // 点击/拖拽宠物 = 唤醒(之后照常处理)
      // 注意:这里【不】清触摸计时器——纯点击不打断触摸动画(由 handleClick 的 touching 守卫挡重复触发);
      // 只有真正拖拽(dragging 成立)才在 handlePointerMove 里打断。
      e.currentTarget.classList.add('dragging');
      stopMove();
      e.currentTarget.setPointerCapture(e.pointerId);
      const rootEl = rootRef.current;
      let offX = 0;
      let offY = 0;
      if (rootEl) {
        const rr = rootEl.getBoundingClientRect();
        offX = e.clientX - (rr.left + rr.width / 2);
        offY = e.clientY - (rr.top + rr.height / 2);
      }
      dragRef.current = { active: true, dragging: false, sx: e.clientX, sy: e.clientY, offX, offY };
    };
    const handlePointerMove = (e: ReactNS.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d.active) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (!d.dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        d.dragging = true;
        setDragging(true);
        // 真正开始拖拽 → 中断触摸动画(清 3s 回待机计时,防止中途回 idle 打断拖拽)
        if (touchTimerRef.current !== null) {
          window.clearTimeout(touchTimerRef.current);
          touchTimerRef.current = null;
        }
        touchingRef.current = false;
        // 拖拽姿势循环播放(once=false 持续循环,与桌面版 playAction('Drag', false) 一致)
        setOnce(false);
        if (config.animations.drag.length) setAnim(pick(config.animations.drag));
      }
      const rootEl = rootRef.current;
      if (rootEl) {
        rootEl.style.left = e.clientX - d.offX - halfW + 'px';
        rootEl.style.top = e.clientY - d.offY - halfH + 'px';
        rootEl.style.right = 'auto';
        rootEl.style.bottom = 'auto';
      }
      const stageEl = stageRef.current;
      if (stageEl) stageEl.style.transform = 'none';
    };
    const handlePointerUp = (e: ReactNS.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      const wasDragging = d.dragging;
      d.active = false;
      d.dragging = false;
      e.currentTarget.classList.remove('dragging');
      if (wasDragging) {
        justDraggedRef.current = true;
        setTimeout(() => {
          justDraggedRef.current = false;
        }, 100);
        setDragging(false);
        setCustomPos({ rx: (e.clientX - d.offX) / window.innerWidth, ry: (e.clientY - d.offY) / window.innerHeight, corner });
        const stageEl = stageRef.current;
        if (stageEl) stageEl.style.transform = 'translateY(' + bottomPad + 'px)';
        // 拖拽结束:播一次"摔倒→站起"(standup,不参与随机、不进菜单),播完回 idle 循环;
        // 无 standup 池时维持旧行为(直接回 idle 循环)。与桌面版(pet2d.js)松手流程一致。
        const standupPool = config.animations.standup;
        if (standupPool && standupPool.length) {
          console.log(
            '[miku-pet] ' + new Date().toTimeString().slice(0, 8) + ' pet=' + cfg.id + ' drag-end -> standup: ' + standupPool.join(','),
          );
          setAnim(pick(standupPool, animRef.current));
          setOnce(true);
        } else {
          console.log('[miku-pet] ' + new Date().toTimeString().slice(0, 8) + ' pet=' + cfg.id + ' drag-end -> idle (no standup pool)');
          if (config.animations.idle.length) {
            setAnim(pick(config.animations.idle, animRef.current));
            setOnce(false);
          }
        }
      }
    };
    const handleClick = (e: ReactNS.MouseEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (d.active || d.dragging || justDraggedRef.current) return;
      // 每次点击:心情值随机 +0~3(0-100 夹取);动作播放中的点击同样计心情,仅动画/气泡不重复触发
      const boost = clickMoodBoost();
      setStats((prev) => ({ ...prev, mood: Math.min(100, prev.mood + boost) }));
      if (boost > 0) showFloat('心情 +' + boost); // 互动飘字反馈(0 时不弹)
      if (once && !config.animations.idle.includes(animRef.current)) return;
      if (touchingRef.current) return; // 触摸动画播放中:仅计心情,不回退/重复触发(防动画交错卡住)
      stopMove();
      setOnce(true);
      // 部位判定:按点击框内的纵向位置识别头/身/腿 → 触摸互动(成功/失败随机分支)
      const rect = e.currentTarget.getBoundingClientRect();
      const relY = rect.height > 0 ? (e.clientY - rect.top) / rect.height : -1;
      const zone = CLICK_ZONES.find((z) => relY >= z.y0 && relY < z.y1);
      console.log(
        '[miku-pet] ' + new Date().toTimeString().slice(0, 8) + ' pet=' + cfg.id + ' click zone=' + (zone?.id ?? 'none') + ' relY=' + relY.toFixed(3),
      );
      if (zone) {
        const roll = Math.random();
        if (roll < zone.success.prob) {
          applyTouch(zone.success);
          return;
        }
        if (zone.fail) {
          applyTouch(zone.fail);
          return;
        }
        // 未触发(头部 95% / 身体 90%)→ 回退普通点击回应(眨眼/吃饭),不抽挠头
        // (挠头与待机随机池共用,触摸回退用它易与随机演出冲突卡在挠头表情;exclude 当前动画防同动画重入)
      }
      if (config.animations.clicks.length) {
        const missPool = config.animations.clicks.filter((a) => a !== 'scratch' && a !== animRef.current);
        const n = missPool.length ? pick(missPool) : pick(config.animations.clicks);
        setAnim(n);
        setSeq((s) => s + 1); // 与 applyTouch 同一状态推进,避免同值动画 bailout 后无 seq 变化
        showBubble(n); // 点击 → 按回应动作弹对应气泡
      }
    };
    /** 触摸互动:好感度变化 + 专属动画循环播 ms 毫秒(结束后回 idle)+ 固定气泡 + 飘字 */
    const applyTouch = (o: TouchOutcome) => {
      setStats((prev) => ({ ...prev, affection: clampStat(prev.affection + o.delta, STAT_MAX.affection) }));
      showFloat((o.delta >= 0 ? '好感度 +' : '好感度 ') + o.delta);
      if (touchTimerRef.current !== null) window.clearTimeout(touchTimerRef.current);
      touchingRef.current = true;
      setAnim(o.anim);
      setOnce(false); // 循环播放,直到定时结束回 idle
      setSeq((s) => s + 1);
      showBubbleText(o.bubble, o.ms);
      touchTimerRef.current = window.setTimeout(() => {
        touchTimerRef.current = null;
        touchingRef.current = false;
        backToIdle();
      }, o.ms);
    };

    // ---- 渲染 ----
    const bottomPad = (size * (CANVAS_H - FEET_Y)) / CANVAS_H;
    const stageStyle = dragging ? { transform: 'none' } : { transform: 'translateY(' + bottomPad + 'px)' };
    const rootStyle = customPos
      ? (() => {
          const rx = customPos.rx;
          const ry = customPos.ry;
          const left = Math.min(Math.max(rx * window.innerWidth - halfW, 0), window.innerWidth - size);
          const top = Math.min(Math.max(ry * window.innerHeight - halfH, 0), window.innerHeight - size);
          return { left: left + 'px', top: top + 'px', right: 'auto', bottom: 'auto' };
        })()
      : {};
    const hitProps = {
      className: 'miku-pet-hit',
      style: {
        left: (HIT_BOX.x0 / 640) * 100 + '%',
        top: (HIT_BOX.y0 / 640) * 100 + '%',
        width: ((HIT_BOX.x1 - HIT_BOX.x0) / 640) * 100 + '%',
        height: ((HIT_BOX.y1 - HIT_BOX.y0) / 640) * 100 + '%',
      },
      onMouseEnter: (e: ReactNS.MouseEvent<HTMLDivElement>) => {
        if (!dragRef.current.active) e.currentTarget.style.cursor = 'grab';
      },
      onMouseLeave: (e: ReactNS.MouseEvent<HTMLDivElement>) => {
        if (!dragRef.current.active) e.currentTarget.style.cursor = 'default';
      },
      // 悬停菜单：进入显示、离开 260ms 后收起（留时间把鼠标挪进菜单）
      onPointerEnter: openMenu,
      onPointerLeave: closeMenu,
      onClick: handleClick,
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerUp,
      title: 'miku-pet',
    };
    // 悬停菜单（两级：一级=按钮列表；点击「改名」「钱包」进二级，「工作」直接执行）
    const menuNode = menuOpen
      ? h('div', {
          className: 'miku-pet-menu',
          'data-dsh-part': 'menu',
          'data-miku-lit': '1',
          onPointerEnter: openMenu,
          onPointerLeave: closeMenu,
          children:
            menuView === 'rename'
              ? [
                  h('div', { className: 'miku-pet-menu-row', children: [h('input', {
                    value: nameDraft,
                    maxLength: 32,
                    onInput: (e: ReactNS.FormEvent<HTMLInputElement>) => setNameDraft(e.currentTarget.value),
                    onKeyDown: (e: ReactNS.KeyboardEvent<HTMLInputElement>) => {
                      // 中文输入法组词中(回车确认候选字)不触发保存/取消
                      const native = e.nativeEvent as KeyboardEvent;
                      if (native.isComposing || native.keyCode === 229) return;
                      if (e.key === 'Enter') void saveName();
                      if (e.key === 'Escape') {
                        closeMenuNow();
                      }
                    },
                  })] }),
                  h('div', { className: 'miku-pet-menu-row', children: [
                    h('button', { className: 'primary', onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); void saveName(); }, children: '保存' }),
                    h('button', { onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); setMenuView('root'); }, children: '取消' }),
                  ] }),
                ]
              : menuView === 'wallet'
                ? [
                    h('div', { className: 'miku-pet-menu-row', children: [h('b', { children: '金币: ' + coins })] }),
                    h('div', { className: 'miku-pet-menu-row', children: [
                      h('button', { className: 'primary', onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); setMenuView('root'); }, children: '返回' }),
                    ] }),
                  ]
                : [
                    h('div', { className: 'miku-pet-menu-row', children: [
                      h('b', { children: petName || '未命名' }),
                      h('button', {
                        className: 'primary',
                        onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); startRename(); },
                        children: '改名',
                      }),
                    ] }),
                    h('div', { className: 'miku-pet-actions-grid', children: [
                      h('button', {
                        onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); setMenuView('wallet'); },
                        children: '金币钱包',
                      }),
                      h('button', {
                        onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => {
                          e.stopPropagation();
                          closeMenuNow();
                          setShopOpen(true); // 商店 = 网页中央独立窗口
                        },
                        children: '商店',
                      }),
                      h('button', {
                        className: 'primary',
                        disabled: working,
                        onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); doWork(); },
                        children: working ? '工作中…' : '工作',
                      }),
                      h('button', {
                        disabled: sleeping,
                        onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); doSleep(); },
                        children: sleeping ? '睡觉中…' : '睡觉',
                      }),
                    ] }),
                    h('div', { className: 'miku-pet-menu-row', children: [
                      h('button', {
                        onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => {
                          e.stopPropagation();
                          closeMenuNow();
                          setHelpOpen(true); // 玩法说明 = 独立动漫风弹层
                        },
                        children: '玩法说明',
                      }),
                      customPos
                        ? h('button', {
                            onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); setCustomPos(null); },
                            children: '回角落',
                          })
                        : null,
                    ] }),
                  ],
        })
      : null;
    return h('div', {
      ref: rootRef,
      className: 'miku-pet-root',
      'data-corner': corner,
      'data-facing': facing,
      // 高特异性钩子:供覆盖规则压过 GUI 皮肤 patches(html[data-dsh-skin] body[data-ds-dark-theme] [class*=menu] !important)
      'data-miku-lit': '1',
      'data-miku-root': '1',
      style: Object.assign(
        { '--miku-pet-size': size + 'px', '--miku-pet-mx': margin.x + 'px', '--miku-pet-my': margin.y + 'px' },
        rootStyle,
        // 商店打开时把整个根提到最顶层,遮罩可覆盖页面全部(含应用自身浮层)
        shopOpen ? { zIndex: 99999 } : {},
      ),
      children: [
        h('div', {
          ref: stageRef,
          className: 'miku-pet-stage',
          'data-dsh-part': 'sprite',
          style: stageStyle,
          children: [
            h('img', {
              ref: imgRef,
              className: 'miku-pet-video is-front',
              style: { transform: facing === 'right' ? 'scaleX(-1)' : 'scaleX(1)' },
              alt: 'miku-pet',
            }),
            h('div', hitProps),
          ],
        }),
        // 名字不再常驻显示(悬停菜单里就能看到,见 menuNode 首行)
        null,
        // 左侧属性彩条(饥饿/心情/活力 0-100;与菜单同显隐)
        menuOpen
          ? h('div', {
              className: 'miku-pet-stats',
              'data-dsh-part': 'stats',
              'data-miku-lit': '1',
              children: STAT_DEFS.map((d) => {
                const v = Math.round(stats[d.key]);
                const pct = Math.min(100, Math.max(0, (v / d.max) * 100));
                return h('div', { className: 'miku-pet-stat', children: [
                  h('span', { className: 'miku-pet-stat-label', children: d.label }),
                  h('span', { className: 'miku-pet-stat-track', children: [
                    h('span', { className: 'miku-pet-stat-fill', style: { width: pct + '%', background: d.color } }),
                  ] }),
                  h('span', { className: 'miku-pet-stat-num', children: String(v) }),
                ] });
              }),
            })
          : null,
        // 对话气泡（按动作弹台词；自动隐藏）
        bubble ? h('div', { className: 'miku-pet-bubble', 'data-dsh-part': 'bubble', children: bubble }) : null,
        // 互动飘字（点击等操作：头顶弹出 +0.25 心情）
        floatMsg ? h('div', { key: floatKey, className: 'miku-pet-float', 'data-dsh-part': 'float', children: floatMsg }) : null,
        // 悬停菜单
        menuNode,
        // 商店独立窗口（网页中央模态；标题居中「miku商店」/ 格子物品 / 右下角钱包余额）
        shopOpen
          ? h('div', {
              className: 'miku-pet-shop-overlay',
              'data-dsh-part': 'shop',
              onClick: () => setShopOpen(false),
              children: h('div', {
                className: 'miku-pet-shop-window',
                'data-miku-lit': '1',
                onClick: (e: ReactNS.MouseEvent<HTMLDivElement>) => e.stopPropagation(),
                children: [
                  h('div', { className: 'miku-pet-shop-head', children: [
                    h('span', { className: 'miku-pet-shop-head-deco', children: '*' }),
                    h('b', { className: 'miku-pet-shop-title', children: 'miku商店' }),
                    h('span', { className: 'miku-pet-shop-head-deco', children: '*' }),
                  ] }),
                  h('button', {
                    className: 'miku-pet-shop-close',
                    onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); setShopOpen(false); },
                    children: '*',
                  }),
                  h('div', { className: 'miku-pet-shop-grid', children: SHOP_ITEMS.map((it) =>
                    h('div', { className: 'miku-pet-shop-cell', children: [
                      h('img', { className: 'miku-pet-shop-img', src: it.img, alt: it.id }),
                      h('span', { className: 'miku-pet-shop-cell-name', children: it.label }),
                      h('span', {
                        className: 'miku-pet-shop-cell-meta',
                        children: it.price + (it.lottery ? ' 游戏币 · ' : ' 金币 · ') + (it.hunger ? '恢复 ' + it.hunger + ' 饥饿' : it.gameCoins ? '兑换 ' + it.gameCoins + ' 个' : '全属性+10,买即开奖(最高100万)'),
                      }),
                      h('button', {
                        onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); buyItem(it); },
                        children: '购买',
                      }),
                    ] }),
                  )}),
                  h('div', { className: 'miku-pet-shop-foot', children: [
                    h('button', {
                      onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); setShopOpen(false); },
                      children: '关闭',
                    }),
                    h('span', { className: 'miku-pet-shop-coins', children: '钱包 ' + coins + ' 金币 · 游戏币 ' + gameCoins }),
                  ] }),
                ],
              }),
            })
          : null,
        // 彩票中奖弹层:独立页面提示(在商店之上,不走气泡);点遮罩/确认关闭
        lotteryResult
          ? h('div', {
              className: 'miku-pet-shop-overlay',
              onClick: () => setLotteryResult(null),
              children: h('div', {
                className: 'miku-pet-shop-window',
                'data-miku-lit': '1',
                onClick: (e: ReactNS.MouseEvent<HTMLDivElement>) => e.stopPropagation(),
                children: [
                  h('div', { className: 'miku-pet-shop-head', children: [
                    h('span', { className: 'miku-pet-shop-head-deco', children: '*' }),
                    h('b', { className: 'miku-pet-shop-title', children: '幸运开奖' }),
                    h('span', { className: 'miku-pet-shop-head-deco', children: '*' }),
                  ] }),
                  h('div', {
                    className: 'miku-pet-lottery-prize',
                    children: (lotteryResult.prize >= 1_000_000 ? '* 头奖 * ' : '') + lotteryResult.prize.toLocaleString() + ' 金币',
                  }),
                  h('div', { className: 'miku-pet-lottery-sub', children: '游戏币余额 ' + lotteryResult.gameCoins }),
                  h('div', { className: 'miku-pet-lottery-actions', children: [
                    h('button', {
                      className: 'primary',
                      onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); setLotteryResult(null); },
                      children: '确认',
                    }),
                  ] }),
                ],
              }),
            })
          : null,
        // 玩法说明页(独立动漫风弹层,列出彩票概率与期望值)
        helpOpen
          ? h('div', {
              className: 'miku-pet-shop-overlay',
              onClick: () => setHelpOpen(false),
              children: h('div', {
                className: 'miku-pet-shop-window',
                'data-miku-lit': '1',
                onClick: (e: ReactNS.MouseEvent<HTMLDivElement>) => e.stopPropagation(),
                children: [
                  h('div', { className: 'miku-pet-shop-head', children: [
                    h('span', { className: 'miku-pet-shop-head-deco', children: '*' }),
                    h('b', { className: 'miku-pet-shop-title', children: '玩法说明' }),
                    h('span', { className: 'miku-pet-shop-head-deco', children: '*' }),
                  ] }),
                  h('button', {
                    className: 'miku-pet-shop-close',
                    onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); setHelpOpen(false); },
                    children: '×',
                  }),
                  h('div', { className: 'miku-pet-help-body', children: [
                    // 金币收入
                    h('div', { className: 'miku-pet-help-block', children: [
                      h('b', { children: '金币收入' }),
                      h('div', { children: '· 被动收入:每分钟自动 +1 金币(待机/工作/睡觉均生效),下线后不累计。' }),
                      h('div', { children: '· 工作:每 10s 判定一轮,50% 成功 +3 金币、50% 失败 -1 金币,判定后自动继续下一轮,点击/拖拽可打断。' }),
                      h('div', { children: '· 钱包余额下限 0,存 localStorage/存档文件,刷新不丢失。' }),
                    ] }),
                    // 属性与衰减
                    h('div', { className: 'miku-pet-help-block', children: [
                      h('b', { children: '属性与衰减(每 60s 结算)' }),
                      h('div', { children: '· 饥饿:-1(工作中 -5),下限 0,商店食物可恢复。' }),
                      h('div', { children: '· 心情:-0.5,下限 0;点击宠物随机 +0~3。' }),
                      h('div', { children: '· 活力:-0.25,下限 0;睡觉每 30s +4(上限 100)。' }),
                      h('div', { children: '· 好感度:待机每满 300s -1,下限 0、上限 500。' }),
                    ] }),
                    // 触摸互动
                    h('div', { className: 'miku-pet-help-block', children: [
                      h('b', { children: '触摸互动(好感度)' }),
                      h('div', { children: '· 头部(宠物上半):5% 概率 +5 好感,触发开心动画 3 秒。' }),
                      h('div', { children: '· 身体(中部):10% 概率 +10 好感,触发害羞动画 3 秒。' }),
                      h('div', { children: '· 腿部(下半):10% 概率 +30 好感并触发色色动画;90% 概率 -5 好感并触发生气动画。' }),
                    ] }),
                    // 睡觉与拖拽
                    h('div', { className: 'miku-pet-help-block', children: [
                      h('b', { children: '睡觉与拖拽' }),
                      h('div', { children: '· 睡觉:菜单触发,每 30s 活力 +4;点击/拖拽唤醒;与工作互斥。' }),
                      h('div', { children: '· 拖拽:拖走宠物松手播放站起动画并回待机,位置会记住,菜单可「回角落」。' }),
                    ] }),
                    // 随机待机演出
                    h('div', { className: 'miku-pet-help-block', children: [
                      h('b', { children: '随机待机演出' }),
                      h('div', { children: '· 待机时每 5s 掷骰,60% 概率表演随机动作(眨眼/挠头/吃饭)。' }),
                      h('div', { children: '· 连续 2 次没抽中时,下一次 100% 必演(保底)。' }),
                    ] }),
                    // 商店
                    h('div', { className: 'miku-pet-help-block', children: [
                      h('b', { children: '商店(均需金币/游戏币充足)' }),
                      h('div', { children: '· 黄油面包:5 金币兑换,饥饿 +40。' }),
                      h('div', { children: '· 红豆沙包:10 金币兑换,饥饿 +80。' }),
                      h('div', { children: '· 游戏币:10 金币兑换 1 个,可无限攒。' }),
                      h('div', { children: '· 幸运彩票:10 游戏币/张,购买后全属性 +10 并立即开奖,奖金直接入钱包。' }),
                    ] }),
                    // 彩票奖池
                    h('div', { className: 'miku-pet-help-block', children: [
                      h('b', { children: '幸运彩票奖池(每张独立开奖)' }),
                      h('table', { className: 'miku-pet-help-table', children: [
                        h('tr', { children: [h('th', { children: '奖金(金币)' }), h('th', { children: '概率' }), h('th', { children: '期望贡献' })] }),
                        LOTTERY_TIERS.map((t) => h('tr', { children: [
                          h('td', { children: t.prize.toLocaleString() }),
                          h('td', { children: t.pct + '%' }),
                          h('td', { children: ((t.prize * t.pct) / 100).toFixed(1) + ' 金' }),
                        ] })),
                      ] }),
                      h('div', { className: 'miku-pet-help-ev', children: '每张期望收益 ≈ ' + LOTTERY_EV.toFixed(1) + ' 金币' }),
                    ] }),
                  ] }),
                ],
              }),
            })
          : null,
      ],
    });
  }

  /** 多开容器：拉取配置 → 合并默认+用户层 pets → 渲染多个 PetCard */
  function PetMulti() {
    const [pets, setPets] = useState<Pet[]>([]);
    const [ready, setReady] = useState(false);

    useEffect(() => {
      let alive = true;
      (async () => {
        try {
          const r1 = await fetch('/miku-pet/config.jsonc?v=' + Date.now());
          if (!r1.ok) throw new Error('config.jsonc HTTP ' + r1.status);
          config = assertClientConfig(JSON.parse(stripJsonc(await r1.text())));
          const defaults = config.pets;
          // 用户覆盖层（覆盖片段：pets / animations / animationWeights，缺省回落默认）
          let user: UserOverrides = {};
          try {
            const r2 = await fetch('/miku-pet/config');
            if (r2.ok && r2.status !== 204) user = await r2.json().catch(() => ({}));
          } catch {
            /* 无用户层时忽略 */
          }
          config = applyUserOverrides(config, user);
          const merged = config.pets;
          if (!alive) return;
          petBridge.current = merged;
          petBridge.template = defaults.length ? defaults[0] : undefined;
          petBridge.sync = (list: Pet[]) => {
            setPets(list);
            petBridge.current = list;
          };
          setPets(merged);
          setReady(true);
        } catch (e) {
          console.error('[miku-pet] 配置加载失败', e); // 配置缺失/损坏：显式报错，不静默隐藏
        }
      })();
      return () => {
        alive = false;
        petBridge.sync = () => {};
      };
    }, []);

    return ready ? pets.map((p) => h(PetCard, { key: p.id, cfg: p })) : null;
  }

  return PetMulti;
}
