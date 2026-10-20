# Implementation Plan - TASK_2026_707

## Inputs and constraints

- Requirements used: `context.md`, `code-audit.md`, `provider-usage-sources.md`, and the caller's six settled decisions and two-PR scope. No task description, design handoff, or prior plan is present. `CLAUDE.md` requires Electron first, shared-host compatibility and memory-safe scoped verification. This is architecture only; no production code is changed.
- The caller's choices override the research report's LiteLLM and xAI-management-key recommendations: use the existing OpenRouter catalog with bundled fallback; keep the management key out of both PRs.
- The repository instruction file is `CLAUDE.md`; the file search found no per-library `CLAUDE.md` in affected libraries. The code-symbol index returned zero symbols with unknown coverage, so specific source checks below use the supplied audit and targeted native search/AST reads.
- **Verified:** `rpc.types.ts:829,1191,3814,3904` carries typed methods and a runtime method manifest; `register-shared-rpc-handlers.ts:60-92` registers shared handlers. **Assumption:** the new library's exact Nx import alias and registration path follow nearby backend libraries; verify `tsconfig.base.json` and a comparable `project.json` before implementation.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Quota snapshot RPC and push already feed a single store | `libs/frontend/core/src/lib/services/plan-limits.store.ts:5-15`; `libs/shared/src/lib/types/rpc.types.ts:1191` | PR 1 changes readers and presentation without a second quota transport. |
| Rows are full width and show all windows | `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:199-302,427-456`; `provider-account-row.component.ts:257-300,445-489` | Replace row composition with a bounded tile; keep the existing account/owner grouping. |
| Claude generic and model weekly windows are separate | `libs/backend/auth-providers/src/lib/quota/readers/claude-plan-usage.reader.ts:122-151,239-256` | Presentation needs a deterministic duplicate rule, without falsifying source values. |
| Ollama reader only accepts request counts today | `libs/backend/auth-providers/src/lib/quota/readers/ollama-cloud-plan-usage.reader.ts:35-43,53-110,126-154` | Parse `/api/balance` for quota, `/api/usage` for counts/model detail. The old source comment must be corrected. |
| Antigravity has OAuth then local-server fallback | `libs/backend/auth-providers/src/lib/quota/readers/antigravity-plan-usage.reader.ts:69-78,85-159`; `antigravity-oauth-plan-usage.reader.ts:81-89` | Add headless CLI as third fallback and preserve failure cause. |
| Grok subscription reader intentionally excludes standalone API-key auth | `libs/backend/auth-providers/src/lib/quota/readers/grok-account-plan-usage.reader.ts:57-117` | Show local CLI usage for that account without inventing a subscription bar. |
| Claude ledger retains timestamps and four token classes | `libs/backend/agent-sdk/src/lib/session-stats/session-usage-ledger.ts:20-32,188-225` | Daily facts can be derived from ledger records. |
| Existing stats RPC removes date and is capped by caller | `libs/shared/src/lib/types/rpc/rpc-session.types.ts:359-428,481-501`; `libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts:83-114,394-465` | New aggregate RPC must scan all relevant history independently of the 200-session view cap. |
| OpenRouter pricing service already fetches and registers a catalog | `libs/backend/auth-providers/src/lib/providers/openrouter/openrouter-pricing.service.ts:40-74,92-116,148-194`; `libs/shared/src/lib/utils/pricing.utils.ts:18-64,122-158` | Reuse it as pricing primary; bundled rate card is offline fallback. |
| Electron registers auth providers before handlers | `apps/ptah-electron/src/di/phase-2-libraries.ts:206`; `phase-4-handlers.ts:91-105` | Analytics service registration belongs in the library phase, RPC handler in the handler phase. |

## Architecture decision

Create `libs/backend/usage-analytics` as a host-neutral `scope:extension`, `type:feature` library. It owns an aggregate service, source adapters, pricing resolution and a bounded disk cache. It depends through public indexes on agent-sdk's ledger reader, auth-providers' pricing/provider readers, and shared contracts. Neither agent-sdk nor auth-providers depends back on it. A small handler in `rpc-handlers` exposes `analytics:usageSummary` to `ClaudeRpcService`; Angular owns only view state and SVG presentation. **Assumption:** the existing public agent-sdk reader does not expose an uncapped dated-ledger iterator; inspect `session-stats-reader.service.ts:123-166,213-273` and add a narrow public scan method there rather than importing internals or using repeated `session:stats-batch` calls.

