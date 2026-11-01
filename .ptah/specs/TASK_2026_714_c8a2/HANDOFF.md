# Session handoff — TASK_2026_714_c8a2 (session 40)

Written 2026-11-02. Replaces the session 39 handoff (committed in 54e98c057).

W = `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a` (branch `feat/codex-removal-a`,
DRAFT PR #881 https://github.com/Hive-Academy/ptah-extension/pull/881, head `da18f9abb`).
T = `W\.ptah\specs\TASK_2026_714_c8a2\`. `W\node_modules` is a JUNCTION to the main checkout's
node_modules: never `npm install` in W; remove it with `cmd /c rmdir W\node_modules` before any
`git worktree remove` (only when the user authorizes). Main checkout `D:\projects\ptah-extension`
stays clean on `main`.

Second task started this session (parallel, user decision U4):
U = `D:\projects\ptah-extension\.claude-worktrees\codex-usage-pricing` (branch
`feat/codex-usage-pricing` from origin/main b84d0e2f6, NO commits, NO PR yet; node_modules junction
created). Task folder `U\.ptah\specs\TASK_2026_codex_usage_pricing\` (untracked).

## Goal

PR #881: Electron-only, Codex main chat and Codex CLI lanes on the native Codex App Server runtime.
Finish D9 (native Codex chat history after reload via `thread/read`) and then Removal A (remove
only the Codex translation proxy and the Codex path through the Claude Agent SDK; other providers
untouched; `@openai/codex-sdk` stays in package.json but Ptah source must not import/resolve it).
Decisions: T\decisions.md (D29-D31).

Usage task (U): make Codex pricing, token accounting, plan usage/limits advanced and predictable on
the native runtime. User decisions in `U\...\decisions.md`: U1 subscription sessions show the
published-rate value labeled "covered by subscription" (shared `pricing.utils.ts` design); U2
API-key sessions show an estimate in the existing cost chip, marked as estimate, "unavailable" when
any used token class has no exact rate; U3 session totals include child threads, pre-compaction
usage and failed/interrupted turns; U4 separate task/PR in parallel with #881.

## Done in session 40 (all pushed to PR #881)

| Commit | Subject | Verify |
| --- | --- | --- |
| 54e98c057 | feat(agent-sdk,codex-runtime): project native Codex history (D9 12c-1) | agent-sdk tc/lint; codex-app-server specs 543/543 |
| aec49bd78 | feat(agent-sdk): route session history to native Codex reader (D9 12c-2) | agent-sdk+rpc-handlers tc/lint; specs pass. CI green |
| 426790bc7 | feat(electron,codex-runtime): bind native Codex history in Electron (D9 12d-1) | tc/lint 14/14 (7 projects); DI/composition specs pass. CI: degradation-audit FAIL (fixed in da18f9abb) |
| da18f9abb | feat(rpc-handlers,agent-sdk): route chat history via native reader (D9 12d-2) | tc/lint 8 projects + webview; history/DI specs pass except known Windows symlink specs; degradation-audit OK |

da18f9abb commit message lists 5 new error codes; the commit actually adds 6 (also
`HISTORY_CANCELLED`). Code is correct; not amended.

Reviews (in-process code-logic-reviewer): T\code-logic-review-D9-12c1.md (final APPROVE 8.5),
-12c2.md (APPROVE 8), -12d1.md (APPROVE 8.5), -12d2.md (APPROVE 8). Release-gate items recorded in
T\plan-d9-history.md (12a/12b M1, M2, M4; sibling-thread cycle; includeBlockOwners ignored on
native route; router failure `cause` not logged; projector user-id format spec).

Research: T\research-codex-usage-pricing.md (copied to U). Usage plan:
`U\.ptah\specs\TASK_2026_codex_usage_pricing\implementation-plan.md` (8 batches).

## CI state of PR #881 (head da18f9abb)

16 checks SUCCESS (incl. `checks` = degradation-audit, typecheck). `test (shard 2/4)` failed once
in `libs/backend/platform-cli` `cli-workspace-watcher.spec.ts` (nestedRepoDetection, real forked
@parcel/watcher) — branch does not touch platform-cli, judged flaky; a rerun of run 41354695251
(`gh run rerun --failed`) was IN_PROGRESS at handoff; `main` depends on it. Check it first.

## Open problems and decisions (waiting on the user)

1. D9 live release-gate check (paid): needs explicit authorization with a turn cap. Proposed: cap 3
   turns; back up ~/.ptah/settings.json; one native Codex chat in Electron incl. one sub-agent;
   reload; confirm history (and older pages) renders like Claude; capture one real `thread/read`;
   restore settings.json and `cmp`. Procedure: Electron live-test procedure (session 24 handoff,
   commit e10bb860a). Asked; no answer yet.
2. Usage plan approval: asked "do you approve the 8-batch plan?" — no answer yet. Do not start U
   implementation before approval.
3. U contains a foreign change `task-tracking/landing-live-demo/HANDOFF.md` (+81/-130) written by
   another session; never commit or revert it; asked the user whose it is.
4. Known local-only failures (ignore): rpc-handlers session-folder/symlink specs (Windows), agent-sdk
   2 plugin-loader specs, auth-providers dependency-checks/EPERM, Jest "worker failed to exit"
   warning in ptah-electron src/di (inherited process kill timer).
5. A Playwright-driven Electron (PID 904, user-data-dir ptah-stagger-udd) was running from another
   session; not ours.

## Key files

- T\plan-d9-history.md — D9 batches, release gate list.
- T\removal-a-codex-inventory.md — Removal A batches A1-A8 (A6-A8 limited by D31).
- W\libs\backend\agent-sdk\src\lib\codex-app-server\codex-history-projector.ts — snapshot -> events.
- W\libs\backend\agent-sdk\src\lib\codex-app-server\session-history-router.ts — native/Claude route.
- W\apps\ptah-electron\src\di\codex-runtime-composition.ts — Electron history port binding.
- W\libs\backend\rpc-handlers\src\lib\chat\session\chat-history-read.service.ts — RPC delegation.
- W\tools\degradation-audit\check-degradation.ts — CI swallow ratchet; valid suppression forms only
  `// degradation-audit: reported — <reason>` or `// degradation-audit: optional-capability — <reason>`.
- U\.ptah\specs\TASK_2026_codex_usage_pricing\implementation-plan.md and decisions.md.

## Background work

None. No lane, subagent, verify or watcher runs. All lanes of this session completed.

## Next steps

1. `gh pr checks 881 --json name,state --jq '.[]|"\(.state) \(.name)"'` — if shard 2/4 failed
   again in platform-cli, inspect; otherwise CI is green for da18f9abb.
2. Commit this HANDOFF.md in W (docs, `git commit -F`, trailer
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`), push in the background.
3. Ask/await the user: D9 live check (turn cap) and usage plan approval.
4. Removal A A2-A5 in W (retire Codex fallback selection, remove proxy consumers, delete
   `providers/codex/codex-translation-proxy.ts` and Codex-only proxy symbols), then A6 per D31.
   Re-run the reference search for proxy symbols before A3-A5. Can start before the live check.
5. After approval: usage batch 1 in U, same loop; open a draft PR after the first verified batch.
6. Update PR #881 body; mark ready only when D9 + Removal A are done and verified.

Verify per batch (background, timeout >= 90 min, never while a lane edits): typecheck,lint first,
tests second, in SEPARATE commands (Jest flags after `--` break lint/typecheck):
`npm run verify -- -t typecheck,lint -p <projects>` then
`npm run verify -- -t test -p <projects> -- --testPathPatterns=<pattern>`. Read rc and "N tasks:";
read the `full log:` paths. For shared-lib changes include every dependent host in typecheck.
Lanes may run `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`.

## Rules (repeat to every lane)

CLAUDE.md applies. Lanes never verify/test/lint/typecheck/build/nx/npm, never commit/push, never
call ptah_get_diagnostics, never npm install; deliverables absolute; LF, no BOM, CR check. Codex
lanes use model `gpt-6-sol` (codex weekly quota reset: 0% until 2026-11-08). claude CLI lane
disabled; Glm/opencode/grok at limit; do not use Kimi. Codex code is reviewed by the in-process
`code-logic-reviewer` subagent. Strict TS incl. noPropertyAccessFromIndexSignature; specs are
type-checked by ts-jest: branded ids via `SessionId.from`, real enum members (PlatformType.CLI),
win32 drive-letter paths, `import 'reflect-metadata'` first when tsyringe libs load, no `as never`;
no `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`, non-null `!`. Native UI contracts
identical to Claude's; fixes in the backend translation layer; no frontend Codex special case;
NEVER strip MCP. Commit in the foreground, push in the background, watch CI with `gh --jq`.
No merge, force push, history rewrite, branch deletion or worktree removal without the user. Paid
live runs need explicit authorization with a turn cap. The user wants light verify load (other
sessions share the 2-slot lock): keep runs scoped, stop leftover verify processes.
