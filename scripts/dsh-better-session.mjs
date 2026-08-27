#!/usr/bin/env node
/**
 * dsh-better-session — manage the inactive-by-default @morlay/better-session
 * aggregate rows: inspect both session stores, migrate the legacy jsonl.zstd
 * logs into the RDB SQLite store, and flip the opt-in overrides in a profile.
 *
 * Usage:
 *   node scripts/dsh-better-session.mjs status [--profile web] [--json]
 *   node scripts/dsh-better-session.mjs migrate [--apply] [--project <key>]
 *        [--limit N] [--include-empty] [--json] [--no-backup] [--create-store]
 *        [--sessions-dir DIR] [--db FILE]
 *   node scripts/dsh-better-session.mjs enable  [--profile web] [--yes] [--dry-run]
 *   node scripts/dsh-better-session.mjs disable [--profile web] [--dry-run]
 *
 * The aggregate ships every expanded better-session row behind a trailing
 * `disabled: true` override ("inactive by default"), so a fresh install keeps
 * the stock jsonl persistence. This tool is the opt-in path:
 *
 *   1. `migrate --apply` (with dsh stopped): decodes each legacy
 *      `<root>/<project>/session-<id>/session.jsonl.zstd` and inserts it into
 *      the RDB store's tables. Drop/filter semantics mirror
 *      @morlay/session-rdb@0.0.11 (`EPHEMERAL_EVENT_TYPES`, `ignorable`,
 *      dense renumbering, provenance pruning).
 *   2. `enable`: appends a managed `disabled: false` override block to the
 *      profile patch so the three rows mount on next start.
 *
 * Migration is insert-only and idempotent (existing session ids are skipped),
 * so re-running after a partial run converges. Sessions created under the RDB
 * backend are never touched.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { constants as zlibConstants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'

const TAG = '[dsh-better-session] '

/** Marker strings framing the managed override block written by enable/disable. */
const BLOCK_BEGIN = '# >>> dsh-better-session opt-in (managed by scripts/dsh-better-session.mjs) >>>'
const BLOCK_END = '# <<< dsh-better-session opt-in <<<'

/** Aggregate rows this tool manages. `session-persistence-jsonl` is intentionally absent from the enable block: */
const MANAGED_INSERT_IDS = ['web-ui-session-branch', 'web-ui-session-rdb', 'web-ui-conversation-message-actions']
/** …the aggregate already disables it permanently because the RDB backend replaces it once enabled. */
const HARNESS_ROW_ID = 'session-persistence-jsonl'

/**
 * Identity constants mirroring @morlay/session-rdb@0.0.11. When the store is
 * missing they let this script bootstrap a compatible empty database; an
 * EXISTING store is fingerprint-checked before any write so we never touch
 * files owned by another tool (for example the query cache).
 */
const SESSION_FORMAT_VERSION = 0
const SCHEMA_VERSION = 1
const SQLITE_APPLICATION_ID = 1146308688
const EPHEMERAL_EVENT_TYPES = ['assistant/chunk']

function report(message) {
  console.log(TAG + message)
}

function fatal(message) {
  console.error(TAG + 'ERROR ' + message)
  process.exitCode = 1
}

/** Parse argv into `{ command, flags }`; unknown booleans are rejected by usage(). */
function parseArgv(argv) {
  const [command = '', ...rest] = argv
  const flags = { _: [] }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (!arg.startsWith('--')) {
      flags._.push(arg)
      continue
    }
    const key = arg.slice(2)
    const valueful = ['project', 'limit', 'profile', 'sessions-dir', 'db']
    if (valueful.includes(key)) {
      const value = rest[i + 1]
      if (value === undefined) throw new Error(`flag ${key} expects a value`)
      flags[key] = value
      i++
      continue
    }
    flags[key] = true
  }
  return { command, flags }
}

function usage() {
  report('usage: node scripts/dsh-better-session.mjs <status|migrate|enable|disable> [--apply|--yes|--dry-run] [--json]')
  process.exit(process.argv[2] === undefined ? 0 : 1)
}

