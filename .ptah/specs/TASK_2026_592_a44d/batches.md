# Batches - TASK_2026_592_a44d

Total tasks: 10 | Batches: 4 | Complete: 4/4

Sources: task.md, context.md (Conversation Summary, orchestrator decisions (a)-(e)), research-report.md
("Recommended design", "Risks and tests", "Unknowns"). BUGFIX, plan-free. Worktree ROOT =
`D:\projects\ptah-extension\.claude-worktrees\fix-close-tab-session` (branch `fix/close-tab-ends-session`).
All paths below are under ROOT.

Batching boundary: one batch per library seam (chat-state producer, chat consumer, workspace-removal
seam core+chat, backend unknown), in dependency order. Batch 4 shares no files or libs with Batches 1-3
and may run in parallel with Batch 1.

Chosen defaults (recorded, not asked):

- Session ender is a NEW root-provided service in `@ptah-extension/chat` (chat-state stays RPC-free),
  instantiated eagerly by injecting it in both shells (`AppShellComponent`, `ElectronShellComponent`),
  not in `apps/ptah-extension-webview` (keeps Batch 2 inside one lib; root singleton, so double inject
  is harmless).
- "Streaming abort already dispatched" is carried on the event: `ClosedTabEvent` gains an OPTIONAL
  `streamAbortDispatched?: boolean`, set by `closeTab` from the new boolean return of
  `abortStreamingForTab`. Optional so existing spec literals that build `ClosedTabEvent` keep compiling.
- Folder removal: confirm stays streaming-only (decision (a)); idle sessions are ended only AFTER the
  backend accepted `workspace:removeFolder`, so a rejected removal ends nothing extra.
- `/clear`, rewind rebind, `forceCloseTab` (pop-out transfer, tribunal rollback) never end sessions
  (decision (e)).

## Plan validation

Status: PASSED WITH RISKS

Verified on disk (main 95cb1de78):

- `closeTab` emits `closedTab{kind:'close'}` before removing the tab and calls `abortStreamingForTab`
  first (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:909-974`); `abortStreamingForTab` is
  `void` and a no-op without a controller (`:2694-2701`).
- The only tab-close `chat:abort` is the abort listener in
  `libs/frontend/chat/src/lib/services/message-sender.service.ts:216-237`; it reads `claudeSessionId`
  synchronously and skips when null.
- `ClosedTabEvent` (`tab-manager.service.ts:86-101`) has `tabId`, `sessionId: string | null`, `kind`.
- Existing `closedTab()` consumers: `stream-router.service.ts:80`, `transcript-retention.service.ts:83`
  (component-scoped, wrong home for a singleton side effect), `orchestra-canvas.component.ts:455`.
- `StreamRouter` is instantiated eagerly by the root `App` (`apps/ptah-extension-webview/src/app/app.ts:57`).
- `closeOtherTabs` (`:2351`) / `closeTabsToRight` (`:2380`): only callers are
  `tab-manager.lifecycle.spec.ts:395-425`.
- `getStreamingSessionIds` lives on `IWorkspaceCoordinator`
  (`libs/frontend/core/src/lib/tokens/workspace-coordinator.token.ts:55`), implemented at
  `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts:307-314`, used by
  `libs/frontend/core/src/lib/services/electron-layout.service.ts:340` (`removeFolder`, `:334-413`), mocked
  in `electron-layout.service.spec.ts:46`.
- `saveResumeState` REPLACES `resumableSdkSubagents` with the filtered input
  (`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:587-623`). The input comes from the in-memory
  `SubagentRegistryService.getResumableBySession` (`libs/backend/vscode-core/src/services/subagent-registry.service.ts:508`)
  in both `abortSession` (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:976-994`)
  and the generic session-end subscriber (`chat-session.service.ts:224-233`). A durable list is restored
  into the registry by `restoreResumableBySession` (`subagent-registry.service.ts:516+`). So an idle abort
  overwrites with `[]` only if the registry no longer holds the interrupted records (restart without
  restore, or TTL `lazyCleanup`). Batch 4 pins this.

Assumptions:

