# Development Tasks — TASK_2026_173

**Title**: Editor panel — git-diff correctness, measured performance, and hunk-level stage/revert
**Total Batches**: 10 (0–9) | **Total Tasks**: 61 | **Status**: 8/10 complete (0–7). **SEQ-2 SATISFIED 2026-08-10** (`seq-2-verification.md`) — Batch 8 is UNBLOCKED and dispatched via `batch-8-dispatch.md`. Batch 9 reachable in parallel.
**Source plan**: `implementation-plan.md` §9, adopted with **two corrections** (see Plan Validation Summary).
**Binding overrides**: `amendments.md` supersedes `task-description.md` wherever they conflict. A-1..A-5, the A-group merge, and N1/N2/N3 are settled — do not re-litigate.
**CLI agent delegation**: **DISABLED** (user decision, Checkpoint 0.1). Every executor below is a sub-agent. Do not spawn CLI agents for any batch.

---

## Plan Validation Summary

**Validation Status**: **PASSED WITH RISKS** — §9's 10-batch structure is adopted. Two defects corrected, three assumptions documented.

### Assumptions Verified Against The Working Tree

| #   | Assumption                                                                             | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `ALLOWED_METHOD_PREFIXES` already contains `'git:'` (amendment A-2)                    | Verified — `libs/backend/vscode-core/src/messaging/rpc-handler.ts:67`. No new `git:*` method can hit the silent-crash mode. The live gates are `RPC_METHOD_PRESENCE` (compile error) and `GitRpcHandlers.METHODS` (test failure via `rpc-allowlist.spec.ts`).                                                                                                                                                                                                                                                                                                                                                           |
| 2   | `nx test ptah-electron` is the NFR-1 baseline target                                   | ⚠️ **STALE — rebaselined 2026-08-03.** Executor `apps/ptah-electron/project.json:294-300`, `@nx/jest:jest`, still correct. The **143 passed / 4 skipped** figure is not: TASK_2026_171 P3 relocated the Layout/Terminal/Update handler families and their specs to `libs/backend/rpc-handlers`. Electron is now **135 passed / 4 skipped**; `rpc-handlers` is **1410 passed / 2 skipped**. `nx test ptah-electron` alone is **no longer a sufficient NFR-1 target** — batch 2 touches `GitRpcHandlers`, which lives in `rpc-handlers`. See Standing Per-Batch Gates item 1 for the replacement cross-project invariant. |
| 3   | Spec files named in plan §8.5 exist and can be extended                                | Verified — `diff-view.component.spec.ts`, `editor-panel.component.spec.ts`, `file-tree-node.component.spec.ts`, `git-status.service.spec.ts`, `editor-workspace.spec.ts`, `code-editor.component.spec.ts` all present. `editor-diff-split.spec.ts` and `git-info.service.spec.ts` are genuinely NEW.                                                                                                                                                                                                                                                                                                                    |
| 4   | `apps/ptah-electron-e2e/src/specs/editor/` exists as a home for the M1/M3/M4 harnesses | Verified — contains `editor.spec.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 5   | N1's `@if`/`@else if`/`@else` chain terminating in `<ptah-code-editor>`                | Verified — `editor-panel.component.ts:254` / `:264` / `:276`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 6   | `execGit` is small enough to harden without collateral                                 | Verified — 84 lines. All 16 `GitInfoService` call sites remain source-compatible (changes are additive).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### Defects Found in §9 — CORRECTED

**DEFECT 1 (blocking parallelism claim — corrected).**
§9 and Risk A-9 both assert _"Batches 4/6 touch disjoint files and may run parallel with 3"_ and _"batch 6 … may run parallel with 3–5"_. **This is false.** Batches 3, 4, and 6 all edit the same 964-line file, `libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts`:

- Batch 2 edits `:223-232` (stale/error glyph in the tab strip) and `:255-262` (diff-view input binding)
- Batch 3 restructures the template at `:254-287` (three-layer always-mounted region, N1 + B1)
- Batch 4 rewrites three drag handlers at `:837-849`, `:885-902`, `:930-940` (B5)
- Batch 6 rewrites the tab strip at `:206-232` and deletes `stopPropagation` at `:672` (D1)

Regions are _mostly_ disjoint within the file, but four separate sub-agent passes editing one file on a shared checkout worked by concurrent agents (NFR-9, R-8) is exactly the cross-contamination failure mode NFR-9 exists to prevent, and the Edit tool's exact-match requirement makes stale reads a near-certainty under concurrency. **Correction: batches 3 → 4 → 6 run strictly sequentially.** No batch in this task runs in parallel with any other. Risk A-9's own reasoning ("do not run batches 2 and 3 in parallel") applies with equal force to 3/4/6; it simply missed the overlap.

**DEFECT 2 (floating measurement step — corrected).**
§9 places all of B0 in batch 0 but §7 states M1's baseline _must_ be captured after the A batch lands, because batch 2 rewrites the diff fetch path. §9 notes this in a parenthetical and then never re-homes the step, leaving it orphaned between batches. **Correction: M1 baseline capture is Task 2.14, the final gated task of batch 2.** Batch 3 cannot report an M1 after-figure without it, so it is made an explicit exit criterion of batch 2, not a note.

### Risks Identified

| ID      | Risk                                                                                                                                                                                                                                                                                                                                              | Severity                  | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V-1** | **Open Question #1 (B4 exclusion unification) is unresolved.** `amendments.md` settles A-1..A-5 and N1–N3 but is silent on it. AC2 demands watcher and tree agree; they currently disagree in both directions, and strict unification silently stops the file tree showing `node_modules` and `dist` — a user-visible change beyond stated scope. | **HIGH** (blocks batch 5) | Batch 5 **defaults to the plan's own recommendation**: two named sets behind one shared predicate (`TREE_HIDDEN_DIRS` ⊆ `WATCH_IGNORED_DIRS`), which satisfies AC2's "single source of truth for the mechanism" while leaving tree visibility unchanged and honouring R-9. **Orchestrator MUST confirm this with the user at the batch 4→5 boundary before spawning batch 5.** Recorded as Task 5.0, a gate.                                                                 |
| **V-2** | Batch 2 is the largest and riskiest unit in the task (14 tasks spanning `libs/shared`, `libs/backend`, `libs/frontend`) and SEQ-1 forbids splitting it across commits. A single executor pass over that surface is a review-quality hazard.                                                                                                       | **HIGH**                  | Batch 2 runs as **three sequential executor passes inside one batch and one commit** (2A backend, 2B frontend, 2C verification). SEQ-1 is preserved because the _tab-key scheme_ is entirely frontend and is touched exactly once, in pass 2B. **The orchestrator MUST NOT commit between passes.**                                                                                                                                                                          |
| **V-3** | R-3 (A3 makes previously-invisible git failures visible) has a 13-case triage matrix that must execute **before** batch 2 merges, per plan §3.5. If deferred to QA it invalidates the batch.                                                                                                                                                      | **MEDIUM**                | Task 2.13 — a named senior-tester pass, gated as a batch-2 exit criterion, each case recorded pass / fixed-in-scope / follow-up finding.                                                                                                                                                                                                                                                                                                                                     |
| **V-4** | Open Question #3 — `patch`/`hunks` fields on `GitDiffFileResult` land in the D2 batch, meaning the result interface is touched twice.                                                                                                                                                                                                             | **LOW**                   | Adopted as planned (D2 batch). SEQ-1's verification criterion constrains the _tab-key scheme_, not the RPC result interface; an additive non-breaking field in batch 8 does not violate it. Documented so no reviewer flags it as scope drift.                                                                                                                                                                                                                               |
| **V-5** | Batch 1 mixes frontend (two Angular services, one provider) with backend (`libs/shared` constants, `git-watcher.service.ts` constant swap) — against the standing never-mix rule.                                                                                                                                                                 | **LOW**                   | **Deliberate deviation, justified**: C1 AC2 requires the wire format to be byte-identical across the swap, which is only verifiable when both sides move together. The backend slice is ~12 lines of mechanical constant substitution. Assigned `frontend-developer` where all the risk lives. If the orchestrator insists on strict separation, the shared-constants slice can be lifted to a prep task — **not recommended**, it splits the one assertion that proves AC2. |
| **V-6** | Batch 4's B3 edits `git-status.service.ts`, which batch 1 converts to a `MessageHandler`.                                                                                                                                                                                                                                                         | **LOW**                   | Sequential ordering (1 before 4) already resolves it. Noted so batch 4's executor reads the post-C1 file, not the plan's pre-C1 line numbers.                                                                                                                                                                                                                                                                                                                                |

### Edge Cases To Handle (traced to owning task)

- [ ] Chunk-boundary multi-byte UTF-8 corruption in `execGit` → Task 2.1 (spec with payload straddling a 64 KiB boundary)
- [ ] `git apply -` cannot run because stdin is never closed → Task 2.1 (N2, hard prerequisite for both A3 and D2)
- [ ] Staged rename diffs against the wrong source path → Tasks 2.4, 2.11 (N3, `origPath`)
- [ ] Genuinely-empty tracked file rendering as "(new file)" → Task 2.10 (drive chrome from `originalRef.kind`, not `originalContent === ''`)
- [ ] Repository with zero commits (HEAD unresolvable) → Task 2.3 side-resolution table
- [ ] Monaco laid out while hidden measures zero → Task 3.2 (`layout()` inside `rAF`, not a microtask)
- [ ] `saveViewState()` may not restore collapsed regions on the pinned Monaco version → Task 3.4 (verify empirically; if it fails, report per B0 AC4 — do **not** claim a pass)
- [ ] Windows `\` vs POSIX `/` in directory-prefix indicators → Task 4.2
- [ ] Drag interrupted by window blur or ESC → **TASK_2026_176** (folded out of Task 4.4; all three handlers leak today)
- [ ] Over-broad exclusion hides real source changes → Task 5.3 (R-9; modify a tracked file mid-M3-window)
- [ ] CRLF / no trailing newline / non-ASCII byte-identity → Task 8.7 (real temp repos; mocked git is not evidence)
- [ ] Binary file → hunk actions absent, not present-and-broken → Tasks 2.10, 8.5
- [ ] `git apply` offset tolerance silently shifting a hunk → Task 8.4 (snapshot token makes shift impossible; also parse stderr for `offset` and log)

### Blockers Found

**None that stop decomposition.** V-1 is a decision gate scoped to batch 5 only; batches 0–4 and 6–9 are unaffected and the plan supplies a defensible default.

---

## Standing Per-Batch Gates (apply to EVERY batch, no exceptions)

Every batch must leave the repo committable and green. Before a batch is marked COMPLETE:

1. **NFR-1 test baseline** — **REBASELINED 2026-08-03, see note below.** `nx test ptah-electron` shows **≥135 passed / ≤4 skipped** AND `nx test rpc-handlers` shows **≥1410 passed / ≤2 skipped**. Both are gates at _every_ batch boundary, not only at the end. Converting a failing test to skipped is a regression, not a fix.

   > **Why the number changed.** The original gate (`≥143 passed`) was written before TASK_2026_171 P3 landed. That task moved the Layout, Terminal and Update RPC handler families out of `apps/ptah-electron` into `libs/backend/rpc-handlers`, and their specs moved with them. Electron also gained 15 characterization tests (Batch 0) and 2 DI identity assertions. Net effect on `ptah-electron`: **143 passed → 135 passed**, with 25 tests now living in `rpc-handlers` instead. **This is relocation, not regression** — no test was deleted or skipped.
   >
   > **Use the cross-project invariant as the real gate**: `ptah-electron passed + rpc-handlers passed` must never decrease. Current floor: **135 + 1410 = 1545**. A test vanishing from one project without appearing in the other is a regression regardless of what either number reads alone. Per-project floors above are secondary — they catch a project-local wipe, but only the sum catches a silent loss in transit.
   >
   > Relevant to this task specifically: **batch 2 rewrites the diff read path and touches `GitRpcHandlers`, which lives in `rpc-handlers`.** That project's count is now load-bearing here, not incidental.

2. **Typecheck** — `nx typecheck` clean for every changed project.
3. **Lint, standalone per project** — run `nx lint <project>` **individually for each changed project**. Do **not** rely on a batched `nx run-many -t lint`. A `run-many` under parallel load recently masked a real `@nx/dependency-checks` error in this repo; standalone invocation is the only trustworthy signal.
4. **Affected unit tests** — `nx test <project>` for each changed project (`shared`, `ptah-extension-webview`, `libs/frontend/editor`, `ptah-electron` as applicable).
5. **Three-runtime build** (NFR-5) — required for any batch touching `libs/shared` or `libs/backend`: VS Code, Electron and CLI all build.
6. **Scope discipline** (NFR-9) — work confined to the files listed. Failures originating outside this task's scope are **reported and the batch stopped**, never fixed opportunistically. `--no-verify` is forbidden.
7. **NFR-2** — `ChangeDetectionStrategy.OnPush` on every component touched or added; signals + `inject()`; new state workspace-partitioned.

---

## Batch 0: Measurement Harnesses & Baselines ✅ COMPLETE — `accb485ed` (2026-08-03)

**Recommended Executor**: `senior-tester`
**Fallback Executor**: `frontend-developer`
**Execution Mode**: sequential
**Rationale**: Pure test-harness construction — Playwright specs in `ptah-electron-e2e` plus one Jest benchmark. No product code is instrumented (plan §7). This is a tester's core competency and touches zero files any other batch touches, so it also warms up the verification apparatus every later batch depends on.
**Tasks**: 5 | **Dependencies**: None | **Satisfies**: B0

### Task 0.1: M1 harness — diff-tab re-display latency ⏸️ PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-electron-e2e\src\specs\editor\perf-m1-diff-redisplay.spec.ts` (NEW)
**Requirement**: B0 (M1)
**Details**: Playwright. `page.evaluate` installs a `MutationObserver` on the modified editor's `.view-lines`; resolve at the first `rAF` after the expected line count appears; time from synthetic click with `performance.now()`. Workload: ~500-line TypeScript file, alternating diff-tab ↔ file-tab. 10 round trips; report **median and max**.
**Validation Notes**: Do NOT capture the M1 baseline here — plan §7 requires it after batch 2 lands (Task 2.14). Build the harness only, and prove it runs.

### Task 0.2: M2 harness — `git:status-update` handling cost ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\file-tree\perf-m2-status-update.spec.ts` (NEW)
**Requirement**: B0 (M2), B3
**Details**: Jest. Build 300 `GitFileStatus` entries + 100 `FileTreeNodeComponent` fixtures; dispatch the message; time `fixture.detectChanges()` + `TestBed.flushEffects()`. 10 iterations, median + max. Include a generous upper-bound assertion so it doubles as a permanent regression guard.
**Validation Notes**: Plan §7 flags a deliberate deviation from B0 AC5 (Electron as reference runtime): M2's cost is entirely renderer-side and identical across hosts, and Jest yields a far more reproducible figure than a GPU-scheduled Electron window. **Report the Jest figure as M2, with an Electron spot-check for confirmation, and state the deviation explicitly in the artifact** — B0 AC4 requires deviations be flagged, not buried.

### Task 0.3: M3 harness — `git status` invocations from cache churn ⏸️ PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-electron-e2e\src\specs\editor\perf-m3-watcher-churn.md` (procedure) + any needed script
**Requirement**: B0 (M3), B4
**Details**: Launch the Electron dev build with `GIT_TRACE=1`; git emits one trace line per invocation to stderr, already captured by the main-process log. Run a 60 s build writing `.nx/cache` + `.angular/cache`; count trace lines matching `status`. **Zero product-code change.** Also modify one tracked source file mid-window to prove B4 AC3 (genuine changes still fire).
**Validation Notes**: Baseline expected ≈30 invocations; target is 0 attributable to already-excluded paths.

