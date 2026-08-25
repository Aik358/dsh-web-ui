/**
 * dsh-perf 代理式 assistant-step shadow。
 *
 * 机制(源码证据): 官方在 keyed slot 'conversation.chat.node' 以 priority 0 注册
 * assistant-step 渲染器; slots 投影规则是"每个 cell 的 lowest priority entry 渲染",
 * 而 abdicate 是崩溃退役而非 null 让位 —— 因此轻节点无法自动放行官方。
 * 本 shadow 以 priority -1 注册, 内部持有官方组件引用(apply 时从
 * SlotCore.entries() 原始视图捕获), 轻节点直接转发官方 props 渲染(零行为差异),
 * 仅对超重节点做降载(流式渲染不打 shiki + 折叠), 点击"完整渲染"再转发官方。
 * official 捕获失败时 fail-safe: 一律降载渲染(视觉降级但永不空白)。
 * @module @linxin666/dsh-perf/client
 */
import { createElement, memo, useState, type ComponentType } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'

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

/** 降载渲染: 文本走 MarkdownText(streaming, 不触发代码高亮); 代码/推理折叠。 */
function DegradedBlocks(props: ShadowOwner, onExpand: () => void): JSX.Element | null {
  const blocks = props.node?.data?.blocks ?? []
  const total = blockChars(blocks)
  const rows = blocks.map((block, index) => {
    if (block.kind === 'text') {
      return createElement(MarkdownText, {
        key: index,
        text: block.text ?? '',
        streaming: true,
        fileMentions: props.fileMentions as never,
      })
    }
    if (block.kind === 'reasoning') {
      return createElement('details', { key: index, style: { opacity: 0.72, fontSize: '0.92em' } },
        createElement('summary', null, '推理 (' + (block.text?.length ?? 0) + ' 字符)'),
        createElement('pre', null, block.text ?? ''),
      )
    }
    if (block.kind === 'code') {
      const lines = (block.text ?? '').split('\n').length
      return createElement('details', { key: index },
        createElement('summary', null, '代码 [' + (block.lang ?? '') + '] ' + lines + ' 行'),
        createElement('pre', null,
          createElement('code', null, block.text ?? ''),
        ),
      )
    }
    return null
  })
  return createElement('div', { 'data-dsh-perf-shadow': '1', style: { position: 'relative' } },
    rows,
    createElement('button', {
      onClick: onExpand,
      style: {
        marginTop: 6, padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(128,148,168,.35)',
        background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer', fontSize: '0.92em',
      },
    }, '完整渲染（共 ' + Math.round(total / 1024) + 'KB）'),
  )
}

/** Build the shadow component around the captured official renderer.
 * @param official - captured official assistant-step renderer (undefined = fail-safe degrade).
 * @param enabled - plugin setting (dsh-perf renderDegrade) reader; light nodes always forward official.
 */
export function makePerfAssistantShadow(
  official: ComponentType<ShadowOwner> | undefined,
  enabled: () => boolean = (): boolean => true,
): ComponentType<ShadowOwner> {
  const Shadow = memo(function PerfAssistantShadow(props: ShadowOwner) {
    const [expanded, setExpanded] = useState(false)
    const isAssistant = props.node?.kind === 'assistant-step'
    const blocks = props.node?.data?.blocks ?? []
    const heavy = enabled() && isAssistant && !expanded && blockChars(blocks) > threshold()
    if (!heavy && official !== undefined) {
      // 轻节点: 透传转发官方(相同 owner/inject 面, 零行为差异)。
      return createElement(official, props)
    }
    if (official === undefined && !isAssistant) return null
    return DegradedBlocks(props, () => setExpanded(true))
  })
  return Shadow
}