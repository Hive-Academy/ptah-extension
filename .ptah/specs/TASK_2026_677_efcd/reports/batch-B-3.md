# Batch B-3 report: inspector services, add-on token, git branch

- Task: TASK_2026_677_efcd, Wave 3, Task B-3.1
- Executor: Claude `frontend-developer` sub-agent
- Worktree: `D:\projects\ptah-extension\.claude-worktrees\clean-session-view` (branch `feat/clean-session-view`)
- Verdict: COMPLETE. No nx or jest run (decisions.md row 59). The team-leader runs the Scoped checks in MODE 2.

## Task B-3.1: completion and evidence

| Item | Status | Evidence |
| --- | --- | --- |
| B2 `SessionInspectorStore` (`modelFor(tabId): Signal<SessionInspectorModel>`, root) | done | `session-inspector.store.ts`. There is one cached `computed` per tab in a `Map`. `forget(tabId)` runs from `TabManagerService.onTabClosed`. The store has no timers. |
| `needsYouCount` = unique open request ids + `waiting` lanes with no open request | done | `requests.length + silentWaiting`. `requests` is deduped by id in `mergeInspectorRequests`. `silentWaiting` counts non-Orchestrator rows with status `waiting` and empty `openRequestIds`. |
| Orchestrator state (needs-you > waiting on N > working > idle) | done | `orchestratorState()`. "Busy" means `streaming` or `resuming`. N counts roster agents that are running, waiting or queued. |
| AGENTS order + `{active} / {finished}` meta | done | `orderAgentRows()`: requests or `waiting` first, then running/queued by newest `startedAt` (null last), then done/failed/stopped by latest `endedAt`. The sort is stable. `active` counts rows in the first two groups. `finished` counts done/failed/stopped. |
| `OrchestratorCardModel` model / context / tokens / cost / turns | done (B-4 does not render them, per delta 3) | `orchestratorCard()`. Unknown values stay `null` and are never `0`. Context comes from `liveModelStats` only when `contextKnown !== false`. Tokens = `sessionStats.tokenCount` or the sum of the four classes. Cost = `totalCost`, which can be `null`. `turns` uses the transcript's grouping rule (a run of user messages opens one turn) and is `null` when 0. It recomputes only when the `messages` array changes. |
| Request merge helper (pure) | done | `session-inspector-requests.ts` `mergeInspectorRequests`. Lane entries are inserted first, so a lane entry wins over a session entry with the same id. A request's owner is the roster agent whose `openRequestIds` holds the id, else `orchestrator`. Results are FIFO by `timestamp`, then `requestId`. A source with no id falls back to the typed `{source}:{ownerKey}:{kind}:{toolName}` key. `command` holds the full text: the shell `command` from `toolInput`, else the description, else the tool name. For questions it holds every question text. `questionPreview` is the first 60 characters. |
| `InspectorOpenStateService` (root) `dockedOpen / setDocked / forget` | done | `inspector-open-state.service.ts`. The choice is stored per tab as `{open, mode}` in memory. A choice whose mode differs from the current mode counts as absent. `forget` runs on `onTabClosed`. |
| B1 `InspectorShellController` (`@Injectable()`, provided per host) | done | `inspector-shell.controller.ts`: `attach`, `band`, `isOpen`, `isModal`, `showDot`, `toggleLabel`, `toggle()`, `closeInsp(target?)`, `onTabChanged()`. Additions are listed under Decisions. |
| `SESSION_WORKFLOW_ADDONS` token, `SessionWorkflowAddon`, `SessionAddonSlot`, `sessionWorkflowKind` | done | `tokens/session-workflow-addons.token.ts`. `sessionWorkflowKind` returns `null` on main (M-3, H1 hook-up). 677 registers no add-on. |
| Git `branch` in `known` + `sessionBranch(tab, gitState)` | done | `session-git-stats.store.ts`: the `SessionGitState` type, `branchOf()` in `toState`, `sameSessionGitState()` in `setState`, and `sessionBranch` = `tab.agentOrigin.branch`, else the known-state branch. |
| Spec update (`known` gains `branch`) | done | `session-git-stats.store.spec.ts`: four existing `known` `toEqual` assertions gain `branch: null`. A new case covers the branch value, a checkout-only change publishing a new state, and `sessionBranch` precedence. |
| Barrels (append-only, 2nd owner) | done | `services/index.ts`: `export * from './session-inspector'` and `sessionBranch` / `SessionGitState`. `chat/src/index.ts`: the token file exports. Earlier lines are untouched. |
| Webview `app.config.ts` provider change | done | `{ provide: MESSAGE_HANDLERS, useExisting: TasksChangedFeed, multi: true }` is added after `TaskSessionLinksService`, imported from `@ptah-extension/tasks-ui/presentation`. This is B §2's integration line, moved into B-3 (implementation-plan §3 "app.config.ts moves ... into B-3"). |

