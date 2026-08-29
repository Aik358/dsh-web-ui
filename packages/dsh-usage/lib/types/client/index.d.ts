/**
 * dsh-usage browser half — seats the first-level 使用统计 settings section
 * (below the Workshop entry) and polls the host overview only while the
 * section is open. All provider probing and credential handling happens in
 * the host half; this bundle only renders the overview document.
 * @module @linxin666/dsh-usage/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-ui-settings/client';
import { type UsageSettings } from './UsageSectionCard.tsx';
/** Required services. */
export declare const inject: string[];
export type { UsageSectionProps, UsageSectionFace } from './UsageSectionCard.tsx';
export type { UsageUiState } from './usage-store.ts';
export type { UsageSettings };
declare module '@deepseek-ai/cordis' {
    interface Context {
        /**
         * Optional rc.6 compatibility binder provided by dsh-web-settings;
         * absent when that group plugin is not installed, so callers fall back to
         * the official settings scope.
         */
        webUiSettings?: {
            bind<S>(spec: SettingsScopeSpec<S>): SettingsScope<S>;
        };
    }
}
/**
 * Client plugin body: register dictionaries and seat the settings section.
 * The overview poll loop and the store live with the section component's
 * mount cycle, so no background traffic exists while the page is closed.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