Reject putting aggregation in `session-analytics-state.service.ts`: it cannot recover dates or CLI costs from the current RPC. Reject putting it in auth-providers: transcript indexing is a separate responsibility and would turn quota service dependencies inward. Reject a new chart package: user chose in-house SVG and the audit found no existing dashboard chart package. The new library is one domain boundary, not one library per provider.

### PR 1: plan-limits strip

**Wireframe, desktop 3–4 equal-width tiles; mobile one or two columns**

```text
┌──────────────────────────┐
│ icon Provider   acct…7F  │
│      Plan badge       ↻   │
│ Weekly  73%  ███████░░░  │  ← most constrained valid window
│ 5h 18% · 2h  Model 0% · 6d│  ← other windows, horizontal wrap/scroll
│ 7.3B tokens · $12.40      │  ← one secondary line
│ provider API · near limit │  ← source and state; status pill on failure
└──────────────────────────┘
```

**Component and file contract.** `ProviderAccountCardComponent` (`libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts`) keeps header, discovery and owner mapping; a new `ProviderAccountTileComponent` (`.../provider-account-tile/provider-account-tile.component.ts` and `.html`) owns the uniform tile only. Move reusable presentation mapping out of the 838-line card into `.../provider-account-card/plan-tile-view.model.ts`; retire `provider-account-row.component.ts` once no caller remains. The tile accepts one owner snapshot plus the shared clock signal value and emits owner refresh. It never fetches. Use standalone, OnPush, `input.required()`, `output()`, `computed()` and `inject()` where needed. `PlanLimitsStore` (`libs/frontend/core/src/lib/services/plan-limits.store.ts:73-90`) remains the sole load/push/clock owner; no per-tile timer or observer. The card uses CSS grid `repeat(auto-fit, minmax(...))`, equal tile anatomy and constrained text so long notices do not determine row height. Preserve keyboard focus, accessible refresh label and progressbar name/value. Compact `Intl.NumberFormat` with a validated decimal-string conversion handles Codex lifetime tokens; never coerce beyond safe integer to a JS number.

**Selection rule.** Eligible primary windows are those with finite used percentage and known, future reset; choose highest used percentage, then nearest reset, then stable window ID. Keep expired/unknown windows as labeled chips without a fabricated value. For Claude, if generic weekly has `reset-usage-unknown` and a specific weekly model window exists, suppress the generic chip from the compact view and show its reset/status in the tile details tooltip; if generic weekly is valid, retain both because their scopes differ. If no eligible bar exists, reserve the same bar slot for a single precise status pill. Near-limit starts at 90% of any valid window, not only primary. Source `provider-api` versus `live-event`, resets, per-owner refresh, notices and Codex activity remain visible in chip, secondary line, or a details popover. OpenCode local token+cost and Ollama request counts stay secondary/tooltip facts. API-key Grok shows local CLI token/cost with `no subscription quota for API-key login`; absence of any local session gets a precise unavailable status.

**Reader files and contracts.** Modify `libs/backend/auth-providers/src/lib/quota/readers/ollama-cloud-plan-usage.reader.ts` and its spec. Define private Zod schemas for the two documented `/api/balance` variants and `/api/usage?range=7d&group_by=model`; validate finite `0..100` remaining percent, nonnegative USD, timestamps and bounded arrays/body. The normalized result is the existing `PlanUsageReading` with windows (`session`, `weekly`, or monthly allowance where that shape exists), `localUsage` for account requests/cost if representable, and model detail in an additive shared DTO field only if the existing DTO lacks a safe detail slot. For legacy limits, `usedPercent = 100 - remaining_percent`; for allowance, `(allowance_usd - balance_usd) / allowance_usd` only when allowance is positive, labeled monthly credit allowance, never session/weekly. Purchased `balance_usd` is an amount, never a percentage. `/api/usage` failure does not discard valid `/api/balance` windows; `/api/balance` failure does not turn counts into a quota bar. Reuse the reader's 5 s timeout, abort, redirect refusal, body cap and safe error logging. Handle 401/403 auth, 429 backoff per `Retry-After` on the next explicit refresh only, 503 unavailable. Respect the documented 10/min/user limit with at least a 60 s cache across tiles/refreshes.

