/** Paired-only model discovery and adoption routes; generic privileged RPCs stay loopback-only. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { TypertGatewayFace } from './host-gateway.ts'
import { invokeGateway, isConflictOutcome, isRejectedOutcome } from './host-gateway.ts'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { z } from 'zod'
import type { PairingService } from './pairing.ts'
import { readCookie } from './gate.ts'
import { readBoundedJson, writeJson } from './http.ts'
import { isTrustedApiRequest, publicHostOf } from './routes.ts'

const MAX_BODY_BYTES = 16 * 1024
const MAX_IDENTIFIER_LENGTH = 160
const MAX_DISPLAY_NAME_LENGTH = 240
const MAX_TOKEN_LIMIT = 10_000_000
const REASONING_EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
type ReasoningEffort = typeof REASONING_EFFORTS[number]
const stringField = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[\r\n\0]/.test(value), 'must not contain a newline or NUL')
const providerSchema = z.object({ provider: stringField(MAX_IDENTIFIER_LENGTH) }).strict()
const modelSchema = z.object({
  id: stringField(MAX_IDENTIFIER_LENGTH),
  name: stringField(MAX_DISPLAY_NAME_LENGTH).optional(),
  contextWindow: z.number().int().safe().positive().max(MAX_TOKEN_LIMIT).optional(),
  maxTokens: z.number().int().safe().positive().max(MAX_TOKEN_LIMIT).optional(),
  reasoningEfforts: z.array(z.enum(REASONING_EFFORTS)).min(1).refine(
    efforts => efforts.every((effort, index) => index === 0 || REASONING_EFFORTS.indexOf(efforts[index - 1]!) < REASONING_EFFORTS.indexOf(effort)),
    'reasoning efforts must be unique and in canonical order',
  ).optional(),
}).strict()
const upsertSchema = z.object({ provider: stringField(MAX_IDENTIFIER_LENGTH), model: modelSchema }).strict()

interface ModelProfile { id: string, name?: string, contextWindow?: number, maxTokens?: number, reasoningEfforts?: ReasoningEffort[] }
/** One configured-provider row as llm/listConfigurableProviders serves it. */
interface ProviderRoute { provider: string, displayName: string, settingsNs: string, settingsPath: string[], declared?: unknown }
/** One settings namespace view as settings/describe serves it (mobile-owned subset). */
interface SettingsNamespaceView { ns: string, value: unknown, revision: number, writable?: boolean }
/** One model group as session/modelCatalog serves it. */
interface ModelProviderGroup { id: string, name?: string, models: Array<{ id: string, name?: string, description?: string, reasoning?: unknown }> }
interface EligibleProvider { provider: string, displayName: string, namespace: SettingsNamespaceView, profile: Record<string, unknown> }
interface CatalogValue { groups: ModelProviderGroup[], failures: Array<{ id: string, name: string, message: string }> }
/** One settings path operation (the phone-owned mutation plan shape). */
interface SettingsPathOpView { op: string, path: string[], value?: unknown }

export const PAIRED_MODEL_CATALOG_PATHS = {
  catalog: '/api/pair/model-catalog',
  discover: '/api/pair/model-catalog/discover',
  upsert: '/api/pair/model-catalog/upsert',
} as const

