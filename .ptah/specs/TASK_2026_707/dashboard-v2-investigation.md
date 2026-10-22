# Dashboard v2 investigation — TASK_2026_707

Read-only. Screenshot checked: `.ptah/specs/TASK_2026_707/visual/r3/full-1920x1080-dark.png` (1920×1080, dark). No builds, tests, or git writes. Ptah symbol tools were not exposed in this session (`search_tool` query `ptah` returned no tools); citations are from native search and file reads.

## Answers

### 1. Route cards

**What renders them.** Both buttons are inline in `DashboardGridComponent`, not separate components.

- Tribunal: `libs/frontend/dashboard/src/lib/components/dashboard-grid/dashboard-grid.component.html:18-46`. Click calls `conveneTribunal()` → `appState.setCurrentView('tribunal')` (`dashboard-grid.component.ts:83-85`).
- Command Center: same file `:48-79`, wrapped in `@if (isElectron)` (`:48`). `isElectron` is `VSCodeService.isElectron` (`dashboard-grid.component.ts:75-77`). Click calls `openCommandCenter()` → `setCurrentView('command-center')` (`:87-89`).

The Analytics route mounts this grid for every host: `apps/ptah-extension-webview/src/app/app.routes.ts:121-126` (`path: 'analytics'`, `DashboardGridComponent`).

**Removing them affects**

| Surface | What breaks or changes |
| --- | --- |
| Electron Analytics page | The two full-width buttons go away. Nothing else on the grid depends on them. |
| VS Code webview | Same component, so the Tribunal button disappears there too. The Command Center button is already absent (`@if (isElectron)`). |
| Jest | `dashboard-grid.layout.spec.ts:41` asserts `aria-label="Convene a Tribunal"`; `:86` asserts `Open Command Center`. |
| Electron showcase | `apps/ptah-electron-e2e/src/showcase/dashboard-tour.scene.ts:23` and `:107` address the Tribunal button and explicitly do not click it (paid run). `tribunal-tour.scene.ts:139-140` also looks up `button` / `[aria-label="Convene a Tribunal"]` (that scene can match the Setup hub control too; see below). |
| Setup hub (do not remove) | `libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts:815` and `:872` are a second pair of the same labels. `setup-hub.component.spec.ts:110` covers the Command Center card. |
| Chat input | `libs/frontend/chat/.../chat-input.component.ts:173` is a separate "Open Command Center" control. |

**Already in the top nav**

- Electron title tabs (`electron-shell.component.ts:174-221`): Chat, **Voice** (`aria-label="Voice"`, view `command-center`, `:177-181`), Apps, Tasks, **Tribunal** (`:210-217`), Analytics, Setup hub. Voice is the Command Center. Spec: `electron-shell.config-gate.spec.ts:209` ("Chat, Voice, Apps, Tasks, Tribunal, Analytics, Setup hub").
- VS Code chrome (`app-shell.component.html:121-184`, hidden when `isElectron` at `:118`): Dashboard (`title="Session Analytics"`), Thoth, **Tribunal** (`:177-184`, comment says Electron has it in the global navbar), Tasks, Marketplace. No Voice / `command-center` control in `app-shell.component.ts` (search returned no matches).

Removing the two dashboard buttons does not remove a route. Tribunal stays one click away on both hosts. Voice stays one click away on Electron only. VS Code never had a Voice tab.

### 2. "Your harness is short"

**Component.** `HarnessCardComponent`, selector `ptah-harness-card`, mounted at `dashboard-grid.component.html:83`. Title and body: `harness-card.component.ts:97-137`. It renders only when `blocked().count > 0` (`:97`). The button "Move these aside…" (`:129-136`, `data-testid="harness-card-repair"`) sets `repairOpen` and mounts `HarnessRepairDialogComponent` (`:141-145`). The card itself sends no repair RPC (`:50-58`).

**Data.** `inject(HarnessHealthStore)` from `@ptah-extension/marketplace/services` (`harness-card.component.ts:10`, `:150`). Blocked set is `harnessBlockedPaths()` — the single `missing ∩ foreign` derivation in `@ptah-extension/shared` (`:33-38`). Cold pull only; the store is filled by the `harness:healthChanged` push registered in `MESSAGE_HANDLERS` (`:73-80`). The reconciler text points at this card: `libs/backend/harness-sync/.../harness-reconciler.service.ts:965` and `libs/shared/.../harness-blocked-wording.ts:107`, `:307`.

