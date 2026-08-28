/**
 * The /m data channel: every allowlisted unary method must answer with the
 * transport envelope the phone's callUnary requires
 * ({ type: 'server-response', rpcId, result }) — regressions here surface as
 * a dead "加载中…" mobile surface.
 */
import { createServer, request as httpRequest } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { TypertGatewayFace, WorkspaceRegistryFace } from '../src/host-gateway.ts'
import { makeMobileApiRoutes } from '../src/mobile-api.ts'
import { assertWireArgs } from './wire-gateway.ts'

interface TestServer {
  port: number
  close: () => Promise<void>
}

const cookieName = 'dsh_pair'

/** A pairing service stub that recognizes every cookie value. */
const service = {
  config: { cookieName },
  hasDevice: () => true,
  touchDevice: () => true,
} as never

/** The resolved mobile composer preference (tests flip it per case). */
const mobileEnterToSend = () => true

/** Business results the gateway stub answers per namespace/method. */
const GATEWAY_RESULTS: Record<string, unknown> = {
  'agentPresets/list': { presets: [], authorable: false },
  'session/list': { items: [] },
  'session/create': { sessionId: 's-created' },
  'session/search': { items: [] },
  'session/prompt': { accepted: true },
  'session/modelCatalog': { default: { provider: 'fx', model: 'fx-1' }, routableProviders: ['fx'], groups: [], failures: [] },
  'session/selectModel': { ok: true },
  'session/rename': { ok: true },
  'session/cancel': { accepted: true },
  'directoryPicker/list': { path: '/tmp/x', home: '/tmp', crumbs: [], entries: [], truncated: false },
}

/**
 * A typertGateway stub returning business results (failures throw). Every
 * call is validated against the 0.1.2 descriptor wire layout first, so an
 * args-shape drift (the class of bug that broke session/list and
 * directoryPicker/list) fails here instead of going green.
 */
const gateway: TypertGatewayFace = {
  async stream(request) {
    assertWireArgs(request)
    return this.invoke(request) as AsyncIterable<unknown>
  },
  async invoke(request) {
    assertWireArgs(request)
    const key = request.namespace + '/' + request.method
    if (key in GATEWAY_RESULTS) return GATEWAY_RESULTS[key] as unknown
    if (key === 'session/follow') {
      return (async function* () {
        yield { type: 'snapshot', cursor: 5, records: [], hasMore: false }
      })()
    }
    throw new Error('unexpected gateway call ' + key)
  },
}

/** A workspace registry stub with no rows. */
const workspaceRegistry: WorkspaceRegistryFace = { list: () => [] }

async function serve(routes: WebRoute[]): Promise<TestServer> {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://x').pathname
    const exact = routes.find(r => r.kind === 'exact' && r.path === pathname)
    const route = exact ?? routes.find(r => r.kind === 'prefix' && pathname.startsWith(r.path))
    if (route === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    void route.handler(request, response)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined || error === null) resolve()
        else reject(error)
      })
    }),
  }
}

