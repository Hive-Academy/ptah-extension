# HANDOFF - TASK_2026_678_9083 (Voice Command Center)

Written 2026-10-16 at the end of session 7. Read this first. Then use targeted reads of `batches.md` (header line 3,
Decisions D49-D60, the "Phase E revise round" sections at the end), `completion-summary.md` (Open items, Draft PR body),
`reports/merge-2-resolution-report.md` and `code-logic-review-merge-main.md`.

## Goal

Ship an Electron-only voice "Command Center" page in Ptah: a canvas scene of the work tree (root session, children,
Tribunal lanes), voice in/out (VAD, chunker, TTS playback, barge-in), a pending-input card, a work list and session
controls. Amendment A1 / AC22: the page owns the Tribunal launch, and a roster Confirm comes only from a click/key on the
card (never sent to the model as text). Match `prototype/command-center.html` in dark and light themes.

Current goal of the session: bring PR #735 level with `main` WITHOUT losing or degrading anything from `main`, prove it,
then mark the PR ready. The USER has PAUSED new merges to `main` until PR #735 merges (D60).

## Where

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/command-center`, branch `feat/command-center`.
- DRAFT PR #735: https://github.com/Hive-Academy/ptah-extension/pull/735 (body NOT yet updated; still draft).
- Last commit: `4ffb07f26`, PUSHED (the branch is level with `origin/feat/command-center`; no local-only commits).
- `node_modules` is a junction to the main checkout. Husky hooks are active (commitlint: subject must not start with an
  upper-case word; read `.commitlintrc.json`). Never `--no-verify`.
- `.gitignore`: the Ptah dev app adds `.opencode/agent/` at app start; remove only that line, never commit it.
- Python on Windows writes CRLF; git normalizes on `add`. Do not run Prettier on `batches.md` (it re-aligns 132 table lines).

## IN PROGRESS AT HANDOFF: merge 2 of `main` (NOT committed)

- `git merge --no-ff --no-commit origin/main` is in progress. `MERGE_HEAD` = `3c153c574` (33 commits after merge 1).
- Conflicts were only `libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts` and its `.spec.ts`.
  A codex lane resolved them (report `reports/merge-2-resolution-report.md`: main's files as the baseline, the
  Electron-only Command Center card re-added on main's structure; setup-hub spec 11/11). Conflict markers: 0.
- The two files are still UNMERGED in the index (`UU`) and have CRLF in the working copy. Everything else from main is
  staged by git.
- Not yet done for merge 2: orchestrator verification of the resolution, the audit against main, checks, the commit.

## Done in session 7 (all on `feat/command-center`)

| Commit | What |
| --- | --- |
| `29ba80c32` | R4: rail single scroller, pending card scrolls into view once (R3-1); HUD settles after prompt speech (R3-2) |
| `14a642675` | stacked work list scrollable again (R4-1) |
| `af8906844` | R5: failed start toast (N-1); new `command-center-workspace-binding.ts` follows the workspace (N-2); rail wheel (R4-4) |
| `2501d9670` | R6: stale-workspace guard in `CommandCenterSessionCoordinator.send` (S-1, M-4); open failure toast (M-1) |
| `4051af50c` | R7a: an in-flight send keeps the binding it started on (visual r6 S-1); refused send keeps the typed text; double-submit guard |
| `ee719b838` | R7b (user request D56): Electron argv workspace must be an existing directory (`apps/ptah-electron/src/activation/initial-workspace-arg.ts`); "The session could not start: <reason>" vs resume text (`rpc-handlers` broadcaster); one console log per CHAT_ERROR (`chat`) |
| `836ca1548` | toast when a typed send throws (r7 Moderate) |
| `3214906c4` | MERGE 1 of `origin/main` (111 commits); conflicts in tab-manager (main's `visibleTabOwners` kept), chat-input (main text/classes + our hold), chat-view (main moved stats helpers); lock spec fake `config()` |
| `9865169a9` | Gate 3 senior-tester: 9 integration tests (AC9, AC14, AC18, AC21), AC5/12/15/24 rows refreshed; command-center 338/338 |
| docs | `0809571ea`, `525c07575`, `c13ba0c39`, `50cab714f`, `8fb2525e5`, `64df0551f`, `4ffb07f26` (D49-D60, reviews, completion summary) |

Reviews this session (all in the task folder): `code-logic-review-phase-e-r4.md` (8/10), `-r5.md` (7/10, S-1),
`-r6.md` APPROVED 8/10, `-r7.md` APPROVED 8/10; `visual-review-phase-e-r3.md` (7.5/10), `visual-review-phase-e-r6.md`
(7/10; its S-1 fixed in `4051af50c` without an Electron re-check, user choice D55); `code-logic-review-merge-main.md`
(codex reviewer of the orchestrator's merge-1 resolution + `836ca1548`: APPROVED 8/10, no findings).
Team-leader Mode 3: `completion-summary.md` = TASK COMPLETE with caveats (18.1 deferred; no visual APPROVED verdict;
the last visual fix not re-checked). Gate 3 by rule = senior-tester (done, `9865169a9`).

Merge 1 audit (done by the orchestrator, read-only, D60): 266 files differ from main at `3214906c4`; 259 differ by
exactly the branch's own diff (patch-id equal); the other 7 audited line by line: every main-added line is present,
no main-removed line came back (flags were re-wraps or generic lines; counts confirmed), no file from main deleted.
Result: merge 1 lost NO main work. This result is NOT yet written into a task doc: add it to `batches.md` (D61).

## User decisions this session

D49 bounded fix R3-1/R3-2; D51 fix N-1/N-2/R4-4; D53 coordinator guard; D55 race fix without a visual re-check; D56 fix
the backend console-error causes in this PR; D57 B18 measurements DEFERRED (not measured); D58 the Ptah artwork icon
(`D:\projects\ptah-voice-command.jpg`) goes in a FOLLOW-UP PR; D60 no main work may be lost; user paused merges to main.

## Open problems

1. Merge 2 must be finished and audited (see Next steps).
2. GitGuardian check FAILS on PR #735: finding 38266155 "Stripe Keys", a FAKE key in an OLD commit of
   `libs/frontend/command-center/src/lib/voice/spoken-text.spec.ts` (the current file builds it at runtime). The USER
   must mark it as a false positive / test credential in the GitGuardian dashboard. No history rewrite.
3. PR needs a human approving review; CodeRabbit runs after `gh pr ready`.
4. Electron coordination with other sessions (agreed rule): whoever is ready first announces
   "Electron: <session> launching, port <n>" and goes; the other waits for "Electron: free". This task uses port 9334
   only; never touch port 9333 or processes it did not start. No Electron run is planned in the remaining steps.
5. Follow-ups (not blocking): `future-enhancements.md` last sections (r3-r7 Moderates/Minors, icon follow-up, the stored
   `main.mjs` workspace entry in the user's Ptah Dev profile, visual reviews must capture the renderer console).

## Key files

- Command Center: `libs/frontend/command-center/src/lib/components/` (`command-center-page.{component,controller}.ts`,
  controller at 697 lines with max-lines 700; `command-center-workspace-binding.ts`; `command-center-turn-status.ts`),
  `model/session-coordinator.ts`, `voice/command-voice-loop.ts`, `scene/sprite-cache.ts` (root "P" face).
- Merge-sensitive: `libs/frontend/chat-state/src/lib/tab-manager.service.ts`,
  `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts`,
  `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`,
  `libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts` (+ spec), `tsconfig.base.json`.
- Backend (D56): `apps/ptah-electron/src/activation/{bootstrap,initial-workspace-arg}.ts`,
  `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts`,
  `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts`.

## Next steps (exact)

1. `cd D:/projects/ptah-extension/.claude-worktrees/command-center`; `git status -sb` (push if ahead);
   `git rev-parse --short MERGE_HEAD` must print `3c153c574`. Do NOT run `git merge --abort` unless the resolution is wrong.
2. Read `reports/merge-2-resolution-report.md`. Verify the two setup-hub files against both parents:
   `git diff -w origin/main -- libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts` must show only the
   Electron-only Command Center card (+ `VSCodeService`, `Mic` imports); same for the spec (card tests only).
3. `npx prettier --write` the two setup-hub files, `git add` them. Commit the merge in the foreground (default merge
   message is allowed by commitlint; body: what was resolved, D60; end with the Co-Authored-By line).
4. Audit merge 2 (M = the new merge commit, P1 = `M^1` = `4ffb07f26`, P2 = `M^2` = `3c153c574`, B =
   `git merge-base P1 P2`, compute it). Same method as merge 1 (it found nothing lost):
   a. `git diff --name-only --diff-filter=D P2 M` must be empty (no main file deleted).
   b. For each file in `git diff --name-only P2 M`: if `git diff P2 M -- f | git patch-id --stable` equals
      `git diff B P1 -- f | git patch-id --stable`, the file differs from main only by the branch's own diff (clean).
   c. For every other file: every line `main` added (`git diff -U0 B P2 -- f`, `+` lines) must exist in `M:f`; no line
      `main` removed may come back unless the branch added it; confirm suspicious generic lines by exact counts in
      `git show P2:f` vs `git show M:f`; read `git diff -w P2 M -- f` and confirm only intended branch changes remain.
   d. Spawn ONE codex lane (`ptah_agent_list` first) as an independent read-only reviewer of the files from step c and
      of the setup-hub resolution (no Jest, no git writes); deliverable `code-logic-review-merge-main-2.md`.
5. Checks, one at a time, filtered:
   `npx nx run-many -t typecheck -p command-center chat-state chat chat-types core dashboard harness-builder tribunal-panel ui shared rpc-handlers ptah-electron ptah-extension-webview --parallel=1 2>&1 | grep -E "Running target|error TS|Successfully|failed"`;
   `npx nx test harness-builder --parallel=1 2>&1 | grep -E "Tests:|Suites:|●"`;
   `npx nx test command-center --parallel=1 2>&1 | grep -E "Tests:|Suites:|●"` (expect 338);
   `npx nx test chat-state --parallel=1 2>&1 | grep -E "Tests:|Suites:|●"`;
   `npx nx test chat --parallel=1 2>&1 | grep -E "Tests:|Suites:|●"` (3992 passed, 2 skipped after merge 1);
   lint for the same projects; `npx tsx tools/degradation-audit/check-degradation.ts 2>&1 | tail -1` (expect 296 or
   main's new baseline; never raise it with branch code). Never run build/serve/e2e/package.
6. Record D61 (merge 1 audit result, merge 2 resolution, audit, checks) in `batches.md`; docs commit; `git push` in the
   background; confirm `gh pr view 735 --json mergeable,mergeStateStatus` is MERGEABLE (if main moved despite the pause,
   ask the user).
7. Update the PR body from `completion-summary.md` "Draft PR body" (add: D56 backend fixes, merge audit, Gate 3 tests,
   deferred B18 measurements, GitGuardian false positive for the user, icon follow-up PR). `gh pr edit 735 --body-file`.
   Then `gh pr ready 735`. Set `task.md` `status:` (edit only that line) when the user confirms. Report the PR link.
8. After merge: the icon follow-up (D58) in a new worktree/branch from main.
