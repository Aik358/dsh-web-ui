/**
 * The mobile surface's data channel: `/m/api` proxies the host ApiProxy
 * service for the standalone phone page. The phone's RPC calls ride THIS
 * prefix instead of the connection plugin's `/api` — so the tunneled Host
 * never needs to enter the connection trust fence (a distributable plugin
 * cannot change that fence), and this plugin's own pairing gate is the
 * access control instead.
 *
 * Security model:
 * - Every request must carry a live paired-device cookie (the same gate
 *   semantic as the LAN fence), enforced before any host call.
 * - Only an explicit allowlist of methods is proxied ON THIS PREFIX. The
 *   allowlist constrains the /m/api proxy alone: the same paired-device
 *   cookie also passes the global api/gate, so a paired device is a
 *   full-control credential for the host /api surface outside the SDK's
 *   loopback-pinned privileged set (settings/credentials/agentPreset/host
 *   actions/llm.discoverModels). Pairing is full device trust.
 * - `session.list` is paged here (the host API returns everything; this
 *   layer slices stable pages) so the phone never transfers the whole list.
 * - The live mux stream is bridged over Server-Sent Events on the same
 *   prefix (one-directional push; answers to questions/approvals ride the
 *   unary channel), gated identically.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { TypertGatewayFace, WorkspaceRegistryFace } from './host-gateway.ts'
import { invokeGateway } from './host-gateway.ts'
import type { PendingTracker } from './mobile-pending.ts'
import type { PairingService } from './pairing.ts'
import { readBoundedJson, writeJson } from './http.ts'
import { readCookie } from './gate.ts'

/**
 * Methods the phone surface may call. Everything else is refused HERE — but
 * note the paired-device cookie also passes the global api/gate for the full
 * ApiProxy surface (gate.ts), so a paired phone is a full-control credential:
 * the allowlist only constrains this /m/api proxy, not the cookie's reach.
 * stop() revokes every device; the loopback panel can also revoke one
 * device at a time.
 */
const MOBILE_ALLOWLIST = new Set([
  'host.listDirectory',
  'workspace.create',
  'workspace.list',
  'agentPreset.list',
  'session.create',
  'session.list',
  'session.history',
  'session.search',
  'session.prompt',
  'session.models',
  'session.selectModel',
  'session.rename',
  'session.cancel',
])

/**
 * Locally answered display-preference method (the phone's read-only
 * surface preferences; never proxied to the host ApiProxy and never a
 * settings-domain write).
 */
const MOBILE_PREFERENCES_METHOD = 'mobile.preferences'
const MOBILE_PENDING_METHOD = 'mobile.pending'
const MOBILE_RESPOND_METHOD = 'mobile.respond'
/** Execute a slash command through the host command registry (#1125). */
const MOBILE_COMMAND_METHOD = 'mobile.command'

/** One session.list page (thin phones load incrementally). */
const SESSION_PAGE_SIZE = 20
/** SSE keep-alive ping cadence for the live mux stream (single connection). */
const DEFAULT_EVENTS_HEARTBEAT_MS = 15_000

/** Encode one list position as an opaque continuation cursor. */
function sessionListCursor(updatedAt: number, sessionId: string): string {
  return `${updatedAt}:${sessionId}`
}

/** Parse a cursor; malformed cursors mean "start over" (safe failure mode). */
function parseSessionListCursor(cursor: string): { updatedAt: number; sessionId: string } | undefined {
  const separator = cursor.indexOf(':')
  if (separator < 0) return undefined
  const updatedAt = Number(cursor.slice(0, separator))
  if (!Number.isFinite(updatedAt)) return undefined
  return { updatedAt, sessionId: cursor.slice(separator + 1) }
}

/** Whether a row comes strictly after the cursor position. */
function afterCursor(row: { updatedAt: number; sessionId: string }, position: { updatedAt: number; sessionId: string }): boolean {
  return row.updatedAt < position.updatedAt
    || (row.updatedAt === position.updatedAt && row.sessionId > position.sessionId)
}

