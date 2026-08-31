/**
 * Workspace-domain mutations for dsh-session-archive. The alpha.2 SDK has a
 * public archive verb (`workspaceRegistry.archiveSession`) but no unarchive,
 * so unarchive and workspace-row cleanup go through the registry's durable
 * domain handles (`requireState`/`setState` for the global archive set,
 * entity `mutate` for workspace rows). Both writes flow through the domain
 * storage, so the workspace feed publishes follow frames and every connected
 * browser sees the change without a reload. The seams are feature-detected
 * and pinned to the SDK cohort; when absent, operations fail with
 * `missing-seam` instead of guessing at files.
 * @module @linxin666/dsh-session-archive/host/workspace-store
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the workspaceRegistry Context merge (dsh-workspace face).
import type {} from '@deepseek-ai/dsh-workspace'
import { canonicalSessionId } from './session-files.ts'

/** Minimal runtime shape the registry must expose for durable archive-set writes. */
interface RegistrySeam {
  requireState?(): unknown
  setState?(state: unknown): Promise<void>
  archivedSessionIds: readonly string[]
  list(): WorkspaceEntityLike[]
}

interface WorkspaceEntityLike {
  id: string
  path: string
  title: string
  sessionIds: readonly string[]
  mutate?(fn: (record: WorkspaceRecordLike) => WorkspaceRecordLike): Promise<void>
}

export interface WorkspaceRecordLike {
  path: string
  title: string
  sessionIds: string[]
  createdAt: string
  updatedAt: string
}

/** Whether the unarchive seam is present on this registry instance. */
export function unarchiveSeamAvailable(registry: unknown): boolean {
  const seam = registry as RegistrySeam
  return typeof seam?.requireState === 'function' && typeof seam?.setState === 'function'
}

/**
 * Remove ids from the registry-global archive set durably. Idempotent: ids
 * not in the set are ignored. Emits the domain `put` change so the workspace
 * feed publishes `{ type: 'archived' }` follow frames.
 */
export async function unarchiveSessions(registry: unknown, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  const seam = registry as RegistrySeam
  if (!unarchiveSeamAvailable(seam)) {
    throw new Error('workspace registry does not expose the durable state seam')
  }
  const state = seam.requireState?.() as { archivedSessionIds?: string[] } | undefined
  if (state === undefined || typeof state !== 'object') {
    throw new Error('workspace registry state unavailable')
  }
  const current = Array.isArray(state.archivedSessionIds) ? state.archivedSessionIds : []
  // The stored set mixes id spellings (bare uuids beside `session-<uuid>`);
  // compare canonically and preserve every non-matching entry verbatim.
  const drop = new Set(ids.map(canonicalSessionId))
  const next = current.filter((id) => !drop.has(canonicalSessionId(id)))
  if (next.length === current.length) return
  await seam.setState?.({ ...state, archivedSessionIds: next })
}

/**
 * Archive one session through the public verb. Idempotent for already
 * archived ids; throws when the session does not exist live or in
 * persistence.
 */
export async function archiveSession(ctx: Context, id: string): Promise<void> {
  const registry = ctx.workspaceRegistry as unknown as {
    archiveSession?(sessionId: string): Promise<void>
  }
  if (typeof registry?.archiveSession !== 'function') {
    throw new Error('workspace registry does not expose archiveSession')
  }
  await registry.archiveSession(id)
}

/**
 * Remove ids from every workspace's durable `sessionIds` account. Goes
 * through the entity `mutate` path (durable table update + record refresh +
 * feed upsert). Returns the ids actually removed from at least one row.
 */
export async function removeFromWorkspaceRows(registry: unknown, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const seam = registry as RegistrySeam
  const drop = new Set(ids.map(canonicalSessionId))
  const matches = (id: string): boolean => drop.has(canonicalSessionId(id))
  const touched: string[] = []
  let entities: WorkspaceEntityLike[]
  try {
    entities = seam.list()
  } catch {
    return []
  }
  for (const entity of entities) {
    if (typeof entity.mutate !== 'function') continue
    if (!entity.sessionIds.some(matches)) continue
    await entity.mutate((record) => ({
      ...record,
      sessionIds: record.sessionIds.filter((id) => !matches(id)),
    }))
    touched.push(entity.id)
  }
  return touched
}
