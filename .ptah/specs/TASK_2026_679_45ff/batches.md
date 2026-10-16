# Batches - TASK_2026_679_45ff

Total tasks: 26 | Batches: 13 | Complete: 7/13

Worktree root (ROOT): `D:/projects/ptah-extension/.claude-worktrees/previous-sessions-modal`
(branch `feat/previous-sessions-modal`, base `851846797`). Every path below is absolute under ROOT.
Plan line ranges refer to `implementation-plan.md` in this folder.

## Run defaults (recorded, decided from evidence)

- Executors (decisions.md D3, user-pinned): Claude subagents implement. backend-developer for
  Batches 1-2, frontend-developer for Batches 3-11, senior-tester for Batches 12-13.
- Phase reviews: code-logic (plus style where a new public API ships) on the codex CLI lane.
  Implementer family: Claude (Anthropic). Reviewer family: codex (OpenAI). Different family, no exception.
  Visual review (visual-reviewer) after Phase 3, under the D10 Electron coordination.
- Order: backend contract first, then the chat building blocks, then the entry points and the
  switch-over. The old sidebar keeps working in every commit until Batch 10 (the switch-over).
  New services temporarily duplicate shell logic (Batches 3-9); Batch 10 deletes the shell copies.
- Batches run one at a time (sequential). Batches 8-9 (canvas) are file-disjoint from 5-7 and could
  run in parallel, but the "one heavy check at a time" rule (CLAUDE.md) removes the benefit.
- Batch size: at most 6 files and 2 projects. That is why the plan's advisory B0-B6 split into 13.
  Mapping: B0 -> 1, 2 | B1 -> 3, 4 (+ focus-wrap moved to 5) | B2 -> 5, 6 | B3 -> 7 | B5 -> 8, 9 |
  B4 -> 10, 11 | B6 -> 12, 13.
- Task-folder documents (`.ptah/specs/TASK_2026_679_45ff/*`) are not staged with batch commits.
  The orchestrator commits them separately as `docs(task-specs): ...`.

## Verification rules (repeat to every executor; CLAUDE.md, mandatory)

- Verify only the projects the batch changed. Never a workspace-wide check, never `run-many` over
  projects the batch did not change.
- Gate commands (two separate runs, one at a time, foreground, long timeout, output tailed):
  - `npx nx run-many -t typecheck,lint -p <projects> --parallel=1`
  - `npx nx run-many -t test -p <projects> --parallel=1 --maxWorkers=2`
    (confirm the header says "Running target test for N projects" with N = projects requested).
  - Never add `--maxWorkers` to the typecheck/lint run: those typecheck targets are `nx:run-commands`
    (`tsc`/`ngc`) and would receive the flag.
- While iterating: `npx jest -c <lib>/jest.config.ts <spec files> --coverage=false --maxWorkers=2`.
- One heavy check at a time across all agents. Never `build`, `serve`, `dev`, `package`.
  `e2e` only in Batches 12-13, only for the D7/D14 list.
- No git commands by executors. The team-leader commits: foreground, scopes from `.commitlintrc.json`,
  subject <= 72 chars, body lines <= 100 (wrap at 72), trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push.
- Code rules (plan "Inputs and constraints"): Angular standalone + OnPush, `inject()`,
  `input()`/`output()`, signals; imports through `src/index.ts` aliases across libs; no `any`, no
  `as unknown as`; no `console.*` in libs (use `LoggingService`); no element with both `class=""`
  and `[class]=""`; chat never imports `@ptah-extension/canvas`; no TODO/stub/placeholder code.

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- `SessionGetOrganizationResult = SessionOrganizationMutationResult` reuses an existing shape -
  verified (`libs/shared/src/lib/types/rpc/rpc-session.types.ts:136-154`).
- `SESSION_ORGANIZATION_CHANGED` carries `sessionIds` - verified in the producer
  (`session-organization-rpc.handlers.ts:389-391`). The consumer case at
  `chat-message-handler.service.ts:195-197` calls `handleSessionMetadataChanged()` without the payload,
  so Task 3.3 must read `sessionIds` from the payload (type at
  `libs/shared/src/lib/types/messages/payload-map.ts:304-308`).
- `electron-shell.component.ts:51` imports `sessionSidebarWidthFromDividerDrag`, and `:378-418` call
  `begin/apply/commitExternalSidebarResize` on the shell - verified. Batch 10 removes both sides in one
  commit, and Batch 11 deletes `session-sidebar-width.ts` after both are gone.
- The editor reads only `id`, `name`, `organization` from its `session` input - verified by the
  architect (plan Codebase evidence). Task 3.1 builds neutral values for the other fields.
- A1 (no transformed Electron ancestor of `ptah-app-shell`) - unverified. Checked in the Phase 3
  visual review (scrim covers the whole window at 1440 px).
- A2 (`--maxWorkers=2` forwarded to `@nx/jest` by `run-many -t test`) - unverified. Checked in every
  batch's test run (header and worker count). Fallback: `npx jest -c <lib>/jest.config.ts --coverage=false --maxWorkers=2`.
- A3 (webview harness serves the built SPA with the shell row present) - unverified. Checked in Task 13.3.
- All CREATE targets are absent and all MODIFY/DELETE targets exist on disk (checked 2026-10-16
  against base `851846797`).

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| R1. `session:getOrganization` race: a push or a second open arrives while a fetch is in flight, or the editor is closed before it resolves; a stale summary then opens or overwrites | MEDIUM | Task 3.1: latest-request-wins token per open; a push for the in-flight id refetches or supersedes it; a close during the fetch never opens the editor. Spec cases required. |
| R2. Focus restore runs while the panel or shell row is still `inert` | HIGH | Tasks 3.1, 4.2, 5.2, 5.3, 7.2, 9.1: every restore in `afterNextRender` after the state change that removes `inert`; specs assert `document.activeElement` per close path. |
| R3. Organization editor Tab escapes while the modal panel is inert | HIGH | Task 5.3 (component 6b): Tab wrap on `.modal-box`, first/last wrap specs. |
| R4. A document-level Escape listener in canvas also fires | MEDIUM | Tasks 5.2, 5.3, 6.2, 7.2, 9.1: Escape handlers call `stopPropagation()`; specs assert it. |
| R5. The Rail menu close steals focus from the Rename popover | MEDIUM | Task 9.1: DP-6 nesting plus one `afterNextRender` handoff; spec asserts the input is focused after both renders. |
| R6. A newly persisted session has no metadata yet, so `getOrganization` answers `session-not-found` | LOW | Task 1.2 spec covers not-found; Task 9.1 shows the `'failed'` announcement instead of opening. |
| R7. Fixed modal confined by a transformed Electron ancestor (A1) | LOW | Phase 3 visual review. If it fails, fix the ancestor; do not move the modal outside the shell. |
| R8. Deleting `.sidebar-item-active` (design 3.7) breaks the Workspaces sidebar | MEDIUM | Task 11.1 keeps both rules (DP-3); Phase 3 visual review checks the Workspaces active row. |
| R9. Shell logic duplicated in new services between Batches 3 and 9 | LOW | Batch 10 deletes the shell copies; Task 11.1 runs the removed-symbol grep gate over `apps/` and `libs/`. |
| R10. `canvas.spec.ts` strict-mode failure (two Rail footer buttons) | HIGH if missed | Task 13.1 updates it; D14 run. |
| R11. Harness scenarios pass vacuously when the SPA placeholder is served | MEDIUM | Task 13.3: hard expectation once booted; tester confirms `#ptah-e2e-fixture-root` absent per run. |
| R12. Docs-shot runs leave regenerated tracked PNGs | HIGH | Task 13.2: revert `apps/ptah-docs/public/screenshots` after the run (DP-12). |
| R13. Electron contention with TASK_2026_681 (port 9351) or the stale 9333 entry | MEDIUM | Batches 12-13 and the visual review start only after the orchestrator has 681's "Electron: free" and has announced per D10; never ports 9333 or 9351. |
| R14. The perf spec helper path is not executed by default | LOW | DP-13: stays skip-gated; shared helpers exercised by three other specs in Batch 12; header disclosure in Task 12.2. |
| R15. Merge overlap with TASK_2026_681 (chat UI, app-shell / canvas-rail) | MEDIUM | Not a batch task. Orchestrator checks overlap before the PR (context.md "Electron coordination"). |