Modify `libs/backend/auth-providers/src/lib/quota/readers/antigravity-plan-usage.reader.ts` and add `antigravity-cli-usage.adapter.ts` plus specs. Keep OAuth → local server → `agy -p /usage`. Spawn with `execFile` argument array, absolute executable resolution through existing CLI discovery if available, fixed timeout, max output bytes and no shell. The adapter alone parses text and maps only recognized lines to windows. Status detail codes (`no-oauth`, `no-local-server`, `cli-auth-required`, `cli-not-found`, `cli-parse-failed`, `cli-timeout`) should be represented as a typed optional reason in `libs/shared/src/lib/types/plan-limit.types.ts`; the tile maps each to plain action text. **Assumption:** exact `agy` text format is undocumented; implementer must capture a redacted logged-in sample and fixtures before accepting percentage parsing. Unknown output returns `cli-parse-failed`, never 0%.

Modify `libs/backend/auth-providers/src/lib/quota/readers/grok-account-plan-usage.reader.ts` or the service composer `.../quota/plan-usage.service.ts` (choose the existing local-usage composition point at implementation after reading it) so API-key identities retain `grok-session-usage.reader.ts:22-71` local usage even when subscription quota is unsupported. Do not add an xAI key field or call management billing. PR 1 changes no RPC method; existing `provider:getPlanLimits` and `planLimits:changed` carry the additive status/detail fields with shared Zod validation where RPC schemas are defined.

**PR 1 failure/test seam.** `ollama-cloud-plan-usage.reader.spec.ts`: legacy and allowance variants, missing windows, bad percentages/date, 401/429/503, independent balance/usage failure, redirect and timeout; `antigravity-cli-usage.adapter.spec.ts`: text fixtures, auth/not-installed/server/parse/timeout codes and no shell injection; `antigravity-plan-usage.reader.spec.ts`: fallback order; `grok-account-plan-usage.reader.spec.ts` and `plan-usage.service.spec.ts`: API-key local cost survives no quota; `provider-account-tile.component.spec.ts`: primary tie-break, Claude duplicate, 90%, exact large-number formatting, notices, refresh and keyboard/accessibility semantics. Keep existing provider card tests focused on owner mapping.

### PR 2: usage dashboard

**Wireframe**

```text
┌ Usage     [7d] [30d] [90d]           [Sessions] ┐
│ Raw token cost  $... estimated/partial            │
│ Processed | cached | uncached | output | savings   │
├───────────────────┬───────────────────────────────┤
│ Provider shares   │ Daily stacked area             │
│ Claude  ███  $/%/t│ [Cost] [Tokens]                │
│ Codex   ██   $/%/t│ legend + daily hover/focus     │
├───────────────────┴───────────────────────────────┤
│ By model [Model] [Day]    cost | share | tokens    │
│ Cost quality: reported / priced / unpriced         │
├───────────────────────────────────────────────────┤
│ Sessions: existing list, cards and detail modal    │
└───────────────────────────────────────────────────┘
```

**RPC contract.** Create `libs/shared/src/lib/types/rpc/rpc-analytics.types.ts`, export it from `rpc.types.ts` and the shared public index. Type and validate input at handler entry with Zod:

```ts
type UsageRangeDays = 7 | 30 | 90;
type CostSource = 'provider-reported' | 'model-priced' | 'unpriced';
interface UsageSummaryParams { range: UsageRangeDays; workspace?: string }
interface UsageFact {
  day: string; providerId: string; modelId: string;
  inputUncachedTokens: number; cacheReadTokens: number;
  cacheWriteTokens: number; outputTokens: number;
  costUsd: number | null; costSource: CostSource;
  requestCount?: number; sourceId: string;
}
interface UsageSourceStatus {
  sourceId: string; status: 'complete' | 'partial' | 'unavailable';
  reason?: string; scannedFiles?: number; malformedRecords?: number;
}
interface UsageSummary {
  version: 1; generatedAt: string; timeZone: 'UTC';
  fromDay: string; untilDayExclusive: string;
  facts: UsageFact[]; sources: UsageSourceStatus[];
  pricing: { source: 'openrouter' | 'bundled' | 'unavailable'; asOf: string | null };
}
```

