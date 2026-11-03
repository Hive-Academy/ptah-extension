# Handoff - TASK_2026_865_2a1d ("Continue with <provider>" carry-over)

Date: 2026-11-03 (~19:45 UTC). Worktree:
`/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765`,
branch `feat/provider-switch-carryover`. Draft PR: https://github.com/Hive-Academy/PtahCode/pull/914
(remote head `cfd8100ed`, worktree clean, everything pushed).

## Goal

After a provider switch, a conversation from the old provider is refused with AUTH_REQUIRED and
shows a re-auth banner. Add an explicit carry-over: bounded read of the old conversation, tool
I/O / attachments / reasoning removed, known secrets redacted, new chat on the active provider
whose first turn carries that text. Triggers: a "Continue with <provider>" button on the banner,
and `/compact` on the old conversation, both directions (Claude <-> Codex). The old provider is
never called. All user decisions: decisions.md rows 1-55 (read the last rows first).

Key user decisions this session:
- Row 47: fix the pre-existing `prefer-const` lint error on main in its own commit (done).
- **Row 51: heavy local verify is moved to CI.** Per batch only a fast local typecheck
  (`ptah_get_diagnostics`, which kept timing out under load); no local `npm run verify`. Push after
  each batch, fix CI failures with new commits. The PR stays DRAFT until CI is green and the codex
  Phase 1 and Phase 2 reviews pass.

## Done (all pushed)

| Commit | Subject | Verification |
| --- | --- | --- |
| ce4c9e346 | feat(shared): add chat carry-over RPC contract | local verify shared 3/3 |
| 02887892d | fix(agent-sdk): use const for the codex turn stream subscription | local lint pass |
| e08327d13 | feat(agent-sdk): add bounded carry-over transcript read (Batch 2) | local typecheck, test, lint pass |
| ba6527d6a | docs(task-specs): fix fixture (row 41), requirement changes (row 36), before shots | - |
| ff0530284 | feat(agent-sdk,rpc-handlers): carry-over route and transcript renderer (Batch 3) | CI only |
| ef437ab39 | feat(core,chat): banner identity and provider carry-over service (Batch 6) | CI only |
| bedccc8da | feat(rpc-handlers): carry-over launch pin and host service (Batch 4) | CI only |
| a0d5ec0cc | feat(chat): route refusals and /compact to the carry-over (Batch 7) | CI only |
| 511d86bda | fix(rpc-handlers,chat): pass secret scan and degradation audit | local degradation-audit pass (chat 10 <= 11) |
| 33ef24160 | feat(rpc-handlers): register carry-over service and wire its RPCs (Batch 5) | local di-lint pass |
| a81b23022 | feat(chat): add continue with provider button to re-auth banner (Batch 8) | CI only |
| + docs(task-specs) report commits (6fb93898c, 30ec0429e, cfd8100ed) | | |

Phase 1 (Batches 1-8) is fully implemented. batches.md marks 3-8 "COMPLETE (CI pending)".
"Before" screenshots: `screenshots/before/` (4 PNGs, real Electron from main's
`dist/apps/ptah-electron`, mocked `chat:start` AUTH_REQUIRED, themes anubis / anubis-light); the
capture spec is saved as `screenshots/before/_capture.spec.ts.txt` for the "after" run
(visual-review.md).

CI run 1 (head 6fb93898c): typecheck, test shard 2/4, git-real-git, docs-build, webview-e2e PASS;
`checks` FAILED at degradation-audit (fixed in 511d86bda). The run for head cfd8100ed had not
started its main jobs at handoff.

## Open problems and decisions

1. **CI on head cfd8100ed is unverified.** Batches 3-8 never ran tests locally. Expect possible
   failures. Known risks: Batch 3 local run had 1 of 6 Nx tasks fail (unknown which); Batch 6 had 2
   unrelated chat transcript specs fail under load (pass alone); Batch 7 warns
   `chat-message-handler.service.spec.ts` may hit a DI failure because the handler now injects
   `ProviderCarryOverService` (fix: stub provider in that spec).
2. **GitGuardian check fails** on commit ff0530284 ("JSON Web Token" in
   `chat-carry-over-transcript.spec.ts`). It is a fake redaction fixture (`{"alg":"HS256"}` /
   `{"sub":"1234567890"}`), not a credential (row 54). The fixture is fixed in 511d86bda, but the
   old commit stays in history (no force push allowed), so the check may keep failing. The USER must
   resolve the incident as a false positive on the GitGuardian dashboard — tell them; do not rewrite
   history.
