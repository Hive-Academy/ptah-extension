# Frontend fix report — TASK_2026_626_7b3e (one fix round)

Inputs: `code-logic-review-frontend.md` (NEEDS_FIXES, finding 1) and `code-style-review-frontend.md` (#1, #2, #4 and #7, added to this round by the coordinator). Nothing under `libs/backend/**` was touched. No git commands that change state were run. Heavy checks were not run, as instructed.

## Findings → changes

### Logic review, finding 1: live updates reached only one background tab (fixed)

- **Root cause.** `tabsForSession` returned the active-workspace tabs. Only when there were none did it wrap the singular `findTabBySessionIdAcrossWorkspaces`, which stops at the first match (`tab-workspace-partition.service.ts:294-300`). As a result:
  - A second background tab on the same session got no update.
  - A background tab got no update when an active tab existed for the same session.
- **Fix, aggregator.** `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts:255-265`. `tabsForSession` now returns the union of:
  - the active tabs (`findTabsBySessionId`), and
  - every background tab (`findBackgroundTabsBySessionId`).

  The union is deduplicated by id, because the active lookup's unbound fallback can itself return a background tab.
- **Fix, chat-state lookup.** `libs/frontend/chat-state/src/lib/tab-manager.service.ts:612-620`. Adds `findBackgroundTabsBySessionId(sessionId)`, the plural of the cross-workspace lookup. It reuses the existing `TabWorkspacePartitionService.findBackgroundTabIds(predicate)`, so the partition service is unchanged.
- **Install path.** The live handler (`session-stats-aggregator.service.ts:223-240`) calls `installSessionStats(t.id, snapshot, undefined, event.context)` once per tab. Each call runs its own `acceptSessionStats` admission, and each write goes through the workspace-aware `updateTabInternal`.
- **Authoritative path.** `handleSessionStats` had the same single-tab limitation, because it uses the same helper (`:129`). The review asked for it to be fixed with the same change, and it now is. Compaction clearing, `installSessionStats` and `setLiveModelStats` reach every bound tab in any workspace. `streamingHandler.handleSessionStats` is still called once per event; it has its own routing, which was not changed here.
- **Specs that reproduce the finding.** In `session-stats-aggregator.service.spec.ts`:
  - `:324` (mocked manager suite): one active tab plus two background tabs, one of them also returned by the active fallback. Each tab gets `installSessionStats` and `clearCompactionState` exactly once, and the streaming handler is called once.
  - `:1480-1572`, describe `the same session in several tabs across workspaces (review finding 1)`, which uses the real `TabManagerService` and partition:
    - `:1491`: two tabs in `/ws/live` and one in `/ws/other`, all background after switching to `/ws/third`. All three receive the provisional r5, then the settle r6, and none keeps the estimate marker.
    - `:1524`: an active tab plus a background tab on the same session. Both receive the estimate and the settle. The old code missed the background tab.
    - `:1542`: per-tab admission. After r6 is installed, a provisional r5 reaches neither tab.
    - `:1555`: `session:stats` r6 after a provisional r5 settles all three cross-workspace tabs.
  - The old single-tab test (spied `findTabBySessionIdAcrossWorkspaces`) was replaced. The test "prefers the active-workspace tabs and never consults the partition" asserted the bug, so it became `:324`.

### Style review #1 (Serious): growth of `tab-manager.service.ts` (fixed)

- New pure module `libs/frontend/chat-state/src/lib/live-context-stats.ts`:
  - `contextFillStats(prior, tokens)` (`:17`) is the former private `postCompactionContextStats`, moved without changes.
  - `liveContextStats(prior, context)` (`:60`) is the former private `liveContextStats`, with the tab lookup removed.
- `tab-manager.service.ts` now calls these functions (`:2128`, `:2150`, `:2245`). Both private helpers were deleted.
- The file is now 2976 lines, down from 3038 at HEAD and below the 2982-line base before this task.
- `deriveLiveModelStats` lives in `chat`, and `chat-state` must not import from `chat`, so the helpers stay in `chat-state`.
- New spec `live-context-stats.spec.ts` covers fill and capacity reuse, non-positive and non-finite tokens, an untrusted capacity, `normalizeModelKey` matching and a model mismatch.

### Style review #2 (Moderate): duplicate install methods (fixed)

- `installSessionStats(tabId, snapshot, budget?, context?)` is now the only install path and returns the admission result as a boolean (`tab-manager.service.ts:2216-2259`).
- `installLiveSessionStats` was removed. Its only caller was the aggregator, and the earlier grep found no other references.
- The context is applied only when `snapshot.provisional === true`, and in the same update as the snapshot. Existing callers pass three arguments and see the same behaviour; the return type changed from `void` to `boolean`, which they ignore.
- `tab-manager.service.spec.ts`: the `installLiveSessionStats` describe was renamed `installSessionStats with a live context (TASK_2026_626)`. Its calls now go through `installSessionStats(tabId, snap, undefined, ctx)`, and the assertions are unchanged. The file was also reformatted with prettier.

### Style review #4 (Moderate): inline context shape (fixed)

- `installSessionStats` and `liveContextStats` now use the shared `SessionStatsLiveContext` type (exported from `@ptah-extension/shared` via `types/messages/index.ts:8`) instead of the inline `{ model; contextTokens }`.

### Style review #7 (Minor): sr-only text (fixed)

- In `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.html`, all 5 occurrences are now `<span class="sr-only">estimated </span>`.
- The expectation in `session-stats-summary.component.spec.ts:491-492` was updated to `'estimated '`.

## Files changed

- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts`
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.spec.ts`
- MODIFIED `libs/frontend/chat-state/src/lib/tab-manager.service.ts`
- MODIFIED `libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts`
- CREATED `libs/frontend/chat-state/src/lib/live-context-stats.ts`
- CREATED `libs/frontend/chat-state/src/lib/live-context-stats.spec.ts`
- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.html`
- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.spec.ts`

## Deferred, and why

- **Style #3** (estimate marker markup repeated in the template), **#5** (`snapshotFor` handler-name parameter) and **#6** (double warning, raw id in a log): deferred on the coordinator's instruction and recorded for later. None of them can lose data.
- **Out of scope, not checked:** `StreamingHandlerService.handleSessionStats` (chat-streaming) routes the footer and `pendingStats` itself. Whether it fans out to several background tabs was not checked or changed. It is not part of the finding, and it is called once per event as before.
- **Cost note:** the background lookup now runs on every stats event, including when active tabs exist. It is O(workspaces × tabs) and runs on throttled events, with no timer or observer added.

## Verification

- `ptah_get_diagnostics`, scoped to the six changed TypeScript files: no errors in `tab-manager.service.ts`, `live-context-stats.ts`, `live-context-stats.spec.ts`, `tab-manager.service.spec.ts` or `session-stats-aggregator.service.ts`.
- `session-stats-aggregator.service.spec.ts` reports branded-type errors (`string` used as `TabId`) at `:290` (an existing line) and at `:324-325` (the new test). These follow the spec's existing `makeTab({ id: 'bg-tab' })` pattern. Sibling specs report the same class of error before this change, and Jest compiles these specs without them blocking.
- `npx prettier --write` was run on the changed TypeScript files except `tab-manager.service.ts`, which was left alone to avoid unrelated reformatting.
- Jest, Nx and builds were **not run**, as instructed; the team-leader runs them. Suggested scoped runs:
  - `npx nx test chat-state --parallel=1`
  - `npx nx test chat --parallel=1`
  - `npx nx test chat-ui --parallel=1`
