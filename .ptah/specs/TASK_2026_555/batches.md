# Batches - TASK_2026_555

Total tasks: 64 | Batches: 60 | Complete: 48/60

Progress (2026-10-02): Batches 1-35 (with 2b, 12b, 12c, 15b, 17b, 27b, 28b-28d, 32b) are COMPLETE; the Providers tab
gate (28) is committed at 3fa94f02d, 28b at 0daf6ccdd, 28c at 7788993b3, 28d at 46fda2e5f, 29 at 41b85393c, 30 at
07da3f4f6, 31 at c04a85a4e, 32 at b4c512eb3, 32b at b1ef5eb50, 33 at 45fbd7146, 34 at 7dd06a872 and 35 at 2d59760e1
(Gate V 50 decisions recorded in task.md at cb865c3a8). Batch 36 is IN_PROGRESS: its implementation is committed at
6384f0a22 (fix) and e75a1cf31 (harness), and the Gate V 36 reviews are pending. Track B: Batch 39 at f316580ea, 40 at
0e5cb4d38, 45 at 40f4bc821.
Next: Gate V 36 for Batch 36 (visual-reviewer + combined 29-36 code review; then stop and show the user the flagged
items).

Source of truth: `implementation-plan.md` (final, review rounds 1-2), `design-spec.md`, `task.md` "## Decisions",
`parity-inventory.md`, `prototypes/final/` (visual source of truth), `investigation/forensics-523-vs-shipped.md`.
The plan's step labels (S1a-S7) are kept in each batch header so the two documents stay aligned.

## Path roots (absolute)

- ROOT = `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign` (worktree, branch
  `feat/task-555-settings-redesign`). Never touch `D:\projects\ptah-extension` itself.
- TASK = `ROOT\.ptah\specs\TASK_2026_555`
- CHAT = `ROOT\libs\frontend\chat\src\lib\settings`
- CORE = `ROOT\libs\frontend\core\src\lib\services`
- UI = `ROOT\libs\frontend\ui\src\lib\native`
- HARNESS = `ROOT\libs\frontend\webview-e2e-harness\src\lib\scenarios\settings`
- RT = `ROOT\libs\backend\cli-agent-runtime\src\lib\cli-agents`
- RPC = `ROOT\libs\backend\rpc-handlers\src\lib\handlers`
- TYPES = `ROOT\libs\shared\src\lib\types`

## Execution defaults (recorded, chosen by the team-leader)

1. **Batch size cap.** At most 6 files across at most 2 libs, with one scoped verify command. The plan's S5 (≈44 files)
   and S6 (≈34 files) are therefore split into sequential sub-batches. Two exceptions are allowed where D14 requires
   an atomic move (unmount + mount in one commit): Batch 18 (8 files) and Batch 34 (7 files including deletions).
   Each is marked EXCEPTION and gives its reason.
2. **One owner per tab (plan §6 rule 2).** Batches 17-28 (Providers) run in **one** `frontend-developer` subagent
   instance, continued with SendMessage between batches. Batches 29-36 (Orchestration) do the same, in the same
   instance or a second one. They are never CLI lanes and never parallel.
3. **Visual gate as a ratchet.** The plan says a UI batch commits only with green fold assertions and
   `visual-review.md` PASS for its tab. Once the tab is split, the fold budget cannot pass until the layout batches
   land. Default:
   - Intermediate sub-batches commit when typecheck/test/lint and the reachability gate are green and the smoke
     captures are attached. **From Batch 22 on there is no per-batch code review** (user decision 2026-09-30,
     task.md "## Decisions"). Batch 21 was committed the same way, while its already-running Glm review was still in
     flight.
   - The **tab-gate batch** (28 Providers, 36 Orchestration, and 50 Advanced / Search & Voice) commits only
     when fold assertions are green in both hosts and both themes, visual-reviewer returns PASS, AND the combined
     cross-side code review of that tab's whole diff accepts (28: Batches 21-28; 36: Batches 29-36; 50: Batches
     39-50).
   - Visual drift checkpoints (visual-reviewer, structural drift only) run at Batch 24 (cards/grid) and Batch 31
     (matrix).
   - Once a fold assertion turns green, every later batch keeps it green.
   - Nothing merges before Batch 38.
   - If the user wants the strict reading instead, hold the tab's sub-batch commits and squash them at the gate. No
     batch boundary changes.
4. **Shared-worktree concurrency.** Parallel batches edit the same working tree. Rules:
   - Parallel batches must be file-disjoint (all are, by construction).
   - The team-leader re-runs each batch's verify command serially at commit time, after the previous commit lands.
   - `nx build ptah-extension-webview` and every Playwright run write `dist/` and the screenshots folder. They are a
     **single-writer resource**, and only one gate run happens at a time.
   - Batches whose verify commands test the same project (3 and 4 on cli-agent-runtime) are not run concurrently.
5. **CLI lanes.**
   - Batches are vendor-neutral. The orchestrator picks the lane from `ptah_agent_list` at spawn time.
   - Constraints at decomposition time (2026-09-29, from the orchestrator):
     - opencode must not be used (out of quota).
     - Glm cannot read images, so it is never a visual reviewer.
     - antigravity is available.
     - codex is also listed as installed, but the orchestrator did not offer it. Use it only if the orchestrator
       confirms.
   - **Lane status update (from the orchestrator):**
     - The user chose codex + antigravity as the lanes.
     - The Glm lane (Ollama Cloud) has hit its usage limit.
     - codex has hit its usage limit until 2026-10-03 20:10.
     - opencode is out of quota.
     - **antigravity is the only CLI lane.** Cross-side reviews of in-process work go to antigravity.
     - If antigravity also stops, independent reviewer subagents are used, and their reviews are labelled
       same-side in the review file and the commit body.
     - With one lane, lane-eligible batches run in-process when antigravity is busy reviewing. Reviews take
       priority over lane authoring.
   - Lanes never run git.
   - At most 3 lanes at once.
6. **Cross-side review route.**
   - **From Batch 22 on (user decision 2026-09-30):** code reviews are combined, not per batch. There is one
     cross-side review over the whole Providers diff (21-28) at Gate V 28, one over the whole Orchestration diff
     (29-36) at Gate V 36, and one over the Advanced / Search & Voice batches at their Gate V. The routing rules below
     pick the reviewer for those combined reviews (and applied per batch up to Batch 20). Batches 37 and 38 keep
     their own routes.
   - In-process author (subagent) → code review by a CLI lane (code-logic-reviewer role; plus the code-style-reviewer
     role where the batch lists it).
   - CLI-lane author → subagent `code-logic-reviewer` (plus `code-style-reviewer` where listed).
   - The visual review is always the `visual-reviewer` subagent, because Glm cannot read images and antigravity's
     image capability is unverified. When the author is an in-process frontend-developer, this is a same-side
     independent reviewer, and the reason is disclosed in `visual-review.md`. If the orchestrator confirms an
     image-capable lane, that lane may do the visual review instead.
   - A code review never substitutes for the visual review (plan §6 rule 4).
7. **Gate G (reachability), from Batch 16 on.** Every batch that commits after Batch 16 is committed must also pass
   Gate G. That includes backend batches:
   ```
   npx nx build ptah-extension-webview
   cd D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\frontend\webview-e2e-harness && npx playwright test --config=playwright.config.ts src/lib/scenarios/settings/settings-reachability.e2e.spec.ts
   ```
   A red Gate G blocks the commit, even when the batch's own tests are green (D14, plan §6 rule 6). From Batch 22 on,
   with no per-batch code review (default 6), typecheck/test/lint, Gate G and the smoke captures are the whole
   per-batch commit gate. The team-leader still checks the changed files on disk before committing. Batches committed
   before Batch 16 are covered by Batch 16's baseline run on top of them.
   - **No silent re-runs.** Every Gate G run uses `--reporter=list` and keeps its full log. A failure is diagnosed
     before any re-run: record the test name, the failing entry id, and the error with its first stack frame.
     - A failure that reproduces blocks the commit.
     - A failure that does not reproduce is recorded in the log with its details and a suspected cause, and the gate
       is then run with `--repeat-each=3`. All repeats must pass.
     - Local runs have `retries: 0` (`playwright.config.ts:25`), so a single red run is real evidence, not noise.
   - Nothing else may build the webview or write `dist/` while Gate G runs (execution default 4). A concurrent
     rebuild is the first suspect for any unexplained failure.
8. **Gate V (visual), tab-gate batches only.** Gate G, plus
   `npx playwright test --config=playwright.config.ts src/lib/scenarios/settings` (same cwd), run for both hosts
   (vscode, electron) and both themes (anubis, anubis-light) at 1024×768. Then visual-reviewer compares the captures
   in `TASK\screenshots\angular\` with `prototypes/final/screenshots/` and writes `TASK\visual-review.md`.
9. **Smoke captures.** Every UI sub-batch attaches the Batch 16 smoke captures (both tabs, vscode host, both themes)
   to its report, so drift is visible at every commit.
   - **Baseline images are write-once.** `TASK\screenshots\angular\baseline-*.png` are the "before" images the visual
     gates (Batches 28, 36 and 38) compare against. They are frozen at commit 72ab2f4be.
   - Per-batch captures go to `current-{tab}-{host}-{theme}-1024x768.png`.
   - The `baseline-*` names are written only when `SETTINGS_CAPTURE_BASELINE=1` is set explicitly, and nobody sets
     it in this task.
   - No batch ever stages a change to a `baseline-*.png`. At commit time the team-leader checks
     `git status -- .ptah/specs/TASK_2026_555/screenshots/angular/baseline-*`; if a baseline is modified, it is
     restored from 72ab2f4be (`git checkout 72ab2f4be -- <path>`) before anything is staged.
   - Until Batch 17b is committed, the smoke spec still writes the baseline names. Executors either run it and then
     restore the 8 files from 72ab2f4be, or skip it and say so.
10. **No `git stash` in this worktree.** No executor, reviewer or lane uses `git stash` in any form. The stash stack
    is shared with the main checkout and every other worktree, and this worktree always holds several batches'
    uncommitted work, so a stash can take another batch's files or pop another session's entry. This rule was added
    after the Batch 4 reviewer stashed; the orchestrator confirmed nothing was lost.
    - To compare against the base, use a read-only form such as `git show HEAD:<path>`, `git diff`, or a scratch copy
      of the file outside the worktree.
    - To reproduce red before a fix, revert the fixed lines in a temporary copy, never in the shared tree.
    - Reviewers stay read-only on the working tree.
11. **Jest passthrough goes to `test` only.** Never pass `-- --maxWorkers=2` to a run that includes `typecheck`:
    Nx forwards it to `tsc`, which fails with `TS5023 Unknown compiler option` (seen in 28c and 28d). Run
    `typecheck,lint` and `test` as two commands, and add the passthrough to the `test` one only (Batch 17
    verification shows the form).

## Commit and verification log

| Batch | Commit | Verify (serial, at commit time) | Review | Accepted findings / notes |
| --- | --- | --- | --- | --- |
| 3 | 16b5120e4 | typecheck and lint green. test: 1241 pass; the 2 failures are both in `capabilities/claude-approval.reader.spec.ts`, a known git-latency flake (its imports are only node builtins and `./claude-approval.reader`; the orchestrator ran it 21/21 on the base commit and in the worktree). The 115 Batch 3 specs (cursor, sdk-error-summary, codex) pass alone | subagent code-logic-reviewer (cross-side of Glm), APPROVED | Moderate 1 (the `run.cancel()` rethrow is a fresh `Error`, losing vendor error identity) accepted: the only consumer reads `.message`, and a fresh error keeps the key out of the stack. Moderate 2 (no adapter-level multi-secret spec) accepted: Cursor holds one secret |
| 6 | 84f59b405 | platform-electron typecheck and lint green; `electron-secret-storage.spec.ts` 27/27; `ptah-electron` typecheck/test/lint green. The only failures were `workspace-watch-host.{stress,entry}.spec.ts`, under load (the entry spec passes 12/12 alone) | subagent code-logic-reviewer (cross-side of antigravity), APPROVED | Carry-forward to Batch 7: catch a `persist()` rejection from `delete()` |
| 5 | c569d1eaa | shared, core, chat and webview green. rpc-handlers: 3387 pass, 1 fail = `harness/selection/harness-skill-selection-rpc.service.spec.ts` (pre-existing; fails on `main`) | subagent code-logic-reviewer, APPROVED. **Same-side** for the part a backend-developer subagent finished (disclosed in the commit; the Glm lane wrote most of the code) | Debt recorded on Batch 8 (3 under-typed fixtures; a keychain outage fails the whole `getConfig`) |
| 15 | 335c532ae | ui, chat, memory-curator-ui and skill-synthesis-ui all green | Glm lane (cross-side of the in-process author), APPROVED 7/10 | NativeAutocomplete defects → Batch 15b; "byte-for-byte" wording corrected in Task 15.1 |
| 14 | 47b39d17d | ui and chat green (modal spec 10/10) | subagent code-logic-reviewer (cross-side of Glm), APPROVED; the author fixed findings 1-2 | Finding 3 (focus trap/return) → Playwright acceptance in Batches 27 and 32 |
| 8 | 82cba0142 | core and chat typecheck/test/lint all green (the chat typecheck error seen earlier came from Batch 15b's in-progress edit to `native-autocomplete.component.ts:294`, now fixed there) | Glm lane (cross-side of the in-process author), APPROVED 8/10; the stage-default deviation was judged correct (`dependsOnPrevious` existed only in `connectProvider`) | Moderate 1 (callers ignore the refusal boolean) → Batch 17 acceptance. Moderate 2: the three deliberately changed TASK_2026_534 assertions (spec `:874`, `:896`, `:1354`) are listed in the commit body (there is no `batch-8-report.md`). The `TASK_2026_551/fix-report.md` UI half is committed with this batch. Batch 5 fixture debt: none of the three fixtures was touched, so it is still open |
| 15b | b8d720ba2 | ui, chat, memory-curator-ui and skill-synthesis-ui all green | subagent code-logic-reviewer; round 1 APPROVED with 2 moderate, round 2 APPROVED (both fixed, 118/118). The fixes were finished by a frontend-developer subagent after the Glm lane hit its usage limit, so that part is **same-side** (disclosed in the commit) | Batch 15 review defects closed; Batches 22, 26 and 30 are unblocked on this dependency |
| 9 | 827f8cdd2 | core and chat all green; facade spec `git diff --stat` empty | antigravity lane (cross-side of the in-process author), APPROVED 9/10, 0 findings | The facade is still 1094 lines; the < 700 acceptance applies at the end of Batch 11 |
| 1 | d1b1469a3 | Full S1a command (11 projects): the only failed task is `rpc-handlers:test`, with one failure, the known `harness-skill-selection-rpc.service.spec.ts` (3398 passed). Everything else is green | Glm lane round 1 APPROVED 7/10 (3 moderate) → one bounded correction → antigravity lane round 2 APPROVED 8/10. **Revise cap reached**, so no further loop | **Known open defects, not fixed in this task** (also in the commit body): **M1**, when two queued `set()` calls on one key both fail, the in-memory cache keeps the first write's unpersisted value (`libs\backend\platform-core\src\file-settings-manager.ts:122-147`; fix: snapshot `previous` from the last committed value, not the current cache). **Minor**, the startup sweep logs a benign ENOENT warning when two processes sweep the same stale temp file at once (`:553-558`). Both are candidates for a follow-up task; Batch 38/Mode 3 lists them as open |
| 7 | 2b4d0ac12 | shared, core, vscode-core and ptah-electron typecheck/lint green. Test failures: rpc-handlers 1 (the known `harness-skill-selection`), vscode-core 1, `services/git-info.service.review.spec.ts` (real-git load flake; 2/2 alone; vscode-core has no uncommitted change) | subagent code-logic-reviewer (cross-side of the antigravity lane), round 1 APPROVED with 2 moderate, round 2 APPROVED 9/10 (both fixed, 11/11) | Checked on disk: no `sdkAdapter.reset()`; the secret-store throw is caught (Batch 6 carry-forward met); fixed error texts. The lane process exited 1 twice after finishing, so the report and the files are the evidence. Batch 13 is unblocked on this dependency |
| 16 | 72ab2f4be | harness typecheck/lint green; webview rebuilt from the current tree (Batches 1, 7, 9, 15b committed; the uncommitted Batches 10 and 2 were in the tree); **Gate G 9/9** in vscode and electron: the count guard, the 64-id baseline, the host guard, all 64 present entries reached by real clicks per host, and kept selectors | antigravity lane round 1 NEEDS_REVISION 5/10 (2 blocking, 2 serious) → one correction → in-process code-logic-reviewer round 2 APPROVED 8/10. **Same-side**, disclosed (all CLI lanes out of quota). **Revise cap reached** | Open items → Task 37.3: NW-1 (`closeWizard` assertion in `finally` masks the real failure, `table.ts:110`); NW-2 (#56 toggle-and-restore can leak FixtureState); NW-3 (recovery may leave another tab active); #39/#79 error branches untestable until `installRpcAutoResponder` gains an opt-in error envelope. `settings-reachability.table.ts` is 802 lines (max-lines warning; a data table, accepted). The hollow-spec deletion moved here from Batch 37. From this commit on, Gate G is mandatory for every commit |
| 10 | d5f238415 | core and chat all green; facade spec diff empty; webview rebuilt; **Gate G 9/9** both hosts | in-process code-style-reviewer, APPROVED 9/10 (2 minor). **Same-side**, disclosed (lanes out of quota) | Facade is 804 raw / 710 counted lines, so the < 700 acceptance lands in Batch 11. `ProvidersCommitService` is not exported from the core barrel |
| 2 | ad747e20b | cli-engine, ptah-extension-vscode, ptah-electron and ptah-cli typecheck/test/lint all green; webview rebuilt; **Gate G 9/9** both hosts | in-process code-logic-reviewer, APPROVED (specs 45/45, 4/4, 4/4). **Same-side**, disclosed (lanes out of quota) | Found two pre-existing startup degradations → Batch 2b (user: fix every degradation found). Both were confirmed on disk by the team-leader: the custom-provider load sits inside the migration try (`apps\ptah-extension-vscode\src\activation\bootstrap.ts:~105-127`), and `with-engine.ts:105` uses `Symbol.for('WorkspaceProvider')` while `tokens.ts:25` registers `Symbol.for('PlatformWorkspaceProvider')` |
| 11 | 7376571ec | core and chat all green; facade spec diff empty; webview rebuilt; **Gate G 9/9** | in-process code-style-reviewer, APPROVED 9/10. **Same-side**, disclosed | **TASK_2026_554 state-service acceptance met**, measured by the team-leader (non-blank, non-comment lines): facade 540, `providers-commit.service.ts` 329, `providers-connection-setup.service.ts` 258. Minor open: leftover blank lines at facade `:287-289`, `:556-557` (not stripped; the team-leader does not edit code). The collaborators are not exported from the core barrel (by design) |
| 2b | 325d8e751 | cli-engine, ptah-extension-vscode, ptah-electron and ptah-cli all green; webview rebuilt; **Gate G 9/9** | in-process code-logic-reviewer, APPROVED (vscode 8/8, electron 8/8, with-engine 51/51). **Same-side**, disclosed | Checked on disk: `loadCustomProviders(container)` sits outside the migration try; `with-engine.ts:519` uses `PLATFORM_TOKENS.WORKSPACE_PROVIDER`. Carry-forward to Batch 27: surface a custom-provider load error in the catalog if the state exposes one |
| 12 | 0a9d1b85f | core and chat all green (facade spec 86/86); `tsc -p libs/frontend/chat/tsconfig.spec.json` reports 0 errors in `providers-settings.component.spec.ts`; facade 578 counted lines; webview rebuilt; **Gate G 9/9** | in-process code-logic-reviewer, APPROVED. **Same-side**, disclosed | Moderate 1 (`redetectClis` cascaded on the shared section, not its own result) was fixed by the author exactly as the reviewer named it. It was **checked without a second review round**: the orchestrator checked the report, and the team-leader read `providers-settings-state.service.ts:464-473` (a `detected` flag set only after a successful `agent:detectClis`) and the new overlapping-calls spec (`spec :1469`). Moderate 2 (raw `error.message` in RPC outer catches) → Batches 12b/12c. The authorised one-line fixture fix in `providers-settings.component.spec.ts` is included |
| 12c | 08c6500c4 | rpc-handlers: 3412 pass, 1 fail = the known `harness-skill-selection` (the run included 12b's uncommitted handler edits, and nothing else failed); webview rebuilt with Batch 13's in-progress core edits in the tree; **Gate G 9/9** | in-process code-logic-reviewer, APPROVED (20/20, 41/41). **Same-side**, disclosed | `SettingsPersistError` passes through (fixed by construction). New import edge rpc-handlers → `@ptah-extension/platform-core` (lint and boundaries green). Out-of-scope sites are listed in the follow-ups below |
| 12b | d32aebae8 | rpc-handlers: same result (1 known failure, 3412 pass); **Gate G 9/9** | antigravity lane (cross-side of the in-process author), APPROVED 8/10 | **MOD-1 recorded, not fixed:** `auth:setApiKey` returns "Could not save the API key." when a *clear* (empty key → `deleteProviderKey`) fails (`auth-rpc.handlers.ts:1258, :1275`). Nobody sees it in Settings: the state never shows RPC error text (plan §5), and Settings deletes go through `auth:deleteStoredKey` (Batch 7). The wizard's empty-key path is the only caller. Dispatcher rethrow → follow-ups below |
| 13 | c68d1b389 | core and chat all green; counted lines: facade 605, commit 375, setup 362; webview rebuilt; **Gate G 9/9** | antigravity lane (cross-side of the in-process author), APPROVED 8/10 | The moderate (the tier read-back passed for a missing instance) was fixed. The team-leader read `providers-commit.service.ts:270-293`: missing instance → `false` (unsaved), unreadable store → throw (unconfirmed). There are 3 specs at `providers-commit.service.spec.ts:303-314` (the orchestrator re-ran it 40/40 without the cache). 7 files, one over the cap (type-only), accepted. Deviation: `removeCustomEntry` is also blocked while the route is not loaded. **The S2 state layer is complete; the Providers tab starts (Batch 17)** |
| 17b | 41fbce284 | harness typecheck/lint green; webview rebuilt; **Gate G 27/27 with `--repeat-each=3`** (fully parallel); smoke 4/4 in both hosts, 0 `baseline-*.png` modified, 8 `current-*.png` produced | the orchestrator read the one-file, test-only diff. **Same-side**, disclosed | **Gate G flake record:** the owner's first Gate G run in Batch 17 had 1 failure / 8 passes on a bundle that passed 9/9 minutes earlier. The immediate re-run passed, but the failing test name was not captured. It did not reproduce in 27 runs here. Suspected cause: a concurrent webview rebuild or harness run by another agent during that run (the single-writer rule). Execution default 7 now forbids silent re-runs and requires `--repeat-each=3` after any unexplained failure. `current-*.png` are **left untracked** because the repo tracks `.ptah/specs/**` (`.gitignore:135` un-ignores it) and does not ignore similar output. The per-batch smoke captures stay local evidence; the final visual captures are committed in Batches 28, 36 and 38 |
| 17 | 2d11b9a34 | chat, core, ui, harness and webview typecheck/test/lint all green; webview rebuilt; **Gate G 9/9** (log kept at `/tmp/b17-gateG.log`, no failures); 0 `baseline-*.png` modified; `current-*.png` not staged | antigravity lane (cross-side of the in-process author), APPROVED 9/10, 0 findings; the orchestrator confirmed the review has substance | The Batch 8 carry-forward is met: `settings-save-feedback.service.ts:73` returns early on a refused (`false`) write, and spec `:166` covers a refused save while `commit()` still shows an earlier save. Constraint from review `:36` (callers pass a state-service save method as `write`) recorded on Batches 22, 26 and 30. `PROVIDER_MODELS_LOADER` is now also provided at `SettingsComponent`; Batch 18 removes the duplicate in `providers-settings.component.ts:33` |
| 18 | b16102327 | chat, core, ui, harness and webview typecheck/test/lint all green; webview rebuilt; **Gate G 9/9** (log `/tmp/b18-gateG.log`, no failures; the owner's two runs were 9/9 too); 0 `baseline-*.png` modified | antigravity lane (cross-side of the in-process author), APPROVED 9/10, 0 findings; the orchestrator confirmed the review has substance (a move table covering every output, read state and retry) | Checked on disk: `providers-settings.component.ts` no longer mounts the models loader, the assignments or `<ptah-cli-config>`; `orchestration-settings.component.ts` mounts the AOC (`:35`), the assignments (`:49`, with `initialEditingConsumerId`) and `<ptah-cli-config>` (`:54`) unchanged, calls `state.open()` in `ngOnInit` (`:98`) and forwards `focusTarget`; `settings.component.ts:286` calls `redetectClis()`. **9 files, D14 exception** (the reachability spec's kept-selector per-tab check). Interim notes 1 and 2 → Batch 29 |
| 19 | a28c6b851 | chat, core, ui, harness and webview typecheck/test/lint all green; webview rebuilt; **Gate G 9/9** (log `/tmp/b19-gateG.log`, no failures); 0 `baseline-*.png` modified | in-process code-logic-reviewer, APPROVED; both moderate findings fixed by the author (specs 32/32). **Same-side**, disclosed | Checked on disk: `connectionUsage()` returns `complete` (`connection-usage.ts:49, :90`), with `mainProviderId` undefined = route not loaded and null = no main agent (`:24`). `connectionKind()` defaults to `api-key` at runtime (`connection-kind.ts:45`). **Orchestrator decisions:** (a) system CLIs are **not** counted in "Used by", because Codex CLI does not use Ptah's OpenAI Codex connection. This deviates from the prototype and is **flagged to the user** for the visual review (Batch 28/38). (b) "Empty = follows main agent" applies to all six roles. (c) Batch 20 renders "Loading…" while `complete` is false and "Not used yet" only when complete and empty, with a spec (added to Task 20.1) |
| 20 | 36384ace1 | chat, core, ui, harness and webview typecheck/test/lint green (9/14 tasks from cache on unchanged inputs; the owner's round-1 run: core 1083, ui 610, chat 1777 + 2 skipped, webview 224); webview rebuilt; **Gate G 9/9** (log `%TEMP%\b20-tl-gateG.log`, no failures; the owner's runs were 27/27 with `--repeat-each=3`); 0 `baseline-*.png` modified; `current-*.png` not staged. The orchestrator compared the drawer captures with `prototypes/final/screenshots/interactions/drawer-*.png`: the layout matches after the fix | antigravity lane (cross-side of the in-process author), round 1 NEEDS_REVISION 6/10 (3 serious, 1 moderate, 1 minor) → all fixed → round 2 APPROVED 10/10 | Checked on disk: `drawerId` cleared only on a `ready` list without the id (`providers-settings.component.ts:389-392`); `[checking]` from `route.status === 'loading'` (`:251`); `check-failed` on a route error (`:465`). 11 files: 4 new + `providers-settings.component.ts` + its spec (revise round 1, test-only, outside the listed files) + 2 harness files + task.md (lanes decision lines) + report + review; over the cap on test/harness files only, accepted. **Accepted deltas:** (a) backdrop blur / darker scrim lives in `NativeDrawerComponent` → Batch 28; (b) per-connection probe latency ("92ms") and a non-secret key hint ("•••• 8f21") are not in the state contract → Batch 21 question, else a flagged deviation at Gate V; (c) drawer `max-w-lg` (prototype 32rem), computed initials "MK"/"SO" vs the prototype's "KM"/"SV", no Overview footer primary action (Check connection is in the status card) |
| 21 | 2cb1a107a | chat, core, ui, harness and webview typecheck/test/lint green (9/14 tasks from cache on unchanged inputs; owner: core 1083, ui 610, chat 1806 + 2 skipped, webview 224); webview rebuilt (initial bundle 3.49 MB, unchanged); **Gate G 9/9** (log `%TEMP%\b21-tl-gateG.log`, no failures; owner 27/27 with `--repeat-each=3`); 0 `baseline-*.png` modified; `current-*.png` not staged | **review in flight, findings → Batch 22** (Glm lane, started before the user dropped per-batch reviews on 2026-09-30; `batch-21-code-logic-review.md` is not written yet and is not committed). The combined Providers review (21-28) runs at Gate V 28 | Checked on disk: #7, #8, #12 and #49 flipped to `restored`; RUX-1, RUX-4 and RUX-10 added as `restored`; `EXPECTED_CAPABILITY_COUNT` 81 → 84 (`BASELINE_PRESENT_IDS` 64 untouched); the `connection.id !== 'anthropic'` Manage exclusion is removed. #49 covers the drawer half only → Batch 32 (the add-instance modal) extends its reach to the CLI-agent forms. `providers-settings.component.spec.ts` holds this batch's parent-level specs (accepted, outside the list). The orchestrator compared the Moonshot Credentials capture with the prototype markup: the structure matches; no eye toggle on the stored key is correct (the key never reaches the webview). **Flagged deviation for the user at Gate V 28:** no key hint (orchestrator decision: it would send part of the secret across RPC). Overview has no latency; the draft-probe latency is shown only in the Replace check. The Batch 20 carry-forward question is answered: no contract change |
| 22 | bb4502d59 | chat, core, ui, harness and webview typecheck/test/lint exit 0 (core 1083/1083, ui 610/610, chat 1856 + 2 skipped, webview 224/224; lint 0 errors, warnings core 11 / chat 31 / harness 41, unchanged); webview rebuilt (initial 3.49 MB, unchanged); **Gate G 9/9** (log `%TEMP%\b22-tl-gateG.log`, no failures; owner 27/27 with `--repeat-each=3`); owner captures 4/4 and 12/12 with `--repeat-each=3`; 0 `baseline-*.png` modified; `current-*.png` not staged; `ProviderSetupWizardComponent` diff empty | **no per-batch code review** (user decision 2026-09-30); deferred to the combined Providers review (21-28) at Gate V 28 | Batch 21 Glm findings M1, M2, minor 3, 4, 5 fixed and spec-pinned (`batch-21-code-logic-review.md` committed here). Checked on disk: `runDrawerWrite` (`drawer-write.ts:23-44`) publishes `blocked` on reject/refusal; tier write and Undo both call `state.setMainAgentTier` (`models-tiers-tab.component.ts:150-151`, Batch 17 constraint met); Advanced re-reads the setup after a saved base URL (`advanced-tab.component.ts:279`); `PRICING_NOTE` verbatim (`:10`). Outside the listed files, accepted: `drawer-write.ts` (+ spec), credentials-tab (+ spec), providers-settings (+ spec), drawer spec, `settings.fixtures.ts`, `settings-visual.e2e.spec.ts`, new `settings-drawer.reach.ts` (pure move to keep harness lint at 41). Baseline `present` #6/#10/#13/#32/#33/#36 re-routed to the drawer (ids unchanged); `EXPECTED_CAPABILITY_COUNT` 84 → 85. Also committed: `pattern-map-advanced-search-voice.md` + its APPROVED review and the task.md 2026-09-30 decisions. Deviations for Gate V 28 → Batch 28 section |
| 23 | 65b8a9fa0 | chat, core, ui, harness and webview typecheck/test/lint exit 0 (core 1083/1083, ui 610/610, chat 1859 + 2 skipped, webview 224/224; lint 0 errors, warnings 11/31/41 unchanged); webview rebuilt (initial 3.49 MB, **~13 kB under the 3.5 MB error budget** → budget rule on Batches 26/27); **Gate G 9/9** (log `%TEMP%\b23-tl-gateG.log`, no failures; owner 27/27 with `--repeat-each=3`); owner captures 12/12 with `--repeat-each=3`; 0 `baseline-*.png` modified; `current-*.png` not staged; wizard diff empty | **no per-batch code review**; deferred to the combined Providers review (21-28) at Gate V 28 | Checked on disk: `data-field` on the badge (`setting-scope-row.component.ts:77`), `shortFieldName` input with fallback (`:142`, `:202`), D6 session copy via `clearEndsSessions` (`providers-settings.component.ts:210`, `:663`). Out-of-list edits accepted as test-only: card spec, consumer-assignments spec, parent spec, `settings-visual.e2e.spec.ts`, 15-line `openScopeBadge` helper in `settings-drawer.reach.ts`. Beyond-plan choices (in the commit body): "Save provider to…" bridge (`providers-settings.component.ts:100`, removed in Batch 26); `'mixed'` kept as a neutral badge; placement `bottom-start`; D6 copy added. Reachability #16/#17/#18 re-pointed, RUX-5/RUX-6 restored, count 85 → 87. Pre-existing degradation found: VS Code host offers the "Desktop app" layer/target → **new Batch 27b** |
| 24 | 7f1742f4d | chat, core, ui, harness and webview typecheck/test/lint exit 0 (core 1083/1083, ui 610/610, chat 1914 + 2 skipped, webview 224/224; lint 0 errors, warnings core 11 / chat **30** (card `max-lines` gone) / harness 41); webview rebuilt, **no budget error** (initial 3.48 MB, ~3.5 kB smaller); **Gate G 9/9** (log `%TEMP%\b24-tl-gateG.log`, no failures; owner 27/27 with `--repeat-each=3`); owner captures 12/12 with `--repeat-each=3`; 0 `baseline-*.png` modified; `current-*.png` not staged; wizard diff empty | **no per-batch code review**; deferred to Gate V 28. **Drift checkpoint** (orchestrator): the VS Code card grid matches `index-anubis-1024x768.png` structurally | **Encoding incident check:** `git diff HEAD` of `settings-reachability.table.ts` and the card specs has no mojibake (`â€`, `Ã`, `Â`, U+FFFD all absent on disk and in the diff); the table diff is only the `throughCard` / `openCardDrawer` / #15 edits; files are UTF-8 without BOM. **D14 spot-check (3 rows):** Change main provider on the main-agent block (`providers-settings.component.ts:96`); card click → `detailsRequested` → `openDrawer` (`provider-connection-card.component.ts:65`, `providers-settings.component.ts:181`); needs-key / not-installed actions in the drawer (`credentials-tab.component.ts:189` Add key, `:121` Check again). Out-of-list edits accepted (moved types/helpers, removed Manage): drawer (+ spec import), overview-tab import, `settings-drawer.reach.ts`, visual spec. Electron cards 100-111 px → Q-extra-1 **orchestrator decision recorded on Batch 28** (container-width grid) |
| 25 | 08c64663a | chat, core, ui, harness and webview typecheck/test/lint exit 0 (core 1083/1083, ui 610/610, chat 1943 + 2 skipped, webview 224/224; lint 0 errors, warnings 11/30/41 unchanged); webview rebuilt, **no budget error** (initial 3.49 MB, ~13.5 kB under 3.5 MB; lazy chunk `routing-map-component` 14.41 kB); **Gate G 9/9** (log `%TEMP%\b25-tl-gateG.log`, clean; owner 27/27 with `--repeat-each=3`); owner captures 12/12 with `--repeat-each=3`; 0 `baseline-*.png` modified; `current-*.png` not staged; wizard diff empty | **no per-batch code review**; deferred to Gate V 28. Orchestrator capture check: `current-providers-vscode-anubis` matches the prototype routing-map structure (3 nodes, Operational pill, Reassign / Inspect / Manage matrix footers); the old main-agent block below it until Batch 26 is expected | **Capture-run infrastructure failure (execution default 7, not a Gate G run):** in an owner tuning run of `settings-visual.e2e.spec.ts`, test `baseline smoke — both tabs (electron, anubis)` failed at **0 ms** with `Error: worker process exited unexpectedly (code=3221226505, signal=null)` (Windows 0xC0000409); no test body or entry ran, so there is no first stack frame. Log `%TEMP%\b25-visual-crash.log`. It did not reproduce: the immediate re-run and the final `--repeat-each=3` (12/12) passed. Suspected cause: a Chromium/Playwright worker process crash under repeated local builds, not the page. Checked on disk: `providers-settings.component.ts` is 700 lines (at the limit; Batch 26 must reduce it); the map is `@defer (on immediate)` (`:79`); Inspect / Manage call `requestSettingsTab` with `background-models` / `cli-agents` (`routing-map.component.ts:262`); no mojibake in the 7 changed files. Out-of-list: `settings-visual.e2e.spec.ts` (node assertions), accepted. Node reach entries and deviations → Batch 28 section |
| 26 | 78b26e4ec | chat, core, ui, harness and webview typecheck/test/lint exit 0 (core 1083/1083, ui 610/610, chat 1964 + 2 skipped, webview 224/224; lint 0 errors, warnings 11/30/41 unchanged); webview rebuilt, **no budget error** (initial 3.47 MB, ~28 kB under 3.5 MB; lazy `main-agent-reassign-popover-component` 16.46 kB, `routing-map-component` 14.66 kB); **Gate G 9/9** (log `%TEMP%\b26-tl-gateG.log`, clean; owner final 27/27 with `--repeat-each=3`); owner captures 12/12 with `--repeat-each=3`; 0 `baseline-*.png` modified; `current-*.png` not staged; ui, core and wizard diffs empty | **no per-batch code review**; deferred to Gate V 28. Orchestrator capture check (after the "## Visual revise"): the compact popover matches `interactions/index-1.png` (provider select, model select, segmented effort, Save-to select), fully visible in VS Code | Checked on disk: `providers-settings.component.ts` **555** lines (was 700); `git grep main-provider-save-to -- libs` empty. The only "Save provider to…" left in the page is a negative spec assertion (`providers-settings.component.spec.ts:394`). The in-popover re-scope link `main-agent-provider-rescope` ("Save provider to {scope}…") is the RUX-5 path. #16 (`settings-reachability.table.ts:375`) and RUX-5 (`:827`) reach the popover Save-to. D6 copy "…Changing the provider ends running chat sessions." (`main-agent-reassign-popover.component.ts:234-235`), with the provider written only through `runDrawerWrite` → `activateConnection` (`:316`, no Undo); model and effort Undo through `state.saveSettings` (`:356`, `:367`). No mojibake in the 9 changed files. **Owner Gate G diagnostics (execution default 7):** run 1 was 6 failed / 21 passed with a 180 s timeout, because the popover stayed open after Cancel (focus fell to `<body>`); fixed with a spec. Revise run 1 was 6 failed / 21 passed, because focus was lost after "Enter a model ID…"; fixed with `afterNextRender` and a spec. One 0 ms worker crash (0xC0000409, `%TEMP%\b26-gateG-worker-crash.log`) did not reproduce with `--repeat-each=3` (27/27). Out-of-list edits accepted: routing-map / routing-map-node popover slot, harness helper moves. Carry-forwards: Batch 28 (flagged plain model select, height/placement, card preselect); **Batch 27b: RUX-5 and #16 assert "Desktop app" in both hosts; make them host-aware** |
| 27 | 4c1ce8045 | chat, core, ui, harness and webview typecheck/test/lint exit 0 (core 1083/1083, ui 610/610, chat 1976 + 2 skipped, webview 224/224; lint 0 errors, warnings 11/30/41 unchanged); webview rebuilt, **no budget error** (initial 3.47 MB, 971.99 kB over the warning budget, +0.40 kB; lazy `provider-catalog-modal-component` 8.81 kB); **Gate G 9/9** (log `%TEMP%\b27-tl-gateG.log`, clean; owner final 27/27 with `--repeat-each=3`); owner captures 12/12 with `--repeat-each=3`; 0 `baseline-*.png` modified; `current-*.png` not staged; ui, core and wizard diffs empty | **no per-batch code review**; deferred to Gate V 28. Orchestrator capture check: the modal matches the command-palette shape (search + ESC, "Available in catalog", per-row Connect / Sign in). Delta → Batch 28: "Browse catalog →" sits under the hint text, not right-aligned on the same line | Checked on disk: **Batch 14 finding 3 asserted in Gate G**. Search focused on open (`settings-drawer.reach.ts:199`); 12 Tabs, each checked with `dialog.contains(document.activeElement)` (`settings-reachability.table.ts:816-817`); focus returns to "Connect provider" after Esc / backdrop (`:828`, `settings-drawer.reach.ts:207`). **Batch 2b carry-forward handled:** `state.connections()` error → "Custom providers could not be loaded…" + Retry → `state.refreshConnections()` (`provider-catalog-modal.component.ts:44`, `providers-settings.component.ts:164`, `:290`). The `more-providers` route lands on the modal (`providers-settings.component.ts:404-408`; the routing row is unchanged at `settings.component.ts:52`). The modal is in `@defer` (`:161`). Page file 590 lines. No mojibake in the 7 changed files. **Owner Gate G diagnostic (default 7):** run 1 was 6 failed / 21 passed with a 180 s timeout. Cause: daisyUI keeps a closed `<dialog>` laid out, so `toBeHidden()` never passed and a wizard was left open. Fixed by asserting the `open` attribute; not a flake. No worker crash in this batch. Deviations → Batch 28 section |
| 27b | 9bf09cbf7 | chat, core, ui, harness and webview typecheck/test/lint exit 0 (9/14 tasks from cache on unchanged inputs; core 1085/1085, ui 610/610, chat 1989 + 2 skipped, webview 224/224; lint 0 errors, warnings 11/30/41 unchanged; log `%TEMP%\b27b-tl-verify.log`); webview rebuilt, **no budget error** (initial 3.47 MB, 973.12 kB over the warning budget, +1.13 kB; lazy `main-agent-reassign-popover-component` 16.48 kB, `provider-catalog-modal-component` 8.78 kB; log `%TEMP%\b27b-tl-build.log`); **Gate G 9/9** (log `%TEMP%\b27b-tl-gateG.log`, clean; owner 27/27 with `--repeat-each=3`); owner captures 4/4; 0 `baseline-*.png` modified; `current-*.png` not staged | **no per-batch code review**; deferred to Gate V 28. Orchestrator capture check PASSED: `current-scope-popover-vscode-anubis` and `current-main-agent-save-to-vscode-anubis-light` show "VS Code"; the Electron captures show "Desktop app" | **Deviation 1 ACCEPTED by the orchestrator (shown to the user at Gate V 28):** keep the App target in VS Code, labelled "VS Code" (Electron keeps "Desktop app"). Verified on disk by the orchestrator: `platform-vscode/src/settings/vscode-settings-registration.ts:112-122` builds the resolver with the VS Code app prefix; `settings-core/src/scope/workspace-scope-resolver.ts:80-101` reads `<appPrefix>.<key>`; `config-rpc.handlers.ts:188, 671` default writes to `app`. Removing the target would hide existing values. No backend change; `providers-settings-state.service.ts` unchanged. Checked on disk: 13 paths (1 created `app-scope-label.ts`, 12 modified) match the report; `VSCodeService.isElectron` exists (`vscode.service.ts:171`); no mojibake in the diff (byte scan; the `·` is `C2 B7`). 13 paths across 3 libs, over the cap (every label site plus specs/harness), accepted. Report deviation 6 (routing-map "4 enabled" badge over the scope popover, Electron light) → Batch 28 defect |
| 28 | 3fa94f02d | chat, core, ui, harness and webview typecheck/test/lint exit 0 (9/14 tasks from cache on unchanged inputs; core 1085/1085, ui 610/610, chat 1995 + 2 skipped, webview 224/224; lint 0 errors, warnings 11/30/41 unchanged; log `%TEMP%\b28-tl-verify.log`); webview rebuilt, **no budget error** (initial 3.48 MB, 975.78 kB over the warning budget, +2.66 kB against 27b; lazy `connection-detail-drawer-component` 63.23 kB, `main-agent-reassign-popover-component` 18.11 kB, `provider-catalog-modal-component` 8.78 kB; log `%TEMP%\b28-tl-build.log`); **Gate G 9/9** (log `%TEMP%\b28-tl-gateG.log`, clean; owner 27/27 with `--repeat-each=3`); **Gate V (full settings folder, owner): 114 passed, 12 skipped (the 2 `fixme` scenes × 2 hosts × 3), 0 failed with `--repeat-each=3 --workers=2`** (`%TEMP%\b28r-folder3.log`); fold budget per host (task.md "Gate V 28"): VS Code card 5 at 574 px, Electron heading at 547 px, every card 80 px, 0 px overflow at 800 px; 0 `baseline-*.png` modified; no mojibake (byte scan of the diff and the new files) | **Combined Providers code review 21-28:** Glm lane (cross-side), APPROVED 8/10 (`providers-21-28-code-logic-review.md`). M1, m1 and m2 were fixed by the owner exactly as named and **checked on disk without a second review round** (Batch 12 precedent). **Visual:** visual-reviewer PASS WITH NOTES (same-side, disclosed), 5 defects, all fixed; orchestrator re-check → **Providers PASS** (`visual-review.md` "Orchestrator re-check after the revise") | **Gate V failure record (default 7):** the first folder run after the final build failed 2 tests, reachability `#77 ("No CLI agents found" install help)` in both hosts, with `browserContext.newPage: Target crashed` (a Chromium renderer crash while `throughVariantBoot` opened the second page, not an assertion; `%TEMP%\b28r-folder2.log`). #77 had passed 3/3 in the standalone Gate G on the same build. Suspected cause: memory pressure from parallel workers. It did not reproduce in the `--repeat-each=3 --workers=2` re-run (114/12/0), and there was no 0xC0000409. **Review fixes on disk:** M1, `main-agent-reassign-popover.component.ts:237-244` (`target()` null until sources load), `:116, 121, 145, 152` (controls disabled), `:346, 383, 394` (saves guarded), `:160-168` (loading and error with Retry); spec `main-agent-reassign-popover.component.spec.ts:272` "while the model and effort sources are not loaded (M1)". m1, `settings-save-feedback.service.ts` `undo()` keeps the toast and its Undo while `saving()`; spec `settings-save-feedback.service.spec.ts:119` "m1: Undo while another save is in flight…". m2, `providers-settings.component.ts:541-542` (a confirmed wizard save clears the filter); specs `providers-settings.component.spec.ts:685` and `:700`. **Out-of-list accepted:** `apps/ptah-extension-webview/src/styles.css:1939` `[class*='popover']:not(.popover-trigger)`. The `:focus-visible` ring is unaffected: it is `focus-visible:outline` on the inner trigger buttons (`setting-scope-row.component.ts:208`, `routing-map-node.component.ts:62, 74`), and the rule sets only background and border on the non-focusable wrapper `div.popover-trigger` (`native-popover.component.ts:72`). Also: `native-drawer.component.ts` scrim (the one allowed ui file), the shell `settings.component.html` (+ spec), `routing-map-node.component.ts`, the card state/component (B5), and `settings-routing-map.entries.ts`. **Committed with the batch:** task.md "Gate V 28 (2026-10-01, user)", the report, `visual-review.md`, the code review, and the 48 final Providers `current-*` captures (default 9). The 4 `current-orchestration-*` captures stay local until Gate V 36. **User decisions → new Batches 28b, 28c, 28d.** Accepted deviation: the "VS Code" App-layer label |
| 28b | 0daf6ccdd | chat, core, ui, harness and webview typecheck/test/lint exit 0 (9/14 tasks from cache on unchanged inputs; core 1085/1085, ui **615/615** (+5), chat 1997 + 2 skipped, webview 224/224; lint 0 errors, warnings 11/30/41 unchanged; log `%TEMP%\b28b-tl-verify.log`); webview rebuilt, **no budget error** (initial 3.48 MB, 976.07 kB over the warning budget, +0.29 kB; `main-agent-reassign-popover-component` still lazy, 18.07 kB; log `%TEMP%\b28b-tl-build.log`); **Gate G 9/9** (log `%TEMP%\b28b-tl-gateG.log`, clean; owner 27/27 with `--repeat-each=3`); owner full settings folder **120 passed, 6 skipped** (only the `main-model` deep-link `fixme` × 2 hosts × 3) with `--repeat-each=3 --workers=2`; VS Code card 5 at 590 px, Electron heading 547 px; 0 `baseline-*.png` modified; no mojibake | **no per-batch code review**; covered by Batch 38 and the final review. Orchestrator capture check PASSED: `current-main-agent-model-search-vscode-anubis` and `…-electron-anubis-light` show the filtered list with the Tool markers and "Enter a model ID…", on top of everything; the node shows the full "Default (chosen by Claude)" | **Decision 1 accepted (orchestrator):** the existing `ProviderModelSearchFieldComponent` is exported from the ui barrel (`provider-model-picker/index.ts:16-19`) instead of adding a compact mode to the 673-line picker. Checked on disk: `provider-model-picker.component.ts` and its spec have **no diff**; the new inputs `inputId`, `includeDefault` and `pinnedOption` are opt-in with defaults that keep the picker output; chat imports from `@ptah-extension/ui` only (no deep import). **Decision 2 accepted:** Esc in an open list closes only the list (`provider-model-search-field.component.ts:269-271`, `stopPropagation`), in the popover and in the drawer tier pickers; pinned by `provider-model-search-field.component.spec.ts:353` ("Esc closes the open list without reaching an enclosing dialog; a closed field lets Esc through") and `main-agent-reassign-popover.component.spec.ts:206` ("Esc closes the open model list first, and only the next Esc closes the popover"). **Decision 3:** list 210 px against a ~280 px field → Batch 38 carry-forward. **Gate V failure record (default 7):** the owner's first full-folder run failed `reachability (vscode)` at **RUX-10**, `locator('[data-testid="connection-credentials"]')` not found after 5 s (`%TEMP%\b28b-folder.log`), the only failing entry. The entry was untouched by this batch, and it passed in all three Gate G repeats on the same build and in Electron. Suspected cause: drawer tab render timing under two-worker load. It did not reproduce over 3 repeats (120/6/0, `%TEMP%\b28b-folder3.log`); no crash. Committed: 14 source/spec/harness paths + report, the 48 refreshed tracked Providers captures and the 4 new `current-main-agent-model-search-*` files; the `current-orchestration-*` captures stay local. 13 source paths across 3 libs, over the cap as the batch accepts |
| 28c | 7788993b3 | shared, core and rpc-handlers typecheck green (3/3); tests: shared 2202/2202, core 1085/1085, rpc-handlers 3513 passed, 4 skipped, 1 failed = the known `harness-skill-selection-rpc.service.spec.ts` (122 suites); lint 0 errors (shared 5 / core 11 warnings, pre-existing) (logs `%TEMP%\b28c-tl-verify.log`, `b28c-tl-typecheck.log`, `b28c-tl-sc.log`; the first combined run's typecheck failed only on the team-leader's own `-- --maxWorkers=2` passthrough, TS5023, and was re-run without it); webview rebuilt, **no budget error** (initial 3.48 MB, 976.07 kB over the warning budget, unchanged from 28b; log `%TEMP%\b28c-tl-build.log`); **Gate G 9/9** (log `%TEMP%\b28c-tl-gateG.log`, clean, 1.6 m; no failure, so no repeat run); 0 `baseline-*.png` modified; drive D: 53 GB free | **Own cross-side review (orchestrator exception):** antigravity lane, code-logic-reviewer, round 1 NEEDS_REVISION 7.5/10 (S-1, M-1, M-2; 0 blocking, no secret leak) → revise round 1 → **APPROVED 9.5/10** (`batch-28c-code-logic-review.md`) | Checked on disk: recorder `clear()` tombstone with a new sequence (`connection-check-recorder.ts:63-69`), `complete()` refuses older tickets (`:47-55`); custom-entry check uses `probeCustomProvider` + `customProbeCheckRecord` (`connection-check.ts:149-160`, `:262-287`), same as `testCustomEntryAndRecord` (`:228-259`). Committed: 20 paths (9 source incl. 3 new, 10 specs incl. 6 new, `task.md` "Batch 28c" decision line); report and review stay untracked until task end. 2 libs, over the cap by decision. **Carry-forward → Batch 37 / final report:** a concurrent `auth:checkConnection` that joins an in-flight check started before a key change returns the old-key result to the caller (it is not recorded). Evidence: `check()` returns the in-flight promise (`connection-check.ts:98-99`), `recorder.clear()` does not touch `ConnectionChecker.inFlight`, and `run()` returns `record` even when `complete()` refuses it (`:124`, `:131`). Deviations (report "Deviations" 1-7): `Date.now()` latency clock from `DraftVerificationService`; local connections are not checkable |
| 28d | 46fda2e5f | chat, core, ui, harness and webview typecheck,lint exit 0 and test exit 0 (split commands, default 11; every Nx task matched the cache from the owner's identical run, so chat and core were re-run fresh: `--skip-nx-cache` exit 0, direct jest core **1109/1109** (36 suites), chat **2036 passed + 2 skipped** (123 suites); logs `%TEMP%\b28d-tl-tl.log`, `b28d-tl-test.log`, `b28d-tl-test-fresh.log`, `b28d-tl-jest-{core,chat}.log`); webview rebuilt, **no budget error** (initial 3.48 MB, 978.64 kB over the warning budget, +2.57 kB against 28c, ~21 kB under the 3.5 MB error budget; log `%TEMP%\b28d-tl-build.log`); **Gate G 9/9** (log `%TEMP%\b28d-tl-gateG.log`, clean, 1.9 m; no failure, so no repeat run); owner Gate G 27/27 with `--repeat-each=3`; owner full settings folder **40 passed, 2 skipped** (the known main-model deep-link `fixme` × 2 hosts; `%TEMP%\b28d-settings-folder.log`, written at 17:11 after the last source edit at 16:55, so not re-run); 0 `baseline-*.png` modified | **no per-batch code review** (user decision 2026-09-30). Orchestrator capture check PASSED: `current-drawer-moonshot-*` ("Connected & verified (92ms)", "•••• 8f21 (stored on this machine)"), `current-drawer-moonshot-credentials-*` (hint) and `current-providers-*` ("Used by 2" on OpenAI Codex) match `drawer-moonshot.png` and `index-anubis-1024x768.png` | Checked on disk: `hostKeyHint` (`providers-settings-sections.ts:107-116`) admits only `/^•{4} \S{4}$/u` and is applied only when a key is stored (`providers-settings-state.service.ts:306`, `:317`); the hint is never an RPC parameter and no added line logs. `checkConnection` (`providers-connection-setup.service.ts:102-127`): `hostCheckable` ids call `auth:checkConnection` (35 s) then the route re-read; local servers, Ollama Cloud and unknown ids get the re-read alone, and no added line calls `auth:testConnection`. A failed RPC publishes `failed` with no host text; latest generation wins. D15: `overviewCheckedStatus` returns "Check failed" for any non-verified record and never overrides a route warning (`overview-tab.component.ts:84-108`); no latency for null/0/NaN. Codex CLI listed for `openai-codex` only, while `complete` waits for `agent:getConfig`. Committed: 18 source/spec/harness paths + the 36 refreshed tracked `current-*` captures (Providers, drawers, main-agent popover/model search/Save-to, catalog, scope popover); the 4 `current-orchestration-*` stay local until Gate V 36; report untracked until task end. Over the 6-file cap on specs/harness (2 libs + harness), accepted as the batch allows. **Carry-forwards → Batch 38** (Task 38.1) |
| 29 | 41b85393c | chat, core, ui, harness and webview typecheck,lint exit 0 ("Successfully ran typecheck, lint for 5 projects"; log `%TEMP%\b29-tl-tl.log`) and test exit 0 (split commands, default 11; `--skip-nx-cache`): core **1109/1109** (36 suites), ui **615/615** (31), webview **224/224** (11), chat **2082 passed + 2 skipped** (125 suites; 28d 2036, +46 new: rows spec 31, notes spec 15); log `%TEMP%\b29-tl-test.log`; webview rebuilt (`--skip-nx-cache`), **no budget error** (initial 3.48 MB, 978.64 kB over the warning budget, unchanged from 28d: neither new file is imported yet; log `%TEMP%\b29-tl-build.log`); **Gate G 9/9** (`--reporter=list`, log `%TEMP%\b29-tl-gateG.log`, clean, 2.5 m; no failure, so no repeat run); 0 `baseline-*.png` modified; drive D: 52 GB free | **no per-batch code review** (user decision 2026-09-30); pure derivations, no UI, so the orchestrator capture check does not apply and no `current-*` capture was refreshed | Checked on disk: 4 new files, 676 lines (rows 249, rows spec 284, notes 75, notes spec 68), no `as any`, no TODO/stub/skip/only. `cliMatrixRows` (`cli-matrix-rows.ts:239-249`): `ptahCliId`, non-system and duplicate detection rows skipped (`:156`); status only Ready / Disabled / Not installed / Needs API key (Cursor) (`:163`), no quota state (D11); Cursor `credentialAction` on both groups (`:179`); stable rank by `preferredAgentOrder`, unranked last (`:226-233`); instance status, key status and tiers (`:185-219`). `cliPermissionNote` (`cli-permission-notes.ts:71`): `Record` over `CliType`, so every id has copy at compile time; `PENDING_USER_REVIEW_IDS = ['copilot', 'ptah-cli']` (`:17`). Committed: the 4 paths only; report untracked until task end. **For Gate V 36 user review:** the new Copilot / Ptah-instance copy, the "Sandboxed Port" deviation, the Pi package mismatch and Batch 30's new install copy, listed under Task 36's implementation details |
| 30 | 07da3f4f6 | chat, core, ui, harness and webview typecheck,lint exit 0 ("Successfully ran typecheck, lint for 5 projects", no passthrough) and test exit 0 (`-- --maxWorkers=2`; the harness has no test target): core **1109/1109** (36 suites), ui **619/619** (31, +4), webview **224/224** (11), chat **2127 passed + 2 skipped** (127 suites; 29: 2082 / 125, +45); webview rebuilt (`--skip-nx-cache`), **no budget error** (initial 3.48 MB, 981.10 kB over the 2.5 MB warning, +2.46 kB against 29, under the 3.5 MB error budget; lazy `cli-orchestration-matrix-component` 33.36 kB); **Gate G 9/9** (`--reporter=list`, clean, 1.9 m; no failure, so no repeat run); 0 `baseline-*.png` modified | **no per-batch code review** (user decision 2026-09-30); the commit gate is the checks. Two orchestrator visual rounds: V30-1, V30-2 and V30-4 fixed; V30-3 (`py-3` rows) reverted to `table-xs` per implementation-plan.md 1049-1052 / 1080-1082 | Committed by explicit path: 11 source/spec/harness paths (4 new chat files, `orchestration-settings.component.ts`, `settings-cli-matrix.entries.ts`, reachability table, visual spec, ui `native-autocomplete` and `provider-model-search-field` + spec), the 16 `current-orchestration-*` captures, `task.md` ("Second track (2026-10-01, user)" decision line) and `batch-30-report.md` (earlier batch reports 1-23 are tracked). The 8 Providers `current-*` captures the smoke run rewrote (`current-providers-electron-*`, `current-provider-catalog-*`, `current-scope-popover-electron-*`; `git diff --stat` binary only) were **not staged** and were restored after the commit. ui changes are opt-in (`compact`, `matchInputWidth`, `placeholder`; defaults keep every other consumer unchanged). 11 source paths across 3 libs, over the cap as the report lists (deviation 1 + visual round 1). **Open item → Batch 36:** Electron Orchestration fold projected about 86 px over 660 |
| 31 | c04a85a4e | chat, core, ui, harness and webview typecheck,lint exit 0 ("Successfully ran typecheck, lint for 5 projects", no passthrough) and test exit 0 (`-- --maxWorkers=2`): core **1109/1109** (36 suites), ui **619/619** (31), webview **224/224** (11), chat **2149 passed + 2 skipped** (129 suites; 30: 2127 / 127, +22); webview rebuilt (`--skip-nx-cache`), **no budget error** (initial 3.48 MB, 981.03 kB over the 2.5 MB warning, -0.07 kB against 30, under the 3.5 MB error budget; lazy `cli-orchestration-matrix-component` 45.65 kB, was 33.36 kB); **Gate G 9/9** (`--reporter=list --workers=2`, track B may be building, clean, 2.1 m; no failure, so no repeat run); owner Gate G 9/9 and 27/27 with `--repeat-each=3 --workers=2` after the #63 fix; `settings-reachability.e2e.spec.ts` equals HEAD (the owner's timeout change was reverted); 0 `baseline-*.png` and 0 non-orchestration `current-*` modified | **no per-batch code review** (user decision 2026-09-30); the commit gate is the checks. Orchestrator accepted the visuals (cursor and copilot popover captures) and the visual drift checkpoint (report §5: no structural drift) | Committed by explicit path: 10 source/spec/harness paths (4 new: `cursor-credential-popover` and `copilot-auto-approve-toggle` + specs; matrix + spec, `cli-model-effort-popover.component.ts`, `settings-cli-matrix.entries.ts`, reachability table, visual spec), 24 `current-orchestration-*` captures (16 retaken + 8 new `popover-copilot` / `popover-cursor`) and `batch-31-report.md`. **Gate G record (default 7, from the report):** the owner's runs 1-2 failed on a real defect in the new #63 entry (Undo outside the popover moved focus, so Esc left `cli-permission-popover` open), fixed in the entry; a later 8-worker repeat failure was diagnosed as CPU load and the capped `--workers=2` repeat passed 27/27. Old AOC Copilot toggle kept until Batch 33 (transient duplicate). **Open items → Batch 36** (a)-(c) |
| 32b | b1ef5eb50 | chat, core, ui, harness and webview typecheck,lint exit 0 ("Successfully ran targets typecheck, lint for 5 projects", 10 targets, no passthrough; log `%TEMP%\b32b-tl-tl.log`) and test exit 0 (`-- --maxWorkers=2`, 4/4 from cache on the owner's identical inputs; log `%TEMP%\b32b-tl-test.log`), then ui and chat re-run fresh (`--skip-nx-cache`): ui passed; chat passed (13 m 59 s; the log was overwritten by the chat-only re-run, so the fresh ui line is from the first fresh attempt; log `%TEMP%\b32b-tl-test-fresh.log`). Owner counts: chat **2179 passed + 2 skipped** (131 suites, +1), ui **624/624** (31 suites, +1), core 1109/1109, webview 224/224. Webview rebuilt, **no budget error** (initial **3.48 MB**, the 2.5 MB warning is pre-existing; log `%TEMP%\b32b-tl-build.log`). **Gate G run 1: 8/9** (log `%TEMP%\b32b-tl-gateG.log`), then **27/27 with `--repeat-each=3 --workers=2`** (log `%TEMP%\b32b-tl-gateG-repeat.log`); 0 `baseline-*.png` modified | **no per-batch code review** (user decision 2026-09-30); this diff is in the combined Orchestration review at Gate V 36. Team-leader capture check: `current-orchestration-modal-tiers-vscode-anubis-light` shows `glm-5.3:cloud` in all three tier fields | **Gate G failure record (default 7):** run 1 failed `reachability (electron) › every present/restored capability is reachable` in `bootSettings` before any entry ran, `TimeoutError: page.goto: Timeout 15000ms exceeded` at `settings.fixtures.ts:672`; no assertion failed. Suspected cause: CPU starvation. `Win32_Processor.LoadPercentage` was 100/100/100 right after the run, with jest/vitest/nx runs from other worktrees (task-576-p2, task-576-p3, task-578, qa3elhamor); no build of this worktree's `dist/` ran. It did not reproduce: the repeat run was 27/27. The owner's run hit the same signature (report §4). Checked on disk: `selectedLabel` (`provider-model-search-field.component.ts:256-261`) returns the raw ID when no option matches and `compactLabel(option)` when compact, otherwise `option.name`; there is one spec in each of ui and chat; no stub markers. Committed by explicit path: 3 source/spec paths, `batch-32b-report.md` and the 8 modified `current-orchestration-*` captures (4 modal-tiers, 4 popover anti-aliasing only). **Closes Gate V 36 item 7** (HANDOFF list); item 8 (two Esc presses) stays open |
| 33 | 45fbd7146 | chat, core, ui, harness and webview typecheck,lint exit 0 ("Successfully ran targets typecheck, lint for 5 projects", no passthrough; log `%TEMP%\b33-tl-tl.log`) and test `-- --maxWorkers=2` exit 0 (4 projects; chat and webview ran, core and ui from cache on unchanged inputs; log `%TEMP%\b33-tl-test.log`). Owner counts: chat **2206 passed + 2 skipped** (131 suites, +27 against 32b), core 1109, ui 624, webview 224. Webview rebuilt, **no budget error** (initial **3.48 MB**; log `%TEMP%\b33-tl-build.log`). **Gate G 9/9** (`--reporter=list --workers=2`, clean, 2.8 m, first run, no repeat needed; log `%TEMP%\b33-tl-gateG.log`); 0 `baseline-*.png` and 0 non-orchestration `current-*` modified | **no per-batch code review** (user decision 2026-09-30); in the combined Orchestration review at Gate V 36. Orchestrator capture check PASSED after visual revise round 1 (`current-orchestration-order-popover-vscode-anubis`, `current-orchestration-electron-anubis`): 24×24 ▲/▼ in an order popover instead of 14×10 stacked arrows, and the bar is one row in both hosts | Checked on disk: `agent-orchestration-config.component.ts` (292 lines) has no `ClaudeRpcService`, no private `agentConfig` and no `agent:*` call; class `AgentOrchestrationConfigComponent` and selector `ptah-agent-orchestration-config` are kept. **Host-text rule (track B scan): clean.** The old `:404` / `:617` patterns are gone. The re-detect failure (`:15`, `:251-254`) and the order-save failure (`:16`, `:274`) show fixed sentences, and the thrown error is discarded. The one remaining `{{ state.commit().message }}` (`orchestration-settings.component.ts:85`) is pre-existing at HEAD and composed from fixed text (`providers-commit.service.ts:390` keeps RPC error text out of UI state). Writes go through `state.saveSettings({orchestration:{maxConcurrentAgents|preferredAgentOrder}})` with Undo of the exact previous value; reordering waits for both `orchestration` and `cliAgents` reads and for no save in flight. The deep link opens `background-roles-details` for every background target, not `cli-agents`. Out-of-list harness files accepted (orchestrator): `settings-reachability.e2e.spec.ts` (3 lines, `reveal` click) and `settings-visual.e2e.spec.ts`. **Owner Gate G record (default 7):** 5 runs under 99-100% CPU (R1-a 24/27, R1-b 24/27, R1-c 22/27, R1-d 26/27, R1-e 27/27 with `--repeat-each=3`). Every failure was recorded with its entry (RUX-4, #47, RUX-5, #28, RUX-8), error and frame (`settings-reachability.e2e.spec.ts:89` page closed after the 180 s budget, `page.goto` 15 s at boot, `route.fetch` 10 s on an external fonts.gstatic.com request, worker crash 0xC0000409), plus a suspected cause. None was on an entry this batch touches, and none reproduced on the same entry. Gaps against default 7: the record is one table written after the runs, so it does not show that each failure was diagnosed before the next run; every run was already `--repeat-each=3`; R1-c's "kept selectors survive" boot failures and R1-d name no entry. This team-leader's own Gate G passed on its first run, so the commit does not rest on those runs. Committed by explicit path: 8 source/spec/harness paths, `batch-33-report.md` and 40 `current-orchestration-*` captures (32 re-taken, 8 new `roles-open` / `order-popover`). 5 chat + 3 harness paths, over the 6-file cap by the 2 accepted harness files |
| 34 | 7dd06a872 | chat, core, ui, harness and webview typecheck,lint exit 0 ("Successfully ran targets typecheck, lint for 5 projects", no passthrough; log `%TEMP%\b34-tl-tl.log`) and test `-- --maxWorkers=2` exit 0 (4 projects, 2 from cache on the owner's identical inputs; log `%TEMP%\b34-tl-test.log`). Owner counts: chat **2202 passed + 2 skipped** (130 suites; the deleted spec's suite is gone), core 1109, ui 624, webview 224. Webview rebuilt, **no budget error** (initial **3.46 MB**, down from 3.48: the deleted component left `main.js`; log `%TEMP%\b34-tl-build.log`). **Gate G 9/9** (`--reporter=list --workers=2`, clean, 1.5 m, first run, no repeat; log `%TEMP%\b34-tl-gateG.log`), so the D14 proof holds with the old component deleted; 0 `baseline-*.png` and 0 non-orchestration `current-*` modified | **no per-batch code review** (user decision 2026-09-30); in the combined Orchestration review at Gate V 36. Orchestrator accepted deviations 1-4, the out-of-list files the report names, the #45 popover copy and, for now, the matrix "Test failed: {reason}" text. Revise round 1 (roles chevron) checked on the `current-orchestration-roles-open-vscode-anubis` capture: it points down when open | Checked on disk: `git grep "PtahCliConfigComponent\|ptah-cli-config" -- libs apps` hits only `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/index.ts:16` and `ptah-cli-registry.ts:66` (the `ptah-cli-config-persistence.service` import paths). The barrel export is removed (`settings/index.ts`, old line 13). The `cli-agents` target is `[data-testid="cli-matrix"]` (`orchestration-settings.component.ts:124, 132-134`, by template ref `#cliMatrix` so the matrix stays lazy) with `tabindex="-1"` on the table (`cli-orchestration-matrix.component.ts:98-99`). The chevron rotate is on an `aria-hidden` wrapper (`orchestration-settings.component.ts:66-68`). #45 is in the popover (`cli-model-effort-popover.component.ts:113-117`, `:155-159`). The `providers-commit.service.ts` change is a comment only. **Host-text rule:** no added line in the 19 touched files renders `.error`, `error.message` or `.reason`; the one host reason (`cli-orchestration-matrix.component.ts:476`, unchanged) is listed under Gate V 36. Parity: report §4 maps every Ptah-instance capability (#39, #42-#57, #59-#69, RM-3) to its new home and a real-click Gate G entry; `EXPECTED_CAPABILITY_COUNT` 97 and the 64 baseline ids are unchanged. **Owner Gate G record (default 7):** G1 22/27, each failure diagnosed with step, error and frame (the run ran out of time on 5 second-page boots, a real cost of the draft, fixed with one shared `ALL_CLIS_LIVE` page); G2 9/9; G3 26/27 (#64, a 180 s budget timeout under 100% CPU, not reproduced); G4 27/27 with `--repeat-each=3`. Committed by explicit path: 19 source/spec/harness paths (including the 2 deletions), `batch-34-report.md` and 37 `current-orchestration-*` captures. EXCEPTION: over the 7-path budget by the out-of-list files the orchestrator accepted. Commitlint: 0 errors, 1 warning (`footer-leading-blank`, a body line starting with `#45` parsed as a footer) |
| 35 | 2d59760e1 (docs: cb865c3a8) | chat, core, ui, harness and webview typecheck,lint exit 0 ("Successfully ran targets typecheck, lint for 5 projects", no passthrough; log `%TEMP%\b35-tl-tl.log`) and test `-- --maxWorkers=2` exit 0 (4 projects, 2 from cache on the owner's identical inputs; log `%TEMP%\b35-tl-test.log`). Owner counts: chat **2228 passed + 2 skipped** (131 suites; 34: 2202 / 130), core 1109, ui 624, webview 224. Webview rebuilt, **no budget error** (initial **3.46 MB**, unchanged; log `%TEMP%\b35-tl-build.log`). **Gate G 9/9** (`--reporter=list --workers=2`, clean, 1.5 m, first run, no repeat; log `%TEMP%\b35-tl-gateG.log`); 0 `baseline-*.png` and 0 non-orchestration `current-*` modified | **no per-batch code review** (user decision 2026-09-30); in the combined Orchestration review at Gate V 36. Orchestrator capture check PASSED after visual revise round 1 (R1 one-line role cells, R2 summary `text-base-content`, R3 deep-link targets cleared on tab change) | Checked on disk: `provider-consumer-assignments.component.ts` is 385 lines (323 counted, under 700). All inputs (`timeoutNotice`, `disabled`, `initialEditingConsumerId`) and outputs (`setupProviderRequested`, `retryEnhancementRequested`, `assignmentSaved`, `timeoutSaved`) are kept (`:217-224`), as is `data-testid="assignments-heading"` (`:45`). **No re-export shim:** neither file re-exports; `connection-usage.ts`, the container and both specs import the moved symbols from `provider-consumer-rows.ts`. **Host-text rule: clean.** The only rendered message is `readiness.message` (`:110`), and `providerReadiness` (`provider-consumer-rows.ts:221-246`) returns fixed sentences with only the provider display name filled in. **D15:** `writeAssignment` (`:345-349`) emits `assignmentSaved` only when the write is accepted and `commit()` is `saved`, for the write and for Undo; `saveDraft` (`:339-342`) puts the picker back on the read-back row otherwise; a blocking readiness writes nothing (`:316`); `saveTimeout` gates `timeoutSaved` the same way (`:379-381`). **600 s budget:** the changed lines of `settings-reachability.e2e.spec.ts` are identical to track B `d0b6c6f39` (`Compare-Object` on the `-U0` diffs: no difference). **Owner Gate G record (default 7):** G1 20/27 was a real reproducing RUX-12 failure (the sticky deep link re-opened the roles), diagnosed and fixed, and the root cause was then fixed in R3; G2-G4 failed only on the 180 s per-host budget with no assertion failure (entries named); G5 27/27 with one worker; the orchestrator then stopped re-runs and applied the 600 s budget; G6 27/27 and the revise run 27/27, both with `--repeat-each=3 --workers=2`. Committed by explicit path: 13 source/spec/harness paths (2 new), `batch-35-report.md` and 27 `current-orchestration-*` captures (23 re-taken, 4 new `role-popover`). Over the 6-file cap by the out-of-list files the report names (deviation 1). **Separate docs commit cb865c3a8:** task.md "## Decisions" gets the user's Gate V 50 decisions (2026-10-02), and `pattern-map-advanced-search-voice.md` P6 changes the drawer width from 460 px to 512 px |
| 36 (implementation; gate pending) | 6384f0a22 (`fix(chat)`, order popover focus) + e75a1cf31 (`test(webview-e2e-harness)`, scenes + fold gate) | chat, core, ui, harness and webview typecheck,lint exit 0 (log `%TEMP%\b36-tl-tl.log`) and test `-- --maxWorkers=2` exit 0 (4 projects, 2 from cache; log `%TEMP%\b36-tl-test.log`; policy bar spec 23/23 per the owner). Webview rebuilt, **no budget error** (initial **3.46 MB**; log `%TEMP%\b36-tl-build.log`). **Gate G 9/9** (`--reporter=list --workers=2`, clean, 1.6 m, first run; log `%TEMP%\b36-tl-gateG.log`). **Full settings folder `--workers=2`: 72 passed, 2 skipped (the known main-model deep-link `fixme`, one per host), 0 failed** (3.5 m; log `%TEMP%\b36-tl-folder.log`). Fold log: VS Code roles summary 643 px (enforced, pass) in both themes; Electron 779 px, logged as over and not enforced (`fold-pending`). All 96 `current-*` were backed up to `%TEMP%\b36-tl-shots-backup` first, and the non-orchestration ones were restored afterwards; 0 `baseline-*.png` and 0 non-orchestration `current-*` modified | **Batch 36 is the tab gate and is NOT COMPLETE.** The visual-reviewer and the combined cross-side code review of 29-36 run next, and the batch is marked COMPLETE only when both accept (default 3) | Checked on disk: the popover fix (`agent-orchestration-config.component.ts`) keeps native `disabled` on the ends only, sets `aria-disabled` while `!canReorder()`, and guards `moveAgentUp/Down` on `canReorder()`; the spec adds the held-save focus test. The fixture change is one optional `overrides` parameter spread over the stateful fixtures (`settings.fixtures.ts`, 703 lines, accepted as 1 over). `git grep "status: 'pending'"` over the settings harness finds only the table's doc comment (`settings-reachability.table.ts:14`). `ORCHESTRATION_ELECTRON_ROLES_FOLD_ENFORCED = false` (`settings-visual.e2e.spec.ts:289`). No stub markers in added lines. **Owner Gate G record (default 7):** B36-G1 26/27, one worker crash 0xC0000409 at 0 ms before any entry (known), then B36-G2 27/27 with `--repeat-each=3`; the scene failures F1 (test defect: option name) and F2 (a real focus race, which became the fix commit) were diagnosed before re-runs. Committed by explicit path: the fix commit holds 2 chat files; the harness commit holds 4 harness files, `batch-36-report.md` and 28 `current-orchestration-*` captures (byte-level re-renders; no UI change in the harness commit) |
| 36b (Gate V 36 fixes) | 21e29b3e7 (`fix(core)`) + 3dcf61755 (`fix(ui)`) + 81940b389 (`fix(chat)`) + 707a153e0 (`test(webview-e2e-harness)`, harness + 52 captures) + 8fb6dfe25 (`docs(task-specs)`, task.md + Gate V 36 reviews) | chat, core, ui, harness and webview typecheck,lint exit 0 (run 1 `%TEMP%\b36b-tl-tl.log` crashed 0xC0000409 before any target; re-run `%TEMP%\b36b-tl-tl2.log` 10/10 tasks green, no passthrough); test `-- --maxWorkers=2` exit 0 (core **1112/1112**, ui **629/629**, webview **224/224**, chat **2283 passed + 2 skipped**; `%TEMP%\b36b-tl-test.log`); webview build **3.46 MB** (`%TEMP%\b36b-tl-build.log`); **Gate G 27/27** (`--repeat-each=3`, `%TEMP%\b36b-gateg.log`) and 9/9 (`%TEMP%\b36b-tl-gateG.log`); full settings folder `--workers=2` **72 passed / 2 skipped (the existing main-model deep-link `test.fixme`, `settings-providers.e2e.spec.ts:124`) / 0 failed** (`%TEMP%\b36b-folder.log`; the first folder run `%TEMP%\b36b-tl-folder.log` was interrupted by the agent limit, not a failure). No `baseline-*` modified | Gate V 36 re-checks: `gate-v36-code-logic-review-29-32.md` APPROVED WITH NOTES 8/10, `gate-v36-code-logic-review-33-36.md` APPROVED WITH NOTES 8.5/10, both by **same-side** code-logic-reviewer subagents (no CLI lane; antigravity out of quota), disclosed in the commit bodies. Visual re-check of `visual-review-gate-v36.md` pending | Captures (orchestrator decision): kept the 44 `current-orchestration-*` and the 8 `current-drawer-{moonshot,sovereigneg}-models-*` (36b pill text to base-content, deviation 6). Restored 17 side-effect captures with `git restore -- <path>`: 15 differed only by 1/255 encoding noise; `current-providers-{electron,vscode}-anubis-light` held a hover state on the card's Retry from the pointer position (Batch 36c f). Re-check notes → Batch 36c |
| 36c (Gate V 36 re-check notes, tasks a-j) | 2d4793b7f (`fix(chat)`) + 2bdae1006 (`test(webview-e2e-harness)`, 3 specs + 40 captures) + 493baad02 (`docs(task-specs)`, visual Re-check 1 + `screenshots/gate-v36r1/`) | Round 1: chat, core, ui, harness and webview typecheck,lint exit 0; test exit 0 (4 projects, core/ui/chat from cache on the owner's identical inputs); build 3.46 MB; Gate G 9/9; folder 75 passed / 2 skipped / **1 failed** (`settings-providers.e2e.spec.ts:153` `[id="null"]`, reproduced 5/6 with `--repeat-each=3`) → task j. Round 2: harness typecheck,lint exit 0; Gate G 9/9 (`%TEMP%\b36c-r2-gateG.log`); folder 75 passed / 2 skipped (fixme) / 1 worker crash 0xC0000409 (`settings-orchestration.e2e.spec.ts:209` electron, no assertion; `%TEMP%\b36c-r2-folder.log`); j scene `--repeat-each=3` one more such crash; both tests then `--repeat-each=3` **6/6** (`%TEMP%\b36c-r3-*.log`) | Same-side: code notes from code-logic-reviewer re-checks, visual Re-check 1 by a visual-reviewer subagent; orchestrator accepted the task i captures on the 8x crops. Visual Re-check 2 pending | Captures: 40 `current-orchestration-*` kept; non-orchestration captures (22 in round 1, 18 in round 2) had 0 visible pixels and were restored by exact path; no `baseline-*` |
| 36d (Gate V 36 visual re-check 2 N3) | e4b2cf311 (`fix(chat)`) + 8716cd046 (`test(webview-e2e-harness)`, 2 files + 8 captures) + ef3dec4df (`docs(task-specs)`, visual Re-check 2 + `screenshots/gate-v36r2/`) | chat, core, ui, harness and webview typecheck,lint exit 0 (`%TEMP%\b36d-tl-tl.log`); test exit 0 (4 projects, core/ui/chat from cache on the owner's identical inputs; `%TEMP%\b36d-tl-test.log`); build 3.46 MB; Gate G 9/9 (`%TEMP%\b36d-tl-gateG.log`); full settings folder (`%TEMP%\b36d-folder.log`) 78 passed / 2 skipped (fixme) / 2 failed = both reachability runs (`settings-reachability.e2e.spec.ts:66`, vscode and electron) on an external font fetch in `csp-stub.ts:40` (`fonts.gstatic.com` Inter woff2: `route.fetch` 10 s timeout / `ECONNRESET`), no assertion. Not reproduced: Gate G `--repeat-each=3` **27/27** (`%TEMP%\b36d-gateG-r3.log`) | Same-side: visual Re-check 2 PASS WITH NOTES 8/10 (visual-reviewer subagent). Closes Gate V 36 with the two code re-checks (8/10, 8.5/10) | Captures: 8 `current-orchestration-*` kept (4 Cursor popover with the aria-disabled Save look; 4 with 0 visible pixels, kept by the orchestration rule); 22 others had 0 visible pixels and were restored by exact path; no `baseline-*`. Follow-up: the external font fetch in `csp-stub.ts` can fail a gate run on network trouble |
| Merge track B | 31337c533 (merge of 74c2dfda5 into ef3dec4df) | chat, core, ui, harness, webview and ptah-electron-e2e typecheck,lint exit 0 (`%TEMP%\bmerge-tl.log`); test exit 0 (`%TEMP%\bmerge-test.log`); build **3.32 MB** (`%TEMP%\bmerge-build.log`); Gate G 9/9 (`%TEMP%\bmerge-gateG.log`, 141 capabilities); full settings folder **88 passed / 2 skipped (fixme) / 0 failed** incl. Advanced / Search & Voice scenes (`%TEMP%\bmerge-folder.log`) | Conflicts resolved by the team-leader (4 files, see the merge section); no separate review | 7 Advanced captures kept (settled focus/shadow), 34 restored; follow-ups → Batch 51 |
| 51 | a93b37656 (`fix(webview)`) + af8f23c3a (`fix(chat)`) + 68dc462cb (`test(webview-e2e-harness)`, harness + fonts + 30 captures) | chat, core, ui, harness and webview typecheck,lint exit 0 (`%TEMP%\b51-tl.log`); test exit 0 (4 projects, all from cache on the owner's identical inputs; `%TEMP%\b51-test.log`); build **3.32 MB**; Gate G 9/9 (`%TEMP%\b51-gateG.log`); full settings folder **88 passed / 2 skipped (fixme) / 0 failed** (`%TEMP%\b51-folder.log`) | No separate code review; orchestrator accepted report and captures | Captures: the 30 accepted ones committed from the pre-run backup (`%TEMP%\b51-accepted`, 0 visible pixels vs the new run); 106 others had no visible change vs HEAD and were restored by exact path; no `baseline-*`. Note: the table-header rule is app-wide (see Batch 51) |
| 37 | 308259146 (`test(webview-e2e-harness)`) + d9a92315f (`test(e2e)`) + bd2e1ee16 (`test(chat)`) + ebf297a24 (`test(core)`) + 581a557fe (`test(ui)`) + cee84bfa1 (`docs(docs)`, SCREENSHOTS.md) + 520d88c34 (`docs(task-specs)`) | Executor (wide command, `%TEMP%\b37-*.log`): typecheck,lint 20 projects pass after its fixes; test 56/58 then chat re-run 2631 passed; the remaining failure is rpc-handlers `harness-skill-selection-rpc.service.spec.ts` "never writes state.json", **environment cause** (`%TEMP%\.ptah\harness` marker; follow-up 8). Live Electron: docs shot 3 passed, settings spec 3 passed, settings tour 1 passed (profile copies). Team-leader re-run: typecheck,lint exit 0 for chat, core, ui, harness, ptah-electron-e2e (`%TEMP%\b37-tl-tl.log`); chat/core/ui test exit 0 (from cache on the executor's inputs); thoth scene `--repeat-each=3` 3/3; Gate G 9/9; full settings folder 87 passed / 2 skipped (fixme) / 1 failed = `route.fetch: read ECONNRESET` from the local fixture server (`127.0.0.1`, csp-stub, electron reachability ADV-2), no assertion; Gate G `--repeat-each=3` **27/27** (`%TEMP%\b37-tl-gateG-r3.log`). Webview build unchanged (no product code in this batch) | No separate code review; orchestrator accepted the report | Captures: all 120 rewritten had no visible change and were restored; no `baseline-*`. Docs PNGs not committed (Batch 52). Follow-ups 7-9 recorded |
| 52 | c5f078f04 (`fix(cli-agent-runtime)`) + 1a1d1b2f7 (`fix(chat)`) + 9790b2ee0 (`test(webview-e2e-harness)`, 4 files + 100 captures) + 2c3b01e84 (`docs(docs)`, 2 docs PNGs) + b45a7ca46 (`docs(task-specs)`, report) | chat, core, ui, harness, webview and cli-agent-runtime typecheck,lint exit 0 (`%TEMP%\b52-tl-tl.log`); test exit 0 (5 projects, from cache on the owner's identical inputs; `%TEMP%\b52-tl-test.log`); build **3.32 MB**; Gate G 9/9 (`%TEMP%\b52-tl-gateG.log`); full settings folder 91 passed / 2 skipped (fixme) / **1 failed** = baseline smoke (vscode, anubis) `assertProvidersFold` `overflowAt800` 1 > 0 (`settings-visual.e2e.spec.ts:132`), same layout as passing runs (widths 269, 3 columns at 800); not reproduced: baseline smoke `--repeat-each=3` **12/12**, overflow 0 px (`%TEMP%\b52-tl-smoke-r3.log`). Suspected sub-pixel jitter during the 800 px resize; the margin is 0 px, worth a look in Batch 38 | No separate code review; orchestrator accepted captures and docs shots | Captures: the 100 accepted (92 + 8 new `current-live-*`) committed from the pre-run backup (`%TEMP%\b52-accepted`; the new run differed by 2 pixels on two live-orchestration captures); 31 others had no visible change vs HEAD and were restored; no `baseline-*`. Follow-up 10 (tasks UI raw version line) |
| 53 | 6362f8545 (`fix(ui)`) + 59ab01830 (`fix(chat)`) + bb057830c (`test(webview-e2e-harness)`, 3 files + 44 captures) + 23435a471 (`docs(docs)`, agents-orchestration.png) + eeaa94951 (`docs(task-specs)`, visual-review.md Batch 38 section, `screenshots/gate-v38/`, report) | Round 1: typecheck,lint 5 projects exit 0; test 4 projects exit 0 (cache); build 3.32 MB; Gate G 9/9; folder 93 passed / 2 skipped / 1 failed = baseline smoke 30 s timeout, reproduced 10/12 under 100 % CPU (other sessions) → task 53.6 (split). Round 2: harness typecheck,lint exit 0; Gate G 9/9; `settings-visual` `--repeat-each=3` **108/108**; full folder **122 passed / 2 skipped (fixme) / 0 failed** (`%TEMP%\b53-r2-*.log`) | Batch 38 visual review (same-side) PASS WITH NOTES 8/10 raised B38-1..6; re-check pending | 44 accepted captures committed from backup; 56 restored (no visible change); no `baseline-*`. `settings.fixtures.ts` 706 lines. Follow-up 11 (B38-6) |
| 54 | 5d7e90ef7 (`fix(ui)`) + d8d7f29ac (`fix(webview)`) + f4fa997ed (`fix(chat)`) + d660b6a4d (`test(webview-e2e-harness)`) | Orchestrator run: typecheck,lint 5 projects exit 0 (`%TEMP%\b54-me-tl.log`); test chat, ui, webview exit 0 (`%TEMP%\b54-me-test.log`); build 3.32 MB; full settings folder 123 passed / 2 skipped (fixme) / 1 worker crash 0xC0000409 in `preferences.e2e.spec.ts:82` (`%TEMP%\b54-me-folder.log`); not reproduced: that spec + Gate G `--repeat-each=3` **42/42** (`%TEMP%\b54-me-r3.log`) | Batch 38 re-check 1 (same-side) found N1; final full review on the PR | 70 rewritten captures had <= 2 px noise vs HEAD and were restored; no `baseline-*` |
| 4 | 50c773767 | cli-agent-runtime typecheck/test/lint all green (the claude-approval flake passed this run) | subagent code-logic-reviewer (cross-side of Glm), APPROVED; it reproduced red before the fix (5/7 fail) and green after | BLOCKED check = not blocked: `package.json:252-267` contributes none of the four key families, and no writer targets VS Code config. Hand-edited uncontributed keys are no longer read (documented, pinned by spec). The moderate finding (only `codexModel` exercised through `resolveModel`) is **recorded, not fixed**. All six model keys share one `MODEL_CONFIG_KEYS` → `agentOrchestration.<key>` lookup (`service.ts:165-179`), and the plan asks for one regression spec. Batch 36's orchestration scene exercises model writes per CLI. If a later batch special-cases one CLI's model read, that batch adds a table-driven case. The reviewer used `git stash`; execution default 10 now forbids it |
| 39 | f316580ea (track B, `feat/task-555-advanced-search-voice`) | chat typecheck exit 0 (`--skip-nx-cache`, no passthrough, default 11); lint exit 0 (0 errors, 33 warnings; 3 in the batch's new specs: 2 `no-empty-function`, 1 unused `ComponentFixture` import in `search-voice-settings.component.spec.ts:2`); test `-- --maxWorkers=2` exit 0, chat **2099 passed + 2 skipped** (127 suites; 29: 2082 / 125); webview rebuilt (`--skip-nx-cache`), **no budget error** (initial 3.48 MB, 980.01 kB over the warning budget, +1.37 kB against 29, ~20 kB under the 3.5 MB error budget); **Gate G 9/9** in the track B worktree (`--reporter=list`, clean, 2.1 m; no failure, so no repeat run); logs `/tmp/b39-{test,build,gateG}.log` | **no per-batch code review** (user decision 2026-09-30); author opencode lane (kimi-k2.7-code) | Checked on disk: `saveGeneric` (`settings-save-feedback.service.ts`) takes label / write / optional undo, toasts "Saved {label}." with no scope words, never "Saved" on `ok:false` or a throw, and `saving` covers both the Providers commit and `genericSaving` (D3); `undo()` dispatches by `'scope' in request`, Providers `save()` body unchanged. Shells `advanced-settings.component.ts` (138 lines) and `search-voice-settings.component.ts` (32) mount the existing children in the old order; Export/Import moved verbatim with `aria-label="Export settings"` / `"Import settings"`; voice and go-vet stay Electron-only; `(modelChanged)` still re-detects CLIs. Tab ids `pro-features` / `tools` unchanged. Out-of-list: unused `SettingsComponent.openPricing` and `ClaudeRpcService` injection removed (license card and builders card keep their own). Committed: 8 source/spec paths + `batch-39-report.md`, by explicit path; tree clean after commit; no `current-*` capture refreshed (Gate V for these tabs is Batch 50). 8 paths in 1 lib, over the 6-file cap by the 3 specs, accepted |
| 40 | 0e5cb4d38 (track B, `feat/task-555-advanced-search-voice`) | One whole-tree run with Batch 45: typecheck,lint exit 0 for chat, core, ui, webview-e2e-harness, webview (no passthrough; chat lint 0 errors, 30 warnings, none in batch files); test `-- --maxWorkers=2` exit 0, chat `--skip-nx-cache` **2136 passed + 2 skipped** (129 suites; 39: 2099 / 127); webview rebuilt (`--skip-nx-cache`), **no budget error** (initial 3.49 MB, 994.88 kB over the warning budget, **+14.87 kB against 39** for 40 and 45 together, ~5 kB under the 3.5 MB error budget); **Gate G 9/9** (`--reporter=list`, 2.5 m, no failure, no repeat); logs `/tmp/b40-45-{test,chattest,build,gateG}.log` | **no per-batch code review** (user decision 2026-09-30); author Glm lane | Checked on disk (D15): `submitLicenseKey` shows "Membership activated" only on `isSuccess() && data.success`; `confirmLogout` keeps the confirm open with an inline `role="alert"` on failure; `importSettings` sets the outcome only from the write's own result. **Deviation for Gate V 50:** Import and Log out failures are inline alerts, not alert toasts (`saveGeneric` has no alert-only entry; VS Code cancel is indistinguishable from success). Export failure still has no feedback (pre-existing, unchanged). The shared `advanced-settings.component.spec.ts` also carries the opencode lane's Batch 39 lint fix (noted in the commit body). Standalone Data Portability card folded into the membership card |
| 45 | 40f4bc821 (track B) | Same whole-tree run as Batch 40 (committed after it, tree clean afterwards) | **no per-batch code review**; author opencode lane (kimi-k2.7-code), completed by an in-process frontend-developer (lane failed: Unknown error) | Checked on disk (D15): `writeProviders` / `writeMaxResults` / `writeKey` / `removeKey` return ok only on `isSuccess() && data.success`, and providers and max results restore the fallback on failure; the checkbox and slider DOM are set back after a refused save; the key popover closes only on success and clears the typed key on every dismissal. Carries the Batch 39 lint fixes in `settings-save-feedback.service.spec.ts` and `search-voice-settings.component.spec.ts`. For Gate V 50: clear toast reads "Saved removal of the {Provider} API key." (no verb option in `saveGeneric`); the fold check was not measured |
| 41 | 81caf233a (track B) | Whole tree with Batch 46 (from the commit body): affected typecheck green (10 projects); lint green (chat 0 errors, 30 warnings); test green (chat 2165 passed + 2 skipped, 131 suites); webview build no budget error; **Gate G 9/9** | **no per-batch code review**; author Glm lane (usage limit), completed by an in-process frontend-developer (Advanced owner). Round 1 was rejected by the team-leader D15 spot-check and reworked | Bundle: Advanced and Search & Voice tabs in `@defer (on immediate)`, 10 child re-exports dropped from the settings barrel; initial 3.47 → 3.33 MB with 46. For Gate V 50: effort cell disabled while Ultracode is on; `UltracodeStateService` returns `Promise<boolean>`. Its host-error-text defect (load alerts / save toasts) was found in round-1 verification and fixed inside Batch 42 (c0877c675) |
| 46 | 795fb435a (track B) | Same whole-tree run as Batch 41 (typecheck, lint, test green; webview initial 3.33 MB; Gate G 9/9) | **no per-batch code review**; author in-process frontend-developer (Search & Voice owner) | Drawer mounts in voice-config (Gate V 50 deviation). Its leftover host error text in `voice-config.component.ts` (`errorText`, `result.error`, `data.error`) was found in round-1 verification of 42/43/47/48 and is being fixed by the 48 owner; `voice-config.component.ts` + spec go into the Batch 48 commit |
| 42 | c0877c675 (track B) | **Round-1 whole-tree verification of 42, 43, 47, 48** (after the owners' revise rounds; logs `%TEMP%\bB1-tl-r2-*.log`): typecheck,lint exit 0 for chat, core, ui, webview-e2e-harness, webview (no passthrough); chat settings eslint 0 errors, 1 warning (pre-existing wizard max-lines); test `--skip-nx-cache -- --maxWorkers=2` exit 0, direct chat jest **2268 passed + 2 skipped** (131 suites); webview rebuilt (`--skip-nx-cache`), **no budget error** (initial 3.33 MB); **Gate G 9/9** (`--reporter=list --workers=2`, 2.1 m, clean, no repeat). First verification run (before revisions): same results except chat jest 2258 passed, 1 failed = the known `cli-agent-output.component.spec.ts` 5 s load timeout (17/17 alone). Main.js check (HANDOFF open item) **confirmed**: license-status-card, web-search-config, voice-config, go-vet, local-stt/tts and elevenlabs panels are in lazy chunks, none in the initial list; enhanced-prompts-config absent. Captures: 28 `current-advanced*`, `current-search-voice*`, `current-voice-drawer-*`, `current-go-vet-*` from a deleted scratch spec (one capture re-taken after a `page.goto` 15 s timeout under load); not staged; orchestrator capture check PASSED (V1-V7 fixed); 0 `baseline-*` modified | **no per-batch code review**; author antigravity CLI lane (+ revise rounds 1-2 by the same lane) | Checked on disk: D14 (no `enhanced-prompts-config` reference left in libs/apps), no mojibake/BOM/CRLF, no new `as any`/`@ts-ignore`, drawer in `@defer (when drawerOpen())`, no barrel change, fixed failure sentences only (cancel = no alert). **Folded in:** the Batch 41 host-text fix in `agent-behaviour-section.component.ts` (`errorText` removed). Report committed (39/40/45 precedent) |
| 43 | 4a4bc3df4 (track B) | Same round-1 verification as Batch 42 | **no per-batch code review**; author antigravity CLI lane (+ revise round 1) | New `output-style-parity-section.component.ts` (extracted; list now 573 counted lines, was exactly 700 before the extraction). Round-1 lint finding (2 unused `error` catch bindings) fixed with bare `catch {}`. Parity confirm/cancel covered by `output-style-list.component.spec.ts:139, :165`. **Gate V 50 note:** no spec pins "a parity selection has no Undo" (`output-style-config.component.ts`, `undo: null` when parity is on). Accepted pre-existing parse-error text (user's own file). Report committed |
| 47 | bd4c5c6a3 (track B) | Same round-1 verification as Batch 42 | **no per-batch code review**; author Glm CLI lane; revise round 1 finished in-process after the Glm Ollama weekly limit (**same-side** for that part) | Fixed failure sentences in all paths (save, download, load voices, preview). For Gate V 50: voice-only TTS payload; Curated click on an already-Curated backend makes no write. Report committed |
| 40b | 011961e9e (track B) | **One whole-tree verification of 40b, 43b, 45b, 48** (logs `%TEMP%\bB1-tl-r3-*.log`): chat typecheck,lint exit 0 (`--skip-nx-cache`); chat settings eslint 0 errors, 1 warning (pre-existing wizard max-lines); direct chat jest **2298 passed + 2 skipped** (131 suites, 0 failed); webview rebuilt (`--skip-nx-cache`), **no budget error** (initial 3.33 MB, main.js 1.48 MB); **Gate G 9/9** (`--reporter=list --workers=2`, 2.1 m, clean, no repeat); `current-search-voice-*` (both hosts) and `current-go-vet-electron-*` re-taken with a deleted scratch spec (4/4), not staged; 0 `baseline-*` modified. Checked on disk: no mojibake/BOM/CRLF in any of the 17 files (the owner's CRLF-converted spec is LF; numstat equals the CR-insensitive numstat, so no line-ending churn), no new `as any`/`@ts-ignore`/`eslint-disable`; no host text reaches a template in these files (`output-style.store.ts` messages land in `store.error`, rendered only through `fixedErrorMessage`, or are the audited fixed backend codes) | **no per-batch code review**; in-process frontend-developer (same-side); base 40 author Glm lane | Fixed sentences for key activation / log out (14 → 17 specs). Report committed |
| 43b | 1de289ccd (track B) | Same verification as 40b | **no per-batch code review**; in-process (same-side); base 43 author antigravity lane | `SETTINGS_MALFORMED` parity warning no longer carries the JSON parser text; fixed codes pass through; others get the fixed fallback (20 → 22 specs). Report committed |
| 45b | 0947cea9e (track B) | Same verification as 40b | **no per-batch code review**; in-process (same-side); base 45 author opencode lane + in-process | Fixed sentences for web search; failed test rows show "The connection check failed." (18 → 36 specs). **Open from its host-text scan (needs an owner):** `advanced-settings.component.ts:221, :234, :242-243` Import outcome (Batch 39/40 code, visible); `ptah-ai/agent-orchestration-config.component.ts:404, :617` (visible); `pro-features/mcp-port-config.component.ts:251-253` (Batch 44 owns it). Report (with the scan) committed |
| 48 | df3cf51a5 (track B) | Same verification as 40b (round-1 verification of 42/43/47/48 also covered this batch before the revisions) | **no per-batch code review**; in-process frontend-developer (Search & Voice owner), **same-side** (Glm out of quota) | Includes `voice-config.component.ts` + spec (Batch 46 file): ElevenLabs voice name in the Model / Voice cell (one `voice:listVoices` per tab visit, "Custom voice" + id tooltip fallback) and the round-1 host-text finding fixed with fixed sentences. New `elevenlabs-select-rows.ts` (700-line cap, accepted). go vet control is a daisyUI toggle with `role="switch"`. Orchestrator capture check passed for round 1; the re-taken `current-go-vet-*` / `current-search-voice-*` are for the orchestrator's last look. Report committed |
| 44 | 3286a18ec (track B) | After revise round 1 (logs `%TEMP%\bB1-tl-b44r-*.log`): typecheck,lint exit 0 for chat, core, ui, webview-e2e-harness, webview (`--skip-nx-cache`, no passthrough); `nx lint ptah-electron-e2e` exit 0 (the batch touched the app: comment-only edit in `workspace-settings.shot.ts`; its 15 warnings are pre-existing, none in that file); chat settings eslint 0 errors, 1 warning (pre-existing wizard max-lines; the round-1 spec warnings `any[]` / unused `params` are fixed); direct chat jest **2319 passed + 2 skipped** (133 suites); targeted suites 32 = mcp-port-config 11 + vscode-lm-config 8 + advanced-settings 13; webview rebuilt (`--skip-nx-cache`), **no budget error** (initial 3.33 MB, main.js 1.48 MB); **Gate G record (default 7):** run 1 8 passed / 1 failed, `reachability (vscode) › every present/restored capability is reachable` at **0 ms** with `worker process exited unexpectedly (code=3221226505)` (Windows 0xC0000409; no test body ran, so no stack frame; log `bB1-tl-b44r-gateG.log`); suspected cause: known Chromium/Playwright worker crash under load (track A building), not the page; **`--repeat-each=3 --workers=2`: 27/27** (6.3 m, `bB1-tl-b44r-gateG-repeat3.log`). Captures `current-advanced-mcp-*`, `current-advanced-mcp-localhost-confirm-*` re-taken (4/4; the spec also asserts the checkbox stays unticked while the confirm is open), and first-round `current-advanced-vscode-lm-*`; deleted scratch spec; not staged; 0 `baseline-*` modified | **no per-batch code review**; author antigravity CLI lane (+ revise round 1, same lane) | Checked on disk: D14 (no code reference to `browser-settings` / `ptah-browser-settings` in libs/apps, comments only; `apps/ptah-docs/SCREENSHOTS.md:119, :189` rows left for the Batch 37 docs pass), no mojibake/BOM/CRLF, no new `any`/`@ts-ignore`. **Host-text fixes folded in:** `mcp-port-config` (fixed sentences) and the `advanced-settings` Import outcome (the joined backend `key: ${error.message}` list → "Some settings could not be imported."). D15: `mcp-port-config` writes strict `isSuccess() && data.success === true` (missing flag = failure, spec-pinned); VS Code LM writes go through `LlmProviderStateService.setDefaultModel/Provider` (`isSuccess() && data?.success`, falsy = failure). The R1/R3/R5 specs exist and run, written as rewritten tests, not added ones (`mcp-port-config.component.spec.ts:188, :297`; `advanced-settings.component.spec.ts:134-142`), so the count stays 32. VS Code LM card renders in both hosts in the harness (fixture-driven; no host condition in `advanced-settings.component.ts:141`). Copy: toast "Saved MCP port." + persistent row hint "Changes apply after the MCP server restarts." Report committed. Still open from the 45b scan: `ptah-ai/agent-orchestration-config.component.ts:404, :617` |
| 49b | 4fad78694 (track B; committed before 49) | **One whole-tree verification of 49b + 49** (logs `%TEMP%\bB1-tl-b49-*.log`): typecheck,lint exit 0 for chat, core, ui, webview-e2e-harness, webview (`--skip-nx-cache`, no passthrough); eslint over chat settings + harness `src`: 0 errors, 43 warnings, none new in batch files except the existing `settings-reachability.table.ts` max-lines (716 → 719 counted; still the only harness max-lines warning in `scenarios/settings`, count not grown); direct chat jest **2327 passed + 2 skipped** (133 suites); webview rebuilt (`--skip-nx-cache`), **no budget error** (initial 3.33 MB, main.js 1.48 MB); **Gate G 9/9** with 137 entries (`--reporter=list --workers=2`, 5.4 m under track A load, clean, no repeat); **new scene spec `settings-advanced-search-voice.e2e.spec.ts` 8/8** (`--workers=2`, 1.0 m: captures + fold, Esc/focus, D15, both hosts); 0 `baseline-*` modified | **no per-batch code review**; started by the antigravity lane (partial toast edit, replaced), finished in-process (**same-side**) | Checked on disk: no host text, no mojibake/BOM/CRLF, no new `any`/`@ts-ignore`; output-style-list 694 raw / 590 counted. **Rule deviation recorded (commit body):** the owner ran `git checkout --` once on `settings-toast.component.spec.ts` (a file this batch owns) to restore the lane's partial spec before rewriting it; nothing staged, stashed or lost. Toast lift is pure CSS, verified in the built `styles.css` by the owner. Out of scope: web-search and go vet confirms handle Esc without stopPropagation (not inside a drawer). Report committed |
| 49 | d0b6c6f39 (track B) | Same verification as 49b | **no per-batch code review**; in-process frontend-developer (Advanced/Search owner), **same-side** | 43 entries ADV-1..24 / SV-1..19 in new entries files; `EXPECTED_CAPABILITY_COUNT` 94 → 137; `BASELINE_PRESENT_IDS` untouched; new fixtures / reach / scene spec files; additive `rpcError()` in `marketplace.fixtures.ts`; reachability per-host timeout 180 s → 600 s (accepted by the orchestrator: 137 entries under load). **Search & Voice fold logged, not enforced** (`SEARCH_VOICE_FOLD_ENFORCED = false`; provider rows 57-63 px, Electron voice rows end at 686 px) → the Batch 50 density fix turns it on; Advanced fold enforced and green. **Single-writer note (commit body):** the owner built and ran Playwright in track B with the orchestrator's permission; the team-leader re-ran every check at commit time. **Committed with the batch: the 40 `current-*` tab gate captures** (8 names × 2 hosts × 2 themes + 4 Electron-only names × 2 themes; 28/30 precedent), re-written by the team-leader's own scene run. Showcase `settings-tour.scene.ts` step 7 silent skip (pre-existing since `41b85393c`) → Task 37.1. Report committed |
| 50a | e2032e30a (track B) | Logs `%TEMP%\bB1-tl-b50a-*.log`: typecheck,lint exit 0 for chat, core, ui, webview-e2e-harness, webview (`--skip-nx-cache`, no passthrough); eslint on the 3 touched files 0 errors, 0 warnings; direct chat jest **2329 passed + 2 skipped** (133 suites); webview rebuilt (`--skip-nx-cache`), **no budget error** (initial 3.33 MB, main.js 1.48 MB); **Gate G 9/9** (`--reporter=list --workers=2`, 2.2 m, clean, no repeat); **scene spec 8/8 with the Search & Voice fold enforced** (logged: provider rows 41/41/41 in every run; web search bottom 383 VS Code / 439 Electron; Electron voice rows 626); 0 `baseline-*` modified | **no per-batch code review** (combined review at Gate V 50); in-process frontend-developer, **same-side** | Checked on disk: no host text, no mojibake/BOM/CRLF, no new `any`; web-search-config 552 counted lines. Captures: the team-leader's verification run re-took the 40 names; the 12 that differ from Batch 49 are committed (the owner's run had 15; 3 came back byte-identical). Orchestrator capture check PASSED. Batch 50 stays IN_PROGRESS until Gate V 50 and the combined 39-50 code review accept. Report committed |
| 50b | 7e70f3a80 (code) + 74fcf5a42 (`docs(task-specs)` reviews) (track B) | Round 1 (logs `%TEMP%\bB1-tl-b50b-*.log`): typecheck,lint exit 0 for chat, core, ui, webview-e2e-harness, webview (`--skip-nx-cache`, no passthrough); chat jest 2399 + 2 skipped; webview 3.33 MB; **Gate G 9/9** (`--workers=2`, 1.8 m); scene spec 24/24 (`--repeat-each=3`). The team-leader found 11 remaining 10-11 px helper-text lines in stream B + license (fixed by the owner). Round 2 after that revise (logs `bB1-tl-b50b2-*.log`): chat typecheck,lint exit 0; chat settings eslint 0 errors, 1 warning (pre-existing wizard max-lines); direct chat jest **2404 passed + 2 skipped** (134 suites); webview rebuilt (`--skip-nx-cache`), **no budget error** (initial 3.33 MB, main.js 1.48 MB); **scene spec 24/24** (`--repeat-each=3 --workers=2`, fold enforced for both tabs: Advanced behaviour card ends at 419 VS Code / 483 Electron, rows 43/41/41/41; Search & Voice web search ends at 382 / 438, provider rows 41, Electron voice rows end at 625; identical in all repeats); Gate G not re-run after the text-size-only revise (orchestrator: only if the scene spec showed anything unexpected; it did not); 0 `baseline-*` modified | Reviews: antigravity lane (lanes review, APPROVED WITH NOTES 8/10) and code-logic-reviewer subagent (42-44, NEEDS_REVISION 6/10), both cross-side; visual-reviewer subagent **same-side, disclosed** (FAIL 6/10); authors in-process (**same-side**) | Checked on disk: no host text rendered; colour classes only on `aria-hidden` icons; no 10-11 px text except the six effort popover buttons (labels, kept); no mojibake/BOM/CRLF in 32 files; no new `any`; largest non-spec file 648 counted lines. Committed: 26 modified chat files + the new `output-style-config.component.spec.ts`, both 50b reports and the 40 re-taken tab captures (69 paths); then the three review files + 14 `gate-v50-*.png` evidence (17 paths). User decisions 2026-10-02 applied (neutral Clear, one-line behaviour rows). Orchestrator capture check PASSED. **Batch 50 stays IN_PROGRESS until the reviewers re-check** |
| 50c | 0405b2162 (code) + 74c2dfda5 (`docs(task-specs)` re-check sections) (track B) | Logs `%TEMP%\bB1-tl-b50c-*.log`: typecheck,lint exit 0 for chat, core, ui, webview-e2e-harness, webview (`--skip-nx-cache`, no passthrough); chat settings eslint 0 errors, 1 warning (pre-existing wizard max-lines); direct chat jest **2419 passed + 2 skipped** (134 suites); webview rebuilt (`--skip-nx-cache`), **no budget error** (initial 3.33 MB, main.js 1.48 MB); **Gate G 9/9** (`--reporter=list --workers=2`, 2.3 m, clean, no repeat); **scene spec 24/24** (`--repeat-each=3 --workers=2`; fold enforced for both tabs, identical in all repeats: Advanced behaviour card ends at 419 VS Code / 483 Electron, rows 43/41/41/41; Search & Voice web search ends at 382 / 438, provider rows 41, Electron voice rows end at 625); 0 `baseline-*` modified | Re-check of 7e70f3a80: lanes **APPROVED 10/10** (antigravity, cross-side); 42-44 **APPROVED WITH NOTES 8/10** (code-logic-reviewer subagent, cross-side); visual **PASS WITH NOTES 8/10** (visual-reviewer, **same-side, disclosed**). 50c author in-process (**same-side**) | Checked on disk: no host text rendered, no 10-11 px text added, no mojibake/BOM/CRLF in the 23 files, no new `any`; largest non-spec file 662 counted lines (output-style-list). Committed: 20 chat files + report + the 15 tab captures that changed (36 paths); then the three review files' re-check sections + 20 `gate-v50r1-*.png` evidence (23 paths). **Gate V 50 passed → Batch 50 and Task 50.1 COMPLETE.** Accepted items and follow-ups are listed in the Batch 50 section |

Known failures that do not block a batch (anything not on this list is a blocker):

- `libs/backend/rpc-handlers/src/lib/harness/selection/harness-skill-selection-rpc.service.spec.ts` ("never writes
  state.json"): pre-existing on the untouched base commit and outside this task. It does not block rpc-handlers
  batches.
- Load-sensitive timeouts that pass when run alone. The team-leader re-runs each alone before accepting it, and
  records the run above:
  - `cli-agent-runtime`: `capabilities/claude-approval.reader.spec.ts` (real git, 5 s jest timeout)
  - `platform-electron`: `workspace-watch/workspace-watch-host.{entry,stress}.spec.ts` (needs
    `npx nx run ptah-electron:build-workspace-watch-host`)
  - `rpc-handlers`: `voice-rpc.handlers.spec.ts:284` and the file-view spec
  - `vscode-core`: `services/git-info.service.review.spec.ts` (real git; 2/2 alone during the Batch 7 verification)

Scope watch (resolved): the deletion of the hollow `HARNESS\provider-settings.e2e.spec.ts` **moved from Batch 37 to
Batch 16**, committed in 72ab2f4be. Both Batch 16 reviews confirmed it asserted nothing real. Task 37.1 no longer
deletes it; it only verifies that the file is gone.

Stray files not owned by any batch (never stage them; the orchestrator removes them):
- `.ptah\specs\TASK_2026_555\_old-facade-batch9.ts`
- `apps\ptah-electron\src\windows\.shell-security-j54EAW\` (a test temp dir)

## Follow-ups outside this task (for the final report; some need a user decision)

1. **RPC dispatcher forwards raw error text for handlers that rethrow. Needs a user decision.**
   - Where: `ROOT\libs\backend\vscode-core\src\messaging\rpc-handler.ts:241-252` returns `errorObj.message` for
     any non-`RpcUserError` exception. Examples: `ptahCli:list` (`ptah-cli-rpc.handlers.ts:122`) and
     `auth:testConnection` (`auth-rpc.handlers.ts:1091`); `ptah-cli-rpc.handlers.spec.ts:160-174` asserts the raw
     text.
   - Options (from `batch-12b-code-logic-review.md`, "Analysis of Open Item"):
     - **Option 1, per handler.** Catch in `ptahCli:list` (return `{agents: [], error: 'Could not load CLI agents.'}`)
       and in `auth:testConnection` (fixed `errorMessage`). Tailored copy, no risk to other RPCs. It is whack-a-mole:
       any future handler without a catch leaks again.
     - **Option 2, in the dispatcher.** Treat `RpcUserError` (already handled at `:229-239`) as public, and return a
       fixed fallback such as "An unexpected error occurred." (or `sanitizeErrorMessage`) for every other exception.
       This is a repo-wide guarantee. It is a breaking change for every spec that asserts an exact exception message,
       so it needs its own migration batch and touches every RPC. It is out of this task's scope.
     - **Reviewer recommendation:** Option 1 now for the two Settings RPCs, as a follow-up batch; Option 2 on the
       platform roadmap.
   - The team-leader adds no batch until the user decides.
2. **Raw error text in non-Settings RPCs:** `agent:permissionResponse` (`agent-rpc.handlers.ts:638`, `:745`),
   `agent:stop` (`:775`), `agent:resumeCliSession` (`:898`). This goes away with option 2 above, or with a
   per-handler pass.
3. **`auth:setApiKey` clear-failure copy (Batch 12b MOD-1):** use "Could not delete the stored key." when the key is
   empty.
4. **Batch 1 open defects:** M1 (a double failure on one key keeps the first write's unsaved value,
   `file-settings-manager.ts:122-147`) and the benign ENOENT sweep warning (`:553-558`).
5. **Spec type-check gap:** chat/core/ui specs under `tsconfig.spec.json` are not gated (Task 37.4).
6. **Batch 16 harness items:** NW-1/2/3 and the error envelope (Task 37.3). These are inside this task, listed here
   for completeness.
7. **Secret writes end running chat sessions (user decision, final report):** `write-path-trace.md` §5. `ConfigWatcher`
   (`config-watcher.ts:57-71`, started at `agent-sdk/.../di/register.ts:633`) ends every live session on any
   `ptah.auth.*` secret write (Replace key, Delete key, Cursor credential, Ptah instance key) without a confirm;
   `auth:copilotLogin` (`auth-rpc.handlers.ts:1233`) and `auth:codexLogin` (`:1586`) reset the SDK directly.
   Pre-existing: `ConfigWatcher` is unchanged in this task. Read from code, no live run.
8. **Test isolation, rpc-handlers (environment cause):** `harness-skill-selection-rpc.service.spec.ts` "never writes
   state.json" fails on this machine because `C:\Users\abdal\AppData\Local\Temp\.ptah\harness` exists and
   `resolveHarnessWorkspaceRoot` walks up from the mkdtemp workspace and stops at that `.ptah` marker (the spec does not
   pass `homeDir` / isolate the marker). Lib unchanged vs `main`. Follow-up: isolate the spec. The folder is not
   deleted (needs the user's OK).
9. **Stray marketplace captures:** the Batch 37 marketplace run wrote 62 untracked PNGs into
   `.ptah/specs/TASK_2026_533_marketplace_redesign/screenshots/angular/` (`marketplace-visual.e2e.spec.ts`). Not this
   task's; not staged, not deleted.
10. **Tasks UI shows the raw CLI version line:** `tasks-ui/.../task-agent-discovery.service.ts:69-70` builds "Run
    through {cli} {version}." from the raw `--version` line ("Run through codex codex-cli 0.155.1."). It could reuse
    the Batch 52.1 normaliser (`cliVersionLabel`). Owner: tasks UI.
11. **B38-6, Electron shell sidebar contrast (outside Settings):** active workspace name 2.96:1 (`#2563eb` on
    `#242430`, dark); "Hide Workspaces" rail label 3.45:1 (dark) and 1.3:1 (light, `#44ebd3` on `#f3efec`). Evidence
    `screenshots/gate-v38/sweep-electron-*.json`. The Batch 51 "0 color-contrast" result holds inside `ptah-settings`
    only. Owner: shell.

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- D8 reader bug is real — **verified**: writer `agent-rpc.handlers.ts:1037-1043` uses `('ptah','agentOrchestration.<k>')`;
  reader `agent-spawn-environment.service.ts:124-176` uses section `'ptah.agentOrchestration'`; the file route applies only
  when `section === 'ptah'` (`vscode-workspace-provider.ts` getConfiguration). Keys are file-routed (`file-settings-keys.ts:162-171`).
- After D8, no user loses a value that exists only in VS Code config `ptah.agentOrchestration.*` — **unverified**; the existing
  migration moves stateStorage → file only (`agent-rpc.handlers.ts:~1080-1117`). Checked in Task 4.1.
- Electron secret delete works end to end — **partly verified**: `ElectronSecretStorage.delete` exists
  (`libs/backend/platform-electron/src/implementations/electron-secret-storage.ts:105-107`). Not yet verified: that the
  `EXTENSION_CONTEXT.secrets` shim (`apps/ptah-electron/src/di/phase-1-infra.ts`, Phase 1.5) routes to it, and that
  `AuthSecretsService.setCredential('apiKey','')` calls delete. Checked in Task 6.1 before Batch 7 may start.
- Frontend contracts the plan relies on — **verified**:
  - `ProvidersSettingsCommit` shape and statuses (`providers-settings-state.service.ts:56-71`)
  - the `runCommit` early return (`:1022`)
  - `AppStateService.requestSettingsTab` / `PendingSettingsTab` (`app-state.service.ts:145, 1340`)
  - `initialEditingConsumerId` (`provider-consumer-assignments.component.ts:477`)
  - `fixedProvider` (`provider-model-picker.component.ts:145`)
  - the interim deep-link target `#providers-cli-heading data-focus="cli-agents"` (`ptah-cli-config.component.ts:40-41`)
  - `NativeAutocompleteComponent` exists (`UI\autocomplete\`)
- `PtahCliConfigComponent` has no consumer outside Settings — **verified** by grep. Only `settings.component.*`,
  `providers-settings.component.ts`, `CHAT\index.ts` and the backend name collisions in `ptah-cli-registry.ts` match
  (a backend symbol, not the component).
- Nx project names in every verify command — **verified** from each `project.json`. `@ptah-extension/webview-e2e-harness`
  has no `test` target (run-many skips it), and `@ptah-extension/settings-core` has no `lint` target.
- Specs are exempt from `max-lines` (`eslint.config.mjs:505-519` ignores `**/*.spec.ts`) — **verified**. The 700-line
  budget applies to non-spec `.ts` only, and it is a warning, so reviewers enforce it, not lint.
- `ProviderSetupWizardComponent` (2390 lines) stays untouched — plan decision; checked by `git diff --stat` in every
  Providers batch.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Parallel batches share one working tree. Verify runs and the webview build can observe another batch's half-done edits, and `dist/` can race | HIGH | Execution default 4: file-disjoint batches only, serial commit-time re-verify, gate runs single-writer, and Batches 3 and 4 are not concurrent |
| Splitting S5/S6 re-creates the #575 "piecemeal" pattern (forensics §2.3) | HIGH | Execution defaults 2, 3 and 9: one owner per tab, every component mounted in the batch that builds it, reachability green on every commit, drift checkpoints at 24/31, full gate at 28/36 |
| A capability becomes unreachable between sub-batches (D14) | HIGH | Old surfaces are removed only in the batch that mounts their replacement: Batch 18 (move to Orchestration), Batch 24 (card actions → drawer; the drawer already exists from Batches 20-22), Batch 26 (old main-agent section → popover), Batch 34 (PtahCliConfig delete after matrix, cursor, modals and policy bar). Gate G on every commit |
| The state facade climbs back over 700 lines after S2c (Batches 12-13) | MEDIUM | Tasks 12.1/13.1 acceptance: counted lines < 700 for facade and collaborators. New logic lives in collaborators; the facade only delegates |
| `file-settings-manager.error-paths.spec.ts:121-137` "chain recovers" calls `await mgr.set('key','v1')` with a failing write; after 553 that rejects | MEDIUM | Task 1.1: change only that line to `await expect(...).rejects.toBeInstanceOf(SettingsPersistError)`, keep the recovery assertion, and list it in the report as a deliberate change |
| D15 changes TASK_2026_534 "saved after throw" assertions | MEDIUM | Task 8.1 lists every changed assertion by file:line; the reviewer checks that none other changed |
| D8 changes which store the spawn reader uses; hand-edited VS Code `ptah.agentOrchestration.*` values stop being read | MEDIUM | Task 4.1 checks `package.json` contributes and the settings-core migrations. If a user-writable VS Code path exists and is not migrated, the batch returns BLOCKED (no silent loss) |
| Ptah-instance **Edit (#50)** has no named component in the plan (the matrix Actions column lists it) | MEDIUM | Task 32.1: `AddCliInstanceModalComponent` gains an optional `editing` input (instance summary) and submits `saveSettings({cli:[{action:'update',…}]})` (the existing contract, `providers-settings-state.service.ts:999-1003`). If that contract cannot carry name/key/provider edits, the executor stops and reports rather than inventing one |
| Transient duplicate controls in Orchestration sub-batches: the Copilot toggle exists in the old AOC and in the new popover between Batches 31 and 33 | LOW | Both write the same key. Batch 33 removes the old one. Not merged before Batch 38 |
| Harness fixture file exceeds 700 lines | LOW | Task 16.1: split per tab (`settings.fixtures.ts` + `settings-orchestration.fixtures.ts`) if > 700 counted lines |
| Electron sidebar narrows content and the fold fails in Electron only (Q-extra-1) | MEDIUM | At Batch 28/36 the team-leader escalates to the orchestrator/user with the measurements; the budget is not silently changed |
| New permission copy (Ptah instances, Copilot) is not user-approved | LOW | Task 29.1 flags it; shown to the user with the Orchestration visual review (Batch 36) |
| Each save-on-selection triggers a full `refresh()` (≈13 RPCs) | LOW | Accepted, existing behaviour (plan §8); recorded, not changed |
| `showModal()` top layer vs Electron native dialogs | LOW | Batch 38 live Electron pass checks file dialogs |

Edge cases (plan §5):

- Loading skeletons + `aria-busy` per region; save triggers disabled until the section is `ready` — Tasks 20.1, 25.1, 26.1, 31.1
- Read error per region with "Retry {label}" (moved from `providers-settings.component.ts:60-69`) — Tasks 18.1, 28.1, 31.1
- Empty states: no connections; no CLIs (#77 install help); no Ptah instances; catalog no-match + Clear — Tasks 27.1, 28.1, 31.1, 32.1
- Unsupported runtime: Save-to lists only `writeScopes(key)`; header "App: Desktop|VS Code" — Tasks 18.1, 26.1, 23.1
- Partial save (552): per-tier conflict, later tiers saved, activation skipped — Task 8.1
- Write failure (553): `set()` rejects, memory restored, toast "Not saved: …", no Undo — Tasks 1.1, 17.1
- Cursor key (551): never logged; read-back via `cursorApiKeyStored`; env precedence note — Tasks 3.1, 5.1, 8.1, 32.1
- Concurrent save: triggers disabled while saving; feedback service refuses re-entry (D3) — Task 17.1
- Workspace switched mid-edit → `blocked` toast; overlay stays open with fresh values — Tasks 17.1, 26.1
- Verify failed (credential / base URL): Save disabled, reason and latency inline, nothing persisted — Tasks 13.1, 21.1, 22.1
- Delete key on the active driver: warning copy; card shows `needs-key` — Task 21.1
- Delete custom connection that is the active driver: blocked "Switch the main agent first." — Tasks 13.1, 22.1
- Modal/popover dismissed mid-save: the write continues; the page toast reports it — Tasks 17.1, 32.1
- Undo = a real second write through the same state method; D6 provider change and auth/provider scope clear have a confirm and no Undo — Tasks 17.1, 23.1, 26.1

## Parallelism map

- **Can start now (no dependencies):** 1, 3, 5, 6, 14, 15, 16. Batch 4 is also dependency-free, but it waits for
  Batch 3's commit (same test project).
- **Recommended first wave** (max 3 lanes + subagents):
  - subagents: Batch 1 (backend-developer), Batch 16 (senior-tester), Batch 15 (frontend-developer)
  - lanes: Batch 5, Batch 6, Batch 3
  - Batch 14 (lane) goes next, when a lane frees up.
  - Critical path: 5 → 8 → 9 → 10 → 11 → 12 → 13 → 17 → … → 28 → 28b → 28c → 28d → 29 → … → 36 → 39 → … → 50 →
    37 → 38.
- **Strictly sequential chains:**
  - 1 → 2
  - 3 → 4 (serialised on the shared test project)
  - 6 → 7
  - 8 → 9 → 10 → 11 → 12 → 13
  - 17 → … → 28 → 28b (Providers owner) → 28c (backend-developer) → 28d (Providers owner). 28c could run beside
    28b (file-disjoint: backend and shared vs ui and chat), but the order after 28 is fixed as 28b → 28c → 28d
    (orchestrator), so they run in that order.
  - 29 → … → 36 (Orchestration owner)
  - 39 → … → 50 (Advanced/Search owner), after 36 (user decision 2026-09-30). The map's dependency graph allows
    43 and 45 to start after 39, but the execution decision (one worktree, sequential owners) runs them in number
    order: 39 → 40 → 41 → 42 → 43 → 44 → 45 → 46 → 47 → 48 → 49 → 50. `advanced-settings.component.ts` is edited
    by 39-42 and 44, `search-voice-settings.component.ts` by 39, 45 and 46, so any reordering must keep those
    serialised.
  - 50 → 37 → 38 (close-out and final visual review run once, after Batch 50; pattern-map §8 sequencing note,
    user decision 2026-09-30)

| Batch | Plan step | Name | Executor | Lane-eligible | Depends on |
| --- | --- | --- | --- | --- | --- |
| 1 | S1a | 553 persist failures reject | backend-developer | no (blast radius, judgment) | — |
| 2 | S1a | 553 startup survives a rejecting write | backend-developer | yes | 1 |
| 2b | S1a | Startup degradations found by Batch 2 | backend-developer | in-process (lanes out of quota) | 2 |
| 3 | S1b | 551 Cursor key redaction | backend-developer | yes | — |
| 4 | S1b | D8 spawn reader reads the file store | backend-developer | yes | — (serialised after 3) |
| 5 | S1b | 551 `cursorApiKeyStored/EnvSet` + migrate spec | backend-developer | yes | — |
| 6 | S1c | Electron secret delete pre-check | backend-developer | yes | — |
| 7 | S1c | `auth:deleteStoredKey` RPC | backend-developer | yes | 6 |
| 8 | S2a | 551 UI read-back, 552 staging, D15 | frontend-developer | no | 3, 5 |
| 9 | S2b | Split 1: types + section helpers | frontend-developer | no | 8 |
| 10 | S2b | Split 2: ProvidersCommitService | frontend-developer | no | 9 |
| 11 | S2b | Split 3: ProvidersConnectionSetupService | frontend-developer | no | 10 |
| 12 | S2c | New reads + widened types | frontend-developer | no | 11, 5 |
| 12b | S2c | Sanitize raw RPC error text: ptah-cli + auth | backend-developer | in-process (lanes out of quota) | — |
| 12c | S2c | Sanitize raw RPC error text: agent + provider | backend-developer | in-process | — |
| 13 | S2c | New writes | frontend-developer | no | 12, 7 |
| 14 | S3 | NativeModalComponent | frontend-developer | yes | — |
| 15 | S3 | Picker `searchable` + tool-use | frontend-developer | yes | — |
| 15b | S3 | Autocomplete id prefix + reset on reopen | frontend-developer | yes | 15 |
| 16 | S4 | Harness baseline + reachability gate | senior-tester | no | — |
| 17 | S5 | Save feedback service + toast | frontend-developer (Providers owner) | no | 8, 16 |
| 17b | S4 | Smoke captures stop overwriting baselines | Providers owner or senior-tester | antigravity OK | 16 |
| 18 | S5 | Shell + interim Orchestration (EXCEPTION 8 files) | Providers owner | no | 17, 17b, 12 |
| 19 | S5 | Pure derivations: connection kind + usage | Providers owner | no | 18 |
| 20 | S5 | Drawer + Overview tab | Providers owner | no | 19, 14 |
| 21 | S5 | Drawer Credentials tab | Providers owner | no | 20, 13 |
| 22 | S5 | Drawer Models & Tiers + Advanced tabs | Providers owner | no | 21, 15, 15b |
| 23 | S5 | Scope badge (D16) | Providers owner | no | 22 |
| 24 | S5 | Compact connection card (+ drift checkpoint) | Providers owner | no | 23 |
| 25 | S5 | Routing map + nodes | Providers owner | no | 24 |
| 26 | S5 | Main Agent popover (D6) | Providers owner | no | 25, 15, 15b |
| 27 | S5 | Catalog modal | Providers owner | no | 26, 14 |
| 27b | S5 | Host-correct scope layers + Save-to targets | Providers owner | no | 27 |
| 28 | S5 | Providers composition + **Gate V (Providers)** | Providers owner | no | 27b |
| 28b | S5 | Compact searchable model picker in the Main Agent popover | Providers owner | no | 28 |
| 28c | S5 | Masked key hint + last check latency (contract, backend) | backend-developer | no (secret handling) | 28 (runs after 28b) |
| 28d | S5 | Key hint, Overview latency, Codex CLI "Used by" (UI) | Providers owner | no | 28c, 28b |
| 29 | S6 | Pure derivations: matrix rows + permission notes | Orchestration owner | no | 28d |
| 30 | S6 | CLI matrix + model/effort popover | Orchestration owner | no | 29, 15b |
| 31 | S6 | Cursor popover + Copilot toggle (+ drift checkpoint) | Orchestration owner | no | 30 |
| 32 | S6 | Add-instance + tier-mapping modals | Orchestration owner | no | 31, 14, 13 |
| 32b | S6 | Closed compact model field shows the saved ID (Batch 32 defect) | Orchestration owner | no | 32 |
| 33 | S6 | Policy bar + roles `<details>` | Orchestration owner | no | 32 |
| 34 | S6 | Retire PtahCliConfig (EXCEPTION, D14) | Orchestration owner | no | 33 |
| 35 | S6 | Roles table restyle + consumer rows | Orchestration owner | no | 34 |
| 36 | S6 | Orchestration scenes + **Gate V (Orchestration)** | Orchestration owner | no | 35 |
| 39 | AS | Foundation: generic save entry (G2) + tab shells | Advanced/Search owner | no | 36 |
| 40 | AS | Advanced: Membership & data card | Advanced/Search owner | no | 39 |
| 41 | AS | Advanced: Agent behaviour card (PR-1/PR-2; deletes workflows-config) | Advanced/Search owner | no | 40 |
| 42 | AS | Advanced: System prompt drawer (deletes enhanced-prompts-config) | Advanced/Search owner | no | 41 |
| 43 | AS | Advanced: Output style matrix + editor drawer | Advanced/Search owner | no | 39 (run after 42) |
| 44 | AS | Advanced: MCP & browser + VS Code LM cards (deletes browser-settings) | Advanced/Search owner | no | 42 |
| 45 | AS | Search: Web search matrix | Advanced/Search owner | no | 39 (run after 44) |
| 46 | AS | Voice: engines matrix + D-VOICE drawer shell | Advanced/Search owner | no | 45 |
| 47 | AS | Voice: local STT/TTS panels | Advanced/Search owner | no | 46 |
| 48 | AS | Voice: ElevenLabs panel + go vet card | Advanced/Search owner | no | 46 (run after 47) |
| 49 | AS | Harness: reachability + scenes for both tabs | Advanced/Search owner | no | 43, 44, 48 |
| 50 | AS | **Gate V (Advanced / Search & Voice)** + combined code review 39-50 | Advanced/Search owner, then visual-reviewer | no (images) | 49 |
| 37 | S7 | Close-out: live scripts, full run, reports | senior-tester | no | 50 |
| 38 | S7 | Full visual review + live Electron pass | visual-reviewer | no (images) | 37 |

---

## Batch 1: 553 persist failures reject (S1a) — COMPLETE (d1b1469a3)

- Recommended executor: backend-developer (subagent)
- Fallback executor: CLI lane with a self-contained prompt (then the review goes to a subagent)
- Execution mode: sequential
- Rationale: one lib, but caller specs across 4 libs may react to the new rejection. Deciding which of them assert
  "resolves on failure" needs judgment.
- Review route: in-process author → CLI-lane code-logic review
- Tasks: 1 | Depends on: none

### Task 1.1: `persist()` rejects with `SettingsPersistError`; memory restored; listeners only on success — COMPLETE

- Files:
  - CREATE `ROOT\libs\backend\platform-core\src\file-settings-errors.ts`
  - MODIFY `ROOT\libs\backend\platform-core\src\file-settings-manager.ts`
  - MODIFY `ROOT\libs\backend\platform-core\src\index.ts`
  - MODIFY `ROOT\libs\backend\platform-core\src\file-settings-manager.error-paths.spec.ts`
  - CREATE `ROOT\.ptah\specs\TASK_2026_553\fix-report.md`
- Plan reference: implementation-plan.md:176-228 (Component 1); §7 row S1a (:1133)
- Pattern to follow: `ROOT\libs\backend\platform-core\src\state-storage-errors.ts:3-33` (error class)
- Quality requirements:
  - The error carries only the fs `code` plus fixed text, never a value.
  - Logging stays `console.warn`.
  - `flushSync` keeps swallowing.
  - The `writePromise` chain keeps accepting writes after a failure.
- Validation notes: flip `:139-150` to expect rejection. In `:121-137`, change only the first `await` to
  `.rejects` (see Risks), and list both deliberate changes. If caller specs in vscode-core, platform-vscode,
  platform-electron, platform-cli or settings-core go red, fix them in this batch only up to 2 extra spec files in 1
  extra lib. Beyond that, STOP and report the list; the team-leader adds a batch.
- Implementation details:
  - `set()` snapshots the previous value, awaits the queued persist, and on rejection restores the snapshot and rethrows.
  - Listeners fire after a successful persist.
  - The fix report holds the RPC save-path trace (RPC → handler → `setConfiguration` → `set` → `persist` → reject →
    envelope → `runCommit` `unsaved` → toast) and the spec evidence. Batch 2 appends the startup evidence.

### Batch 1 verification

- New cases: failed write leaves the value unchanged; the next `set()` succeeds; listeners are not called on failure.
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/platform-core @ptah-extension/vscode-core @ptah-extension/platform-vscode @ptah-extension/platform-electron @ptah-extension/platform-cli @ptah-extension/settings-core @ptah-extension/rpc-handlers @ptah-extension/cli-engine ptah-extension-vscode ptah-electron ptah-cli` (tail output)
- Gate G if committed after Batch 16.
- Code-logic review accepts.

## Batch 2: 553 startup survives a rejecting write (S1a) — COMPLETE (ad747e20b)

- Recommended executor: backend-developer (subagent), or a CLI lane
- Fallback executor: whichever of the two was not used
- Execution mode: sequential
- Rationale: three spec-only additions in two apps and one lib (cli-engine); each is self-contained.
- Review route: in-process → CLI lane; lane → subagent code-logic-reviewer
- Tasks: 1 | Depends on: Batch 1

### Task 2.1: bootstrap specs assert startup survives a rejecting `setConfiguration` — COMPLETE

- Files:
  - MODIFY `ROOT\apps\ptah-extension-vscode\src\activation\bootstrap.cursor-key.spec.ts`
  - MODIFY `ROOT\apps\ptah-electron\src\activation\bootstrap.cursor-key.spec.ts`
  - MODIFY `ROOT\libs\backend\cli-engine\src\lib\bootstrap\with-engine.spec.ts`
  - MODIFY `ROOT\.ptah\specs\TASK_2026_553\fix-report.md` (append the startup section)
- Plan reference: implementation-plan.md:200-216
- Pattern to follow: the existing cases in each spec; `run-cursor-api-key-migration.ts:26-42` (catch-all)
- Quality requirements: a real rejecting fake (`SettingsPersistError`), not a thrown string. Assert that activation
  resolves and that the warning is logged without the value.
- Validation notes: if a bootstrap path does NOT survive, stop and report. The production fix is not in this batch's
  scope.
- Implementation details: one case per file; the fix report gains "startup survives" evidence with spec names.

### Batch 2 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-engine ptah-extension-vscode ptah-electron ptah-cli`
- Gate G if committed after Batch 16; code-logic review accepts.

## Batch 2b: startup degradations found by Batch 2 (S1a follow-up) — COMPLETE (325d8e751)

- Recommended executor: backend-developer (subagent, in-process)
- Fallback executor: antigravity CLI lane, when its quota is back
- Execution mode: sequential
- Rationale:
  - The user asked to fix every degradation found. Batch 2's startup specs exposed two pre-existing defects.
  - Both are in bootstrap files that no other batch owns.
  - Two small tasks, one executor.
- Review route: in-process author → antigravity lane when available; otherwise an independent reviewer subagent,
  labelled same-side
- Tasks: 2 | Depends on: Batch 2 (COMPLETE)

### Task 2b.1: load custom providers independently of the settings-migration outcome (VS Code + Electron) — COMPLETE

- Files:
  - MODIFY `ROOT\apps\ptah-extension-vscode\src\activation\bootstrap.ts` (`:104-126`)
  - MODIFY `ROOT\apps\ptah-electron\src\activation\bootstrap.ts` (`:246-268`)
  - MODIFY `ROOT\apps\ptah-extension-vscode\src\activation\bootstrap.cursor-key.spec.ts` and
    `ROOT\apps\ptah-electron\src\activation\bootstrap.cursor-key.spec.ts`, or a sibling bootstrap spec in each
    app if one already covers custom providers
- Plan reference: Batch 2 report / review; implementation-plan.md Component 1 (startup paths must not crash)
- Pattern to follow: the existing non-fatal try/catch blocks in each bootstrap file
- Quality requirements:
  - Today `customProviders.load()` sits inside the same try/catch as `MigrationRunner.runMigrations()`, so a failed
    migration skips loading user-defined providers for the whole session.
  - Give the load its own try/catch after the migration block, so it runs whether the migration succeeded or failed.
  - The log line still reports the entry count and the dropped entries.
  - Publish order is unchanged: providers are published to the registry cache before anything that reads the
    registry.
- Validation notes: one spec per host covers a rejecting `runMigrations()`: `customProviders.load()` is still
  called, the registry is published, and activation resolves. A second case: a throwing `load()` is logged and
  does not reject activation.
- Implementation details: no new DI tokens; resolve `CustomProviderStore` exactly as today.

### Task 2b.2: cli-engine `migrateLegacyAuthMethod` resolves the real workspace-provider token — COMPLETE

- Files:
  - MODIFY `ROOT\libs\backend\cli-engine\src\lib\bootstrap\with-engine.ts` (`:97-105`, `:519-537`)
  - MODIFY `ROOT\libs\backend\cli-engine\src\lib\bootstrap\with-engine.spec.ts`
- Plan reference: Batch 2 report / review
- Pattern to follow: `PLATFORM_TOKENS.WORKSPACE_PROVIDER` (`ROOT\libs\backend\platform-core\src\di\tokens.ts:25`,
  `Symbol.for('PlatformWorkspaceProvider')`), imported from the platform-core barrel, never a local
  `Symbol.for(...)`
- Quality requirements:
  - Today `WORKSPACE_PROVIDER_TOKEN = Symbol.for('WorkspaceProvider')` (`:105`) is registered by nothing. Its catch
    (`:310`) hides the resolution failure, so the legacy auth-method migration **never runs** in the CLI.
  - Use the platform token.
  - Remove the local symbol and its stale doc comment (`:97`).
  - The failure log stays and carries no settings value.
- Validation notes:
  - A spec with a real container registration under `PLATFORM_TOKENS.WORKSPACE_PROVIDER` shows the migration now
    runs and writes the migrated value.
  - A spec shows a second run is a no-op (idempotent).
  - A spec shows a user file that is already migrated, or that has no legacy value, is left untouched: no write,
    no deletion of unrelated keys.
  - The report records what the migration reads and writes (key, store, scope) as a write-path trace row, and
    confirms that it only touches the legacy key.
- Implementation details: none beyond the above.

### Batch 2b verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-engine ptah-extension-vscode ptah-electron ptah-cli`
- Gate G (webview rebuilt; reachability spec green in both hosts)
- Review accepts.

## Batch 3: 551 Cursor key redaction (S1b) — COMPLETE (16b5120e4)

- Recommended executor: CLI lane (self-contained, 4 code files in one lib)
- Fallback executor: backend-developer (subagent)
- Execution mode: sequential
- Rationale: a pure helper plus adapter call sites with exact line references; describable in one prompt.
- Review route: lane → subagent code-logic-reviewer (security focus: no key in logs, chunks or segments)
- Tasks: 1 | Depends on: none. Do not run concurrently with Batch 4 (same test project).

### Task 3.1: `redactSecrets` + `summarizeCliSdkError(…, secrets)`; Cursor adapter redacts every path — COMPLETE

- Files:
  - MODIFY `RT\cli-adapters\sdk-error-summary.ts`, `RT\cli-adapters\sdk-error-summary.spec.ts`
  - MODIFY `RT\cli-adapters\cursor-cli.adapter.ts`, `RT\cli-adapters\cursor-cli.adapter.spec.ts`
  - CREATE `ROOT\.ptah\specs\TASK_2026_551\fix-report.md`
- Plan reference: implementation-plan.md:230-269 (Component 2)
- Pattern to follow: existing Cursor case `sdk-error-summary.spec.ts:60`; Codex caller `codex-cli.adapter.ts:773` (must stay untouched)
- Quality requirements:
  - Literal-value replacement with a fixed `[REDACTED]` marker, applied before the headline is cut.
  - The third parameter is optional and defaults to `[]`.
- Validation notes: three 551 acceptance specs, each asserting that no logger arg, output chunk or segment contains
  the key:
  - `runTurn` rejection (`:376-388`)
  - `run.cancel()`/`interrupt()` rejection (`:426-435`)
  - `detect` resolver failure (`:195-200`)
- Implementation details:
  - Capture the resolved key in the `runSdk` scope and pass `[apiKey]` to the log detail and the summary.
  - The report holds the key → store → reader trace (`agent:setConfig` → `ptah.auth.provider.cursor` →
    `resolveCursorApiKey`, env first) and the redaction evidence. Batch 8 appends the UI half.

### Batch 3 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime`
- Gate G if committed after Batch 16; code-logic review accepts.

## Batch 4: D8 spawn reader reads the file store (S1b) — COMPLETE (50c773767)

- Recommended executor: CLI lane
- Fallback executor: backend-developer (subagent)
- Execution mode: sequential
- Rationale: one reader file plus one new regression spec; exact form given by sibling reads.
- Review route: lane → subagent code-logic-reviewer (write-path trace rows 894-896 of plan §3)
- Tasks: 1 | Depends on: none. Start after Batch 3 commits (shared test project).

### Task 4.1: `resolveReasoningEffort` / `resolveAutoApprove` / `resolveModel` read `('ptah','agentOrchestration.<key>')` — COMPLETE

- Files:
  - MODIFY `RT\agent-spawn-environment.service.ts`
  - CREATE `RT\agent-spawn-environment.settings-routing.spec.ts`
  - MODIFY `ROOT\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.spec.ts`, only if its
    `:304-321` normalisation now masks the fix (report why)
- Plan reference: implementation-plan.md:271-288 (Component 3), D8
- Pattern to follow: sibling reads `agent-spawn-environment.service.ts:226-256`
- Quality requirements: defaults are unchanged (`''`/`true`). Exactly one regression spec, with a fake workspace
  provider that honours the real `section==='ptah' && isFileBasedSettingKey` rule.
- Validation notes (ASSUMPTION check): confirm whether any user-writable path puts values in VS Code config
  `ptah.agentOrchestration.*`:
  - Check the `ROOT\apps\ptah-extension-vscode\package.json` contributes and the settings-core migrations.
  - Record the file:line in the report.
  - If such values exist and are not migrated to the file store, return BLOCKED instead of committing a silent
    behaviour loss.
- Implementation details: replace the section/key pair at each of the four reads (`:124, :147, :158, :173`
  neighbourhood).

### Batch 4 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime`
- Gate G if committed after Batch 16; code-logic review accepts.

## Batch 5: 551 read-back fields + migrate rejecting-write spec (S1b) — COMPLETE (c569d1eaa)

- Recommended executor: CLI lane
- Fallback executor: backend-developer (subagent)
- Execution mode: sequential
- Rationale: small, self-contained; it is the head of the critical path (Batch 8 needs the type fields).
- Review route: lane → subagent code-logic-reviewer
- Tasks: 1 | Depends on: none

### Task 5.1: `agent:getConfig` adds `cursorApiKeyStored` and `cursorApiKeyEnvSet`; migration survives a rejecting write — COMPLETE

- Files:
  - MODIFY `TYPES\rpc\rpc-agents.types.ts`
  - MODIFY `RPC\agent-rpc.handlers.ts`
  - MODIFY `RPC\agent-rpc.handlers.set-config.spec.ts`
  - MODIFY or CREATE one `RPC\agent-rpc.handlers.*.spec.ts` for `migrateAgentOrchestrationSettings` (prefer an existing
    migration spec file if one exists)
- Plan reference: implementation-plan.md:242-266, :204-205 (review finding 2)
- Pattern to follow: `cursorApiKeyConfigured` (`agent-rpc.handlers.ts:1050-1056`; type `rpc-agents.types.ts:107`)
- Quality requirements: `Stored` = secret present; `EnvSet` = `CURSOR_API_KEY` non-empty. Never return the value.
- Validation notes: set-config spec cases with and without the env var (`:174-330`). The migrate case: a rejecting
  `setConfiguration` is logged and the handler does not reject.
- Implementation details: compute both booleans next to `cursorApiKeyConfigured`.

### Batch 5 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/core @ptah-extension/chat ptah-extension-webview`
- Gate G if committed after Batch 16; code-logic review accepts.

## Batch 6: Electron secret delete pre-check (S1c, first checklist item) — COMPLETE (84f59b405)

- Recommended executor: CLI lane
- Fallback executor: backend-developer (subagent)
- Execution mode: sequential
- Rationale: a trace plus one spec; it gates Batch 7 (the handler must not ship on an unverified assumption).
- Review route: lane → subagent code-logic-reviewer
- Tasks: 1 | Depends on: none

### Task 6.1: prove that delete → `get` is `undefined` on the Electron secret backend — COMPLETE

- Files:
  - MODIFY `ROOT\libs\backend\platform-electron\src\implementations\electron-secret-storage.spec.ts`
  - MODIFY `ROOT\libs\backend\platform-electron\src\implementations\electron-secret-storage.ts`, ONLY if the trace
    shows delete does not persist
- Plan reference: implementation-plan.md:323-332
- Pattern to follow: existing cases in `electron-secret-storage.spec.ts`
- Quality requirements: the report cites file:line for:
  - `EXTENSION_CONTEXT.secrets` shim → `ElectronSecretStorage` (`apps\ptah-electron\src\di\phase-1-infra.ts`)
  - `AuthSecretsService.setCredential('apiKey','')` → delete (`auth-secrets.service.ts:193-196`)
  - `deleteProviderKey` (`:300-302`)
- Validation notes: delete must survive a reload (persisted file), not only the in-memory map (`:105-107` deletes from
  `this.secrets`; confirm a persist follows).
- Implementation details: spec: store → delete → new instance over the same file → `get` is `undefined`.

### Batch 6 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/platform-electron ptah-electron`
- Gate G if committed after Batch 16; code-logic review accepts.

## Batch 7: `auth:deleteStoredKey` RPC (S1c) — COMPLETE (2b4d0ac12)

- Recommended executor: CLI lane
- Fallback executor: backend-developer (subagent)
- Execution mode: sequential
- Rationale: 5 files in 2 libs; the contract is fully specified.
- Review route: lane → subagent code-logic-reviewer (security: least privilege, id validated before use, no reset)
- Tasks: 1 | Depends on: Batch 6

### Task 7.1: new RPC, schema, registration, handler, spec — COMPLETE

- Files:
  - MODIFY `TYPES\rpc\rpc-auth.types.ts`, `TYPES\rpc.types.ts`
  - MODIFY `RPC\auth-rpc.handlers.ts`, `RPC\auth-rpc.schema.ts`
  - CREATE `RPC\auth-rpc.handlers.delete-stored-key.spec.ts`
- Plan reference: implementation-plan.md:290-332 (Component 4), D4
- Pattern to follow:
  - `auth:setApiKey` registration (`rpc.types.ts:1468`, `RPC_METHOD_ENTRIES :3564+`; `auth-rpc.handlers.ts:154-160, :305-315`)
  - provider-id validation `auth-rpc.schema.ts:45-57`
  - fixed error text as in `agent-rpc.handlers.ts:327-331`
- Quality requirements:
  - **No** `sdkAdapter.reset()`.
  - Invalidate the auth-status and model caches, as `:1241-1248` does.
  - Error `'Could not delete the stored key.'`.
- Validation notes: five spec cases:
  - the Anthropic slot is deleted
  - a provider slot is deleted
  - an unknown id is rejected before any secret call
  - reset is never called
  - a store rejection gives the fixed error
  - **Carry-forward from the Batch 6 review:** `ElectronSecretStorage.delete` propagates a `persist()` rejection as
    a throw (`libs\backend\platform-electron\src\implementations\electron-secret-storage.ts:108-112`). The handler
    must catch every throw from `setCredential('apiKey','')` / `deleteProviderKey(id)` and return
    `{success:false, error:'Could not delete the stored key.'}`, never an unhandled rejection. A spec with a
    rejecting `delete` pins this. Deleting an absent key is idempotent success (`delete` early-returns and fires
    no `onDidChange`), so the handler must not rely on the change event.
- Implementation details: `'anthropic'` → `setCredential('apiKey','')`; otherwise `deleteProviderKey(id)`.

### Batch 7 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/core @ptah-extension/vscode-core ptah-electron`
- Gate G if committed after Batch 16; code-logic review accepts.

## Batch 8: 551 UI read-back, 552 staged tiers, D15 (S2a) — COMPLETE (82cba0142)

- Recommended executor: frontend-developer (subagent); the same instance should continue Batches 9-13
- Fallback executor: a second frontend-developer subagent
- Execution mode: sequential
- Rationale: behaviour changes in the 1200-line commit pipeline; they need judgment and must land before the split
  moves the code.
- Review route: in-process → CLI-lane code-logic review
- Tasks: 1 | Depends on: Batches 3, 5

### Task 8.1: read-back on `cursorApiKeyStored`; `stage` marker replaces `dependsOnPrevious`; never "Saved" after a failed write — COMPLETE

- Files:
  - MODIFY `CORE\providers-settings-state.service.ts`, `CORE\providers-settings-state.service.spec.ts`
  - MODIFY `ROOT\.ptah\specs\TASK_2026_551\fix-report.md` (append the UI read-back half)
- Plan reference: implementation-plan.md:334-369 (Component 5), D15
- Pattern to follow: the existing commit ops `:472-518`; `runCommit` `:1017-1101`
- Quality requirements: the TASK_2026_534 conflict/activation specs stay green unchanged, except the saved-after-throw
  assertions D15 changes deliberately (listed by file:line in the report).
- Validation notes:
  - The 552 acceptance spec: two tiers, the first conflicts, the second saves, activation does not run, and the
    message names each tier.
  - Three D15 cases, none landing in `saved`: throw → `unconfirmed`; `success:false` → `unsaved`; ack + mismatch →
    `unsaved`.
  - Cursor clear with `CURSOR_API_KEY` set.
- Implementation details: `stage?: 'setup'|'tier'|'activation'`, default `'setup'`, with the skip rules of the plan
  (:341-346). Read-back runs only after an acknowledged `true` write.
- Debt carried from Batch 5 (record the decision in the report; fix a file only if this batch touches it):
  - Three fixtures build `AgentOrchestrationConfig` without `cursorApiKeyStored`/`cursorApiKeyEnvSet`:
    `libs\frontend\tribunal-panel\src\lib\services\tribunal-discovery.service.spec.ts:23-33`,
    `apps\ptah-electron-e2e\src\specs\thoth\skills.spec.ts:152`,
    `libs\frontend\webview-e2e-harness\src\lib\scenarios\thoth\skills-lane-pickers.e2e.spec.ts:153`.
    They are harmless today. Every fixture this batch touches carries both fields.
  - `agent:getConfig` now always reads the secret store (`getCursorApiKeyStatus` in `agent-rpc.handlers.ts`), so a
    keychain outage fails the whole call even when `CURSOR_API_KEY` is set. It is accepted (the kind of failure is
    unchanged). The UI must show the orchestration read error with Retry, not a stale "Set" badge.

### Batch 8 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core @ptah-extension/chat`
- Gate G if committed after Batch 16; code-logic review accepts.

## Batch 9: facade split 1 — types + section helpers (S2b) — COMPLETE (827f8cdd2)

- Recommended executor: frontend-developer (same instance as Batch 8)
- Fallback executor: another frontend-developer subagent
- Execution mode: sequential
- Rationale: a behaviour-neutral refactor in three steps so that each step is small and independently green.
- Review route: in-process → CLI lane, code-style + code-logic roles (structure is the point of 554)
- Tasks: 1 | Depends on: Batch 8

### Task 9.1: move types to `providers-settings.types.ts` (re-exported) and plumbing to `providers-settings-sections.ts` — COMPLETE

- Files:
  - CREATE `CORE\providers-settings.types.ts`, `CORE\providers-settings-sections.ts`, `CORE\providers-settings-sections.spec.ts`
  - REWRITE (partial) `CORE\providers-settings-state.service.ts`
- Plan reference: implementation-plan.md:371-403 (Component 6); refactor recipe `.claude/skills/humanize-library/references/refactor-recipes.md:80-94`
- Pattern to follow: the existing `section()/read()/view()/freshEffortView()/require()` (`:1142-1187`)
- Quality requirements: the public class, token, DI and every public member are unchanged. `core/src/index.ts:2`
  still exports the types.
- Validation notes: `git diff -- CORE\providers-settings-state.service.spec.ts` must show **no** `expect` edits
  (checked across Batches 9-11).
- Implementation details: the helpers take the workspace/RPC dependencies explicitly as parameters.

### Batch 9 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core @ptah-extension/chat`
- Gate G if committed after Batch 16; review accepts.

## Batch 10: facade split 2 — `ProvidersCommitService` (S2b) — COMPLETE (d5f238415)

- Recommended executor: frontend-developer (same instance)
- Fallback executor: another frontend-developer subagent
- Execution mode: sequential
- Rationale: see Batch 9. Review route as Batch 9.
- Tasks: 1 | Depends on: Batch 9

### Task 10.1: move `commitState`, `runCommit`, `contextMatches` and the operation builders (`:840-1015`) — COMPLETE

- Files:
  - CREATE `CORE\providers-commit.service.ts`, `CORE\providers-commit.service.spec.ts`
  - MODIFY `CORE\providers-settings-state.service.ts`
- Plan reference: implementation-plan.md:375-379
- Pattern to follow: root-provided `@Injectable({ providedIn: 'root' })` services in CORE
- Quality requirements: the facade passes hooks for `refreshScopes`, `refresh` and `sectionsReady`, so the side-effect
  order of `:1024-1101` is preserved.
- Validation notes: the direct spec covers the stage/skip matrix from Batch 8.
- Implementation details: the facade delegates `commit`.

### Batch 10 verification

- Same command as Batch 9; the facade spec has no `expect` edits; review accepts.

## Batch 11: facade split 3 — `ProvidersConnectionSetupService` (S2b) — COMPLETE (7376571ec)

- Recommended executor: frontend-developer (same instance)
- Fallback executor: another frontend-developer subagent
- Execution mode: sequential
- Review route: as Batch 9
- Tasks: 1 | Depends on: Batch 10

### Task 11.1: move connect-operation assembly, activation auth, draft verification and probe state, external auth — COMPLETE

- Files:
  - CREATE `CORE\providers-connection-setup.service.ts`, `CORE\providers-connection-setup.service.spec.ts`
  - MODIFY `CORE\providers-settings-state.service.ts`
- Plan reference: implementation-plan.md:380-383, :394-396 (554 acceptance)
- Pattern to follow: Batch 10's collaborator
- Quality requirements (554 acceptance):
  - the facade and each collaborator are under 700 counted lines (`npx eslint --rule "max-lines:[error,{max:700,skipBlankLines:true,skipComments:true}]"` on the three files)
  - the facade spec has no assertion changes across Batches 9-11
- Validation notes: probe generation state stays in one place, and the cancel/abort ordering is unchanged.
- Implementation details: the facade delegates `connectProvider`, `verifyDraft`, `cancelVerification` and
  `performExternalAuth`.

### Batch 11 verification

- Same command as Batch 9, plus the line-count evidence in the report; review accepts.

## Batch 12: new reads and widened types (S2c) — COMPLETE (0a9d1b85f)

- Recommended executor: frontend-developer (same instance)
- Fallback executor: another frontend-developer subagent
- Execution mode: sequential
- Rationale: the read side is split from the write side to stay within 6 files.
- Review route: in-process → CLI-lane code-logic review
- Tasks: 1 | Depends on: Batches 11, 5

### Task 12.1: `redetectClis`, widened `refreshOrchestration`, `ProvidersConnection.accountLabel/tokenStale`, `customEntry(id)`, `testCliConnection` keeps latency/reason — COMPLETE

- Files:
  - MODIFY `CORE\providers-settings.types.ts`, `CORE\providers-settings-sections.ts`
  - MODIFY `CORE\providers-settings-state.service.ts`, `CORE\providers-settings-state.service.spec.ts`
  - MODIFY `CHAT\providers\providers-settings.component.spec.ts`: a one-line fixture fix only, authorised by the
    orchestrator. The fixture helper at `:60` builds a `ProvidersConnection` without the new `accountLabel` and
    `tokenStale` fields (TS2739 under `tsconfig.spec.json`). chat's jest run does not type-check specs, so no gated
    target would catch it. Adding the two fields avoids new debt. The batch now spans 5 files in 2 libs (core, chat).
- Plan reference: implementation-plan.md:405-433 (Component 7 table, read rows)
- Pattern to follow: existing `refresh*` members; AOC re-detect `agent-orchestration-config.component.ts:598-625`
- Quality requirements:
  - No credential in a signal.
  - `reason` is the backend-sanitized `error` only.
  - The facade stays under 700 counted lines; logic lives in sections/collaborators.
- Validation notes: the orchestration projection adds `detectedClis`, `disabledClis`, `preferredAgentOrder`,
  `maxConcurrentAgents`, `copilotAutoApprove` and `cursorApiKey{Configured,Stored,EnvSet}`.
- Implementation details: the `redetectClis` sequence is `agent:detectClis`, then orchestration, CLI agents, CLI
  models.

### Batch 12 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core @ptah-extension/chat`
- Gate G if committed after Batch 16; review accepts.

## Batch 12b: sanitize raw RPC error text — ptah-cli + auth handlers (S2c follow-up) — COMPLETE (d32aebae8)

- Recommended executor: backend-developer (subagent, in-process)
- Fallback executor: antigravity CLI lane, when its quota is back
- Execution mode: sequential
- Rationale:
  - Project rule: never surface a raw `error.message` to the client.
  - Batch 12's CLI test UI shows `reason` and relies on "no key or path in reason".
  - The team-leader's grep of the four handlers the Settings UI calls found 14 raw-error returns, 10 of them in
    Settings RPCs. This batch takes the two most sensitive handlers: `ptahCli:*`, which feeds `reason`, and
    `auth:setApiKey`, whose store error could echo the key.
  - Batch 12c takes the rest. The two batches are file-disjoint.
- Review route: in-process author → antigravity lane when available; otherwise an independent reviewer subagent,
  labelled same-side (security focus)
- Tasks: 1 | Depends on: none (Batch 12 only consumes `reason`). Commit it serially with Batch 12c: same test
  project.

### Task 12b.1: fixed client messages in `ptah-cli-rpc.handlers.ts` and `auth-rpc.handlers.ts` outer catches — COMPLETE

- Files:
  - MODIFY `RPC\ptah-cli-rpc.handlers.ts`: `ptahCli:create` `:152`, `ptahCli:update` `:211`, `ptahCli:delete`
    `:247`, `ptahCli:testConnection` `:277-289`, `ptahCli:listModels` `:359`
  - MODIFY `RPC\ptah-cli-rpc.handlers.spec.ts`
  - MODIFY `RPC\auth-rpc.handlers.ts`: `auth:copilotLogin` `:1144`, `auth:setApiKey` `:1271`
  - MODIFY `RPC\auth-rpc.handlers.spec.ts`
- Plan reference: implementation-plan.md §2a/§5 ("No RPC error text enters state"); Component 4's fixed-error
  pattern (`agent-rpc.handlers.ts:327-331`); the Batch 12 `reason` contract
- Pattern to follow:
  - the fixed-text returns in `auth:deleteStoredKey` (Batch 7, `auth-rpc.handlers.ts` ~`:1284-1330`)
  - `sanitizeErrorMessage` (`ROOT\libs\backend\cli-agent-runtime\src\lib\ptah-cli\ptah-cli-registry.utils.ts:110-126`),
    only if a sanitized detail is genuinely needed
- Quality requirements:
  - Each outer catch returns a fixed, per-RPC message (e.g. "Could not test the connection.", "Could not save the
    API key.").
  - Logging and Sentry keep the error object, as today; no secret is added to a log line.
  - Expected failures that already return fixed text stay untouched: the inner `success:false` paths from the
    registry, whose error is already backend-sanitized.
  - `ptahCli:testConnection`'s **inner** result (`ptahCliRegistry.testConnection`) keeps its sanitized `error`, which
    is Batch 12's `reason`. Only the outer catch changes.
  - `auth:copilotLogin`: if a known, user-actionable failure exists (e.g. device-flow expired), map it to fixed copy;
    otherwise use "GitHub sign-in failed. Try again."
- Validation notes:
  - One spec per RPC: a thrown `Error` whose message contains a fake key (`sk-test-FAKEKEY123`) and a path
    (`C:\Users\someone\.ptah\settings.json`) never appears in the RPC result (`JSON.stringify(result)`), and the
    result carries the fixed text.
  - Existing specs that asserted the raw message change deliberately; list them in the report.
- Implementation details: none beyond the above.

### Batch 12b verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers` (known pre-existing failure:
  `harness-skill-selection-rpc.service.spec.ts`)
- Gate G (webview rebuilt; reachability spec green in both hosts)
- Review accepts.

## Batch 12c: sanitize raw RPC error text — agent + provider handlers (S2c follow-up) — COMPLETE (08c6500c4)

- Recommended executor: backend-developer (subagent, in-process). It may run in parallel with Batch 12b (file-disjoint),
  but is committed serially after it.
- Fallback executor: antigravity CLI lane
- Execution mode: sequential
- Rationale: the remaining Settings-called raw-error returns from the same grep.
- Review route: as Batch 12b
- Tasks: 1 | Depends on: none

### Task 12c.1: fixed client messages in `agent:setConfig`, `provider:setModelTier`, `provider:clearModelTier` — COMPLETE

- Files:
  - MODIFY `RPC\agent-rpc.handlers.ts` (`agent:setConfig` outer catch `:408` only)
  - MODIFY `RPC\agent-rpc.handlers.set-config.spec.ts`
  - MODIFY `RPC\provider-rpc.handlers.ts` (`:616`, `:708`)
  - MODIFY `RPC\provider-rpc.handlers.spec.ts`
- Plan reference / pattern / quality / validation: as Task 12b.1 (fake key + path never in the result; fixed text;
  logging unchanged).
- Validation notes:
  - `agent:setConfig`'s existing fixed Cursor-key error (`:327-331`) stays.
  - A Batch 1 `SettingsPersistError` already carries fixed text plus a code. It may pass through as-is, because its
    message is fixed by construction. Assert that it still does.
  - Out of scope, and listed as a follow-up in the report because the Settings UI does not call them:
    `agent:permissionResponse` (`agent-rpc.handlers.ts:638`, `:745`), `agent:stop` (`:775`) and
    `agent:resumeCliSession` (`:898`), and the typed `AgentContinueError` return at `:806`, whose message is a
    fixed code-bearing text by design. The Batch 37 parity-evidence "Follow-ups" section carries them.

### Batch 12c verification

- Same as Batch 12b.

## Batch 13: new writes (S2c) — COMPLETE (c68d1b389)

- Recommended executor: frontend-developer (same instance)
- Fallback executor: another frontend-developer subagent
- Execution mode: sequential
- Review route: in-process → CLI-lane code-logic review
- Tasks: 1 | Depends on: Batches 12, 7

### Task 13.1: the write members through `runCommit`; orchestration patch widened with order-sensitive array read-back — COMPLETE

- Files:
  - MODIFY `CORE\providers-settings-state.service.ts`, `CORE\providers-settings-state.service.spec.ts`
  - MODIFY `CORE\providers-commit.service.ts`, `CORE\providers-commit.service.spec.ts`
  - MODIFY `CORE\providers-connection-setup.service.ts`, `CORE\providers-connection-setup.service.spec.ts`
  - MODIFY `CORE\providers-settings.types.ts`: the widened orchestration patch type (one new
    `ProvidersOrchestrationPolicyField` type and one widened `Pick`). Added at the orchestrator's request. This is
    **7 files, over the 6-file cap by one** (1 lib, a type-only edit next to its only consumer); the exception is
    accepted.
- Author's deviation, accepted and recorded: besides the active-driver block, `removeCustomEntry` is also blocked
  while the route section is not `ready`, with "Refresh the main agent route before removing this connection." The
  active driver cannot be checked then, so allowing the delete could remove the connection the main agent is using.
  The reviewer confirms that a spec covers it. The "ends running chat sessions" confirm stays UI work in Batch 26
  (D6).
- Plan reference: implementation-plan.md:410-433 (write rows), D4, D5, D7
- Pattern to follow: the `connectProvider` verify gate (`:441-444`); the tier patch path (`:970-986`)
- Quality requirements:
  - Write members: `deleteStoredKey`, `disconnectCopilot`, `removeCustomEntry` (blocked for the active driver),
    `updateCustomEntryFields`, `updateCustomEntryEndpoint` (verify gate), `updateLocalBaseUrl` (verify gate),
    `setMainAgentTier` (+clear), `setCliInstanceTiers` (full object).
  - Each has specs for success, `success:false`, rejection and read-back mismatch.
  - The array read-back has its own case.
- Validation notes:
  - The gates refuse an unverified or mismatched probe (#27).
  - No RPC error text enters state.
  - The facade stays under 700 counted lines.
- Implementation details: D7. A models-endpoint change alone is saved after a verify of the *current* base URL with
  the stored credential.

### Batch 13 verification

- Same command as Batch 12; Gate G if committed after Batch 16; review accepts.

## Batch 14: `NativeModalComponent` (S3) — COMPLETE (47b39d17d)

- Recommended executor: CLI lane
- Fallback executor: frontend-developer (subagent)
- Execution mode: sequential
- Rationale: a domain-free primitive with a verbatim contract; no page mounting required. It is a library primitive,
  mounted by Batches 27 and 32.
- Review route: lane → subagent code-logic-reviewer + code-style-reviewer (barrel/tag rules)
- Tasks: 1 | Depends on: none. Start when a lane frees up.

### Task 14.1: modal on native `<dialog>` with header/default/footer slots — COMPLETE

- Files:
  - CREATE `UI\modal\native-modal.component.ts`, `UI\modal\index.ts`, `UI\modal\native-modal.component.spec.ts`
  - MODIFY `UI\index.ts` (one `export * from './modal';` line)
- Plan reference: implementation-plan.md:435-455 (Component 8); design-spec §2.5
- Pattern to follow:
  - barrels `UI\index.ts:1-50`
  - `showModal` jsdom stub `ROOT\libs\frontend\git-ui\src\lib\diff-view\diff-view.component.spec.ts:46-60`
- Quality requirements:
  - Standalone, OnPush, signal inputs.
  - No document listeners.
  - `ngOnDestroy` closes if open.
  - `data-testid="native-modal-dialog"`.
- Validation notes: `cancel` emits `closed` without the component closing itself. The barrel spec stays green.
- Implementation details: an `effect()` drives `showModal()`/`close()`; size classes sm/md/lg.

### Batch 14 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/ui @ptah-extension/chat`
- Gate G if committed after Batch 16; review accepts.

## Batch 15: picker `searchable` + tool-use indicators (S3) — COMPLETE (335c532ae)

- Recommended executor: frontend-developer (subagent). A CLI lane is acceptable only with the D12 regression rule
  quoted in its prompt.
- Fallback executor: CLI lane
- Execution mode: sequential
- Rationale: it changes a component shared with Memory and Thoth Skills. Opt-in behaviour must be exact (D12, user
  decision R3).
- Review route: in-process → CLI-lane code-logic review
- Tasks: 1 | Depends on: none

### Task 15.1: `searchable = input(false)` with an internal search field; always-on tool-use marker and summary — COMPLETE

- Files:
  - MODIFY `UI\provider-model-picker\provider-model-picker.component.ts`, `UI\provider-model-picker\provider-model-picker.component.spec.ts`
  - CREATE `UI\provider-model-picker\provider-model-search-field.component.ts`, `UI\provider-model-picker\provider-model-search-field.component.spec.ts` (not exported from the barrel)
- Plan reference: implementation-plan.md:457-484 (Component 9), D12
- Pattern to follow: `UI\autocomplete\native-autocomplete.component.ts:144-208`; `toolUseWarning()` `:467-472`
- Quality requirements:
  - All existing inputs, outputs and testids are unchanged.
  - New testids: `provider-model-picker-search`, `provider-model-picker-tooluse-summary`.
  - Filtering happens in a `computed`, capped at 50.
  - The picker stays under 700 counted lines.
- Validation notes:
  - With `searchable=false`, the `<select>` interaction is unchanged. Wording corrected after review: the
    per-option tool-use suffix and the summary line show in both modes, per the plan's "Always (both modes)"
    rule, so the markup is not byte-for-byte identical.
  - The memory-curator-ui and skill-synthesis-ui specs pass unchanged.
  - `dependency-boundaries.spec.ts` stays green.
- Implementation details: the pinned "not in catalog" option and the manual-entry `<details>` are kept.

### Batch 15 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/ui @ptah-extension/chat @ptah-extension/memory-curator-ui @ptah-extension/skill-synthesis-ui`
- Gate G if committed after Batch 16; review accepts.

## Batch 15b: autocomplete option-id prefix + reset active index on reopen (S3 follow-up) — COMPLETE (b8d720ba2)

- Recommended executor: CLI lane
- Fallback executor: frontend-developer (subagent)
- Execution mode: sequential
- Rationale:
  - The Batch 15 review found two defects in `NativeAutocompleteComponent`.
  - Fixed `suggestion-{i}` option ids collide when several searchable pickers are on one page. The drawer's three
    tier pickers (Batch 22), the Main Agent popover (Batch 26) and the matrix cells (Batch 30) do that, so the
    `aria-activedescendant`/`aria-controls` pairing breaks.
  - The keyboard active index is stale when the panel reopens.
  - This is a small, self-contained fix in `libs/frontend/ui`, file-disjoint from all work in flight.
- Review route: lane → subagent code-logic-reviewer
- Tasks: 1 | Depends on: Batch 15 (COMPLETE). Must be COMPLETE before Batches 22, 26 and 30.

### Task 15b.1: per-instance option-id prefix; reset the active index when the panel opens — COMPLETE

- Files:
  - MODIFY `UI\autocomplete\native-autocomplete.component.ts`, `UI\autocomplete\native-autocomplete.component.spec.ts`
  - MODIFY `UI\provider-model-picker\provider-model-search-field.component.ts` and its spec, only to use the
    instance prefix for `aria-controls` / `aria-activedescendant` (`:95, :148`)
- Plan reference: `batch-15-code-logic-review.md` (moderate findings 1-2)
- Pattern to follow: existing per-instance id generation in `libs/frontend/ui` (reuse it if one exists; otherwise a
  module-level counter)
- Quality requirements: existing consumers keep working unchanged. The prefix defaults to a generated unique value,
  so no consumer has to pass one.
- Validation notes:
  - A spec mounts two autocompletes and asserts that the option ids are disjoint and that each input's
    `aria-activedescendant` points into its own panel.
  - A spec closes and reopens the panel and asserts that the active index is reset (to the selected option when
    there is one, else none).
- Implementation details: `getActiveDescendantId()` returns the prefixed id.

### Batch 15b verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/ui @ptah-extension/chat @ptah-extension/memory-curator-ui @ptah-extension/skill-synthesis-ui`
- Gate G if committed after Batch 16; review accepts.

## Batch 16: harness baseline + reachability gate (S4) — COMPLETE (72ab2f4be)

- Recommended executor: senior-tester (subagent)
- Fallback executor: frontend-developer (subagent)
- Execution mode: sequential
- Rationale: it runs Playwright against the built bundle and freezes the baseline that gates every later batch.
- Review route: in-process → CLI-lane code-logic review (can each entry fail? `reach` must click through, not only
  check DOM presence)
- Tasks: 1 | Depends on: none (its baseline run executes on top of whatever has committed)

### Task 16.1: fixtures + `bootSettings`, the reachability table and spec frozen against the current page, and smoke captures — COMPLETE

- Files:
  - CREATE `HARNESS\settings.fixtures.ts`, `HARNESS\settings-reachability.table.ts`, `HARNESS\settings-reachability.e2e.spec.ts`
  - CREATE `HARNESS\settings-visual.e2e.spec.ts` (smoke captures only; fold assertions are added in Batches 28/36)
- Plan reference: implementation-plan.md:783-830 (Component 14), §6 (:1022-1095), §7 S4
- Pattern to follow:
  - `ROOT\libs\frontend\webview-e2e-harness\src\lib\scenarios\marketplace\marketplace.fixtures.ts` (stateful resolvers
    `:969-982`, `waitForAnimationsSettled :296`)
  - `marketplace-visual.e2e.spec.ts:57-73, 282-296`
- Quality requirements:
  - Reference data from `prototypes/BRIEF.md:44-69`, without the quota state (D11).
  - Every write resolver records its call and mutates the read-back state.
  - The table has one entry per parity "yes"/"partial" row (except #85), plus the 17 restored items (`pending`),
    plus #22/#83/#84.
  - Three rules are enforced: a count guard `EXPECTED_CAPABILITY_COUNT`, a frozen baseline list, and no
    present → pending regression.
  - The kept-selector check covers `settings-back`, `provider-connection-card`, `#providers-connections-heading`,
    `assignments-heading`, the 4 tab buttons by role and name, "Export settings" and
    `settings-toggle-web-search-provider`.
- Validation notes:
  - The report re-confirms D11 (`agent-process.types.ts:282-313`: no quota field).
  - No docs-shot or tour edits.
  - If the baseline run is red because of an earlier committed batch, report which one; it is fixed before this
    batch commits.
  - Split the fixtures per tab if they exceed 700 counted lines.
- Implementation details: captures go to `TASK\screenshots\angular\baseline-*`. The smoke scene becomes the per-batch
  smoke capture (execution default 9).

### Batch 16 verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/webview-e2e-harness`
- Gate G (baseline: every `present` entry green in both hosts; the count guard passes)
- Review accepts.

## Batch 17: save feedback service + toast (S5) — COMPLETE (2d11b9a34)

- Recommended executor: frontend-developer (subagent), the **Providers owner**. The same instance continues through
  Batch 28.
- Fallback executor: a new frontend-developer subagent that first reads Batches 17-28 and the prior reports
- Execution mode: sequential
- Rationale: plan §6 rule 2 (one owner per tab, no parallel lanes); the save path every later Providers batch uses.
- Review route: in-process → CLI-lane code-logic review
- Tasks: 1 | Depends on: Batches 8, 16

### Task 17.1: `SettingsSaveFeedbackService` + `SettingsToastComponent`, provided and rendered by `SettingsComponent` — COMPLETE

- Files:
  - CREATE `CHAT\feedback\settings-save-feedback.service.ts`, `CHAT\feedback\settings-save-feedback.service.spec.ts`
  - CREATE `CHAT\feedback\settings-toast.component.ts`, `CHAT\feedback\settings-toast.component.spec.ts`
  - MODIFY `CHAT\settings.component.ts`, `CHAT\settings.component.html`
- Plan reference: implementation-plan.md:526-551 (Component 11), D2, D3, D15
- Pattern to follow: the commit state `CORE\providers-settings-state.service.ts:56-71`
- Quality requirements:
  - One toast signal and one 8 s timer, cleared on replace, dismiss and `DestroyRef`.
  - `role="status"`/`"alert"`; testids `settings-toast`, `settings-toast-undo`.
  - Provide `PROVIDER_MODELS_LOADER` at `SettingsComponent`. `providers-settings.component.ts:33` keeps its
    duplicate until Batch 18.
- Validation notes:
  - Re-entry while saving shows "Another change is still saving." and does not call `write`.
  - Undo runs through `save()` with `undo:null`.
  - Failure toasts list the `unsaved`/`unconfirmed` field names, without Undo.
  - **Carry-forward from the Batch 8 review (moderate 1).** Since Batch 8, every commit command resolves `false`
    when it is refused because another save is in flight. The problem:
    - The 13 existing UI callers ignore that result and gate on the shared `commit()` status instead.
    - So a refused save can show the "Saved" of a different save. The worst case is
      `CHAT\providers\provider-consumer-assignments.component.ts:741-746`, which emits `assignmentSaved`.

    What this batch does:
    - The feedback service decides from the **per-call result** of `write()`. `false` → the "Another change is
      still saving." toast, and never a success toast.
    - It reads `commit()` only after a `true` result.
    - A spec pins this: a refused `write` resolving `false` while `commit()` shows an earlier `saved` must not
      produce a success toast or an Undo.
    - Every caller this batch or a later batch routes through the service inherits the fix. The Batch 35 restyle of
      `provider-consumer-assignments.component.ts` must drop its `commit()`-status gate for `assignmentSaved` in
      favour of the per-call result.
- Implementation details: the toast is derived from `state.commit()` after the awaited write.

### Batch 17 verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview --parallel=2`
- `npx nx run-many -t test -p <same projects> --parallel=2 -- --maxWorkers=2` (the jest passthrough goes on the
  `test` command only; on `typecheck` it fails with TS5023, execution default 11)
- Gate G; smoke captures attached; review accepts.

## Batch 17b: smoke captures stop overwriting the baseline images (S4 follow-up) — COMPLETE (41fbce284)

- Recommended executor: frontend-developer (the Providers owner, between Batches 17 and 18), or senior-tester
- Fallback executor: antigravity CLI lane
- Execution mode: sequential
- Rationale:
  - The Batch 16 smoke spec writes its per-batch captures over `screenshots\angular\baseline-*.png`, which
    destroys the "before" images the visual gates need. The Providers owner found it in Batch 17; the orchestrator
    restored the 8 files byte-for-byte from 72ab2f4be.
  - It is kept as its own one-file batch rather than added to Batch 18, because Batch 18 is already the 8-file D14
    exception.
  - It is file-disjoint from Batch 17 and must land **before Batch 18 runs any smoke capture**.
- Review route: in-process author → antigravity when available, otherwise a same-side subagent (disclosed)
- Tasks: 1 | Depends on: Batch 16 (COMPLETE). Must be COMPLETE before Batch 18.

### Task 17b.1: capture file names by purpose — COMPLETE

- Files:
  - MODIFY `HARNESS\settings-visual.e2e.spec.ts`
- Plan reference: implementation-plan.md §6 (captures to `screenshots/angular/`); execution default 9
- Pattern to follow: the existing capture helper in the same spec
- Quality requirements:
  - The default name is `current-{tab}-{host}-{theme}-1024x768.png`.
  - `baseline-{tab}-{host}-{theme}-1024x768.png` is written only when `process.env.SETTINGS_CAPTURE_BASELINE === '1'`.
  - No other behaviour change.
  - Batches 28 and 36 later add the fold assertions to this same spec. Keep the naming helper small and reusable.
- Validation notes:
  - Run the smoke spec once without the flag. The 8 `baseline-*.png` files must be byte-identical to 72ab2f4be
    (`git status` shows them unmodified), and 8 `current-*.png` files must appear.
  - Whether `current-*` captures get committed is the team-leader's decision per batch: they are the per-batch smoke
    evidence, and they are committed with the batch that produced them.
- Implementation details: none beyond the above.

### Batch 17b verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/webview-e2e-harness`
- The smoke spec runs green, with the baselines unmodified
- Gate G; review accepts.

## Batch 18: shell + interim Orchestration container (S5) — COMPLETE (b16102327) — EXCEPTION (9 files, D14 atomic move)

- Recommended executor: Providers owner (frontend-developer)
- Fallback executor: as Batch 17
- Execution mode: sequential
- Rationale:
  - Moving the background assignments and `<ptah-cli-config>` off Providers and onto Orchestration must happen in
    one commit (D14).
  - The Providers spec, the shell spec and the reachability entries change with that move, so they belong to the same
    commit.
- Review route: in-process → CLI-lane code-logic review
- Tasks: 1 | Depends on: Batches 17, 17b, 12

### Task 18.1: header, tab bar, deep-link routing rows available now, #84 re-detect, interim `OrchestrationSettingsComponent` — COMPLETE

- Files:
  - MODIFY `CHAT\settings.component.ts`, `CHAT\settings.component.html`, `CHAT\settings.component.spec.ts`
  - CREATE `CHAT\ptah-ai\orchestration-settings.component.ts`, `CHAT\ptah-ai\orchestration-settings.component.spec.ts`
  - MODIFY `CHAT\providers\providers-settings.component.ts`, `CHAT\providers\providers-settings.component.spec.ts`
  - MODIFY `HARNESS\settings-reachability.table.ts` (re-point the moved entries)
  - MODIFY `HARNESS\settings-reachability.e2e.spec.ts`, 3 lines: each kept selector is asserted on the tab that hosts
    it. This is the **9th file, a D14 exception accepted by the orchestrator**: it must land in the same commit as the
    move, or Gate G goes red. The team-leader confirmed that no kept selector was dropped and that no status, count or
    baseline line changed.
- Plan reference:
  - implementation-plan.md:486-524 (Component 10), :559-579 (interim container), D9, D14
  - review round 2 N2/N3 (:1285-1286)
- Pattern to follow: `settings.component.ts:143-149` (`applyPendingTab`); `providers-settings.component.ts:206-211` (the moved mounts)
- Quality requirements:
  - Header: "Workspace: {name} · App: {Desktop|VS Code}".
  - Tab buttons stay `<button>` with the same names; all four are enabled (D9).
  - `settings-back` is kept.
  - Remove the `viewChild` and call `state.redetectClis()` from `onModelChanged()`.
- Validation notes:
  - Routing rows in this batch: `providerId` → wizard; `connections` → focus heading; background-role sections →
    Orchestration + `initialEditingConsumerId`; `cli-agents` → `#providers-cli-heading`; no-section.
  - `main-*` rows land in Batch 26 and `more-providers` in Batch 27. Until then, those rows keep today's behaviour.
  - The interim container calls `state.open()` once on a standalone mount.
  - The shell spec proves that a direct Orchestration landing opens the state without mounting Providers.
  - The #84 re-detect-from-Advanced case is covered.
- Implementation details: the interim container renders the old AOC, `ProviderConsumerAssignmentsComponent` and
  `PtahCliConfigComponent` unchanged, and forwards `focusTarget`.

### Batch 18 verification

- Same command as Batch 17; Gate G (moved entries green on Orchestration); smoke captures; review accepts.

## Batch 19: pure derivations — connection kind + usage (S5) — COMPLETE (a28c6b851)

- Recommended executor: Providers owner
- Fallback executor: as Batch 17
- Execution mode: sequential
- Rationale: pure functions consumed by the drawer, split out to keep Batch 20 within the cap. There is no component,
  so the unmounted rule does not apply.
- Review route: in-process → CLI-lane code-logic review
- Tasks: 1 | Depends on: Batch 18

### Task 19.1: `connectionKind()` and `connectionUsage()` — COMPLETE

- Files:
  - CREATE `CHAT\providers\connection-drawer\connection-kind.ts`, `CHAT\providers\connection-drawer\connection-kind.spec.ts`
  - CREATE `CHAT\providers\connection-usage.ts`, `CHAT\providers\connection-usage.spec.ts`
- Plan reference: implementation-plan.md:637-640, :673-677; design-spec §2.3
- Pattern to follow: `CHAT\providers\provider-consumer-assignments.component.ts:37-139` (pure helper style)
- Quality requirements: inapplicable tabs are excluded per kind (claude-cli, api-key, oauth, custom, local).
- Validation notes: usage sources are the driver, the curator, lanes (empty = follows main), the judge and
  `cliAgents[].providerId`. System CLIs are excluded (ASSUMPTION recorded in the plan).
- Implementation details: returns `{providerId → readonly UsedBy[]}`.

### Batch 19 verification

- Same command as Batch 17; Gate G; review accepts.

## Batch 20: connection drawer + Overview tab (S5) — COMPLETE (36384ace1)

- Recommended executor: Providers owner
- Fallback executor: as Batch 17
- Execution mode: sequential
- Rationale: the drawer is mounted and reachable from today's card `manageRequested` before the card is compacted,
  so no card action is lost in between (D14).
- Review route: in-process → CLI-lane code-logic review
- Tasks: 1 | Depends on: Batches 19, 14

### Task 20.1: `ConnectionDetailDrawerComponent` + `OverviewTabComponent`, opened from the existing card — COMPLETE (36384ace1)

- Files:
  - CREATE `CHAT\providers\connection-detail-drawer.component.ts`, `CHAT\providers\connection-detail-drawer.component.spec.ts`
  - CREATE `CHAT\providers\connection-drawer\overview-tab.component.ts`, `CHAT\providers\connection-drawer\overview-tab.component.spec.ts`
  - MODIFY `CHAT\providers\providers-settings.component.ts`
- Plan reference: implementation-plan.md:637-667; design-spec §2.3; `prototypes/final/index.html` (drawer)
- Pattern to follow:
  - drawer `UI\drawer\native-drawer.component.ts:175-205` (`widthClass="w-full max-w-md"`)
  - tab group `UI\tab-group\native-tab-group.component.ts:51-66`
- Quality requirements:
  - `data-testid="connection-detail-drawer"`.
  - The drawer content is per connection (Gate 1.7 known prototype defect).
  - The footer holds a per-tab primary action only (deviation 3).
  - Esc closes the drawer and focus returns to the trigger.
  - Per-tab skeleton with `aria-busy`.
- Validation notes: Overview holds the status, "Check connection", the Used-by list, and "Follows main agent →" chips
  that deep-link to Orchestration.
- **Used-by states (from the Batch 19 decisions):** `connectionUsage()` returns `{ byProvider, complete }`.
  - While `complete` is false, the Used-by list shows "Loading…" (with `aria-busy`), never an empty state.
  - "Not used yet" is shown only when `complete` is true and the provider has no entries.
  - A spec covers all three: incomplete, complete-and-empty, complete-with-entries.
  - System CLIs are not listed (orchestrator decision; see the Batch 19 log row).
- Implementation details: the tabs render from `connectionKind`.

### Batch 20 verification

- Same command as Batch 17; Gate G; smoke captures; review accepts.

## Batch 21: drawer Credentials tab (S5) — COMPLETE (2cb1a107a)

- Recommended executor: Providers owner
- Fallback executor: as Batch 17
- Execution mode: sequential
- Review route: in-process → CLI-lane code-logic review
- Tasks: 1 | Depends on: Batches 20, 13

### Task 21.1: masked key + show/hide, Replace (verify-then-save), Delete key, Copilot sign-out, Codex/claude-cli/Ollama copy — COMPLETE (2cb1a107a)

- Files:
  - CREATE `CHAT\providers\connection-drawer\credentials-tab.component.ts`, `CHAT\providers\connection-drawer\credentials-tab.component.spec.ts`
  - MODIFY `CHAT\providers\connection-detail-drawer.component.ts`
  - MODIFY `HARNESS\settings-reachability.table.ts` (flip #7, #8, #12, #49 and RUX-1/-4/-10 to `restored`)
- Plan reference: implementation-plan.md:645-658; §3 rows 882-884; §4 rows #7/#8/#12/#49; D4
- Pattern to follow: the wizard's `verifyDraftConnection` callback (`providers-settings.component.ts:457-462`)
- Quality requirements:
  - The key input clears on destroy.
  - Delete uses an inline confirm; on the active driver it warns that new requests fail until a key is added.
  - The `anthropic` Replace rule follows plan :649-652.
- Validation notes: Replace with a failed verify leaves Save disabled, shows reason and latency, and persists nothing.
- **Carry-forward from Batch 20 (36384ace1):** the prototype shows a per-connection probe latency ("92ms") in the
  Overview status and a non-secret key hint ("•••• 8f21"). Neither is in the state contract (`EffectiveRouteProvider`
  has no latency, `rpc-auth.types.ts:214-276`; `ProvidersConnection` has only `hasKey`,
  `providers-settings.types.ts:132-144`). Put the question to the orchestrator before this batch starts: a small
  core/shared contract change (latency kept per connection; a last-4 hint that is never the secret), or no change and
  a **flagged deviation for the user at Gate V** (Batch 28). The Credentials masked-key display depends on the answer.
- Implementation details: Replace → `connectProvider({activation:'connect-only'})`; Delete → `deleteStoredKey`;
  Sign out → `disconnectCopilot`.

### Batch 21 verification

- Same command as Batch 17; Gate G (the flipped entries green); captures. The per-batch code review was dropped by the
  user decision of 2026-09-30. The Glm-lane review that was already running is still in flight; its findings go to
  Batch 22.

## Batch 22: drawer Models & Tiers + Advanced tabs (S5) — COMPLETE (bb4502d59)

- Recommended executor: Providers owner
- Fallback executor: as Batch 17
- Execution mode: sequential
- Review route: no per-batch code review (user decision 2026-09-30); commits after typecheck/test/lint, Gate G and captures. The cross-side code review is combined at Gate V 28 (Providers diff 21-28)
- Tasks: 1 | Depends on: Batches 21, 15, 15b
- **Carry-in from Batch 21 (2cb1a107a):** the Glm-lane code review of Batch 21 was still in flight at commit. When
  `TASK\batch-21-code-logic-review.md` arrives, fix its accepted findings in this batch, list them in the Batch 22
  report, and commit the review file with this batch.

### Task 22.1: tier pickers saved on selection with Undo; custom base URL / models endpoint (verified), help URL, pricing, delete connection — COMPLETE (bb4502d59)

- Files:
  - CREATE `CHAT\providers\connection-drawer\models-tiers-tab.component.ts`, `CHAT\providers\connection-drawer\models-tiers-tab.component.spec.ts`
  - CREATE `CHAT\providers\connection-drawer\advanced-tab.component.ts`, `CHAT\providers\connection-drawer\advanced-tab.component.spec.ts`
  - MODIFY `CHAT\providers\connection-detail-drawer.component.ts`
  - MODIFY `HARNESS\settings-reachability.table.ts` (flip #25, #27, #28, #30, #34, #38 and RUX-2)
- Plan reference: implementation-plan.md:659-665; §3 rows 881, 885-889; D7
- Pattern to follow: Batch 17's feedback service for save-on-selection
- Quality requirements:
  - The pricing note reads verbatim "Stored for your reference; Ptah does not use it for cost estimates yet."
  - Help URL and pricing are rendered by interpolation only.
  - Delete of the active custom driver is blocked.
- Validation notes: the models-endpoint gate refuses an unverified probe. Tier Undo performs a second real write.
- Implementation details: pickers use `[searchable]="true"`; custom model ID entry is kept (#35).
- **Constraint from the Batch 17 review (`batch-17-code-logic-review.md:36`):** every
  `SettingsSaveFeedbackService.save({write, undo})` call passes a `ProvidersSettingsStateService` save method (or a
  closure that only calls one) as `write` and `undo`. A custom `write` that resolves `true` without updating
  `commit()` would be reported as a success using a stale commit. The spec asserts which state method each control
  calls.

### Batch 22 verification

- Same command as Batch 17; Gate G; captures attached. No per-batch code review (combined at Gate V 28).

## Batch 23: scope badge with field name (S5) — COMPLETE (65b8a9fa0)

- Recommended executor: Providers owner
- Fallback executor: as Batch 17
- Execution mode: sequential
- Review route: no per-batch code review (user decision 2026-09-30); commits after typecheck/test/lint, Gate G and captures. The cross-side code review is combined at Gate V 28 (Providers diff 21-28)
- Tasks: 1 | Depends on: Batch 22

### Task 23.1: `SettingScopeRowComponent` becomes a badge (nothing when inherited) + popover; D16 field name — COMPLETE (65b8a9fa0)

- Files:
  - MODIFY `CHAT\providers\setting-scope-row.component.ts`, `CHAT\providers\setting-scope-row.component.spec.ts`
  - MODIFY `CHAT\providers\providers-settings.component.ts` (pass `shortFieldName`)
  - MODIFY `HARNESS\settings-reachability.table.ts` (re-point the scope entries; RUX-5/-6)
- Plan reference: implementation-plan.md:610-626; D16; §3 row 880
- Pattern to follow: popover `UI\popover\native-popover.component.ts:116-159`, with `backdropClass="transparent"`
- Quality requirements:
  - `data-testid="scope-badge"` with a non-empty `data-field`.
  - Badge text "{short} · {Workspace|App}"; the popover header names the field.
  - Selector, inputs and outputs are unchanged.
- Validation notes: clearing `authMethod`/`anthropicProviderId`/`provider.*` keeps the review-then-confirm with the
  "ends running chat sessions" copy and no Undo (D6).
- Implementation details: `shortFieldName = input<string|null>(null)`, falling back to `fieldName`.

### Batch 23 verification

- Same command as Batch 17; Gate G; captures attached. No per-batch code review (combined at Gate V 28).

## Batch 24: compact connection card (S5) — COMPLETE (7f1742f4d) (+ visual drift checkpoint: structure matches, orchestrator)

- Recommended executor: Providers owner
- Fallback executor: as Batch 17
- Execution mode: sequential
- Rationale: the card actions move into the drawer, which is complete after Batch 22, so D14 holds.
- Review route: no per-batch code review (user decision 2026-09-30); commits after typecheck/test/lint, Gate G and captures. The cross-side code review is combined at Gate V 28 (Providers diff 21-28), **plus** a visual-reviewer drift checkpoint (card and grid
  structure vs `prototypes/final/`, both themes; structural drift only)
- Tasks: 1 | Depends on: Batch 23

### Task 24.1: card ≤ 80 px, clickable → `detailsRequested`, at most one inline action; state table extracted — COMPLETE (7f1742f4d)

- Files:
  - REWRITE `CHAT\providers\provider-connection-card.component.ts`, `CHAT\providers\provider-connection-card.component.spec.ts`
  - CREATE `CHAT\providers\provider-connection-card.state.ts`, `CHAT\providers\provider-connection-card.state.spec.ts`
  - MODIFY `CHAT\providers\providers-settings.component.ts` (wire `detailsRequested`, `usedByCount`, grid classes)
  - MODIFY `HARNESS\settings-reachability.table.ts` (re-point the card-action entries to the drawer)
- Plan reference: implementation-plan.md:627-636; RUX-4/-7
- Pattern to follow: `UI\card\native-card.component.ts:100-101, 156, 178, 213-243` (clickable + activated)
- Quality requirements:
  - Every existing input and output is kept, including `manageRequested`.
  - Testids `provider-connection-card`, `provider-name`, `status-copy`, `auth-modality` are kept.
  - Colour goes on the dot and badge only; text stays `text-base-content` (D13).
  - The card file is under 700 counted lines.
- Validation notes: the grid is `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3`. Card height is measured in the smoke
  capture.
- Implementation details: the `ResolvedConnectionState` derivations move to `.state.ts` as pure functions.

### Batch 24 verification

- Same command as Batch 17; Gate G; drift checkpoint returns no structural drift; captures attached. No per-batch code review (combined at Gate V 28).

## Batch 25: routing map + nodes (S5) — COMPLETE (08c64663a)

- Recommended executor: Providers owner
- Fallback executor: as Batch 17
- Execution mode: sequential
- Rationale: the map mounts above the existing main-agent section. The Main Agent node reuses the existing controls
  until Batch 26 replaces them (D14).
- Review route: no per-batch code review (user decision 2026-09-30); commits after typecheck/test/lint, Gate G and captures. The cross-side code review is combined at Gate V 28 (Providers diff 21-28)
- Tasks: 1 | Depends on: Batch 24

### Task 25.1: `RoutingMapComponent` + `RoutingMapNodeComponent` — COMPLETE (08c64663a)

- Files:
  - CREATE `CHAT\providers\routing-map.component.ts`, `CHAT\providers\routing-map.component.spec.ts`
  - CREATE `CHAT\providers\routing-map-node.component.ts`, `CHAT\providers\routing-map-node.component.spec.ts`
  - MODIFY `CHAT\providers\providers-settings.component.ts`
- Plan reference: implementation-plan.md:585-595; design-spec §2.1/§3.1
- Pattern to follow: `prototypes/final/index.html` routing map
- Quality requirements:
  - Testids `routing-map`, `routing-node-main-agent|background-roles|cli-agents`.
  - Status dots are always paired with text.
  - The "Operational" badge reflects `route.ready`.
  - Each node has a skeleton while its section is loading.
- Validation notes: the Background and CLI nodes call `requestSettingsTab({tab:'orchestration', section:…})` and land
  as routed in Batch 18.
- Implementation details: the Background preview shows the 2 explicit roles plus "N follow main agent". The CLI preview
  shows the first 4 in preferred order plus counts.

### Batch 25 verification

- Same command as Batch 17; Gate G; smoke captures; captures attached. No per-batch code review (combined at Gate V 28).

## Batch 26: Main Agent popover (S5) — COMPLETE (78b26e4ec)

- Recommended executor: Providers owner
- Fallback executor: as Batch 17
- Execution mode: sequential
- Rationale: the old main-agent section is removed in the same commit that mounts the popover (D14).
- Review route: no per-batch code review (user decision 2026-09-30); commits after typecheck/test/lint, Gate G and captures. The cross-side code review is combined at Gate V 28 (Providers diff 21-28); focus for it: write-path rows 877-879
- Tasks: 1 | Depends on: Batches 25, 15, 15b

### Task 26.1: provider (confirm, no Undo), model and effort (save on selection + Undo), Save-to, Check connection; `main-*` routing rows — COMPLETE (78b26e4ec)

- Files:
  - CREATE `CHAT\providers\main-agent-reassign-popover.component.ts`, `CHAT\providers\main-agent-reassign-popover.component.spec.ts`
  - MODIFY `CHAT\providers\providers-settings.component.ts` (remove the old main-agent block; the node opens the popover)
  - MODIFY `CHAT\settings.component.ts`, `CHAT\settings.component.spec.ts` (`main-agent|main-model|main-effort` rows)
  - MODIFY `HARNESS\settings-reachability.table.ts`
- Plan reference: implementation-plan.md:596-609; D6; §3 rows 877-879; `providers-settings.component.ts:425-441, 510-527`
- Pattern to follow: Batch 23 popover usage (`backdropClass="transparent"`, `placement="bottom-start"`)
- Quality requirements:
  - Provider change copy: "New main-agent requests use {name}. Changing the provider ends running chat sessions."
  - The uncheckable note is kept.
  - Triggers are disabled while saving.
  - Save-to lists only `writeScopes`.
  - **D14 carry-forward from Batch 23 (65b8a9fa0):** remove the interim "Save provider to…" button
    (`data-testid="main-provider-save-to"`, `providers-settings.component.ts:95-101`) in this batch, when the popover's
    provider Save-to replaces that block. Re-point harness #16 and RUX-5 (they reach the Save-to list through that
    button today) to the popover's Save-to in the same commit, and drop the two parent specs that pin the button.
  - **Bundle budget (from Batch 23):** the initial bundle is ~13 kB under the 3.5 MB error budget. The popover must
    load in a `@defer` block (or otherwise not grow the initial bundle); report the initial total before and after.
- Validation notes: a workspace switch mid-edit gives a `blocked` toast, and the popover stays open with fresh values.
- Implementation details: model → `saveSettings({model:{model, applyTo}})`; effort from `effortLevels` plus "Provider
  default".
- **Constraint from the Batch 17 review (`batch-17-code-logic-review.md:36`):** every
  `SettingsSaveFeedbackService.save({write, undo})` call passes a `ProvidersSettingsStateService` save method (or a
  closure that only calls one) as `write` and `undo`. A custom `write` that resolves `true` without updating
  `commit()` would be reported as a success using a stale commit. The spec asserts which state method each control
  calls.

### Batch 26 verification

- Same command as Batch 17; Gate G; captures attached. No per-batch code review (combined at Gate V 28).
- `npx nx build ptah-extension-webview` reports **no budget error** (a budget error fails the batch); the initial
  total does not grow beyond the Batch 23 figure except by a documented, deferred-loaded amount.
- `main-provider-save-to` is gone from the tree (grep), and #16 / RUX-5 stay green through the popover.

## Batch 27: provider catalog modal (S5) — COMPLETE (4c1ce8045)

- Recommended executor: Providers owner
- Fallback executor: as Batch 17
- Execution mode: sequential
- Review route: no per-batch code review (user decision 2026-09-30); commits after typecheck/test/lint, Gate G and captures. The cross-side code review is combined at Gate V 28 (Providers diff 21-28)
- Tasks: 1 | Depends on: Batches 26, 14

### Task 27.1: `ProviderCatalogModalComponent` on `NativeModalComponent size="lg"`; `more-providers` routing row — COMPLETE (4c1ce8045)

- Files:
  - CREATE `CHAT\providers\provider-catalog-modal.component.ts`, `CHAT\providers\provider-catalog-modal.component.spec.ts`
  - MODIFY `CHAT\providers\providers-settings.component.ts`
  - MODIFY `CHAT\settings.component.ts`, `CHAT\settings.component.spec.ts`
  - MODIFY `HARNESS\settings-reachability.table.ts` (RUX-3)
- Plan reference: implementation-plan.md:668-672; `providers-settings.component.ts:224-226, 342-345`
- Pattern to follow: Batch 14 modal
- Quality requirements:
  - `data-testid="provider-catalog-modal"`.
  - The empty search shows "No matching providers" plus Clear.
  - "Sign in to X" is kept for OAuth/CLI entries.
- Validation notes: `providerChosen` → close, then `openWizard(id)`; "Custom endpoint" → `openWizard('')`. The wizard
  is unchanged.
- Carry-forward from the Batch 2b review (moderate, pre-existing): a custom-provider load failure at startup is still
  indistinguishable from having no custom providers. Two cases:
  - If the state already exposes a read error for the provider list (a section in `error`, or a
    `provider:listCustomEntries` failure), the catalog modal shows "Custom providers could not be loaded. Your saved
    settings have not changed." with "Retry", instead of an empty list. A spec covers it.
  - If the state exposes no such signal, record that in the report. Do not add a backend field in this batch; it
    becomes a follow-up.
- Carry-forward from the Batch 14 review (finding 3; jsdom cannot test the native focus trap): this is the first
  `NativeModalComponent` mount in the real page. A Playwright scene (in the reachability spec now, moved into
  `settings-providers.e2e.spec.ts` in Batch 28) must assert:
  - opening the catalog modal moves focus into the dialog
  - Tab stays inside it
  - Esc and backdrop close it
  - focus returns to the "Connect provider" opener
- Implementation details: the list is the unconfigured `catalog()` computed.
- **Bundle budget (from Batch 23):** the initial bundle is ~13 kB under the 3.5 MB error budget. The catalog modal
  must load in a `@defer` block (or otherwise not grow the initial bundle); report the initial total before and after.

### Batch 27 verification

- Same command as Batch 17; Gate G; captures attached. No per-batch code review (combined at Gate V 28).
- `npx nx build ptah-extension-webview` reports **no budget error** (a budget error fails the batch).

## Batch 27b: host-correct scope layers and Save-to targets (S5 follow-up) — COMPLETE (9bf09cbf7)

- Recommended executor: Providers owner (in-process frontend-developer)
- Fallback executor: as Batch 17
- Execution mode: sequential
- Rationale: degradation found in Batch 23 (report deviation 6): in the VS Code host the scope popover shows a
  "Desktop app" layer and every Save-to list offers a "Desktop app" target. The user's standing rule is to fix every
  degradation found, and the plan's edge case "Unsupported runtime: Save-to lists only `writeScopes(key)`" requires the
  targets to match the running host.
- Review route: no per-batch code review (user decision 2026-09-30); commits after typecheck/test/lint, Gate G and
  captures. Covered by the combined Providers review at Gate V 28.
- Tasks: 1 | Depends on: Batch 27

### Task 27b.1: `writeScopes(key)` and the shown scope layers match the running host — COMPLETE (9bf09cbf7)

- **Outcome (root-cause step, `batch-27b-report.md`):** the App layer is real in VS Code (`app.vscode.*`), so the
  target is kept and named after the host ("VS Code" / "Desktop app") through `CHAT\providers\app-scope-label.ts`.
  `writeScopes` is unchanged; its spec pins that `app` is not filtered. **Orchestrator decision (accepted, shown to
  the user at Gate V 28):** keep the App target in VS Code, labelled "VS Code".

- Files (expected; confirm after the root-cause step):
  - MODIFY `CORE\providers-settings-state.service.ts` (`writeScopes`, `:540-548`, filters only `workspace`; it passes
    the key's `supportedTargets` through, so `app` is offered in VS Code) and its spec
  - MODIFY `CHAT\providers\setting-scope-row.component.ts` (+ spec) if the popover layer list does not already derive
    from a host-aware source
  - MODIFY `HARNESS\settings-reachability.table.ts` / `HARNESS\settings.fixtures.ts` only if a per-host assertion is
    needed there
- Plan reference: implementation-plan.md §5 edge case "Unsupported runtime"; D16; batch-23-report.md deviation 6
- Pattern to follow: the existing `workspace` filter in `writeScopes` (`:544-546`)
- **Root-cause step first:** find where `supportedTargets` for these keys comes from (`config:getScopes`,
  `config-scope-rpc.handlers.ts`, and the host's `appScopable`) and whether the webview already knows the host
  (e.g. the header "App: Desktop|VS Code"). **If the root cause is in a backend or RPC contract (the host returns
  `app` as a supported target where it cannot be written or read), the owner stops and reports with file:line
  evidence; no backend edit in this batch.** The team-leader then returns it to the orchestrator.
- Quality requirements:
  - In VS Code: no "Desktop app" layer in the scope popover and no "Desktop app" option in any Save-to list
    (main-agent provider/model/effort and every other `writeScopes` consumer).
  - In Electron: the App layer and target are unchanged.
  - A spec per host (VS Code and Electron) on the state service, plus a component spec for the popover layers.
  - Nothing a user already stored at the App scope becomes invisible: if a VS Code user has an App-layer value,
    report how it is shown (it must not silently disappear).
  - **Harness (from Batch 26):** RUX-5 asserts the popover's Save-to options are exactly
    `['Global · all apps', 'Desktop app', 'This workspace']` in **both** hosts, and #16 asserts 3 options
    (`settings-reachability.table.ts:375-383`, `:827-836`). Make both host-aware in this batch: VS Code without
    "Desktop app", Electron unchanged.
- Write-path trace (in the report): for each Save-to target removed or kept, control → state method → RPC →
  store key / scope → runtime reader, per host; confirm that the VS Code runtime never reads the App layer that
  was being offered (or show that it does, which would change the fix).

### Batch 27b verification

- Same command as Batch 17; Gate G (both hosts); captures of the scope popover and a Save-to list in both hosts.
- `npx nx build ptah-extension-webview` reports no budget error.

## Batch 28: Providers composition + Gate V (Providers) (S5) — COMPLETE (3fa94f02d)

- Recommended executor: Providers owner, then the visual-reviewer subagent for the gate
- Fallback executor: as Batch 17
- Execution mode: sequential
- Rationale: final order and density, the Providers interaction scenes and the fold assertions. This is the tab gate.
- Review route: the **combined cross-side code review** of the whole Providers diff (Batches 21-28; Batch 21’s Glm-lane findings arrive through Batch 22) (user decision 2026-09-30) **and** a visual-reviewer PASS (`TASK\visual-review.md`,
  Providers section; same-side reason disclosed)
- Tasks: 1 | Depends on: Batch 27b

### Task 28.1: page order per prototype, header count and filter, #22 line, hint strip, removals; Providers scenes and fold assertions — COMPLETE (3fa94f02d)

- Files:
  - MODIFY `CHAT\providers\providers-settings.component.ts`, `CHAT\providers\providers-settings.component.spec.ts`
  - CREATE `HARNESS\settings-providers.e2e.spec.ts`
  - MODIFY `HARNESS\settings-visual.e2e.spec.ts` (the Providers half: fold, card height, grid columns, D16 badge check,
    captures)
  - MODIFY `HARNESS\settings-reachability.table.ts` (every Providers-owned restored item is `restored`)
- Plan reference: implementation-plan.md:553-583, §6 (:1042-1064), §7 S5 (:1141); D10, D11
- Pattern to follow: `ROOT\libs\frontend\webview-e2e-harness\src\lib\scenarios\marketplace\marketplace-visual.e2e.spec.ts`
- Quality requirements:
  - Removed: the `<h1>Providers</h1>` block and "Refresh settings". #21 Reload is absent (asserted in the spec).
  - #22 is one `text-[11px]` line.
  - The read-error "Retry {label}" lives per region.
  - The `ProviderSetupWizardComponent` diff is empty.
- Validation notes: scenes to cover:
  - card → drawer for each kind (claude-cli, api-key, oauth, custom)
  - delete key emits `auth:deleteStoredKey`
  - Copilot sign-out
  - catalog → wizard
  - popover model save → toast → Undo emits a 2nd `config:model-switch`
  - provider change needs a confirm
  - deep-link `main-model` opens the popover
  - the popover search filters models
- Implementation details: fold at 1024×768 in both hosts and both themes:
  - `scrollY === 0`
  - the bottoms of tabs, routing map, connections heading and 5th card are ≤ 660 px
  - every card is ≤ 80 px
  - 3 columns at 1024 px, ≥ 2 at 800 px
  - an Electron-only failure is escalated (Q-extra-1)
- **Carry-forwards from Batch 20 (36384ace1), for the Gate V composition and `visual-review.md`:**
  - The prototype's drawer backdrop is darker and blurs the page; ours is `bg-black/50` with no blur. It is owned by
    `NativeDrawerComponent` (`libs/frontend/ui`), so a change there is a ui-owner change: decide it here (in scope as
    one extra file, or recorded as a deviation).
  - Accepted deltas to record in the visual review, not to re-flag as defects: drawer width `max-w-lg` (prototype
    32rem); computed initials "MK"/"SO" vs the prototype's hand-written "KM"/"SV"; Overview has no footer primary
    action (Check connection is in the status card).
  - Latency "92ms" and key hint "•••• 8f21": Batch 21 decided on **no contract change**. List both as a **flagged
    deviation for the user** at this gate: no key hint, because it would send part of the secret across RPC; no
    Overview latency, because the draft-probe latency shows only in the Credentials Replace check.
- **ORCHESTRATOR DECISION (2026-09-30) for Q-extra-1 (Electron card height, measured in Batch 24):** this is the
  default and is shown to the user at Gate V 28; the user may override it.
  - Measured in Batch 24: VS Code cards are 80 px at 269 px width (3 columns). In Electron the Settings page is about
    670 px wide, and with 3 columns the cards are 215 px wide and 100-111 px tall.
  - Decision: the connections grid picks its column count from the **container width**, not the viewport
    breakpoints. Use, for example, `grid-cols-[repeat(auto-fill,minmax(<card min>,1fr))]`, or container queries.
    VS Code keeps 3 columns at 1024 px. Electron's ~670 px content gets 2 columns with 80 px cards.
  - The fold budget (≤ 660 px bottoms, every card ≤ 80 px) is **not changed**. The Task 28.1 "3 columns at 1024 px"
    line applies to the VS Code host; Electron asserts 2 columns at its content width.
  - After this change, `settings-visual.e2e.spec.ts` asserts the **80 px card height in both hosts**. Batch 24's spec
    asserts it for VS Code only and logs the Electron numbers.
  - Batch 24 options (2) "Use as main" label and (3) accept 100-111 px are not taken unless the user chooses them.
- **Carry-forwards from Batch 27b (host-correct scope labels, 9bf09cbf7, `batch-27b-report.md`):**
  - **DEFECT to fix in this batch (report deviation 6):** in
    `current-scope-popover-electron-anubis-light-1024x768.png` the CLI node's "4 enabled" badge paints **over** the
    open scope popover (on the workspace row). Fix the stacking order between the routing-map node badges (Batch 25,
    `routing-map*.component.ts`) and `NativePopoverComponent` so an open popover is always on top, in both hosts and
    both themes; assert it in the visual spec (e.g. `elementFromPoint` on the popover's rows returns a popover
    descendant).
  - **RUX-5 and #18 are now host-aware** (`expectHostAppScope` in `settings-drawer.reach.ts`): RUX-5 expects
    `['Global · all apps', <host>, 'This workspace']` with `<host>` = "VS Code" or "Desktop app", and the other host's
    name absent. #16 keeps 3 options in both hosts. Keep this when the scenes move to `settings-providers.e2e.spec.ts`.
  - **FLAGGED for the user at Gate V 28: "VS Code App layer label".** The orchestrator accepted keeping the App target
    in VS Code, labelled "VS Code" (Electron keeps "Desktop app"), because VS Code reads and writes `app.vscode.*` and
    the chat pickers default to it. The alternative (hide the App layer in VS Code) is a product decision that needs a
    plan for existing `app.vscode.*` values and a backend default-target change.
  - Record in the visual review, not a defect: the badge text stays "{short} · App" in both hosts (D16); the host
    name appears in the popover. Global wording is still inconsistent across surfaces ("Global · all Ptah apps"
    popover layer, "Global · all apps" Save-to, "All Ptah apps" toast), pre-existing; decide at Gate V 28.
- **Carry-forwards from Batch 27 (catalog modal, `batch-27-report.md`), for the composition and Gate V list:**
  - **Hint-strip layout delta (orchestrator capture check):** "Browse catalog →" sits *under* the hint text. In
    `prototypes/final/screenshots/index-anubis-1024x768.png` it is right-aligned on the same line as "N catalog
    providers ready to add: …". Fix it in this batch's composition: one row, text left and link right, truncating the
    names and not wrapping. Also place the strip directly under the grid; today it follows the clear-override review
    section, which is directly below the grid only while that section is closed.
  - Deviations to record in the visual review:
    - **The openers are always enabled.** "Connect provider", the tile and "Browse catalog" open the modal even when
      setup cannot start, so the Batch 2b load error with Retry stays reachable. Inside the modal, Connect and Configure
      carry the `canSetUp` gate.
    - **Batch 2b carry-forward handled:** `state.connections()` `error` shows "Custom providers could not be loaded.
      Your saved settings have not changed." with Retry → `state.refreshConnections()` in the modal. The hint reads
      "The provider catalog could not be loaded." and never says "0 providers".
    - The modal is `size="md"` (`max-w-lg`), as in the prototype, not the plan's `lg`. It is 512×461 px, centred.
    - `autofocus` was removed (the lint rule). `showModal()` focuses the search, the first focusable control.
    - Connect buttons and "Browse catalog →" use base-content text with a primary border (deviation 6), not
      primary-coloured text.
    - Row detail copy comes from the registry. "Sign in" is kept next to "Connect" for OAuth and CLI entries.
    - The tile uses a primary dot instead of the prototype's plus-circle icon, to keep icon modules out of the eager
      bundle. The search keeps its visible focus ring.
    - **Batch 14 finding 3 is closed by Gate G.** RUX-3 and the `openCatalog` / `closeCatalog` helpers assert focus
      on the search at open, focus staying inside the dialog over 12 Tab presses, and focus returning to "Connect
      provider" after Esc and after a backdrop click. Batch 28 may move these into `settings-providers.e2e.spec.ts`.
    - **Observed, not changed (ui owner):** the `NativeModalComponent` backdrop button has no accessible name beyond
      "close" and no focus ring (`native-modal.component.ts:78-80`).
    - **Harness note:** daisyUI's `.modal` keeps a closed `<dialog>` laid out at opacity 0, so `toBeHidden()` never
      passes. Assert the dialog's `open` attribute instead (`expectCatalogOpen`).
- **Carry-forwards from Batch 26 (Main Agent popover, `batch-26-report.md` incl. "## Visual revise"), for the Gate V
  list:**
  1. **FLAGGED (decision at Gate V 28): the popover's model control is a plain `<select>`, with no search.**
     - Why: `ProviderModelPickerComponent` has no compact mode. It always renders a card
       (`libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-picker.component.ts:148-345`). Its one-row
       field `ProviderModelSearchFieldComponent` is not exported from the ui barrel (`…/provider-model-picker/index.ts:11-17`),
       so a deep import would break the module boundary.
     - Cost: this loses model search for long model lists, against task.md decision (3) ("Model search is
       Settings-only, via an opt-in `searchable` input").
     - Kept: "Enter a model ID…" (#35) and the "[Tool: Yes|No]" marker.
     - **Proposed fix:** a compact variant of the picker in `libs/frontend/ui` (a ui-owner change), used by the
       popover, in Batch 28 or a new Batch 28b.
  2. **Popover height and placement.** The first build capped the popover at `max-h-[18rem]` with internal scroll. The
     visual revise removed the cap: the popover is `w-[19rem]` and fully visible at 1024×768 in both hosts. VS Code
     shows it at 304 × 284 px, y=478, below the node as in the prototype. Electron flips it above the node, at y=190.
     The visual spec asserts it is fully inside the viewport. Re-check both after the Batch 28 composition (header
     removal, container-width grid).
  3. **Card "Use for main agent" → popover preselect.** The page-level "Review main provider change" panel is gone. A
     card's "Use for main agent" opens the popover preselected on that provider, straight into the D6 confirm (one
     provider-change surface). The uncheckable note and the button names are kept.
  4. The provider's **re-save to another scope** is a small in-popover link, "Save provider to {scope}…"
     (`main-agent-provider-rescope`), reached from the shared "Save to:" select. It replaces the removed page button
     `main-provider-save-to` and carries RUX-5.
  5. There is no "Apply & Save". Model and effort save on selection (D2); the provider saves on its confirm (D6).
     Model and effort share one Save-to, which lists only the targets both keys allow.
  6. Check connection is a small header button. Effort is a segmented `join` group with the real `effortLevels`
     (default / low / medium / high / xhigh / max).
  7. **Recurring Windows Playwright worker crash (0xC0000409)** at 0 ms. It happened in Batches 25 and 26 and never
     reproduced. Watch for it in Batch 28's longer runs.
- **Carry-forwards from Batch 25 (routing map, `batch-25-report.md`):**
  - **New reachability (Gate G) entries in `HARNESS\settings-reachability.table.ts`** for the three routing-map node
    actions. Each one clicks the node's footer action and asserts where it lands:
    - **Reassign** (`routing-node-main-agent`) → the Main Agent popover (mounted by Batch 26). Assert that the
      popover is open with provider, model and effort.
    - **Inspect** (`routing-node-background-roles`) → Agent Orchestration, background roles section
      (`section: 'background-models'`). Assert that the Orchestration tab is active and the background-roles region is
      visible and focused.
    - **Manage matrix** (`routing-node-cli-agents`) → Agent Orchestration, CLI matrix (`section: 'cli-agents'`).
      Assert that the Orchestration tab is active and the CLI matrix / CLI agents region is visible.
    - Run them in both hosts. `EXPECTED_CAPABILITY_COUNT` only grows.
  - **Deviations to record in the visual review:**
    - **Node markup:** the design-spec §3.1 node is a `<button>`. Ours makes the footer action the one `<button>`,
      stretched over the node, with the D16 badges layered above it, because a node-wide button would nest buttons.
    - **No quota pill** on the CLI node, because the state holds no quota data. The node shows "{n} enabled" instead.
    - **Wording:**
      - "Next request target" is dropped from the Main footer.
      - The follower row names a count ("4 roles · Follow main agent"), not the role names.
      - The Main node carries a status word ("Active").
      - The Background footer reads "{set} set · {n} following", not "6 autonomous background tasks".
      - "Manage matrix ›" / "Inspect ›", with base-content text and muted chevrons (deviation 6).
    - The map is deferred (`@defer (on immediate)`), behind a placeholder of the same footprint.
    - The node grid uses container width: VS Code 3 columns; Electron 2 + 1 with a half-width third node, which
      makes the map taller in Electron. The fold gate owns the final numbers.
  - `providers-settings.component.ts` is at exactly 700 lines after Batch 25. Batch 26 must bring it under the limit
    again when it removes the old main-agent block.
- **Carry-forwards from Batch 24 (drift checkpoint, orchestrator):** the VS Code card grid matches
  `prototypes/final/screenshots/index-anubis-1024x768.png` structurally: 3 columns, two-row cards, dot + status, and
  "Used by". The page top (main-agent block, header) is still pre-routing-map; that is expected until Batches 25-28.
  Recorded deviations for the visual review:
  - the state sentence moved off the card face (accessible name and tooltip);
  - initials avatar instead of the vendor mark;
  - the Settings shell's `max-w-4xl` makes the grid 832 px (prototype about 976 px);
  - the active card has a secondary spine and the failed card a warning tone, per design-spec §3.3 and the state
    table;
  - the inline action is `btn-xs` (24 px, WCAG 2.5.8);
  - the "Connect another provider" tile, the header count and filter, and the hint strip are this batch's work.
- **Carry-forwards from Batch 22 (bb4502d59, `batch-22-report.md` "Deviations and open points"), for the Gate V
  review and the combined code review:**
  - **Models & Tiers row density (flag):** each tier row embeds the full searchable picker (Batch 15 component), so
    rows are taller than the prototype's shared search + Change buttons; at 1024×768 the Haiku picker is below the
    fold of the drawer. Mapped-to text is `text-base-content` (deviation 6); the prototype's per-row "Tool use: Yes"
    badge is the picker's per-provider summary.
  - **No "Standard Built-in Provider" notice:** the Advanced tab is custom-only (inapplicable tabs are absent, Batch
    19/20 decision); built-in local base-URL edits stay on the Credentials setup fallback (D14).
  - **Advanced differs from the prototype by design:** Endpoint heading with Check / Save (D7 verify-before-save);
    the plan's verbatim pricing note instead of "Used for real-time session cost tracking" (pricing has no runtime
    reader); "Delete connection" with inline confirm; per-section Save buttons (deviation 3).
  - **Inline save toast with Undo in Models & Tiers** (page toast sits outside the drawer focus trap); the drawer is
    lifted to `z-[60]` above the page toast (z-50). Confirm this stacking with the Batch 28 page composition.
  - **Re-routed baseline entries #6/#10/#13/#32/#33/#36** now reach the drawer tab that holds them (D14 removed the
    Models footer "Edit in setup" for non-custom kinds); the wizard stays reachable from Connect provider. Harness #10
    asserts the new `credentials-cli-detected` line.
  - **Visual-spec wait narrowed** to the drawer's own `ptah-drawer-*` keyframes (intermittent hang fix, test-only).
  - The combined review covers `drawer-write.ts` and the Part A fixes in credentials-tab / providers-settings.

### Batch 28 verification

- Same command as Batch 17
- Gate V (Providers): Gate G, plus the full settings harness folder in both hosts and both themes
- `visual-review.md` Providers PASS against `prototypes/final/screenshots/index-{anubis,anubis-light}-1024x768.png`
  and the interaction shots
- The combined Providers (21-28) code review accepts

## Gate V 28 follow-ups (Batches 28b-28d, user decision 2026-10-01)

task.md "Gate V 28 (2026-10-01, user)" accepts only the "VS Code" App-layer label as a deviation. The compact model
picker, the key hint, the Overview latency and Codex CLI under "Used by" become work. Order: 28b → 28c → 28d → 29.
These are Providers-tab additions after the tab gate, so each keeps **every Providers fold assertion green in both
hosts and both themes** (execution default 3, ratchet) and attaches the Providers captures. The final visual review of
these surfaces is in Batch 38.

## Batch 28b: compact searchable model picker in the Main Agent popover (S5 follow-up) — COMPLETE (0daf6ccdd)

- Recommended executor: Providers owner (in-process frontend-developer, continued)
- Fallback executor: as Batch 17
- Execution mode: sequential
- Rationale: one new ui variant and its single consumer. It needs design judgment on density (the popover is 19rem
  wide) and a ui barrel export. It is not lane-eligible, because it touches a shared public entry point.
- Review route: no per-batch code review (user decision 2026-09-30). The `libs/frontend/ui` change is covered in
  Batch 38 and the final review; the orchestrator does a capture check at commit.
- Tasks: 1 | Depends on: Batch 28

### Task 28b.1: `ProviderModelPickerComponent` compact variant (ui, exported) used by the popover; full model value on the Main Agent node — COMPLETE (0daf6ccdd)

- **Outcome:** the compact control is the existing `ProviderModelSearchFieldComponent`, exported from the barrel with
  opt-in `inputId`, `includeDefault` and `pinnedOption` (orchestrator-accepted). `provider-model-picker.component.ts`
  and its spec are unchanged.

- Files:
  - MODIFY `UI\provider-model-picker\provider-model-picker.component.ts` (+ spec): add a compact, searchable variant
    (e.g. `variant="compact"` / `compact` input). It is one row: a search field with a list, and no card chrome.
    Alternatively, export `ProviderModelSearchFieldComponent` as the compact control. Choose one, and record why.
  - MODIFY `UI\provider-model-picker\index.ts`: the new public surface goes through the barrel. **No deep import**
    from chat (module boundary; the Batch 26 carry-forward reason).
  - MODIFY `CHAT\providers\main-agent-reassign-popover.component.ts` (+ spec): replace the plain `<select>` with the
    compact picker.
  - MODIFY `CHAT\providers\routing-map.component.ts` / `routing-map-node.component.ts` (+ spec): the Main Agent node
    shows the full model value.
  - MODIFY `HARNESS\settings-providers.e2e.spec.ts`: un-`fixme` "the popover search filters models".
  - MODIFY `HARNESS\settings-visual.e2e.spec.ts` only where the popover size or position assertions change.
  - This is 6-8 paths across 3 libs, over the cap. That is accepted (one ui control plus its one consumer and the
    harness), as for 27b.
- Plan reference: task.md "Gate V 28" and decision (3) ("Model search is Settings-only, via an opt-in `searchable`
  input"); Batch 26 carry-forward 1 (in the Batch 28 section); design-spec popover; `prototypes/final/screenshots/interactions/index-1.png`.
- Pattern to follow: the Batch 15 `searchable` input and `NativeAutocompleteComponent` (Batch 15b id prefix and
  reset-on-reopen); the existing `ProviderModelSearchFieldComponent`.
- Quality requirements:
  - The model control filters as the user types, has full keyboard support (arrows, Enter, Esc closes the list
    first and then the popover), and an accessible name.
  - Keep "Enter a model ID…" (#35), and keep the "[Tool: Yes|No]" tool-use marker on every option.
  - Keep a stored model the catalogue lacks listed as "· not in current catalog". Keep save-on-selection (D2) with
    the toast and Undo, and the M1 gating (disabled until a Save-to target exists).
  - The existing non-compact picker callers (drawer Models & Tiers, the wizard) are unchanged: the default variant
    renders the same output, and their specs pass unchanged.
  - **Main Agent node:** it shows the full model value, as in the prototype. Today VS Code shows "Default (chosen by
    Clau…" at the 261 px node width. Wrapping to a second line is allowed, but truncating the value is not. The node
    height change must keep the VS Code fold (card 5 ≤ 660 px) and the Electron per-host budget.
  - **The popover is fully inside the viewport in every state.** That covers the default state, the open model list,
    the manual field, the D6 confirm, the loading and error states, and the outcome. Check both hosts and both themes;
    the Batch 28 `fitToViewport` stays. Only the body scrolls, and an open model list is never clipped by the
    popover's scroll box.
- Validation notes:
  - RISK (MEDIUM): a list inside a popover with a height cap can be clipped, or can escape the stacking fix. Assert
    that the open list is on top (`assertPopoverOnTop`-style `elementFromPoint`) and inside the viewport.
  - RISK (LOW): a ui barrel export grows the eager bundle if the popover chunk stops being lazy. Report the initial
    total before and after; the popover must stay in its lazy chunk.
- Implementation details: the popover's `modelOptions` stays the source of the options; the picker only renders and
  filters.

### Batch 28b verification

- Same command as Batch 17, which includes `@ptah-extension/ui`.
- `npx nx build ptah-extension-webview` reports no budget error; the popover stays a lazy chunk.
- Gate G (`--reporter=list`), plus the full settings folder in both hosts and both themes: every Providers fold
  assertion is green and the "popover search filters models" scene passes (no `fixme` left except the `main-model`
  deep link).
- Captures `current-main-agent-popover-*`, `current-main-agent-save-to-*` and `current-providers-*` in both hosts and
  both themes, plus a new capture with the model list open.

## Batch 28c: masked key hint and last connection check (contract, backend) (S5 follow-up) — COMPLETE (7788993b3)

- Recommended executor: backend-developer (subagent, in-process)
- Fallback executor: backend-developer CLI lane, if the orchestrator confirms one; its review then goes to a subagent
  code-logic-reviewer (execution default 6)
- Execution mode: sequential
- Rationale: an RPC contract change that handles secrets. It needs judgment at the secret-store boundary and exact
  control of what crosses RPC. It has no UI.
- Review route: **ORCHESTRATOR DECISION (2026-10-01): 28c gets its own cross-side code review before the commit,**
  by the antigravity lane in the code-logic-reviewer role, because the batch derives data from a stored secret. This
  is an exception to the no-per-batch-review decision from Batch 22 on. The author is an in-process subagent, so the
  lane is the cross side (execution default 6). The team-leader commits only after an accepting verdict. A
  NEEDS_REVISION verdict goes back to the same executor.
- Tasks: 2 | Depends on: Batch 28 (runs after 28b)

### Why a key hint is now accepted exposure

Batch 21 decided on no key hint, because it would send part of the secret across RPC. At Gate V 28 the user did
**not** accept that deviation (task.md "Gate V 28"): the prototype's "•••• 8f21" lets a user tell which key is stored
without revealing it. The exposure is bounded to what password managers and cloud consoles show:

- The **last 4 characters only**, computed in the extension host from the stored secret. The full key and any prefix
  never leave the host.
- **No hint for a key shorter than 12 characters.** For a short key, the last 4 characters are too large a share of
  the secret, and a short key is usually a placeholder or local token.
- The hint is display-only. It is never accepted as input, never logged, and never echoed in errors.

### Task 28c.1: per-stored-key masked hint (host-computed, bullets + last 4) — COMPLETE

- Files (confirm after the read-path step; ≤ 6 files across `libs/shared` and `libs/backend`):
  - MODIFY `TYPES\rpc\rpc-auth.types.ts`: add an optional `keyHint?: string` per stored key on the existing key
    status response (for example the `auth:getApiKeyStatus` result), documented as "bullets + last 4, host-computed,
    absent when no key or the key is shorter than 12 characters".
  - MODIFY `RPC\auth-rpc.handlers.ts` (+ spec, or a new focused `auth-rpc.handlers.key-hint.spec.ts`): compute the
    hint where the key status is read.
  - CREATE a pure helper, e.g. `maskKeyHint(secret): string | undefined`, in `RPC\..\utils\` (+ spec).
- Plan reference: task.md "Gate V 28"; Batch 21 decision (log row 21); Batch 7 `auth:deleteStoredKey` pattern.
- Pattern to follow: the existing SECURITY note on `AuthGetAuthStatusResponse` (`rpc-auth.types.ts:165-171`, "NEVER
  contains actual credential values"). Update that note to say exactly what is allowed.
- Quality requirements:
  - The format is exactly `'•••• ' + last4` (U+2022 × 4, a space, then 4 characters). The file stays UTF-8 without
    a BOM, and the specs check for mojibake.
  - Keys shorter than 12 characters, empty keys, whitespace-only keys and read failures give no `keyHint`, and never
    throw.
  - **Specs prove the full key never crosses RPC:**
    - For a set of fixture keys (including one of ≥ 40 characters), the JSON-serialised RPC result contains neither
      the full key nor any substring longer than 4 characters of it.
    - The same check covers the error path: a secret-store read failure gives no hint and no key text in the error.
    - The helper is never called on the write path.
  - Cursor, Copilot, Codex OAuth and CLI logins have no key hint. The Cursor redaction from Batch 3 is unchanged.
- Validation notes:
  - ASSUMPTION: the key-status handler can read the secret in the host without a new permission prompt. Verify with
    file:line. If reading the secret for a hint needs a new secret-store call path, report it before implementing.
  - RISK (HIGH, security): logging. Grep the changed handler for log calls that could include the secret or the hint.
- Write-path and read-path trace (in the report): secret store → handler read → `maskKeyHint` → RPC field →
  webview state (read only; 28d renders it). There is no write path; state that explicitly.

### Task 28c.2: per-connection last check result with latency and timestamp — COMPLETE

- Files (confirm after the read-path step):
  - MODIFY `TYPES\rpc\rpc-auth.types.ts` (or `rpc-providers.types.ts`): a shared `ConnectionCheckRecord`
    `{ status, latencyMs: number | null, checkedAt: string (ISO 8601) }`, and an optional `lastCheck?` on the
    per-provider route or status entry that the Overview already reads (for example `auth:getEffectiveRoute`
    providers).
  - MODIFY the existing connection-check paths so that each records its result. The candidates are
    `auth:testConnection`, `provider:testCustomEntry`, and the route or probe path behind `auth:getEffectiveRoute`
    (`RPC\auth-rpc.handlers.ts`, `RPC\provider-rpc.handlers.ts`, `rpc-handlers\src\lib\utils\custom-provider-probe.ts`)
    (+ specs).
- Quality requirements:
  - The latency is measured around the real probe (monotonic clock, whole ms), and `checkedAt` is set when the check
    completes. A failed or timed-out check records its status with `latencyMs: null`.
  - The record is in-memory per host session, unless the plan names a persisted store. **Do not add a settings key.**
    If persistence seems needed, report it and stop.
  - Draft verification (`auth:verifyDraftConnection`) does **not** write the saved connection's record.
  - Concurrent checks for one provider keep the newest completed result, never an older one that finished late.
- Validation notes:
  - RISK (MEDIUM): a probe that throws must still record `status` + `latencyMs: null`, and never an unhandled
    rejection.
  - ASSUMPTION: every connection kind's Check path goes through one of the handlers above. Verify with file:line,
    and list any kind that does not (for example CLI detection).
- Write-path and read-path trace (in the report): Check control → RPC → probe → record store (key: provider id) → the
  read RPC field → webview state.

### Batch 28c verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/core`
  (use the rpc-handlers project name from `project.json`). The known `harness-skill-selection` failure does not block
  (see the known failures list).
- `npx nx build ptah-extension-webview` reports no budget error, and Gate G passes (execution default 7 applies to
  backend batches).
- The secret-crossing specs are listed by name in the report, and each one fails on a deliberately wrong helper
  (`slice(-8)`) in a scratch copy, never in the shared tree.

## Batch 28d: key hint, Overview latency and Codex CLI "Used by" (UI) (S5 follow-up) — COMPLETE (46fda2e5f)

- Recommended executor: Providers owner (in-process frontend-developer, continued)
- Fallback executor: as Batch 17
- Execution mode: sequential
- Rationale: three small renders on existing drawer and card surfaces, reading the 28c fields and existing CLI state.
- Review route: no per-batch code review (user decision 2026-09-30); commits after typecheck/test/lint, Gate G and
  captures, with an orchestrator capture check.
- Tasks: 1 | Depends on: Batches 28c, 28b

### Task 28d.1: render the key hint, the Overview latency, and Codex CLI under "Used by" — COMPLETE (46fda2e5f)

- Files (≤ 6 plus specs, chat + harness):
  - MODIFY `CHAT\providers\connection-drawer\credentials-tab.component.ts` (+ spec): the stored-key row shows the hint
    ("•••• 8f21"). With no hint, it keeps today's "Key stored" wording and never shows a placeholder.
  - MODIFY `CHAT\providers\connection-drawer\overview-tab.component.ts` (+ spec): the status card shows the last
    check's latency ("92ms" style, as in the prototype) and a relative time. With no record it shows nothing, never
    "0ms".
  - MODIFY `CHAT\providers\connection-usage.ts` (+ spec): OpenAI Codex lists "Codex CLI" under "Used by" when the
    Codex CLI is enabled, as in the prototype ("Used by 2").
  - MODIFY `CORE\providers-settings-state.service.ts` / `providers-settings.types.ts` only if the 28c fields need
    mapping into the state (keep the facade ≤ 700 lines).
  - MODIFY `HARNESS\settings.fixtures.ts` (a hint, a check record, Codex CLI enabled) and
    `HARNESS\settings-reachability.table.ts` or `settings-providers.e2e.spec.ts` (new reach entries).
- Plan reference: task.md "Gate V 28"; prototype drawer shots under `prototypes/final/screenshots/interactions/`;
  Batch 19 decision (a), which this batch reverses by user decision.
- Quality requirements:
  - **Reversal of the Batch 19 decision (a):** "Codex CLI" counts under "Used by" for **OpenAI Codex only**, and only
    when the Codex CLI is enabled (`state.cliAgents()` / `agent:getConfig`, `providers-settings-state.service.ts:117,
    480`). A disabled or undetected Codex CLI is not listed. While the CLI read is loading, `connectionUsage` keeps
    `complete: false` (the "Loading…" rule from Batch 20). Update the note at `connection-usage.ts:57`.
  - The hint and latency text are `text-base-content` (deviation 6). The hint is never selectable into a copy action
    and never sent back over RPC.
  - New Gate G reach entries: the hint visible for Moonshot, the latency visible in Overview after a check, and
    "Codex CLI" under "Used by" for OpenAI Codex. `EXPECTED_CAPABILITY_COUNT` only grows.
  - The Providers fold assertions stay green in both hosts and both themes, and card height stays ≤ 80 px with the
    longer "Used by".
- Validation notes:
  - RISK (LOW): the 28c field names may differ from those assumed here. Use the 28c report's contract, not this text.

### Batch 28d verification

- Same command as Batch 17, then the build (no budget error), Gate G (`--reporter=list`), and the full settings
  folder in both hosts and both themes.
- Captures: `current-drawer-moonshot-credentials-*` (hint), `current-drawer-moonshot-*` (Overview latency) and
  `current-providers-*` ("Used by 2" on OpenAI Codex), in both hosts and both themes.

## Batch 29: pure derivations — matrix rows + permission notes (S6) — COMPLETE (41b85393c)

- Recommended executor: frontend-developer (subagent), the **Orchestration owner**. The same instance continues through
  Batch 36; it may be the Providers owner instance.
- Fallback executor: a new frontend-developer subagent that first reads Batches 29-36 and the prior reports
- Execution mode: sequential
- Review route: no per-batch code review (user decision 2026-09-30); commits after typecheck/test/lint, Gate G and captures. The cross-side code review is combined at Gate V 36 (Orchestration diff 29-36)
- Tasks: 1 | Depends on: Batch 28d (order after 28: 28b → 28c → 28d → 29)

### Task 29.1: `cli-matrix-rows.ts` (order, installed/uninstalled, instance status/key/tiers) and `cli-permission-notes.ts` — COMPLETE

- Files:
  - CREATE `CHAT\ptah-ai\cli-matrix-rows.ts`, `CHAT\ptah-ai\cli-matrix-rows.spec.ts`
  - CREATE `CHAT\ptah-ai\cli-permission-notes.ts`, `CHAT\ptah-ai\cli-permission-notes.spec.ts`
- Plan reference: implementation-plan.md:710-738; §4 rows #43, #44, #54, #70, #71; D11
- Pattern to follow:
  - the rank rule `agent-orchestration-config.component.ts:357-393`
  - the old #70 copy (`git show 7ecdefa45^1:libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts`
    lines 350-359, 530-540, 580-590, 631-641, 701-711)
- Quality requirements:
  - Every CLI id has copy.
  - No "Quota reached" state; status is only what detection reports (D11).
  - Cursor stays actionable in the Uninstalled group (`cursor-cli.adapter.ts:208-223`).
- Interim notes carried from Batch 18 (resolve in S6; the owner of Batches 29-36 checks both before Batch 36's gate):
  1. On a first landing on Advanced or Search & Voice, before Providers or Orchestration has opened the state, the
     header shows no workspace name. The shell derives it from `state.scopes().data.activePath`, which is not loaded
     yet. Fix in S6 or Batch 36: the shell opens the state (or at least the scopes section) itself, or the header
     hides the workspace part until it is ready. Pin it in `settings.component.spec.ts`.
  2. The legacy "Manage … in Providers" label is still rendered by the old AOC inside the interim container. Batch 33
     (the policy-bar rewrite) retires it. The AOC spec asserts it is absent (RUX-9).
- Validation notes: the Ptah-instance and Copilot permission copy is new. Export the affected ids as
  `PENDING_USER_REVIEW_IDS` from the notes file, and list that copy in the report for the user.
- Implementation details: `ptahCliId` rows are skipped from detected CLIs; instances come from `cliAgents()`.

### Batch 29 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview`
- Gate G; captures attached. No per-batch code review (combined at Gate V 36).

## Batch 30: CLI matrix + model/effort popover (S6) — COMPLETE (07da3f4f6)

- Recommended executor: Orchestration owner
- Fallback executor: as Batch 29
- Execution mode: sequential
- Rationale: the matrix mounts in the interim container **above** the old AOC/PtahCliConfig content. Both coexist until
  Batch 34 (D14).
- Review route: no per-batch code review (user decision 2026-09-30); commits after typecheck/test/lint, Gate G and captures. The cross-side code review is combined at Gate V 36 (Orchestration diff 29-36); focus for it: write-path rows 893-895, 898
- Tasks: 1 | Depends on: Batches 29, 15b

### Task 30.1: `CliOrchestrationMatrixComponent` (on/off, status, provider, model/effort cells, permissions ℹ, Test/Delete) + `CliModelEffortPopoverComponent` — COMPLETE (07da3f4f6)

- Files:
  - CREATE `CHAT\ptah-ai\cli-orchestration-matrix.component.ts`, `CHAT\ptah-ai\cli-orchestration-matrix.component.spec.ts`
  - CREATE `CHAT\ptah-ai\cli-model-effort-popover.component.ts`, `CHAT\ptah-ai\cli-model-effort-popover.component.spec.ts`
  - MODIFY `CHAT\ptah-ai\orchestration-settings.component.ts`
  - MODIFY `HARNESS\settings-reachability.table.ts` (flip #43, #44, #54, #70, #71 and RUX-8/-11)
- Plan reference: implementation-plan.md:710-742
- Pattern to follow:
  - the static option lists and unsupported-effort guard `ptah-cli-config.component.ts:13-35, 224-248` (copy them;
    the old file is deleted in Batch 34)
  - the opencode/pi hint (#67)
- Quality requirements:
  - `<table class="table table-xs">`, `@for … track id`.
  - Testids `cli-matrix`, `cli-matrix-row-<id>`, `cli-matrix-uninstalled`.
  - Disabled or not-installed rows render plain text.
  - The install-guide ℹ holds the #77 copy.
  - Tiers/Edit/Credentials/Add buttons are **not rendered** until their batch lands (no dead controls).
- Validation notes: 2 clicks → `agent:setConfig` (RUX-8). Model and effort take effect at the next spawn only after
  Batch 4 (D8). The reviewer confirms that Batch 4 is committed.
- Implementation details: system on/off → `disabledClis`; instance on/off → `ptahCli:update.enabled`; saves go through
  the feedback service with Undo.
- **Constraint from the Batch 17 review (`batch-17-code-logic-review.md:36`):** every
  `SettingsSaveFeedbackService.save({write, undo})` call passes a `ProvidersSettingsStateService` save method (or a
  closure that only calls one) as `write` and `undo`. A custom `write` that resolves `true` without updating
  `commit()` would be reported as a success using a stale commit. The spec asserts which state method each control
  calls.

### Batch 30 verification

- Same command as Batch 29; Gate G; smoke captures; captures attached. No per-batch code review (combined at Gate V 36).

## Batch 31: Cursor credential popover + Copilot toggle move (S6) — COMPLETE (c04a85a4e) (+ visual drift checkpoint)

- Recommended executor: Orchestration owner
- Fallback executor: as Batch 29
- Execution mode: sequential
- Review route: no per-batch code review (user decision 2026-09-30); commits after typecheck/test/lint, Gate G and captures. The cross-side code review is combined at Gate V 36 (Orchestration diff 29-36), **plus** a visual-reviewer drift checkpoint (matrix density
  and structure vs `prototypes/final/orchestration.html`, both themes)
- Tasks: 1 | Depends on: Batch 30

### Task 31.1: `CursorCredentialPopoverComponent` (#64, 551 env note) and `CopilotAutoApproveToggleComponent` (moved verbatim) wired into the matrix — COMPLETE (c04a85a4e)

- Files:
  - CREATE `CHAT\ptah-ai\cursor-credential-popover.component.ts`, `CHAT\ptah-ai\cursor-credential-popover.component.spec.ts`
  - CREATE `CHAT\ptah-ai\copilot-auto-approve-toggle.component.ts`, `CHAT\ptah-ai\copilot-auto-approve-toggle.component.spec.ts`
  - MODIFY `CHAT\ptah-ai\cli-orchestration-matrix.component.ts`
  - MODIFY `HARNESS\settings-reachability.table.ts`
- Plan reference: implementation-plan.md:739-749; §3 rows 896-897
- Pattern to follow:
  - the uncertain-write and recheck logic `agent-orchestration-config.component.ts:466-581`, moved with its specs
  - the key clear-on-destroy pattern `ptah-cli-config.component.ts:177`
- Quality requirements:
  - Show/hide on the key (#49).
  - The "Set" badge comes from `cursorApiKeyStored`.
  - With the env var set: "CURSOR_API_KEY is set in the environment and takes precedence over the stored key."
- Validation notes: the toggle writes through `state.saveSettings({orchestration:{copilotAutoApprove}})`, not a private
  RPC. The old AOC toggle stays until Batch 33 (transient duplicate, see Risks).
- Implementation details: "Remove stored key" → `saveCursorCredential('')`.

### Batch 31 verification

- Same command as Batch 29; Gate G; drift checkpoint shows no structural drift; captures attached. No per-batch code review (combined at Gate V 36).

## Batch 32: add-instance + tier-mapping modals (S6) — COMPLETE (b4c512eb3)

- Recommended executor: Orchestration owner
- Fallback executor: as Batch 29
- Execution mode: sequential
- Review route: no per-batch code review (user decision 2026-09-30); commits after typecheck/test/lint, Gate G and captures. The cross-side code review is combined at Gate V 36 (Orchestration diff 29-36); focus for it: write-path rows 898-900; D5
- Tasks: 1 | Depends on: Batches 31, 14, 13
- **Carry-in from Batch 21 (2cb1a107a):** reachability #49 is `restored` for its drawer half only (the Replace
  field). This batch adds show/hide to the CLI-agent add/edit forms and extends #49's `reach` to click it there.

### Task 32.1: `AddCliInstanceModalComponent` (create + edit mode, #47/#48/#49/#50) and `CliTierMappingModalComponent` (#53, D5) — COMPLETE

- Files:
  - CREATE `CHAT\providers\add-cli-instance-modal.component.ts`, `CHAT\providers\add-cli-instance-modal.component.spec.ts`
  - CREATE `CHAT\providers\cli-tier-mapping-modal.component.ts`, `CHAT\providers\cli-tier-mapping-modal.component.spec.ts`
  - MODIFY `CHAT\ptah-ai\cli-orchestration-matrix.component.ts` (Add row, Tiers, Edit actions)
  - MODIFY `HARNESS\settings-reachability.table.ts` (flip #47, #53)
- Plan reference: implementation-plan.md:750-764; D5; `ptah-cli-config.component.ts:48-53, 171-175`
- Pattern to follow: Batch 14 modal; Batch 17 feedback (toast rendered inside the modal footer, plan :542-544)
- Quality requirements:
  - Testids `add-cli-instance-modal`, `cli-tier-mapping-modal`.
  - The tier modal always sends the full `{sonnet?,opus?,haiku?}`; "Use inherited" removes that key.
  - Placeholders show the provider-level `cliAgent` tier.
- Validation notes:
  - Create stays disabled for `github-copilot` until `externalAuth.signInState==='signed-in'`.
  - **Edit (#50) RISK:** the edit mode uses `saveSettings({cli:[{action:'update',…}]})`. If that contract cannot carry
    the name/key edit, STOP and report.
  - A modal dismissed mid-save still reports through the page toast.
  - Carry-forward from the Batch 14 review (finding 3): for both the add-instance modal and the tier-mapping
    modal, a Playwright scene asserts that focus moves into the dialog on open, stays trapped on Tab, and returns
    to the opener (the Add row / the Tiers button) after Esc, backdrop and submit.
- Implementation details: submit → `saveSettings({cli:[{action:'create',…}]})`; tiers → `setCliInstanceTiers`.

### Batch 32 verification

- Same command as Batch 29; Gate G; captures attached. No per-batch code review (combined at Gate V 36).

## Batch 32b: closed compact model field shows the saved ID (S6) — COMPLETE (b1ef5eb50)

- Recommended executor: Orchestration owner
- Fallback executor: as Batch 29
- Execution mode: sequential
- Review route: no per-batch code review (user decision 2026-09-30); part of the combined Orchestration review at
  Gate V 36
- Tasks: 1 | Depends on: Batch 32
- Origin: `batch-32-report.md` §5 item 1 / HANDOFF "Open from Batch 32"; orchestrator decision: fix the shared field in
  compact mode.

### Task 32b.1: `ProviderModelSearchFieldComponent.selectedLabel` uses `compactLabel` in compact mode — COMPLETE

- Files:
  - MODIFY `UI\provider-model-picker\provider-model-search-field.component.ts` (+ spec)
  - MODIFY `CHAT\providers\cli-tier-mapping-modal.component.spec.ts`
  - Re-take `current-orchestration-modal-tiers-*` and `current-orchestration-popover-{model,effort}-*` captures
- Quality requirements: the closed compact field shows the saved ID when the host pinned it as
  `{id, name: 'saved, not in the current list'}`; the `''` sentinel keeps its label; non-compact output unchanged.
- Result: done as specified; see `batch-32b-report.md` and the commit/verification log row.

### Batch 32b verification

- Same command as Batch 29; Gate G; captures attached. Passed (see the log row).

## Batch 33: policy bar + roles `<details>` (S6) — COMPLETE (45fbd7146)

- Recommended executor: Orchestration owner
- Fallback executor: as Batch 29
- Execution mode: sequential
- Rationale: the old AOC body (with its private state, RPC writes and duplicate Copilot toggle) is replaced by the
  policy bar in the same commit.
- Review route: no per-batch code review (user decision 2026-09-30); commits after typecheck/test/lint, Gate G and captures. The cross-side code review is combined at Gate V 36 (Orchestration diff 29-36); focus for it: write-path rows 891-892
- Tasks: 1 | Depends on: Batch 32

### Task 33.1: `AgentOrchestrationConfigComponent` becomes the one-row policy bar; the container wraps the roles in a closed `<details>` — COMPLETE

- Files:
  - REWRITE `CHAT\ptah-ai\agent-orchestration-config.component.ts`, `CHAT\ptah-ai\agent-orchestration-config.component.spec.ts`
  - MODIFY `CHAT\ptah-ai\orchestration-settings.component.ts`, `CHAT\ptah-ai\orchestration-settings.component.spec.ts`
  - MODIFY `CHAT\settings.component.spec.ts` (background-role rows assert `background-roles-details` is `open`)
  - MODIFY `HARNESS\settings-reachability.table.ts`
- Plan reference: implementation-plan.md:695-709; deviations 4 and 5; RUX-9
- Pattern to follow: `moveAgentUp/Down` logic `agent-orchestration-config.component.ts:426-443`
- Quality requirements:
  - `data-testid="orchestration-policy-bar"`.
  - ▲/▼ buttons with `aria-label`s; no grip icon.
  - Range 1-20 with a live value.
  - No `ClaudeRpcService` or private `agentConfig` left.
  - Class and selector are kept (still exported).
- Validation notes: `data-testid="background-roles-details"` is closed by default and opened by the deep links. The
  "Manage … in Providers" repeats are absent (the AOC spec asserts this).
- Implementation details: writes go through the feedback service → `state.saveSettings({orchestration:{…}})`;
  Re-detect → `state.redetectClis()`.

### Batch 33 verification

- Same command as Batch 29; Gate G; captures attached. No per-batch code review (combined at Gate V 36).

## Batch 34: retire PtahCliConfig (S6) — COMPLETE (7dd06a872) — EXCEPTION (7 paths incl. 2 deletions, D14 atomic)

- Recommended executor: Orchestration owner
- Fallback executor: as Batch 29
- Execution mode: sequential
- Rationale: the replacement is fully mounted by Batches 30-33. The delete, the barrel edit, the routing target change
  and the reachability re-point must land together.
- Review route: no per-batch code review (user decision 2026-09-30); commits after typecheck/test/lint, Gate G and captures. The cross-side code review is combined at Gate V 36 (Orchestration diff 29-36), plus a parity check of the Ptah-instance capabilities (add,
  edit, delete, test, per-instance model, Cursor key, delegated model/effort) against `parity-inventory.md`
- Tasks: 1 | Depends on: Batch 33

### Task 34.1: delete `PtahCliConfigComponent`; route `cli-agents` to `[data-testid="cli-matrix"]` — COMPLETE

- Files:
  - DELETE `CHAT\ptah-ai\ptah-cli-config.component.ts`, `CHAT\ptah-ai\ptah-cli-config.component.spec.ts`
  - MODIFY `CHAT\index.ts` (remove the export at `:13`)
  - MODIFY `CHAT\ptah-ai\orchestration-settings.component.ts` (unmount the old component)
  - MODIFY `CHAT\settings.component.ts`, `CHAT\settings.component.spec.ts` (the `cli-agents` target)
  - MODIFY `HARNESS\settings-reachability.table.ts` (re-point every entry that targeted the old component)
- Plan reference: implementation-plan.md:509, :775-781; review N2
- Pattern to follow: n/a
- Quality requirements: grep shows no remaining reference to `PtahCliConfigComponent`/`ptah-cli-config` in libs or apps
  (backend `ptah-cli-registry.ts` symbols excepted).
- Validation notes: Gate G must be green with the old component gone. That is the D14 proof.
- Implementation details: n/a

### Batch 34 verification

- Same command as Batch 29; Gate G; captures attached. No per-batch code review (combined at Gate V 36).

## Batch 35: roles table restyle + consumer rows (S6) — COMPLETE (2d59760e1)

- Recommended executor: Orchestration owner
- Fallback executor: as Batch 29
- Execution mode: sequential
- Review route: no per-batch code review (user decision 2026-09-30); commits after typecheck/test/lint, Gate G and captures. The cross-side code review is combined at Gate V 36 (Orchestration diff 29-36); focus for it: write-path rows 902-904
- Tasks: 1 | Depends on: Batch 34

### Task 35.1: `provider-consumer-rows.ts` extraction; `table-xs` rows with popover reassignment and "Follows main agent →" chips; setup deep-link rewired — COMPLETE

- Files:
  - CREATE `CHAT\providers\provider-consumer-rows.ts`, `CHAT\providers\provider-consumer-rows.spec.ts`
  - MODIFY `CHAT\providers\provider-consumer-assignments.component.ts`, `CHAT\providers\provider-consumer-assignments.component.spec.ts`
  - MODIFY `CHAT\ptah-ai\orchestration-settings.component.ts` (`setupProviderRequested` → `requestSettingsTab({tab:'providers', providerId})`)
  - MODIFY `HARNESS\settings-reachability.table.ts`
- Plan reference: implementation-plan.md:765-774
- Pattern to follow: `makeRow` and its helpers, `provider-consumer-assignments.component.ts:37-139`
- Quality requirements:
  - Inputs and outputs are unchanged.
  - `data-testid="assignments-heading"` is kept.
  - The component is under 700 counted lines (805 today).
- Validation notes: writes go through the feedback service with Undo. `initialEditingConsumerId` still puts the row in
  edit state.
- Implementation details: n/a

### Batch 35 verification

- Same command as Batch 29; Gate G; captures attached. No per-batch code review (combined at Gate V 36).

## Batch 36: Orchestration scenes + Gate V (Orchestration) (S6) — COMPLETE (implementation 6384f0a22 + e75a1cf31; docs 8fb6dfe25; 36b 21e29b3e7, 3dcf61755, 81940b389, 707a153e0; 36c 2d4793b7f, 2bdae1006, 493baad02; 36d e4b2cf311, 8716cd046, ef3dec4df) — Gate V 36 passed

- **Gate V 36 result (2026-10-02):** all three reviews accept, all by **same-side** subagents (disclosed; no CLI lane:
  antigravity out of quota, no image-capable lane):
  - code 29-32 (`gate-v36-code-logic-review-29-32.md`, Re-check): APPROVED WITH NOTES, 8/10
  - code 33-36 (`gate-v36-code-logic-review-33-36.md`, Re-check): APPROVED WITH NOTES, 8.5/10
  - visual (`visual-review-gate-v36.md`, Re-check 2): PASS WITH NOTES, 8/10
  - Re-check notes were fixed in Batches 36c (code notes, visual N1, checkbox) and 36d (visual N3, 36c task d focus).
- **Carried notes (recorded, not fixed here):**
  - V36-3 light muted-text contrast → the muted-token batch after the track B merge (HANDOFF "Remaining work" 3).
  - Two app-shell `<dialog class="modal">` elements outside Settings (`components/molecules/confirmation-dialog.component.ts`
    and a sibling shell dialog) are hidden Tab stops while closed → follow-up outside this task.
  - N2: in Electron, provider names in the matrix truncate with a mouse-only `title` → accepted trade-off (Gate V 36
    decision 1, fold round 2).
  - M-1: the strict in-tab repeat of the same role deep link is Jest-only (`settings.component.spec.ts:362-363`,
    `orchestration-settings.component.spec.ts:154`); no UI can raise it. The Playwright scene repeats it through the
    Providers drawer (36c.g).

- Recommended executor: Orchestration owner, then the visual-reviewer subagent for the gate
- Fallback executor: as Batch 29
- Execution mode: sequential
- Review route: the **combined cross-side code review** of the whole Orchestration diff (Batches 29-36) (user decision 2026-09-30) **and** a visual-reviewer PASS (`TASK\visual-review.md`,
  Orchestration section)
- Tasks: 1 | Depends on: Batch 35

### Task 36.1: `settings-orchestration.e2e.spec.ts`, the Orchestration half of the visual spec, zero `pending` entries — COMPLETE (Gate V 36 passed after 36b-36d)

- Files:
  - CREATE `HARNESS\settings-orchestration.e2e.spec.ts`
  - MODIFY `HARNESS\settings-visual.e2e.spec.ts`
  - MODIFY `HARNESS\settings-reachability.table.ts` (zero `pending`)
  - MODIFY `CHAT\ptah-ai\orchestration-settings.component.ts`, only for density fixes the gate requires
- Plan reference: implementation-plan.md:1049-1052, §7 S6 (:1142)
- Pattern to follow: Batch 28 scenes
- Quality requirements: fold at 1024×768 in both hosts and both themes, with the 5+2 reference set:
  - the bottoms of `orchestration-policy-bar`, the `cli-matrix` header, the first row and `background-roles-summary`
    are ≤ 660 px
  - `table-xs`
  - `background-roles-details` is closed by default
  - row heights are logged
- Validation notes: scenes to cover:
  - cell pick → `agent:setConfig`
  - on/off
  - Tiers → `ptahCli:update` with the full object
  - adding a Copilot instance requires sign-in
  - roles collapsed by default
  - deep-link `judge` opens the details with the Judge row editing
  - `setupProviderRequested` lands on Providers with the wizard open
- Implementation details: the new permission copy (Batch 29) goes into the visual review for user review.
- **User review list for Gate V 36 (recorded at the Batch 29 commit, 41b85393c):**
  1. `PENDING_USER_REVIEW_IDS = ['copilot', 'ptah-cli']` (`cli-permission-notes.ts:17`), copy from
     `batch-29-report.md` §2:
     - Copilot, auto-approve on: badge "Auto-approve: On", detail "Copilot runs every tool call without asking for
       approval."
     - Copilot, auto-approve off: badge "Auto-approve: Off", detail "Copilot runs read-only tools without asking.
       Every other tool call waits for your approval."
     - Copilot, setting not loaded: badge "Auto-approve: unknown", detail "The saved Copilot auto-approve setting has
       not loaded, so its permissions are unknown."
     - Ptah instance: badge "Follows Autopilot", detail "Uses the chat's Autopilot setting. With Autopilot off, each
       tool call waits for your approval; Auto-edit approves file edits only; Plan Mode is read-only; Full Auto
       approves every action."
  2. Deviation: the prototype's Ptah-instance copy ("Sandboxed Port", "Runs in an isolated child process …
     restricted to configured workspace root") is not used, because the code does not support it (a Ptah instance
     runs through the Agent SDK with the chat's permission level; YOLO maps to `bypassPermissions`,
     `ptah-cli-registry.ts` `resolvePermissionOptions`).
  3. Prototype mismatch: the prototype's Pi install package `@inflection/pi-cli` contradicts the adapter, which names
     `@earendil-works/pi-coding-agent`.
  4. From Batch 30: the install-guide copy for Cursor, Antigravity, opencode and Pi is new (old #77 copy covers only
     Codex and Copilot) and needs user review.
  5. Batch 31 copy (`batch-31-report.md` §4).
- **Open item (recorded at the Batch 30 commit, 07da3f4f6):** Electron Orchestration fold: projected roles-summary
  bottom about 746 px (86 px over 660); options in `batch-30-report.md` (collapse Uninstalled group / Gate V 28
  precedent / denser narrow layout); decide at Gate V 36.
- **Open items (recorded at the Batch 31 commit, c04a85a4e):**
  - (a) The Electron fold overrun is now about 104 px: the Cursor row stacks Credentials over Install guide.
  - (b) After clicking the toast's Undo with a popover open, Esc no longer closes the popover, because focus has left
    it (existing `NativePopoverComponent` behaviour).
  - (c) The Cursor key saves without a connection check (none exists for Cursor), while task.md says credentials
    require a passing check.
- **Batch 32 items (HANDOFF.md Gate V 36 list, items 7-8):**
  - Item 7, the tier field showed "saved, not in the current list" instead of the model ID: **FIXED by Batch 32b
    (b1ef5eb50)**. The closed compact field now shows the ID (`current-orchestration-modal-tiers-*` read
    `glm-5.3:cloud`). No user decision needed.
  - Item 8, leaving the tier modal from a focused tier field takes two Esc presses (the field opens its list on
    focus): still open, for user review.
- **Batch 33 items (recorded at the Batch 33 commit, 45fbd7146):**
  - (a) The Electron fold is now at 779 px for the roles summary (119 px over 660); it was projected 104 px over before
    the bar. VS Code fits (643 px). This adds to open item 4 / Batch 31 (a).
  - (b) In Electron the order chips clip behind a fade after the third chip. The full order is in the order popover and
    in the Edit button's accessible name.
  - (c) The visible label "Preferred Order:" is shortened to "Order:". "Preferred order" stays in the Edit button's
    name and the popover title; the prototype's "lanes" suffix is dropped.
  - (d) The Electron e2e `apps/ptah-electron-e2e/src/specs/settings/settings.spec.ts` and
    `apps/ptah-electron-e2e/src/docs-screenshots/workspace-settings.shot.ts` must open the roles details
    (`background-roles-summary`) before looking for `assignments-heading` (stale since Batch 18). Owned by Batch 37.
- **Batch 34 items (recorded at the Batch 34 commit, 7dd06a872):**
  - #45 model count now lives in the instance Model popover: "12 models available from Ollama Cloud." (singular
    "1 model available from {Provider}."), hidden until `cliAgents` loads, and not shown for system CLIs
    (`cli-model-effort-popover.component.ts:113-117`). New copy, for user review.
  - For the combined code review: the matrix line "Test failed: {reason}" (`cli-orchestration-matrix.component.ts:476`)
    shows the host's reason. It is accepted for now because the registry sanitizes it (`ptah-cli-rpc.handlers.ts:301-303`,
    Batch 12b), but the reviewer should confirm it against the fixed-sentence rule.
- **Batch 35 items (recorded at the Batch 35 commit, 2d59760e1; `batch-35-report.md` "For Gate V 36" 1-6):**
  1. New copy, for user review:
     - "Follows main agent → {driver}" (truncated in the cell, with the full route in the title);
     - "Reassign {Role}" (the popover's dialog name);
     - "Each choice saves at once, with Undo. No provider follows the main agent.";
     - the " Not saved." suffix on blocking readiness sentences;
     - the toast label "{Role} assignment";
     - the tier badges "direct model" / "{tier} tier".
  2. No Purpose column: the prototype's per-role purpose texts have no product source. Only Judging & enhancement
     keeps its existing helper copy.
  3. The Scope column is blank for inherited global values (D16), which is every role in the fixture.
  4. A provider change saves with the model reset to the tier default; choosing a model is then a second save with its
     own Undo.
  5. The role popover flips above its cell when there is no room below, covering the rows above while open.
  6. The reachability per-host budget is now 600 s (`settings-reachability.e2e.spec.ts`), with lines identical to
     track B's `d0b6c6f39`, so the merge needs no resolution.
- **Batch 36 items (recorded at the Batch 36 implementation commits, 6384f0a22 + e75a1cf31; `batch-36-report.md` §9-10):**
  - Item 4 / Batch 31 (a) / Batch 33 (a), unchanged: the Electron roles summary is at 779 px (119 over), while VS Code
    fits at 643. The fold gate (`assertOrchestrationFold`, `settings-visual.e2e.spec.ts`) enforces every other region
    and logs this one as `fold-pending`, behind `ORCHESTRATION_ELECTRON_ROLES_FOLD_ENFORCED = false`. Flip the flag to
    `true` after the user's decision (and any layout change).
  - Item 5 / Batch 31 (b): the extension found in Batch 36 (Esc ignored for about 100-300 ms while an order move saves,
    because natively disabled move buttons dropped focus) is **FIXED** in 6384f0a22. The move buttons are
    `aria-disabled` during a save and keep focus. Item 5 itself (Esc after clicking the toast's Undo) is unchanged.
  - The new scenes exercise copy already on this list: "Awaiting sign-in" / "Signed in", "Set up {provider}",
    " Not saved.", "Follows main agent → {driver}".
  - `settings.fixtures.ts` is 703 lines, 1 over the 700-line rule, after Batch 36's `bootSettings` overrides (harness
    fixture; accepted by the orchestrator).
  - Zero `pending` capability entries: 98 = 64 `present` + 34 `restored`.

### Batch 36 verification

- Same command as Batch 29
- Gate V (Orchestration)
- `visual-review.md` Orchestration PASS against `prototypes/final/screenshots/orchestration-{anubis,anubis-light}-1024x768.png`
  (density follows the §1.2 budget, not the prototype's 56 px rows)
- The combined Orchestration (29-36) code review accepts

## Batch 36b: Gate V 36 review fixes (S6) — COMPLETE (21e29b3e7 core, 3dcf61755 ui, 81940b389 chat, 707a153e0 harness + captures, 8fb6dfe25 docs)

- Executor: two in-process frontend-developer streams (stream 1 matrix/modals/shared ui/core,
  `batch-36b-matrix-report.md` incl. "Fold round 2"; stream 2 policy bar/roles, `batch-36b-roles-report.md`)
- Review route: Gate V 36 re-checks by same-side code-logic-reviewer subagents (disclosed; no CLI lane):
  29-32 APPROVED WITH NOTES 8/10, 33-36 APPROVED WITH NOTES 8.5/10. Visual re-check pending.
- Depends on: Batch 36 implementation (6384f0a22, e75a1cf31)

### Task 36b.1: stream 1 — CLI matrix, popovers, modals, shared ui, core (S1, S2, M1-M9, V36-1, V36-2, V36-4, V36-7, V36-9, fold round 2) — COMPLETE

- Files: core `providers-settings-state.service.ts` (+spec), `providers-settings.types.ts`; ui `native-modal`,
  `provider-model-picker`, `provider-model-search-field` (+specs); chat `ptah-ai/cli-orchestration-matrix`,
  `cli-model-effort-popover`, `cursor-credential-popover`, `copilot-auto-approve-toggle`,
  `providers/add-cli-instance-modal`, `cli-tier-mapping-modal`, `feedback/settings-save-feedback.service` (+specs);
  harness `settings-cli-matrix.entries.ts`, `settings-reachability.table.ts`, `settings-orchestration.e2e.spec.ts`,
  `settings-visual.e2e.spec.ts` (`ORCHESTRATION_ELECTRON_ROLES_FOLD_ENFORCED = true`)
- Fold: VS Code roles summary 550 px, Electron 600 px (budget 660), enforced in both hosts and themes

### Task 36b.2: stream 2 — policy bar and roles (S-1, M-1, M-2, m-1, V36-2, V36-6, V36-8) — COMPLETE

- Files: chat `ptah-ai/agent-orchestration-config`, `orchestration-settings` (`focusTargetConsumed`),
  `providers/provider-consumer-assignments`, `provider-consumer-rows` (+specs), `settings.component.html` (one
  binding) + `settings.component.spec.ts`

### Batch 36b verification

- See the "36b" row of the commit and verification log: typecheck/lint, test, build 3.46 MB, Gate G 27/27, settings
  folder 72 passed / 2 skipped (fixme) / 0 failed

## Batch 36c: Gate V 36 re-check notes — COMPLETE (2d4793b7f chat, 2bdae1006 harness + captures, 493baad02 docs)

- Report: `batch-36c-report.md` (tasks a-j). Reviews: same-side (code re-check notes from code-logic-reviewer
  subagents, visual Re-check 1 from a visual-reviewer subagent; no CLI lane), disclosed in the commit bodies. The visual
  Re-check 2 runs on these commits; Batch 36 stays IN_PROGRESS until it accepts.
- Round 1, team-leader verify (2026-10-02, blocked): typecheck,lint 5 projects exit 0 (`%TEMP%\b36c-tl-tl.log`); test 4 projects exit 0
  (core/ui/chat from cache on the owner's identical inputs; `%TEMP%\b36c-tl-test.log`); build 3.46 MB; Gate G 9/9
  (`%TEMP%\b36c-tl-gateG.log`). Full settings folder (`%TEMP%\b36c-folder.log`): 75 passed / 2 skipped (fixme) /
  **1 failed**: `settings-providers.e2e.spec.ts:128` (vscode) "popover model search filters the models…", `:153`
  `locator('[id="null"]')` not found: `:152` reads `aria-activedescendant` once right after `Home`, without waiting.
  Reproduced with `--repeat-each=3` (`%TEMP%\b36c-repeat.log`): 5 passed / 1 failed, same error. Not in a 36c-touched
  file (spec and `libs/frontend/ui` picker unchanged; the 36c popover edit runs after Enter). Suspected: test race under
  load. Fix (executor): wait for a non-empty `aria-activedescendant` (e.g. `toHaveAttribute(..., /.+/)`) before reading.
  Captures: 40 `current-orchestration-*` kept; 22 non-orchestration captures had 0 visible pixels and were restored.
- Round 2, after task j: harness typecheck,lint exit 0 (`%TEMP%\b36c-r2-tl.log`); Gate G 9/9
  (`%TEMP%\b36c-r2-gateG.log`); full settings folder (`%TEMP%\b36c-r2-folder.log`) 75 passed / 2 skipped (fixme) / 1
  failed = **worker crash** `code=3221226505` (0xC0000409, the Node crash also seen in `b36b-tl-tl.log`), no assertion,
  in `settings-orchestration.e2e.spec.ts:209` (electron) "roles are collapsed by default". The j scene `--repeat-each=3`
  (`%TEMP%\b36c-r2-repeat.log`) hit the same crash once (electron), no assertion. Not reproduced: both tests
  `--repeat-each=3` 6/6 (`%TEMP%\b36c-r3-orch.log`, `%TEMP%\b36c-r3-repeat.log`). Suspected cause: process crash under
  machine load (other sessions), not test logic. Captures: 40 `current-orchestration-*` kept; 18 others had 0 visible
  pixels and were restored by exact path. No `baseline-*` touched.
- Tasks h (More-menu column, visual re-check N1), i (18 px `cli-check`, `capture()` disables animations and waits
  for the matrix) and j (spec race fix) were added by the orchestrator.

- Recommended executor: Orchestration owner (in-process frontend-developer)
- Execution mode: sequential
- Source: re-check sections of `gate-v36-code-logic-review-29-32.md` (N-1..N-3) and
  `gate-v36-code-logic-review-33-36.md` (N-1, N-2, M-1 harness gap); Phase 1 capture finding of Batch 36b
- Tasks: 10 | Depends on: Batch 36b

### Task 36c.a: saveDraft reverts from the returned save() value — COMPLETE

- `provider-consumer-assignments.component.ts:346-360` `saveDraft`: decide the revert from the returned `save()` value
  (`'saved'`), not `commit().status` (33-36 N-1). Same check for `main-agent-reassign-popover.component.ts:378`.

### Task 36c.b: fixed TIMEOUT_NOT_SAVED wording for a refused save — COMPLETE

- 33-36 N-2: when the time-limit save is refused because another save runs, show a correct fixed sentence.

### Task 36c.c: Add toast without "Testing the connection." when no test runs — COMPLETE

- 29-32 N-1: `add-cli-instance-modal.component.ts:319`, `cli-orchestration-matrix.component.ts:475-477`.

### Task 36c.d: focus after the Cursor key is removed — COMPLETE

- 29-32 N-2: the row moves into the collapsed Uninstalled group; `closeCredentials` must put focus on a stable element
  (e.g. the Uninstalled group summary), not `body` (`cli-orchestration-matrix.component.ts:505-508`, `:435-438`).

### Task 36c.e: rename rejected, key saved — the alert says the key is stored — COMPLETE

- 29-32 N-3: `add-cli-instance-modal.component.ts:352`.

### Task 36c.f: captures move the pointer away before each screenshot — COMPLETE

- Harness: settings visual/scene captures call e.g. `page.mouse.move(0, 0)` before each screenshot so no hover state is
  captured (seen in Batch 36b: `current-providers-{electron,vscode}-anubis-light` Retry hover).

### Task 36c.g: Playwright scene for the repeated in-tab deep link — COMPLETE

- 33-36 M-1 is Jest-only today; add a scene that raises a second pending-tab request for the same role.
- Done as the `judge` deep link twice through its only real route (Providers drawer); the strict in-tab repeat has no
  in-app trigger and stays pinned by Jest (disclosed in the report).

### Task 36c.h: More actions menu is a column inside its panel — COMPLETE

- Visual re-check 1 N1: `cli-orchestration-matrix.component.ts:294-297` (`flex w-40 flex-col`); Jest classes case and a
  Playwright bounds scene (`settings-orchestration.e2e.spec.ts:244`, both hosts).

### Task 36c.i: On checkbox tick centred — COMPLETE

- Cause: daisyUI's 0.2 s checkmark animation captured mid-flight on the deferred matrix. Fix: 18 px `cli-check`
  (`cli-orchestration-matrix.component.ts:136`, `:386-390`); `capture()` disables animations and the Orchestration
  capture waits for the matrix rows. Accepted by the orchestrator on the 8x crops.

### Task 36c.j: providers scene polls aria-activedescendant — COMPLETE

- `settings-providers.e2e.spec.ts:151-158` uses `expect.poll` on the attribute and the active row's text instead of one
  read after `Home` (the round 1 folder failure). Owner: `--repeat-each=5` both hosts 10/10; team-leader: 6/6.

## Batch 36d: Gate V 36 visual re-check 2 (N3) + 36c task d browser check — COMPLETE (e4b2cf311 chat, 8716cd046 harness + captures, ef3dec4df docs)

- Report: `batch-36d-report.md`. Source: `visual-review-gate-v36.md` "Re-check 2" N3 and the unverified 36c task d focus.
- Review: same-side (visual Re-check 2 by a visual-reviewer subagent, PASS WITH NOTES 8/10), disclosed in the commits.
- Tasks: 2 | Depends on: Batch 36c

### Task 36d.a: Cursor key popover keeps focus during a save (N3) — COMPLETE

- `CHAT\ptah-ai\cursor-credential-popover.component.ts` (+spec): key field `readonly` + `aria-busy`, buttons
  `aria-disabled` (never native `disabled`), handlers refuse while busy or empty; focus to the key field after a save,
  to Cancel when the remove confirm opens, back to "Remove stored key" on Cancel. Visible change: the empty-field Save is
  primary at 50% opacity instead of grey (`current-orchestration-popover-cursor-*`).

### Task 36d.b: browser scenes for the Cursor key focus paths — COMPLETE

- `HARNESS\settings-cursor-key.fixtures.ts` (new), `HARNESS\settings-orchestration.e2e.spec.ts`: a failed save keeps
  focus and Esc returns it to the trigger; save then remove puts the row back in the collapsed Uninstalled group with
  focus on its toggle.

### Batch 36d verification

- See the "36d" row of the commit and verification log.

## Merge of track B (after Gate V 36) — COMPLETE (31337c533, parents ef3dec4df + 74c2dfda5)

- `git merge --no-ff --no-commit feat/task-555-advanced-search-voice` (B at 74c2dfda5, clean; A at ef3dec4df, clean).
  Merge base 41b85393c. B changes outside `.ptah`: chat (53 files), webview-e2e-harness (9),
  `apps/ptah-electron-e2e/src/docs-screenshots/workspace-settings.shot.ts` (auto-merged).
- Conflicts and resolutions (team-leader, by reading both sides):
  1. `CHAT\feedback\settings-save-feedback.service.ts`: A added `SettingsSaveResult` + the raw-key filter; B added
     `SettingsGenericSaveRequest` at the same spot. Kept both. `saveGeneric` now returns `SettingsSaveResult`
     ('refused' / 'failed' / 'saved', additive, same meaning as `save()`). All 25 production callers ignore the return
     and decide inside their own `write()` closure; none reads `commit()` or `toast()`, so D15 holds. The spec was
     auto-merged and has no assertion on the new return value (follow-up). One doubled blank line removed.
  2. `CHAT\index.ts`: both sides only removed exports (A: `PtahCliConfigComponent`, retired in Batch 34; B: the
     deferred Advanced / Search & Voice children). Took both removals; no importer outside the folder.
  3. `HARNESS\settings-reachability.table.ts`: both imports and spreads kept (A `CLI_MATRIX_ENTRIES`; B
     `ADVANCED_ENTRIES`, `SEARCH_VOICE_ENTRIES`). Count from the shared 94: A 98, B +43 (ADV-1..24, SV-1..19) →
     `EXPECTED_CAPABILITY_COUNT = 141`. Gate G passes with it (the spec asserts the table length).
  4. `HARNESS\settings.fixtures.ts` (`bootSettings`): `{ ...withAdvancedSearchVoice(state, statefulSettingsFixtures(state)), ...overrides }`
     (B's layer, A's per-boot overrides last). File is 704 lines (A 703, B 703; 1 over the accepted 703, recorded).
  - Auto-merged: `settings.component.html` / `.ts` / `.spec.ts`, `settings-save-feedback.service.spec.ts`,
    `settings-reachability.e2e.spec.ts`, `task.md` (both Gate V 50 and Gate V 36 entries present).
- Verify (serial): typecheck,lint exit 0 for chat, core, ui, webview-e2e-harness, webview, ptah-electron-e2e
  (`%TEMP%\bmerge-tl.log`); test exit 0 (chat and webview ran, core/ui from cache; `%TEMP%\bmerge-test.log`); build
  **3.32 MB** (under 3.5 MB; B's deferred tabs left the eager bundle); Gate G 9/9 (`%TEMP%\bmerge-gateG.log`); full
  settings folder **88 passed / 2 skipped (fixme) / 0 failed**, including `settings-advanced-search-voice.e2e.spec.ts`
  (`%TEMP%\bmerge-folder.log`). A's native-modal, search-field and `capture()` changes did not break B's scenes.
- Captures: the folder run rewrote 41 captures; 9 differed visibly from the merge result (crops
  `%TEMP%\bmerge-crop-*.png`). Orchestrator decision: **kept 7** (settled focus fill / card shadow from `capture()` with
  animations off): `current-advanced-output-style-{electron,vscode}-{anubis,anubis-light}`,
  `current-advanced-mcp-vscode-anubis`, `current-advanced-mcp-electron-{anubis,anubis-light}`, committed inside the
  merge commit. **Restored 34** by exact path: `current-main-agent-model-search-{electron-anubis,vscode-anubis-light}`
  (active row not yet drawn at capture time, Batch 51 task 3) and 32 with no visible change. No `baseline-*` modified.
- Commit: `31337c533`, git's default merge subject (commitlint ignores it; `commitlint --edit` exit 0), body via
  `git commit -F`.

## Batch 51: muted token + style polish (after the merge) — COMPLETE (a93b37656 webview, af8f23c3a chat, 68dc462cb harness + fonts + captures)

- Recommended executor: in-process frontend-developer (one owner; shared styles, then all-tab re-capture)
- Execution mode: sequential
- Depends on: Merge of track B (31337c533)
- Tasks: 6 (51.6 added by the orchestrator). Report: `batch-51-report.md`.
- Review: no separate code review; the orchestrator accepted the report and the 30 kept captures.
- Team-leader checks: no stray files from the owner's mis-run shell write (git status incl. ignored, nothing in the
  worktree root newer than 31337c533; report clean, 246 lines). Fonts: 15 woff2 (all `wOF2` magic), 3 OFL 1.1 texts
  with copyright lines, 376 KB; the harness has no build/asset target and no app config references the folder.
  Scoping: both aria-disabled rules use `:where(ptah-settings)` (the Settings selector); `--bcm` changes only in the
  `anubis` and `anubis-light` theme blocks. **Note:** the table-header rule `.table :where(thead, tfoot)` is app-wide:
  it also recolours headers outside Settings (dashboard, marketplace, skill synthesis) in every theme. Batch 38 or a
  follow-up should look at those surfaces.

### Task 51.1: muted text token contrast — COMPLETE

- Raise the shared muted text token in anubis-light to >= 4.5:1 (Gate V 50 decision 4: light table headers 4.45:1,
  "Order:", matrix subtitle, roles helper 4.45, Uninstalled header 4.14) and fix the dark Uninstalled header 4.39:1
  (V36-3). Webview app styles. Re-capture all tabs.

### Task 51.2: aria-disabled buttons look like native disabled — COMPLETE

- One shared rule, not per component, for buttons with `aria-disabled="true"`: the 36b move buttons, the role cell, the
  36d Cursor popover Save/Remove, any other. The empty-field Cursor "Save key" now shows primary at 50% opacity
  (`%TEMP%\b36d-crop-cursor.png`).

### Task 51.3: model-search capture waits for the active row — COMPLETE

- Harness: the main-agent model-search capture waits for `aria-activedescendant` / the active row before the
  screenshot (2 of 4 variants caught it before the active row was drawn in the merge run).

### Task 51.4: saveGeneric spec asserts its result — COMPLETE

- `settings-save-feedback.service.spec.ts`: assert the `SettingsSaveResult` return of `saveGeneric` (refused, failed by
  `ok:false`, failed by throw, saved) — merge follow-up.

### Task 51.5: Gate G no longer depends on the network — COMPLETE

- `HARNESS\..\..\csp-stub.ts:40` fetches the Inter font from `fonts.gstatic.com`; two Gate G runs failed on the network
  (36d). Serve the font locally or stub the request.
- Done: a local OFL copy under `libs/frontend/webview-e2e-harness/src/lib/fonts/`; nothing is fetched.

### Task 51.6: one shared capture helper for every settings spec — COMPLETE

- `HARNESS\settings-capture.ts` (`capture()`, `capturePath()`), used by the visual spec and the track B Advanced /
  Search & Voice spec (its own `shoot()` removed): settled page, pointer away, animations off.

## Advanced and Search & Voice tabs (Batches 39-50)

Source: `TASK\pattern-map-advanced-search-voice.md` §8 (APPROVED 2026-09-30, with its antigravity review
`pattern-map-advanced-search-voice-review.md` APPROVED). No new prototype and no Gate 1.7: these tabs reuse the
approved `prototypes/final/` patterns P1-P12 (map §1). Plan step label: **AS**. Batches 39-50 run after Batch 36; 37
and 38 run after 50.

Common to every batch 39-50 (recorded defaults):

- Recommended executor: `frontend-developer`, the **"Advanced/Search owner"**, in-process, one instance continued
  with SendMessage between batches (execution default 2). Fallback: a fresh in-process frontend-developer reading this
  section and the previous batch reports.
- Execution mode: sequential, in number order (see the parallelism map).
- Review route: **no per-batch code review** (user decision 2026-09-30). Each batch commits after typecheck/test/lint,
  **Gate G** and the smoke captures. The combined cross-side code review of Batches 39-50 and the visual-reviewer
  Gate V run at Batch 50.
- Verify command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview`
  (serial, output tailed), then Gate G (execution default 7), then the smoke captures (default 9).
- Accepted decisions to apply (task.md "## Decisions", 2026-09-30): gaps G1-G3, G5-G7, G11-G13 as proposed in map §5;
  G9 resolved (one "Chat reasoning effort" cell, same setting as Providers > Main Agent effort); **PR-1** (dead
  "Default for new sessions" preset radios) and **PR-2** ("Workflows require a paid plan." sentence) removals approved.
- Preserve list: map §4. Every capability listed there stays or moves; nothing else is removed. The harness/e2e
  selector safe-list (map §4 last row) is updated **in the same batch** as any rename.
- D15 applies everywhere: "Saved" only after the write's own result; a failed write reverts the control and shows
  an alert toast. Text stays `text-base-content` (deviation 6).
- Deletions (41, 42, 44) are atomic with the mount of their replacement (D14), like Batch 34.
- Persisted-settings writes changed by a batch are listed with their RPC → store key → runtime reader in the batch
  report (feeds the Task 37.2 write-path trace).
- CHAT paths below are relative to `CHAT` (`ROOT\libs\frontend\chat\src\lib\settings`).
- Targeted Jest runs use --testPathPatterns (Jest 30 ignores --testPathPattern).

## Batch 39: foundation — generic save entry (G2) + Advanced / Search & Voice tab shells (AS) — COMPLETE (f316580ea, track B)

- Recommended executor: frontend-developer (Advanced/Search owner), in-process
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 36

### Task 39.1: generic save entry on `SettingsSaveFeedbackService`; `AdvancedSettingsComponent` and `SearchVoiceSettingsComponent` shells; Data Portability logic moves into the Advanced shell — COMPLETE

- Files (6):
  - MODIFY `CHAT\feedback\settings-save-feedback.service.ts`, `CHAT\feedback\settings-save-feedback.service.spec.ts`
  - CREATE `CHAT\advanced-settings.component.ts`, `CHAT\search-voice-settings.component.ts` (location next to the
    Providers/Orchestration shells; follow their placement)
  - MODIFY `CHAT\settings.component.ts`, `CHAT\settings.component.html`
- Plan reference: pattern map §8 row 39, §5 G2, §9 items 1 and 8
- Pattern to follow: `ProvidersSettingsComponent` / `OrchestrationSettingsComponent` shells; the existing
  `SettingsSaveFeedbackService.save` (D3 disable-while-saving, 8 s toast, Undo)
- Quality requirements: the generic entry takes `write: () => Promise<{ok:true}|{ok:false,message}>`, an optional
  Undo and a label; toast "Saved {label}." with no scope words; the Providers entry is unchanged (its specs stay
  green). The shells host the existing children unchanged. Deep-link tab ids `pro-features` and `tools` stay.
- Validation notes: Export/Import move with their logic, not re-implemented; `aria-label="Export settings"` kept.

## Batch 40: Advanced — Membership & data card (AS) — COMPLETE (0e5cb4d38, track B)

- Recommended executor: frontend-developer (Advanced/Search owner), in-process
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 39

### Task 40.1: Membership & data card (A1-A9), membership key popover (A5), inline Log out confirm (A4), Import feedback (A9) — COMPLETE

- Files (3): MODIFY `CHAT\license\license-status-card.component.ts`; CREATE `CHAT\license\license-status-card.component.spec.ts`;
  MODIFY `CHAT\advanced-settings.component.ts`
- Plan reference: pattern map §2.1 rows A1-A9, §4, §5 G3/G12, P8/P12
- Quality requirements: one primary action in the card; key format check + server verify before save (S-verify);
  Log out and Import confirm first, no Undo; `ptah-license-status-card` selector kept.

## Batch 40b: Advanced — membership card host-text fix (AS follow-up) — COMPLETE (011961e9e, track B)

- Executor: in-process frontend-developer (Search & Voice owner), same-side; base Batch 40 author Glm lane
- Execution mode: sequential | Tasks: 1 | Depends on: Batch 40; found by the Batch 45b host-text scan

### Task 40b.1: fixed sentences for membership key activation and log-out failures — COMPLETE

- Files (3): MODIFY `CHAT\license\license-status-card.component.ts` + spec; `TASK\batch-40b-report.md`
- Quality requirements: no `result.error` / `data.error` / `error.message` in any visible alert; one fixed sentence per
  action ("Could not activate the membership key." / "Could not log out."); log-out confirm stays open on failure;
  the local key-format message and the success line unchanged.

## Batch 41: Advanced — Agent behaviour card; deletes `workflows-config` (AS) — COMPLETE (81caf233a, track B)

- Recommended executor: frontend-developer (Advanced/Search owner), in-process
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 40

### Task 41.1: Agent behaviour card (A10, A11, A26, A27, A29), PR-1 and PR-2 applied, "Chat reasoning effort" cell (G9) — COMPLETE

- Files (5): CREATE `CHAT\pro-features\agent-behaviour-section.component.ts` + spec; DELETE
  `CHAT\pro-features\workflows-config.component.ts` + spec; MODIFY `CHAT\advanced-settings.component.ts`
- Plan reference: pattern map §2.1 rows A10-A12, A26-A29, §6 PR-1/PR-2, §5 G1/G9, §9 item 11
- Quality requirements: S-sel with Undo; effort read-back check because `EffortStateService.setEffort` returns void
  (a failed write is never toasted as saved); Ultracode restores the previous effort; sub-note "Same value as
  Providers > Main Agent effort"; `aria-label="Toggle Enhanced System Prompt"` kept.
- Validation notes: atomic deletion (D14); PR-1 and PR-2 are removed only as approved.

## Batch 42: Advanced — System prompt drawer D-SP; deletes `enhanced-prompts-config` (AS) — COMPLETE (c0877c675, track B)

- Recommended executor: frontend-developer (Advanced/Search owner), in-process
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 41

### Task 42.1: System prompt drawer (A14-A18) — COMPLETE

- Files (5): CREATE `CHAT\pro-features\system-prompt-drawer.component.ts` + spec; DELETE
  `CHAT\pro-features\enhanced-prompts-config.component.ts`; MODIFY `CHAT\pro-features\agent-behaviour-section.component.ts`,
  `CHAT\advanced-settings.component.ts`
- Plan reference: pattern map §2.1 rows A14-A18, P6, §5 G5/G6
- Quality requirements: generated-at, detected stack, view, regenerate (confirm first, progress up to 120 s),
  download and empty-state guidance all kept; preview through `ptah-markdown-block` only.

## Batch 43: Advanced — Output style matrix + editor drawer D-OS (AS) — COMPLETE (4a4bc3df4, track B)

- Recommended executor: frontend-developer (Advanced/Search owner), in-process
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 39 (runs after 42, number order)

### Task 43.1: Output style (A19-A25): list → matrix with "Active" radio column, editor → drawer, CLI parity `<details>` — COMPLETE

- Files (5): MODIFY `CHAT\output-style\output-style-config.component.ts`, `CHAT\output-style\output-style-list.component.ts`
  + spec, `CHAT\output-style\output-style-editor.component.ts` + spec
- Plan reference: pattern map §2.1 rows A19-A25, §5 G6/G7, P4/P6/P9
- Quality requirements: store unchanged; `role="radiogroup"` retained; invalid-file list, collision / fallback /
  missing-active banners and copy-to-project kept; parity file write confirms first, no Undo.

## Batch 43b: Advanced — output-style parity warning host-text fix (AS follow-up) — COMPLETE (1de289ccd, track B)

- Executor: in-process frontend-developer (Search & Voice owner), same-side; base Batch 43 author antigravity lane
- Execution mode: sequential | Tasks: 1 | Depends on: Batch 43; found by the Batch 45b host-text scan

### Task 43b.1: parity "malformed settings file" warning without the JSON parser text — COMPLETE

- Files (3): MODIFY `CHAT\output-style\output-style.store.ts` + spec; `TASK\batch-43b-report.md`
- Quality requirements: `SETTINGS_MALFORMED` shows a fixed sentence with the constant-derived path; the audited fixed
  backend codes pass through; any other code gets the fixed fallback; the save conflict prompt (fixed templates) kept.

## Batch 44: Advanced — MCP & browser + VS Code LM cards; deletes `browser-settings` (AS) — COMPLETE (3286a18ec, track B)

- Recommended executor: frontend-developer (Advanced/Search owner), in-process
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 42 (serialises `advanced-settings.component.ts` edits; runs after 43)

### Task 44.1: MCP port policy row, namespace matrix, "Allow localhost" folded in (A30-A32); VS Code LM card with D15 fix (A33-A37) — COMPLETE

- Files (6): MODIFY `CHAT\pro-features\mcp-port-config.component.ts`; DELETE `CHAT\pro-features\browser-settings.component.ts`;
  MODIFY `CHAT\pro-features\vscode-lm-config.component.ts`; CREATE `CHAT\pro-features\mcp-port-config.component.spec.ts`,
  `CHAT\pro-features\vscode-lm-config.component.spec.ts`; MODIFY `CHAT\advanced-settings.component.ts`
- Plan reference: pattern map §2.1 rows A30-A37, P3/P4
- Quality requirements: port validation and restart note kept (S-explicit, Undo restores the previous port);
  "Allow localhost" enable confirms first; CLI re-detect after an LM model change kept; `ptah-vscode-lm-config` kept.

## Batch 45: Search — Web search matrix (AS) — COMPLETE (40f4bc821, track B)

- Recommended executor: frontend-developer (Advanced/Search owner), in-process
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 39 (runs after 44, number order)

### Task 45.1: Web search matrix (V1-V8) with confirm-on-clear and the silent-failure fix — COMPLETE

- Files (4): MODIFY `CHAT\ptah-ai\web-search-config.component.ts`; CREATE `CHAT\ptah-ai\web-search-config.component.spec.ts`;
  MODIFY `CHAT\search-voice-settings.component.ts`, `ROOT\apps\ptah-electron-e2e\src\specs\settings\settings.spec.ts`
  (only if a testid changes)
- Plan reference: pattern map §3.1 rows V1-V8, §5 G11 (save-then-test kept)
- Quality requirements: `ptah-web-search-config` and `settings-toggle-web-search-provider-*` kept; Clear key
  confirms first, no Undo.
- Validation notes: this batch touches an app (`ptah-electron-e2e`); if the file changes, add its lint to the verify.

## Batch 45b: Search — web search host-text fix + settings-folder host-text scan (AS follow-up) — COMPLETE (0947cea9e, track B)

- Executor: in-process frontend-developer (Search & Voice owner), same-side; base Batch 45 author opencode lane,
  completed in-process
- Execution mode: sequential | Tasks: 1 | Depends on: Batch 45

### Task 45b.1: fixed sentences for web search failures; host-text scan of `CHAT` — COMPLETE

- Files (3): MODIFY `CHAT\ptah-ai\web-search-config.component.ts` + spec; `TASK\batch-45b-report.md` (incl. the scan)
- Quality requirements: one fixed sentence per action (load, providers, max results, key save, key clear); a failed
  connection check shows "The connection check failed." and never the probe exception text.
- Open from the scan (not fixed here, see the commit log row): `advanced-settings.component.ts` Import outcome
  (`result.error`, `Import failed: ${error.message}`); `agent-orchestration-config.component.ts:404, :617`
  (`result.error`); `mcp-port-config.component.ts:251-253` (owned by Batch 44).

## Batch 46: Voice — engines matrix + drawer D-VOICE shell (AS) — COMPLETE (795fb435a, track B)

- Recommended executor: frontend-developer (Advanced/Search owner), in-process
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 45

### Task 46.1: Voice engines matrix (V9-V12) and `voice-details-drawer` mounting the existing panels — COMPLETE

- Files (5): MODIFY `CHAT\ptah-ai\voice-config.component.ts` + spec; CREATE `CHAT\ptah-ai\voice-details-drawer.component.ts`
  + spec; MODIFY `CHAT\search-voice-settings.component.ts`
- Plan reference: pattern map §3.1 rows V9-V12, P4/P6
- Quality requirements: STT/TTS provider selection, including unavailable-with-reason, kept; voice rows stay hidden
  on VS Code where they are today.

## Batch 47: Voice — local STT/TTS panels (AS) — COMPLETE (bd4c5c6a3, track B)

- Recommended executor: frontend-developer (Advanced/Search owner), in-process
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 46

### Task 47.1: local panels reflowed for the drawer + D15 fixes (V13-V20) — COMPLETE

- Files (4): MODIFY `CHAT\ptah-ai\local-stt-panel.component.ts` + spec, `CHAT\ptah-ai\local-tts-panel.component.ts` + spec
- Plan reference: pattern map §3.1 rows V13-V20, §5 G5
- Quality requirements: source, model/voice, custom id/path validation, download with progress, preview kept;
  `local-tts-preview-btn` kept; "Saved" chips replaced by the toast.

## Batch 48: Voice — ElevenLabs panel + go vet card (AS) — COMPLETE (df3cf51a5, track B)

- Recommended executor: frontend-developer (Advanced/Search owner), in-process
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 46 (runs after 47)

### Task 48.1: ElevenLabs (V21-V25, verify-then-save per G13) and go vet consent restyle (V26-V29) — COMPLETE

- Files (4): MODIFY `CHAT\ptah-ai\elevenlabs-panel.component.ts` + spec, `CHAT\ptah-ai\go-vet-consent-config.component.ts` + spec
- Plan reference: pattern map §3.1 rows V21-V29, §5 G13
- Quality requirements: ElevenLabs Save disabled until `voice:testConnection` with the draft key passes; the key is
  never saved on a failed probe; Clear key confirms first; go vet keeps `role="switch"`, the enable confirm naming
  the root, stale reasons, error mapping, Electron-only visibility and the `go-vet-consent-*` testids.

## Batch 49: harness — reachability + scenes for Advanced and Search & Voice (AS) — COMPLETE (d0b6c6f39, track B)

- Recommended executor: frontend-developer (Advanced/Search owner), in-process
- Execution mode: sequential
- Tasks: 1 | Depends on: Batches 43, 44, 48

### Task 49.1: reachability entries and scenes for both tabs; D15 failure fixtures — COMPLETE

- Files (4-6): MODIFY `HARNESS\settings-reachability.table.ts`, `HARNESS\settings-reachability.e2e.spec.ts`; CREATE a scene
  spec and fixtures for the two tabs; MODIFY `ROOT\apps\ptah-electron-e2e\src\showcase\settings-tour.scene.ts` only if
  a step breaks
- Plan reference: pattern map §4 (safe-list), §8 row 49
- Quality requirements: every §4 preserve-list capability has a reach entry; fixtures for STT / TTS / web-search /
  output-style / effort failures assert D15 (no "Saved" after a failure); `EXPECTED_CAPABILITY_COUNT` only grows;
  `BASELINE_PRESENT_IDS` untouched; keep the harness `max-lines` warnings from growing (split helpers as in Batch 22).

## Batch 49b: component defects pinned by the Batch 49 scenes (AS follow-up) — COMPLETE (4fad78694, track B; committed before 49)

- Executor: started by the antigravity CLI lane (toast, partial, replaced; lane hit its quota), finished in-process by a
  frontend-developer (Advanced owner), same-side
- Execution mode: sequential | Tasks: 1 | Depends on: Batches 43, 44, 48 (fixes their components); 49's scenes need it

### Task 49b.1: radio revert, Esc on inline confirms, toast clear of drawer footers — COMPLETE

- Files (12): MODIFY `CHAT\feedback\settings-toast.component.ts` + spec, `CHAT\output-style\output-style-list.component.ts`
  + spec, `CHAT\output-style\output-style-config.component.ts`, `CHAT\advanced-settings.component.ts` + spec,
  `CHAT\pro-features\mcp-port-config.component.ts` + spec, `CHAT\ptah-ai\elevenlabs-panel.component.ts` + spec;
  `TASK\batch-49b-report.md`
- Quality requirements: a failed activate and a cancelled parity confirm put the saved radio back
  (`syncActiveRadios`); Import, output-style Delete and Allow-localhost confirms close on Esc with focus back on the
  opener; the ElevenLabs clear confirm stops Esc from closing D-VOICE; the toast clears every open drawer footer
  (pure CSS `body:has(ptah-native-drawer [role=dialog])` → `bottom-28`); output-style-list ≤ 700 lines.

## Batch 50: Gate V (Advanced / Search & Voice) + combined code review (AS) — COMPLETE (50a e2032e30a, 50b 7e70f3a80, reviews 74fcf5a42, 50c 0405b2162, re-check 74c2dfda5; track B) — Gate V 50 passed: code reviews APPROVED / APPROVED WITH NOTES after re-check; visual PASS WITH NOTES after re-check; user decisions 2026-10-02 applied

- Recommended executor: frontend-developer (Advanced/Search owner) for density fixes, then the visual-reviewer
  subagent for the gate
- Execution mode: sequential
- Review route: the **combined cross-side code review** of Batches 39-50 (user decision 2026-09-30; reviewer picked
  per execution default 6) **and** a visual-reviewer PASS (`TASK\visual-review.md`, new Advanced / Search & Voice
  section; same-side reason disclosed)
- Tasks: 1 | Depends on: Batch 49

### Task 50.1: visual gate for both tabs × both hosts × both themes against the approved patterns — COMPLETE

- Files (1): MODIFY `TASK\visual-review.md` (new section)
- Plan reference: pattern map §2.2 and §3.2 (fold budgets), §1 (P1-P12, deviations 3-6)
- Quality requirements: fold assertions from §2.2 and §3.2 at 1024×768; Electron and VS Code (go vet / voice hidden
  on VS Code); anubis and anubis-light; no `text-primary`/`text-error` text; focus visible; Esc/backdrop return
  focus; axe clean beyond known patterns.

### Batch 50 verification

- Verify command as above; Gate G; the full settings harness folder in both hosts and both themes
- `visual-review.md` Advanced / Search & Voice PASS
- The combined 39-50 code review accepts

### Task 50a: Search & Voice density — map §3.2 fold met and enforced — COMPLETE (e2032e30a, track B)

- Executor: in-process frontend-developer (Advanced/Search owner), same-side
- Files: MODIFY `CHAT\ptah-ai\web-search-config.component.ts` + spec, `HARNESS\settings-advanced-search-voice.e2e.spec.ts`
  (`SEARCH_VOICE_FOLD_ENFORCED = true`); `TASK\batch-50a-report.md`; 12 re-taken `current-*` captures
- Result: provider rows 57-63 → 41 px in all four host/theme runs; web search card bottom 383 (VS Code) / 439
  (Electron); Electron voice rows end 686 → 626 px (fold 660). Every testid and the 45/45b behaviour kept; the Clear
  confirm opens below the action row. Orchestrator capture check PASSED.

### Task 50b: Gate V 50 review fixes — COMPLETE (7e70f3a80 code, 74fcf5a42 reviews; track B)

- Executor: two in-process frontend-developer streams, same-side — A (Advanced: output-style/*, system-prompt-drawer,
  agent-behaviour-section, mcp-port-config, vscode-lm-config, advanced-settings + specs, new
  `output-style-config.component.spec.ts`; `TASK\batch-50b-advanced-report.md`) and B (license-status-card,
  web-search-config, elevenlabs-panel, go-vet-consent-config + specs; `TASK\batch-50b-search-voice-report.md`)
- Reviews committed separately (`74fcf5a42`): `gate-v50-code-logic-review-lanes.md` (antigravity lane, cross-side of
  opencode / Glm / in-process; APPROVED WITH NOTES 8/10), `gate-v50-code-logic-review-42-44.md` (code-logic-reviewer
  subagent, cross-side of the antigravity lane; NEEDS_REVISION 6/10, no blocking), `visual-review-gate-v50.md`
  (visual-reviewer subagent, **same-side, disclosed**; FAIL 6/10, no broken layout) + 14 `gate-v50-*.png` evidence
- User decisions 2026-10-02 applied: neutral resting "Clear" (red only on the confirm), Agent behaviour descriptions
  clamped to one line. All helper text ≥ 12 px (`text-xs`; go vet description `text-sm`), except the six effort
  popover buttons (10 px button labels, kept on purpose)
- 40 tab gate captures re-taken and committed. (Re-check done: see Task 50c.)

### Task 50c: Gate V 50 re-check minors — COMPLETE (0405b2162 code, 74c2dfda5 re-check sections; track B)

- Executor: in-process frontend-developer, same-side; `TASK\batch-50c-report.md`
- Fixed: N1 (fast regenerate failure no longer treated as "may still be running"), N2 (editor `persisting` guard across
  STALE_FILE), N3 (`parityRequestedTier` set only after a successful activate), N4 (per-key Import failures get their
  own fixed sentence), N5 (`confirmedModel` linkedSignal keyed on the provider list), item 16 (Copy to this project
  confirms before overwriting a project-tier style; `copyToProjectTier(name, overwrite)`), visual m1 (go vet
  description back to `text-xs`), visual N2 (Clear trigger keeps its resting look while its confirm is open)
- Re-check verdicts (appended to the review files, `74c2dfda5`, with 20 `gate-v50r1-*.png` evidence): lanes review
  **APPROVED 10/10** (antigravity lane, cross-side); 42-44 review **APPROVED WITH NOTES 8/10** (code-logic-reviewer
  subagent, cross-side); visual **PASS WITH NOTES 8/10** (visual-reviewer subagent, same-side, disclosed)

### Gate V 50: accepted items and follow-ups (recorded, not fixed)

- Accepted: item 14 — Undo of "Allow localhost off" has no confirm (it restores an already-confirmed state within the
  toast window); 9-11 px badges and `btn-xs` labels (shared daisyUI sizes); the six 10 px effort popover buttons
  (labels)
- Moved: docs item 12 (`apps/ptah-docs/SCREENSHOTS.md` browser-settings rows) → Batch 37; D6 (table header contrast
  4.45:1 in light theme, shared muted token) → the muted-token batch in track A after the merge
- Follow-ups for the final report: N1 detects a timeout by elapsed time (`ClaudeRpcService` gives a timeout no error
  code); N4 depends on the host's per-key import error format (`ptah.` / `config:` prefix) — a typed field on the
  `settings:import` result is a backend follow-up

## Batch 37: close-out — live scripts, full run, reports (S7) — COMPLETE (308259146 harness, d9a92315f e2e, bd2e1ee16 chat specs, ebf297a24 core specs, 581a557fe ui specs, cee84bfa1 SCREENSHOTS.md, 520d88c34 task docs)

- Executor: senior-tester subagent; report `batch-37-report.md`, logs `%TEMP%\b37-*.log`.
- Orchestrator decisions: the live docs-shot PNGs (`apps/ptah-docs/public/screenshots/`, backup `%TEMP%\b37-docs-shots`)
  are NOT committed; they revealed live-data defects (Batch 52), and are re-taken after it. The rpc-handlers failure is
  environmental (follow-up 8). The `ConfigWatcher` finding goes to the final report (follow-up 7).
- Review: no separate code review; the "Review accepts" line is covered by the orchestrator's acceptance of the report.

- Recommended executor: senior-tester (subagent)
- Fallback executor: frontend-developer (subagent)
- Execution mode: sequential
- Review route: in-process → CLI-lane code-logic review of the reports and script edits
- Tasks: 2 | Depends on: Batch 50 (moved from 36 by the user decision of 2026-09-30: the close-out is the single final
  full run and write-path trace, and it covers Providers, Orchestration, Advanced and Search & Voice; the parity
  evidence and write-path trace include the pattern-map preserve list §4 and the save paths of Batches 39-48)

### Task 37.1: delete the hollow spec; update and run the docs shot and the showcase tour — COMPLETE (docs PNGs held for Batch 52)

- Files:
  - VERIFY `HARNESS\provider-settings.e2e.spec.ts` is gone (deleted in Batch 16, 72ab2f4be)
  - MODIFY `ROOT\apps\ptah-electron-e2e\src\docs-screenshots\workspace-settings.shot.ts` (`assignments-heading` is now
    on Orchestration, `:36-44`)
  - MODIFY `ROOT\apps\ptah-electron-e2e\src\showcase\settings-tour.scene.ts`, only if its run shows a broken step
- Plan reference: implementation-plan.md:821-830, :1113, :1143
- Pattern to follow: the existing scripts
- Quality requirements: confirm the invocations from `docs-screenshots.config.ts` / `showcase.config.ts` before running.
- Validation notes: live Electron data, not fixtures.
- Implementation details: n/a

### Task 37.3: harness follow-ups carried from the Batch 16 review (revise cap reached) — COMPLETE

- Files:
  - MODIFY `ROOT\libs\frontend\webview-e2e-harness\src\lib\scenarios\marketplace\marketplace.fixtures.ts` (`installRpcAutoResponder`, `:116-216`; shared with thoth/boot)
  - MODIFY `HARNESS\settings-reachability.table.ts`, `HARNESS\settings-reachability.e2e.spec.ts`
- Quality requirements:
  - `installRpcAutoResponder` gains an **opt-in** error envelope (default off, so marketplace, thoth and boot are
    unchanged). Then the #39/#79 read-error branches get reach entries.
  - Fix NW-1: the `closeWizard` final assertion inside `finally` (`table.ts:110`) must not mask the original failure.
  - Fix NW-2: the #56 toggle-and-restore restores `FixtureState` in a `finally`.
  - Fix NW-3: recovery returns to the entry's starting tab.
- Validation notes: the marketplace, thoth and boot scenes must stay green.

### Task 37.4: record the spec type-check gap (follow-up, not fixed in this task) — COMPLETE

- Files: `TASK\write-path-trace.md` is not the place; add a "Follow-ups" section to `TASK\parity-evidence.md`
  (Task 37.2).
- Finding (from Batch 12): `@ptah-extension/chat` specs have many pre-existing `tsc` errors under
  `libs\frontend\chat\tsconfig.spec.json`, and no gated target catches them. `typecheck` uses `tsconfig.lib.json`, and
  the jest transform does not type-check. New fixture drift (such as the Batch 12 `ProvidersConnection` fields)
  therefore passes every gate.
- Required:
  - Run `npx tsc --noEmit -p libs\frontend\chat\tsconfig.spec.json`. Record the error count, and whether any error
    is in a file this task touched.
  - **Errors in files this task touched are fixed in this batch.**
  - Pre-existing errors elsewhere are listed as a follow-up task proposal: add a `typecheck-spec` target, or include
    the spec tsconfig in `typecheck`. Name the owner as devops-engineer.
- Validation notes: the same check for `@ptah-extension/core` and `@ptah-extension/ui` specs, since this task added
  fixtures there too.

### Task 37.2: full verification + TASK_2026_555 write-path trace + parity evidence + fix-report completeness — COMPLETE

- Files:
  - CREATE `TASK\write-path-trace.md` (plan §3, each row with its read-back/reader evidence, the D8 before/after, and
    the "ends running chat sessions" finding)
  - CREATE `TASK\parity-evidence.md` (every `keep`/`move`/restored row → test name; #21 dropped per user decision)
  - VERIFY `ROOT\.ptah\specs\TASK_2026_551\fix-report.md`, `ROOT\.ptah\specs\TASK_2026_553\fix-report.md`
- Plan reference: implementation-plan.md:870-950, :1248-1257
- Quality requirements: every §3 row cites evidence; every §4 row cites a passing test.
- Validation notes: n/a
- Implementation details: n/a

### Batch 37 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/platform-core @ptah-extension/vscode-core @ptah-extension/platform-vscode @ptah-extension/platform-electron @ptah-extension/platform-cli @ptah-extension/settings-core @ptah-extension/rpc-handlers @ptah-extension/cli-engine @ptah-extension/cli-agent-runtime @ptah-extension/shared @ptah-extension/core @ptah-extension/chat @ptah-extension/ui @ptah-extension/memory-curator-ui @ptah-extension/skill-synthesis-ui @ptah-extension/webview-e2e-harness ptah-extension-webview ptah-extension-vscode ptah-electron ptah-cli` (this is the one wide command, by plan decision at close-out; output tailed)
- The full settings harness folder (Gate V, both tabs); reachability green with zero `pending`
- The live docs shot and settings tour pass
- Review accepts

## Batch 52: live-data defects (before Batch 38) — COMPLETE (c5f078f04 cli-agent-runtime, 1a1d1b2f7 chat, 9790b2ee0 harness + captures, 2c3b01e84 docs PNGs, b45a7ca46 report)

- Source: the Batch 37 live Electron docs shots (`%TEMP%\b37-docs-shots`), orchestrator decision.
- Recommended executor: in-process frontend-developer (Orchestration owner); sequential
- Depends on: Batch 37
- Tasks: 7 (52.6 and 52.7 added during the batch). Report: `batch-52-report.md`.
- Review: no separate code review; the orchestrator viewed the live captures, the Orchestration captures and the two
  docs PNGs and accepted them.
- Team-leader checks: the antigravity adapter change on disk (status line skipped, id/name split on the tab,
  `--model` gets only the id via `agyModelId`; args still spawned as an array through `resolveDirectSpawn` /
  `spawnCli`, no shell). The owner's two shell slips left nothing behind: `cli-matrix-rows.ts` diff clean, no stray
  files newer than 520d88c34.

### Task 52.1: CLI version text normalised — COMPLETE

- `cli-orchestration-matrix.component.ts:145` prefixes `v` to the raw CLI version line, so live data reads
  "vcodex-cli 0.155.1". Show one normalised version.

### Task 52.2: model cell shows one value — COMPLETE (incl. the `agy models` parser fix in cli-agent-runtime)

- The Antigravity model cell shows ID and name on three lines ("claude-sonnet-4-6 Claude Sonnet 4.6 (Thinking)"). Show
  one value.

### Task 52.3: Main Agent node head — COMPLETE

- The scope badges in the Main Agent node head must not stack or wrap the title.

### Task 52.4: live-like fixture data in the harness — COMPLETE

- Harness fixtures carry live-shaped values (raw CLI version lines, model ID + display name, several scope badges) so
  the scenes catch 52.1-52.3.

### Task 52.5: re-take the Electron docs shots — COMPLETE

- After 52.1-52.3: re-run `workspace-settings.shot.ts` against real Electron and commit the docs PNGs in
  `apps/ptah-docs/public/screenshots/`.
- Done: `settings-overview.png` and `agents-orchestration.png` committed (2c3b01e84); the other docs PNGs unchanged.

### Task 52.6: Main Agent override layers as whole badges — COMPLETE

- New `main-agent-scope-badges` component: one badge per override layer under the one-line title, with a dialog listing
  the layer's fields; Esc returns focus to the badge.

### Task 52.7: a model saved before 52.2 is the selected catalogue model — COMPLETE

- `cli-model-effort-popover` reads the saved value through `cliModelDisplay`, so a tab-joined value is the selected
  catalogue model, not "saved, not in the current list"; Undo writes back the stored value.

## Batch 53: Batch 38 findings B38-1..B38-5 — COMPLETE (6362f8545 ui, 59ab01830 chat, bb057830c harness + captures, 23435a471 docs PNG, eeaa94951 visual-review + gate-v38 + report)

- Executor: Orchestration owner (in-process frontend-developer). Report `batch-53-report.md`. Tasks: 6.
  - 53.1 (B38-1) card reads the recorded check — COMPLETE
  - 53.2 (B38-2) card Check / Retry check only their own connection — COMPLETE
  - 53.3 (B38-3) model list at least as wide as its field (ui) — COMPLETE
  - 53.4 (B38-4) order strip shows whole chips, then "+N" (docs PNG re-taken) — COMPLETE
  - 53.5 (B38-5) 800 px fold assertion without rounding jitter — COMPLETE
  - 53.6 baseline smoke split into 8 region tests per host/theme; boot `page.goto` 30 s (documented);
    `settings.fixtures.ts` 706 lines (2 over the accepted 704) — COMPLETE
- Round 2 verify (after 53.6, machine still loaded): harness typecheck,lint exit 0 (`%TEMP%\b53-r2-tl.log`); Gate G
  9/9 (`%TEMP%\b53-r2-gateG.log`); `settings-visual.e2e.spec.ts --repeat-each=3` **108/108**, longest test 15.7 s
  (`%TEMP%\b53-r2-visual.log`); full settings folder **122 passed / 2 skipped (fixme) / 0 failed**
  (`%TEMP%\b53-r2-folder.log`). Captures: the 44 accepted committed from `%TEMP%\b53-accepted` (2 pixels off in the new
  run); 56 others had no visible change and were restored.
- Round 1 (blocked) for the record:

- Team-leader verify (2026-10-02): on-disk checks pass. 53.1 `applyRecordedCheck`: a failed `lastCheck` not older than
  the route probe wins over Active / Connected / Not checked / Check unavailable (D15), fixed copy only. 53.2
  `checkFromCard`: `checkProviderConnection(id)` (`auth:checkConnection` for that connection), busy guard
  (`saving()` / `connectionCheck` checking), full re-read only when the route read failed, focus to the card's
  `role="button"` (from `ptah-native-card [clickable]`). 53.3 ui: `matchInputWidth` always on for the search field;
  `native-autocomplete` panel min = field width, max = max(field, 448 px). No core change.
- typecheck,lint 5 projects exit 0; test 4 projects exit 0 (from cache); build 3.32 MB; Gate G 9/9 (3.8 min, was 1.5);
  full settings folder (`%TEMP%\b53-tl-folder.log`, 7.0 min, was 2.8): 93 passed / 2 skipped (fixme) / **1 failed** =
  baseline smoke (electron, anubis-light) **30 s test timeout** waiting for `connection-detail-drawer`
  (`settings-visual.e2e.spec.ts:674`). Repeat `--repeat-each=3` (`%TEMP%\b53-tl-smoke-r3.log`): **10 of 12 failed**,
  every repeat at 29.5-30.9 s (Batch 52: 10-17 s). Machine at 100 % CPU (other sessions: 3 Ptah, 48 node, 63 Chromium
  processes); everything ran ~2.5x slower. Suspected: load, not Batch 53, but it reproduces, so the commit waits for a
  re-run under normal load (execution default 7).
- Captures: tree left at the owner's accepted state (44 kept, `%TEMP%\b53-accepted`; the run's other 36 had no visible
  change and were restored). `agents-orchestration.png` docs PNG untouched by the harness.

## Batch 54: busy controls keep focus (Batch 38 re-check 1 N1) — COMPLETE (5d7e90ef7 ui, d8d7f29ac webview, f4fa997ed chat, d660b6a4d harness)

- Executor: Orchestration owner (in-process frontend-developer). Verified and committed by the orchestrator (user
  request 2026-10-03: finish the task, subagent reviews, one final full review on the PR). Report: `batch-54-report.md`.
- 54.1 N1: shared `SettingsBusyDisabledDirective` (`[ptahBusyDisabled]`, `feedback/busy-disabled.directive.ts`) on 64
  busy controls in 24 Settings components; ui pickers get the same pattern; app-style rule dims busy inputs/selects.
  New Playwright scene: drawer check → Esc closes the drawer, focus returns to the card (both hosts).
- 54.2: no `native-autocomplete` user outside Settings; the setup wizard tier pickers are plain selects (unaffected).
- 54.3: "Models & Tiers and Advanced" drawer test at most ~22 % of its timeout; not split.

## Batch 38: full visual review + live Electron pass (S7) — COMPLETE (review PASS WITH NOTES 8/10; re-check 1 after Batch 53: PASS WITH NOTES 8/10, B38-1..B38-5 fixed; its new N1 fixed in Batch 54; B38-6 is follow-up 11)

- Review: `visual-review.md` "Batch 38 final review" (visual-reviewer subagent, **same-side**, disclosed), committed in
  eeaa94951 with `screenshots/gate-v38/`. Verdict **PASS WITH NOTES, 8/10**.
- Findings:
  - B38-1 (Moderate): card "Connected" after a failed drawer check → fixed in 53.1
  - B38-2 (Moderate): card Check / Retry re-read the whole page and record no check → fixed in 53.2
  - B38-3 (Minor): model lists narrower than their field → fixed in 53.3
  - B38-4 (Minor): order strip clips the fifth chip mid-glyph → fixed in 53.4
  - B38-5 (Minor, harness): intermittent 1 px 800 px fold overflow (rounding) → fixed in 53.5
  - B38-6 (Minor, outside this task): Electron shell sidebar contrast → follow-up 11
- Batch 38 completes when the visual reviewer's re-check of B38-1..B38-5 accepts.

- Recommended executor: visual-reviewer (subagent; needs image reading, so not a Glm lane)
- Fallback executor: an image-capable CLI lane, if the orchestrator confirms one
- Execution mode: sequential
- Review route: this batch is the visual review. The team-leader verifies the evidence in Mode 3.
- Tasks: 1 | Depends on: Batch 37 (and so on Batch 50). The final review covers all four tabs (Providers,
  Orchestration, Advanced, Search & Voice); Advanced and Search & Voice are compared against the approved
  `pattern-map-advanced-search-voice.md` patterns, not a separate prototype.

### Task 38.1: both tabs × both hosts × both themes vs `prototypes/final/`; before/after vs `screenshots/current-0{1,2,3}.png`; live Electron sanity — PENDING

- Files: MODIFY `TASK\visual-review.md` (final section, verdict)
- Plan reference: implementation-plan.md §6 (:1066-1095)
- Quality requirements (pass line):
  - fold assertions green
  - structure, order and one primary action per region match the prototype (except deviations 3-6 and D9-D11)
  - no `text-primary`/`text-error` text
  - focus visible
  - Esc/backdrop closes every overlay and returns focus
  - axe shows no `nested-interactive` beyond the known card pattern
  - Electron file dialogs are unaffected by `showModal()`
- Validation notes: the new permission copy and the D16 badge departure from the prototype are shown to the user.
- Implementation details: n/a
- **Carry-forwards from Batch 28b (0daf6ccdd, `batch-28b-report.md`), minor deviations to check, not defects now:**
  - The Main Agent popover's open model list is **210 px wide against a ~280 px field**. It sizes to its content,
    because `NativeAutocompleteComponent` (`libs/frontend/ui`) owns the panel width. Decide whether to match the
    field width (a ui-owner change); if so, check the drawer tier pickers too.
  - Returning from "Enter a model ID…" to the combobox reopens the list (focus opens it, the field's shared rule);
    one Esc closes it.
  - Esc in an open search list closes only the list, in the popover and the drawer tier pickers (accepted behaviour
    change). Re-check "Esc/backdrop closes every overlay and returns focus" with that two-step Esc.
- **Carry-forwards from Batch 28d (46fda2e5f, `batch-28d-report.md` §8-9), design questions to settle here:**
  - **Card vs drawer after a failed check.** The connection card shows route status only and does not read
    `lastCheck`. After a failed drawer "Check connection", a card can still read "Connected" while its drawer reads
    "Check failed". Decide whether the card carries the recorded check (D15 reading of "never verified after a
    failure").
  - **Card "Check connection" / "Retry" still refresh the whole page.** The cards' own actions use the page-wide route
    refresh (`providers-settings.component.ts:151-152`); only the drawer's Check runs `auth:checkConnection` for one
    connection. Decide whether the card actions should check their own connection too.

### Batch 38 verification

- `visual-review.md` final verdict PASS covering both tabs, both hosts and both themes; screenshots exist in
  `TASK\screenshots\angular\`.
