/**
 * The Better Session card: declares the third-party origin, shows the live
 * posture and store counts, and drives enable (with automatic migration) /
 * disable through the plugin's loopback-fenced /api routes. Interactive on
 * purpose — unlike the family's form cards nothing here saves into a settings
 * namespace; the profile patch layer is the state that actually moves rows.
 *
 * Styling is intentionally minimal inline structure with stable class names;
 * semantic attributes follow contracts/semantic-attrs-v1.md.
 * @module better-session-manager/client/better-session-card
 */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Upstream project the integration comes from. */
export const UPSTREAM_URL = 'https://github.com/morlay/better-session'
export const UPSTREAM_LABEL = 'morlay/better-session'

export type Posture = 'inactive-by-default' | 'enabled-via-profile' | 'enabled-via-bundle' | 'not-installed'

export interface BetterSessionStatus {
  mountState: Posture
  aggregateArtifactSeen: boolean
  legacyTotalSessions: number
  legacyProjects: Array<{ key: string; sessions: number; bytes: number }>
  storeExists: boolean
  storeSessions?: number
  storeEvents?: number
}

async function post(action: 'enable' | 'disable', body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/dsh-perf/better-session/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok || payload.ok === false) throw new Error(String(payload.error ?? `HTTP ${response.status}`))
  return payload
}

export interface CardViewModel {
  posture: Posture | undefined
  statusError: string | undefined
  busy: null | 'enable' | 'disable'
  notice: null | { kind: 'done' | 'disabled'; imported: number; failed: number } | { kind: 'failed'; error: string }
  confirmKind: null | 'enable' | 'disable'
  status: BetterSessionStatus | undefined
}

/** All card state and the actions mutating it; exported for tests and DI. */
export function useCardModel(): {
  model: CardViewModel
  refresh: () => void
  requestEnable: () => void
  confirmEnable: () => Promise<void>
  requestDisable: () => void
  confirmDisable: () => Promise<void>
  cancelConfirm: () => void
} {
  const [model, setModel] = useState<CardViewModel>({
    posture: undefined,
    statusError: undefined,
    busy: null,
    notice: null,
    confirmKind: null,
    status: undefined,
  })
  const patch = (part: Partial<CardViewModel>): void => setModel((current) => ({ ...current, ...part }))

  const refresh = (): void => {
    void (async () => {
      try {
        const response = await fetch('/api/dsh-perf/better-session/status', { cache: 'no-store' })
        const payload = await response.json() as BetterSessionStatus & Record<string, unknown>
        patch({ posture: payload.mountState, status: payload as BetterSessionStatus, statusError: undefined })
      } catch (error) {
        patch({ statusError: (error as Error).message })
      }
    })()
  }

  return {
    model,
    refresh,
    requestEnable: () => patch({ notice: null, confirmKind: 'enable' }),
    requestDisable: () => patch({ notice: null, confirmKind: 'disable' }),
    confirmEnable: async () => {
      patch({ confirmKind: null, busy: 'enable' })
      try {
        const outcome = await post('enable', { acknowledge: true })
        patch({
          busy: null,
          posture: 'enabled-via-profile',
          notice: { kind: 'done', imported: Number(outcome.imported ?? 0), failed: Number(outcome.failed ?? 0) },
        })
      } catch (error) {
        patch({ busy: null, notice: { kind: 'failed', error: (error as Error).message } })
      }
    },
    confirmDisable: async () => {
      patch({ confirmKind: null, busy: 'disable' })
      try {
        await post('disable', {})
        patch({ busy: null, posture: 'inactive-by-default', notice: { kind: 'disabled', imported: 0, failed: 0 } })
      } catch (error) {
        patch({ busy: null, notice: { kind: 'failed', error: (error as Error).message } })
      }
    },
    cancelConfirm: () => patch({ confirmKind: null }),
  }
}

export interface BetterSessionCardProps
  extends PropsRuntime<'web-ui.plugin.item'>,
  PropsLocale<'dsh-perf-bs'> {
  /** State override for unit tests; production wires the hook above. */
  wired?: ReturnType<typeof useCardModel>
}

type LocaleT = (key: string, params?: Record<string, string | number>) => string

function interpolate(template: string, params: Record<string, string | number>): string {
  let out = template
  for (const [key, value] of Object.entries(params)) out = out.replaceAll(`{${key}}`, String(value))
  return out
}

