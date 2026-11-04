# Handoff - TASK_2026_865_2a1d ("Continue with <provider>" carry-over)

Date: 2026-11-03 (~21:15 UTC). Worktree:
`/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765`,
branch `feat/provider-switch-carryover`. Draft PR: https://github.com/Hive-Academy/PtahCode/pull/914
Remote head `a2b3c4395`. One local docs commit (this HANDOFF + decisions row 80) is NOT pushed:
push it in the background with the next push (a docs-only push would cancel the running CI).

## Goal

After a provider switch, a conversation from the old provider is refused with AUTH_REQUIRED and
shows a re-auth banner. Add an explicit carry-over: bounded read of the old transcript, tool I/O /
attachments / reasoning removed, known secrets redacted, a new chat on the active provider whose
first turn carries that text. Triggers: a "Continue with <provider>" banner button and `/compact`,
both directions (Claude <-> Codex). The old provider is never called. All user decisions are in
decisions.md rows 1-80 (read the last rows first). Rows 51, 63, 67, 68, 76 are user answers
from this and the previous session.

## Done this session (all pushed unless noted)

| Commit | Subject | Verification |
| --- | --- | --- |
| a9cda59db | feat(codex-runtime): bounded newest-first codex session tail read (Batch 9) | 2 specs 189/189 |
| 58499669f | fix(rpc-handlers): keep the carry-over check from holding a proxy (review F1) | 36/36 |
| d908a92f7 | fix(chat): recover a lost carry-over launch and fix the check text (F2, F4) | 189/189 |
| 2114984cb | Merge origin/main (conflict in message-dispatch.service.ts resolved, row 70) | dispatch spec 47/47 |
| 1d0884603 | fix(chat): lazy-load the carry-over launch to fit the bundle budget (row 63) | local prod build 3,994,704 B < 4 MB; CI Webview E2E PASS |
| 364ca0c53 | fix(rpc-handlers,chat): match carry-over sessions by launch request id (R1-R3) | specs pass; di-lint pass; degradation-audit no FAIL |
| 17cb79892 | test(rpc-handlers,chat): align specs with the carry-over contract (4 CI failures) | local jest pass |
| 99f6a8150 | fix(rpc-handlers,chat): refuse a carry-over retry until the launch retires (row 76) | specs 48/78/41/90 |
| bac9eb3c6 | feat(agent-sdk,electron): read native codex carry-over tails (Batch 10) | agent-sdk 47/47, electron 42/42 |
| + docs(task-specs) commits 7b04236c4, 210b5ae75, 96ce8eeb6, c76b5817c, a2b3c4395 | | |

CI history: head c76b5817c — Webview E2E PASS, Electron E2E PASS, typecheck/checks/docs-build/
git-real-git PASS (on 96ce8eeb6), test shards 3+4 FAILED on 4 spec-only issues (fixed in
17cb79892). CI on head a2b3c4395 was PENDING at handoff (all jobs queued).

Reviews (codex = reviewer family, claude = implementer family):
- code-logic-review.md (Phase 1): REVISE 5/10 -> fixed F1, F2, F4; F3 (unclaimed-tab rekey
  before skip, stale liveness only) deferred as a named later task (row 59).
- code-logic-re-review.md: REVISE -> R1/R2/R3 -> user approved one bounded fix (rows 67-68).
- code-logic-final-review.md: REVISE 5/10, R2 + R3 FIXED, R1 partial -> user chose "Block retry
  until retired" (row 76) -> commit 99f6a8150.
- code-logic-fix5-review.md: codex lane ed1a9fdd RUNNING at handoff (file is still a skeleton).

## In progress

- **Batch 11 NOT STARTED** (its subagent was lost with the session; no edits in the tree).
  Restart it: brief = batches.md "## Batch 11" Task 11.1 (chat-carry-over.service.ts + spec,
  chat-carry-over-transcript.ts) — native constants 200/8/16, `codex-app-server` +
  `openai-codex` eligible, router gets `nativeBound`, logs `source: 'codex-native'`, no native
  adapter call; make agent-sdk router `nativeBound` required only if a one-line type change (row
  77); keep all fix behavior of 58499669f, 364ca0c53, 99f6a8150. Executor: Claude
  backend-developer subagent (kimi code AT LIMIT reset unknown; Ollama Code weekly 97%; codex is
  the reviewer family) — rows 48, 58.

## Open problems and decisions

1. **CI on a2b3c4395 unverified** (pending at handoff). Fix task-caused failures with new commits.
2. **Fix-5 review pending** (lane ed1a9fdd). The user's cap rule: this is the ONE review of the
   row-76 change. If it finds defects -> report to the user and stop; do not fix on your own.
