import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  applyManagedBlock,
  decodeZstdLog,
  describeMountState,
  discoverLegacySessions,
  encodeSessionLog,
  eventDimensions,
  insertSession,
  main,
  openStore,
  parseSessionLog,
  projectPersistedEvents,
} from './dsh-better-session.mjs'

const event = (type, seq, time, data, extra = {}) => ({ type, seq, time, data, ...extra })
const chunkRow = (tag, seq0, time0, texts) => ({ type: tag, seq0, time0, data: { turn: 1, step: 1, index: seq0, dt: [], texts } })

test('decodeZstdLog splits concatenated frames and reports torn tails', () => {
  const batch = (n) => [
    event('turn/start', n * 10, n * 1000 + 1, {}),
    event('user/message', n * 10 + 1, n * 1000 + 2, { text: `m${n}` }),
  ]
  const encoded = encodeSessionLog(
    { type: 'session', version: 0, id: 'session-frame-walk', createdAt: 1 },
    [batch(0), batch(1), batch(2)],
  )
  assert.equal(decodeZstdLog(encoded).chunks.length, 4, 'header frame plus three batch frames decode independently')

  // Truncating anywhere short of the final frame's tail leaves every earlier
  // frame decodable and the damaged one unrecoverable (torn-tail recovery).
  const cut = encoded.subarray(0, encoded.length - 24)
  const torn = decodeZstdLog(cut)
  assert.equal(torn.tornTail, true)
  assert.ok(torn.chunks.length >= 2, 'complete frames before the tear still decode')
})

test('parseSessionLog validates the header line', () => {
  const good = parseSessionLog(encodeSessionLog({ type: 'session', version: 0, id: 'session-fixture-1', createdAt: 1700000000000 }, []))
  assert.equal(good.header.id, 'session-fixture-1')
  assert.deepEqual(good.events, [])
  assert.throws(() => parseSessionLog(encodeSessionLog({ type: 'not-a-session', version: 0 }, [])), /not a session header/)
  assert.throws(() => parseSessionLog(encodeSessionLog({ type: 'session', id: 'x', version: 7 }, [])), /unsupported format version/)
})

test('projectPersistedEvents drops ephemeral/ignorable/packed rows and prunes provenance', () => {
  const events = [
    chunkRow('text-chunks', 3, 300, ['a', 'b']),
    event('assistant/chunk', 4, 400, { text: 'delta' }),
    event('request/header', 5, 500, {}, { ignorable: true }),
    event('user/message', 6, 600, { text: 'hi' }),
    event('assistant/message', 7, 700, { text: 'full body' }, { sourceEventSeqs: [4, 6] }),
    event('tool/call', 8, 800, { callId: 'call-9', name: 'bash' }),
    event('tool/result', 9, 900, { message: { content: [{ toolCallId: 'call-9' }] } }),
  ]
  const projected = projectPersistedEvents(events)
  assert.deepEqual(projected.rows.map((r) => r.kind), ['user/message', 'assistant/message', 'tool/call', 'tool/result'])
  assert.deepEqual(projected.droppedSeqs.sort((a, b) => a - b), [3, 4, 5])
  // Provenance pointing at the dropped delta (seq 4) is pruned away while the
  // surviving reference (seq 6) stays.
  assert.equal(projected.rows[1].sourceEventSeqs, JSON.stringify([6]))
  assert.equal(projected.rows[2].role, 'function')
  assert.equal(projected.rows[2].name, 'bash')
  assert.equal(projected.rows[2].actionId, 'call-9')
  assert.equal(projected.rows[3].actionId, 'call-9')
})

test('eventDimensions falls back to playpen defaults for unknown kinds', () => {
  assert.deepEqual(eventDimensions(event('custom/plugin-event', 1, 1, {})), { role: '', name: '', actionId: '' })
  assert.deepEqual(eventDimensions(event('todo/write', 1, 1, {})), { role: 'state', name: 'todos', actionId: '' })
  assert.equal(eventDimensions(event('tool/result', 1, 1, {})).actionId, '')
})