Acceptance: the B1/B2 contracts, the token, `sessionWorkflowKind` and `sessionBranch` can all be imported from `@ptah-extension/chat`. Through `export * from './lib/services'`, the barrel exposes `SessionInspectorStore`, `InspectorShellController`, `InspectorOpenStateService`, the types, `sessionBranch` and `SessionGitState`. The token exports are listed by name.

## Files (absolute)

- CREATED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\chat\src\lib\services\session-inspector\session-inspector.types.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\chat\src\lib\services\session-inspector\session-inspector-requests.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\chat\src\lib\services\session-inspector\session-inspector.store.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\chat\src\lib\services\session-inspector\inspector-open-state.service.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\chat\src\lib\services\session-inspector\inspector-shell.controller.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\chat\src\lib\services\session-inspector\index.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\chat\src\lib\tokens\session-workflow-addons.token.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\chat\src\lib\services\session-git-stats\session-git-stats.store.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\chat\src\lib\services\session-git-stats\session-git-stats.store.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\chat\src\lib\services\index.ts` (append-only)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\chat\src\index.ts` (append-only)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\apps\ptah-extension-webview\src\app\app.config.ts` (one import, one provider)

## Quality requirements and edge cases

| Requirement / risk | Handling |
| --- | --- |
| One `ResizeObserver` per controller, `disconnect()` on destroy | It is created lazily on the first `attach`. A re-attach calls `disconnect()` and then `observe(newShell)` on the same instance. `DestroyRef.onDestroy` disconnects it and nulls the shell and focus callbacks. The band is written only when it changes. A width of 0 (a hidden or detached retained shell) is ignored, so the last real band stays. With no `ResizeObserver`, the band falls back to `docked` (B §4 failure behaviour). |
| Store map pruned on tab close | `onTabClosed` calls `forget(tabId)`, and the listener is released on destroy. The open-state service prunes the same way. |
| `showDot()` null while open; `need` > `sel` | `showDot` returns `null` when `isOpen()`. It returns `need` when `needsYouCount > 0`, `sel` when `initialOpen === true`, and `null` otherwise. |
| `toggleLabel` never changes with the dot | It reads `isOpen()` only: `Show session details` / `Hide session details`. |
| A2 never starts git tracking | `sessionBranch` is pure and takes the state the caller already reads. It never calls `track()`. |
| Overlay: sheet closed on load | `sheetOpen` starts as `false`. |
| Overlay: sheet closed on tab switch | A constructor `effect` on the bound tab id calls `onTabChanged()` (a modal sheet goes through `closeInsp()`). Hosts can also call `onTabChanged()`; it is idempotent. |
| Overlay: sheet closed on resize into the band | Docked -> overlay sets `sheetOpen = false` and keeps the docked choice. Focus moves through the fallback chain only when it was lost (it was inside the removed docked aside). |
| Sheet never written to the per-tab docked choice | Overlay `toggle` and `closeInsp` only touch `sheetOpen`. |
| Resize overlay -> docked with the sheet open | Writes `setDocked(tabId, mode, true)`, clears `sheetOpen`, and leaves focus alone. |
| Unknown or null tab | `tab()` is `null`, so `isOpen` is false, `isModal` is false (no stuck `inert`), `showDot` is null, and `toggle` does nothing. `modelFor(unknownId)` returns `agents.status = 'unknown'`, zero counts, and no requests. |
| Empty `SESSION_WORKFLOW_ADDONS` / no kind / no match | `workflowAddonsFor(addons, kind, slot)` returns `[]` for a null registry or a null kind, so the host renders no outlet. |
| Focus: open | The opener is remembered. After the next render, the controller focuses `[data-inspector-close]` inside the shell. If the inspector mounts late (deferred chunk), `closeReady(button)` focuses the button while the open is still pending. |
| Focus: close fallback chain | Each step runs in `afterNextRender`, after `inert` is gone: the target, then the remembered opener, then the live opener (each only when connected and `offsetParent !== null`), then the title `h1` when connected. Focus never goes to `body`. |
| Esc / Tab wrap | `onSheetKeydown`: Esc closes to the opener unless `defaultPrevented`, so an open request panel's own handler goes first. Tab and Shift+Tab wrap over the visible, non-inert focusables inside the sheet. |

## Deviations

1. **Git `branch` lives in a chat-local subtype, not in `CompactGitState`.** `CompactGitState` is defined in chat-ui (`compact-session-metrics.ts:20`). That file is outside B-3's file list, and chat-ui belongs to D-1 in this wave. `SessionGitState` adds `branch` to the `known` variant and is a structural subtype, so every chat-ui consumer (`input<CompactGitState>`) accepts it unchanged. `sameSessionGitState` wraps `sameGitState` and also compares the branch, so a checkout with no line changes still publishes a new state.
2. **Pruning uses `onTabClosed`, not "a computed over the open tab ids" (B §3).** `TabManagerService.tabs` covers only the active workspace. A computed over it would drop the cached models of tabs in background workspaces. `onTabClosed` is the repository's pattern for this (`composer-draft.store.ts:27`, `transcript-retention.service.ts:106`), and it fires for every close.
3. **Batch plan line citations are stale.** `implementation-plan.md:86-100` and `:305-331` now sit at `:97-111`, `:195-209` (§3.2) and `:421-446` (§7.2). I worked from the content, not the line numbers.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Where the controller gets the tab: `bindTab(tabId: () => string \| null)`, which derives `{tabId, mode, initialOpen}` itself | host passes the full context; controller derives it | M-3 drops the `inspectorInitialOpen` input and resolves the kind through `sessionWorkflowKind(tab)`. Deriving it here means the H1 one-line hook-up enables initial-open in both hosts (§7.4). | yes |
| `initialOpen = sessionWorkflowKind(tab) !== null ? true : null`; `mode = tab.viewMode ?? 'full'` | — | B §4 rule 1, M-3, `chat-types.ts:782` (`viewMode` optional, `'full'` is the default) | yes |
| Close-button focus target: `data-inspector-close` attribute (`INSPECTOR_CLOSE_ATTR`) + `closeReady(el)` for late mounts | query by aria-label; a registration method only | The B1 `attach` signature has no close-button parameter, and the inspector body is deferred (B §5), so both paths are needed. **B-4 must put `data-inspector-close` on `Close session details` and call `closeReady` once it renders.** | yes |
| Focus moves to the close button only when the sheet opens (modal), not on a docked open | always move focus | Docked = disclosure toggle (`aria-pressed`). §8.3 focus paths cover the sheet. | yes |
| `mainInert` signal (= `isModal`) for the host's `[inert]` binding; `onSheetKeydown(event)` for the sheet's keydown | — | B §4 "sets inert ... through a signal the host binds"; "Tab wrap is a keydown handler on the sheet" | yes |
| `workflowAddonsFor(addons, kind, slot)` helper beside the token | each host filters inline | §7.2: the same lookup in three places (inspector, chat-view header chip/action, Rail) | yes |
| `TaskSectionData` / `TodosSectionData` / `GitSectionData` defined now (type-only) | leave to B-4 | B §3 lists them in `session-inspector.types.ts`. They are type-only imports (`@ptah-extension/shared`, `@ptah-extension/tasks-ui/presentation`), so they add no bundle cost. | yes |
| `turns` = user-run count with the transcript's grouping rule, `null` when 0 | `null` always; `messageCount` | D-O4 shows the caption only when the value is non-null. `sessionStats.messageCount` counts assistant messages, not turns. | yes |
| A branch name is kept as the backend reports it (`HEAD` when detached); empty or missing becomes `null` | map `HEAD` to null | `rpc-git.types.ts:97-99`. Push payloads can omit `branch`, so `branchOf` validates the shape. | yes |

## Verification

- No nx or jest command was run (decisions.md row 59, parallel wave).
- `ptah_get_diagnostics` scoped to the 12 changed files (typescript-compiler, coverage clean): **0 errors in any B-3 source file** (types, requests, store, open-state, controller, index, token, git store, both barrels, `app.config.ts`).
- The diagnostics did report two errors in `session-git-stats.store.spec.ts`, at lines 91 and 98. Both are on unchanged lines (the existing `sessionWorkingRoot` `{ agentOrigin: null } as ...` casts). The editor-side checker flags the same TS2352 cast class in many other untouched specs (for example `agent-card-truncation.spec.ts:137` and `send-message-chip.component.spec.ts:6`), so these are tsconfig-of-the-checker artefacts, not B-3 regressions. The new spec case added no diagnostic.
- Still to run in team-leader MODE 2 (the batch's Scoped checks): `b3-test`, `b3-typecheck`, `b3-lint` for `@ptah-extension/chat` and `ptah-extension-webview`.

## Out-of-scope observations

- `libs/frontend/chat/src/lib/components/molecules/session-header/` (A2-1) is untracked in the same worktree. I did not touch it.
- B-4 and CV-1 must provide `InspectorShellController` in their host `providers`, call `bindTab(...)` and `attach(...)`, bind `[inert]="ctrl.mainInert()"` on the main column, and bind `(keydown)="ctrl.onSheetKeydown($event)"` on the sheet.