### Task 0.4: M4 harness — change-detection passes during drag ⏸️ PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-electron-e2e\src\specs\editor\perf-m4-drag-cd.spec.ts` (NEW)
**Requirement**: B0 (M4), B5
**Details**: Playwright `page.mouse.move` loop for 2 s over the sidebar splitter; a `MutationObserver` on the sidebar element's `style` attribute counts layout writes; compare against a parallel `rAF` frame counter. Measures the observable effect rather than CD internals — externally verifiable and framework-version-proof. 2 s window × 5 runs, median + max.

### Task 0.5: Capture M2, M3, M4 baselines and create the measurement artifact ⏸️ PENDING

**File**: `D:\projects\ptah-extension\.ptah\specs\TASK_2026_173\measurements.md` (NEW)
**Requirement**: B0 AC1, AC2, AC3
**Details**: Record, for each of M2/M3/M4: workload definition, sample count, **median and max**, machine, method — sufficient for a third party to reproduce. Single-shot numbers are not acceptable (B0 AC3).
**Validation Notes**: M2/M3/M4 baselines are valid on today's code — batches 1 and 2 touch none of those paths (plan §7). M1's row stays empty until Task 2.14.

**Batch 0 Acceptance Criteria**:

- Four harnesses exist and execute end-to-end
- `measurements.md` contains M2, M3, M4 baselines with median + max + workload + sample count + method (B0 AC1–AC3)
- M2's Electron-vs-Jest deviation stated explicitly (B0 AC4)
- M1 row present but explicitly marked "deferred to Task 2.14"
- Standing gates 1–4 pass

---

## Batch 1: Message Plumbing (C1) ✅ COMPLETE — `df2ab24fb` (2026-08-03)

**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential
**Rationale**: Small and mechanical — four `MESSAGE_TYPES` entries, two Angular services converted to `MessageHandler`, one provider line. All the risk (Angular DI instantiation timing, debounce preservation) is frontend. The two backend-side edits are ~12 lines of constant substitution. See risk **V-5** for why this batch deliberately spans both sides.
**Tasks**: 6 | **Dependencies**: Batch 0 (soft — harnesses should exist before product code moves, so a regression is measurable) | **Satisfies**: C1

> **AMENDMENT A-4 IN FORCE**: C1 runs FIRST, ahead of the A-group. This reverses SEQ-3 §4. A1's fix needs a new `git:status-update` subscriber inside the editor lib; with C1 unlanded it would either add a fourth raw `window.addEventListener` (violating the lib's own guideline #1 that C1 exists to enforce) or thread through `EditorWorkspaceHelper`'s raw handler, which C1 then rewrites. Running C1 first means A1 writes its trigger into the final architecture exactly once. **This violates neither SEQ-1 nor SEQ-2.**

### Task 1.1: Add the four shared message types ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\messages\message-constants.ts`
**Requirement**: C1 AC4
**Details**: Append (append-only, per the shared-lib guideline) `GIT_STATUS_UPDATE: 'git:status-update'`, `FILE_TREE_CHANGED: 'file:tree-changed'`, `FILE_CONTENT_CHANGED: 'file:content-changed'`, `EDITOR_REREAD_OPEN_TABS: 'editor:reread-open-tabs'`.

### Task 1.2: Add payload map entries ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\messages\payload-map.ts`
**Requirement**: C1 AC4
**Details**: Payload entries for the four new types. `git:status-update` carries `workspaceRoot` + `causes`.

### Task 1.3: Watcher uses the shared constants ⏸️ PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\git-watcher.service.ts` (~`:43-57`)
**Requirement**: C1 AC2, AC5
**Details**: Swap the four local string constants for the shared ones. **The wire format must be byte-identical** — this is what makes C1 AC2 and AC5 true by construction rather than by testing.

### Task 1.4: `GitStatusService` → `MessageHandler` ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\git-status.service.ts` (~`:217-225`)
**Requirement**: C1 AC1, AC2, AC3
**Details**: `implements MessageHandler`; `handledMessageTypes = [MESSAGE_TYPES.GIT_STATUS_UPDATE]`. `startListening()` keeps the eager `fetchGitInfo()` and drops the raw listener; `stopListening()` becomes a no-op stub or is removed together with its `destroyRef` hook.
**Validation Notes**: Do **not** touch `CACHE_TTL_MS` or the fetch scheduling documented at `:72-87`. Plan Open Question #2 confirms diff refresh and the 5 s TTL do not interact — `git:diffFile` is a different RPC driven by the same push.

### Task 1.5: `EditorWorkspaceHelper` routes through `EditorService` ⏸️ PENDING

**Files**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor\editor-workspace.ts` (`:325-358`), `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor.service.ts` (`:366-394`)
**Requirement**: C1 AC1, AC2, AC3, AC4
**Details**: `EditorWorkspaceHelper` is a plain class, not injectable — route its three message types through `EditorService`, which is already a `MessageHandler`. Extend `handledMessageTypes`; delegate in `handleMessage`. Delete the raw `window.addEventListener` at `editor-workspace.ts:357` and its `removeEventListener` at `:363`. `startFileTreeWatcher`/`stopFileTreeWatcher` shrink to timer lifecycle only.
**Validation Notes**: **The debounce timers and their exact windows stay on the helper, unchanged** — C1 AC2 requires observable behaviour including existing debounce windows to be identical. C1 AC3 requires no handler registered and no timer pending after destruction.

### Task 1.6: Register the provider ⏸️ PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\app.config.ts` (~`:129`)
**Requirement**: C1 AC1, AC5
**Details**: `{ provide: MESSAGE_HANDLERS, useExisting: GitStatusService, multi: true }` alongside the existing `EditorService` provider.
**Validation Notes**: **Gotcha (Risk A-8)** — `MessageRouterService` reads `handledMessageTypes` in its constructor (`message-router.service.ts:29-31`), so `useExisting` forces `GitStatusService` instantiation at router-construction time. Verified safe today: its constructor only registers a destroy hook (`:157-159`). Re-verify if the constructor has grown.

> ### ⚠️ TWO AC DEFECTS FOUND DURING EXECUTION — verified by the orchestrator, 2026-08-03
>
> **AC1 is not achievable within tasks 1.1–1.6 as scoped.** Post-batch grep of `libs/frontend/editor/src` still shows two raw listeners:
>
> ```
> git-branches.service.ts:149    window.addEventListener('message', this._messageHandler);
> worktree.service.ts:251        window.addEventListener('message', handler);
> ```
>
> `GitBranchesService` consumes the **same** `git:status-update` push this batch just moved — it is the second renderer occurrence of that literal. Neither file appears in this batch's task list or the plan's own file table. Per NFR-9 the executor correctly did **not** touch them.
>
> **Achievable claim**: "zero raw listeners in the two services C1 names". AC1's wording ("zero in editor services") overstates the scope. `GitBranchesService` is a near-identical conversion consuming a type now in `MESSAGE_TYPES` — **file as a follow-up**, do not smuggle it into a later batch.
>
> **AC5 is not satisfiable as written.** It requires "message delivery verified working in VS Code, Electron and CLI". A repo-wide grep confirms `apps/ptah-electron/src/services/git-watcher.service.ts` is the **only producer of all four message types anywhere** in `apps/` or `libs/backend/` (the sole other hit is `apps/ptah-electron-e2e/src/support/ui-driver.ts:267`, a test helper). VS Code and the CLI emit none of them, before or after this change. **There is nothing to deliver in two of the three hosts.**
>
> Reinterpreted for this task as: _the consumer path is host-agnostic and is exercised end-to-end_ — true, and now covered by `apps/ptah-extension-webview/src/app/editor-message-routing.spec.ts`, which drives real `window` `MessageEvent`s through the real `MessageRouterService` into the real services. **Not** "all three hosts push these", which is false today. If a future host grows a watcher, AC5's original reading becomes meaningful again.

**Batch 1 Acceptance Criteria**:

- ~~Zero raw global `message` event listeners remain in editor services~~ → **zero in the two services C1 names** (`git-status.service.ts`, `editor-workspace.ts`). See the AC1 defect note above. (C1 AC1, amended)
- All four message types behave identically, **including debounce windows** (C1 AC2)
- No handler registered and no timer pending after service destruction (C1 AC3)
- Exactly one place to add a future message type: `EditorService.handledMessageTypes` + its switch (C1 AC4)
- Message delivery verified working in VS Code, Electron and CLI (C1 AC5)
- Standing gates 1–7 pass

---

## Batch 2: 🔑 THE KEYSTONE — A1 + A2 + A3 + A4 (+ N2, N3) ✅ COMPLETE — `61628f623` (2026-08-03)

**Recommended Executor**: **three sequential passes, one batch, ONE commit**

- **Pass 2A** → `backend-developer` (Tasks 2.1–2.6)
- **Pass 2B** → `frontend-developer` (Tasks 2.7–2.12)
- **Pass 2C** → `senior-tester` (Tasks 2.13–2.14)

**Fallback Executor**: `backend-developer` for the whole batch
**Execution Mode**: sequential (strictly — 2A, then 2B, then 2C)
**Rationale**: This is the largest and riskiest unit in the task and SEQ-1 forbids splitting it across commits. Splitting it across _executor passes_ within one batch is not the same thing and is the only way to keep review quality tractable across `libs/shared` + `libs/backend` + `libs/frontend` (risk **V-2**). SEQ-1 is preserved because the tab-key scheme is entirely frontend and is touched exactly once, in pass 2B.
**Tasks**: 14 | **Dependencies**: **Batch 1 (hard)** | **Satisfies**: A1, A2, A3, A4, N2, N3

> ### ⛔ ORCHESTRATOR: DO NOT COMMIT BETWEEN PASSES ⛔
>
> Passes 2A, 2B and 2C are one indivisible unit of work. Run each pass, verify, then run the next. **A single commit lands at the end of pass 2C, after all fourteen tasks.** Committing after 2A produces exactly the half-migrated, shippable-looking-and-wrong intermediate state SEQ-1 exists to forbid.

> ### 📏 SEQ-1 VERIFICATION CRITERION (strengthened per amendments.md)
>
> **The diff of the delivered change SHALL show the diff-tab key scheme changed exactly once.** This is a hard review gate. If a reviewer can point at two separate rewrites of the key scheme in this diff, the batch is rejected regardless of whether it works.

### Pass 2A — Backend (`backend-developer`)

### Task 2.1: `execGit` hardening (N2 — HARD PREREQUISITE) ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\utils\exec-git.ts`
**Requirement**: N2, A3, D2 (prerequisite for both)
**Details**: Three additive changes (plan §3.2):

1. **Buffer accumulation** — collect `Buffer[]` and `Buffer.concat(...).toString('utf8')` once at close, replacing `stdout += data.toString()` per chunk (`:62-64`). Fixes chunk-boundary UTF-8 corruption.
2. **`execGitBuffer(args, cwd, opts): Promise<{ stdout: Buffer; stderr: string; exitCode: number }>`** — new sibling for blob reads (NUL-byte binary detection, `byteLength`) and snapshot hashing. `execGit` becomes a thin string wrapper over it.
3. **stdin** — `ExecGitOptions.stdin?: string | Buffer`; write it then `child.stdin.end()`. When absent, `child.stdin.end()` **immediately** so no git subcommand can block on an open pipe (`:43` never closes it today).
4. **`env` merge** — set `LC_ALL=C`, `LANG=C`, `GIT_OPTIONAL_LOCKS=0` on all invocations. `GIT_OPTIONAL_LOCKS=0` additionally stops read-only `git status` touching `.git/index.lock` — a free reduction in the watcher feedback loop B4 later fights.

**Validation Notes**: **This is the hard prerequisite for both A3 and D2 and it lands HERE, not in batch 8.** `git apply -` cannot be invoked at all today. All 16 existing `GitInfoService` call sites must remain unchanged — the changes are additive. **Add a spec with a multi-byte UTF-8 payload straddling a 64 KiB chunk boundary** (Risk A-2).

### Task 2.2: `readBlob` with show→cat-file classification ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\git-info.service.ts` (NEW method)
**Requirement**: A3 AC1, AC2, AC3, AC5
**Details**: `readBlob(root, ref, path): GitBlobRead`. Classify on the failure path using **exit codes, not messages** (locale-independent, zero extra spawns on the happy path):

```
git show <rev>:<path>
  exit 0    -> 'content'  (or 'binary' if bytes contain NUL)
  exit != 0 -> git cat-file -e <rev>:<path>
                 exit 0 -> 'error' (object exists, show failed)
                 exit 1 -> 'absent'
                 other  -> 'error', classify by pre-flight probe
```

Pre-flight probes for the error branch: `isGitRepo()` fails → `not-a-repo`; `git rev-parse --verify HEAD` fails → `no-commits`; `ENOENT` → `git-missing`; timeout message → `timeout`; `EACCES`/`EPERM` → `permission-denied`; else `unknown`.
**Validation Notes**: `git:showFile` is **kept unchanged** — `worktree-hook-handler.ts` and others still call it. Do not widen `GitShowFileResult`. A3's contract change is delivered through the new method only.

### Task 2.3: `diffFile` service method ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\git-info.service.ts` (NEW method)
**Requirement**: A2 AC1, AC2, AC6; A4 AC1, AC2, AC5
**Details**: Implement the two comparisons and the full side-resolution table from plan §2.2:

| Status         | comparison | originalRef                 | modifiedRef      |
| -------------- | ---------- | --------------------------- | ---------------- |
| `M` unstaged   | worktree   | `index`                     | `worktree`       |
| `M` staged     | staged     | `commit(HEAD)`              | `index`          |
| `??` untracked | worktree   | **`absent`**                | `worktree`       |
| `A` staged     | staged     | **`absent`**                | `index`          |
| `D` unstaged   | worktree   | `index`                     | **`absent`**     |
| `D` staged     | staged     | `commit(HEAD)`              | **`absent`**     |
| `R` staged     | staged     | `commit(HEAD)` @ `origPath` | `index` @ `path` |
| no commits     | staged     | **`absent`**                | `index`          |

Worktree side reads bytes via `IFileSystemProvider.readFileBytes` (`PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` — the port already exists, registered in all three hosts). `snapshotToken` = sha256 over the exact bytes of both sides + ref identity; opaque to the client.
**Validation Notes**: **`HEAD ↔ worktree` is dropped entirely** — it corresponds to no UI row and is the source of A2's defect. A4 falls out for free: nothing hard-requires the worktree file to exist, so `D` produces `index ↔ absent` and renders. **Amendment A-5 in force**: a worktree deletion's original side is the **index**, not HEAD; the two coincide only when nothing is staged.

### Task 2.4: `parseFileStatus` populates `origPath` (N3) ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\git-info.service.ts` (`:988-1010`)
**Requirement**: A2 AC6, N3
**Details**: The `porcelain=v2` type-2 (rename/copy) parser currently slices only the pre-tab segment and discards the original path. Populate `origPath` from the post-tab segment.
**Validation Notes**: Without this, A2 AC6 (staged rename diffs against the correct pre-rename source) is unimplementable. Requires the `GitFileStatus` extension in Task 2.5.

### Task 2.5: Shared RPC types ⏸️ PENDING

**Files**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-git.types.ts`, `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
**Requirement**: A2, A3, A4, N3, NFR-4
**Details**: Add `GitReadErrorCode`, `GitBlobRead`, `DiffSideRef`, `GitDiffFileParams`, `GitDiffFileResult`. Add `origPath?: string` to `GitFileStatus`. Leave `GitShowFileResult` untouched. Add `git:diffFile` to **both** `RpcMethodRegistry` **and** `RPC_METHOD_PRESENCE`.
**Validation Notes**: **Amendment A-2 — name the gate that can actually fail.** `ALLOWED_METHOD_PREFIXES` already contains `'git:'` (verified, `rpc-handler.ts:67`); no `git:*` method can reach the silent-crash mode. The two gates that _can_ fail, both loud: (1) `RPC_METHOD_PRESENCE` → **compile error**; (2) `GitRpcHandlers.METHODS`, asserted by `rpc-allowlist.spec.ts:43` to partition `RPC_METHOD_NAMES` exactly → **test failure**. Do not send reviewers hunting for a missing prefix that cannot be missing.

### Task 2.6: `git:diffFile` handler + Zod schema ⏸️ PENDING

