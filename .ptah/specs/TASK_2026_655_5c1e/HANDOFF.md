# HANDOFF — TASK_2026_655 (main-agent stream chunks stop rendering after a workspace switch)

Written 2026-10-14 at the end of session 3. It overwrote the session 2 `handoff.md` (same file
name on Windows; its content is superseded by this file). Read this file
first, then only the files and line ranges it names. Read large files in chunks of at most 60-80
lines (a hook shortens tool output above ~2400 tokens).

## Session 4 outcome (latest; supersedes "Open problems" and "Next steps" below)

- Orchestrator re-ran the chat checks: test PASS, typecheck PASS, lint 0 errors; rpc-handlers lint
  0 errors (50 warnings); reproduction spec hash unchanged (`8f36bddd8aa3f123`); A-2 holds
  (R-F4 3/3; `assumption-checks.md` updated).
- Re-review of the F fixes (grok, `code-logic-review-F-r2.md`): REVISE 4/10, 3 defects, all
  verified. ONE bounded correction (codex, `batch-F-fix2-report.md`) fixed them with tests.
  Chat after the correction: 199 suites, 3,691 passed, 2 skipped; typecheck PASS; lint 0 errors.
- Independent review of the correction (grok, `code-logic-review-F-r3.md`): REVISE 5/10, 2 open
  defects. Revise cap is used up, so they are reported, not fixed:
  1. serious: a seeded subagent whose parent Task is itself inside a subagent (nested owner) takes
     the owner-not-found fallback; its live tail has no streaming root and is not shown
     (`session-history-replayer.service.ts:336-352`).
  2. moderate: a Task owner that was not the last history row is appended at the bottom after
     turn-end finalization (`session-history-replayer.service.ts:354-390`,
     `message-finalization.service.ts:69-80`). Order only; no loss or duplicate.
- Final 4-project run (before the correction): shared, agent-sdk, rpc-handlers, chat all PASS.
  Only chat files changed after it, and chat was re-run in full.
- Not done: Batch B minor M2 tests (optional); A-1 and RA-A1 need a live app session.

## Goal

Electron app, single chat layout. The main agent streams in workspace A; the user switches to B
and back to A; the in-flight turn's streamed chunks stop rendering and the spinner goes off.
Fix it with the approved plan + addendum. USER GOAL (user-owned): no streamed content lost and
none shown twice. Correctness without defects is the priority.

## Where the work lives

| Item | Value |
| --- | --- |
| Worktree | `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush` |
| Branch | `fix/workspace-switch-stream-flush` — **no commits yet** (base `4f571f8d1` = `main`). Nothing pushed, no PR. |
| Task folder | `.ptah/specs/TASK_2026_655_5c1e/` (untracked) |
| Main checkout | `D:/projects/ptah-extension` must stay on `main`. Work only in the worktree. |
| node_modules | the worktree has a **junction** to the main `node_modules` (created this session). Remove it only with `cmd /c rmdir <worktree>\node_modules`, never a recursive delete. |
| Reproduction spec | `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.ws-switch-resync.spec.ts` (untracked). Must stay unchanged. SHA-256 prefix `8f36bddd8aa3f123` (checked twice this session; unchanged). It PASSES now. |

## User decisions (final; do not ask again)

- Scope FULL plan (core + D-9 + D-10), OQ1 two-node split accepted, OQ2/OQ3 fixed in this task,
  reverted `canFlush` stays dropped, do not wait for TASK_2026_629.
- Session 3: addendum **approved** with the orchestrator's Revision 3 fix (rule P2 for untracked
  X, rule P3, loose blocks; decision RB-9). No more document review rounds.
- Session 3: the user **accepted** these no-loss duplicate edges: rule R turn boundary, A-B2
  failure, page edge, older host without `liveSeedBlocks` (addendum B.10 point 9).
