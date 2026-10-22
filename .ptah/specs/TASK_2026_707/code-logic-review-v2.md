# Code Logic Review — `TASK_2026_707` dashboard v2

Review family: grok (implementer: codex)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | NEEDS_REVISION |
| Verdict | REVISE |
| Blocking issues | 0 |
| Serious issues | 3 |
| Moderate issues | 4 |
| Failure modes found | 5 |

Score 5 sits in the "real gaps" band. It is not 3–4: owner dedup, the Grok login-file removal, copilot/cursor/pi exclusion, the harness button gate, and the usage honest-gap strings (`—`, `≥`, `Unpriced`, `Unknown`) are implemented and the scoped Jest suites pass. It is not 7–8: a cold `provider:getPlanLimits` can exceed the webview RPC timeout, a limit window can show "reset unknown" while the shared formatter has a reset, and the docs still send people to a dashboard button that this change deleted.

`ptah_*` tools were not exposed (`search_tool` for `ptah` returned no tools). Citations are from the uncommitted diff, full reads of the changed logic, and the two Jest commands below. `ptah_get_diagnostics` was not run.

## Five logic questions

### 1. How does this fail silently?

A detection timeout resolves `fromSource('detection')` to `undefined`. `cli-store` and `lane` then run on `[]`, so installed Codex, OpenCode, Antigravity, and Grok are omitted while `discoverTargets` still resolves (`plan-limit-owner-discovery.service.ts:230-241`, `:610-614`). The card renders the remaining owners as a normal snapshot. That drop-one-source behaviour is the requested degradation; there is still no user-visible "detection timed out" state.

The worse silent case is the client timeout in defect 1: owners that were ready (selected provider, Ptah CLI Ollama) are held inside `Promise.all` until the slow chain finishes, and a 30s webview timeout fails the whole pull.

### 2. What user action produces unexpected behaviour?

Opening Analytics on a cold host (CLI detection plus a Codex app-server start plus an Antigravity or Codex usage read) can burn the 30s `provider:getPlanLimits` budget. The user sees a failed or stale plan-limits section.

A sighted user with four plan windows sees only three meters and no "+N more" tooltip (defect 4).

Following the Tribunal docs and looking for **Convene a Tribunal** on the dashboard finds nothing (defect 3). Tribunal still exists on the nav and on the Tribunal empty state.

### 3. What input data produces a wrong answer?

A window with no `resetsAt` but an exhaustion reset, or a reset that `formatToolResetText` would describe via `resetPassage`, gets `reset unknown` or a stripped `formatRelative` line (defect 2). `formatUsed` itself still refuses to print an unknown used-value as 0.

`summary.sessionCount ?? 0` (and the message/subagent twins) in `usage-summary.view-model.ts:223-225` is pre-existing and was not introduced by this diff. Real zeros stay zeros. Cost `null` renders `Unknown`. Cached share `null` renders `—`.

### 4. What happens when a dependency fails?

`fromSource` catches a throw, logs `errorName` with a `degradation-audit: reported` comment, and returns `undefined` (`plan-limit-owner-discovery.service.ts:617-626`). A timeout takes the same drop path with a debug log and no audit comment (`:609-614`); the timer is cleared in `finally`. One source dying does not reject `discoverTargets`. Grok's removed login-file reader no longer has an empty `catch`.

`ownerForCliStore` / `ownerForOpenCode` / `ownerForAntigravity` are synchronous identity resolvers. A throw inside `cliStores` still drops OpenCode, Antigravity, and Grok together, because they share one source promise (`:372-391`). That grouping predates Grok joining the source.

Detection cannot hang the RPC forever: its race is `SLOW_LIMIT_LOOKUP_DEADLINE_MS` (12s) at `:209-214`. The late `detectAll()` is not cancelled.

### 5. What is missing that the requirements never mentioned?

Owner-level cooldown and evidence are still computed (`plan-tile-view.model.ts:1010-1047`) and are not rendered (defect 6). The design cell table did not list them. The webview timeout versus the new sequential budgets was not in the batch reports. Docs and the Electron IPC comment that names `HarnessCardComponent.ngOnInit` (`apps/ptah-electron/src/ipc/ipc-bridge.ts:214`) were not in the file list; the comment is stale, and the skills badge still cold-pulls on its own `ngOnInit` (`harness-health-badge.component.ts:297-300`).

