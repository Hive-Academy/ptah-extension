# Handoff - TASK_2026_865_2a1d ("Continue with <provider>" carry-over)

Date: 2026-11-03. Worktree: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765`.
Branch: `feat/provider-switch-carryover`. The user stopped the session after Batch 1.

## State

| Step | State |
| ---- | ----- |
| Gate 0.1 | Done. Lanes enabled, lane-review, codex lane = cross-side reviewer (context.md). |
| Gate 1 | Passed (task-description.md Revision 1 + rows 12, 14-15). |
| Gate 2 | Passed for all parts by user decisions (rows 24, 26, 29-33, 41), except ONE open fix: row 41 (Component 11 byte-bound fixture). |
| Plan | implementation-plan.md Revision 3. User answers: K2 both directions (rows 20, 25, 30), U1=A (31), U2=A (32), P4=A fail closed (38), rpc.types.ts edits in own block (39). |
| Batches | batches.md: 11 batches. Phase 1 = 1-8, Phase 2 (K2 native read) = 9-11, no longer held (row 30). |
| Batch 1 | **UNCOMMITTED** (corrected by the parent session, 2026-11-03 17:25 UTC: `git log main..HEAD` has only `docs(task-specs)` commits; `libs/shared/src/lib/types/rpc.types.ts` and `rpc/rpc-chat.types.ts` are modified in the worktree; batches.md still says IN_PROGRESS). The child reported `-p @ptah-extension/shared` 3/3; re-run it before the commit (cache hit if unchanged). Check the row 39 own-block rule in the diff, then commit only those files. |
| Batch 2 | UNCOMMITTED, NOT VERIFIED. A backend-developer subagent was still running its verify when the session stopped. Files: agent-sdk `history.types.ts`, `history-event-factory.ts` (+spec), `session-history-reader.service.ts`, new `session-history-reader.carry-over.spec.ts`. Report: batch-2-report.md is MISSING (not in the task folder). |
| Session end | The child session ended at the 120-minute runtime cap (`agentSessions.maxRuntimeMinutes`), turn 4, 17:13 UTC. Its transcript was not readable. The parent recorded the continuation choice (parent TASK_2026_863_3855 decisions row 63): the user starts a NORMAL session here with the prompt at the end of this file. |
| batches.md labels | Batches 9-11 still say "HELD (user decision, row 27)". That hold is lifted (rows 30, 41). Change the three headings to PENDING before Phase 2. |
| Batches 3-11 | Not started. |

## Next steps (in order)

0. Batch 1: review `git diff -- libs/shared` against batches.md Batch 1 and row 39, run
   `npm run verify -- -p @ptah-extension/shared`, then team-leader Mode 2 commits only those
   two files (`feat(shared): ...`). Mark Batch 1 COMPLETE.
1. Batch 2: batch-2-report.md is missing; review the diff (`git diff -- libs/backend/agent-sdk`)
   against batches.md Batch 2 and plan Component 2, run
   `npm run verify -- -p @ptah-extension/agent-sdk`, fix or re-run the developer if it fails,
   then commit only those files (`feat(agent-sdk): ...`).
2. Row 41: one bounded software-architect fix of the Component 11 byte-bound fixture spec only
   (enough pages to exceed 80 MiB = 10x the 8 MiB bound, each page under the 16 MiB frame limit,
   byte cutoff before the request cap; assert newest turns, incomplete flag, page-byte sum, no
   further requests). NO plan re-check. Commit the plan.
3. Row 36: copy the plan's "## Proposed requirement changes" (Requirement 9 /compact and AC
   changes, plus P4=A text from row 38) into task-description.md before the Phase 1 review.
4. Pre-step before Batch 6: visual-reviewer takes Electron "before" screenshots of the re-auth
   banner (dark + light) from the base commit.
5. Run Batches 3-8 per batches.md (executor per batch; team-leader Mode 2 after each; scoped
   `npm run verify -- -p <batch projects>`; Batch 5 adds `@ptah-extension/cli-engine`). Task 7.1
   applies P4=A (row 38).
6. Phase 1 close: final verify (8 projects incl. ptah-electron, ptah-extension-webview,
   cli-engine); codex code-logic review of the phase diff (covers F1/F3) + style review of the 2
   new RPC methods; one fix round.
7. Phase 2: Batches 9-11, then its own codex code-logic review (covers the row 41 fixture).
8. Visual-reviewer "after" screenshots (dark + light). Commit, push + PR in background (row 6).

## Rules to keep

- AUTH_REQUIRED refusal of `chat:continue` stays byte-identical; `/compact` refusal shape stays
  unchanged for non-carry-over cases (rows 8, 22).
- Do not edit `libs/frontend/onboarding` or Codex sign-in code; do not restore the retired proxy.
- REVISE past the cap or any user-reserved decision (privacy, security, removals, scope) goes to
  the user; never decide it alone (row 16).
- CLAUDE.md: scoped verify only; no build/serve/e2e/package; Electron first.
- Executors: implementers must not be the codex family (codex is the reviewer). Ollama Code was at
  its limit; kimi code worked but ignored a queued message (check edits yourself).

## Key files (task folder)

context.md, decisions.md (rows 1-41), task-description.md (+ -review.md), implementation-plan.md
Revision 3 (+ -review.md, rounds 1-4), batches.md, batch-1-report.md.

## Start prompt for the new session (normal session, not a child)

Open a normal Ptah session with this worktree as its folder, then paste:

```text
/orchestrate TASK_2026_865_2a1d

Continue this task from its handoff. Work only in the worktree
/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765
on branch feat/provider-switch-carryover.

Read .ptah/specs/TASK_2026_865_2a1d/HANDOFF.md first, then context.md, decisions.md
(rows 1-41) and batches.md. Every user question so far is answered (rows 20-41); do not ask
them again. Continue with "Next steps (in order)" in HANDOFF.md, starting at step 0
(Batch 1 is uncommitted).

Rules: follow CLAUDE.md (scoped `npm run verify -- -p <projects>` only; never workspace-wide;
no build/serve/e2e/package; Electron first; before/after screenshots in dark and light).
Approval mode lane-review; the codex lane is the cross-side reviewer, so implementers are a
non-codex family. Ask me (one bundled AskUserQuestion) about any REVISE past the cap and any
privacy, security, removal or scope decision. Do not change the AUTH_REQUIRED refusal
contract. Do not edit libs/frontend/onboarding or the Codex sign-in code. Keep libs/shared
rpc type edits in their own block (row 39); the branch feat/provider-readiness also edits
those files. Commit in the foreground; push and open the PR in the background. No merge,
force push or worktree removal. Record every decision in decisions.md (check the last row
first). Run /session-handoff yourself when the context budget runs low.
```
