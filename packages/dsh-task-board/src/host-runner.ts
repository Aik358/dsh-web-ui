import type { ApiProxy, RpcId } from '@deepseek-ai/dsh-host-apiproxy'
import type { CommandResult } from '@deepseek-ai/dsh-commands/types'
import type { TaskRecord } from './core/tasks.ts'

function request<T>(payload: T) {
  return { rpcId: `task-board-${crypto.randomUUID()}` as RpcId, payload }
}

function failure(error: { code: string; message: string }): Error {
  return new Error(`${error.code}: ${error.message}`)
}

/** One session-list row, extracted from the sessions.list RPC result. */
export type SessionSummary = Extract<
  Awaited<ReturnType<ApiProxy['sessions']['list']>>['result'],
  { ok: true }
>['value']['items'][number]

type ExecutionSessionId = Extract<
  Awaited<ReturnType<ApiProxy['sessions']['create']>>['result'],
  { ok: true }
>['value']['sessionId']

export interface SessionCommandDispatcher {
  execute(
    sessionId: ExecutionSessionId,
    line: string,
    signal: AbortSignal,
  ): Promise<CommandResult | undefined>
}

export type ExecutionInspection =
  | { outcome: 'pending' }
  | { outcome: 'succeeded' }
  | { outcome: 'failed'; error: string }
  | { outcome: 'cancelled'; error: string }