/** Route-family dependencies. */
export interface MobileApiDeps {
  /** The pairing service (device gate + cookie name). */
  service: PairingService
  /** The typertGateway service (0.1.2 Remote dispatch; injected by the plugin). */
  gateway: TypertGatewayFace
  /** The workspace registry (host service backing workspace.list). */
  workspaceRegistry: WorkspaceRegistryFace
  /** The pending tracker. */
  pendingTracker: PendingTracker
  /** The resolved mobile composer preference (live per request). */
  mobileEnterToSend: () => boolean
  /** SSE keep-alive ping cadence for the mux stream (default 15000 ms; test seam). */
  eventsHeartbeatMs?: number
  /**
   * Optional command dispatcher for executing slash commands on the mobile
   * surface. When absent, `mobile.command` returns an error; the mobile UI
   * can still fall back to `session.prompt` (which sends the line to the
   * model, not the command registry).
   */
  commandDispatcher?: {
    execute(
      sessionId: string,
      line: string,
      signal: AbortSignal,
    ): Promise<{ ok: true; result: unknown } | { error: string }>
  }
}

/** Mobile API route paths. */
export const MOBILE_API_PATHS = {
  events: '/m/api/events.mux',
} as const

/** The mobile-api prefix (every other path under it is a method name). */
const MOBILE_API_PREFIX = '/m/api'
/** Method extraction: the prefix plus one slash. */
const MOBILE_API_METHOD_PREFIX = `${MOBILE_API_PREFIX}/`

/**
 * Build the mobile data-channel routes.
 * @param deps - pairing service, gateway, and workspace registry.
 * @returns the routes to register on webServer.
 */
