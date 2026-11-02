# Session handoff — TASK_2026_714_c8a2 + TASK_2026_codex_usage_pricing (session 42)

Written 2026-11-02. Replaces the session 41 handoff (committed in 865cffff0).

W = `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a` (branch `feat/codex-removal-a`,
DRAFT PR #881, pushed head `95f6514e7`). T = `W\.ptah\specs\TASK_2026_714_c8a2\`.
U = `D:\projects\ptah-extension\.claude-worktrees\codex-usage-pricing` (branch
`feat/codex-usage-pricing`, DRAFT PR #886 https://github.com/Hive-Academy/ptah-extension/pull/886,
pushed head `43bc29aa6`). UT = `U\.ptah\specs\TASK_2026_codex_usage_pricing\`.
L = `D:\projects\ptah-extension\.claude-worktrees\codex-d9-live` (DETACHED at 865cffff0, used for
the D9 live check; node_modules junction; keep until the user authorizes removal).
All node_modules are junctions to the main checkout: never `npm install`. Main checkout stays clean.
U has a FOREIGN change `task-tracking/landing-live-demo/HANDOFF.md`: never commit or revert it.

## User decisions

- "I authorize all work, sort this out asap" (2026-11-02): continue all work without asking;
  still no merge / force push / history rewrite / worktree removal without the user.
- D9 live check authorized, cap 3 turns (session 41 used 2/3 on the first run; the re-run after the
  D9 fixes is authorized with its own cap of 3 turns).
- Usage 8-batch plan APPROVED.
- Session 42 ended on user request ("stop after this round, give me a prompt").

## Commits this session

| Repo | Commit | Subject | Verify |
| --- | --- | --- | --- |
| U | 43bc29aa6 | feat(shared): add exact-rate price contract for usage (usage 3) | tc/lint 14/14 (shared, cli-agent-runtime, all 5 hosts); shared tests pricing.utils + session-stats-live pass; review Round 1 APPROVE 8.5 (M1 rounding fixed by coordinator + spec). Pushed. |

## W state (uncommitted, ALL reviews APPROVED)

Reviews: A3 Revision 2 -> T\code-logic-review-A3.md "## Round 2" APPROVE 8.5 (minor follow-ups:
Claude-family provider mismatch now refused = intended behavior change, PR note; skipped model probes
return [] — trace callers; Codex message literal repeated in ptah-cli-registry.ts:588/:816; no fixture
for named-account placeholder). D9 fix 3+4 -> T\code-logic-review-D9-fix3.md "## Round 1" APPROVE 8
(M1: busy window up to 30 s after a fire-and-forget spawn; M2: failed spawn with receiver ids holds
the context until its 30 s timer; D12 formatting partial; live checks listed there). D9 fix 1 Round 1
APPROVE 9.

Coordinator fixes this session (in W, uncommitted): codex-app-server-process.ts warn `issues` ->
`JSON.stringify(error.issues)` (codex-runtime logger takes only flat metadata) + spec lines 372/715;
codex-context.ts logger.error second arg -> `{ reason: ... }` (2 places); codex-chat-events.ts child
mapping (agent_start passed through unchanged, others get the spawn id; fixes TS2322);
skill-synthesis skill-registry-catalog.service.ts `let linked` -> `const` (prefer-const error also on
main; blocks affected lint).

Verify status W:
- typecheck,lint (12 projects, run 3): 23/24 pass; only `auth-providers:lint` @nx/dependency-checks
  persistence-sqlite (known local-only; CI passes).
- tests (codex-runtime, agent-sdk, auth-providers, rpc-handlers, skill-synthesis, cli-agent-runtime):
  failures listed in T\w-test-failures.md. ENVIRONMENTAL (Windows EPERM symlink; ignore): agent-sdk
  PluginLoaderService symlink/alias, rpc-handlers resolveSessionFolder / readSessionPolicyRoots /
  ChatSessionService lineage / plugins:get-config notice. REAL: codex-runtime codex-context.spec
  fixture (Zod: item/started startedAtMs), agent-sdk SdkQueryRunner one-shot auth override,
  agent-sdk projectCodexHistory replay, auth-providers TASK_2026_408 Batch 9 proxy integration S1-S5,
  rpc-handlers chat-session.native + chat-slash-command-router.native (mock lacks
  `resolveActiveAuthWithDefault`). The thread/list warn spec is fixed by the coordinator.
- **W test-fix lane DONE** (agent `1a448267-2f15-40ce-82f6-c884eb154af4`): report
  T\task-W-test-fix-report.md. Spec-only changes: codex-context.spec.ts,
  sdk-query-runner.service.spec.ts, codex-history-projector.spec.ts,
  chat-session.native.spec.ts, chat-slash-command-router.native.spec.ts; auth-providers
  translation-proxy.sdk.integration.spec.ts S1-S5 describe-SKIPPED with an A4-deletion reason
  (A4 deletes that spec). Not yet verified.

## U state

- Batch 4 (native result wiring) uncommitted: codex-chat-adapter.ts, codex-chat-turn-stream.ts,
  codex-chat-turn-lifecycle.spec.ts, codex-session-usage-owner.ts/.spec, session-metadata-store.ts/.spec,
  wiring/codex-chat-metadata-port.ts, di/register.ts + new di/register.codex-runtime.spec.ts,
  apps/ptah-electron codex-runtime-composition.ts, rpc-handlers codex-chat-host-ports.ts,
  codex-chat-native-contract.spec.ts. Report UT\task-batch4-report.md (+ Revision 1). Review
  UT\code-logic-review-batch4.md: REVISE 5.5 -> Round 1 APPROVE 8. Follow-ups: R1 moderate
  publishStats has no once-per-turn guard (double call would double the turn price) — add a guard
  in batch 5 or a small fix; R2 confirm totalCost number|null by typecheck; R3 publishStats in
  `finally` could replace the result error; R4 cross-billing-mode label; R5 Reflect.get in spec.
- Coordinator fix: codex-chat-turn-stream.ts `publishStats`/`observeUsage` were out of scope at the
  detached drain call (TS2304) -> outer `drainUsage` holder.
- **U typecheck,lint PASSED 12/12** after the coordinator fix:
  `npm run verify -- -t typecheck,lint -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`.
  Tests for batch 4 are not run yet (step 6).
- Rate card research DONE: UT\research-codex-rate-card.md (committed in 43bc29aa6). Official OpenAI
  prices for all 7 fallback IDs (gpt-6.1-sol, gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-5.6-sol
  [promotional through at least 2026-11-21], gpt-5.6-terra, gpt-5.6-luna), with URLs. Rules: exact
  IDs only, no alias substitution, unknown tier/retention -> unavailable. Feeds a later rate-card batch.

## Next steps

1. Read T\task-W-test-fix-report.md (lane already finished; no status check needed).
2. W: rerun tests for the projects with real failures:
   `npm run verify -- -t test -p @ptah-extension/codex-runtime,@ptah-extension/agent-sdk,@ptah-extension/auth-providers,@ptah-extension/rpc-handlers -- --coverage=false`
   (accept only the EPERM symlink failures). If the lane changed production code, rerun typecheck,lint
   for the 12 projects (see session 41 command list in git history of this file) and get a short
   in-process code-logic-reviewer check of those changes.
3. Commit W as separate commits (explicit paths, foreground): (a) fix(auth-providers,agent-sdk,cli-agent-runtime,skill-synthesis):
   A2 regression + A3 consumers (auth-providers files, new codex-native-runtime-refusal.ts,
   agent-sdk helpers sdk-model-service / sdk-query-options-builder / sdk-query-runner.service + specs,
   cli-agent-runtime ptah-cli-registry + spec, skill-synthesis lane-resolver + spec);
   (b) fix(codex-runtime,rpc-handlers,shared): D9 request-local protocol rejection
   (codex-protocol-validator, codex-app-server-process, codex-session-history.spec, chat-history-read,
   rpc-error-codes); (c) feat(codex-runtime,agent-sdk): D9 native sub-agent card (codex-context,
   codex-event-translator, codex-runtime.types + specs, agent-sdk codex-app-server/* files);
   (d) style(skill-synthesis): prefer-const in skill-registry-catalog (check .commitlintrc.json types);
   plus task docs in T. Push in background; watch CI (`gh pr checks 881`); recheck electron-e2e
   hunk-revert-top-layer (judged unrelated). Update PR #881 body with follow-ups (R1-1 behavior
   change, HISTORY_FAILED still used for stalledCursor/pageLimit/processFailure, D9 M1/M2, A3 minors).
4. D9 re-run live check (cap 3 turns): build-dev from a clean detached worktree of the new head,
   settings backup/restore + cmp, port 9335, GPT-5.6-Luna, Manual approvals. Confirm history after
   reload/reopen, sub-agent card + agents panel, wait completed, D9 M1 (send right after a
   fire-and-forget spawn), and capture any `thread/list` WARN issue paths -> D9 fix 2 (schema change
   only on a proved path).
5. Removal A A4 (delete codex-translation-proxy.ts + specs + providers/codex/index.ts export +
   session-query-executor Codex accommodation + SDK_CODEX_PROXY/SDK_CURATOR_CODEX_PROXY tokens + Codex
   harness specs CodexLaneProbe/SDK integration spec incl. TASK_2026_408 Batch 9; see
   T\task-A3-report.md A4/A5 list), A5, A6 per D31.
6. U: when the tc/lint rerun passes, run tests
   `npm run verify -- -t test -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers -- --testPathPatterns="codex-chat-turn-lifecycle|codex-chat-native-contract|codex-session-usage-owner|session-metadata-store|register.codex-runtime" --coverage=false`,
   commit batch 4 (`feat(agent-sdk,rpc-handlers,electron): ...` check scopes), push, then batch 5
   (shared cost display; include R1 once-per-turn guard), batches 6-8, then a rate-card batch from the
   research. Rebase U on #881 after it merges (conflicts: codex-chat-turn-stream.ts,
   codex-chat-events.ts, codex-event-translator.ts, codex-runtime.types.ts, codex-context.ts).

## Rules (repeat to every lane)

CLAUDE.md applies. Lanes never verify/test/lint/typecheck/build/nx/npm, never commit/push, never
call ptah_get_diagnostics, never npm install; deliverables absolute; LF, no BOM, CR check. Codex
lanes model `gpt-6-sol` (Glm also showed room in session 42; claude lane disabled; no Kimi). Code
reviewed by in-process `code-logic-reviewer` subagent (revise cap 2 rounds). Strict TS; specs
type-checked by ts-jest. Native UI contracts identical to Claude's; fixes only in backend
translation; no frontend Codex special case; NEVER strip MCP. degradation-audit suppression only
`// degradation-audit: reported — <reason>` / `// degradation-audit: optional-capability — <reason>`.
Never edit a worktree while a verify runs there; never commit/push while a lane edits it. Commit in
the foreground (`git commit -F`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`),
push in the background. Typecheck/lint and tests in SEPARATE verify commands; Jest flags only on
test. No merge, force push, history rewrite, branch deletion or worktree removal without the user.
Codex lane resume with a context > 60k starts fresh: give complete instructions.