## Failure modes

### Whole plan-limits pull exceeds the webview timeout

- Trigger: cold `discoverTargets` where detection uses most of 12s and the Codex lane then uses most of its own 12s, then `assemble` waits on a slow owner read (Codex or Antigravity, another 12s).
- Symptom: `provider:getPlanLimits` times out. The store keeps the last snapshot or installs the empty placeholder and sets `loadError`. Fast owners that were already discovered never appear in that response.
- Evidence: `plan-limit-owner-discovery.service.ts:209-241`, `plan-limits-snapshot.service.ts:147-150`, `claude-rpc.service.ts:135`, `plan-limits.store.ts:176`.
- Current handling: per-source deadlines only. No total budget. The store uses the 30s default.
- Recommendation: keep detection off the read clocks, and cap detection-plus-dependent-reads so the RPC returns inside 30s (or pass a longer timeout and return a partial snapshot when the cap hits).

### Compact reset line contradicts the shared reset formatter

- Trigger: the displayed window's meaningful reset is `exhaustion.resetsAt` or a `resetPassage`, while `window.resetsAt` is missing.
- Symptom: the cell says `reset unknown` (or a shortened relative of the wrong instant). The window `title` still includes `formatToolResetText`.
- Evidence: `plan-tile-view.model.ts:985-989`, `plan-limit-format.ts:284-306`.
- Current handling: local `formatRelative(...).replace(/^in /, '')` on `displayPrimary.resetsAt` only.
- Recommendation: derive the visible short line from `formatToolResetText` (relative clause only), including the exhaustion fallback.

### Detection timeout looks like "not installed"

- Trigger: `detectAll` misses the 12s detection budget.
- Symptom: dashboard roster has no Codex, OpenCode, Antigravity, or Grok, with a successful snapshot.
- Evidence: `plan-limit-owner-discovery.service.ts:230-241` and `:609-614`.
- Current handling: debug log, empty CLI sources. Requested degradation. No in-card signal.
- Recommendation: optional. If a signal is added, do not invent a zero percent.

### Docs still start Tribunal from the dashboard card

- Trigger: a reader follows the Tribunal guides.
- Symptom: the named dashboard control is gone. Nav and the Tribunal empty state still convene.
- Evidence: `apps/ptah-docs/src/content/docs/tribunal/relay.md:37`, `crucible.md:81`, `race.md:55`, `forge.md:50`, `council.md:94`.
- Current handling: none in this diff.
- Recommendation: point those steps at the Tribunal tab or the Tribunal panel empty state.

### Fourth plan window is only on the section aria-label

- Trigger: an owner has more than three windows after the generic-weekly hide.
- Symptom: meters 4+ are not on screen and are not in `hiddenWindowNotes` / the header `title`. A screen reader that reads the section `aria-label` still hears them.
- Evidence: `plan-tile-view.model.ts:965-998`, `provider-account-tile.component.html:3-6`.
- Current handling: `slice(0, 3)`. The older chip path's "+N more" title was not copied onto the compact notes.
- Recommendation: append the sliced windows to `hiddenWindowNotes` (the field comment at `plan-tile-view.model.ts:294` already promises tooltip lines).

## Blocking issues

None.

## Serious issues

### 1. Sequential detection and lane budgets plus the later usage read can pass the 30s RPC timeout

