/**
 * The usage statistics settings section: two tabs (用量: today's usage,
 * balances, trend; 个人套餐: per-provider plan quota windows) plus a compact
 * settings row. Data comes from the host's loopback-fenced
 * /api/dsh-usage/overview document; polling runs only while the section is
 * mounted and the tab is visible.
 * @module @linxin666/dsh-usage/client/UsageSectionCard
 */

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { UsageStoreInstance } from './usage-store.ts'
import { t } from './locales.ts'
import styles from './usage.module.css'
import type { ProviderSnapshotView, UsageTokenTotals } from '../core/types.ts'

/** The settings fields this section edits (immediate-apply semantics). */
export interface UsageSettings {
  enabled?: boolean
  pollIntervalSec?: number
  bubbleMode?: string
}

/** The registration-side face the section's slot entry injects. */
export interface UsageSectionFace {
  /** The section-local store (overview snapshot + lifecycle). */
  store: UsageStoreInstance
  /** Fetch one overview now. */
  poll: () => void
  /** Force a host probe cycle now (resolves with the fresh overview). */
  refresh: () => void
  /** Whether a forced refresh is in flight (component-local state mirrors it). */
  settings: SettingsScope<UsageSettings>
}

export interface UsageSectionProps extends UsageSectionFace {
  /** Close the settings panel (the shell owns the open state). */
  close: () => void
}

/** Poll cadence while the section is open. */
const SECTION_POLL_MS = 10_000

/** Compact token count: 12345 -> 12.3k, 1234567 -> 1.23M. */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value < 1000) return String(value)
  if (value < 1_000_000) return trim(value / 1000) + 'k'
  if (value < 1_000_000_000) return trim(value / 1_000_000) + 'M'
  return trim(value / 1_000_000_000) + 'B'
}

function trim(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(value >= 10 ? 1 : 2).replace(/\.?0+$/, '')
}

function formatTime(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString()
  } catch {
    return ''
  }
}

function toneClass(percent: number): string {
  if (percent >= 90) return styles.barLow
  if (percent >= 70) return styles.barWarn
  return styles.barFill
}

function TotalsRow(props: { totals: UsageTokenTotals }): ReactNode {
  const { totals } = props
  return (
    <div className={styles.statRow}>
      <div className={styles.stat}>
        <span className={styles.statValue}>{formatTokens(totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens + totals.outputTokens)}</span>
        <span className={styles.statLabel}>{t('usage.tokens.total')}</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.statValue}>{formatTokens(totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens)}</span>
        <span className={styles.statLabel}>{t('usage.tokens.input')}</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.statValue}>{formatTokens(totals.outputTokens)}</span>
        <span className={styles.statLabel}>{t('usage.tokens.output')}</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.statValue}>{formatTokens(totals.cacheReadTokens)}</span>
        <span className={styles.statLabel}>{t('usage.tokens.cacheRead')}</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.statValue}>{formatTokens(totals.cacheWriteTokens)}</span>
        <span className={styles.statLabel}>{t('usage.tokens.cacheWrite')}</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.statValue}>{formatTokens(totals.calls)}</span>
        <span className={styles.statLabel}>{t('usage.calls', { n: totals.calls })}</span>
      </div>
    </div>
  )
}

function balanceLine(provider: ProviderSnapshotView): ReactNode {
  if (provider.balance !== undefined) {
    return <span className={styles.providerBalance}>{provider.balance.currency.toUpperCase() === 'CNY' ? '¥' : provider.balance.currency.toUpperCase() === 'USD' ? '$' : ''}{provider.balance.totalBalance}{provider.balance.currency.toUpperCase() !== 'CNY' && provider.balance.currency.toUpperCase() !== 'USD' ? ' ' + provider.balance.currency.toUpperCase() : ''}</span>
  }
  if (provider.credential === 'oauth') return <span className={styles.muted}>{t('usage.oauth')}</span>
  if (provider.credential === 'none') return <span className={styles.muted}>{t('usage.balance.noCredential')}</span>
  if (!provider.supported) return <span className={styles.muted}>{t('usage.balance.unsupported')}</span>
  return null
}

function ProviderRow(props: { provider: ProviderSnapshotView; current?: string }): ReactNode {
  const { provider, current } = props
  return (
    <div className={styles.providerRow} data-dsh-part="provider-row">
      <span className={styles.providerName}>
        {provider.displayName}
        {current === provider.provider && <span className={styles.currentBadge}>{t('usage.current')}</span>}
      </span>
      <span className={styles.providerTokens}>{balanceLine(provider)}</span>
    </div>
  )
}