export function makeMobileApiRoutes(deps: MobileApiDeps): WebRoute[] {
  const { service, gateway, workspaceRegistry, mobileEnterToSend } = deps
  const eventsHeartbeatMs = deps.eventsHeartbeatMs ?? DEFAULT_EVENTS_HEARTBEAT_MS

  /**
   * Refresh the paired device's presence and report whether it is live.
   * The mobile surface (unlike the desktop Web UI) has no `/api/pair/heartbeat`
   * sender, so any activity on the mobile channel — a gated RPC, or the live
   * SSE stream staying open — must count as presence. Without this, an
   * idle-but-connected phone ages past `offlineAfterMs` and the desktop panel
   * wrongly reports it as disconnected.
   */
  const touchDeviceFor = (req: IncomingMessage): boolean => {
    const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
    if (deviceId === undefined) return false
    return service.touchDevice(deviceId)
  }

  /** The phone gate: a live paired-device cookie, or nothing else proceeds. */
  const gateOk = (req: IncomingMessage): boolean => {
    return touchDeviceFor(req)
  }

  const handleMethod = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    if (!gateOk(req)) {
      writeJson(res, 403, { ok: false, error: { code: 'unpaired', message: 'mobile session is not paired' } })
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    if (!pathname.startsWith(MOBILE_API_METHOD_PREFIX)) {
      writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown mobile api path' } })
      return
    }
    const method = pathname.slice(MOBILE_API_METHOD_PREFIX.length)
    const local = method === MOBILE_PREFERENCES_METHOD 
      || method === MOBILE_PENDING_METHOD 
      || method === MOBILE_RESPOND_METHOD
      || method === MOBILE_COMMAND_METHOD
    if (!MOBILE_ALLOWLIST.has(method) && !local) {
      writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: `method ${method} is not exposed to the mobile surface` } })
      return
    }
    let envelope: unknown
    try {
      envelope = await readBoundedJson(req, 64 * 1024)
    } catch {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'invalid json body' } })
      return
    }
    const parsed = envelope as { rpcId?: unknown; payload?: unknown }
    const rpcId = typeof parsed?.rpcId === 'string' ? parsed.rpcId : ''
    if (rpcId === '') {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing rpcId' } })
      return
    }
    if (local) {
      if (method === MOBILE_PREFERENCES_METHOD) {
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: { mobileEnterToSend: mobileEnterToSend() } },
        })
      } else if (method === MOBILE_PENDING_METHOD) {
        const payload = parsed.payload as any
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: deps.pendingTracker.pending(payload?.sessionId) },
        })
      } else if (method === MOBILE_RESPOND_METHOD) {
        // The 0.1.2 question/approval waterfall rides forwarded gateway events
        // rather than the removed apiproxy respond channel; answering from the
        // phone returns a controlled unavailable until that bridge exists.
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: false, error: { code: 'unavailable', message: 'respond is unavailable on this host build' } },
        })
      } else if (method === MOBILE_COMMAND_METHOD) {
        const payload = parsed.payload as { sessionId?: string; line?: string } | undefined
        const sessionId = payload?.sessionId
        const line = payload?.line
        if (typeof sessionId !== 'string' || typeof line !== 'string') {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: 'missing sessionId or line' } },
          })
        } else if (deps.commandDispatcher === undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'unavailable', message: 'command dispatcher is not available' } },
          })
        } else {
          try {
            const abort = new AbortController()
            res.on('close', () => { if (!res.writableEnded) abort.abort() })
            const outcome = await deps.commandDispatcher.execute(sessionId, line, abort.signal)
            if ('error' in outcome) {
              writeJson(res, 200, {
                type: 'server-response',
                rpcId,
                result: { ok: false, error: { code: outcome.error, message: outcome.error } },
              })
            } else {
              writeJson(res, 200, {
                type: 'server-response',
                rpcId,
                result: { ok: true, value: { matched: true, result: outcome.result } },
              })
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            writeJson(res, 200, {
              type: 'server-response',
              rpcId,
              result: { ok: false, error: { code: 'internal', message } },
            })
          }
        }
      }
      return
    }
    try {
      // Cancel the host-side work when the phone goes away mid-call (the
      // response stream closing before we answer means nobody is listening).
      const abort = new AbortController()
      res.on('close', () => { if (!res.writableEnded) abort.abort() })
      const response = await dispatch(gateway, workspaceRegistry, method, parsed?.payload, rpcId, abort.signal)
      writeJson(res, 200, response)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      writeJson(res, 200, {
        type: 'server-response',
        rpcId,
        result: { ok: false, error: { code: 'internal', message } },
      })
    }
  }

  /** Bridge the host mux stream over SSE: one `data:` frame per mux frame. */
  const handleEvents = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET') {
      res.writeHead(405)
      res.end()
      return
    }
    if (!gateOk(req)) {
      writeJson(res, 403, {
        ok: false,
        error: { code: 'unpaired', message: 'mobile session is not paired' },
      })
      return
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const controller = new AbortController()
    let closed = false
    const heartbeat = setInterval(() => {
      if (closed) return
      // An open SSE stream proves the phone is still live even while the agent
      // idles (no RPC traffic), so refresh presence alongside the transport
      // keepalive — otherwise an idle phone drifts to "disconnected".
      touchDeviceFor(req)
      try {
        res.write(': ping\n\n')
      } catch {
        // The write failed; the close handler tears the subscription down.
      }
    }, eventsHeartbeatMs)
    const onClose = (): void => {
      if (closed) return
      closed = true
      controller.abort()
      clearInterval(heartbeat)
    }
    res.on('close', onClose)
    req.on('close', onClose)
    try {
      // The 0.1.2 cohort removed the apiproxy event mux this endpoint used to
      // bridge, so the stream carries keepalives only for now: the phone's
      // EventSource stays connected (no reconnect churn) and its polling
      // fallback keeps the open session live via /m/api/session.history.
      while (!closed) {
        await new Promise(resolve => setTimeout(resolve, eventsHeartbeatMs))
        if (closed) break
        touchDeviceFor(req)
        res.write(': ping\n\n')
      }
    } catch {
      // The stream ended or errored; the EventSource reconnects.
    } finally {
      controller.abort()
      clearInterval(heartbeat)
    }
    if (!closed) res.end()
  }

  return [
    { kind: 'prefix', path: MOBILE_API_PREFIX, handler: handleMethod },
    { kind: 'exact', path: MOBILE_API_PATHS.events, handler: handleEvents },
  ]
}

/**
 * Map one gateway business result onto the mobile wire shape for a method.
 * The Remote faces return direct business results; the phone's contract
 * keeps its own field names (sessionId vs the SDK's id), so list-shaped
 * results are re-keyed here.
 */
