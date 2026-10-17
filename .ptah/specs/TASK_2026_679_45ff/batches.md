# Batches - TASK_2026_679_45ff

Total tasks: 35 (26 + fix A1.1-A1.2 + fix P3.1-P3.2 + merge M.1 + merge M2.1 + visual fix V1.1-V1.4) | Batches: 16 (8+9 and 10+11 merged; Fix rounds A1, P3 and V1, Main merges M and M2 added) | Complete: 16/16
Status (2026-10-17): ALL BATCHES COMPLETE. V1 + V1.4 (b8543ad25, 36619f3a1) re-review APPROVED, D91 visual re-check PASS; Batch 12 (6607db0d7) and Batch 13 (fb6b0f6d2) committed. Mode 3 completion verified: `reports/mode-3-completion.md` (COMPLETE). NEXT: push and open the PR with FU-1..FU-11.

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
- Update 2026-10-16 (D57, D58, D63, D64; supersedes the executor, sequential-only and batch-size
  lines above from Batch 8 on): Batches 8+9 and 10+11 are merged (cap 10 files). Waves: A1 (Fix
  round A1, Claude `frontend-developer`) || A2 (Batch 8-9, codex lane) -> A3 (codex re-review of A1)
  -> B (Batch 10-11, Claude) -> Phase 3 review split by family + visual -> C (Batches 12 and 13
  kept split, D64: written by a codex lane, runs by `senior-tester`). Executors run Jest only on
  their changed specs; the team-leader runs the full gate once per batch, no `--skip-nx-cache`
  unless a cached result is in doubt. No commit while any executor edits the worktree.
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

Phase 2 reviews on `a83cf71cf..7c1ac3a32` (codex; implementer family Claude, reviewer family
codex/OpenAI, no same-family exception):

- `reviews/phase-2-code-style-review.md` — APPROVED 7/10 (1 Moderate -> FU-3, 1 Minor recorded in FU-3)
- `reviews/phase-2-code-logic-review.md` — REVISE 6/10 (1 Serious, 3 Moderate)

Fix round: Fix round A1 below (finding 1 Serious + finding 3 Moderate, D59-D60). Finding 2 is the
accepted DP-14 (D61); finding 4 is FU-2 (D62). One codex re-review scoped to the A1 commit closes
Phase 2.

Phase 2 — COMPLETE. Re-review `reviews/phase-2-fix-rereview.md` (codex; implementer Claude) on
`7be628b20..17de63f35`: APPROVED 8/10, findings 1 (Serious) and 3 (Moderate) fixed, no new
defects (D68).

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

## Batch 7: PreviousSessionsModalComponent — COMPLETE (commit 7c1ac3a32; Phase 2 reviews: style APPROVED, code-logic REVISE -> Fix round A1)

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

## Fix round A1: Phase 2 code-logic fixes — COMPLETE (commit 17de63f35; codex re-review APPROVED 8/10: reviews/phase-2-fix-rereview.md)

Source: `reviews/phase-2-code-logic-review.md` (codex, REVISE 6/10). Fix-round decisions: D59-D62.
Fixed here: finding 1 (Serious) and finding 3 (Moderate focus race, D59). Not fixed: finding 2
(accepted DP-14, D61), finding 4 (FU-2, D62), style Moderate (FU-3, D62), style Minor (recorded in
FU-3, D62).

- Recommended executor: Claude subagent `frontend-developer`
- Execution mode: sequential
- Fallback order: fresh frontend-developer subagent -> non-codex CLI lane (grok, then Glm; codex is
  the re-reviewer)
- Subagent reason: wave A1 is a Claude implementer so the codex re-review stays cross-family (D58);
  the lane slot runs Batch 8-9 in parallel
- Review family: codex (one code-logic re-review scoped to the A1 commit; resume codex session
  `01a14637-9d0b-7c33-b3c5-1a8139a4b726`). Implementer Claude, reviewer codex/OpenAI.
- Rationale: two independent fixes in Phase 2 chat files; file-disjoint from Batch 8-9 (D63), so
  waves A1 and A2 run in parallel in the same worktree
- Tasks: 2 | Depends on: Batch 7 (committed)
- Phase: 2 (fix round) | Phase review: code-logic re-review of the A1 commit only (codex)
- Projects: `@ptah-extension/chat`

Files (6) — nothing else is edited (no barrel, no html, no other chat file):
- MODIFY `ROOT/libs/frontend/chat/src/lib/services/session-list/session-row-actions.service.ts`
- MODIFY `ROOT/libs/frontend/chat/src/lib/services/session-list/session-row-actions.service.spec.ts`
- MODIFY `ROOT/libs/frontend/chat/src/lib/services/session-list/session-organizer.service.ts`
- MODIFY `ROOT/libs/frontend/chat/src/lib/services/session-list/session-organizer.service.spec.ts`
- MODIFY `ROOT/libs/frontend/chat/src/lib/components/organisms/previous-sessions/previous-sessions-modal.component.ts`
- MODIFY `ROOT/libs/frontend/chat/src/lib/components/organisms/previous-sessions/previous-sessions-modal.component.spec.ts`

### Task A1.1: A failed grid open keeps the modal open — COMPLETE

- Files: `session-row-actions.service.ts` + spec, `previous-sessions-modal.component.ts` + spec
- Finding 1: `session-row-actions.service.ts:47-50` discards the `Promise<boolean>` of
  `AppStateManager.requestCanvasSession` (`libs/frontend/core/src/lib/services/app-state.service.ts:1235-1275`:
  `false` for an invalid id or a request not consumed within 5 s); `previous-sessions-modal.component.ts:351-354`
  closes at once.
- Requirements (D60): `openSession` returns `Promise<SessionOpenResult>`,
  `type SessionOpenResult = 'opened' | 'failed'` exported from the service file (not from a barrel,
  D24). Grid: await `requestCanvasSession`; `true` -> `'opened'`, `false` -> `'failed'` with
  `logger.warn`. Single: unchanged behaviour (start `chatStore.switchSession`, log a rejection as
  today) and resolve `'opened'` without awaiting the history load. Modal `onOpened`: one open at a
  time (further opens ignored while one is pending); close only on `'opened'`; on `'failed'` keep
  the modal open, announce `Couldn't open "<display name>". Try again.` through the existing
  `announce()` status line, and focus that row's open button after render when focus left the panel
  (else leave focus alone); when the modal was destroyed or closed meanwhile, do nothing.
