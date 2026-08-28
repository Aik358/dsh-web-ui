/**
 * The 0.1.2 wire contract the test gateway fakes validate against: the
 * parameter layout per namespace/method, transcribed from the generated
 * descriptor tables (typert.host.js / typert.remote-client.js of the
 * @deepseek-ai packages installed in this worktree). The gateway's
 * assertExactArguments (@deepseek-ai/dsh-api-gateway/lib/index.js) throws
 * arguments-invalid on any extra or missing args key, so a BFF that drifts
 * off a descriptor shape can never go green against a fake that calls
 * assertWireArgs.
 */

/** One descriptor parameter's wire layout. */
export interface WireParameter {
  /** The descriptor's wire key. */
  wire: string
  /** True when the descriptor marks the parameter acceptsUndefined. */
  optional?: boolean
}

/**
 * Wire parameters per namespace/method, verified against the
 * 0.1.2-alpha.1 descriptor tables:
 * - dsh-api-session-controller: session/list carries its single request
 *   parameter under the '_request' wire key; every other session method
 *   dispatched here uses 'request'; session/modelCatalog takes nothing.
 * - dsh-api-workspace-controller: workspace/create uses 'request';
 *   directoryPicker/list declares one flat optional 'path'.
 * - dsh-agent-presets: agentPresets/list takes nothing.
 * - dsh-llm: llm/listConfigurableProviders takes nothing; discoverModels
 *   takes flat (settingsNs, request).
 * - dsh-api-settings-controller: settings/describe takes nothing;
 *   settings/mutate takes flat (ns, ops, expectedRevision acceptsUndefined).
 */
export const WIRE_PARAMETERS: Record<string, readonly WireParameter[]> = {
  'session/list': [{ wire: '_request' }],
  'session/create': [{ wire: 'request' }],
  'session/page': [{ wire: 'request' }],
  'session/follow': [{ wire: 'request' }],
  'session/search': [{ wire: 'request' }],
  'session/prompt': [{ wire: 'request' }],
  'session/selectModel': [{ wire: 'request' }],
  'session/rename': [{ wire: 'request' }],
  'session/cancel': [{ wire: 'request' }],
  'session/modelCatalog': [],
  'workspace/create': [{ wire: 'request' }],
  'directoryPicker/list': [{ wire: 'path', optional: true }],
  'agentPresets/list': [],
  'llm/listConfigurableProviders': [],
  'llm/discoverModels': [{ wire: 'settingsNs' }, { wire: 'request' }],
  'settings/describe': [],
  'settings/mutate': [{ wire: 'ns' }, { wire: 'ops' }, { wire: 'expectedRevision', optional: true }],
}

/**
 * Validate one gateway invoke request against the descriptor wire layout,
 * mirroring the gateway's assertExactArguments: extra and missing keys both
 * reject with a TypertGatewayError-shaped arguments-invalid throw.
 */
export function assertWireArgs(request: { namespace: string; method: string; args: Record<string, unknown> }): void {
  const parameters = WIRE_PARAMETERS[request.namespace + '/' + request.method]
  if (parameters === undefined) return
  const expected = new Set(parameters.map(parameter => parameter.wire))
  const extra = Object.keys(request.args).filter(key => !expected.has(key))
  const missing = parameters
    .filter(parameter => parameter.optional !== true && !Object.hasOwn(request.args, parameter.wire))
    .map(parameter => parameter.wire)
  if (extra.length === 0 && missing.length === 0) return
  const clauses: string[] = []
  if (missing.length > 0) clauses.push('missing ' + missing.map(key => JSON.stringify(key)).join(', '))
  if (extra.length > 0) clauses.push('unexpected ' + extra.map(key => JSON.stringify(key)).join(', '))
  throw Object.assign(
    new Error('args fields do not match the descriptor: ' + clauses.join('; ')),
    { code: 'arguments-invalid' },
  )
}
