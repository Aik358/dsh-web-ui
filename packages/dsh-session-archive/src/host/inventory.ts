/**
 * Inventory assembly: one pass over the authoritative session feed (host
 * SessionController — cold sessions included, agents never activated), the
 * workspace registry (membership + archive set), the projection-cache index
 * (titles, creation facts), the on-disk session directories (sizes, sessions
 * missing from the feed), and the plugin's own archive-time ledger. The
 * result is the single document the browser half renders and plans against.
 * @module @linxin666/dsh-session-archive/host/inventory
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ArchiveIssueCode, ArchiveSessionRow, WorkspaceView } from '../core/types.ts'
import type { LedgerDocument } from './ledger.ts'
import { indexSessionDirs, type SessionDirIndex } from './session-files.ts'

/** Minimal duck-typed face of the host SessionController feed. */
export interface SessionFeedFace {
  list(request: unknown, signal: AbortSignal): Promise<{
    items?: readonly {
      sessionId?: string
      updatedAt?: number
      running?: boolean
      blank?: boolean
      parentSessionId?: string
      origin?: string
      cwd?: string
    }[]
  }>
}

/** Minimal duck-typed face of the host WorkspaceRegistry. */
export interface WorkspaceRegistryFace {
  list(): readonly { id: string; path: string; title: string; sessionIds: readonly string[] }[]
  archivedSessionIds: readonly string[]
}

export interface InventorySources {
  feed: SessionFeedFace | undefined
  registry: WorkspaceRegistryFace | undefined
  dshHome: string
  ledger: LedgerDocument
}

/** Title/createdAt/cwd enrichment rows from the harness projection cache. */
interface ProjcacheIndex {
  sessions: Record<string, {
    identity?: { createdAt?: number; cwd?: string }
    rows?: { title?: { val?: unknown }; goal?: { val?: unknown } }
  }>
}

export function readProjcacheIndex(dshHome: string): ProjcacheIndex {
  const path = join(dshHome, 'storages', 'session_projcache.json')
  if (!existsSync(path)) return { sessions: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { tables?: { sessions?: ProjcacheIndex['sessions'] } }
    return { sessions: parsed.tables?.sessions ?? {} }
  } catch {
    return { sessions: {} }
  }
}

function titleFromProjcache(entry: NonNullable<ProjcacheIndex['sessions'][string]>): string | undefined {
  const val = entry.rows?.title?.val
  return typeof val === 'string' && val !== '' ? val : undefined
}

export interface BuiltInventory {
  rows: ArchiveSessionRow[]
  workspaces: WorkspaceView[]
  archivedSessionIds: string[]
  dirIndex: SessionDirIndex
}

/**
 * Build the full inventory. Rows exist only for sessions the feed lists or
 * the sessions root contains — projection-cache or ledger entries alone never
 * conjure a row (no ghosts). Rows from the feed carry reliable last-activity
 * times; disk-only rows are flagged `unreadable` metadata.
 */
