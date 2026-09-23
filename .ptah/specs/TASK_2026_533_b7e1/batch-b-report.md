# Batch B report: frontend (TASK_2026_533_b7e1)

Worktree: `D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement`, branch `fix/session-stats-disagreement`, on top of Batch A (`f00c30d44`). No git command that changes history was run. Nothing was committed or stashed. `.ptah/specs/TASK_2026_418_a91c/*` was not touched.

## Summary

- The stats panel reads ONE input, `snapshot: SessionStatsEntry | null`, for every accounting number: the cost chip (`totalCost`), the tokens chip (`tokenCount`), the agents chip (`agentSessionCount`), the table rows (`modelUsageList`) and the table totals (`tokens.*`, `totalCost`).
  - Deleted: the message-derived summary (`calculateSessionCostSummary`), the frontend token arithmetic and the row `.reduce` totals.
  - The `messages`, `preloadedStats` and `modelUsageList` inputs are gone. `liveModelStats` (the context badge) and `compactionCount` stay as separate inputs.
- Tabs and surfaces INSTALL the snapshot; they never add to it.
  - `TabState.sessionStats` replaces `preloadedStats` and `modelUsageList`.
  - `SurfaceSessionStats.snapshot` replaces `totals` and `modelUsage`.
  - A snapshot is dropped if it names another session, or if its `revision` is lower than one already installed for the same session in this page lifetime.
- Compaction no longer builds totals from messages. The tab keeps its snapshot.
- The background strip names the populations it shows: `N background · M done`, or both populations when mixed. The AGENTS chip stays the backend lifetime count.

## Files changed

### chat-ui (presentational)
- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts`
  - Uses the single `snapshot` input.
  - Both layouts render ONE `ng-template` table with the columns IN (uncached), OUT, CACHE READ, CACHE CREATION and COST, and `role` table semantics. Footer totals come from the snapshot.
  - A known-subtotal label appears only when pricing is partial and `totalCost` is null.
  - Duration shows only when the backend sends `durationMs`.
  - An absent snapshot or an absent aggregate renders "—" or "cost unavailable".
  - The container-query CSS is scoped to the card grid (`.stats-cards`). It previously also re-columned the table rows.
  - The file went from 857 to 725 lines.
- CREATED `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.spec.ts`
- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/background-agent-strip.component.ts`: the required `origin: 'foreground' | 'background'` field and a population-labelled `summaryText`.
- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/background-agent-strip.component.spec.ts`
- MODIFIED `libs/frontend/chat-ui/src/index.ts`: the `ModelUsageEntry` export is removed (the type is deleted). *(out of list, see below)*
- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.ts` and `compact-session-stats.component.ts`: `CompactSummaryMetrics.tokens` is now `number | null` and renders `Tokens —`. *(out of list, see below)*

### chat-types
- MODIFIED `libs/frontend/chat-types/src/lib/chat-types.ts`: `TabState.sessionStats?: SessionStatsEntry | null` is added. `preloadedStats` and `modelUsageList` are removed.

### chat-state
- MODIFIED `libs/frontend/chat-state/src/lib/tab-manager.service.ts`
  - Added `installSessionStats(tabId, snapshot)` and `activeTabSessionStats`.
  - `applyLoadedSessionStats(tabId, SessionStatsEntry, model)` now installs the snapshot through the same guard.
  - `applyCompactionComplete` no longer takes or writes stats.
  - Removed `setPreloadedStats`, `setModelUsageList`, `setLiveModelStatsAndUsageList`, `activeTabPreloadedStats` and `activeTabModelUsageList`.
  - The revision guard is a private page-lifetime `Map`. It is never persisted and is pruned when a tab closes or resets.