**Files**: `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\git-rpc.handlers.ts`, `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\git-rpc.schema.ts` (NEW)
**Requirement**: A2, A3, A4, NFR-3, NFR-8
**Details**: Register `git:diffFile`; extend the `METHODS` tuple; inject `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` for the worktree-side read. New Zod schema file for this method only — **do not retrofit the other 16 methods in this task**.
**Validation Notes**: **Amendment A-1 in force** — no `platform-core` git port. `GitInfoService` + `GitRpcHandlers` are already three-runtime (`manifest.ts:154-158`, `requires: []`; registered VS Code `phase-3-handlers.ts:56`, Electron `phase-4-handlers.ts:102`, CLI `container.ts:274`). Do **not** add capability to `git-watcher.service.ts` or any host-specific handler. Call `validatePathSegment` (`git-info.service.ts:450-461`) on **both** `path` and `originalPath` before any git invocation (NFR-8). Backend returns a code plus a short pre-sanitized message — **raw stderr and absolute paths go to `logger.error` and nowhere else** (A3 AC4).

### Pass 2B — Frontend (`frontend-developer`)

### Task 2.7: The structured diff tab record ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor\editor-tab.types.ts`
**Requirement**: A1, A2 (SEQ-1 core)
**Details**: Add `DiffComparison`, `DiffSideRef`, `DiffTabStatus`, `DiffTabState` per plan §2.1. `EditorTab.diff?: DiffTabState` — **presence is the discriminant**. **Direct replacement**: `isDiff`, `originalContent`, `diffRelativePath` are **deleted, not deprecated**. `content` stays the modified side so `switchTab`/`closeTab`'s `activeFileContent.set(tab.content)` (`editor-tabs.ts:85`, `:69`) keep working unmodified.
Key format: `diff:<comparison>:<relativePath>`. Collision-safe — real file tabs are keyed by _absolute_ paths.
**Validation Notes**: **THIS IS THE TAB-KEY SCHEME CHANGE. It happens here, once.** Nothing anywhere may parse the key string — the typed descriptor exists so it never has to. **Amendment A-3**: no migration, no dual-format reader, no first-run purge. `_workspaceEditorState` is an in-memory `Map` (`editor.service.ts:43-46`); no backend writer of editor `openTabs` exists anywhere under `libs/backend/` or `apps/`. R-2 is Low/Low.

### Task 2.8: `openDiff` rewrite ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor\editor-diff-split.ts` (`:23-96`)
**Requirement**: A1 AC4; A2 AC1, AC2, AC3, AC4; A4 AC1, AC2, AC4
**Details**: `openDiff(request)` takes a comparison; builds the structured key; makes **one** `git:diffFile` RPC (today: two per tab, so refreshing three tabs costs six). **Delete the early return at `:29-36`** — re-click now activates _and_ revalidates (A1 AC4). **Delete the hard requirement on `editor:openFile` at `:54-62`** — this is what blocks A4 today.
Tab label, derived once at creation (A2 AC4, unambiguous without hover): `foo.ts (staged)` / `foo.ts (working tree)`; deleted → `foo.ts (deleted, staged)`; untracked → `foo.ts (new)`.

### Task 2.9: `refreshDiffTab` + the revalidation path ⏸️ PENDING

**Files**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor\editor-diff-split.ts`, `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor.service.ts`, `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor\editor-workspace.ts`, `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor\editor-file-ops.ts`
**Requirement**: A1 AC1, AC2, AC3, AC5, AC6, AC7
**Details**: Trigger source is **`git:status-update`**, not `editor:reread-open-tabs` — it is the authoritative "git state changed" push, already fires on every commit/stage/checkout/discard (`git-watcher.service.ts:148-171`), and carries `workspaceRoot`. Debounce 250 ms per workspace.

Refresh algorithm (plan §2.4):

1. Read tab, bail if absent; capture `originWorkspace`; bail if `inFlightDiffRefreshes.has(key)` (mirrors `inFlightRereads`, `editor-file-ops.ts:26`) — bounded queueing per NFR-7
2. Bump `diff.requestId`; `status: 'refreshing'`. **Do not touch `original`/`modified`** — A1 AC6, no flicker to empty
3. `rpcCall('git:diffFile', …)`
4. Drop the response if `requestId` moved, or the workspace changed, or the tab closed
5. Success → write state, `status: 'fresh'`, update `content` / `activeFileContent` / `syncTabsToCache()`
6. Either side `outcome:'error'` → `status: 'error'`, mapped message, **retain previous content** (A1 AC7)
7. Transport failure → `status: 'stale'`, retain content, indicator shown

**`editor:reread-open-tabs` must SKIP tabs where `tab.diff` is set** — the loop at `editor-workspace.ts:349-353` stops issuing `editor:openFile` against `diff:…` keys. `handleFileContentChanged` becomes a no-op for diff-keyed paths (defence in depth).
`file:content-changed` (path P) → refresh any `worktree` diff tab whose `diff.path` matches.
**Validation Notes**: **A1 AC5 is verified by a literal count: 0 failed RPCs across 5 consecutive git operations with 3 diff tabs open.** A1 AC3 (discard) — choose "render an empty diff", not self-close: after refresh `original === modified` and the header renders "No changes". AC3 permits either; self-closing a tab the user is looking at is more surprising.

### Task 2.10: `DiffViewComponent` — A-group states ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\diff-view\diff-view.component.ts`
**Requirement**: A1 AC7; A3 AC1, AC2, AC5; A4 AC3, AC5
**Details**: Render per outcome (plan §3.3):

| original / modified   | Render                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `content` / `content` | Normal diff                                                                                          |
| `absent` / `content`  | "(new file)" chrome — **driven by `originalRef.kind === 'absent'`, NOT by `originalContent === ''`** |
| `content` / `absent`  | "(deleted)" chrome, modified pane empty (A4 AC3)                                                     |
| `binary` either side  | "Binary file — diff not shown"                                                                       |
| `error` either side   | Error overlay + Retry; **never** rendered as content                                                 |

New **diff header bar** replacing the floating `(new file)` badge at `:56-62`: status chip + Retry + the new/deleted/binary chrome (the D3 toggle is added in batch 3). `GitReadErrorCode` → a fixed user-facing string table on the **frontend**.
**Validation Notes**: **The `originalRef`-driven chrome is exactly what fixes A3 AC5** — a genuinely empty tracked file now renders as an empty diff, not as a new file. Replaces `diff-view.component.ts:100-102`. Error state is a **persistent overlay, not a toast** — A1 AC7 requires a persistent indicator. **Do not restructure the template's `@if` chain here — that is batch 3's job.** Keep this batch's edits to the component's state rendering.

### Task 2.11: Comparison-aware Source Control rows ⏸️ PENDING

**Files**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\source-control\source-control-panel.component.ts` (`:111`, `:159`), `D:\projects\ptah-extension\libs\frontend\editor\src\lib\source-control\source-control-file.component.ts`, `D:\projects\ptah-extension\libs\frontend\editor\src\lib\sidebar\sidebar.component.ts`
**Requirement**: A2 AC1, AC2, AC3, AC6; N3
**Details**: The _Staged Changes_ row and the _Changes_ row currently emit **identical** `diffRequested` events. Rows now emit `{ path, comparison, origPath? }`; `sidebar.component.ts` widens the `diffRequested` output type to the structured request.
**Validation Notes**: **Do NOT de-nest the buttons or remove `stopPropagation` here — that is batch 6 (D1).** Keep this batch's edits to the emitted payload only, so batch 6's diff stays reviewable as an accessibility change.

### Task 2.12: Stale/error glyph in the tab strip ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\editor-panel\editor-panel.component.ts` (`:223-232`, `:255-262`)
**Requirement**: A1 AC7; A2 AC4
**Details**: Warning glyph next to `fileName` when `diff.status !== 'fresh'`, with `[attr.title]` carrying the reason. Reuses the existing dirty-dot slot pattern. Update the `<ptah-diff-view>` binding to the single `[diffTab]` input. `onDiffRequested` carries the comparison.
**Validation Notes**: **Touch ONLY these regions.** Batch 3 restructures `:254-287`; batch 4 rewrites `:837-949`; batch 6 rewrites `:206-232`. Minimal, surgical edits here keep those later diffs clean.

### Pass 2C — Verification (`senior-tester`)

### Task 2.13: R-3 triage matrix (GATE — before merge) ⏸️ PENDING

**File**: `D:\projects\ptah-extension\.ptah\specs\TASK_2026_173\r3-triage.md` (NEW)
**Requirement**: A3 (R-3 mitigation); DoD item 9
**Details**: Execute in **Electron**, before this batch merges. Record each case as **pass / fixed-in-scope / follow-up finding**:
submodule path · symlink · path with spaces · path with non-ASCII characters · binary file · file > 10 MB · file added but never committed · detached HEAD · repository with zero commits · path inside a nested git repo · file with CRLF · file with no trailing newline · file that is empty and tracked
**Validation Notes**: **Never re-suppress.** If the volume is large, the contingency is to promote specific enumerated benign cases to their own `outcome` values — **not** to reintroduce the blanket empty-content swallow. Discovering these failures is the _point_ of A3 (task-description R-3). Volume should be small: the only previously-silent case that mapped to a benign outcome was "new/untracked file", which now classifies as `absent`, not `error`.

### Task 2.14: Automated A-group coverage + M1 baseline ⏸️ PENDING

**Files**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor\editor-diff-split.spec.ts` (NEW), `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\git-info.service.spec.ts` (NEW), `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor\editor-workspace.spec.ts`, `D:\projects\ptah-extension\.ptah\specs\TASK_2026_173\measurements.md`
**Requirement**: NFR-1; B0 (M1 baseline)
**Details**:

- `editor-diff-split.spec.ts` — the **full A1–A4 acceptance matrix**
- `git-info.service.spec.ts` — `readBlob` classification, `origPath` parsing, the 64 KiB UTF-8 boundary case
- `editor-workspace.spec.ts` — the literal A1 AC5 assertion (reread skips diff tabs)
- **Capture the M1 baseline now** (defect-2 correction) and write it into `measurements.md`: 10 round trips, median + max, per Task 0.1's harness

**Validation Notes**: **M1's baseline MUST be captured here, on post-batch-2 / pre-batch-3 code.** Batch 2 rewrote the diff fetch path, so a pre-batch-2 figure is not apples-to-apples (plan §7, SEQ-3 §2). Batch 3 cannot report an M1 after-figure without this. NFR-1 requires A1–A4 to have automated coverage — they are correctness claims about output the user cannot verify by eye.

**Batch 2 Acceptance Criteria** (all must pass before the single commit):

- **SEQ-1**: the delivered diff shows the **diff-tab key scheme changed exactly once** — hard review gate
- A1 AC1–AC7, including the literal **0 failed RPCs across 5 git operations with 3 diff tabs open** (AC5)
- A2 AC1–AC6, including two simultaneous distinct tabs for one file (AC3) and correct rename source (AC6)
- A3 AC1–AC5, including a genuinely-empty tracked file rendering as an empty diff, not a new file (AC5)
- A4 AC1–AC5, with **no error toast** on a deleted file (AC4). A4 AC1 per amendment A-5: **index**, not HEAD, on the original side
- N2 verified: multi-byte UTF-8 across a 64 KiB chunk boundary is intact; `git apply -` is invocable
- N3 verified: `origPath` populated for type-2 porcelain lines
- `git:diffFile` exercised **end-to-end in Electron**; present in `RpcMethodRegistry`, `RPC_METHOD_PRESENCE`, and `GitRpcHandlers.METHODS`; `rpc-allowlist.spec.ts` green
- R-3 triage matrix complete, every case dispositioned, **nothing re-suppressed** (DoD 9)
- M1 baseline in `measurements.md` with median + max over ≥10 samples
- Standing gates 1–7 pass
- **ONE commit for all fourteen tasks**

> ### 🔓 SEQ-2 CHECKPOINT — **CLEARED 2026-08-10** (was: READ BEFORE BATCH 8)
>
> **SEQ-2 is SATISFIED.** Evidence: `seq-2-verification.md`. **A1, A2, A3 and A4 all verified** against the **current tree** — not against this batch's commit `61628f623`, and not against the batch's own claims. That distinction was load-bearing: the verifier established that the git-read backend carrying A3's classification ladder and A2's side-resolution table is **untouched since July**, while the frontend layer that renders and drives it was rewritten by Batches 4, 6 and 7, so backend claims rest on "unchanged + version-matched live re-check" and frontend claims rest on direct reading of today's code.
>
> **The gate was failed first and closed second.** The verification initially returned **NOT SATISFIED** on A2 AC5 — _unproven_, not failed. It was then closed by tracing `openTabs` to its two real paths: the in-session `switchWorkspace` restore is a direct object-reference assignment out of an in-memory `Map` with no serialize/parse step that could scramble `comparison`; and on the cross-reload path `EditorService`'s constructor never calls `getState()` for tabs while `switchWorkspace`'s cache-miss branch unconditionally resets `openTabs` to `[]`. Four permanent regression tests were added, **each proven non-vacuous** by reintroducing the exact hazard it guards, confirming the failure, then reverting.
>
> This gate was cleared **by verification, not by assumption and not by fatigue.** Read `seq-2-verification.md` before questioning any part of it.
>
> _Original wording, retained for provenance:_ **Batch 8 (D2 hunk stage/revert) MUST NOT START until this batch is independently verified against every A1–A4 acceptance criterion above.** Not "implemented" — _independently verified_. This is a data-integrity constraint, not a scheduling preference. A hunk stage/revert applies a derived patch to the user's git index or working tree, and is only as correct as the diff it derives from. Against A1 unfixed it applies a patch from an arbitrarily old snapshot — worst case applying cleanly at a shifted offset and silently corrupting the file. Against A2 unfixed it stages the exact content the user deliberately left unstaged. Against A3 unfixed it stages a fabricated whole-file addition whose real HEAD content was never read. **The git index holds work the user is about to commit; the working tree holds work that may exist nowhere else. Corruption here is not recoverable by undo.**

---

## Batch 3: Diff Editor Lifecycle (B1 + B2 + N1 + D3) ✅ COMPLETE — `3a73a037d` (2026-08-04)

**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `senior-tester` (for the M1 after-measurement only)
**Execution Mode**: sequential
**Rationale**: B1 and B2 both live in `diff-view.component.ts`; N1's fix is the same template restructure as B1's; D3 is one `updateOptions` call in the same file. One executor, one file cluster, one coherent review.
**Tasks**: 6 | **Dependencies**: **Batch 2 (hard — Risk A-9: batches 2 and 3 both touch `diff-view.component.ts` and `editor-panel.component.ts`; they must not overlap)** | **Satisfies**: B1, B2, D3, N1

### Task 3.1: Three-layer always-mounted content region (B1 + N1) ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\editor-panel\editor-panel.component.ts` (`:253-297`)
**Requirement**: B1 AC1, B1 AC6, N1
**Details**: Replace the `@if` / `@else if` / `@else` chain with three simultaneously-mounted, absolutely-positioned layers, mirroring the `[class.invisible]` idiom proven at `code-editor.component.ts:92-96`:

```
<div class="flex-1 min-h-0 relative">
  <ptah-diff-view   [class.invisible]="!activeDiffTab()"   [diffTab]="activeDiffTab()" />
  <ptah-code-editor [class.invisible]="activeDiffTab() || isActiveFileImage()" … />
  @if (isActiveFileImage()) { <img …> }
  @if (isLoading() && !hasActiveFile()) { <spinner overlay> }
</div>
```

Both editors `position:absolute; inset:0` inside the relative parent so the invisible one occupies no layout.
**Validation Notes**: **N1 is the reason this matters twice.** Today the final `@else` branch **is** `<ptah-code-editor>` (`:276`), so activating a diff tab destroys the code editor and discards the Monaco model + view-state cache for **every open workspace** — the TASK_2026_154 teardown silently reintroduced by template structure. B1's blast radius is double what B1 states.

