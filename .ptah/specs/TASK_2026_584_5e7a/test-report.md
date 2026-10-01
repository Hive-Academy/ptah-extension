# Test Report - TASK_2026_584_5e7a (Batch 9, real-host smoke)

Worktree `D:\projects\ptah-extension\.claude-worktrees\task-584`, branch `feat/task-584-agent-sessions`, HEAD 891f76583. Date 2026-10-01.

## Scope

- User request: real-host smoke S1-S11 (Electron dev build, then VS Code), prove A1/A3/A4/A5, cover follow-ups F1, F2, F4.
- Result in one line: S11 PASS (with 2 known load-related failures); Electron boot check (F4) PASS; S1-S10 and the VS Code host are BLOCKED on this machine (no model credentials in an isolated host profile; no VS Code host driver). A1/A3/A4/A5 are NOT proven. One probable defect found by reading code (F1).
- Not done: store-to-read traces for metadata `workingDirectory` (B1) and `TabState.agentOrigin` (B7). batches.md assigns them to Mode 3 completion (O12), not to Task 9.1.

## Per-step results

| Step                                              | Result                                | Evidence |
| ------------------------------------------------- | ------------------------------------- | -------- |
| S11 unit/type/lint suites                         | PASS (2 known non-task failures)      | below    |
| Electron boot (F4, part of S1)                    | PASS                                  | below    |
| S1 UI binding, A1                                 | BLOCKED                               | below    |
| S1b late adoption/reload; F1 no-workspace VS Code | BLOCKED (static defect evidence only) | below    |
| S2 - S10                                          | BLOCKED                               | below    |
| VS Code host (every step)                         | BLOCKED                               | below    |
| A1, A3, A4, A5                                    | NOT PROVEN                            | below    |
| F2 default tail vs budget                         | static evidence only, live BLOCKED    | below    |

### S11 - unit/typecheck/lint (PASS)

Command (verbatim, from `D:\projects\ptah-extension\.claude-worktrees\task-584`):

`NX_DAEMON=false NX_ISOLATE_PLUGINS=false npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk,@ptah-extension/platform-core,@ptah-extension/cli-agent-runtime,@ptah-extension/rpc-handlers,@ptah-extension/vscode-lm-tools,@ptah-extension/shared,@ptah-extension/chat-state,@ptah-extension/chat,ptah-cli --parallel=2`

- 57 tasks passed (all 9 typecheck, all 9 lint, 7 of 9 test targets). Run duration 14m40s.
- Failed: `@ptah-extension/platform-core:test` (1 test) and `@ptah-extension/rpc-handlers:test` (1 test).
  - platform-core: "Performance smoke - PtahFileSettingsManager (Gap E) > keeps per-write cost flat across 1000 sequential set() calls". Wall-clock performance test under load. Re-run alone with `npx nx test @ptah-extension/platform-core --skip-nx-cache --testPathPattern=file-settings --maxWorkers=2`: 46 suites, 999 passed, 0 failed. Test defect class (flaky under load), not a product defect; batches.md already lists "one platform-core case" as flaky under load.
  - rpc-handlers: `harness-skill-selection-rpc.service.spec.ts` "never writes state.json" (spec line ~113). Listed in batches.md as failing on the untouched base. Not a task failure.
- Totals for the two suites that failed: platform-core 998 passed/1 failed/4 todo; rpc-handlers 3424 passed/1 failed/4 skipped.
- Verdict: the scoped command is green apart from the one recorded pre-existing failure and one load-flaky case that passes alone.

### Electron dev build boot, F4 and S1 boot portion (PASS)

Setup: `nx build-dev ptah-electron` and `nx copy-renderer-dev ptah-electron` (both exit 0), then `electron.exe dist/apps/ptah-electron/main.mjs <scratch repo> --remote-debugging-port=9333` with `APPDATA` pointed at a scratch dir (the dev build hardcodes userData `%APPDATA%\Ptah Dev`, which the user's own running instance holds, so a scratch APPDATA was the only way to avoid touching it). Scratch git repo contained `.ptah/specs/TASK_SMOKE_1/task.md`. Note: the workspace argument must precede flags (`bootstrap.ts:171-175` takes the first argv entry that is not argv[0]/argv[1]); my first launch put the flag first and booted with the main.mjs path as workspace, so its errors (ENOTDIR, detect-project-type) were my launch error and were discarded. Findings below are from the correct second launch.

- Log (`[CliAgentRuntime] CLI agent runtime services registered`) lists `SESSION_SPAWNER` and `CHILD_CHAT_SESSION_HOST` registered at boot. No log line mentions spawner/child at boot.
- 897 log lines through boot, 50 s idle, then quit: 0 `[ERROR]` lines, no unhandled rejection, no spawner-originated warning. The only WARN-class items were pre-existing ones (event-loop lag, slow handlers, MCP port 51820 held by the user's instance so it fell back to 51821).
- F4 conclusion: no boot-time side effect from the eagerly constructed spawner's subscriptions observed. A 30 s idle window shows nothing emitted by it.
- Graceful quit via CDP `Browser.close`: `gateway-chat-bridge unsubscribed`, `AgentProcessManager disposeAll()`, `PtahCliRegistry disposeAll()` logged, no push logged after shutdown, 0 electron.exe processes left (verified with tasklist). That is the idle-no-child part of the S10 quit check only; the live-child quit is BLOCKED.
- Screenshots: `smoke-b9/electron-boot.png`, `smoke-b9/electron-idle.png` (renderer loaded, workspace `repo` active, Orchestra Canvas empty state).
- Side effect to know: the dev build reconciles harness/user layer into the real home `C:\Users\abdal\.ptah` on boot (UserLayerMirror/harness-sync), which is normal boot behaviour and ran once from my launch. Result was `noop`/`errors:0`.

### S1 - S10 (BLOCKED, Electron)

Reason: every step needs a parent chat session driven by a live model that calls `ptah_session_start` (the children are also live model sessions). RPC `auth:getAuthStatus` on the isolated profile returned `hasApiKey:false, hasOpenRouterKey:false, hasAnyProviderKey:false, copilotAuthenticated:false`. Without credentials no parent or child can run. Options not taken: copying the user's encrypted provider secrets/Dev profile into the scratch profile (copies the user's credentials; not authorised), and launching against the user's real "Ptah Dev" profile (single-instance lock is held by the user's running instance, and it would spend their real quota and write into their real workspaces). Also not done: calling the MCP tool over HTTP with a fabricated caller id, because that skips the parent tab, which is the thing S1 tests (A1).

