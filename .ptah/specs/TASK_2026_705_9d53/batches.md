# Batches - TASK_2026_705_9d53

Total tasks: 11 | Batches: 4 | Complete: 4/4

Worktree (every path below is absolute in it): `D:/projects/ptah-extension/.claude-worktrees/remove-single-layout`
(branch `refactor/remove-single-layout`, base main `15fe6031a`). Abbreviation used below:
`WT` = `D:/projects/ptah-extension/.claude-worktrees/remove-single-layout`.

## Plan validation

Status: PASSED WITH RISKS

Batching boundary: consumers first, provider last. Every batch removes callers of the layout API
before the batch that deletes it, so each batch compiles and passes its own scoped checks and can
be committed on its own.

Assumptions:

- A1 (plan) bundle savings come from deleted files — unverified; no build is run (CLAUDE.md). Not
  checked unless the user asks for a build.
- A2 (plan) `openInEditor` follows the focused tile via `tabManager.activeTab()`
  (`canvas.store.ts:425-430`) — unverified; manual VS Code smoke in QA (visual review), not a batch.
- A3 (plan) chat-view members `stats`, `_inspectorStore`, `_gitStats`, `sessionBranch`,
  `limitAwareDot`, `inspectorToggleDescription` may have other consumers — verified per member in
  Task 2.1 (remove only when no reference remains; typecheck + lint are the detector).
- A4 (team-leader) the plan's file list is complete — verified: a sweep of `libs` and `apps`
  (`*.ts|*.html|*.css|*.scss`) for every removed symbol returns exactly the 49 files the plan
  names; `canvas-rail-board.component.ts` is a comment-only edit and does not match the sweep.
- A5 (team-leader) `TabBarComponent` and `SessionHeaderComponent` are not exported from any barrel
  — verified: `chat/src/index.ts` and `chat/src/lib/components/index.ts` export neither; the only
  barrel hits are `TabItemComponent` (`chat/src/lib/components/index.ts:107`, `chat-ui/src/index.ts:107`)
  and `AwaitingBackgroundIndicatorComponent` (`chat-ui/src/index.ts:14`).
- A6 (team-leader) no app-shell or electron-shell spec imports or overrides `ChatViewComponent` or
  `TabBarComponent` — verified by grep (0 hits), so removing them from `AppShellComponent.imports`
  needs no TestBed override changes.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R1 Plan ordering does not compile per batch: the plan's Batch 1 deletes the core layout API while chat, harness-builder and webview still call it, and the plan says "commit after Batch 3 or commit 1-3 together". A per-batch commit gate cannot pass that order. | HIGH | Reordered (Decision D-TL1): consumers in Batches 1-2, the core API deletion in Batch 3, chat-ui deletions in Batch 4. Same four groups, same file ownership. |
