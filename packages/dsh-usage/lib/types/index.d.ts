import type { Context } from '@deepseek-ai/cordis';
import z from 'schemastery';
import { type UsageServiceOptions } from './host/usage-service.ts';
export declare const name = "dsh-usage";
export declare const inject: string[];
export declare const USAGE_SETTINGS_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
export interface Config {
    enabled?: boolean;
    /** Provider probe cycle in seconds; 30-3600. */
    pollIntervalSec?: number;
    /** Pet bubble mode: always (refreshes each poll), change (only on value change), off. */
    bubbleMode?: string;
    /** Ledger retention in local days. */
    retainDays?: number;
}
export declare const Config: z<Config>;
export interface ResolvedConfig extends UsageServiceOptions {
    enabled: boolean;
}
export declare function resolveConfig(config?: Config): ResolvedConfig;
export declare const apply: (ctx: Context, config?: Config) => void;
