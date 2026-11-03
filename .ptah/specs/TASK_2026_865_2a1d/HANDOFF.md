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
| Batch 1 | DONE and committed (shared contract). Verify `-p @ptah-extension/shared` passed (3/3). Block rule of row 39 applied by the orchestrator. |
| Batch 2 | UNCOMMITTED, NOT VERIFIED. A backend-developer subagent was still running its verify when the session stopped. Files: agent-sdk `history.types.ts`, `history-event-factory.ts` (+spec), `session-history-reader.service.ts`, new `session-history-reader.carry-over.spec.ts`. Report: batch-2-report.md (may be missing or partial). |
| Batches 3-11 | Not started. |

## Next steps (in order)

1. Batch 2: read batch-2-report.md if present, review the diff (`git diff -- libs/backend/agent-sdk`)
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
