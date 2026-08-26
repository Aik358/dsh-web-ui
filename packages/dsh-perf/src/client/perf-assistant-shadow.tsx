/**
 * dsh-perf 保持观感的助手消息 shadow。
 *
 * 设计: 不替换官方渲染的任何视觉 —— 所有 assistant-step 节点都经官方渲染器输出
 * (样式、推理行、代码块、图片、操作按钮完全同款)。唯一干预: 超重(>threshold 字符)
 * 且已 settled 的消息, 首次渲染强制以 "running"(流式) 形态转交官方 —— 官方流式
 * 分支本来就不打 shiki/KaTeX(源码: streaming ? void 0 : 高亮), 节点外观与官方
 * 流式期间的普通围栏样式完全一致; 随后 600ms 定时器把状态翻回 settled, 让高亮在
 * 回合结束热路径之外一次性完成。最终外观与官方渲染逐像素一致, 无折叠、无降载按钮。
 *
 * 官方捕获: 注册时序上本插件 inject 回调先于官方回调执行, 因此捕获放在首次渲染
 * (全部插件已 apply) 时进行, 且必须排除自身上下(entries 按 priority 排序, 自身在前)。
 * 捕获失败时仍走官方失败面(渲染 JsonBlock 兜底), 绝不出现降载视图。
 */
import { createElement, memo, useEffect, useRef, useState, type ComponentType } from 'react'

interface ShadowBlock {
  kind?: string
  text?: string
  lang?: string
}

interface ShadowData {
  status?: string
  blocks?: ShadowBlock[]
}

export interface ShadowOwner {
  node?: { key?: string; kind?: string; data?: ShadowData }
  useTurnData?: (key: string) => unknown
  openFile?: unknown
  renderMessageImages?: unknown
  fileMentions?: unknown
  t?: (key: string) => string
  [k: string]: unknown
}

const DEFAULT_THRESHOLD = 20000
const FINALIZE_DELAY_MS = 600

function threshold(): number {
  try {
    const value = Number(localStorage.getItem('dsh-perf-shadow-threshold'))
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_THRESHOLD
  } catch { return DEFAULT_THRESHOLD }
}

function blockChars(blocks: ShadowBlock[]): number {
  let total = 0
  for (const block of blocks) total += block?.text?.length ?? 0
  return total
}

/** Build the shadow component around the official assistant-step renderer.
 * @param official - 注册期捕获的官方渲染器(可能尚未注册, 直接传 undefined)。
 * @param enabled - renderDegrade 开关读取器; 关闭时直接转交官方, 零干预。
 * @param captureOfficial - 渲染期懒捕获器(须排除影子自身)。
 */
export function makePerfAssistantShadow(
  official: ComponentType<ShadowOwner> | undefined,
  enabled: () => boolean = (): boolean => true,
  captureOfficial?: () => ComponentType<ShadowOwner> | undefined,
): ComponentType<ShadowOwner> {
  const Shadow = memo(function PerfAssistantShadow(props: ShadowOwner) {
    const officialRef = useRef<ComponentType<ShadowOwner> | undefined>(official)
    if (officialRef.current === undefined && captureOfficial !== undefined) {
      officialRef.current = captureOfficial()
    }
    const data = props.node?.data
    const isAssistant = props.node?.kind === 'assistant-step'
    const heavy = enabled() && isAssistant && data?.status === 'settled' && blockChars(data?.blocks ?? []) > threshold()
    const [finalized, setFinalized] = useState(!heavy)
    useEffect(() => {
      if (!heavy || finalized) return
      let cancelled = false
      const id = setTimeout(() => {
        if (!cancelled) setFinalized(true)
      }, FINALIZE_DELAY_MS)
      return () => { cancelled = true; clearTimeout(id) }
    }, [heavy, finalized])
    if (officialRef.current === undefined) {
      // 无官方可转交: 按官方 slot 的 fallback 兜底(JsonBlock), 不改视觉契约。
      return null
    }
    const effective = heavy && !finalized
      ? { ...props, node: props.node === undefined ? undefined : { ...props.node, data: { ...data, status: 'running' } } }
      : props
    return createElement(officialRef.current, effective)
  })
  return Shadow
}
