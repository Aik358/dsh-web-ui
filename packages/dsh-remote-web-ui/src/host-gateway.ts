/**
 * The 0.1.2 host data channel: every former ApiProxy route now rides the
 * typertGateway service (namespace + method dispatch, business results
 * direct, failures thrown). This module owns the structural gateway face
 * and the outcome helpers the mobile BFF layers share, so no file in this
 * package imports the removed dsh-host-apiproxy faces.
 */
import type { Context } from '@deepseek-ai/cordis'

/** The typertGateway service face this package consumes (structural). */
export interface TypertGatewayFace {
  invoke(request: { namespace: string; method: string; args: Record<string, unknown>; signal?: AbortSignal }): Promise<unknown>
  stream?(request: { namespace: string; method: string; args: Record<string, unknown>; signal?: AbortSignal }): Promise<AsyncIterable<unknown>>
}

/** Workspace registry rows (host service; only the fields consumed here). */
export interface WorkspaceRegistryFace {
  list(): ReadonlyArray<{ id: string; title?: string; path?: string; cwd?: string }>
}

/** The wire outcome the /m/api 'server-response' envelope has always carried. */
export type GatewayOutcome = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }

/** Read the injected gateway, or undefined when the host did not mount it. */
export function gatewayOf(ctx: Context): TypertGatewayFace | undefined {
  return ctx.get('typertGateway') as TypertGatewayFace | undefined
}

/** Invoke one Remote method and map throws onto the wire outcome shape. */
export async function invokeGateway(
  gateway: TypertGatewayFace,
  namespace: string,
  method: string,
  args: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<GatewayOutcome> {
  try {
    return { ok: true, value: await gateway.invoke({ namespace, method, args, ...(signal === undefined ? {} : { signal }) }) }
  } catch (error) {
    // Business failures ride TypertRemoteFailure: the structured
    // {code, message, details} payload lives on error.failure and the error
    // itself carries no .code (only TypertGatewayError does), so read the
    // structured failure first and keep the error surface as the fallback
    // for gateway-level rejections (arguments-invalid and friends).
    const failure = (error as { failure?: unknown } | null)?.failure
    const structured = (failure !== null && typeof failure === 'object' ? failure : error) as { code?: unknown; message?: unknown } | null
    const code = typeof structured?.code === 'string' ? structured.code : 'internal'
    const message = typeof structured?.message === 'string' && structured.message !== ''
      ? structured.message
      : error instanceof Error ? error.message : String(error)
    return { ok: false, error: { code, message } }
  }
}

/**
 * True when the gateway threw a settings mutation conflict (HTTP 409 analog).
 * The host classifies a stale expectedRevision write as the wire code
 * 'settings-conflict' (dsh-api-settings-controller maps SettingsConflictError
 * onto it); the message regex stays only as a last-resort fallback.
 */
export function isConflictOutcome(outcome: GatewayOutcome): boolean {
  return !outcome.ok && (outcome.error.code === 'settings-conflict' || /conflict/i.test(outcome.error.message))
}

/**
 * True when the gateway rejected a settings mutation payload (HTTP 422 analog).
 * The host classifies provider refusals as the wire code 'settings-rejected'
 * (the settings controller's rejected() seam); the message regex stays only
 * as a last-resort fallback.
 */
export function isRejectedOutcome(outcome: GatewayOutcome): boolean {
  return !outcome.ok && (outcome.error.code === 'settings-rejected' || /reject/i.test(outcome.error.message))
}
