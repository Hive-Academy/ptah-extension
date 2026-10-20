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

## Re-review (round 2 + CodeRabbit)

Reviewer: Anthropic Claude (independent); implementer: codex. Read-only; no checks run. Reviewed the uncommitted diff plus `attention-context.util.ts`.

### Per-item status

A. Duplicate title: FIXED. `chat-attention-host-message-handler.service.ts:~187-196,211`: row title is the kind label, context is provider plus safe session title, falling back to `notice.title` with no context for an unknown kind. Residual: the default-title filter list (`:~192`) omits "Lane permission required", so a host title equal to that string would duplicate; add it. Minor.

B1. Unpartitioned owner resolves a real path: IMPLEMENTED, but it introduces a routing defect, see N1 (blocking). The path is taken only from a root whose `workspaceIdFromPath` equals the target id (`:~238-241`); the workspaceId is never used as a path and remote targets stay Unknown. The check that `validTab` matches by `claudeSessionId` OR `tab.id` (`:~229-231`) widens the old rule; a UUID collision is implausible, so minor.

B2. `/tmp`: FIXED. `attention-context.util.ts:1`, the `(?:^|\s)\/[^\s]+` alternative.

B3/B6. Cap at 80: FIXED, deterministic (pure function of stable inputs). `attention-context.util.ts:5-8` and both call sites. Weakness: the cap truncates the tail, so a title near 80 characters pushes `Tool: X` or the question out entirely, and the tool name is the most useful part for a permission. Minor; fix by budgeting the title to about 40 characters before joining.

B4. `typeof toolName` check: FIXED, `chat-attention-source.service.ts:144`.

B5. Shared filter: FIXED, with false positives.
- Any whitespace-preceded slash token is dropped, so "Use /compact", "run /clear" and a question "Should I use /init?" disappear (`util.ts:1`). Slash commands are normal in this product's titles. Minor, but it contradicts "normal titles must survive". Fix: require two or more segments or a known root (`/(?:tmp|etc|usr|var|home|Users|opt|root)\b`), or restrict single-segment to those roots.
- `1/2.5`-style tokens match the relative-file rule. Cosmetic.
- "CI/CD" and "and/or" are safe (no preceding whitespace before the slash, no extension).
- Secret prefixes AKIA, ghp_, xoxb- and sk- are covered. No negatives found for the stated cases.

B7. Focus outcome: PARTIAL, and the mapping is wrong for two of three causes. `notification-focus-coordinator.service.ts:48` now reports every `false` as `cap-reached`, but `false` also means workspace mismatch and the 5 s mount timeout (`app-state.service.ts:1317-1320`). Neither is a cap, so the old `missing` was the more accurate label for them, and `cap-reached` may drive a misleading "tile cap" message. Minor. Fix: keep `cap-reached` only when the canvas tile count is at the limit, otherwise `missing`. The already-tiled-at-cap deferral is a legitimate scope limit.

TestBed overload errors: NOT NEW. `useClass` in `overrideProvider` exists at `origin/main` in `chat-attention-source.service.spec.ts` (`:122,144` there, `:271,293` now, shifted by the added specs).

### New defects

N1. BLOCKING. `chat-attention-host-message-handler.service.ts:~238-241` together with `notification-focus-coordinator.service.ts:~38-58`. After B1, a host projection for an unpartitioned owner has `item.workspacePath` set to the real root (`:~211`) and `Open` is routable. `focusRouter.focus({workspacePath: '/root', tabId})` reaches `resolve()`, which compares `(byTab.workspacePath ?? '')` ('') with '/root', fails, and returns null. `run()` then calls `switchWorkspace('/root')`. With no active path, `TabWorkspacePartitionService.switchWorkspace` does not save the current tabs (`tab-workspace-partition.service.ts:~200-206`, `if (current)`), and `TabManagerService.switchWorkspace` then replaces `_tabs` with the stored or empty set (`tab-manager.service.ts:~849-857`). The unpartitioned tabs, including the target tab, disappear from view, and focus continues with `tabId: undefined` and cannot find them. The user clicks Open and loses their tab list. The previous rounds avoided this because the source item path stayed `''`.
Fix (either): (a) in `resolve()`, accept `byTab.workspacePath === null` when the global `tabId` matches regardless of `target.workspacePath` (tab ids are unique and the host handler has already verified ownership), so the null-path branch adopts through `requestCanvasTab` and never switches; or (b) have the host handler keep `presentationWorkspace` as `''` for a null-path owner and use the real root only for the label. Add a spec using a null-path owner with a real-root target asserting no `switchWorkspace` call.