| R2 `SurfaceActiveDirective.surface` is `input.required` (`surface-active.directive.ts:17-19`): `app-shell.component.html:385` cannot become bare `ptahSurfaceActive` unless the directive changes in the same batch. | HIGH | Directive and its spec move into Batch 1 with app-shell (Task 1.1). |
| R3 Batch 3 deletes a core API but its scoped check does not typecheck `chat`/`canvas`. | MEDIUM | Task 3.1 verification runs the zero-reference grep for `layoutMode|setLayoutMode|toggleLayoutMode|LayoutMode` across `WT/libs` and `WT/apps` before the check (grep is cheap, not a heavy run). |
| R4 Peer branch `feat/inspector-side-dock` (TASK_2026_699) changes `canvas-rail-board.component.ts` (+89/-44 vs main). Its net diff on `chat-view.*` is zero (rev 4 reverted it). | MEDIUM | Task 2.2 edits only the comment at `canvas-rail-board.component.ts:321-325`; no other line. Do not touch its "single-focus" wording (dock feature, unrelated). Whichever PR merges second resolves a one-hunk conflict. |
| R5 Peer-owned files: `chat-transcript.*`, `message-bubble.*`, `chat-input.component.ts`. | MEDIUM | Not in any batch. Every executor prompt carries the prohibition; Mode 2 rejects a batch whose `git status` shows them. |
| R6 Batch size exceeds the 6-file guideline (Batch 1: 28 files; Batch 2: 11) and Batches 1 and 3 span 3 projects. | MEDIUM | Accepted (Decision D-TL2): the orchestrator fixed four sequential batches and a single chat-view batch; edits are mechanical branch collapses. Scoped checks still name only the touched projects. |
| R7 Intermediate state between Batch 1 and Batch 3: the boot pin `setLayoutMode('grid')` is gone while core still reads `ptah-layout-mode`, so a stale `'single'` could make `harness-builder` skip its tile request until Batch 3. | LOW | Intermediate commits only; the PR ships all four batches. Batch 3 removes the guard and the read together. |
| R8 Notification click at the 20-tile cap gives no feedback (decision 4); agent-origin badge dropped (decision 5); Ctrl/Cmd+T tab not tiled (pre-existing); claimed workflow tabs tiled in VS Code (decision 7). | LOW (accepted) | Recorded; plan Risks 1-4. Task 1.4 pins the cap behaviour with a spec. |
| R9 Rendered visual evidence for Mode 3 needs BEFORE screenshots (dark + light) of the VS Code shell from base `15fe6031a`. | MEDIUM | Capture before Batch 1 lands (orchestrator spawns visual-reviewer against the base build), or later from a checkout of `15fe6031a`. Mode 3 blocks without them. |

Edge cases:

- Stored `localStorage['ptah-layout-mode'] = 'single'` lands on the canvas — handled in Task 3.1
  (regression spec) and Task 4.2 (e2e title).
- `ORCHESTRA_CANVAS_COMPONENT` unbound: the spinner fallback is the only shell content — handled in
  Task 1.1 (keep `app-shell.component.html:397-410`).
- Notification click at the tile cap resolves `cap-reached`, panel stays open, no tab switch —
  handled in Task 1.4.
- Standalone routes hide the canvas via `*ptahRetainWhile`, and `SURFACE_ACTIVE` goes false there —
  handled in Task 1.1 (directive = chat route addressed; spec follows the route only).
- chat-view without `SESSION_CONTEXT` (specs, Tribunal conductor): `mainPanelShowing` =
  `_sessionVisible?.() ?? true` (plan D5) — handled in Task 2.1.
- Fork failure still calls `showActionError` — handled in Task 2.1.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D-TL1 | Order batches consumers-first: chat shell/services (+ directive) -> chat-view -> core API + harness-builder + webview -> chat-ui + e2e | plan order (core first, commit 1-3 together) / consumers first | `implementation-plan.md:323-325` says batches 1-3 compile only together; team-leader refuses to commit a batch whose scoped typecheck fails | yes |
| D-TL2 | Keep four batches despite the 6-file / 2-project guideline | 4 batches / ~9 smaller batches | orchestrator prompt fixes 4 sequential batches; one chat-view batch; mechanical edits | yes |
| D-TL3 | Move `chat/src/lib/components/index.ts` (TabItem re-export) to Batch 1, `canvas-rail-board.component.ts` (comment) to Batch 2, `harness-builder-view.*` to Batch 3 | plan grouping / dependency grouping | re-export removal is safe before the chat-ui delete; harness-builder reads `layoutMode()` (`harness-builder-view.component.ts:436`) so it must land no later than the core deletion; keeps Batch 4 at 2 projects | yes |
| D-TL4 | One phase ("removal") for all four batches; one code-logic review on the combined diff after Batch 4; no style review (no new public API; export removals approved by decision 6); visual review in QA | per-batch review / one phase review | risk-based review rule | yes |

Follow-ups (out of scope, not planned here):

- chat-view no-context fallbacks when there is no `SESSION_CONTEXT`; making it required
  (`parity-inventory.md:114`, remove-proposed).