export interface PairedModelCatalogDeps {
  service: PairingService
  gateway: TypertGatewayFace
  /** The LAN IP literals the host fence accepts, mirroring the /api/pair fence. */
  lanAddresses: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function reject(res: ServerResponse, status: number, error: string): void { writeJson(res, status, { error }) }
function publicProviderId(value: string): string {
  const normalized = value.replace(/[\r\n\0]/g, ' ').trim().slice(0, MAX_IDENTIFIER_LENGTH)
  return normalized === '' ? 'unknown' : normalized
}

function publicCatalog(value: CatalogValue): CatalogValue {
  return {
    groups: value.groups.map(group => ({ id: group.id, name: group.name, models: group.models.map(model => ({
      id: model.id, name: model.name,
      ...model.description === undefined ? {} : { description: model.description },
      ...model.reasoning === undefined ? {} : { reasoning: model.reasoning },
    })) })),
    failures: value.failures.map(failure => ({
      id: failure.id,
      name: failure.name,
      message: `model catalog unavailable for provider ${publicProviderId(failure.id)}`,
    })),
  }
}
function publicCandidates(models: Array<{ id: string, name?: string, contextWindow?: number, maxTokens?: number }>): unknown[] {
  return models.map(model => ({ id: model.id,
    ...model.name === undefined ? {} : { name: model.name },
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
  }))
}
function fieldsOf(model: ModelProfile, includeId: boolean): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    ...includeId ? { id: model.id } : {},
    ...model.name === undefined ? {} : { name: model.name },
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
  }
  if (model.reasoningEfforts !== undefined) fields.reasoningEfforts = Object.fromEntries(model.reasoningEfforts.map(effort => [effort, effort === 'off' ? null : effort]))
  return fields
}
function groupFor(catalog: CatalogValue, provider: string): ModelProviderGroup | undefined {
  if (catalog.failures.some(failure => failure.id === provider)) return undefined
  return catalog.groups.find(group => group.id === provider)
}
/** The host model catalog (groups + failures) via session/modelCatalog. */
async function readCatalog(gateway: TypertGatewayFace): Promise<CatalogValue | undefined> {
  const outcome = await invokeGateway(gateway, 'session', 'modelCatalog')
  if (!outcome.ok || !isRecord(outcome.value)) return undefined
  const value = outcome.value as { groups?: unknown; failures?: unknown }
  if (!Array.isArray(value.groups) || !Array.isArray(value.failures)) return undefined
  return value as unknown as CatalogValue
}

/**
 * Resolve one exact llm-pi-ai provider address, never an input-supplied path.
 * The 0.1.2 llm/listConfigurableProviders row has no `active` flag; the
 * settings document itself (the provider profile being present) is the
 * eligibility source, and the settingsNs/settingsPath checks stay exact.
 */