### Task 3.2: Persistent diff editor + loader handle ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\diff-view\diff-view.component.ts`
**Requirement**: B1 AC1, B2 AC4
**Details**: Input collapses from three primitives to one: `readonly diffTab = input<EditorTab | null>(null)`. `createDiffEditor` **once** in `afterNextRender` after `loader.load()`; store `this.monacoApi` from the resolved handle. **Never `window.monaco`.**
**Validation Notes**: B2 AC4's verification ("with the global unavailable, updates SHALL still function") becomes _structural_ rather than behavioural. **Layout gotcha (Risk A-4)**: a Monaco editor laid out while hidden measures zero — call `editor.layout()` inside `requestAnimationFrame`, **not** a microtask, so Angular has flushed the class removal (`code-editor.component.ts:504-510`). Applies to both hosts now.

### Task 3.3: Model-pair cache + eviction on close ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\diff-view\diff-view.component.ts`
**Requirement**: B1 AC4, AC5, AC6; B2 AC5
**Details**: Model-**pair** cache keyed by diff tab key; URIs namespaced per instance: `ptah-diff://<instanceId>/<encodeURIComponent(key)>/original` and `…/modified`. `MAX_DIFF_PAIRS = 30`.
**Eviction on close** — the one place the diff diverges from the code editor, which deliberately _retains_ evicted models. Pull-based, no new coupling:

```
liveDiffKeys = computed(() => new Set(openTabs().filter(t => t.diff).map(t => t.filePath)));
effect(() => { for (const key of cache.keys()) if (!liveDiffKeys().has(key)) disposePair(key); });
```

**Validation Notes**: B1 AC5 verification — open and close **30 diff tabs**; retained Monaco model count returns to start ±2. This same effect handles B1 AC6 (workspace switch): `openTabs` is replaced wholesale, outgoing pairs dispose, `diffTab()` goes null → `setModel(null)`, which `IStandaloneDiffEditor` accepts. No throw, no stale diff.

### Task 3.4: View-state save/restore ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\diff-view\diff-view.component.ts`
**Requirement**: B1 AC3, AC4
**Details**: `saveViewState()` before switching away, `restoreViewState()` after `setModel`, keyed by tab key. `IStandaloneDiffEditor.saveViewState()` returns `IDiffEditorViewState` covering both sides' scroll/cursor plus collapsed regions → AC3 and AC4 together.
**Validation Notes**: **Risk A-3 — verify empirically on the pinned Monaco version that collapsed regions actually survive `setModel`.** If they do not, **record the shortfall per B0 AC4; do NOT report a pass.** AC4 requires each tab restore its _own_ state, not another tab's — test with multiple diff tabs.

### Task 3.5: `pushEditOperations` content update + language change (B2) ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\diff-view\diff-view.component.ts` (replaces `:214-229`)
**Requirement**: B2 AC1, AC2, AC3, AC5
**Details**: Per side: `model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null)`. No dispose, no recreate — incremental re-tokenize, no flash to unstyled text. Language change: `this.monacoApi.editor.setModelLanguage(model, lang)` when `model.getLanguageId() !== lang`.
**Validation Notes**: **No `applyingExternalEdit` guard is needed** — the diff stays `readOnly: true`, so no content listener and no user-edit feedback loop exists. AC5: 10 rapid updates in 2 s leak no models.

### Task 3.6: D3 inline/side-by-side toggle + M1 after-measurement ⏸️ PENDING

**Files**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\diff-view\diff-view.component.ts`, `D:\projects\ptah-extension\.ptah\specs\TASK_2026_173\measurements.md`
**Requirement**: D3 AC1–AC5; B0 (M1 after)
**Details**: Toggle in the diff header bar; `editor.updateOptions({ renderSideBySide })` — **no recreation** (AC2, consistent with B1). Save/restore view state around the call for scroll preservation. Preference persisted via the **existing** `editor:updateSetting` / `editor:getSetting` (already in `EDITOR_PANE_METHODS`, `manifest.ts:104-105`, served by all hosts) — **no new RPC**. Key: `editor.diff.renderSideBySide`. Real `<button>` with `aria-pressed` (AC5). Capture the M1 after-figure.
**Validation Notes**: `readOnly: true` and `renderMarginRevertIcon: false` **stay permanently** (plan §4.3). Monaco's built-in revert arrow performs an in-model edit on a writable modified side — the wrong mechanism entirely, since it reverts into a Monaco buffer rather than into git. This is what makes D2 AC11 structurally true rather than a behavioural promise. **Do not make the modified side writable in this batch or any later one.**

**Batch 3 Acceptance Criteria**:

- B1 AC1: no diff-editor construction on a return switch (instrument or observe)
- **B1 AC2: M1 target met — median ≥70% below baseline AND ≤100 ms absolute.** If not met, **flag explicitly per B0 AC4** — do not report a pass
- B1 AC3/AC4: scroll + collapsed-region state preserved, per-tab (or shortfall recorded per Risk A-3)
- B1 AC5: 30 open/close cycles return the Monaco model count to start ±2
- B1 AC6: workspace switch with no active diff neither throws nor leaves a stale diff
- B2 AC1–AC5, including AC4 verified **with the global unavailable**
- N1: activating a diff tab no longer destroys `CodeEditorComponent` — the model/view-state cache survives for every open workspace
- D3 AC1–AC5; preference survives restart (AC4)
- M1 after-figure recorded in `measurements.md` with median + max
- Standing gates 1–7 pass

---

## Batch 4: Tree & Drag Performance (B3 + B5) ✅ COMPLETE — `06b900d85` (2026-08-10)

> B5 _behavior_ landed early and out of order in `16da79d2f` (2026-08-03). Tasks 4.1, 4.2, 4.3 and
> 4.5 were executed by a `frontend-developer` sub-agent per `batch-4-dispatch.md` and reviewed by
> `code-logic-reviewer` (`batch-4-code-logic-review.md`): **APPROVED, 8/10, 0 critical, 0 serious,
> 2 moderate**. The reviewer re-ran the suites live and diffed the working tree rather than
> trusting the report.
>
> **The M2 median target is MISSED by ~4–6x and the batch still passes**, because B0 AC4 requires
> "target met **or** the shortfall explicitly flagged" and it is flagged with a sound diagnosis:
> the harness median is dominated by Angular change detection across 100 fixtures, so an
> asymptotic fix cannot move it. B3's real property — no multiplicative growth — is carried by
> independent scaling evidence the reviewer audited and found unmassaged (shipped cost flat at
> 0.66–0.82x for 10x files, versus 2.14–3.86x for the pre-B3 reference scan).
>
> Two moderate findings were dispositioned and closed, not deferred: the §7 untracked-directory
> `isDirectory` branch **stays** (an untracked directory does transitively contain a changed file;
> git just declines to enumerate it, so dropping the branch would violate AC3's literal text — the
> cosmetic redundancy with the `U` badge is a UX nuance, not a logic defect), and Failure Mode 3
> (double-`mousedown` drag re-entry) needs **no action**, the new code being strictly safer than
> the pre-refactor behavior, which registered two racing listener quartets. Pointer capture is the
> real fix and belongs to a future task.

> **[SUPERSEDED 2026-08-10 — every item below is now closed; retained for provenance.]**
> **Residue re-verified against the tree, 2026-08-10** (audit, not agent-report). What "B5 landed"
> does and does not mean:
>
> - **Requirement B5's _behavior_ is fully shipped.** All three resize drags coalesce to one
>   `requestAnimationFrame` with a single zone re-entry, and every cleanup path cancels the armed
>   frame — `editor-panel.component.ts:921, 1015, 1109` (the three `runOutsideAngular` blocks),
>   `:1190` (the shared `_dragFrame` handle), `:1207` (`cancelAnimationFrame` on teardown).
> - **Task 4.3's _deliverable_ is NOT done.** `startDragTracking` does not exist anywhere in
>   `libs/frontend/editor` — the pattern was applied three times, not extracted once. B5 AC4
>   was specified to "fall out of having a single implementation"; with three copies it does
>   not fall out of anything and is currently unproven.
> - **Task 4.4 is genuinely closed** — the blur/Escape teardown shipped under TASK_2026_176
>   (`e82dc9802`), whose message names editor-panel as the pattern it followed.
> - **B3 has not started.** `changedDirPrefixes` appears only inside a perf-spec comment
>   (`perf-m2-status-update.spec.ts:61`) as the thing being measured for; it is not in
>   `git-status.service.ts`. `hasChangedChildren` (`file-tree-node.component.ts:284`) still
>   does the per-node linear scan.
> - **Task 4.5 is confirmed outstanding** by `measurements.md:252` — the M2/M4 after-figures
>   are still recorded as PENDING in Batch 4.
>
> **Net**: 4.4 ✅ · 4.3 behavior ✅ / extraction ⏸️ · 4.1, 4.2, 4.5 ⏸️.

**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `senior-tester` (for the M2/M4 after-measurements only)
**Execution Mode**: sequential
**Rationale**: Two self-contained frontend perf fixes with their own measurements.
**Tasks**: 5 | **Dependencies**: **Batch 3 (hard — CORRECTED from plan §9)**

> ### ⚠️ CORRECTION TO plan §9 / Risk A-9
>
> §9 says batch 4 "may run parallel with 3" and Risk A-9 says batches 4/6 "touch disjoint files". **This is false.** Batch 3 edits `editor-panel.component.ts:253-297`; batch 4 edits `editor-panel.component.ts:837-949`. Same file, concurrent sub-agent passes, shared checkout worked by concurrent agents (NFR-9, R-8). **Run sequentially.** Batch 4's B3 also touches `git-status.service.ts`, which batch 1 converted to a `MessageHandler` — read the post-C1 file, not the plan's pre-C1 line numbers (risk V-6).

**Satisfies**: B3, B5

### Task 4.1: `changedDirPrefixes` computed in `GitStatusService` ✅ COMPLETE — 2026-08-10; reviewer APPROVED. The `isDirectory` branch STAYS (reviewer's explicit call, AC3 literal text)

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\git-status.service.ts` (beside `fileStatusMap`, `:141-152`)
**Requirement**: B3 AC3, AC4, AC5, AC6
**Details**:

```ts
readonly changedDirPrefixes = computed<ReadonlySet<string>>(() => {
  const set = new Set<string>();
  for (const f of this._files()) {
    const p = f.path.replace(/\\/g, '/');
    if (f.isDirectory) set.add(p);
    for (let i = p.indexOf('/'); i !== -1; i = p.indexOf('/', i + 1)) set.add(p.slice(0, i));
  }
  return set;
});
```

**Validation Notes**: Build cost is O(total path segments) once per status update; `_files` already carries a custom `equal: filesEqual` (`:96`) so the computed only recomputes on genuine change. AC4 (multi-root) holds because `_files()` is already the active workspace's slice. **AC5 (mixed separators) — normalize on insert, reuse the node's existing normalization on lookup. Windows is the primary development platform for this project.**

### Task 4.2: `hasChangedChildren` → O(1) lookup ✅ COMPLETE — 2026-08-10; reviewer APPROVED. Trailing-slash boundary and `src/app` vs `src/app-legacy` both spec-pinned

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\file-tree\file-tree-node.component.ts` (`:284-304`)
**Requirement**: B3 AC1, AC2, AC3, AC5, AC6
**Details**: Drop the per-node linear scan of `fileStatusMap` for `changedDirPrefixes().has(relativeDirPath)`.
**Validation Notes**: AC2 requires evaluation to be **effectively constant-time with respect to the number of changed files**. AC3 requires correctness in _both_ directions: every directory transitively containing a changed file is marked, and no directory without one is marked.

### Task 4.3: Extract `startDragTracking` ✅ COMPLETE — 2026-08-10; reviewer APPROVED. Three drag paths → one helper; all 10 existing drag specs pass with the spec file UNMODIFIED. B5 AC4 now closed by construction

> **Re-verified 2026-08-10.** `16da79d2f` applied this task's rAF pattern **inline to all three
> drag paths** rather than extracting the helper. So AC1, AC2 and AC5 are already satisfied in
> behavior, and **AC4 is not** — it was written to fall out of a single implementation, and
> there are three. This task is now a pure de-duplication: fold `:921`, `:1015` and `:1109`
> into one `startDragTracking`, keeping the clamping arithmetic per-surface and the shared
> `_dragFrame` teardown at `:1190`/`:1207` intact. Line numbers below are pre-`16da79d2f`
> and no longer resolve — use the three current `runOutsideAngular` blocks.

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\editor-panel\editor-panel.component.ts` (~~`:832-858`, `:879-903`, `:921-949`~~ → now `:921`, `:1015`, `:1109`)
**Requirement**: B5 AC1, AC2, AC4, AC5
**Details**: One private helper replacing three duplicated drag paths — **AC4 falls out of having a single implementation**:

```
startDragTracking({ onMove(e), onCommit(), onCancel() })
  runOutsideAngular:
    mousemove -> store latest event; if (!frame) frame = rAF(flush)
    flush     -> frame = null; ngZone.run(() => onMove(latest))   // <=1 CD pass/frame
    mouseup   -> cancelAnimationFrame(frame); ngZone.run(() => onMove(latest)); cleanup()
```

**Validation Notes**: **AC2 is the subtle one** — the mouseup path must cancel the pending frame _and_ apply the final value synchronously, so coalescing never loses the last update and the released size exactly matches the release position. **AC5: clamping arithmetic copied verbatim per surface; layout must be bit-identical. This is a performance fix with no intended UX change.**