async function call(port: number, method: string): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const body = JSON.stringify({ type: 'client-request', rpcId: 'probe-1', method, payload: {} })
    const req = httpRequest({
      host: '127.0.0.1', port, path: `/m/api/${method}`, method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${cookieName}=device-1`, 'content-length': Buffer.byteLength(body) },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

async function callWithPayload(port: number, method: string, payload: unknown): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const body = JSON.stringify({ type: 'client-request', rpcId: 'probe-1', method, payload })
    const req = httpRequest({
      host: '127.0.0.1', port, path: '/m/api/' + method, method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieName + '=device-1', 'content-length': Buffer.byteLength(body) },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

async function callNoCookie(port: number, method: string): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const body = JSON.stringify({ type: 'client-request', rpcId: 'probe-1', method, payload: {} })
    const req = httpRequest({
      host: '127.0.0.1', port, path: `/m/api/${method}`, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

describe('mobile api envelope', () => {
  it('writes the unpaired SSE rejection as JSON with family headers', async () => {
    const server = await serve(makeMobileApiRoutes({ service, gateway, workspaceRegistry, mobileEnterToSend }))
    try {
      const result = await new Promise<{ status: number; body: string; headers: typeof import('node:http').IncomingHttpHeaders }>((resolve, reject) => {
        const req = httpRequest({ host: '127.0.0.1', port: server.port, path: '/m/api/events.mux', method: 'GET' }, (response) => {
          const chunks: Buffer[] = []
          response.on('data', chunk => { chunks.push(chunk as Buffer) })
          response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: response.headers }))
        })
        req.on('error', reject)
        req.end()
      })
      expect(result.status).toBe(403)
      expect(JSON.parse(result.body)).toEqual({
        ok: false,
        error: { code: 'unpaired', message: 'mobile session is not paired' },
      })
      expect(result.headers['content-type']).toBe('application/json; charset=utf-8')
      expect(result.headers['referrer-policy']).toBe('no-referrer')
    } finally {
      await server.close()
    }
  })

  it('wraps every allowlisted unary method in the server-response envelope', async () => {
    const server = await serve(makeMobileApiRoutes({ service, gateway, workspaceRegistry, mobileEnterToSend }))
    try {
      for (const method of [
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
      ]) {
        const { status, body } = await callWithPayload(server.port, method, method === 'session.history' ? { sessionId: 's-1' } : {})
        expect(status).toBe(200)
        const envelope = JSON.parse(body) as { type?: string; rpcId?: string; result?: { ok?: boolean } }
        expect(envelope.type, method).toBe('server-response')
        expect(envelope.rpcId, method).toBe('probe-1')
        expect(envelope.result?.ok, method).toBe(true)
      }
    } finally {
      await server.close()
    }
  })

  it('wraps a session.list error in the server-response envelope, not a bare rpc body', async () => {
    const failingGateway: TypertGatewayFace = {
      invoke: async (request) => {
        if (request.namespace === 'session' && request.method === 'list') {
          throw Object.assign(new Error('nope'), { code: 'forbidden' })
        }
        return gateway.invoke(request)
      },
    }
    const server = await serve(makeMobileApiRoutes({ service, gateway: failingGateway, mobileEnterToSend }))
    try {
      const { status, body } = await call(server.port, 'session.list')
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { type?: string; rpcId?: string; result?: { ok?: boolean; error?: unknown } }
      expect(envelope.type).toBe('server-response')
      expect(envelope.rpcId).toBe('probe-1')
      expect(envelope.result?.ok).toBe(false)
      expect(envelope.result?.error).toEqual({ code: 'forbidden', message: 'nope' })
    } finally {
      await server.close()
    }
  })

  it('answers mobile.preferences locally from the plugin config', async () => {
    let mobileEnterToSend = true
    const server = await serve(makeMobileApiRoutes({
      service,
      gateway,
      workspaceRegistry,
      mobileEnterToSend: () => mobileEnterToSend,
    }))
    try {
      const first = await call(server.port, 'mobile.preferences')
      expect(first.status).toBe(200)
      expect(JSON.parse(first.body)).toEqual({
        type: 'server-response',
        rpcId: 'probe-1',
        result: { ok: true, value: { mobileEnterToSend: true } },
      })

      mobileEnterToSend = false
      const second = await call(server.port, 'mobile.preferences')
      expect(second.status).toBe(200)
      expect(JSON.parse(second.body)).toEqual({
        type: 'server-response',
        rpcId: 'probe-1',
        result: { ok: true, value: { mobileEnterToSend: false } },
      })
    } finally {
      await server.close()
    }
  })

  it('heartbeat keep-alive reuses the single SSE connection (no new socket)', async () => {
    const blockingGateway = gateway
    const routes = makeMobileApiRoutes({ service, gateway: blockingGateway, mobileEnterToSend, eventsHeartbeatMs: 25 })
    let connections = 0
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://x').pathname
      const exact = routes.find(r => r.kind === 'exact' && r.path === pathname)
      const route = exact ?? routes.find(r => r.kind === 'prefix' && pathname.startsWith(r.path))
      if (route === undefined) {
        response.writeHead(404)
        response.end()
        return
      }
      void route.handler(request, response)
    })
    server.on('connection', () => { connections += 1 })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo

    let sseData = ''
    let resolveDone: (() => void) | undefined
    const done = new Promise<void>(resolve => { resolveDone = resolve })
    const req = httpRequest({
      host: '127.0.0.1', port: address.port, path: '/m/api/events.mux', method: 'GET',
      headers: { cookie: 'dsh_pair=device-1' },
    }, (response) => {
      response.on('data', (chunk) => {
        sseData += (chunk as Buffer).toString('utf8')
        // Two keep-alive pings prove the heartbeat is writing to this stream.
        if ((sseData.match(/: ping/g) ?? []).length >= 2) resolveDone?.()
      })
    })
    req.on('error', () => { resolveDone?.() })
    req.end()

    await done
    // The heartbeat wrote two pings onto the SAME open SSE connection; no
    // additional socket was opened for keep-alive (reuse of the single stream).
    expect((sseData.match(/: ping/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(connections).toBe(1)

    req.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('refreshes device presence on every gated unary request', async () => {
    // The mobile surface has no /api/pair/heartbeat sender, so any gated RPC
    // must count as presence (touchDevice) — otherwise an idle phone ages past
    // offlineAfterMs and the desktop panel reports it as disconnected while it
    // is still actively connected.
    const touchDevice = vi.fn(() => true)
    const spyService = { config: { cookieName }, hasDevice: () => true, touchDevice } as never
    const server = await serve(makeMobileApiRoutes({ service: spyService, gateway, workspaceRegistry, mobileEnterToSend }))
    try {
      const { status } = await call(server.port, 'session.list')
      expect(status).toBe(200)
      expect(touchDevice).toHaveBeenCalledWith('device-1')
    } finally {
      await server.close()
    }
  })

  it('refreshes device presence on every SSE keep-alive while the stream stays open', async () => {
    // The core scenario: an idle phone keeps its SSE stream open but sends no
    // RPC traffic. The keep-alive interval must keep calling touchDevice so the
    // device never ages past offlineAfterMs — without this the desktop panel
    // reports "disconnected" while the phone is still connected.
    const touchDevice = vi.fn(() => true)
    const spyService = { config: { cookieName }, hasDevice: () => true, touchDevice } as never
    const blockingGateway = gateway
    const routes = makeMobileApiRoutes({ service: spyService, gateway: blockingGateway, mobileEnterToSend, eventsHeartbeatMs: 20 })
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://x').pathname
      const exact = routes.find(r => r.kind === 'exact' && r.path === pathname)
      const route = exact ?? routes.find(r => r.kind === 'prefix' && pathname.startsWith(r.path))
      if (route === undefined) {
        response.writeHead(404)
        response.end()
        return
      }
      void route.handler(request, response)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo

    let resolveDone: (() => void) | undefined
    const done = new Promise<void>(resolve => { resolveDone = resolve })
    const req = httpRequest({
      host: '127.0.0.1', port: address.port, path: '/m/api/events.mux', method: 'GET',
      headers: { cookie: 'dsh_pair=device-1' },
    }, () => {})
    req.on('error', () => { resolveDone?.() })
    req.end()

    // Wait until the keep-alive interval has fired enough times (>= 2 touches).
    const deadline = Date.now() + 2000
    while (touchDevice.mock.calls.length < 2 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 10))
    }
    resolveDone?.()

    expect(touchDevice.mock.calls.length).toBeGreaterThanOrEqual(2)
    // Each keep-alive refreshes presence for the paired device cookie.
    for (const callArgs of touchDevice.mock.calls) {
      expect(callArgs[0]).toBe('device-1')
    }

    req.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('vetoes when touchDevice returns false despite a present cookie', async () => {
    // hasDevice may be true while touchDevice is false (e.g. the service was
    // stopped). The gate must still refuse and must not leak the request.
    const touchDevice = vi.fn(() => false)
    const spyService = { config: { cookieName }, hasDevice: () => true, touchDevice } as never
    const server = await serve(makeMobileApiRoutes({ service: spyService, gateway, workspaceRegistry, mobileEnterToSend }))
    try {
      const { status } = await call(server.port, 'session.list')
      expect(status).toBe(403)
      expect(touchDevice).toHaveBeenCalledWith('device-1')
    } finally {
      await server.close()
    }
  })

  it('does not refresh presence when the device cookie is absent', async () => {
    const touchDevice = vi.fn(() => true)
    const spyService = { config: { cookieName }, hasDevice: () => false, touchDevice } as never
    const server = await serve(makeMobileApiRoutes({ service: spyService, gateway, workspaceRegistry, mobileEnterToSend }))
    try {
      // A request without the pairing cookie must be vetoed and must not
      // touchDevice (there is no device id to refresh).
      const { status } = await callNoCookie(server.port, 'session.list')
      expect(status).toBe(403)
      expect(touchDevice).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })
})
describe('mobile api body failure contract (shared readBoundedJson)', () => {
  /** Raw POST at /m/api/: raw text payload or no payload at all. */
  async function rawPost(
    port: number,
    path: string,
    payload: string | undefined,
  ): Promise<{ status: number | null; body: string; error: string | null }> {
    return await new Promise((resolve) => {
      const headers: Record<string, string> = {
        cookie: cookieName + '=device-1',
        host: '127.0.0.1:' + String(port),
        connection: 'close',
      }
      if (payload !== undefined) {
        headers['content-type'] = 'application/json'
        headers['content-length'] = String(Buffer.byteLength(payload))
      }
      const req = httpRequest({ host: '127.0.0.1', port, path, method: 'POST', headers }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), error: null })
        })
      })
      req.on('error', (error: Error) => resolve({ status: null, body: '', error: error.message }))
      if (payload !== undefined) req.write(payload)
      req.end()
    })
  }

  it('answers 400 for an unparseable, empty or oversized body', async () => {
    const server = await serve(makeMobileApiRoutes({ service, gateway, workspaceRegistry, mobileEnterToSend }))
    try {
      // Unparseable and explicit empty (content-length 0) bodies answer the
      // full envelope; a body-less POST is a client-side transport nuance and
      // is not part of the reader contract.
      for (const payload of ['{not json', '']) {
        const outcome = await rawPost(server.port, '/m/api/mobile.preferences', payload)
        expect(outcome.error).toBeNull()
        expect(outcome.status).toBe(400)
        expect(JSON.parse(outcome.body)).toEqual({
          ok: false,
          error: { code: 'bad-request', message: 'invalid json body' },
        })
      }
      // Oversize: readBoundedJson throws while the body is still in flight,
      // so the strict reader keeps the socket-alive 400 contract (no destroy);
      // the response body may be cut by the connection teardown, only the
      // status is part of the contract.
      const oversize = await rawPost(
        server.port,
        '/m/api/mobile.preferences',
        JSON.stringify({ type: 'client-request', rpcId: 'p', payload: { blob: 'x'.repeat(70 * 1024) } }),
      )
      expect(oversize.error).toBeNull()
      expect(oversize.status).toBe(400)
    } finally {
      await server.close()
    }
  })
})

describe('mobile api 0.1.2 wire mapping', () => {
  /** A recorded gateway asserting exact wire args, answering per method. */
  function recordingGateway(results: Record<string, unknown>): {
    gateway: TypertGatewayFace
    calls: Array<{ namespace: string; method: string; args: Record<string, unknown> }>
  } {
    const calls: Array<{ namespace: string; method: string; args: Record<string, unknown> }> = []
    const gateway: TypertGatewayFace = {
      async stream(request) {
        assertWireArgs(request)
        calls.push({ namespace: request.namespace, method: request.method, args: request.args })
        if (request.namespace + '/' + request.method === 'session/follow') {
          const value = results['session/follow'] as unknown
          return (async function* () { yield value })()
        }
        throw new Error('unexpected stream call ' + request.namespace + '/' + request.method)
      },
      async invoke(request) {
        assertWireArgs(request)
        calls.push({ namespace: request.namespace, method: request.method, args: request.args })
        const key = request.namespace + '/' + request.method
        if (key in results) return results[key] as unknown
        throw new Error('unexpected gateway call ' + key)
      },
    }
    return { gateway, calls }
  }

  it('sends session/list on its _request wire and passes projections through', async () => {
    const { gateway, calls } = recordingGateway({
      'session/list': {
        items: [{
          sessionId: 's-1', running: false, updatedAt: 123, blank: false,
          projections: { asOfSeq: 9, values: { title: '改造移动端' } },
        }],
      },
    })
    const server = await serve(makeMobileApiRoutes({ service, gateway, workspaceRegistry, mobileEnterToSend }))
    try {
      const { status, body } = await call(server.port, 'session.list')
      expect(status).toBe(200)
      expect(calls).toEqual([{ namespace: 'session', method: 'list', args: { _request: {} } }])
      const envelope = JSON.parse(body) as { result?: { ok?: boolean; value?: { items?: Array<Record<string, unknown>> } } }
      expect(envelope.result?.ok).toBe(true)
      expect(envelope.result?.value?.items?.[0]?.projections).toEqual({ asOfSeq: 9, values: { title: '改造移动端' } })
    } finally {
      await server.close()
    }
  })

  it('sends directoryPicker/list the flat optional path', async () => {
    const { gateway, calls } = recordingGateway({
      'directoryPicker/list': { path: '/tmp/x', home: '/tmp', crumbs: [], entries: [], truncated: false },
    })
    const server = await serve(makeMobileApiRoutes({ service, gateway, workspaceRegistry, mobileEnterToSend }))
    try {
      const withPath = await callWithPayload(server.port, 'host.listDirectory', { path: '/tmp/x' })
      expect(withPath.status).toBe(200)
      expect(calls).toEqual([{ namespace: 'directoryPicker', method: 'list', args: { path: '/tmp/x' } }])
      const withoutPath = await callWithPayload(server.port, 'host.listDirectory', {})
      expect(withoutPath.status).toBe(200)
      expect(calls[1]).toEqual({ namespace: 'directoryPicker', method: 'list', args: {} })
    } finally {
      await server.close()
    }
  })

  it('maps the catalog default onto current for session.models', async () => {
    const { gateway, calls } = recordingGateway({
      'session/modelCatalog': { default: { provider: 'fx', model: 'fx-1' }, routableProviders: ['fx'], groups: [], failures: [] },
    })
    const server = await serve(makeMobileApiRoutes({ service, gateway, workspaceRegistry, mobileEnterToSend }))
    try {
      const { body } = await callWithPayload(server.port, 'session.models', { sessionId: 's-1' })
      expect(calls).toEqual([{ namespace: 'session', method: 'modelCatalog', args: {} }])
      const envelope = JSON.parse(body) as { result?: { ok?: boolean; value?: Record<string, unknown> } }
      expect(envelope.result?.ok).toBe(true)
      expect(envelope.result?.value?.current).toEqual({ provider: 'fx', model: 'fx-1' })
      expect(envelope.result?.value).not.toHaveProperty('default')
    } finally {
      await server.close()
    }
  })

  it('answers agentPreset.list with the real 0.1.2 roster (no fabricated hasDocument)', async () => {
    const { gateway, calls } = recordingGateway({
      'agentPresets/list': { presets: [{ id: 'a', trust: 'system' }], authorable: false },
    })
    const server = await serve(makeMobileApiRoutes({ service, gateway, workspaceRegistry, mobileEnterToSend }))
    try {
      const { body } = await callWithPayload(server.port, 'agentPreset.list', {})
      expect(calls).toEqual([{ namespace: 'agentPresets', method: 'list', args: {} }])
      const envelope = JSON.parse(body) as { result?: { ok?: boolean; value?: Record<string, unknown> } }
      expect(envelope.result?.value).toEqual({ presets: [{ id: 'a', trust: 'system' }], authorable: false })
    } finally {
      await server.close()
    }
  })

  it('answers mobile.respond with the controlled unavailable envelope', async () => {
    const server = await serve(makeMobileApiRoutes({ service, gateway, workspaceRegistry, mobileEnterToSend }))
    try {
      const { status, body } = await callWithPayload(server.port, 'mobile.respond', {
        sessionId: 's-1', type: 'approval', approvalId: 'a-1', outcome: 'allowed-once',
      })
      expect(status).toBe(200)
      expect(JSON.parse(body)).toEqual({
        type: 'server-response',
        rpcId: 'probe-1',
        result: { ok: false, error: { code: 'unavailable', message: 'respond is unavailable on this host build' } },
      })
    } finally {
      await server.close()
    }
  })

  it('maps a TypertRemoteFailure business failure through its structured code', async () => {
    const failingGateway: TypertGatewayFace = {
      invoke: async (request) => {
        assertWireArgs(request)
        if (request.namespace === 'session' && request.method === 'list') {
          // TypertRemoteFailure shape: the structured payload rides .failure;
          // the error itself carries no .code.
          throw Object.assign(new Error('session "s-1" not found'), {
            failure: { code: 'session-not-found', message: 'session "s-1" not found', details: {} },
          })
        }
        return gateway.invoke(request)
      },
    }
    const server = await serve(makeMobileApiRoutes({ service, gateway: failingGateway, mobileEnterToSend }))
    try {
      const { body } = await call(server.port, 'session.list')
      const envelope = JSON.parse(body) as { result?: { ok?: boolean; error?: unknown } }
      expect(envelope.result?.ok).toBe(false)
      expect(envelope.result?.error).toEqual({ code: 'session-not-found', message: 'session "s-1" not found' })
    } finally {
      await server.close()
    }
  })

  /** One fake log event. */
  interface FakeEvent { seq: number; type: string }

  /**
   * A message-aligned fake history host: real paginate semantics (windows
   * are cut on message counts and include every event in the slice) with an
   * optional per-page record cap, so a conforming small-page host can drive
   * the backward loop through several differing pages.
   */
  function historyGateway(events: FakeEvent[], options: { projections?: unknown; pageCap?: number } = {}): TypertGatewayFace {
    const messageAligned = (beforeSeq: number | undefined, maxMessages: number, throughSeq: number): { records: unknown[]; hasMore: boolean } => {
      const end = Math.min(throughSeq + 1, beforeSeq ?? throughSeq + 1)
      let count = 0
      let cut = 0
      for (let index = end - 1; index >= 0; index--) {
        const event = events[index]
        if (event === undefined || (event.type !== 'user/message' && event.type !== 'assistant/message')) continue
        count += 1
        if (count >= maxMessages) {
          cut = event.seq
          break
        }
      }
      let slice = events.slice(cut, end)
      if (options.pageCap !== undefined && slice.length > options.pageCap) slice = slice.slice(-options.pageCap)
      return { records: slice.map(event => ({ type: 'event', event })), hasMore: cut > 0 }
    }
    return {
      async stream(request) {
        assertWireArgs(request)
        const req = (request.args as { request: { maxMessages?: number } }).request
        const cursor = events.at(-1)?.seq ?? -1
        const opening = messageAligned(undefined, req.maxMessages ?? 1, cursor)
        return (async function* () {
          yield {
            type: 'snapshot',
            cursor,
            records: opening.records,
            hasMore: opening.hasMore,
            ...(options.projections === undefined ? {} : { projections: options.projections }),
          }
        })()
      },
      async invoke(request) {
        assertWireArgs(request)
        const req = (request.args as { request: { throughSeq: number; beforeSeq?: number; maxMessages?: number } }).request
        return messageAligned(req.beforeSeq, req.maxMessages ?? 1, req.throughSeq)
      },
    }
  }

  const seqsOf = (page: { events?: Array<{ event: { seq: number } }> }): number[] => (page.events ?? []).map(entry => entry.event.seq)

  it('pages sessionHistory backward by advancing beforeSeq when pages run short', async () => {
    // 12 message events; a 3-record page cap forces several differing pages.
    const events = Array.from({ length: 12 }, (_, seq) => ({ seq, type: 'user/message' }))
    const gateway = historyGateway(events, { pageCap: 3 })
    const server = await serve(makeMobileApiRoutes({ service, gateway, workspaceRegistry, mobileEnterToSend }))
    try {
      const { body } = await callWithPayload(server.port, 'session.history', { sessionId: 's-1', maxMessages: 8 })
      const envelope = JSON.parse(body) as { result?: { ok?: boolean; value?: { events: Array<{ event: { seq: number } }>; hasMore: boolean } } }
      expect(envelope.result?.ok).toBe(true)
      const seqs = seqsOf(envelope.result?.value ?? {})
      // Ascending and deduped, covering records well past the first page
      // window (the loop must advance beforeSeq to reach them).
      expect(seqs).toEqual([4, 5, 6, 7, 8, 9, 10, 11])
      expect(new Set(seqs).size).toBe(seqs.length)
      expect(envelope.result?.value?.hasMore).toBe(false)
    } finally {
      await server.close()
    }
  })

  it('keeps a short log ascending and never surfaces the opening newest record out of order', async () => {
    const events = [
      { seq: 0, type: 'user/message' },
      { seq: 1, type: 'user/message' },
      { seq: 2, type: 'user/message' },
    ]
    const projections = {
      asOfSeq: 2,
      values: { permissions: { options: [{ id: 'default', name: 'Default' }], currentValue: 'default' } },
    }
    const gateway = historyGateway(events, { projections })
    const server = await serve(makeMobileApiRoutes({ service, gateway, workspaceRegistry, mobileEnterToSend }))
    try {
      const { body } = await callWithPayload(server.port, 'session.history', { sessionId: 's-1' })
      const envelope = JSON.parse(body) as { result?: { ok?: boolean; value?: { events: Array<{ event: { seq: number } }>; hasMore: boolean; projections?: unknown } } }
      expect(envelope.result?.ok).toBe(true)
      const seqs = seqsOf(envelope.result?.value ?? {})
      // The follow(maxMessages:1) opening record (seq 2) must not resurface
      // at events[0] or duplicate the newest page record.
      expect(seqs).toEqual([0, 1, 2])
      expect(new Set(seqs).size).toBe(seqs.length)
      expect(envelope.result?.value?.projections).toEqual(projections)
      expect(envelope.result?.value?.hasMore).toBe(false)
    } finally {
      await server.close()
    }
  })

  it('honors an explicit beforeSeq as the exclusive upper bound (load older)', async () => {
    const events = Array.from({ length: 10 }, (_, seq) => ({ seq, type: 'user/message' }))
    const gateway = historyGateway(events)
    const server = await serve(makeMobileApiRoutes({ service, gateway, workspaceRegistry, mobileEnterToSend }))
    try {
      const { body } = await callWithPayload(server.port, 'session.history', { sessionId: 's-1', beforeSeq: 6, maxMessages: 3 })
      const envelope = JSON.parse(body) as { result?: { ok?: boolean; value?: { events: Array<{ event: { seq: number } }>; hasMore: boolean } } }
      expect(envelope.result?.ok).toBe(true)
      const seqs = seqsOf(envelope.result?.value ?? {})
      // Strictly below the bound; the opening snapshot's newest record
      // (seq 9, at or above the bound) never leaks into the older window.
      expect(seqs).toEqual([3, 4, 5])
      expect(envelope.result?.value?.hasMore).toBe(true)
    } finally {
      await server.close()
    }
  })
})