async function eligibleProvider(gateway: TypertGatewayFace, requested: string): Promise<{ provider?: EligibleProvider, status?: number, error?: string }> {
  const providersOutcome = await invokeGateway(gateway, 'llm', 'listConfigurableProviders')
  const settingsOutcome = await invokeGateway(gateway, 'settings', 'describe')
  if (!providersOutcome.ok || !settingsOutcome.ok || !Array.isArray(providersOutcome.value) || !isRecord(settingsOutcome.value)) {
    return { status: 502, error: 'model catalog capability is unavailable' }
  }
  const routes = providersOutcome.value as ProviderRoute[]
  const settings = settingsOutcome.value as { writable?: unknown; namespaces?: unknown }
  if (settings.writable !== true || !Array.isArray(settings.namespaces)) {
    return { status: 502, error: 'model catalog capability is unavailable' }
  }
  const route = routes.find(candidate => isRecord(candidate) && candidate.provider === requested)
  if (route === undefined) return { status: 404, error: `unknown provider ${requested}` }
  if (route.settingsNs !== 'llm-pi-ai' || !Array.isArray(route.settingsPath) || route.settingsPath.length !== 2
    || route.settingsPath[0] !== 'providers' || route.settingsPath[1] !== requested) return { status: 403, error: `provider ${requested} is not eligible for the paired model catalog` }
  const namespace = (settings.namespaces as SettingsNamespaceView[]).find(candidate => isRecord(candidate) && candidate.ns === 'llm-pi-ai')
  const root = namespace !== undefined && isRecord(namespace.value) ? namespace.value : undefined
  const providersValue = root !== undefined && isRecord(root.providers) ? root.providers : undefined
  const profile = providersValue !== undefined && isRecord(providersValue[requested]) ? providersValue[requested] : undefined
  if (namespace === undefined || profile === undefined) return { status: 403, error: `provider ${requested} is not eligible for the paired model catalog` }
  return { provider: { provider: requested, displayName: typeof route.displayName === 'string' ? route.displayName : requested, namespace, profile } }
}
function validIdentifier(value: unknown): value is string {
  const parsed = stringField(MAX_IDENTIFIER_LENGTH).safeParse(value)
  return parsed.success && parsed.data === value
}
function configuredModels(profile: Record<string, unknown>): { inherited: true } | { inherited: false, values: Record<string, unknown>[] } | undefined {
  if (!Object.hasOwn(profile, 'models')) return { inherited: true }
  if (!Array.isArray(profile.models)) return undefined
  if (profile.models.length === 0) return { inherited: true }
  const values: Record<string, unknown>[] = []
  for (const entry of profile.models) {
    if (!isRecord(entry) || !validIdentifier(entry.id)) return undefined
    values.push({ ...entry })
  }
  return { inherited: false, values }
}
function configuredOverrides(profile: Record<string, unknown>): { present: boolean, values: Map<string, Record<string, unknown>> } | undefined {
  if (!Object.hasOwn(profile, 'modelOverrides')) return { present: false, values: new Map() }
  if (!isRecord(profile.modelOverrides)) return undefined
  const values = new Map<string, Record<string, unknown>>()
  for (const [id, value] of Object.entries(profile.modelOverrides)) {
    if (!validIdentifier(id) || !isRecord(value)) return undefined
    values.set(id, { ...value })
  }
  return { present: true, values }
}
function updatedModels(existing: Record<string, unknown>[], model: ModelProfile): Record<string, unknown>[] {
  const next = existing.map(entry => ({ ...entry }))
  const index = next.findIndex(entry => entry.id === model.id)
  const patch = fieldsOf(model, true)
  if (index >= 0) next[index] = { ...next[index], ...patch }
  else next.push(patch)
  return next
}
function mutationPlan(profile: Record<string, unknown>, provider: string, model: ModelProfile, catalog: CatalogValue): { ops: SettingsPathOpView[] } | undefined {
  const configured = configuredModels(profile)
  const overrides = configuredOverrides(profile)
  if (configured === undefined || overrides === undefined) return undefined
  const modelsPath = ['providers', provider, 'models']
  const overridesPath = ['providers', provider, 'modelOverrides']
  if (!configured.inherited) {
    if (overrides.values.size > 0) return undefined
    const ops: SettingsPathOpView[] = [{ op: 'set', path: modelsPath, value: updatedModels(configured.values, model) }]
    if (overrides.present) ops.push({ op: 'unset', path: overridesPath })
    return { ops }
  }

  const group = groupFor(catalog, provider)
  if (group?.models.some(entry => entry.id === model.id) === true) {
    const existing = overrides.values.get(model.id) ?? {}
    return { ops: [{ op: 'set', path: [...overridesPath, model.id], value: { ...existing, ...fieldsOf(model, false) } }] }
  }
  if (group === undefined) return undefined
  const materialized: Record<string, unknown>[] = []
  const materializedIds = new Set<string>()
  for (const installed of group.models) {
    materialized.push({ ...overrides.values.get(installed.id), id: installed.id })
    materializedIds.add(installed.id)
  }
  for (const [id, override] of overrides.values) {
    if (!materializedIds.has(id)) materialized.push({ ...override, id })
  }
  const ops: SettingsPathOpView[] = [{ op: 'set', path: modelsPath, value: updatedModels(materialized, model) }]
  if (overrides.present) ops.push({ op: 'unset', path: overridesPath })
  return { ops }
}
function paired(req: IncomingMessage, service: PairingService): boolean {
  const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
  return deviceId !== undefined && service.touchDevice(deviceId)
}
async function bodyOf<T>(req: IncomingMessage, schema: z.ZodType<T>): Promise<T | undefined> {
  try { return schema.parse(await readBoundedJson(req, MAX_BODY_BYTES)) } catch { return undefined }
}

