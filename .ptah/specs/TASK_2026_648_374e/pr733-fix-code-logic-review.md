# Code Logic Review — `TASK_2026_648_374e` / PR #733 fix `c638c21fa`

Verdict: APPROVED
Score: 8/10
Review family: grok (implementer codex)

Findings: None

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 |

Score is 8, not 9: the reachable paths match the contracts below, but the rewind spec never makes `findTabByIdAcrossWorkspaces` return a workspace, and this review did not re-run the webview budget build. Score is not 7: no changed path returns a success-looking wrong workspace, a stuck guard, or a filter bar on the non-organization branch.

`ptah_code_search_symbols` / `ptah_get_diagnostics` are not on this client (`search_tool` returned no ptah server). Evidence is `git show c638c21fa` plus the current files those hunks land in. No test or build was re-run here. The implementer's report claims the chat suite and one webview build passed; that log was not in the commit.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Sidebar forget key is the active workspace at click, not a field on the row | Read a row workspace; snapshot `activeWorkspacePath` | `ChatSessionSummary` (`libs/shared/src/lib/types/execution/node.ts:229-264`) has no workspace. The same shell already asks `workflowForSession(id, activeWorkspacePath)` (`app-shell.organization.spec.ts:318`). | Yes |
| Rewind lookup is equivalent to snapshotting the active path for every session id this view can resolve | Require a background-tab workspace; treat the lookup as redundant but correct | Tile `resolvedSessionId` only reads `tabs()` (`chat-view.component.ts:804-812`), the active set. A background-only tab never reaches `attemptRewindV2`. | Yes |
| Null `SESSION_CARD_ACTIONS` frozen at first injection is the requested contract | Live-null the token; always wrap | Task text and `session-embed.component.ts:101-110`. Canvas passes a stable object before children inject (`canvas-detail-transcript.component.ts:62-71`). | Yes |

## Five logic questions

### 1. How does this fail silently?

It does not, on the changed lines. Sidebar delete still forgets only after `result.isSuccess() && result.data?.success` (`app-shell.component.ts:960-961`). A confirm cancel returns at `953-955` with no forget. Rewind still forgets only after `deleteSession` `isSuccess()` (`chat-view.component.ts:1934-1942`); a failed delete returns `deletedOk: false` and does not clear the index. `WorkflowSessionIndexService.forget` no-ops on an empty path (`workflow-session-index.service.ts:23-31` and `:77-79`), which is the same `?? ''` fallback as before when both the lookup and `activeWorkspacePath` are missing (`chat-view.component.ts:1683-1688`).

### 2. What user action produces unexpected behaviour?

Switching workspace during the sidebar confirm, or during rewind's tab close, no longer points `forgetWorkflowSession` at the workspace that became active mid-await.

- Sidebar: `deletedWorkspacePath` is read before `confirm()` (`app-shell.component.ts:944-945`) and passed at `:961`. The row's list is the active workspace's list. Spec `app-shell.organization.spec.ts:345-374` swaps `activeWorkspacePath` to `/other` while the confirm promise is pending and expects `('tagged', '/work')`.
- Rewind: `originWorkspacePath` is taken before `rewindFiles` (`chat-view.component.ts:1682-1688`) and passed through `deleteOriginalSession` (`:1858-1860`, `:1942`). `findTabBySessionId` (`tab-manager.service.ts:567-577`) prefers the active set, then `findTabByIdAcrossWorkspaces` (`tab-workspace-partition.service.ts:325-338`) returns that tab's `workspacePath`. For a session this view can actually rewind, that path is the active path at capture time (see Decisions). `??` then `activeWorkspacePath` covers a null lookup (`workspacePath: null` when no workspace is active, same file `:322-323`).

`switchWorkspace` re-remembers only the tabs that became active (`tab-manager.service.ts:823-825`). The session being deleted stays under the workspace it already had. Forgetting the snapshotted path removes that key.

Pre-existing, not introduced, and not a fail of this commit: `closeTab` returns immediately when the id is no longer in the active `_tabs()` list (`tab-manager.service.ts:1341-1343` and `:1372-1374`). A workspace switch during the confirm parks the tab in the background partition, so the later `closeTab` in `app-shell.component.ts:969-972` does not close it. The badge key is still the one this commit fixed.