**Marketplace already has the same data, not the same notice.**

- Badge: `HarnessHealthBadgeComponent` (`libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts:55`). Same store (`:207`) and same `harnessBlockedPaths` (`:20-22`, computed `:250`).
- Mount: `skills-section-header.component.ts:43`, on the installed skills page (`installed-skills-page.component.ts` header "Skills & Plugins"). The badge comment at `harness-card.component.ts:23-26` still says `plugins-surface.component.ts:70` is the only mount; that is stale. The live mount is the skills header.
- Popover shows per-target rows and, when `blocked().count > 0`, `<ptah-harness-blocked-paths>` (`harness-health-badge.component.ts:167-169`). Its action is **Reconcile now** (`:187-199`, `data-testid="harness-reconcile"`), not "Move these aside…". The shared blocked-paths prose takes a different `reconcileStep` on the dashboard card (`harness-card.component.ts:165-178`).

**Where it should go if the dashboard card is removed.** Keep it on the installed skills header, inside the existing badge popover (already the page the Overview "Review" link targets: `skills-section-header.component.ts:18-19`). Add the dashboard's button there: open `HarnessRepairDialogComponent` with the same `blocked()` input. Needs: `HarnessHealthStore` (already injected), `harnessBlockedPaths` (already computed), `HarnessRepairDialogComponent` (already used by the card), and the card's `RECONCILE_STEP` string so the shared paragraph still names the control. Do not add a second blocked-set function.

`SkillSelectionCard` sits between the harness card and analytics (`dashboard-grid.component.html:85`) and stays silent once the workspace has been asked about skills (`dashboard-grid.component.ts:28-32`). It is absent from the screenshot for that reason.

### 3. Plan limits — why two tiles

The card does not filter owners. `ProviderAccountCardComponent.owners` returns every `snapshot.owners` entry, selected provider first (`provider-account-card.component.ts:176-188`). Two tiles means `provider:getPlanLimits` returned two owners.

**Dashboard path**

1. Card effect: `planLimits.load({ providerId: auth.persistedProviderId() })` (`provider-account-card.component.ts:207-209`).
2. `PlanLimitsStore.load` calls RPC `provider:getPlanLimits` (`libs/frontend/core/src/lib/services/plan-limits.store.ts:169-176`). With no registered surface scope the body is only `{ providerId }` — no `sessionIds`, no `ownerKeys` (`:218-230`).
3. Handler `provider-rpc.handlers.ts:262` → `PlanLimitsSnapshotService.assemble` (`plan-limits-snapshot.service.ts:143-155`).
4. Owners come from `PlanLimitOwnerDiscoveryService.discoverTargets` (`plan-limit-owner-discovery.service.ts:219-304`). Each `read` target goes through `PlanUsageService.getOwnerSnapshot` (`plan-limits-snapshot.service.ts:190`).

Discovery sources, in order (`plan-limit-owner-discovery.service.ts:8-31`, `:237-277`):

| Source | Who gets a tile | Gate |
| --- | --- | --- |
| Selected provider | The active auth route only | `claude-cli` needs a live native session, else "no open session" (`:346-365`). `anthropic` API key is `unsupported-auth`, never read (`:367-373`). `openai-codex` reads Codex home (`:375-379`). `ollama-cloud` / `opencode-go` / `opencode-zen` read the stored key (`:160-165`, `:381-385`). Anything else is `provider-unsupported` and still listed (`:387-393`). |
| CLI stores | Installed `opencode`, `antigravity`; `grok` only if `hasGrokCliLogin()` (`:396-414`, `CLI_STORE_CLIS` `:166`) | `detectAll()` must report `installed` (`:661-666`). Grok also needs `~/.grok/auth.json` (or `GROK_HOME`) with a non-`api_key` credential (`:168-191`). |
| Sessions | Requested session ids | Dashboard omits them. |
| Lanes | Installed `codex` only (`:430-441`) | Same `detectAll()`. |
| Ptah CLI | Enabled agents whose `providerId === 'ollama-cloud'` (`:479-493`) | Does not wait on CLI detection. Missing key → label `(key unavailable)` and `unknownReason: 'missing-api-key'` (`provider-owner.resolver.ts:483-515`). |
| Ledger | `ownerKeys` plus owners with active evidence, if `planOwnerRead` knows them (`:501-518`) | Unknown identity dropped (`:507`). |