The actual schema should use bounded IDs, ISO UTC day/date, nonnegative safe integers and finite nonnegative USD. `workspace` must be resolved and confined to an active workspace at the RPC boundary, following `session:stats-batch` (`session-rpc.handlers.ts:1235-1259`); do not use a caller supplied path in a filesystem scan before this check. `facts` are disjoint contributions: one source record is counted once, with stable source identity and dedup key. `costUsd=null` means unknown; never turn it into zero. Provider-reported spend has priority over model-priced estimate for the same contribution, so both are never summed. `sourceId` exposes provenance category, not a path or credential. `range` is complete UTC days including today, with explicit exclusive end; output caps should be defined after a 90-day fixture, with day×provider×model aggregation before transport.

**Aggregate placement and flow.** Create `libs/backend/usage-analytics/project.json`, `src/index.ts`, `src/lib/di/tokens.ts`, `registration.ts`, `usage-summary.service.ts`, `usage-source.types.ts`, `claude-ledger.source.ts`, `cli-session.source.ts`, `ollama-cloud-usage.source.ts`, `antigravity-usage.source.ts`, `usage-pricing.service.ts`, `usage-rollup-cache.ts` and focused specs. Do not make a separate class per CLI if their dated transcript projection shares a real shape; do keep provider-specific parsing in its existing provider lib. The aggregate service enumerates all relevant dated ledgers, groups by UTC day/provider/model and token class, merges optional provider daily/model spend, prices each contribution, and returns statuses for gaps. `ClaudeRpcService` calls `analytics:usageSummary`; add `AnalyticsUsageStore` at `libs/frontend/dashboard/src/lib/services/analytics-usage.store.ts` with request cancellation, 7/30/90 selection and computed derived totals. A new `UsageDashboardComponent`, `UsageKpiStripComponent`, `ProviderShareBarsComponent`, `DailyUsageAreaChartComponent`, `UsageBreakdownTableComponent` and `CostQualityPanelComponent` live under `libs/frontend/dashboard/src/lib/components/usage-dashboard/`. `AnalyticsCardComponent` switches between Usage and Sessions while retaining `SessionAnalyticsStateService`, `SessionStatsCardComponent`, list, detail modal and existing session RPCs. SVG components take normalized series/labels via required inputs, use one static SVG per chart, no recurring timer/observer per point, and expose equivalent table/accessible text for keyboard and screen reader users. Source statuses and unknown cost remain visible in the UI.

**Source boundaries.** Extend agent-sdk's public `SessionStatsReaderService` with an uncapped, dated usage projection drawn from `session-usage-ledger.ts`; reuse its transcript and subagent dedup semantics (`session-usage-aggregator.ts:187-304`). No transcript content crosses into the analytics cache. Codex, OpenCode and Grok adapters must use existing local session readers and preserve timestamps; OpenCode local cost is a reported local estimate, labeled model-priced unless provider billing evidence exists. Ollama `/api/usage` supports only 24h/7d/30d, so 90-day history needs persisted daily observations from prior reads; a fresh install displays 30-day maximum coverage and `partial` for the older span. Its top-ten model groups plus `remainder` must retain the remainder as an `unknown model` fact so totals reconcile. Antigravity quota text is not spend history; include dated local CLI usage only where a verified parser exists, otherwise show `unavailable` with an explanation. Do not label a quota percentage as usage cost. For any source lacking dated token classes, keep available cost/request facts and mark token coverage partial rather than synthesizing token counts.

**Pricing.** `usage-pricing.service.ts` receives the existing `OpenRouterPricingService` through the auth-providers public index (`src/index.ts:116`), maps provider-native IDs to OpenRouter slugs using the explicit alias strategy of `providers/local/ollama-cloud-metadata.service.ts`, then uses `findModelPricing` from the bundled rate card when catalog fetch/lookup fails. Keep the provider qualifier in the key to avoid cross-provider collisions; never rewrite canonical catalog entries. Reuse the four-class cost formula in `session-usage-aggregator.ts:252-299`, including cache-write rates; cache savings equals cached-input tokens priced at the full uncached input rate minus their actual cache-read cost, only for priced facts with both rates. Unknown savings remain unknown. Historical values are estimates using the rate version at computation time. Label the top line `Raw token cost (estimate / known lower bound)` when partial or unpriced sources exist; provider-reported figures still describe usage USD, not subscription cash paid.

