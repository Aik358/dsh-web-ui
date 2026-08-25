import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import { mountOnce } from './mount-once.ts'
import { PerfMeter, type PerfMode, type PerfMeterOptions } from './host/perf-meter.ts'
import { makePerfStatsRoute } from './host/routes.ts'

export const name = 'dsh-perf'
export const inject = ['webServer']
export const PERF_SETTINGS_NAMESPACE = settingsNamespace('dsh-perf')

export interface Config {
  enabled?: boolean
  mode?: string
  meterIntervalMs?: number
  statsWindowSeconds?: number
  maxActiveSessions?: number
  maxEventsPerSec?: number
  /** 客户端消息渲染降载(P1 shadow)开关, 由 client 消费, host 只做 schema 承载。 */
  renderDegrade?: boolean
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  mode: z.string().default('balanced'),
  meterIntervalMs: z.number().min(1000).max(60000).default(2000),
  statsWindowSeconds: z.number().min(10).max(3600).default(120),
  maxActiveSessions: z.number().min(1).max(100).default(5),
  maxEventsPerSec: z.number().min(10).max(100000).default(300),
  renderDegrade: z.boolean().default(true),
})

export interface ResolvedConfig {
  enabled: boolean
  mode: PerfMode
  meterIntervalMs: number
  statsWindowSeconds: number
  maxActiveSessions: number
  maxEventsPerSec: number
  renderDegrade: boolean
}

export function resolveConfig(config?: Config): ResolvedConfig {
  return {
    enabled: config?.enabled ?? true,
    mode: config?.mode === 'off' || config?.mode === 'aggressive' || config?.mode === 'balanced' ? config.mode : 'balanced',
    meterIntervalMs: config?.meterIntervalMs ?? 2000,
    statsWindowSeconds: config?.statsWindowSeconds ?? 120,
    maxActiveSessions: config?.maxActiveSessions ?? 5,
    maxEventsPerSec: config?.maxEventsPerSec ?? 300,
    renderDegrade: config?.renderDegrade ?? true,
  }
}

/** 由 bundle patch 应用的持久化写批延迟: 覆盖整行时写死 500ms(balanced)。 */
export const BUNDLE_WRITE_BATCH_DELAY_MS = 500

/** 尽力从运行时读取 persistence 行实际生效的 writeBatchMaxDelayMs(只读, 不修改)。 */
function readAppliedBatchDelay(ctx: Context): number | undefined {
  try {
    const service = (ctx as unknown as { get?: (name: string) => unknown }).get?.('sessionPersistence')
    const config = (service as { config?: { writeBatchMaxDelayMs?: unknown } } | undefined)?.config
    return typeof config?.writeBatchMaxDelayMs === 'number' ? config.writeBatchMaxDelayMs : undefined
  } catch {
    return undefined
  }
}

export const apply = mountOnce('@linxin666/dsh-perf', (ctx: Context, config?: Config): void => {
  let source: () => Config = () => config ?? {}
  let meter: PerfMeter | undefined
  let disposeRoutes: (() => void) | undefined

  const rearm = (): void => {
    const value = resolveConfig(source())
    if (!value.enabled) {
      meter?.stop()
      meter = undefined
      disposeRoutes?.()
      disposeRoutes = undefined
      return
    }
    const options: PerfMeterOptions = {
      mode: value.mode,
      meterIntervalMs: value.meterIntervalMs,
      statsWindowSeconds: value.statsWindowSeconds,
      maxActiveSessions: value.maxActiveSessions,
      maxEventsPerSec: value.maxEventsPerSec,
      batchDelayMs: readAppliedBatchDelay(ctx) ?? BUNDLE_WRITE_BATCH_DELAY_MS,
    }
    if (meter === undefined) {
      meter = new PerfMeter(ctx, options)
      meter.start()
      disposeRoutes = ctx.webServer.register(makePerfStatsRoute(meter))
    } else {
      meter.applyOptions(options)
    }
  }

  installSettingsSection(ctx, PERF_SETTINGS_NAMESPACE, Config, config ?? {}, {
    setSource: (next) => { source = next; rearm() },
    onChange: rearm,
  })

  ctx.effect(() => {
    rearm()
    return () => {
      disposeRoutes?.()
      meter?.stop()
    }
  }, 'dsh-perf: runtime')
})