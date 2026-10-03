# Cutover logic re-review — fix 825a12ab0

Reviewer: Codex, GPT-6

Score: 7/10

Verdict: REVISE

Reviewed commit `825a12ab0b3692a62c6548f6750524ee585917b3` on the requested branch, using its diffs and committed source, against the round-0 findings and Fix round 1 table. All source line numbers below refer to that commit. This is a static logic review: tests and builds were not run, and the other writer's working-tree changes were not reviewed or modified. The author's reported test results were not independently reproduced.

| Round-0 finding | verified status (FIXED / PARTIAL / NOT FIXED / REJECTION SOUND / REJECTION UNSOUND) | evidence file:line |
| --- | --- | --- |
| SER-1 | PARTIAL | `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts:129` wires navigation after GitStatus; `libs/frontend/git-ui/src/lib/services/review-navigation.service.ts:379` clears historical scope while preserving the editor through its leave guard. Ordinary switch/removal works without silently discarding the buffer. However, `review-navigation.service.ts:489` overwrites a retained editor's owner on a tab-only navigation; see finding 2. |
| MOD-1 | PARTIAL | `libs/frontend/git-ui/src/lib/services/review-navigation.service.ts:249`, `:307`, `:397` order concurrent RPC reads correctly. But `:455` does not recheck the open ticket at the guarded commit, so an older guarded continuation can land and invalidate the newer read; see finding 1. |
| MOD-2 | PARTIAL | `libs/frontend/git-ui/src/lib/review-canvas/file-diff-section.component.ts:669` preserves the composer when the read becomes null on collapse/window exit, and `:602` advertises the hidden draft. It only recognizes a null owner, not replacement by another owner, and still deletes text on read errors; see findings 3 and 4. |
| MOD-3 | PARTIAL | `libs/frontend/git-ui/src/lib/review-canvas/review-canvas.component.ts:789` extends restoration while reads are pending, with the finite 300-frame limit at `review-canvas-position.ts:22`. `review-canvas.component.ts:802` and `:816` yield to user input/navigation; `:825` supplies the path fallback. Simple staged-id replacement works, but `review-canvas-position.ts:90` excludes an already-existing destination section; see finding 5. |
| MOD-4 | FIXED | `package.json:195` declares Shiki 4.4.3, also present in the lockfile root dependency map; the committed Pierre dependency range accepts Shiki 4.x. `libs/frontend/git-ui/src/lib/renderer/pierre-config.ts:137`, `:149`, `:168` route theme loading through a logged, readable light fallback. |
| MIN-1 | FIXED | `scripts/electron-only-chunks.js:124` checks the JS filename sets; `:152` checks the static main closure; `scripts/copy-webview.js:22` folds case only on Windows. No concrete false positive found for the committed production configuration (`apps/ptah-extension-webview/project.json:80`, outputHashing none), its flat JS output convention and current public assets. This is filename consistency, not a content-integrity check; arbitrary future nested JS outputs or copied root JS assets would require adapting the assertion. |
| MIN-2 | FIXED | `libs/frontend/git-ui/src/lib/review-canvas/hunk-toolbar.component.ts:470` clears a refused outcome on dismissal; `:324`, `:341`, `:354` consequently restore the buttons and eligibility. A later stale-token retry remains subject to backend refusal. |
| MIN-3 | REJECTION SOUND | `libs/frontend/git-ui/src/lib/renderer/pierre-config.ts:262` gives each independently scrollable code pane a labelled keyboard stop; keeping keyboard access is a reasonable acceptance of the original minor tradeoff. The one-observer design is recorded at `.ptah/specs/TASK_2026_576_e16a/implementation-plan.md:989`. Qualification: overflow-sensitive focusability does not inherently require a separate observer instance per pane (an observer can observe multiple targets), so that part of the author's rationale is overstated, but it does not make the retained behavior defective. |

## New findings

These include residual defects in the claimed fixes, not only behavior first introduced by this commit.

1. **MOD — The latest-open ticket does not cover the leave-guard continuation.**

   **File:line:** `libs/frontend/git-ui/src/lib/services/review-navigation.service.ts:455`; related checks at `:269` and `:403`.

   **Scenario:** An older historical open has finished its RPC and is awaiting the editor's asynchronous leave guard. A newer historical/stash open starts and captures the current seq, bumping `openTicket`. The older guard then resolves true while the newer RPC is pending. `land()` checks only `leaveTicket` and seq, so the older open commits. The newer RPC subsequently fails the seq check and returns without opening: the earlier request wins. The new workspace-reset continuation at `:390` has the same interaction: a pending reset guard can commit after a new-workspace read starts, causing that valid new navigation to be dropped.

   **Fix:** Carry a unified navigation generation through both the RPC and guard stages and check it immediately before committing. Starting a newer open must invalidate older guarded continuations, including a reset continuation, while preserving/reusing the editor confirmation as appropriate. Add deferred-guard coverage, including a new-workspace open while reset confirmation is pending; the added latest-click tests cover RPC ordering without a pending guard.

