# Handoff - TASK_2026_865_2a1d ("Continue with <provider>" carry-over)

Date: 2026-11-03. Worktree: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765`.
Branch: `feat/provider-switch-carryover`. Last commit: `3f6b09096` (task specs and gate reviews).

## Where the task is

| Step | State |
| ---- | ----- |
| Gate 0.1 | Done. Lanes enabled, approval mode lane-review, codex lane is the cross-side reviewer (context.md). |
| Gate 1 (task-description.md) | Passed. Codex rounds 1-2; cap decision row 12; user confirmed rows 10 and 12 (rows 14-15). |
| Gate 2 (implementation-plan.md, Revision 1) | BLOCKED at the revise cap. Codex round 2: F2, F4-F8 fixed; F1 and F3 still Serious. |
| Scope item K2 | ANSWERED: K2 rejected, support both directions, `/compact` as a second trigger if small (decisions.md rows 20-23). |
| Plan Revision 2 | STARTED in the old session (software-architect subagent) at handoff time. It may be finished, partial, or not started. See "Update after the K2 answer" below. |
| Team-leader / implementation / QA / commit / PR | Not started. |

## Update after the K2 answer (supersedes Q2 below)

User's words (via parent, 2026-11-03): "basically, whether i'm on claude or codex, if i switched
then ran compact command i will be able to continue easily and i do these already".

- K2 rejected: support Claude -> Codex AND Codex -> Claude (row 20). Today a native Codex session
  after a switch to Claude is silently resumed on Codex (`workspace-provider-profile-resolver.ts:190-266`);
  the carry-over must make the switch real there too (row 21). A change to native-resume behaviour
  beyond the carry-over trigger is a user-reserved item.
- `/compact` on the old conversation after a switch becomes a second trigger of the same carry-over,
  if small (row 22). The banner button stays. If it adds more than about 4 production files or
  touches the refusal contract, send its size and options to the user before building.
- Plan Revision 2 folds in rows 20-22 and the reviewer's exact F1/F3 fixes (row 23). This does NOT
  pass Gate 2: Q1 (row 19) stays with the user.

How to resume Revision 2:

1. Check `implementation-plan.md` for a `## Revision 2` section and a `## /compact trigger size`
   section, and `git status` for an uncommitted plan edit.
2. If both sections are complete: read them. Send any "needs user decision" or
   `## User-reserved items` entry to the user. Then run the Gate 2 codex review of Revision 2
   (fresh codex lane, self-contained brief; append `## Round 3` to implementation-plan-review.md).
3. If missing or partial: start a fresh software-architect with the Revision 2 brief: rows 16-23 of
   decisions.md, the three changes (both directions with bounded native Codex read; `/compact`
   second trigger with a size section; F1/F3 fixes as stated in implementation-plan-review.md
   Round 2), `## Proposed requirement changes` for any AC wording change (do not edit
   task-description.md), and a `## Revision 2` section mapping each change.
4. After the codex review: Gate 2 is past the cap, so its result goes to the user (Q1), with the
   recommendation to pass it if the review is APPROVED.

## The two user questions - BOTH ANSWERED

- Q1 ANSWERED (row 24): "Fix F1+F3, then build". One bounded architect correction of F1/F3 as the
  reviewer stated; no further codex plan re-check; Gate 2 passes by user decision; the phase
  code-logic review covers F1/F3.
- Q2/K2 ANSWERED (rows 20, 25): rejected; both directions; `/compact` is a second trigger next to the
  banner button. If K2 + /compact add more than about 5 files, report size and options to the parent
  before building that part; build the rest meanwhile.

The original question text is kept below for the record.

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

1. Both answers are recorded (rows 20-25; next row is 26).
2. Finish plan Revision 2 (architect correction). No codex plan re-check (row 24). Check the K2 +
   /compact size against the 5-file threshold (row 25).
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

`context.md`, `decisions.md` (rows 1-23), `task-description.md` (+ `-review.md`),
`implementation-plan.md` Revision 1 (+ `-review.md`, rounds 1-2).