- A non-null `claudeSessionId` is a real SDK id (it is only set from stream events; no temp-id helper
  exists in `libs/frontend`) — verified by grep; Task 2.1 still guards non-empty string.
- `findTabBySessionId` scans active then all background partitions (`tab-manager.service.ts:450`) —
  research-verified; Task 2.1 test uses it as the shared-session guard.
- No non-tab surface (tribunal/harness panel via `StreamingSurfaceRegistry` / `WorkflowSessionClaimService`)
  displays a session that a user-closable tab also holds — unverified; Task 2.1 must check and, if such a
  surface exists, add it to the guard.
- Cross-webview twin (VS Code sidebar + editor panel showing the same session) cannot be seen from one
  `TabManagerService`; accepted residual risk (recoverable by `autoResumeIfInactive`), per research Q3.
- `chat:abort` on an idle record ends the record and stops claude.exe (inferred, not run) — checked at
  completion by the manual process-list observation recorded under "Completion evidence".

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| Double `chat:abort` on a streaming close (listener + new service) could overwrite the first abort's resume state | HIGH | Task 1.1 (`abortStreamingForTab` returns boolean, carried as `streamAbortDispatched`), Task 2.1 guard, Task 2.2 test "streaming close sends exactly one chat:abort" |
| Ending a session on workspace switch (user requirement) | HIGH | No switch path emits `closedTab`; Task 1.2 test (switch emits no `closedTab`), Task 3.3 test (coordinator/layout switch sends no `chat:abort`) |
| Ending on pop-out transfer / `/clear` / tribunal rollback | HIGH | Task 2.1 acts on `kind==='close'` only; Task 2.2 tests `forceClose` and `reset` send none |
| `closedTab` is a single-value signal; two closes in one tick coalesce | MEDIUM | All live callers await one close per tick; dead batch closers deleted (Task 1.1); Task 2.2 test for two sequential closes each sending one RPC |
| RPC rejection or sync throw inside the effect breaks close or later effects | MEDIUM | Task 2.1 fire-and-forget with `.catch` + try/catch, `console.warn`; Task 2.2 test |
| New confirm on `awaiting-background`/`sleeping` also fires for programmatic closers (tribunal `endRun`, app-shell delete cleanup, rewind delete-original) | LOW | `endRun` already handles cancel (`tribunal-run.service.ts:207-212`); others await `closeTab`; executor confirms no existing spec in chat breaks, reported in Task 1.1 |
| Folder removal ends idle sessions even if backend rejects removal | MEDIUM | Task 3.2 ends idle ids only after `workspace:removeFolder` success; Task 3.3 test |
| `chat:abort` racing `session:delete` after app-shell / rewind delete paths | LOW | Backend logs "missing session" in `saveResumeState` and returns; no fix, noted for review |
| `saveResumeState([])` overwrites a durable non-empty list on idle close | MEDIUM (unknown) | Task 4.1 test; Task 4.2 smallest fix only if proven |

Edge cases:

- Fresh tab closed before first send (`sessionId` null) — no RPC; Task 2.2.
- Session still open in another tab or canvas tile in any partition — no RPC; Task 2.2.
- Streaming close — exactly one `chat:abort` (from the listener); Tasks 1.2, 2.2.
- Controller present but already aborted — `abortStreamingForTab` returns false, ender may send one more
  abort (harmless duplicate, rare); documented in Task 1.1.
- Confirm cancelled on `awaiting-background`/`sleeping` — tab kept, no `closedTab`, no RPC; Task 1.2.
- Folder removal with mixed streaming + idle tabs — streaming aborted once (before, existing), idle ones
  once (after success), no id twice; Task 3.3.
- Removing the only workspace — idle sessions still ended; Task 3.3.

## Batch 1: chat-state close contract — COMPLETE (6260ca411)

- Recommended executor: frontend-developer (in-process sub-agent)
- Fallback executor: a single CLI lane with the batch executor prompt
- Execution mode: sequential
- Rationale: three tightly coupled edits in one service plus its specs; changes a public event type
  that Batch 2 consumes.