- Orchestrator decisions recorded this session (inside the user's goal):
  - F1 defect 3: after filter retirement, rule T stays active only for `historyToolIds` (always
    keep; reconcile when the result differs; never drop).
  - F3 defect 4: when `session:load` fails after an early resync claim, reset the tab before the
    claim release (seed applies onto an empty tab; never discard the seed).
  - F2 D2: any filter exception fails OPEN (deliver the event, apply the seed unfiltered).

## Documents (task folder)

| File | State |
| --- | --- |
| `implementation-plan.md` | APPROVED (session 1). |
| `implementation-plan-addendum.md` | APPROVED by the user (session 3). Has `## Revision 1/2/3` changelogs at the top. Residual A = RA-1..RA-5; Residual B = rules P, P2, P3, T, R, O, I, S, H. |
| `implementation-plan-addendum-review.md` | Round 3 (opencode): REVISE 7/10, 1 moderate defect → fixed by Revision 3 (user-approved). |
| `assumption-checks.md` | A-1 and RA-A1 NOT run (need a live app turn); A-3, A-B2, RB2-A3 hold; A-2 see below. |
| `batch-*-report.md` | Implementer reports per batch (S, B1, B2, B-fix, F1, F2, F2-fix, F3; F-fix pending). |
| `code-logic-review-*.md` | Reviews (all Claude-family reviewers; all implementers were codex). |
| `test-report-R-F4.md` | R-F4 integration spec report (written, NOT yet run). |
| `chat-failures.txt` | Scratch: failure text of the chat test run (delete before commit, or leave untracked). |
| `diagnosis.md`, `code-logic-review.md` | Obsolete (reverted `canFlush` change). Ignore. |
| `proof.md`, `context.md` | Root-cause evidence and the user report. |

## What is done

| Batch | Files (all uncommitted) | Review | Checks |
| --- | --- | --- | --- |
| S shared contract | `libs/shared/src/lib/types/messages/{payload-map,schemas,chat-stream-snapshot.spec}.ts`, `libs/shared/src/lib/types/rpc/rpc-chat.types.ts` | checked by orchestrator vs plan comp. 1 + addendum B.2.1; included in review B | shared jest 7/7, typecheck, lint PASS |
| B host (B1 + B2 + B-fix) | rpc-handlers `chat/streaming/{stream-delta-coalescer,live-message-projection,chat-stream-delivery-coordinator.service}.ts` (+specs); `chat/session/{history-block-owners,chat-history-read.service,chat-session.service}.ts` (+specs); `handlers/chat-rpc.schema.ts` (+spec); agent-sdk `helpers/history/session-replay.service.ts`, `session-history-reader.service.ts` (+specs) | `code-logic-review-B.md` REVISE → fixed → `code-logic-review-B-r2.md` **APPROVED 8/10** (4 minor: M1 conservative publishTerminal guard; M2 no per-drop-rule pending-anchor cleanup tests; M3/M4 see file) | `nx run-many -t test -p agent-sdk rpc-handlers` PASS (2 projects; 3322 + 4380 tests); typecheck both PASS; lint agent-sdk PASS; **lint rpc-handlers result not visible** (filter cut it) — re-run |
| F1 filter + patch | `libs/frontend/chat/src/lib/services/chat-store/{persisted-content-filter,history-tool-result-patch}.ts` (+specs) | `code-logic-review-F1.md` REVISE → fixed → `code-logic-review-F1-r2.md` **APPROVED 8/10** (2 minor) | 51 focused tests PASS (round 1) |
| F2 replayer etc. | `chat-store/session-history-replayer.service.ts`, `chat-store/session-liveness-reconciler.service.ts`, `stream-viewport-controller.service.ts` (+specs) | `code-logic-review-F2.md` **APPROVED 7/10** with 3 moderate (D1 filter registration outside try/catch; D2 filter calls fail closed; D3 filters leak for closed tabs) + 2 minor (D4, D5) → sent to F-fix | orchestrator fixed one test-data error in replayer spec (`expectedLive: ['post-text']`, case R-B1s Rev 3 a: ids vs deltas) |
| F3 callers | `chat-message-handler.service.ts`, `chat.store.ts`, `chat-store/session-loader.service.ts`, `chat-store/compaction-lifecycle.service.ts` (+specs) | `code-logic-review-F3.md` **REVISE 6/10**: F3-1 SERIOUS (verified: `finally` releases the claim before the registry delete; `main` did delete first), F3-2 moderate, F3-3/F3-4 minor → sent to F-fix | — |
| R-F4 | NEW `chat-store/session-loader.resync-live-seed.spec.ts` (3 cases: seed + fenced live delta, generating status, A-2 subagent nesting) | not reviewed | NOT run. Tester suspects A-2 fails (history finalization clears `streamingState` before the seed). Plan rule: "If nesting fails, record it; do not widen the scope." |

Chat project run before F-fix (`nx test @ptah-extension/chat`): typecheck PASS, lint PASS (0 errors),
tests FAIL in 3 groups — `chat-view.dock.spec.ts` (~16, `stream-viewport-controller.service.ts:116`
`result` undefined), `session-loader.cli-restore.spec.ts` (7, "Failed to restore CLI sessions"),
`session-loader.service.spec.ts` (1, "claims a resync before session:load ..."). The first two
PASS on `main` (26/26), so this branch broke them.

## Last lane (finished)

- **Batch F fix lane** (codex, agent `7c054319-de71-4404-b1ce-1ad1d3fd87cf`, CLI session
  `01a13b67-5071-75c0-a931-ec32af3d9a7a`), deliverable `batch-F-fix-report.md`. Task: fix the 3 failing test groups,
  F3-1..F3-4 and F2 D1-D5, each with a test; it may run chat checks itself (no other check runs).
  It already edited `session-loader.cli-restore.spec.ts` — verify that the spec change is
  justified and does not weaken the spec.
- **F-fix outcome (lane FINISHED before session 3 closed; nothing is running now):**
  `batch-F-fix-report.md` written. Lane-reported checks: `nx test @ptah-extension/chat` PASS
  (199 suites, 3,688 passed, 2 skipped), `nx typecheck` PASS, `nx lint` PASS (0 errors, 45
  warnings). R-F4 spec 3/3 PASS, including the A-2 subagent nesting case (update
  `assumption-checks.md`: A-2 holds by R-F4). Orchestrator verified: the only spec change
  outside the lane's own specs is `session-loader.cli-restore.spec.ts` (+4 lines: providers for
  the new `SessionLivenessReconcilerService` and `StreamViewportController` injections; no
  assertion changed); `chat-view.dock.spec.ts` unchanged. Root causes per the report: A1
  viewport declare assumed a reply (`stream-viewport-controller.service.ts:67,117`), A2 missing
  providers + absent RPC reply handling (`session-loader.service.ts:1574-1575`,
  `session-liveness-reconciler.service.ts:66`), A3 filter exception escaped and blocked delivery
  (now fails open, `session-history-replayer.service.ts:879-889`). The lane's PASS is evidence,
  not proof: the next session must re-run the checks itself.

