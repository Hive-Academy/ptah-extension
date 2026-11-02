# Session handoff — TASK_2026_714_c8a2 + TASK_2026_codex_usage_pricing (session 43)

Written 2026-11-02. Replaces the session 42 handoff.

W = `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a` (branch `feat/codex-removal-a`,
DRAFT PR #881 https://github.com/Hive-Academy/ptah-extension/pull/881, pushed head `67104d6d9`).
T = `W\.ptah\specs\TASK_2026_714_c8a2\`.
U = `D:\projects\ptah-extension\.claude-worktrees\codex-usage-pricing` (branch
`feat/codex-usage-pricing`, DRAFT PR #886 https://github.com/Hive-Academy/ptah-extension/pull/886,
pushed head `c45f0b79b`). UT = `U\.ptah\specs\TASK_2026_codex_usage_pricing\`.
L = `D:\projects\ptah-extension\.claude-worktrees\codex-d9-live` (detached, for the D9 live check;
keep until the user authorizes removal).
All node_modules are junctions to the main checkout: never `npm install`. Main checkout stays clean.
U has a FOREIGN change `task-tracking/landing-live-demo/HANDOFF.md`: never commit or revert it.

## Goal and user decisions

- Finish both PRs: Removal A (remove the Codex translation proxy; Codex runs only via the native
  runtime) + D9 native Codex history/sub-agent cards (#881), and native Codex usage/pricing/limits
  in 8 batches + a rate-card batch (#886). User also asked to fix failing CI.
- "I authorize all work, sort this out asap": proceed without asking. Still NO merge, force push,
  history rewrite, branch deletion or worktree removal without the user.
- D9 live check re-run authorized, cap 3 turns.

## Done this session (all pushed)

| PR | Commit | Subject | Verify |
| --- | --- | --- | --- |
| #881 | a9497540e | fix(auth-providers,agent-sdk): refuse retired Codex proxy routes (A3) | tc/lint 23/24 (known local auth-providers dependency-checks); tests pass except Windows EPERM symlink specs; review A3 APPROVE 8.5 |
| #881 | 6fdce7110 | fix(codex-runtime,rpc-handlers,shared): reject bad frames per request (D9 fix 1) | review APPROVE 9 |
| #881 | b8d7c78f4 | feat(codex-runtime,agent-sdk): show native Codex sub-agents as cards (D9 fix 3/4) | review APPROVE 8 |
| #881 | 1d8926e2a | style(skill-synthesis): use const for an unchanged counter | |
| #881 | df293fb9c | docs(docs): task reports | |
| #881 | 67104d6d9 | test(e2e): recheck the canvas after the update-dialog probe | fixes CI hunk-revert-top-layer race (diagnosis T\e2e-hunk-revert-diagnosis.md) |
| #886 | 423d840a2 | feat(agent-sdk,rpc-handlers,electron): price native Codex turns (usage 4) | tc/lint 12/12, focused tests pass, review APPROVE 8 |
| #886 | c45f0b79b | feat(chat-ui,chat,agent-sdk): label final cost basis (usage 5) | tc/lint 16/16, focused tests pass, review Round 2 APPROVE 8.5 |

PR #881 body updated (follow-ups listed). **PR #881 CI on 67104d6d9: GREEN** (18 pass, 4 skipped;
one flaky chat-streaming perf test passed on rerun). No code reviews (draft; CodeRabbit skips drafts).

**PR #886 CI on c45f0b79b: 5 FAIL** — causes found and fixed LOCALLY (not committed, see U state):
`checks` = degradation-audit orphaned markers in codex-chat-adapter.ts:315/:603; `test (shard 4/4)`
= codex-chat-adapter.spec.ts "opens through the DS1 gate..." expects no stats for a turn without
usage; `electron-e2e` = same hunk-revert helper race fixed on #881 (cherry-pick 67104d6d9 to U);
`main` = aggregate. LESSON: run FULL test targets of changed projects, not only focused patterns.

## In progress (uncommitted)

### W: Removal A step A4 (reviewed APPROVE 8, NOT yet verified)
Deleted: auth-providers providers/codex/codex-translation-proxy.ts + .spec.ts,
codex-stream-parity.spec.ts, translation/translation-proxy.sdk.integration.spec.ts. Edited:
session-query-executor.service.ts/.spec.ts (Codex case removed from resolveCapacityRoute),
auth-providers-tokens tokens.ts (SDK_CODEX_PROXY, SDK_CURATOR_CODEX_PROXY removed),
auth-providers src/index.ts, providers/codex/index.ts, translation-proxy-base.spec.ts.
Lane report T\task-A4-report.md (includes A5/A6 remainder); review T\code-logic-review-A4.md
(M1: dead `codexProxy` idle lane in idle-session.reducer.ts / idle-fire-gate.ts -> A5).
Coordinator REVERTED the lane's tools/mcp-bench edits (historical benchmark data; keep unchanged).
Untracked scratch to NOT commit: T\pr881-body-old.md, T\pr881-body-new.md, T\ci-watch-67104d6d9.txt.

### U: batch 6 + two CI fixes (batch 6 review Round 2 APPROVE 8, NOT yet verified after revision)
- Batch 6 (Codex quota DTO, sanitized ordered buckets): codex-runtime codex-account-usage.types.ts,
  codex-account-usage-client.ts/.spec.ts, auth-providers quota/readers/codex-plan-usage.reader.ts
  /.spec.ts, shared plan-limit.types.ts. Report UT\task-batch6-report.md (+ Revision 1).
  Review UT\code-logic-review-batch6.md. Pre-revision verify: typecheck pass, focused tests pass,
  only auth-providers:lint known local dependency-checks error.
- OPEN residual R1 (batch 6 review Round 2): if `rateLimitsByLimitId.codex` exists but is
  malformed/empty it is filtered out and the default `rateLimits` is not prepended because the
  check uses the raw key. Fix: test whether an EMITTED `codex` bucket exists. Not done yet.
- CI fix 1 (coordinator): codex-chat-adapter.ts — removed the two orphaned degradation-audit
  markers (plain comments now).
- CI fix 2 (coordinator): codex-chat-turn-stream.ts publishStats — after the checkpoint persist,
  `if (!usageReported && !turnUsageObserved) return;` so a turn without usage publishes no stats
  (no invented zeros); restores pre-batch-4 behavior expected by codex-chat-adapter.spec.ts.

## Background work at handoff

- No CLI lanes running. No subagents running.
- Two verify processes from the old session may still hold/queue lock slots (their output is
  lost; results unknown): U full tests (pid 42648) and W A4 tc/lint (pid 41680, queued; its
  follow-up test command will not run). Check `node scripts/verify.mjs --status`; dead or
  >120 min slots are taken over automatically. Rerun both verifies below.

## Next steps

1. U: fix batch 6 residual R1 (see above) in codex-plan-usage.reader.ts or the client mapper + spec.
2. U verify (separate commands; do not edit U while it runs):
   `npm run verify -- -t typecheck,lint -p @ptah-extension/codex-runtime,@ptah-extension/auth-providers,@ptah-extension/shared,@ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode,ptah-extension-webview,ptah-cli,ptah-tui`
   (accept only auth-providers:lint @nx/dependency-checks persistence-sqlite),
   `node scripts/verify.mjs --exec --task degradation-audit -- node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`
   (no new codex-* findings), and FULL tests
   `npm run verify -- -t test -p @ptah-extension/agent-sdk,@ptah-extension/codex-runtime,@ptah-extension/auth-providers,@ptah-extension/shared,@ptah-extension/chat-ui,@ptah-extension/chat -- --coverage=false`
   (accept only Windows EPERM symlink specs).
3. U commit (foreground, explicit paths, never the foreign HANDOFF): (a) `fix(agent-sdk): publish
   Codex stats only with usage and drop orphaned markers`; (b) `feat(codex-runtime,auth-providers,
   shared): map Codex quota buckets (usage 6)` + UT batch 6 docs. Then `git cherry-pick 67104d6d9`
   (e2e helper fix; note only the show-canvas.ts hunk applies, the .ptah doc is W-only — if the
   cherry-pick brings T\e2e-hunk-revert-diagnosis.md into U that is acceptable, or use
   `git checkout 67104d6d9 -- apps/ptah-electron-e2e/src/support/show-canvas.ts` and commit as
   `test(e2e): recheck the canvas after the update-dialog probe`). Push in background, watch
   `gh pr checks 886`.
4. W verify A4: `npm run verify -- -t typecheck,lint -p @ptah-extension/auth-providers-tokens,@ptah-extension/auth-providers,@ptah-extension/agent-sdk,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`
   then `npm run verify -- -t test -p @ptah-extension/auth-providers,@ptah-extension/agent-sdk,ptah-electron -- --coverage=false`.
   Also run di-lint is done by pre-push. Commit `refactor(auth-providers,agent-sdk): delete the
   Codex translation proxy (A4)` + T\task-A4-report.md + T\code-logic-review-A4.md + this
   HANDOFF. Push, watch `gh pr checks 881`, update PR body (A4 checked).
5. W: A5 (T\task-A4-report.md "A5/A6 remainder": ICodexOwnerKeySource, codex-proxy-policy.ts +
   spec, placeholder/proxy cases, quota owner resolver, Windows-hide guard spec, shared
   `codexProxy` compaction state, review A4 M1 dead idle lane), then A6
   (codex-native-binary-path.ts stops resolving @openai/codex-sdk; keep the package in manifests
   per D31). Lane -> verify -> in-process code-logic-reviewer -> commit -> push.
6. W: D9 live check (cap 3 turns) after A4/A5 land: clean detached worktree of the new head,
   build-dev, settings backup/restore + cmp, port 9335, GPT-5.6-Luna, Manual approvals; confirm
   history after reload, sub-agent card + agents panel, wait completed, D9 M1; capture any
   `thread/list` WARN issue paths.
7. U: batches 7, 8 and the rate-card batch (UT\implementation-plan.md section 3 table,
   UT\research-codex-rate-card.md). Open follow-ups: batch 4 R3/R4, batch 3 D4 isOptional,
   batch 5 minors (terminal-only publish invariant comment; key tooltip on SessionCostBasis),
   batch 6 minors (`Limit abc123` labels; reset-credits/upsell presence-only), plan usage service
   drops owner-level fields. Rebase U on main after #881 merges (user merges).

## Rules (repeat to every lane)

CLAUDE.md applies. Lanes never verify/test/lint/typecheck/build/nx/npm, never commit/push/stash/
checkout/reset/git rm, never call ptah_get_diagnostics, never npm install; deliverables absolute;
LF, no BOM. Codex lanes `cli: codex`, model `gpt-6-sol` (Glm also had room). Code reviewed by an
in-process `code-logic-reviewer` subagent (revise cap 2 rounds). Strict TS; specs type-checked by
ts-jest. Native UI contracts identical to Claude's; no frontend Codex special case; NEVER strip MCP.
degradation-audit suppression only `// degradation-audit: reported — <reason>` /
`// degradation-audit: optional-capability — <reason>`, and only on a flagged catch. Never edit a
worktree while a verify runs there; never commit/push while a lane edits it. Commit in the
FOREGROUND (`git commit -F`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`),
push in the background. Typecheck/lint and tests in SEPARATE verify commands; Jest flags only on
test. Do not edit tools/mcp-bench data. Codex lane resume with context > 60k starts fresh: give
complete instructions.