- MODIFIED `libs/frontend/chat-state/src/lib/tab-manager.intent-mutators.spec.ts`
- MODIFIED `libs/frontend/chat-state/src/lib/surface-session-stats.registry.ts`: stores `{ live, snapshot }`, assignment only, with the same session and revision guard. The addition code and `SurfaceModelUsage` are removed.
- MODIFIED `libs/frontend/chat-state/src/lib/surface-session-stats.registry.spec.ts`
- MODIFIED `libs/frontend/chat-state/src/lib/tab-state.types.ts`: `PreloadedStatsPayload` is removed. *(out of list)*
- MODIFIED `libs/frontend/chat-state/src/index.ts`: the `PreloadedStatsPayload` and `SurfaceModelUsage` exports are removed. *(out of list)*
- MODIFIED `libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts` and `tab-manager.lifecycle.spec.ts` *(out of list)*

### chat
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts`
  - New exported `SessionStatsEvent` type, which includes `sessionStats?`.
  - Installs the snapshot on every target tab, or records it on the surface.
  - The `preloadedStats` addition block is deleted.
  - Context derivation and the unchanged forwarding to `StreamingHandlerService` are kept.
  - A snapshot whose `sessionId` differs from the event's is ignored, with a warning.
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`
  - `applyResumeStats` installs the resume `SessionStatsEntry` as-is. The row copy with patched `contextWindow` is gone.
  - A resume that carries no stats keeps the snapshot and clears only the context badge.
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts`: the `calculateSessionCostSummary` reconstruction is removed.
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/services/chat.store.ts`: `sessionStats` replaces `preloadedStats` and `modelUsageList`. `handleSessionStats(SessionStatsEvent)`.
- MODIFIED `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` and `.html`: `[snapshot]="resolvedSessionStats()"`.
- MODIFIED `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts`: metrics come from `tab.sessionStats` (`tokenCount`, `totalCost`, `agentSessionCount`). The message summary is removed. `agentCount` is always passed, so the tree-counting fallback in `summarize*` never runs.
- MODIFIED `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/components/organisms/background-agent-tray.component.ts`: sets `origin`. Background records win on dedupe, as before.
- MODIFIED `libs/frontend/chat/src/lib/components/organisms/background-agent-tray.component.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/components/index.ts` and `services/index.ts`: removed re-exports of deleted types. *(out of list)*
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/session-loader.cli-restore.spec.ts`: dropped mocks of removed setters. *(out of list)*

### harness-builder
- MODIFIED `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts`: `[snapshot]="stats.snapshot"` and `[liveModelStats]="stats.live"`. The `modelUsageList` copy and the `ModelUsageEntry` import are removed.
- MODIFIED `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.spec.ts`: renders the real summary component and provides a `ModelStateService` stub.

## Failing specs: before and after

Every failure below was run against the unchanged production code. Specs are transpile-only (`isolatedModules`), so every failure is a runtime failure.

| Spec | Failure before the fix | After |
| --- | --- | --- |
| `chat-ui/.../session-stats-summary.component.spec.ts` (new, 8 tests) › "displays one backend snapshot in both layouts without message-derived totals", plus null, zero, partial, absent-snapshot, absent-aggregate, rows-not-summing and duration cases | All 8 fail with `NG0303: Can't set value of the 'snapshot' input on the 'SessionStatsSummaryComponent' component.` | PASS |
| `chat-ui/.../background-agent-strip.component.spec.ts` › "labels five completed background entries as five background" | `Expected: "5 background · 5 done"`, `Received: "5 agents · 5 done"`. The mixed test received `"5 agents · 2 running · 1 background · 2 done"`. | PASS |
| `chat/.../session-stats-aggregator.service.spec.ts` › "installs snapshots 10 then 15 without addition for tabs and surfaces" | `installSessionStats` was never called (`- Expected - 90 / + Received + 1`). The mismatched-session test received no warning. | PASS |
| `harness-builder/.../harness-builder-view.component.spec.ts` › "binds stored snapshot and independent live context badge" | `TypeError: summary.snapshot is not a function` | PASS |
| `chat-state/.../tab-manager.intent-mutators.spec.ts`: install, older-revision, no-revision, session-mismatch, restored-revision and compaction-keeps-snapshot | `TypeError: service.installSessionStats is not a function`. `applyLoadedSessionStats` → `Expected: {…snapshot}`, `Received: undefined`. | PASS |
| `chat-state/.../surface-session-stats.registry.spec.ts` (5 tests) | `TypeError: Cannot read properties of undefined (reading 'input')`: the old `record` adds up `turn.tokens` | PASS |
| `chat/.../session-loader.service.spec.ts`: install as-is, and keep the snapshot on an empty resume (also UICS-010) | `TypeError: this.tabManager.setPreloadedStats is not a function`: the old path clears or rebuilds the snapshot. Dependent `setLiveModelStats` expectations showed `Number of calls: 0`. | PASS |
| `chat/.../compaction-lifecycle.service.spec.ts` › "never manufactures session totals from messages on compaction", B2 | The payload carried a manufactured `preloadedStats` (`{"messageCount":0,"tokens":{…0},"totalCost":null}`) | PASS |
| `chat/.../compact-session-card.component.spec.ts` › snapshot metrics, and unavailable without a snapshot | `Received string: "0 tokensCost —"` for both | PASS |
| `chat/.../background-agent-tray.component.spec.ts` › origin mapping | `origin` was undefined on every entry | PASS |

