# HANDOFF — Codex removal (#881) + Codex usage/pricing (#886)

Written 2026-11-02 ~16:10 UTC by the coordinating session (session-handoff).

## Goal and user decisions

- TASK_2026_714_c8a2 — PR #881 https://github.com/Hive-Academy/ptah-extension/pull/881 (DRAFT),
  worktree W = `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a`, branch
  `feat/codex-removal-a`. Remove the Codex translation proxy; Codex runs only through the native
  App Server runtime. Includes D9: native Codex history + sub-agent cards.
- TASK_2026_codex_usage_pricing — PR #886 https://github.com/Hive-Academy/ptah-extension/pull/886
  (DRAFT), worktree U = `D:\projects\ptah-extension\.claude-worktrees\codex-usage-pricing`,
  branch `feat/codex-usage-pricing`. Native Codex usage, pricing, limits. Plan:
  `U\.ptah\specs\TASK_2026_codex_usage_pricing\implementation-plan.md`.
- Latest user instruction (verbatim): "don't do heavy checks locally please lets continue don't
  stop until we get that live tested and pr merged". So: rely on CI, no local test/lint runs
  (a single small-lib typecheck before a push was used once, 15 s). Earlier: user authorized all
  work incl. D9 live check; no force push, history rewrite, branch deletion, worktree removal.
- Merge: user wants the PRs merged. BLOCKER: the `main` ruleset requires an approving review
  (`gh pr view 894` → BLOCKED / REVIEW_REQUIRED). Do NOT use `--admin`; ask the user to approve
  or merge. Merge order: #894 → #881 → rebase/merge-main #886 → #886.
- Rules: delegate implementation to CLI lanes (codex `gpt-6-sol`; Kimi ptahCliId
  `pc-10e5a6b5-b237-4c72-a213-3202bd30d1fe`; Glm ptahCliId `pc-355b645d-35af-4974-84cf-9cf961ea0164`)
  with self-contained prompts; lanes never run verify or git; review each change with an
  in-process `code-logic-reviewer`; commit foreground, push background. Never commit or revert
  `U\task-tracking\landing-live-demo\HANDOFF.md` (foreign). Do not edit tools/mcp-bench. Never
  npm install. Decision D31: keep `@openai/codex-sdk` in root/electron manifests + lockfile.