/* ── zstd frame handling ─────────────────────────────────────────────────── */

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * Walk a zstd frame structurally and return the byte offset just past its
 * final block (and checksum, when the header declares one). Mirrors the
 * concatenated-frame layout the official writer produces: independent frames
 * appended back-to-back, so each can be decompressed on its own slice.
 *
 * Block headers are little-endian triples (3 bytes): bit 0 last-block,
 * bits 1-2 type, bits 3+ size. Frame header size derives from the frame
 * header descriptor bitfield (RFC 8878).
 */
function zstdFrameEnd(buffer, start) {
  const descriptor = buffer[start + 4]
  const fcsFlag = descriptor >> 6 & 0b11
  const singleSegment = (descriptor >> 5 & 1) === 1
  const checksumFlag = (descriptor >> 2 & 1) === 1
  const dictFlag = descriptor & 0b11
  let pos = start + 5
  if (!singleSegment) pos += 1
  // FCS field size: absent (flag 0, streaming) or one byte when
  // Single_Segment pins the frame to end at EOF; otherwise 2/4/8 bytes.
  pos += fcsFlag === 0 ? (singleSegment ? 1 : 0) : [0, 2, 4, 8][fcsFlag - 1]
  pos += [0, 1, 2, 4][dictFlag]
  for (;;) {
    if (pos + 3 > buffer.length) return -1
    const header = buffer.readUIntLE(pos, 3)
    const last = (header & 1) === 1
    const blockSize = header >> 3
    pos += 3 + blockSize
    if ((header >> 1 & 0b11) === 0b11) return -1 // reserved block type
    if (last) break
  }
  if (checksumFlag) pos += 4
  return pos
}

/**
 * Split a concatenated multi-frame log into decoded plaintext chunks. Node's
 * synchronous decompressor returns after the FIRST complete frame, which is
 * exactly why the whole-buffer call cannot serve here.
 * @returns {{ chunks: string[], tornTail: boolean }}
 */
export function decodeZstdLog(buffer) {
  if (typeof zstdDecompressSync !== 'function') {
    throw new Error('this Node build lacks native zstd APIs; Node >= 22.15 is required')
  }
  const chunks = []
  let tornTail = false
  let cursor = buffer.indexOf(ZSTD_MAGIC)
  while (cursor >= 0 && cursor < buffer.length) {
    const end = zstdFrameEnd(buffer, cursor)
    // Structurally broken or truncated final frame: recover whatever prefix
    // decodes and flag the loss — mirrors the reader's torn-tail handling.
    if (end < 0 || end > buffer.length) {
      try {
        chunks.push(zstdDecompressSync(buffer.subarray(cursor)).toString('utf8'))
      } catch { /* unrecoverable remainder */ }
      tornTail = true
      break
    }
    chunks.push(zstdDecompressSync(buffer.subarray(cursor, end)).toString('utf8'))
    cursor = end
  }
  return { chunks, tornTail }
}

/**
 * Decode one `session.jsonl.zstd`. The first frame must carry exactly one
 * line: the session header. Later chunks hold event lines (one JSON value per
 * line). Returns the header, parsed storage rows, and how far decoding got.
 */
export function parseSessionLog(buffer) {
  const { chunks, tornTail } = decodeZstdLog(buffer)
  const text = chunks.join('')
  const lines = text.split('\n').filter((line) => line.length > 0)
  if (lines.length === 0) throw new Error('empty log')
  const header = JSON.parse(lines[0])
  if (header.type !== 'session') throw new Error(`first line is not a session header (${String(header.type)})`)
  if (header.version !== SESSION_FORMAT_VERSION) throw new Error(`unsupported format version ${JSON.stringify(header.version)} (expected ${SESSION_FORMAT_VERSION})`)
  const events = []
  for (let i = 1; i < lines.length; i++) {
    try {
      events.push(JSON.parse(lines[i]))
    } catch (error) {
      throw new Error(`malformed event line ${i + 1}: ${error.message}`)
    }
  }
  return { header, events, tornTail }
}

/** Compose one legacy log exactly like the official writer does: frame 1 holds the header line, later frames hold batches of event lines. Used by tests and fixtures. */
export function encodeSessionLog(header, eventBatches) {
  const frames = [zstdCompressSync(JSON.stringify(header) + '\n', { params: { [zlibConstants.ZSTD_c_checksumFlag]: 1 } })]
  for (const batch of eventBatches) {
    frames.push(zstdCompressSync(batch.map((line) => JSON.stringify(line)).join('\n') + '\n', { params: { [zlibConstants.ZSTD_c_checksumFlag]: 1 } }))
  }
  return Buffer.concat(frames)
}