- Specs: service — grid `true` -> `'opened'`, grid `false` -> `'failed'` + warn logged, single ->
  `'opened'` and `switchSession` called. Modal — grid success closes; grid failure keeps the
  dialog open, sets the status text and does not call `dialog.close()`; a second row click while the
  first open is pending is ignored; a result arriving after the modal closed does nothing.

### Task A1.2: A new organizer open cancels an old close's focus restore — COMPLETE

- Files: `session-organizer.service.ts` + spec
- Finding 3: `close()` schedules `restore` with `afterNextRender` (`:150-159`); `open()` (`:134-142`)
  does not cancel it, so editor A's restore can run while editor B is open.
- Requirements (D59): keep the `AfterRenderRef` returned in `close()`; `open()` destroys it and
  clears the field (same pattern as `previous-sessions-dialog.service.ts:42-48,125-128`, D21). The
  ref also clears itself when the callback runs. `openForSession` reaches the editor through
  `open()`, so it is covered. Close-only behaviour, including the D30 callback order, is unchanged.
- Specs: close A then open B before the render -> A's restore does not run; close only -> restore
  runs once after the render (existing case stays green).

### Fix round A1 verification

- Exactly the six files changed (team-leader `git diff --name-only`)
- Gate (team-leader, once, after A1 and Batch 8-9 both return):
  `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=1`, then
  `npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2`