A source that throws or misses its deadline is dropped alone (`:620-649`). CLI-store uses `LIMIT_LOOKUP_DEADLINE_MS` = 3000 (`evidence-precedence.ts:17`) and **awaits** `detectAll()` inside that budget (`discovery.service.ts:255-257`). The codex lane source has 12000 ms (`SLOW_LIMIT_LOOKUP_DEADLINE_MS`, `evidence-precedence.ts:23`) but also awaits detection (`:259-264`). The Ptah CLI source does not.

Readers that can return windows (`plan-usage.service.ts:155-168`): Claude session probe, Codex, Ollama Cloud (`/api/balance` reader), Antigravity, OpenCode local, OpenCode Go, Grok account, plus local fallbacks for OpenCode Go and Grok session spend. `planOwnerRead` (`plan-owner-read.ts:71-126`) returns `null` for every other provider, and discovery then omits that owner (`:589-590`).

The screenshot's two tiles match two known statuses, not a hidden-tile filter:

- Claude · 85a3, "(owner unknown) (key unavailable)", pill "No plan limits (API key)". The pill is `unsupported-auth` with no windows (`plan-tile-view.model.ts:633-646`). The parenthetical is the owner label, split by `tileTitleLines` (`plan-tile-view.model.spec.ts:841-847`). `(key unavailable)` is written only when the secret read returns null (`provider-owner.resolver.ts:475-479` and `:510-515`).
- Ollama Cloud · cd23, same qualifier, pill "No API key configured", action "Add key". That sentence is `unsupported-config` for `ollama-cloud` (`plan-tile-view.model.ts:545-551`, `:647-648`). "Add key" opens Settings → Providers (`provider-account-card.component.ts:225-230`). A missing key never reaches the network (`plan-owner-read.ts:64-68`).

**`ptah_agent_list` path (different enumeration, same readers)**

- Tool text is built in `mcp-response-formatter.ts:1787-1839`, which appends `formatPlanLimitsSection` (`agent-limit.formatter.ts:395`).
- Lookup is `agent.list()` then `agent.limits(rows)` (`lane-plan-limits-rpc.handlers.ts:8-10`, `:123-137`). `getLaneLimits` is `LaneLimitLookupService.lookup` (`ptah-api-builder.service.ts:762`).
- `LaneOwnerResolver.ownerForLane` (`lane-owner.resolver.ts:107-121`): codex → Codex home; opencode → `ownerForOpenCode(model)` (Go subscription when the store has a Go key); antigravity and grok → CLI store. Grok is **not** gated on `hasGrokCliLogin()` here (`:116-119`). Ptah CLI on Ollama Cloud uses the agent key (`lane-limit-lookup.service.ts:228-229`). Then `planOwnerRead` + `PlanUsageService.getOwnerSnapshot` (`:192-200`) — the same read as the dashboard.
- Copilot, cursor, and pi have no owner rule (`lane-owner.resolver.ts:120-121`, spec `:132`). Lookup returns `no-owner` (`lane-limit-lookup.service.ts:261`). They can still appear in the list as lanes with unknown limits.
- Electron also exposes the same rows over RPC `agent:getLanePlanLimits` (`lane-plan-limits-rpc.handlers.ts:67-70`), capability `lanePlanLimits` (`apps/ptah-electron/src/rpc-host-profile.ts:46-48`). The dashboard does not call it. VS Code must not (`apps/ptah-extension-vscode/src/di/expected-absent.ts:77-80`).

`SYSTEM_CLI_TYPES` (`agent-process.types.ts:74-82`): codex, copilot, cursor, antigravity, opencode, pi, grok. Ptah CLI agents are separate.

**Per provider**

