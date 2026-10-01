# Handoff — TASK_2026_576_e16a (git review UI + git reliability)

Written 2026-10-01, end of session. Replaces the 2026-09-30 handoff.

## 1. Where things stand

| Item | State |
|---|---|
| P1 (Batches 1–8) | MERGED into `main` (PR #611, merge `16dce8519`). Branch deleted. The `task-576-p1` worktree is stale and can be removed (`git worktree remove`). |
| P2 branch | `feat/task-2026-576-p2`, based on `main` (merge `af0877420`). **Draft PR #619** against `main`: https://github.com/Hive-Academy/ptah-extension/pull/619 |
| P2 worktree | `D:/projects/ptah-extension/.claude-worktrees/task-576-p2` (all task work happens here; main checkout stays on `main`) |
| P2 batches done | 9 `7800dde50`, 18 `e7b30b433`, 10 `4ff38bc5c`, 11 `2ae839735`, 12 `ca36b19de`, 15 `183aac6e6`, 13 `ddafac963`, 16 `4b458351a`, 19 `0c3189fbc` |
| P2 batches left | **14** (worktree removal detection + frontend scoping, depends on 13) and **17** (review reader 2 MiB limit, depends on 16). They are file-disjoint and can run in parallel. |
| Then | P2 phase-end review → P3 (Batches 20–32) → P4 (33–44) → P5 (45–57) → Cutover (58–69), each a stacked branch + PR |
| Progress | 17/69 batches complete (batches.md header) |

Read first: `context.md` (Gate decisions — especially **Auto mode** and **Lanes widened**, 2026-10-01), `batches.md` (per-batch specs, Outcome notes, phase-end checkboxes).

## 2. Mode of work (user, 2026-10-01)

- **Auto mode**: finish all remaining phases without stopping for user questions. Gates that would ask the user are decided by an independent lane of a different family (record the decision under `reviews/`).
- The orchestrator **may push** phase branches and **open stacked draft PRs**. P3 branches from P2 (`feat/task-2026-576-p3`, worktree `.claude-worktrees/task-576-p3`, PR base = `feat/task-2026-576-p2`), P4 from P3, and so on. When a lower PR merges, merge `origin/main` (or the new base) into the next branch — **no rebase of pushed branches, no force push**.
- Limits: never commit to or merge into `main`, never merge a PR, never bypass hooks, never amend, never approve a removal outside the approved parity list, never touch protected paths.
- Executors: subagents (backend-developer, frontend-developer, …) plus CLI lanes **Glm** (ptah-cli `pc-355b645d-35af-4974-84cf-9cf961ea0164`, no image input), **antigravity** (exits 1 after writing — check the deliverable), **opencode with Kimi** (`opencode-go/kimi-k2.7-code`, fallback `opencode/kimi-k2.7-code`; no messaging — read with `ptah_agent_read`). Not codex, not copilot. Max 3 lanes in flight.

## 3. Next steps, in order

1. **Batch 14** (backend-developer): `apps/ptah-electron/src/services/git-watcher.service.ts` (+spec) re-lists worktrees on admin change (≤1 per 30 s, last-run timestamp, no free-running timer; pattern `scheduleNestedRootsRefresh`); a prunable entry under `.claude-worktrees/` → `pruneWorktrees` + `git:worktreeChanged {action:'removed'}`. `libs/frontend/git-ui/src/lib/services/worktree.service.ts` (+spec) passes `workspaceRoot`. Verify `npx nx run-many -t typecheck,test,lint -p ptah-electron @ptah-extension/git-ui`.
2. **Batch 17** (CLI lane recommended, e.g. opencode Kimi or Glm; fallback backend-developer): `GitReviewReaderService.readBlob` uses `GIT_DIFF_MAX_SIDE_BYTES` (2 MiB) and the new outcomes, replacing the 64 MiB cap (`git-review-reader.service.ts:~383-387`). **Reuse `git/git-blob-classifier.ts`** from Batch 16. Spec for too-large and LFS pointer. Verify `vscode-core` typecheck/test/lint.
3. Commit each batch (orchestrator commits; explicit paths), mark it COMPLETE with an Outcome note in batches.md, push to PR #619.
4. **P2 phase-end review** (batches.md "P2 phase-end review"):
   - One cross-side review lane on `git diff origin/main...HEAD` (logic scope). Subagent-authored batches → CLI-lane reviewer; lane-authored batches (19, and 17 if a lane writes it) → `code-logic-reviewer` subagent. Write to `reviews/p2-phase-review*.md`.
   - Full e2e set.
   - Visual review of Batch 11 branch picker (before/after, dark + light) — `visual-reviewer` subagent or antigravity (Glm has no image input).
   - Fix findings in follow-up commits; tick the checkbox; mark PR #619 ready for review (`gh pr ready 619`).
5. **P3**: create branch + worktree from P2, open draft PR stacked on P2, run Batches 20–32 per batches.md waves, then P3 phase-end review (includes visual review of the change-set card against `prototype/`). Repeat for P4, P5, Cutover.

## 4. Open items for the P2 phase-end review

- Real-git suites `remote-stash` and `hooks` (kill-guard) flake under heavy machine load; they pass alone. Gate rule used: 3 green runs of `vscode-core:test-real-git` with nothing else running.
- `git-rpc.schema.ts:14` comment still names `validatePathSegment`.
- The header comment of `git-rpc.handlers.spec.ts` was not updated.
- `git-info.service.ts` is over `max-lines` (warning); Batch 16 moved new logic into `git-repo-operation.reader.ts` and `git-blob-classifier.ts`.
- The command-classification table in the git-info spec could add `check-ignore` and `worktree prune`.
- Batch 15 badge letters changed: conflicted `!`, ignored `I` (was `!`). Check in the visual review.
- `.err-solid-text` (design-spec §5 conflicted badge for the change-set card) does not exist yet — P3 card work must add it.
- Batch 16 deviation: operation markers are checked on every status (cached `rev-parse --git-path`, fs only after the first call) instead of "only when U entries exist".
- Known unrelated failure (also on `main`): rpc-handlers `harness-skill-selection-rpc.service.spec.ts` "never writes state.json".

## 5. Rules that stay in force

- Never touch or stage: `.ptah/specs/TASK_2026_555/**`, `.claude/skills/ptah-cli-usage/references/internal-mcp.md`, `apps/ptah-video-studio/**`. Stage explicit paths only. Do not add a `.gitignore` image rule (the user's own PR does that).
- The git stash stack is shared by all worktrees and sessions: never bare `git stash`/`pop`; tagged push, apply by SHA, drop by tag. Prefer WIP commits.
- Never `Remove-Item -Recurse` the node_modules junction in a worktree (use `cmd /c rmdir` if needed).
- Commit messages: UTF-8 without BOM, LF, header ≤ 100 chars, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commitlint scopes: `vscode-core`, `electron`, `git-ui`, `e2e`, `webview`, `ci`, `shared`. PR bodies end with the Claude Code line.
- Pre-commit hook: `nx format:write`, `nx affected -t lint` (incl. `degradation-audit`), `ptah-electron:validate-deps`, commitlint.
- `@nx/jest` needs `--testPathPatterns` (plural). Real-git specs are `*.real-git.spec.ts`, excluded from `vscode-core:test`, run by `vscode-core:test-real-git` (in band).
- Parallel subagents in one worktree are fine when file-disjoint; tell each which files the other owns. Typecheck may fail transiently on the other agent's in-progress edits — re-run once.
- Nx Cloud is disabled; local cache only.