- Commit (before Batch 8-9's): `fix(chat): phase 2 fix round - grid open outcome, organizer focus`
- Then NEEDS REVIEW: codex code-logic re-review scoped to the A1 commit
- Result (team-leader, 2026-10-16): exactly the six files; combined gate with Batch 8-9
  (`run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/canvas`, then `-t test`,
  header "Running target test for 2 projects") passed; committed `17de63f35`. Executor decisions
  accepted as D65.

### Phase 2 follow-ups (named later tasks, not in this run)

- FU-2 "reversed date range indication" (Phase 2 logic finding 4, Moderate): when From is later
  than To (`previous-sessions-toolbar.component.ts:135-168`, `session-list-view.store.ts:79-99`),
  show an invalid-range message instead of "No matching sessions"
  (`previous-sessions-modal.component.ts:224-229`, `.html:162-176`), or constrain the inputs' min/max.
  Scope: `@ptah-extension/chat`; scoped Jest on the changed specs.
- FU-3 "search focus hook and grouping comments" (Phase 2 style Moderate + Minor): add one behaviour
  attribute `data-previous-sessions-search` on both search inputs
  (`session-filter-bar.component.ts:131`, `previous-sessions-toolbar.component.ts:83`) and select it
  in the modal (`previous-sessions-modal.component.ts:70-72,547-550`) instead of test IDs; reword
  the "sidebar" comments in `organisms/previous-sessions/session-row-groups.ts:2-7,15,40-42`.
  Scope: `@ptah-extension/chat`.

---

## Phase 3: Entry points and sidebar removal (Batches 8-9, 10-11)

Batches 8+9 and 10+11 are merged (D57c, D63). Phase review: code-logic split by implementer family
(D58): Batch 8-9 (codex-written) -> Claude `code-logic-reviewer` subagent; Batch 10-11
(Claude-written) -> codex lane. Plus visual (visual-reviewer; Electron 1440/760/400 px, dark and
light, against `prototype/` and D12; checks at implementation-plan.md:1232-1240; D10 coordination;
never ports 9333/9334/9351 without a fresh "free"). No style review: no new lib-level public API.

Phase 3 — FIX ROUND (all batches committed: `5202e97bc`, `0fe789fce`; range
`17de63f35..0fe789fce`). Code-logic reviews in:

- `reviews/phase-3-batch-8-9-code-logic-review.md` — Claude on codex-written Batch 8-9: APPROVED 7/10
  (0 Blocking, 0 Serious, 4 Moderate, 5 Minor).
- `reviews/phase-3-batch-10-11-code-logic-review.md` — codex on Claude-written Batch 10-11: REVISE 5/10
  (0 Blocking, 2 Serious, 0 Moderate, 0 Minor).

One fix round (D72): S1 and M4 in Fix round P3; S2 closed by Batch 12 (D77); M1, M2, M3 -> FU-4,
FU-5, FU-6; Minor -> FU-7 (recorded). Then Main merge M, then the visual review on the merged head
(D76). Phase 3 closes when the codex re-review of P3 accepts and the visual review passes.

Phase 3 code reviews CLOSED (2026-10-17): codex re-review of P3 `4c4e429b0` APPROVED 8/10
(`reviews/phase-3-fix-rereview.md`; implementer Claude, reviewer codex/OpenAI): S1 FIXED, M4 FIXED,
0 new source defects; 2 Minor spec-coverage gaps -> FU-8 (D81). Main merge M committed
`8a29952a6`. Remaining Phase 3 gate: the visual review on `8a29952a6`
(`reviews/phase-3-visual-review.md`).

## Batch 8-9: Rail footer "Previous sessions" button, card Rename and Organize — COMPLETE (commit 5202e97bc)

- Merged from Batches 8 and 9 (D63). Runs as wave A2 in parallel with Fix round A1.
- Recommended executor: CLI lane, implementation capability, `role: frontend-developer` (codex
  first per D58)
- Execution mode: sequential (Task 8.1, then Task 9.1, in one lane)
- Fallback order: other non-Claude family with room (grok, then Glm; never AT LIMIT) -> Claude
  `frontend-developer` subagent (the reviewer then becomes codex)
- Subagent reason: N/A
- Review family: Claude `code-logic-reviewer` subagent (implementer codex/OpenAI, reviewer Claude)
- Rationale: one project, seven files; consumes the Phase 2 chat services (`PreviousSessionsDialogService`,
  `SessionOrganizerService`, `SessionRowActionsService.rename`) and edits none of them, so it is
  file-disjoint from Fix round A1
- Tasks: 2 | Depends on: Batches 3, 4 (committed)
- Phase: 3 | Phase review: deferred to end of Batch 10-11
- Plan components: 9, D5, D9, DP-6, Gate 2 option (a) card branch
- Projects: `@ptah-extension/canvas`

Files (7):
- MODIFY `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts`
- MODIFY `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.spec.ts`
- MODIFY `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`
- MODIFY `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts`
- MODIFY `ROOT/libs/frontend/canvas/src/lib/orchestra-canvas.component.ts` (comment only)
- MODIFY `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts`
- MODIFY `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.spec.ts`

### Task 8.1: Footer button, output and board wiring — COMPLETE

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

### Task 9.1: Rename popover and Organize menu items — COMPLETE

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
- Parallel-run note (D63): Fix round A1 edits `session-organizer.service.ts` and
  `session-row-actions.service.ts` at the same time. It changes only `openSession` (no Rail caller)
  and makes `open()` cancel a pending close restore; `rename`, `open`, `openForSession`, `close`,
  `isOpen` signatures and the close-only D30 order stay as they are. Do not edit chat files.

### Batch 8-9 verification

- Exactly the seven files changed; real logic, no stubs
- Gate (team-leader, once): `npx nx run-many -t typecheck,lint -p @ptah-extension/canvas --parallel=1`,
  then `npx nx run-many -t test -p @ptah-extension/canvas --parallel=1 --maxWorkers=2`
- Commit (after the A1 commit; no commit while any executor still edits the worktree, D58):
  `feat(canvas): batch 8-9 - Rail Previous sessions and card actions`
- Result (team-leader, 2026-10-16): exactly the seven files; no Delete in the card, chat imports
  no canvas, no `any`/`as unknown as`/`console.*`/TODO; D16 (`claudeSessionId` passed as is),
  D17/D18 (`cancelled`/`unavailable` silent, spec'd), D30 (microtask owner restore, spec
  `canvas-rail-card.component.spec.ts:505`) verified; nothing removed beyond the footer height
  class and one comment. The lane's 7 sibling diagnostics are pre-existing (D67). Combined gate
  passed; committed `5202e97bc`. Executor decisions accepted as D66. Phase 3 code-logic review
  (Claude `code-logic-reviewer`) deferred to the end of Batch 10-11.

## Batch 10-11: Shell switch-over, dead files and session-only CSS — COMPLETE (commit 0fe789fce; codex code-logic REVISE 5/10 -> Fix round P3, S2 -> Batch 12)

- Merged from Batches 10 and 11 (D63): ten files, task order 10.1 -> 10.2 -> 11.1.
- Recommended executor: Claude subagent `frontend-developer`
- Execution mode: sequential
- Fallback order: fresh frontend-developer subagent -> non-codex CLI lane (grok, then Glm)
- Subagent reason: highest-risk batch (shell switch-over; Electron divider and shell resize API go
  in one change); HANDOFF wave B pins a Claude subagent so the codex review stays cross-family
- Review family: codex (implementer Claude)
- Rationale: the Electron divider calls the shell's external-resize API, so both sides go together;
  the dead files and CSS have no importers only after 10.2
- Tasks: 3 | Depends on: Fix round A1 and Batch 8-9 (both committed)
- Phase: 3 (last batch) | Phase review: code-logic (split per D58) + visual on the Phase 3 diff
- Plan components: 10, 11, 12
- Projects: `@ptah-extension/chat`, `ptah-extension-webview` (CSS only)

Files (10):
- MODIFY `ROOT/libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`
- MODIFY `ROOT/libs/frontend/chat/src/lib/components/templates/app-shell.component.html`
- CREATE `ROOT/libs/frontend/chat/src/lib/components/templates/app-shell.previous-sessions.spec.ts`
- DELETE `ROOT/libs/frontend/chat/src/lib/components/templates/app-shell.organization.spec.ts`
- MODIFY `ROOT/libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`
- MODIFY `ROOT/libs/frontend/chat/src/lib/components/templates/electron-shell.activity-placement.spec.ts`
- DELETE `ROOT/libs/frontend/chat/src/lib/components/templates/session-row-groups.ts`
- DELETE `ROOT/libs/frontend/chat/src/lib/components/templates/session-sidebar-width.ts`
- DELETE `ROOT/libs/frontend/chat/src/lib/components/templates/session-sidebar-width.spec.ts`
- MODIFY `ROOT/apps/ptah-extension-webview/src/styles.css`

### Task 10.1: Electron divider removal — COMPLETE

- Files: `electron-shell.component.ts`, `electron-shell.activity-placement.spec.ts`
- Plan reference: implementation-plan.md:919-942
- Pattern to follow: n/a (deletion)
- Quality requirements: delete the divider block (`:290-301`), the import (`:51`), `sessionsShell`,
  `sessionsDividerAnchor`, `onSessionsDivider*` (`:377-419`); replace the divider test (`:188-215`) as the plan says
- Validation notes: removes the only external caller of the shell's resize API
- Implementation details: deletion only; no shim.

### Task 10.2: AppShellComponent sidebar removal, modal host, navbar entry — COMPLETE

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

### Task 11.1: Delete dead files and session-only CSS; run the removed-symbol gate — COMPLETE

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

### Batch 10-11 verification

- Every listed file exists / is deleted; grep gate output (Task 11.1) reported
- Gate (team-leader, once): `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=1`,
  then `npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2`
- Canvas consumes chat through the alias: also `npx nx run-many -t typecheck -p @ptah-extension/canvas --parallel=1`
- `ptah-extension-webview`: CSS only, not built or tested here (covered by the visual review)
- Commit: `feat(chat,webview): batch 10-11 - replace session sidebar with modal`
- Then return NEEDS REVIEW for Phase 3 (code-logic split per D58 + visual review under D10)
- Result (team-leader, 2026-10-16): 11 files (the 10 listed plus `app-shell.retained-chrome.spec.ts`,
  whose `#shellRow` anchor the plan removes; re-anchored on `*ptahRetainWhile` with a single-row
  guard, assertions unchanged, D69). Deletes complete: no `libs/` reference to the removed symbols
  or files (only provenance comments in moved specs); the two remaining gate hits are e2e files
  owned by Batch 12 (`perf-session-fixture.ts:437`) and Batch 13 (`editor-git.shot.ts:39`). No
  `any`/`as unknown as`/new `console.*`/TODO on added lines; chat imports no canvas; both
  `.sidebar-item-active` rules kept (R8). Parity: A-1 moved (navbar + Rail), A-2..A-8, A-11
  scroll, A-12 approved removals (D6), A-9/A-10 and B-E rows moved (Batches 6-7), F-1 kept and
  spec'd. lint-staged formats only `*.{ts,js,json,md}`, so `styles.css` and the template were not
  reformatted (its older prettier drift at :146, :312-343 is untouched). Gate:
  `run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/canvas` passed (4/4), then
  `run-many -t test -p @ptah-extension/chat` passed ("Running target test for project
  @ptah-extension/chat", N=1). `ptah-extension-webview`: CSS only, not built (visual review).
  Committed `0fe789fce`. Executor decisions accepted as D69-D70.

## Fix round P3: Phase 3 code-logic fixes — COMPLETE (commit 4c4e429b0; codex re-review APPROVED 8/10: reviews/phase-3-fix-rereview.md)

Source: both Phase 3 code-logic reviews. Decisions D72-D76. Fixed here: Batch 10-11 S1 (Serious)
and Batch 8-9 M4 (Moderate, data loss, D74). Not here: S2 (Batch 12, D77), M1/M2/M3 (FU-4..FU-6),
Minor m1-m5 (FU-7).

- Recommended executor: Claude subagent `frontend-developer`
- Execution mode: sequential (Task P3.1, then Task P3.2, one executor)
- Fallback order: fresh frontend-developer subagent -> non-codex CLI lane with implementation
  capability (codex is the re-reviewer)
- Subagent reason: S1 is in Claude-written shell code; one executor for both tasks keeps "one heavy
  check at a time" and needs one re-review (D76)
- Review family: codex lane, one code-logic re-review scoped to the P3 commit (fix author Claude,
  reviewer codex/OpenAI; for the card part the original author was codex, but the re-review family
  differs from the fix author, which is the rule)
- Rationale: two small, independent fixes in two projects; 5 files (6 with the optional component)
- Tasks: 2 | Depends on: Batch 10-11 (committed)
- Phase: 3 (fix round) | Phase review: code-logic re-review of the P3 commit only (codex)
- Projects: `@ptah-extension/chat`, `@ptah-extension/canvas`

Files (5, plus at most 1 optional CREATE) — nothing else is edited:
- MODIFY `ROOT/libs/frontend/chat/src/lib/components/templates/app-shell.component.html`
- MODIFY `ROOT/libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` (only if the
  focus-on-render / Escape logic lives in the shell)
- MODIFY `ROOT/libs/frontend/chat/src/lib/components/templates/app-shell.previous-sessions.spec.ts`
- CREATE (optional, instead of growing the shell) `ROOT/libs/frontend/chat/src/lib/components/organisms/previous-sessions/previous-sessions-load-state.component.ts`
  (internal, not exported from `src/index.ts`; its cases stay in the shell spec)
- MODIFY `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts`
- MODIFY `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.spec.ts`

### Task P3.1: Reachable close while the deferred modal loads or fails — COMPLETE

- Files: the chat files above
- Finding S1: `app-shell.component.html:19-23` has no `@loading`/`@error`; `:101-105` makes the row
  inert as soon as `previousSessions.isOpen()`; the modal's close and Escape exist only in the
  deferred chunk, so a failed or slow chunk leaves the chat surface inert with no reachable control.
- Requirements (D73): `@loading (after 150ms)` and `@error` on that `@defer`, each wrapped in
  `@if (previousSessions.isOpen())`; a modal surface (role dialog, aria-modal, name "Previous
  sessions", z 990, same panel tokens as the modal) outside the inert row; the Close button takes
  focus on render and calls `previousSessions.close()` (focus returns to the opener after render);
  Escape closes with `stopPropagation()`. Loading copy "Loading previous sessions..."; error copy
  "Previous sessions could not load. Close this and reload the window to try again." No Retry
  (Angular caches a failed defer load per template). DP-2 per-open `@if` and DP-8 `inert` unchanged.
- Specs (shell spec, `DeferBlockBehavior.Manual` describe): Loading and Error states each render the
  surface outside the inert row with focus on Close; Close -> `isOpen()` false, row not inert, focus
  back on the navbar trigger (`autoDetectChanges`, D54); Escape closes and stops propagation; nothing
  renders for Loading/Error while closed. Existing shell specs stay green.

### Task P3.2: Rename in-flight guard on the Rail card — COMPLETE

- Depends on: Task P3.1 (same executor, sequential)
- Files: the canvas files above
- Finding M4: `canvas-rail-card.component.ts:296` (`keydown.enter`) and `:299` (Save) both call
  `saveRename` (`:435-441`) with no guard; Enter repeat or Enter-edit-Save sends overlapping renames.
- Requirements (D74): `renaming` signal; `saveRename` returns at once while set; input `readOnly`
  and Save `disabled` while set; after the await, `cancelRename()` (close + focus) only if
  `renameOpen()` is still true; clear the flag in `finally`. `'failed'` keeps today's close (D75).
- Specs: two Enters before resolve -> one `rename` call; Enter then Save -> one call; input readOnly
  and Save disabled while pending; resolve closes and focuses the trigger; Cancel while pending ->
  no focus move on resolve; a later rename after resolve works.

### Fix round P3 verification

Result (team-leader, 2026-10-17): exactly the 5 listed files plus the optional internal
`previous-sessions-load-state.component.ts` (no barrel change). No `any`, `as unknown as`,
`console.*`, TODO or `class=""` + `[class]` on one element. S1: `@loading (after 150ms)`/`@error`
each under `@if (previousSessions.isOpen())`, stand-in outside the inert row, Close focused on
render, Escape stops propagation, no Retry. M4: `renaming` guard, readOnly/disabled, close only if
still the same open (`renameOpenCount`, accepted as D78), `finally` clears. Gate: typecheck,lint
4/4 passed; test "Running target test for 2 projects", passed. Executor specs: chat shell 24/24,
canvas card 36/36. Committed `4c4e429b0`. Executor decisions accepted as D78-D79.

- Only the listed files changed (team-leader `git status --short`, `git diff --name-only`)
- Gate (team-leader, once): `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/canvas --parallel=1`,
  then `npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/canvas --parallel=1 --maxWorkers=2`
  (header "Running target test for 2 projects")
- Commit: `fix(chat,canvas): phase 3 fix round - modal load state, rename guard`
- Then Main merge M (below), and NEEDS REVIEW: codex code-logic re-review scoped to the P3 commit,
  run in parallel with the merge resolver (reviewer reads `git show <P3>`; no tests, no builds)

## Main merge M: merge `main` (TASK_2026_681) into the branch — COMPLETE (commit 8a29952a6)

- Why: `main` (`6c0490f1f`) carries TASK_2026_681; `git merge-tree --write-tree HEAD main` reports
  content conflicts in exactly `canvas-rail-board.component.ts` and `.spec.ts` (main `75ce4a6d1`:
  needs-you cue via `SessionInspectorStore`, sheet-scoped Tab trap, `data-testid="canvas-tile"`).
  Main changes only `canvas`, `chat`, `chat-ui` (chat-ui untouched on this branch). Must land
  before the visual review and the PR (D76). `git merge` (no history rewrite; branch local-only).
- Step 1 (team-leader, after the P3 commit, worktree clean apart from task docs): `git merge main`.
  If any file other than the two above conflicts, abort (`git merge --abort`) and report.
- Step 2 (Claude `frontend-developer`, Brief merge-resolver): resolve exactly the two files, keeping
  both sides' behaviour; no other edit; no git.
- Step 3 (team-leader): no conflict markers (`git diff --check`, grep `<<<<<<<`), gate
  `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/canvas --parallel=1`,
  then `-t test` for the same two (`--maxWorkers=2`, header N=2); `git commit --no-edit`
  (commitlint ignores `Merge ` subjects). The merge commit holds only the resolution.
- Executor family: Claude; no separate code review (both sides were reviewed; the resolution is a
  union checked by the gate and by the visual review on the merged head).

### Task M.1: Resolve `canvas-rail-board` conflicts — COMPLETE

- Files: `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`,
  `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts`
- Keep from the branch: `PreviousSessionsDialogService` injection, `previousSessionsRequested`
  handling and the footer `aria-expanded` binding (Batch 8-9). Keep from main: `SessionInspectorStore`
  import/injection and the needs-you count in `closedDetailsDescription`, the `isTabbable`
  inspector-dialog clause, `onSheetKeydown` using `event.currentTarget`, `data-testid="canvas-tile"`,
  and main's new specs and providers. Both sides' specs pass.

### Main merge M verification

Result (team-leader, 2026-10-17): resolver report `reports/merge-m-report.md` (Claude
`frontend-developer`, board spec 91/91). `git diff MERGE_HEAD` on the two files shows only the
branch's additions (`PreviousSessionsDialogService` import/inject, `[previousSessionsOpen]`,
`(previousSessionsRequested)`, three spec providers, RailStub input/output, the Previous-sessions
spec); `git diff HEAD` shows only main's (`SessionInspectorStore` + needs-you count, `isTabbable`
inspector-dialog clause, `onSheetKeydown` `event.currentTarget`, `data-testid="canvas-tile"`, main's
provider and specs). Footer `aria-expanded` is in `canvas-rail.component.ts` (not conflicted). No
conflict markers; no other unmerged path. Gate scope `chat` + `canvas` (D80): typecheck,lint
"Successfully ran targets typecheck, lint for 2 projects"; test "Running target test for 2
projects" -> "Successfully ran target test for 2 projects". Staged the two files by name;
`git commit --no-edit` (foreground, hooks ran) -> `8a29952a6` (parents `4d34ec9bb`, `6c0490f1f`).

## Main merge M2: merge `main` (PRs #731, #735, #736, #739) into the branch — COMPLETE (commit 5c892b28a)

- Why: user asked to merge `main` again (`71820e0c0`, ~20 commits). Merge-base `6c0490f1f`.
  Executor family: Claude `frontend-developer` (resolver); no separate code review (D80 rationale:
  both sides reviewed, the resolution is an import union checked by the gate and the visual review).

### Task M2.1: Resolve `canvas-rail-board.component.spec.ts` imports — COMPLETE

- File: `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts` (one
  hunk, imports). Main's `lucide-angular` import kept in main's position, then the branch's
  `@ptah-extension/chat` import (superset of main's line). Report: `reports/merge-m2-report.md`.

### Main merge M2 verification

Result (team-leader, 2026-10-17): `git diff --name-only --diff-filter=U` listed only the spec; no
conflict markers; `git diff --check` exit 0. `git diff HEAD` on the spec shows only main's additions
(`LucideAngularModule` import + mount override, deferred-inspector spec with `completeDeferBlocks`,
lucide details-strip spec); `git diff MERGE_HEAD` only the branch's (three chat symbols, RailStub
`previousSessionsOpen`/`previousSessionsRequested`, three providers, Previous-sessions spec). Files
changed on both sides (6): board `.ts`/`.spec.ts`, `electron-shell.component.ts`,
`chat-message-handler.service.ts`, `libs/shared` `rpc.types.ts` and `rpc/rpc-session.types.ts`;
none in `rpc-handlers`, so it is not gated (D83). Gate scope `chat` + `canvas` + `shared`:
typecheck,lint "Running targets typecheck, lint for 3 projects" -> "Successfully ran targets
typecheck, lint for 3 projects"; test "Running target test for 3 projects" -> "Successfully ran
target test for 3 projects". Staged the spec by name; `git commit --no-edit` (foreground, hooks
ran) -> `5c892b28a` (parents `8a29952a6`, `71820e0c0`). Visual-review additions from main: the
Command Center nav tab, `overflow-x-auto` tablist and `min-h-0` rows in `electron-shell`; the
lucide small-band Details opener (`aria-expanded`) and `@defer (on idle)` wide inspector in the board.

