/**
 * Provider adapters: one entry per provider family this plugin can query for
 * a pay-as-you-go balance or a coding-plan quota. Adapters are pure — they
 * build an HTTP probe from a resolved credential and parse the response — so
 * the service stays transport-only and every endpoint detail lives here.
 *
 * All probes run host-side (Node fetch); API keys never reach the browser.
 * @module @linxin666/dsh-usage/core/adapters
 */
import type { PlanWindowView } from './types.ts';
/** One HTTP probe the service executes verbatim. */
export interface ProbeSpec {
    url: string;
    headers: Record<string, string>;
}
/** Inputs an adapter may use to build a probe. */
export interface AdapterProbeContext {
    /** Resolved credential value (the raw key; env refs are resolved upstream). */
    apiKey: string;
}
/** A parsed balance fact. */
export interface BalanceParse {
    currency: string;
    totalBalance: string;
}
/** A parsed plan-quota fact. */
export interface PlanParse {
    planName?: string;
    windows: PlanWindowView[];
}
/** One provider family's probing capability. */
export interface ProviderAdapter {
    /** Provider route keys this adapter serves. */
    ids: readonly string[];
    /** Fallback display name when the LLM runtime has none. */
    displayName: string;
    balance?: {
        build(context: AdapterProbeContext): ProbeSpec;
        parse(status: number, body: unknown): BalanceParse | undefined;
    };
    plan?: {
        build(context: AdapterProbeContext): ProbeSpec;
        parse(status: number, body: unknown): PlanParse | undefined;
    };
}
/**
 * The adapter registry, in no particular order. Route keys come from the
 * pi-ai provider catalog plus the routes this deployment observed in user
 * configuration (`zenmux`).
 */
export declare const PROVIDER_ADAPTERS: readonly ProviderAdapter[];
/** Find the adapter serving a provider route key, if any. */
export declare function adapterFor(provider: string): ProviderAdapter | undefined;
/**
 * Best-effort human message from a provider error body, for the per-provider
 * error line. Never throws; truncated to one short sentence.
 */
export declare function providerErrorMessage(status: number, body: unknown): string;