/** A post-create launch failure that still identifies the session to the ledger. */
export class SessionLaunchError extends Error {
  constructor(readonly sessionId: string, cause: unknown) {
    super(`execution session ${sessionId} failed during launch: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    this.name = 'SessionLaunchError'
  }
}

function isErrorTurnEnd(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false
  const reason = (data as { reason?: unknown }).reason
  return typeof reason === 'object' && reason !== null && (reason as { kind?: unknown }).kind === 'error'
}

export class HostExecutionRunner {
  constructor(
    private readonly api: ApiProxy,
    private readonly commands?: SessionCommandDispatcher,
  ) {}

  async launch(task: TaskRecord): Promise<string> {
    // A handover bundle overrides the legacy pin fields: the bundle is the
    // authoritative execution triplet for a continuation card (issue #5).
    const workspaceId = task.handover?.workspaceId ?? task.workspaceId
    const mode = task.handover?.mode ?? task.mode
    const permission = task.handover?.permission ?? task.permission
    if (workspaceId !== undefined) {
      const workspaces = await this.api.workspace.list(request({}))
      if (!workspaces.result.ok) throw failure(workspaces.result.error)
      if (!workspaces.result.value.items.some(item => item.workspaceId === workspaceId)) {
        throw new Error(`workspace not found: ${workspaceId}`)
      }
    }
    if (mode !== undefined) {
      const presets = await this.api.agentPresets.list(request({}))
      if (!presets.result.ok) throw failure(presets.result.error)
      const preset = presets.result.value.presets.find(item => item.id === mode)
      if (preset === undefined) throw new Error(`agent preset not found: ${mode}`)
      if (preset.broken !== undefined) throw new Error(`agent preset is unavailable: ${preset.broken}`)
    }
    const created = await this.api.sessions.create(request({
      ...(workspaceId === undefined ? {} : { workspaceId: workspaceId as never }),
      ...(mode === undefined ? {} : { agentPreset: mode }),
    }))
    if (!created.result.ok) throw failure(created.result.error)
    const sessionId = created.result.value.sessionId
    try {
      const renamed = await this.api.sessions.rename(request({ sessionId, title: task.title }))
      if (!renamed.result.ok) throw failure(renamed.result.error)
      if (permission !== undefined) {
        if (this.commands === undefined) throw new Error('permission command dispatcher is unavailable')
        const command = await this.commands.execute(sessionId, `/permission ${permission}`, AbortSignal.timeout(30_000))
        if (command === undefined) throw new Error('permission command was not acknowledged')
        if (command.kind !== 'success') throw new Error(command.text ?? 'permission command failed')
      }
      const prompt = await this.api.sessions.prompt(request({
        sessionId,
        mode: 'queue' as const,
        content: [{ type: 'text' as const, text: this.promptText(task) }],
      }))
      if (!prompt.result.ok) throw failure(prompt.result.error)
    } catch (error) {
      throw new SessionLaunchError(sessionId, error)
    }
    return sessionId
  }

  /** Prompt text with a handover preamble (bundle references) when the card carries a bundle. */
  private promptText(task: TaskRecord): string {
    const body = task.prompt !== '' ? task.prompt : task.title
    const handover = task.handover
    if (handover === undefined || handover.references.length === 0) return body
    const lines = handover.references.map(reference => `- ${reference}`).join('\n')
    return `交接包引用（来自任务看板续接卡片，冻结于 ${new Date(handover.bundledAt).toISOString()}）：\n${lines}\n\n${body}`
  }

  async listRunning(): Promise<{ known: true; count: number; items: SessionSummary[] } | { known: false }> {
    try {
      const response = await this.api.sessions.list(request({}))
      return response.result.ok
        ? { known: true, count: response.result.value.items.filter(item => item.running).length, items: response.result.value.items }
        : { known: false }
    } catch {
      return { known: false }
    }
  }

  /**
   * Resolve one execution's outcome. The caller may pass the session list it
   * already fetched this poll tick; otherwise inspect lists sessions itself.
   * Sharing the list keeps a poll with E open executions at one list RPC
   * instead of 1 + E.
   */
  async inspect(sessionId: string, startedAt = 0, sessions?: readonly SessionSummary[]): Promise<ExecutionInspection> {
    let items: readonly SessionSummary[]
    if (sessions !== undefined) {
      items = sessions
    } else {
      const response = await this.api.sessions.list(request({}))
      if (!response.result.ok) return { outcome: 'pending' }
      items = response.result.value.items
    }
    const summary = items.find(item => item.sessionId === sessionId)
    if (summary === undefined) return { outcome: 'cancelled', error: 'execution session no longer exists' }
    if (summary.running) return { outcome: 'pending' }
    const events: Array<{ event: { type: string; seq?: number; time?: number; data: unknown } }> = []
    let beforeSeq: number | undefined
    let reachedExecutionBoundary = false
    for (let page = 0; page < 100; page += 1) {
      const history = await this.api.sessions.history(request({
        sessionId: summary.sessionId,
        maxMessages: 100,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
      }))
      if (!history.result.ok) return { outcome: 'pending' }
      events.push(...history.result.value.events)
      const oldestTime = history.result.value.events.reduce<number | undefined>((oldest, entry) => {
        const time = entry.event.time
        return typeof time !== 'number' ? oldest : oldest === undefined ? time : Math.min(oldest, time)
      }, undefined)
      if (!history.result.value.hasMore || (oldestTime !== undefined && oldestTime <= startedAt)) {
        reachedExecutionBoundary = true
        break
      }
      const oldestSeq = history.result.value.events.reduce<number | undefined>((oldest, entry) => {
        const seq = entry.event.seq
        return typeof seq !== 'number' ? oldest : oldest === undefined ? seq : Math.min(oldest, seq)
      }, undefined)
      if (oldestSeq === undefined || oldestSeq === beforeSeq) return { outcome: 'pending' }
      beforeSeq = oldestSeq
    }
    if (!reachedExecutionBoundary) return { outcome: 'pending' }
    const turnEnd = events
      .filter(entry => entry.event.type === 'turn/end' && (
        startedAt <= 0 || (typeof entry.event.time === 'number' && entry.event.time >= startedAt)
      ))
      .sort((a, b) => (a.event.seq ?? Number.MAX_SAFE_INTEGER) - (b.event.seq ?? Number.MAX_SAFE_INTEGER))[0]
    if (turnEnd === undefined) return { outcome: 'pending' }
    return isErrorTurnEnd(turnEnd.event.data)
      ? { outcome: 'failed', error: 'agent turn ended with an error' }
      : { outcome: 'succeeded' }
  }
}