- `SESSION_WORKFLOW_ADDONS` token and the `workflowAddonsFor` export
  (`parity-inventory.md:113`, remove-proposed; plan D7). Batch 2 removes only chat-view's consumption.

## Rules for every batch (repeat in every executor prompt)

- Work only in `WT`. Do not edit `chat-transcript.*`, `message-bubble.*` or `chat-input.component.ts`.
- No stubs, TODOs or placeholders. Do not edit `batches.md` or `task.md`. No git commands.
- Verification is memory-safe: only the batch's command below, `--parallel=1`, Jest `--maxWorkers=2`,
  one heavy check at a time, output filtered with `| tail`. Never workspace-wide; never build, serve,
  e2e, package or showcase runs. For `run-many`, confirm the header says "Running target ... for N
  projects" with N equal to the projects requested (projects without that target are skipped).

## Batch 1: Chat shell, routing services and SurfaceActiveDirective — COMPLETE (commit 56451fc0b)

- Recommended executor: CLI lane (frontend-developer capability: Angular templates, signals, Jest specs)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: one coupled change set (app-shell template needs the directive change; every caller of
  `setLayoutMode`/`layoutMode` in chat stops calling it before the API is deleted in Batch 3)
- Tasks: 5 | Depends on: none
- Phase: removal | Phase review: code-logic (after Batch 4, combined diff)
- Parity rows covered: `parity-inventory.md` lines 44-47, 50-56 (tab bar capabilities), 57 (the chat
  re-export of `TabItemComponent`), 59 (TabManager APIs kept), 68-69 (callers only), 70-76, 79-84, 89