/* ── conversion pipeline (mirrors @morlay/session-rdb@0.0.11) ────────────── */

/** Packed storage rows produced by the writer's chunk packing; their content lives in the authoritative non-delta events, so the importer drops them like the rdb backend does. */
const PACKED_ROW_TAGS = new Set(['text-chunks', 'reasoning-chunks', 'tool-call-chunks'])

/**
 * Whether a decoded event gets a persisted row. Keeps the exact predicate of
 * `isPersistedEvent` plus the packed-row tags the rdb layer never receives
 * (they expand into delta events before reaching the backend).
 */
export function isPersistedEvent(event) {
  return !PACKED_ROW_TAGS.has(event.type) && !EPHEMERAL_EVENT_TYPES.includes(event.type) && event.ignorable !== true
}

/**
 * Playpen dimensions for `t_events.f_role/f_name/f_action_id`. Verbatim port
 * of `eventDimensions` (unknown plugin-merged types keep playpen defaults).
 */
export function eventDimensions(event) {
  switch (event.type) {
    case 'turn/start':
    case 'turn/end':
    case 'step/start':
    case 'step/end':
    case 'session/end-seed':
      return { role: 'turn', name: '', actionId: '' }
    case 'user/message':
    case 'request/header':
    case 'request/context':
      return { role: 'user', name: '', actionId: '' }
    case 'assistant/message':
      return { role: 'model', name: '', actionId: '' }
    case 'tool/call':
      return { role: 'function', name: String(event.data?.name ?? ''), actionId: String(event.data?.callId ?? '') }
    case 'tool/result':
      return { role: 'function', name: '', actionId: String(event.data?.message?.content?.[0]?.toolCallId ?? '') }
    case 'todo/write':
      return { role: 'state', name: 'todos', actionId: '' }
    default:
      return { role: '', name: '', actionId: '' }
  }
}

/**
 * Reduce one session's decoded events to persisted rows: drops ephemeral /
 * ignorable / packed rows, prunes surface provenance referencing dropped seqs
 * (fully-pruned lists store NULL, like `surfaceBindings`), and prepares the
 * parent chain anchor values. Bridge sequences are assigned densely from 0 in
 * original order — the importer always writes complete logs, so a fresh head
 * starts at -1.
 * @returns {{ rows: object[], droppedSeqs: number[], droppedCount: number, rawCount: number }}
 */
export function projectPersistedEvents(events) {
  const droppedSeqs = []
  for (const event of events) {
    if (!isPersistedEvent(event)) droppedSeqs.push(Number(event.seq ?? event.seq0))
  }
  const dropped = new Set(droppedSeqs)
  const rows = events.filter(isPersistedEvent).map((event) => {
    const refs = Array.isArray(event.sourceEventSeqs) ? event.sourceEventSeqs.filter((seq) => !dropped.has(seq)) : undefined
    const dims = eventDimensions(event)
    return {
      eventId: randomUUID(),
      kind: event.type,
      data: JSON.stringify(event.data ?? {}),
      createdAt: Number(event.time ?? 0),
      originalSeq: Number(event.seq),
      sourceEventSeqs: refs !== undefined && refs.length > 0 ? JSON.stringify(refs) : null,
      surfaceOp: event.surfaceOp !== undefined ? JSON.stringify(event.surfaceOp) : null,
      role: dims.role,
      name: dims.name,
      actionId: dims.actionId,
    }
  })
  return { rows, droppedSeqs, droppedCount: dropped.size, rawCount: events.length }
}

/* ── store helpers ────────────────────────────────────────────────────────── */

