import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import { mountOnce } from './mount-once.ts'
import { UsageService, type UsageServiceOptions } from './host/usage-service.ts'
import { makeUsageOverviewRoute, makeUsageRefreshRoute } from './host/routes.ts'

export const name = 'dsh-usage'
export const inject = ['webServer']
export const USAGE_SETTINGS_NAMESPACE = settingsNamespace('dsh-usage')

export interface Config {
  enabled?: boolean
  /** Provider probe cycle in seconds; 30-3600. */
  pollIntervalSec?: number
  /** Pet bubble mode: always (refreshes each poll), change (only on value change), off. */
  bubbleMode?: string
  /** Ledger retention in local days. */
  retainDays?: number
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  pollIntervalSec: z.number().min(30).max(3600).default(60),
  bubbleMode: z.string().default('always'),
  retainDays: z.number().min(7).max(730).default(180),
})

export interface ResolvedConfig extends UsageServiceOptions {
  enabled: boolean
}

export function resolveConfig(config?: Config): ResolvedConfig {
  const bubbleMode = config?.bubbleMode === 'change' || config?.bubbleMode === 'off' ? config.bubbleMode : 'always'
  return {
    enabled: config?.enabled ?? true,
    pollIntervalSec: typeof config?.pollIntervalSec === 'number' ? config.pollIntervalSec : 60,
    bubbleMode,
    retainDays: typeof config?.retainDays === 'number' ? config.retainDays : 180,
  }
}

export const apply = mountOnce('@linxin666/dsh-usage', (ctx: Context, config?: Config): void => {
  let source: () => Config = () => config ?? {}
  let service: UsageService | undefined
  let disposeRoutes: (() => void) | undefined

  const rearm = (): void => {
    const value = resolveConfig(source())
    if (!value.enabled) {
      service?.stop()
      service = undefined
      disposeRoutes?.()
      disposeRoutes = undefined
      return
    }
    if (service === undefined) {
      service = new UsageService(ctx, value)
      service.start()
      const disposers = [makeUsageOverviewRoute(service), makeUsageRefreshRoute(service)]
        .map((route) => ctx.webServer.register(route))
      disposeRoutes = () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            // Route fiber already gone during shutdown.
          }
        }
      }
    } else {
      service.applyOptions(value)
    }
  }

  installSettingsSection(ctx, USAGE_SETTINGS_NAMESPACE, Config, config ?? {}, {
    setSource: (next) => { source = next; rearm() },
    onChange: rearm,
  })

  ctx.effect(() => {
    rearm()
    return () => {
      disposeRoutes?.()
      service?.stop()
      service = undefined
    }
  }, 'dsh-usage: runtime')
})