function mapListItems(value: unknown): Array<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { items?: unknown }).items)) return []
  return (value as { items: unknown[] }).items.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
}

/** Dispatch one allowlisted method through the typertGateway faces. */
async function dispatch(
  gateway: TypertGatewayFace,
  workspaceRegistry: WorkspaceRegistryFace,
  method: string,
  payload: unknown,
  rpcId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const body = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
  /** Business-result outcome -> the server-response envelope the phone's callUnary expects. */
  const respond = (outcome: Awaited<ReturnType<typeof invokeGateway>>): unknown => ({
    type: 'server-response' as const,
    rpcId,
    result: outcome.ok ? { ok: true, value: outcome.value } : { ok: false, error: outcome.error },
  })

  if (method === 'session.list') {
    // The Remote list is unpaged; this layer keeps slicing stable pages over
    // (updatedAt desc, sessionId asc) exactly as before, so thin phones never
    // transfer the whole list at once.
    const outcome = await invokeGateway(gateway, 'session', 'list', {}, signal)
    if (!outcome.ok) return { type: 'server-response' as const, rpcId, result: outcome }
    const items = mapListItems(outcome.value).map(item => ({
      sessionId: String(item.id ?? item.sessionId ?? ''),
      running: item.running === true,
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
      blank: item.blank === true,
      ...(typeof item.title === 'string' ? { title: item.title } : {}),
      ...(typeof item.displayTitle === 'string' ? { displayTitle: item.displayTitle } : {}),
      ...(typeof item.cwd === 'string' ? { cwd: item.cwd } : {}),
      ...(item.origin === 'subagent' ? { origin: 'subagent' as const } : {}),
    })) as Array<{ updatedAt: number; sessionId: string }>
    const cursor = (payload as { cursor?: string } | undefined)?.cursor
    items.sort((a, b) => b.updatedAt - a.updatedAt
      || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0))
    const position = cursor === undefined ? undefined : parseSessionListCursor(cursor)
    const from = position === undefined ? 0 : items.findIndex(row => afterCursor(row, position))
    const start = from < 0 ? items.length : from
    const page = items.slice(start, start + SESSION_PAGE_SIZE)
    const last = page[page.length - 1]
    const nextCursor = last !== undefined && start + page.length < items.length
      ? sessionListCursor(last.updatedAt, last.sessionId)
      : undefined
    return {
      type: 'server-response',
      rpcId,
      result: {
        ok: true,
        value: {
          items: page,
          hasMore: nextCursor !== undefined,
          ...(nextCursor !== undefined ? { nextCursor } : {}),
        },
      },
    }
  }
  if (method === 'workspace.list') {
    // The 0.1.2 Remote has no workspace list RPC; the workspaceRegistry host
    // service is the row source (the same fact source task-board validates
    // against).
    const items = workspaceRegistry.list().map(row => ({
      workspaceId: row.id,
      ...(row.title === undefined ? {} : { title: row.title }),
      ...(row.path === undefined ? {} : { path: row.path }),
      ...('sessionIds' in row && Array.isArray((row as { sessionIds?: unknown }).sessionIds)
        ? { sessionIds: (row as { sessionIds: string[] }).sessionIds }
        : {}),
    }))
    return { type: 'server-response', rpcId, result: { ok: true, value: { items } } }
  }
  if (method === 'workspace.create') {
    const outcome = await invokeGateway(gateway, 'workspace', 'create', { request: body }, signal)
    if (outcome.ok && typeof outcome.value === 'object' && outcome.value !== null) {
      const row = outcome.value as Record<string, unknown>
      const workspace = typeof row.workspace === 'object' && row.workspace !== null ? row.workspace : row
      return { type: 'server-response', rpcId, result: { ok: true, value: { workspace, created: true } } }
    }
    return respond(outcome)
  }
  if (method === 'host.listDirectory') return respond(await invokeGateway(gateway, 'directoryPicker', 'list', { request: body }, signal))
  if (method === 'agentPreset.list') {
    const outcome = await invokeGateway(gateway, 'agentPresets', 'list', {}, signal)
    if (!outcome.ok) return respond(outcome)
    const value = (typeof outcome.value === 'object' && outcome.value !== null ? outcome.value : {}) as Record<string, unknown>
    return {
      type: 'server-response',
      rpcId,
      result: { ok: true, value: { ...value, presets: value.presets ?? [], authorable: value.authorable ?? false, hasDocument: true } },
    }
  }
  if (method === 'session.create') return respond(await invokeGateway(gateway, 'session', 'create', { request: body }, signal))
  if (method === 'session.history') return respond(await sessionHistory(gateway, body, signal))
  if (method === 'session.search') return respond(await invokeGateway(gateway, 'session', 'search', { request: body }, signal))
  if (method === 'session.prompt') return respond(await invokeGateway(gateway, 'session', 'prompt', { request: body }, signal))
  if (method === 'session.models') {
    // The catalog is host-global in 0.1.2 (the sessionId argument is accepted
    // for wire compatibility and ignored).
    return respond(await invokeGateway(gateway, 'session', 'modelCatalog', {}, signal))
  }
  if (method === 'session.selectModel') return respond(await invokeGateway(gateway, 'session', 'selectModel', { request: body }, signal))
  if (method === 'session.rename') return respond(await invokeGateway(gateway, 'session', 'rename', { request: body }, signal))
  if (method === 'session.cancel') return respond(await invokeGateway(gateway, 'session', 'cancel', { request: body }, signal))
  throw new Error(`unhandled allowlisted method ${method}`)
}