- File: `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts:209-241`
- Batch: A
- Scenario: Dashboard `provider:getPlanLimits` does not pass `sessionIds`. Codex is not the selected provider, so `resolveCodexHomeOwner` starts only after detection settles (`:234-240`), inside a fresh `SLOW_LIMIT_LOOKUP_DEADLINE_MS` (12s). `LIMIT_LOOKUP_DEADLINE_MS` is 3s and `SLOW_LIMIT_LOOKUP_DEADLINE_MS` is 12s (`evidence-precedence.ts:17-23`). `assemble` then reads every owner, and Codex/Antigravity reads use another 12s (`plan-limits-snapshot.service.ts:147-150`, `limitLookupDeadlineMs`). Worst case about 12+12+12 = 36s. `ClaudeRpcService.call` defaults to 30s (`claude-rpc.service.ts:135`). `PlanLimitsStore.load` does not override it (`plan-limits.store.ts:176`).
- Impact: the call this batch was meant to make reliable fails as a whole-card timeout on a cold start. Selected-provider and Ollama results sit inside the same `Promise.all` and are not returned early. Detection itself cannot hang past 12s.
- Fix: keep a separate detection clock, but bound discovery-plus-owner-reads under 30s, or set a longer timeout on this method and return partial owners when the cap hits. Add a spec that a never-resolving `detectAll` settles `discoverTargets` by the detection budget and that the summed budget stays inside the client timeout.

### 2. Short reset ignores exhaustion resets and forks the formatter

- File: `libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.ts:985-989`
- Batch: B1
- Scenario: `shortReset` reads only `displayPrimary.resetsAt`. `formatToolResetText` uses `resetPassage` first, then `window.resetsAt ?? window.exhaustion?.resetsAt` (`plan-limit-format.ts:288-306`). A limit-reached window whose reset lives on the exhaustion therefore shows `reset unknown` in the cell. The string is also built with `formatRelative` plus a `^in ` strip, not the shared helper the investigation required.
- Impact: the numbers-first cell shows the wrong reset on the state (at-limit) the color treatment is there to highlight. The per-window `title` can still be right, so the visible line and the tooltip disagree.
- Fix: set `shortReset` from `formatToolResetText` (relative portion only), so exhaustion and passage stay one implementation.

### 3. User docs still tell people to convene Tribunal from the dashboard

- File: `apps/ptah-docs/src/content/docs/tribunal/relay.md:37` (same instruction at `crucible.md:81`, `race.md:55`, `forge.md:50`, `council.md:94`)
- Batch: B1
- Scenario: the dashboard buttons are gone (`dashboard-grid.component.html:18-24` is the provider card, then the skill card). The guides still say to choose **Convene a Tribunal** on the dashboard. Showcase beat 4 was updated to the Tribunal tab (`dashboard-tour.scene.ts`). Setup hub and chat still have their own controls, which this batch was told to leave.
- Impact: the documented click path 404s inside the product. Tribunal remains reachable from the shell tab and from `tribunal-empty-state.component.ts`.
- Fix: retarget those five doc sentences to the nav tab or the Tribunal panel. Do not restore the dashboard card.

## Moderate and minor issues

### 4. Windows past the third meter are dropped from the tooltip

- File: `libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.ts:965-968` and `:993-998`
- Batch: B1
- Problem: `compactWindows` is `slice(0, 3)` after hiding the generic weekly. `hiddenWindowNotes` records only that one hidden weekly. The header `title` (`provider-account-tile.component.html:3-6`) never lists the overflow. `accessibleLabel` does include every window (`plan-tile-view.model.ts:990-991`).
- Fix: push the sliced windows into `hiddenWindowNotes` the way the unused chip "+N more" path already formats them (`:937-946`).

### 5. The live repair sentence is not an approved reconcile step

- File: `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts:28`
- Batch: B1
- Problem: the popover interpolates `then use Reconcile now, or Move these aside… below.` The only updated shared clause is `HARNESS_BLOCKED_RECONCILE_STEPS['dashboard-card']` (`harness-blocked-wording.ts:109-110`), which names the badge and is not what the badge renders. Nothing else passes `harnessBlockedAction('dashboard-card')`. The button itself is correctly behind `blocked().count > 0` (`harness-health-badge.component.ts:192-194`) and opens `HarnessRepairDialogComponent` with the same `blocked()` computed (`:213-215`, `:264-266`). There is no second blocked-set function.
- Fix: add a surface key whose value is the in-popover clause, and pass `HARNESS_BLOCKED_RECONCILE_STEPS` (or `harnessBlockedAction`) into the blocked-paths paragraph. Delete or stop exporting the unused `dashboard-card` phrasing once nothing reads it.

