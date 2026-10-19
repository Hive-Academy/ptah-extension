# Batch 2 report - TASK_2026_705_9d53

Executor: frontend-developer (subagent). Worktree: `D:/projects/ptah-extension/.claude-worktrees/remove-single-layout`
(branch `refactor/remove-single-layout`, on top of Batch 1 `56451fc0b`). No git commands run, no checks run
(per the orchestrator's instruction). `ptah_get_diagnostics` was tried twice on the six changed TS files.
Both times it returned "TypeScript check still running after 45s", so it gives no evidence either way.
The orchestrator's scoped check is the gate:
`npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat @ptah-extension/canvas --parallel=1 -- --maxWorkers=2 2>&1 | tail -60`.

## Task 2.1 - chat-view drops layout reads, the inspector host and the session header - DONE

Evidence (source, after the edit):

- `mainPanelShowing` is now `computed(() => this._sessionVisible?.() ?? true)` (chat-view.component.ts:820).
  Its doc comment was rewritten (812-814).
- `resolvedQuestionRequests` no longer has `isMainPanel` / `tilesPresent` or the early `return []`
  (hunk at old 1322-1326).
- `onBranchRequested`: when the fork succeeds, it calls only `requestCanvasSession(newSessionId, 'Branch')` and then `showActionInfo('Branch created.')`
  (1464-1465). The failure path `showActionError('Branch failed: ...')` is unchanged. The doc comment now
  names `AppStateManager.requestCanvasSession()` (1440-1441).
- Removed: `hostsInspector`, `bareChrome` (its only readers were `hostsInspector` and the shell wiring),
  the `InspectorShellController` inject and provider, `wireInspectorShell` and its constructor call,
  the `inspectorShell` view query, `headerBranch`, `inspectorDot`, `limitCue`, `contextRingPercent`,
  `toggleDescription`, `headerChipAddons`, `headerActionAddons`, `_workflowAddons`, `_gitStats` and `_vscode`
  (only `headerBranch` read either of these). Also removed are the imports that became unused: `afterNextRender`, `NgComponentOutlet`,
  `limitAwareDot`, `inspectorToggleDescription`, `SessionHeaderComponent`, `SessionInspectorComponent`,
  `InspectorShellController`, `SESSION_EMBED_CHROME`, `SESSION_WORKFLOW_ADDONS` / `sessionWorkflowKind` /
  `workflowAddonsFor`, `SessionGitStatsStore` / `sessionBranch` / `sessionWorkingRoot`, `SESSION_CARD_ACTIONS`.
- Kept: `needsYouCount` and `_inspectorStore`, which the compact card reads (html:15). Also kept is `stats`. A3 said to check it,
  and it is still read by the plan-limits scope effect (`this.stats.runOwnerKeys()`), so it stays. Its doc comment was
  rewritten (946-949). The `cs-shell` wrapper stays (D6), as do the agent sidebar tab, the no-context fallbacks,
  the `SESSION_WORKFLOW_ADDONS` token file (D7), and `SessionInspectorComponent` and `InspectorShellController`
  in their own files, which the Rail board still uses.
- Template: deleted the session-header block (old html:30-71) and the scrim and inspector block (old html:283-317).
  Also removed are `#inspectorShell` and `[attr.inert]="shell.isModal() ..."`. The wrapper comment was updated, and the
  agent-origin comment no longer mentions the tab bar.
- CSS: deleted `.cs-inspector`, `--sheet`, `--full`, `.cs-scrim` and `@keyframes csInspectorIn`, and dropped
  `.cs-inspector` from the reduced-motion list. `.cs-shell` is kept because the template still uses it. The section comment was rewritten.
- Deleted `libs/frontend/chat/src/lib/components/molecules/session-header/session-header.component.ts`, together with
  its now-empty folder. Nothing else referenced it: the only other match is `ptah-compact-session-header`,
  which is a different component.
- `session-context.token.ts:34` now reads "(tests and the Tribunal conductor)."
- Specs:
  - `chat-view.component.spec.ts`: removed `layoutModeSig` (declaration, the stub's `layoutMode` and the harness
    return), the `inspectorOpen` option and the `InspectorOpenStateService` stub. Also removed the `reportAnswerMiss` /
    `clearAnswerMiss` stubs, the "inspector Answer focus" describe (3 cases) and the compact "removes the open inspector" case, plus
    the `ptah-session-header` assertion in the forced-card case.
  - The two rewind cases that set `grid` keep their assertions without that line. One was renamed to drop
    "canvas-grid mode". The `mainPanelShowing` main-panel case now asserts "no session context, so showing".
  - Added the `branch (fork) flow` describe (new 1335-1371). It asserts `requestCanvasSession('branch-session-uuid-1', 'Branch')`,
    and that neither `openSessionTab` nor `switchSession` is called. A second case covers a failed fork, where no tile opens.
    This spec had no fork case before.
  - `chat-view.dock.spec.ts`, `chat-view.keepalive.spec.ts`: removed `layoutMode` from the `AppStateManager` stub,
    and dropped the dead `InspectorOpenStateService` stub and import and the answer-miss stubs. The only reader
    of `InspectorOpenStateService` is `InspectorShellController`, which chat-view no longer provides.
  - `chat-view.session-enter.spec.ts`: removed `layoutMode` from the stub.

## Task 2.2 - canvas spec stub and Rail board comment - DONE

- `canvas-detail-transcript.component.spec.ts`: removed `layoutMode: signal('single')` from the stub (old line 256).
- `canvas-rail-board.component.ts:322-326`: only the comment changed. It now says that a standalone route keeps the canvas mounted
  but hidden (`*ptahRetainWhile`). `surfaceActive` and `parentActive` are unchanged, and
  `canvas-rail-board.component.spec.ts` was not touched.

## Batch verification (static)

- `grep -rnE "layoutMode|SessionHeaderComponent|ptah-session-header|hostsInspector|inspectorShell|cs-inspector|cs-scrim|csInspectorIn" libs/frontend/chat libs/frontend/canvas`
  returns 0 hits.
- The only changed files are the 11 listed below. `.gitignore` was already modified before this batch and I did not touch it, and
  `capture/` and `screenshots/` are untouched. No peer-owned file was edited (`chat-transcript.*`, `message-bubble.*`,
  `chat-input.component.ts`).
- Scoped typecheck, test and lint: not run by me, as instructed.

## Files changed (new-side line ranges)

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/remove-single-layout/libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`:
  imports 13-53, 81, the class doc at 126, constants 149-152, `imports`/`providers` 189-195, `ngOnDestroy` 659, 812-820, 928,
  946-958, 965, 988, 1094, 1141-1145, 1310, 1440-1441, 1464-1465
- MODIFIED `.../templates/chat-view.component.html`: 1-4, 27-28, 237
- MODIFIED `.../templates/chat-view.component.css`: 8, 13, 149
- MODIFIED `.../templates/chat-view.component.spec.ts`: 73, 189, 205, 436, 443, 506-513, 581, 612, 1268-1270, 1293,
  1335-1371 (new fork describe), 1502-1504, 1515, 2441, 2492
- MODIFIED `.../templates/chat-view.dock.spec.ts`: 89, 322, 351-358
- MODIFIED `.../templates/chat-view.keepalive.spec.ts`: 83, 479, 508-515
- MODIFIED `.../templates/chat-view.session-enter.spec.ts`: 106
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/remove-single-layout/libs/frontend/chat/src/lib/tokens/session-context.token.ts`: 34
- DELETED `D:/projects/ptah-extension/.claude-worktrees/remove-single-layout/libs/frontend/chat/src/lib/components/molecules/session-header/session-header.component.ts` (all 261 lines)
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/remove-single-layout/libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.spec.ts`: 255
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/remove-single-layout/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`: 324-326 (comment only)

## Risks and assumptions

- A3 (members with other consumers): I checked each member. `stats` is kept because the plan-limits effect reads it. `_inspectorStore` is kept
  for `needsYouCount`. `_gitStats`, `sessionBranch`, `limitAwareDot` and `inspectorToggleDescription` were removed because
  nothing referenced them any more. Typecheck and lint will catch anything I missed.
- R4 (Rail comment): only the comment lines changed, and the Rail spec is untouched.
- R5 (peer-owned files): none were edited.
- R7 (intermediate state): `AppStateManager.layoutMode` and the rest of the core API are still in place for Batch 3. This batch
  only stops reading them, so the batch still compiles on its own.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Delete `focusQuestionCard`, `openLaneFromInspector`, their helpers (`findQuestionCard`, `revealQuestionCard`, `clearAnswerWait`, `_answerWait`, `QUESTION_CARD_WAIT_MS`, `QUESTION_CARD_FOCUSABLE`), `hasLaneSurface` and `_cardActions`, together with the 3 "inspector Answer focus" spec cases | (a) keep them and strip only the shell calls, as the batch line suggests; (b) delete them as unreachable | After html:283-317 is removed, nothing calls them. They were only the `(answerRequested)` / `(laneRequested)` outputs and the `[hasLaneSurface]` input of the deleted `<ptah-session-inspector>`. They are `protected`, so no outside caller is possible. Decision 6 (user-approved) says to delete code that this PR makes unreachable, including chat-view's own inspector host. The Rail board hosts and wires its own inspector. | yes (git) |
| Remove the dead `InspectorOpenStateService` stubs from the dock and keepalive specs | keep / remove | Its only injector is `InspectorShellController` (`inspector-shell.controller.ts:95`), and chat-view no longer provides that controller | yes |
| Add a fork spec describe instead of "keeping one" | add / skip | The spec had no `onBranchRequested` case at all. The batch requires one that asserts `requestCanvasSession(newSessionId, 'Branch')` | yes |

## Plan deviations

- The decision in row 1 above: the batch text said to keep the question-focus handler and remove only its shell calls. I deleted the handler as dead code under decision 6.
- I removed `bareChrome` and the `SESSION_EMBED_CHROME` import from chat-view because nothing reads them any more. The token
  itself and its other consumers (`compact-session-card`, `session-embed`, the barrel) are unchanged.
  `chat-view.session-enter.spec.ts` still provides `'bare'`. That is harmless, and I left it alone.

## Out-of-scope observations

- `libs/frontend/chat/src/lib/components/templates/chat-view.component.manual-test.md` is not in the batch, and I did not check it for
  steps about the inspector or the header. If it has any, they need updating.
- The `SESSION_WORKFLOW_ADDONS` token and the `workflowAddonsFor` export are now unused (parity says remove-proposed, not in this PR).
