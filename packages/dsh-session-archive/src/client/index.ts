/**
 * dsh-session-archive browser half — seats the first-level 会话归档管理
 * settings section. All session enumeration and mutation happens in the
 * host half over loopback-fenced routes; this bundle renders the inventory
 * document and drives the batch pipelines.
 * @module @linxin666/dsh-session-archive/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface Context merge (ctx.settingsScope).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ctx.slots merge (the renderer owns the slot registry since 0.1.2).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the client sessions face merge (ctx.sessions) for the
// current-selection id and the post-batch feed refresh. Deliberately NOT
// imported: the api-session-controller client merge declares `sessions` on
// Context and would collide with the host dsh-session merge inside this
// package's single tsc program. The face is read via a duck-typed cast.
import { createElement } from 'react'
import { ArchiveController } from './archive-controller.ts'
import { SessionArchiveCard, type SessionArchiveFace } from './SessionArchiveCard.tsx'
import { NS, en, zh } from './locales.ts'
import type { SessionArchiveConfig } from '../core/config.ts'

/** Minimal duck-typed face of the browser sessions service. */
interface SessionsFace {
  list: { getSnapshot(): { current?: string } }
  refresh?: () => Promise<void>
}

/** Settings namespace the section edits (the host plugin registers it). */
const ARCHIVE_SETTINGS_NS = 'dsh-session-archive'

/** First-level nav position: below Workshop (150) and dsh-usage (151). */
const SECTION_ORDER = 152

/** Required services. */
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote', 'sessions']

export type { SessionArchiveFace } from './SessionArchiveCard.tsx'
export type { SessionArchiveConfig }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Optional rc.6 compatibility binder provided by dsh-web-settings;
     * absent when that group plugin is not installed, so callers fall back to
     * the official settings scope.
     */
    webUiSettings?: { bind<S>(spec: SettingsScopeSpec<S>): SettingsScope<S> }
  }
}

/**
 * Client plugin body: register dictionaries and seat the settings section.
 * The controller and store live with the apply body, so the last inventory
 * renders instantly when the section is reopened.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'dsh-session-archive: dictionaries')

  const binder = ctx.get('webUiSettings') ?? ctx.settingsScope
  const settingsScope = binder.bind<SessionArchiveConfig>({ namespace: ARCHIVE_SETTINGS_NS })

  const sessionsFace = (() => {
    try {
      const sessions = (ctx as unknown as { get(name: string): unknown }).get('sessions') as SessionsFace | undefined
      if (sessions === undefined) return undefined
      const refresh = typeof sessions.refresh === 'function' ? sessions.refresh.bind(sessions) : undefined
      return { list: sessions.list, ...(refresh !== undefined ? { refresh: () => refresh() } : {}) }
    } catch {
      return undefined
    }
  })()

  const controller = new ArchiveController({ sessions: sessionsFace })
  const face = (): SessionArchiveFace => ({ controller, settings: settingsScope })

  ctx.slots.inject('settings.section', () => {
    try {
      const unregister = ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-session-archive',
        order: SECTION_ORDER,
        label: () => ctx.locale.bind(NS)('arch.title'),
        locale: NS,
        inject: face,
      }, SessionArchiveCard)
      return () => {
        unregister()
      }
    } catch {
      return () => {}
    }
  })
}