- Scoped check: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core @ptah-extension/chat --parallel=1 -- --maxWorkers=2 2>&1 | tail -60`
  (header: 2 projects)

### Task 1.1: SurfaceActiveDirective loses its input; app-shell shows navbar plus canvas only; delete the tab bar — COMPLETE

- Files: MODIFY `WT/libs/frontend/core/src/lib/routing/surface-active.directive.ts`,
  `WT/libs/frontend/core/src/lib/routing/surface-active.spec.ts`,
  `WT/libs/frontend/chat/src/lib/components/templates/app-shell.component.html`,
  `WT/libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`,
  `WT/libs/frontend/chat/src/lib/components/templates/app-shell.previous-sessions.spec.ts`,
  `WT/libs/frontend/chat/src/lib/components/index.ts`;
  DELETE `WT/libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts`,
  `WT/libs/frontend/chat/src/lib/components/organisms/tab-bar.component.spec.ts`
- Plan reference: implementation-plan.md:109-152 (components 2 and 3), 184-191 (component 8, the chat re-export part)
- Pattern to follow: `surfaceActiveFor` in `WT/libs/frontend/core/src/lib/routing/surface-active.ts:8-13`
- Quality requirements: directive `active` = `surfaceActiveFor('chat')()`, no input, no
  `AppStateManager` inject, selector unchanged; app-shell template per plan (delete the Canvas toggle
  209-220, tab-bar branch keeping the "Orchestra Canvas" label 222-232, navbar Previous sessions
  button 328-352, single content div 412-419; canvas div drops `[class.hidden]`; header hide becomes
  `[class.hidden]="isElectron"`; bare `ptahSurfaceActive`); class drops `TabBarComponent`,
  `ChatViewComponent`, `HistoryIcon`, `LayoutGridIcon`, `layoutMode`, `openPreviousSessions`,
  `toggleLayoutMode`, `TitleOrigin` if unused; `handleCreateSession` keeps only
  `requestNewCanvasSession`; `previousSessions` stays. Remove only `TabItemComponent` from the
  deprecated re-export in `components/index.ts:104-108`, keep the other two names.
- Validation notes: R2 (directive and template change together); edge cases unbound canvas spinner
  and standalone-route retention. Rewrite `surface-active.spec.ts:41-60` to follow the settled route
  only and drop the `LayoutMode` import. In `app-shell.previous-sessions.spec.ts` drop the `layout`
  field, delete the navbar-button cases, open the modal through `PreviousSessionsDialogService.open()`,
  and ADD the VS Code shell case (canvas container visible; no `ptah-tab-bar`, no "Toggle canvas grid"
  button, no `ptah-chat-view`; label "Orchestra Canvas" present). The other app-shell specs
  (retained-chrome, outlet-wrapper, auth-redirect, notification-center) must pass unchanged.
- Implementation details: update app-shell comments 7-13, 54, 376-381 and the class doc 77-107;
  no "single chat"/"single layout" wording left in edited files.

### Task 1.2: ElectronShellComponent stops pinning the layout — COMPLETE

- Depends on: Task 1.1
- Files: MODIFY `WT/libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`,
  `WT/libs/frontend/chat/src/lib/components/templates/electron-shell.activity-placement.spec.ts`,
  `.../electron-shell.apps-tab.spec.ts`, `.../electron-shell.command-center-tab.spec.ts`,
  `.../electron-shell.config-gate.spec.ts`, `.../electron-shell.review-dock.spec.ts`,
  `.../electron-shell.view-transition.spec.ts` (all in `WT/libs/frontend/chat/src/lib/components/templates/`)
- Plan reference: implementation-plan.md:154-161 (component 4)
- Pattern to follow: existing `onCanvasTab` body (`electron-shell.component.ts:500-503`)
- Quality requirements: delete the boot pin (421-425) and the `setLayoutMode` line in `onCanvasTab`;
  keep `setCurrentView('chat')`. Remove `setLayoutMode` stubs from the six specs and the not-called
  assertion in `apps-tab.spec.ts`.
- Validation notes: R7 (intermediate state, accepted).
- Implementation details: no new imports; remove any import left unused.

### Task 1.3: Session-routing services always target the canvas (chat project only) — COMPLETE

- Depends on: Task 1.1
- Files: MODIFY `WT/libs/frontend/chat/src/lib/services/chat-store/session-open-bridge.service.ts` and `.spec.ts`,
  `WT/libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts` and `.spec.ts`,
  `WT/libs/frontend/chat/src/lib/services/workflow-tab-launcher.service.ts` and `.spec.ts`,
  `WT/libs/frontend/chat/src/lib/services/session-list/session-row-actions.service.ts` and `.spec.ts`,
  `WT/libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts` and `.spec.ts`,
  `WT/libs/frontend/chat/src/lib/components/organisms/previous-sessions/previous-sessions-modal.component.spec.ts`
- Plan reference: implementation-plan.md:163-188 (component 5; the harness-builder part is Task 3.2)
- Pattern to follow: each service's existing grid branch (`requestCanvasSession`
  `app-state.service.ts:1219-1263`, `requestCanvasTab` 1331-1356)
- Quality requirements: keep only the grid body in each; drop `SessionLoaderService` from
  session-open-bridge and `ChatStore` from session-row-actions if unused; fix adoption comments
  335-341; `session-row-actions` keeps its warn + `'failed'` path (61-66).
- Validation notes: decision 7 — in `workflow-tab-launcher.service.spec.ts` keep one case asserting a
  launched workflow tab requests a canvas tile with its `tabId`; delete single-layout cases and
  `layoutMode` stubs at the spec lines the plan lists.
- Implementation details: no claim filter is added anywhere.

### Task 1.4: NotificationFocusCoordinator returns cap-reached (decision 4) — COMPLETE

- Depends on: Task 1.1
- Files: MODIFY `WT/libs/frontend/chat/src/lib/services/notification-focus-coordinator.service.ts`,
  `WT/libs/frontend/chat/src/lib/services/notification-focus-coordinator.service.spec.ts`
- Plan reference: implementation-plan.md:190-201 (component 6)
- Pattern to follow: `NotificationFocusResult` outcomes (`WT/libs/frontend/core/src/lib/tokens/notification-focus-router.token.ts:7`)
- Quality requirements: delete `setLayoutMode('grid')` (43) and the cap fallback (53-72); return
  `canvasResult`; drop the `ChatStore` inject and the `openSessionTab`/`switchTab` calls; keep `resolve`.
- Validation notes: edge case cap-reached — replace the "falls back to the full single view" spec
  (103) with "returns cap-reached and switches no tab"; drop `layout:` entries (47, 70).
- Implementation details: `notification-center.component.ts` is not edited (it already keeps the
  panel open on a non-success result, 275, 282).

### Task 1.5: Batch 1 sweep — COMPLETE

- Depends on: Tasks 1.1-1.4
- Quality requirements: `grep -rnE "setLayoutMode|toggleLayoutMode|ptah-tab-bar|TabBarComponent|Toggle canvas grid" WT/libs/frontend/chat WT/libs/frontend/core/src/lib/routing`
  returns 0; `layoutMode` remains in chat only in `chat-view.*` specs/sources (Batch 2).

### Batch 1 verification

- Result (team-leader, Mode 2): files verified on disk against Tasks 1.1-1.5 and parity rows
  44-57, 59, 68-76, 79-84, 89; every removed capability is remove-approved (decisions.md 2, 4, 5,
  6, 7). Task 1.5 sweep returns 0 hits; `layoutMode` remains only in `chat-view.*` (Batch 2).
  No TODO/PLACEHOLDER/STUB markers in the diff.
- Scoped check (orchestrator run, 2 projects): typecheck and lint passed. Test had 1 failure in
  `compact-session-card.component.spec.ts` ("keeps unowned CLI agents off other Rail cards...")
  with a Jest "worker failed to exit gracefully" warning. That spec and its component are not
  changed by Batch 1, and the spec passes alone (49 passed, 49 total): classified as a
  load-related flake, not a Batch 1 regression. Not re-run.
- Process note: the executor marked the task lines IMPLEMENTED itself; the team-leader verified
  them before accepting.
- Committed 56451fc0b (28 files; `.gitignore` and the task folder left unstaged).
- Every listed artifact exists or is deleted as listed; no file outside the list changed
  (`git status --short`), in particular no peer-owned file (R5)
- Scoped check above passes, 2 projects in the header
- No per-batch review; the phase review covers it after Batch 4
- Edge cases unbound canvas, standalone retention and cap-reached are pinned by specs

## Batch 2: ChatViewComponent layout reads and dead inspector host — COMPLETE (commit 8e4fc7cb3)

- Recommended executor: CLI lane (frontend-developer capability)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: every `chat-view.component.*` edit in one batch (orchestrator rule); tightly coupled
  TS/HTML/CSS/spec in one component
- Tasks: 2 | Depends on: Batch 1
- Phase: removal | Phase review: code-logic (after Batch 4)
- Parity rows covered: `parity-inventory.md` lines 86-88, 95 (session-context token and
  canvas-rail-board comments), 107-112, 115-116 (kept)
- Scoped check: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat @ptah-extension/canvas --parallel=1 -- --maxWorkers=2 2>&1 | tail -60`
  (header: 2 projects)

