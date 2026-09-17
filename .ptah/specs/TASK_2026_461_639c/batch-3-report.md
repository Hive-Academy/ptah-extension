# Frontend implementation — `TASK_2026_461_639c`, batch 3

**Tasks completed**: Task 3.1 — deleted `skillSynthesis.eligibilityMinTurns` and `skillSynthesis.prefilterMinChars` end to end, including file settings, RPC validation and DTOs, Angular controls/labels, and all named fixtures. Added A4 coverage proving stale update-payload keys parse successfully and are stripped from the output.

**Files**:

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\platform-core\src\file-settings-keys.ts — removed both registered keys and defaults.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.schema.ts — removed both schema fields.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.schema.spec.ts — removed both live fixture fields and added the A4 stale-payload stripping case.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.handlers.spec.ts — removed both settings fixture fields.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\shared\src\lib\types\rpc.types.ts — removed both DTO members.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\frontend\skill-synthesis-ui\src\lib\components\skill-settings-panel.component.ts — removed both labels and form-bound inputs.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\frontend\skill-synthesis-ui\src\lib\components\skill-settings-panel.component.spec.ts — removed both controls from the test form.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\frontend\skill-synthesis-ui\src\lib\components\skill-synthesis-tab.component.ts — removed both controls from the parent settings form.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\frontend\skill-synthesis-ui\src\lib\components\skill-synthesis-tab.component.spec.ts — removed both settings fixture fields.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\frontend\webview-e2e-harness\src\lib\scenarios\thoth\skills-lane-pickers.e2e.spec.ts — removed both settings fixture fields.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\apps\ptah-electron-e2e\src\specs\thoth\skills.spec.ts — removed both settings fixture fields.

**Stack observed**: Angular 21.2.6 from `package.json`; standalone components, signals/reactive forms, and mandatory `ChangeDetectionStrategy.OnPush` from `skill-synthesis-tab.component.ts`, `skill-settings-panel.component.ts`, and sibling `skill-candidates-table.component.ts`; Tailwind 3/daisyUI 4 styling from the existing component templates and root `CLAUDE.md`; Zod 4.3.6 at the RPC boundary from `package.json` and `skills-synthesis-rpc.schema.ts`.

**Design fidelity**: No visual design handoff applied. The existing two-column settings grid and all existing classes remain unchanged; only the two obsolete rows were removed.

**States covered**: Existing loading, interactive, and save behavior is unchanged. No focusable dead controls or orphan labels remain. A4 covers persisted stale settings reaching the update boundary: both unknown fields are accepted and stripped by Zod.

**Verification**:

1. Process discipline before verification: each Batch 3 run checked for active Jest/Nx commands and executors. Nx daemon/plugin workers were identified as idle infrastructure and excluded. Runs were held while the Batch 4 lane or another worktree had an active Jest/Nx executor.

2. First test attempt:

   `NX_DAEMON=false npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/skill-synthesis-ui`

   The command continued beyond the tool's 120-second capture window; the capture returned exit 124 while the same process tree remained active. It was allowed to finish before any other Batch 3 command. Because its final stdout was unavailable, it was rerun once with the HANDOFF rule 8 mitigation `--parallel=1`.

3. Serialized test rerun:

   `NX_DAEMON=false npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/skill-synthesis-ui --parallel=1`

   Header:

   ```text
   NX   Running target test for 4 projects:
   ```

   Totals:

   ```text
   @ptah-extension/shared: Test Suites: 59 passed, 59 total
   @ptah-extension/shared: Tests: 1521 passed, 1521 total

   @ptah-extension/platform-core: Test Suites: 41 passed, 41 total
   @ptah-extension/platform-core: Tests: 4 todo, 781 passed, 785 total

   @ptah-extension/skill-synthesis-ui: Test Suites: 27 passed, 27 total
   @ptah-extension/skill-synthesis-ui: Tests: 431 passed, 431 total

   @ptah-extension/rpc-handlers: Test Suites: 101 passed, 101 total
   @ptah-extension/rpc-handlers: Tests: 33 skipped, 3016 passed, 3049 total

   NX   Successfully ran target test for 4 projects
   ```

   Aggregate: 228 suites passed; 5,749 tests passed, 33 skipped, 4 todo, 0 failed. Nx reported one of four tasks from local cache. Existing forced worker-exit/open-handle warnings appeared in shared, platform-core, and rpc-handlers; the command exited 0.