### Task 4.4: ~~Drag interruption teardown~~ ✅ CLOSED — folded into TASK_2026_176 (`e82dc9802`); DO NOT re-implement

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\editor-panel\editor-panel.component.ts`
**Requirement**: B5 AC3, AC4
**Details**: **Deleted from this batch; implemented in TASK_2026_176 so the work is not done twice.** The editor panel now tears down its three drag handlers on `window` blur and on `Escape`, restoring the pre-drag size and cancelling any armed frame.

### Task 4.5: M2 + M4 after-measurements ✅ COMPLETE — 2026-08-10; reviewer APPROVED. M2 target **MISSED by ~4–6x — flagged, not rounded up** (B0 AC4), with scaling evidence carrying B3's real claim; M4 re-run shows no drift

**File**: `D:\projects\ptah-extension\.ptah\specs\TASK_2026_173\measurements.md`
**Requirement**: B0 AC1–AC4
**Details**: Re-run the Task 0.2 and Task 0.4 harnesses. Record median + max for both.
**Validation Notes**: **M2 target: median ≥80% below baseline, AND cost must not grow multiplicatively with (directories × changed files).** M4 target: ≤1 CD pass per animation frame, median ≥50% below baseline. Any shortfall is flagged explicitly (B0 AC4), never reported as a pass.

**Batch 4 Acceptance Criteria**:

- B3 AC1–AC6; **M2 target met or shortfall flagged**; mixed-separator correctness proven on Windows
- B5 AC1–AC5; **M4 target met or shortfall flagged**; layout visually identical to before
- Updated `git-status.service.spec.ts` (`changedDirPrefixes`), `file-tree-node.component.spec.ts` (O(1) + mixed separators), `editor-panel.component.spec.ts` (drag coalescing)
- `measurements.md` carries M2 and M4 after-figures with median + max
- Standing gates 1–7 pass

---

## Batch 5: Watcher Exclusions (B4) ✅ COMPLETE — `6df1984a7` (2026-08-10)

> Executed by a `backend-developer` sub-agent per `batch-5-dispatch.md`; reviewed by
> `code-logic-reviewer` (`batch-5-code-logic-review.md`): **APPROVED WITH FOLLOW-UPS, 8/10, 0 critical,
> 0 serious, 2 moderate**. The reviewer re-ran every affected suite live and diffed the working tree
> rather than trusting the report; no discrepancy was found between the report's claims and the tree.
>
> **M3 target MET and met for the right reason**: 26 → 1 `git status` invocations over a 60 s window,
> **0 from excluded paths**. The executor added a paired same-session control on the old predicate
> (reproducing 26 against the recorded baseline of 25), so the fall is attributable to the change and
> not to a quiet machine — the baseline alone could not have carried that claim.
>
> **B4 AC3 was proved positively, not by absence.** The single surviving invocation was the mid-window
> tracked-file edit, identified by name in the trace. A literal 0 would have been a _failure_ here, not
> a better number — it would have meant the real edit was swallowed too, which is precisely the R-9
> defect this batch existed to avoid. A permanent unit test now carries the same positive control.
>
> Both moderate findings were dispositioned before the commit: **Issue 1 is CLOSED by direct
> verification** (see the Axis 2 block above — `.angular`'s gitignore entry is unanchored, confirmed by
> `git check-ignore` at four nesting depths, evidence recorded in the constant's docstring so it
> travels with the code), and **Issue 2 (harness drift detection) is filed as Batch 9 candidate 1**,
> not silently accepted.

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `devops-engineer`
**Execution Mode**: sequential
**Rationale**: Entirely backend/Electron — `libs/shared` constants, the Electron watcher, and the Electron tree builder. No Angular surface.
**Tasks**: 4 | **Dependencies**: **Batch 4 (sequential) + Task 5.0 decision gate** | **Satisfies**: B4

### Task 5.0: 🚧 DECISION GATE — resolve Open Question #1 ✅ RESOLVED 2026-08-10

**Requirement**: B4 AC2, AC4 (risk **V-1**)
**Details**: **The orchestrator MUST confirm this with the user before spawning batch 5.** `amendments.md` settles A-1..A-5 and N1–N3 but is silent on plan Open Question #1.

The watcher and the tree builder disagree in **both** directions today: the tree hides `.nx`/`.cache` which the watcher does not, and the watcher ignores `node_modules`/`dist` which the tree **shows**. B4 AC2 demands they agree.

- **Option A** — strict unification: one set, both consumers. Consequence: the file tree **stops showing `node_modules` and `dist`**. Matches VS Code, almost certainly right, but is a user-visible change beyond stated scope.
- **Option B (DEFAULT, recommended by the plan and adopted here)** — two named sets behind **one shared predicate**: `TREE_HIDDEN_DIRS` ⊆ `WATCH_IGNORED_DIRS`. Honours AC2's "single source of truth" for the _mechanism_, keeps tree visibility unchanged, and honours R-9 (over-broad exclusion is worse than the churn it fixes).

**Proceed with Option B unless the user says otherwise.** Record the decision in this file before Task 5.1 starts.

> ### ✅ USER DECISION 2026-08-10 — **OPTION B**
>
> Confirmed with the user at the batch 4→5 boundary, as V-1 and this gate require. **Two named
> sets behind one shared predicate**: `TREE_HIDDEN_DIRS` ⊆ `WATCH_IGNORED_DIRS`.
>
> **The file tree keeps showing `node_modules` and `dist`.** Any executor that makes them
> disappear has implemented Option A and is not done — that is a user-visible scope change
> this task explicitly declined.
>
> AC2's "single source of truth" is satisfied by the **mechanism** (one predicate, one module),
> not by the two sets being identical. Task 5.2's "a second hand-maintained list SHALL be
> treated as not-done" still binds in full: `HIDDEN_SKIP` is deleted, and both consumers call
> the shared predicate. R-9 stands — an over-broad exclusion set is a correctness defect and is
> worse than the churn it fixes, so the only addition beyond the union of the two current lists
> is `.angular`.
>
> **Task 5.1 is unblocked.**

> ### ✅ AXIS 2 RATIFIED 2026-08-10 — recorded retroactively, per the Batch 5 review
>
> **The shared predicate matches at every path segment, not just the root — a deliberate widening
> ratified in Batch 5's review.** The plan (`implementation-plan.md:377`) and the Batch 5 dispatch
> both described the watcher's mechanism as a "path-level test", so the executor's segment-level
> choice went beyond their literal text; it self-flagged the widening rather than burying it, and
> `code-logic-reviewer` ruled **ACCEPT**. It is the more correct reading of B4 AC1/AC2's intent: the
> tree builder has always been segment-level (`buildFileTree` recurses and re-applies the filter at
> every depth — verified against `git show HEAD:…` as pre-dating Batch 5), so a prefix-only watcher
> would have left the two consumers still disagreeing, which is the exact defect B4 exists to close.
> For 12 of the 13 names the widening provably cannot hide anything new, because those names were
> already tree-invisible at every depth. **This is settled — do not re-litigate it in a later batch.**
>
> The 13th name, `.angular`, was the review's one open correctness tail and is now **closed by direct
> verification, not inference**: the root `.gitignore` entry (line 51) is the bare unanchored token
> `.angular`, which git matches at any depth, confirmed via `git check-ignore -v` against four probe
> paths at different nesting depths. Evidence recorded in the `WATCH_IGNORED_DIRS` docstring so the
> claim travels with the code rather than living only in a report file.

### Task 5.1: Shared exclusion constants ✅ COMPLETE — 2026-08-10; reviewer APPROVED. `TREE_HIDDEN_DIRS` (12) ⊆ `WATCH_IGNORED_DIRS` (13), subset derived in code so it cannot drift; `.angular` the only addition

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\constants\workspace-scan.constants.ts` (NEW)
**Requirement**: B4 AC2
**Details**: `WORKSPACE_SCAN_EXCLUDED_DIRS` (per the Task 5.0 decision — under Option B, `TREE_HIDDEN_DIRS` and `WATCH_IGNORED_DIRS`) plus `isExcludedWorkspacePath(relativePath): boolean`, splitting on `[\\/]`.
**Set contents** — conservative per R-9: current `HIDDEN_SKIP` (`.git .hg .svn .DS_Store .Trash .cache .tmp .temp .nx`) ∪ current watcher list (`node_modules dist`) ∪ **`.angular`** (the only addition; it is the named M3 churner alongside `.nx/cache`).
**Validation Notes**: **Do NOT speculatively add `out`, `build`, `coverage`, `.next`, `.turbo`** — those are plausible source directories in some projects, and R-9 rates missing changes a correctness defect against churn's mere annoyance.

### Task 5.2: Both consumers use the shared predicate ✅ COMPLETE — 2026-08-10; reviewer APPROVED. `HIDDEN_SKIP` deleted outright (zero occurrences in product code); Axis 2 segment-level widening ratified, see the block above

**Files**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\git-watcher.service.ts` (~~`:378-393`~~ → **`:382-405`**, `watchWorkspaceRoot`; re-verified 2026-08-10, the old offsets now land on the doc comment), `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\editor-rpc.handlers.ts` (`:70` `HIDDEN_SKIP` and `:855`/`:858` in `buildFileTree` — both still resolve exactly)
**Requirement**: B4 AC1, AC2, AC4
**Details**: Watcher does a path-level test against the `fs.watch` filename; the tree builder does a segment-level test. **`HIDDEN_SKIP` is deleted.** One implementation, one predicate.
**Validation Notes**: **B4 AC2 states that reintroducing a second hand-maintained list SHALL be treated as not-done.** After this task that must be structurally impossible, not merely avoided. Note the tree builder currently applies `HIDDEN_SKIP` only to entries starting with `.` (`:858`) — the Task 5.0 decision governs what changes here.

### Task 5.3: M3 after-measurement + genuine-change proof ✅ COMPLETE — 2026-08-10; reviewer APPROVED. M3 target **MET**: 26 → 1, **0 from excluded paths**, with a paired same-session control. B4 AC3 proved positively — the one surviving invocation was the tracked-file edit, by name

**File**: `D:\projects\ptah-extension\.ptah\specs\TASK_2026_173\measurements.md`
**Requirement**: B4 AC1, AC3, AC5; B0
**Details**: Re-run Task 0.3's 60 s `GIT_TRACE=1` window. **Target: 0 invocations triggered by paths the file-tree builder already excludes** (baseline ≈30). **Within the same window, modify a tracked source file and confirm the change appears in Source Control inside the existing debounce window** — this is B4 AC3 and the direct mitigation for R-9.
**Validation Notes**: B4 AC5 — exercise VS Code and CLI; neither may regress. The watcher is Electron-only but the exclusion set is not. Where a capability cannot exist in a runtime, absence must be a **clean no-op, not a crash** (NFR-5).

**Batch 5 Acceptance Criteria**:

- Task 5.0 decision recorded before any code is written
- B4 AC1: **M3 = 0 invocations** from already-excluded paths
- B4 AC2: single source of truth; a second hand-maintained list is structurally impossible
- B4 AC3: a genuine source change still fires status update + tree refresh within the existing debounce window
- B4 AC4: user-opened ignored directories behave consistently with the tree's own visibility rules
- B4 AC5: VS Code and CLI exercised, no regression; all three runtimes build
- `measurements.md` carries the M3 after-figure
- Standing gates 1–7 pass

---

## Batch 6: Accessibility (D1) ✅ COMPLETE — `b57d3c8d4` (2026-08-10)

> Executed by a `frontend-developer` sub-agent per `batch-6-dispatch.md`, reported in
> `batch-6-report.md`, reviewed by `code-logic-reviewer` (`batch-6-code-logic-review.md`):
> **APPROVED WITH FOLLOW-UPS, 8/10, 0 critical, 0 serious, 2 moderate** — both moderates explicitly
> non-blocking and both are documentation corrections, not code defects. The reviewer re-ran every
> live-runnable claim (all four gate suites, both DOM guards, the `stopPropagation` grep, and a
> fresh independent axe-core run) rather than trusting the report.
>
> **All seven D1 acceptance criteria pass.** `nested-interactive` — the rule D1 AC1 names — clears
> on both trees, 20 nodes. AC6 is evidenced at **35/35 identical measurements** in real headless
> Chromium against the DOM Angular actually produced (`createElement`/`appendChild`, not the
> parser-flattened form), which caught and fixed a real `uppercase` regression on the way. AC5 is
> structural, not a promise: all four `stopPropagation()` calls **and all four `MouseEvent`
> parameters** are gone from the signatures, so no future edit can quietly reintroduce the
> dependency.
>
> ### ⚖️ THE BATCH TRADES ONE CRITICAL AXE VIOLATION FOR ANOTHER — user-ruled, do not re-open
>
> De-nesting the tab close button onto a `role="presentation"` wrapper makes axe descend through the
> wrapper (which is what lets `role="tab"` pass `aria-required-parent`) and therefore re-parents the
> **close button** onto the `role="tablist"`, which permits only `tab` as an owned element. That is a
> **new critical `aria-required-children` violation on a rule that previously passed.**
>
> **The user ruled: keep the `tablist`/`tab` shape and accept it.** `nested-interactive` was a real
> operability defect — it is _why_ the `stopPropagation()` calls existed, and it made hit-testing and
> AT traversal disagree with the template — whereas here the close button remains reachable,
> focusable, labelled and operable and only its ownership is wrong. **Filed to Batch 9 as item 4.
> Do not propose `role="toolbar"`, `aria-owns`, or hoisting the buttons.**
>
> Two moderate review findings were actioned before the commit, both by editing `batch-6-report.md`
> and neither by touching code: §3.3's claim that `host: { role: 'presentation' }` was _necessary_
> is **wrong** (the reviewer built both variants and both pass — softened to "added defensively"),
> and §8's empty-list item was **understated** (the reviewer reproduced it as a live critical
> violation today, not an inspection-only risk — promoted to Batch 9 item 5 as a confirmed defect
> with a known one-line fix).

> ### ⚠️ EVERY LINE NUMBER BELOW IS STALE — corrected in `batch-6-dispatch.md`
>
> Batch 4 (`06b900d85`) rewrote `editor-panel.component.ts` substantially (three drag blocks collapsed
> into one helper, three listener quartets into one), and batches 2 and 3 moved the other two files.
> **Every citation in Tasks 6.1–6.4 predates that.** All were re-verified against the working tree on
> 2026-08-10; the corrected offsets live in the dispatch, which is the executor's source of truth.
>
> The re-verification also surfaced a **structural finding that changes the shape of this batch**: in
> all three files the outer clickable is already a `<button>` with the action buttons nested _inside_
> it. Nested interactive content inside a `<button>` is invalid HTML — the browser flattens it in the
> parsed DOM — which is why the `stopPropagation()` calls exist at all. Task 6.4 therefore cannot be
> done independently of 6.1–6.3: deleting `stopPropagation` only works once the nesting is gone. See
> the dispatch for the per-file de-nesting shape.

**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `senior-tester`
**Execution Mode**: sequential
**Rationale**: Pure template/semantics work across three components. Low risk, but it edits `editor-panel.component.ts` and both source-control components — files batches 2, 3 and 4 also touched.
**Tasks**: 4 | **Dependencies**: **Batch 5 (sequential — CORRECTED from plan §9, which claimed batch 6 may run parallel with 3–5; it edits `editor-panel.component.ts:206-232` and `:672`, overlapping batches 3 and 4)** | **Satisfies**: D1

### Task 6.1: De-nest the tab close button ✅ COMPLETE — 2026-08-10; reviewer APPROVED. Shape landed as specified; padding split (`py-1.5 pl-3 pr-2.5` on the tab button, `pr-3` on the wrapper) so the left inset stays inside the tab's hit target. The `aria-required-children` consequence is accepted by user ruling, Batch 9 item 4

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\editor-panel\editor-panel.component.ts` (`:229` inside `:206`)
**Requirement**: D1 AC1, AC2, AC4, AC6
**Details**: Outer becomes `<div role="presentation">` carrying the tab chrome classes; inside it, a `<button role="tab" [attr.aria-selected]>` for the label and a **sibling** `<button [attr.aria-label]="'Close ' + fileName">`.
**Validation Notes**: **AC6 — visual appearance must be unchanged.** Preserve it by moving the chrome classes to the container. Preserve the batch-2 stale/error glyph and the dirty-dot slot.

### Task 6.2: De-nest the section headers ✅ COMPLETE — 2026-08-10; reviewer APPROVED. `aria-expanded` did not exist before and now does; `aria-controls` points at per-instance list ids (a static counter, so two mounted panels cannot collide on `duplicate-id`). **Caught a bug the dispatch did not anticipate**: Tailwind preflight sets `text-transform: none` on `button`, so wrapping the label in a button silently dropped the header out of caps (108.39px → 96.78px) — `uppercase` repeated on the toggle, with a regression test

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\source-control\source-control-panel.component.ts` (`:92` inside `:78`; `:140` inside `:126`)
**Requirement**: D1 AC1, AC3, AC4, AC6
**Details**: Same pattern — container `<div>`, a `<button [attr.aria-expanded]>` expand/collapse toggle plus a **sibling** stage-all / unstage-all action button.

### Task 6.3: De-nest the file row ✅ COMPLETE — 2026-08-10; reviewer APPROVED. `role="listitem"` moved off the `<button>` (a genuine semantic conflict — `listitem` was overriding the button's own role); row gained the `'Open diff for …'` label it never had. `host: { role: 'presentation' }` added defensively, **not** necessary — see the corrected §3.3

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\source-control\source-control-file.component.ts` (`:68`, `:79`, `:91` inside `:39`)
**Requirement**: D1 AC1, AC4, AC6
**Details**: Row becomes a `<div role="listitem">` containing a `<button>` for open-diff plus sibling action buttons.
**Validation Notes**: This third site is not named in the original findings but is the same defect and sits inside the panel D1 AC1 scopes.

### Task 6.4: Delete `stopPropagation`; add focus-visible rings ✅ COMPLETE — 2026-08-10; reviewer APPROVED. All four calls **and all four `MouseEvent` parameters** deleted — the isolation is structural. Only live `stopPropagation()` left in these files is `closeSplit` (`editor-panel.component.ts:622`), out of scope. **`btn-ghost` does NOT suppress the focus ring** (daisyui 4.12.24 `dist/styled.css:1652` sets it); the project utilities were applied anyway and measured to win at equal specificity

