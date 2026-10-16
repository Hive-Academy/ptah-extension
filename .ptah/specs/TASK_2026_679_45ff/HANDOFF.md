# HANDOFF — TASK_2026_679_45ff (Previous sessions modal)

Written 2026-10-16 by orchestrator session 2 (token budget reached). Read this first, then `decisions.md`,
`context.md` and `batches.md` in this folder. This file replaces the session-1 handoff.

## Goal

Remove the always-visible session list sidebar in `AppShellComponent`. Add a "Previous sessions" button under
the canvas Rail footer "New session" (Electron + VS Code grid) and next to the navbar `New` (VS Code single
layout). It opens an accessible modal with the full session list (search, filters, sort, grouping, date range,
rows, Organize / Rename / Delete, states, Load More). Selecting a row opens the session and closes the modal.
Focus trap, Escape closes the innermost layer, focus returns to the opener. Scope add D9: each canvas Rail card
"Session actions" menu gets Rename (popover) and Organize (same organization editor), no Delete.

## Where

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/previous-sessions-modal`
- Branch: `feat/previous-sessions-modal`, base main `851846797`. **Not pushed. No PR yet.**
- Task folder: `D:/projects/ptah-extension/.claude-worktrees/previous-sessions-modal/.ptah/specs/TASK_2026_679_45ff`
- Record files (D56) are committed in a `docs(task-specs)` commit at the end of session 2. Reports, reviews,
  `*-review.md` and `prototype/` stay uncommitted on purpose (D56).

## Done

Gates 1, 1.7 and 2 are APPROVED (user decisions D1-D15). Do not reopen them.

Commits on the branch (7 of 13 batches, `batches.md` header says Complete 7/13):

| Batch | Commit | Subject |
| --- | --- | --- |
| 1 | `2244c176d` | feat(shared,rpc-handlers): batch 1 - session:getOrganization read RPC |
| 2 | `a83cf71cf` | test(vscode): batch 2 - getOrganization unavailable case |
| 3 | `aad99feb6` | feat(chat): batch 3 - session organizer and row action services |
| 4 | `d0cd1ac0c` | feat(chat): batch 4 - session list view store and dialog service |
| 5 | `b896b7787` | feat(chat): batch 5 - focus trap for confirm and organizer dialogs |
| 6 | `d3da763ec` | feat(chat): batch 6 - previous sessions toolbar and list row |
| 7 | `7c1ac3a32` | feat(chat): batch 7 - previous sessions modal |

- **Phase 1 (B1-B2) closed.** Codex lane `1ebf7d33`: `reviews/phase-1-code-logic-review.md` APPROVED 8/10
  (1 Moderate: test gap only), `reviews/phase-1-code-style-review.md` APPROVED 8/10. The Moderate is later
  task **FU-1** in `batches.md` (store-close race spec, `session-organization-rpc.handlers.spec.ts:1106-1119`);
  not scheduled in this run.
- **Phase 2 (B3-B7) committed.** Diff `a83cf71cf..7c1ac3a32`, 27 files, all `@ptah-extension/chat`. Each batch
  passed scoped typecheck+lint and test (last: 221 suites, 4131 passed, 2 skipped).
- Executor decisions D16-D55 accepted by the team-leader and recorded in `decisions.md`. Batch 10 section of
  `batches.md` carries notes from D52-D55 (shell specs need `fixture.autoDetectChanges()` for focus-return
  asserts; delete the shell expired-transcript constant; shell `session-group-*` ids go away).

## In progress

- Nothing is running. The Phase 2 reviews are written (see "Phase 2 review result" below) but no
  team-leader has acted on them yet. No code is uncommitted; only task-folder docs are.

## Next steps (exact)

1. Read both Phase 2 review files.
2. Invoke a FRESH team-leader in MODE 2 with both Phase 2 review paths and their verdicts
   (code-logic REVISE 6/10, style APPROVED 7/10). Fix round rule:
   Blocking + Serious fixed in ONE round (frontend-developer subagent), Moderate only if it can lose data,
   else a named later task; Minor recorded. Then one re-review scoped to the fixes (codex lane).
   Tell it to apply D57/D58 and the "Speed-up plan" wave order below: merge Batches 8+9 and 10+11 in
   `batches.md`, and give the A1 (fix round) and A2 (Batch 8+9 on a codex lane) briefs together so both run
   in parallel.
3. Continue wave by wave (team-leader MODE 2 after each executor; act on its `### Next action:` line):
   - Phase 3: B8-B11 (Rail footer + card menu in `@ptah-extension/canvas`, shell switch-over, Electron divider
     removal, CSS cleanup, deletes) → codex code-logic review + visual review (Electron, dark + light,
     1440 / 760 / 400 px, against `prototype/` and D12). Follow D10 before any Electron launch.
   - Phase 4: B12-B13 (e2e/helper/harness updates, then the D7 + D14 runs one at a time; revert regenerated
     docs PNGs in `apps/ptah-docs/public/screenshots` afterwards, DP-12).
