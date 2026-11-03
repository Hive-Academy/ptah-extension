# Handoff - TASK_2026_865_2a1d ("Continue with <provider>" carry-over)

Date: 2026-11-03. Worktree: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765`.
Branch: `feat/provider-switch-carryover`. Last commit: `3f6b09096` (task specs and gate reviews).

## Where the task is

| Step | State |
| ---- | ----- |
| Gate 0.1 | Done. Lanes enabled, approval mode lane-review, codex lane is the cross-side reviewer (context.md). |
| Gate 1 (task-description.md) | Passed. Codex rounds 1-2; cap decision row 12; user confirmed rows 10 and 12 (rows 14-15). |
| Gate 2 (implementation-plan.md, Revision 1) | BLOCKED at the revise cap. Codex round 2: F2, F4-F8 fixed; F1 and F3 still Serious. |
| Scope item K2 | BLOCKED: waiting for the user. |
| Team-leader / implementation / QA / commit / PR | Not started. |

## The two open user questions

### Q1 - Gate 2 at the revise cap (decisions.md row 19)

Open findings (implementation-plan-review.md `## Round 2`):

- F1: after `prepare`, the launch re-reads the active provider only on the undefined-profile branch.
  A switch back during `prepare` can still reach the old provider. Fix: re-read
  `resolveActiveAuthForPath(workspaceId).providerId` after `prepare` on every runtime branch and fail
  before lineage or adapter calls. Test: `prepare` returns a pinned-provider profile while the
  active provider switches back; assert zero `startChatSession`, `resumeSession` and old-session writes.
- F3: the claimed-surface branch (`chat-message-handler.service.ts:837-852`) returns after
  `onSurfaceCreated` and never binds the tab, so pending stays and the notice never appears. Fix:
  handle `claimSessionResolution` results `'skip'` (suppress binding), `'bind'` (attach owning tab,
  call `completeBinding`), `'none'` (today's behaviour). Make the handler edit required, with an
  integration test (tab id, pending release, notice timing, no attach on skip).

Options:
- (A) RECOMMENDED: one bounded architect correction of F1 and F3 only, then a codex re-check scoped
  to F1/F3. If APPROVED, Gate 2 passes.
- (B) The user reads the plan and approves or rejects it directly.
- (C) Accept as is and leave F1/F3 to the code review (not recommended: correctness defects).

### Q2 - Scope item K2 (decisions.md row 17)

A native Codex session never gets the provider-mismatch refusal: the resolver resumes it on Codex
without a provider compare (`workspace-provider-profile-resolver.ts:190-266`, verified by codex).
So the approved Codex -> Claude direction (D9) and the Codex half of AC 3.10 cover a path no user
reaches today.

Options:
- (A) RECOMMENDED: accept K2. Only Claude SDK sessions are eligible; a native Codex session is
  refused before any read, with a test. Saves about 5 files. Reversible later.
- (B) Keep D9 in full: build a bounded native Codex tail read now (codex-runtime, Electron port, router).

## Next steps after the answers

1. Record both answers in `decisions.md` (next row is 20).
2. Q1=A: fresh software-architect fixes F1/F3 in implementation-plan.md (Revision 2); codex lane
   re-checks F1/F3 only (append `## Round 3` to implementation-plan-review.md). Apply the Q2 answer
   to K2 in the same revision.
3. Team-leader Mode 1 -> batches.md (backend and frontend batches, file-disjoint).
4. Before batch 1: visual-reviewer takes Electron "before" screenshots of the re-auth banner (dark + light).
5. Implement batches; scoped `npm run verify -- -p <changed projects>` per batch; final verify adds
   `ptah-electron` and `ptah-extension-webview` (row 18).
6. Codex code-logic review of the phase diff (cross-family) -> code-logic-review.md; one fix round.
7. Visual-reviewer "after" screenshots (dark + light).
8. Commit (foreground, `task-specs` scope for spec files, see `.commitlintrc.json`), push + PR in the
   background (row 6), watch CI and reviews.

## Rules to keep

- AUTH_REQUIRED refusal of `chat:continue` and `/compact` stays byte-identical (row 8).
- Do not edit `libs/frontend/onboarding`, Codex sign-in code, or restore the retired proxy.
- A REVISE past the cap or any user-reserved decision goes to the user, never decided alone (row 16).
- CLAUDE.md: scoped verify only; no build/serve/e2e/package; Electron first; no merge or force push.

## Key files (task folder)

`context.md`, `decisions.md` (rows 1-19), `task-description.md` (+ `-review.md`),
`implementation-plan.md` Revision 1 (+ `-review.md`, rounds 1-2).