2. **MOD — A retained editor is reassigned to the new workspace by changing tabs.**

   **File:line:** `libs/frontend/git-ui/src/lib/services/review-navigation.service.ts:489`; tab-only call at `:342`, removal check at `:368`.

   **Scenario:** Open and modify `/a/x.ts` in workspace A. Switch to B and choose Keep editing, intentionally retaining A's editor. Select History and then Changes. Each tab-only commit preserves the same target but records B as `stateWorkspace`. Removing A now returns early and neither clears nor guards its retained target; even a later redundant switch to B treats that target as B-owned. Saving or discarding after this point does not repair the service's ownership bookkeeping. The explicit owner preservation at `:386` lasts only until the next commit.

   **Fix:** Preserve ownership when only tab/scope presentation changes and the file target is retained. Establish ownership from the target's originating workspace when it is actually opened, rather than recomputing it from the currently active workspace on every commit. Cover Keep editing → tab switch → owner removal.

3. **MOD — Preserved composer text can migrate to another draft owner.**

   **File:line:** `libs/frontend/git-ui/src/lib/review-canvas/file-diff-section.component.ts:674`; submission uses the current owner at `:755` and `:774`.

   **Scenario:** Begin a comment for change-set session A, collapse the file, then open a change set for session B containing that same file in the same workspace. The canvas tracks sections by file id (`review-canvas.component.ts:169`), so it reuses the section. `draftOwner` changes from one non-null owner to another (`review-canvas.component.ts:272`); the clear condition does not notice that A went away. Expand and submit: A's retained text is added to B's drafts. A cached workspace switch with matching file ids can similarly reuse sections across workspace owners.

   **Fix:** Capture and compare the semantic owner key (workspace plus ownerSessionId) for an active composer. Clear or partition the composer when that owner changes, including non-null → non-null transitions; do not silently submit it under the replacement owner. Add an owner-replacement test, not only the existing null-owner test.

4. **MOD — A failed read after expanding can still silently erase the retained comment.**

   **File:line:** `libs/frontend/git-ui/src/lib/review-canvas/file-diff-section.component.ts:671` and `:677`.

   **Scenario:** Write a comment, collapse or scroll away, then return after the cached diff was evicted or invalidated. If the new read lands as `status: 'error'`, the effect clears the composer although its owner still exists. Retry can restore the diff but cannot restore the user's text. A read becoming a labelled result also deletes it. Thus the collapse fix preserves text only until the next unsuccessful/non-text read, contrary to the requested owner-lifetime behavior.

   **Fix:** Retain the text and selection while the diff is unavailable, disable submission, and offer retry or explicit dismissal. Clear automatically on owner loss/replacement, not a transient read failure. Cover collapse → error → retry with the original text restored.

5. **MIN — Collapse state is lost when staging merges into an existing staged section.**

   **File:line:** `libs/frontend/git-ui/src/lib/review-canvas/review-canvas-position.ts:89`.

   **Scenario:** A partially staged file has both worktree and staged sections. Collapse its worktree section, then stage the remaining changes. The worktree id disappears, but the surviving staged id already existed in `previous`. The `!previous.has(file.id)` predicate rejects that destination, leaving the vanished id in the collapsed set and the remaining file expanded. The reverse merge on unstage has the same issue. The added test only covers a newly created destination id.

   **Fix:** Define and implement the collapse-state merge for same-path sections even when the destination id already exists (for example, collapse the survivor if either merged section was collapsed), and remove vanished ids after transfer. Cover partially staged → fully staged and the reverse.

## Review limits

No tests, builds, dependency installs or application runs were performed, as requested. The restore is bounded rather than endless, and its user-input cancellation remains intact; reads slower than the 300-frame cap can still outlast restoration, which is an explicit finite-limit tradeoff. No further concrete packaging or light-theme defect was established by static inspection. The modified specs were read as coverage evidence, not treated as proof that the omitted scenarios pass.
## Fix round 2 (orchestrator-run, frontend-developer)

All five findings were reproduced against the working tree before fixing (no rejections). Line numbers refer to the uncommitted working tree.

