# HANDOFF - TASK_2026_718_15b7

Test hygiene for chat unit tests and the webview session-create e2e flake.

## Goal

1. `libs/frontend/chat` unit tests pass with near-zero console output (PR #788 CI showed ~580 lines per
   shard). Fix test setup and mocks; no global console stub. Treat NG0101 and
   `tabManager.activeTabSessionId is not a function` as possible real bugs.
2. Fix the flaky `libs/frontend/webview-e2e-harness/src/lib/scenarios/sessions/session-create.e2e.spec.ts`
   "blank session name produces client-side validation error" test.

User rules: codex CLI lanes implement and review (never grok/opencode, max 3 lanes). Memory-safe checks
only (scoped projects, `--parallel=1`, Jest `--maxWorkers=2`, filtered output). No local e2e runs without
user approval. Coordinate heavy checks and pushes with peer sessions (ListAgents; ask for "checks: free",
send it after). Commit in the foreground with explicit pathspecs; push in the background; watch CI until green.

## Where

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\chat-test-hygiene`
- Branch: `fix/chat-test-hygiene` (from origin/main 47f65df38), pushed.
- `node_modules` in the worktree is a junction to `D:\projects\ptah-extension\node_modules`.
  Never run `npm install` there. Before any `git worktree remove`, run `cmd //c rmdir node_modules`.
- PR: https://github.com/Hive-Academy/ptah-extension/pull/817 (head 8b123a305)

## Done

- Commit `8b123a305` fix(chat,webview-e2e-harness): quiet chat unit tests and harden e2e spec (37 files,
  includes this task folder). Pre-commit lint-staged passed. Pre-push gates (di-lint, Electron
  validate-deps) passed.
- `test-setup.ts`: `setupZonelessTestEnv` + typed IntersectionObserver stub (incl. `scrollMargin`).
- ~22 chat specs made zoneless-safe (flush promises, Jest fake timers instead of fakeAsync), RPC mocks
  and TabManager/AuthState/Logging doubles completed, broad console stubs replaced by asserted per-test
  spies restored in `finally`.
- Product fixes: `cursor-credential-popover.component.ts` (skip post-save focus after ngOnDestroy, NG0911);
  `main-agent-reassign-popover.component.ts` (`[openOnFocus]="false"`; behavior change: focus alone no
  longer opens that model list; click/typing/ArrowDown still do).
- e2e spec: `expect(nameInput).toBeHidden()` after Create in both create tests. Root cause of the flake:
  the PR #788 spec used a one-shot `count()` before the navbar popover rendered, skipped the submit, and
  left the navbar backdrop open. Main commit e9aa53fc4 already waits for the input.
- Findings: NG0101 absent under zoneless (no change). `activeTabSessionId` TypeError was a stub gap.
- Verification (local, final state): `nx test chat` 264/264 suites, 4590 passed, 2 skipped,
  0 console blocks. Typecheck chat + webview-e2e-harness pass. Lint webview-e2e-harness passes.
- Review: codex code-logic review round 2 REVISE (2 pre-existing console-hiding gaps) -> fix round ->
  re-review APPROVED (`code-logic-review.md`, `code-logic-rereview.md`). Same family as implementer by
  user pin (weaker evidence).

## In progress

- CI on PR #817: at handoff 2 pass, 15 pending, 1 skipping. A background watcher in the old session
  (`gh pr checks 817 --watch`) will not report to a new session; re-check with `gh`.
- Uncommitted: `.ptah/specs/TASK_2026_718_15b7/task.md` status `in_progress` -> `in_review`, and this
  `HANDOFF.md`. Commit them with the next fix commit (or alone) by explicit path.

## Open problems and decisions

- Local `nx lint chat` fails with 128x "Static imports of lazy-loaded libraries are forbidden" plus 2 other
  errors, on unchanged lines and untouched files. Treated as a worktree project-graph artifact
  (decisions.md #14). If CI lint fails on it, investigate; it is not from this diff.
- Behavior change in main-agent-reassign popover (decisions.md #10, #12) is stated in the PR body.
  The user may overrule it.
- All decisions with evidence: `decisions.md` in this folder (#1-#15).

## Key files

- `libs/frontend/chat/src/test-setup.ts`
- `libs/frontend/chat/src/lib/settings/ptah-ai/cursor-credential-popover.component.ts`
- `libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.ts`
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/sessions/session-create.e2e.spec.ts`
- Lane reports: `lane-a/b/c/d1/d2-report.md`, `fix-round-report.md` in this folder.

## Next steps

1. `cd D:\projects\ptah-extension\.claude-worktrees\chat-test-hygiene`
2. Check CI: `gh pr checks 817` and, for a failure, `gh run view <run-id> --log-failed | tail -80`.
   Also read review comments: `gh pr view 817 --comments` and
   `gh api repos/Hive-Academy/ptah-extension/pulls/817/comments`.
3. In the CI unit-test logs for chat, confirm console noise is near zero, for example
   `gh run view <run-id> --log | grep -cE "NG0914|IntersectionObserver is not defined|ModelStateService\]"`.
4. For a task-related failure: fix it (codex lane per user rules), then verify scoped:
   `npx jest -c libs/frontend/chat/jest.config.ts <spec> --coverage=false --maxWorkers=2`
   and before push, after asking peers for "checks: free":
   `npx nx test chat --parallel=1 -- --coverage=false --maxWorkers=2`
   `npx nx run-many -t typecheck -p chat webview-e2e-harness --parallel=1`
5. Commit in the foreground with explicit paths (include task.md and HANDOFF.md), subject <= 72 chars,
   scopes from `.commitlintrc.json` (`chat`, `webview-e2e-harness`), trailer
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push in the background.
6. Repeat until CI is green and reviews are addressed. Report PR URL, head, CI and review state.
   Do not merge, force push, or remove the worktree/branch without user authorization.