N2. MINOR. `attention-context.util.ts:1` slash-command and single-segment false positives, see B5.

N3. MINOR. Spec coverage: the lane's host specs cover the title and context split and the root matching, but nothing exercises the N1 path (host target with root path plus null-path owner through the real coordinator).

### Score and verdict

Score: 6/10
Verdict: REVISE. Part A and the CodeRabbit regex, cap and typeof fixes are sound. B1 creates a regression in the Open flow (N1), which must be fixed before merge. B5 and B7 refinements are minor.

## Final review (bounded correction)

Reviewer: Anthropic Claude (independent); implementer: codex. Read-only; no checks run.

### Per-item status

1. N1 (unpartitioned Open): FIXED. `chat-attention-host-message-handler.service.ts:~197-198` sets the projection routing path to `''` when a validated owner has a null path, with the real root only in `labelPath`; `openProjected` (`:~285-290`) passes `''` for the same owner. The coordinator `resolve()` matches `(null ?? '') === ''`, takes the null-path branch (no `switchWorkspace`), and adopts via `requestCanvasTab(tab.id, null, ...)`; the canvas normalises null to `''` (`orchestra-canvas.component.ts:430-433`). Spec: dispatcher "routes an unpartitioned owner by tab id" and the coordinator null-path spec cover it.
2. Path filter: FIXED. `attention-context.util.ts:1`: `/compact` and `/clear` survive; `/tmp`-style well-known roots and multi-segment paths are rejected; "CI/CD" and "and/or" pass. Residual false positives: `/dev` or `/home` used as bare words and `/api/users`-style tokens are dropped (arguably path-like). Cosmetic.
3. Cap shortens the variable part first: FIXED for the main cases. `attention-context.util.ts:5-19`; the slice arithmetic yields exactly 80. Gap (minor): when the provider is empty, parts are `[title, 'Tool: X']`, so the index-1 branch truncates the tool before the title and drops `Tool: X` entirely once title plus tool exceeds 80. Fix: choose the truncation target by identity (the title entry) rather than by index, or pass labelled parts.
4. 'missing' on failed adoption: FIXED, `notification-focus-coordinator.service.ts:~48-50`, with the spec.
5. "Lane permission required" in the default-title filter: FIXED at `chat-attention-source.service.ts:~137` and the host handler.
6. Dispatcher gate: FIXED and correct. `chat-attention-action-dispatcher.service.ts:55` allows `''` only with a `tabId` and still refuses when both are missing; the spec covers both. VS Code: an unpartitioned `''` path previously refused Open outright, so this is not a regression. It now routes through the null-path branch, which in a panel without a mounted canvas waits the 5 s timeout and then reports "Target unavailable". Acceptable.
7. "Show in canvas" label: FIXED. Source (`chat-attention-source.service.ts:160`), host projection (`...handler.service.ts:213`) and failed-turn (`chat-failed-turn-attention.service.ts:44`) use it; surface-owned rows keep "Open"; the action id stays `open`, so `notification-center.store.ts:110` (`actionId.toLowerCase() === 'open'`) and the dispatcher keep working. No non-spec code keys on the label text.

### Defects

D1. MINOR (pre-existing hazard, now more reachable). `notification-focus-coordinator.service.ts:~39-41` calls `workspaceCoordinator.switchWorkspace('')` whenever `initial` is null, including `target.workspacePath === ''`. With a stale `tabId` (tab closed between render and click) and an active workspace, this switches to an empty `''` partition and hides the user's tabs. The notification-center store and snackbar already forwarded `''` before this change (`notification-center.store.ts:~130`), and the item 6 gate now also lets it through when `tabId` is set. Fix: `if (target.workspacePath && initial?.workspacePath !== null) await switchWorkspace(...)`, returning `missing` when `initial` is null and the path is empty.
D2. MINOR. Context cap target selection when the provider is empty (item 3).
D3. COSMETIC. Bare `/dev`, `/home` words in titles are treated as paths.

No blocking defects. The routing, label and filter changes match the stated intent, and the specs referenced (null-path coordinator branch, dispatcher gate, host and source context cases) assert the new behaviour and would fail against the previous code.

### Score and verdict

Score: 8/10
Verdict: APPROVED. D1 and D2 are small follow-ups, not merge blockers. Scoped chat and notification-center checks must still be run by the orchestrator.