**Files**: `source-control-panel.component.ts` (`:228`, `:233`), `source-control-file.component.ts` (`:175`), `editor-panel.component.ts` (`:672`)
**Requirement**: D1 AC5, AC7
**Details**: Delete `event.stopPropagation()` from `onStageAll`, `onUnstageAll`, `onAction`, `onTabClose`. Add `focus-visible` ring utilities and **verify `btn-ghost` does not suppress them**.
**Validation Notes**: **D1 AC5 is explicit that the fix must hold WITHOUT relying on event-propagation suppression as the mechanism.** If a test fails after removing `stopPropagation`, the de-nesting is incomplete — do not put it back.

**Batch 6 Acceptance Criteria**:

- D1 AC1: DOM validation finds **no nested interactive elements** anywhere in the editor and source-control panels
- D1 AC2/AC3: tab-select, tab-close, section toggle and stage-all/unstage-all each receive focus independently and activate via **both Enter and Space**
- D1 AC4: screen reader announces a distinct, accurate label and role for each
- D1 AC5: activating an inner control does not fire the outer one, **with `stopPropagation` deleted**
- D1 AC6: visual appearance unchanged from before
- D1 AC7: visible focus indicator on keyboard focus
- Standing gates 1–7 pass

---

## Batch 7: Split-Pane Save (C2) ✅ COMPLETE — `f47351d14` (2026-08-10)

> Executed by a `frontend-developer` sub-agent per `batch-7-dispatch.md`, reported in
> `batch-7-report.md`, reviewed by `code-logic-reviewer` (`batch-7-code-logic-review.md`) over two
> rounds: **Round 1 APPROVED WITH FOLLOW-UPS, 7/10, 0 critical, 2 serious, 3 moderate**; both serious
> findings fixed in-batch before commit; **Round 2 re-verification: APPROVED, no outstanding
> blockers.** All six C2 acceptance criteria pass. Editor suite 222 → **269** (+47, none modified,
> none skipped); NFR-1 cross-project floor held exactly at 1863; lint 0 errors / 14 pre-existing
> warnings.
>
> ### 🔴 Task 7.2 shipped as OWNERSHIP, not bindings — and the hazard was proved, not assumed
>
> Task 7.2 as literally worded below is dangerous, and the executor demonstrated it rather than
> taking the dispatch's word: a throwaway probe wiring `contentChanged` → `setInput('content', …)`
> produced **10 `pushEditOperations` full-model replacements across 10 simulated keystrokes** —
> cursor to the end of the buffer, undo stack collapsed, on the buffer the user is typing into.
> Value equality does **not** absorb it once the echo can lag, and a _debounced_ mirror carries a
> value 150 ms stale by construction, so the hazard is strictly worse there. The probe was deleted.
>
> **What shipped**: the tab record is the write target for both panes and is **not** the read source
> for the focused pane. Neither `[content]` binding changed by a character —
> `[content]="codeEditorContent()"` and `[content]="editorService.splitFileContent()"` are
> byte-identical to `b57d3c8d4`, independently confirmed by the reviewer against the diff. The mirror
> lives in the service, not the template, and re-reads `focusedPane()` **at flush time**, so it can
> never target the pane that has focus.
>
> The `code-editor.component.ts:395-398` invariant was rewritten rather than left to outlive its
> truth: `activeFileContent` is now written on an edit (the _other_ pane's, while this pane is
> unfocused), so the comment now states the actual mechanism — nothing writes a pane's own edits back
> into its own `content` input.
>
> ### 🛡️ The regression guard was vacuous, and that was caught and fixed in-batch
>
> Round 1's most valuable finding: the permanent negative test proved a property of
> `CodeEditorComponent` in isolation, wired by hand, and never touched `editor-panel.component.ts` —
> where the binding a future engineer would actually change lives. The reviewer reintroduced the
> literal Task 7.2 wording at `editor-panel.component.ts:741-745` / `:386-389` and the shipped suite
> stayed **259/259 green**. A guard that cannot fail reads as protection and is worse than none.
>
> **Fixed in-batch.** Two panel-level guards now sit at the real site. Under the reintroduced hazard
> the suite fails **exactly 2 of 262** — and only those two — and returns to green on revert;
> independently reproduced by the reviewer at 269 tests. The second guard drives the tab record to a
> value differing from _both_ pane signals, which defeats the "value equality accidentally hides a
> rebinding" mode the first guard alone cannot see on the right pane.
>
> **The invariant at `code-editor.component.ts:395-398` is now enforceable rather than incidental.**
> That is the load-bearing outcome of this batch, more than the save semantics themselves.
>
> ### Beyond C2: a live primary-pane data-loss bug fixed as a side effect (Leg 4)
>
> The workspace cache held **three** copies of the same text. On `switchWorkspace` away and back the
> pre-C2 code restored `activeFileContent` from the open-time snapshot, `syncFile` saw it differ from
> the model and pushed it: **the primary pane's unsaved edits were reverted by a workspace
> round-trip** — live on `main`, nothing to do with the split pane. Both pane signals are now derived
> from the tab record on restore. Wider than "split-pane save" by the letter of NFR-9, disclosed
> plainly, and accepted by the reviewer as the correct one-line fix (reconciling only the split half
> would leave the two panes restoring from different stores).
>
> ### Conflict dialog — focus containment fixed in-batch, axe clean
>
> Round 1's second serious finding (new code, one batch after Batch 6 raised this file's a11y bar):
> the dialog had focus-on-open and Escape but no Tab containment and no focus restore. **Fixed, not
> deferred** — a two-way Tab/Shift+Tab toggle on the labelled container (introducing no new tab stop)
> plus `saveConflictReturnFocus` captured _before_ the open-effect moves focus, restored on Cancel,
> Overwrite and Escape, guarded on `isConnected`. 7 behavioural tests. `axe-core@4.12.1` over the
> **rendered** dialog: **0 violations**, the lone `color-contrast` incomplete confirmed as generic
> unstyled-jsdom noise by a reviewer-added baseline control with the dialog never opened.
>
> ### Accepted deviations and known limits — disclosed, not rounded up
>
> - **AC5 is PARTIAL by one deliberate deviation**: a split-pane edit now dirties a background tab in
>   the different-files case. Gating on same-path would reopen the exact divergence C2 exists to
>   close. Reviewer accepted it as fixing a genuine pre-existing bug, not degrading AC5. Read path is
>   byte-identical; no prompts, no mirroring, no cursor effects.
> - **"The conflict prompt backstops the focus-change race" is wrong and is corrected for the
>   record.** If the race were hit, the full-model push brings the pane into _exact_ agreement with
>   the tab record — erasing the divergence `hasUnabsorbedPeerEdit` needs, so the prompt would
>   specifically **not** fire. What makes the race acceptable is that it is unreachable: a click
>   task's microtasks fully drain before the browser dequeues the next native `keydown`. No code
>   comment ever carried the inaccurate claim.
> - **After Cancel the panes remain divergent** until the next focus change, marked only by the
>   generic dirty dot. Auto-reconciling would destroy exactly the edits Cancel was pressed to protect.
>   AC1's wording is disjunctive and any subsequent save re-prompts. Filed as a Batch 9 item.
> - **Nothing was verified in a running app.** Everything on both sides is jsdom plus a faked Monaco
>   whose `pushEditOperations` is a whole-value assignment: it proves _whether_ a push happens, not
>   what real Monaco does to cursor, undo or IME state when one does. jsdom likewise does not
>   implement native Tab traversal, so the trap is proved by handler behaviour, not a browser walk.

> ### ⚠️ EVERY LINE NUMBER BELOW IS STALE — corrected in `batch-7-dispatch.md` §1.1
>
> `editor-diff-split.ts` was rewritten by Batch 2, and `editor-panel.component.ts` has now been
> rewritten by **Batch 4 (`06b900d85`) and again by Batch 6 (`b57d3c8d4`)**. Every citation in
> Tasks 7.1–7.4 predates all of it. Re-verified against the working tree on 2026-08-10: the four
> drifted citations are `updateSplitContent` (`:117-123` → **`:302-304`**), `openFileInSplit`
> (`:139-141` → **`:262-286`**), `codeEditorContent` (`:654-659` → **`:659-663`**, where `:653-657`
> is now `codeEditorPath` — a live confusion hazard), and the per-pane model block (`:202-208` →
> **`:202-211`**). `code-editor.component.ts:399-411` is the one citation that did not drift.
> **The dispatch is the executor's source of truth.**
>
> ### 🔴 Task 7.2 as literally worded is DANGEROUS — the dispatch re-scopes it
>
> `code-editor.component.ts:395-398` carries a load-bearing comment: _"the incoming `content` input
> never carries the user's own edits back … so any divergence here is an outside change we must
> apply."_ That invariant is the only thing keeping `syncFile` from issuing a full-model
> `pushEditOperations` over the buffer the user is typing into. It holds because the left pane reads
> `activeFileContent()` (written on open/switch only) while edits go to the tab record.
>
> **Rebinding the left pane's `[content]` to the tab record inverts it** — `updateTabContent` fires
> on every keystroke, so the user's own text echoes back into the effect. Value equality usually
> absorbs it; under fast typing the echo lags the model, the `:399` comparison goes true, and the
> cursor jumps to the end with the undo stack collapsed. `tasks.md`'s own justification for 7.2
> describes why the _current_ arrangement is safe — it is not an argument that the rebinding is.
>
> **Task 7.2 is therefore dispatched as a statement about content OWNERSHIP (the write target), not
> about bindings (the read source).** Converge the writes; drive only the _unfocused_ pane from the
> tab record. A different shape is permitted only with an explicit justification against that
> invariant and an update to the comment.
>
> ### The root cause has FOUR legs, not the two Task 7.1 names
>
> Re-verification found two more divergence paths, neither named anywhere in Batch 7:
>
> - **Leg 3 — the split pane's save never marks the tab clean.** `onSplitFileSaved`
>   (`editor-panel.component.ts:693-698`) omits the `markTabClean` that the left pane's `onFileSaved`
>   (`:753-757`) performs, and `saveFile` (`editor-file-ops.ts:110-124`) is RPC-only. **C2 AC4 fails
>   today**, on a path with nothing to do with conflicts. Fixed in 7.1/7.2, not 7.4.
> - **Leg 4 — the workspace cache is a second independent store of the same content.**
>   `editor-workspace.ts:146-148` persists `splitFileContent` and `:92-95` restores it, while the tab
>   record persists separately via `syncTabsToCache()`. A workspace switch away and back round-trips
>   through a different store and can reintroduce divergence **after** Tasks 7.1–7.3 have run.
>
> Also flagged: `openFileInSplit`'s no-tab branch (`editor-diff-split.ts:274-285`) never creates a
> tab, so "the tab record owns content for both panes" has a hole. It is vacuously safe (one editing
> surface, nothing to diverge from) but must be reasoned and pinned, not assumed — and **not** "fixed"
> by creating a tab, which would change observable behaviour.
>
> ### 🚫 `closeSplit`'s `stopPropagation` stays
>
> `editor-panel.component.ts:621-624` is the last live `stopPropagation()` in this file. It was out of
> Batch 6's scope and it is out of Batch 7's. It will look like an obvious leftover ten lines from
> where this batch works. NFR-9: it gets filed, not fixed here.

**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `senior-tester`
**Execution Mode**: sequential
**Rationale**: Plan §5.5 names this "the highest-uncertainty item after D2" and says to isolate it. Isolated it is.
**Tasks**: 4 | **Dependencies**: **Batch 6 (sequential). Also hard-depends on Batch 2 — `editor-diff-split.ts` was rewritten there.** | **Satisfies**: C2

### Task 7.1: `updateSplitContent` writes the tab record ✅ COMPLETE — write-through lands, including when the split file is NOT the active file (see the AC5 deviation above). Legs 3 and 4 fixed here too: both save paths now route through one `saveFromPane` → `persistSave` → `markTabClean`, so there is one save policy rather than two that drifted

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor\editor-diff-split.ts` (`:117-123`, `:139-141`)
**Requirement**: C2 AC1, AC2
**Details**: Root cause — `openFileInSplit` copies content at open time and split edits write only `splitFileContent`, never back into `openTabs`. Fix: `updateSplitContent(content)` also calls `tabs.updateTabContent(splitFilePath, content)` when that path has an open tab. **The open tab record becomes the single owner of content for both panes.**

### Task 7.2: Content ownership converges on the tab record ✅ COMPLETE — **shipped as re-scoped: ownership, NOT bindings. The wording below is superseded and is retained only as the hazard it describes.** Do NOT rebind the focused pane's `[content]`; two panel-level guards now fail if you do

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\editor-panel\editor-panel.component.ts` (`:654-659`)
**Requirement**: C2 AC4, AC5
**Details**: Both panes' `[content]` inputs derive from the tab record. The left pane already effectively does — `activeFileContent` is set on switch/open only, and `onContentChanged` writes the tab, not the signal — so no feedback loop is introduced.
**Validation Notes**: **AC5 — the different-files case must be EXACTLY as today.** Every branch here is gated on `splitFilePath === activeFilePath`.

### Task 7.3: Unfocused-pane mirroring ✅ COMPLETE — 150 ms debounce in the service (not the template), re-reads `focusedPane()` at flush time so it can never target the focused pane; `setFocusedPane` cancels the pending mirror and reconciles both panes; `closeSplit` absorbs an unmirrored edit before tearing down. AC6 per-pane models preserved

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\code-editor\code-editor.component.ts` (mirroring hook, split-pane case only)
**Requirement**: C2 AC1, AC6
**Details**: When the same path is open in both panes, the **unfocused** pane receives the focused pane's content on a short debounce. `CodeEditorComponent.syncFile` already applies external content via `pushEditOperations` guarded by `applyingExternalEdit` (`:399-411`) — no new mechanism, and undo survives.
**Validation Notes**: Mirroring **only** into the unfocused pane prevents cursor-jump while typing. **AC6: the independent per-pane Monaco models (`code-editor.component.ts:202-208`) are a deliberate design decision and must be PRESERVED — the save path is what changes, not the model strategy.**

### Task 7.4: Conflict prompt at save ✅ COMPLETE — `hasUnabsorbedPeerEdit` gates an `alertdialog` with Overwrite/Cancel/Escape, focus-trapped and focus-restoring, axe-clean. R-10 respected: reachable only under genuine unabsorbed divergence, never on an ordinary split-pane save

**Files**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor\editor-diff-split.ts`, `D:\projects\ptah-extension\libs\frontend\editor\src\lib\editor-panel\editor-panel.component.ts`
**Requirement**: C2 AC2, AC3, AC4
**Details**: If the tab record carries a write from the other pane that this pane has not absorbed, prompt "This file was also edited in the other pane — Overwrite / Cancel". Dirty indicator correct in both panes after save (AC4).
**Validation Notes**: **R-10 — a prompt on every split-pane save would be worse than today's silent behaviour.** With Tasks 7.1 and 7.3 in place this should be reachable only under a genuine race. Prefer reconciliation over prompting where content allows.

**Batch 7 Acceptance Criteria** — all verified by the reviewer against the working tree, not from the report's transcript:

- ✅ C2 AC1: no silent divergence — including the workspace-cache round-trip (Leg 4), four tests
- ✅ C2 AC2/AC3: `hasUnabsorbedPeerEdit` verified against real signal state; Cancel genuinely writes nothing — no RPC, no tab mutation
- ✅ C2 AC4: both dirty notions — the tab record's `isDirty` and the per-pane badge — correct, and the badge fix is a baseline-only effect specifically so it cannot re-enter `syncFile` and reintroduce the §1.2 hazard
- ⚠️ C2 AC5: **PARTIAL, by one disclosed and accepted deviation** — read path byte-identical; a different-files split edit now dirties a background tab. See the block above
- ✅ C2 AC6: independent per-pane Monaco models untouched; only the doc comment was rewritten
- ✅ Standing gates 1–7 pass — re-run live by the reviewer, all figures matching

### Post-batch fix — `(focusin)` keyboard pane focus ✅ COMPLETE — `6dc68c03b` (2026-08-10)