test('insertSession writes dense bridges, head cursor, and is idempotent per session id', () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'dsh-bs-')), 'store.sqlite')
  const db = openStore(dbPath, { createStore: true })
  try {
    const projection = projectPersistedEvents([
      event('user/message', 0, 10, { text: 'a' }),
      event('assistant/chunk', 1, 11, {}),
      event('assistant/message', 2, 12, { text: 'b' }),
    ])
    assert.deepEqual(insertSession(db, { id: 'session-a', version: 0, createdAt: 5, cwd: '/p' }, projection), { inserted: true })
    insertSession(db, { id: 'session-a' }, projection)
    const head = db.prepare("SELECT f_head_sequence AS s FROM t_sessions WHERE f_session_id='session-a'").get()
    assert.equal(head.s, 1, 'two persisted events renumber densely to head seq 1')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM t_events WHERE f_kind=?').get('assistant/message').n, 1, 're-run inserts nothing new')
    assert.equal(db.prepare('SELECT f_revision AS r FROM t_sessions').get().r, 1, 'one durable write bumps revision once')
    const chainRoots = db.prepare(`SELECT t_session_events.f_sequence AS seq, t_events.f_parent_id AS parent
        FROM t_session_events JOIN t_events ON t_events.f_event_id = t_session_events.f_event_id
        WHERE f_session_id='session-a' ORDER BY f_sequence`).all()
    assert.equal(chainRoots[0].parent, '', 'first bridge chains from the empty root anchor')
    assert.notEqual(chainRoots[1].parent, '', 'second bridge chains onto the first event row')
  } finally {
    db.close()
    rmSync(dbPath, { force: true })
  }
})

function buildFakeRoot(root) {
  const addSession = (project, dirName, headerId, events) => {
    const dir = join(root, project, dirName)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.jsonl.zstd'), encodeSessionLog({ type: 'session', version: 0, id: headerId, createdAt: 42, cwd: `/work/${project}` }, [events]))
  }
  addSession('--proj-a--', 'session-one', 'session-one', [event('user/message', 0, 1, { text: 'hello' }), event('assistant/chunk', 1, 2, {})])
  addSession('--proj-a--', 'deadbeef-bare', 'bare-two', [event('user/message', 0, 3, { text: 'bare uuid era' })])
  addSession('--proj-b--', 'with-surface', 'session-three', [
    event('user/message', 4, 40, { text: 'ctx' }),
    event('assistant/message', 5, 50, { text: 'surface' }, { sourceEventSeqs: [4], surfaceOp: 'append' }),
    event('user/message', 6, 60, { text: 'tail' }),
  ])
}