### Task 2.1: chat-view drops layout reads, the inspector host and the session header — COMPLETE

- Files: MODIFY `WT/libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`,
  `.../chat-view.component.html`, `.../chat-view.component.css`, `.../chat-view.component.spec.ts`,
  `.../chat-view.dock.spec.ts`, `.../chat-view.keepalive.spec.ts`, `.../chat-view.session-enter.spec.ts`
  (all in `WT/libs/frontend/chat/src/lib/components/templates/`),
  `WT/libs/frontend/chat/src/lib/tokens/session-context.token.ts`;
  DELETE `WT/libs/frontend/chat/src/lib/components/molecules/session-header/session-header.component.ts`
- Plan reference: implementation-plan.md:203-256 (component 7)
- Pattern to follow: the plan's member list; `cs-shell` wrapper kept (plan D6)
- Quality requirements: `mainPanelShowing` = `this._sessionVisible?.() ?? true`;
  `resolvedQuestionRequests` drops `tilesPresent` and the main-panel return; fork keeps only
  `requestCanvasSession` and `showActionError` on failure; delete `hostsInspector`,
  `InspectorShellController` inject and provider, `wireInspectorShell` and its call, the shell calls
  in question focus, the `inspectorShell` view query, template blocks html:32-69 and 285-316,
  `#inspectorShell` and the `[attr.inert]` binding; header-only members and the
  `SESSION_WORKFLOW_ADDONS`/`workflowAddonsFor` imports; CSS 17-50 and `.cs-inspector` in the
  reduced-motion list. Keep `needsYouCount`, the agent sidebar tab (html:318-340), the no-context
  fallbacks, the token itself (D7), `SessionInspectorComponent` elsewhere.