## Verification

Command:

```
npx nx run-many -t test,typecheck,lint -p @ptah-extension/chat-ui,@ptah-extension/chat-types,@ptah-extension/chat-state,@ptah-extension/chat,@ptah-extension/harness-builder --skip-nx-cache
```

Exit code 0: "Successfully ran targets test, typecheck, lint for 5 projects".

| Project | test | typecheck | lint |
| --- | --- | --- | --- |
| @ptah-extension/chat-state | 19 suites, 413 passed | pass | 0 errors, 2 warnings |
| @ptah-extension/chat-ui | 34 suites, 272 passed | pass | 0 errors, 8 warnings |
| @ptah-extension/chat | 96 suites, 1497 passed, 2 skipped | pass | 0 errors, 14 warnings |
| @ptah-extension/harness-builder | 5 suites, 120 passed | pass | 0 errors, 75 warnings |
| @ptah-extension/chat-types | no `test` target (Nx: "do not have a configuration") | pass | pass |

More on the checks:
- **Lint warnings.** `npx eslint <changed files>` shows only warnings that already exist at HEAD: `max-lines` on `tab-manager.service.ts`, `chat-view.component.ts`, `session-loader.service.ts` and `harness-builder-view.component.ts`, plus harness-builder `explicit-member-accessibility` and a loader `no-empty-function`. The panel's `max-lines` warning also existed at HEAD (857 lines, now 725). Four `no-non-null-assertion` warnings in my new spec were fixed.
- **Spec types.** `typecheck` covers only `tsconfig.lib.json`, so I also ran `tsc -p <lib>/tsconfig.spec.json --noEmit` for chat-ui, chat-state, chat and harness-builder. I intersected the errors with the lines this batch added, and none of the errors fall on those lines.
- **Formatting.** Prettier was applied to files that were Prettier-clean at HEAD, and to the panel component and its spec. Six touched files were already not Prettier-clean at HEAD; they were left as they were, to avoid unrelated churn.
- **Dashboard.** `@ptah-extension/dashboard` was not added. This batch changed no shared type, and a workspace grep finds no dashboard use of any removed symbol.

## Changes outside the file list, with reasons

