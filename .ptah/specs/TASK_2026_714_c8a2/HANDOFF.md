# Session handoff — TASK_2026_714_c8a2 (session 10)

Written 2026-10-26. Replaces the session 9 handoff (in git history, commit 08c0e13a8).
At handoff: no subagent, CLI lane or verify run of this task is active. The runtime worktree is
clean. (Three Codex lanes of TASK_2026_701_9e4b belong to another session; do not touch them.)

## Goal

One Codex runtime for Ptah: the Codex App Server, shared by main chat, the messaging gateways and
CLI lanes through ONE core lib (`@ptah-extension/codex-runtime`) and thin adapters. Then DELETE the
two legacy paths: A = Claude Agent SDK + Codex translation proxy (main chat), B =
`@openai/codex-sdk` (CLI lanes). Claude behavior unchanged. Electron first. No runtime-selector
UI. Production stays behind the parity gate until parity is proven.

**User decision:** the runtime PR is NOT merged until the App Server path runs main chat, gateways
and lanes (session handling and subagents working) AND paths A and B are removed. Defects found on
the way go out as SEPARATE small PRs that the user merges first; then `main` is merged into the
runtime branch (no rebase, no force push).

**Principle (user):** use native App Server features wherever they exist; build only where they do
not. Session decisions are rows at the end of `decisions.md` (all session 10 decisions are already
written there: "P6 fix 1..22", "P7 fix 1..11").

## PRs and branches

| PR | Branch / worktree | State |
| --- | --- | --- |
| #824 | `fix/provider-switch-model-sync` / `.claude-worktrees/provider-switch-model-sync` | MERGED. Worktree + branch kept until the user authorizes cleanup. |
| #826 | `fix/host-stored-model-validation` / `.claude-worktrees/host-stored-model-validation` | MERGED into main by the user (merge commit `b72dd7a54`, 2026-10-26 01:52 UTC). Worktree + branch kept until the user authorizes cleanup. |
| #823 | `feat/codex-runtime-integration` / `.claude-worktrees/codex-runtime-integration` | DRAFT, do not merge. Pushed head before this handoff: `44e3cf44b`. Local commits on top: `e8586f4ba` (7e), `787093f0c` (P7 closed), plus this handoff commit — the orchestrator pushes them at the end of session 10 (check with `git log --oneline origin/feat/codex-runtime-integration..HEAD`). origin/main (with #826) is NOT merged into the runtime branch yet. |

CI on #823 at `44e3cf44b`: 18 pass, 3 skipped, 1 fail: `git-real-git (windows-latest)`, test
`GitInfoService change-set delegates (real git) › reads HEAD text by root-relative path from a
subdirectory` (vscode-core; this task does not touch it, probably flaky). One re-run of the failed
job was started (run 40255621381). Earlier flaky e2e: `git/hunk-widget-mouse.spec.ts:85` passed on
re-run.

## Done this session (runtime branch, all verified by team-leader runs)

| Phase | Commits | Notes |
| --- | --- | --- |
| decisions | `61e37c6f6` | session 9 decisions recorded |
| P6 6d/6b/6e | `8aaaa169c`, `027cc1a69`, `b96812e40`, `f660c19bf`, `78e5eebcc` | metadata identity, chat + routing adapters, DI composition |
| P6 fix 6f | `f8dfd61cc`, `47e28da09`, `ecbbc3c64` | first P6 review (logic 4/10, style 6/10) fixed; native `model/list` |
| P6 fix 6g | `c107d55d2`, `ce987b8a6`, `d564aa4ce` | ownership routing (SN1), model slug = `Model.model`, usage = delta of `total` |
| P6 fix 6h | `4b6f6f3a3`, `bf8712418` | N1-N3 cleanup; **P6 CLOSED** (logic re-review 2 APPROVE 7/10, style APPROVE 7/10) |
| P7 7a/7c/7b | `b7f936961`, `d9e9956c3`, `cbbb8a337`, `74d66ede0` | chat runtime profile service, config RPC routing, native start/resume/slash |
| P7 fix 7d | `4a2f15579`, `6a1ed5cbe`, `f57e381f9`, `44e3cf44b` | P7 review (4/10) fixed: B1, B2 (Claude regression), S1, S2, notice rules, di-lint |
| P7 fix 7e | `e8586f4ba`, `787093f0c` | **P7 CLOSED** (re-review APPROVE 7/10); typed `SessionUnavailableError` |

Evidence for model slug and usage semantics was checked at the pinned tag `rust-v0.155.1`
(raw.githubusercontent.com; github.com `blob` URLs return 404): `models.rs` `id: preset.id`,
`model: preset.model`; `protocol.rs` `append_last_usage` adds `last` into `total`;
`non_cached_input = input - cached`.