/** Build the narrow paired-device model catalog routes. */
export function makePairedModelCatalogRoutes(deps: PairedModelCatalogDeps): WebRoute[] {
  const { service, gateway, lanAddresses } = deps
  /** Same fence as the /api/pair family: loopback, the advertised LAN literals, or the configured public host. */
  const fence = (req: IncomingMessage): boolean => {
    const publicHost = publicHostOf(service.publicBaseUrl)
    return isTrustedApiRequest(req, publicHost === undefined ? lanAddresses : [...lanAddresses, publicHost])
  }
  const gate = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!fence(req)) {
      req.resume()
      reject(res, 403, 'paired model catalog is not reachable for this origin')
      return false
    }
    if (!paired(req, service)) {
      req.resume()
      reject(res, 403, 'paired model catalog requires a live paired device')
      return false
    }
    return true
  }
  const catalog = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!gate(req, res)) return
    if (req.method !== 'GET') return reject(res, 405, 'method not allowed')
    const providersOutcome = await invokeGateway(gateway, 'llm', 'listConfigurableProviders')
    const settingsOutcome = await invokeGateway(gateway, 'settings', 'describe')
    if (!providersOutcome.ok || !settingsOutcome.ok || !Array.isArray(providersOutcome.value) || !isRecord(settingsOutcome.value)) {
      return reject(res, 502, 'model catalog capability is unavailable')
    }
    const routes = providersOutcome.value as ProviderRoute[]
    const settings = settingsOutcome.value as { writable?: unknown; namespaces?: unknown }
    const namespace = Array.isArray(settings.namespaces)
      ? (settings.namespaces as SettingsNamespaceView[]).find(candidate => isRecord(candidate) && candidate.ns === 'llm-pi-ai')
      : undefined
    const providerMap = namespace !== undefined && isRecord(namespace.value) && isRecord(namespace.value.providers) ? namespace.value.providers : undefined
    const eligible = settings.writable === true && providerMap !== undefined ? routes
      .filter(candidate => isRecord(candidate) && candidate.settingsNs === 'llm-pi-ai'
        && Array.isArray(candidate.settingsPath) && candidate.settingsPath.length === 2 && candidate.settingsPath[0] === 'providers'
        && candidate.settingsPath[1] === candidate.provider && isRecord(providerMap[candidate.provider]))
      .map(candidate => ({ provider: candidate.provider, displayName: typeof candidate.displayName === 'string' ? candidate.displayName : candidate.provider })) : []
    writeJson(res, 200, { capability: 'paired-model-catalog', providers: eligible })
  }
  const discover = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!gate(req, res)) return
    if (req.method !== 'POST') return reject(res, 405, 'method not allowed')
    const body = await bodyOf(req, providerSchema)
    if (body === undefined) return reject(res, 400, 'invalid model catalog request')
    const eligible = await eligibleProvider(gateway, body.provider)
    if (eligible.provider === undefined) return reject(res, eligible.status ?? 502, eligible.error ?? 'model catalog capability is unavailable')
    const outcome = await invokeGateway(gateway, 'llm', 'discoverModels', { settingsNs: 'llm-pi-ai', request: { provider: eligible.provider.provider } })
    if (!outcome.ok || !Array.isArray(outcome.value)) return reject(res, 502, `model discovery failed for provider ${eligible.provider.provider}`)
    writeJson(res, 200, { models: publicCandidates(outcome.value as Array<{ id: string, name?: string, contextWindow?: number, maxTokens?: number }>) })
  }
  const upsert = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!gate(req, res)) return
    if (req.method !== 'POST') return reject(res, 405, 'method not allowed')
    const body = await bodyOf(req, upsertSchema)
    if (body === undefined) return reject(res, 400, 'invalid model catalog request')
    const eligible = await eligibleProvider(gateway, body.provider)
    if (eligible.provider === undefined) return reject(res, eligible.status ?? 502, eligible.error ?? 'model catalog capability is unavailable')
    const before = await readCatalog(gateway)
    if (before === undefined) return reject(res, 502, `model catalog is unavailable for provider ${body.provider}`)
    const plan = mutationPlan(eligible.provider.profile, body.provider, body.model, before)
    if (plan === undefined) return reject(res, 502, `model catalog is unavailable for provider ${body.provider}`)
    // The gateway mutate takes (ns, ops, expectedRevision) flat; the host
    // classifies refusals with the wire codes 'settings-conflict' (409) and
    // 'settings-rejected' (422), which invokeGateway surfaces from the
    // TypertRemoteFailure payload.
    const mutation = await invokeGateway(gateway, 'settings', 'mutate', {
      ns: 'llm-pi-ai',
      ops: plan.ops,
      expectedRevision: eligible.provider.namespace.revision,
    })
    if (isConflictOutcome(mutation)) return reject(res, 409, `model update conflicted for provider ${body.provider}`)
    if (isRejectedOutcome(mutation)) return reject(res, 422, `model update was rejected for provider ${body.provider}`)
    if (!mutation.ok) return reject(res, 502, `model update failed for provider ${body.provider}`)
    const after = await readCatalog(gateway)
    if (after === undefined) return reject(res, 502, `model catalog is unavailable for provider ${body.provider}`)
    writeJson(res, 200, publicCatalog(after))
  }
  return [
    { kind: 'exact', path: PAIRED_MODEL_CATALOG_PATHS.catalog, handler: catalog },
    { kind: 'exact', path: PAIRED_MODEL_CATALOG_PATHS.discover, handler: discover },
    { kind: 'exact', path: PAIRED_MODEL_CATALOG_PATHS.upsert, handler: upsert },
  ]
}