const DDL = [
  `CREATE TABLE IF NOT EXISTS "t_persistence_state" (
\t"f_singleton"\tINTEGER PRIMARY KEY CHECK("f_singleton" = 1),
\t"f_store_id"\tTEXT NOT NULL
) STRICT`,
  `CREATE TABLE IF NOT EXISTS "t_sessions" (
\t"f_id"\tINTEGER PRIMARY KEY AUTOINCREMENT,
\t"f_session_id"\tTEXT NOT NULL UNIQUE,
\t"f_head_event_id"\tTEXT NOT NULL DEFAULT '',
\t"f_head_sequence"\tINTEGER NOT NULL DEFAULT -1,
\t"f_version"\tINTEGER NOT NULL,
\t"f_created_at"\tINTEGER NOT NULL,
\t"f_cwd"\tTEXT,
\t"f_parent_session"\tTEXT,
\t"f_seed_length"\tINTEGER,
\t"f_origin"\tTEXT,
\t"f_delegation_depth"\tINTEGER,
\t"f_incarnation"\tTEXT NOT NULL,
\t"f_revision"\tINTEGER NOT NULL
) STRICT`,
  `CREATE TABLE IF NOT EXISTS "t_events" (
\t"f_id"\tINTEGER PRIMARY KEY AUTOINCREMENT,
\t"f_event_id"\tTEXT NOT NULL UNIQUE,
\t"f_parent_id"\tTEXT NOT NULL DEFAULT '',
\t"f_kind"\tTEXT NOT NULL DEFAULT '',
\t"f_role"\tTEXT NOT NULL DEFAULT '',
\t"f_name"\tTEXT NOT NULL DEFAULT '',
\t"f_action_id"\tTEXT NOT NULL DEFAULT '',
\t"f_encoding"\tTEXT NOT NULL DEFAULT '',
\t"f_data"\tTEXT NOT NULL,
\t"f_created_at"\tINTEGER NOT NULL DEFAULT 0,
\t"f_original_seq"\tINTEGER NOT NULL,
\t"f_source_event_seqs"\tTEXT,
\t"f_surface_op"\tTEXT
) STRICT`,
  `CREATE TABLE IF NOT EXISTS "t_session_events" (
\t"f_id"\tINTEGER PRIMARY KEY AUTOINCREMENT,
\t"f_session_id"\tTEXT NOT NULL REFERENCES "t_sessions"("f_session_id") ON DELETE CASCADE,
\t"f_event_id"\tTEXT NOT NULL REFERENCES "t_events"("f_event_id") ON DELETE CASCADE,
\t"f_sequence"\tINTEGER NOT NULL,
\tUNIQUE("f_session_id", "f_sequence")
) STRICT`,
]

/**
 * Open the RDB store. Existing stores are fingerprint-checked (application id
 * + schema version must match @morlay/session-rdb@0.0.11) so the script never
 * mutates foreign sqlite files; a missing file can only be opened with
 * `createStore` set, which bootstraps the DDL above byte-compatible with the
 * backend's own entity definitions.
 */
export function openStore(dbPath, { createStore = false } = {}) {
  const existed = existsSync(dbPath)
  if (!existed && !createStore) {
    throw new Error(`store ${dbPath} does not exist yet; enable better-session once (dsh start + stop creates it) or pass --create-store`)
  }
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA foreign_keys = ON')
  if (!existed) {
    db.exec(`PRAGMA application_id = ${SQLITE_APPLICATION_ID}`)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    for (const ddl of DDL) db.exec(ddl)
    db.prepare('INSERT INTO t_persistence_state (f_singleton, f_store_id) VALUES (1, ?) ON CONFLICT DO NOTHING').run(randomUUID())
  }
  const applicationId = db.prepare('PRAGMA application_id').get()
  const userVersion = db.prepare('PRAGMA user_version').get()
  const appIdValue = Number(Object.values(applicationId)[0])
  const versionValue = Number(Object.values(userVersion)[0])
  if (appIdValue !== SQLITE_APPLICATION_ID || versionValue !== SCHEMA_VERSION) {
    db.close()
    throw new Error(`${dbPath} is not a session-rdb store (application_id=${appIdValue}, user_version=${versionValue})`)
  }
  return db
}

/* ── filesystem discovery ─────────────────────────────────────────────────── */

/**
 * Enumerate legacy sessions as `{ projectKey, sessionId, dir, logPath, sizeBytes }`, sorted deterministically.
 * The backend lists EVERY subdirectory of a project dir (the on-disk segment
 * name mirrors the raw session id, which carried no `session-` prefix in
 * older writers), so this walk is prefix-free too; the canonical session id
 * comes from the decoded header later.
 */