### 3. What input data produces a wrong answer?

No new wrong answer.

- Empty or null workspace becomes `''`, and the index rejects it (`isValidKey` requires `length > 0`). Same as the old `activeWorkspacePath ?? ''` after the await.
- `ChatSessionSummary` cannot name a different workspace than the list the user is looking at, so the sidebar snapshot is not "the wrong row's workspace".
- `SESSION_START_GUARD` is now always a function (`session-embed.component.ts:83-85`). Callers do not test the token for truthiness. They call it and test the reason: `chat-view.component.ts:1495-1498`, `:1518-1521`, `:1537-1540`, and `chat-input.component.ts:1483-1484`. A null input guard makes the wrapper return `null` (`?.() ?? null`), and `if (reason)` / `if (blockReason)` stays false. Canvas reads `guard()` and expects the store string (`canvas-detail-transcript.component.spec.ts:529-533`). The canvas guard is `() => this.canvasStore.startBlockReason(this.tabId())` (`canvas-detail-transcript.component.ts:61`), so each call still sees the current tab and store. `?? null` does not rewrite a non-null string.
- `SESSION_CARD_ACTIONS` stays `null` when `cardActions()` is null at first injection, and otherwise forwards to the current input (`session-embed.component.ts:101-110`). Compact cards treat a null token as "no host actions" (`compact-session-card.component.ts:547-552`). The transcript's `skipSelf` provider (`chat-transcript.component.ts:244-248`) still falls through to `singleChatCardActions()` when the parent token is null, and uses the wrapper when the parent provided actions. Canvas always passes an object (`canvas-detail-transcript.component.ts:28` and `:62-71`), and those methods are arrows, so the wrapper's method call keeps the component `this`.
- `RAIL_TRANSCRIPT_RETENTION` is still one `useFactory` boolean (`session-embed.component.ts:88-91`). `ChatView` reads it once (`chat-view.component.ts:849-850`). Canvas binds `true` for the life of the embed (`canvas-detail-transcript.component.ts:29`).

### 4. What happens when a dependency fails?

Unchanged, and still visible. Sidebar: failed or thrown `deleteSession` logs and does not forget (`app-shell.component.ts:973-980`). Rewind: RPC failure sets `deletedOk: false` and a suffix the caller shows (`chat-view.component.ts:1865-1868`, `:1944-1949`). The filter bar's `queryChange` still calls `onListQueryChange` → `chatStore.setListQuery` (`app-shell.component.ts:806-808`) once the deferred view exists. A chunk that never arrives leaves the organization search unmounted; the date-range row under it is outside the defer block (`app-shell.component.html:165-170`) and the `@else` local search is not shown while `organizationAvailable()` is true (`:125-134`). That gap is the defer itself, not a wrong query written to the store.

### 5. What is missing that the requirements never mentioned?

- Nothing in `apps/ptah-electron-e2e` or the webview e2e specs selects `ptah-session-filter-bar` (search of `*e2e*` was empty). `AppShell` has no `viewChild` on that bar (`app-shell.component.ts` viewChild uses are the search input, edit input, resize handle, and shell row).
- Jest's default defer behavior is `DeferBlockBehavior.Playthrough` (`node_modules/@angular/core/fesm2022/testing.mjs:135`). Organization specs already `settle()` via `whenStable` before expecting the bar (`app-shell.organization.spec.ts:269-274` and `:504-520`). The non-organization example still expects the bar to be absent and `[data-testid="session-search-local"]` present (`:376-389`).
- `SessionFilterBarComponent` stays in `AppShell.imports` (`app-shell.component.ts:40` and `:153`). That is the same pattern as `SessionOrganizationEditorComponent` (`:156`), which this template already defers (`app-shell.component.html:19-25`) specifically to leave the initial bundle. The only production template reference of the filter bar is the new defer block (`:128-132`). No second production importer showed up in the repo search. This review did not rebuild `ptah-extension-webview`, so the 3.50 MiB claim stays the implementer's.
- The rewind spec (`chat-view.component.spec.ts:944-965`) changes `activeWorkspacePath` during `closeTab` and expects `'/ws'`. `findTabByIdAcrossWorkspaces` is `jest.fn()` with no return (`:276`), so the assertion passes on the `activeWorkspacePath` fallback taken before `closeTab`. It does not prove a background `workspacePath`. That branch is also unreachable for a rewind this view can start (question 2). Not a product defect.