Edge cases:

- Persisted Rail session outside the loaded page or filters - handled in Tasks 3.1 and 9.1.
- Draft Rail card (`claudeSessionId === null`): Organize disabled with "Send a first message to save this
  session." - handled in Task 9.1.
- VS Code host: `session:getOrganization` answers `organization-unavailable`; the Rail shows no Organize -
  handled in Tasks 1.2, 2.1 and 9.1.
- `ok:false` or a transport error from `getOrganization`: `'failed'`, logged, editor not opened - handled in Task 3.1.
- Opener gone when the modal closes: focus the first visible `[data-previous-sessions-trigger]` - handled in Task 4.2.
- Modal open when the shell switches to a standalone view: close without restore (DP-9) - handled in Task 10.1.
- Delete of the session the editor shows: `closeIfShowing` - handled in Task 3.2.
- Rename empty, unchanged or longer than 200: no RPC or capped - handled in Task 3.2.
- Close and reopen keeps query state with no new `session:list` (Req 2.9) - handled in Tasks 4.1 and 7.2.
- Text typed in the last 250 ms before close is dropped - accepted (DP-14), no task.

---

## Phase 1: Backend read RPC (Batches 1-2)

Phase review: code-logic + style (new public RPC method `session:getOrganization`), codex lane.

Phase 1 — COMPLETE. Reviews on `851846797..a83cf71cf` (codex CLI lane 1ebf7d33; implementer family
Claude, reviewer family codex/OpenAI, no same-family exception):

- `reviews/phase-1-code-logic-review.md` — APPROVED 8/10 (0 Blocking, 0 Serious, 1 Moderate)
- `reviews/phase-1-code-style-review.md` — APPROVED 8/10 (no findings)

Fix round: none. The one Moderate finding is a test-coverage gap that cannot break a lane config or
lose data (production guard at `session-organization-rpc.handlers.ts:301-305` is correct), so per
the fix-round rule it is deferred to a named later task:

- Follow-up FU-1 "getOrganization store-close race spec" (not in this run): in
  `libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.handlers.spec.ts:1106-1119`,
  make `queryWorkspace` or `countChildren` close the fake store during the read, assert both reads
  ran, and assert the `organization-unavailable` response, so the spec pins the post-read guard
  instead of the second `isAvailable()` call count. Scope: one spec file in
  `@ptah-extension/rpc-handlers`; verify with scoped Jest on that spec.

## Batch 1: session:getOrganization read RPC — COMPLETE (commit 2244c176d)

- Recommended executor: Claude subagent `backend-developer`
- Execution mode: sequential
- Fallback order: fresh backend-developer subagent -> CLI lane with implementation capability whose
  family differs from the reviewer's (then the reviewer moves to another family)
- Subagent reason: user-pinned executor policy (decisions.md D3: Claude subagents implement)
- Review family: different from implementer (Claude implements, codex reviews)
- Rationale: one contract change across the shared registry and its one handler; two dependent tasks
- Tasks: 2 | Depends on: none
- Phase: 1 | Phase review: code-logic + style (deferred to end of Batch 2)
- Plan components: Gate 2 choice option (a) (`implementation-plan.md:160-241`), D13
- Projects: `@ptah-extension/shared`, `@ptah-extension/rpc-handlers`

Files (5):
- MODIFY `ROOT/libs/shared/src/lib/types/rpc/rpc-session.types.ts`
- MODIFY `ROOT/libs/shared/src/lib/types/rpc.types.ts`
- MODIFY `ROOT/libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.schema.ts`
- MODIFY `ROOT/libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.handlers.ts`
- MODIFY `ROOT/libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.handlers.spec.ts`

### Task 1.1: Shared RPC types and registry entries — COMPLETE

- Files: `ROOT/libs/shared/src/lib/types/rpc/rpc-session.types.ts`, `ROOT/libs/shared/src/lib/types/rpc.types.ts`
- Plan reference: implementation-plan.md:191-196
- Pattern to follow: `SessionSetOrganizationParams`/`SessionSetOrganizationResult` (`rpc-session.types.ts:136-160`);
  registry entries near `rpc.types.ts:825` and `RPC_METHOD_ENTRIES` near `:3764`
- Quality requirements: `SessionGetOrganizationParams { sessionId: string }`;
  `SessionGetOrganizationResult = SessionOrganizationMutationResult`; both registry entries (typed and runtime)
- Validation notes: the host-source baseline does not cover `session:*` (no baseline edit, plan:75)
- Implementation details: add the two types, add `'session:getOrganization'` to `RpcMethodRegistry` and
  `RPC_METHOD_ENTRIES` so `RPC_METHOD_NAMES` derives it.

### Task 1.2: Handler, schema and spec — COMPLETE

- Depends on: Task 1.1
- Files: `...session-organization-rpc.schema.ts`, `...session-organization-rpc.handlers.ts`, `...session-organization-rpc.handlers.spec.ts`
- Plan reference: implementation-plan.md:197-218; review r1 Minor (describe cost as workspace-wide read, then ID lookup)
- Pattern to follow: `session-organization-rpc.handlers.ts:105-112` (`METHODS`), `:185-200` (registration),
  `:298-347` (`authorizeSession`, `withMissingTasks`), `:350-383` (error sanitising)
- Quality requirements: no broadcast; no store/service change in `libs/backend/session-organization`;
  the handler's doc comment says "workspace-wide read, then ID lookup"
- Validation notes: R6 (not-found for a session without metadata)
- Implementation details: `SessionGetOrganizationParamsSchema` reuses `SessionIdParamSchema`; add the method to
  `METHODS`; `registerGetOrganization()` = parse -> `UNAVAILABLE` when no store -> `authorizeSession` (null ->
  `NOT_FOUND`) -> `toSessionOrganizationSummary(queryWorkspace(root).get(id), countChildren(root).get(id) ?? 0, new Set())`
  -> `withMissingTasks` -> sanitised errors. Update the exact method-count assertion in the spec.
  Spec cases: unavailable, not found, unauthorized workspace, defaults with no stored row, stored values plus
  `childCount`, missing-task flag, invalid params.

### Batch 1 verification

- Both tasks' artifacts exist with real implementations and the seven spec cases
- `npx nx run-many -t typecheck,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1`
- `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1 --maxWorkers=2`
  (header: "Running target test for 2 projects")
- Guard spec in the edited lib (part of the test run above): `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts`
  and `libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts` pass
- No per-batch review; Phase 1 review after Batch 2
- Commit: `feat(shared,rpc-handlers): batch 1 - session:getOrganization read RPC`

## Batch 2: Host guard specs for the read RPC — COMPLETE (commit a83cf71cf; Phase 1 reviews APPROVED: reviews/phase-1-code-logic-review.md, reviews/phase-1-code-style-review.md)

- Recommended executor: Claude subagent `backend-developer` (resume the Batch 1 executor if its last
  activity was under 5 minutes ago)
- Execution mode: sequential
- Fallback order: fresh backend-developer subagent -> CLI lane (implementation, non-reviewer family)
- Subagent reason: user-pinned executor policy (D3)
- Review family: different from implementer (codex)
- Rationale: the VS Code guard spec is a third project; the 2-project limit puts it in its own batch,
  together with the scoped runs of the three host rpc-surface specs
- Tasks: 1 | Depends on: Batch 1
- Phase: 1 (last batch) | Phase review: code-logic + style on the Phase 1 diff
- Plan components: Gate 2 choice option (a) correction 1 (`implementation-plan.md:162-169, 219-238`), D13
- Projects: `ptah-extension-vscode` (one spec file; no other edit)