export function discoverLegacySessions(sessionsRoot) {
  const out = []
  if (!existsSync(sessionsRoot)) return out
  for (const project of readdirSync(sessionsRoot).sort()) {
    const projectDir = join(sessionsRoot, project)
    try {
      if (!statSync(projectDir).isDirectory()) continue
    } catch {
      continue
    }
    for (const entry of readdirSync(projectDir).sort()) {
      const dir = join(projectDir, entry)
      const logPath = join(dir, 'session.jsonl.zstd')
      let sizeBytes = 0
      try {
        sizeBytes = statSync(logPath).size
      } catch {
        continue
      }
      if (existsSync(join(dir, 'session.jsonl'))) {
        out.push({ projectKey: project, sessionId: entry, dir, logPath, sizeBytes, encodingMismatch: true })
        continue
      }
      out.push({ projectKey: project, sessionId: entry, dir, logPath, sizeBytes })
    }
  }
  return out
}

/* ── commands ─────────────────────────────────────────────────────────────── */

function defaultSessionsDir() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'sessions')
}

function defaultDbPath() {
  return join(defaultSessionsDir(), 'sessions.sqlite')
}

function defaultProfilePatch(profile) {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', profile, 'cordis.patch.yml')
}

function countTable(db, table) {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get()
  return Number(row.n)
}

/** Inspect the sqlite store without mutating anything. */
function describeStore(dbPath) {
  if (!existsSync(dbPath)) return { exists: false, path: dbPath }
  const db = openStore(dbPath)
  try {
    return {
      exists: true,
      path: dbPath,
      sessionIdUnique: countTable(db, 't_sessions'),
      events: countTable(db, 't_events'),
      bridges: countTable(db, 't_session_events'),
    }
  } finally {
    db.close()
  }
}

function hasDisabledOverride(text, id) {
  const lines = text.split(/\r?\n/)
  return lines.some((line, i) => line.trim() === `- id: ${id}` && (lines[i + 1] ?? '').trim() === 'disabled: true')
}

/** Summarize where the opt-in stands: repository artifact vs live profile overrides. */
export function describeMountState(repoPatchPath, profilePatchPath) {
  const repoText = existsSync(repoPatchPath) ? readFileSync(repoPatchPath, 'utf8') : ''
  const profileText = existsSync(profilePatchPath) ? readFileSync(profilePatchPath, 'utf8') : ''
  const repoOverridden = OVERRIDE_TARGET_IDS.every((id) => hasDisabledOverride(repoText, id))
  const profileEnabled = profileText.includes(BLOCK_BEGIN)
  const state = profileEnabled ? 'enabled-via-profile' : repoOverridden ? 'inactive-by-default' : 'not-installed-or-manual'
  return { repoOverridden, profileEnabled, state, repoPatchPath, profilePatchPath }
}

const ENABLE_BLOCK_BODY = [
  `- id: ${HARNESS_ROW_ID}`,
  '  disabled: true',
  ...MANAGED_INSERT_IDS.flatMap((id) => [`- id: ${id}`, '  disabled: false']),
]

/** Every artifact the aggregate ships for this external, used to detect its inactive state. */
const OVERRIDE_TARGET_IDS = [HARNESS_ROW_ID, ...MANAGED_INSERT_IDS]

function renderEnableBlock() {
  return [
    BLOCK_BEGIN,
    '# Re-enables the three better-session rows. The stock jsonl persistence row',
    '# stays disabled: once enabled, the RDB (SQLite) backend owns persistence.',
    '# Run `migrate --apply` first if you want legacy sessions visible in the UI.',
    ...ENABLE_BLOCK_BODY,
    BLOCK_END,
  ].join('\n')
}