- Validation notes: A3 — remove `stats`, `_gitStats`, `sessionBranch`, `limitAwareDot`,
  `inspectorToggleDescription`, `_inspectorStore` only when no reference remains (`_inspectorStore`
  is still used by `needsYouCount` and answer-miss handling). Specs: drop `layoutModeSig`
  (443, 451, 597), the grid-setting cases, the single fork path, every header/inspector/sheet/scrim
  case (incl. the `ptah-session-header` query at spec:2569); keep one fork case asserting
  `requestCanvasSession(newSessionId, 'Branch')`; remove `layoutMode` from the `AppStateManager`
  stubs in the dock, keepalive and session-enter specs. Peer-owned files untouched (R5).
- Implementation details: session-context token comment line 34 -> "tests and the Tribunal conductor".

### Task 2.2: canvas spec stub and Rail board comment — COMPLETE

- Depends on: Task 2.1
- Files: MODIFY `WT/libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.spec.ts`,
  `WT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts` (comment only)
- Plan reference: implementation-plan.md:117-119, 244-246
- Quality requirements: remove `layoutMode` from the `AppStateManager` stub (spec:256); rewrite the
  comment at `canvas-rail-board.component.ts:321-325` (no single-chat mode; the canvas is hidden only
  by `*ptahRetainWhile` on standalone routes); `parentActive` behaviour unchanged.
- Validation notes: R4 — change only those comment lines; `canvas-rail-board.component.spec.ts` must
  pass unchanged.

### Batch 2 verification

- Result (team-leader, Mode 2): files verified on disk against Tasks 2.1-2.2 and parity rows
  86-88, 95, 107-112, 115-116. `mainPanelShowing` = `_sessionVisible?.() ?? true`; fork calls only
  `requestCanvasSession(newSessionId, 'Branch')`; `needsYouCount`, `_inspectorStore`, the agent
  sidebar tab and the `cs-shell` box are kept. The batch grep returns 0 hits in chat and canvas.
- Deviation accepted: `focusQuestionCard`, `openLaneFromInspector`, their helpers and 3 inspector
  spec cases were deleted beyond the batch text; their only callers were the deleted inspector
  host template (decisions.md row 9, under user decision 6). `bareChrome` and the
  `SESSION_EMBED_CHROME` import were removed from chat-view as unread; the token stays.
- `chat-view.component.manual-test.md` checked: it does not describe the inspector or the session
  header, so no cleanup is needed (not a Batch 4 item).
- Scoped check (orchestrator run, 2 projects): typecheck, test and lint passed; the Batch 1 flake
  did not recur. Not re-run.
- Committed 8e4fc7cb3 (11 files; `.gitignore` and the task folder left unstaged).
- Every listed artifact exists or is deleted; no other file changed; no peer-owned file touched
- `grep -rnE "layoutMode|SessionHeaderComponent|ptah-session-header|hostsInspector|inspectorShell|cs-inspector|cs-scrim|csInspectorIn" WT/libs/frontend/chat WT/libs/frontend/canvas` returns 0
- Scoped check above passes, 2 projects in the header

## Batch 3: Core layout API removal, harness-builder guard, webview app — COMPLETE (commit 56fccb725)