> **Pulled out of the Batch 9 register (was item 6) and fixed rather than filed**, because filing it
> left a C2 claim untrue. `setFocusedPane` is not only the `Ctrl+S` gate — it also cancels the pending
> mirror and reconciles the panes. With `focusedPane` reachable only by `(click)`, a keyboard-only user
> never ran the reconciliation C2 was built to provide, so **"no longer loses work" was false for that
> user specifically**. That is a defect in Batch 7's deliverable, not a follow-up to it.
>
> **Change**: two `(focusin)="onPaneClick('left'|'right')"` bindings alongside the existing `(click)`
> on both pane containers, plus a doc comment on the handler. No new method, no new state.
> `focusin` bubbles; `focus` does not, and Monaco's focus lands on a hidden textarea deep inside the
> pane. The pane containers are siblings, so neither pane's `focusin` can reach the other.
> `editor-diff-split.ts` — `setFocusedPane`, the mirror-cancel path, the two §1.2 panel guards — is
> byte-identical; the spec diff is purely additive (`+512 / -0`), so the negative typing test is
> untouched.
>
> **Reviewed by team-leader verification instead of `code-logic-reviewer`**, on the grounds that the
> non-vacuity evidence _is_ what a logic review would go looking for, and it was reproduced
> independently rather than accepted from the report: with both bindings removed, **5 focus tests fail
> and the `(click)` control test still passes** (48 → 5 failed / 43 passed), proving the guards bite
> and that the failure is specific to the new path rather than collateral. File restored to a matching
> SHA-256 afterwards. Editor suite **279/279, 16 suites** (baseline 273; +6 is exactly this addendum);
> lint 0 errors. Report: `focusin-addendum-report.md`.
>
> **Known benign side effect, disclosed not guarded**: a mouse click on Monaco now fires `focusin`
> before `click`, so `onPaneClick` runs twice per click. `setFocusedPane` is idempotent — both content
> setters early-return on equality and the second `cancelPendingMirror` finds no timer — so the second
> call is a no-op. Not suppressed with a guard, because a guard would be the new logic this was scoped
> to avoid.

---

## ✂️ NATURAL CUT LINE — HERE (R-7) — **REACHED 2026-08-10**

**Batches 0–7 are complete, committed and coherent as delivered.** C1 + A-group + B + D1 + D3 + C2 form a shippable unit on their own: the diff is correct, measured, accessible, and no longer loses work. Stopping here costs the D2 feature and nothing else — no partial state, no half-migrated scheme.

**Everything below this line is gated.** Batch 8 is a feature project in its own right and is the only batch that writes to the user's git index. It was blocked on SEQ-2 — which Batch 7 did **not** clear and could not clear — and **SEQ-2 was cleared on 2026-08-10 by an independent verification pass** (`seq-2-verification.md`, A1–A4 all verified against the current tree). Batch 8 is now dispatchable. Batch 9 is filing work and may proceed from this cut line independently of Batch 8.

---

## Batch 8: D2 — Hunk Stage / Revert 🔄 IN PROGRESS — **SEQ-2 SATISFIED, DISPATCHED 2026-08-10**

> ### ✅ SEQ-2 SATISFIED — A1, A2, A3 and A4 ALL VERIFIED
>
> **Evidence: `seq-2-verification.md`.** Both of Batch 8's preconditions now hold: Batch 7's
> sequential dependency was satisfied when `f47351d14` landed, and **SEQ-2 was cleared on
> 2026-08-10 by an independent verification pass** run as its own step, exactly as this gate
> required. **Implemented-and-committed was never the bar; independently verified is, and that
> bar was met.**
>
> **Verified against the current tree, not against Batch 2's commit `61628f623`.** That choice was
> load-bearing rather than pedantic: the verifier established that the git-read backend carrying
> A3's classification ladder and A2's side-resolution table **has not changed a line since July**,
> while the frontend layer that renders and drives it was rewritten by Batches 4, 6 and 7. Backend
> claims therefore rest on "unchanged + a version-matched live re-check against real `git`"; frontend
> claims rest on direct reading of the code that exists today. Verifying against the old commit would
> have proved something true of a tree nobody is shipping.
>
> **The gate was FAILED FIRST and CLOSED SECOND.** The first pass returned **NOT SATISFIED** on
> A2 AC5 — _unproven_, not failed, and reported as such rather than rounded up. It was then closed
> by tracing `openTabs` end to end to its two real paths:
>
> - **In-session restore** — `EditorWorkspaceHelper.switchWorkspace` assigns the cached
>   `EditorTab[]` **by direct object reference** out of an in-memory `Map`. There is no
>   serialize/parse step anywhere on that path, so no code exists that could re-derive or scramble
>   a tab's `diff.comparison` on the way back.
> - **Cross-reload discard** — `EditorService`'s constructor never calls `getState()` for tabs, and
>   `switchWorkspace`'s cache-miss branch (hit for every path after a reload, since that `Map` is
>   rebuilt empty) **unconditionally** sets `openTabs` to `[]`. Tabs are not persisted at all, so an
>   old-format entry categorically cannot reach `openTabs`.
>
> **Four permanent regression tests were added, and each was proven non-vacuous** by reintroducing
> the exact hazard it guards, confirming the test fails, then reverting and confirming it passes.
> They stay in the suite: a future change that reintroduces stale-comparison restoration,
> cross-workspace tab leakage, or reload-time hydration from persisted state will fail them.
>
> **Anyone reading this later: the gate was cleared by verification, not by assumption and not by
> fatigue.** Five non-vacuous mutation probes, three live real-git scratch-repo spot-checks, and the
> full editor / vscode-core / rpc-handlers suites green. Two limits are disclosed in the artifact
> rather than buried — nothing ran in a real Electron/VS Code host with real Monaco, and one
> unrelated synthetic `diff:worktree:` literal exists outside this write path (filed, not a defect
> against this gate). Read `seq-2-verification.md` in full before questioning any part of it.
>
> **Dispatch: `batch-8-dispatch.md` is the executor's source of truth.** Every line number in
> Tasks 8.1–8.7 below is **stale** and is corrected there.

**Recommended Executor** (on unblock): **two sequential passes, one batch, ONE commit**

- **Pass 8A** → `backend-developer` (Tasks 8.1–8.4)
- **Pass 8B** → `frontend-developer` (Tasks 8.5–8.6)
- **Pass 8C** → `senior-tester` (Task 8.7)

**Fallback Executor**: `backend-developer` for the whole batch
**Execution Mode**: sequential
**Rationale**: Same reasoning as batch 2 — the backend write path and the Monaco decoration layer are different disciplines, but they ship together because a half-landed write path is worse than none.
**Tasks**: 7 | **Satisfies**: D2

> ### ✅ SEQ-2 — PRECONDITION MET (retained in full; the stakes below still bind)
>
> **Dependencies: Batch 7 (sequential) ✅ `f47351d14` AND — non-negotiably — Batch 2 independently verified against every one of A1's, A2's, A3's and A4's acceptance criteria ✅ `seq-2-verification.md`, 2026-08-10.**
>
> **The precondition is satisfied. Everything below it is NOT obsolete** — it is why the executor must treat this batch as the highest-risk unit in the task. The four failure modes enumerated below are the reasons the gate existed; the gate closing means the diff Batch 8 derives its patches from is trustworthy, **not** that a bad patch has stopped being unrecoverable.
>
> _Original wording, retained for provenance:_ **No part of the D2 hunk stage/revert write path may start until the keystone batch (A1+A2+A3+A4) has been independently verified.** Not "implemented", not "committed" — _independently verified against its acceptance criteria_.
>
> This is a data-integrity constraint, not a scheduling preference. A hunk stage/revert takes the diff on screen and applies a derived patch to the user's git index or working tree. That operation is only as correct as the diff it derives from:
>
> - **A1 unfixed** → the patch derives from an arbitrarily old snapshot. Best case the apply fails; **worst case it applies cleanly at a shifted offset and silently corrupts the file.**
> - **A2 unfixed** → the "staged" diff is really `HEAD ↔ worktree`. The user believes they are curating a commit and is handed **the opposite of what they selected.**
> - **A3 unfixed** → a failed git read renders as "new file, all additions". Staging from it stages a **fabricated whole-file addition** whose real HEAD content was never read.
> - **A4 unfixed** → deleted-file diffs do not open, so the deletion case cannot be exercised at all.
>
> **The git index holds work the user is about to commit. The working tree holds work that may exist nowhere else. Corruption here is not recoverable by undo.**
>
> **Orchestrator: before spawning batch 8, re-read batch 2's acceptance criteria and confirm each one was verified, not merely claimed. If any is unverified, batch 8 does not start.** — **DONE.** Every A1–A4 criterion was re-read from `task-description.md` verbatim (not paraphrased from this file or from Batch 2's commit message) and dispositioned individually in `seq-2-verification.md`. A2 AC5 was the one that came back unproven; it was closed on a second pass rather than waved through.

### Task 8.1: Extend `GitDiffFileResult` with patch + hunks ⏸️ PENDING

**Files**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-git.types.ts`, `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\git-info.service.ts`
**Requirement**: D2 AC1, AC10
**Details**: Add `patch: string | null` (git's own unified diff for this comparison) and `hunks: GitHunkRef[]` (parsed headers only: `{ index, originalStart, originalLines, modifiedStart, modifiedLines, header }`).
**Validation Notes**: Risk **V-4** / Open Question #3 — this is an **additive, non-breaking** second touch of the result interface, adopted deliberately to keep the keystone batch tight. SEQ-1 constrains the _tab-key scheme_, not this interface. Not scope drift.

### Task 8.2: `git:applyHunks` contract + Zod ⏸️ PENDING

**Files**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-git.types.ts`, `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`, `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\git-rpc.schema.ts`, `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\git-rpc.handlers.ts`
**Requirement**: D2 AC12, AC13; NFR-3, NFR-4
**Details**: `GitApplyHunksParams { path, originalPath?, comparison, operation: 'stage'|'unstage'|'revert', hunkIndices: number[], snapshotToken }`; `GitApplyHunksFailure = 'STALE_SNAPSHOT'|'APPLY_FAILED'|'BINARY_UNSUPPORTED'|'INVALID_OPERATION'|'NOT_A_REPO'|'UNKNOWN'`; `GitApplyHunksResult { success, code?, message?, snapshotToken? }`.
**One method with an `operation` discriminant, not three** — one Zod schema, one staleness path, one audit-log site. Register in `RpcMethodRegistry` + `RPC_METHOD_PRESENCE` + `GitRpcHandlers.METHODS`.
**Validation Notes**: **Amendment A-1 / D2 AC13 superseded** — no `platform-core` port. Add to `GitInfoService` + `GitRpcHandlers`, which are already three-runtime; **never** to `git-watcher.service.ts` or a host-specific handler. **Amendment A-2** — `'git:'` is already allowlisted; the gates that can fail are `RPC_METHOD_PRESENCE` (compile error) and the `METHODS` tuple (test failure via `rpc-allowlist.spec.ts:43`). **NFR-3: Zod-validate the payload on the backend BEFORE touching git.**

### Task 8.3: Operation matrix + patch reassembly ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\git-info.service.ts`
**Requirement**: D2 AC2, AC3, AC4, AC9, AC10
**Details**: **Governing decision: git generates the patch, git consumes the patch.** The frontend never constructs diff text.

| comparison | operation     | Patch source                                               | Apply command             |
| ---------- | ------------- | ---------------------------------------------------------- | ------------------------- |
| `worktree` | stage (AC2)   | `git diff -U3 --no-color --no-ext-diff -- <path>`          | `git apply --cached -`    |
| `worktree` | revert (AC4)  | same                                                       | `git apply -R -`          |
| `staged`   | unstage (AC3) | `git diff --cached -U3 --no-color --no-ext-diff -- <path>` | `git apply --cached -R -` |

Reassembly: keep the file header block (`diff --git`, `index`, `---`, `+++`) plus **only the selected `@@` hunks, verbatim**, including any `\ No newline at end of file` marker (AC9).
**Validation Notes**: **Do NOT recompute hunk headers.** Later hunks' `+`-side start lines are stale relative to a partially applied file; `git apply` tolerates this via context matching and reports the offset. This is precisely `git add -p`'s behaviour. **Do NOT pass `--recount` or `--unidiff-zero`** (we use `-U3`). **No line-ending code of our own** — `core.autocrlf` is handled implicitly because `git diff` emits in index (LF) space and `git apply --cached` applies in the same space; that is the whole point of this design. The valid operation set is derivable from `comparison` — **validate that in the handler, not just the schema** (AC AC INVALID_OPERATION).

### Task 8.4: Server-side staleness + atomicity + forensics ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\git-info.service.ts`
**Requirement**: D2 AC6, AC7; NFR-8; R-1
**Details** (plan §6.5):

```
1. validatePathSegment(path); validatePathSegment(originalPath ?? path)
2. resolveRoot(workspaceRoot) — existing registered-folder guard (git-rpc.handlers.ts:162-186)
3. operation invalid for comparison                     -> INVALID_OPERATION
4. recompute the snapshot exactly as git:diffFile does
5. recomputed != params.snapshotToken                   -> STALE_SNAPSHOT        [AC6]
6. patch is "Binary files … differ" or 0 hunks          -> BINARY_UNSUPPORTED    [AC10]
7. reassemble the selected hunks                                                 [AC9]
8. revert only: snapshot worktree file bytes to a temp file
9. git apply <flags> --check -   (stdin = patch)        -> APPLY_FAILED          [AC7]
10. git apply <flags> -          -> on failure:
      revert  : restore from the temp snapshot
      --cached: git read-tree <tree from `git write-tree` at step 4>
                                                        -> APPLY_FAILED          [AC7]
11. recompute and return the new snapshotToken
12. log { workspaceRoot, path, comparison, operation, hunkIndices,
          snapshotToken, patchSha256, exitCode } at info                         [R-1]
```

**Validation Notes**: **AC6 is the single most important criterion in D2** — staleness is refused **server-side**, never trusted from the client, and never applied optimistically. **Risk A-5: do NOT cache the snapshot token; a cached token defeats AC6 entirely.** The two extra git spawns per apply are acceptable — the operation is user-initiated and infrequent. **Risk A-6**: the token check makes the pre-image provably identical to what the user saw, so no offset shift is possible against a fresh snapshot; additionally **parse `git apply`'s stderr for `offset` and log it**. `git write-tree` writes only tree objects and never moves a ref. NFR-8: sanitized messages only, raw stderr to the log.

### Task 8.5: Hunk affordances in the diff view ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\diff-view\diff-view.component.ts`
**Requirement**: D2 AC1, AC10, AC11, AC14; D3 AC6
**Details**: **Glyph-margin decorations plus an overlay widget** anchored at `modifiedStart` in the modified model. **No view zones** (they shift line numbers) and **no model edits**. Affordances positioned by git's `@@ -a,b +c,d @@` modified-side line ranges, **not** by Monaco's change regions — git hunk boundaries and Monaco's differ, and git's segmentation is authoritative. Binary → actions absent, not present-and-broken (AC10).
Keyboard reachability (AC14): a **roving-tabindex list of hunk actions in the diff header bar** (`Hunk 2 of 7 — Stage / Revert`) driven by the same `hunks` array, so keyboard users never need to reach the margin.
**Validation Notes**: **`readOnly: true` and `renderMarginRevertIcon: false` stay. The modified pane NEVER becomes writable.** That is what makes AC11 ("no accidental edits outside the explicit hunk actions") structurally true rather than a behavioural promise. Line decorations render in **both** layouts → D3 AC6 satisfied for free.

### Task 8.6: Confirmation modal + post-apply refresh ⏸️ PENDING