3. **Known residual (by design, row 79)**: an old launch whose process inits > ~210 s after
   admission and after the retry's acceptance can still take the retry's ID; only an agent-sdk
   registry change closes it (user did not choose it). List it in the PR body as a later task,
   with F3 (rekey before skip).
4. **GitGuardian** fails on commit ff0530284: a fake test JWT (redaction fixture). The USER must
   resolve it as a false positive on the GitGuardian dashboard. Never rewrite history.
5. Note for the final review: `@defer (on immediate)` also defers the pre-existing re-auth banner
   (row 71). `codex-runtime-composition.ts` is over the `max-lines` warning (pre-existing).

## Key files

- Task folder `.ptah/specs/TASK_2026_865_2a1d/`: decisions.md (rows 1-80), batches.md,
  implementation-plan.md (Rev 3 + 3.1; plan wins over stale batch text, row 61),
  task-description.md (Revision 2), batch-*-report.md, fix-{1..5}-*-report.md, the review files,
  visual-review.md + screenshots/before/ (+ `_capture.spec.ts.txt` for the after run).
- Backend: `libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.ts` (check,
  launch, request-ID tickets, IN_FLIGHT refusal), `libs/backend/agent-sdk/src/lib/codex-app-server/{session-history-router,codex-carry-over-projector}.ts`,
  `libs/backend/codex-runtime/src/lib/codex-session-history.ts`, `apps/ptah-electron/src/di/codex-runtime-composition.ts`,
  `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts` (tags SESSION_ID_RESOLVED).
- Frontend: `libs/frontend/chat/src/lib/services/{provider-carry-over.service.ts,provider-carry-over-launch.ts (lazy chunk),message-sender.service.ts}`,
  `.../components/templates/chat-view.component.html` (deferred banner).
- Shared: `libs/shared/src/lib/types/rpc/rpc-chat.types.ts` (carry-over contract, deadlines).

## Background work

- Codex lane `ed1a9fdd-a813-4931-9a50-74a9efe859c5` (CLI session 01a1a33e-a23d-7d41-a94d-de4715f310c2):
  scoped review of 99f6a8150 -> `code-logic-fix5-review.md`. RUNNING; handed to the new session.
- No subagents or watchers are running (the CI watcher shell ended with the old session).

## Next steps (in order)

1. Read the fix-5 review when its `<agent-lane-completed>` arrives. APPROVED -> continue.
   REVISE -> report the findings to the user and ask (cap exhausted).
2. Watch CI on the PR head (all workflows, not only "CI"):
   `gh run list --branch feat/provider-switch-carryover --limit 6`, then background
   `gh run watch <id> --exit-status --interval 120` per run; on failure
   `gh run view --job <id> --log-failed | sed 's/\x1b\[[0-9;]*m//g' | grep -E "FAIL|●|error" | head`.
3. Restart Batch 11 (In progress above). Commit in the foreground only when no agent edits the
   worktree; push in the background; record rows 81+.
4. Phase 2 code-logic review by a codex lane on the Phase 2 commits (a9cda59db, bac9eb3c6,
   Batch 11 commit), including the Component 11 byte-bound fixture (row 44). One fix round, one
   scoped re-review; REVISE past that -> user.
5. Visual-reviewer "after" screenshots in Electron, dark + light (banner without button, with
   button, busy, notice after button carry-over, notice after /compact carry-over, /compact from a
   native Codex session), reusing `screenshots/before/_capture.spec.ts.txt`.
6. Update the PR body (Summary, Test plan with real CI results, later tasks: F3 + the residual),
   then `gh pr ready 914` only when CI is green and the reviews pass. Report PR URL, head, CI and
   review state. No merge, no force push, no worktree removal.

## Rules to keep

- User row 51: heavy verify runs in CI. Locally only `ptah_get_diagnostics` on changed files and
  scoped jest/light checks under `node scripts/verify.mjs --exec --task <name> -- <cmd>`.
  di-lint: `npx nx run di-lint:lint`; degradation audit:
  `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts | grep -E "FAIL|TOTAL"`.
  No build/serve/e2e/package except the visual-reviewer's Electron screenshots.
- Do not change the AUTH_REQUIRED refusal contract of `chat:continue`. Do not edit
  `libs/frontend/onboarding` or Codex sign-in code. Do not raise the webview bundle budget (row 63).
- Ask the user about any REVISE past the cap and any privacy, security, removal or scope decision.
- Commitlint: read `.commitlintrc.json`; subject <= 72, body lines <= 100; `chat` and
  `task-specs` scopes were accepted on this branch.