Files (1):
- MODIFY `ROOT/apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts`

### Task 2.1: VS Code `organization-unavailable` case for the read method — COMPLETE

- File: `ROOT/apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts`
- Plan reference: implementation-plan.md:162-169; implementation-plan-review.md "Re-review r1" finding 1
- Pattern to follow: the `MUTATIONS` unavailable cases in the same file (`:48-57`, `:146-170`)
- Quality requirements: a separate read-method case (do not add the read to the `MUTATIONS` list name);
  asserts `{ ok: false, reason: 'organization-unavailable' }` for `session:getOrganization`
- Validation notes: VS Code edge case (Rail never calls it there; the backend must still answer)
- Implementation details: add one `it` (or a small `READS` list) that invokes the registered
  `session:getOrganization` handler on the VS Code container and expects the unavailable result.

### Batch 2 verification

- Scoped Jest only (these host projects are not otherwise edited; never their full `nx test`):
  - `npx jest -c apps/ptah-extension-vscode/jest.config.ts apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts --coverage=false --maxWorkers=2`
  - `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/di/rpc-surface.spec.ts --coverage=false --maxWorkers=2`
  - `npx jest -c libs/backend/cli-engine/jest.config.cjs libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts --coverage=false --maxWorkers=2`
- One run at a time. `npx nx lint ptah-extension-vscode` is not run (spec-only change; lint-staged
  lints the staged file at commit)
- Commit: `test(vscode): batch 2 - getOrganization unavailable case`
- Then return NEEDS REVIEW for Phase 1 (code-logic + style, codex)

---

## Phase 2: Chat modal building blocks (Batches 3-7)

Phase review: code-logic + style (new public exports from `@ptah-extension/chat`: four services and
`SESSION_NAME_MAX_LENGTH`), codex lane.

## Batch 3: Organizer and row-action services — COMPLETE (commit aad99feb6)

- Recommended executor: Claude subagent `frontend-developer`
- Execution mode: sequential
- Fallback order: fresh frontend-developer subagent -> CLI lane (implementation, non-reviewer family)
- Subagent reason: user-pinned executor policy (D3)
- Review family: different from implementer (codex)
- Rationale: `SessionRowActionsService.deleteSession` calls `organizer.closeIfShowing`, and the push hook
  calls `organizer.onOrganizationChanged`; the three tasks share one dependency chain
- Tasks: 3 | Depends on: Batch 1 (registry type for `session:getOrganization`)
- Phase: 2 | Phase review: deferred to end of Batch 7
- Plan components: 4 (incl. option (a) parts), 2
- Projects: `@ptah-extension/chat`

Files (6):
- CREATE `ROOT/libs/frontend/chat/src/lib/services/session-list/session-organizer.service.ts`
- CREATE `ROOT/libs/frontend/chat/src/lib/services/session-list/session-organizer.service.spec.ts`
- CREATE `ROOT/libs/frontend/chat/src/lib/services/session-list/session-row-actions.service.ts`
- CREATE `ROOT/libs/frontend/chat/src/lib/services/session-list/session-row-actions.service.spec.ts`
- MODIFY `ROOT/libs/frontend/chat/src/lib/services/chat-message-handler.service.ts`
- MODIFY `ROOT/libs/frontend/chat/src/lib/services/chat-message-handler.service.spec.ts`

### Task 3.1: SessionOrganizerService with `openForSession` and one-entry cache — COMPLETE

- Files: `session-organizer.service.ts`, `session-organizer.service.spec.ts`
- Plan reference: implementation-plan.md:411-466 (option (a) branches apply; ignore (b)/(c))
- Pattern to follow: the `linkedSignal` at `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:409-432` (copy, do not edit the shell)
- Quality requirements: root service; `afterNextRender(..., { injector })` with the root injector for restore
  (DP-5); `LoggingService` for failures; no `console.*`
- Validation notes: R1 (race) and R2 (inert restore). Required spec cases beyond the plan list: close while a
  fetch is in flight does not open; a second `openForSession` supersedes the first; a push for the in-flight id
  does not let a stale result win.
- Implementation details: `available`, `session` (loaded row ?? cached entry ?? previous copy), `isOpen`,
  `rowFor`, `open`, `close` (drops the cache entry, then restore after render), `closeIfShowing`,
  `openForSession(sessionId, name, restoreFocus)` calling `ClaudeRpcService.call('session:getOrganization', …)`
  and `onOrganizationChanged(sessionIds)`.

### Task 3.2: SessionRowActionsService (open, rename, delete) — COMPLETE

- Depends on: Task 3.1
- Files: `session-row-actions.service.ts`, `session-row-actions.service.spec.ts`
- Plan reference: implementation-plan.md:331-377
- Pattern to follow: shell logic at `app-shell.component.ts:859-865` (open), `:910-934` (rename), `:937-982`
  (delete) - moved by copy; the shell copies are deleted in Batch 10
- Quality requirements: export `SESSION_NAME_MAX_LENGTH = 200`; `'failed'` paths log through
  `LoggingService.error('SessionRowActions', …)`; workspace path captured before the confirm
- Validation notes: edge cases rename empty/unchanged/>200, delete of the session the editor shows
- Implementation details: migrate the two delete tests from `app-shell.organization.spec.ts:322, 345` (titles
  kept; leave the originals in place until Batch 10) and add the plan's rename/open cases.

### Task 3.3: Push hook for a cached organizer session — COMPLETE

- Depends on: Task 3.1
- Files: `chat-message-handler.service.ts`, `chat-message-handler.service.spec.ts`
- Plan reference: implementation-plan.md:461-463
- Pattern to follow: the existing case at `chat-message-handler.service.ts:195-197`
- Quality requirements: keep `handleSessionMetadataChanged()` unchanged; add one call
- Validation notes: the case currently ignores the payload; read `sessionIds` from the typed payload
  (`payload-map.ts:304-308`)
- Implementation details: in the `SESSION_ORGANIZATION_CHANGED` branch also call
  `organizer.onOrganizationChanged(payload.sessionIds)`; add one spec case.

### Batch 3 verification

- Every listed file exists; no shell file edited
- Iterate: `npx jest -c libs/frontend/chat/jest.config.ts <the three specs> --coverage=false --maxWorkers=2`
- Gate: `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=1`, then
  `npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2`
- Commit: `feat(chat): batch 3 - session organizer and row action services`

Accepted 2026-10-16 (team-leader):
- Executor: frontend-developer (Claude). Report: reports/batch-3-report.md.
- Verified on disk: 4 created and 2 modified files; no shell file edited. The organizer covers R1
  (pendingOpen/pendingRefresh tokens, re-read on a push for the in-flight id) and R2 (restore in
  `afterNextRender` on the root injector, after `sessionId`/`fetched` are cleared).