- Recommended executor: CLI lane (frontend-developer capability)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: the provider deletion lands after every consumer is gone; harness-builder and the
  webview routing spec are the last readers of `layoutMode`
- Tasks: 2 | Depends on: Batches 1, 2
- Phase: removal | Phase review: code-logic (after Batch 4)
- Parity rows covered: `parity-inventory.md` lines 66-69 (API deletion), 77, 78, 85, 95 (app.config comment)
- Scoped check: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core @ptah-extension/harness-builder ptah-extension-webview --parallel=1 -- --maxWorkers=2 2>&1 | tail -60`
  (header: 3 projects)

### Task 3.1: Delete LayoutMode and the layout API from AppStateManager — COMPLETE

- Files: MODIFY `WT/libs/frontend/core/src/lib/services/app-state.service.ts`,
  `WT/libs/frontend/core/src/lib/services/app-state.service.spec.ts`,
  `WT/libs/frontend/core/src/lib/tokens/lazy-view-components.token.ts` (comment 29-38),
  `WT/apps/ptah-extension-webview/src/app/webview-routing.spec.ts`,
  `WT/apps/ptah-extension-webview/src/app/app.config.ts` (comment 288-296)
- Plan reference: implementation-plan.md:86-107 (component 1)
- Pattern to follow: `normalizeInitialView` (`app-state.service.ts:810-820`) keeps its signature
- Quality requirements: delete `LayoutMode`, `_layoutMode`, `layoutMode`, the localStorage read
  (776-781), `setLayoutMode`, `toggleLayoutMode`; `normalizeView('orchestra-canvas')` -> `'chat'`
  with no grid write; fix doc comments 109-111, 242-248, 806-808. Spec: delete 206-242, 661-675,
  1004-1013; drop `layoutMode` from 156-162 and `savedLayoutMode` (103, 113-114); ADD the regression
  case (stored `'single'` -> `currentView()` is `chat`, `'layoutMode' in service` is false).
  `webview-routing.spec.ts:339-348` keeps the `orchestra-canvas` -> `chat` assertion only.
- Validation notes: R3 — before the scoped check, grep
  `LayoutMode|layoutMode|setLayoutMode|toggleLayoutMode` across `WT/libs` and `WT/apps` must return
  0 hits outside this batch's files (after Task 3.2). `ptah-layout-mode` may remain only in this
  regression spec and the e2e `canvas.spec.ts`.

### Task 3.2: harness-builder always requests a tile — COMPLETE

- Files: MODIFY `WT/libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts`,
  `WT/libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.spec.ts`
- Plan reference: implementation-plan.md:174, 184
- Quality requirements: delete the `layoutMode() === 'grid'` guard (436-442), keep its body; drop
  `layoutMode` stubs/cases at spec 96, 155, 235 (and the single case near 326).
- Validation notes: R7 closes here.

### Batch 3 verification

- Every listed artifact edited; no other file changed
- Grep in Task 3.1 returns 0 outside the allowed specs
- Scoped check above passes, 3 projects in the header

Batch 3 outcome (team-leader, Mode 2): verified on disk. Grep for
`LayoutMode|layoutMode|setLayoutMode|toggleLayoutMode|ptah-layout-mode` over `WT/libs` and
`WT/apps` hits only `app-state.service.spec.ts` (header note + regression case 198-208) and e2e
`canvas.spec.ts:58` (Batch 4) — zero production reads/writes (F7, implementation-plan.md:380-387).
Scoped check: typecheck and test passed for all 3 projects; lint passed for core and
harness-builder. `ptah-extension-webview:lint` failed with one error, "Circular dependency between
ptah-extension-webview and @ptah-extension/command-center" at
`apps/ptah-extension-webview/src/app/app.routes.ts:224` — PRE-EXISTING on main `15fe6031a`
(orchestrator reproduced it in a clean worktree with `--skip-nx-cache`); `app.routes.ts` is not
changed by any batch; not caused by this PR. PR follow-up: fix the webview <-> command-center cycle
in a separate task and name it in the PR body.
Accepted deviations (no capability removed): the `normalizeInitialView('orchestra-canvas') -> 'chat'`
unit case is kept minus its layout line (only core-level coverage of `normalizeView`); four extra
stale layout comments in `app-state.service.ts` rewritten (comment-only).

## Batch 4: chat-ui dead components and Electron e2e/showcase — COMPLETE (commit 1264d3d41)

- Accepted deviation: the executor also removed the now-unused `director` parameter from
  `goToCanvas` and changed its one call site (`lane-console-review.scene.ts:43,228`). This is
  in scope because removing the toggle left the parameter unused. Sweep result: two hits remain,
  and both are intended regression absence assertions (`app-state.service.spec.ts:207`,
  `canvas.spec.ts:63`).

- Recommended executor: CLI lane (frontend-developer capability)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: chat-ui deletions are safe once the tab bar and the chat re-export are gone (Batch 1);
  e2e/showcase edits are leaf files
- Tasks: 2 | Depends on: Batch 1 (and 3 for the final sweep)
- Phase: removal | Phase review: code-logic on the combined diff `15fe6031a..HEAD` (due after this batch)
- Parity rows covered: `parity-inventory.md` lines 57-58, 67 (e2e), 93, 94
- Scoped check: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui ptah-electron-e2e --parallel=1 -- --maxWorkers=2 2>&1 | tail -60`
  (header: test runs for 1 project, since `ptah-electron-e2e` has no test target; typecheck and lint for 2)

