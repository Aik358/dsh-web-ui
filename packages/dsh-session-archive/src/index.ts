import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import { mountOnce } from './mount-once.ts'
import { ArchiveService } from './host/janitor.ts'
import { makeArchiveRoutes } from './host/routes.ts'
import type { SessionArchiveConfig } from './core/config.ts'

export const name = 'dsh-session-archive'
export const inject = ['webServer', 'workspaceRegistry']
export const SESSION_ARCHIVE_SETTINGS_NAMESPACE = 'dsh-session-archive' as SettingsNamespace

export const Config: z<SessionArchiveConfig> = z.object({
  enabled: z.boolean().default(true),
  autoArchiveEnabled: z.boolean().default(false),
  autoArchiveDays: z.number().min(1).max(3650).default(7),
  autoDeleteEnabled: z.boolean().default(false),
  autoDeleteDays: z.number().min(1).max(3650).default(7),
  checkIntervalMin: z.number().min(15).max(1440).default(60),
})

export const apply = mountOnce('@linxin666/dsh-session-archive', (ctx: Context, config?: SessionArchiveConfig): void => {
  let source: () => SessionArchiveConfig = () => config ?? {}
  let service: ArchiveService | undefined
  let disposeRoutes: (() => void) | undefined

  const rearm = (): void => {
    const value = source()
    const resolved = Config(value)
    if (resolved.enabled === false) {
      service?.stop()
      service = undefined
      disposeRoutes?.()
      disposeRoutes = undefined
      return
    }
    if (service === undefined) {
      const next = new ArchiveService(ctx)
      service = next
      void next.start()
      const disposers = makeArchiveRoutes(next).map((route) => ctx.webServer.register(route))
      disposeRoutes = () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            // Route fiber already gone during shutdown.
          }
        }
      }
    }
    service?.applyConfig(value)
  }

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, SESSION_ARCHIVE_SETTINGS_NAMESPACE, Config, config ?? {}, {
      setSource: (next) => { source = next; rearm() },
      onChange: rearm,
    })
  })

  ctx.effect(() => {
    rearm()
    return () => {
      disposeRoutes?.()
      service?.stop()
      service = undefined
    }
  }, 'dsh-session-archive: runtime')
})