4. Team-leader MODE 3 (completion): parity-inventory row-by-row check.
5. Before the PR: check overlap with branch `fix/clean-session-followups` (TASK_2026_681):
   `git diff --stat main...fix/clean-session-followups -- libs/frontend/chat libs/frontend/canvas apps/ptah-extension-webview/src/styles.css`.
6. Commit the updated record files only (D56: `git add` them by name; no `reports/`, `reviews/`,
   `*-review.md`, `prototype/`) as `docs(task-specs): TASK_2026_679 ...`, then push + PR as ONE background
   command: `git push -u origin feat/previous-sessions-modal && gh pr create --base main --title "..." --body "..."`.
   PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Report the PR link.

## Speed-up plan for the rest of the task (user decisions D56-D58)

Session 2 took about 3 hours for 7 batches. The causes: 13 small batches run one after another, the full
`@ptah-extension/chat` test run (221 suites, 4131 tests) ran twice per batch (executor + team-leader), and
sometimes a third time with `--skip-nx-cache`. Apply these rules from now on:

- **One full gate per batch (D57a).** Executors (subagents and lanes) run only
  `npx jest -c <lib>/jest.config.ts <changed spec files> --coverage=false --maxWorkers=2`. Only the
  team-leader runs the two full gate commands, once.
- **No `--skip-nx-cache` by default (D57b).**
- **Merged batches (D57c):** Batches 8+9 → one canvas batch; Batches 10+11 → one shell batch; Batches 12+13
  stay split only if the team-leader finds a dependency. Up to 10 files per merged batch.
- **CLI lanes implement too (D58)**, in parallel where file-disjoint, max 3 lanes. Run `ptah_agent_list`
  before each spawn (codex had confirmed room, weekly 44% at 19:36 UTC). Load the agent-lanes skill. Each
  lane brief: absolute file list, the CLAUDE.md verification rules, no git, 40 tool-call ceiling, timeout
  1200000, `deliverables` = its report path, report via `ptah_agent_report`.
- **Reviewer family ≠ implementer family:** Claude-written code → codex lane review; codex-written code →
  Claude `code-logic-reviewer` subagent (or grok lane). A phase review with mixed authors is split by author.
- **No commit while anyone edits the same worktree** (lint-staged stashes unstaged changes during the hook).
  Let parallel executors finish, then the team-leader commits each batch separately, files staged by name.

### Proposed wave order (team-leader confirms file sets in MODE 2)