export function applyManagedBlock(patchText, mode) {
  const beginIdx = patchText.indexOf(BLOCK_BEGIN)
  const endIdx = beginIdx >= 0 ? patchText.indexOf(BLOCK_END, beginIdx) : -1
  if (mode === 'remove') {
    if (beginIdx < 0) return patchText
    const after = endIdx >= 0 ? patchText.slice(endIdx + BLOCK_END.length) : ''
    const prefix = patchText.slice(0, beginIdx).replace(/\n+$/, '\n')
    const tail = after.replace(/^\n+/, '').replace(/\s*$/, '')
    return prefix + (tail ? tail + '\n' : '')
  }
  const block = renderEnableBlock()
  if (beginIdx >= 0 && endIdx >= 0) {
    return patchText.slice(0, beginIdx) + block + patchText.slice(endIdx + BLOCK_END.length)
  }
  const base = patchText.replace(/\n*$/, '\n')
  return base + '\n' + block + '\n'
}

function commandEnableDisable(command, flags) {
  const profile = flags.profile ?? 'web'
  const patchPath = defaultProfilePatch(profile)
  if (!existsSync(patchPath)) {
    fatal(`profile patch not found: ${patchPath} (create the profile first)`)
    return 1
  }
  const original = readFileSync(patchPath, 'utf8')
  const updated = applyManagedBlock(original, command === 'enable' ? 'insert' : 'remove')
  if (updated === original) {
    report(`${command}: no changes needed (${patchPath})`)
    return 0
  }
  if (flags['dry-run']) {
    report(`dry-run: would update ${patchPath}`)
    const before = original.split('\n')
    const after = updated.split('\n')
    for (const line of after.filter((line) => !before.includes(line))) report('  + ' + line)
    return 0
  }
  if (command === 'enable' && !flags.yes) {
    report('reminder: migrations run against a stopped dsh; run `migrate --apply` first unless you accept an empty conversation list under the new backend.')
    report('pass --yes to skip this reminder check.')
    return 1
  }
  mkdirSync(resolve(patchPath, '..'), { recursive: true })
  writeFileSync(patchPath, updated)
  report(`${command}: wrote ${patchPath} (takes effect after restarting dsh)`)
  return 0
}

/** Print/migrate summary unit shared by dry-run and --apply runs. */
function summarizeResults(results, { includeEmpty }) {
  const imported = results.filter((r) => r.status === 'imported')
  const skippedExisting = results.filter((r) => r.status === 'skipped-existing')
  const skippedEmpty = results.filter((r) => r.status === 'skipped-empty')
  const failed = results.filter((r) => r.status === 'failed')
  return {
    totalScanned: results.length,
    imported: imported.length,
    skippedExisting: skippedExisting.length,
    skippedEmpty: skippedEmpty.length,
    failed: failed.length,
    details: results.map(({ sessionId, projectKey, status, events, dropped, torn, error }) => ({ sessionId, projectKey, status, events, dropped, torn, error })),
    includeEmpty: includeEmpty === true,
  }
}

