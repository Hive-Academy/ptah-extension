# Live test 10d.P r4: native Codex CLI lanes in Electron (after fix 10d.L5)

- Date: 2026-11-01 01:24 to 01:52 local. Worktree `codex-runtime-integration`, head `2d1c69dd2`.
- F: `C:\Users\abdal\AppData\Local\Temp\ptah-live-p10dL4-20261101-012450\` (`app.log`, `a.json`, `c1.json`,
  `c2.json`, `mark-*.txt`, `launch-epoch.txt`, `root-pid.txt`, `lane-out.after-a.txt`, `ptah.db`, `sessions.db`,
  `shots\`, `settings.json.bak`, `settings.after.json`, `build.log` `wasm.log` `build2.log` and `*.exit`, helper
  scripts copied from r3, plus `turns.js` (now filtered by this run's `ws` cwd) and the budget guards `guard.js`
  and `guard2.js`).
- Preflight: no `electron.exe` was running. This run's root PID was 5240 (parent 33268, command line
  `electron.exe ...\dist\apps\ptah-electron\main.mjs --remote-debugging-port=9335 .../ws`). It was stopped with
  `taskkill /T /F /PID 5240`. After that `tasklist` showed no `electron.exe`. Three installed Ptah Store
  `codex.exe` processes (parent 16236, `C:\Program Files\WindowsApps\PtahOrchestra.Ptah_2.0.0.0_x64__...`) were
  left alone and were still running.
- The main checkout still has only its 2 earlier untracked paths (`.ptah/specs/TASK_2026_motion_investigation/`,
  a `.mp4` under `apps/ptah-video-studio/promos/`). This run did not change them.
- UI setup: Settings > Main agent > Reassign > OpenAI Codex > GPT-5.6-Luna > This workspace > Use for main agent >
  Save (`shots/02-reassign-before-save.png`, `shots/04-confirm.png`: `Workspace override`, `Provider: OpenAI
  Codex`, `Model: gpt-5.6-luna`, toast "Main agent provider saved. Saved main agent model to This workspace."). New
  session > Create (`shots/06-session.png`). Approval mode changed from Full Auto (YOLO) to Manual with "Disable
  Autopilot" (`shots/07-modemenu.png`, `shots/08-manual.png`: `Manual`, `gpt-5.6-luna`, `Medium`, footer
  `OpenAI Codex`).

## Builds

- `build-dev ptah-electron`: exit 0. It waited 197 s in the verify queue, then held the lock for 93.5 s
  (`build.log`).
- `copy-wasm.js dist/apps/ptah-electron`: exit 0, `wasm.log`.
- `copy-renderer-dev ptah-electron`: exit 0 (queue 10 s, lock 52.0 s), `build2.log`.
- No other build, test, verify or install was run.

## Model turns used: 7 of 8

Counted by `turn_context` records newer than the launch, in rollouts under `~/.codex/sessions/2026/11/01/` whose
`cwd` is this run's `ws` folder (`/10/31/` had no rollout of this run):

- Main chat `rollout-2026-11-01T01-35-45-01a19451-b6cc-7c71-8460-9ee28b144d9a.jsonl`: 5 (A spawn, A report peer
  turn, A completion peer turn, C resume, C message).
- Lane `rollout-2026-11-01T01-36-16-01a19452-311c-7010-ad01-92c0771a35b3.jsonl`: 2 (A, C resumed turn).
- Not counted: `rollout-2026-11-01T01-38-38-01a19454-...jsonl` (cwd `...\.claude-worktrees\streaming-composer`,
  another session).

A budget guard (`guard2.js`) watched the count and would have stopped the app at 8. It never fired. The app was
stopped by hand at 7 turns because the resumed lane was looping inside one turn (see C). The turn count is not the
whole cost: the resumed lane turn alone used 178,864 tokens (`turn_token_usage`) over 12 sleep-and-check model
calls.

## Timeline

| Step | Prompt (plain) | Result |
| --- | --- | --- |
| A | `Spawn one codex lane (no role). Its task: write lane-out.txt containing "lane ok" in the workspace, then call ptah_agent_report. Declare lane-out.txt as a deliverable. Do not wait for it.` | One `mcp__ptah__elicitation` (spawn) approval, allowed (`shots/a-approval1.png`). Two more Manual-mode prompts came from the main chat's own peer turns (1 fileChange, 1 Bash) and were allowed (`shots/a-approval2..3.png`). Spawn on the first try: agent `b7ad308b-5eac-474b-ac2e-bb91e23b6848`, cliSessionId `01a19452-311c-7010-ad01-92c0771a35b3` (app.log 1659). Report delivered (1697). `Agent exited ... completed` (1703). Completion signal delivered (1717). Chat shows `Codex CLI · Report`, a main-agent reply, then `Codex CLI · Completed · Finished in 35s · 1 report · 1/1 files · lane total gpt-6-sol · lane total 53,945 tokens`, then a final main-agent reply (`shots/a-end.png`). In its report peer turn the main agent said the lane "added a trailing period" and rewrote the file (its fileChange approval). After A the file is `lane ok\n` (8 bytes, `lane-out.after-a.txt`). |
| C1 | `Resume that codex lane with resume_session_id 01a19452-311c-7010-ad01-92c0771a35b3. Task: wait for a message from me, then append the text of that message to lane-out.txt and call ptah_agent_report. Do not wait for it.` | One spawn approval, allowed (`shots/c1-approval1.png`). `Resume gate: decision resume, reason within the context and idle limits, contextTokens 13782, idleMs 147968, recordsHeld 1` (1810). New agent `d4ce6a83-6ad1-4193-884b-71faad69f56b` spawning (1811), new lane app-server started (1826), spawn result with the same cliSessionId `01a19452-311c-...` (1834). `Dropped orphaned output key` for the earlier agent (1839). The lane rollout started its second turn at 23:39:27.171Z (UTC). Chat: "Resumed the Codex lane ... It is running and waiting for your message" and a `Codex CLI · running` row (`shots/c1-end.png`). |
| C2 | `Use ptah_agent_message to send the text "third" to that resumed lane.` | One `mcp__ptah__elicitation` approval, allowed (`shots/c2-approval1.png`). `[AgentMessageRouter] Message routed: {agentId d4ce6a83-..., cli codex, mode queue-next-turn, pending 1}` (1870), tool result `isError false` (1871). Tool result text in the main rollout: "**Mode:** queue-next-turn ... Held and delivered as the next full turn, not mid-turn ... The agent is mid-turn and codex cannot be interrupted or steered, so the message is queued at position 1 and will be delivered as a new turn when the current one ends." Chat: "Sent third to the resumed lane. It was queued as the next turn." The lane did not end its turn. From 23:39:30.892Z to 23:50:49.472Z it made 12 `clock.sleep` calls of 60000 ms, each followed by a check of `lane-out.txt` and a note such as "Still waiting for the message to append." or "No message has arrived; I will keep waiting." Its turn never reached `task_complete`, so the queued message was never delivered as a turn. The app was stopped at 23:51:27Z. `lane-out.txt` stayed `lane ok\n`. No report row and no Completed row for the resumed lane (`shots/c-end.png`). |

## Observations

| # | Gap | Result | Evidence |
| --- | --- | --- | --- |
| S | `Lane outcomes start failed` at startup | **FAIL** | app.log 76, 1 line. 10d.L5 now logs the cause: `[WARN] Lane outcomes start failed (non-fatal): {"error":"Cannot inject the dependency at position #1 of \"StructuredDecisionAdapter\" constructor ... #0 of \"InternalQueryService\" ... #6 of \"SdkQueryRunner\" ... \"authProvider\" at position #4 of \"SdkModelService\" ... \"providerModels\" at position #1 of \"AuthManager\" ... \"activeProviderResolver\" at position #3 of \"ProviderModelsService\" ... \"scope\" at position #0 of \"ActiveProviderResolver\" constructor. Reason: Attempted to resolve unregistered dependency token: \"Symbol(WorkspaceScopeResolver)\""`. Stack top: tsyringe `dependency-container.js:330`, then `optional (main.mjs:86314:21)`, `main.mjs:86433:26`, `useFactory (instance-caching-factory.js:7:24)`. So the lane-outcomes start resolves `StructuredDecisionAdapter` before `WorkspaceScopeResolver` is registered. As in r3, `lane_outcome_records` rows were still written. |
| G1 | Resume of a completed lane (writer handoff) | **PASS** | `already has an active writer` = 0, `Codex context could not be opened` = 0. 1810 `Resume gate ... decision resume`. 1826 `Codex process started`. 1834 spawn result with the same cliSessionId. The lane rollout has 2 `turn_context` records on the same thread. `Codex process exited` = 0 in the whole log. |
| G2 | Completion signal delivered to the main chat | **PASS (A only)** | A: 1697 report delivered, 1703 agent exited, 1717 `[LaneCompletionNotifier] Completion signal delivered: {agentId b7ad308b-..., parentSessionId 01a19451-b6cc-..., status completed, verdict delivered, deliverables 1}`. Chat order: Report, then Completed (`shots/a-end.png`). The resumed lane in C never completed, so there is no C evidence. Whole log: `Codex chat turn: busy` = 0, `delivery-failed` = 0, `parent-session-not-active` = 0, `no-parent-recorded` = 0. |
| G3 | Lane `ptah_agent_report` under `approval_policy never` | **PASS (A)** | `approval policy is never` = 0 in app.log. A's report was delivered (1697) to parent `01a19451-b6cc-...`. |
| G4 | MCP errors show real text, not "null" | **NOT-OBSERVED** | No MCP tool error happened (`"isError":true` = 0). |
| G5 | Lane token columns and report receipts in `ptah.db` | **PASS (tokens); receipts empty as designed** | Read-only better-sqlite3 after teardown. `lane_outcome_records`: 1 row, `agent_id b7ad308b-...`, `verdict delivered`, `model gpt-6-sol`, `duration_ms 35095`, **`input_tokens 53511`, `output_tokens 434`** (sum 53,945, equal to the UI lane total), `cost_usd NULL`, `parent_session_id 01a19451-b6cc-7c71-8460-9ee28b144d9a`. The resumed agent `d4ce6a83-...` has no row: it had not ended when the app was stopped. `lane_outcome_report_receipts`: 0 rows (plain `ptah_agent_report`, expected). |
| C | `ptah_agent_message` to a resumed lane after the writer handoff | **FAIL (routed to the new agent, never delivered)** | Resume used the same cliSessionId (1810, 1834). The message went to the new agent `d4ce6a83-...`, not the closed one, with no writer/closed/not-found error (1870, 1871). But the mode was `queue-next-turn`: Codex lanes cannot be steered mid-turn, and the lane carried out "wait for a message" by sleeping inside its open turn (12 x 60 s sleeps over 11 min 18 s). The queued message waits for the turn to end, and the turn waits for the message, so neither happens. `lane-out.txt` never got "third". No report or Completed row for the resumed lane. `Codex chat turn: busy` = 0, `delivery-failed` = 0. |

Other records:

- app.log 855: the only `[ERROR]`, `[renderer] console.error ... [ClaudeRpcService] RPC timeout for method:
  boot:getReadiness` during startup. The app then started normally.
- `[CodexChatApprovalSink] read-only command not accepted` 5 times (1620, 1701, 1722, 1782, 1865).
- `Host routing step failed: {stage scope, code unavailable}` 3 times (1609, 1784, 1864), once per user prompt, each
  after `[lane-routing] system one call failed: {cause timeout ... 3000 ms}`.
- MCP port 51820 was in use (the installed Ptah app), so this run's MCP server used 51821 (670-672).
- `[SessionHistoryReader] Session file not found` once (1681).
- 33 `[event-loop] lag` warnings.
- The session card kept the `needs you` banner after the approvals (as in r2 and r3).

## Gaps

1. Gate S (new evidence): lane-outcomes start fails because `Symbol(WorkspaceScopeResolver)` is not registered when
   `StructuredDecisionAdapter` is resolved (chain `InternalQueryService` > `SdkQueryRunner` > `SdkModelService` >
   `AuthManager` > `ProviderModelsService` > `ActiveProviderResolver`). This looks like a registration-order problem
   in the Electron DI wiring, not a lane problem.
2. Scenario C: a message to a native Codex lane that is mid-turn is only queued for the next turn. A lane told to
   "wait for a message" busy-waits in the same turn (`clock.sleep`), so the message is never delivered and the lane
   spends tokens until it is stopped. Possible fixes: steer or interrupt the Codex turn, show the pending message to
   the lane (for example in a tool result it can poll), or end an idle-looping turn. On the prompt side, a lane can
   only receive a queued message if it ends its turn.
3. Scenario C after delivery (append, report, Completed for a resumed lane after a message) is still unproven,
   because the message was never delivered.
4. G5 receipts: `lane_outcome_report_receipts` stays empty for plain `ptah_agent_report` (by design per the brief).
   `cost_usd` is NULL for the Codex lane.
5. A resumed lane still replaces the earlier agent's stored output (`Dropped orphaned output key`, 1839).
6. The main agent again rewrote `lane-out.txt` in its A report peer turn (model choice, as in r3).
7. Stale `needs you` banner after Allow (cosmetic).

## Settings restore

`~/.ptah/settings.json` was backed up to `F\settings.json.bak` before the build. The app changed it
(`autopilot.enabled true -> false`, workspace `authMethod thirdParty`, `anthropicProviderId openai-codex`,
`provider.thirdParty.openai-codex.selectedModel gpt-5.6-luna`, `provider.openai-codex.mainAgent.modelTier.opus
gpt-6.1-sol`). That copy is `F\settings.after.json`. After the app stopped, the backup was copied back. `cmp
settings.json.bak ~/.ptah/settings.json` exited **0** (identical). `~/.codex/config.toml` was not touched, and MCP
was not changed. No repository files were changed, except this report.