**Persistence and performance.** On-disk daily rollup is chosen over full on-demand scan. Cache lives in a host-neutral application data directory supplied by an existing platform storage port (verify port; add a small port only if no suitable abstraction exists). Store source file identity, byte length, mtime, last valid byte offset, price-catalog version, UTC day aggregates and a format version; write atomically and tolerate corrupt/missing cache by rebuilding. Never cache credentials or raw prompts. Resume append-only JSONL; rescan changed/truncated files; dedup moved copies by stable session/message identity. Retain at least 92 days and refresh recent/current buckets. Target: 90-day warm request ≤2 s and cold scan ≤10 s on a fixture of 10k session files / 1M usage records, with cancellation and bounded concurrency; report `partial` on timeout rather than fake completeness. **Assumption:** port and file-identity facilities exist; inspect platform-core storage contracts before implementation and choose a path within its allowed app-data root.

**RPC/wiring.** Add `analytics:usageSummary` to `libs/shared/src/lib/types/rpc.types.ts` registry and method manifest, and `analytics:` to the runtime `ALLOWED_METHOD_PREFIXES` only if not already present. Add `libs/backend/rpc-handlers/src/lib/handlers/analytics-rpc.handlers.ts` and its export in `handlers/index.ts`; register it through `register-shared-rpc-handlers.ts:60-92`. Register the analytics library service in Electron, VS Code and CLI composition roots via each phase-2 library registration; update each affected `phase-4-handlers.ts`, `expected-resolvable.ts`, `container.smoke.spec.ts`, `rpc-surface.spec.ts` and `surface-composition.spec.ts` as required by the RPC surface contract. The Electron path is acceptance priority; shared changes must keep other hosts compiling. No direct transport call from Angular.

**Failure/test seam.** Add `usage-summary.service.spec.ts` for daily/provider/model aggregation, dedup, partial sources and mixed cost provenance; `claude-ledger.source.spec.ts` for range edges and uncapped pagination; each CLI adapter spec for missing/malformed timestamps; `ollama-cloud-usage.source.spec.ts` for nested cached tokens, top-ten remainder, 30-day/90-day gap and HTTP errors; `usage-pricing.service.spec.ts` for OpenRouter/bundled fallback, provider-qualified alias, unpriced model and cache savings; `usage-rollup-cache.spec.ts` for append, truncate, rename, corrupt cache and atomic recovery; `analytics-rpc.handlers.spec.ts` for schema, workspace confinement, cancellation and response cap. Angular store/chart specs verify 7/30/90 selection, cost/tokens toggle, empty/partial data, SVG stack totals, model/day toggle, keyboard access and preserved Sessions route/detail. Add a 90-day performance fixture at the service boundary; do not use e2e for it.

## Integration architecture

PR 1 flow: owner discovery → existing `PlanUsageService` readers → snapshot RPC/push → `PlanLimitsStore` → tile view model → tile grid. Credentials terminate inside readers. Failure cause travels as a typed reason, not raw HTTP/CLI text. PR 2 flow: persisted transcript/API sources → bounded dated facts → pricing/provenance and daily rollup → analytics RPC → Angular store → KPI/chart/table/quality panel. Sources can fail independently. A failed source is visible and excluded from known totals; remaining sources still render. Cached prior observations may be used with `partial` status and age; UI never calls them current provider data.

## Architecture-level quality requirements

- Functional: preserve every current account/window reset, near-limit alert, source badge, per-owner refresh, OpenCode local usage, Codex activity, Ollama requests, notices and Sessions detail. Only compact their placement. The 90-day dashboard states which sources have incomplete history.
- Performance: one shared plan clock; no item-level polling/observers. Quota API polling respects Ollama's 10/min limit. Warm 90-day aggregate ≤2 s, cold fixture ≤10 s; aggregate before RPC and cap response size.
- Security: Zod on all external bodies and RPC params/results, bounded response/process output, `execFile` argument array, fixed timeouts, redirect refusal with bearer key, no credential or transcript text in cache/log/UI. Scope workspace paths before filesystem access.
- Maintainability: use public lib indexes; per-lib tsyringe registration; split existing large frontend files; SVG chart contains only geometry and presentation. No duplicate legacy dashboard implementation after the new Usage tab is mounted.