async function commandMigrate(flags) {
  const sessionsDir = flags['sessions-dir'] ? resolve(String(flags['sessions-dir'])) : defaultSessionsDir()
  const dbPath = flags.db ? resolve(String(flags.db)) : defaultDbPath()
  const projectFilter = flags.project ? String(flags.project) : undefined
  const limit = flags.limit ? Math.max(1, Number(flags.limit)) : Infinity
  const includeEmpty = flags['include-empty'] === true

  const sessions = discoverLegacySessions(sessionsDir).filter((s) => !projectFilter || s.projectKey === projectFilter || s.projectKey.includes(projectFilter))
  const results = []

  let db = null
  if (flags.apply) {
    backupStore(dbPath, flags)
    // Fail before doing work if the target cannot serve.
    db = openStore(dbPath, { createStore: flags['create-store'] === true })
  }

  const seenIds = new Map()
  for (const session of sessions.slice(0, limit === Infinity ? undefined : limit)) {
    const base = { sessionId: session.sessionId, projectKey: session.projectKey }
    if (session.encodingMismatch) {
      results.push({ ...base, status: 'failed', error: 'both session.jsonl and session.jsonl.zstd present (encoding mismatch)' })
      continue
    }
    let parsed
    try {
      parsed = parseSessionLog(readFileSync(session.logPath))
    } catch (error) {
      results.push({ ...base, status: 'failed', error: `decode failed: ${error.message}` })
      continue
    }
    const previous = seenIds.get(parsed.header.id)
    if (previous !== undefined && previous !== session.dir) {
      results.push({ ...base, status: 'failed', error: `duplicate legacy session id ${parsed.header.id} also found at ${previous}` })
      continue
    }
    seenIds.set(parsed.header.id, session.dir)

    const projection = projectPersistedEvents(parsed.events)
    if (projection.rows.length === 0 && !includeEmpty) {
      results.push({ ...base, status: 'skipped-empty', events: 0, dropped: projection.droppedCount, torn: parsed.tornTail })
      continue
    }

    if (!flags.apply) {
      results.push({ ...base, status: 'would-import', events: projection.rows.length, dropped: projection.droppedCount, torn: parsed.tornTail })
      continue
    }

    try {
      const outcome = insertSession(db, parsed.header, projection)
      results.push({ ...base, status: outcome.inserted ? 'imported' : 'skipped-existing', events: projection.rows.length, dropped: projection.droppedCount, torn: parsed.tornTail })
    } catch (error) {
      results.push({ ...base, status: 'failed', error: error.message })
    }
  }

  const summary = summarizeResults(results, { includeEmpty })
  if (flags.json) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    for (const item of results) {
      const tail = [item.events !== undefined ? `${item.events} evts` : '', item.dropped !== undefined ? `${item.dropped} dropped` : '', item.torn ? 'TORN TAIL' : '', item.error ? `ERROR ${item.error}` : ''].filter(Boolean).join(', ')
      report(`${item.status.padEnd(17)} ${item.projectKey}/${item.sessionId}${tail ? ` (${tail})` : ''}`)
    }
    report(summary.totalScanned === 0 ? 'no legacy sessions matched' : `scanned ${summary.totalScanned}: would-import/imported ${summary.imported}, skipped-existing ${summary.skippedExisting}, skipped-empty ${summary.skippedEmpty}, failed ${summary.failed}`)
  }

  if (!flags.apply) {
    if (!flags.json) report('dry-run: nothing written. Pass --apply (with dsh stopped) to migrate into ' + dbPath)
    db?.close()
    return summary.failed > 0 ? 1 : 0
  }
  // Ensure WAL side files land durably beside the migrated rows.
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  db.close()
  return summary.failed > 0 ? 1 : 0
}

/**
 * Copy the sqlite store (plus WAL side files) into the DSH home backups tree
 * before any --apply write. Returns the backup directory, or null when there
 * is nothing to back up.
 */
export function backupStore(dbPath, flags) {
  if (flags['no-backup'] === true || !existsSync(dbPath)) return null
  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
  const backupDir = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'backups', `better-session-migrate-${stamp}`)
  mkdirSync(backupDir, { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) {
    const source = dbPath + suffix
    if (existsSync(source)) copyFileSync(source, join(backupDir, 'sessions.sqlite' + suffix))
  }
  report(`backed up store to ${backupDir} (skip with --no-backup)`)
  return backupDir
}

