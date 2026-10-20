# Code Logic Review: attention context label fix

Review family: reviewer Anthropic Claude (independent); implementer codex.
Score: 6/10
Verdict: REVISE

Scope: full diff of 7 files in the worktree, plus `tab-workspace-partition.service.ts`, `tab-manager.service.ts` facade, `notification-focus-coordinator.service.ts`, `vscode.service.ts`. No tests, typecheck or lint were run (read-only, as instructed).

## Root cause assessment (question 1)

- The TabManager facade does pass the live signal: `findTabByIdAcrossWorkspaces` passes `this._tabs()` (`tab-manager.service.ts:709-713`) and the session variant likewise (`:677-684`). So the "partition map copy lags the signal" hypothesis is NOT the cause. With an active workspace the tab is found and `workspacePath` is the active path.
- The only way the old code showed "Unknown workspace" with an owner found is `activePath === null` (`tab-workspace-partition.service.ts:325-349`, `workspacePath: activePath`). The lane's claim is therefore coherent but UNPROVEN for Electron: no evidence in the report or diff shows Electron leaves `_activeWorkspacePath` null at the time requests arrive. The other possible cause is owner === null (tab not found), which the fix does not repair, it only relabels (see defect 1).
- The missing session title was certainly real: `context` was never set before this change. That part is fixed.
- Gap: `findTabBySessionIdAcrossWorkspaces` returns null when `activePath` is null, because the active tab set is only searched inside `if (activePath)` (`tab-workspace-partition.service.ts:284-292`). In exactly the null-active-path case the lane blames, a request that has only a `sessionId` (lane permissions via `findTabId(undefined, parentSessionId, [])`, source.service.ts:76, 108-112) still gets owner null: no title, no provider, Open and Allow disabled. The new spec mock hides this: its session lookup returns an owner with `workspacePath: null` (spec :50), which the real service never does.

## Defects

1. BLOCKING (misleading label, masks rather than fixes). `chat-attention-host-message-handler.service.ts:179`, `chat-attention-source.service.ts:121`. When the target is non-local (host: `localWorkspace()` returned null, i.e. a different or unknown workspace/host) or the owner is not found, the label now shows the LOCAL active workspace or startup root. A remote or other-workspace request is displayed as belonging to the current workspace, which is a wrong answer where "Unknown workspace" was an honest one. The routing identity (`attention:<id>`) stays opaque, so the label and the identity now disagree. Fix: use the active/startup fallback only when an owner was actually found and its `workspacePath` is null (the unpartitioned-tab case). When owner is null (source) or the target is not local (host), keep `Unknown workspace`. Add a spec for owner-null and non-local-target asserting `Unknown workspace`. The existing spec "uses the active workspace when the request has no local owner" (source.spec ~:130) and the host spec asserting active workspace for a remote projection encode the wrong behaviour and must be changed.

2. BLOCKING (root cause not demonstrated). Same sites. No test or evidence shows Electron has a null active workspace path in the reported scenario. Fix: either add a regression spec using the real `TabWorkspacePartitionService` (not a mock) with no active path, a tab in the active set and a tabId request, or document the actual Electron sequence (where `_activeWorkspacePath` stays null: `tab-workspace-partition.service.ts:207`, `:476`). Also make `findTabBySessionIdAcrossWorkspaces` search `activeTabs` when `activePath` is null, matching its by-id sibling, so lane permissions get an owner.

3. MINOR/MODERATE (Open routing with fallback path). `notification-focus-coordinator.service.ts:54-58` requires `owner.workspacePath === target.workspacePath`. When the owner path is null and `item.workspacePath` is now the startup root, `resolve()` returns null, so focus runs with `tabId: undefined` and relies on `claudeSessionId` or `tab.id` as `sessionId`. Open enabled by `!!owner` may then focus the wrong target or fail for a never-started tab. Fix: pass `tabId` through when the lookup finds the tab irrespective of path, or verify with a spec.

4. MINOR (unsafe-title filter hides normal titles). `source.service.ts:134, 143` and `host...service.ts:187`: `/[\\/]|\b(?:...token|secret...)\b/i` drops titles such as "CI/CD pipeline", "and/or", "Fix token refresh", "Rotate secret" and questions containing a slash. Titles are user session names rendered via interpolation, so this is a privacy heuristic losing real data. Fix: test only for path-like shapes (`/[A-Za-z]:\\|(^|\s)\/[\w.-]+\/|\\\\/`) and key-like shapes (`\bsk-[\w-]{8,}`), or drop the word-based filter.

5. MINOR (stale label). `VSCodeService.config()` is read inside `untracked(reconcile)` (source.service.ts:50), so a later `updateWorkspaceRoot` does not trigger reconcile; the host handler labels only once at message time. Fix: read `this.vscode.config()` in the tracked effect body, as was done for `activeWorkspacePath$`.

6. MINOR (spec fidelity). Source spec mocks (`chat-attention-source.service.spec.ts:44-52`) diverge from the real partition contract for session lookups with a null active path (see root cause gap). Tests would pass whilst the real service returns null.

## Checks answered