3. If a Task 3.3 refusal pin (`chat-session.native.spec.ts`, `chat-slash-command-router.native.spec.ts`)
   fails in CI, that is a plan BLOCKER: report to the user, do not change production refusal code.
4. Items for the codex Phase 1 review (rows 53, 55): A3 readiness probe leaves a warm per-workspace
   proxy; unclaimed-tab rekey runs before the lifecycle claim; P4 fail-closed text appears after the
   dispatcher's "Message delivery failed." prefix; Dismiss / Open Settings clear the banner without a
   generation; F1 (re-read active provider after prepare on every branch) and F3 (claimed-surface
   skip/bind/none) correctness; 2 new public RPC methods need a style review.

## Key files

- Task folder `.ptah/specs/TASK_2026_865_2a1d/`: decisions.md (rows 1-55), batches.md (11 batches),
  implementation-plan.md (Rev 3 + 3.1), task-description.md (Revision 2 = requirement changes),
  batch-{1..8}-report.md (batch-2 report missing; review notes in row 43), visual-review.md.
- Backend: `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`
  (`readCarryOverTranscript`), `.../codex-app-server/session-history-router.ts`,
  `libs/backend/rpc-handlers/src/lib/chat/session/{chat-carry-over.service.ts,chat-carry-over-transcript.ts,chat-session.service.ts}`,
  `.../handlers/chat-rpc.{handlers,schema}.ts`, `.../chat/{di,tokens}.ts`.
- Frontend: `libs/frontend/core/src/lib/services/auth-state.service.ts`,
  `libs/frontend/chat/src/lib/services/{provider-carry-over.service.ts,message-sender.service.ts,chat-message-handler.service.ts,chat-store/chat-lifecycle.service.ts}`,
  `.../components/molecules/notifications/auth-required-banner.component.ts`,
  `.../components/templates/chat-view.component.{ts,html}`.

## Background work

None. No subagents, CLI lanes or child sessions are running. The old CI watcher shell was stopped.

## Next steps (in order)

1. Watch CI for head cfd8100ed: `gh pr checks 914`; find the CI run with
   `gh run list --branch feat/provider-switch-carryover --limit 5`, then a background
   `gh run watch <id> --exit-status --interval 120`. On failure read
   `gh run view --job <id> --log-failed | grep -E "FAIL|●|error" | head`. Fix task-caused failures
   with a non-codex implementer (Claude backend/frontend-developer subagent; kimi code and Ollama
   Code were AT LIMIT), commit in the foreground, push in the background. Degradation audit can be
   checked locally: `node scripts/verify.mjs --exec --task degradation-audit -- npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts | grep -E "FAIL|TOTAL"`.
2. In parallel: codex lane (load the `agent-lanes` skill first; `ptah_agent_spawn` cli codex,
   workingDirectory = worktree, deliverable `<task folder>/code-logic-review.md`) for the Phase 1
   code-logic review on `git diff main...HEAD -- libs` (excluding Phase 2), covering the items in
   Open problem 4, plus a style review of the two new RPC methods. One fix round (Blocking and
   Serious), then one short re-review scoped to the fixes. REVISE past that goes to the user.
3. Phase 2: Batches 9-11 (native Codex tail read; plan Component 11 with the row 41 fixture,
   Components 12-13; P4 = A in Batch 11). Same CI-gated flow. Then a codex code-logic review scoped
   to the Phase 2 commits.
4. Visual-reviewer "after" screenshots in Electron, dark + light (banner without button, with
   button, busy state, notice after button carry-over, notice after /compact carry-over), reusing
   `screenshots/before/_capture.spec.ts.txt`.
5. Update the PR body (Summary, Test plan with real CI results), then `gh pr ready 914` only when CI
   is green and both reviews pass. Report PR URL, head, CI and review state. No merge, no force push.

## Rules to keep

- Do not change the AUTH_REQUIRED refusal contract of `chat:continue` (byte-identical); `/compact`
  refusal unchanged for non-carry-over cases.
- Do not edit `libs/frontend/onboarding` or Codex sign-in code. Retired proxy stays retired.
- Codex is the cross-side reviewer; implementers come from another family.
- Ask the user about any REVISE past the cap and any privacy, security, removal or scope decision.
- Record every decision in decisions.md (row 56 onward). Commit in the foreground only when no agent
  is editing the worktree (lint-staged hides unstaged files). Push in the background.
- The worktree has a git-ignored `node_modules` symlink to the main checkout (needed for jest).