- Tasks: 2 | Depends on: none
- Verify: `npx nx run-many -t typecheck,lint -p @ptah-extension/chat-state` then
  `npx nx run-many -t test -p @ptah-extension/chat-state -- --maxWorkers=2`
- Reviewer: code-logic-reviewer (behavioural: close contract, confirm gating)

### Task 1.1: closeTab contract — abort boolean, event flag, background confirm, delete dead closers — COMPLETE

- File: `libs/frontend/chat-state/src/lib/tab-manager.service.ts`
- Plan reference: research-report.md "Recommended design" 2, 5, 7; "Q5"; context.md decisions (b), (c)
- Pattern to follow: existing `closeTab` (`:909-974`), `ClosedTabEvent` doc style (`:86-101`)
- Quality requirements: no behaviour change for `forceCloseTab` / `resetTabToFresh` beyond ignoring the
  new return value; `closedTab` still emitted before tab removal.
- Validation notes: double-abort risk; coalescing risk (dead closers removed); programmatic closers now
  prompt for background tabs (report any spec in other libs that asserts no prompt).
- Implementation details:
  - `abortStreamingForTab(tabId): boolean` — true only when this call aborted a live (not yet aborted)
    controller; false when none or already aborted. Update its doc comment.
  - `ClosedTabEvent` gains `readonly streamAbortDispatched?: boolean` with a doc line: true when closing
    aborted an in-flight stream whose listener already sent `chat:abort`. `closeTab` sets it from the
    return value; `forceCloseTab` and `resetTabToFresh` do not set it.
  - `needsConfirmation` adds `tab.status === 'awaiting-background' || tab.status === 'sleeping'`; message
    text names background work (for example "This session has unsaved changes, is streaming, or has
    background work running. Closing it ends the session. Close anyway?"); labels and style unchanged.
  - Delete `closeOtherTabs` and `closeTabsToRight` and any doc references to them in this file.

### Task 1.2: chat-state specs — COMPLETE

- Depends on: Task 1.1
- Files: `libs/frontend/chat-state/src/lib/tab-manager.lifecycle.spec.ts`,
  `libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts`,
  `libs/frontend/chat-state/src/lib/tab-manager.cross-workspace.spec.ts`
- Plan reference: research-report.md "Risks and tests"
- Pattern to follow: `tab-manager.lifecycle.spec.ts:105-191` (closeTab + `closedTab()` assertions),
  `tab-manager.service.spec.ts:159-212` (abort controller tests)
- Quality requirements: real assertions, no skipped tests.
- Implementation details:
  - lifecycle spec: delete `describe('closeOtherTabs + closeTabsToRight')` (`:395-425`). Add: confirm
    shown for `awaiting-background` and for `sleeping`; cancel keeps the tab and emits no `closedTab`;
    idle tab closes without confirm; `closedTab().streamAbortDispatched` is true after closing a tab with
    a live controller and falsy for an idle tab.
  - service spec: `abortStreamingForTab` returns true for a live controller, false when none, false on a
    second call.
  - cross-workspace spec (real partition): `switchWorkspace` to another workspace and back emits no
    `closedTab` and keeps background tabs intact. PROVES: workspace switch emits no closedTab.

### Batch 1 verification

- Every listed artifact exists and contains the required work
- The batch's scoped verify commands pass (output tailed)
- code-logic-reviewer returned an accepting verdict
- Edge cases: confirm cancel, already-aborted controller, switch emits nothing

## Batch 2: chat-lib close-tab session ender + canvas cancel guard — COMPLETE (aa2129688)

- Recommended executor: frontend-developer (in-process sub-agent)
- Fallback executor: a single CLI lane with the batch executor prompt
- Execution mode: sequential
- Rationale: new service plus wiring into two shells; guard design needs judgment (non-tab surface check).
  Task 2.3 added after the Batch 1 review (orchestrator decision): canvas tile cancel guard.
- Tasks: 3 | Depends on: Batch 1 (complete, 6260ca411)
- File cap: exactly 6 files across 2 libs (chat, canvas) — do NOT add a `services/index.ts` export; the
  shells import the service by relative path.
- Approved deviation (team-leader, during execution): 10 files. Injecting the ender in the shells broke 4
  shell spec suites (26 tests): their TabManager mocks have no `closedTab`. Each spec gets one provider
  stub `{ provide: ClosedTabSessionEnderService, useValue: {} }` in `libs/frontend/chat/src/lib/components/templates/`
  `electron-shell.config-gate.spec.ts`, `app-shell.auth-redirect.spec.ts`, `electron-shell.apps-tab.spec.ts`,
  `electron-shell.activity-placement.spec.ts`. These are test-harness changes only, still inside the chat
  lib. The stub was chosen over widening those mocks so the real RPC side effect never runs in unrelated
  shell suites.
- Verify: `npx nx run-many -t typecheck,lint -p @ptah-extension/chat,@ptah-extension/canvas` then
  `npx nx run-many -t test -p @ptah-extension/chat,@ptah-extension/canvas -- --maxWorkers=2`
- Reviewer: code-logic-reviewer (behavioural: side-effecting effect, guards, error handling)

### Task 2.1: ClosedTabSessionEnderService and eager instantiation — COMPLETE

- Files: `libs/frontend/chat/src/lib/services/closed-tab-session-ender.service.ts` (new),
  `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`,
  `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`
- Plan reference: research-report.md "Recommended design" 1-4; "Q3", "Q4"; context.md decision (d), (e)
- Pattern to follow: effect + `untracked` shape in `transcript-retention.service.ts:79-86`;
  RPC fire-and-forget in `message-sender.service.ts:226-233`
- Quality requirements: `@Injectable({ providedIn: 'root' })`; never awaited by `closeTab`; never throws.
- Validation notes: double abort, shared session, non-tab surface assumption, rejection handling.
- Implementation details:
  - `effect(() => { const evt = tabManager.closedTab(); ... untracked(...) })`. Act only when
    `evt.kind === 'close'`, `evt.sessionId` is a non-empty string, `evt.streamAbortDispatched !== true`,
    and `tabManager.findTabBySessionId(evt.sessionId) === null` (tab already removed when the effect runs).
  - Check whether any non-tab surface (tribunal / harness panels through `StreamingSurfaceRegistry` or
    `WorkflowSessionClaimService`) can still display that session id; if so include it in the guard,
    else state in the report why not.
  - Call `claudeRpcService.call('chat:abort', { sessionId })` inside try/catch with `.catch` →
    `console.warn('[ClosedTabSessionEnder] ...', { tabId, sessionId, error })`. Ignore the result.
  - Inject the service in both shells (`private readonly _closedTabSessionEnder = inject(...)`) with a
    one-line comment on why (eager root singleton). Import it by relative path; no `services/index.ts`
    export in this batch (file cap).
  - Note from Batch 1: `closeTab` now re-reads the tab after the confirm and emits nothing if the tab
    left the active list meanwhile; the event's `sessionId` is the post-confirm binding.

### Task 2.2: ClosedTabSessionEnderService spec — COMPLETE

- Depends on: Task 2.1
- File: `libs/frontend/chat/src/lib/services/closed-tab-session-ender.service.spec.ts` (new)
- Pattern to follow: signal-driven fake TabManager in `transcript-retention.service.spec.ts:33-70`
- Implementation details (each a separate `it`, using `TestBed.flushEffects()` / `TestBed.tick()`):
  - idle close with real session → exactly one `chat:abort` with that `sessionId`
  - `streamAbortDispatched: true` → no RPC. PROVES (with Task 1.2): streaming close sends exactly one chat:abort
  - `kind: 'forceClose'` → no RPC. PROVES: forceCloseTab transfer sends none
  - `kind: 'reset'` → no RPC. PROVES: /clear reset sends none
  - `sessionId: null` and `''` → no RPC
  - another tab still resolves the session (`findTabBySessionId` returns a tab) → no RPC
  - RPC rejects and RPC throws synchronously → no throw out of the effect, `console.warn` called, and a
    following close still sends its RPC. PROVES: RPC rejection never throws from close
  - two sequential closes (flush between) → two RPCs, one per session

### Task 2.3: canvas removeTile keeps the tile when the close is cancelled — COMPLETE

- Files: `libs/frontend/canvas/src/lib/canvas.store.ts`, `libs/frontend/canvas/src/lib/canvas.store.spec.ts`
- Plan reference: batch-1-code-logic-review.md Serious issue 1 (`canvas.store.ts:242-246`)
- Pattern to follow: post-close check in `libs/frontend/tribunal-panel/src/lib/services/tribunal-run.service.ts:207-212`
- Validation notes: Batch 1 made more tabs prompt (`awaiting-background`, `sleeping`), so a cancelled
  confirm on a tile now happens more often; today the tile is dropped while its tab stays open.
- Implementation details: in `removeTile`, after `await this.tabManager.closeTab(tabId)`, return early
  when `this.tabManager.tabs()` still contains `tabId` (tile and focus unchanged). Keep the doc comment
  accurate. Spec: cancelled close (tab still present) keeps the tile and focus; confirmed close drops the
  tile and clears focus.

### Batch 2 verification

- Every listed artifact exists and contains the required work
- Scoped verify commands pass (output tailed)
- code-logic-reviewer returned an accepting verdict
- Edge cases: null session, shared session, streaming, rejection, cancelled tile close

## Batch 3: workspace-folder removal ends all its sessions — COMPLETE (cc1c0e1f2)

- Recommended executor: frontend-developer (in-process sub-agent)
- Fallback executor: a single CLI lane with the batch executor prompt
- Execution mode: sequential
- Rationale: interface change in core token implemented in chat; ordering around backend success matters.
- Tasks: 3 | Depends on: none by files (shares the `@ptah-extension/chat` test run with Batch 2, so run
  after Batch 2)
- Verify: `npx nx run-many -t typecheck,lint -p @ptah-extension/core,@ptah-extension/chat` then
  `npx nx run-many -t test -p @ptah-extension/core,@ptah-extension/chat -- --maxWorkers=2`
- Reviewer: code-logic-reviewer (behavioural: ordering vs backend result, dedup, switch untouched)

### Task 3.1: coordinator returns all session ids of a workspace — COMPLETE

- Files: `libs/frontend/core/src/lib/tokens/workspace-coordinator.token.ts`,
  `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts`
- Plan reference: research-report.md "Q2"; context.md decision (a)
- Pattern to follow: `getStreamingSessionIds` (`workspace-coordinator.service.ts:307-314`)
- Implementation details: add `getSessionIds(workspacePath): SessionId[]` to `IWorkspaceCoordinator` and
  the service — every tab of that workspace with a non-null `claudeSessionId`, de-duplicated. Keep
  `getStreamingSessionIds` (still drives the confirm).

### Task 3.2: ElectronLayoutService.removeFolder ends idle sessions after removal succeeds — COMPLETE

- Depends on: Task 3.1
- File: `libs/frontend/core/src/lib/services/electron-layout.service.ts`
- Pattern to follow: existing abort loop `:362-371`
- Implementation details: capture `allIds = coordinator.getSessionIds(path)` BEFORE
  `cleanupWorkspaceState` destroys the tabs; keep the streaming confirm + streaming abort exactly as today;
  after `workspace:removeFolder` succeeds, send `chat:abort` fire-and-forget (`.catch` → `console.error`
  like `:364-368`) for every id in `allIds` not already aborted as streaming. Nothing extra on cancel or
  backend rejection. `switchWorkspace` untouched. Update the method doc comment.

### Task 3.3: specs for removal and switch — COMPLETE

- Depends on: Task 3.2
- Files: `libs/frontend/core/src/lib/services/electron-layout.service.spec.ts`,
  `libs/frontend/chat/src/lib/services/workspace-coordinator.service.spec.ts`
- Pattern to follow: `electron-layout.service.spec.ts:1586-1771`, `workspace-coordinator.service.spec.ts:637-660`
- Implementation details: add `getSessionIds` to the coordinator mock (`:46`). Tests: idle-only workspace
  removal sends one `chat:abort` per idle id after `workspace:removeFolder`; mixed streaming + idle sends
  each id once; confirm cancelled sends nothing; backend rejection sends no idle abort; removing the only
  workspace still ends its sessions; `switchWorkspace` sends no `chat:abort`. Coordinator: `getSessionIds`
  returns all non-null ids de-duplicated, empty for an unknown workspace; coordinator `switchWorkspace`
  never calls `tabManager.closeTab` / `forceCloseTab`. PROVES: workspace switch sends no chat:abort.

### Batch 3 verification

- Every listed artifact exists and contains the required work
- Scoped verify commands pass (output tailed)
- code-logic-reviewer returned an accepting verdict
- Edge cases: mixed tabs, rejection, only workspace

## Batch 4: backend saveResumeState overwrite unknown — COMPLETE (fb1119220)

- Recommended executor: backend-developer (in-process sub-agent); a single CLI lane is acceptable (tiny,
  self-contained) if the orchestrator wants it parallel with Batch 1 (max one lane at a time).
- Fallback executor: backend-developer
- Execution mode: sequential
- Rationale: one investigative test, at most one guard; independent of Batches 1-3.
- Tasks: 2 | Depends on: none (may run parallel with Batch 1; commits stay one batch at a time)
- Verify: `npx nx run-many -t typecheck,lint -p @ptah-extension/rpc-handlers,@ptah-extension/vscode-core`
  then `npx nx run-many -t test -p @ptah-extension/rpc-handlers,@ptah-extension/vscode-core -- --maxWorkers=2`
- Reviewer: code-logic-reviewer (behavioural: persisted resume state)

### Task 4.1: pin whether an idle chat:abort overwrites a non-empty resumable list — COMPLETE

- File: a spec beside `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` (extend
  its existing spec, or add `chat-session.abort-resume-state.spec.ts`), and/or
  `libs/backend/vscode-core/src/services/subagent-registry.service.spec.ts`
- Plan reference: research-report.md "Q4", "Unknowns" first bullet
- Pattern to follow: `libs/backend/agent-sdk/src/lib/session-metadata-store.spec.ts:302-345`
- Implementation details: use the REAL `SubagentRegistryService` (mock only the SDK adapter/ptahCli). Cases:
  (a) running subagent → `markAllInterrupted` → abort persists it → a second (idle) abort still passes the
  interrupted record (registry retained); (b) registry empty but durable list present (restart without
  `restoreResumableBySession`) → what the idle abort writes; (c) interrupted records after the registry
  TTL / `lazyCleanup`. Also note the session-end subscriber (`chat-session.service.ts:224-233`) writes the
  same snapshot. Report the result per case with evidence.

### Task 4.2: smallest fix only if Task 4.1 proves a non-empty list is overwritten — COMPLETE

- Depends on: Task 4.1
- File: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` (or the store if that is
  the single point covering both writers)
- Implementation details: if (b) or (c) overwrites a non-empty durable list in a path the new close
  behaviour reaches, add the smallest guard (for example skip writing an empty snapshot when the registry
  holds nothing for that session) covering both writers, with a test. If no overwrite occurs, make no
  production change and state that in the report. If the fix needs more than one guard or a contract
  change, stop and report it as a blocker instead of designing it.

### Batch 4 verification

- Every listed artifact exists and contains the required work
- Scoped verify commands pass (output tailed)
- code-logic-reviewer returned an accepting verdict
- If a production change was made: write-path traced to its readers (`restoreResumableBySession`,
  `chat-history-read.service.ts:116`, `chat-subagent-context-injector.service.ts:81`)

## Completion evidence (Mode 3)

- Final cross-side code-logic review of the whole branch diff on one CLI lane (orchestrator picks it),
  in addition to the per-batch reviews.
- Parity: N/A — no surface replaced, consolidated, rebuilt or redesigned; the deleted `closeOtherTabs` /
  `closeTabsToRight` had zero non-spec callers (no UI entry point).
- UI evidence: the confirm dialog itself is unchanged; the behaviour change is that closing an
  `awaiting-background` or `sleeping` tab now shows it (with new message text). Required: before/after
  screenshots, dark and light, of the tab bar when closing a `sleeping` (or `awaiting-background`) tab —
  "before" from base commit 95cb1de78 (tab closes, no dialog), "after" from the branch (dialog with new
  text). Captured by visual-reviewer.
- Runtime check (closes the "claude.exe exits on abort" unknown): close an idle tab in the dev app and
  record the claude.exe process count before and after; switch workspaces and record that the count does
  not change.
- Write-path trace: only if Task 4.2 changed `saveResumeState` behaviour; tab localStorage format is
  unchanged by this task.
- Follow-ups to record (out of scope): app-quit disposal and crash orphans, backend idle reaper, VS Code
  panel-dispose session end, `/clear` and rewind ending the replaced session.
  - From the Batch 4 review (orchestrator decision, not fixed here): the `retireInterruptedRecord` path
    (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts:123-148`) can
    leave freshly interrupted subagents in the registry with no live record. The new `hadLiveRecord`
    guard in `abortSession` means a later idle abort no longer saves them. The spec fake does not
    exercise retire or an end with an empty `workspaceRoot`.
  - From the Batch 4 review: an existing wipe of resumable state for a restored tab (it predates this
    task).