## Open problems

1. Batch F is green per the lane; re-run all chat checks yourself; then ONE independent
   re-review of the F fixes (Claude family or another non-codex family). Revise cap for code: this
   is round 1; at most one more bounded correction, then report open defects to the user.
2. R-F4 passed 3/3 in the F-fix lane's run (A-2 holds). Confirm in your own chat run and update
   the A-2 row in `assumption-checks.md`.
3. `lint @ptah-extension/rpc-handlers` final result must be read (re-run with a filter on
   `problems|Successfully ran|Failed`).
4. Batch B minor M2 (tests for pending-anchor cleanup per drop rule: idle, compaction, subagent
   end, replacing message_start) — optional small test-only lane.
5. A-1 and RA-A1 need a live app session (user action); listed in `assumption-checks.md`.
6. Not run: no workspace-wide check, no build/serve/e2e (project rule).

## Lessons from session 3

- Lanes cannot run a lock wrapper with `Remove-Item -Force` (command review: "blocked by
  policy"), and a lock retried as many identical tool calls stops a lane with `repeat-call`.
  Working pattern: lanes write code and tests but run NO heavy checks; the orchestrator runs
  every check serially with the bash lock below. Exception: when only one lane runs, it may run
  its own checks directly.
- Lock used by the orchestrator (bash, one command, background):
  `L=.ptah/specs/TASK_2026_655_5c1e/.check-lock; until mkdir $L 2>/dev/null; do sleep 20; done; trap 'rmdir $L' EXIT; <check>`
- `ptah_agent_spawn` with `resume_session_id` starts a FRESH lane (context > 60k) — always give
  complete instructions.
- Filter test output carefully: `grep error` matches warning text; `head` can cut the final
  "Successfully ran" line.
- `opencode` is near its monthly limit (91%); codex had room (weekly ~15-20%).

## Next steps (exact)

1. Read `batch-F-fix-report.md` (per-item fixes F3-1..4, F2 D1-D5, A1-A3 with file:line and
   test names). No lane is running.
2. Run, one at a time (from the worktree, with the lock):
   - `npx nx test @ptah-extension/chat --parallel=1 --outputStyle=static 2>&1 | grep -E "Tests:|Test Suites:|● .*›|Successfully ran|Failed tasks"`
   - `npx nx typecheck @ptah-extension/chat --parallel=1`
   - `npx nx lint @ptah-extension/chat --parallel=1 2>&1 | grep -E "problems|Successfully ran|Failed"`
   - `npx nx lint @ptah-extension/rpc-handlers --parallel=1 2>&1 | grep -E "problems|Successfully ran|Failed"`
   - `sha256sum libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.ws-switch-resync.spec.ts` → must start `8f36bddd8aa3f123`
3. Handle R-F4 / A-2 per open problem 2.
4. Independent re-review of the F fixes (not codex): write `code-logic-review-F-r2.md`.
5. Optional: Batch B M2 tests (rpc-handlers), then re-run rpc-handlers tests.
6. Final scoped run: `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/chat --parallel=1` and confirm the header says "Running target test for 4 projects".
7. Commit in the foreground (read `.commitlintrc.json`; subject ≤ 72 chars; body lines ≤ 100,
   wrap at 72; scopes e.g. `fix(shared,agent-sdk,rpc-handlers,chat): ...`; end with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Stage specific files only; include
   the reproduction spec; do not commit `.ptah/specs` scratch (`chat-failures.txt`) unless the
   repo convention commits task folders (check `git log -- .ptah/specs` first).
8. Push + `gh pr create` in ONE background command (pre-push hook runs di-lint and the Electron
   validate-deps gate; a failed gate needs a fix commit). PR body: `## Summary` + `## Test plan`,
   list the accepted edges and the not-run assumption checks, end with
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Report the PR link (user
   rule: no local-only branches).