| Wave | Work | Executor | Runs in parallel with |
| --- | --- | --- | --- |
| A1 | Phase 2 fix round (chat files from `reviews/phase-2-code-logic-review.md`) | Claude `frontend-developer` subagent | A2 |
| A2 | Batch 8+9 merged (canvas Rail footer button + card Rename/Organize; depends only on B3-B4) | codex CLI lane (`role: frontend-developer`) | A1 |
| A3 | Re-review of A1 fixes (codex, resume `01a14637-9d0b-7c33-b3c5-1a8139a4b726`) | codex lane | — |
| B | Batch 10+11 merged (shell switch-over, Electron divider removal, CSS cleanup, deletes; high risk) | Claude `frontend-developer` subagent | — |
| B-rev | Phase 3 code-logic review: Claude-written files → codex; codex-written (8+9) → Claude `code-logic-reviewer` | split | each other |
| B-vis | Visual review (Electron, D10, dark + light, 1440/760/400 px vs `prototype/` + D12) | `visual-reviewer` subagent | — |
| C | Batch 12+13 (e2e helpers/specs/harness updates written by a codex lane; then the D7 + D14 runs one at a time) | codex lane writes, `senior-tester` subagent runs | — |
| D | MODE 3, overlap check with `fix/clean-session-followups`, record-files docs commit (D56), push + PR | orchestrator | — |

## Roles and rules

- Implementers: Claude subagents and CLI lanes (D58; revises D3). Reviewers: a different family than the
  implementer. The global CLAUDE.md "CLI lanes only" rule expired 2026-10-16.
- Every executor and lane brief repeats the CLAUDE.md verification rules. Executors run no git; the
  team-leader commits. Task-folder files are never staged with batch commits. Docs commits contain only the
  record files listed in D56 (no `reports/`, `reviews/`, `*-review.md`, `prototype/`).

## Verification commands (memory-safe; one heavy check at a time; never build/serve/dev/package)

- Two SEPARATE commands (do not pass `--maxWorkers` to typecheck/lint):
  - `npx nx run-many -t typecheck,lint -p <projects> --parallel=1`
  - `npx nx run-many -t test -p <projects> --parallel=1 --maxWorkers=2`
    (confirm "Running target test for N projects" with the right N; use `--skip-nx-cache` if the cache replays)
  - Iterating: `npx jest -c <lib>/jest.config.ts <spec...> --coverage=false --maxWorkers=2`
- Projects: `@ptah-extension/chat`, `@ptah-extension/canvas` (B8-B11); `ptah-electron-e2e`,
  `@ptah-extension/webview-e2e-harness` (B12-B13). E2E only for the D7 + D14 list
  (implementation-plan.md "Verification points" + canvas.spec.ts `-g "stacked split after a swap tabs from the Rail"`).

## Commit rules

Foreground `git commit`; scopes from `.commitlintrc.json` (`security`, `git` are not scopes); subject <= 72
chars; body lines <= 100 (wrap at 72); end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
Never push in the foreground; never commit to main.

## Electron coordination (D10)

One Electron instance and one tester at a time. Before launch, send "Electron: TASK_2026_679 launching,
port <n>" to the other sessions; after close, send "Electron: free". Do not use ports 9333 (stale), 9334 (678),
9351 (681/674) without a fresh "free". Latest log (context.md): 678 free, 674 free. TASK_2026_681 asked to go
next after 678: confirm 681 has announced and released before this task's Electron runs. Do not touch
`C:\Users\abdal\.ptah` test data or the untracked `.claude\skills\ts-web-conventions` in the main checkout.

## Key files

- Task folder: `task-description.md`, `parity-inventory.md`, `design-spec.md` + `prototype/`,
  `implementation-plan.md`, `batches.md`, `decisions.md` (D1-D55), `context.md`, `reports/batch-1..7-report.md`,
  `reviews/phase-1-*.md`, `reviews/phase-2-*.md`.
- New code (chat, `libs/frontend/chat/src/lib`): `services/session-list/{session-organizer.service,
  session-row-actions.service, session-list-view.store, previous-sessions-dialog.service}.ts`,
  `utils/focus-wrap.utils.ts`, `components/molecules/{previous-sessions-toolbar, session-list-row}/`,
  `components/organisms/previous-sessions/{previous-sessions-modal.component.*, session-row-groups.ts}`.
- Still to change: `components/templates/app-shell.component.{ts,html}`, `templates/electron-shell.component.ts`,
  `templates/session-sidebar-width.ts` (delete), `templates/session-row-groups.ts` (delete in B11),
  `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail{,-card,-board}.component.ts`,
  `apps/ptah-extension-webview/src/styles.css`.

