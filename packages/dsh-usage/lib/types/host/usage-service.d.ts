/**
 * The dsh-usage host service: folds live session usage into the persistent
 * ledger, probes each configured provider's balance/coding-plan endpoint on
 * a poll cycle, and announces the current provider's status to the pet
 * bubble. Secrets stay in the host process; the browser only ever sees the
 * overview document.
 * @module @linxin666/dsh-usage/host/usage-service
 */
import type { Context } from '@deepseek-ai/cordis';
import type { UsageOverviewView } from '../core/types.ts';
/** Source tag the plugin stamps onto pet announcements. */
export declare const USAGE_ANNOUNCE_SOURCE = "dsh-usage";
/** Poll-loop and announce options; re-applied live on settings change. */
export interface UsageServiceOptions {
    pollIntervalSec: number;
    bubbleMode: 'always' | 'change' | 'off';
    retainDays: number;
}
/** Format a balance for display: symbol prefix when known, code suffix otherwise. */
export declare function formatMoney(currency: string, totalBalance: string): string;
/** Map a used percent to the announcement tone. */
export declare function planTone(percent: number): 'ok' | 'warn' | 'low';
export declare class UsageService {
    private readonly ctx;
    private options;
    private readonly persistDir;
    private readonly ledgerPath;
    private readonly snapshotsPath;
    private ledger;
    private readonly snapshots;
    /** Per-live-session route attribution (WeakMap: disposed sessions age out). */
    private readonly sessionRoutes;
    /** The most recent route seen this boot; the pet bubble follows it. */
    private current;
    private sessionListenerDisposer;
    private pollTimer;
    private flushTimer;
    private pollInFlight;
    private disposed;
    private lastSignature;
    constructor(ctx: Context, options: UsageServiceOptions);
    /** Start the listeners, load persisted state, and arm the first poll. */
    start(): void;
    /** Stop timers and flush pending ledger writes. */
    stop(): void;
    /** Re-apply options live (settings change); the poll cycle picks them up. */
    applyOptions(options: UsageServiceOptions): void;
    /** Force one poll now (manual refresh route). */
    refresh(): Promise<void>;
    /** Assemble the overview document the browser section renders. */
    overview(): UsageOverviewView;
    /** One local day aggregated per provider. */
    private daySummary;
    private onSessionEvent;
    /** Normalize a provider TokenUsage into the ledger bucket (one call). */
    private totalsFrom;
    private loadPersisted;
    private scheduleFlush;
    private flushLedger;
    private persistSnapshots;
    private rearmPoll;
    /** One poll cycle: enumerate routes, resolve credentials, probe, announce. */
    pollNow(): Promise<void>;
    private listProviderRoutes;
    private probeRoute;
    /**
     * Resolve the credential backing one route: pi-ai credential records
     * first, then the profile's apiKeyEnv reference, then the DeepSeek
     * official adapter's env reference. OAuth grants resolve to a kind with
     * no key (this plugin does not spend third-party OAuth budgets).
     */
    private resolveCredential;
    /** The llm-pi-ai profile object for one provider route, when configured. */
    private piAiProfile;
    /** The DeepSeek official adapter's credential reference name. */
    private deepseekApiKeyEnv;
    /**
     * Announce the current provider's balance or plan usage to the pet. In
     * `change` mode only meaningful value changes re-announce; `off` skips.
     */
    private announceCurrent;
}
