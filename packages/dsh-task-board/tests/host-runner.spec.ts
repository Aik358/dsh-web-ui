import { describe, expect, it, vi } from 'vitest'
import type { Workspace } from '@deepseek-ai/dsh-workspace/types'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import { HostExecutionRunner, SessionLaunchError } from '../src/host-runner.ts'

type GatewayRequest = {
  namespace: string
  method: string
  args: Record<string, unknown>
  signal?: AbortSignal
}

type FakeWorkspace = { id: string }

function workspaceRegistry(items: readonly FakeWorkspace[] = [{ id: 'workspace-a' }]) {
  return { list: vi.fn(() => items) } as unknown as { list(): readonly Workspace[] }
}

function sessionEvent(type: string, seq: number, time: number, data: unknown) {
  return { type: 'event' as const, event: { type, seq, time, data } }
}

function snapshot(records: readonly unknown[], cursor = Math.max(0, ...records.map(record => (record as { event?: { seq?: number } }).event?.seq ?? 0)), hasMore = false) {
  return { type: 'snapshot' as const, header: {}, cursor, records, hasMore, projections: {} }
}

function configuredTask(): TaskRecord {
  return {
    ...createTask({ title: 'Run me', description: '', prompt: 'do work' }, 1, 'task-a'),
    workspaceId: 'workspace-a',
    mode: 'preset-a',
    permission: 'workspace-write',
  }
}

