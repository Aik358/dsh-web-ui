import { createServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import type { TypertGatewayFace } from '../src/host-gateway.ts'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { makePairedModelCatalogRoutes, PAIRED_MODEL_CATALOG_PATHS } from '../src/paired-model-catalog.ts'
import { assertWireArgs } from './wire-gateway.ts'

interface TestServer {
  port: number
  close: () => Promise<void>
}

interface Call {
  method: string
  payload: unknown
}

const cookieName = 'dsh_pair'

function provider(provider = 'acme'): Record<string, unknown> {
  return { provider, displayName: 'Acme', settingsNs: 'llm-pi-ai', settingsPath: ['providers', provider] }
}

function namespace(value: unknown, revision = 7): Record<string, unknown> {
  return { ns: 'llm-pi-ai', schema: {}, value, applies: 'live', secrets: [], revision }
}

interface GatewayOptions {
  providers?: unknown[]
  writable?: boolean
  namespace?: Record<string, unknown>
  discover?: unknown
  groups?: unknown[]
  failures?: unknown[]
  describeError?: string
  mutateError?: string
  modelsError?: string
  discoverError?: string
}

/**
 * A TypertRemoteFailure-shaped throw: the structured {code, message, details}
 * payload rides .failure and the error itself carries no .code (exactly the
 * 0.1.2 business-failure shape). The real host messages carry no
 * conflict/reject token, so the 409/422 mapping must ride the code.
 */
function remoteFailure(code: string): Error {
  const message = code === 'settings-conflict'
    ? 'settings namespace "llm-pi-ai" changed since it was read (expected revision 7, now 8)'
    : code === 'settings-rejected'
      ? 'the settings provider refused the write'
      : code
  return Object.assign(new Error(message), { failure: { code, message, details: {} } })
}

function makeGateway(options: GatewayOptions = {}): { gateway: TypertGatewayFace, calls: Call[] } {
  const calls: Call[] = []
  const result = (method: string, value: unknown, failure?: string) => async (args: Record<string, unknown>) => {
    calls.push({ method, payload: args })
    if (failure !== undefined) throw remoteFailure(failure)
    return value
  }
  const gateway: TypertGatewayFace = {
    invoke: async (request) => {
      assertWireArgs(request)
      const key = request.namespace + '/' + request.method
      const args = request.args as Record<string, unknown>
      switch (key) {
        case 'llm/listConfigurableProviders':
          return await result(key, options.providers ?? [provider()], options.describeError)(args)
        case 'llm/discoverModels':
          return await result(key, options.discover ?? [{ id: 'acme-1', name: 'Acme 1', contextWindow: 64_000, maxTokens: 8_000 }], options.discoverError)(args)
        case 'session/modelCatalog':
          return await result(key, { groups: options.groups ?? [{ id: 'acme', name: 'Acme', models: [{ id: 'installed', name: 'Installed' }] }], failures: options.failures ?? [] }, options.modelsError)(args)
        case 'settings/describe':
          return await result(key, { writable: options.writable ?? true, hasDocument: true, namespaces: [options.namespace ?? namespace({ providers: { acme: { models: [] } } })] }, options.describeError)(args)
        case 'settings/mutate':
          return await result(key, namespace({ providers: {} }, 8), options.mutateError)(args)
        default:
          throw new Error('unexpected gateway call ' + key)
      }
    },
  }
  return { gateway, calls }
}

async function serve(routes: WebRoute[]): Promise<TestServer> {
  const server: Server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://x').pathname
    const route = routes.find(candidate => candidate.kind === 'exact' && candidate.path === pathname)
    if (route === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    void route.handler(request, response)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise((resolve, reject) => server.close(error => error === undefined || error === null ? resolve() : reject(error))),
  }
}

async function call(port: number, path: string, options: { method?: string, body?: unknown, paired?: boolean, host?: string } = {}): Promise<{ status: number, body: unknown }> {
  const method = options.method ?? 'POST'
  const serialized = options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
  return await new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1', port, path, method,
      headers: {
        ...(options.host === undefined ? {} : { host: options.host }),
        ...(serialized === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(serialized) }),
        ...(options.paired === false ? {} : { cookie: `${cookieName}=device-1` }),
      },
    }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(chunk as Buffer))
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
    })
    req.on('error', reject)
    req.end(serialized)
  })
}

