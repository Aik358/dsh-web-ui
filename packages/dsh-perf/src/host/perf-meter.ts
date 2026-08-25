import { monitorEventLoopDelay } from 'node:perf_hooks'
type EventLoopDelayMonitor = ReturnType<typeof monitorEventLoopDelay>
import type { Context } from '@deepseek-ai/cordis'

export type PerfMode = 'off' | 'balanced' | 'aggressive'

export interface PerfMeterOptions {
  /** HUD 与服务端观测开关: off 时仅保留路由占位, 不订阅事件、不采样。 */
  mode: PerfMode
  /** 采样周期(毫秒), 也是 bucket 粒度。 */
  meterIntervalMs: number
  /** 环形窗口保留时间(秒), 用于 events/s 与类型分布。 */
  statsWindowSeconds: number
  /** bundle patch 应用的写批延迟(毫秒), 展示用。 */
  batchDelayMs: number
}

interface SessionTrack {
  window: number
  lastType: string
}

interface Bucket {
  at: number
  events: number
  sessions: number
}

export interface PerfSessionStat {
  id: string
  eventsPerSec: number
  lastType: string
}

export interface PerfStats {
  ok: true
  ts: number
  uptimeMs: number
  mode: PerfMode
  meterIntervalMs: number
  batchDelayMs: number
  elDelay: { meanMs: number; p99Ms: number; maxMs: number }
  mem: { rssMB: number; heapUsedMB: number }
  events: { perSec: number; window: number; activeSessions: number }
  topSessions: PerfSessionStat[]
  eventTypes: Record<string, number>
}

export class PerfMeter {
  private readonly sessions = new Map<string, SessionTrack>()
  private readonly types = new Map<string, number>()
  private readonly buckets: Bucket[] = []
  private readonly el: EventLoopDelayMonitor
  private timer: ReturnType<typeof setInterval> | undefined
  private disposed = false
  private started = false
  private windowMs: number

  constructor(
    private readonly ctx: Context,
    private options: PerfMeterOptions,
  ) {
    this.el = monitorEventLoopDelay({ resolution: 10 })
    this.windowMs = options.statsWindowSeconds * 1000
  }

  /** (Re)apply host-side options; cheap, safe to call on settings change. */
  applyOptions(options: PerfMeterOptions): void {
    this.windowMs = options.statsWindowSeconds * 1000
    const wasOff = this.options.mode === 'off'
    this.options = options
    if (wasOff && options.mode !== 'off' && this.started) this.attach()
    if (!wasOff && options.mode === 'off' && this.started) this.detach()
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.el.enable()
    this.attach()
    this.timer = setInterval(() => this.tick(), this.options.meterIntervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.disposed) return
    this.disposed = true
    this.detach()
    if (this.timer !== undefined) clearInterval(this.timer)
    this.el.disable()
    this.started = false
  }

  private attach(): void {
    if (this.attached) return
    this.attached = true
    const ctx = this.ctx as unknown as {
      on(event: string, listener: (subject: unknown, event: unknown) => void): () => void
    }
    const off = ctx.on('session/event', (subject, event) => {
      const ev = event as { type?: string }
      const type = typeof ev?.type === 'string' ? ev.type : 'unknown'
      const id = (subject as { id?: string } | undefined)?.id ?? 'root'
      this.noteEvent(id, type)
    })
    if (typeof off === 'function') this.disposers.push(off)
  }

  private detach(): void {
    for (const dispose of this.disposers) { try { dispose() } catch { /* noop */ } }
    this.disposers.length = 0
    this.attached = false
  }

  private attached = false
  private readonly disposers: (() => void)[] = []
  private pending = 0

  private noteEvent(id: string, type: string): void {
    this.pending += 1
    const track = this.sessions.get(id) ?? { window: 0, lastType: type }
    track.window += 1
    track.lastType = type
    this.sessions.set(id, track)
    this.types.set(type, (this.types.get(type) ?? 0) + 1)
  }

  /** 每 tick 归档: pending -> bucket; 解算窗口速率; 读取 EL 延迟并重置。 */
  private tick(): void {
    const at = Date.now()
    const events = this.pending
    this.pending = 0
    if (events === 0) {
      this.el.reset()
      this.compactBuckets(at, 0)
      return
    }
    const sessions = this.sessions.size
    this.buckets.push({ at, events, sessions })
    this.compactBuckets(at, events)
    // 每 tick 读一次均值并将累计器清零, 使数字代表"最近一个采样周期"。
    const meanMs = this.el.mean / 1e6
    const p99Ms = this.el.percentile(99) / 1e6
    const maxMs = this.el.max / 1e6
    this.el.reset()
    this.lastDelay = { meanMs, p99Ms, maxMs }
  }

  private lastDelay: { meanMs: number; p99Ms: number; maxMs: number } = { meanMs: 0, p99Ms: 0, maxMs: 0 }

  private compactBuckets(at: number, _events: number): void {
    const cutoff = at - this.windowMs
    while (this.buckets.length > 0 && this.buckets[0].at < cutoff) this.buckets.shift()
  }

  private windowEvents(): { perSec: number; count: number } {
    if (this.buckets.length === 0) return { perSec: 0, count: 0 }
    const span = Math.max(1, (this.buckets[this.buckets.length - 1].at - this.buckets[0].at) / 1000)
    const count = this.buckets.reduce((sum, bucket) => sum + bucket.events, 0)
    return { perSec: Math.round((count / span) * 10) / 10, count }
  }

  snapshot(): PerfStats {
    const { perSec, count } = this.windowEvents()
    const now = Date.now()
    const activeSessions = [...this.sessions.values()].filter(track => track.window > 0).length
    const topSessions: PerfSessionStat[] = [...this.sessions.entries()]
      .sort((a, b) => b[1].window - a[1].window)
      .slice(0, 5)
      .map(([id, track]) => ({
        id,
        eventsPerSec: Math.round((track.window / Math.max(1, this.windowMs / 1000)) * 10) / 10,
        lastType: track.lastType,
      }))
    const mem = process.memoryUsage()
    return {
      ok: true,
      ts: now,
      uptimeMs: process.uptime() * 1000,
      mode: this.options.mode,
      meterIntervalMs: this.options.meterIntervalMs,
      batchDelayMs: this.options.batchDelayMs,
      elDelay: this.lastDelay,
      mem: { rssMB: Math.round(mem.rss / 1048576), heapUsedMB: Math.round(mem.heapUsed / 1048576) },
      events: { perSec, window: count, activeSessions },
      topSessions,
      eventTypes: Object.fromEntries([...this.types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)),
    }
  }
}