describe('HostExecutionRunner', () => {
  it('validates and applies workspace, preset, and permission before the task prompt', async () => {
    const order: string[] = []
    const promptPayloads: unknown[] = []
    const commands = {
      execute: vi.fn(async (_sessionId: string, line: string) => {
        order.push('permission')
        expect(line).toBe('/permission workspace-write')
        return { kind: 'success' as const }
      }),
    }
    const gateway = {
      stream: vi.fn(async () => ({ async *[Symbol.asyncIterator]() { yield snapshot([], 0, false) } })),
      invoke: vi.fn(async (request: GatewayRequest) => {
        expect(request.args).toEqual(request.namespace === 'agentPresets' ? {} : expect.objectContaining({ request: expect.anything() }))
        if (request.namespace === 'agentPresets') {
          order.push('preset')
          return { presets: [{ id: 'preset-a', isDefault: false }] }
        }
        const payload = request.args.request as Record<string, unknown>
        if (request.method === 'create') {
          order.push('create')
          return { sessionId: 'session-a', agentPreset: payload.agentPreset }
        }
        if (request.method === 'rename') {
          order.push('rename')
          return { title: payload.title, seq: 1 }
        }
        if (request.method === 'prompt') {
          promptPayloads.push(payload)
          order.push('prompt')
          return { accepted: true }
        }
        throw new Error('unexpected gateway call')
      }),
    }
    await expect(new HostExecutionRunner(gateway, commands, workspaceRegistry()).launch(configuredTask())).resolves.toBe('session-a')
    expect(order).toEqual(['preset', 'create', 'rename', 'permission', 'prompt'])
    expect(gateway.invoke.mock.calls[1]?.[0].args).toEqual({ request: { workspaceId: 'workspace-a', agentPreset: 'preset-a' } })
    expect(promptPayloads).toEqual([{ sessionId: 'session-a', requestId: expect.any(String), mode: 'queue', content: [{ type: 'text', text: 'do work' }] }])
  })

  it('fails closed on a stale workspace or unacknowledged permission command', async () => {
    const create = vi.fn()
    const gateway = {
      stream: vi.fn(async () => ({ async *[Symbol.asyncIterator]() { yield snapshot([], 0, false) } })),
      invoke: vi.fn(async (request: GatewayRequest) => {
        if (request.method === 'create') return create()
        return { presets: [{ id: 'preset-a' }] }
      }),
    }
    await expect(new HostExecutionRunner(gateway, undefined, workspaceRegistry([])).launch(configuredTask())).rejects.toThrow('workspace not found')
    expect(create).not.toHaveBeenCalled()

    const prompt = vi.fn()
    const permissionRejected = {
      stream: vi.fn(async () => ({ async *[Symbol.asyncIterator]() { yield snapshot([], 0, false) } })),
      invoke: vi.fn(async (request: GatewayRequest) => {
        if (request.namespace === 'agentPresets') return { presets: [{ id: 'preset-a' }] }
        if (request.method === 'create') return { sessionId: 'session-a' }
        if (request.method === 'rename') return { title: 'Run me', seq: 1 }
        if (request.method === 'prompt') return prompt()
        throw new Error('unexpected gateway call')
      }),
    }
    const unavailable = new HostExecutionRunner(permissionRejected, undefined, workspaceRegistry()).launch(configuredTask())
    await expect(unavailable).rejects.toThrow('permission command dispatcher is unavailable')
    await expect(unavailable).rejects.toMatchObject({ sessionId: 'session-a' })
    expect(prompt).not.toHaveBeenCalled()

    const rejected = new HostExecutionRunner(permissionRejected, {
      execute: async () => undefined,
    }, workspaceRegistry()).launch(configuredTask())
    await expect(rejected).rejects.toBeInstanceOf(SessionLaunchError)
    await expect(rejected).rejects.toMatchObject({ sessionId: 'session-a' })
    expect(prompt).not.toHaveBeenCalled()
  })

  it('fails closed when the permission command reports an error', async () => {
    const prompt = vi.fn()
    const gateway = {
      stream: vi.fn(async () => ({ async *[Symbol.asyncIterator]() { yield snapshot([], 0, false) } })),
      invoke: vi.fn(async (request: GatewayRequest) => {
        if (request.namespace === 'agentPresets') return { presets: [{ id: 'preset-a' }] }
        if (request.method === 'create') return { sessionId: 'session-a' }
        if (request.method === 'rename') return { title: 'Run me', seq: 1 }
        if (request.method === 'prompt') return prompt()
        throw new Error('unexpected gateway call')
      }),
    }
    const launch = new HostExecutionRunner(gateway, {
      execute: async () => ({ kind: 'error', text: 'permission denied' }),
    }, workspaceRegistry()).launch(configuredTask())
    await expect(launch).rejects.toThrow('permission denied')
    expect(prompt).not.toHaveBeenCalled()
  })

  it('bounds permission dispatch and fails closed when the command throws', async () => {
    const timeoutSignal = new AbortController().signal
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal)
    try {
      const prompt = vi.fn()
      const execute = vi.fn(async (_sessionId: string, _line: string, signal: AbortSignal) => {
        expect(signal).toBe(timeoutSignal)
        throw new Error('permission command timed out')
      })
      const gateway = {
        stream: vi.fn(async () => ({ async *[Symbol.asyncIterator]() { yield snapshot([], 0, false) } })),
        invoke: vi.fn(async (request: GatewayRequest) => {
          if (request.namespace === 'agentPresets') return { presets: [{ id: 'preset-a' }] }
          if (request.method === 'create') return { sessionId: 'session-a' }
          if (request.method === 'rename') return { title: 'Run me', seq: 1 }
          if (request.method === 'prompt') return prompt()
          throw new Error('unexpected gateway call')
        }),
      }
      const launch = new HostExecutionRunner(gateway, { execute }, workspaceRegistry()).launch(configuredTask())
      await expect(launch).rejects.toMatchObject({
        name: 'SessionLaunchError',
        sessionId: 'session-a',
        message: expect.stringContaining('permission command timed out'),
      })
      expect(timeout).toHaveBeenCalledOnce()
      expect(timeout).toHaveBeenCalledWith(30_000)
      expect(prompt).not.toHaveBeenCalled()
    } finally {
      timeout.mockRestore()
    }
  })

  it('settles from session list plus the newest turn end and waits on read failures', async () => {
    let running = true
    let historyOk = true
    const gateway = {
      invoke: vi.fn(async (request: GatewayRequest) => {
        if (request.method === 'list') return { items: [{ sessionId: 'session-a', running }] }
        if (request.method === 'page') {
          if (!historyOk) throw new Error('offline')
          return { records: [sessionEvent('turn/end', 10, 1_100, { reason: { kind: 'error' } })], hasMore: false }
        }
        throw new Error('unexpected gateway call')
      }),
      stream: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() {
          yield snapshot([], 10, true)
        },
      })),
    }
    const runner = new HostExecutionRunner(gateway)
    await expect(runner.inspect('session-a')).resolves.toEqual({ outcome: 'pending' })
    running = false
    await expect(runner.inspect('session-a')).resolves.toEqual({ outcome: 'failed', error: 'agent turn ended with an error' })
    historyOk = false
    await expect(runner.inspect('session-a')).resolves.toEqual({ outcome: 'pending' })
  })

  it('pages backward to the execution turn and ignores later user turns in the same session', async () => {
    const page = vi.fn(async (request: GatewayRequest) => {
      const payload = request.args.request as { beforeSeq?: number }
      return payload.beforeSeq === undefined
        ? { records: [sessionEvent('turn/end', 300, 3_000, { reason: { kind: 'error' } })], hasMore: true }
        : { records: [sessionEvent('turn/end', 100, 1_100, { reason: { kind: 'complete' } }), sessionEvent('session/start', 90, 900, {})], hasMore: false }
    })
    const gateway = {
      invoke: vi.fn(async (request: GatewayRequest) => request.method === 'list'
        ? { items: [{ sessionId: 'session-a', running: false }] }
        : page(request)),
      stream: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() {
          yield snapshot([sessionEvent('user/message', 400, 4_000, {})], 400, true)
        },
      })),
    }
    await expect(new HostExecutionRunner(gateway).inspect('session-a', 1_000)).resolves.toEqual({ outcome: 'succeeded' })
    expect(page).toHaveBeenCalledTimes(2)
    expect((page.mock.calls[1]?.[0].args.request as { beforeSeq?: number }).beforeSeq).toBe(300)
  })

  it('carries the session list in listRunning and reuses it in inspect without another list RPC', async () => {
    const items = [{ sessionId: 'session-a', running: false }]
    const list = vi.fn(async () => ({ items }))
    const page = vi.fn(async () => ({ records: [sessionEvent('turn/end', 10, 1_100, { reason: { kind: 'complete' } })], hasMore: false }))
    const gateway = {
      invoke: vi.fn(async (request: GatewayRequest) => request.method === 'list' ? list() : page()),
      stream: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() {
          yield snapshot([], 10, true)
        },
      })),
    }
    const runner = new HostExecutionRunner(gateway)
    const running = await runner.listRunning()
    expect(running).toEqual({ known: true, count: 0, items })
    if (!running.known) throw new Error('expected known')
    await expect(runner.inspect('session-a', 1_000, running.items)).resolves.toEqual({ outcome: 'succeeded' })
    expect(list).toHaveBeenCalledOnce()
    expect(page).toHaveBeenCalledOnce()
  })

  it('probes the history head instead of re-scanning a wedged session whose newest seq is unchanged', async () => {
    let headSeq = 40
    const page = vi.fn(async (request: GatewayRequest) => ({
      records: [sessionEvent('assistant/message', headSeq, 4_000, {})],
      hasMore: false,
    }))
    const gateway = {
      invoke: vi.fn(async (request: GatewayRequest) => request.method === 'list' ? { items: [{ sessionId: 'session-a', running: false }] } : page(request)),
      stream: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() {
          yield snapshot([sessionEvent('assistant/message', headSeq, 4_000, {})], headSeq, false)
        },
      })),
    }
    const runner = new HostExecutionRunner(gateway)
    await expect(runner.inspect('session-a', 1_000)).resolves.toEqual({ outcome: 'pending' })
    const afterFirst = page.mock.calls.length
    expect(afterFirst).toBe(0)
    await expect(runner.inspect('session-a', 1_000)).resolves.toEqual({ outcome: 'pending' })
    expect(page.mock.calls.length).toBe(afterFirst)
    headSeq = 41
    await expect(runner.inspect('session-a', 1_000)).resolves.toEqual({ outcome: 'pending' })
    expect(page.mock.calls.length).toBe(afterFirst)
  })

  it('drops the scan memo once the execution settles or the session vanishes', async () => {
    let headSeq = 40
    let found = false
    const page = vi.fn(async (_request: GatewayRequest) => ({
      records: [found ? sessionEvent('turn/end', headSeq, 4_000, { reason: { kind: 'complete' } }) : sessionEvent('assistant/message', headSeq, 4_000, {})],
      hasMore: false,
    }))
    const gateway = {
      invoke: vi.fn(async (request: GatewayRequest) => request.method === 'list' ? { items: [{ sessionId: 'session-a', running: false }] } : page(request)),
      stream: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() {
          yield snapshot([sessionEvent('assistant/message', headSeq, 4_000, {})], headSeq, true)
        },
      })),
    }
    const runner = new HostExecutionRunner(gateway)
    await expect(runner.inspect('session-a', 1_000)).resolves.toEqual({ outcome: 'pending' })
    found = true
    headSeq = 41
    await expect(runner.inspect('session-a', 1_000)).resolves.toEqual({ outcome: 'succeeded' })
    const callsBefore = page.mock.calls.length
    gateway.invoke.mockImplementation(async (request: GatewayRequest) => request.method === 'list' ? { items: [] } : page(request))
    await expect(runner.inspect('session-a', 1_000)).resolves.toEqual({ outcome: 'cancelled', error: 'execution session no longer exists' })
    expect(page.mock.calls.length).toBe(callsBefore)
  })
})