/** The section component; the slot merges the face into these props. */
export function UsageSectionCard(props: UsageSectionProps): ReactNode {
  const { store, poll, refresh, settings } = props
  const ui = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const settingsSnapshot = settings.getSnapshot()
  const settingsValue = settingsSnapshot.value ?? {}
  const [tab, setTab] = useState<'usage' | 'plans'>('usage')
  const [refreshing, setRefreshing] = useState(false)

  // Poll while mounted and visible; the overview is cheap (no probes — the
  // host's own cycle owns those) so 10 s keeps balances fresh-ish between
  // manual refreshes.
  useEffect(() => {
    poll()
    let timer: number | undefined
    const start = (): void => {
      if (timer === undefined && document.visibilityState === 'visible') timer = window.setInterval(poll, SECTION_POLL_MS)
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        poll()
        start()
      } else if (timer !== undefined) {
        window.clearInterval(timer)
        timer = undefined
      }
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (timer !== undefined) window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [poll])

  const snapshot = ui.snapshot
  const trendMax = useMemo(() => {
    if (snapshot === null) return 0
    return Math.max(1, ...snapshot.usage.days.map((day) => day.totals.inputTokens + day.totals.outputTokens + day.totals.cacheReadTokens + day.totals.cacheWriteTokens))
  }, [snapshot])

  const onRefresh = (): void => {
    setRefreshing(true)
    try {
      refresh()
    } finally {
      // The POST resolves through the next poll tick; unlock shortly either way.
      window.setTimeout(() => setRefreshing(false), 3000)
    }
  }

  if (ui.status === 'error') {
    return <div className={styles.section} data-dsh-plugin="usage">{t('usage.error', { error: ui.error ?? '' })}</div>
  }
  if (snapshot === null) {
    return <div className={styles.section} data-dsh-plugin="usage">{t('usage.loading')}</div>
  }

  const current = snapshot.current
  const currentProvider = snapshot.providers.find((provider) => provider.provider === current.provider)
  const planProviders = snapshot.providers.filter((provider) => provider.plan !== undefined || (provider.supported && provider.credential !== 'none' && provider.credential !== 'oauth'))

  return (
    <div className={styles.section} data-dsh-plugin="usage">
      <div className={styles.header} data-dsh-part="header">
        <span className={styles.currentProvider}>
          {currentProvider !== undefined
            ? `${currentProvider.displayName}${current.model !== undefined && current.model !== '' ? ' · ' + current.model : ''}`
            : t('usage.noData')}
        </span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={styles.muted}>{t('usage.updated', { time: formatTime(snapshot.updatedAt) })}</span>
          <button type="button" className={styles.refreshBtn} onClick={onRefresh} disabled={refreshing}>
            {refreshing ? t('usage.refreshing') : t('usage.refresh')}
          </button>
        </span>
      </div>

      <div className={styles.tabs} role="tablist" data-dsh-part="tabs">
        <button type="button" role="tab" aria-selected={tab === 'usage'} className={tab === 'usage' ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setTab('usage')}>
          {t('usage.tab.usage')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'plans'} className={tab === 'plans' ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setTab('plans')}>
          {t('usage.tab.plans')}
        </button>
      </div>

      {tab === 'usage' && (
        <>
          <div className={styles.card} data-dsh-part="today-card">
            <span className={styles.cardTitle}>{t('usage.today')}</span>
            {snapshot.usage.today.totals.calls === 0
              ? <span className={styles.muted}>{t('usage.noData')}</span>
              : <TotalsRow totals={snapshot.usage.today.totals} />}
            {snapshot.usage.today.providers.length > 0 && (
              <div data-dsh-part="provider-list">
                {snapshot.usage.today.providers.map((row) => (
                  <div key={row.provider} className={styles.providerRow}>
                    <span className={styles.providerName}>
                      {snapshot.providers.find((provider) => provider.provider === row.provider)?.displayName ?? row.provider}
                      {current.provider === row.provider && <span className={styles.currentBadge}>{t('usage.current')}</span>}
                    </span>
                    <span className={styles.providerTokens}>{formatTokens(row.totals.inputTokens + row.totals.cacheReadTokens + row.totals.cacheWriteTokens + row.totals.outputTokens)} · {t('usage.calls', { n: row.totals.calls })}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.card} data-dsh-part="balance-card">
            <span className={styles.cardTitle}>{t('usage.balance')}</span>
            {snapshot.providers.filter((provider) => provider.supported).length === 0
              ? <span className={styles.muted}>{t('usage.balance.unsupported')}</span>
              : snapshot.providers.filter((provider) => provider.supported).map((provider) => (
                <ProviderRow key={provider.provider} provider={provider} current={current.provider} />
              ))}
            {snapshot.providers.some((provider) => provider.error !== undefined) && (
              <span className={styles.errorLine}>
                {snapshot.providers.filter((provider) => provider.error !== undefined).map((provider) => `${provider.displayName}: ${t('usage.provider.error', { error: provider.error ?? '' })}`).join('；')}
              </span>
            )}
          </div>

          {snapshot.usage.days.length > 0 && (
            <div className={styles.card} data-dsh-part="trend-card">
              <span className={styles.cardTitle}>{t('usage.trend')}</span>
              <div className={styles.trend}>
                {snapshot.usage.days.map((day, index) => {
                  const total = day.totals.inputTokens + day.totals.outputTokens + day.totals.cacheReadTokens + day.totals.cacheWriteTokens
                  return (
                    <div
                      key={day.date}
                      className={index === snapshot.usage.days.length - 1 ? `${styles.trendBar} ${styles.trendBarToday}` : styles.trendBar}
                      style={{ height: `${Math.max(3, Math.round((total / trendMax) * 100))}%` }}
                      title={`${day.date}: ${formatTokens(total)}`}
                    />
                  )
                })}
              </div>
              <div className={styles.trendAxis}>
                <span>{snapshot.usage.days[0]?.date.slice(5)}</span>
                <span>{snapshot.usage.days[snapshot.usage.days.length - 1]?.date.slice(5)}</span>
              </div>
            </div>
          )}

          <SettingsRow settings={settings} snapshot={settingsSnapshot.status === 'ready' ? settingsSnapshot : undefined} value={settingsValue} />
        </>
      )}

      {tab === 'plans' && (
        planProviders.length === 0
          ? <div className={styles.card}><span className={styles.muted}>{t('usage.plan.noPlan')}</span></div>
          : planProviders.map((provider) => <PlanCard key={provider.provider} provider={provider} />)
      )}
    </div>
  )
}

function PlanCard(props: { provider: ProviderSnapshotView }): ReactNode {
  const { provider } = props
  return (
    <div className={`${styles.card} ${styles.planCard}`} data-dsh-part="plan-card">
      <div className={styles.planHead}>
        <span className={styles.planName}>
          {provider.displayName}
          {provider.plan?.planName !== undefined ? ` · ${provider.plan.planName}` : ''}
        </span>
      </div>
      {provider.error !== undefined && <span className={styles.errorLine}>{t('usage.provider.error', { error: provider.error })}</span>}
      {provider.plan === undefined || provider.plan.windows.length === 0
        ? <span className={styles.muted}>{t('usage.plan.noPlan')}</span>
        : provider.plan.windows.map((window) => (
          <div key={window.key} className={styles.windowRow} data-dsh-part="plan-window">
            <span className={styles.windowLabel}>
              <span>{window.name ?? t(`usage.plan.windows.${window.key}`)}</span>
              <span>{window.percent !== undefined ? `${window.percent >= 10 ? Math.round(window.percent) : window.percent.toFixed(1)}%` : ''}</span>
            </span>
            {window.percent !== undefined && (
              <span className={styles.bar}>
                <span className={toneClass(window.percent)} style={{ width: `${Math.min(100, Math.max(0, window.percent))}%`, display: 'block' }} />
              </span>
            )}
            {window.resetsAt !== undefined && (
              <span className={styles.resetLine}>{t('usage.plan.reset', { date: new Date(window.resetsAt).toLocaleString() })}</span>
            )}
          </div>
        ))}
    </div>
  )
}

function SettingsRow(props: {
  settings: UsageSectionProps['settings']
  snapshot?: { writable: boolean }
  value: UsageSettings
}): ReactNode {
  const { settings, snapshot, value } = props
  const disabled = snapshot === undefined || !snapshot.writable
  const bubbleMode = typeof value.bubbleMode === 'string' && ['always', 'change', 'off'].includes(value.bubbleMode) ? value.bubbleMode : 'always'
  return (
    <div className={styles.card} data-dsh-part="settings-row">
      <span className={styles.cardTitle}>{t('usage.config.title')}</span>
      <div className={styles.settingsGrid}>
        <label className={styles.settingItem}>
          <input
            type="checkbox"
            checked={value.enabled ?? true}
            disabled={disabled}
            onChange={(event) => { void settings.set('enabled', event.target.checked) }}
          />
          {t('usage.config.enabled')}
        </label>
        <label className={styles.settingItem}>
          {t('usage.config.pollIntervalSec')}
          <input
            type="number"
            min={30}
            max={3600}
            value={typeof value.pollIntervalSec === 'number' ? value.pollIntervalSec : 60}
            disabled={disabled}
            onChange={(event) => {
              const parsed = Number(event.target.value)
              if (Number.isFinite(parsed) && parsed >= 30 && parsed <= 3600) void settings.set('pollIntervalSec', Math.round(parsed))
            }}
          />
        </label>
        <label className={styles.settingItem}>
          {t('usage.config.bubbleMode')}
          <select
            value={bubbleMode}
            disabled={disabled}
            onChange={(event) => { void settings.set('bubbleMode', event.target.value) }}
          >
            <option value="always">{t('usage.config.bubbleMode.always')}</option>
            <option value="change">{t('usage.config.bubbleMode.change')}</option>
            <option value="off">{t('usage.config.bubbleMode.off')}</option>
          </select>
        </label>
      </div>
    </div>
  )
}