test('discoverLegacySessions walks bare-uuid dirs too and flags encoding mismatches', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-bs-root-'))
  try {
    buildFakeRoot(root)
    mkdirSync(join(root, '--proj-c--', 'conflicted'), { recursive: true })
    writeFileSync(join(root, '--proj-c--', 'conflicted', 'session.jsonl.zstd'), Buffer.alloc(0))
    writeFileSync(join(root, '--proj-c--', 'conflicted', 'session.jsonl'), '{}')
    const found = discoverLegacySessions(root)
    assert.equal(found.length, 4)
    assert.ok(found.some((s) => s.sessionId === 'deadbeef-bare'), 'bare uuid segments are session dirs')
    assert.ok(found.find((s) => s.projectKey === '--proj-c--')?.encodingMismatch)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

async function runCapture(argv) {
  let captured = ''
  const log = console.log
  console.log = (line) => { captured += `${line}\n` }
  try {
    const code = await main(argv)
    assert.notEqual(code, 1, `command failed: ${captured}`)
    return captured
  } finally {
    console.log = log
  }
}

/** `--json` output shares stdout with progress reports; keep the payload only. */
function jsonFrom(text) {
  return text.slice(text.indexOf('{'))
}

test('migrate dry-run parses without touching the store, then --apply imports idempotently', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-bs-run-'))
  const sessionsDir = join(tmp, 'sessions')
  const dbPath = join(tmp, 'sessions.sqlite')
  try {
    buildFakeRoot(sessionsDir)
    const dry = JSON.parse(jsonFrom(await runCapture(['migrate', '--json', '--sessions-dir', sessionsDir, '--db', dbPath])))
    assert.equal(dry.imported, 0)
    assert.equal(dry.details.find((d) => d.sessionId === 'deadbeef-bare').status, 'would-import')
    assert.equal(dry.details.every((d) => d.torn === false), true)

    const applied = JSON.parse(jsonFrom(await runCapture(['migrate', '--json', '--apply', '--yes', '--create-store', '--sessions-dir', sessionsDir, '--db', dbPath])))
    assert.equal(applied.imported, 3)

    const db = openStore(dbPath)
    try {
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM t_sessions').get().n, 3)
      // The surface event keeps its provenance verbatim because nothing was
      // dropped in its own log; the replace-style op serializes as-is.
      const surface = db.prepare("SELECT f_source_event_seqs AS refs FROM t_events WHERE f_surface_op = '\"append\"'").get()
      assert.equal(surface.refs, JSON.stringify([4]))
      const projA = db.prepare("SELECT COUNT(*) AS n FROM t_sessions WHERE f_cwd LIKE '%proj-a%'").get().n
      assert.equal(projA, 2, 'both naming eras under one project land in the same store')
      const again = JSON.parse(jsonFrom(await runCapture(['migrate', '--json', '--apply', '--yes', '--create-store', '--sessions-dir', sessionsDir, '--db', dbPath])))
      assert.equal(again.skippedExisting, 3, 're-running converges without duplicates')
      assert.equal(again.imported, 0)
    } finally {
      db.close()
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('enable/disable manage a marker-delimited override block in the profile patch', () => {
  const base = '# existing row\n- id: web-ui-remote-web-ui\n  config:\n    autoTunnel: true\n'
  const enabled = applyManagedBlock(base, 'insert')
  assert.match(enabled, /# >>> dsh-better-session opt-in/)
  assert.match(enabled, /\n- id: web-ui-session-rdb\n  disabled: false\n/)
  assert.match(enabled, /\n- id: session-persistence-jsonl\n  disabled: true\n/, 'the jsonl patch stays disabled inside the enable block')
  assert.equal(enabled.endsWith('\n'), true)
  assert.equal(applyManagedBlock(enabled, 'insert').split('# >>> dsh-better-session opt-in').length - 1, 1, 're-enabling replaces instead of duplicating')
  assert.equal(applyManagedBlock(enabled, 'remove'), base, 'disabling removes the whole managed block')
  assert.equal(applyManagedBlock(base, 'remove'), base, 'remove without a block is a no-op')
})

test('describeMountState derives the opt-in posture from repo + profile files', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-bs-mount-'))
  try {
    const repoPatch = join(tmp, 'repo.patch.yml')
    const profilePatch = join(tmp, 'profile.patch.yml')
    const inactiveRepo = [
      '- id: session-persistence-jsonl',
      '  disabled: true',
      '- id: web-ui-session-branch',
      '  disabled: true',
      '- id: web-ui-session-rdb',
      '  disabled: true',
      '- id: web-ui-conversation-message-actions',
      '  disabled: true',
    ].join('\n')
    writeFileSync(repoPatch, inactiveRepo)
    writeFileSync(profilePatch, '')
    assert.equal(describeMountState(repoPatch, profilePatch).state, 'inactive-by-default')
    writeFileSync(profilePatch, `${inactiveRepo}\n${applyManagedBlock('', 'insert')}`)
    assert.equal(describeMountState(repoPatch, profilePatch).state, 'enabled-via-profile')
    writeFileSync(repoPatch, '')
    assert.equal(describeMountState(repoPatch, profilePatch).state, 'enabled-via-profile', 'profile block wins regardless of repo posture')
    writeFileSync(profilePatch, '')
    assert.equal(describeMountState(repoPatch, profilePatch).state, 'not-installed-or-manual')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
