// 路由级同源守卫测试：/miku-pet/config 的 PUT/DELETE 必须通过 isLoopbackRequest
// （跨站 / 异源 / 非回环 socket 一律 403 且不落盘；同源 200 并写/删配置）。
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyImpl } from '../src/index.ts'

interface ReqLike extends EventEmitter {
  method: string
  url: string
  socket: { remoteAddress: string }
  headers: Record<string, string | undefined>
  destroy: () => void
}

let handler: (req: ReqLike, res: unknown) => Promise<void>
let tmpHome: string
let oldEnv: string | undefined

function makeCtx(): unknown {
  return {
    webServer: {
      register: (spec: { handler: (req: ReqLike, res: unknown) => Promise<void> }) => {
        handler = spec.handler
      },
    },
    effect: (cb: () => void) => cb(),
  }
}

function makeReq(opts: { method: string; remote: string; host: string; origin?: string; site?: string }): ReqLike {
  const req = new EventEmitter() as ReqLike
  req.method = opts.method
  req.url = '/miku-pet/config'
  req.socket = { remoteAddress: opts.remote }
  const headers: Record<string, string | undefined> = { host: opts.host }
  if (opts.origin !== undefined) headers.origin = opts.origin
  if (opts.site !== undefined) headers['sec-fetch-site'] = opts.site
  req.headers = headers
  req.destroy = () => {}
  return req
}

function makeRes(): { status: number; body: string } & Record<string, unknown> {
  const res = { status: 0, body: '' } as { status: number; body: string } & Record<string, unknown>
  res.writeHead = (status: number) => { res.status = status }
  res.end = (body: string) => { res.body = body }
  return res
}

function drive(req: ReqLike, res: unknown, body?: string): Promise<void> {
  const p = handler(req, res)
  if (body !== undefined) req.emit('data', Buffer.from(body))
  req.emit('end')
  return p
}

const configPath = (): string => join(tmpHome, 'miku-pet', 'main-config.json')
const validBody = JSON.stringify({
  pets: [{ id: 'main', size: 220, position: { corner: 'top-right', marginX: 20, marginY: 96 }, name: 'Miku' }],
})

beforeEach(() => {
  oldEnv = process.env.DSH_HOME
  tmpHome = mkdtempSync(join(tmpdir(), 'miku-fence-'))
  process.env.DSH_HOME = tmpHome
  applyImpl(makeCtx())
})

afterEach(() => {
  if (oldEnv === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldEnv
  rmSync(tmpHome, { recursive: true, force: true })
})

describe('/miku-pet/config request fence', () => {
  it('rejects cross-site PUT with 403 and does not write', async () => {
    const req = makeReq({ method: 'PUT', remote: '127.0.0.1', host: '127.0.0.1:3091', origin: 'http://evil.example', site: 'cross-site' })
    const res = makeRes()
    await drive(req, res, validBody)
    expect(res.status).toBe(403)
    expect(existsSync(configPath())).toBe(false)
  })

  it('rejects foreign-origin PUT with 403 and does not write', async () => {
    const req = makeReq({ method: 'PUT', remote: '127.0.0.1', host: '127.0.0.1:3091', origin: 'http://127.0.0.1:9999' })
    const res = makeRes()
    await drive(req, res, validBody)
    expect(res.status).toBe(403)
    expect(existsSync(configPath())).toBe(false)
  })

  it('rejects non-loopback socket PUT with 403', async () => {
    const req = makeReq({ method: 'PUT', remote: '192.168.1.5', host: '127.0.0.1:3091', site: 'same-origin' })
    const res = makeRes()
    await drive(req, res, validBody)
    expect(res.status).toBe(403)
  })

  it('accepts same-origin PUT and persists the sanitized config', async () => {
    const req = makeReq({ method: 'PUT', remote: '127.0.0.1', host: '127.0.0.1:3091', origin: 'http://127.0.0.1:3091', site: 'same-origin' })
    const res = makeRes()
    await drive(req, res, validBody)
    expect(res.status).toBe(200)
    const written = JSON.parse(readFileSync(configPath(), 'utf8')) as { pets: Array<Record<string, unknown>> }
    expect(written.pets[0]).toMatchObject({ id: 'main', name: 'Miku', size: 220 })
  })

  it('rejects cross-site DELETE with 403 and keeps the file', async () => {
    await mkdir(join(tmpHome, 'miku-pet'), { recursive: true })
    await writeFile(configPath(), '{"pets":[]}', 'utf8')
    const req = makeReq({ method: 'DELETE', remote: '127.0.0.1', host: '127.0.0.1:3091', origin: 'http://evil.example', site: 'cross-site' })
    const res = makeRes()
    await drive(req, res)
    expect(res.status).toBe(403)
    expect(existsSync(configPath())).toBe(true)
  })

  it('accepts same-origin DELETE and removes the config', async () => {
    await mkdir(join(tmpHome, 'miku-pet'), { recursive: true })
    await writeFile(configPath(), '{"pets":[]}', 'utf8')
    const req = makeReq({ method: 'DELETE', remote: '127.0.0.1', host: '127.0.0.1:3091', origin: 'http://127.0.0.1:3091', site: 'same-origin' })
    const res = makeRes()
    await drive(req, res)
    expect(res.status).toBe(200)
    expect(existsSync(configPath())).toBe(false)
  })
})