| Provider | Dashboard discovery | agent_list | Why the screenshot tile is missing or empty |
| --- | --- | --- | --- |
| Claude subscription | Only a `claude-cli` route with an open native session, or a later session/ledger owner (`discovery.service.ts:346-365`, `plan-owner-read.ts:80-92`) | A ptah-cli Claude lane only after a run recorded `accountInfo()` (`lane-owner.resolver.ts:19-20`, `:172-179`) | Selected route is the API-key owner, so the subscription reader never runs. |
| Claude API key | Yes, when that route is selected. Status `unsupported-auth`, no windows (`plan-owner-read.ts:76-78`) | Not a lane | Present: "No plan limits (API key)". An API key has no plan windows by design. |
| Codex | Yes if `detectAll` says `codex` installed (`discovery.service.ts:430-441`). Reader: `createCodexPlanUsageReader` | Yes, Codex home (`lane-owner.resolver.ts:110-111`) | Not in this snapshot. Dropped if detection said not installed, or the lane source missed its deadline while awaiting `detectAll`. |
| Grok | Yes only if installed **and** `hasGrokCliLogin()` (`discovery.service.ts:410-414`) | Yes, unconditional CLI-store owner (`lane-owner.resolver.ts:116-119`). Reader: `createGrokAccountPlanUsageReader` plus session local reader | The login-file gate is stricter than agent_list. A logged-in Grok lane can show Weekly % in the list and still never be discovered for the card. |
| OpenCode Go | Not its own tile. Installed `opencode` → `ownerForOpenCode()` (`discovery.service.ts:403-407`). Go vs local is inside that owner (`lane-owner.resolver.ts:11-12`). Readers: `opencode-go` and `opencode` | Same owner, from the opencode lane | Not in this snapshot. Same detection/deadline drop as Codex. One OpenCode owner covers Go and the CLI store. |
| Ollama Cloud / Glm | Enabled ollama-cloud Ptah CLI agents, and the selected provider if it is `ollama-cloud` | Same agent key (`lane-limit-lookup.service.ts:228-229`). Reader: `createOllamaCloudPlanUsageReader` | Present, but this Electron's secret read returned null, so the tile is "No API key configured" and `/api/balance` is never called. agent_list on another process can still hold the key and print real %. |
| Antigravity | Yes if installed (`CLI_STORE_CLIS`, `:166`, `:404-406`). Reader: `createAntigravityPlanUsageReader` | Yes (`lane-owner.resolver.ts:114-115`) | Not in this snapshot. Same detection/deadline drop. |
| Copilot | Never. `planOwnerRead` returns null (`plan-owner-read.ts:119-125`) | Listed; lookup is `no-owner` | No reader. A tile would have no %. |
| Cursor | Never | Listed; lookup is `no-owner` | No reader. |

**Smallest correct change.** Stop using the narrower discovery list as the dashboard's roster. Have `discoverTargets` (or the snapshot service) take the same rows `agent.list()` already returns and read them with `LaneLimitLookupService.lookup`, which already shares `planOwnerRead` and `PlanUsageService`. Keep the selected-provider owner so the Claude API-key tile stays. Drop the `hasGrokCliLogin()` gate so Grok matches the lane resolver; the Grok reader already reports `no-usage-source` for API-key auth (`lane-owner.resolver.ts:117-118`). Do not add Copilot, Cursor, or pi until a reader exists. Give the detection-dependent sources their own deadline that does not include `detectAll()` time, or the 3s / 12s budgets will keep swallowing Codex, OpenCode, and Antigravity while the Ptah CLI source (Ollama) still returns — the shape of this screenshot.

This was not re-run against the live Electron log. The "detection timed out" explanation is inferred from the source graph plus a snapshot that contains an Ollama owner (detection-independent) and no Codex/OpenCode/Grok/Antigravity owner (detection-dependent). A debug line `[PlanLimitOwnerDiscovery] source timed out` would confirm it.

### 4. Usage section inventory

Host: `analytics-card.component.html:1-3` heading "Usage", then `UsageDashboardComponent`. RPC: `analytics:spendSummary` with `{ range, workspace? }` (`analytics-usage.store.ts:122-125`). Ranges: 7d, 30d, 90d (`:22-29`). Default 30d.

Preserve every label below. Screenshot values are the 30-day render, not constants.

**Chrome**

- Date span (`usage-dashboard.component.html:4-6`), e.g. "Sep 21 – Oct 20, 2026".
- Range buttons 7d / 30d / 90d (`:9-22`).
- Refresh (`:24-42`), "Loading usage..." (`:51`), "Could not load usage data." plus Retry (`analytics-usage.store.ts:39`, template `:54-64`), "Refresh failed; showing the last loaded data." (`:78`), "Updating usage... (showing the last loaded data)" (`:86`).
- Empty: "No usage in this range. Start a chat to see provider usage, tokens and cost." (`:95-97`).

**Left column — cost summary** (`usage-cost-summary.component.ts`)