- The team-leader re-ran both gates: typecheck+lint passed; lint `--skip-nx-cache` passed with 0
  errors. Tests `--skip-nx-cache` covered 1 project (header "Running target test for project
  @ptah-extension/chat", `--maxWorkers=2` forwarded, A2): 214 suites, 3999 passed, 2 skipped.
- Executor decisions accepted as D16-D19 (decisions.md). Task 9.1 notes updated for `'cancelled'`.
- Minor, recorded and not fixed (Phase 2 review input): `chat-message-handler.service.ts` is now
  705 lines, so it gets a new `max-lines` (700) warning. Its header comment does not list
  `SESSION_ORGANIZATION_CHANGED`. The full test run printed a "worker failed to exit gracefully"
  warning; the 3 Batch 3 specs run alone do not print it, so it comes from an older suite.

## Batch 4: List view store, dialog service and exports — COMPLETE (commit d0cd1ac0c)

- Recommended executor: Claude subagent `frontend-developer`
- Execution mode: sequential
- Fallback order: fresh frontend-developer subagent -> CLI lane (implementation, non-reviewer family)
- Subagent reason: user-pinned executor policy (D3)
- Review family: different from implementer (codex)
- Rationale: the last two root services plus the one barrel edit that exports all four (canvas needs them
  from `@ptah-extension/chat` in Batches 8-9)
- Tasks: 3 | Depends on: Batch 3
- Phase: 2 | Phase review: deferred to end of Batch 7
- Plan components: 1, 3, and the `S/index.ts` part of 4
- Projects: `@ptah-extension/chat`

Files (5):
- CREATE `ROOT/libs/frontend/chat/src/lib/services/session-list/session-list-view.store.ts`
- CREATE `ROOT/libs/frontend/chat/src/lib/services/session-list/session-list-view.store.spec.ts`
- CREATE `ROOT/libs/frontend/chat/src/lib/services/session-list/previous-sessions-dialog.service.ts`
- CREATE `ROOT/libs/frontend/chat/src/lib/services/session-list/previous-sessions-dialog.service.spec.ts`
- MODIFY `ROOT/libs/frontend/chat/src/lib/services/index.ts`

### Task 4.1: SessionListViewStore — COMPLETE

- Files: `session-list-view.store.ts`, `.spec.ts`
- Plan reference: implementation-plan.md:299-330
- Pattern to follow: shell signals at `app-shell.component.ts:313-320, 327-393, 790-808, 823-836` (copy)
- Quality requirements: `filteredSessions` is one `computed` over `ChatStore.sessions()`; no timers or listeners
- Validation notes: Req 2.9 / B-16 (no extra `setListQuery` on reopen)
- Implementation details: spec cases B-1, B-14, B-15, `hasServerFilters` false when unavailable, state survives.

### Task 4.2: PreviousSessionsDialogService — COMPLETE

- Files: `previous-sessions-dialog.service.ts`, `.spec.ts`
- Plan reference: implementation-plan.md:378-410
- Pattern to follow: Task 3.1's root-injector `afterNextRender`
- Quality requirements: `open()` no-op when open; opener from `inject(DOCUMENT).activeElement`
- Validation notes: R2; edge case "opener gone" -> first visible `[data-previous-sessions-trigger]`
- Implementation details: `isOpen`, `open()`, `close({ restoreFocus })` with the connected/not-inert/visible checks.

### Task 4.3: Barrel exports — COMPLETE

- Depends on: Tasks 4.1, 4.2
- File: `ROOT/libs/frontend/chat/src/lib/services/index.ts`
- Plan reference: implementation-plan.md:458-460
- Pattern to follow: existing named exports in `services/index.ts:1-15`
- Quality requirements: named exports only for the four services and `SESSION_NAME_MAX_LENGTH`
- Validation notes: none
- Implementation details: add five named exports.

### Batch 4 verification

- Every listed file exists
- Gate: `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=1`, then
  `npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2`
- Commit: `feat(chat): batch 4 - session list view store and dialog service`

Accepted 2026-10-16 (team-leader):
- Executor: frontend-developer (Claude). Report: reports/batch-4-report.md.
- Verified on disk: 4 created and 1 modified file (barrel: 5 named exports, nothing else); no shell
  file edited. `filteredSessions` is one `computed` with no timers or listeners; `clearFilters` keeps
  sort/groupBy (B-15). The dialog service covers R2 (restore in `afterNextRender` on the root
  injector; spec uses an OnPush host with an `[attr.inert]` binding) and the "opener gone" edge case
  (first visible `[data-previous-sessions-trigger]`).
- The team-leader re-ran both gates with `--skip-nx-cache`: typecheck+lint passed. Tests covered 1
  project (header "Running target test for project @ptah-extension/chat", `--maxWorkers=2`
  forwarded): 216 suites, 4030 passed, 2 skipped (+2 suites, +31 tests over Batch 3).
- Executor decisions accepted as D20-D24 (decisions.md). D20 (no main-region focus fallback) is a
  Phase 3 visual-review check.
- Minor, recorded and not fixed: the "worker failed to exit gracefully" warning from Batch 3 still
  prints; it does not come from the Batch 4 specs.

## Batch 5: Focus trap and nested dialog a11y — COMPLETE (commit b896b7787)

- Recommended executor: Claude subagent `frontend-developer`
- Execution mode: sequential
- Fallback order: fresh frontend-developer subagent -> CLI lane (implementation, non-reviewer family)
- Subagent reason: user-pinned executor policy (D3)
- Review family: different from implementer (codex)
- Rationale: the util and its two existing-dialog consumers form one a11y change
- Tasks: 3 | Depends on: none (may follow Batch 4 in order)
- Phase: 2 | Phase review: deferred to end of Batch 7
- Plan components: 5, 6a, 6b
- Projects: `@ptah-extension/chat`

Files (6):
- CREATE `ROOT/libs/frontend/chat/src/lib/utils/focus-wrap.utils.ts`
- CREATE `ROOT/libs/frontend/chat/src/lib/utils/focus-wrap.utils.spec.ts`
- MODIFY `ROOT/libs/frontend/chat/src/lib/components/molecules/confirmation-dialog.component.ts`
- CREATE `ROOT/libs/frontend/chat/src/lib/components/molecules/confirmation-dialog.component.spec.ts`
- MODIFY `ROOT/libs/frontend/chat/src/lib/components/molecules/session-organization-editor/session-organization-editor.component.ts`
- MODIFY `ROOT/libs/frontend/chat/src/lib/components/molecules/session-organization-editor/session-organization-editor.component.spec.ts`

### Task 5.1: `wrapTabWithin` util — COMPLETE

- Files: `focus-wrap.utils.ts`, `.spec.ts`
- Plan reference: implementation-plan.md:467-489
- Pattern to follow: `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:37-55, 735-751` (do not edit it)
- Quality requirements: ignores non-Tab and modified keys; skips disabled, `[hidden]`, `[inert]`, invisible
- Validation notes: none
- Implementation details: wrap first <-> last; `preventDefault` when no tabbables.

### Task 5.2: ConfirmationDialogComponent semantics, focus, Escape, trap — COMPLETE

- Depends on: Task 5.1
- Files: `confirmation-dialog.component.ts`, `confirmation-dialog.component.spec.ts` (new)
- Plan reference: implementation-plan.md:490-527
- Pattern to follow: `confirmation-dialog.component.ts:20-60, 97-107`
- Quality requirements: `role="dialog"`, `aria-modal`, `aria-labelledby`/`aria-describedby` with unique ids;
  initial focus on Cancel; text, order and buttons unchanged
- Validation notes: R2, R4 (Escape `stopPropagation`)
- Implementation details: effect on `isOpen()` with `untracked` stores the opener; focus in `afterNextRender`;
  restore after close; spec covers role/name, initial focus, Escape, Tab wrap, focus return.

### Task 5.3: SessionOrganizationEditorComponent trap and post-render restore — COMPLETE

- Depends on: Task 5.1
- Files: `session-organization-editor.component.ts`, `.spec.ts`
- Plan reference: implementation-plan.md:528-563
- Pattern to follow: editor `:107-115`, `:561-564`, `:752-769`
- Quality requirements: content, verbs and errors unchanged; synchronous restore at `:767` moves into
  `afterNextRender`
- Validation notes: R3 (Gate 2 finding 1), R2, R4
- Implementation details: `(keydown)` on the `<dialog>` wraps Tab over `.modal-box` (`viewChild`);
  `onEscape` adds `stopPropagation()`; spec: first/last wrap, Escape, focus return after the opener's
  container loses `inert`.

### Batch 5 verification

- Every listed file exists
- Gate: `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=1`, then
  `npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2`
- The existing editor and shell organization specs still pass (the old sidebar still uses the editor)
- Commit: `feat(chat): batch 5 - focus trap for confirm and organizer dialogs`

Accepted 2026-10-16 (team-leader):
- Executor: frontend-developer (Claude). Report: reports/batch-5-report.md.
- Verified on disk: 3 created and 3 modified files, exactly the listed six; canvas file untouched;
  no chat import from `@ptah-extension/canvas`; no skip/only/TODO/console. Spec cases on disk:
  focus-wrap 6, confirm dialog 10, editor 15 (10 existing + 5 new). R2 (restore in
  `afterNextRender`, specs use an `[attr.inert]` host), R3 (editor Tab wrap over `#modalBox`) and
  R4 (Escape `stopPropagation` in both dialogs, document-listener spec) are carried.
- Team-leader gates with `--skip-nx-cache`: typecheck+lint passed (plus `eslint` on the three
  sources: no `max-lines` warning). Tests covered 1 project (`--maxWorkers=2` forwarded): 218
  suites, 4051 passed, 2 skipped (+2 suites, +21 tests over Batch 4).
- Plan deviations in 5.3 (template ref instead of `viewChild`; open-state guard instead of a stored
  `AfterRenderRef`) accepted as D25-D26; other executor decisions D27-D29. Restore callback order
  (owner before editor) accepted as D30 and carried to Tasks 7.2 and 9.1.
- The editor is now just under the 700-line `max-lines` limit: any later growth there needs an
  extraction, not a suppression.
- Minor, recorded and not fixed: the "worker failed to exit gracefully" warning from Batch 3.

## Batch 6: Toolbar, row and filter-bar molecules — COMPLETE (commit d3da763ec)

- Recommended executor: Claude subagent `frontend-developer`
- Execution mode: sequential
- Fallback order: fresh frontend-developer subagent -> CLI lane (implementation, non-reviewer family)
- Subagent reason: user-pinned executor policy (D3)
- Review family: different from implementer (codex)
- Rationale: presentational molecules the modal composes; the toolbar hosts the filter bar
- Tasks: 2 | Depends on: Batch 3 (`SESSION_NAME_MAX_LENGTH`), Batch 4 (types)
- Phase: 2 | Phase review: deferred to end of Batch 7
- Plan components: 8a, 8b, filter-bar changes
- Projects: `@ptah-extension/chat`

Files (5):
- CREATE `ROOT/libs/frontend/chat/src/lib/components/molecules/previous-sessions-toolbar/previous-sessions-toolbar.component.ts`
- CREATE `ROOT/libs/frontend/chat/src/lib/components/molecules/session-list-row/session-list-row.component.ts`
- CREATE `ROOT/libs/frontend/chat/src/lib/components/molecules/session-list-row/session-list-row.component.spec.ts`
- MODIFY `ROOT/libs/frontend/chat/src/lib/components/molecules/session-filter-bar/session-filter-bar.component.ts`
- MODIFY `ROOT/libs/frontend/chat/src/lib/components/molecules/session-filter-bar/session-filter-bar.component.spec.ts`

### Task 6.1: Filter bar class changes and PreviousSessionsToolbarComponent — COMPLETE

- Files: `session-filter-bar.component.ts`, `.spec.ts`, `previous-sessions-toolbar.component.ts`
- Plan reference: implementation-plan.md:661-687, 727-733; design-spec 3.4
- Pattern to follow: toolbar markup moved from `app-shell.component.html:123-221` (copy; shell untouched)
- Quality requirements: filter bar class/wrapper changes only (one wrapping toolbar >= 640,
  `placeholder:text-base-content-muted`, `max-h-[min(34rem,70dvh)] overflow-y-auto` on popover content);
  toolbar is presentational (no services); `data-testid="session-search-local"`, `aria-label`s per plan
- Validation notes: the toolbar has no own spec; the modal spec (Task 7.2) covers it
- Implementation details: filter-bar spec adds B-7 (task id debounced into `taskId`) and B-2 (clear X).

### Task 6.2: SessionListRowComponent (`li[ptah-session-list-row]`) — COMPLETE

- Files: `session-list-row.component.ts`, `.spec.ts`
- Plan reference: implementation-plan.md:689-726; D12; DP-4
- Pattern to follow: selector exception at `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts:41-43`
- Quality requirements: `.session-row-current` / `.session-row-open-tab` are host classes styled in the
  component and paint the whole `li` incl. the chips line (D12); 24x24 action targets; actions visible on
  `hover: none`; maxlength 200
- Validation notes: R4 (rename Escape `stopPropagation`)
- Implementation details: spec cases C-3, C-4, C-5/D12, C-6, D-2, C-10.

### Batch 6 verification

- Every listed file exists
- Gate: `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=1`, then
  `npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2`
- Commit: `feat(chat): batch 6 - previous sessions toolbar and list row`

Accepted 2026-10-16 (team-leader):
- Executor: frontend-developer (Claude). Report: reports/batch-6-report.md.
- Verified on disk: 3 created and 2 modified files, exactly the listed five; no shell file touched.
  Filter-bar diff is class/wrapper only (debounce, emission, `linkedSignal` seeds and timer release
  unchanged). Toolbar has no services or state. Row: host classes and `:host(...)` rules paint the
  whole `li` incl. the chips line (D12); actions 24 x 24, visible under `hover: none`; rename field
  `maxlength` from `SESSION_NAME_MAX_LENGTH`; R4 Escape `preventDefault` + `stopPropagation`.
  Spec cases on disk: row 24 (C-3, C-4, C-5/D12, C-6, C-10, D-2, R4), filter bar +4 (B-7, B-2 x2,
  design 3.4 classes).
- Team-leader gates with `--skip-nx-cache`: typecheck+lint passed. Tests covered 1 project
  (`--maxWorkers=2` forwarded): 219 suites, 4079 passed, 2 skipped (+1 suite, +28 tests over
  Batch 5).
- Executor decisions B6-1..B6-9 accepted as D31-D39; side effects accepted as D40 (old sidebar
  layout until Batch 10) and D41 (new molecules not barrel-exported; Task 7.2 imports them by
  relative path).
- Carried to Task 7.2: bind `renameCommitted` and move focus only after `'enter'` (D32); keep the
  modal double-fire guard (D33); do not focus the rename field from the modal (D34); the
  toolbar's `role="search"` is on the plain variant only (D31).
- Minor, recorded and not fixed: the "worker failed to exit gracefully" warning (since Batch 3).

## Batch 7: PreviousSessionsModalComponent — COMPLETE (commit 7c1ac3a32; Phase 2 review pending)

- Recommended executor: Claude subagent `frontend-developer`
- Execution mode: sequential
- Fallback order: fresh frontend-developer subagent -> CLI lane (implementation, non-reviewer family)
- Subagent reason: user-pinned executor policy (D3)
- Review family: different from implementer (codex)
- Rationale: the smart organism and its moved grouping module; it is not hosted until Batch 10
- Tasks: 2 | Depends on: Batches 3-6
- Phase: 2 (last batch) | Phase review: code-logic + style on the Phase 2 diff (codex)
- Plan components: 7
- Projects: `@ptah-extension/chat`

Files (5):
- CREATE `ROOT/libs/frontend/chat/src/lib/components/organisms/previous-sessions/session-row-groups.ts`
- CREATE `ROOT/libs/frontend/chat/src/lib/components/organisms/previous-sessions/session-row-groups.spec.ts`
- CREATE `ROOT/libs/frontend/chat/src/lib/components/organisms/previous-sessions/previous-sessions-modal.component.ts`
- CREATE `ROOT/libs/frontend/chat/src/lib/components/organisms/previous-sessions/previous-sessions-modal.component.html`
- CREATE `ROOT/libs/frontend/chat/src/lib/components/organisms/previous-sessions/previous-sessions-modal.component.spec.ts`

### Task 7.1: Moved grouping module — COMPLETE

- Files: `organisms/previous-sessions/session-row-groups.ts`, `.spec.ts`
- Plan reference: implementation-plan.md:651-654
- Pattern to follow: `ROOT/libs/frontend/chat/src/lib/components/templates/session-row-groups.ts` (copy; the old
  file stays until Batch 11 so every commit typechecks)
- Quality requirements: only the label import path changes
- Validation notes: none
- Implementation details: spec from `app-shell.organization.spec.ts:734-815` (copy; originals stay until Batch 10).

### Task 7.2: Modal organism — COMPLETE

- Depends on: Task 7.1
- Files: `previous-sessions-modal.component.ts`, `.html`, `.spec.ts`
- Plan reference: implementation-plan.md:564-660; design-spec 3-4, 11; DP-2, DP-9, DP-10
- Pattern to follow: prototype `prototype/index.html`, `prototype/assets/app.js`, `prototype/assets/modal.css`
- Quality requirements: component name and test ids exactly `PreviousSessionsModalComponent`,
  `previous-sessions-modal`, `previous-sessions-list`; filter bar rendered directly (no inner defer, DP-10);
  panel `inert` while the editor or confirm dialog is open; Escape `stopPropagation`
- Validation notes: R2, R4; edge cases reopen-keeps-state and delete focus. D30 (from Batch 5): the
  organizer's `restoreFocus` runs before the editor's own restore in the same render; the spec must
  close the editor opened from a row and assert the final `document.activeElement` after the close
  render (the row's Organize button, with the panel no longer inert). A mismatch is fixed on the
  owner side per D30.
- Implementation details: spec carries the `app-shell.organization.spec.ts` tests listed at plan:636-640 (titles
  kept, retargeted to `[data-testid="previous-sessions-list"]`) plus Req 2.1-2.9, D-1, D-10/D-11, E-1, E-2, E-4.

### Batch 7 verification

- Every listed file exists; no shell file edited
- Gate: `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=1`, then
  `npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2`
- Commit: `feat(chat): batch 7 - previous sessions modal`
- Then return NEEDS REVIEW for Phase 2 (code-logic + style, codex)

Accepted 2026-10-16 (team-leader):
- Executor: frontend-developer (Claude). Report: reports/batch-7-report.md.
- Verified on disk: exactly the five listed files created; nothing else under `libs/` or `apps/`
  changed; no shell or barrel file touched. `session-row-groups.ts` differs from the templates copy
  by the label import path only (`git diff --no-index`: 1 line). Component 579 lines (< 700),
  standalone + OnPush, no inputs/outputs; Escape `preventDefault` + `stopPropagation`, ignored
  during IME, when `defaultPrevented` or while a nested layer is open (R4); panel `inert` while the
  editor or confirm is open; every focus move in `afterNextRender` with a `destroyed` guard (R2);
  rename double-fire guard (D33), focus to Rename only on `'enter'` (D32), no rename-field focus
  (D34). No TODO / `console.` / `any` / `as unknown as` / canvas import in the folder.
- Team-leader gates with `--skip-nx-cache`: typecheck+lint passed. Tests covered 1 project
  (`--maxWorkers=2` forwarded): 221 suites, 4131 passed, 2 skipped (+2 suites, +52 tests over
  Batch 6).
- Executor decisions B7-1..B7-14 accepted as D42-D55. B7-8 (header-button focus guard, D49) is
  owner-side, fires only after a click on a header button and only when focus fell to `<body>`;
  it leaves Batch 6 files unchanged.
- Carried to Batch 10: D54 (shell specs that assert the opener restore use
  `fixture.autoDetectChanges()`), D53 (delete the shell's expired-transcript constant, R9), D52
  (shell `session-group-*` ids go with the sidebar).
- Minor, recorded and not fixed: the "worker failed to exit gracefully" warning (since Batch 3).

---

## Phase 3: Entry points and sidebar removal (Batches 8-11)

Phase review: code-logic (codex) + visual (visual-reviewer; Electron 1440/760/400 px, dark and light;
checks listed at implementation-plan.md:1232-1240; D10 coordination; never ports 9333/9351).
No style review: no new lib-level public API in this phase.

## Batch 8: Rail footer "Previous sessions" button — PENDING

- Recommended executor: Claude subagent `frontend-developer`
- Execution mode: sequential
- Fallback order: fresh frontend-developer subagent -> CLI lane (implementation, non-reviewer family)
- Subagent reason: user-pinned executor policy (D3)
- Review family: different from implementer (codex)
- Rationale: footer output plus the board wiring to the chat root service (DP-1); one coupled change
- Tasks: 1 | Depends on: Batch 4 (exported `PreviousSessionsDialogService`)
- Phase: 3 | Phase review: deferred to end of Batch 11
- Plan components: 9 (footer part), D5
- Projects: `@ptah-extension/canvas`

Files (5):
- MODIFY `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts`
- MODIFY `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.spec.ts`
- MODIFY `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`
- MODIFY `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts`
- MODIFY `ROOT/libs/frontend/canvas/src/lib/orchestra-canvas.component.ts` (comment only)

### Task 8.1: Footer button, output and board wiring — PENDING

- Files: the five above
- Plan reference: implementation-plan.md:736-760 (footer), 818-827 (seam), 838-845
- Pattern to follow: the existing New session footer button in `canvas-rail.component.ts`
- Quality requirements: footer heights `h-[120px]` / `h-[82px]`; button under New session; name "Previous
  sessions" in both forms; enabled when New is disabled; `data-previous-sessions-trigger`,
  `aria-haspopup="dialog"`, `aria-expanded` from an input; reason text below both buttons, sr-only when collapsed
- Validation notes: chat must not import canvas (direction stays canvas -> chat)
- Implementation details: new `previousSessionsRequested` output; the board injects
  `PreviousSessionsDialogService` from `@ptah-extension/chat` and calls `open()`, and passes `isOpen()` to the
  footer's `aria-expanded` input.

### Batch 8 verification

- Every listed file exists
- Gate: `npx nx run-many -t typecheck,lint -p @ptah-extension/canvas --parallel=1`, then
  `npx nx run-many -t test -p @ptah-extension/canvas --parallel=1 --maxWorkers=2`
- Commit: `feat(canvas): batch 8 - Rail footer Previous sessions button`

## Batch 9: Rail card Rename and Organize — PENDING

- Recommended executor: Claude subagent `frontend-developer`
- Execution mode: sequential
- Fallback order: fresh frontend-developer subagent -> CLI lane (implementation, non-reviewer family)
- Subagent reason: user-pinned executor policy (D3)
- Review family: different from implementer (codex)
- Rationale: the D9 menu actions in one component and its spec; the hardest focus handoff in the task
- Tasks: 1 | Depends on: Batches 3, 4
- Phase: 3 | Phase review: deferred to end of Batch 11
- Plan components: 9 (card part), D9, DP-6, Gate 2 option (a) card branch
- Projects: `@ptah-extension/canvas`

Files (2):
- MODIFY `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts`
- MODIFY `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.spec.ts`

### Task 9.1: Rename popover and Organize menu items — PENDING

- Files: the two above
- Plan reference: implementation-plan.md:760-837 (card), 828-837 (seam); design-spec 8
- Pattern to follow: menu at `canvas-rail-card.component.ts:180-240, 341-381, 393-398`;
  `ROOT/libs/frontend/ui/src/lib/native/popover/native-popover.component.ts:80-84, 166-178, 236-243, 302-309`
- Quality requirements: Delete is not added (D9); Organize absent on VS Code; draft Organize disabled with
  "Send a first message to save this session."; the Rename form does not use `role="menuitem"`
- Validation notes: R5 (handoff), R2, R4, R6 (`'failed'` sets the announcement). Per D17,
  `openForSession` also returns `'cancelled'` (superseded by a close, delete or later open): no
  announcement and no focus move. `'unavailable'` (D18) shows no announcement either; the Rail hides
  Organize on hosts without organization. Ids are `SessionId` (D16): pass `claudeSessionId` as is.
  D30 (from Batch 5): the organizer's `restoreFocus` runs before the editor's own restore in the
  same render. Spec: open Organize from the Rail menu, close the editor, and assert the final
  `document.activeElement` after the close render is the intended target (the card's menu trigger
  when the menu item is gone). If the editor's opener stays usable and differs from that target,
  fix in this batch on the owner side per D30, not in the editor (at its 700-line limit).
- Implementation details: outer Rename `ptah-native-popover` whose trigger slot holds the existing menu
  popover (DP-6); close the menu, then open Rename in `afterNextRender`; Enter calls
  `SessionRowActionsService.rename`, Escape cancels, focus returns to the trigger; Organize uses
  `organizer.open` for a loaded row and `openForSession` for a persisted card outside the loaded page;
  spec includes the excluded-from-page case.

### Batch 9 verification

- Both files changed with real logic
- Gate: `npx nx run-many -t typecheck,lint -p @ptah-extension/canvas --parallel=1`, then
  `npx nx run-many -t test -p @ptah-extension/canvas --parallel=1 --maxWorkers=2`
- Commit: `feat(canvas): batch 9 - Rail card Rename and Organize actions`

## Batch 10: Shell switch-over (sidebar out, modal in) — PENDING

- Recommended executor: Claude subagent `frontend-developer`
- Execution mode: sequential
- Fallback order: fresh frontend-developer subagent -> CLI lane (implementation, non-reviewer family)
- Subagent reason: user-pinned executor policy (D3)
- Review family: different from implementer (codex)
- Rationale: the Electron divider calls the shell's external-resize API, so both sides go in one commit
- Tasks: 2 | Depends on: Batches 3-9
- Phase: 3 | Phase review: deferred to end of Batch 11
- Plan components: 10, 11
- Projects: `@ptah-extension/chat`

Files (6):
- MODIFY `ROOT/libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`
- MODIFY `ROOT/libs/frontend/chat/src/lib/components/templates/app-shell.component.html`
- CREATE `ROOT/libs/frontend/chat/src/lib/components/templates/app-shell.previous-sessions.spec.ts`
- DELETE `ROOT/libs/frontend/chat/src/lib/components/templates/app-shell.organization.spec.ts`
- MODIFY `ROOT/libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`
- MODIFY `ROOT/libs/frontend/chat/src/lib/components/templates/electron-shell.activity-placement.spec.ts`

### Task 10.1: Electron divider removal — PENDING

- Files: `electron-shell.component.ts`, `electron-shell.activity-placement.spec.ts`
- Plan reference: implementation-plan.md:919-942
- Pattern to follow: n/a (deletion)
- Quality requirements: delete the divider block (`:290-301`), the import (`:51`), `sessionsShell`,
  `sessionsDividerAnchor`, `onSessionsDivider*` (`:377-419`); replace the divider test (`:188-215`) as the plan says
- Validation notes: removes the only external caller of the shell's resize API
- Implementation details: deletion only; no shim.

### Task 10.2: AppShellComponent sidebar removal, modal host, navbar entry — PENDING

- Depends on: Task 10.1
- Files: `app-shell.component.ts`, `.html`, `app-shell.previous-sessions.spec.ts` (new), delete
  `app-shell.organization.spec.ts`
- Plan reference: implementation-plan.md:847-918; DP-8, DP-9
- Pattern to follow: deferred editor block `app-shell.component.html:1-26`
- Quality requirements: modal behind `@defer (when …; prefetch on idle)` (eager bundle must not grow);
  `[attr.inert]` on the shell row; navbar button only `!isElectron && layoutMode() === 'single'`, right after
  `New`; editor retargeted to `organizer.session()` / `organizer.close()`; every symbol and import listed in
  the plan deleted; X, Check, Plus kept
- Validation notes: R9 (shell copies deleted here); edge case standalone view closes without restore.
  Other app-shell specs (`retained-chrome`, `notification-center`, `outlet-wrapper`, `auth-redirect`) must
  pass unchanged; edit one only if it fails, and report it (it then counts toward this batch)
- Implementation details: inject `PreviousSessionsDialogService` and `SessionOrganizerService`;
  `openPreviousSessions()`; DP-9 effect; new spec covers Req 7.1, 1.3/F-1, 1.7, inert, standalone close.
- Carried from Batch 7:
  - D54: `app-shell.previous-sessions.spec.ts` cases that assert focus returns to the opener (or
    any `afterNextRender` restore from a root service) call `fixture.autoDetectChanges()`; a
    manual-only fixture lets the restore run while the opener is still `inert` and focus stays on
    `<body>`. Pattern: `previous-sessions-modal.component.spec.ts:308`.
  - D53 / R9: delete the shell's expired-transcript tooltip constant (`app-shell.component.ts:304-305`);
    the modal owns its own copy.
  - D52: the shell's `session-group-<key>` ids leave with the sidebar markup; the modal uses
    `psm-group-<key>`. Do not reintroduce the shell ids.
  - The carried shell tests now live in `previous-sessions-modal.component.spec.ts` (D55);
    deleting `app-shell.organization.spec.ts` drops no coverage beyond 322/345 (Batch 3 spec).

### Batch 10 verification

- Every listed file exists / is deleted; `T/session-row-groups.ts` and `T/session-sidebar-width*` are
  untouched (deleted in Batch 11)
- Gate: `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=1`, then
  `npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2`
- Canvas consumes chat through the alias: also `npx nx run-many -t typecheck -p @ptah-extension/canvas --parallel=1`
- Commit: `feat(chat): batch 10 - replace session sidebar with modal entry`

## Batch 11: Dead files and session-only CSS — PENDING

- Recommended executor: Claude subagent `frontend-developer`
- Execution mode: sequential
- Fallback order: fresh frontend-developer subagent -> CLI lane (implementation, non-reviewer family)
- Subagent reason: user-pinned executor policy (D3)
- Review family: different from implementer (codex)
- Rationale: these files have no importers only after Batch 10
- Tasks: 1 | Depends on: Batch 10
- Phase: 3 (last batch) | Phase review: code-logic (codex) + visual (visual-reviewer) on the Phase 3 diff
- Plan components: 12, and the deletions of 10/11
- Projects: `@ptah-extension/chat`, `ptah-extension-webview` (CSS only)

Files (4):
- DELETE `ROOT/libs/frontend/chat/src/lib/components/templates/session-row-groups.ts`
- DELETE `ROOT/libs/frontend/chat/src/lib/components/templates/session-sidebar-width.ts`
- DELETE `ROOT/libs/frontend/chat/src/lib/components/templates/session-sidebar-width.spec.ts`
- MODIFY `ROOT/apps/ptah-extension-webview/src/styles.css`

### Task 11.1: Delete dead files and session-only CSS; run the removed-symbol gate — PENDING

- Files: the four above
- Plan reference: implementation-plan.md:943-962, 1186-1197; DP-3, DP-11
- Pattern to follow: n/a (deletion)
- Quality requirements: delete `.sidebar-item-open-tab` (both themes), `.sidebar-scroll`, both
  `aside:not(:hover)` rules; KEEP both `.sidebar-item-active` rules and retitle that comment (Workspaces
  sidebar); leave the `ptah.sessionSidebarWidth` storage key alone (DP-11)
- Validation notes: R8, R9
- Implementation details: then grep `apps/` and `libs/` for `sidebarOpen`, `toggleSidebar`,
  `ExternalSidebarResize`, `session-sidebar-width`, `SESSION_SIDEBAR_`, `sidebar-scroll`,
  `sidebar-item-open-tab`, `Toggle Sessions panel`, `Resize session sidebar`, `templates/session-row-groups`
  - all must return nothing (matches outside `apps/`/`libs/` are informational). Also confirm no `console.`
  in new/changed lib code and no `@ptah-extension/canvas` import in chat.

### Batch 11 verification

- Files deleted; grep gate output reported
- Gate: `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=1`, then
  `npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2`
- `ptah-extension-webview`: CSS only, not built or tested here (covered by the visual review)
- Commit: `refactor(chat,webview): batch 11 - delete sidebar width and CSS`
- Then return NEEDS REVIEW for Phase 3 (code-logic codex + visual review under D10)

---

## Phase 4: E2E alignment and approved runs (Batches 12-13)

Phase review: none (test code only). Evidence is the D7/D14 runs recorded in `test-report.md` by senior-tester.
Precondition for every Electron launch (D10, orchestrator-owned): TASK_2026_681 has sent "Electron: free";
the orchestrator sends "Electron: TASK_2026_679 launching, port <n>" before and "Electron: free" after.
Never ports 9333 or 9351. Runs one at a time; each spec run once. The Electron e2e target depends on
`ptah-electron:build-dev`; that is part of the approved run, never run build targets separately.

## Batch 12: Electron e2e helpers and chat/git specs — PENDING

- Recommended executor: Claude subagent `senior-tester`
- Execution mode: sequential
- Fallback order: fresh senior-tester subagent -> CLI lane with test capability (non-reviewer family)
- Subagent reason: user-pinned executor policy (D3); the D7 runs launch Electron under D10 coordination
- Review family: n/a (no phase review; runs are the evidence)
- Rationale: the shared helpers and the four specs that use them change and run together
- Tasks: 2 | Depends on: Batches 7-11 (test ids and names)
- Phase: 4 | Phase review: none
- Plan components: 13 (Electron part), DP-13
- Projects: `ptah-electron-e2e`

Files (6):
- MODIFY `ROOT/apps/ptah-electron-e2e/src/support/perf-session-fixture.ts`
- MODIFY `ROOT/apps/ptah-electron-e2e/src/support/perf-page-capture.ts`
- MODIFY `ROOT/apps/ptah-electron-e2e/src/specs/chat/tile-load-older-history.spec.ts`
- MODIFY `ROOT/apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts`
- MODIFY `ROOT/apps/ptah-electron-e2e/src/specs/git/change-set-card.spec.ts`
- MODIFY `ROOT/apps/ptah-electron-e2e/src/specs/git/visual-review.spec.ts`

### Task 12.1: Helpers `openPreviousSessions`, `openSessionFromList`, rescoped `sessionRowButton` — PENDING

- Files: `perf-session-fixture.ts`, `perf-page-capture.ts`
- Plan reference: implementation-plan.md:963-1000
- Pattern to follow: `perf-session-fixture.ts:433-460, 475-490`; `perf-page-capture.ts:204-211, 461-470`
- Quality requirements: helpers idempotent; selectors from the plan (`[data-testid="previous-sessions-list"]`,
  `[data-previous-sessions-trigger]`, dialog name "Previous sessions")
- Validation notes: no test deleted (Req 9.2-9.3)
- Implementation details: as the plan lists.

### Task 12.2: Update the four specs and run them — PENDING

- Depends on: Task 12.1
- Files: the four spec files
- Plan reference: implementation-plan.md:1000-1024, 1222-1224; DP-13
- Pattern to follow: existing spec structure
- Quality requirements: the perf spec header discloses that the measured window includes opening the modal
- Validation notes: R13, R14
- Implementation details: after `npx nx run-many -t typecheck,lint -p ptah-electron-e2e --parallel=1` passes,
  run once each, one at a time (D7):
  `npx nx e2e ptah-electron-e2e -- src/specs/chat/tile-load-older-history.spec.ts`,
  `… src/specs/chat/tile-open-longtask-budget.perf.spec.ts` (expected: skipped),
  `… src/specs/git/change-set-card.spec.ts`, `… src/specs/git/visual-review.spec.ts`.
  Record results in `test-report.md`.

### Batch 12 verification

- `npx nx run-many -t typecheck,lint -p ptah-electron-e2e --parallel=1`
- Four D7 runs reported (pass, or skip for the perf spec), output tailed
- Commit: `test(e2e): batch 12 - open sessions through Previous sessions modal`

## Batch 13: Canvas spec, docs shots and harness scenarios — PENDING

- Recommended executor: Claude subagent `senior-tester` (resume the Batch 12 tester if under 5 minutes idle)
- Execution mode: sequential
- Fallback order: fresh senior-tester subagent -> CLI lane with test capability (non-reviewer family)
- Subagent reason: user-pinned executor policy (D3); D10-coordinated Electron runs
- Review family: n/a (no phase review)
- Rationale: the remaining e2e files; harness and Electron are two projects
- Tasks: 3 | Depends on: Batch 12
- Phase: 4 (last batch) | Phase review: none
- Plan components: 13 (rest), D7, D14, DP-12, A3
- Projects: `ptah-electron-e2e`, `@ptah-extension/webview-e2e-harness`

Files (6):
- MODIFY `ROOT/apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`
- MODIFY `ROOT/apps/ptah-electron-e2e/src/docs-screenshots/sessions.shot.ts`
- MODIFY `ROOT/apps/ptah-electron-e2e/src/docs-screenshots/editor-git.shot.ts`
- MODIFY `ROOT/libs/frontend/webview-e2e-harness/src/lib/scenarios/sessions/session-list.e2e.spec.ts`
- MODIFY `ROOT/libs/frontend/webview-e2e-harness/src/lib/scenarios/sessions/session-create.e2e.spec.ts`
- MODIFY `ROOT/libs/frontend/webview-e2e-harness/src/lib/scenarios/sessions/session-delete.e2e.spec.ts`

### Task 13.1: `canvas.spec.ts` Rail footer locator — PENDING

- File: `canvas.spec.ts`
- Plan reference: implementation-plan.md:79, 1005-1010; D14
- Pattern to follow: `canvas.spec.ts:215-220`
- Quality requirements: target the New session button explicitly (two footer buttons now)
- Validation notes: R10
- Implementation details: run once (D14):
  `npx nx e2e ptah-electron-e2e -- src/specs/canvas/canvas.spec.ts -g "stacked split after a swap tabs from the Rail"`.

### Task 13.2: Docs shots — PENDING

- Files: `sessions.shot.ts`, `editor-git.shot.ts`
- Plan reference: implementation-plan.md:1010-1016, 1225-1226; DP-12
- Pattern to follow: existing shot scripts
- Quality requirements: open the modal through the helper before shooting session rows
- Validation notes: R12 - after the runs, `git checkout -- apps/ptah-docs/public/screenshots` is done by the
  team-leader (executors run no git); the tester lists every regenerated PNG
- Implementation details: from `apps/ptah-electron-e2e`, once each:
  `npx playwright test --config=docs-screenshots.config.ts src/docs-screenshots/sessions.shot.ts`, then
  `… src/docs-screenshots/editor-git.shot.ts`.

### Task 13.3: Harness scenarios — PENDING

- Files: the three harness specs
- Plan reference: implementation-plan.md:1016-1024, 1227-1229; A3
- Pattern to follow: existing scenario structure
- Quality requirements: hard expectations once booted (no vacuous pass)
- Validation notes: R11 - the tester confirms `#ptah-e2e-fixture-root` was absent in each run
- Implementation details: once each, one at a time:
  `npx nx e2e @ptah-extension/webview-e2e-harness -- src/lib/scenarios/sessions/session-list.e2e.spec.ts`, then
  `session-create.e2e.spec.ts`, then `session-delete.e2e.spec.ts`.

### Batch 13 verification

- `npx nx run-many -t typecheck,lint -p ptah-electron-e2e @ptah-extension/webview-e2e-harness --parallel=1`
- D14 run, two docs-shot runs, three harness runs reported in `test-report.md`; A3 confirmed
- Regenerated PNGs reverted before staging (DP-12)
- Commit: `test(e2e,webview-e2e-harness): batch 13 - modal canvas, docs, harness`

---

## Completion (Mode 3) inputs

- Parity: `parity-inventory.md` (required; the task replaces the sidebar surface). Rows A-F verified against
  the build; approved removals D6.
- Visual evidence: Phase 3 visual review, dark and light, against `prototype/` and D12.
- Write-path trace: no persisted settings are written by this task. The sidebar width write
  (`ptah.sessionSidebarWidth`) is removed with no new writer (DP-11); confirm in Mode 3.