/** The card body rendered inside the Web Plugins group list slot. */
export function BetterSessionCard(props: BetterSessionCardProps): JSX.Element {
  const wired = props.wired ?? useCardModel()
  const { model } = wired
  const t = props.t as LocaleT

  // One status fetch on mount; manual refresh stays available via the state row click.
  useEffect(() => { wired.refresh() }, [])

  if (model.statusError !== undefined) {
    return (
      <section className="dsh-bsm-card" data-dsh-plugin="better-session-manager" data-dsh-part="card">
        <h3>{t('settings.title')}</h3>
        <p className="dsh-bsm-error" role="alert">{t('notice.failed', { error: model.statusError })}</p>
      </section>
    )
  }

  const enabled = model.posture === 'enabled-via-profile' || model.posture === 'enabled-via-bundle'
  const stateKey = model.posture === 'enabled-via-profile' ? 'state.enabled'
    : model.posture === 'enabled-via-bundle' ? 'state.enabledBundle'
      : model.posture === undefined ? 'state.unknown' : 'state.inactive'

  return (
    <section className="dsh-bsm-card" data-dsh-plugin="better-session-manager" data-dsh-part="card">
      <h3>{t('settings.title')}</h3>
      <p className="dsh-bsm-description">{t('settings.description')}</p>
      <p className="dsh-bsm-source">
        {t('settings.sourcePrefix')}{' '}
        <a href={UPSTREAM_URL} target="_blank" rel="noreferrer">{UPSTREAM_LABEL}</a>
        {t('settings.sourceSuffix')}
      </p>
      <p
        className={`dsh-bsm-state dsh-bsm-state-${String(model.posture ?? 'unknown')}`}
        data-dsh-part="state"
        onClick={() => wired.refresh()}
      >{t(stateKey)}</p>
      <ul className="dsh-bsm-metrics">
        <li>{interpolate(t('label.legacyCount'), { total: model.status?.legacyTotalSessions ?? 0, projects: model.status?.legacyProjects?.length ?? 0 })}</li>
        {(model.status?.storeSessions !== undefined) && (
          <li>{interpolate(t('label.storeCount'), { sessions: model.status.storeSessions ?? 0, events: model.status.storeEvents ?? 0 })}</li>
        )}
      </ul>

      {model.notice !== null && model.notice.kind === 'done' && (
        <p className="dsh-bsm-notice" data-dsh-part="notice">
          {interpolate(t('notice.done'), { imported: model.notice.imported, failed: model.notice.failed })}
        </p>
      )}
      {model.notice !== null && model.notice.kind === 'disabled' && (
        <p className="dsh-bsm-notice" data-dsh-part="notice">{t('notice.disabled')}</p>
      )}
      {model.notice !== null && model.notice.kind === 'failed' && (
        <p className="dsh-bsm-error" role="alert">{t('notice.failed', { error: model.notice.error })}</p>
      )}

      <div className="dsh-bsm-actions">
        {enabled ? (
          <button type="button" className="dsh-bsm-btn-danger" disabled={model.busy !== null}
            onClick={() => wired.requestDisable()}>{model.busy === 'disable' ? t('action.working') : t('action.disable')}</button>
        ) : (
          <button type="button" className="dsh-bsm-btn-primary" disabled={model.busy !== null}
            onClick={() => wired.requestEnable()}>{model.busy === 'enable' ? t('action.working') : t('action.enable')}</button>
        )}
      </div>

      {model.busy === 'enable' && <p className="dsh-bsm-progress" data-dsh-part="progress">{t('label.migrating')}</p>}

      {model.confirmKind !== null && (
        <div className="dsh-bsm-confirm" role="dialog" aria-modal="true" data-dsh-part="confirm">
          <div className="dsh-bsm-confirm-box">
            <h4>{t(model.confirmKind === 'enable' ? 'warn.enableTitle' : 'warn.disableTitle')}</h4>
            <p>{t(model.confirmKind === 'enable' ? 'warn.enableBody' : 'warn.disableBody')}</p>
            <div className="dsh-bsm-confirm-actions">
              <button type="button" onClick={() => wired.cancelConfirm()}>{t('dialog.cancel')}</button>
              <button type="button"
                className={model.confirmKind === 'enable' ? 'dsh-bsm-btn-primary' : 'dsh-bsm-btn-danger'}
                onClick={() => { void (model.confirmKind === 'enable' ? wired.confirmEnable() : wired.confirmDisable()) }}>
                {t('dialog.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