1. **Barrels**: `chat-ui/src/index.ts`, `chat-state/src/index.ts`, `chat/src/lib/components/index.ts`, `chat/src/lib/services/index.ts`. They re-exported `ModelUsageEntry`, `PreloadedStatsPayload` and `SurfaceModelUsage`, which are deleted because nothing uses them after the change. Required for compile.
2. **`chat-state/src/lib/tab-state.types.ts`**: deleted `PreloadedStatsPayload`, which only fed the removed addition paths.
3. **`chat-ui/.../compact-session-summary.ts` and `compact-session-stats.component.ts`**: `CompactSummaryMetrics.tokens` could not express "unavailable". Without this change, the in-list compact card would show `0 tokens` for an absent snapshot, which breaks the "never zeros" rule. The summary builder also defaulted a missing value to `?? 0`. The compact card is the only caller of `summarizeLive` and `summarizeFinalized`.
4. **Specs that call removed APIs** (runtime `TypeError` otherwise):
   - `chat-state/.../tab-manager.service.spec.ts`: the compaction tests now use `setLiveModelStats` and `installSessionStats`. Its partition mock gains `findTabByIdAcrossWorkspaces`, the same stub `tab-manager.intent-mutators.spec.ts` already uses.
   - `chat-state/.../tab-manager.lifecycle.spec.ts`: the `activeTab*` selectors.
   - `chat/.../session-loader.cli-restore.spec.ts`: dead mocks.

## Pre-existing errors found (not fixed; unrelated to this change)

- **Batch A's two items are still present.** Neither depends on this change:
  - `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts:1677`: `'liveModelStats' does not exist in type '{ id: TabId; claudeSessionId: … }'`. This is a targeted-harness tab literal type, and it was at line 1716 before this batch removed lines.
  - `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.spec.ts:199`: `Type 'string' is not assignable to type 'TabId'`, from `makeTab({ id: 'bg-tab' })`. It was at line 176.
- **Batch A undercounted.** "Two errors" is not the whole picture: the spec tsconfigs carry many more pre-existing errors, mostly branded `TabId`/`SessionId` string literals. Examples:
  - `compaction-lifecycle.service.spec.ts:271` and more than 60 other lines
  - `tab-manager.lifecycle.spec.ts:197`
  - `tab-bar.component.spec.ts:170`
  - `compact-session-card.component.spec.ts:233` (`number` → `null` marker)
  - `libs/frontend/core/src/testing/mock-rpc-service.ts:54`
- **Nothing guards them.** No Nx target type-checks specs, so these errors do not fail CI.

## Decisions

- **Revision guard lifetime (tabs).** The guard is a private in-memory map, not a field on the persisted tab. A page reload is a new backend attachment in both hosts: a VS Code extension-host restart reloads the webview, and the Electron backend is the main process. So a restored tab's stored snapshot (for example revision 50) never blocks the restarted backend's revision 1. The spec "never compares a restored snapshot revision with the restarted backend counter" pins this through `loadTabState`.
- **Revision rules.**
  - An equal revision is accepted. The resume reply can carry the owner's snapshot with the same revision plus `contextSnapshot` and row `contextWindow`.
  - A snapshot without a revision (the resume path with no owner) is taken in arrival order.
- **Session mismatch.**
  - The aggregator rejects a snapshot whose `sessionId` differs from the event's.
  - `installSessionStats` rejects a snapshot for a session other than the tab's bound `claudeSessionId`. A tab with no bound session (null owner) can adopt it.
- **Strip labels.**
  - Background only: `N background · …`.
  - Foreground only: `N foreground · …`.
  - Mixed: `B background · F foreground · R running · D done`.
  - Status buckets always follow; zero counts are omitted.
- **Empty resume payload.** The tab keeps its snapshot. This is safe because `openSessionTab` returns either the same session's tab or a new tab without stats, and a session switch or reset nulls `sessionStats`.

## Open issues

1. `messageCount` is 0 for live runs and `durationMs` is not populated by Batch A. The panel never shows `messageCount`, and it hides the duration chip until the backend supplies `durationMs`. So the TIME chip that used to be derived from messages is gone for now.
2. `SessionStatsSummaryComponent` still injects `ModelStateService` from `@ptah-extension/core` for model display names. This predates the batch; no chat, state or backend service is imported. Removing it would need a display-name input from every host, which is outside the plan.
3. `chat-message-handler.service.ts:570` still casts the unvalidated `session:stats` payload (`payload as Parameters<…>[0]`). The boundary is not validated. That file is not in the list, so it was not changed.
4. Row `contextWindow` is no longer patched by the renderer's name lookup, because the table does not use it. The context badge still uses `wireContextWindow` for `contextSnapshot`.
5. The Batch A "legacy warmup agent files" item (Batch A open issue 4) may still inflate `agentSessionCount`. The frontend shows it as-is.

