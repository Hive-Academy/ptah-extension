# TASK_2026_677_efcd — HANDOFF 6

> File name: `handoff-6.md`. NEVER write `HANDOFF.md` (user rule; decisions rows 8, 67). The next handoff is
> `handoff-7.md`. Worktree: `D:\projects\ptah-extension\.claude-worktrees\clean-session-view`, branch
> `feat/clean-session-view`. Origin has commits up to `5ed660524`; everything after it is LOCAL ONLY, no PR.
> Keep the git-ignored `node_modules` junction (row 53); remove it before the worktree is removed.

## 1. Done (session 6)

- W3 committed: B-3 `cd37b5a44`, A2-1 `567a62a3f`, D-1 `9e36b8753` (MODE 2 fix round row 75), docs `415d33556`,
  `7fa0856c0`.
- W4 committed: A2-2 `d389caab0`, A1-2 `b5d707631`, B-4 `d5951a2f7`, docs `65add1d60` (rows 78-84).
- D-1 grok review `code-logic-review-D-1.md` = REVISE 5/10. Fixes held for the ONE phase fix round (row 77):
  Serious 1-3, Moderate 4, 6, 7; Moderate 5 only if trivial. Grok re-reviews the D-1 fixes.
- Row 81 Minor (A2-2 `aria-haspopup="menu"` -> `dialog`) also goes to the phase fix round.
- Row 85 (uncommitted at this write): cross-task contract with TASK_2026_649, option B, accepted by 649 (its D8).
  677 owns `libs/frontend/chat/src/lib/tokens/session-embed-chrome.token.ts` (exact content: batches.md CV-1 note).
  CV-1 hides inspector / default-open / shell controller when `'bare'`; CV-2 hides the session header when `'bare'`.
- PR #733 MERGED 2026-10-15T17:09:58Z. C-3 is unblocked after the rebase.
- 12/19 batches complete.

## 2. Open at this write

1. W5 (A1-3, CV-1): both executors were interrupted by an API rate limit, then resumed in session 6. Partial
   edits are on disk. When they report: fresh team-leader MODE 2 for W5 (projects `@ptah-extension/chat` plus any
   others in `git status`; include the batches.md / decisions.md edits in its docs commit). CV-1 must report Jest
   resolution of `tasks-ui/presentation` (row 84).
2. After the W5 commits: rebase onto main (plan §7.4 H1-H3), confirm the node_modules junction target still
   matches the worktree package.json / lock, re-verify the C-3 file list against main, then run C-3 on ONE lane
   (codex or grok; the batch section verbatim, batches.md ~565-625). Review by a different family.
3. W6 (CV-2, B-5; B-5 needs C-3), W7 CV-3 (may close as no-op in W6 MODE 2), W8 BUILD-1:
   `node .ptah/tmp/check-run.mjs webview-bundle -- npx nx build ptah-extension-webview --parallel=1 --skip-nx-cache`
   (3.5 MB error budget).
4. Codex phase code-logic review (+ style check of new public exports); D-1 and any codex-built batch get a
   non-codex reviewer. One fix round. Visual-reviewer dark + light vs `prototype/` and `screenshots/before/`.
   Final commit. Push + `gh pr create` as ONE background command.
5. USER question (ask once if relevant): `SESSION_WORKFLOW_ADDONS` (B-3) has no consumer now; removal is the
   user's decision.

## 3. Verification (one at a time, worktree root)

```
node .ptah/tmp/check-run.mjs <label> -- npx nx run-many -t typecheck -p <projects> --parallel=1 --skip-nx-cache
node .ptah/tmp/check-run.mjs <label> -- npx nx run-many -t lint -p <projects> --parallel=1 --skip-nx-cache
node .ptah/tmp/check-run.mjs <label> -- npx nx run-many -t test -p <projects> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache
```

Confirm the header "Running target X for N projects".

## 4. Rules

As handoff-5.md §7, plus: executors never put both `class=""` and `[class]=""` on one element; write no new specs;
lucide-angular icons and `ptah-provider-mark`; ask the user only for removals, scope or irreversible actions.
