/**
 * Browser half for @linxin666/dsh-perf: a tiny performance HUD.
 *
 * One poll loop reads the host's loopback-fenced /api/dsh-perf/stats
 * (event/s, event-loop delay, memory, batch delay) and merges it with local
 * browser sampling (rAF FPS + longtask count). Everything degrades silently:
 * a missing host half hides the HUD, a hostile environment keeps the GUI
 * unaffected. apply() never throws.
 * @module @linxin666/dsh-perf/client
 */

/** Wire shape the host half returns; loose on purpose (host version drift). */
interface StatsWire {
  ok?: boolean
  ts?: number
  uptimeMs?: number
  mode?: string
  meterIntervalMs?: number
  batchDelayMs?: number
  elDelay?: { meanMs?: number; p99Ms?: number; maxMs?: number }
  mem?: { rssMB?: number; heapUsedMB?: number }
  events?: { perSec?: number; window?: number; activeSessions?: number }
  topSessions?: { id?: string; eventsPerSec?: number; lastType?: string }[]
  eventTypes?: Record<string, number>
  alert?: {
    kind?: string
    activeSessions?: number
    eventsPerSec?: number
    maxSessions?: number
    maxEventsPerSec?: number
  } | null
}

const API_STATS = '/api/dsh-perf/stats'
const POLL_MS = 2000
const STORAGE_KEY = 'dsh-perf-hud-visible'
const FPS_WINDOW_MS = 1000
const LONGTASK_WINDOW_MS = 60_000

export function apply(): void {
  try {
    boot()
  } catch (error) {
    console.debug('[dsh-perf] HUD boot degraded:', error)
  }
}

