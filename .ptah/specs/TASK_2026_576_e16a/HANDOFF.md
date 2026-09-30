# Handoff — TASK_2026_576_e16a (git review UI + git reliability)

Written 2026-09-30, end of session. Replaces the earlier handoff (deleted as outdated).

## 1. Where things stand

| Item | State |
|---|---|
| P1 (RC1–RC8, Batches 1–8) | COMPLETE, approved (Glm, `reviews/p1-approval.md`). **PR #611** open against `main`: https://github.com/Hive-Academy/ptah-extension/pull/611 |
| P1 branch | `feat/task-2026-576-git-review`, HEAD `3346f60a6`, pushed. Worktree `D:/projects/ptah-extension/.claude-worktrees/task-576-p1` |
| P2 branch | `feat/task-2026-576-p2`, stacked on P1 (rebased on `3346f60a6`), **not pushed**. Worktree `D:/projects/ptah-extension/.claude-worktrees/task-576-p2` |
| Main checkout | `D:/projects/ptah-extension` on `main` (local `main` is behind `origin/main`; the user decides when to pull) |
| Batch 19 (RC11) | COMPLETE, `0c3189fbc` |
| Batch 9 (RC14) | IMPLEMENTED, **uncommitted** in the P2 worktree; test gate open (§3) |
| Batches 10–18 | PENDING. Waves in batches.md "P2 execution waves": Wave 2 = Batch 18, then 10 → 17 serial, then the P2 phase-end review |

Read first: `context.md` (gate decisions, review cadence, stacked branches), `batches.md` (P1 follow-up, P2 sections, Batch 9 state).

## 2. Decisions made this session (all in context.md)

- **Review cadence P2 → cutover: per phase.** Per batch: typecheck, lint, scoped unit tests (+ real-git specs when git behaviour changes), pre-commit hook, then commit. At each phase end: one cross-side review lane on the phase diff, the full e2e set, visual review for UI phases. New UI stays unmounted until Batch 58.
- **Stacked phase branches**: one branch + one PR per phase, each on the previous phase's branch. P1 PR fixes go on the P1 branch, then P2 is rebased (use a merge instead once P2 is pushed). After P1 merges, rebase P2 onto `main` (`git rebase --onto` if P1 was squashed).
- **Real-git specs run serially**: the default `vscode-core:test` ignores `*.real-git.spec.ts`; `vscode-core:test-real-git` runs them `--runInBand`; the `git-real-git` CI job calls it (3346f60a6, reviewed APPROVE by antigravity, `reviews/p1-followup-test-split-review.md`).
- **Images**: the 63 task PNGs were deleted. The user adds a `.gitignore` rule for images under `.ptah/specs/` in their own PR — do not add one here. `research_notes/` was deleted by the user.
- The user asked the orchestrator to push P1 and open PR #611. Pushing/opening PRs for later phases still needs the user's explicit ask.

## 3. Next steps, in order

1. **Fix the P1 test split gap (on the P1 branch, updates PR #611).** `libs/backend/vscode-core/src/services/git-info.service.remote-stash.spec.ts` spawns real git (push, pull/fetch) but is not named `*.real-git.spec.ts`, so it still runs in the parallel default target and times out under load (4 failures today). Rename it to `*.real-git.spec.ts`; grep vscode-core for other specs that spawn real git without the suffix (`execFileSync('git'`, `mkdtempSync` + `git init`) and rename those too. Verify `vscode-core:test` and `vscode-core:test-real-git` (3 runs), commit in the P1 worktree, push (the user asked for the PR; confirm before pushing again if unsure), then rebase P2 onto it.
2. **Close the Batch 9 gate** in the P2 worktree with no other lanes or agents running: `nx run @ptah-extension/vscode-core:test` and `nx run @ptah-extension/vscode-core:test-real-git` 3 times. Today one serial run failed once on the kill-guard test "a cancel of `commit -a` mid-hook kills the tree and Ptah removes the lock it left" (passes alone 14/14; passed 10 times before). If it fails again, capture the assertion and send Batch 9 back to backend-developer. If green, commit Batch 9 (5 files, see batches.md Task 9.1 state) with scope `vscode-core`, and mark it COMPLETE.
3. **Wave 2: Batch 18** (one GitInfoService per host, RC13) — backend-developer; runs alone (touches projects that import vscode-core).
4. **Waves 3–10: Batches 10 → 17** serial (hot spot `git-info.service.ts` / `libs/shared`).
5. **P2 phase-end review**: one cross-side lane on the P2 diff, the full e2e set, visual review for Batch 11 (branch picker). Then tell the user P2 is ready for its PR.

## 4. Rules that stay in force

- Lanes: **only Glm** (ptah-cli, `ptahCliId pc-355b645d-35af-4974-84cf-9cf961ea0164`) and **antigravity** (cli). Glm has no image input. antigravity exits with code 1 after writing its deliverable (writes its final line to stderr) — check the deliverable, not the exit code.
- Lane `workingDirectory` must be inside `D:/projects/ptah-extension`; the `.claude-worktrees/task-576-p*` worktrees qualify.
- Cross-side review: in-process author → CLI-lane reviewer, and the reverse. Each review in its own file under `reviews/`.
- Never touch or stage: `.ptah/specs/TASK_2026_555/**`, `.claude/skills/ptah-cli-usage/references/internal-mcp.md`, `apps/ptah-video-studio/**`. Stage explicit paths only.
- Never commit to or merge into `main`; never bypass hooks (`--no-verify`), never amend.
- The git stash stack is shared by all worktrees and sessions: never bare `git stash`/`pop`; use a tagged push, apply by SHA, drop by tag.
- Commit messages: UTF-8 without BOM, LF, header ≤ 100 chars; end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Scopes that pass commitlint: `vscode-core`, `electron`, `git-ui`, `e2e`, `webview`, `ci`, `shared`.
- `@nx/jest` needs `--testPathPatterns` (plural). The pre-commit hook runs `nx format:write`, `nx affected -t lint` (incl. `degradation-audit`), `ptah-electron:validate-deps`, commitlint.
- Known unrelated failure: rpc-handlers `harness-skill-selection-rpc.service.spec.ts` "never writes state.json".
- Nx Cloud is disabled (free plan exceeded); local cache only.