To unblock: a scratch profile with a provider key (a throwaway key via Settings > Auth) or an explicit user go-ahead to use the Dev profile; then follow implementation-plan.md:1067-1104 as written.

Blocked step list: S1 (3 starts, tabs/badge/banner/focus/sidebar/worktrees/metadata cwd, chat-runtime-unavailable on a real start), S1b (reload; late adoption; sidebar click and tab activation), S2, S3, S4, S5, S6, S7, S8, S9, S10 (compact, parent stopped, held completion, live-child quit).

### VS Code host (BLOCKED, every step)

Reasons: (1) same credential blocker; (2) no way to drive the VS Code UI from this session (no computer-use or VS Code automation; `@vscode/test-electron` is a dependency but no smoke harness exists in the repo, and building one is larger than this batch); (3) a no-workspace VS Code window (S1b / F1) needs GUI control. Not attempted.

### F1 - no active workspace (static evidence; live repro BLOCKED)

`libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts:318-341`: `findTabByIdAcrossWorkspaces` only looks in the active path when `_activeWorkspacePath()` is truthy (`:322-330`) and otherwise iterates `_workspaceTabSets` (`:332-338`). With no workspace the map is empty and the active `_tabs` signal is not consulted unless the caller passes `activeTabs`, so it returns `null` (`:340`). Callers that depend on it without passing `activeTabs`, among others: `streaming-handler.service.ts:161`, `message-finalization.service.ts:130`, `permission-handler.service.ts:457`, `tab-manager.service.ts:949,1369,1535,1596,1724,1763,1880,2222`, `message-sender.service.ts:312,365,731`. The B7 `requireTargetTab` fix (O14) covers only `session-loader.service.ts`. Status: probable defect (MINOR to MAJOR depending on whether a no-workspace VS Code window can host agent tabs at all); needs a live check or a unit case on `TabManagerService` with no active workspace, adoption of a late tab, then streaming/finalisation. Not reproduced here.

### F2 - `ptah_session_read` default tail vs 8,000-char budget (static; live BLOCKED)

`session-spawner.service.ts:108` `SESSION_READ_DEFAULT_TAIL_KIB = 32`; `tool-result-budget.ts:54` `DEFAULT_TOOL_RESULT_BUDGET_CHARS = 8000`. 32 KiB is more than 8,000 characters, so any transcript longer than 8,000 characters is cut; a short transcript (under 8,000 chars) is not. So "always cut" holds for any child that has done real work, not for a trivial one. Live measurement BLOCKED. No change made.

### A1, A3, A4, A5

- A1 (push before first chunk): NOT PROVEN, needs S1.
- A3 (subagents read `<cwd>/.mcp.json`): NOT PROVEN, needs S3. Boot log shows the Electron MCP server started on 51821 and wrote `.mcp.json` registration for the workspace; that does not prove subagents read it.
- A4 (`acceptEdits` only inside cwd): NOT PROVEN, needs S7.
- A5 (transcript by worktree cwd): NOT PROVEN, needs S6.
- Unit-level coverage of the policy, matcher, spawner and read paths passes in S11, but assumptions A1/A3/A4/A5 are about real SDK/host behaviour that the unit suites double.

## Execution

- Commands: the nx command above; `npx nx test @ptah-extension/platform-core --skip-nx-cache --testPathPattern=file-settings --maxWorkers=2`; `nx build-dev ptah-electron`; `nx copy-renderer-dev ptah-electron`; Electron launch as described.
- Not executed: S1-S10 (Electron), all of VS Code. Reasons above.
- Host processes: all electron.exe processes I started were stopped (verified); the scratch dir `D:\b9scratch` was deleted. Build output under `dist/` is untracked/ignored; no production code edited, nothing committed. Files in this folder added by me: `test-report.md`, `smoke-b9/electron-boot.png`, `smoke-b9/electron-idle.png`.

## Verdict

- Proven: S11 green (known exceptions); Electron boots clean with the eager spawner registered and shuts down gracefully (F4 satisfied at boot).
- Not proven: S1-S10 on either host, S1 `chat-runtime-unavailable` on a real start, S1b/F1 live, A1, A3, A4, A5, F2 live measurement, B1/B7 store-to-read traces.
- Risks: F1 probable defect (read of `tab-workspace-partition.service.ts:318-341`) unreproduced; code-logic-review-b9 cannot approve S-steps without live evidence; the smoke needs credentialed hosts and a human or automation for VS Code.