4. Typecheck:

   `NX_DAEMON=false npx nx run-many -t typecheck -p @ptah-extension/platform-core @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/skill-synthesis-ui @ptah-extension/skill-synthesis @ptah-extension/webview-e2e-harness ptah-electron-e2e`

   ```text
   NX   Running target typecheck for 7 projects:
   NX   Successfully ran target typecheck for 7 projects
   ```

   Totals: 7 passed, 0 failed. The included `@ptah-extension/skill-synthesis` and dependent `rpc-handlers` typechecks passed on the first completed run, so the conditional source-failure rerun was not needed.

5. Lint:

   `NX_DAEMON=false npx nx run-many -t lint -p @ptah-extension/platform-core @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/skill-synthesis-ui`

   ```text
   NX   Running target lint for 4 projects:
   NX   Successfully ran target lint for 4 projects
   ```

   Totals: 4 passed, 0 failed, 31 pre-existing warnings (9 platform-core, 19 rpc-handlers, 2 shared, 1 skill-synthesis-ui), 0 errors. No warning was introduced in a changed location.

6. Degradation audit:

   `NX_DAEMON=false npx nx run degradation-audit:lint`

   The first two completed attempts failed while concurrent Batch 4 had an unannotated fail-open catch in its owned untracked cleanup store: `libs/backend/skill-synthesis: 7 FAIL (baseline 6)`. Batch 3 did not edit that file. After waiting for Batch 4 to finish its test/audit cycle and add the required suppression, the final run produced:

   ```text
   degradation-audit: scanned 2853 file(s)
   libs/backend/platform-core: 7 ok (baseline 7)
   libs/backend/rpc-handlers: 1 ok (baseline 1)
   libs/backend/skill-synthesis: 6 ok (baseline 6)
   libs/frontend/skill-synthesis-ui: 5 ok (baseline 5)
   libs/shared/src: 3 ok (baseline 3)
   degradation-audit: TOTAL 303 unsuppressed site(s)
   NX   Successfully ran target lint for project degradation-audit
   ```

   Final exit: 0. No baseline was updated.

7. Required dead-key audit:

   `rg -n "eligibilityMinTurns|prefilterMinChars" libs apps -g "*.ts"`

   ```text
   libs\backend\skill-synthesis\src\lib\prefilter-corpus-measurement.spec.ts:57:  eligibilityMinTurns: 5,
   libs\backend\skill-synthesis\src\lib\prefilter-corpus-measurement.spec.ts:59:  prefilterMinChars: 800,
   libs\backend\skill-synthesis\src\lib\prefilter-corpus-measurement.spec.ts:77:    t.turnCount >= OLD_SETTINGS.eligibilityMinTurns &&
   libs\backend\skill-synthesis\src\lib\prefilter-corpus-measurement.spec.ts:78:    t.charLength >= OLD_SETTINGS.prefilterMinChars;
   ```

   Only the explicitly retained opt-in corpus harness remains.

8. `git diff --check` limited to Batch 3-owned files: exit 0, no output.

No SQLite spec is touched; XB1 is not applicable.

**Risk handling**:

- A4 / persisted stale settings: the update schema spec constructs both old field names, parses without throwing, asserts the output is exactly `{ settings: {} }`, and asserts neither stale property exists.
- R-TL5 / shared worktree: no file under `libs/backend/skill-synthesis` or `libs/backend/persistence-sqlite` was edited. Verification waited for Batch 4 Jest/Nx runs and the final degradation audit waited for its cleanup-store suppression.
- R9 / load flakes: the uncaptured long-running parallel test attempt was allowed to finish, then rerun with `--parallel=1`; the serialized run passed all four projects.
- XB2: Batch 3 adds no catch or fail-open path; the final repository-wide audit exits 0.
- XB3: only `run-many` was used for multi-project checks; observed project counts were exactly 4 / 7 / 4.
- XB4: no tracker, invocation-event promotion, extractor field, generalization shortcut, or phase-5 behavior was changed.
- UI regression risk: OnPush, signals/reactive-form ownership, DOM safety, and existing utility classes remain unchanged; deletion leaves no dead label, control, fixture, string, or DTO field.

**Plan deviations**: None. The only operational deviation was the required HANDOFF rule 8 serialized rerun after the first test process outlived the tool capture window.

**Out-of-scope observations**: Existing lint warnings and Jest worker teardown warnings remain. Batch 4's transient degradation-audit failure was fixed by its owning lane and was not modified in Batch 3.