/** Insert one projected session transactionally; returns whether a row was materialized. */
export function insertSession(db, header, projection) {
  if (db.prepare('SELECT 1 FROM t_sessions WHERE f_session_id = ?').get(header.id)) {
    return { inserted: false }
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(`INSERT INTO t_sessions
        (f_session_id, f_version, f_created_at, f_cwd, f_parent_session, f_seed_length, f_origin, f_delegation_depth, f_incarnation, f_revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`).run(
      String(header.id),
      SESSION_FORMAT_VERSION,
      Number(header.createdAt ?? 0),
      header.cwd != null ? String(header.cwd) : null,
      header.parentSession != null ? String(header.parentSession) : null,
      header.seedLength != null ? Number(header.seedLength) : null,
      header.origin != null ? String(header.origin) : null,
      header.delegationDepth != null ? Number(header.delegationDepth) : null,
      randomUUID(),
    )
    let parentId = ''
    let sequence = 0
    for (const row of projection.rows) {
      db.prepare(`INSERT INTO t_events
          (f_event_id, f_parent_id, f_kind, f_role, f_name, f_action_id, f_encoding, f_data, f_created_at, f_original_seq, f_source_event_seqs, f_surface_op)
          VALUES (?, ?, ?, ?, ?, ?, 'json', ?, ?, ?, ?, ?)`).run(
        row.eventId, parentId, row.kind, row.role, row.name, row.actionId, row.data, row.createdAt, row.originalSeq, row.sourceEventSeqs, row.surfaceOp,
      )
      db.prepare('INSERT INTO t_session_events (f_session_id, f_event_id, f_sequence) VALUES (?, ?, ?)').run(String(header.id), row.eventId, sequence)
      parentId = row.eventId
      sequence++
    }
    if (projection.rows.length > 0) {
      db.prepare('UPDATE t_sessions SET f_head_event_id = ?, f_head_sequence = ?, f_revision = f_revision + 1 WHERE f_session_id = ?').run(
        parentId, sequence - 1, String(header.id),
      )
    }
    db.exec('COMMIT')
    return { inserted: true }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function commandStatus(flags) {
  const sessionsDir = flags['sessions-dir'] ? resolve(String(flags['sessions-dir'])) : defaultSessionsDir()
  const dbPath = flags.db ? resolve(String(flags.db)) : defaultDbPath()
  const profile = flags.profile ?? 'web'
  const repoPatchPath = resolve(import.meta.dirname ?? '.', '..', 'packages', 'dsh-web-all', 'cordis.patch.yml')
  const mount = describeMountState(repoPatchPath, defaultProfilePatch(profile))
  const store = describeStore(dbPath)
  const byProject = new Map()
  for (const session of discoverLegacySessions(sessionsDir)) {
    const bucket = byProject.get(session.projectKey) ?? { sessions: 0, bytes: 0 }
    bucket.sessions++
    bucket.bytes += session.sizeBytes
    byProject.set(session.projectKey, bucket)
  }
  const payload = {
    mountState: mount.state,
    profileEnabledBlock: mount.profileEnabled,
    repoRowsOverridden: mount.repoOverridden,
    legacyRoot: sessionsDir,
    legacyProjects: Object.fromEntries([...byProject.entries()].sort(([a], [b]) => a.localeCompare(b))),
    legacyTotalSessions: [...byProject.values()].reduce((sum, b) => sum + b.sessions, 0),
    store,
  }
  if (flags.json) {
    console.log(JSON.stringify(payload, null, 2))
    return 0
  }
  report(`opt-in state: ${payload.mountState} (repo overrides ${mount.repoOverridden ? 'present' : 'MISSING'}, profile ${profile} block ${mount.profileEnabled ? 'present' : 'absent'})`)
  report(`legacy store ${sessionsDir}: ${payload.legacyTotalSessions} session(s) across ${byProject.size} project(s)`)
  for (const [key, bucket] of [...byProject.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    report(`  ${key}: ${bucket.sessions} session(s), ${(bucket.bytes / 1024 / 1024).toFixed(1)} MB`)
  }
  if (store.exists) {
    report(`rdb store ${dbPath}: ${store.sessionIdUnique} session(s), ${store.events} event(s), ${store.bridges} bridge(s)`)
  } else {
    report(`rdb store ${dbPath}: absent (created the first time better-session runs enabled)`)
  }
  if (payload.mountState === 'inactive-by-default') {
    report('next steps: `migrate --apply` (dsh stopped) then `enable --yes`, restart dsh afterwards')
  }
  return 0
}

/* ── main ─────────────────────────────────────────────────────────────────── */

export async function main(argv) {
  const { command, flags } = (() => {
    try {
      return parseArgv(argv)
    } catch (error) {
      fatal(error.message)
      return { command: '', flags: {} }
    }
  })()
  switch (command) {
    case 'status':
      return commandStatus(flags)
    case 'migrate': {
      if (flags.apply && !flags.yes) {
        const walFresh = (() => {
          for (const suffix of ['', '-wal']) {
            const p = `${flags.db ? resolve(String(flags.db)) : defaultDbPath()}${suffix}`
            try {
              if (Date.now() - statSync(p).mtimeMs < 120_000) return true
            } catch { /* absent */ }
          }
          return false
        })()
        if (walFresh) {
          fatal('the sqlite store was modified within the last two minutes — stop dsh, then rerun with --apply --yes')
          return 1
        }
      }
      return await commandMigrate(flags)
    }
    case 'enable':
    case 'disable':
      return commandEnableDisable(command, flags)
    default:
      usage()
      return 0
  }
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const code = await main(process.argv.slice(2))
  process.exit(code)
}