| finding | status | where (file:line) | test |
| --- | --- | --- | --- |
| 1 (MOD) latest-open ticket does not cover leave-guard / reset continuations | FIXED. `leaveTicket` and `openTicket` merged into one `generation`. It is bumped when a git-reading open starts, when a guarded navigation starts asking, and on every workspace switch or removal. Both the RPC continuation (`superseded`) and the guard continuation (`land`) check it right before committing. A newer open now invalidates an older guarded continuation, including the reset one. The spot editor's `confirmLeave` already settles the older question `false` and reuses the dialog for the newer one (`spot-editor.component.ts:564`). | `libs/frontend/git-ui/src/lib/services/review-navigation.service.ts:160`, `:250`, `:308`, `:361`, `:371`, `:401`, `:454-458` | `review-navigation.service.spec.ts:578` "an older open still waiting on the leave guard does not land over a newer open"; `:605` "a pending workspace-reset answer does not drop an open started in the new workspace" (both use a deferred guard) |
| 2 (MOD) tab-only commit reassigns a retained editor's owner | FIXED. `navigate` captures the workspace the request was made in (`opened`), and `commit` makes it the owner only of what is newly opened. A retained target (same target reference: a tab-only switch, or a kept editor whose historical comparison was dropped) keeps `stateWorkspace`. The one-shot owner restore in `resetWorkspaceState` was removed because `commit` now covers it. | `review-navigation.service.ts:444`, `:484-504` (commit), `:379-392` (reset) | `review-navigation.service.spec.ts:787` "a kept editor stays owned by its workspace across tab switches, so removing it still asks" (Keep editing → History → Changes → remove A: the guard is asked again and the target is cleared) |
| 3 (MOD) composer text migrates across a non-null → non-null owner change | FIXED. The composer records the semantic owner identity (`[workspaceRoot, ownerSessionId]`) when it opens. The effect clears the composer when the owner is null or its identity differs, and `addDraft` refuses to submit under any other identity. An equal owner record that is re-emitted keeps the composer. | `libs/frontend/git-ui/src/lib/review-canvas/file-diff-section.component.ts:88` (identity), `:690-703` (effect), `:787-789` (submit guard), toggle stores `owner` | `file-diff-section.component.spec.ts:968` "drops the composer when another owner replaces it on the same file, and never submits under it" (session A → B while collapsed); `:990` "keeps the composer when an equal owner record is re-emitted" |
| 4 (MOD) error or label read after expanding erases the retained comment | FIXED. The effect no longer clears the composer on `status: 'error'` or a label. While the diff is unavailable, the text and line range stay, "Add draft" is `disabled` with `aria-describedby` pointing at a muted note (`comment-unavailable`), and Retry (error row) or Cancel (explicit dismissal) stays available. The composer is cleared automatically only on owner loss or replacement. | `file-diff-section.component.ts:329-336` (disabled submit), `:345-355` (note), `:690-703` | `file-diff-section.component.spec.ts:1000` "keeps the comment through a failed read after expanding, with Add draft disabled, until Retry restores the diff" (collapse → error → retry → original text and range restored and submitted); `:1044` "keeps the comment when a read turns into a labelled row" |
| 5 (MIN) collapse lost when staging merges into an existing staged section | FIXED. A collapsed id that left the list now moves to every file listed under its path, whether the id is new or already present, and the vanished id is dropped. A merged section stays collapsed if either section was collapsed. An id whose path is no longer listed is left unchanged, as before. | `libs/frontend/git-ui/src/lib/review-canvas/review-canvas-position.ts:69-99` | new `libs/frontend/git-ui/src/lib/review-canvas/review-canvas-position.spec.ts`: partially staged → fully staged, partially staged → fully unstaged (reverse), both sections collapsed, new-id move, no-op cases |

`review-canvas.component.ts` and `workspace-coordinator.service.ts` were not touched; neither needed a change.

### Verification

- `NX_DAEMON=false NODE_OPTIONS=--no-experimental-require-module npx nx run git-ui:test --maxWorkers=2 --testPathPatterns="review-navigation|file-diff-section|review-canvas"`: 9 suites passed, 247 tests passed (rerun after prettier: same result)
- `npx nx run git-ui:typecheck` (`ngc --noEmit -p tsconfig.lib.json`): passed
- `npx nx run git-ui:lint`: passed, 0 errors. 1 warning outside this round's files: `spot-editor.component.ts` max-lines 776 > 700, owned by the other writer.
- `prettier --check` on the six changed or created files: clean after `--write`, which touched only lines from this round.
- chat `workspace-coordinator` test: not applicable (file not touched)