Last verify (7e, team-leader): rpc-handlers lint/test/typecheck PASS; agent-sdk test + typecheck
PASS, lint FAILS only on the 2 known errors in
`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts:174,183`
(`no-unexpected-multiline`, file identical to origin/main, needs a fix on main); di-lint PASS;
typecheck ptah-electron, ptah-extension-vscode, ptah-cli, ptah-tui PASS.

## Open problems and decisions

- **Merge origin/main (with #826) into the runtime branch — next step 2.** Expected conflicts in
  `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` and
  `chat-slash-command-router.service.ts`, in the `prepare()` / fallback hunks of start, resume and
  slash relaunch, plus ~14 chat-session specs (#826 adds a `resolveStoredModel` mock). Merge rules
  (recorded under Batch 7d in batches.md):
  1. compute `currentModel` after the last await before `prepare()`;
  2. apply `resolveStoredModel(workspacePath, storedModel)` only on the Claude (legacy) branch;
     the native path always maps to a Codex catalog model.
  #826 also changed `libs/backend/auth-providers` (`stored-model-offer.ts`,
  `workspace-provider-profile-resolver.ts`) and `gateway-chat-bridge.ts`.
  Keep main's ~60 unformatted lines in chat-session.service.ts as they are.
- **Network:** github.com git HTTPS failed twice this session (`Failed to connect to github.com
  port 443`); `gh` API calls kept working. Retry a failed push or fetch once.
- **Deferred items (all listed with reasons in batches.md):** live session stats (no exact message
  count or lifetime totals for resumed threads), `review/start` (no Ptah UI), title parameter of
  `updateCodexExecution` (name = sessionId), store workspace-key rules not unified, register.ts
  over the max-lines warning, model list with no open session (8a), VS Code/CLI cache gap (8d/8e),
  accumulator replay spec (frontend import boundary), cancel during `prepare()` (unchanged Claude
  behavior), cache-write tokens inside inputTokens (open question).
- **8a acceptance list (in batches.md under Batch 8a):** host contracts — await
  `initializeSessionRuntimeIdentityLookup(store, logger)`; bind stable instances (registerInstance)
  before the first adapter resolution; register literally (di-lint visible) any token a class
  injects; native controls with `canSendFollowUp` and their own exactly-once persistence; build the
  validated CodexExecutionProfile and do NOT publish the model notice again. Audit: direct
  `SDK_AGENT_ADAPTER` users in chat-session.service.ts, broadcaster cleanup
  `chat-stream-broadcaster.service.ts:351-359`, same session in two tabs, pending-resume thread-id
  cleanup. Also FM-R2 (live effort can differ from the saved effort after a failed save) and FM-R6
  (permission scope drift). M2 check: Electron passes `app.isPackaged` verbatim.
- **Still open from #824 (follow-ups, not fixed):** picker label shows `tab.sessionModel` with no
  override; reassign dialog does not preselect the workspace model; a Codex reassign to "This
  workspace" also writes the global tier map; no host push event for changes from CLI/another window.
- **Process lessons:** a Codex lane's queued `npm run verify` vanishes when the lane exits, so the
  team-leader must run the deciding verify itself. Lanes often stop near ~5-7 min while waiting on
  the FIFO lock; their code is usually complete. Team-leader subagents hit the 400k context limit
  after long phases: start a fresh one per phase with a handoff, tell it to keep context small.
  Declare lane deliverables at spawn. Messages queued to a Codex lane are lost if the lane exits
  first: also send them to the team-leader.

## Key files

- Task folder: `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/`
  (`batches.md` = source of truth incl. Run state "session 11 close" and the Batch 8a acceptance
  list; `decisions.md`; `implementation-plan.md`; review files `code-logic-review-p6.md`,
  `code-style-review-p6.md`, `code-logic-rereview-p6.md`, `code-style-rereview-p6.md`,
  `code-logic-rereview2-p6.md`, `code-logic-review-p7.md`, `code-logic-rereview-p7.md`; batch
  reports `batch-6a..6h-*.md`, `batch-7a..7e-*.md`).
- P6 code: `libs/backend/agent-sdk/src/lib/codex-app-server/` (chat adapter, events, approval sink,
  routing adapter, routers, `session-runtime-identity.ts`), `libs/backend/agent-sdk/src/lib/wiring/`
  (identity cache, metadata port, composition, composition errors, legacy controls composition),
  `libs/backend/agent-sdk/src/lib/di/register.ts`, `di/tokens.ts`, `src/index.ts`,
  `session-metadata-store.ts`; `libs/backend/codex-runtime/src/lib/` (`codex-runtime.ts`,
  `codex-app-server-process.ts`, `codex-event-translator.ts`, `codex-protocol-methods.ts`).
- P7 code: `libs/backend/rpc-handlers/src/lib/chat/session/chat-runtime-profile.service.ts`,
  `chat-session.service.ts`, `chat-slash-command-router.service.ts`,
  `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts`, `config-runtime-controls.ts`.
- Gate: `libs/backend/codex-runtime/src/lib/di/registration.ts`, `codex-parity-gate.ts`,
  `codex-dev-route.ts`.

## Next steps (in order)

1. Runtime worktree: `git status -sb`; `git log --oneline origin/feat/codex-runtime-integration..HEAD`.
   If commits are unpushed, `git push origin feat/codex-runtime-integration` in the background.
   Check CI: `gh pr checks 823` (and the re-run of `git-real-git (windows-latest)`; if it fails
   again on the same test, look at it as a real defect, although it is outside this task).
2. Merge main: `git fetch origin && git merge origin/main` in the runtime worktree (no rebase, no
   force). Resolve the conflicts with the two merge rules above. Then:
   - `npm run verify -- -p @ptah-extension/auth-providers,@ptah-extension/rpc-handlers,@ptah-extension/gateway-chat-bridge,@ptah-extension/agent-sdk`
   - `node scripts/verify.mjs --exec --task di-lint -- npx nx run di-lint:lint`
   - `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`
   Commit the merge in the foreground; push in the background; watch `gh pr checks 823 --watch`.
   Consider a short Claude code-logic review of the conflict resolution (merge commit diff of the
   two chat session files).
3. Start a FRESH team-leader (Mode 2) for P8 with a handoff prompt (absolute paths; keep context
   small; Batch 8a = Electron DI composition and dev-switch wiring with the acceptance list in
   batches.md; then the "Session 7 plan" order). Tell it to STOP before any live Electron run or
   paid model call, and at the P8 phase review.
4. Before any live Electron test: ask the user. Paid runs only `haiku` and Codex luna, tiny
   prompts, <=10 turns. Back up `~/.ptah/settings.json` into a new `%TEMP%` folder and restore it
   byte-identical (`cmp`). Do not edit it without the user's go.
5. P8 phase review (Claude code-logic, plus code-style if new public API), fix rounds, then later
   phases per batches.md (Removal A, Removal B, each after parity proof).

## Verification rules (repeat to every lane)

- `npm run verify -- -p A,B` / `npm run verify -- -t test -p A` (extra Jest flags after a second
  `--`). FIFO lock is machine-wide; `node scripts/verify.mjs --status`. Other heavy commands:
  `node scripts/verify.mjs --exec --task <name> -- <cmd>`. Never workspace-wide, never `nx
  run-many`, never positional `nx test A B`, never build/serve/dev/e2e/package unless for an
  approved Electron live run. A lane's queued verify vanishes when the lane exits.
- Known noise: `translation-proxy.sdk.integration.spec.ts` EPERM on Windows; agent-sdk lint 2 errors
  in `session-query-executor.accounts.spec.ts:174,183` (from main); auth-providers 3 lint errors
  (main's account files); cli-agent-runtime 5-6; core 2 (attention-permission-actions);
  rpc-handlers/chat module-boundary "Static imports of lazy-loaded libraries" warning; di-lint
  `__fixtures__` ERROR lines are its expected self-test output.
- Never run npm ci / npm install in a worktree (node_modules is a junction).
- Lane deliverable paths MUST be absolute and declared at spawn. Lanes do not commit or push.
- No `as unknown as`, `any`, `@ts-ignore` or `eslint-disable` added by this task.
- Commit in the foreground, explicit paths, `.commitlintrc.json` (scope `task-specs` for docs),
  subject <=72, body lines <=100, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Push in the background. No merge of PRs, force push, history rewrite, branch deletion or worktree
  removal. Never commit log files.

## Electron live-test procedure (run from the worktree under test, only with the user's go)

1. `node scripts/verify.mjs --exec --task electron-live-test -- npx nx build-dev ptah-electron`
2. `node scripts/copy-wasm.js dist/apps/ptah-electron`
3. `node scripts/verify.mjs --exec --task electron-live-test -- npx nx copy-renderer-dev ptah-electron`
4. `PTAH_NO_DEVTOOLS=1 PTAH_DB_PATH=… PTAH_SESSIONS_DB_PATH=… node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9335 <ws>`
- Port 9335 only. Drive with Playwright `connectOverCDP`; reusable scripts in
  `%TEMP%/ptah-live-test-3/` (`cdp.js`, `s-reassign2.js`, `s-confirm-save.js`, `s-newsession.js`,
  `s-send.js`, `sdiff.js`). Send marker in the log:
  `[SessionLifecycle] Starting SDK query with options: {"model":...}`. Stop the app with
  `taskkill /T /F` on the root `electron.exe` of the worktree.