## Open problems / risks

- FU-1 (Phase 1 Moderate, test gap) is a later task.
- Known minor: `chat-message-handler.service.ts` is 705 lines (max-lines warning) and its header comment does not
  list `SESSION_ORGANIZATION_CHANGED`. A "worker failed to exit gracefully" warning prints in the chat test run
  (from an older suite).
- D20: no "main region" focus fallback; check in the Phase 3 visual review. A1 (no transformed Electron ancestor
  clips the fixed modal) is checked only in the visual review. A3: harness scenarios may pass vacuously if the
  SPA placeholder is served — confirm `#ptah-e2e-fixture-root` is absent per run.
- D30: organizer focus restore runs before the editor's; Batches 7 and 9 add specs for the final focus target.

## Phase 2 review result (both lanes finished; no lane or subagent is still running)

- **Style** — `reviews/phase-2-code-style-review.md`, codex lane `4184049f` (CLI session
  `01a14637-cdaa-7bf0-ba21-8594c0de1bb0`): **APPROVED 7/10**. 0 Blocking, 0 Serious.
  - Moderate: the modal's search-field focus selector depends on test IDs (`SEARCH_FIELD`,
    `previous-sessions-modal.component.ts:70-72,547-550`); use one behavior attribute (like the row's
    `data-action`) shared by both toolbar variants.
  - Minor: stale "sidebar" comments in the moved `organisms/previous-sessions/session-row-groups.ts:2-7,15`.
- **Code-logic** — `reviews/phase-2-code-logic-review.md`, codex lane `8d8feb15` (CLI session
  `01a14637-9d0b-7c33-b3c5-1a8139a4b726`, usable as `resume_session_id` for the fix re-review): **REVISE 6/10**.
  0 Blocking, **1 Serious**, 3 Moderate. The lane's scoped Jest run passed 3 suites / 86 tests; its ptah
  diagnostics call timed out (no compiler evidence from the lane).
  1. **Serious:** grid open failure closes the modal without opening a session.
     `session-row-actions.service.ts:47-50` drops the `Promise<boolean>` of `requestCanvasSession`
     (`libs/frontend/core/src/lib/services/app-state.service.ts:1247-1275` resolves `false` on bad id or a
     5 s unconsumed request); `previous-sessions-modal.component.ts:351-354` closes at once. Fix: return an
     outcome from `openSession`, await it in `onOpened`, close only on success, announce failure.
  2. Moderate: a typed server search inside the debounce window is lost on close (Req 2.9).
  3. Moderate: an old organizer `close()` restore (`session-organizer.service.ts:150-159`) is not cancelled by
     a new `open()` (`:134-142`); cancel the pending `AfterRenderRef` or use a generation token (the dialog
     service already does this, `previous-sessions-dialog.service.ts:42-48,125-128`).
  4. Moderate: a reversed date range (From > To) shows "No matching sessions"; validate the range.
- **Not yet given to a team-leader.** The next session runs step 2 of "Next steps" with both paths:
  team-leader MODE 2 decides the fix round. Rule: fix the Serious; a Moderate is fixed only if it can lose
  data (judge finding 2: typed search lost) or else becomes a named later task; Minor is recorded. Finding 3
  is a focus race of the R2 kind (cheap, same file as Batch 3) — the team-leader may include it. After the fix
  round, one codex re-review scoped to the fixes, then Batch 8.

## PR status

The branch is **local-only** (not pushed, no PR). The PR comes after Phase 4 and Mode 3 (step 6). Remaining:
Phase 2 fix round + re-review, Batches 8-13, the Phase 3 code-logic and visual reviews, the D7/D14 e2e runs,
Mode 3, then docs commit, push and PR. If the user wants an earlier draft PR, push and open it with
`gh pr create --draft` as one background command (the pre-push hook runs di-lint and the Electron
`validate-deps` gate).
