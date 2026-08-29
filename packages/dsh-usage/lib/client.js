window.__ModuleLoader__.load({
	id: "@linxin666/dsh-usage",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-store-engine
		const platform = ["@deepseek-ai/dsh-client", "-store"].join("");
		const legacy = ["@deepseek-ai/dsh-client-runtime", "/client"].join("");
		let engine;
		try {
			engine = require(platform);
		} catch {
			engine = require(legacy);
		}
		engine.createSnapshotStore;
		const defineStore = engine.defineStore;
		engine.shallowEqual;
		//#endregion
		//#region src/client/usage-store.ts
		/**
		* Browser-side usage store: the overview snapshot polled from the host plus
		* the fetch lifecycle. Section-local: the store lives while the settings
		* section is mounted, so polling only runs while the page is open.
		* @module @linxin666/dsh-usage/client/usage-store
		*/
		/** Create the usage store handle (apply world only; never module-level). */
		function createUsageStore() {
			return defineStore({
				init: () => ({
					snapshot: null,
					status: "loading",
					error: null
				}),
				actions: {
					setSnapshot: (draft, snapshot) => {
						draft.snapshot = snapshot;
						draft.status = "ready";
						draft.error = null;
					},
					setState: (draft, status, error) => {
						draft.status = status;
						draft.error = error;
					}
				}
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* dsh-usage locale dictionaries (zh/en). The zh dictionary is the key source;
		* `en` mirrors its full key set (packages/AGENTS.md bilingual discipline).
		* @module @linxin666/dsh-usage/client/locales
		*/
		/** Dictionary namespace this package registers. */
		const NS = "dsh-web-ui-usage";
		/** Chinese copy. */
		const zh = {
			"usage.title": "使用统计",
			"usage.tab.usage": "用量",
			"usage.tab.plans": "个人套餐",
			"usage.refresh": "刷新",
			"usage.refreshing": "刷新中…",
			"usage.updated": "更新于 {time}",
			"usage.loading": "正在加载用量数据…",
			"usage.error": "加载失败：{error}",
			"usage.current": "当前",
			"usage.today": "今日用量",
			"usage.calls": "{n} 次调用",
			"usage.tokens.total": "总 tokens",
			"usage.tokens.input": "输入",
			"usage.tokens.output": "输出",
			"usage.tokens.cacheRead": "缓存读",
			"usage.tokens.cacheWrite": "缓存写",
			"usage.trend": "近 30 天",
			"usage.noData": "暂无用量数据（统计自插件启用起）",
			"usage.balance": "余额",
			"usage.balance.unsupported": "暂不支持余额查询",
			"usage.balance.noCredential": "未配置凭据",
			"usage.oauth": "OAuth 凭据，不做余额查询",
			"usage.plan.reset": "{date} 重置",
			"usage.plan.noPlan": "未检测到套餐数据",
			"usage.plan.windows.5h": "5 小时",
			"usage.plan.windows.week": "每周",
			"usage.plan.windows.month": "每月",
			"usage.provider.error": "查询失败：{error}",
			"usage.config.title": "设置",
			"usage.config.enabled": "启用插件",
			"usage.config.pollIntervalSec": "轮询间隔（秒）",
			"usage.config.bubbleMode": "宠物气泡",
			"usage.config.bubbleMode.always": "常驻显示",
			"usage.config.bubbleMode.change": "仅变化时",
			"usage.config.bubbleMode.off": "关闭"
		};
		/** English mirror; every zh key present. */
		const en = {
			"usage.title": "Usage Statistics",
			"usage.tab.usage": "Usage",
			"usage.tab.plans": "Plans",
			"usage.refresh": "Refresh",
			"usage.refreshing": "Refreshing…",
			"usage.updated": "Updated {time}",
			"usage.loading": "Loading usage data…",
			"usage.error": "Failed to load: {error}",
			"usage.current": "Current",
			"usage.today": "Today",
			"usage.calls": "{n} calls",
			"usage.tokens.total": "Total tokens",
			"usage.tokens.input": "Input",
			"usage.tokens.output": "Output",
			"usage.tokens.cacheRead": "Cache read",
			"usage.tokens.cacheWrite": "Cache write",
			"usage.trend": "Last 30 days",
			"usage.noData": "No usage data yet (counting starts when the plugin is enabled)",
			"usage.balance": "Balance",
			"usage.balance.unsupported": "Balance query not supported",
			"usage.balance.noCredential": "No credential configured",
			"usage.oauth": "OAuth credential, no balance query",
			"usage.plan.reset": "resets {date}",
			"usage.plan.noPlan": "No plan data detected",
			"usage.plan.windows.5h": "5 hours",
			"usage.plan.windows.week": "Weekly",
			"usage.plan.windows.month": "Monthly",
			"usage.provider.error": "Query failed: {error}",
			"usage.config.title": "Settings",
			"usage.config.enabled": "Enable plugin",
			"usage.config.pollIntervalSec": "Poll interval (seconds)",
			"usage.config.bubbleMode": "Pet bubble",
			"usage.config.bubbleMode.always": "Always visible",
			"usage.config.bubbleMode.change": "On change",
			"usage.config.bubbleMode.off": "Off"
		};
		/**
		* Active dictionary, picked by the document language at call time. The
		* section resolves its copy the same tiny way the pet's DOM-injected surface
		* does (the settings section has no framework locale seat of its own).
		*/
		function dictionary() {
			return (typeof document !== "undefined" ? document.documentElement.lang : "zh").toLowerCase().startsWith("en") ? en : zh;
		}
		/** Translate a key with optional `{name}` template params; missing keys degrade to the key. */
		function t(key, params) {
			let text = dictionary()[key] ?? key;
			if (params !== void 0) for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
			return text;
		}
		//#endregion
		//#region \0dsh-css:packages/dsh-usage/src/client/usage.module.css.mjs
		const css = ".cvtkAW_section{color:inherit;flex-direction:column;gap:16px;display:flex}.cvtkAW_header{justify-content:space-between;align-items:center;gap:12px;display:flex}.cvtkAW_currentProvider{opacity:.75;font-size:13px}.cvtkAW_refreshBtn{appearance:none;color:inherit;font:inherit;cursor:pointer;opacity:.85;background:0 0;border:1px solid;border-radius:8px;padding:4px 12px;font-size:12px;transition:opacity .12s,background-color .12s}.cvtkAW_refreshBtn:hover:not(:disabled){opacity:1;background:color-mix(in srgb, currentColor 8%, transparent)}.cvtkAW_refreshBtn:disabled{cursor:default;opacity:.5}.cvtkAW_refreshBtn:focus-visible{box-shadow:0 0 0 2px color-mix(in srgb, currentColor 45%, transparent);outline:none}.cvtkAW_tabs{border-bottom:1px solid color-mix(in srgb, currentColor 14%, transparent);gap:4px;display:flex}.cvtkAW_tab{appearance:none;color:inherit;font:inherit;cursor:pointer;opacity:.65;background:0 0;border:none;border-bottom:2px solid #0000;margin-bottom:-1px;padding:6px 14px;font-size:13px}.cvtkAW_tab:hover{opacity:.9}.cvtkAW_tab:focus-visible{box-shadow:0 0 0 2px color-mix(in srgb, currentColor 45%, transparent);outline:none}.cvtkAW_tabActive{opacity:1;border-bottom-color:currentColor;font-weight:600}.cvtkAW_card{border:1px solid color-mix(in srgb, currentColor 14%, transparent);border-radius:12px;flex-direction:column;gap:10px;padding:14px 16px;display:flex}.cvtkAW_cardTitle{letter-spacing:.04em;text-transform:uppercase;opacity:.6;font-size:12px;font-weight:600}.cvtkAW_statRow{flex-wrap:wrap;gap:18px;display:flex}.cvtkAW_stat{flex-direction:column;gap:2px;display:flex}.cvtkAW_statValue{font-variant-numeric:tabular-nums;font-size:18px;font-weight:600}.cvtkAW_statLabel{opacity:.6;font-size:11px}.cvtkAW_providerRow{border-top:1px solid color-mix(in srgb, currentColor 8%, transparent);justify-content:space-between;align-items:center;gap:12px;padding:6px 0;font-size:13px;display:flex}.cvtkAW_providerRow:first-of-type{border-top:none}.cvtkAW_providerName{align-items:center;gap:8px;min-width:0;display:flex}.cvtkAW_providerTokens{font-variant-numeric:tabular-nums;opacity:.75;white-space:nowrap}.cvtkAW_providerBalance{font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:600}.cvtkAW_currentBadge{border:1px solid color-mix(in srgb, currentColor 35%, transparent);opacity:.8;border-radius:999px;flex:none;padding:1px 7px;font-size:10px;font-weight:600}.cvtkAW_trend{align-items:flex-end;gap:3px;height:56px;display:flex}.cvtkAW_trendBar{background:color-mix(in srgb, currentColor 30%, transparent);border-radius:3px 3px 0 0;flex:1 1 0;min-width:4px;min-height:2px}.cvtkAW_trendBarToday{background:color-mix(in srgb, currentColor 65%, transparent)}.cvtkAW_trendAxis{opacity:.5;font-variant-numeric:tabular-nums;justify-content:space-between;font-size:10px;display:flex}.cvtkAW_muted{opacity:.6;font-size:12px}.cvtkAW_errorLine{opacity:.75;font-size:12px}.cvtkAW_planCard{flex-direction:column;gap:8px;display:flex}.cvtkAW_planHead{justify-content:space-between;align-items:baseline;gap:10px;display:flex}.cvtkAW_planName{font-size:14px;font-weight:600}.cvtkAW_windowRow{flex-direction:column;gap:4px;display:flex}.cvtkAW_windowLabel{opacity:.8;font-variant-numeric:tabular-nums;justify-content:space-between;font-size:12px;display:flex}.cvtkAW_bar{background:color-mix(in srgb, currentColor 10%, transparent);border-radius:999px;height:6px;overflow:hidden}.cvtkAW_barFill{background:color-mix(in srgb, currentColor 55%, transparent);border-radius:999px;height:100%;transition:width .3s}.cvtkAW_barWarn{background:#d97706}.cvtkAW_barLow{background:#dc2626}.cvtkAW_resetLine{opacity:.55;font-variant-numeric:tabular-nums;font-size:11px}.cvtkAW_settingsGrid{flex-wrap:wrap;align-items:center;gap:16px;display:flex}.cvtkAW_settingItem{align-items:center;gap:8px;font-size:13px;display:flex}.cvtkAW_settingItem input[type=checkbox]{accent-color:currentColor}.cvtkAW_settingItem input[type=number]{border:1px solid color-mix(in srgb, currentColor 25%, transparent);width:90px;color:inherit;font:inherit;background:0 0;border-radius:6px;padding:3px 8px;font-size:13px}.cvtkAW_settingItem select{border:1px solid color-mix(in srgb, currentColor 25%, transparent);color:inherit;font:inherit;background:0 0;border-radius:6px;padding:3px 8px;font-size:13px}.cvtkAW_settingItem input:focus-visible,.cvtkAW_settingItem select:focus-visible{box-shadow:0 0 0 2px color-mix(in srgb, currentColor 45%, transparent);outline:none}";
		const tagId = "@linxin666/dsh-usage/usage.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@linxin666/dsh-usage";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var usage_module_css_default = {
			"bar": "cvtkAW_bar",
			"barFill": "cvtkAW_barFill",
			"barLow": "cvtkAW_barLow",
			"barWarn": "cvtkAW_barWarn",
			"card": "cvtkAW_card",
			"cardTitle": "cvtkAW_cardTitle",
			"currentBadge": "cvtkAW_currentBadge",
			"currentProvider": "cvtkAW_currentProvider",
			"errorLine": "cvtkAW_errorLine",
			"header": "cvtkAW_header",
			"muted": "cvtkAW_muted",
			"planCard": "cvtkAW_planCard",
			"planHead": "cvtkAW_planHead",
			"planName": "cvtkAW_planName",
			"providerBalance": "cvtkAW_providerBalance",
			"providerName": "cvtkAW_providerName",
			"providerRow": "cvtkAW_providerRow",
			"providerTokens": "cvtkAW_providerTokens",
			"refreshBtn": "cvtkAW_refreshBtn",
			"resetLine": "cvtkAW_resetLine",
			"section": "cvtkAW_section",
			"settingItem": "cvtkAW_settingItem",
			"settingsGrid": "cvtkAW_settingsGrid",
			"stat": "cvtkAW_stat",
			"statLabel": "cvtkAW_statLabel",
			"statRow": "cvtkAW_statRow",
			"statValue": "cvtkAW_statValue",
			"tab": "cvtkAW_tab",
			"tabActive": "cvtkAW_tabActive",
			"tabs": "cvtkAW_tabs",
			"trend": "cvtkAW_trend",
			"trendAxis": "cvtkAW_trendAxis",
			"trendBar": "cvtkAW_trendBar",
			"trendBarToday": "cvtkAW_trendBarToday",
			"windowLabel": "cvtkAW_windowLabel",
			"windowRow": "cvtkAW_windowRow"
		};
		//#endregion
		//#region src/client/UsageSectionCard.tsx
		/**
		* The usage statistics settings section: two tabs (用量: today's usage,
		* balances, trend; 个人套餐: per-provider plan quota windows) plus a compact
		* settings row. Data comes from the host's loopback-fenced
		* /api/dsh-usage/overview document; polling runs only while the section is
		* mounted and the tab is visible.
		* @module @linxin666/dsh-usage/client/UsageSectionCard
		*/
		/** Poll cadence while the section is open. */
		const SECTION_POLL_MS = 1e4;
		/** Compact token count: 12345 -> 12.3k, 1234567 -> 1.23M. */
		function formatTokens(value) {
			if (!Number.isFinite(value) || value <= 0) return "0";
			if (value < 1e3) return String(value);
			if (value < 1e6) return trim(value / 1e3) + "k";
			if (value < 1e9) return trim(value / 1e6) + "M";
			return trim(value / 1e9) + "B";
		}
		function trim(value) {
			return value >= 100 ? String(Math.round(value)) : value.toFixed(value >= 10 ? 1 : 2).replace(/\.?0+$/, "");
		}
		function formatTime(ms) {
			try {
				return new Date(ms).toLocaleTimeString();
			} catch {
				return "";
			}
		}
		function toneClass(percent) {
			if (percent >= 90) return usage_module_css_default.barLow;
			if (percent >= 70) return usage_module_css_default.barWarn;
			return usage_module_css_default.barFill;
		}
		function TotalsRow(props) {
			const { totals } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: usage_module_css_default.statRow,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: usage_module_css_default.stat,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: usage_module_css_default.statValue,
							children: formatTokens(totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens + totals.outputTokens)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: usage_module_css_default.statLabel,
							children: t("usage.tokens.total")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: usage_module_css_default.stat,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: usage_module_css_default.statValue,
							children: formatTokens(totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: usage_module_css_default.statLabel,
							children: t("usage.tokens.input")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: usage_module_css_default.stat,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: usage_module_css_default.statValue,
							children: formatTokens(totals.outputTokens)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: usage_module_css_default.statLabel,
							children: t("usage.tokens.output")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: usage_module_css_default.stat,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: usage_module_css_default.statValue,
							children: formatTokens(totals.cacheReadTokens)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: usage_module_css_default.statLabel,
							children: t("usage.tokens.cacheRead")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: usage_module_css_default.stat,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: usage_module_css_default.statValue,
							children: formatTokens(totals.cacheWriteTokens)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: usage_module_css_default.statLabel,
							children: t("usage.tokens.cacheWrite")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: usage_module_css_default.stat,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: usage_module_css_default.statValue,
							children: formatTokens(totals.calls)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: usage_module_css_default.statLabel,
							children: t("usage.calls", { n: totals.calls })
						})]
					})
				]
			});
		}
		function balanceLine(provider) {
			if (provider.balance !== void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: usage_module_css_default.providerBalance,
				children: [
					provider.balance.currency.toUpperCase() === "CNY" ? "¥" : provider.balance.currency.toUpperCase() === "USD" ? "$" : "",
					provider.balance.totalBalance,
					provider.balance.currency.toUpperCase() !== "CNY" && provider.balance.currency.toUpperCase() !== "USD" ? " " + provider.balance.currency.toUpperCase() : ""
				]
			});
			if (provider.credential === "oauth") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: usage_module_css_default.muted,
				children: t("usage.oauth")
			});
			if (provider.credential === "none") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: usage_module_css_default.muted,
				children: t("usage.balance.noCredential")
			});
			if (!provider.supported) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: usage_module_css_default.muted,
				children: t("usage.balance.unsupported")
			});
			return null;
		}
		function ProviderRow(props) {
			const { provider, current } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: usage_module_css_default.providerRow,
				"data-dsh-part": "provider-row",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: usage_module_css_default.providerName,
					children: [provider.displayName, current === provider.provider && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: usage_module_css_default.currentBadge,
						children: t("usage.current")
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: usage_module_css_default.providerTokens,
					children: balanceLine(provider)
				})]
			});
		}
		/** The section component; the slot merges the face into these props. */
		function UsageSectionCard(props) {
			const { store, poll, refresh, settings } = props;
			const ui = (0, react.useSyncExternalStore)(store.subscribe, store.getSnapshot);
			const settingsSnapshot = settings.getSnapshot();
			const settingsValue = settingsSnapshot.value ?? {};
			const [tab, setTab] = (0, react.useState)("usage");
			const [refreshing, setRefreshing] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				poll();
				let timer;
				const start = () => {
					if (timer === void 0 && document.visibilityState === "visible") timer = window.setInterval(poll, SECTION_POLL_MS);
				};
				const onVisibility = () => {
					if (document.visibilityState === "visible") {
						poll();
						start();
					} else if (timer !== void 0) {
						window.clearInterval(timer);
						timer = void 0;
					}
				};
				start();
				document.addEventListener("visibilitychange", onVisibility);
				return () => {
					if (timer !== void 0) window.clearInterval(timer);
					document.removeEventListener("visibilitychange", onVisibility);
				};
			}, [poll]);
			const snapshot = ui.snapshot;
			const trendMax = (0, react.useMemo)(() => {
				if (snapshot === null) return 0;
				return Math.max(1, ...snapshot.usage.days.map((day) => day.totals.inputTokens + day.totals.outputTokens + day.totals.cacheReadTokens + day.totals.cacheWriteTokens));
			}, [snapshot]);
			const onRefresh = () => {
				setRefreshing(true);
				try {
					refresh();
				} finally {
					window.setTimeout(() => setRefreshing(false), 3e3);
				}
			};
			if (ui.status === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: usage_module_css_default.section,
				"data-dsh-plugin": "usage",
				children: t("usage.error", { error: ui.error ?? "" })
			});
			if (snapshot === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: usage_module_css_default.section,
				"data-dsh-plugin": "usage",
				children: t("usage.loading")
			});
			const current = snapshot.current;
			const currentProvider = snapshot.providers.find((provider) => provider.provider === current.provider);
			const planProviders = snapshot.providers.filter((provider) => provider.plan !== void 0 || provider.supported && provider.credential !== "none" && provider.credential !== "oauth");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: usage_module_css_default.section,
				"data-dsh-plugin": "usage",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: usage_module_css_default.header,
						"data-dsh-part": "header",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: usage_module_css_default.currentProvider,
							children: currentProvider !== void 0 ? `${currentProvider.displayName}${current.model !== void 0 && current.model !== "" ? " · " + current.model : ""}` : t("usage.noData")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								display: "flex",
								gap: 8,
								alignItems: "center"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: usage_module_css_default.muted,
								children: t("usage.updated", { time: formatTime(snapshot.updatedAt) })
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: usage_module_css_default.refreshBtn,
								onClick: onRefresh,
								disabled: refreshing,
								children: refreshing ? t("usage.refreshing") : t("usage.refresh")
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: usage_module_css_default.tabs,
						role: "tablist",
						"data-dsh-part": "tabs",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "tab",
							"aria-selected": tab === "usage",
							className: tab === "usage" ? `${usage_module_css_default.tab} ${usage_module_css_default.tabActive}` : usage_module_css_default.tab,
							onClick: () => setTab("usage"),
							children: t("usage.tab.usage")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "tab",
							"aria-selected": tab === "plans",
							className: tab === "plans" ? `${usage_module_css_default.tab} ${usage_module_css_default.tabActive}` : usage_module_css_default.tab,
							onClick: () => setTab("plans"),
							children: t("usage.tab.plans")
						})]
					}),
					tab === "usage" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: usage_module_css_default.card,
							"data-dsh-part": "today-card",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: usage_module_css_default.cardTitle,
									children: t("usage.today")
								}),
								snapshot.usage.today.totals.calls === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: usage_module_css_default.muted,
									children: t("usage.noData")
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TotalsRow, { totals: snapshot.usage.today.totals }),
								snapshot.usage.today.providers.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									"data-dsh-part": "provider-list",
									children: snapshot.usage.today.providers.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: usage_module_css_default.providerRow,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: usage_module_css_default.providerName,
											children: [snapshot.providers.find((provider) => provider.provider === row.provider)?.displayName ?? row.provider, current.provider === row.provider && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: usage_module_css_default.currentBadge,
												children: t("usage.current")
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: usage_module_css_default.providerTokens,
											children: [
												formatTokens(row.totals.inputTokens + row.totals.cacheReadTokens + row.totals.cacheWriteTokens + row.totals.outputTokens),
												" · ",
												t("usage.calls", { n: row.totals.calls })
											]
										})]
									}, row.provider))
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: usage_module_css_default.card,
							"data-dsh-part": "balance-card",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: usage_module_css_default.cardTitle,
									children: t("usage.balance")
								}),
								snapshot.providers.filter((provider) => provider.supported).length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: usage_module_css_default.muted,
									children: t("usage.balance.unsupported")
								}) : snapshot.providers.filter((provider) => provider.supported).map((provider) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderRow, {
									provider,
									current: current.provider
								}, provider.provider)),
								snapshot.providers.some((provider) => provider.error !== void 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: usage_module_css_default.errorLine,
									children: snapshot.providers.filter((provider) => provider.error !== void 0).map((provider) => `${provider.displayName}: ${t("usage.provider.error", { error: provider.error ?? "" })}`).join("；")
								})
							]
						}),
						snapshot.usage.days.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: usage_module_css_default.card,
							"data-dsh-part": "trend-card",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: usage_module_css_default.cardTitle,
									children: t("usage.trend")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: usage_module_css_default.trend,
									children: snapshot.usage.days.map((day, index) => {
										const total = day.totals.inputTokens + day.totals.outputTokens + day.totals.cacheReadTokens + day.totals.cacheWriteTokens;
										return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: index === snapshot.usage.days.length - 1 ? `${usage_module_css_default.trendBar} ${usage_module_css_default.trendBarToday}` : usage_module_css_default.trendBar,
											style: { height: `${Math.max(3, Math.round(total / trendMax * 100))}%` },
											title: `${day.date}: ${formatTokens(total)}`
										}, day.date);
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: usage_module_css_default.trendAxis,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: snapshot.usage.days[0]?.date.slice(5) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: snapshot.usage.days[snapshot.usage.days.length - 1]?.date.slice(5) })]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SettingsRow, {
							settings,
							snapshot: settingsSnapshot.status === "ready" ? settingsSnapshot : void 0,
							value: settingsValue
						})
					] }),
					tab === "plans" && (planProviders.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: usage_module_css_default.card,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: usage_module_css_default.muted,
							children: t("usage.plan.noPlan")
						})
					}) : planProviders.map((provider) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PlanCard, { provider }, provider.provider)))
				]
			});
		}
		function PlanCard(props) {
			const { provider } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `${usage_module_css_default.card} ${usage_module_css_default.planCard}`,
				"data-dsh-part": "plan-card",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: usage_module_css_default.planHead,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: usage_module_css_default.planName,
							children: [provider.displayName, provider.plan?.planName !== void 0 ? ` · ${provider.plan.planName}` : ""]
						})
					}),
					provider.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: usage_module_css_default.errorLine,
						children: t("usage.provider.error", { error: provider.error })
					}),
					provider.plan === void 0 || provider.plan.windows.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: usage_module_css_default.muted,
						children: t("usage.plan.noPlan")
					}) : provider.plan.windows.map((window) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: usage_module_css_default.windowRow,
						"data-dsh-part": "plan-window",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: usage_module_css_default.windowLabel,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: window.name ?? t(`usage.plan.windows.${window.key}`) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: window.percent !== void 0 ? `${window.percent >= 10 ? Math.round(window.percent) : window.percent.toFixed(1)}%` : "" })]
							}),
							window.percent !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: usage_module_css_default.bar,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: toneClass(window.percent),
									style: {
										width: `${Math.min(100, Math.max(0, window.percent))}%`,
										display: "block"
									}
								})
							}),
							window.resetsAt !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: usage_module_css_default.resetLine,
								children: t("usage.plan.reset", { date: new Date(window.resetsAt).toLocaleString() })
							})
						]
					}, window.key))
				]
			});
		}
		function SettingsRow(props) {
			const { settings, snapshot, value } = props;
			const disabled = snapshot === void 0 || !snapshot.writable;
			const bubbleMode = typeof value.bubbleMode === "string" && [
				"always",
				"change",
				"off"
			].includes(value.bubbleMode) ? value.bubbleMode : "always";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: usage_module_css_default.card,
				"data-dsh-part": "settings-row",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: usage_module_css_default.cardTitle,
					children: t("usage.config.title")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: usage_module_css_default.settingsGrid,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: usage_module_css_default.settingItem,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: value.enabled ?? true,
								disabled,
								onChange: (event) => {
									settings.set("enabled", event.target.checked);
								}
							}), t("usage.config.enabled")]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: usage_module_css_default.settingItem,
							children: [t("usage.config.pollIntervalSec"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "number",
								min: 30,
								max: 3600,
								value: typeof value.pollIntervalSec === "number" ? value.pollIntervalSec : 60,
								disabled,
								onChange: (event) => {
									const parsed = Number(event.target.value);
									if (Number.isFinite(parsed) && parsed >= 30 && parsed <= 3600) settings.set("pollIntervalSec", Math.round(parsed));
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: usage_module_css_default.settingItem,
							children: [t("usage.config.bubbleMode"), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								value: bubbleMode,
								disabled,
								onChange: (event) => {
									settings.set("bubbleMode", event.target.value);
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "always",
										children: t("usage.config.bubbleMode.always")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "change",
										children: t("usage.config.bubbleMode.change")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "off",
										children: t("usage.config.bubbleMode.off")
									})
								]
							})]
						})
					]
				})]
			});
		}
		//#endregion
		//#region src/client/index.ts
		async function usageFetch(path, method) {
			const response = await fetch(path, method === "POST" ? { method: "POST" } : {});
			if (!response.ok) throw new Error("usage " + path + " failed: " + response.status);
			return await response.json();
		}
		const usageApi = {
			overview: () => usageFetch("/api/dsh-usage/overview", "GET"),
			refresh: () => usageFetch("/api/dsh-usage/refresh", "POST")
		};
		/** Settings namespace the section edits (the host plugin registers it). */
		const USAGE_SETTINGS_NS = "dsh-usage";
		/** First-level nav position: directly below the Workshop section (order 150). */
		const SECTION_ORDER = 151;
		/** Required services. */
		const inject = [
			"slots",
			"locale",
			"connection",
			"settingsScope",
			"remote"
		];
		/**
		* Client plugin body: register dictionaries and seat the settings section.
		* The overview poll loop and the store live with the section component's
		* mount cycle, so no background traffic exists while the page is closed.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => {
				try {
					return ctx.locale.register(NS, {
						zh,
						en
					});
				} catch {
					return () => {};
				}
			}, "dsh-usage: dictionaries");
			const settingsScope = (ctx.get("webUiSettings") ?? ctx.settingsScope).bind({ namespace: USAGE_SETTINGS_NS });
			const store = createUsageStore().create();
			let pollSeq = 0;
			const poll = () => {
				const seq = pollSeq + 1;
				pollSeq = seq;
				usageApi.overview().then((snapshot) => {
					if (seq !== pollSeq) return;
					store.actions.setSnapshot(snapshot);
				}, () => {
					if (seq !== pollSeq) return;
					store.actions.setState("error", "usage.overview transport error");
				});
			};
			const refresh = () => {
				const seq = pollSeq + 1;
				pollSeq = seq;
				usageApi.refresh().then((snapshot) => {
					if (seq !== pollSeq) return;
					store.actions.setSnapshot(snapshot);
				}, () => {
					if (seq !== pollSeq) return;
					store.actions.setState("error", "usage.refresh transport error");
				});
			};
			const face = () => ({
				store,
				poll,
				refresh,
				settings: settingsScope
			});
			ctx.slots.inject("settings.section", () => {
				try {
					const unregister = ctx.slots.register({
						name: "settings.section",
						id: "dsh-usage",
						order: SECTION_ORDER,
						label: () => ctx.locale.bind(NS)("usage.title"),
						locale: NS,
						inject: face
					}, UsageSectionCard);
					return () => {
						unregister();
					};
				} catch {
					return () => {};
				}
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map