## Team-leader handoff: file-disjoint execution groups

The following groups are separate ownership sets. The team leader may refine scheduling; shared contracts must land before their consumers. Commands are recommended for later executors, **not run during this architecture task**. Run one heavy check at a time, `--parallel=1` for Nx and `--maxWorkers=2` for Jest; never build/serve/e2e/workspace-wide.

| PR / owner | Files (new or changed) | Executor | Scoped verification |
| --- | --- | --- | --- |
| 1 / quota readers | `libs/backend/auth-providers/src/lib/quota/readers/{ollama-cloud-plan-usage.reader.ts,antigravity-plan-usage.reader.ts,antigravity-cli-usage.adapter.ts,grok-account-plan-usage.reader.ts}` and matching specs; `quota/plan-usage.service.ts` and spec if needed | backend-developer | `npx nx test auth-providers --parallel=1` or changed Jest specs with `--maxWorkers=2` |
| 1 / DTO | `libs/shared/src/lib/types/plan-limit.types.ts` and contract spec if additive reason/model detail is required | backend-developer | `npx nx test shared --parallel=1`; typecheck dependent Electron and VS Code hosts later |
| 1 / tile | `libs/frontend/dashboard/src/lib/components/provider-account-card/{provider-account-card.component.ts,plan-tile-view.model.ts}`, new `provider-account-tile/*`, retired `provider-account-row.component.ts`, matching specs; `libs/frontend/core/src/lib/services/plan-limits.store.ts` only if typed detail propagation needs it | frontend-developer | `npx nx test dashboard --parallel=1`; `npx nx test frontend-core --parallel=1` if changed |
| 2 / contract | `libs/shared/src/lib/types/rpc/{rpc-analytics.types.ts}`, `libs/shared/src/lib/types/rpc.types.ts`, shared public index and specs; allowlist source if `analytics:` is new | backend-developer | `npx nx test shared --parallel=1` |
| 2 / ledger | `libs/backend/agent-sdk/src/lib/session-stats/{session-stats-reader.service.ts,session-usage-ledger.ts}` only where public dated scan is needed; public index and focused specs | backend-developer | `npx nx test agent-sdk --parallel=1` |
| 2 / aggregate | New `libs/backend/usage-analytics/{project.json,src/index.ts,src/lib/**}`; `tsconfig.base.json` alias if required; source adapter, pricing/cache specs | backend-developer | `npx nx test usage-analytics --parallel=1`; `npx nx typecheck usage-analytics --parallel=1` |
| 2 / RPC composition | `libs/backend/rpc-handlers/src/lib/handlers/{analytics-rpc.handlers.ts,index.ts}`, `register-shared-rpc-handlers.ts`, handler spec and `rpc-allowlist.spec.ts`; three host DI phase files and listed smoke/surface/expected-resolvable specs | backend-developer | `npx nx test rpc-handlers --parallel=1`, then scoped Electron/VS Code/CLI smoke and surface specs with Jest `--maxWorkers=2`; typecheck dependent hosts sequentially |
| 2 / dashboard | `libs/frontend/dashboard/src/lib/components/analytics-card/{analytics-card.component.ts,analytics-card.component.html}`, new `usage-dashboard/*`, `services/analytics-usage.store.ts`, matching specs; retain session components | frontend-developer | `npx nx test dashboard --parallel=1`; `npx nx typecheck dashboard --parallel=1` |

## Risks