### Phase 3 follow-ups (named later tasks, not in this run)

- FU-4 "Rail Organize focus-order spec" (Batch 8-9 M1): replace the mocked organizer in
  `canvas-rail-card.component.spec.ts:505-523` with the real `SessionOrganizerService` and editor (or
  an editor stub that restores focus in its own `afterNextRender`), assert the trigger holds focus
  after the close render, and add the disconnected-trigger fallback case to `.rc-select`
  (`canvas-rail-card.component.ts:455-460`). Scope: `@ptah-extension/canvas`.
- FU-5 "Rail card announcement repeat" (M2): clear `announcement` before each Organize and stale
  action so a repeated failure is re-announced (`canvas-rail-card.component.ts:338,364,453`).
- FU-6 "Rename failure feedback on both surfaces" (M3): a design update to 8.7, then keep the draft
  and announce on `'failed'` in the Rail card (`canvas-rail-card.component.ts:435-441`) and the modal
  row (`previous-sessions-modal.component.ts:381-395`) together.
- FU-7 "Rail card minors" (recorded, m1-m5): Organize item lacks `aria-haspopup="dialog"` (card.ts
  :255-266); `keydown.enter` saves during IME composition (card.ts:296); no Tab trap in the Rename
  panel, shared with the New session popover (`NativePopover` follow-up); board spec never drives
  `isOpen` true (board.spec.ts:367,435); expanded footer fixed at 120 px could overflow a 3-line
  reason (canvas-rail.component.ts:231).
