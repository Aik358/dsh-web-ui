/**
 * @linxin666/dsh-client-ui-better-session-manager — host half.
 *
 * Operational surface for opting into the inactive-by-default
 * `@morlay/better-session` aggregate integration: loopback-fenced routes that
 * report the current posture, run the one-shot legacy jsonl → SQLite
 * migration (child process; the profile stays untouched unless it succeeds),
 * and flip the managed enable block in the boot profile's patch file — the
 * same hot-reloaded user layer dsh-plugin-manager writes, so switches apply
 * without a host restart on long-lived surfaces.
 *
 * The card itself lives in the browser half and declares the upstream origin.
 * This package has no settings namespace: none of its surfaces are
 * user-editable preferences, and enabling does not write ~/.dsh/settings.yaml
 * but the profile patch layer (the state that actually moves rows).
 * @module @linxin666/dsh-client-ui-better-session-manager
 */
import type { Context } from '@deepseek-ai/cordis'
import { mountOnce } from './mount-once.ts'
import { makeBetterSessionRoutes } from './host/routes.ts'

export const name = 'better-session-manager'

/** Required services: the web server surface hosts the action routes. */
export const inject = ['webServer']

/**
 * Register the plugin. Route registration failures degrade to a log: an
 * external-integration manager must never fail the host boot.
 * @param ctx - plugin context.
 */
export const apply = mountOnce('@linxin666/dsh-client-ui-better-session-manager', (ctx: Context): void => {
  ctx.effect(() => {
    const disposers = makeBetterSessionRoutes().map((route) => ctx.webServer.register(route))
    return (): void => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch { /* route already gone with its fiber */ }
      }
    }
  }, 'better-session-manager: api routes')
})
