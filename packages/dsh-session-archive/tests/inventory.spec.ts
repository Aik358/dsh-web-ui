import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  canonicalSessionId,
  indexSessionDirs,
  isInside,
  isSessionRdb,
  deleteRdbSession,
  rdbDbPaths,
} from '../src/host/session-files.ts'
import { buildInventory } from '../src/host/inventory.ts'
import { createFakeHost, fakeContext, writeProjcache, type FakeHost } from './fixtures.ts'

describe('canonicalSessionId', () => {
  it('maps both segment spellings to the one canonical id', () => {
    expect(canonicalSessionId('abc')).toBe('session-abc')
    expect(canonicalSessionId('session-abc')).toBe('session-abc')
  })
})

describe('isInside', () => {
  it('accepts children and the root itself, rejects outside paths and prefix tricks', () => {
    expect(isInside('/sessions', '/sessions/proj/id')).toBe(true)
    expect(isInside('/sessions', '/sessions')).toBe(true)
    expect(isInside('/sessions', '/sessions-other/id')).toBe(false)
    expect(isInside('/sessions', '/etc/passwd')).toBe(false)
  })
})

describe('indexSessionDirs', () => {
  it('indexes by the canonical id with sizes', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-session-archive-'))
    const project = join(home, 'sessions', '--demo--')
    mkdirSync(join(project, 'abc'), { recursive: true })
    writeFileSync(join(project, 'abc', 'session.jsonl.zstd'), Buffer.alloc(128, 1))
    const index = indexSessionDirs(join(home, 'sessions'))
    expect(index.byId.get('session-abc')).toBeDefined()
    expect(index.byId.has('abc')).toBe(false)
    expect(index.sizes.get('session-abc')).toBe(128)
  })

  it('does not follow symlinks that escape the sessions root', () => {
    if (process.platform === 'win32') return
    const home = mkdtempSync(join(tmpdir(), 'dsh-session-archive-'))
    const outside = mkdtempSync(join(tmpdir(), 'dsh-session-archive-outside-'))
    const project = join(home, 'sessions', '--demo--')
    mkdirSync(project, { recursive: true })
    symlinkSync(outside, join(project, 'escape'))
    const index = indexSessionDirs(join(home, 'sessions'))
    expect(index.byId.size).toBe(0)
    expect(index.unreadable).toHaveLength(1)
    expect(existsSync(outside)).toBe(true)
  })
})

describe('session-rdb store', () => {
  function makeRdb(path: string): void {
    const db = new DatabaseSync(path)
    db.exec('pragma application_id = 1146308688')
    db.exec('pragma user_version = 1')
    db.exec('create table t_sessions (f_session_id text primary key, f_created_at integer)')
    db.exec('create table t_session_events (f_event_id text primary key, f_session_id text references t_sessions(f_session_id) on delete cascade)')
    db.prepare('insert into t_sessions values (?, ?)').run('session-1', 1)
    db.prepare('insert into t_session_events values (?, ?)').run('e1', 'session-1')
    db.close()
  }

  it('fingerprints the rdb store', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-session-archive-'))
    mkdirSync(join(home, 'sessions'), { recursive: true })
    const dbPath = join(home, 'sessions', 'sessions.sqlite')
    expect(isSessionRdb(dbPath)).toBe(false)
    makeRdb(dbPath)
    expect(isSessionRdb(dbPath)).toBe(true)
    expect(isSessionRdb(join(home, 'nope.sqlite'))).toBe(false)
  })

  it('deletes rows with the event cascade', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-session-archive-'))
    mkdirSync(join(home, 'sessions'), { recursive: true })
    const dbPath = join(home, 'sessions', 'sessions.sqlite')
    makeRdb(dbPath)
    expect(deleteRdbSession(dbPath, 'session-2')).toBe(false)
    expect(deleteRdbSession(dbPath, 'session-1')).toBe(true)
    const db = new DatabaseSync(dbPath, { readOnly: true })
    expect(db.prepare('select count(*) as n from t_sessions').get()).toEqual({ n: 0 })
    expect(db.prepare('select count(*) as n from t_session_events').get()).toEqual({ n: 0 })
    db.close()
    expect(rdbDbPaths(home)).toContain(dbPath)
  })
})