- FU-8 "Phase 3 fix-round transition specs" (recorded, P3 re-review Minors, D81): (a) shell spec
  (`app-shell.previous-sessions.spec.ts:441-543`) renders Complete after Loading with Close focused
  (focus hands to the modal search, `previous-sessions-modal.component.ts:266-275`) and destroys
  Loading before its first focus callback (`previous-sessions-load-state.component.ts:119-123`);
  (b) card spec (`canvas-rail-card.component.spec.ts:595-625`) keeps the first rename pending across
  Cancel and reopen (reopened popover stays open with focus) and rejects it (`renaming` clears,
  `canvas-rail-card.component.ts:447-458`). Scope: `@ptah-extension/chat`, `@ptah-extension/canvas`.
- FU-9 "Phase 3 visual Moderates and Minors" (recorded, `reviews/phase-3-visual-review.md` Moderate
  1-7 and Minor 1-5, D87; none loses data or breaks config): Rename popover geometry and styling
  (306 px vs `w-72` 288 px, muted heading, `flex-1` Cancel/Save, clip at 400 with Workspaces open,
  `canvas-rail-card.component.ts:294`); footer button light-theme hairline 1.0 (Moderate 2, the class
  part is fixed by V1.3); Organize item lacks `aria-haspopup="dialog"` (`canvas-rail-card.component.ts:258`,
  same as FU-7 m1); failed open is announced only through the `sr-only` status line
  (`previous-sessions-modal.component.ts:436`; joins FU-6); D20 focus to `<body>` with no opener
  (Moderate 5; D20 accepted, not reopened); Details opener off-screen at 400 (pre-existing canvas
  minimum width); row meta shows date only (fixture or binding gap, unscored). Minors: current-row
  accent curves on the rounded `li`; scrim stops at the 1430 px layout width (app-wide
  `scrollbar-gutter`); footer label weight (now `font-medium` by V1.3, re-check); `Open beside`
  reason wraps to two lines; double focus outline on the Rename input. Scope: `@ptah-extension/chat`,
  `@ptah-extension/canvas`.