- "Raw token cost"; total `$3.82` in the shot; `≥` prefix and tooltip "{n} facts unpriced, {tokens} tokens" when any fact is unpriced (`:123-138`).
- Badge "partial" with tooltip of incomplete sources (`:42-49`, `:145-151`).
- Footnote "* estimated at API rates; not your bill" (`:52-54`).
- One line per incomplete source: `{providerDisplayName(sourceId)}: {reason ?? status}` (`:57-68`). Shot: "Codex: partial", "Antigravity: No dated local model usage history is available", "Ollama Cloud: No dated local model usage history is available". Source ids (`usage-summary.service.ts:16`): `claude-ledger`, `codex`, `opencode`, `grok`, `antigravity`, `ollama-cloud`. Complete sources are omitted. `providerDisplayName` (`usage-formatting.ts:130-159`) title-cases unknown ids, so `claude-ledger` would read "Claude Ledger".
- Per provider: mark, display name, cost (`—` or `≥ $`), share bar, "{pct} of cost · {tokens} tokens" or "of known cost" when any fact is unpriced (`:172-179`). Shot: Anthropic $3.72, 97.4% of cost, 3.4M tokens; Codex $0.10, 2.6% of cost, 189.9K tokens.

**Left column — donut** (`usage-cost-donut.component.ts`)

- "Cost share"; toggle Provider | Model (`:15-18`).
- Center: formatted known cost and "known cost" (`:31-32`).
- Legend: label, cost, percent or "—".
- "Unpriced usage is excluded from cost share; shown totals are lower bounds." (`:47`).

**Right column — chart**

- "Daily usage" (`usage-dashboard.component.html:120-122`).
- Toggle Cost | Tokens (`:123-143`).
- In-house stacked bars, one series per provider (`usage-dashboard.component.ts:85-97`). Y axis and day labels from the series. Shot legend: Anthropic, Codex. Caption: "Hover or focus a day column for that day's per-provider values." (`stacked-bar-chart.component.html:169`).

**KPI strip** (`usage-kpi-strip.component.ts`)

- Processed tokens — shot 3.6M; sub "~{n} per active day" or "No active days" (`:90-94`). Shot "~1.5M per active day".
- Cached input — shot 3M; "{pct} of observed input" or "No input observed" (`:97-101`). Shot "98.1% of observed input".
- Uncached input — shot 28.1K; "{n} cache writes" (`:104-106`). Shot "106.7K cache writes".
- Output — shot 24.7K. No sub-line (`:57-63`).
- Cache savings — shot $11.05; "—", or "≥ $" when some facts lack savings. Sub: "Cost before cache savings: {n}x raw cost" (shot "3.9x raw cost"), else "a lower bound", "vs raw token cost", or "No savings data" (`:125-133`). Tooltip: "{n} facts without savings data".

**Sessions row** (same component, `:78-82`)

- Sessions 14, Messages 87, Subagents 2. Group label "Session activity in selected range". Title "Counts include usage sources with session identity in this range".

**Breakdown** (`usage-breakdown-table.component.ts`)

- "Breakdown"; toggle Model | Day.
- Model columns: Model (mark, `modelDisplayName`, provider badge), Cost, Share or "Share of known cost" (`:140-142`), Tokens. Unpriced cost is "—" with title "No price for this model" or "Some usage of this model is unpriced".
- Shot model rows: "Opus 5.5" / Anthropic / $3.72 / 97.4% / 3.4M; "gpt-5-sol" / Codex / $0.10 / 2.6% / 189.9K.
- Day columns: Day, Cost, Share, Tokens, Top model.

**Top 5 sessions** (`usage-top-sessions.component.ts:13-28`)

- "Top 5 sessions by cost". Empty: "No session-linked usage in this range."
- Columns: Session (title), Model (**raw `session.modelId`**, `:24`), Cost (`Unpriced` or `≥ $`), Tokens, Last active ("Less than 1h ago" / "{n}h ago" / "{n}d ago", `:47-52`).
- Shot models are `claude-opus-5-5`, not "Opus 5.5". Display names for the breakdown come from `resolveModelDisplayName` (`usage-summary.view-model.ts:195-198`, `pricing.utils.ts:648-658`). Top sessions pass `summary.topSessions` through unchanged (`usage-summary.view-model.ts:277`).

**Provenance tiles** (`usage-cost-quality.component.ts`)

- Provider reported — shot 0%, "share of tokens".
- Model priced — shot 100%, "share of tokens".
- Unpriced — shot 0%, "share of tokens". Null share renders "—" (`:63-64`).
- Cache savings — shot $11.05, "vs raw token cost"; "≥ $" and tooltip when unknown facts exist (`:66-80`).

Below the section, still on the grid: `BuildersCard` "Ptah is open source" (`dashboard-grid.component.html:89`). Out of the usage inventory. Leave it.