function boot(): void {
  const host = document.documentElement
  if (host === null || host === undefined) return

  const root = document.createElement('div')
  root.dataset.dshPerf = 'hud'
  root.style.cssText = [
    'position:fixed', 'bottom:10px', 'right:10px', 'z-index:2147483000',
    'padding:7px 9px', 'border-radius:8px', 'background:rgba(15,20,26,.92)',
    'color:#d8e0ea', 'font:11px/1.5 ui-monospace,Menlo,Consolas,monospace',
    'white-space:pre', 'pointer-events:auto', 'user-select:none',
    'box-shadow:0 2px 12px rgb(0 0 0 / .35)', 'max-width:340px', 'overflow:hidden',
    'border:1px solid transparent',
  ].join(';')

  const cache: { stats?: StatsWire; stale: boolean; failures: number } = { stats: undefined, stale: true, failures: 0 }
  const longtasks: number[] = []
  let fps = 0

  // --- 本地采样: FPS(近 1s) + Longtask(近 60s) ----------------------
  let frames = 0
  let fps0 = performance.now()
  const rafLoop = (): void => {
    frames += 1
    const now = performance.now()
    if (now - fps0 >= FPS_WINDOW_MS) {
      fps = Math.round((frames * 1000) / (now - fps0))
      frames = 0
      fps0 = now
    }
    requestAnimationFrame(rafLoop)
  }
  requestAnimationFrame(rafLoop)

  try {
    const observer = new PerformanceObserver((list) => {
      const now = performance.now()
      longtasks.push(now)
      const cutoff = now - LONGTASK_WINDOW_MS
      while (longtasks.length > 0 && longtasks[0] < cutoff) longtasks.shift()
    })
    observer.observe({ entryTypes: ['longtask'] })
  } catch { /* Safari/旧 Chrome 无 longtask: 静默 */ }

  // --- 轮询 host -----------------------------------------------------
  const poll = async (): Promise<void> => {
    let wire: StatsWire | undefined
    try {
      const response = await fetch(API_STATS, { cache: 'no-store' })
      if (!response.ok) throw new Error('http ' + response.status)
      const body: unknown = await response.json()
      if (typeof body === 'object' && body !== null) wire = body as StatsWire
    } catch { /* host half 未启用/未安装 */ }
    if (wire === undefined) {
      cache.failures += 1
      if (cache.failures >= 3) {
        cache.stale = true
        root.style.display = 'none'
      }
      return
    }
    cache.failures = 0
    cache.stats = wire
    cache.stale = false
    root.style.display = currentVisible() ? 'block' : 'none'
    render(root, cache, fps, longtasks.length)
  }

  // --- 渲染 -----------------------------------------------------------
  let renderInto: HTMLElement | undefined
  function render(hostEl: HTMLElement, state: { stats?: StatsWire }, currentFps: number, longtaskCount: number): void {
    const s = state.stats
    if (s === undefined) return
    const lines: string[] = []
    const mode = s.mode ?? '?'
    const batch = s.batchDelayMs ?? '?'
    const alert = s.alert
    if (alert) {
      const reason = alert.kind === 'sessions'
        ? '会话 ' + (alert.activeSessions ?? '?') + ' 个 ≥ 阈值 ' + (alert.maxSessions ?? '?')
        : alert.kind === 'events'
          ? '事件 ' + (alert.eventsPerSec ?? '?') + '/s ≥ 阈值 ' + (alert.maxEventsPerSec ?? '?')
          : '会话与事件均超阈值'
      lines.push('[!] ' + reason)
    }
    lines.push('dsH PERF  mode=' + mode + '  batch=' + batch + 'ms')
    const ev = s.events ?? {}
    lines.push('events ' + (ev.perSec ?? '?') + '/s  active=' + (ev.activeSessions ?? '?') + '  win=' + (ev.window ?? '?'))
    const el = s.elDelay ?? {}
    lines.push('EL p99=' + fmtMs(el.p99Ms) + ' mean=' + fmtMs(el.meanMs))
    lines.push('fps=' + currentFps + '  longtasks(60s)=' + longtaskCount)
    const mem = s.mem ?? {}
    lines.push('rss=' + (mem.rssMB ?? '?') + 'MB  heap=' + (mem.heapUsedMB ?? '?') + 'MB')
    for (const session of (s.topSessions ?? []).slice(0, 3)) {
      const id = shortId(session.id ?? '?')
      lines.push('  · ' + id + '  ' + (session.eventsPerSec ?? '?') + '/s [' + (session.lastType ?? '') + ']')
    }
    hostEl.style.borderColor = alert ? '#ff8a65' : 'transparent'
    if (renderInto !== undefined) renderInto.textContent = lines.join('\n')
    else hostEl.textContent = lines.join('\n')
  }
  function fmtMs(value: number | undefined): string {
    if (value === undefined) return '?'
    return (value >= 100 ? Math.round(value) : Math.round(value * 10) / 10) + 'ms'
  }
  function shortId(id: string): string {
    return id.length > 12 ? id.slice(0, 12) + '…' : id
  }

  // --- 可见性 / 生命周期 ----------------------------------------------
  function currentVisible(): boolean {
    return localStorage.getItem(STORAGE_KEY) !== 'hidden'
  }
  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    if (target?.dataset.dshPerfAction === 'close') {
      localStorage.setItem(STORAGE_KEY, 'hidden')
      root.style.display = 'none'
    }
  })

  const closeBtn = document.createElement('button')
  closeBtn.dataset.dshPerfAction = 'close'
  closeBtn.textContent = '×'
  closeBtn.style.cssText = 'position:absolute;top:2px;right:4px;border:0;background:none;color:#8fa3b8;cursor:pointer;font:12px/1 monospace;padding:2px'
  root.appendChild(closeBtn)

  // 数据区与关闭按钮分离: textContent 更新不得清掉按钮。
  const dataEl = document.createElement('pre')
  dataEl.style.cssText = 'margin:0;font:inherit;color:inherit'
  root.appendChild(dataEl)
  root.appendChild(closeBtn)
  // render 状态注入容器
  renderInto = dataEl

  if (!currentVisible()) root.style.display = 'none'
  else document.body.appendChild(root)
  void poll()
  setInterval(poll, POLL_MS)
}