/**
 * One bounded history window via the 0.1.2 read path: open session/follow to
 * take the opening snapshot's throughSeq, then page backward with
 * session/page (the dedicated history RPC no longer exists). Bounded by
 * maxMessages like the old tail page; hasMore mirrors the last page.
 */
async function sessionHistory(
  gateway: TypertGatewayFace,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ReturnType<typeof invokeGateway>> {
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  const maxMessages = typeof body.maxMessages === 'number' ? body.maxMessages : 30
  if (sessionId === '') {
    return { ok: false, error: { code: 'bad-request', message: 'session.history requires sessionId' } }
  }
  const address = { kind: 'session' as const, sessionId }
  let cursor: number | undefined
  let records: unknown[] = []
  let hasMore = false
  try {
    const stream = await gateway.stream?.({ namespace: 'session', method: 'follow', args: { request: { address, maxMessages: 1 } }, ...(signal === undefined ? {} : { signal }) })
    if (stream === undefined) return { ok: false, error: { code: 'unavailable', message: 'gateway stream is unavailable' } }
    const iterator = stream[Symbol.asyncIterator]()
    const next = await iterator.next()
    if (typeof iterator.return === 'function') await iterator.return()
    const opening = next.done === true ? undefined : next.value as { type?: string; cursor?: number; records?: unknown[]; hasMore?: boolean }
    if (opening === undefined || opening.type !== 'snapshot' || typeof opening.cursor !== 'number') {
      return { ok: false, error: { code: 'internal', message: 'session follow did not open with a snapshot' } }
    }
    cursor = opening.cursor
    records = [...(opening.records ?? [])]
    hasMore = opening.hasMore === true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: { code: 'internal', message } }
  }
  // Page backward until the window is full or the head is reached. The
  // opening window usually covers a short tail; the loop bounds at 10 pages.
  const beforeSeq = typeof body.beforeSeq === 'number' ? body.beforeSeq : undefined
  for (let page = 0; page < 10 && records.length < maxMessages && hasMore; page += 1) {
    const outcome = await invokeGateway(gateway, 'session', 'page', {
      request: {
        address,
        throughSeq: cursor,
        maxMessages,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
      },
    }, signal)
    if (!outcome.ok) return outcome
    const value = outcome.value as { records?: unknown[]; hasMore?: boolean } | null
    if (value === null || typeof value !== 'object' || !Array.isArray(value.records)) break
    // Newest-first pages; trim to the requested window once.
    records = [...records, ...value.records].slice(-maxMessages)
    hasMore = value.hasMore === true
  }
  const events = records.map(record => ({
    event: typeof record === 'object' && record !== null && 'event' in record
      ? (record as { event: unknown }).event
      : record,
  }))
  return {
    ok: true,
    value: {
      events,
      hasMore,
    },
  }
}