### 6. Cooldown and owner evidence are computed and then not shown

- File: `libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.html:20-47`
- Batch: B1
- Problem: the template renders meters, one short reset, or a status sentence plus action. It never reads `view().cooldown`, `view().evidence`, or `view().statusNotice`. Those fields are still filled at `plan-tile-view.model.ts:1010-1047`. A windowed owner in cooldown shows percents with no "retry delay, not a plan reset" line. Windowless owners still get `statusPill` and `tileAction` (no-session → Go to chat, Ollama missing key → Add key), which matches the design.
- Fix: when `cooldown` or owner evidence is present, put that sentence in the status line or the cell `title`, including when meters are visible.

### 7. Usage strip group label and the output-token placement

- File: `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-kpi-strip.component.ts:18` and `:28-34`
- Batch: B2
- Problem: the six-tile group `aria-label` is `Session activity in selected range`, so cost and tokens are announced as session activity. Output tokens are an `sr-only` span on the processed tile and a clause of the cost `title` (`:64-68`). They are not a subline or tooltip of the processed or cached tiles, which is where the investigation said the retired token tiles had to stay. Uncached input, cache writes, cached input amount, and per-active-day are visible sublines. Cache-savings dollars stay on the provenance row; the cost tile tooltip repeats them.
- Fix: label the group for the whole strip (or split the session trio). Put output tokens on the processed tile `title` or subline.

## Data flow

1. Dashboard effect calls `PlanLimitsStore.load({ providerId })` (`provider-account-card.component.ts:207-209`). OK.
2. RPC `provider:getPlanLimits` with no session or owner keys when no surface scope is registered (`plan-limits.store.ts:218-231`). OK.
3. `discoverTargets` starts selected-provider, sessions, Ptah CLI, and ledger immediately. Detection has a 12s race. CLI-store and lane start after that race (`plan-limit-owner-discovery.service.ts:209-253`). Gap: summed time, defect 1. Dedup is first-source-wins in source array order (`:198-205`, `:254`). Grok is an installed CLI-store owner with no login-file gate (`:386-389`). Copilot, cursor, and pi never become entries because `planOwnerRead` returns null and `entryFor` returns `undefined` (`:565-566`). The new spec asserts that roster (`plan-limit-owner-discovery.service.spec.ts:291-312`) and passed.
4. `assemble` reads each owner under `limitLookupDeadlineMs` (`plan-limits-snapshot.service.ts:143-186`). A failed read becomes `service-unavailable` plus ledger windows, not a fake 0 (`:212-222`). OK.
5. The card stably reorders the selected provider id first (`provider-account-card.component.ts:176-188`). OK.
6. `buildPlanTile` classifies with `classifyWindow` and `NEAR_LIMIT_PERCENT`. Bars use `usedPercent` (undefined when an amount has no positive limit, never 0 for unknown). Primary big text is `formatUsed`. Gap: short reset, defect 2; overflow, defect 4.
7. Usage: `buildUsageViewModel` maps top sessions through `resolveModelDisplayName` (`usage-summary.view-model.ts:281-284`), the same helper as breakdown rows (`:199`). The cell shows that name and puts `modelId` on `title` (`usage-top-sessions.component.ts:25`). OK.
8. Partial sources: header button, `sourceTip()` joins incomplete sources (`usage-dashboard.component.ts:92-97`, template `:43-51`). The visible source `<ul>` is gone. The button is in tab order. Whether DaisyUI `data-tip` appears on keyboard focus was not verified in a browser; `title` and `aria-description` are set.
9. Harness: dashboard card deleted. Badge popover shows the repair action only when `blocked().count > 0` and mounts the existing dialog. Reconciler warn text points at the Skills & Plugins badge (`harness-reconciler.service.ts` action string in the diff). Gap: wording key, defect 5.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Dashboard `provider:getPlanLimits` returns installed codex/opencode/antigravity/grok, Ptah CLI Ollama, and the selected provider | COMPLETE | Spec roster at `plan-limit-owner-discovery.service.spec.ts:291-312` passed here |
| Detection time is not inside the 3s/12s read deadlines | COMPLETE | Separate 12s detection race, then the source races |
| Detection cannot hang the RPC unboundedly | COMPLETE | 12s race. Late work is abandoned, not awaited |
| Total worst case stays safe for the webview | MISSING | Defect 1, about 36s vs 30s |
| Failing source dropped alone, with audit comment on swallows | PARTIAL | Throws have the comment. A throw in `cliStores` drops all three CLI-store owners together. Timeouts are logged, not audited |
| Grok login-file gate removed | COMPLETE | `:386-389`, spec `:167` |
| No copilot/cursor/pi cells | COMPLETE | Same spec; `entryFor` drops null `planOwnerRead` |
| Owner dedup and source precedence | COMPLETE | Map insertion order after `Promise.all` |
| Remove Tribunal and Command Center dashboard cards | COMPLETE | Grid template. Setup hub and chat input were not edited |
| Move harness notice into the badge popover; delete the card | COMPLETE | Button gated; same `harnessBlockedPaths` and repair dialog |
| No leftover dashboard-card instructions | MISSING | Defect 3. Comments in `skill-selection-card` and `ipc-bridge.ts` still name `HarnessCardComponent` |
| Compact plan cells: big %, up to three meters, short reset, state colors, status only with no windows | PARTIAL | Colors and status cell match. Reset and overflow: defects 2 and 4 |
| Reset formatting reused, not forked | MISSING | Defect 2 |
| Six-tile KPI, other numbers in sublines/tooltips, full-width chart, donut beside bars, tables side by side | PARTIAL | Layout matches the template. Output placement and the group label: defect 7 |
| Top-5 model display name matches breakdown | COMPLETE | `resolveModelDisplayName` |
| Honest gaps (`—`, `≥`, partial, Unpriced); null not shown as 0 | COMPLETE | Cost, cached share, provider rows, provenance. Pre-existing `sessionCount ?? 0` unchanged |
| Partial badge focusable | COMPLETE | It is a `button` with `title` and `aria-description`. Visual tooltip-on-focus not browser-checked |
| OnPush, signals, `input()`, no `[innerHTML]` on the changed components | COMPLETE | Read the changed component classes. No `innerHTML` under those files |
| VS Code webview compile | PARTIAL | Not built. Dashboard Jest compiled the changed dashboard specs |

