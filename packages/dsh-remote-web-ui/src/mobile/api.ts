/**
 * Mobile-surface business API: the handful of host RPC methods the
 * simplified surface needs. The wire shapes below are the phone's OWN
 * contract — the /m/api BFF maps the 0.1.2 Remote faces onto them, so the
 * phone bundle stays decoupled from SDK-internal type churn.
 */
import { callUnary } from './rpc.ts'

/** One workspace row as the phone's workspace browser consumes it. */
export interface WorkspaceView {
  workspaceId: string
  title?: string
  path?: string
  /** Session ids owned by this workspace (drives the phone's owned filter). */
  sessionIds?: string[]
  /** ISO timestamp the workspace row was created (advisory metadata). */
  createdAt?: string
  /** ISO timestamp of the latest activity on the workspace (advisory). */
  updatedAt?: string
}

/** One agent preset choice in the New Session composer. */
export interface AgentPresetEntry {
  id: string
  name?: string
  description?: string
  broken?: string
  isDefault?: boolean
  trust?: string
}

/** One session-list row (updatedAt desc cursor paging rides this). */
export interface SessionSummary {
  sessionId: string
  running: boolean
  updatedAt: number
  title?: string
  displayTitle?: string
  cwd?: string
  blank: boolean
  origin?: 'subagent'
  /** Projection hints riding the row (values.title drives the list label). */
  projections?: { asOfSeq?: number; values?: Record<string, unknown> }
}

/** One history entry (message-aligned event as the phone folds it). */
export interface HistoryEntry {
  event: { type: string; seq: number; time: number; data: unknown }
}

/** Projection baseline riding the tail history page. */
export interface SessionProjectionsBlock {
  [key: string]: unknown
}

/** Reasoning-effort metadata one model advertises. */
export interface ModelReasoning {
  defaultEffort?: string
  efforts: ReadonlyArray<{ id: string; name: string; description?: string }>
}

/** Model catalog as the phone's model picker renders it. */
export interface SessionModels {
  /** The session's active selection (provider + model + effort). */
  current?: { provider: string; model: string; reasoningEffort?: string }
  default?: string
  /** Providers the session can switch to (advisory; present in newer hosts). */
  routable?: boolean
  groups: ReadonlyArray<{
    id: string
    name?: string
    models: ReadonlyArray<{
      id: string
      name?: string
      description?: string
      reasoning?: ModelReasoning
    }>
  }>
  failures?: ReadonlyArray<{ id: string; name: string; message: string }>
}

/** One session.list page. */
export interface SessionPage {
  items: SessionSummary[]
  /** Continuation cursor; undefined once the tail is reached. */
  nextCursor?: string
  hasMore: boolean
}

/** The session.create result (the id is the commit the caller navigates to). */
export interface CreatedSession {
  sessionId: string
  /** The composition the new session runs (echoed so the caller can label it). */
  agentPreset?: string
}

/** Agent presets available when composing a new session. */
export interface AgentPresetRoster {
  presets: readonly AgentPresetEntry[]
  authorable: boolean
}

/** One history page (already bounded to whole messages by the host). */
export interface HistoryPage {
  events: HistoryEntry[]
  hasMore: boolean
  /**
   * Projection baseline riding the tail page (permissions select etc.);
   * absent when the deployment mounts no projection registry.
   */
  projections?: SessionProjectionsBlock
}

/** Read-only display preferences the plugin answers locally on `/m/api`. */
export interface MobilePreferences {
  /** Plain Enter sends the drafted prompt (false: Enter inserts a newline). */
  mobileEnterToSend: boolean
}

/** The workspace roster (session ids come back per workspace). */
export async function listWorkspaces(): Promise<WorkspaceView[]> {
  const { items } = await callUnary<{ items: WorkspaceView[] }>('workspace.list', {})
  return items
}

/** Read-only mobile display preferences (answered by the plugin, not the host proxy). */
export async function fetchMobilePreferences(): Promise<MobilePreferences> {
  return await callUnary<MobilePreferences>('mobile.preferences', {})
}

/** One session.list page; omit the cursor for the first page. */
export async function listSessions(cursor?: string): Promise<SessionPage> {
  return await callUnary<SessionPage>('session.list', cursor === undefined ? {} : { cursor })
}

/** Read the available agent compositions for a new session. */
export async function listAgentPresets(): Promise<AgentPresetRoster> {
  return await callUnary<AgentPresetRoster>('agentPreset.list', {})
}

/**
 * Create a blank session (entity birth precedes the first message). Name a
 * workspace to attach it there, or a cwd; omitting both uses the host cwd.
 */