- FU-10 "Shell tab strip clips at narrow widths" (visual Serious 3, D88/D90; owner TASK_2026_687_615f
  batch B4): main's Command Center tab (PR #735) makes the 7-tab strip need 569 px, so it scrolls with
  a visible scrollbar at 760, 400 and about 800-900 px (`electron-shell.component.ts:135-136`). Not
  fixed in this PR (USER, D90).

## Visual fix round V1: Phase 3 visual Breaking 1 + Serious 1-2 — COMPLETE (commit b8543ad25; V1.2 rework re-gated 2026-10-17, `reports/mode-2-v1-regate.md`; codex re-review APPROVED via V1.4: `reviews/v1-4-fix-rereview.md`; D91 re-check PASS: `reviews/v1-visual-recheck.md`)

- Source: `reviews/phase-3-visual-review.md:62-121` (NEEDS_REVISION 5/10); scope D87; report
  `reports/fix-round-v1-report.md`; gate record `reports/mode-2-batch-12-v1-gate.md`
- Executor: Claude subagent `frontend-developer` (D87) | Re-review: codex (different family, D87)
- Execution mode: sequential | Phase: 3 (fix round) | Projects: `@ptah-extension/chat`, `@ptah-extension/canvas`
- Commit order (D92): V1 commits on its own right after its gate, before Batch 12, with Batch 12 and
  Batch 13 files and the task-folder records left unstaged
- Planned subject: `fix(chat,canvas): visual fix round V1 - sheet width, card title, rail icon`

Files (6):
- MODIFY `ROOT/libs/frontend/chat/src/lib/components/organisms/previous-sessions/previous-sessions-modal.component.html`
- MODIFY `ROOT/libs/frontend/chat/src/lib/components/organisms/previous-sessions/previous-sessions-modal.component.spec.ts`
- MODIFY `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`
- MODIFY `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts`
- MODIFY `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts`
- MODIFY `ROOT/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.spec.ts`

### Task V1.1: Breaking 1, the narrow sheet scrolls sideways — COMPLETE