export async function buildInventory(sources: InventorySources, signal: AbortSignal): Promise<BuiltInventory> {
  const now = Date.now()
  interface Draft {
    id: string
    title?: string
    createdAt?: number
    cwd?: string
    lastActivityAt?: number
    lastActivityReliable: boolean
    running: boolean
    blank: boolean
    origin?: 'subagent'
    parentId?: string
    fromFeed: boolean
    hasDir: boolean
  }
  const drafts = new Map<string, Draft>()
  const add = (id: string): Draft => {
    let draft = drafts.get(id)
    if (draft === undefined) {
      draft = {
        id,
        lastActivityReliable: false,
        running: false,
        blank: false,
        fromFeed: false,
        hasDir: false,
      }
      drafts.set(id, draft)
    }
    return draft
  }

  if (sources.feed !== undefined) {
    try {
      const response = await sources.feed.list({}, signal)
      for (const item of response.items ?? []) {
        if (typeof item.sessionId !== 'string' || item.sessionId === '') continue
        const draft = add(item.sessionId)
        draft.fromFeed = true
        draft.running = item.running === true
        draft.blank = item.blank === true
        if (typeof item.updatedAt === 'number') {
          draft.lastActivityAt = item.updatedAt
          draft.lastActivityReliable = true
        }
        if (typeof item.cwd === 'string' && item.cwd !== '') draft.cwd = item.cwd
        if (typeof item.parentSessionId === 'string' && item.parentSessionId !== '') draft.parentId = item.parentSessionId
        if (item.origin === 'subagent') draft.origin = 'subagent'
      }
    } catch (error) {
      if (signal.aborted) throw error
      // A failing feed degrades to disk+projcache discovery; rows keep the
      // `unreadable` flag so the UI says the metadata is incomplete.
    }
  }

  const dirIndex = indexSessionDirs(join(sources.dshHome, 'sessions'))
  for (const id of dirIndex.byId.keys()) add(id).hasDir = true

  const projcache = readProjcacheIndex(sources.dshHome)
  for (const [id, entry] of Object.entries(projcache.sessions)) {
    const draft = drafts.get(id)
    if (draft === undefined) continue
    if (draft.title === undefined) draft.title = titleFromProjcache(entry)
    if (draft.createdAt === undefined && typeof entry.identity?.createdAt === 'number') draft.createdAt = entry.identity.createdAt
    if (draft.cwd === undefined && typeof entry.identity?.cwd === 'string' && entry.identity.cwd !== '') draft.cwd = entry.identity.cwd
  }

  const workspaces: WorkspaceView[] = []
  const workspaceOf = new Map<string, string[]>()
  if (sources.registry !== undefined) {
    try {
      for (const entity of sources.registry.list()) {
        workspaces.push({ id: entity.id, title: entity.title, path: entity.path, sessionIds: [...entity.sessionIds] })
        for (const sessionId of entity.sessionIds) {
          const list = workspaceOf.get(sessionId)
          if (list === undefined) workspaceOf.set(sessionId, [entity.id])
          else if (!list.includes(entity.id)) list.push(entity.id)
        }
      }
    } catch {
      // Registry hiccup degrades to workspace-less rows; the feed remains.
    }
  }
  let archivedSessionIds: string[] = []
  if (sources.registry !== undefined) {
    try {
      archivedSessionIds = [...sources.registry.archivedSessionIds]
    } catch {
      archivedSessionIds = []
    }
  }
  const archivedSet = new Set(archivedSessionIds)
  // Historical archive entries with no storage left (no feed row, no dir)
  // still surface as rows — flagged `no-data` — so the archive view stays
  // complete and the entries can be cleaned through unarchive/delete instead
  // of silently lingering as ghosts.
  for (const id of archivedSet) {
    if (!drafts.has(id)) add(id)
  }

  const childIds = new Map<string, string[]>()
  for (const draft of drafts.values()) {
    if (draft.parentId === undefined) continue
    const list = childIds.get(draft.parentId)
    if (list === undefined) childIds.set(draft.parentId, [draft.id])
    else list.push(draft.id)
  }

  const rows: ArchiveSessionRow[] = []
  for (const draft of drafts.values()) {
    const issues: ArchiveIssueCode[] = []
    if (draft.title === undefined) issues.push('no-title')
    const archived = archivedSet.has(draft.id)
    const archivedAt = archived ? sources.ledger.entries[draft.id]?.archivedAt : undefined
    if (archived && archivedAt === undefined) issues.push('no-archive-time')
    if (draft.fromFeed === false) issues.push('unreadable')
    if (draft.fromFeed === false && draft.hasDir === false) issues.push('no-data')
    const childList = childIds.get(draft.id) ?? []
    const sizeBytes = dirIndex.sizes.get(draft.id)
    rows.push({
      id: draft.id,
      ...(draft.title !== undefined ? { title: draft.title } : {}),
      ...(draft.createdAt !== undefined ? { createdAt: draft.createdAt } : {}),
      ...(draft.cwd !== undefined ? { cwd: draft.cwd } : {}),
      workspaceIds: workspaceOf.get(draft.id) ?? [],
      archived,
      ...(archivedAt !== undefined ? { archivedAt } : {}),
      ...(draft.lastActivityAt !== undefined ? { lastActivityAt: draft.lastActivityAt } : {}),
      lastActivityReliable: draft.lastActivityReliable,
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      running: draft.running,
      blank: draft.blank,
      ...(draft.origin !== undefined ? { origin: draft.origin } : {}),
      ...(draft.parentId !== undefined ? { parentId: draft.parentId } : {}),
      childIds: childList,
      childCount: childList.length,
      issues,
    })
  }
  rows.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0) || a.id.localeCompare(b.id))
  return { rows, workspaces, archivedSessionIds, dirIndex }
}

export function emptyLedger(): LedgerDocument {
  return { version: 1, entries: {} }
}