## Preserve list

- In-house SVG charts (`ptah-stacked-bar-chart`, `usage-donut-svg`). No chart library.
- Daily stacked bars, Cost | Tokens toggle, per-provider series.
- Cost-share donut with Provider | Model toggle, center "known cost", unpriced excluded from the denominator.
- Range 7d / 30d / 90d, default 30d, RPC `analytics:spendSummary`.
- Honest gaps: "—", "≥", "partial", "Unpriced", "Unknown", "No price…", source reason lines. Do not turn a null into 0.
- Provider marks and `providerDisplayName`.
- Breakdown Model | Day, including "Share of known cost" when the denominator is partial.
- Session / message / subagent counts and the top-5 cap.
- Provenance four-tile: provider reported, model priced, unpriced, cache savings.
- Footnote "* estimated at API rates; not your bill".
- Tile borders already approved: `surface-1` / `surface-2` section cards. Do not invent a new chrome.
- Plan-limit contract fields stay: `PlanLimitWindow.used` (`percent` or `amount`/`limit`/`unit`), `resetsAt`, `label`, `status` (`plan-limit.types.ts:56-95`). Reset copy already exists: `formatToolResetText` / `formatUsed` (`plan-limit-format.ts:257-306`), including "in 1d 21h" style relatives.
- Harness blocked-set function stays the shared one. One repair dialog.

## Design proposal

Recommended layout only, plus one smaller alternative at the end. Electron first. Same Angular templates ship in the VS Code webview, so both widths apply there. The TUI does not import these components (no matches under `apps/ptah-tui`).

Numbers are the content. Status sentences appear only when a provider has no window.

### 1920 — plan limits

One horizontal strip inside the existing "Provider accounts & plan limits" section. Drop the intro sentence ("One tile per quota owner…"). One cell per owner that has a reader. Target row height ~72px, not the current full card with an empty bar.

```
Provider accounts & plan limits                          [Refresh]
+------------------+------------------+------------------+------------------+
| Claude sub    -- | Codex        8%  | Grok         6%  | OpenCode Go  94% |
| no open session  | Weekly      ████ | Weekly      ███  | 5h  94% ████████ |
|                  | resets 4d 20h    | resets 6d 2h     | Wk  ..  Mo  ..   |
+------------------+------------------+------------------+------------------+
| Ollama / Glm LIMIT| Antigravity  -- |                  |                  |
| session --  wk -- | no local quota  |                  |                  |
| add key          |                  |                  |                  |
+------------------+------------------+------------------+------------------+
```

Cell contents, all from data that exists on `PlanLimitOwnerSnapshot` once the owner is actually discovered:

| Element | Needs | Exists today |
| --- | --- | --- |
| Provider name | `owner.label` passed through `tileTitleLines` (name line only) | Yes |
| Big % | `window.used` where `kind === 'percent'` via `formatUsed` | Yes, when that owner's reader ran |
| Window name | `window.label` (Weekly, 5-hour, monthly) | Yes |
| Mini bar | percent 0–100; near-limit tick stays at `NEAR_LIMIT_PERCENT` (card already states 90%) | Yes |
| Reset | `window.resetsAt` via `formatToolResetText`, shortened to the relative part ("4d 20h") | Yes. Do not invent a reset |
| Limit / at-limit color | window state already classified for the current tiles | Yes |
| Status sentence | only when `windows.length === 0`: existing `statusPill` text ("No plan limits (API key)", "No API key configured", "No open session…") | Yes |
| Add key | existing `onTileAction` → Settings Providers | Yes, Ollama missing key only |
| Copilot, Cursor, pi | no | No reader. Omit |

At 1920, `repeat(4, minmax(0,1fr))`. At 1440, `repeat(3, minmax(0,1fr))` so six providers wrap to two rows instead of squeezing percents.

### 1920 — usage

Move the partial-source lines off the left column into the existing "partial" badge tooltip (the tooltip already lists them: `usage-cost-summary.component.ts:145-151`). Delete the visible `<ul data-testid="usage-source-notes">`.