- Context line (Q2): provider, title (skipped for default origin and generic names), `Tool: X` (regex `^[\w .:-]{1,50}$`, no tool input), question collapsed and truncated to 80 (79 plus ellipsis). Deterministic: built from stable tab/request fields, so the `JSON.stringify` diff in `reconcile()` will not churn. Rendered by interpolation, no innerHTML, no full paths. Aside from defect 4, OK.
- `window.ptahConfig` (Q3): not read directly; it goes through `VSCodeService.config()`, whose default `workspaceRoot` is `''` (`vscode.service.ts:84`), so it fails safe in VS Code (where it is the real root) and in tests with `?? ''`. Acceptable for the host-neutral lib, but see defect 1 for when it is used.
- Host projection (Q4): provider is gated on `workspacePath` (local), routing identity (`presentationWorkspace`) unchanged, but the label rule changed (defect 1).
- Snackbar (Q5): `item.context ? context + ' · ' + workspaceName : workspaceName` on the existing `text-base-content-muted` class; no banned `text-base-content/NN` classes. The `<private>` test proves text rendering. OK.
- Specs (Q6): context/tool/question/truncation/lane cases and snackbar join would fail without the fix. The fallback-label specs would pass the wrong behaviour (defect 1), and none exercises the real partition service (defect 2).

## Edge cases

| Case | Handled | Concern |
| --- | --- | --- |
| Active workspace set, owner found | YES | label from owner path, title shown |
| Active path null, tab by id | YES | label from startup root, Open path see defect 3 |
| Active path null, session id only | NO | owner null, title missing (defect 2) |
| Owner null, other workspace | WRONG | labelled with active workspace (defect 1) |
| Slash or "token" in title | NO | title dropped (defect 4) |

## Verdict

REVISE. Context line, snackbar and reactivity are sound. The workspace fallback must be restricted to the found-owner, null-path case, the root cause needs a real-service regression test, and the session-id lookup gap with a null active path should be closed.

## Re-review (round 1)

Reviewer: Anthropic Claude (independent); implementer: codex. Read-only; no checks run.

### Per-defect status

1. Misleading workspace label: FIXED. `chat-attention-source.service.ts:119-125` keeps `workspacePath ''` and an `Unknown workspace` label when the owner is null. The active/startup fallback applies only when an owner was found with a null path. `chat-attention-host-message-handler.service.ts:178-179` now uses `labelPath = workspacePath ?? ''`, so non-local targets stay unknown. Routing identity is unchanged.
2. Root cause and session lookup: PARTIALLY FIXED, acceptable. `tab-workspace-partition.service.ts:~287-293` now searches `activeTabs` when `activePath` is null and returns `workspacePath: null`, mirroring the by-id lookup. It writes the reverse index only when `activePath` is set (checked), so no `''` or null entries are indexed. A stale index entry cannot shadow the null-path hit: an index hit for another path resolves from that partition, and a miss deletes the entry and falls through. The real-service spec (`tab-workspace-partition.service.spec.ts:66`) covers both lookups. The report honestly states that the Electron timing is proven only as a startup null-path window (`electron-layout.service.ts` restore, then `workspace:switch`), not as the reporter's exact scenario. Residual uncertainty, not blocking. Callers: facade passes `_tabs()`; a null-path hit is now returned where null was before, and each caller reads `.tab` or normalises null, consistent with the by-id sibling. I found no regression.
3. Open routing: FIXED. `notification-focus-coordinator.service.ts:~38-58`: `resolve()` compares `(workspacePath ?? '')` with the item path `''`, so a null-path owner matches. `run()` skips `switchWorkspace` only when `initial.workspacePath === null` (an unresolved `initial` is `undefined`, so it still switches), then adopts through `requestCanvasTab(tab.id, null, ...)`. The canvas normalises `null` to `''` against `activeWorkspacePath() ?? ''` (`orchestra-canvas.component.ts:430-433`), so it is not dropped as a mismatch. The tab id is passed, with no reliance on `claudeSessionId`.
4. Unsafe-title filter: FIXED. Both sites use path-shape, `sk-` and long hex/base64 patterns (`source.service.ts:~139`, `host...service.ts:~187`); "CI/CD" and "token refresh" now pass. Residual: the base64 class `[A-Za-z0-9+/_-]{40,}` can drop a 40+ character hyphenated slug title. Cosmetic, minor.
5. Late renderer root: FIXED. `config()` is read in the tracked effect (`source.service.ts:51`).
6. Spec fidelity: FIXED. The source spec mock now requires the tab in the active set for null-path session lookups, and the real partition service has its own spec.

### New defects

N1. MINOR. `notification-focus-coordinator.service.ts:~47-49`: the null-path branch maps a `false` result of `requestCanvasTab` (tile cap, mismatch or the 5 s timeout) to `outcome: 'missing'`. The router contract has `cap-reached` (`notification-focus-router.token.ts:7`), and the normal branch returns it via `requestCanvasFocus`. The panel still stays open because `success` is false, but the user-facing message may say "missing" for a cap refusal. Fix: map the failure to `cap-reached` when the tiles are at the cap, or document `missing` as intentional.
N2. MINOR. `requestCanvasTab` queues until the canvas mounts; if the canvas is not mounted the user waits up to 5 s with no feedback after `setCurrentView('chat')`. Acceptable; no change required.

### Score and verdict

Score: 8/10
Verdict: APPROVED. All six defects are fixed or acceptably mitigated. N1 and N2 are minor and non-blocking. Residual: the exact Electron reproduction timing is still unproven by the evidence. The orchestrator still has to run the scoped chat-state, chat and notification-center checks.