- Antigravity headless text has no documented format; parser must fail closed and fixtures require a logged-in machine.
- Provider histories are uneven: Ollama API offers at most 30 days, while a fresh install has no earlier observations; Antigravity may lack dated usage entirely. Coverage must remain explicit.
- OpenRouter current prices can revise past estimates, and provider usage USD can include subscription-covered consumption. Never describe raw cost as cash billed.
- Transcript volume and copied/moved sessions can inflate totals; rollup invalidation and stable dedup are acceptance-critical.
- PR 2 shared RPC/DI changes affect Electron, VS Code and CLI even though only Electron UI is targeted; shared-host compilation is a gate.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Two PRs, quota first | Caller decision; independent stores in `plan-limits.store.ts:5-15` and `session-analytics-state.service.ts:394-465`. | Yes |
| Uniform tile with one primary bar | Caller requirement; current row renders all windows in `provider-account-row.component.ts:257-300`. Keep all data in chips/details. | Yes |
| Hide only stale Claude generic weekly when a model weekly exists | Generic may be `reset-usage-unknown`, while model weekly is valid (`claude-plan-usage.reader.ts:122-151,239-256`). Alternative showing both in primary area preserves confusion. | Yes |
| Ollama `/api/balance` determines plan windows | Supplied provider research §2; current reader has counts only (`ollama-cloud-plan-usage.reader.ts:35-43`). Alternative deriving percent from request counts has no denominator. | Yes |
| Grok CLI usage without new key | Caller decision; subscription reader excludes API-key auth (`grok-account-plan-usage.reader.ts:57-117`), local reader exists (`grok-session-usage.reader.ts:22-71`). | Yes |
| New host-neutral analytics library with disk rollup | Existing ledger has dated records but frontend's 200-session path loses day (`session-usage-ledger.ts:188-225`; `session-analytics-state.service.ts:83-114`). Alternative on-demand full 90-day scans risks UI latency. | Yes, with cache migration |
| OpenRouter then bundled prices, no LiteLLM | Caller decision; service and rate card exist (`openrouter-pricing.service.ts:40-74`; `pricing.utils.ts:18-64`). | Yes |
| SVG chart, existing Sessions view retained | Caller decision; no existing chart dependency in code audit §D; existing session component tree in audit §A. | Yes |

## Lane-introduced constraints

- Research marked Antigravity print text format unverified; plan requires a fixture experiment before numeric parsing and never treats unknown text as zero.
- Research verified Ollama cached input is included in `input_tokens`; normalize to disjoint uncached/cache-read classes to prevent double counting.
- Research verified Ollama `groups` truncation and `remainder`, 30-day maximum, and 10 requests/min/user; aggregate/status/cache account for each.
- Code audit established the 200-session cap and lack of dated/provider dimensions in current stats RPC; new aggregate cannot claim complete history through that path.

## Proposed Removals

- Replace the obsolete full-width `ProviderAccountRowComponent` after tile parity tests pass; no user capability is removed. Remove only obsolete layout CSS and the old analytic session-card landing arrangement. Session list/cards/detail remain under Sessions.
- Remove the outdated assertion in the Ollama reader source comment that no quota API exists; `/api/balance` is now the documented source.

## Open questions

- **RESOLVED (orchestrator, 2026-10-20):** `agy -p /usage` (binary `%LOCALAPPDATA%/agy/bin/agy`, run with
  argument array, never through Git Bash — MSYS rewrites `/usage` to a path) prints tab-separated lines:
  `<group>\t<window label>\t<remaining %>\t<reset ISO-8601 UTC>`. Captured sample:
  ```text
  Gemini Models	Weekly Limit Remaining	100%	2026-10-27T00:08:58Z
  Gemini Models	Five Hour Limit Remaining	100%	2026-10-20T05:08:58Z
  Claude and GPT models	Weekly Limit Remaining	100%	2026-10-27T00:08:58Z
  Claude and GPT models	Five Hour Limit Remaining	100%	2026-10-20T05:08:58Z
  Gemini 4 Argon	Gemini 4 Argon Weekly Limit	100%	2026-10-27T00:08:44Z
  ```
  Values are REMAINING percent: usedPercent = 100 - value. A line that does not match exactly 4 tab
  fields with a 0..100 percent and a valid ISO date is rejected (fail closed). Use this as the parser fixture.
- **Assumption, implementation check:** which existing platform storage port supplies an app-data root for the rollup. If none exists, add a minimal port with adapters for all hosts before wiring the aggregate.
- **Assumption, implementation check:** which CLI session sources expose dated token classes through public indexes. Sources without them remain explicitly partial; do not invent historical rows.
- No user decision is needed to start either PR under the settled scope. xAI management billing is a future enhancement, outside both PRs.