- `previous-sessions-modal.component.html:22` `w-screen h-dvh` -> `w-full h-full`; `sm:` sizes unchanged
  (matches the review's fix advice). Spec `previous-sessions-modal.component.spec.ts:1029` pins the
  class contract only (jsdom has no layout).
- Open until the D91 re-check: at 400 px `dialog.modal` `scrollWidth === clientWidth`, and the sheet
  fills the dialog height (`h-full` against the modal grid), dark and light.

### Task V1.2: Serious 1, Rail card title stale after Rename — COMPLETE (rework verified, commit b8543ad25)

- Rework verified 2026-10-17: a closure `pressing` flag set in `down` makes `selection()` return early
  during a press (`canvas-rail-board.component.ts:373-377,398`); `up` clears it, then re-reads
  (`:406-410`). New spec "keeps the press hold through the caret the press places (V1.2 rework)"
  (`canvas-rail-board.component.spec.ts:727-773`) covers caret-in-press = 'a', release with caret =
  null, press ending in text = 'a', and pointercancel ending the press. Earlier cases kept.
- History of the first attempt (FAILED, kept for the record):

- Root cause confirmed: `holdTabId` latched for a collapsed caret in a card (`canvas-rail-board.component.ts:373-383`
  before the fix), so `shownTitle` kept the latched title (`compact-rail-card.component.ts:427-429,472`).
  Ignoring a collapsed or empty selection is the right fix for the stale title.
- Defect (regression the fix introduces): the press hold no longer lasts from `pointerdown` to `pointerup`.
  `down` sets the hold (`canvas-rail-board.component.ts:391-397`), but the press itself puts a collapsed
  caret in the card (the report says so), and the `selectionchange` that follows, which arrives before
  `pointerup`, now runs `selection()` (`:373-390`). That call sets `holdTabId` to null in the middle of the
  press. Before V1 that same event kept the hold on the pressed card. Live text that changes (the `now`
  line or metrics of a streaming card) is no longer frozen between the press and the start of a drag, so
  the drag anchor resets to offset 0. That case is what the press hold exists to prevent. The new spec
  (`canvas-rail-board.component.spec.ts:715-722`) sends no `selectionchange` during the press, so it
  cannot catch this.
- Rework: while a press is in flight, `selectionchange` does not change the hold, and `up` re-reads the
  selection once the press flag is clear. Spec: `pointerdown` in card `a`, then collapse the caret in `a`
  and dispatch `selectionchange`, gives `'a'`; `pointerup` with a collapsed caret gives null; a press that
  ends with selected text in `a` gives `'a'` after `pointerup`. Keep the three existing cases.
- Watch at the D91 re-check: `onRenameOpened` calls `input.select()` (`canvas-rail-card.component.ts:434`);
  confirm the card title shows the new name right after Save from the Rail popover and from a modal row.

### Task V1.3: Serious 2, Rail footer button — COMPLETE

- `canvas-rail.component.ts:10,40,251,259,310`: lucide `History` icon `w-3.5 h-3.5 aria-hidden`, and the
  class string equals design-spec 2.1:79-80 exactly; `surface-2`/`surface-3` are Tailwind tokens
  (`apps/ptah-extension-webview/tailwind.config.js:39-40`). ARIA and test ids unchanged. Spec updated.
- Open until the D91 re-check: hover and open fills, hairline, label weight 500, dark and light.

### Visual fix round V1 verification

- Gate on the combined tree, 2026-10-17, team-leader: `nx run-many -t typecheck,lint -p ptah-electron-e2e
  @ptah-extension/chat @ptah-extension/canvas --parallel=1`: 6/6 tasks passed (cache 0/6).
  `nx run-many -t test -p @ptah-extension/chat @ptah-extension/canvas --parallel=1 --maxWorkers=2`:
  "Running target test for 2 projects", both passed (cache 0/2).
- After the V1.2 rework: re-gate `@ptah-extension/canvas` only (typecheck, lint, test). The chat V1
  files and the e2e files passed this gate and do not change. Then commit the 6 V1 files only.
- Then: codex re-review of the V1 commit, and the D91 visual re-check (the items above).
- Re-gate 2026-10-17, team-leader: `nx run-many -t typecheck,lint -p @ptah-extension/canvas
  --parallel=1` passed; `nx run-many -t test -p @ptah-extension/canvas --parallel=1 --maxWorkers=2`
  passed. Committed the 6 V1 files only as b8543ad25 (hook passed); Batch 12, Batch 13 and
  task-folder files left unstaged.

### Task V1.4: re-review finding 1 + finding 2 test part, live card title under a held selection — COMPLETE (commit 36619f3a1, D93)

- Source: `reviews/v1-fix-rereview.md` (codex re-review of b8543ad25) finding 1 (Serious) and finding 2
  test part; report `reports/fix-round-v1-report.md` section `## V1.4 fix`; gate
  `reports/mode-2-v1-4-gate.md`.
- `compact-rail-card.component.ts`: title removed from the hold latch (`latched` = `{ now, metrics }`),
  `shownTitle` deleted; visible title, its tooltip and four aria-labels bind live `title()`. Summary
  and metrics still latched while `holdText()`. Spec: real card attached to `document.body`, DOM
  selection survives, rename while held, asserts new visible title and tooltip, summary still held.
- Gate 2026-10-17, team-leader: `nx run-many -t typecheck,lint -p @ptah-extension/chat-ui
  --parallel=1` passed; `nx run-many -t test -p @ptah-extension/chat-ui --parallel=1 --maxWorkers=2`
  passed (Nx cache hit on the current inputs). Committed the 2 V1.4 files only (hook passed).
- Finding 2 browser part (400 px sheet geometry) stays with the D91 visual re-check.
- FU-11 "Overlapping pointers release the press hold early" (re-review finding 3, Minor, not fixed):
  the single `pressing` flag (`canvas-rail-board.component.ts:375,395-410`) clears on the first
  `pointerup`/`pointercancel` while another pointer is still down. Track active pointer ids. Scope:
  `@ptah-extension/canvas`.

---

## Phase 4: E2E alignment and approved runs (Batches 12-13)

Phase review: none (test code only). Evidence is the D7/D14 runs recorded in `test-report.md` by senior-tester.
Batches 12 and 13 stay split (D64): 12 files would exceed the 10-file merge cap, and Tasks 13.1-13.2 use
the Task 12.1 helpers. Wave C may give both to one codex lane back to back (Batch 12 files first);
the runs stay one at a time under D10, each batch committed on its own.
Precondition for every Electron launch (D10, orchestrator-owned): TASK_2026_681 has sent "Electron: free";
the orchestrator sends "Electron: TASK_2026_679 launching, port <n>" before and "Electron: free" after.
Never ports 9333 or 9351. Runs one at a time; each spec run once. The Electron e2e target depends on
`ptah-electron:build-dev`; that is part of the approved run, never run build targets separately.

## Batch 12: Electron e2e helpers and chat/git specs — COMPLETE (`6607db0d7`, D7 runs passed 2026-10-17 session 5, test-report.md)

- Recommended executor (D85): edits (Tasks 12.1 and the edit part of 12.2) by a codex CLI lane,
  role frontend-developer, in parallel with the Phase 3 visual review, no heavy check; then the
  team-leader gate and the four D7 runs by Claude subagent `senior-tester` after the visual review
- Execution mode: sequential
- Fallback order: other CLI family same capability -> fresh senior-tester subagent
- Subagent reason: the D7 runs launch Electron under D10 coordination (D3); edits need none
- S2 grep rule (D84): `sidebar-scroll(?![-\w])` must have zero matches in `apps/` and `libs/`
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

### Task 12.1: Helpers `openPreviousSessions`, `openSessionFromList`, rescoped `sessionRowButton` — COMPLETE (commit 6607db0d7)

- Files: `perf-session-fixture.ts`, `perf-page-capture.ts`
- Plan reference: implementation-plan.md:963-1000
- Pattern to follow: `perf-session-fixture.ts:433-460, 475-490`; `perf-page-capture.ts:204-211, 461-470`
- Quality requirements: helpers idempotent; selectors from the plan (`[data-testid="previous-sessions-list"]`,
  `[data-previous-sessions-trigger]`, dialog name "Previous sessions")
- Validation notes: no test deleted (Req 9.2-9.3)
- Implementation details: as the plan lists.
- S2 closure (Phase 3 codex review, D72/D77): `sessionRowButton` (`perf-session-fixture.ts:433-437`)
  no longer uses `.sidebar-scroll`; `prepareCanvasWithSessions` (`:444-458`) and the handle lookup
  (`:481-484`) wait for rows in the modal list, not the sidebar; that setup stays outside any
  measured window (the measured click that opens the modal stays as DP-13 discloses).

### Task 12.2: Update the four specs and run them — COMPLETE (commit 6607db0d7; four D7 runs passed, test-report.md runs 1-4)

- Depends on: Task 12.1
- Files: the four spec files
- Plan reference: implementation-plan.md:1000-1024, 1222-1224; DP-13
- Pattern to follow: existing spec structure
- Quality requirements: the perf spec header discloses that the measured window includes opening the modal
- Validation notes: R13, R14
- S2 callers to migrate (all of them, D77): `tile-open-longtask-budget.perf.spec.ts:288,451,519,526,605,607`;
  `tile-load-older-history.spec.ts:41,70,375,391,420`; `change-set-card.spec.ts:136,192,237,270`;
  `visual-review.spec.ts:1068,1072`.
- Implementation details: after `npx nx run-many -t typecheck,lint -p ptah-electron-e2e --parallel=1` passes,
  run once each, one at a time (D7):
  `npx nx e2e ptah-electron-e2e -- src/specs/chat/tile-load-older-history.spec.ts`,
  `… src/specs/chat/tile-open-longtask-budget.perf.spec.ts` (expected: skipped),
  `… src/specs/git/change-set-card.spec.ts`, `… src/specs/git/visual-review.spec.ts`.
  Record results in `test-report.md`.

### Batch 12 verification

- `npx nx run-many -t typecheck,lint -p ptah-electron-e2e --parallel=1`
- Four D7 runs reported (pass, or skip for the perf spec), output tailed
- S2 closed: `sidebar-scroll` has zero matches in `apps/` and `libs/` (team-leader grep), and every
  caller listed in Task 12.2 is migrated
- Commit: `test(e2e): batch 12 - open sessions through Previous sessions modal`

Result (team-leader MODE 2, 2026-10-17, `reports/mode-2-batch-12-v1-gate.md`):
- Edits verified against `reports/batch-12-report.md` by diff: 6 files, in scope; `resolveButtonHandles`
  and `ElementHandle` removed; perf header discloses the measured modal open (DP-13); no test removed.
- S2 grep (D84): `sidebar-scroll(?![-\w])` 0 in `apps libs`; `resolveButtonHandles` 0 in `apps`;
  `sidebar-scroll-body` 4 (harness-builder test id, kept).
- Gate: `typecheck,lint` passed for `ptah-electron-e2e` (with chat and canvas, 6/6, cache 0/6). This
  also compiled the uncommitted Batch 13 Electron files with no error.
- PENDING: the four D7 runs (senior-tester, one Electron slot after the D91 re-check), then commit.
  Watch for the 3-tile perf cases if `PTAH_PERF_SPECS=1` is ever set: the in-page loop clicks the next
  row one frame after the previous one, while `openRow` drops a click during `opening`
  (`previous-sessions-modal.component.ts:422`) and `open()` is a no-op while open
  (`previous-sessions-dialog.service.ts:44`). A marker timeout there points to this race. The default
  run is skipped, as expected.

## Batch 13: Canvas spec, docs shots and harness scenarios — COMPLETE (commit fb6b0f6d2)

- Gate 2026-10-17, team-leader (`reports/mode-2-batch-13-gate.md`): 6 files verified on disk;
  `nx run-many -t typecheck,lint -p ptah-electron-e2e @ptah-extension/webview-e2e-harness
  --parallel=1` passed (4/4 tasks); Task 11.1 grep gate zero matches in `apps/`/`libs/`
  (S2 boundary rule, D84); docs PNGs reverted (6 tracked via checkout, untracked
  `sessions-analytics.png` from run 6 removed). Runs: test-report.md runs 5-7, harness-fix runs
  (list 4/4, create 4/4, delete 5/5; list and delete passed on one `--workers=2` retry after
  browser infrastructure failures outside the modal cases). A3 confirmed: `useAppBuild: true`
  plus hard `#ptah-e2e-fixture-root` `toHaveCount(0)` in every modal case (D94).

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

### Task 13.1: `canvas.spec.ts` Rail footer locator — COMPLETE

- File: `canvas.spec.ts`
- Plan reference: implementation-plan.md:79, 1005-1010; D14
- Pattern to follow: `canvas.spec.ts:215-220`
- Quality requirements: target the New session button explicitly (two footer buttons now)
- Validation notes: R10
- Implementation details: run once (D14):
  `npx nx e2e ptah-electron-e2e -- src/specs/canvas/canvas.spec.ts -g "stacked split after a swap tabs from the Rail"`.

### Task 13.2: Docs shots — COMPLETE

- Files: `sessions.shot.ts`, `editor-git.shot.ts`
- Plan reference: implementation-plan.md:1010-1016, 1225-1226; DP-12
- Pattern to follow: existing shot scripts
- Quality requirements: open the modal through the helper before shooting session rows
- Validation notes: R12 - after the runs, `git checkout -- apps/ptah-docs/public/screenshots` is done by the
  team-leader (executors run no git); the tester lists every regenerated PNG
- Implementation details: from `apps/ptah-electron-e2e`, once each:
  `npx playwright test --config=docs-screenshots.config.ts src/docs-screenshots/sessions.shot.ts`, then
  `… src/docs-screenshots/editor-git.shot.ts`.

### Task 13.3: Harness scenarios — COMPLETE

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
- The full Task 11.1 grep gate list returns zero matches in `apps/` and `libs/` (closes
  `editor-git.shot.ts:39` "Toggle Sessions panel", D77)
- Commit: `test(e2e,webview-e2e-harness): batch 13 - modal canvas, docs, harness`

---

## Completion (Mode 3) inputs

- Parity: `parity-inventory.md` (required; the task replaces the sidebar surface). Rows A-F verified against
  the build; approved removals D6.
- Visual evidence: Phase 3 visual review, dark and light, against `prototype/` and D12.
- Write-path trace: no persisted settings are written by this task. The sidebar width write
  (`ptah.sessionSidebarWidth`) is removed with no new writer (DP-11); confirm in Mode 3.