## Preserve-list check

| Preserve item | Reachable | Where |
| --- | --- | --- |
| In-house SVG charts | Yes | `ptah-stacked-bar-chart`, donut component untouched |
| Daily bars, Cost \| Tokens, per-provider series | Yes | `usage-dashboard.component.html:118-152` |
| Donut Provider \| Model, known cost, unpriced excluded | Yes | `usage-cost-donut` still fed `vm.providers` / `vm.modelRows` |
| Range 7d/30d/90d, default 30d, `analytics:spendSummary` | Yes | Header buttons; store not edited |
| Honest gaps | Yes | KPI cost, provider rows, breakdown, top sessions, quality tiles |
| Provider marks and `providerDisplayName` | Yes | Rows, partial badge tip, top sessions |
| Breakdown Model \| Day, "Share of known cost" | Yes | Breakdown component not rewritten |
| Session, message, subagent counts and top-5 cap | Yes | KPI tiles; table still "Top 5 sessions by cost" |
| Provenance four tiles | Yes | `ptah-usage-cost-quality` after the tables |
| Footnote "* estimated at API rates; not your bill" | Yes | `usage-kpi-strip.component.ts:49` |
| Surface card chrome | Yes | Analytics section still `surface-1`; tiles keep `border-base-content/10` |
| Plan-limit window fields and near-limit tick | Yes | `used` / `resetsAt` / `label` / `status` via `buildPlanTile`; tick at `NEAR_LIMIT_PERCENT` |
| Shared reset copy | No | Defect 2 |
| One blocked-set function, one repair dialog | Yes | Badge |
| Builders card | Yes | `dashboard-grid.component.html:24` |
| Date span, refresh, loading, error, retry, stale, empty copy | Yes | `usage-dashboard.component.html:5-109` |
| Raw cost, `≥`, unpriced fact tooltip | Yes | KPI cost `title` |
| Partial badge and source reasons | Yes | Header button. Visible `<ul>` removed as approved |
| Per-provider cost, bar, share, tokens | Yes | `usage-cost-summary.component.ts:12-50` |
| Processed, per-active-day, cached amount, cached %, uncached, cache writes | Yes | KPI sublines. Cached % `null` is `—` |
| Output tokens | Partial | `sr-only` and cost tooltip only (defect 7) |
| Cache savings dollars | Yes | Provenance row; cost tooltip repeats; subline is the multiple / lower-bound / "No savings data" |
| Top-5 display name, raw id on `title`, Unpriced / `≥`, relative last active | Yes | `usage-top-sessions.component.ts:25-52` |
| Route cards removed; harness card removed | Yes | Grid. Docs still describe the route card (defect 3) |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty detection / CLI not installed | YES | `isInstalled` false → no entry | Timeout uses the same empty list |
| Duplicate owner from selected + CLI | YES | First source in array order wins | |
| Grok installed, no `auth.json` | YES | Owner still listed; reader reports `no-usage-source` | No login-file gate |
| Copilot, cursor, pi installed | YES | `planOwnerRead` null, entry dropped | Spec passed |
| Amount window, limit 0 or non-finite | YES | `usedPercent` undefined, no bar; `formatUsed` returns `unknown` | |
| Percent over 100 | YES | Text is `formatUsed`; bar width clamped to 100 | Same clamp as the old bar |
| More than 3 windows | NO | Sliced with no tooltip lines | Defect 4 |
| No windows | YES | Status sentence and action | |
| Near / at limit | YES | `classifyWindow` → `BAR_TONES` | |
| Source throw | YES | Logged and dropped | CLI-store siblings share one promise |
| `detectAll` never resolves | YES | 12s then empty CLI roster | Defect 1 for the sum with later reads |
| Null usage cost / cached share | YES | `Unknown` / `—` | |
| Partial badge with no incomplete rows | YES | Button hidden unless `isPartial` | Empty tip if a partial source has no reason still shows `status` |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Count the five Tribunal doc pages as in-scope leftover instructions | Ignore docs because the batch file list did not name them; file them | The review brief says leftover "use the dashboard card" text under `apps/*`, `libs/*`, e2e, and showcase. `apps/ptah-docs` is `apps/*`. The sentences name the removed control | Yes. Doc edit only |
| Treat the 36s vs 30s sum as a defect even though each individual deadline matches the spec | Accept any sum of the requested separate clocks | `ClaudeRpcService` default is 30s and this store call does not raise it. Separate clocks were requested; an unbounded sum was not | Yes. Budget or timeout change |