- Never commit real Codex session captures (private data). A 1.6 MB `thread/list` capture was
  moved to `C:\Users\abdal\AppData\Local\Temp\ptah-d9-fix4\` on purpose.

## Done (all pushed)

W / #881 (head 325816509):
- 0f45b62bb refactor(...): drop proxy Codex code (A5); a51a470ad locate the Codex binary without
  the SDK (A6, agent-sdk package.json now lists `@openai/codex`).
- b0e52cf53 test(rpc-handlers,agent-sdk): align specs with A5 and A6 (CI failures fixed).
- 1a70e28d9 fix(codex-runtime): keep Codex history when thread/list is large (inbound frame cap
  16 MiB / outbound 1 MiB, ancestorThreadId listing with -32602 retry, pages of 25, child
  failures degrade to root). Reviews: code-logic-review-D9-fix4.md, -fix5.md (APPROVE 8).
- 325816509 fix(codex-runtime): log history failures as a JSON string (fixed CI typecheck
  TS2322 at codex-session-history.ts:252; local `codex-runtime` typecheck passed).
U / #886 (head 4b257cc7b):
- ad4a69013 usage 8 (limit cause/display; review r2 APPROVE 8), 2a1411c86 usage 7 (live limit
  push; review r2 + my registration.ts type fix), 4b257cc7b usage 9 rate card (review APPROVE 8).
  CI on 2a1411c86: typecheck pass; only failures were onboarding date test (main bug),
  chat stdout-visibility flake, macOS git-real-git.
PR #894 https://github.com/Hive-Academy/ptah-extension/pull/894 — branch `fix/onboarding-age-clock`
(worktree `.claude-worktrees\onboarding-age-clock`), commit 5d4c0c479 pins Date.now in
`libs/frontend/onboarding/src/lib/home/analysis-found-card.component.spec.ts`. CI ALL GREEN.
Merge blocked only by required review.

## Live test results (W)

- `T\live-test-d9-a51a470ad.md` (3/3 paid turns used, model gpt-5.6-luna): sub-agent PARTIAL,
  history after reload FAIL (thread/list frame > 1 MiB), follow-up after sub-agent PASS, no
  proxy/legacy logs.
- `T\live-test-d9-1a70e28d9.md` (0 paid turns, reopened session 01a19cd2-dc3c-7680-ae77-a7c9363246e9
  from evidence `C:\Users\abdal\AppData\Local\Temp\ptah-live-d9-20261102-170847\` copied to
  `...\ptah-live-d9b-20261102-174330\`): resume succeeds, no frame errors; card shows but WITHOUT
  child output; agent lane "unavailable"; agents panel only Orchestrator → PARTIAL/FAIL.
- Live-test worktree: `D:\projects\ptah-extension\.claude-worktrees\d9-live` (detached at
  1a70e28d9, node_modules junction). Move it to the new head before the next re-check.

## In progress

- Lane cd92cfd2-2cfb-43b1-a13e-9b94e871c7a5 (codex, CLI session 01a19cf4-fece-7eb0-a9ad-ef28fae55060)
  RUNNING in W: D9 fix6 — child output/lane/agents panel after resume. Deliverable
  `T\task-D9-fix6-report.md`. Uncommitted edits so far: `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts`,
  `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`, `subagent-execution.store.ts`,
  `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts`.

## Background work

- Lane above (cd92cfd2…), running.
- CI #881 on 325816509: 2 pass / 14 pending at handoff. CI #886 on 4b257cc7b: 12 pass / 5 pending.
  (The session's gh watchers were stopped; re-check with `gh pr checks 881` / `886`.)

## Open problems / follow-ups

- Merges need a human approving review (ruleset). Tell the user.
- #881 review moderates: inbound frame buffer never shrinks after a large frame; ancestorThreadId
  retry only on -32602; pinned protocol schema lacks ancestorThreadId (experimental).
- #886 moderates: lenient price matcher now prices gpt-* IDs for Copilot/OpenRouter too
  (estimate); gpt-5.6-sol promo price has no expiry after 2026-11-21; 12h cache writes priced at
  30m rate; batch 7 throttle has no trailing refresh, close() uses Promise.all; batch 8 picks
  first exhausted window, stale reset possible, ledger not updated from error cause.
- Older follow-ups: batch 4 provisional turnCost gated only on turnUsageObserved; batch 6
  planType fallback test; A5 dead `not-actable` skip reason (idle-compaction.types.ts:141), no
  dedicated isNativeCodexAuthIntent spec; A6: add `@openai/codex` direct dep when D31 removal
  happens; batch 3 D4, batch 4 R3/R4, batch 5/6 minors.
- Known flaky: electron-e2e hunk-revert-top-layer, chat stdout-visibility spec.
- Untracked scratch in W, do not commit: T\pr881-body-old.md, pr881-body-new.md, ci-watch-67104d6d9.txt.

(T = `W\.ptah\specs\TASK_2026_714_c8a2`)

## Next steps

1. When lane cd92cfd2 completes: read `T\task-D9-fix6-report.md`; in-process code-logic-reviewer
   on the uncommitted W diff; fix findings via the lane; then a quick typecheck of only the
   touched libs before pushing, e.g.
   `npm run verify -- -t typecheck -p @ptah-extension/rpc-handlers,@ptah-extension/chat-streaming,@ptah-extension/chat`
   (skip tests locally per user). Commit (explicit paths + T reports/reviews + live-test-d9-1a70e28d9.md), push in background.
2. Move d9-live to the new head (`git -C .claude-worktrees/d9-live checkout --detach <head>`) and
   spawn a codex lane for a 0-paid-turn live re-check (same procedure as
   `T\live-test-d9-1a70e28d9.md`: copy evidence DBs to a new folder, build-dev under
   `node scripts/verify.mjs --exec --task electron-live-test -- sh node_modules/.bin/nx run ptah-electron:build-dev`,
   CDP 9335, reopen session 01a19cd2…, settings backup/restore + cmp). Goal: card output, lane,
   agents panel all PASS.
3. Watch CI: `gh pr checks 881`, `gh pr checks 886`. Inspect failures with
   `gh run view --job <id> --log-failed | grep -E "error TS|● .* › |Tests: .*failed"`.
4. Update PR #881 and #886 bodies (Summary/Test plan with real CI + live results), mark ready
   (`gh pr ready`), then ask the user to approve/merge #894, #881, then #886 (after merging main
   into U and fixing conflicts in the overlap files: codex-chat-turn-stream.ts, codex-chat-events.ts,
   codex-history-projector.ts, session-history-router.ts).
5. Run `/session-handoff` again when the budget runs low.