## Failure modes

None introduced by `c638c21fa`.

Scope: the seven source/spec files in the commit, plus the callees they depend on (`forget` / `rememberTab` / `findTabBySessionId` / `findTabByIdAcrossWorkspaces` / `closeTab` / `resolvedSessionId`, both guard call sites, canvas `ptah-session-embed` bindings, compact-card and transcript `SESSION_CARD_ACTIONS` consumption). Residual: orphan background tab after a mid-dialog workspace switch (`closeTab` active-list check) is pre-existing; the bundle graph was not rebuilt here.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Defer only the organization filter bar; keep bindings; do not flash the non-organization branch | COMPLETE | Non-organization `@else` is unchanged (`app-shell.component.html:134-162`). Org branch has the normal `@defer (on immediate)` gap until the chunk loads. |
| No other eager template use, ViewChild, or e2e first-paint wait | COMPLETE | Cited above. `imports[]` matches the editor defer already in this file. |
| Snapshot workspace before sidebar and rewind delete awaits | COMPLETE | `:944` and `:1682-1688`. |
| Specs exercise a switch during the await | PARTIAL | Sidebar spec does. Rewind spec covers the active-path fallback only. |
| Start guard always a function; reasons still gate send/resume | COMPLETE | Call sites test the return string, not token truthiness. Canvas `guard()` still returns the store reason. |
| Card actions follow the input, stay null if null at creation | COMPLETE | `session-embed.component.ts:101-110` and spec `:117-127`. |
| Rail retention stays creation-time | COMPLETE | Factory plus `chat-view.component.ts:849-850`. |

Implicit requirements not addressed: none beyond the pre-existing `closeTab` active-list limitation.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Confirm cancelled | YES | Return before delete (`app-shell.component.ts:953`) | None |
| Workspace flips during confirm / closeTab | YES | Snapshot taken before the await | Background tab is not closed (pre-existing) |
| Delete RPC failure | YES | No forget | None |
| Null / empty workspace | YES | `?? ''`, index no-ops | Same as before |
| Guard input null, then set, then replaced | YES | Wrapper reads the signal each call (`session-embed.component.spec.ts:134-143`) | None |
| Card actions null at first inject, later set | YES | Token stays null, as specified | Hosts that bind actions on the first template pass (canvas) are unaffected |
| Card actions replaced after inject | YES | Wrapper calls the current input (`session-embed.component.spec.ts:121-127`) | None |
| `organizationAvailable()` false | YES | `@else` local search, defer block not created | None |

## Data flow

1. Filter bar: `organizationAvailable()` true → `@defer (on immediate; prefetch on idle)` → `[query]="listQuery()"` / `(queryChange)="onListQueryChange"` → `setListQuery`. OK. False branch never mounts the bar. OK.
2. Sidebar delete: click → read `activeWorkspacePath` → confirm → `deleteSession` → on success `forgetWorkflowSession(id, snapshot)` → drop the row. OK. `closeTab` afterwards still sees only the active list.
3. Rewind delete-original: `resolvedSessionId` → capture tab workspace (active path for any id this view can resolve) → dry run → confirm → fork → `deleteOriginalSession(id, snapshot)` → close active tabs → `deleteSession` → `forgetWorkflowSession`. OK.
4. Embed guard: consumer `guard()` → `startGuard()?.()` → `string \| null`. OK.
5. Embed card actions: first inject snapshots null vs wrapper; wrapper calls the live input. OK.
6. Rail flag: first inject boolean, `ChatView` stores it. OK.

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM
- Top risk: a workspace switch during confirm still leaves the parked tab open, because `closeTab` ignores ids missing from the active list. This commit does clear the workflow badge for the workspace the row belonged to.
- What a robust implementation would add: a rewind spec whose `findTabByIdAcrossWorkspaces` returns a non-active `workspacePath` only if a caller can rewind that tab; a `closeTab` that removes a partitioned tab when delete already succeeded. Neither is a defect in the hunks under review.
