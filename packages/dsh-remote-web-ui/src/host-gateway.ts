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
    const message = error instanceof Error ? error.message : String(error)
    const code = (error as { code?: unknown } | null)?.code
    return { ok: false, error: { code: typeof code === 'string' ? code : 'internal', message } }
  }
}

/** True when the gateway threw a settings mutation conflict (HTTP 409 analog). */
export function isConflictOutcome(outcome: GatewayOutcome): boolean {
  return !outcome.ok && (outcome.error.code === 'settings-conflict' || /conflict/i.test(outcome.error.message))
}

/** True when the gateway rejected a settings mutation payload (HTTP 422 analog). */
export function isRejectedOutcome(outcome: GatewayOutcome): boolean {
  return !outcome.ok && (outcome.error.code === 'settings-rejected' || /reject/i.test(outcome.error.message))
}