export async function createSession(
  options: { workspaceId?: string; cwd?: string; agentPreset?: string } = {},
): Promise<CreatedSession> {
  return await callUnary<CreatedSession>('session.create', options)
}

/** One history window; omit beforeSeq for the tail page, pass a signal to abort. */
export async function history(
  sessionId: string,
  beforeSeq?: number,
  maxMessages = 30,
  signal?: AbortSignal,
): Promise<HistoryPage> {
  return await callUnary<HistoryPage>('session.history', {
    sessionId,
    maxMessages,
    ...(beforeSeq !== undefined ? { beforeSeq } : {}),
  }, signal)
}

/** Send one text prompt (queued: the agent picks it up in order). */
export async function prompt(sessionId: string, text: string): Promise<void> {
  await callUnary<{ accepted: true }>('session.prompt', {
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text }],
  })
}

/** Send one slash command line (e.g. `/permission workspace-write`). */
export async function sendCommand(sessionId: string, line: string): Promise<unknown> {
  return await callUnary<unknown>('mobile.command', {
    sessionId,
    line,
  })
}

/**
 * Stop the session's active turn (the mobile stop button). Pending queued
 * work is preserved and resumes in FIFO order once cancellation settles.
 */
export async function cancelSession(sessionId: string): Promise<{ accepted: true }> {
  return await callUnary<{ accepted: true }>('session.cancel', { sessionId })
}

/** Fresh advisory model directory for one session (current + groups + failures). */
export async function models(sessionId: string): Promise<SessionModels> {
  return await callUnary<SessionModels>('session.models', { sessionId })
}

/** Select the complete model selection (provider/model/reasoning effort) for a session. */
export async function selectModel(
  sessionId: string,
  selection: { provider: string; model: string; reasoningEffort?: string },
): Promise<{ selected: { provider: string; model: string; reasoningEffort?: string } }> {
  return await callUnary<{ selected: { provider: string; model: string; reasoningEffort?: string } }>('session.selectModel', {
    sessionId,
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort !== undefined ? { reasoningEffort: selection.reasoningEffort } : {}),
  })
}

/* ── pending approvals / questions (#1025) ───────────────────────────── */

/** One pending tool approval awaiting the user's decision. */
export interface PendingApproval {
  approvalId: string
  toolName: string
  callId?: string
  reason?: string
}

/** One pending question item awaiting the user's answer. */
export interface PendingQuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options?: Array<{ label: string; description?: string }>
  multiSelect?: boolean
}

/** One pending question group envelope returned by the host. */
export interface PendingQuestionGroup {
  rpcId: string
  questions: PendingQuestionItem[]
}

/** The pending state for one session. */
export interface PendingState {
  approvals: PendingApproval[]
  questions: PendingQuestionGroup[]
}

/** Fetch pending approvals and questions for one session (polling fallback data source). */
export async function fetchPending(sessionId: string): Promise<PendingState> {
  return await callUnary<PendingState>('mobile.pending', { sessionId })
}

/** Submit an approval decision (allowed-once or rejected). */
export async function respondApproval(
  sessionId: string,
  approvalId: string,
  outcome: 'allowed-once' | 'rejected',
): Promise<void> {
  await callUnary<unknown>('mobile.respond', {
    sessionId,
    type: 'approval',
    approvalId,
    outcome,
  })
}

/** Submit answers to a question group. */
export async function respondQuestion(
  sessionId: string,
  answers: Array<{ id: string; selected: string[]; custom?: string }>,
): Promise<void> {
  await callUnary<unknown>('mobile.respond', {
    sessionId,
    type: 'question',
    answers,
  })
}

/* ── directory browsing / workspace creation (#977) ──────────────────── */

/** One entry in a directory listing. */
export interface DirectoryEntry {
  name: string
  path: string
  hidden: boolean
}

/** The host directory listing result (one level, with ancestor breadcrumbs). */
export interface DirectoryListing {
  path: string
  home: string
  crumbs: DirectoryEntry[]
  entries: DirectoryEntry[]
  truncated: boolean
}

/** The result of creating a workspace from an existing directory. */
export interface WorkspaceCreateResult {
  workspace: WorkspaceView
  created: boolean
}

/** Browse one directory level on the host (defaults to home directory). */
export async function listDirectory(path?: string): Promise<DirectoryListing> {
  return await callUnary<DirectoryListing>('host.listDirectory', path === undefined ? {} : { path })
}

/** Create a workspace from an existing host directory (does not mkdir). */
export async function createWorkspace(path: string): Promise<WorkspaceCreateResult> {
  return await callUnary<WorkspaceCreateResult>('workspace.create', { path })
}