```
Usage          Sep 21 – Oct 20, 2026    [7d|30d|90d]  Refresh     (partial)

[$3.82]  [3.6M tok]  [98.1% cached]  [14 sess]  [87 msg]  [2 sub]
 raw cost  processed   of input       sessions   messages  subagents
 ~1.5M/day  3.9x before cache          cache savings $11.05 in the cost tile tooltip

Daily usage                                          [Cost|Tokens]
[ full-width stacked bars, Anthropic | Codex ........................ ]
Hover or focus a day column for that day's per-provider values.

Cost share [Provider|Model]          By provider
( donut $3.82 known cost )           Anthropic  $3.72  ████████  97.4% · 3.4M
 legend                              Codex      $0.10  █         2.6% · 189.9K

Breakdown [Model|Day]                         Top 5 sessions by cost
Opus 5.5   Anthropic  $3.72  97.4%  3.4M      Session 8e8784ef  Opus 5.5  $0.70  781.2K  7d ago
gpt-5-sol  Codex      $0.10   2.6%  189.9K    ... model column uses modelDisplayName

Provider reported 0%   Model priced 100%   Unpriced 0%   Cache savings $11.05
* estimated at API rates; not your bill
```

KPI strip becomes **one** row of six: cost, processed tokens, cached %, sessions, messages, subagents. Cached % is the current "Cached input" share (`cachedShareOfInput`), not a new metric. Cache-savings dollars move to the cost tile's tooltip (already computed on `vm.kpis.cacheSavingsUsd`) so the strip does not show savings twice. The five token tiles stay available as the tooltip/subline of "processed" and "cached": uncached, output, cache writes, per-active-day. Do not drop those numbers; stop giving each its own card.

Donut and provider bars sit side by side under the full-width chart (`grid-cols-2` from `lg`). Tables sit side by side (`grid-cols-2`). Provenance stays one four-cell row.

### 1440

Same regions. Plan-limit grid is 3 columns. Usage KPI strip wraps 3×2 (`grid-cols-3`). Chart stays full width. Donut + bars stay two columns until the content width drops below ~720px, then stack (the current `grid-cols-1` breakpoint). Tables stack below ~900px so the model column does not truncate "Opus 5.5".

### Alternative (do not do both)

Leave the usage grid as it is and only (a) fix top-5 model names and (b) replace plan-limit tiles with the compact strip. Rejected as the primary proposal because the left column would stay cramped: cost, three source lines, bars, and donut still share `lg:col-span-2` (`usage-dashboard.component.html:101-117`).

### Element → source → exists → files

| Element | Data source | Exists | Files |
| --- | --- | --- | --- |
| One cell per readable lane | `agent.list()` + `LaneLimitLookupService` | Yes, not wired to the card | `plan-limit-owner-discovery.service.ts`, `plan-limits-snapshot.service.ts`, `provider-account-card.component.ts`, `provider-account-tile` |
| Big % and reset | `PlanLimitWindow.used`, `resetsAt` | Yes | `plan-tile-view.model.ts`, `plan-limit-format.ts` (reuse, do not fork) |
| Grok without the login-file gate | `ownerForCliStore('grok')` | Yes on the lane resolver; discovery adds an extra gate | `plan-limit-owner-discovery.service.ts:410-414` |
| Ollama % | `createOllamaCloudPlanUsageReader` | Yes only after a key is present | No new reader. Settings "Add key" stays |
| Claude API key sentence | `unsupported-auth` | Yes | Keep one status line, no empty bar |
| Copilot / Cursor / pi % | none | No | Do not add cells |
| Full-width chart | `vm.providerSeries`, `vm.days` | Yes | `usage-dashboard.component.html:101-154` |
| Six-tile KPI strip | `vm.totalCostUsd`, `vm.kpis` | Yes | `usage-kpi-strip.component.ts` |
| Source lines as badge only | `vm.sources` | Yes, already in the tooltip | `usage-cost-summary.component.ts:57-68` |
| Donut beside bars | `vm.providers`, `vm.modelRows` | Yes | `usage-dashboard.component.html`, `usage-cost-donut.component.ts`, `usage-cost-summary.component.ts` |
| Tables side by side | `vm.modelRows`, `vm.dayRows`, `vm.topSessions` | Yes | `usage-breakdown-table.component.ts`, `usage-top-sessions.component.ts` |
| Top-5 "Opus 5.5" | `resolveModelDisplayName(modelId, availableModels)` | Yes for breakdown; top-5 still prints `modelId` | `usage-top-sessions.component.ts:24`, `usage-summary.view-model.ts:277` |
| Remove route cards | none | n/a | `dashboard-grid.component.html:18-79`, `dashboard-grid.layout.spec.ts`, `dashboard-tour.scene.ts` |
| Move harness notice | `HarnessHealthStore`, `harnessBlockedPaths`, repair dialog | Yes | `harness-health-badge.component.ts` (add the button), then remove `dashboard-grid` `<ptah-harness-card />` only after the badge has the dialog |