**Files**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\diff-view\diff-view.component.ts`, `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor\editor-diff-split.ts`
**Requirement**: D2 AC5, AC7, AC8
**Details**: **Revert requires confirmation — a modal, not a single unconfirmed click** (AC5). On failure, surface _what_ failed and _why_ (AC7).
Post-apply refresh (AC8): `git apply --cached` writes `.git/index`, which the Electron watcher already observes (`git-watcher.service.ts:151-153`) → `git:status-update` → the batch-2 refresh path updates the diff tab, the Source Control counts, and the file-tree indicators. VS Code and CLI have no watcher, so **refresh explicitly on the RPC response in all hosts** and let the watcher push be idempotent.

### Task 8.7: Real-repository byte-identity tests ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\git-info.service.spec.ts`
**Requirement**: D2 AC2, AC3, AC4, AC9; NFR-1
**Details**: **Against real temporary git repositories created in the test.** Compare `git diff` / `git diff --cached` output before and after against the output of the equivalent CLI operation. Cover **CRLF line endings, no trailing newline, non-ASCII content** (AC9), plus the AC2/AC3/AC4 "only that hunk moved" assertions.
**Validation Notes**: **Mocked git is NOT acceptable evidence for a claim of byte-identity.** This is the explicit instruction in plan §8.5 and the primary mitigation for R-1 (severity 9, the highest in the register).

**Batch 8 Acceptance Criteria**:

- **SEQ-2 confirmed held** — batch 2 was independently verified before this batch started
- D2 AC1–AC14, with particular weight on:
  - **AC6** — stale snapshot **refused server-side**, diff refreshes, never applied optimistically
  - **AC7** — atomic; a failed apply leaves the repository in its exact pre-operation state
  - **AC9** — byte-identical to CLI git on CRLF / no-trailing-newline / non-ASCII, proven against **real temp repos**
  - **AC5** — revert confirmed, never a single unconfirmed click
  - **AC11** — read-only diff viewing unchanged; the modified pane is never writable
  - **AC10** — binary files: actions absent
  - **AC14** — hunk stage/revert reachable and activatable by keyboard
- `git:applyHunks` exercised **end-to-end in Electron**; registry + presence + `METHODS` all present; `rpc-allowlist.spec.ts` green
- Every hunk operation logged with enough detail to reconstruct what was applied (R-1 forensics)
- Standing gates 1–7 pass
- **ONE commit for all seven tasks**

---

## Batch 9: Follow-Up Filing ⏸️ PENDING

**Recommended Executor**: `senior-tester`
**Fallback Executor**: `devops-engineer`
**Execution Mode**: sequential
**Tasks**: 3 | **Dependencies**: Batch 8 **or Batch 7 if the cut line was taken — it was, on 2026-08-10**, so this batch is reachable now and does **not** wait on SEQ-2 | **Satisfies**: DoD items 9, 10

### Task 9.1: File B6 (file-tree virtualization) as a follow-up task ⏸️ PENDING

**Requirement**: DoD item 10
**Details**: Create the follow-up task record with **the M2 measurement attached as justification**. B6 was explicitly ruled out of scope: expanding a large directory renders every node with no windowing, but virtualizing the tree is a self-contained project with its own keyboard-navigation, screen-reader-tree, scroll-restoration and drag-and-drop surface. B3 removed the sharper edge of the same problem; **if B3's M2 figure shows the tree is still slow at scale, that measurement is the justification.**

### Task 9.2: File the R-3 residue and any B-group findings ⏸️ PENDING

**Requirement**: DoD item 9; task-description Out-of-Scope item 8
**Details**: Every case in `r3-triage.md` marked "follow-up finding" becomes a filed record. Same for any additional hot path profiling revealed during B-group work — **recorded as findings for a follow-up task, never absorbed into this one**.

### Task 9.3: File the accumulated per-batch follow-up candidates — **ELEVEN items** ⏸️ PENDING

> **Register closed at the R-7 cut line (2026-08-10).** Items 1–5 accumulated across Batches 4–6 and
> are confirmed still recorded, unaltered. Items 6–11 were filed by Batch 7 (five by the executor, one
> hit independently by both executor and reviewer). **Every item carries a concrete one-line fix, not
> an open question** — verified item by item by the reviewer in Round 2. If a future batch adds to
> this register, it inherits that bar.
>
> **The register dropped from twelve to eleven on 2026-08-10.** The former item 6 — keyboard users
> cannot focus a split pane, and therefore cannot save from one — was **fixed rather than filed** and
> is recorded as a post-batch fix under Batch 7 above. It is removed from this table deliberately:
> leaving it queued would send someone to fix it a second time. Items 7–12 renumbered to 6–11.

**Requirement**: DoD item 9 (same "file, never absorb" rule as Task 9.2)
**Details**: These were raised by `code-logic-reviewer` during batch execution, dispositioned as
**genuine follow-ups rather than blockers**, and deliberately **not** fixed in the batch that found
them (NFR-9). Each becomes its own filed record. **Do not fix any of them inside TASK_2026_173.**

| #   | Candidate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Raised by                                                                | Severity |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------- |
| 1   | **Drift detection between `libs/shared/src/lib/constants/workspace-scan.constants.ts` and `apps/ptah-electron-e2e/src/specs/editor/perf-m3-watcher-churn.script.mjs`'s hand-maintained `IGNORED_DIRS` copy.** The `.mjs` harness cannot import the TS constant without dragging itself into the build graph and forfeiting the "zero product-code change" property that makes the M3 before/after numbers comparable — so the copy is justified, but its only safeguard today is a comment banner. A text/AST-level test that fails CI when the two lists diverge turns that comment's promise into an enforced invariant. Tooling-only: drift corrupts a future measurement, never production behaviour.                                                                                                                                                                                                                                                                                                                                                              | Batch 5 review, Failure Mode 4 / Issue 2                                 | MODERATE |
| 2   | **Pre-existing B4 AC4 asymmetry, undocumented anywhere.** An explicitly-targeted ignored directory is enumerable via `editor:getFileTree` with an explicit `rootPath` (`buildFileTree` filters `root`'s _children_, never `root` itself) and openable via `handleFileOpen` (which applies no exclusion filter at all) — even though the same directory is unreachable by navigation from the workspace root. Confirmed byte-identical to `HEAD` before and after Batch 5, so genuinely pre-existing and untouched. Arguably the correct "user asked for it explicitly" behaviour, but it is written down nowhere. **File as documentation, not as a bug**, unless a decision is taken to change it.                                                                                                                                                                                                                                                                                                                                                                    | Batch 5 review, Judgment Call 3                                          | LOW      |
| 3   | **Pointer capture on the three editor-panel resize handles**, carried over from Batch 4's review. Would make the double-`mousedown` drag re-entry structurally impossible rather than merely benign. Batch 4's reviewer ruled **no action needed** there — the post-refactor code is strictly safer than the pre-refactor behaviour, which registered two racing listener quartets — so this is a hardening improvement, not a defect fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Batch 4 review, Failure Mode 3                                           | LOW      |
| 4   | **`aria-required-children` ownership violation on `role="tablist"` — INTRODUCED by Batch 6 and ACCEPTED BY USER DECISION.** De-nesting the tab close button onto a `role="presentation"` wrapper makes axe descend through the wrapper, which re-parents the close button onto the `tablist`; ARIA permits only `tab` as an owned element. **This is a regression on a rule that previously passed** — the batch trades one critical axe violation for another. The user ruled the trade favourable and instructed that the `tablist`/`tab` shape be kept: `nested-interactive` was a real operability defect, while here the close button stays reachable, focusable, labelled and operable and only its ownership is wrong. **File it; do not re-litigate it, and do not propose `role="toolbar"` + `aria-current`, `aria-owns`, or hoisting the buttons — all three were evaluated and ruled out.** The one clean resolution changes what a screen reader announces ("button, current" vs "tab, selected") and deserves its own D1 AC4 review in a task of its own. | Batch 6 report §6 + review, Integration Risk; user decision 2026-08-10   | MODERATE |
| 5   | **Empty-state `role="list"` ownership violation — CONFIRMED DEFECT, known one-line fix.** When a source-control section has zero files, `SourceControlPanelComponent` renders a plain `<div>` ("No staged changes" / "No changes") inside the `role="list"` region (`source-control-panel.component.ts:141-144, 201-204`). **Not hypothetical**: Batch 6's report called it an inspection-only risk because its axe run used a populated fixture, but the reviewer ran `axe-core` over the exact empty-state markup and reproduced a **live critical `aria-required-children` violation on both branches, today**. It hits the common case — most working trees have nothing staged. Genuinely pre-existing and untouched by Batch 6 (confirmed: the empty-state lines fall outside every hunk in that diff), so correctly excluded there. **Fix: give the empty-state message `role="listitem"`. One line per section, no visual change.**                                                                                                                            | Batch 6 review, Failure Mode 1 / Issue 2                                 | MODERATE |
| 6   | **`closeSplit`'s `stopPropagation()`** — the last live `stopPropagation()` in `editor-panel.component.ts`, held out of both Batch 6's and Batch 7's scope by explicit instruction and confirmed untouched across both rounds (reviewer verified it sits outside every diff hunk). It reads as an obvious leftover ten lines from where Batch 7 worked, which is exactly why it needs a record rather than an opportunistic fix. **Fix: delete the `event.stopPropagation()` line and drop the `MouseEvent` parameter — the close button is already a sibling of the pane container after Batch 6's de-nesting, so nothing depends on the suppression.**                                                                                                                                                                                                                                                                                                                                                                                                                | Batch 7 report §9.1                                                      | LOW      |
| 7   | **Pre-existing right-pane self-echo.** `updateSplitContent`'s first line still sets `splitFileContent` from the right pane's own `contentChanged` — the same self-referential shape as Task 7.2's hazard, just un-debounced and pre-existing. Confirmed by diff as byte-identical to `HEAD`; masked today by last-write-wins signal semantics. Removing it inside Batch 7 would have been a read-path change AC5 forbids. **Fix: drop that line and let the right pane's `[content]` read the shared tab record when one exists, falling back to `splitFileContent` only for the no-tab case — which requires the two new §1.2 panel guards to be re-pointed in the same change, so this is genuinely a batch of its own, not a one-liner.**                                                                                                                                                                                                                                                                                                                           | Batch 7 report §9.4 + review Failure Mode 4                              | MODERATE |
| 8   | **No dedicated "these panes disagree" affordance.** After Cancel on the save-conflict dialog the two panes knowingly hold different content, and the only cue is the generic tab-strip dirty dot — ambiguous between "this pane has unsaved edits" and "the other pane disagrees with what you are looking at". Not data loss: Cancel writes nothing, and the predicate is unchanged by Cancel so **any subsequent save re-prompts**. AC1's wording is disjunctive ("reflects it **or** is visibly marked diverged"), so this is defensible as shipped — the reviewer and executor independently reached the same ruling — but it is defensible, not unambiguous. **Fix: add a `badge badge-warning` "Diverged" chip to the split pane's header bar, shown when `hasUnabsorbedPeerEdit(splitFilePath(), splitFileContent())` is true.**                                                                                                                                                                                                                                | Batch 7 report §10.4 + review Failure Mode 3 / Ruling 1                  | MODERATE |
| 9   | **`axe-core` is not a declared dependency, so dialog accessibility is enforced by reviewers remembering to scan.** Both Batch 6 and Batch 7 proved their a11y claims with `axe-core@4.12.1` reached **transitively** through `@axe-core/playwright`, via temporary specs deleted immediately after. A permanent spec importing it today would break silently on a dependency bump, and declaring it means editing `package.json` — outside the `libs/frontend/editor/**` constraint both batches worked under. **Fix: add `"axe-core": "^4.12.1"` to `devDependencies` and convert the deleted probe into a permanent spec, so this is a CI gate rather than a habit.** Note the standing limit: axe has **no automated rule for focus trapping** and could not have caught Batch 7's Serious 2 — behavioural tests remain necessary alongside it.                                                                                                                                                                                                                     | Batch 7 report Round 2 §"axe" + review §C                                | MODERATE |
| 10  | **The delete-confirm and name-input modals (`editor-panel.component.ts:443-500`) have no `role`, no `aria-modal`, no focus management, and clickable `modal-backdrop` divs.** Batch 7's new save-conflict dialog does none of that, which leaves this one file with **one accessible modal and two inaccessible ones** — an inconsistency that will read as an oversight rather than a scope boundary. Left alone deliberately: fixing them inside Batch 7 would have blurred the save-semantics diff. **Fix: apply the exact shape the conflict dialog now uses — `role="alertdialog"` + `aria-modal` + `aria-labelledby`/`aria-describedby`, the same two-way Tab toggle on the container, and `closeSaveConflict`-style capture-before-open focus restore guarded on `isConnected`.**                                                                                                                                                                                                                                                                               | Batch 7 report §9.3 + Round 2 filing 6                                   | MODERATE |
| 11  | **Flaky perf assertion in CI — `perf M2 scaling — directory indicator lookup (B3 AC2)`.** Failed once during Batch 7 with `Expected: < 3 / Received: 23.89` and passed on three subsequent runs; the reviewer hit the identical flake independently in Round 1 while running a different experiment, which is what raises it from "one bad run" to a real CI liability. It is a wall-clock threshold measuring GC/timing noise on a shared runner, in Batch 3's work, unrelated to anything Batch 7 touched — so it is filed, not fixed. **It matters because a test that fails at random trains everyone to re-run rather than read the failure, which is precisely how a genuine B3 regression would get waved through.** **Fix: replace the absolute millisecond bound with the scaling-ratio assertion the AC actually cares about (time at N vs time at 10N stays sub-linear), so the test measures the O(1) claim rather than the runner's mood.**                                                                                                               | Batch 7 report Round 2 §"One flake worth naming" + reviewer, both rounds | MODERATE |

**Validation Notes**: Also still open from Batch 5 §10.2, already covered by Task 9.2's "any
additional findings" clause but repeated here so it is not lost: the two **glob-string** exclusion
lists at `editor-rpc.handlers.ts:487` and `:736` (serving `editor:searchInFiles` and
`editor:listAllFiles`) carry only 5 of `TREE_HIDDEN_DIRS`' 12 names and are **already drifted**.
B4 AC2's "single source of truth" is true of the _predicate mechanism_, which is what Option B
scoped — it is not true of every exclusion decision in that file.

**Batch 9 Acceptance Criteria**:

- B6 filed with the M2 measurement attached
- Every R-3 follow-up finding filed; **none re-suppressed**
- **Every Task 9.3 candidate filed as its own record; none silently dropped and none fixed in-task**
- `measurements.md` complete: M1–M4, before and after, each with workload, sample count, method, median and max

---

## Final Definition of Done (verify at MODE 3)

1. Every acceptance criterion in A1–A4, B1–B5, C1–C2, D1–D3 passes, **verified in Electron**
2. B0 satisfied — before/after for B1, B3, B4, B5 with method, workload, sample count, median and max; M1–M4 met **or the shortfall explicitly flagged**
3. **SEQ-1 held** — the tab-key scheme changed exactly once, in a single unit of work (batch 2)
4. **SEQ-2 held** — no hunk write-path code merged before A1–A4 were verified
5. NFR-1 — **rebaselined**: Electron suite **≥135 passed / ≤4 skipped** AND `rpc-handlers` **≥1410 passed / ≤2 skipped**, cross-project sum never below **1545** (see Standing Per-Batch Gates item 1), with new automated coverage for the A-group correctness claims and D2's stage/revert semantics
6. NFR-4 — every new RPC method in both required locations and exercised end-to-end
7. NFR-5 — VS Code, Electron and CLI all build; no frontend→backend or backend→frontend import introduced; new git capability in `GitInfoService` + `GitRpcHandlers` per amendment A-1, **not** in `git-watcher.service.ts`
8. Lint (standalone per project) and typecheck clean across all affected projects
9. R-3 triage complete — newly-surfaced git failures fixed or filed, **none re-suppressed**
10. B6 filed with the M2 measurement attached

---

## Status Legend

| Icon           | Meaning                              | Set by      |
| -------------- | ------------------------------------ | ----------- |
| ⏸️ PENDING     | Not started                          | team-leader |
| 🔄 IN PROGRESS | Assigned to an executor              | team-leader |
| 🔄 IMPLEMENTED | Executor done, awaiting verification | executor    |
| ✅ COMPLETE    | Verified and committed               | team-leader |
| ❌ FAILED      | Verification failed                  | team-leader |