## Revision 1: response to code-logic-review.md (REVISE 5/10)

For each defect, the failing specs were written first and run against the pre-revision code. This section supersedes two earlier statements:
- "Decisions → Revision rules": an unrevisioned snapshot is no longer taken in arrival order.
- Open issue 3: the `session:stats` payload is now validated in the aggregator.

| Defect | Failure before the fix | Fix | Specs (all pass) |
| --- | --- | --- | --- |
| 1: an unrevisioned resume reply overwrote a newer live snapshot; the surface lost its floor | Tab: 15/$15 then an unrevisioned $2 displayed $2 (`toBe` diff), and the same through `applyLoadedSessionStats`. Surface: 15 then $2 displayed $2, and 10 → history → 5 displayed 5. | New `SessionStatsRevisionFloor` in `chat-state/src/lib/session-stats-snapshot.ts`, used by `TabManagerService.acceptSessionStats` and `SurfaceSessionStatsRegistry.record`. It keeps a per-session floor in memory, separate from the displayed snapshot. A revisioned snapshot installs only when it is not below the floor, and raises it. An unrevisioned snapshot installs only while the session has no floor. An unrevisioned install never lowers or clears the floor. Floors start empty on a webview reload and are never persisted. `surface.clear()` does not clear the floor. The earlier per-tab map and its close-time pruning are gone. | intent-mutators › "revision floor": 15/$15 then $2 stays $15; a delayed `applyLoadedSessionStats` cannot overwrite live 15; $2 then 1/$3 shows $3; one broadcast reaches two tabs of the same session. registry: 15/$15 then $2 stays $15; $2 then 1/$3 shows $3; floor-loss sequence $1 → 10 → $2 → 5 keeps 10. The restored-tab spec (stored revision 50, new revision 1 installs) still passes. |
| 2: a snapshot-only notification erased footer fields | `streamingHandler.handleSessionStats` was called 1 time (expected 0), so compaction clearing, refresh and queued send ran too. | `SessionStatsEvent` is now the union `SessionStatsResultEvent` / `SessionStatsSnapshotEvent`. `isSnapshotOnly` is true only when `cost`, `tokens` and `duration` are all `undefined`; a `0` or `null` cost counts as present. A snapshot-only payload installs its snapshot (tabs or surface) and returns BEFORE compaction clearing, context derivation, footer forwarding, sidebar refresh and queued-message handling. `StreamingHandlerService` never sees it, so the overwrite at `streaming-handler.service.ts:597/639` (finalized message footer, streaming `pendingStats`) cannot happen. | aggregator: a snapshot-only payload installs and runs none of the footer, compaction, refresh, queue or live-stats paths (with `queuedContent` primed); the surface variant; a `null` cost with zero tokens and duration is still a footer result. |
| 3: a malformed revision bypassed ordering | Tab and surface: 16/$16 then revision `"9"`/$9 displayed $9. Malformed tokens were installed. The aggregator installed both. The loader installed a malformed resume snapshot. | One validator, `isValidSessionStatsSnapshot` (same new file, exported from `@ptah-extension/chat-state`). It requires a non-empty `sessionId`; the four token classes as finite non-negative numbers; `totalCost` as a finite non-negative number or `null`; `revision`, when present, as a non-negative safe integer (absent is allowed, see rule 1); and the optional displayed fields (`tokenCount`, `knownCost`, `agentSessionCount`, `durationMs`, `modelUsageList` rows) well-typed when present. It is applied at both boundaries, each with ONE warning that names only the session id: the aggregator `snapshotFor` (`rejected a malformed session snapshot`) and loader `applyResumeStats` (the whole resume payload is skipped). The stores check it again, so any other caller is rejected atomically too. | intent-mutators: `"9"` after 16 stays $16; malformed tokens are not installed. registry: `"9"` after 16 stays $16; negative tokens are rejected. aggregator: one warning with `{ sessionId }` only and no install; surface `"9"` after 16 stays $16; missing token classes are rejected. loader: a malformed resume snapshot installs nothing and warns once. |
| 4: Time chip (minor) | No change needed. The pre-fix run of the extended spec already passed. | None. The panel shows `durationMs` when it is a positive number and hides it when absent or `null`. | panel: `null` is hidden; `125000` shows `2m 5s` in the collapsed bar and in the expanded card. |