- PR description note (from the Batch 1 review, no code change): the app-shell delete-session cleanup
  (`app-shell.component.ts:621`) can now show a second "Close Tab?" prompt for an `awaiting-background`
  or `sleeping` tab after the user already confirmed the delete.

- From the Batch 2 review (orchestrator decision): `closedTab` is a single-value signal, so two closes
  in one tick coalesce and the ender sees only the last one. No current caller does this (each awaits
  one close per tick); a comment sits at the effect in `closed-tab-session-ender.service.ts`. Fix later
  with an event queue or array if a batch closer comes back.

- From the Batch 3 review (orchestrator decision): M3 — removing the same folder again quickly (or a
  repeated removal) could re-send aborts or interleave with an earlier removal; not handled here. M4 —
  `_sessionToWorkspace` reverse index can go stale after removal; it repairs itself, but a cleanup on
  removal is a follow-up. M1 (a staying workspace not visited this run is not checked) left as is, with a
  code comment: no live process can exist for such a workspace.

- From the whole-diff review (MIN-3, accepted): after the Batch 4 `hadLiveRecord` guard, resume records
  past the TTL can stay in the durable list after an idle abort. `restoreResumableBySession` already
  refuses expired records, so the user sees no difference.
- From the correction review (moderate, needs a backend change): a registration race. A turn-1 close
  sends `chat:abort` with the tab id; if that arrives before the backend has registered the record for
  that tab, `endSession` returns 'already-ended' and the process that registers next is left running.
