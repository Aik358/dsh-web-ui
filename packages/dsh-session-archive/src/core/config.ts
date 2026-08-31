/**
 * Configuration shape and validation for dsh-session-archive, shared by the
 * host schema and the client settings form. Pure logic.
 * @module @linxin666/dsh-session-archive/core/config
 */

export interface SessionArchiveConfig {
  enabled?: boolean
  /** Auto-archive sessions inactive for more than this many days. Default off. */
  autoArchiveEnabled?: boolean
  /** Inactivity threshold in days for auto-archive (1-3650). */
  autoArchiveDays?: number
  /** Physically delete archived sessions older than this many days after archive time. Default off. */
  autoDeleteEnabled?: boolean
  /** Archive retention in days for auto-delete (1-3650). */
  autoDeleteDays?: number
  /** Scheduler cadence in minutes (15-1440). */
  checkIntervalMin?: number
}

export interface ResolvedAutoConfig {
  enabled: boolean
  autoArchiveEnabled: boolean
  autoArchiveDays: number
  autoDeleteEnabled: boolean
  autoDeleteDays: number
  checkIntervalMin: number
}

export const AUTO_ARCHIVE_DAYS_MIN = 1
export const AUTO_ARCHIVE_DAYS_MAX = 3650
export const AUTO_DELETE_DAYS_MIN = 1
export const AUTO_DELETE_DAYS_MAX = 3650
export const CHECK_INTERVAL_MIN_MIN = 15
export const CHECK_INTERVAL_MIN_MAX = 1440

export const DEFAULT_AUTO_CONFIG: ResolvedAutoConfig = {
  enabled: true,
  autoArchiveEnabled: false,
  autoArchiveDays: 7,
  autoDeleteEnabled: false,
  autoDeleteDays: 7,
  checkIntervalMin: 60,
}

/** Validate one day-threshold field; returns the rounded value or undefined when invalid. */
export function validateDays(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const rounded = Math.round(value)
  if (rounded < min || rounded > max) return undefined
  return rounded
}

/**
 * Coerce a raw config into resolved values. Invalid or out-of-range fields
 * fall back to defaults — the settings UI validates before saving, and this
 * guards profile-patch hand-written values.
 */
export function resolveAutoConfig(config?: SessionArchiveConfig): ResolvedAutoConfig {
  const days = validateDays(config?.autoArchiveDays, AUTO_ARCHIVE_DAYS_MIN, AUTO_ARCHIVE_DAYS_MAX)
  const retain = validateDays(config?.autoDeleteDays, AUTO_DELETE_DAYS_MIN, AUTO_DELETE_DAYS_MAX)
  const interval = validateDays(config?.checkIntervalMin, CHECK_INTERVAL_MIN_MIN, CHECK_INTERVAL_MIN_MAX)
  return {
    enabled: config?.enabled ?? DEFAULT_AUTO_CONFIG.enabled,
    autoArchiveEnabled: config?.autoArchiveEnabled ?? DEFAULT_AUTO_CONFIG.autoArchiveEnabled,
    autoArchiveDays: days ?? DEFAULT_AUTO_CONFIG.autoArchiveDays,
    autoDeleteEnabled: config?.autoDeleteEnabled ?? DEFAULT_AUTO_CONFIG.autoDeleteEnabled,
    autoDeleteDays: retain ?? DEFAULT_AUTO_CONFIG.autoDeleteDays,
    checkIntervalMin: interval ?? DEFAULT_AUTO_CONFIG.checkIntervalMin,
  }
}