### Task 4.1: Delete TabItemComponent and AwaitingBackgroundIndicatorComponent — COMPLETE

- Files: DELETE `WT/libs/frontend/chat-ui/src/lib/molecules/session/tab-item.component.ts`,
  `WT/libs/frontend/chat-ui/src/lib/atoms/awaiting-background-indicator/awaiting-background-indicator.component.ts`,
  `WT/libs/frontend/chat-ui/src/lib/atoms/awaiting-background-indicator/awaiting-background-indicator.component.spec.ts`;
  MODIFY `WT/libs/frontend/chat-ui/src/index.ts` (lines 14, 107)
- Plan reference: implementation-plan.md:258-268 (component 8)
- Quality requirements: remove the now-empty `awaiting-background-indicator/` folder.

### Task 4.2: e2e title and showcase toggle — COMPLETE

- Files: MODIFY `WT/apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`,
  `WT/apps/ptah-electron-e2e/src/showcase/lane-console-review.scene.ts`
- Plan reference: implementation-plan.md:270-280 (component 9)
- Quality requirements: rename the test at `canvas.spec.ts:56` to "Electron ignores a stale
  ptah-layout-mode value and opens the Rail board" (body unchanged); delete the
  `if (!visible(grid))` toggle click (scene 44-55), keep the `grid.waitFor` (30 s); drop `visible`
  import only if unused. No e2e or showcase run.

### Batch 4 verification

- Every listed artifact deleted or edited; no other file changed
- Final zero-reference sweep (plan `implementation-plan.md:380-387`) over `WT/libs/frontend` and
  `WT/apps` for: `LayoutMode`, `layoutMode`, `setLayoutMode`, `toggleLayoutMode`, `ptah-tab-bar`,
  `TabBarComponent`, `Toggle canvas grid`, `SessionHeaderComponent`, `ptah-session-header`,
  `hostsInspector`, `inspectorShell`, `cs-inspector`, `cs-scrim`, `csInspectorIn`,
  `TabItemComponent`, `ptah-tab-item`, `AwaitingBackgroundIndicator` = 0; `ptah-layout-mode` only
  in `app-state.service.spec.ts` and e2e `canvas.spec.ts`
- Scoped check above passes
- Then the phase code-logic review (Decision D-TL4) and, in QA, visual review with before
  (base `15fe6031a`) and after screenshots, dark + light (R9)