- Ptah lane issue (not this repo's code): a shared antigravity CLI session id delivered another
  session's report to this task's lane. Ptah should keep lane session ids per task/session.
- Open item, accepted by the orchestrator, NOT a pass: the claude.exe runtime check (visual-review.md
  Part B) could not be isolated from the user's running app (shared credentials and `~/.ptah`). It is
  deferred to a manual check by the user, with the steps from visual-review.md Part B going into the
  PR test plan. The `chat:abort` tests prove only that the RPC is dispatched, not that claude.exe exits on
  an idle close or survives a workspace switch. This acceptance criterion stays OPEN, and task.md stays
  `in_review` (never `done`) until both lifecycle outcomes are verified in an isolated environment and
  recorded here.
- From the superseded-abort correction review (moderate; orchestrator decision: the revise cap was
  reached, not fixed here): if the tab is closed while `validateSessionExists` runs and the session file
  is missing, the fallback `startNewConversation` (`message-sender.service.ts:610-621`) can still create
  a backend session that no tab owns.

## Batch log

- QA correction — senior-tester (test-report.md) found a real regression from 573f0fa54. When a newer
  send replaced a live first-turn controller (`continueConversation` falling back to
  `startNewConversation` on a missing session file, or a double send during `session:validate`), the
  old listener sent `chat:abort` with the tab id and ended the NEW turn. Fix: `createAbortController`
  aborts a replaced controller with `ABORT_REASON_SUPERSEDED`, and the listener skips `chat:abort` for
  it; a first-turn close still sends it. A new integration spec has 12 tests, and 3 of them fail with
  the guard removed. The independent antigravity review (code-logic-review-superseded.md) was APPROVED
  8/10, with 1 moderate finding moved to the follow-ups. team-leader re-ran nx typecheck, lint and test
  for chat-state, chat, core and canvas before the commits; the SHAs are in the git log.

- Whole-diff correction — whole-diff cross-side review (antigravity lane) APPROVED 8/10. Fixed: MOD-3
  (closing a tab during its first turn leaked the process; the `MessageSenderService` abort listener now
  falls back to the tab id, which the backend registry `find()` resolves) and MIN-2 (the workspace-removal
  confirm counts only the streaming sessions it will actually abort). An independent antigravity review
  of the correction was APPROVED 8/10. MOD-1, MOD-2, MIN-1 and MIN-3 went to the follow-ups and the PR
  note. Commits 573f0fa54 (chat) and 3ad63f714 (core); nx typecheck, lint and test for core and chat re-run by team-leader: all pass.

- Batch 3 — COMPLETE cc1c0e1f2. Code-logic review APPROVED 7/10, 1 serious + 3 moderate, in-process
  same-side (disclosed). Fixed: S1 (a streaming session also open in a staying workspace is no longer
  aborted; one shared `sessionIdsOpenIn` rule, with a test), M2 (a failed RpcResult is logged, with a
  test), and an orphaned JSDoc. I read the diff: ids are captured after backend success and before
  `cleanupWorkspaceState`; no id is aborted twice; cancel or rejection ends nothing. Re-verified:
  typecheck and lint pass for core and chat, and the core and chat tests pass.

- Batch 2 — COMPLETE aa2129688 (10 files, approved deviation). Code-logic review APPROVED 7/10, 4
  moderate findings, in-process same-side (disclosed). Fixed: a switch-safety test with a real
  TabManager, shell wiring asserted in the AppShell and ElectronShell specs, and the event that predates
  the service is skipped. The non-tab surface guard uses `ConversationRegistry` +
  `TabSessionBinding.surfacesFor`. The shell component diffs contain only the import plus the inject (I
  checked). I re-verified: typecheck and lint pass for chat and canvas, and the chat and canvas tests
  pass.

- Batch 4 — COMPLETE fb1119220. Task 4.1 proved the overwrite: case (b), a tab restored after a restart
  and closed unopened, failed 2/6 on unchanged code. Task 4.2 added one guard (`hadLiveRecord`) in
  `abortSession`; the new spec passes 6/6. Code-logic review APPROVED 7/10, in-process same-side
  (disclosed: CLI lanes were busy). The 2 rpc-handlers failures are in untouched files: a voice spec
  timeout under load, and a harness spec that fails because of a stray `%TEMP%\.ptah` directory. I
  re-ran the session specs myself: 11 suites, 127 tests pass. Write path: the readers were traced
  (`restoreResumableBySession` is the only reader of the durable list); stored format unchanged.
- Batch 1 — COMPLETE 6260ca411. Code-logic review APPROVED 7/10, in-process same-side (disclosed).
  Review follow-up 1 fixed: `closeTab` re-reads the tab after the confirm; the missing tests were added.
  Follow-up 2 (canvas cancel) became Task 2.3. I re-verified: typecheck and lint pass for chat-state and
  chat, and the chat-state tests pass. No caller of `closeOtherTabs` or `closeTabsToRight` remains in
  `libs/` or `apps/`.

## Commit standards

- commitlint scope-enum enforced (`.commitlintrc.json` has `chat`, `chat-state`, `core`, `rpc-handlers`,
  `vscode-core`, `task-specs`): Batch 1 `fix(chat-state)`, Batch 2 `fix(chat)`, Batch 3 `fix(core)`,
  Batch 4 `test(rpc-handlers)` or `fix(rpc-handlers)` if Task 4.2 changes code, task-folder files
  `docs(task-specs)`.
- Stage by explicit paths only; message written to a file without BOM and committed with `git commit -F`;
  every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `git stash`.
