/**
 * The usage ledger: a pure fold from session usage facts into a per-day,
 * per-provider, per-model totals document, plus its JSON serialization.
 * Host-side state lives only in the document; the service owns persistence.
 * @module @linxin666/dsh-usage/core/ledger
 */
import { type UsageLedgerDocument, type UsageTokenTotals } from './types.ts';
/** Local-date key (`YYYY-MM-DD`) for an epoch ms timestamp. */
export declare function localDateKey(ms: number): string;
/** An empty ledger document. */
export declare function createLedgerDocument(): UsageLedgerDocument;
/**
 * Fold one usage report into the ledger in place. `provider` is the route key
 * and `model` the provider-owned model id the step ran under.
 */
export declare function foldUsage(doc: UsageLedgerDocument, atMs: number, provider: string, model: string, usage: Readonly<UsageTokenTotals>): void;
/** Total tokens of a bucket (billed input + output; reasoning is inside output). */
export declare function totalTokens(totals: Readonly<UsageTokenTotals>): number;
/** All local-date keys in the ledger, ascending. */
export declare function ledgerDayKeys(doc: Readonly<UsageLedgerDocument>): string[];
/**
 * Drop every day older than `retainDays` local days before `todayKey`, in
 * place. Returns the number of pruned days.
 */
export declare function pruneLedger(doc: UsageLedgerDocument, todayKey: string, retainDays: number): number;
/**
 * Parse a ledger document from untrusted JSON: unknown shapes resolve to an
 * empty document, malformed entries are dropped, numbers are coerced to
 * finite values. Never throws.
 */
export declare function deserializeLedger(value: unknown): UsageLedgerDocument;
