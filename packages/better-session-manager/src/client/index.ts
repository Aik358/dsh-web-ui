/**
 * Better Session manager card — browser half. Registers one card into the
 * Settings → Web Plugins group (`web-ui.plugin.item` list slot) declaring the
 * third-party origin of the inactive-by-default better-session integration
 * and driving enable/disable plus the legacy-session migration through the
 * host half's loopback-fenced routes.
 *
 * Failure policy: every wiring failure is logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws.
 * @module better-session-manager/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { BetterSessionCard, useCardModel } from './better-session-card.tsx'
import { NS, dictionaries, type BetterSessionKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Card copy. */
    'better-session-manager': BetterSessionKey
  }

  interface SlotMap {
    /**
     * One family plugin card inside the Web Plugins group; spelled locally so
     * this package registers without depending on dsh-web-settings types.
     */
    'web-ui.plugin.item': { kind: 'list'; scope: 'root'; owner: { children?: never } }
  }
}

/** Required services: locale for copy registration, slots for the group entry. */
export const inject = ['slots', 'locale']

/** Apply the browser half. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, dictionaries)
    } catch {
      return () => {}
    }
  }, 'better-session-manager: dictionaries')

  ctx.effect(() => ctx.slots.inject('web-ui.plugin.item', () => {
    try {
      const unregister = ctx.slots.register({
        name: 'web-ui.plugin.item',
        id: 'better-session-manager',
        order: 145,
        locale: NS,
      }, BetterSessionCard)
      return unregister
    } catch (error) {
      console.debug('[better-session-manager] card degraded:', error)
      return () => {}
    }
  }), 'better-session-manager: web plugins card')
}

export { BetterSessionCard, useCardModel } from './better-session-card.tsx'
export { NS, dictionaries } from './locales.ts'
