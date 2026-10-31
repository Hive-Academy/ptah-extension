# Implementation Plan - TASK_2026_856_d668 (revision 3)

Move session metrics and timers out of component lifecycle, and make every session figure (context %, tokens, cost, cache, turns) come from one host or root definition. Electron first; every host keeps compiling.

`W` = `D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics` (all paths below are absolute under it).

## Revision 2 changes

| # | Change | Answers |
| --- | --- | --- |
| R1 | `inspector-session-stats.component.spec.ts` (imports/provides the old clock at `:5,18`) migrates in new batch **B5a**. Deletion moves to **B5b**, which depends on B5a. | Review Blocking 1 |
| R2 | Host regeneration flag reconciles with the service lock (`generationInProgress`) and a host ceiling exported from agent-generation. A token guards late completion. A new split: **B3a** (agent-generation ceiling) → **B3b** (handler). Tests advance past the ceiling with a never-settling run. Drawer re-reads status on the coarse clock while the host reports a run. | Review Serious 1 |
| R3 | Permission and question cards: the active predicate is `timeoutAt > 0 && !expired()`. Auto-deny is an independent effect. Tests assert `jest.getTimerCount() === 0` and the release call after expiry. | Review Serious 2 |
| R4 | `backgroundRevision` is bumped by `switchWorkspace`, `updateBackgroundTab`, `addTabToWorkspace` (background target) and `removeWorkspaceState` (`_workspaceTabSets.delete`, `tab-workspace-partition.service.ts:460`). Deletion tests are added. | Review Serious 3 |
| R5 | Subagent tool count: the monotonic claim is dropped. The value is `max(host toolUses, displayed tool nodes)`, labelled "current known count". A lag-plus-trim test pins the behaviour. Evidence for this choice is in D12. | Review Serious 4 |
| R6 | B13 is split into formal batches **B13a** and **B13b**, each with acceptance criteria, tests and a verify command. B19a and B19b gain acceptance criteria and named tests. | Review Serious 5 |
| R7 | `messageTokenTotal` returns `number \| null`. The badge renders `—` for `null`. | Review Minor 1 |
| R8 | The `N+ turns` design is removed. Turns come from host `turnCount`, with a defined fallback. Unknown turns render nothing, which is the existing `@if (turns() !== null)` convention. | Review Minor 2, decision #6 |
| R9 | The remount quality requirement excepts T2 and T5. | Review Minor 3 |
| R10 | Host lifetime `turnCount` is added to `SessionStatsEntry` (ledger, aggregator, live owner, snapshot validator, inspector). The partial-turn label is removed. New batches **TC1–TC3**, plus a change to B13b. | decisions.md #6 |
| R11 | New section **Context % correctness**: the formula with file:line, three defects (C1–C3), a views table, and batches **CX1–CX5** with concrete-number tests. | decisions.md #7 |
| R12 | New batch **B21** deletes `SessionCostSummaryComponent` and both exports. | decisions.md #5 |
| R13 | All five Proposed Removals are marked **APPROVED by user (decisions #5)**. The "if not approved" fallbacks are gone. | decisions.md #5, #8 |
| R14 | Correction to rev 1: the enhanced-prompts generation lock is process-global (`enhanced-prompts.service.ts:244,314-318,506-513`). The rev-1 test "a different workspace is not blocked" is replaced by its true behaviour. | Found while answering R2 |

## Revision 3 changes

| # | Change | Answers |
| --- | --- | --- |
| R15 | C1 carry-forward now also covers the `!snapshot` branch of `applyResumeStats` (`session-loader.service.ts:1273-1287`). When the host sends no `contextSnapshot` (latest record is a compact boundary, `session-history-reader.service.ts:1283-1285`), the tab re-installs its prior trusted reading for the same model, with the prior reading's own `contextUsed`. Model equality uses `normalizeModelKey` on both branches (`live-context-stats.ts:66`). New pin **F12** (prior 30,000 / 200,000, compact boundary latest → **15%**) in CX4. The stale-prior trade-off is D21. | Review Serious 1 |
| R16 | New defect **C4**: `extractContextSnapshot` (`session-history-reader.service.ts:1281-1296`) scans sidechain records. It now skips any record with `isSidechain === true`, both assistant frames and compact boundaries. "Current formula (verified)" is corrected. New pins **F13** (main 130,000, later sidechain 900,000 → 130,000) and **F14** (main 130,000, later sidechain compact boundary → still 130,000) in CX2. Decision D22. | Review Serious 2 |
| R17 | `BuilderSessionSectionComponent` (`builder-session-section.component.ts:57-59`) is added to "Every frontend view" (loose → strict) with new Component 23 and batch **HB1** (`@ptah-extension/harness-builder`). A full `contextPercent` / `contextUsed` / `contextKnown` reader inventory across `libs` and `apps` is recorded under the views table; every reader is now listed and either already strict or owned by a batch. | Review Serious 3 |
| R18 | Live owner: `runContribution` takes an explicit `turnCount`. The authoritative `run.current` contribution carries `run.turns`; the provisional estimate contribution carries `turnCount: 0`; an incomplete run omits it on both. New pin: prefix 4 + two accepted results + a live estimate = **6** (TC2). Decision D23. | Review Serious 4 |
| R19 | `isCompactSummary` gets a raw-field projection: `JsonlMessageLine` and `SessionHistoryMessage` (`history.types.ts:16-52,77-116`) gain it, and the converter (`jsonl-reader.service.ts:925-959`) forwards it with the existing `isSidechain` pattern. New Component 22 and batch **TC0** (3 files, 1 lib) precede TC1. `isMeta` is not relied on (D24: source shows compact-summary records reach the UI as ordinary user messages). A parity test pins identical raw-ledger and resume classification. | Review Serious 5 |
| R20 | The batch rule now reads: no file overlap between batches that can run in parallel. Overlap is allowed only across an explicit dependency (B2 → CX1, TC1 → CX2). TC1 → CX2 stays serial. | Review Minor 1 |

## Inputs and constraints

- Requirements used: `context.md`, `decisions.md` (rows #5–#8 binding), `research-metrics.md` (M1–M13), `research-timers.md` (T1–T24), `implementation-plan-review.md` (Gate 2, round 1, then the revise-1 re-review of rev 2), the orchestrator briefs for revisions 2 and 3.
- Corrections applied to the research (verified against source, see D5, D6, D9, D11):
  - T2: the probe cannot move to a root store, because the draft credential is in-memory by contract.
  - T5: the fallback deadline is tied to a component-scoped store, so it stays in the component.
  - M9: `findTabByIdAcrossWorkspaces` alone is not reactive for background tabs. A revision signal is needed.
  - The research lists 13 component `setInterval` sites. Source has one more: `command-center-clock.ts:7`.
- Design handoff used: none. This is a refactor. Visible changes are labels and unknown/partial cues (see the "UI" flag on each batch).
- Missing decision-critical input: none. task-description.md is absent, so `context.md` plus `decisions.md` carry intent.
- Binding scope (decisions #6):
  - No new persistent metrics store. The host transcript-derived `SessionStatsEntry` is the single source of truth.
  - The frontend never sums partial data into totals. CLI lanes use the host `usageTotals`. A segment fold is flagged partial and never presented as a total.
- Repository rules applied:
  - Root `CLAUDE.md`: memory-safe `npm run verify -- -p`, no build/serve/e2e/package, Electron first, every host compiling.
  - `eslint.config.mjs:414-422`: a `type:feature` lib may depend on `type:core|util|data-access|ui|feature`.
  - `eslint.config.mjs:303-304`: `scope:webview` libs may depend only on `scope:shared|scope:webview`.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `CacheCountdownClockService` is root, ref-counted (`acquire()` returns an idempotent release), visibility-aware, and runs one 1 s interval | `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/cache-countdown-clock.service.ts:5-50` | This is the pattern to generalise. It lives in a `type:feature` lib, so it moves to core. |
| Consumers of that clock: the cache tile (`inspector-cache-tile.component.ts:86,136`), its spec, and **`inspector-session-stats.component.spec.ts:5,18`**, which imports and provides it | grep over `libs`, `apps` | Three files migrate before deletion (B5a → B5b). |
| `@ptah-extension/core` is `scope:webview, type:core`. Every consumer lib already imports it | `libs/frontend/core/project.json`; grep counts | The core clock adds no dependency edge. chat-state (`type:data-access`) cannot import core (`eslint.config.mjs:425-426`) and needs no clock. |
| `TranscriptLiveClock` builds a per-component 1 s interval. Its only user is the chat transcript | `transcript/transcript-live-clock.ts:21-50`; `chat-transcript.component.ts:835` | Replace it and delete the file. |
| `AgentMonitorStore.tick` is a 1 s counter that runs while any agent runs, rendered or not | `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1038-1043,1296-1324`; consumers `agent-card.component.ts:286,300`, `subagent-lane.component.ts:291,324`, `lane-transcript.component.ts:96-99` | Consumers move to the core clock. The store loses the interval. |
| `commandCenterClock()` builds a 30 s interval per page controller | `libs/frontend/command-center/src/lib/components/command-center-clock.ts:3-11`; `command-center-page.controller.ts:69` | Replace it and delete the file and its spec. |
| `PlanLimitsStore.now` is a root 30 s clock that runs only after limits load | `libs/frontend/core/src/lib/services/plan-limits.store.ts:49-50,88-98,278` | Data-refresh clock. Left alone (D3). |
| `BackOfficeActivityService` runs its own idle interval | `libs/frontend/core/src/lib/services/back-office-activity.service.ts:125-154` | Idle detector. Out of scope (D3). |
| Per-component display intervals | `compact-session-card.component.ts:513-521`, `inspector-agents-section.component.ts:318-323`, `canvas-lane-tabs.component.ts:385-393`, `boot-progress.component.ts:273-278`, `permission-request-card.component.ts:207-226`, `question-card.component.ts:336-350`, `generation-workflow-shell.component.ts:450-455`, `ambient-account-row.component.ts:139-143`, `overview-tab.component.ts:306-315`, `provider-setup-wizard.component.ts:2406-2418`, `analysis-stats-dashboard.component.ts:173-243` | All move to the core clock. |
| Frozen "ago" and duration labels | `inline-agent-bubble.component.ts:960-970`, `resume-notification-banner.component.ts:196`, `electron-welcome.component.ts:271-278`, `history-timeline.component.ts:428-431`, `stash-popover.component.ts:26-28,223`, `workspace-indexing.component.ts:148-151`, `memory-diagnostics-accordion.component.ts:255-258` | Feed them from the core clock. |
| Existing clocks write signals from `runOutsideAngular` | `apps/ptah-extension-webview/src/app/app.config.ts:182-184`; `transcript-live-clock.ts:40` | The core clock schedules outside the zone. |
| The permission card arms a 1 s interval whenever `timeoutAt > 0`. It cleans up only on input change or destroy, and denies from inside the interval | `libs/frontend/chat-ui/src/lib/molecules/permissions/permission-request-card.component.ts:208-226`; `timeoutAt` contract `libs/shared/src/lib/types/permission.types.ts:66-67,182-183` | Expiry must stop the clock (R3). Auto-deny must be independent of the clock acquisition. |
| The drawer's regenerate guard lives in component fields | `libs/frontend/chat/src/lib/settings/pro-features/system-prompt-drawer.component.ts:337-342,434-499` | Lost on close. The host has no in-flight field (`libs/shared/src/lib/types/rpc/rpc-setup.types.ts:526-543`). |
| The unbound `enhancedPrompts:regenerate` handler awaits `enhancedPromptsService.regenerate` with no tracking | `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts:500-567` | Host-side tracking is needed (T1). |
| **Generation lock**: one process-global `isGenerating` flag. `GENERATION_LOCK_TIMEOUT_MS` = 12 min aborts the run, and `GENERATION_LOCK_GRACE_MS` = 30 s later force-releases the lock. The force-release does **not** settle the caller's `regenerate()` promise. `generationInProgress` exposes the lock | `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:223-232,244,314-348,354-378,506-513` | A handler `finally` alone can leave a stuck flag (Serious 1). The handler reconciles with the lock and a ceiling (R2). |
| `EnhancedPromptsRpcHandlers` is a DI singleton | `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts:115` | An in-memory map on the handler lives for the host process. |
| Provider wizard: the draft credential "lives in memory … nothing is written to disk before the host commits" | `provider-setup-wizard.component.ts:8-16,24-26,1500-1529,2183-2225` | The probe's lifetime is bounded by the draft (D5). |
| `SetupWizardStateService.analysisStream` is root. `reset()` clears it per run | `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts:130,188,446-457` | A root `computed` holds the run start (T3). |
| `ElectronLayoutService.workspaceResolved` starts false in Electron and flips once | `libs/frontend/core/src/lib/services/electron-layout.service.ts:91,126-131,898` | The root service owns the load start (T4). |
| `CanvasEmptyBoardComponent` provides `WorkspaceVitalsStore` per component | `libs/frontend/canvas/src/lib/canvas-rail/canvas-empty-board.component.ts:83,273,316-323` | The fallback deadline restarts with the load (D6). |
| `SessionStatsEntry`: four disjoint token classes, `tokenCount` is their sum, a missing field means unavailable. `messageCount` counts parent assistant records. **There is no turn field** | `libs/shared/src/lib/types/rpc/rpc-session.types.ts:347-462` | Canonical token definition (M7). `turnCount` is added here (R10). |
| Ledger: records are parent/subagent API messages. User lines are dropped (`if (!assistant && !hasUsage) return`). Lines are pre-filtered by substring markers | `libs/backend/agent-sdk/src/lib/session-stats/session-usage-ledger.ts:21-36,81-99,106,163-235` | Turn counting needs a prompt record kind and a cheap gate. |
| Aggregator: `messageCount` is counted in `count()` for the ledger path, and summed over contributions for the live path. `finishEntry` is the shared tail | `libs/backend/agent-sdk/src/lib/session-stats/session-usage-aggregator.ts:201-304,306-392,395-450` | `turnCount` follows the same two paths. |
| Live owner: snapshot = transcript prefix + one contribution per query run. A result is accepted once (`replaceRun` outcome `'accepted'`). Run contributions report `messageCount: 0` | `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:1-38,345-363,555-621,864-919,1090-1135` | The live `turnCount` = prefix + accepted results per run (D17). |
| Resume and history: `buildUsagePrefix` / `ledgerFromMessages` run the same ledger and aggregator | `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:1230-1266,1323-1342` | The resume path gets `turnCount` from the shared code. Field pass-through is needed. |
| `SessionHistoryMessage` carries `isMeta`, `isSidechain` and `message.content` | `libs/backend/agent-sdk/src/lib/helpers/history/history.types.ts:77-105` | The prompt classification can run on the resume path. |
| The frontend turn count is a loaded-window count (`countTurns`). A run of user messages opens one turn. `null` when no user turn is loaded | `libs/frontend/chat/src/lib/services/session-inspector/session-inspector.store.ts:75-85,204` | It becomes the fallback only (R8). |
| The inspector turns label is hidden when `turns()` is null | `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts:255-258,396` | No template change is needed for unknown turns. |
| The snapshot boundary validator checks optional fields one by one | `libs/frontend/chat-state/src/lib/session-stats-snapshot.ts:20-56,109-119` | `turnCount` gets `isOptional(…, isRevision)` (TC3). |
| History is paged. A tab keeps `olderHistoryCursor` while older events are unloaded | `libs/frontend/chat/src/lib/services/chat-store/history-paging.service.ts:32-40`; `libs/frontend/chat-types/src/lib/chat-types.ts:642` | The loaded-window count is complete only when the cursor is null. |
| Context formula sites: see "Context % correctness" | — | — |
| `addCliUsage` is "the one definition of 'sum lane usage'" | `libs/shared/src/lib/utils/cli-usage.utils.ts:1-58`; barrel `libs/shared/src/lib/utils/index.ts:88-92` | The CLI token rule goes beside it. |
| Lane projections exist, and three surfaces re-derive fallbacks | `libs/frontend/chat/src/lib/utils/lane-stats.adapters.ts:33-108`; `inspector-agent-usage.ts:33-71`; `cli-lane-usage-summary.component.ts:67-99`; `cli-agent-output.component.ts:186` | One resolver (M2–M4). |
| Command Center finds tabs in the active workspace only | `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:97-144` | M9 is confirmed. |
| `_workspaceTabSets` is a plain `Map`. Writers: `switchWorkspace` `:202,216,223`; `updateBackgroundTab` `:401`; `addTabToWorkspace` `:434`; `removeWorkspaceState` `.delete` `:460`; `syncActiveWorkspaceState` `:533` (active path only) | `libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts:90,102,194-235,374-460,530-545` | Four writers touch background entries and must bump the revision (R4). |
| Subagent tool count today: the displayed tree count when non-empty, else host `toolUses` | `libs/frontend/chat/src/lib/components/organisms/execution/subagent-tile.component.ts:236-247`; `inline-agent-bubble.component.ts:909-925` | The rule diverges between surfaces (M12). |
| The subagent tree is bounded. `ENTRY_EVENT_CAP` evicts events and sets `truncated`. `evictFinalized` drops finalized entries (LRU) | `libs/frontend/chat-streaming/src/lib/subagent-execution.store.ts:295-320,388-399,447,484,495` | The displayed count can fall, so a monotonic value would need a per-entry id set that survives eviction (D12). |
| Host `toolUses` is "last reported", replaced per progress event | `agent-monitor.store.ts:646-648,2402,2492` | The host count can lag the tree. |
| `SessionCostSummaryComponent`: one file, no spec, no selector use. Exported from `chat-ui/src/index.ts:114` and re-exported (deprecated) from `chat/src/lib/components/index.ts:102-105` | grep over `libs`, `apps` | B21 deletes it. `calculateSessionCostSummary` in shared is a different symbol and stays. |

## Architecture decision

- **Chosen approach**: shared primitives first, then a mechanical migration of consumers. No new state architecture and no new persistent store.
  1. A root **`WallClockService`** in `@ptah-extension/core` with two cadences: `second` (1 s) and `coarse` (30 s).
     - Ref-counted, paused while the document is hidden, run outside the zone, refreshed on acquire and on visibility return.
     - Components reach it only through `injectWallClock(cadence, active?)`.
     - It replaces `CacheCountdownClockService`, `TranscriptLiveClock`, `commandCenterClock` and `AgentMonitorStore.tick`, all deleted.
  2. **One definition per figure**, as pure functions:
     - Tokens: `messageTokenTotal`, `sessionTokenTotal`, `cliUsageTokenTotal` (shared).
     - Context: `contextFillTokens`, `trustedContextWindow`, `contextFillPercent` (shared), used by the host formula sites and every frontend writer of `liveModelStats`. `sessionContextCue` (chat-ui) stays the one display rule.
     - Lane usage: `resolveCliLaneUsage` (chat).
     - Subagent tools: `subagentToolCount` (chat).
     - Turns: host `SessionStatsEntry.turnCount`.
     - Unknown is always `null`, rendered as `—` or hidden. It is never rendered as 0.
  3. **Durable owners for starts and deadlines**:
     - The host for T1, through one additive optional field reconciled with the generation lock.
     - Root services for T3 and T4.
     - Existing host or root timestamps for everything else.
  4. A `backgroundTabsRevision` signal makes cross-workspace tab lookups reactive.
- **Rationale**:
  - Every elapsed or countdown label except T1–T4 already has a durable timestamp, so the defects are ticks, not lost state.
  - Most metric defects are divergent definitions (M1–M7, M12, M13, C3), lookup scope (M9), or a known value dropped on reload (C1).
  - The host already rebuilds `SessionStatsEntry` from the transcript on every path, so `turnCount` costs one field and no new store (decision #6).
- **Rejected alternatives**:
  - (a) `AgentMonitorStore.tick` as the shared clock. It is a counter, it runs without renderers, and non-chat libs should not depend on the agent store.
  - (b) `PlanLimitsStore.now`. It is too coarse and starts only after limits load (`plan-limits.store.ts:273-281`).
  - (c) A new lib for the clock. That adds a project for one service.
  - (d) A frontend root store for T1. It dies on renderer reload.
  - (e) Rev-1 "N+ turns". It is superseded by decision #6. The host count is exact whenever it is present.
  - (f) A persistent context-capacity store. It is forbidden by decision #6, and the tab's persisted reading already carries the evidence (C1).
- **Assumptions**: listed per component as `Assumption`, each with a resolving check.
- **Effect on existing code**:
  - Replaced: 4 clock implementations and 14 component intervals or ad-hoc `Date.now()` reads.
  - Replaced: the drawer regenerate heuristic.
  - Replaced: the per-surface lane-usage fallbacks.
  - Replaced: three copies of the capacity-trust predicate and two copies of the percent formula.
  - Replaced: the loose `contextKnown` rule in two views, and the unguarded percent in the harness builder summary (rev 3).
  - Replaced: the client-only turn count, which becomes the fallback.
  - Deleted: `SessionCostSummaryComponent`.
  - Left alone: `PlanLimitsStore.now`, `BackOfficeActivityService`, `GenerationHandoffStore` timers, `BootStatusService` watchdog, the `canvas.store.ts` hidden-status interval, cosmetic typing loops (`streaming-quotes.component.ts:104`, `analysis-activity-indicator.component.ts:107`), `voice-input.service.ts`, M10.

## Context % correctness

### Current formula (verified)

| Part | Rule today | Location |
| --- | --- | --- |
| Numerator, live | `input + cacheRead + cacheCreation` of the **latest main-loop request**. It comes from `message_start` usage when `parent_tool_use_id` is null, so subagent frames never overwrite it. Proxy routes override it from `message_delta`. **Output tokens are excluded.** Published per model as `lastTurnContextTokens` | `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:633-680` (capture), `:896-913` (publish) |
| Numerator, history/resume | The same three classes from the **last assistant record in the main transcript file**. Scanning backwards, a `compact_boundary` first means no frame (`undefined`). **Today the scan does not check `isSidechain`** (`:1281-1296`), so a subagent record written into the main transcript (`history.types.ts:83-84`) can supply the frame or, as a sidechain compact boundary, erase a valid main frame (defect C4). After CX2 the scan skips every `isSidechain === true` record, which makes it the main-loop-only rule the live path already applies | `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:1271-1301` |
| Compaction, live | The tracked frames are cleared on the compact boundary (`stream-transformer.ts:1090-1092`). The tab re-seeds from the boundary's post-compaction tokens with the prior reading's capacity (`contextFillStats`) | `libs/frontend/chat-state/src/lib/tab-manager.service.ts:2578,2597`; `libs/frontend/chat-state/src/lib/live-context-stats.ts:17-51` |
| Window | Evidence only. `resolveContextCapacity` returns `sdk-native` (the SDK's per-model `contextWindow` on a native route) or `provider-catalog` (needs a provider id), else `unknown`. **1M variants are correct live**, because the SDK reports `contextWindow: 1_000_000` for a 1M session. The `[1m]` tag in a model id is not used. The static `getModelContextWindow` table never feeds the gauge | `libs/shared/src/lib/utils/pricing.utils.ts:439-541`; `stream-transformer.ts:897-906` |
| Window, history/resume | **Always unknown**: `contextWindow: 0` and capacity `resolveContextCapacity({ model })` without a route gives `source: 'unknown'` | `session-history-reader.service.ts:1303-1317` |
| Trust predicate | `capacity.model === model`, source `sdk-native`, or `provider-catalog` with a non-empty `providerId`, plus `tokens > 0` and finite. It exists in **three copies** | `live-context-stats.ts:31-43`; `libs/frontend/chat/src/lib/services/chat-store/session-live-stats.util.ts:78-90`; `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-view.ts:42-52` (plus `live.contextWindow === capacity.tokens`) |
| Percent | `Math.round(used / window * 1000) / 10`, one decimal, unclamped, `0` when the window is unknown. It exists in **two copies** | `live-context-stats.ts:49-50`; `session-live-stats.util.ts:98-101` |
| Resume install | `applyLoadedSessionStats` writes an unknown placeholder. `applyResumeStats` then derives from `contextSnapshot` (capacity unknown, see above) | `tab-manager.service.ts:2752-2777`; `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:1229-1303` |
| Fork | A fork opens a new session id in a new tab. Its transcript copies the parent history, so the frame is known and the window is unknown | follows from the two rows above |

The formula itself (numerator classes, main loop only, compaction reset, evidence-only window, one-decimal percent) is correct on the live path. On the history path it is correct except for the missing sidechain filter (C4). Output tokens of the last reply are not part of the prompt that was measured. Defects:

- **C1 — A known context % is lost on resume and on renderer reload.**
  - The tab's `liveModelStats` is persisted to localStorage. It is not in `NON_PERSISTED_TAB_KEYS` (`libs/frontend/chat-state/src/lib/tab-persistence.ts:84-90`).
  - Re-opening the session, or a renderer reload, calls `applyResumeStats`, which replaces a known `65%` with an unknown frame (capacity `unknown`). Strict views then show `—` until the next turn ends.
  - **Fix (CX4)**: before installing, capture the tab's prior reading (the same capture `compactionContextSeed` already does, `session-loader.service.ts:1251-1255`). Then, on both resume branches:
    - **Snapshot present** (`:1289-1303`): when the derived frame is not known and the prior reading has a trusted window for the same model, install `contextFillStats(prior, snapshot.contextTokens)`.
    - **No snapshot** (`:1273-1287`, reached when the latest main record is a compact boundary or the transcript has no main assistant usage): when the prior reading has a trusted window for the same model as `stats.model`, re-install it with its own fill, `contextFillStats(prior, prior.contextUsed)`. Otherwise keep today's unknown placeholder. This keeps a live post-compaction reading (F8, seeded at `tab-manager.service.ts:2578,2597`) across a renderer reload (F12).
    - "Same model" is `normalizeModelKey(prior.model) === normalizeModelKey(model)` on both branches, the comparison `liveContextStats` already uses (`live-context-stats.ts:66`).
  - This is the carry-forward rule the tab already applies for compaction (`tab-manager.service.ts:2578,2597`) and live estimates (`liveContextStats`). No new store (D18, D21).
- **C2 — Two views use a loose rule** (`contextKnown` only). After resume `contextKnown` is true with `contextWindow: 0`, so they render **`0%`** for an unknown window:
  - `compact-session-card.component.ts:261-265`
  - `session-inspector.store.ts:111-125`
  - **Fix**: both use `sessionContextCue` (B8b, B13b). This is rev-1 M13, now with the concrete failure.
  - Rev 3: a third view, the harness builder sidebar summary (`builder-session-section.component.ts:57-59`), has no rule at all and prints any non-null percent. **Fix**: `sessionContextCue` (HB1).
- **C3 — Three trust predicates and two percent formulas can drift.**
  - **Fix (CX1, CX3, CX4)**: shared `trustedContextWindow` and `contextFillPercent`, used by all three writers and by `sessionContextCue`.
  - **Fix (CX2)**: the host's two numerator sums use shared `contextFillTokens`.
- **C4 — The history frame can come from a subagent.**
  - `extractContextSnapshot` walks `mainMessages` backwards and checks neither assistant frames nor compact boundaries for `isSidechain` (`session-history-reader.service.ts:1281-1296`). `SessionHistoryMessage.isSidechain` marks a subagent record in the main transcript (`history.types.ts:83-84`), and the converter sets it only for a literal `true` (`jsonl-reader.service.ts:939`).
  - A later sidechain assistant record replaces the main numerator on resume (130,000 → 900,000). A later sidechain compact boundary returns `undefined` and erases a valid main frame.
  - **Fix (CX2)**: the backwards loop starts with `if (msg.isSidechain === true) continue;`, before the compact-boundary check. The `system/init` model scan is unchanged. Decision D22.

Accepted limitation (D19): a forked session in a new tab has no prior reading, so its context stays `—` until its first turn ends. Inferring a window from the model id would bring back the static-table guess that capacity evidence replaced.

### Formula pinned by tests (concrete numbers)

| Id | Input | Expected |
| --- | --- | --- |
| F1 | usage input 2,000; cacheRead 120,000; cacheCreation 8,000; output 5,000 | `contextFillTokens` = **130,000** (output excluded) |
| F2 | 130,000 used, trusted window 200,000 | **65** → label `65%` |
| F3 | 130,000 used, sdk-native window 1,000,000 (1M variant) | **13** → `13%` |
| F4 | 33,333 used / 200,000 | **16.7** (one-decimal rounding) |
| F5 | 210,000 used / 200,000 | **105** in the label (unclamped). The empty-state ring width clamps to 100 |
| F6 | Capacity `unknown`, or a `provider-catalog` without a provider id, or `capacity.model` ≠ model | window `null` → percent `null` → `—`. **Never `0%`** |
| F7 | Proxy: `message_start` usage all 0, then `message_delta` input 50,000 + cacheRead 10,000 | **60,000** |
| F8 | Live compaction: prior sdk-native 200,000, post-compaction 30,000 | **15** |
| F9 | History: assistant 130,000 then `compact_boundary` as the latest record | no `contextSnapshot` |
| F10 | Resume (C1): prior sdk-native 200,000 for model M, snapshot frame 130,000 for M | **65%**. Same frame with prior model N ≠ M → `—`. No prior → `—` |
| F11 | Subagent `message_start` (non-null `parent_tool_use_id`) of 900,000 during a main frame of 130,000 | the main frame stays **130,000** |
| F12 | Resume (C1, no snapshot): prior sdk-native 200,000 for model M with `contextUsed` 30,000 (15%); host reply has `stats.model` M and no `contextSnapshot` because the latest record is a compact boundary | **15%** (`contextUsed` 30,000). Prior model N ≠ M → `—`. Prior with `provider-catalog` and no provider id → `—`. No prior → `—` (today's placeholder) |
| F13 | History: main assistant 130,000, then a later `isSidechain: true` assistant 900,000 | `contextSnapshot.contextTokens` **130,000** |
| F14 | History: main assistant 130,000, then a later `isSidechain: true` `compact_boundary` | `contextSnapshot` present, **130,000**. A main (non-sidechain) `compact_boundary` in the same position still gives no snapshot (F9) |

### Every frontend view of context %

| View | Source | Rule after this task | Pin test (batch) |
| --- | --- | --- | --- |
| Session stats summary (chat header) | `session-stats-summary.component.ts:189` → `sessionContextCue` | strict | `session-stats-summary.component.spec.ts`: F2, F6 (CX3) |
| Inspector stats tile | `session-stats-source.ts:242` → `sessionContextCue` | strict | `session-stats-source.spec.ts`: F2, F3, F6 (CX5) |
| Chat empty-state ring | `chat-empty-state-screen.component.ts:165-173` ← `ChatVitalsStore.context` (`chat-vitals.store.ts:74-76`) | strict. Integer and clamp are presentation only | `chat-vitals.store.spec.ts`: F2, F5, F6 (CX5) |
| Command Center header | `command-center-page.component.ts:144` → `sessionContextCue` | strict, now cross-workspace | `command-center-page.component.spec.ts`: F2 on a background tab (B18) |
| Compact session card + activity + rail | `compact-session-card.component.ts:261-265` → `compact-session-activity.component.ts:870`, `compact-rail-card.component.ts:404` | **loose → strict** (C2) | `compact-session-card.component.spec.ts`: F6 after resume (B8b); `compact-rail-card.component.spec.ts`: known `0%` shown, `null` hidden (B7) |
| Inspector orchestrator card | `session-inspector.store.ts:111-125` | **loose → strict** (C2) | `session-inspector.store.spec.ts`: F2, F6 (B13b) |
| Harness builder sidebar, collapsed summary | `libs/frontend/harness-builder/src/lib/components/sidebar/builder-session-section.component.ts:57-59` reads `liveModelStats().contextPercent` and prints every non-null value. Both resume writes carry `contextPercent: 0` for an unknown window (the placeholder at `tab-manager.service.ts:2760-2767` and the snapshot-derived frame), so it shows `Context 0%` | **loose → strict** (C2) via `sessionContextCue(...).label` | `builder-session-section.component.spec.ts`: F2 (`Context 65%`), F6 resume placeholder (`Context —`) (HB1) |
| Harness builder sidebar, expanded | the same component embeds `<ptah-session-stats-summary>` (`builder-session-section.component.ts:42-45`) | strict (the summary row above) | covered by CX3 |

Reader inventory (closes the "unlisted view" gap). Greps run for rev 3: `contextPercent` and `\.contextUsed|\.contextWindow\b` over non-spec files in `libs/frontend` and `apps`, plus `contextPercent|contextKnown` over every non-spec path outside `libs/frontend`. `apps` and the backend have no hits. Every hit is one of:

| Hit | Kind | Status |
| --- | --- | --- |
| `chat-types.ts:718`, `tab-state.types.ts:22`, `session-inspector.types.ts:52`, `session-stats-summary.component.ts:59` | type declaration | no rendering |
| `live-context-stats.ts:49`, `session-live-stats.util.ts:98`, `tab-manager.service.ts:2766` | writers | CX3, CX4; the placeholder is read only through strict views |
| `session-stats-view.ts:42-69` | `sessionContextCue` and its tooltip | the strict rule itself (CX3) |
| `session-stats-summary.component.ts:182-200`, `.html:50,340-343,496-505` (label, token count, 70% warning, bar width and 90% critical class) | view | strict: every use is inside `hasKnownContextWindow()` = `sessionContextCue(...).known` |
| `compact-session-card.component.ts:132,187,261-265` → `compact-session-activity.component.ts:824-874`, `compact-rail-card.component.ts:404-443` | view | listed above (B8b, B7) |
| `session-inspector.store.ts:124-125` | view model | listed above (B13b) |
| `chat-empty-state-screen.component.ts:65-73,165` | view | listed above (CX5) |
| `command-center-page.component.html:9` → `command-center-header.component.ts:49-58` | view | fed by `contextCue().percent`, strict; listed above (B18) |
| `builder-session-section.component.ts:57-59` | view | new row above (HB1) |

Verification point for the final gate: the same grep, run on the final tree, returns no non-spec hit outside this table.

## Component specifications

### 1. WallClockService + `injectWallClock` (core)

- Purpose: the single epoch-now source for rendered elapsed, countdown, age and day values.
- Responsibilities:
  - `now(cadence): Signal<number>` for `cadence: 'second' | 'coarse'`. Export `WALL_CLOCK_COARSE_MS = 30_000`.
  - `acquire(cadence): () => void` ref-counts per cadence.
    - The first acquire adds the `visibilitychange` listener and starts the interval.
    - Every acquire sets the cadence signal to `Date.now()`.
    - The release is idempotent. The last release stops the interval and removes the listener (shape of `cache-countdown-clock.service.ts:22-37`).
  - Hidden: stop every interval. Visible again: refresh every acquired cadence and restart it.
  - Intervals start inside `NgZone.runOutsideAngular`.
  - `injectWallClock(cadence, active?: () => boolean): Signal<number>`, called in an injection context.
    - Without `active`: acquire now, release on `DestroyRef.onDestroy`.
    - With `active`: an `effect((onCleanup) => …)` acquires inside `untracked` while `active()` is true, and releases on cleanup.
    - Returns `service.now(cadence)`. A component that needs the clock inside its own `active` predicate reads `inject(WallClockService).now(cadence)`. It is the same signal, so there is no circular initialisation (Component 6).
  - Day values: consumers compute `localDayKey(new Date(coarse()))`.
- Verified contracts: pattern `cache-countdown-clock.service.ts:1-51`; export site `libs/frontend/core/src/lib/services/index.ts`; `libs/frontend/core/src/index.ts:1` re-exports it.
- Dependencies: `@angular/core`, `DOCUMENT`.
- Failure behaviour: no I/O. A missing `DOCUMENT.hidden` reads as visible. A double release is a no-op.
- Quality requirements: at most one interval per cadence app-wide. None while nothing is acquired or the window is hidden.
- Verification seam: `wall-clock.service.spec.ts` with jest fake timers.
  - Two acquires give one interval (`jest.getTimerCount() === 1`), and the last release gives 0.
  - Hidden stops ticking. Visible resumes with a fresh value.
  - Acquire refreshes `now`.
  - The `active` gate acquires and releases.
  - Release is idempotent.
- Files: CREATE `W\libs\frontend\core\src\lib\services\wall-clock.service.ts`, `…\wall-clock.service.spec.ts`; MODIFY `W\libs\frontend\core\src\lib\services\index.ts`.

### 2. Canonical token helpers (shared)

- Responsibilities (new `token-usage.utils.ts`):
  - `messageTokenTotal(t: MessageTokenUsage | null | undefined): number | null` returns `input + output + (cacheRead ?? 0) + (cacheCreation ?? 0)`. It returns `null` when `t` is absent or any present class is not a finite non-negative number (R7). This matches the four-class definition in `rpc-session.types.ts:376-384`.
  - `sessionTokenTotal(entry): number | null` returns a finite `tokenCount`, else `null`. It never recomputes.
  - In `cli-usage.utils.ts`: `cliUsageTokenTotal(usage): { value: number; exact: boolean } | null`.
    - A reported `totalTokens` gives `{ value, exact: true }`.
    - Otherwise, defined in/out gives `{ value: in + out, exact: false }`.
    - Otherwise `null`.
    - Cache classes are not added (D14).
- Verified contracts: `MessageTokenUsage` `libs/shared/src/lib/types/execution/node.ts:60-69`; `CliUsageTotals` `cli-usage.utils.ts:12`; barrel `libs/shared/src/lib/utils/index.ts:88-92` → `libs/shared/src/index.ts:64`.
- Failure behaviour: pure. A non-finite input gives `null`.
- Verification seam:
  - Four-class sum. Missing cache counts as 0.
  - `NaN` gives `null`.
  - `tokenCount` absent gives `null`. `tokenCount` 0 gives 0.
  - CLI: exact, then inexact, then `null`.
- Files: CREATE `W\libs\shared\src\lib\utils\token-usage.utils.ts` (+ `.spec.ts`); MODIFY `W\libs\shared\src\lib\utils\index.ts`, `…\cli-usage.utils.ts` (+ `.spec.ts`).

### 2b. Context fill helpers (shared) — C3

- Responsibilities (new `context-fill.utils.ts`, beside `pricing.utils.ts`, which owns `ContextCapacity`):
  - `contextFillTokens(u: { input?: number; cacheRead?: number; cacheCreation?: number }): number` returns the sum. Missing or non-finite counts as 0. **Output is not a parameter**, so it cannot be added by mistake.
  - `trustedContextWindow(capacity: ContextCapacity | null | undefined, model: string): number | null` returns `capacity.tokens` only when the predicate in the formula table holds, else `null`.
  - `contextFillPercent(used: number, window: number | null): number | null` returns `Math.round(used / window * 1000) / 10` for a finite `used >= 0` and `window > 0`, else `null`. Unclamped.
- Verified contracts: `ContextCapacity` `pricing.utils.ts:444-449`; the predicate copies listed in the formula table.
- Dependencies: shared types only.
- Failure behaviour: pure. Unknown gives `null`.
- Verification seam: `context-fill.utils.spec.ts`, cases F1–F6.
- Files: CREATE `W\libs\shared\src\lib\utils\context-fill.utils.ts` (+ `.spec.ts`); MODIFY `W\libs\shared\src\lib\utils\index.ts`.

### 3. Host-owned regeneration state (T1) — revised for Serious 1

- Purpose: the host says whether an unbound system-prompt regeneration is in flight. It stays truthful when the run never settles.
- Responsibilities:
  - **agent-generation**: export `ENHANCED_PROMPTS_RUN_CEILING_MS = GENERATION_LOCK_TIMEOUT_MS + GENERATION_LOCK_GRACE_MS` (12.5 min) from `enhanced-prompts.service.ts`. Re-export it through `services/enhanced-prompts/index.ts` and `libs/backend/agent-generation/src/index.ts:99-103`. This is the latest moment the lock can still be held for a run (`:323-347`).
  - **Contract**: `EnhancedPromptsGetStatusResponse.regenerationStartedAt?: string | null`. ISO, matching `generatedAt` (`rpc-setup.types.ts:533`).
  - **Handler state**: `private readonly regenerationsInFlight = new Map<string, { startedAt: number; token: object }>()`, keyed by the resolved workspace path.
  - **Reconciliation** (`liveEntry(workspacePath)`, used by both `getStatus` and `regenerate`):
    - An entry is live only while `enhancedPromptsService.generationInProgress` is true **and** `Date.now() - startedAt < ENHANCED_PROMPTS_RUN_CEILING_MS`.
    - Otherwise the entry is deleted and `null` is returned.
    - The lock check covers the force-release path, which clears the lock without settling the promise.
    - The ceiling covers a lock re-taken by a later bound run after the force-release.
    - No timer is armed. Reconciliation runs lazily on read (runtime-cost rule).
  - **`registerRegenerate`, unbound path**, after authorization (`enhanced-prompts-rpc.handlers.ts:517-523`):
    - If `liveEntry` exists, return `{ success: false, error: 'A regeneration is already running for this workspace.' }`.
    - Otherwise set `{ startedAt: Date.now(), token: {} }` before awaiting the service.
    - In `finally`, delete the key **only if the stored token is this call's token**.
  - **Late completion**: a reconciled run that settles later returns its result to its own RPC caller only. It neither re-creates the entry nor clears a newer run's entry. The service's own owner check (`:314-348`, `generationCommittingOwner`) already prevents a timed-out run from committing.
  - **`registerGetStatus`**: adds `regenerationStartedAt: liveEntry ? new Date(startedAt).toISOString() : null` to the success response.
  - **Cancel**: the handler adds no cancel. The service already aborts the run at the lock timeout (`:328-331`). The drawer has no cancel today, and adding one is out of scope.
  - **Global lock**: the lock is process-global (R14). A regenerate for workspace B while A runs passes the handler guard (it is per workspace) and then gets the service's `'Generation already in progress'`. `getStatus(B)` never reports A's entry.
- Verified contracts: response type `rpc-setup.types.ts:526-543`; handler `enhanced-prompts-rpc.handlers.ts:164-215,500-567`; singleton `register-shared-rpc-handlers.ts:115`; RPC map `libs/shared/src/lib/types/rpc.types.ts:1264,1276`; `generationInProgress` `enhanced-prompts.service.ts:376-378`; the spec mock is a `Pick` of the service (`enhanced-prompts-rpc.handlers.spec.ts:180-200`) and must add `generationInProgress`.
- Consumers: the drawer (Component 13). Other readers of `enhancedPrompts:getStatus` are unaffected, because the field is optional: `agent-behaviour-section.component.ts`, `setup-wizard/.../wizard-rpc.service.ts`, `apps/ptah-cli/src/cli/commands/prompts.ts`, the e2e fixture `settings-advanced-search-voice.fixtures.ts`.
- Failure behaviour: no stuck flag is possible past the ceiling or after lock release. A host restart clears the map. Tab-bound runs keep `GuidanceGenerationRunSupervisor`. The error copy is fixed text with no path.
- Verification seam: `enhanced-prompts-rpc.handlers.spec.ts` with `jest.useFakeTimers()`, which fakes `Date`.
  1. During a pending regenerate with `generationInProgress = true`, `getStatus` returns the ISO start.
  2. A second regenerate for the same workspace is rejected.
  3. **Never-settling run, lock released**: the service mock returns `new Promise(() => {})` and `generationInProgress` then becomes `false`. `getStatus` returns `null`, and a new regenerate reaches the service.
  4. **Never-settling run, lock still held**: advance `ENHANCED_PROMPTS_RUN_CEILING_MS + 1` ms. `getStatus` returns `null`.
  5. **Late completion**: after case 3, run 2 starts. Settling run 1 resolves run 1's caller with its result, and `getStatus` still reports run 2.
  6. After resolve and after throw, `getStatus` returns `null`.
  7. `getStatus(B)` is `null` while A runs.
- Files: see B3a, B3b.

### 4. Reactive cross-workspace tab lookup (chat-state) — revised for Serious 3

- Responsibilities:
  - `TabWorkspacePartitionService` gains `private readonly _backgroundRevision = signal(0)` and `readonly backgroundRevision$ = this._backgroundRevision.asReadonly()`.
  - Bump it exactly once per call in:
    - `switchWorkspace` (`:194-235`, moves the old active set into the map and loads the target)
    - `updateBackgroundTab` (`:374-421`, when it mutates)
    - `addTabToWorkspace` (`:423-448`, when the target is not the active path)
    - `removeWorkspaceState` (`:450-489`, when an entry existed before the `.delete` at `:460`)
  - `syncActiveWorkspaceState` (`:530-545`) writes the active path only and does not bump.
  - `TabManagerService` exposes `readonly backgroundTabsRevision = this.workspacePartition.backgroundRevision$`.
  - `findTabByIdAcrossWorkspaces` stays untracked (D9). Reactive callers read `backgroundTabsRevision()` first.
- Verified contracts: `tab-workspace-partition.service.ts:90-123,194-235,326-351,374-460,530-545`; `tab-manager.service.ts:709-718`.
- Failure behaviour: purely additive. A missed bump leaves today's staleness, so each writer has a test.
- Quality requirements: one signal write per mutating call. No per-tab signals.
- Verification seam:
  - Partition spec: each of the four writers increments the revision once. `syncActiveWorkspaceState` does not. `removeWorkspaceState` for an unknown path does not.
  - Tab-manager spec: a `computed` reading the revision and `findTabByIdAcrossWorkspaces(id)` re-evaluates after `updateBackgroundTab`, and returns `null` after `removeWorkspaceState` of that background workspace.
- Files: MODIFY `W\libs\frontend\chat-state\src\lib\tab-workspace-partition.service.ts` (+ `.spec.ts`), `…\tab-manager.service.ts` (+ `.spec.ts`).

### 5. Root-owned run starts (T3, T4)

- T3: `SetupWizardStateService.analysisStartedAt = computed(() => this.analysisStreamSignal()[0]?.timestamp ?? null)`. `AnalysisStatsDashboardComponent` drops its timer fields and effect. It renders `elapsedTime` from `now = injectWallClock('second', () => this.wizardState.analysisStartedAt() !== null)`.
- T4: `ElectronLayoutService.workspaceResolveStartedAt: number`, captured where `_workspaceResolved` is initialised (`:91`). `WorkspaceLoadingStateComponent` arms one `setTimeout(max(0, start + SLOW_HINT_MS - Date.now()))` and clears it on destroy.
- T24: the same component's `today` uses `localDayKey(new Date(coarse()))`.
- Verified contracts: `setup-wizard-state.service.ts:130,188,446-457`; `analysis-stats-dashboard.component.ts:164-243`; `electron-layout.service.ts:91,126-131`; `workspace-loading-state.component.ts:45,261-287`; `localDayKey` `libs/frontend/chat/src/lib/services/vitals/usage-vitals.model.ts:82`.
- Assumption: the first sync starts during construction (`restoreLayout()` at `:176`). Check: read `restoreLayout` and confirm it calls `syncFromBackend`. If it does not, capture the start at the first `syncFromBackend` call.
- Failure behaviour:
  - T3: with no events, the label shows `0:00` and no clock is acquired.
  - T4: outside Electron the component never renders.
- Verification seam:
  - State spec: the first event becomes the start, and `reset()` gives `null`.
  - Dashboard spec: the label after a remount is derived from the store start.
  - Layout spec: the start is set.
  - Loading spec: remounting after 8 s shows the hint at 10 s from the original start.

### 6. chat-ui clock consumers (T16, T17, T18, cache tile) — revised for Serious 2

- `InspectorCacheTileComponent`: `clock = injectWallClock('second')`. Drop the explicit acquire (`:86,136`).
- `inspector-session-stats.component.spec.ts`: replace the `CacheCountdownClockService` import and provider (`:5,18`) with the real `WallClockService` under fake timers. The assertions are unchanged (R1).
- `BootProgressComponent`: replace the local `now` and interval (`:268-279`) with `injectWallClock('second')`.
- `PermissionRequestCardComponent`:
  - `private readonly clockNow = inject(WallClockService).now('second')`.
  - `expired = computed(() => { const t = this.request().timeoutAt; return t > 0 && this.clockNow() >= t; })`.
  - `injectWallClock('second', () => this.request().timeoutAt > 0 && !this.expired())`. The clock is released as soon as the request expires.
  - The acquire refreshes `now`. A card mounted against a stale `now` therefore acquires once, sees `expired()` true, and releases in the same flush.
  - `remainingTime` and `isExpiringSoon` read `clockNow()`.
  - **Auto-deny is a separate `effect`**: when `expired()` is true and `request().id !== this.deniedRequestId`, set `deniedRequestId` and call `respond('deny', 'Request timeout')`. It does not depend on the clock being held, so an expired remount still denies once.
- `QuestionCardComponent`: the same pattern. `timeRemaining = computed(…)` keeps the `-1` sentinel for no timeout. Active means `timeoutAt > 0 && !expired()`. Any existing expiry callback moves to its own effect, guarded once per request id.
- Failure behaviour: deadlines stay host-owned, so a remount shows the correct remaining time.
- Verification seam (real `WallClockService`, fake timers):
  - Permission spec:
    - Deny fires once at expiry.
    - Deny fires once on a mount that is already expired.
    - Deny never fires when `timeoutAt === 0`.
    - **After expiry `jest.getTimerCount() === 0`**, and the release function returned by a spied `WallClockService.acquire` has been called.
    - No acquire happens for `timeoutAt === 0`.
  - Question spec: the remaining time is correct on remount, there is no tick after expiry (`getTimerCount() === 0`), and the release has been called.

### 7. chat-ui metric views (M1, M13 view)

- `TokenBadgeComponent.totalCount` uses `messageTokenTotal(tokens)` for the `MessageTokenUsage` branch.
  - When the result is `null`, the badge text is `—` and the tooltip is `Token usage unavailable`.
  - Number and legacy inputs are unchanged.
- `CompactRailCardComponent.roundedContextPercent` becomes `number | null`. The badge shows any non-null value, including a known `0%`. `null` hides it.
- The rev-1 `turnsPartial` input is **dropped** (R8). `InspectorSessionStatsComponent` is untouched apart from its spec (B5a).
- Verification seam:
  - `token-badge.component.spec.ts`: four-class total, and `NaN` gives `—`.
  - `compact-rail-card.component.spec.ts`: a known `0%` is shown, and `null` is hidden.

### 8. chat transcript and lane clocks (T13, T20, T21, M13)

- `ChatTranscriptComponent`: `injectWallClock('second', running)` replaces `TranscriptLiveClock` (`:835`). Delete the clock file.
- `LaneTranscriptComponent`: `now = injectWallClock('second', () => this.liveTurns().size > 0)` replaces `monitor.tick()` (`:96-99`). Assumption: check the `liveTurns` name. If no such predicate exists, use `this.isStreaming()`.
- `SubagentLaneComponent`: `now = injectWallClock('second', () => this.live())` replaces `monitor.tick()` + `Date.now()` (`:288-300,320-326`).
- `CompactSessionCardComponent`:
  - T13: `now = injectWallClock('second', () => this.streaming() || this.laneSummary().counts.running > 0)`.
  - C2/M13: `contextPercent = computed(() => sessionContextCue(this.tab().liveModelStats ?? null).percent)` replaces `:261-265`.
- Verification seam:
  - Compact card spec: elapsed survives a remount, and no interval runs when idle.
  - Compact card spec, **F6**: a resumed tab with `contextKnown: true, contextWindow: 0` gives `contextPercent() === null`.
  - Compact card spec, **F2**: a trusted 200,000 window gives `65`.

### 9. Lane usage resolver (M2, M3, M4)

- In `lane-stats.adapters.ts`:
  - Add `CliLaneUsage { usage; structured; partial; tokens: number | null; tokensExact }`.
  - Add `resolveCliLaneUsage(source)`: structured `usageTotals` first, else `usageTotalsFromSegments(segments)` marked `partial`. Tokens come from `cliUsageTokenTotal`.
  - `cliLaneStats` is rebuilt on it and keeps `AgentLaneStatsView` (`:78-108`).
- `subagentLaneStats` keeps its `usage.cacheWrite` naming.
- `CliLaneUsageSummaryComponent` uses `lane = computed(() => resolveCliLaneUsage(this.agent()))`.
- `extractCliAgentStats` remains the fold inside `usageTotalsFromSegments`, and components stop calling it.
- **Binding rule (decision #6)**: a segment fold is never shown as a total. It is always `partial`, rendered with `≥` and a "may be partial" title. Host `usageTotals` wins whenever present.
- Verified contracts: `lane-stats.adapters.ts:1-108`; `stats-bar.utils.ts:41-67`; `cli-lane-usage-summary.component.ts:67-99`.
- Failure behaviour: no usage gives `tokens: null`, rendered `—`.
- Verification seam: adapters spec. Structured, then segments (partial), then none, plus exact versus inexact.

### 10. Lane usage consumers (M2 header, M4 inspector, T21 agent card)

- `AgentCardComponent`:
  - `laneUsage = computed(() => resolveCliLaneUsage(this.agent()))`, passed to `ptah-cli-agent-output` as `[usage]`.
  - T21: `now = injectWallClock('second', () => this.agent().status === 'running')`, which replaces `store.tick()` (`:284-305`).
- `CliAgentOutputComponent`:
  - `usage = input<CliLaneUsage | null>(null)`.
  - The header shows `≥` and the partial title when `partial`, and "Reported total" only when `tokensExact`.
  - The direct `extractCliAgentStats` call (`:186`) is dropped.
  - The canvas `presentation="flat"` host never shows the header (`cli-agent-output.component.ts:42`).
- `inspector-agent-usage.ts`: `resolveCliLaneUsage(agent)` replaces the local fallback (`:44-58`) for CLI rows.
- Verification seam: a cli-agent-output partial cue, and the new `inspector-agent-usage.spec.ts` agreement test (inspector = summary = header for one fixture).

### 11. Turn metrics (M5)

- `TurnTokenTotal` gains `cacheRead` and `cacheCreation` (`turn-facts.utils.ts:87-92,256-288`).
- `tokensText` and `messageTokensItem` add `· Z cache` when the cache total is greater than 0 (`turn-activity-panel.component.ts:33-35,61-67`).
- The coverage label `N of M messages` is unchanged. It is a per-turn subtotal over known messages, labelled as such, not a session total.
- Verification seam: new `turn-facts.utils.spec.ts`.

### 12. Session inspector (T14, M6, M7, M8, M13, cross-workspace) — revised

- `InspectorAgentsSectionComponent` (T14): `injectWallClock('second', () => this.hasRunning())` replaces `:318-323`.
- `SessionInspectorComponent.sessionTokens` (M6): `{ input: tokens.input, output: tokens.output }`. "In" means uncached input (D7).
- `SessionInspectorStore`:
  - M7: `tokens = sessionTokenTotal(stats)`, with no recompute (`:113-120`).
  - C2/M13: `contextPercent` and `contextWindow` come from `sessionContextCue(live)`. The window is set only when `known`.
  - **M8 (R10)**: `turns = resolveTurns(tab)`:
    1. `stats.turnCount` when it is a finite non-negative integer. This is the host lifetime count.
    2. Otherwise, when `tab.olderHistoryCursor` is null, the loaded-window `countTurns(messages)`. History is fully loaded, so it is complete.
    3. Otherwise `null`, and the label is hidden (`inspector-session-stats.component.ts:255`).
    - `0` from the host renders `0 turns`. The host knows it; it is not unknown.
  - Cross-workspace: the `tab` computed reads `this.tabManager.backgroundTabsRevision()` before `findTabByIdAcrossWorkspaces` (`:198-201`).
  - `session-inspector.types.ts` and the template are unchanged.
- Verification seam:
  - `inspector-agents-section.component.spec.ts`: no interval when idle.
  - `session-inspector.component.spec.ts`: "In" equals `tokens.input`.
  - New `session-inspector.store.spec.ts`:
    - `tokenCount` absent gives `tokens: null`.
    - F2 and F6.
    - The turns precedence: host 7 with a cursor gives 7; no host value and no cursor gives the loaded count; no host value with a cursor gives `null`; host 0 gives 0.
    - A background-tab update re-evaluates the model.
    - Removing that workspace gives `null` stats.

### 13. Settings and notices (T1 UI, T2, T7, T8, T22, T23)

- `SystemPromptDrawerComponent` (T1):
  - Remove `regenerateStartedAt`, `regenerateBaseline`, `ranOutClientBudget` and the 2× timeout branch.
  - `regenerationStartedAt = computed(() => parseIso(status()?.regenerationStartedAt))`. `Date.parse`, with `NaN` read as `null`. It gates Regenerate and the "may still be running" notice (`:119-136,259`).
  - After the regenerate RPC returns or errors, call `loadStatus()`:
    - The flag still set shows the block with an elapsed label from `injectWallClock('second', () => this.regenerationStartedAt() !== null)`.
    - Cleared with a new `generatedAt` means changed.
    - Cleared without a new `generatedAt` means a definitive failure toast.
  - **Reconciliation while open**: an effect on `injectWallClock('coarse', () => this.regenerationStartedAt() !== null)` calls `loadStatus()` once per coarse tick. The host clears the flag at lock release or at the ceiling (Component 3), so the block resolves without user action. This is one RPC per 30 s, only while the drawer is open and the host reports a run.
  - "Check again" calls `loadStatus()`. The status loads on open, so a remount or reload restores the block.
  - Older host (field absent): the field reads `undefined`, so `regenerationStartedAt()` is `null`. The drawer then behaves like a host with no run in flight. Regenerate is enabled, and the host's own lock rejects a duplicate with its existing error.
- `ProviderSetupWizardComponent` (T2): `_probeStartedAt` replaces `_elapsedSeconds` and `probeTimer`. It is cleared wherever `_elapsedSeconds.set(0)` is today (`:2116,2172,2408,2438`). `now = injectWallClock('second', () => this.probeChecking())`. `ngOnDestroy` cancels the in-flight probe through `cancelDraftVerification()` (D5).
- `AmbientAccountRowComponent` (T22): `injectWallClock('coarse')`.
- `OverviewTabComponent` (T23): `injectWallClock('coarse', () => this.shownCheck() !== null)`.
- `ResumeNotificationBannerComponent` (T7) and `ElectronWelcomeComponent` (T8): the coarse clock. Welcome's grid day uses `localDayKey(new Date(coarse()))`.
- Verification seam:
  - Drawer spec:
    - The host flag blocks Regenerate on a fresh mount.
    - The coarse tick re-reads status, and a cleared flag with a new `generatedAt` emits `changed`.
    - A cleared flag without one shows the failure toast.
    - An absent field leaves Regenerate enabled.
  - Wizard spec: elapsed is derived from the start, destroy cancels the probe, and invalidation clears the start.
  - Row, tab and welcome specs: the label advances after 30 s.

### 14. Command Center (M9, clock)

- `CommandCenterPageComponent`: a private `tabById(id)` reads `this.page.tabs.backgroundTabsRevision()`, then calls `findTabByIdAcrossWorkspaces(id)?.tab ?? null`. `currentStats`, `rootStats`, `childStats` and `contextCue` use it (`:97-144`). Assumption: check the `tabs` field type in `command-center-page.controller.ts`.
- `CommandCenterPageController`: `injectWallClock('coarse')` replaces `commandCenterClock()` (`:32,69`). Delete the clock file and its spec.
- Verification seam: page spec. A background-only tab yields `currentStats`, an update re-renders it, and `contextCue().percent === 65` for the F2 fixture.

### 15. Subagent tool count (M12) + inline agent duration (T6) — revised for Serious 4

- New `libs/frontend/chat/src/lib/utils/subagent-tool-count.ts`: `subagentToolCount(record: { toolUses?: number } | null | undefined, displayed: readonly ExecutionNode[]): number` returns `Math.max(finiteOrZero(record?.toolUses), countToolNodes(displayed))`.
  - **Not monotonic** (D12). It is the larger of the two current sources. It never shows less than the host's last report, and it shows displayed tools before the host catches up.
  - The tile and the bubble label it as the current known count: `title="Current known count"` on the count element. The visible text `N tools` is unchanged.
- `SubagentTileComponent.toolCount` (`:236-247`) and the tool part of `InlineAgentBubbleComponent.childStats` (`:909-925`) use it.
- T6: `InlineAgentBubbleComponent.agentDuration` reads `now()` from `injectWallClock('second', () => running)` (`:964`). Remove the "Known limitation" comment.
- Verification seam:
  - Util spec:
    - Max rule.
    - **Lag plus trim**: host 2 / displayed 3 gives 3. Then trimmed to 1 with host still 2 gives 2, which documents the fall and the host floor. Then host 3 gives 3.
    - A non-finite host value is treated as 0.
  - Tile spec: the title attribute is present.
  - Bubble spec: duration advances while running.

### 16. Remaining feature-lib clock consumers (T9–T12, T15, T19, canvas day)

- `canvas-lane-tabs.component.ts` (T15): `injectWallClock('second', ticking)` replaces `:385-393`.
- `canvas-empty-board.component.ts`: the grid day uses `localDayKey(new Date(coarse()))` (`:303-307`). The load-wait `setTimeout` is unchanged (D6).
- `history-timeline.component.ts` (T9): `rows` uses `coarse()` (`:428-431`).
- `stash-popover.component.ts` (T10): `:223` passes `this.now()`.
- `workspace-indexing.component.ts` (T11): `formatRelativeTime` uses `this.now()` (coarse).
- `memory-diagnostics-accordion.component.ts` (T12): `injectWallClock('coarse')` replaces the `recentEvents`-keyed computed (`:255-258`).
- `generation-workflow-shell.component.ts` (T19): `injectWallClock('second', () => this.handoff.pending() !== null)` replaces the 250 ms interval (`:450-455`). 1 s is enough for `Math.ceil(…/1000)` (`generation-agent-sidebar.component.ts:211-213`).
- Verification seam: each spec advances fake time, asserts the label changes, and asserts `getTimerCount() === 0` when inactive.

### 17. Retire `AgentMonitorStore.tick` (chat-streaming)

- Remove `tick`, `_tickInterval`, `startTick`, `stopTick`, `syncTick` and their calls (`:1038-1043,1283,1296-1324,1550,1753,2137,2239,2259`).
- Leftover `tick: signal(0)` mock entries are harmless.
- Precondition: `grep -rn "\.tick()" libs/frontend --include=*.ts | grep -v spec` hits only vitals stores and `ApplicationRef.tick`.

### 18. Host lifetime `turnCount` (shared, agent-sdk, chat-state) — new (R10)

- Purpose: one host-owned turn count for every stats surface, rebuilt from the transcript like every other `SessionStatsEntry` figure (decision #6).
- Contract (`rpc-session.types.ts`, after `messageCount`):

  ```ts
  /**
   * User turns in the counted scope: a run of consecutive user prompts with no
   * main assistant record between them is one turn. Tool results, meta and
   * compact-summary records are not prompts. Absent when the producer cannot
   * count every turn (older hosts; a live run without per-model attribution).
   */
  readonly turnCount?: number;
  ```

- Producer, ledger path (`session-usage-ledger.ts`):
  - `UsageRecord` gains `readonly prompt: boolean`.
  - `ProjectedLineSchema` gains optional `isMeta`, `isSidechain`, `isCompactSummary` and `message.content` (a string, or an array of `{ type }`). Each field uses `absentWhenMalformed`.
  - A prompt record is a `type: 'user'` (or `message.role: 'user'`) line where:
    - none of `isMeta`, `isSidechain` or `isCompactSummary` is true, and
    - the content is a non-empty string, or an array with at least one `text` or `image` block and no `tool_result` block.
  - A prompt record is pushed with zero usage and `assistant: false`. It never merges by `message.id`.
  - The substring gate (`:106`) admits a line containing `"user"` unless it also contains `"tool_result"`.
    - A prompt's own text cannot produce that unescaped token, because JSON escapes inner quotes.
    - Large tool-result lines therefore stay unparsed, and `session-stats-reader.perf.spec.ts` must still pass.
  - `build()` carries `prompt`.
- Producer, aggregation (`session-usage-aggregator.ts`):
  - In `aggregateLedgers.count`, parent records only, after the scope/range filter: a prompt record when the previous counted parent record was not a prompt increments `turnCount`. An assistant record ends the run.
  - `aggregateContributions` sums `part.turnCount`. If **any** contribution lacks `turnCount`, the result omits it (no partial sum, decision #6).
  - `finishEntry` takes and emits `turnCount`.
  - `emptySessionStats` gives `turnCount: 0`. `failedSessionStats` omits it.
- Producer, live owner (`session-stats-owner.service.ts`):
  - `RunState.turns: number`, starting at 0.
  - `replaceRun` increments it only on outcome `'accepted'`, next to the duration (`:600-611`). Duplicate, rejected and ignored results do not count.
  - `runContribution(sessionId, result, turnCount: number | undefined)` (`:1091-1094`) gains an explicit third parameter and emits it only when it is a number. `build()` (`:876-891`) calls it twice per run, so the value is set per call site (D23):
    - Authoritative contribution (`run.current`, `:879-886`): `run.incomplete ? undefined : run.turns`.
    - Provisional estimate contribution (`run.provisional`, `:887-891`): `run.incomplete ? undefined : 0`. The in-flight turn is not completed, and the authoritative contribution already holds every accepted turn, so the estimate adds none. Passing `run.turns` here would double completed turns; omitting it would hide the label mid-turn.
  - A run with `incomplete === true` (`markRunIncomplete`, `:628-641`) emits no `turnCount` on either contribution, so the snapshot omits it (rule above).
  - The prefix contribution carries the ledger's `turnCount`. `failedSessionStats` for an unreadable prefix omits it, so the snapshot omits it.
- Resume path (`session-history-reader.service.ts` `ledgerFromMessages`, `:1323-1342`): pass `isMeta`, `isSidechain`, `isCompactSummary` and `message.content` through to `visitRecord`.
  - Verified: `isCompactSummary` is **not** on `JsonlMessageLine` (`history.types.ts:16-52`), `SessionHistoryMessage` (`:77-116`) or the converter (`jsonl-reader.service.ts:925-959`), and no file under `libs` names it. Component 22 (batch TC0) adds the projection before TC1. `isMeta` is not relied on (D24).
  - Classification parity: the raw ledger (`ProjectedLineSchema`) and the resume projection read the same four raw fields with the same truth test (`=== true` for the three flags), so one fixture classifies identically on both paths.
- Boundary validation (`chat-state/session-stats-snapshot.ts:47-56`): add `isOptional(value['turnCount'], isRevision)` (a non-negative integer).
- Consumers:
  - `SessionInspectorStore.resolveTurns` (Component 12) is the only display.
  - Every other `SessionStatsEntry` reader ignores an optional field: Command Center (`command-center-page.component.ts:123`), session list, CLI, TUI, VS Code.
  - All hosts compile unchanged because the field is optional.
- Live versus transcript semantics (D17):
  - Live counts completed turns (accepted results). The transcript counts prompts.
  - While a turn is in flight a transcript re-read can be one higher. The revision floor (`session-stats-snapshot.ts:58-80`) stops an unrevisioned history snapshot from replacing a live one, so the UI does not flicker.
  - Assumption: the SDK emits exactly one result per user prompt. Check: in `stream-transformer.spec.ts` / owner spec fixtures, confirm that no result arrives without a preceding user message. If one can (an auto-continuation), increment `turns` only for the first accepted result after a user-message event.
- Failure behaviour: a malformed field reads as absent, and the line still counts. An unknown turn count is omitted, never 0.
- Verification seam:
  - `session-usage-aggregator.spec.ts` (builder plus aggregate):
    - Two prompts, then assistant, then prompt, then assistant gives `turnCount` 2.
    - A tool-result-only user line is not a prompt.
    - `isMeta` and `isCompactSummary` lines are not prompts.
    - `current-context` counts after the last boundary.
    - A `range` scope filters by timestamp.
    - Contributions 3 + 2 give 5. Contributions 3 + absent give absent.
  - `session-history-reader.service.spec.ts`:
    - A resume snapshot carries `turnCount`.
    - Parity fixture: prompt, assistant, a `type: 'user'` record with `isCompactSummary: true` and string content "This session is being continued from a previous conversation …", assistant, prompt, assistant. Resume gives `turnCount` **2**, and the same lines as raw JSONL through the ledger builder (the aggregator spec case below) also give **2**.
  - `session-usage-aggregator.spec.ts` also takes the raw-line form of the parity fixture (2).
  - `session-stats-owner.service.spec.ts`:
    - Prefix 4 plus two accepted results gives 6.
    - Prefix 4 plus two accepted results, then a live estimate for a third in-flight turn (`build(..., live: true)` with a non-empty `run.provisional`) still gives **6**, both in the provisional snapshot and in the published one.
    - A first turn in flight (no `run.current`, only a provisional estimate) gives the prefix value, 4.
    - An incomplete run with a live estimate omits the field.
    - A duplicate result does not count.
    - `markRunIncomplete` omits the field.
    - An unreadable prefix omits it.
  - `session-stats-snapshot.spec.ts`: `turnCount: 2` passes; `-1`, `1.5` and `'2'` reject.

### 19. Frontend context consumers of the shared helpers (C1, C3) — new (R11)

- `live-context-stats.ts`: `contextFillStats` uses `trustedContextWindow` and `contextFillPercent`.
  - The window stays `0` and `contextKnown: true` when the window is untrusted (existing payload shape). `sessionContextCue` gates display.
  - Export `contextFillStats` from `libs/frontend/chat-state/src/index.ts` for the loader.
- `session-stats-view.ts` `sessionContextCue`: the trust test is `trustedContextWindow(capacity, live.model) !== null && live.contextWindow === thatWindow`. The output is unchanged.
- `session-live-stats.util.ts` `deriveLiveModelStats`: uses the same two helpers (`:78-101`).
- `session-loader.service.ts` `applyResumeStats` (C1):
  - Capture `prior = tab.liveModelStats` before `applyLoadedSessionStats`, next to the `compactionContextSeed` capture.
  - Snapshot branch (`:1289-1303`): after deriving from `contextSnapshot`, if the result is not known by `sessionContextCue` and `sameModel(prior, snapshot.model)`, install `contextFillStats(prior, snapshot.contextTokens) ?? derived.live`.
  - No-snapshot branch (`:1273-1287`), revised for review Serious 1: if `prior` is non-null, `sameModel(prior, stats.model)` and `trustedContextWindow(prior.contextCapacity, prior.model) !== null`, install `contextFillStats(prior, prior.contextUsed)`. Otherwise install today's unknown placeholder unchanged (or `null` when `stats.model` is absent).
  - `sameModel(prior, model)` = `!!model && normalizeModelKey(prior.model) === normalizeModelKey(model)`, a private helper in the loader. It replaces rev 2's strict `===` so both branches match `liveContextStats` (`live-context-stats.ts:66`).
  - `contextFillStats` itself returns a window only when the prior capacity is trusted, and `null` for a non-positive fill (`live-context-stats.ts:21-29`), so a prior `contextUsed` of 0 falls back to the placeholder.
  - The compaction-seed branch is unchanged and runs first.
  - Known trade-off (D21): if the transcript was compacted by another client while this tab was closed, the prior reading predates that compaction and is re-installed until the next turn ends. A compaction in this tab always re-seeds or clears the prior reading (`tab-manager.service.ts:2578,2597-2600`), so the case needs an out-of-band compaction.
- Verification seam:
  - `live-context-stats.spec.ts`: F2, F6, F8.
  - `session-stats-view.spec.ts`: F2, F3, F6.
  - `session-stats-summary.component.spec.ts`: label `65%` and `—`.
  - `session-live-stats.util.spec.ts`: F2, F3, F4.
  - `session-loader.service.spec.ts`: F10, all three cases; F12, all four cases; a model key that differs only by normalisation (for example a dated id versus its alias, whichever pair `normalizeModelKey` folds in its own spec) still carries forward.
  - `session-stats-source.spec.ts` and `chat-vitals.store.spec.ts`: F2, F3, F5, F6.

### 20. Host context formula sites (C3) — new (R11)

- `stream-transformer.ts:910-913`: `lastTurnContextTokens: trackedContext ? contextFillTokens(trackedContext) : undefined`.
- `session-history-reader.service.ts:1294-1295`: `contextTokens: contextFillTokens(tokens)`.
- `session-history-reader.service.ts:1281-1286` (C4, review Serious 2): the first statement in the backwards loop is `if (msg.isSidechain === true) continue;`. A sidechain assistant frame is never the numerator, and a sidechain `compact_boundary` never ends the scan. The forward `system/init` scan (`:1275-1280`) is unchanged.
- The live capture logic, the live subagent guard, the proxy override and the compaction clear are unchanged. Tests pin them.
- Verification seam:
  - `stream-transformer.live-stats.spec.ts`: F1 (published `lastTurnContextTokens` 130,000), F3 (an SDK `contextWindow` of 1,000,000 gives `contextWindow` 1,000,000 and `contextCapacity.source` `'sdk-native'`), F7, F11, and a compact boundary between turns giving `lastTurnContextTokens: undefined` for an untracked model.
  - `session-history-reader.service.spec.ts`: F1 on resume, F9, F13 and F14.

### 21. Delete `SessionCostSummaryComponent` — new (R12, decisions #5)

- DELETE `libs/frontend/chat-ui/src/lib/molecules/session/session-cost-summary.component.ts` (no spec exists).
- Remove `export { SessionCostSummaryComponent } …` at `libs/frontend/chat-ui/src/index.ts:114`.
- Remove `SessionCostSummaryComponent,` from the deprecated re-export block at `libs/frontend/chat/src/lib/components/index.ts:102-105`, keeping `SessionStatsSummaryComponent`.
- `calculateSessionCostSummary` / `SessionCostSummary` in `libs/shared/src/lib/utils/subagent-cost.utils.ts` are a different symbol and are not part of the approval. They stay.
- Verification seam: `grep -rn "SessionCostSummaryComponent\|ptah-session-cost-summary" libs apps` returns nothing, and the chat-ui, chat and webview typecheck passes.

### 22. `isCompactSummary` history projection (agent-sdk) — new (R19)

- Purpose: carry the raw `isCompactSummary` flag from a JSONL line to `SessionHistoryMessage`, so the resume ledger (Component 18) can exclude compact-summary user records exactly as the raw ledger does.
- Responsibilities:
  - `JsonlMessageLine` (`history.types.ts:16-52`) gains `isCompactSummary?: unknown` with the doc comment "True on the SDK's post-compaction summary user record (unvalidated)", next to `isSidechain` (`:39-40`).
  - `SessionHistoryMessage` (`:77-116`) gains `readonly isCompactSummary?: boolean`, next to `isSidechain` (`:83-84`).
  - `convertToSessionHistoryMessage` (`jsonl-reader.service.ts:925-959`) adds `...(line.isCompactSummary === true && { isCompactSummary: true })`, the same literal-`true` pattern as `isSidechain` (`:939`).
- Verified contracts: both interfaces and the converter at the lines above. No current reader of the field exists (grep over `libs`), so the addition is purely additive and changes no existing classification.
- Dependencies: none new. `SessionHistoryMessage` extends shared `JSONLMessage` (`history.types.ts:9,77`); the shared type is not changed.
- Integration points: `ledgerFromMessages` (Component 18, TC1) reads `msg.isCompactSummary`. Replay and the frontend ignore it.
- Failure behaviour: any non-`true` value (absent, `false`, `"true"`, `1`) is dropped, so the record is classified by the other fields. This matches `absentWhenMalformed` on the raw ledger side.
- Quality requirements: no extra parse cost (one property read per line).
- Verification seam: `jsonl-reader.service.spec.ts`: a line with `isCompactSummary: true` yields `isCompactSummary: true`; lines with `false`, `"true"` or the field absent yield no `isCompactSummary` key; an `isSidechain` line is unchanged (regression).
- Files: MODIFY `W\libs\backend\agent-sdk\src\lib\helpers\history\history.types.ts`, `W\libs\backend\agent-sdk\src\lib\helpers\history\jsonl-reader.service.ts`, `W\libs\backend\agent-sdk\src\lib\helpers\history\jsonl-reader.service.spec.ts`.

### 23. Harness builder session summary (harness-builder) — new (R17)

- Purpose: make the collapsed builder sidebar summary follow the one display rule for context %.
- Responsibilities: `sessionSummary` (`builder-session-section.component.ts:57-60`) builds the context part as `` `Context ${sessionContextCue(this.liveModelStats()).label}` ``. The cost part is unchanged.
- Verified contracts: `sessionContextCue(live: LiveModelStats | null): SessionContextCue` (`session-stats-view.ts:42-60`), exported from `@ptah-extension/chat-ui` (`libs/frontend/chat-ui/src/index.ts:245`). The component already imports `LiveModelStats` and `SessionStatsSummaryComponent` from `@ptah-extension/chat-ui` (`builder-session-section.component.ts:8-11`), so no new dependency edge.
- Dependencies: harness-builder (`scope:webview, type:feature`, `libs/frontend/harness-builder/project.json:2,7`) → chat-ui, already present.
- Failure behaviour: an unknown, untrusted or mismatched window renders `Context —`, never `Context 0%`. A null `liveModelStats` renders `Context —` (today's behaviour, pinned by the existing spec at `builder-session-section.component.spec.ts:5-15`).
- Quality requirements: none beyond the strict rule.
- Verification seam: `builder-session-section.component.spec.ts`:
  - existing case unchanged (`Context — · Cost unavailable`);
  - F2: `liveModelStats` with `contextUsed` 130,000, `contextWindow` 200,000, `contextPercent` 65 and an sdk-native capacity of 200,000 for the same model → `Context 65%`;
  - F6, two inputs, each → `Context —`, not `Context 0%`: the resume placeholder (`contextKnown: false`, `contextUsed` 0, `contextWindow` 0, `contextPercent` 0, `tab-manager.service.ts:2760-2767`), and the resume-derived frame (`contextKnown: true`, `contextUsed` 130,000, `contextWindow` 0, `contextPercent` 0, capacity source `unknown`).
- Files: MODIFY `W\libs\frontend\harness-builder\src\lib\components\sidebar\builder-session-section.component.ts`, `W\libs\frontend\harness-builder\src\lib\components\sidebar\builder-session-section.component.spec.ts`.

## Integration architecture

- Data flow:
  - Host transcript and SDK stream → host aggregators (`SessionStatsEntry`: tokens, cost, cache, `turnCount`, `contextSnapshot`) and RPC state (T1).
  - → RPC and broadcasts → boundary validator (`isValidSessionStatsSnapshot`) → root stores (`TabManagerService`, `AgentMonitorStore`, `SubagentExecutionStore`, `SetupWizardStateService`, `ElectronLayoutService`).
  - → pure helpers (shared token and context helpers, `sessionContextCue`, `resolveCliLaneUsage`, `subagentToolCount`) → components that project with `injectWallClock(...)()`.
- State or persistence:
  - Totals, turns and the context frame: the host, rebuilt from the transcript after restart.
  - T1: the host process memory, reconciled with the lock.
  - Context reading: the tab state, persisted by the existing tab persistence. C1 only stops a resume from discarding it.
  - Starts and deadlines: the host, or root services.
  - Components hold UI state and clock acquisitions only.
- External boundaries:
  - Transcript lines go through zod with per-field degradation (`absentWhenMalformed`).
  - RPC replies are checked by `isValidSessionStatsSnapshot`, extended for `turnCount`.
  - The T1 ISO string is `Date.parse`d with `NaN` read as `null`.
- Failure and rollback:
  - Each batch reverts alone if its dependants have not landed.
  - Ordering hazards: B5b after B5a; B20 after B8a, B8b and B11; TC1 after TC0; CX2 after TC1; TC2 and TC3 after TC1; HB1 after CX3.
- Observability: no new logging. T1 rejection and reconciliation use the existing handler `logger.info`. The reconciliation logs once per dropped entry, with workspace path only, which is the existing practice at `:524-527`.

## Lifecycle-safety rule

Put this in the PR description. It is a candidate for `libs/frontend/CLAUDE.md`.

1. **A component never owns a start time, a deadline or an accumulated metric.** These live in the host payload or a `providedIn: 'root'` store, keyed by domain id. Components hold UI state and `computed` projections only.
2. **A component never creates `setInterval` for a rendered time.**
   - Use `injectWallClock('second' | 'coarse', active?)` and render `now() - start` or `deadline - now()`.
   - The `active` predicate must turn false once the value stops changing, for example at expiry.
   - A one-shot `setTimeout` is allowed only for a threshold computed from a durable start.
   - Cosmetic animation timers are exempt.
3. **A figure has one definition.**
   - Tokens: `messageTokenTotal`, `sessionTokenTotal`, `cliUsageTokenTotal`.
   - Context: `contextFillTokens`, `trustedContextWindow`, `contextFillPercent` (shared) and `sessionContextCue` (chat-ui).
   - Lane usage: `resolveCliLaneUsage`.
   - Subagent tools: `subagentToolCount`.
   - Turns: host `turnCount`.
   - Missing data renders `—` or `≥`, never 0. The frontend never sums partial data into a total.
4. **A reactive lookup that may target a background workspace** reads `backgroundTabsRevision()` first.
5. **Review check**: `grep -rn "setInterval\|Date.now()" <changed component files>`. Every hit is justified by rule 2.

A lint rule is out of scope (D13).

## Architecture-level quality requirements

- Functional:
  - Every T1–T24 surface shows the same value before and after an unmount/remount at the same wall time, **except T2 (D5: destroy cancels the probe) and T5 (D6: the load restarts with the component)** (R9).
  - T1's block survives a drawer close and a renderer reload while the host runs. It clears within one coarse tick of lock release, and never later than `ENHANCED_PROMPTS_RUN_CEILING_MS`.
  - M1, M5, M7: totals equal the host four-class definition.
  - M2, M3, M4: the three lane surfaces agree.
  - M8: turns equal host `turnCount` when present.
  - M9: the Command Center works for background tabs.
  - M13, C1, C2: a known `0%` is distinct from unknown. A known context % survives resume and reload for the same model, including after a compaction (F12). A sidechain record never sets or clears the history frame (F13, F14). Every view in the reader inventory uses the strict rule. F1–F14 hold.
- Performance:
  - At most two app-wide clock intervals, none while idle or hidden.
  - No per-card interval.
  - Ledger parsing cost unchanged for tool-result lines (`session-stats-reader.perf.spec.ts` passes).
  - The drawer polls only while open and while a host run is reported.
- Security: T1 error copy is fixed text. No secrets. The T2 draft is never persisted.
- Maintainability:
  - No new Nx project and no new dependency edge (chat-state already imports shared; agent-generation is already imported by rpc-handlers at `enhanced-prompts-rpc.handlers.ts:18-26`).
  - Public `index.ts` imports only.
- Testability: each batch names its spec. Clock consumers use the real `WallClockService` with fake timers. Formula tests use the F-table numbers.

## Batches

Rules for every batch (repeat these in every implementer prompt and every CLI lane prompt):

- Work only in `W`. Never edit the main checkout.
- Check with `npm run verify -- -p <projects>` as listed: one foreground run, long timeout, output filtered with `| tail -n 60`. Confirm the header says "Running target … for N projects", with N equal to the projects listed.
- **Never run workspace-wide checks. Never `nx run-many` over projects you did not change. Never run build, serve, dev, e2e or package targets.**
- **Electron first.** "UI: yes" means before/after Electron screenshots of the named surface.
- **Keep every host compiling.** A batch that changes `@ptah-extension/shared`, a backend lib, or a public export also runs `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-extension-webview,ptah-cli,ptah-tui` ("host typecheck" below).
- No file overlap between batches that can run in parallel. A file may appear in two batches only when one depends on the other, directly or transitively (today: `libs/shared/src/lib/utils/index.ts` in B2 → CX1; `session-history-reader.service.ts` and its spec in TC1 → CX2). Those pairs run serially. At most 6 files and 2 libs per batch.
- Lanes do not run git. The coordinating agent commits.

### B1 — Core wall clock [core] (deps: none)

- Files: CREATE `W\libs\frontend\core\src\lib\services\wall-clock.service.ts`, `W\libs\frontend\core\src\lib\services\wall-clock.service.spec.ts`; MODIFY `W\libs\frontend\core\src\lib\services\index.ts`.
- Change: Component 1.
- Acceptance: exported from `@ptah-extension/core`; one interval per cadence; hidden pause and visible refresh; idempotent release; the `active` gate works.
- Tests: `wall-clock.service.spec.ts`.
- Verify: `npm run verify -- -p @ptah-extension/core`
- UI: no.

### B2 — Shared token helpers [shared] (deps: none)

- Files: CREATE `W\libs\shared\src\lib\utils\token-usage.utils.ts`, `…\token-usage.utils.spec.ts`; MODIFY `W\libs\shared\src\lib\utils\index.ts`, `…\cli-usage.utils.ts`, `…\cli-usage.utils.spec.ts`.
- Change: Component 2.
- Acceptance: exported from `@ptah-extension/shared`. `messageTokenTotal` returns `number | null`. Unknown gives `null` and a known 0 gives 0.
- Tests: `token-usage.utils.spec.ts`, `cli-usage.utils.spec.ts`.
- Verify: `npm run verify -- -p @ptah-extension/shared`, then host typecheck.
- UI: no.

### CX1 — Shared context fill helpers [shared] (deps: B2, for `utils/index.ts`)

- Files: CREATE `W\libs\shared\src\lib\utils\context-fill.utils.ts`, `…\context-fill.utils.spec.ts`; MODIFY `W\libs\shared\src\lib\utils\index.ts`.
- Change: Component 2b.
- Acceptance: F1–F6 pass. Output tokens cannot enter `contextFillTokens`.
- Tests: `context-fill.utils.spec.ts`.
- Verify: `npm run verify -- -p @ptah-extension/shared`, then host typecheck.
- UI: no.

### B3a — Generation ceiling export [agent-generation] (deps: none)

- Files: MODIFY `W\libs\backend\agent-generation\src\lib\services\enhanced-prompts\enhanced-prompts.service.ts`, `W\libs\backend\agent-generation\src\lib\services\enhanced-prompts\index.ts`, `W\libs\backend\agent-generation\src\index.ts`.
- Change: Component 3, agent-generation part.
- Acceptance: `ENHANCED_PROMPTS_RUN_CEILING_MS` is importable from `@ptah-extension/agent-generation` and equals `GENERATION_LOCK_TIMEOUT_MS + GENERATION_LOCK_GRACE_MS`. Lock behaviour is unchanged.
- Tests: the existing `enhanced-prompts` service specs pass unchanged.
- Verify: `npm run verify -- -p @ptah-extension/agent-generation`
- UI: no.

### B3b — Host regeneration flag [shared, rpc-handlers] (deps: B3a)

- Files: MODIFY `W\libs\shared\src\lib\types\rpc\rpc-setup.types.ts`, `W\libs\backend\rpc-handlers\src\lib\handlers\enhanced-prompts-rpc.handlers.ts`, `W\libs\backend\rpc-handlers\src\lib\handlers\enhanced-prompts-rpc.handlers.spec.ts`.
- Change: Component 3, handler and contract.
- Acceptance: verification cases 1–7 of Component 3 pass, including the never-settling run past the ceiling.
- Tests: `enhanced-prompts-rpc.handlers.spec.ts`.
- Verify: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/rpc-handlers`, then host typecheck.
- UI: no.

### B4 — Reactive cross-workspace lookup [chat-state] (deps: none)

- Files: MODIFY `W\libs\frontend\chat-state\src\lib\tab-workspace-partition.service.ts`, `…\tab-workspace-partition.service.spec.ts`, `…\tab-manager.service.ts`, `…\tab-manager.service.spec.ts`.
- Change: Component 4.
- Acceptance: the four writers bump the revision once each, including `removeWorkspaceState`. The active-only sync does not. A tracked lookup re-runs after a background update and resolves to `null` after workspace removal.
- Tests: both specs.
- Verify: `npm run verify -- -p @ptah-extension/chat-state`
- UI: no.

### TC0 — `isCompactSummary` history projection [agent-sdk] (deps: none)

- Files: MODIFY `W\libs\backend\agent-sdk\src\lib\helpers\history\history.types.ts`, `W\libs\backend\agent-sdk\src\lib\helpers\history\jsonl-reader.service.ts`, `W\libs\backend\agent-sdk\src\lib\helpers\history\jsonl-reader.service.spec.ts`.
- Change: Component 22.
- Acceptance: a JSONL line with `isCompactSummary: true` converts to a `SessionHistoryMessage` with `isCompactSummary: true`. Any other value converts with no `isCompactSummary` key. Every other converted field is unchanged (existing `jsonl-reader.service.spec.ts`, `jsonl-reader.streaming.spec.ts` and `jsonl-reader.account-context.spec.ts` pass).
- Tests: `jsonl-reader.service.spec.ts` (new cases), `jsonl-reader.streaming.spec.ts` and `jsonl-reader.account-context.spec.ts` (unchanged, must pass).
- Verify: `npm run verify -- -p @ptah-extension/agent-sdk`, then host typecheck.
- UI: no.

### TC1 — Turn count contract, ledger and aggregator [shared, agent-sdk] (deps: TC0)

- Files: MODIFY `W\libs\shared\src\lib\types\rpc\rpc-session.types.ts`, `W\libs\backend\agent-sdk\src\lib\session-stats\session-usage-ledger.ts`, `W\libs\backend\agent-sdk\src\lib\session-stats\session-usage-aggregator.ts`, `W\libs\backend\agent-sdk\src\lib\session-stats\session-usage-aggregator.spec.ts`, `W\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts`, `W\libs\backend\agent-sdk\src\lib\session-history-reader.service.spec.ts`.
- Change: Component 18, contract, ledger, aggregation and resume pass-through (`ledgerFromMessages` forwards `isMeta`, `isSidechain`, `isCompactSummary` from TC0, and `message.content`).
- Acceptance: every ledger-path `SessionStatsEntry` (sessions list, resume prefix) carries `turnCount`. Contributions with any missing value omit it. The parity fixture gives `turnCount` 2 on both the raw-ledger path and the resume path; a compact-summary user record is never a prompt on either. The perf spec passes.
- Tests: `session-usage-aggregator.spec.ts`, `session-history-reader.service.spec.ts`, and the existing `session-stats-reader.perf.spec.ts` (unchanged, must pass).
- Verify: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/agent-sdk`, then host typecheck.
- UI: no.

### TC2 — Live owner turn count [agent-sdk] (deps: TC1)

- Files: MODIFY `W\libs\backend\agent-sdk\src\lib\session-stats\session-stats-owner.service.ts`, `…\session-stats-owner.service.spec.ts`.
- Change: Component 18, live owner.
- Acceptance: prefix plus accepted results. Duplicates do not count. The provisional estimate contribution carries `turnCount: 0`, so prefix 4 + two accepted results + a live estimate gives 6 (not 8, not absent). Incomplete runs and unreadable prefixes omit the field.
- Tests: `session-stats-owner.service.spec.ts`.
- Verify: `npm run verify -- -p @ptah-extension/agent-sdk`, then host typecheck.
- UI: no.

### TC3 — Snapshot validator [chat-state] (deps: TC1)

- Files: MODIFY `W\libs\frontend\chat-state\src\lib\session-stats-snapshot.ts`, `…\session-stats-snapshot.spec.ts`.
- Change: Component 18, boundary validation.
- Acceptance: a valid `turnCount` passes. A negative, fractional or string value rejects the snapshot.
- Tests: `session-stats-snapshot.spec.ts`.
- Verify: `npm run verify -- -p @ptah-extension/chat-state`
- UI: no.

### CX2 — Host context formula sites [agent-sdk] (deps: CX1, TC1)

- Files: MODIFY `W\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts`, `W\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.live-stats.spec.ts`, `W\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts`, `W\libs\backend\agent-sdk\src\lib\session-history-reader.service.spec.ts`.
- Change: Component 20.
- Change: also C4, the `isSidechain` skip in `extractContextSnapshot` (Component 20).
- Acceptance: both sites call `contextFillTokens`. `extractContextSnapshot` skips sidechain records. F1, F3, F7, F9, F11, F13 and F14 pass. Published payloads are byte-identical for the existing fixtures, which contain no sidechain record after the last main frame (if one does, its new expected value follows F13/F14 and the change is called out in the batch report).
- Tests: `stream-transformer.live-stats.spec.ts`, `session-history-reader.service.spec.ts`.
- Verify: `npm run verify -- -p @ptah-extension/agent-sdk`, then host typecheck.
- UI: no.

### CX3 — Context helpers in chat-state and chat-ui [chat-state, chat-ui] (deps: CX1)

- Files: MODIFY `W\libs\frontend\chat-state\src\lib\live-context-stats.ts`, `W\libs\frontend\chat-state\src\lib\live-context-stats.spec.ts`, `W\libs\frontend\chat-state\src\index.ts`, `W\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-view.ts`, `W\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-view.spec.ts`, `W\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.spec.ts`.
- Change: Component 19, chat-state and chat-ui part.
- Acceptance: no local copy of the trust predicate or the percent formula remains in these files. `contextFillStats` is exported. F2, F3, F6 and F8 pass.
- Tests: the three specs listed.
- Verify: `npm run verify -- -p @ptah-extension/chat-state,@ptah-extension/chat-ui`
- UI: no (identical output).

### CX4 — Live derivation and resume carry-forward [chat] (deps: CX1, CX3)

- Files: MODIFY `W\libs\frontend\chat\src\lib\services\chat-store\session-live-stats.util.ts`, `…\session-live-stats.util.spec.ts`, `…\session-loader.service.ts`, `…\session-loader.service.spec.ts`.
- Change: Component 19, C1 and the chat part of C3.
- Acceptance: F2–F4 in derivation. F10 in all three cases. F12 in all four cases (the no-snapshot branch carries a trusted same-model reading forward: prior 30,000 / 200,000 with a compact boundary as the latest record resumes at **15%**). Model equality uses `normalizeModelKey` on both branches. The compaction-seed branch is unchanged (existing `session-loader.resync-live-seed.spec.ts` passes).
- Tests: `session-live-stats.util.spec.ts`, `session-loader.service.spec.ts`, `session-loader.resync-live-seed.spec.ts` (unchanged).
- Verify: `npm run verify -- -p @ptah-extension/chat`
- **UI: yes**. Electron: a session at a known context %, then a renderer reload (Ctrl+R) and a session re-open. The badge keeps its percent instead of `—`. Repeat after a `/compact` in the same tab: the post-compaction percent survives the reload.

### CX5 — Context view pin tests [chat] (deps: CX3)

- Files: MODIFY `W\libs\frontend\chat\src\lib\services\session-stats\session-stats-source.spec.ts`, `W\libs\frontend\chat\src\lib\services\vitals\chat-vitals.store.spec.ts`.
- Change: test-only. It pins the inspector tile and the empty-state ring.
- Acceptance: F2, F3, F5 and F6 pass through `SessionStatsSource.inputs().context` and `ChatVitalsStore.context()`.
- Tests: the two specs.
- Verify: `npm run verify -- -t test -p @ptah-extension/chat`
- UI: no.

### HB1 — Harness builder context summary [harness-builder] (deps: CX3)

- Files: MODIFY `W\libs\frontend\harness-builder\src\lib\components\sidebar\builder-session-section.component.ts`, `W\libs\frontend\harness-builder\src\lib\components\sidebar\builder-session-section.component.spec.ts`.
- Change: Component 23 (C2 for the builder sidebar).
- Acceptance: the collapsed summary's context part is `sessionContextCue(liveModelStats()).label`. F2 renders `Context 65%`. Both F6 inputs render `Context —`; no input with an untrusted or missing window renders `Context 0%`. The existing `Context — · Cost unavailable` case passes unchanged. No new import edge (chat-ui is already imported).
- Tests: `builder-session-section.component.spec.ts`.
- Verify: `npm run verify -- -p @ptah-extension/harness-builder`
- **UI: yes**. Electron: harness builder sidebar, Session section collapsed, on a resumed session whose window is unknown: before `Context 0%`, after `Context —`; on a live session with a known window the percent is unchanged.

### B5a — chat-ui clock consumers [chat-ui] (deps: B1)

- Files: MODIFY `W\libs\frontend\chat-ui\src\lib\molecules\session\inspector-stats\inspector-cache-tile.component.ts`, `…\inspector-cache-tile.component.spec.ts`, `…\inspector-session-stats.component.spec.ts`, `W\libs\frontend\chat-ui\src\lib\molecules\boot-progress\boot-progress.component.ts`, `…\boot-progress.component.spec.ts`.
- Change: Component 6 (cache tile, boot, R1 spec migration).
- Acceptance: `grep -rn "CacheCountdownClockService" libs apps` hits only the service file and its own spec. The boot label is unchanged.
- Tests: the three specs listed.
- Verify: `npm run verify -- -p @ptah-extension/chat-ui`
- UI: no.

### B5b — Delete `CacheCountdownClockService` [chat-ui] (deps: B5a)

- Files: DELETE `W\libs\frontend\chat-ui\src\lib\molecules\session\inspector-stats\cache-countdown-clock.service.ts`, `…\cache-countdown-clock.service.spec.ts`.
- Change: approved removal (decisions #5).
- Acceptance: `grep -rn "CacheCountdownClockService\|cache-countdown-clock" libs apps` returns nothing.
- Tests: chat-ui suite.
- Verify: `npm run verify -- -p @ptah-extension/chat-ui`
- UI: no.

### B6 — Countdown cards [chat-ui] (deps: B1)

- Files: MODIFY `W\libs\frontend\chat-ui\src\lib\molecules\permissions\permission-request-card.component.ts`; CREATE `…\permission-request-card.component.spec.ts`; MODIFY `W\libs\frontend\chat-ui\src\lib\molecules\question-card.component.ts`; CREATE `…\question-card.component.spec.ts`.
- Change: Component 6 (permission, question).
- Acceptance:
  - Deny fires exactly once, including on an already-expired mount.
  - After expiry `jest.getTimerCount() === 0` and the acquire's release has been called.
  - There is no acquire when `timeoutAt === 0`.
- Tests: the two new specs.
- Verify: `npm run verify -- -p @ptah-extension/chat-ui`
- UI: no.

### B7 — chat-ui metric views [chat-ui] (deps: B2)

- Files: MODIFY `W\libs\frontend\chat-ui\src\lib\atoms\token-badge.component.ts`, `…\token-badge.component.spec.ts`, `W\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-rail-card.component.ts`, `…\compact-rail-card.component.spec.ts`.
- Change: Component 7.
- Acceptance: the badge total includes cache classes, and `NaN` renders `—`. The rail shows a known `0%` and hides `null`.
- Tests: the two specs.
- Verify: `npm run verify -- -p @ptah-extension/chat-ui`
- **UI: yes**. The message token badge on a cached turn, and the compact rail card at 0%.

### B8a — Transcript clocks [chat] (deps: B1)

- Files: MODIFY `W\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts`, `…\chat-transcript.component.spec.ts`; DELETE `…\transcript-live-clock.ts`; MODIFY `…\lane-transcript.component.ts`, `…\lane-transcript.component.spec.ts`.
- Change: Component 8 (transcripts).
- Acceptance: the live elapsed label is unchanged. No `TranscriptLiveClock` and no `monitor.tick` read remains in these files.
- Tests: both specs.
- Verify: `npm run verify -- -p @ptah-extension/chat`
- UI: no.

### B8b — Lane and compact card clocks [chat] (deps: B1)

- Files: MODIFY `W\libs\frontend\chat\src\lib\components\organisms\subagent-lane\subagent-lane.component.ts`, `…\subagent-lane.component.spec.ts`, `W\libs\frontend\chat\src\lib\components\molecules\compact-session\compact-session-card.component.ts`, `…\compact-session-card.component.spec.ts`.
- Change: Component 8 (subagent lane, compact card T13 and C2).
- Acceptance: elapsed survives a remount. No per-card interval. F2 and F6 hold on the card.
- Tests: both specs.
- Verify: `npm run verify -- -p @ptah-extension/chat`
- **UI: yes**. The compact session card context badge after a resume. An unknown window is now hidden instead of showing `0%`.

### B10 — Lane usage resolver [chat] (deps: B2)

- Files: MODIFY `W\libs\frontend\chat\src\lib\utils\lane-stats.adapters.ts`, `…\lane-stats.adapters.spec.ts`, `W\libs\frontend\chat\src\lib\components\molecules\agent-card\stats-bar.utils.ts`, `…\stats-bar.utils.spec.ts`, `…\cli-lane-usage-summary.component.ts`, `…\cli-lane-usage-summary.component.spec.ts`.
- Change: Component 9.
- Acceptance: `resolveCliLaneUsage` exists. `cliLaneStats` output is unchanged for existing fixtures. Partial usage renders `≥`.
- Tests: the three specs.
- Verify: `npm run verify -- -p @ptah-extension/chat`
- UI: no.

### B11 — Lane usage consumers + agent card clock [chat] (deps: B1, B10)

- Files: MODIFY `W\libs\frontend\chat\src\lib\components\molecules\agent-card\agent-card.component.ts`, `…\cli-agent-output.component.ts`, `…\cli-agent-output.component.spec.ts`, `W\libs\frontend\chat\src\lib\components\organisms\session-inspector\inspector-agent-usage.ts`; CREATE `…\inspector-agent-usage.spec.ts`.
- Change: Component 10.
- Acceptance: header, summary and inspector agree for one fixture. No `store.tick` in agent-card.
- Tests: `cli-agent-output.component.spec.ts`, `inspector-agent-usage.spec.ts`.
- Verify: `npm run verify -- -p @ptah-extension/chat`
- **UI: yes**. The CLI agent card header with the partial `≥` cue.

### B12 — Turn metrics [chat] (deps: B2)

- Files: MODIFY `W\libs\frontend\chat\src\lib\utils\turn-facts.utils.ts`; CREATE `…\turn-facts.utils.spec.ts`; MODIFY `W\libs\frontend\chat\src\lib\components\molecules\turn\turn-activity-panel.component.ts`.
- Change: Component 11.
- Acceptance: cache classes appear. The coverage labels are unchanged.
- Tests: `turn-facts.utils.spec.ts`.
- Verify: `npm run verify -- -p @ptah-extension/chat`
- **UI: yes**. The turn activity tokens row.

### B13a — Inspector components [chat] (deps: B1)

- Files: MODIFY `W\libs\frontend\chat\src\lib\components\organisms\session-inspector\inspector-agents-section.component.ts`, `…\inspector-agents-section.component.spec.ts`, `…\session-inspector.component.ts`, `…\session-inspector.component.spec.ts`.
- Change: Component 12 (T14, M6).
- Acceptance: no section interval runs when no agent is running (`getTimerCount() === 0`). The elapsed label advances while one runs. Orchestrator "In" equals `tokens.input`.
- Tests: the two specs.
- Verify: `npm run verify -- -p @ptah-extension/chat`
- **UI: yes**. The inspector orchestrator row "In" value.

### B13b — Inspector store [chat] (deps: B2, B4, TC1)

- Files: MODIFY `W\libs\frontend\chat\src\lib\services\session-inspector\session-inspector.store.ts`; CREATE `…\session-inspector.store.spec.ts`.
- Change: Component 12 (M7, M8 via `turnCount`, C2, cross-workspace).
- Acceptance: all cases in the Component 12 store seam pass: tokens `null`, F2, F6, the four turns-precedence cases, background re-evaluation, and workspace removal.
- Tests: `session-inspector.store.spec.ts`.
- Verify: `npm run verify -- -p @ptah-extension/chat`
- **UI: yes**. Inspector tokens `—` without host `tokenCount`, the host turn count on a paged history, and the context `—` for an unknown window.

### B14 — Subagent tool count + inline duration [chat] (deps: B1)

- Files: CREATE `W\libs\frontend\chat\src\lib\utils\subagent-tool-count.ts`, `…\subagent-tool-count.spec.ts`; MODIFY `W\libs\frontend\chat\src\lib\components\organisms\execution\subagent-tile.component.ts`, `…\subagent-tile.component.spec.ts`, `…\inline-agent-bubble.component.ts`, `…\inline-agent-bubble.component.spec.ts`.
- Change: Component 15.
- Acceptance: the lag-plus-trim test passes as specified (3 → 2 → 3). The count carries `title="Current known count"`. The inline duration ticks while running.
- Tests: the three specs.
- Verify: `npm run verify -- -p @ptah-extension/chat`
- UI: yes. The inline agent bubble duration while running.

### B15 — Workspace loading start [core, chat] (deps: B1)

- Files: MODIFY `W\libs\frontend\core\src\lib\services\electron-layout.service.ts`, `…\electron-layout.service.spec.ts`, `W\libs\frontend\chat\src\lib\components\templates\workspace-loading-state.component.ts`, `…\workspace-loading-state.component.spec.ts`.
- Change: Component 5 (T4, T24).
- Acceptance: the hint deadline is anchored on the service start. The day key follows the coarse clock.
- Tests: both specs.
- Verify: `npm run verify -- -p @ptah-extension/core,@ptah-extension/chat`
- UI: no.

### B16 — Settings clocks and T1 UI [chat] (deps: B1, B3b)

- Files: MODIFY `W\libs\frontend\chat\src\lib\settings\pro-features\system-prompt-drawer.component.ts`, `…\system-prompt-drawer.component.spec.ts`, `W\libs\frontend\chat\src\lib\settings\providers\provider-setup-wizard.component.ts`, `…\provider-setup-wizard.component.spec.ts`, `W\libs\frontend\chat\src\lib\settings\providers\accounts\ambient-account-row.component.ts`, `…\ambient-account-row.component.spec.ts`.
- Change: Component 13 (T1, T2, T22).
- Acceptance: the drawer, wizard and row cases in the Component 13 seam pass, including the coarse-tick reconciliation and the absent-field case.
- Tests: the three specs.
- Verify: `npm run verify -- -p @ptah-extension/chat`
- **UI: yes**. The system-prompt drawer during a running regeneration, after close and reopen.

### B17 — Notices and welcome clocks [chat] (deps: B1)

- Files: MODIFY `W\libs\frontend\chat\src\lib\settings\providers\connection-drawer\overview-tab.component.ts`, `…\overview-tab.component.spec.ts`, `W\libs\frontend\chat\src\lib\components\molecules\notifications\resume-notification-banner.component.ts`, `W\libs\frontend\chat\src\lib\components\templates\electron-welcome.component.ts`, `…\electron-welcome.component.spec.ts`.
- Change: Component 13 (T7, T8, T23).
- Acceptance: the age labels advance every 30 s while open. No per-row interval.
- Tests: the overview and welcome specs.
- Verify: `npm run verify -- -p @ptah-extension/chat`
- UI: no.

### B18 — Command Center [command-center] (deps: B1, B4)

- Files: MODIFY `W\libs\frontend\command-center\src\lib\components\command-center-page.component.ts`, `…\command-center-page.component.spec.ts`, `…\command-center-page.controller.ts`, `…\command-center-page.controller.spec.ts`; DELETE `…\command-center-clock.ts`, `…\command-center-clock.spec.ts`.
- Change: Component 14.
- Acceptance: a background tab yields stats and re-renders on update. `contextCue().percent === 65` for F2. `grep -rn "commandCenterClock\|command-center-clock" libs apps` returns nothing.
- Tests: the page and controller specs.
- Verify: `npm run verify -- -p @ptah-extension/command-center`
- **UI: yes**. The Command Center with the root tab in a background workspace.

### B19a — Canvas + indexing [canvas, workspace-indexing] (deps: B1)

- Files: MODIFY `W\libs\frontend\canvas\src\lib\canvas-detail\canvas-lane-tabs.component.ts`, `…\canvas-lane-tabs.component.spec.ts`, `W\libs\frontend\canvas\src\lib\canvas-rail\canvas-empty-board.component.ts`, `…\canvas-empty-board.component.spec.ts`, `W\libs\frontend\workspace-indexing\src\lib\workspace-indexing.component.ts`, `…\workspace-indexing.component.spec.ts`.
- Change: Component 16 (T11, T15, canvas day).
- Acceptance:
  - Lane tabs: elapsed advances by 1 s per fake second while `ticking()`. `getTimerCount() === 0` when not ticking. No local `setInterval` remains.
  - Empty board: the grid day key flips when fake time crosses local midnight (coarse clock). The load-wait `setTimeout` behaviour is unchanged (D6).
  - Indexing: the relative-time label changes after 30 s of fake time and does not re-render between ticks.
- Tests: `canvas-lane-tabs.component.spec.ts`, `canvas-empty-board.component.spec.ts`, `workspace-indexing.component.spec.ts`.
- Verify: `npm run verify -- -p @ptah-extension/canvas,@ptah-extension/workspace-indexing`
- UI: no.

### B19b — Git + memory [git-ui, memory-curator-ui] (deps: B1)

- Files: MODIFY `W\libs\frontend\git-ui\src\lib\history\history-timeline.component.ts`, `…\history-timeline.component.spec.ts`, `W\libs\frontend\git-ui\src\lib\stash\stash-popover.component.ts`, `…\stash-popover.component.spec.ts`, `W\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\memory-diagnostics-accordion.component.ts`, `…\memory-diagnostics-accordion.component.spec.ts`.
- Change: Component 16 (T9, T10, T12).
- Acceptance:
  - History timeline: a row's "ago" label advances after 30 s of fake time with no new commits.
  - Stash popover: `stashAge` receives the coarse `now()`. The label for a fixed stash timestamp changes after 30 s. The `stashAge` signature is unchanged.
  - Memory diagnostics: `now` comes from the coarse clock, not from `recentEvents`. The children's `[now]` labels advance with no new events.
  - No interval is acquired after each component is destroyed (`getTimerCount() === 0`).
- Tests: `history-timeline.component.spec.ts`, `stash-popover.component.spec.ts`, `memory-diagnostics-accordion.component.spec.ts`.
- Verify: `npm run verify -- -p @ptah-extension/git-ui,@ptah-extension/memory-curator-ui`
- UI: no.

### B19c — Setup wizard [setup-wizard] (deps: B1)

- Files: MODIFY `W\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`, `…\setup-wizard-state.service.spec.ts`, `W\libs\frontend\setup-wizard\src\lib\components\analysis-stats-dashboard.component.ts`; CREATE `…\analysis-stats-dashboard.component.spec.ts`; MODIFY `…\generation-workflow-shell.component.ts`, `…\generation-workflow-shell.component.spec.ts`.
- Change: Component 5 (T3) and Component 16 (T19).
- Acceptance: elapsed is derived from the root start and is correct after a remount and after `reset()`. The handoff countdown is unchanged in whole seconds.
- Tests: the three specs.
- Verify: `npm run verify -- -p @ptah-extension/setup-wizard`
- UI: no.

### B20 — Retire the monitor tick [chat-streaming] (deps: B8a, B8b, B11)

- Files: MODIFY `W\libs\frontend\chat-streaming\src\lib\agent-monitor.store.ts` (+ `agent-monitor.store.spec.ts` only if it references the tick).
- Change: Component 17.
- Acceptance: the grep precondition holds, and typecheck passes for the dependants.
- Tests: `agent-monitor.store.spec.ts`.
- Verify: `npm run verify -- -p @ptah-extension/chat-streaming,@ptah-extension/chat,@ptah-extension/canvas`
- UI: no.

### B21 — Delete `SessionCostSummaryComponent` [chat-ui, chat] (deps: none)

- Files: DELETE `W\libs\frontend\chat-ui\src\lib\molecules\session\session-cost-summary.component.ts`; MODIFY `W\libs\frontend\chat-ui\src\index.ts`, `W\libs\frontend\chat\src\lib\components\index.ts`.
- Change: Component 21 (approved removal, decisions #5).
- Acceptance: `grep -rn "SessionCostSummaryComponent\|ptah-session-cost-summary" libs apps` returns nothing. `SessionStatsSummaryComponent` is still re-exported.
- Tests: the chat-ui and chat suites.
- Verify: `npm run verify -- -p @ptah-extension/chat-ui,@ptah-extension/chat`, then host typecheck.
- UI: no.

### Final gate (team-leader, after all batches)

Run `npm run verify` once (affected vs `main`, under the lock). It covers every host that depends on the changed libs: Electron, VS Code, webview, CLI and TUI. The pre-push hook adds di-lint and `validate-deps`.

## Proposed Removals

All five are **APPROVED by user (decisions #5)**.

| Item | Location | Why | Replacement | Batch |
| --- | --- | --- | --- | --- |
| `CacheCountdownClockService` (+ spec) | `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/cache-countdown-clock.service.ts` | Generalised into the core clock | `injectWallClock('second')` | B5a → B5b — APPROVED by user (decisions #5) |
| `TranscriptLiveClock` and `commandCenterClock` (+ spec) | `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-live-clock.ts`; `libs/frontend/command-center/src/lib/components/command-center-clock.ts` | Per-component intervals | `injectWallClock` | B8a, B18 — APPROVED by user (decisions #5) |
| `AgentMonitorStore.tick` + `startTick/stopTick/syncTick` | `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1038-1043,1296-1324` | A renderer-independent counter | The core clock in each consumer | B20 — APPROVED by user (decisions #5) |
| Client regenerate heuristic (`regenerateStartedAt`, `regenerateBaseline`, `ranOutClientBudget`, the 2× timeout) | `system-prompt-drawer.component.ts:337-342,454-499` | Replaced by host `regenerationStartedAt`, now reconciled for wedged runs | Components 3 and 13 | B16 — APPROVED by user (decisions #5) |
| `SessionCostSummaryComponent` + exports (M11) | `libs/frontend/chat-ui/src/lib/molecules/session/session-cost-summary.component.ts`; `chat-ui/src/index.ts:114`; `chat/src/lib/components/index.ts:103` | No template uses it. Its per-message average is misleading on partial counts | None (no consumer) | B21 — APPROVED by user (decisions #5) |

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D1 | Fix definitions and clocks. Do not move pure projections out of components | Move every formatter to stores | `research-metrics.md` "Already correct"; `session-stats-summary.component.ts:95-107` | yes |
| D2 | Clock in `@ptah-extension/core` (`WallClockService` + `injectWallClock`), two cadences | Monitor tick; `PlanLimitsStore.now`; a new lib | Every consumer imports core; `eslint.config.mjs:414-422`; proven shape `cache-countdown-clock.service.ts` | yes |
| D3 | Leave `PlanLimitsStore.now` and `BackOfficeActivityService` | Fold them in | They drive data refresh and idle state (`plan-limits.store.ts:273-281`, `back-office-activity.service.ts:150-154`) | yes |
| D4 | T1 uses the optional host field `regenerationStartedAt` and a per-workspace host guard | A root frontend store; an on-disk record | Root state dies on reload; the handler is a singleton (`register-shared-rpc-handlers.ts:115`); the field is additive | yes |
| D5 | T2 probe stays in the component, with an absolute start, the shared clock, and cancel on destroy | Root store per probe | The draft is memory-only (`provider-setup-wizard.component.ts:8-16`) | yes |
| D6 | T5 load-wait timeout stays component-owned | Root deadline | `WorkspaceVitalsStore` is per component (`canvas-empty-board.component.ts:83`) | yes |
| D7 | "In" means uncached input everywhere | A separate "Prompt in" label | `rpc-session.types.ts:398-399`; `lane-stats.adapters.ts:63` | yes |
| D8 | **Superseded by decisions #6.** Turns come from host `turnCount`. Fallback: the loaded-window count only when `olderHistoryCursor` is null, else `null` (hidden). No `N+` label | Rev-1 `N+ turns` partial cue | User decision #6; the cursor marks an incomplete window (`history-paging.service.ts:32-40`); the template hides `null` (`inspector-session-stats.component.ts:255`) | yes |
| D9 | `backgroundTabsRevision` signal; the finder stays untracked | A tracked finder; per-tab signals | The map is non-reactive (`tab-workspace-partition.service.ts:90,102`); the finder is called from event routing | yes |
| D10 | Message badge total = four classes | in+out | `rpc-session.types.ts:383-384` | yes |
| D11 | `command-center-clock.ts` is in scope | Ignore it | `command-center-clock.ts:3-11` | n/a |
| D12 | **Revised.** Subagent tools = `max(host toolUses, displayed tool nodes)`, labelled "current known count". **No monotonic guarantee** | A root high-water mark per subagent record | The tree is evicted and truncated in the root `SubagentExecutionStore` (`subagent-execution.store.ts:304-315,495`). A high-water mark needs a per-entry set of tool ids that survives eviction and history merges, which is a new store-owned state for one label. The host count is cumulative "last reported" (`agent-monitor.store.ts:646-648`) and becomes final at completion, so the value converges. The review's lag-plus-trim case is pinned by a test | yes |
| D13 | No lint rule | `no-restricted-globals` | Two cosmetic loops would need suppressions | yes |
| D14 | CLI token total excludes cache when `totalTokens` is missing, and is flagged inexact | Four-class sum | Providers differ on cache inclusion (`lane-stats.adapters.ts:82-94`) | yes |
| D15 | Plan written without CLI lanes | Lanes | Every claim needed a personal source read. Lanes stay the recommended executors | yes |
| D16 | T1 reconciliation is **lazy on read**: lock state plus `ENHANCED_PROMPTS_RUN_CEILING_MS`, with a token-guarded `finally` | A handler timer per run; a new service `onForceRelease` hook for unbound runs | Force-release clears the lock without settling the promise (`enhanced-prompts.service.ts:333-346`); `generationInProgress` is public (`:376-378`); a lazy check needs no timer (runtime-cost rule); the `bound` hook needs a reservation and route that unbound runs lack (`:817-826`) | yes |
| D17 | `turnCount` = prompt runs (ledger) and accepted results (live owner). It is omitted when not every turn can be counted | Count assistant messages; count on the frontend | A turn is user-initiated, which matches `countTurns` (`session-inspector.store.ts:75-85`); one accepted result per turn (`session-stats-owner.service.ts:600-611`); an omitted field keeps decision #6 (no partial sums) | yes |
| D18 | C1: on resume, carry a trusted window forward from the tab's persisted reading for the **same model** | Infer a window from the model id; a host capacity store; accept `—` until the next turn | The tab reading is persisted (`tab-persistence.ts:84-90`); the same carry-forward already runs for compaction and live estimates (`tab-manager.service.ts:2578,2597`; `live-context-stats.ts:61-73`); a static table guess was retired by capacity evidence (`session-history-reader.service.ts:1303-1317`); a host store is forbidden (decision #6). A stale window after a route change is corrected by the next live result | yes |
| D19 | A forked session in a new tab shows context `—` until its first turn ends | Seed from the parent tab | The fork has no prior reading. Seeding couples fork flow to tab state for one label. Honest unknown follows the strict rule | yes |
| D20 | Context helpers live in shared `context-fill.utils.ts`, used by host and frontend | Keep three local copies; put them in chat-ui | chat-state cannot import chat-ui (`type:data-access`, `eslint.config.mjs:425-426`); shared is reachable from every side | yes |
| D21 | C1 no-snapshot branch: re-install the prior trusted same-model reading with its own `contextUsed` (`contextFillStats(prior, prior.contextUsed)`); same-model is `normalizeModelKey` equality on both resume branches | Keep `—` until the next turn; have the host send post-compaction tokens with the boundary (new contract field); strict `===` model compare | The host returns no snapshot when the latest main record is a compact boundary (`session-history-reader.service.ts:1283-1285`), and the loader then writes unknown (`session-loader.service.ts:1273-1287`), which loses a live 15% (review Serious 1). Every in-tab compaction re-seeds or nulls the prior reading (`tab-manager.service.ts:2578,2597-2600`), so the prior is post-compaction unless the transcript was compacted by another client while the tab was closed; then the stale reading shows until the next turn ends, the same correction path D18 accepts for a route change. A host contract field is a larger change than the defect and is not needed for in-tab compaction. `normalizeModelKey` is the existing comparison (`live-context-stats.ts:66`) | yes |
| D22 | History context frame skips every `isSidechain === true` record, assistant frames and compact boundaries alike | Skip only sidechain assistant frames; filter sidechain records upstream in the reader | `isSidechain` marks a subagent record in the main transcript (`history.types.ts:83-84`); the live path already excludes subagent frames (`stream-transformer.ts:633-680`); a sidechain boundary describes the subagent's own context, not the main loop's, so letting it end the scan erases a valid main frame (review Serious 2). An upstream filter would change replay, which reads `isSidechain` (`jsonl-reader.service.ts:938-939`) | yes |
| D23 | Live owner: the provisional estimate contribution carries `turnCount: 0`; accepted turns ride only on the authoritative `run.current` contribution; an incomplete run omits it on both | `run.turns` on both; omit on the estimate | `build()` pushes two contributions for a run with a result and a live estimate (`session-stats-owner.service.ts:879-891`); `run.turns` on both doubles completed turns, and omission makes the summed total unknown (aggregation rule, Component 18) and hides the label mid-turn (review Serious 4). An in-flight turn is not completed, so 0 is exact | yes |
| D24 | Project raw `isCompactSummary` into `SessionHistoryMessage` (TC0) instead of relying on `isMeta` | Rely on `isMeta`; detect the summary by its text prefix | No source sets or reads `isCompactSummary` today, and nothing shows that compact-summary records carry `isMeta`. The frontend has to detect the summary by its opening words (`libs/frontend/chat/src/lib/utils/turn-facts.utils.ts:9-24`, `message-bubble.component.ts:397-406`), which shows it arrives as an ordinary user message, so `isMeta` cannot be assumed to exclude it (review Serious 5). A text prefix on the host would diverge from the raw ledger, which reads the flag; the same flag on both paths keeps raw and resume classification identical | yes |

## Clarifications Needed

None. Every open point above was settled from source. The four approved removals and the turn-count scope are user decisions already recorded in `decisions.md` #5 and #6.

## Team-leader handoff

- Recommended executors:
  - frontend-developer or codex lanes for B1, B4, B5a–B21 (frontend), CX3–CX5, HB1 and TC3. These are Angular signals, OnPush and `inject()`.
  - backend-developer for B3a, B3b, TC0, TC1, TC2 and CX2. These are the transcript projection, ledger, aggregator, owner and handler.
  - Either for B2 and CX1, which are pure TypeScript.
  - Reviews come from a different model family (decisions #4).
- Complexity: HIGH.
  - About 95 files across 14 frontend libs and 3 backend libs.
  - Risk sits in TC1 (the ledger gate and perf), TC2 (owner turn semantics, assumption in Component 18), CX4 (two resume branches), B3b (reconciliation) and ordering (B5b, B20).
- Dependencies and ordering:
  - First wave (parallel): B1, B2, B3a, B4, TC0, B21.
  - After TC0: TC1. After B2: CX1, B7, B10, B12. After B3a: B3b. After TC1: TC2, TC3.
  - After CX1: CX3. After CX1 + TC1: CX2 (serial with TC1 on `session-history-reader.service.ts` and its spec). After CX3: CX5, HB1. After CX1 + CX3: CX4.
  - After B1: B5a, B6, B8a, B8b, B13a, B14, B15, B17, B19a, B19b, B19c. After B5a: B5b.
  - B11 (B1 + B10), B16 (B1 + B3b), B18 (B1 + B4), B13b (B2 + B4 + TC1).
  - B20 last among the clock batches (after B8a, B8b and B11).
- Parallel-safe work: no two batches that can run in parallel share a file. The only shared files sit on an explicit dependency: `utils/index.ts` (B2 → CX1) and `session-history-reader.service.ts` plus its spec (TC0 → TC1 → CX2; TC0 does not touch them). TC0's three files and HB1's two files appear in no other batch. Run at most 2 batches concurrently, because the verify lock serialises checks.
- Files affected:
  - CREATE: `wall-clock.service.ts`/`.spec.ts`, `token-usage.utils.ts`/`.spec.ts`, `context-fill.utils.ts`/`.spec.ts`, `permission-request-card.component.spec.ts`, `question-card.component.spec.ts`, `inspector-agent-usage.spec.ts`, `turn-facts.utils.spec.ts`, `session-inspector.store.spec.ts`, `subagent-tool-count.ts`/`.spec.ts`, `analysis-stats-dashboard.component.spec.ts`.
  - DELETE: `cache-countdown-clock.service.ts`/`.spec.ts`, `transcript-live-clock.ts`, `command-center-clock.ts`/`.spec.ts`, `session-cost-summary.component.ts`.
  - MODIFY: every other path in the batches, including (new in rev 3) `history.types.ts`, `jsonl-reader.service.ts`/`.spec.ts` (TC0) and `builder-session-section.component.ts`/`.spec.ts` (HB1). Full paths are in each batch.
- Verification points:
  - Confirm on a fresh read before using a name:
    - `liveTurns` / `isStreaming` (lane-transcript)
    - the `page.tabs` type (Command Center)
    - `restoreLayout` → `syncFromBackend`
    - one SDK result per user prompt (Component 18 assumption)
    - (`isCompactSummary` is resolved: verified absent, projected by TC0, D24.)
  - Grep gates:
    - No `CacheCountdownClockService`, `TranscriptLiveClock`, `commandCenterClock`, `SessionCostSummaryComponent` or monitor `.tick()` remains.
    - `grep -rn "setInterval" libs/frontend --include=*.component.ts` returns only the two cosmetic loops.
    - `grep -rn "capacity.source === 'sdk-native'" libs/frontend` returns no hits outside spec files.
    - The reader greps `contextPercent` and `\.contextUsed|\.contextWindow\b` (non-spec, `libs/frontend` and `apps`) return only files in the reader inventory under "Every frontend view of context %".
  - Per-batch `npm run verify -- -p …` as listed, host typecheck where marked, then the final affected `npm run verify`.
  - Electron before/after screenshots for B7, B8b, B11, B12, B13a, B13b, B14, B16, B18, CX4 and HB1.