describe('buildInventory', () => {
  function writeSessionDir(host: FakeHost, id: string, size = 64): void {
    const project = join(host.home, 'sessions', '--Users-demo--')
    mkdirSync(project, { recursive: true })
    const dir = join(project, id.startsWith('session-') ? id.slice('session-'.length) : id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.jsonl.zstd'), Buffer.alloc(size, 3))
  }

  it('merges feed, disk, projcache, registry, and ledger; never invents rows from projcache alone', async () => {
    const host = createFakeHost({
      feedItems: [
        { sessionId: 'session-feed', updatedAt: 500, cwd: '/tmp/demo' },
        { sessionId: 'session-child', updatedAt: 400, parentSessionId: 'session-feed', origin: 'subagent' },
      ],
      workspaces: [{ id: 'ws-1', path: '/tmp/demo', title: 'Demo', sessionIds: ['session-feed'] }],
      archivedSessionIds: ['session-feed', 'session-ghost'],
      dirs: ['session-diskonly'],
    })
    host.ledger.entries['session-feed'] = { archivedAt: 900, source: 'manual' }
    writeProjcache(host.home, {
      'session-feed': { title: 'Feed session', createdAt: 100 },
      'session-diskonly': { title: 'Disk only', createdAt: 200 },
      'session-projcacheonly': { title: 'Should not appear' },
    })
    const built = await buildInventory(host.sources(), AbortSignal.timeout(5000))
    const ids = built.rows.map((row) => row.id)
    expect(ids.sort()).toEqual(['session-child', 'session-diskonly', 'session-feed', 'session-ghost'])
    expect(ids).not.toContain('session-projcacheonly')

    const feedRow = built.rows.find((row) => row.id === 'session-feed')
    expect(feedRow?.title).toBe('Feed session')
    expect(feedRow?.createdAt).toBe(100)
    expect(feedRow?.archived).toBe(true)
    expect(feedRow?.archivedAt).toBe(900)
    expect(feedRow?.workspaceIds).toEqual(['ws-1'])
    expect(feedRow?.lastActivityReliable).toBe(true)
    expect(feedRow?.issues).toEqual([])

    const child = built.rows.find((row) => row.id === 'session-child')
    expect(child?.parentId).toBe('session-feed')
    expect(child?.origin).toBe('subagent')
    const feedParent = built.rows.find((row) => row.id === 'session-feed')
    expect(feedParent?.childIds).toEqual(['session-child'])

    const diskRow = built.rows.find((row) => row.id === 'session-diskonly')
    expect(diskRow?.title).toBe('Disk only')
    expect(diskRow?.lastActivityReliable).toBe(false)
    expect(diskRow?.issues).toContain('unreadable')

    const ghost = built.rows.find((row) => row.id === 'session-ghost')
    expect(ghost?.issues).toContain('no-data')
    expect(ghost?.issues).toContain('no-archive-time')
  })

  it('degrades gracefully when the feed fails', async () => {
    const host = createFakeHost({ dirs: ['session-x'] })
    host.feedItems = []
    const sources = host.sources()
    sources.feed = {
      list() {
        return Promise.reject(new Error('feed down'))
      },
    }
    const built = await buildInventory(sources, AbortSignal.timeout(5000))
    expect(built.rows.map((row) => row.id)).toEqual(['session-x'])
  })

  it('exposes the fake context the way the service reads it', () => {
    const host = createFakeHost()
    const ctx = fakeContext(host) as { get(name: string): unknown }
    expect((ctx.get('workspaceRegistry') as FakeHost['registry']).archivedSessionIds).toEqual([])
  })
})
