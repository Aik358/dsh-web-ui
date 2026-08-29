# dsh-usage

English | [中文](README.zh.md)

Usage statistics plugin for the dsh web GUI: per-provider balance and coding-plan quota detection plus a live token usage ledger, with a dedicated pet announcement bubble for the current provider.

## What it does

The plugin runs a host-side service and a first-level settings section (使用统计, directly below the Workshop entry):

- **Usage tab (用量)**: today's token totals per bucket (input / output / cache read / cache write, disjoint as the provider reports them) with per-provider and per-model breakdown, the last 30 days as a horizontal provider/model bar chart, and the balance of every configured provider. The ledger folds live `session/event` streams (`request/header` route attribution plus `assistant/message` usage) into `$DSH_HOME/dsh-usage/usage-ledger.json` with day-based retention; counting starts when the plugin is first enabled.
- **Plans tab (个人套餐)**: coding-plan quota windows for every configured provider that exposes one — used percent and reset time per window (Kimi For Coding 5h/week, GLM Coding Plan 5h/week, OpenCode Go rolling/weekly/monthly, MiniMax 5h/week, Codex / ChatGPT subscription 5h/week). Providers without a real plan or subscription (DeepSeek, ZenMux, Moonshot, OpenRouter, SiliconFlow) never appear on this tab; their balance shows on the usage tab instead.
- **Pet linkage**: the pet renders a dedicated announcement bubble (own glass style, tone accent, mini quota meter) showing the current provider's balance or tightest plan window. `bubbleMode` controls it: always / on change / off.
- Probes run entirely host-side on a poll cycle (default 60 s, manual refresh button); API keys are resolved through the harness credential seam (`llm-pi-ai` records, `apiKeyEnv` references) and never reach the browser.

Supported balance endpoints: DeepSeek, Moonshot (CN/international), OpenRouter, SiliconFlow (CN/international), ZenMux. Supported plan endpoints: Kimi For Coding, GLM Coding Plan (CN via open.bigmodel.cn, international via api.z.ai), OpenCode Go, MiniMax, Codex / ChatGPT subscription (OAuth access token from the pi-ai grant; a stale token shows an error until the harness next refreshes it). Providers without a programmatic endpoint (Qwen token plans, OpenCode Zen PAYG, Anthropic, OpenAI) are listed without facts.

## Install

Requires DSH 0.1.2-alpha.1 or later: the plugin is developed against the 0.1.2-alpha.1 DSH cohort and its `@deepseek-ai/*` runtime imports are provided by the host itself.

In your profile (e.g. `~/.dsh/profiles/web`):

```bash
pnpm add @linxin666/dsh-usage
```

and insert into `cordis.patch.yml` (or use the bundle patch):

```yaml
- insert:
    - id: usage
      name: '@linxin666/dsh-usage'
```

Restart `dsh web` for the host half; the client half applies on refresh. The section lives in `Settings -> Usage Statistics`.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch; off = no listeners, no probes, no routes |
| `pollIntervalSec` | `60` | Provider probe cycle (30-3600 s, hot-swappable) |
| `bubbleMode` | `always` | Pet announcement bubble: `always` (fresh every poll) / `change` (only when the value changes) / `off` |
| `retainDays` | `180` | Ledger retention in local days (7-730) |

## Known limitations

- Usage counting starts when the plugin is first enabled; historical sessions are not backfilled.
- OAuth-based routes (for example qwen OAuth grants) are detected as such but not probed; the plugin does not spend third-party OAuth budgets.
- A failed probe keeps the previous fact visible and reports the error line; providers may rate-limit aggressive polling.
- The pet bubble requires the dsh-pet plugin; without it the section works unchanged.