function makeRoutes(gateway: TypertGatewayFace, paired: { value: boolean } = { value: true }, fence: { lanAddresses?: string[], publicBaseUrl?: string } = {}): WebRoute[] {
  const service = { config: { cookieName }, touchDevice: () => paired.value, lanAddresses: fence.lanAddresses ?? [], publicBaseUrl: fence.publicBaseUrl } as never
  return makePairedModelCatalogRoutes({ service, gateway, lanAddresses: fence.lanAddresses ?? [] })
}

describe('paired model catalog API', () => {
  it('rejects an unpaired request before it parses the body or calls the host', async () => {
    const { gateway, calls } = makeGateway()
    const server = await serve(makeRoutes(gateway))
    try {
      const result = await call(server.port, PAIRED_MODEL_CATALOG_PATHS.discover, { paired: false, body: '{not-json' })
      expect(result.status).toBe(403)
      expect(result.body).toEqual({ error: 'paired model catalog requires a live paired device' })
      expect(calls).toEqual([])
    } finally { await server.close() }
  })

  it('refuses a request whose Host is not loopback or an advertised LAN literal, before any host call', async () => {
    const { gateway, calls } = makeGateway()
    const server = await serve(makeRoutes(gateway))
    try {
      const result = await call(server.port, PAIRED_MODEL_CATALOG_PATHS.catalog, { method: 'GET', host: 'attacker.example:9999' })
      expect(result.status).toBe(403)
      expect(result.body).toEqual({ error: 'paired model catalog is not reachable for this origin' })
      expect(calls).toEqual([])
    } finally { await server.close() }
  })

  it('accepts a paired request from an advertised LAN literal with the exact authority', async () => {
    const { gateway } = makeGateway()
    const server = await serve(makeRoutes(gateway, { value: true }, { lanAddresses: ['192.168.1.5'] }))
    try {
      const result = await call(server.port, PAIRED_MODEL_CATALOG_PATHS.catalog, { method: 'GET', host: '192.168.1.5:3456' })
      expect(result.status).toBe(200)
      expect(result.body).toEqual({ capability: 'paired-model-catalog', providers: [{ provider: 'acme', displayName: 'Acme' }] })
    } finally { await server.close() }
  })

  it('refuses to adopt when the provider is absent from the live catalog groups without a listed failure', async () => {
    const { gateway, calls } = makeGateway({ groups: [], namespace: namespace({ providers: { acme: {} } }) })
    const server = await serve(makeRoutes(gateway))
    try {
      const result = await call(server.port, PAIRED_MODEL_CATALOG_PATHS.upsert, { body: { provider: 'acme', model: { id: 'new' } } })
      expect(result.status).toBe(502)
      expect(calls.filter(call => call.method === 'settings/mutate')).toEqual([])
    } finally { await server.close() }
  })

  it('lists only writable pi-ai provider identities with the exact settings address', async () => {
    const { gateway } = makeGateway({ providers: [
      provider('good'),
      { ...provider('wrong-ns'), settingsNs: 'llm-other' },
      { ...provider('wrong-path'), settingsPath: ['providers', 'nested', 'wrong-path'] },
    ], namespace: namespace({ providers: { good: {} } }) })
    const server = await serve(makeRoutes(gateway))
    try {
      const result = await call(server.port, PAIRED_MODEL_CATALOG_PATHS.catalog, { method: 'GET' })
      expect(result.status).toBe(200)
      expect(result.body).toEqual({ capability: 'paired-model-catalog', providers: [{ provider: 'good', displayName: 'Acme' }] })
    } finally { await server.close() }
  })

  it('discovers with the fixed pi-ai namespace and provider only', async () => {
    const { gateway, calls } = makeGateway()
    const server = await serve(makeRoutes(gateway))
    try {
      const result = await call(server.port, PAIRED_MODEL_CATALOG_PATHS.discover, { body: { provider: ' acme ' } })
      expect(result.status).toBe(200)
      expect(calls.filter(call => call.method === 'llm/discoverModels')).toEqual([{ method: 'llm/discoverModels', payload: { settingsNs: 'llm-pi-ai', request: { provider: 'acme' } } }])
      expect(result.body).toEqual({ models: [{ id: 'acme-1', name: 'Acme 1', contextWindow: 64_000, maxTokens: 8_000 }] })
    } finally { await server.close() }
  })

  it('rejects out-of-contract provider and model values before calling the host', async () => {
    const { gateway, calls } = makeGateway()
    const server = await serve(makeRoutes(gateway))
    const invalid = [
      { provider: 'x'.repeat(161) },
      { provider: 'bad\nprovider' },
      { provider: 'acme', model: { id: 'bad\nmodel' } },
      { provider: 'acme', model: { id: 'm', contextWindow: 1.5 } },
      { provider: 'acme', model: { id: 'm', maxTokens: 0 } },
      { provider: 'acme', model: { id: 'm', reasoningEfforts: [] } },
      { provider: 'acme', model: { id: 'm', reasoningEfforts: ['high', 'low'] } },
    ]
    try {
      for (const body of invalid) {
        const result = await call(server.port, PAIRED_MODEL_CATALOG_PATHS.upsert, { body })
        expect(result.status, JSON.stringify(body)).toBe(400)
      }
      expect(calls).toEqual([])
    } finally { await server.close() }
  })

  it('updates an explicit models array without dropping fields or leaving modelOverrides beside it', async () => {
    const { gateway, calls } = makeGateway({ namespace: namespace({ providers: { acme: { models: [
      { id: 'keep', name: 'Keep', input: ['text'], compat: { preserved: true } },
      { id: 'change', name: 'Old', custom: 'kept' },
    ], modelOverrides: {} } } }) })
    const server = await serve(makeRoutes(gateway))
    try {
      const result = await call(server.port, PAIRED_MODEL_CATALOG_PATHS.upsert, { body: { provider: 'acme', model: { id: 'change', name: ' New ', contextWindow: 32_000, reasoningEfforts: ['off', 'low', 'high'] } } })
      expect(result.status).toBe(200)
      const mutation = calls.find(call => call.method === 'settings/mutate')
      expect(mutation).toEqual({ method: 'settings/mutate', payload: {
        ns: 'llm-pi-ai', expectedRevision: 7, ops: [{ op: 'set', path: ['providers', 'acme', 'models'], value: [
          { id: 'keep', name: 'Keep', input: ['text'], compat: { preserved: true } },
          { id: 'change', name: 'New', custom: 'kept', contextWindow: 32_000, reasoningEfforts: { off: null, low: 'low', high: 'high' } },
        ] }, { op: 'unset', path: ['providers', 'acme', 'modelOverrides'] }],
      } })
    } finally { await server.close() }
  })

  it('uses modelOverrides for an installed catalog model when the resolved model list is empty', async () => {
    const { gateway, calls } = makeGateway({ namespace: namespace({ providers: { acme: { models: [], modelOverrides: {} } } }) })
    const server = await serve(makeRoutes(gateway))
    try {
      const result = await call(server.port, PAIRED_MODEL_CATALOG_PATHS.upsert, { body: { provider: 'acme', model: { id: 'installed', maxTokens: 4096 } } })
      expect(result.status).toBe(200)
      expect(calls.find(call => call.method === 'settings/mutate')?.payload).toEqual({
        ns: 'llm-pi-ai', expectedRevision: 7, ops: [{ op: 'set', path: ['providers', 'acme', 'modelOverrides', 'installed'], value: { maxTokens: 4096 } }],
      })
    } finally { await server.close() }
  })

  it('preserves installed model override fields when updating an inherited catalog entry', async () => {
    const { gateway, calls } = makeGateway({ namespace: namespace({ providers: { acme: {
      models: [],
      modelOverrides: { installed: { maxTokens: 2048, custom: 'preserved' } },
    } } }) })
    const server = await serve(makeRoutes(gateway))
    try {
      const result = await call(server.port, PAIRED_MODEL_CATALOG_PATHS.upsert, { body: { provider: 'acme', model: { id: 'installed', maxTokens: 4096 } } })
      expect(result.status).toBe(200)
      expect(calls.find(call => call.method === 'settings/mutate')?.payload).toEqual({
        ns: 'llm-pi-ai', expectedRevision: 7, ops: [{
          op: 'set', path: ['providers', 'acme', 'modelOverrides', 'installed'], value: { maxTokens: 4096, custom: 'preserved' },
        }],
      })
    } finally { await server.close() }
  })

  it('materializes every live id and translates overrides before adding an unknown inherited model', async () => {
    const { gateway, calls } = makeGateway({ namespace: namespace({ providers: { acme: {
      models: [],
      modelOverrides: { 'existing-a': { maxTokens: 2048, custom: 'preserved' } },
    } } }), groups: [{ id: 'acme', name: 'Acme', models: [{ id: 'existing-a', name: 'A' }, { id: 'existing-b', name: 'B' }] }] })
    const server = await serve(makeRoutes(gateway))
    try {
      const result = await call(server.port, PAIRED_MODEL_CATALOG_PATHS.upsert, { body: { provider: 'acme', model: { id: 'new-model', name: 'New model' } } })
      expect(result.status).toBe(200)
      expect(calls.find(call => call.method === 'settings/mutate')?.payload).toEqual({
        ns: 'llm-pi-ai', expectedRevision: 7, ops: [
          { op: 'set', path: ['providers', 'acme', 'models'], value: [
            { id: 'existing-a', maxTokens: 2048, custom: 'preserved' },
            { id: 'existing-b' },
            { id: 'new-model', name: 'New model' },
          ] },
          { op: 'unset', path: ['providers', 'acme', 'modelOverrides'] },
        ],
      })
    } finally { await server.close() }
  })

  it('refuses a malformed entry in an explicit configured model list without mutating settings', async () => {
    const { gateway, calls } = makeGateway({ namespace: namespace({ providers: { acme: {
      models: [42, { id: 'valid' }],
      modelOverrides: {},
    } } }) })
    const server = await serve(makeRoutes(gateway))
    try {
      const result = await call(server.port, PAIRED_MODEL_CATALOG_PATHS.upsert, { body: { provider: 'acme', model: { id: 'new-model' } } })
      expect(result.status).toBe(502)
      expect(calls.filter(call => call.method === 'settings/mutate')).toEqual([])
    } finally { await server.close() }
  })

  it('refuses conflicting explicit models and non-empty modelOverrides without mutating settings', async () => {
    const { gateway, calls } = makeGateway({ namespace: namespace({ providers: { acme: {
      models: [{ id: 'valid', custom: 'preserved' }],
      modelOverrides: { valid: { maxTokens: 2048 } },
    } } }) })
    const server = await serve(makeRoutes(gateway))
    try {
      const result = await call(server.port, PAIRED_MODEL_CATALOG_PATHS.upsert, { body: { provider: 'acme', model: { id: 'valid', maxTokens: 4096 } } })
      expect(result.status).toBe(502)
      expect(calls.filter(call => call.method === 'settings/mutate')).toEqual([])
    } finally { await server.close() }
  })

  it('maps the structured TypertRemoteFailure codes onto 409/422/502 by code, not message', async () => {
    for (const [options, status] of [
      [{ mutateError: 'settings-conflict' }, 409],
      [{ mutateError: 'settings-rejected' }, 422],
      [{ modelsError: 'internal' }, 502],
      [{ discoverError: 'model-discovery-failed' }, 502],
    ] as const) {
      const { gateway } = makeGateway(options)
      const server = await serve(makeRoutes(gateway))
      try {
        const path = 'discoverError' in options ? PAIRED_MODEL_CATALOG_PATHS.discover : PAIRED_MODEL_CATALOG_PATHS.upsert
        const body = path === PAIRED_MODEL_CATALOG_PATHS.discover ? { provider: 'acme' } : { provider: 'acme', model: { id: 'new' } }
        const result = await call(server.port, path, { body })
        expect(result.status).toBe(status)
        expect(result.body).toEqual({ error: expect.any(String) })
        expect(JSON.stringify(result.body)).not.toContain('settingsNs')
      } finally { await server.close() }
    }
  })

  it('returns only public catalog data after mutation and revocation takes effect immediately', async () => {
    const paired = { value: true }
    const sensitiveFailure = 'adapter credential /private/keys/acme-token failed to authenticate'
    const { gateway } = makeGateway({ groups: [{ id: 'acme', name: 'Acme', models: [{ id: 'new', name: 'New' }] }], failures: [{ id: 'bad', name: 'Bad', message: sensitiveFailure }] })
    const server = await serve(makeRoutes(gateway, paired))
    try {
      const success = await call(server.port, PAIRED_MODEL_CATALOG_PATHS.upsert, { body: { provider: 'acme', model: { id: 'new' } } })
      expect(success.status).toBe(200)
      expect(success.body).toEqual({ groups: [{ id: 'acme', name: 'Acme', models: [{ id: 'new', name: 'New' }] }], failures: [{ id: 'bad', name: 'Bad', message: 'model catalog unavailable for provider bad' }] })
      expect(JSON.stringify(success.body)).not.toContain(sensitiveFailure)
      paired.value = false
      const revoked = await call(server.port, PAIRED_MODEL_CATALOG_PATHS.catalog, { method: 'GET' })
      expect(revoked.status).toBe(403)
    } finally { await server.close() }
  })
})