Shared with VS Code: `DashboardGridComponent`, `ProviderAccountCardComponent`, `UsageDashboardComponent`, `HarnessHealthBadgeComponent`. A template change compiles for both hosts. Do not register `agent:getLanePlanLimits` on the VS Code host; call the existing `provider:getPlanLimits` after discovery uses the lane roster. TUI: no change.

## Files to change

1. `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts` — roster aligned with `LaneLimitLookupService`; drop the Grok login-file gate; stop nesting `detectAll()` inside the 3s budget.
2. `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.spec.ts` — Codex/Grok/OpenCode/Antigravity/Ollama expectations.
3. `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts` and `provider-account-tile/` — compact cell, percent first, sentence only when there are no windows.
4. `libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.ts` — view fields for per-window percent and short reset. Reuse `formatUsed` / `formatToolResetText`.
5. `libs/frontend/dashboard/src/lib/components/dashboard-grid/dashboard-grid.component.html` — remove the two route buttons; remove `<ptah-harness-card />` only after the badge owns the repair action.
6. `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts` — "Move these aside…" opens the existing repair dialog.
7. `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-dashboard.component.html` — full-width chart, two-column donut+bars, two-column tables.
8. `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-kpi-strip.component.ts` — one six-tile strip; fold the sessions row into it.
9. `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-cost-summary.component.ts` — hide the source `<ul>`; keep the partial badge tooltip.
10. `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-top-sessions.component.ts` — render `resolveModelDisplayName`, keep `modelId` as the `title`.
11. Specs: `dashboard-grid.layout.spec.ts`, `usage-dashboard.component.spec.ts`, `usage-top-sessions` spec if present, `harness-health-badge.component.spec.ts`, showcase `dashboard-tour.scene.ts` (stop requiring the Tribunal button on the dashboard).

Not in this change: `apps/ptah-tui`, Copilot/Cursor readers, a new chart library, `analytics:spendSummary` contract.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Recommend removing the two route cards | Keep them as the only entry; remove them | Electron nav already has Tribunal and Voice (`electron-shell.component.ts:174-221`). VS Code nav already has Tribunal (`app-shell.component.html:177-184`). Showcase and layout specs are the only hard dependencies. | Yes. Restore the two buttons. |
| Recommend moving the harness card onto the skills badge popover | Leave the card; delete the notice; new marketplace page | Same store and same blocked set already render in the badge (`harness-health-badge.component.ts:167-169`). The missing piece is the repair button, which the card already delegates to `HarnessRepairDialogComponent`. | Yes. |
| Recommend feeding the strip from the lane roster | Keep discovery and only restyle two tiles; call `agent:getLanePlanLimits` from the webview | agent_list and the card already share `PlanUsageService` (`lane-limit-lookup.service.ts:192-200`, `plan-usage.service.ts:175`). The card's roster is the subset in `discoverTargets`. `agent:getLanePlanLimits` is Electron-only (`expected-absent.ts:77-80`), so the webview should keep `provider:getPlanLimits`. | Yes. |
| Omit Copilot, Cursor, and pi | Show them as "unknown" | `planOwnerRead` returns null (`plan-owner-read.ts:119-125`). A cell with no % contradicts the numbers-first layout. | Yes, once a reader exists. |
| Top-5 uses `resolveModelDisplayName` | Leave raw ids | Breakdown already does (`usage-summary.view-model.ts:195-198`). Top-5 prints `session.modelId` (`usage-top-sessions.component.ts:24`). | Yes. |

## Open questions for the user

1. Remove both route cards, or only Command Center (Electron already has Voice) and keep Tribunal on the dashboard for the showcase tour? Recommendation: remove both. The tour can target the nav tab (`electron-shell.component.ts:216`).
2. After the harness card leaves the dashboard, is the skills-page badge popover an acceptable home for "Move these aside…"? Recommendation: yes. It is the only other surface that already shows the blocked paths.
3. Should a provider with no windows (Claude API key, Ollama with no key) stay in the strip as one status cell, or be hidden until it has a percent? Recommendation: keep one status cell. Hiding the API-key case makes the selected account look missing.
4. Is omitting Copilot and Cursor acceptable until a reader exists? Recommendation: yes. agent_list already reports them as unknown, not as a percent.