## Jest

- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts plan-limit-owner-discovery --coverage=false --maxWorkers=2 --silent` — 1 suite passed, 33 tests passed (22.7s).
- `npx jest -c libs/frontend/dashboard/jest.config.ts libs/frontend/dashboard/src/lib/components/provider-account-card libs/frontend/dashboard/src/lib/components/provider-account-tile libs/frontend/dashboard/src/lib/components/dashboard-grid --coverage=false --maxWorkers=2 --silent` — 5 suites passed, 67 tests passed (8.3s). This includes `dashboard-grid.layout.spec.ts`, which batch B1 said was fixed and not re-run. Jest then printed that a worker was force-exited for open handles; the suites had already passed. No product timer was traced from that line.

Not run: usage-dashboard specs (B2 reported them green), marketplace badge specs, webview/Electron build, e2e, browser.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the three serious items (deadlines, reset line, docs). MEDIUM for DaisyUI tooltip-on-focus, which was not opened in a browser.
- Top risk: a cold plan-limits load times out at 30s after this batch made detection and the Codex lane sequential, so the card this work set out to fill stays empty or stale.
- What a robust implementation would add: a single RPC budget with a regression spec; `shortReset` taken from `formatToolResetText`; overflow windows on the cell tooltip; the repair clause registered in `HARNESS_BLOCKED_RECONCILE_STEPS`; doc steps that match the nav.