### Deviation from the coordinator's rule 1 (stated explicitly)
- **Rule as given:** "installed only if revision > floor".
- **Rule as implemented:** a revision at or above the floor installs (`>=`).
- **Why:**
  - The floor is per session, and the aggregator installs one broadcast into every tab bound to that session (canvas grid).
  - With a strict `>`, the second tab would reject the same broadcast.
  - The backend revision counter is process-wide (`session-stats-owner.service.ts`, `revisionCounter`), so an equal revision is the same publication. Re-installing it is an idempotent assignment.
  - A strictly older revision is still rejected.
- **Spec:** "one broadcast reaches every tab bound to the session".

### Files touched in Revision 1
- CREATED `libs/frontend/chat-state/src/lib/session-stats-snapshot.ts` *(out of list)*: the validator and the revision floor. The tab store, the surface store and both boundaries share this one definition, so there is no second, drifting copy.
- MODIFIED `libs/frontend/chat-state/src/index.ts` *(out of list, already touched)*: exports `isValidSessionStatsSnapshot`.
- MODIFIED `libs/frontend/chat-state/src/lib/tab-manager.service.ts` and `surface-session-stats.registry.ts`, with their specs.
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts` and its spec.
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`: `applyResumeStats(tabId, sessionId, stats, …)`, validated.
- MODIFIED `session-loader.service.spec.ts`: new malformed test. Seven legacy resume fixtures gain `sessionId: SESSION`: they predate the `SessionStatsEntry` contract and are now validated.
- MODIFIED `libs/frontend/chat-ui/.../session-stats-summary.component.spec.ts`: duration `null` and expanded-layout cases.
- `chat-message-handler.service.ts` is unchanged. Validation happens in the aggregator, which every `session:stats` payload passes through.

### Verification (Revision 1)
Command:

```
npx nx run-many -t test,typecheck,lint -p @ptah-extension/chat-ui,@ptah-extension/chat-types,@ptah-extension/chat-state,@ptah-extension/chat,@ptah-extension/harness-builder --skip-nx-cache
```

Exit code 0: "Successfully ran targets test, typecheck, lint for 5 projects".

| Project | test | typecheck | lint |
| --- | --- | --- | --- |
| @ptah-extension/chat-state | 19 suites, 422 passed | pass | 0 errors, 2 warnings (unchanged) |
| @ptah-extension/chat-ui | 34 suites, 272 passed | pass | 0 errors, 8 warnings (unchanged) |
| @ptah-extension/chat | 96 suites, 1504 passed, 2 skipped | pass | 0 errors, 14 warnings (unchanged) |
| @ptah-extension/harness-builder | 5 suites, 120 passed | pass | 0 errors, 75 warnings (unchanged) |
| @ptah-extension/chat-types | no test target | pass | pass |

`tsc -p tsconfig.spec.json` for chat-state and chat shows no error on any line added in this revision. Only the pre-existing errors listed above remain, at shifted line numbers: for example `session-loader.service.spec.ts:1717` (Batch A's `liveModelStats` item) and `session-stats-aggregator.service.spec.ts:199` (`TabId`).

### Remaining open points
- **Cold-open race.** A floor is created only by a revisioned snapshot. If the live broadcast arrives before any tab for that session exists (the event is dropped as "no tab bound"), a later resume reply can still install history.
- **Legitimate history refresh.** An unrevisioned post-interrupt refresh is ignored once a live snapshot was accepted in this page lifetime. The live snapshot is the complete lifetime total (coordinator rule 1), and the next live result replaces it anyway.
