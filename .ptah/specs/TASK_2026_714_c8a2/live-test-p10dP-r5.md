# Live test 10d.P r5: native Codex CLI lanes in Electron (after fix 792491e49)

- Date: 2026-11-01 03:01 to 03:22 local (UTC+2). Worktree `codex-runtime-integration`, head `792491e49`.
- F: `C:\Users\abdal\AppData\Local\Temp\ptah-live-p10dL5-20261101-030143\` (`app.log`, `c.json`, `mark-c.txt`,
  `launch-epoch.txt`, `root-pid.txt`, `ptah.db`, `sessions.db`, `sessions\`, `ws\`, `shots\`, `settings.json.bak`,
  `settings.after.json`, `build.log` `wasm.log` `build2.log` and `*.exit`, helper scripts copied from r4, `turns.js`
  now keyed on F's own folder name, and the budget guard `guard3.js` with `guard3.log`).
- Copied from the r4 folder (not modified there): `ptah.db` (+ `-wal`, `-shm`), `sessions.db` (+ `-wal`, `-shm`),
  `ws\` (`lane-out.txt` = `lane ok\n`), `sessions\`, and the `*.js` scripts.
- Preflight: no `electron.exe` was running. Three installed Ptah Store `codex.exe` processes (parent 16236,
  `C:\Program Files\WindowsApps\PtahOrchestra.Ptah_2.0.0.0_x64__...`) were running and were left alone. This run's
  root PID was 24516 (parent 12104, command line `electron.exe ...\dist\apps\ptah-electron\main.mjs
  --remote-debugging-port=9335 .../ws`). The guard stopped it with `taskkill /T /F /PID 24516`. After that
  `tasklist` showed no `electron.exe`. The only `codex.exe` processes left had parent 16236 (Store app).
- The main checkout `git status --short` shows only `.ptah/specs/TASK_2026_motion_investigation/` (untracked).
  This run did not change it.
- UI setup (0 turns): the r4 workspace override did not apply, because F's `ws` is a new path (the card showed
  `Claude (Subscription)`, `Desktop app override`). Settings > Main agent > Reassign > OpenAI Codex > GPT-5.6-Luna >
  This workspace > Use for main agent > Save (`shots/02-reassign-before-save.png`, `shots/04-confirm.png`). Card
  after save: `Workspace override`, `Provider: OpenAI Codex`, `Model: gpt-5.6-luna` (`shots/05-saved.png`).
- Session: the r4 main chat session was **not** in the list. Sessions panel showed "No sessions yet" and Previous
  sessions showed "No sessions yet" for this workspace (`shots/06-sessions.png`, `shots/06-prev.png`). A new
  session was used (`session-11-01-03-16`, `shots/07-session.png`). The parent is the new main thread
  `01a194af-32cb-7c70-8667-f4d2ba03d5cc`, not the r4 parent `01a19451-...`.
- Approval mode changed from Full Auto (YOLO) to Manual with "Disable Autopilot" (`shots/08-modemenu.png`,
  `shots/09-manual.png`: `Manual`, `gpt-5.6-luna`, `Medium`, footer `OpenAI Codex`).

## Builds

- `build-dev ptah-electron`: exit 0. It waited 269 s in the verify queue, then held the lock for 109.9 s
  (`build.log`).
- `copy-wasm.js dist/apps/ptah-electron`: exit 0, `wasm.log`.
- `copy-renderer-dev ptah-electron`: exit 0 (queue 40 s, lock 47.1 s), `build2.log`.
- No other build, test, verify or install was run.

## Model turns used: 5 turn starts against a cap of 4 (cap exceeded by one turn start)

Counted by `turn_context` records newer than the launch (01:10:34Z), in rollouts under
`~/.codex/sessions/2026/11/01/` whose `cwd` is this run's `ws` folder:

- Main chat `rollout-2026-11-01T03-17-52-01a194af-32cb-7c70-8667-f4d2ba03d5cc.jsonl`: 3
  - 01:17:55.867Z: the C prompt (complete 01:18:41.977Z).
  - 01:19:21.894Z: report peer turn after the lane's `ptah_agent_report` (complete 01:19:24.380Z).
  - 01:19:24.739Z: completion peer turn (`<agent-lane-completed ...>`). Stopped by the guard.
- Lane `rollout-2026-11-01T03-18-19-01a194af-9d16-7d20-a203-e93913f4316b.jsonl`: 2
  - 01:18:26.443Z: lane turn 1, "second" (complete 01:19:24.358Z).
  - 01:19:24.674Z: lane turn 2, the queued message. Stopped by the guard.
- Not counted: two rollouts with cwd `...\.claude-worktrees\surface-session-motion` (other session, 0 turns of this
  run).

The guard (`guard3.js`, 250 ms poll) was set to stop the app when the count reached 4 and no turn was open, or at
once when it went above 4. Turn 4 (lane turn 2) and turn 5 (main completion peer turn) started 65 ms apart, so the
count went from 3 to 5 between two polls. The guard fired at 01:19:25.022Z (`guard3: total 5 open 2 third false ->
kill 24516`). Each of the two stopped turns already had one model response recorded (`token_usage_record` at
01:19:26.894Z main and 01:19:28.446Z lane) before the process tree was gone. So the run used 5 turn starts, one
more than the authorized 4. No prompt was sent after the C prompt.

## Timeline

| Step | Prompt (plain) | Result |
| --- | --- | --- |
| C | `Resume the codex lane with resume_session_id 01a19452-311c-7010-ad01-92c0771a35b3. Its task: append the line "second" to lane-out.txt and finish. Do not wait for it. Right after the spawn returns, call ptah_agent_message once to send this to the new agent: "Also append the line third to lane-out.txt."` | The main agent ran one `exec` script with spawn then message. `ptah_agent_spawn invoked` with `resumeSessionId 01a19452-...` (app.log 1614). `Resume gate: decision fresh, reason idle 5240s exceeds 600s, contextTokens 15128, source rollout, recordsHeld 0` (1626). New agent `d414aeb0-02f4-4427-9a40-99df3d22868b`, **new** cliSessionId `01a194af-9d16-7d20-a203-e93913f4316b` (1641). Tool text: "Resume: NOT resumed — a fresh lane was started with a handoff brief (idle 5240s exceeds 600s) ... This host holds no record of that session". The first `ptah_agent_message` in the same script failed, `isError true` (1670): "invalid ptah_agent_message arguments — agentId: Invalid input: expected string, received undefined" (the script read `spawned?.structuredContent?.agentId ?? spawned?.agentId`, and the spawn result carried neither). The main agent then called it again with the ID: `Message routed: {agentId d414aeb0-..., cli codex, mode queue-next-turn, pending 1}` (1685), `isError false` (1686). Chat: "Resumed lane `d414aeb0-...` and queued ..." with a `Codex CLI · running` row (`shots/c-progress-62s.png`). Lane turn 1 appended `second` and called `ptah_agent_report`: `Report delivered` to parent `01a194af-32cb-...` (1715). Main report peer turn ran (01:19:21.9Z to 01:19:24.4Z). At the end of lane turn 1: `Delivered queued message: {agentId d414aeb0-..., remaining 0}` (1720), then `Completion signal delivered: {status completed, verdict unverified, deliverables 0}` (1726). Lane turn 2 started with the user input "Also append the line third to lane-out.txt." and the lane said "I'll check `lane-out.txt`, append `third` ..." and called `exec`. The completion peer turn started at the same time; the chat showed `Finished in 1m 15s · 1 report · self-reported` and a Bash approval for `Get-Content -LiteralPath .\lane-out.txt` (`shots/c-approval4.png`). The guard then stopped the app (5th turn). Four Manual-mode approvals were allowed in total (`shots/c-approval1..4.png`). End state: `lane-out.txt` = `lane ok\nsecond\n` (15 bytes), no `third`. |

## Observations

| # | Gap | Result | Evidence |
| --- | --- | --- | --- |
| S | `Lane outcomes start failed` at startup and after the workspace opens | **PASS** | 0 lines at 900 lines (20 s after launch), 0 at 1546 lines (workspace open, setup done, before the C prompt), 0 in the whole log (1734 lines). |
| C | Resume, message to the resumed lane, queued delivery, append second then third, Completed after both turns | **FAIL** | (1) Resume was not used: gate decision `fresh` (idle 5240 s > 600 s limit), new cliSessionId `01a194af-9d16-...` (1626, 1641); the old thread `01a19452-...` got no turn. (2) The message reached the new agent with `isError false`, mode `queue-next-turn` (1685, 1686), after a first call failed on an undefined agentId (1670). (3) The queued message was delivered after lane turn 1 (1720) and started lane turn 2 at 01:19:24.674Z: this part works. (4) `third` was never written: lane turn 2 was stopped by the budget guard 0.35 s after it started. (5) The completion signal and the `Finished` row came after lane turn 1, at the same moment the queued turn 2 began (1720, 1726), not after both turns. `Codex chat turn: busy` = 0, `delivery-failed` = 0. |
| G1 | No writer or context error | **PASS (not a resume)** | `already has an active writer` = 0, `Codex context could not be opened` = 0. Because the gate chose `fresh`, the writer handoff was not exercised in this run. |
| G2 | Completion signal delivered to the main chat | **PASS (delivered), timing issue** | 1726 `[LaneCompletionNotifier] Completion signal delivered` to parent `01a194af-32cb-...`. `Codex chat turn: busy` = 0, `delivery-failed` = 0. It fired at the end of lane turn 1 although a queued message had just started lane turn 2 (1720). That started a completion peer turn in parallel with the lane's second turn. |
| G3 | Lane `ptah_agent_report` under `approval_policy never` | **PASS** | `approval policy is never` = 0. Report delivered (1715), tool `isError false` (1716). |
| G5 | Lane token columns in `ptah.db` | **PASS** | Read-only better-sqlite3 after teardown (`db.js`, `{readonly:true}`). New `lane_outcome_records` row: `agent_id d414aeb0-02f4-4427-9a40-99df3d22868b`, `verdict unverified`, `model gpt-6-sol`, `duration_ms 75074`, **`input_tokens 135233`, `output_tokens 896`**, `cost_usd NULL`, `parent_session_id 01a194af-32cb-7c70-8667-f4d2ba03d5cc`, `ended_at` = 01:19:24.458Z (end of lane turn 1). The r4 row (`b7ad308b-...`, 53511/434) is still there. `lane_outcome_report_receipts`: 0 rows. |

Other records:

- `[ERROR]` lines in app.log: 0.
- `"isError":true`: 1 (1670, the undefined agentId call above).
- `[CodexChatApprovalSink] read-only command not accepted ... codex-read-only-not-accepted, reason details-gate`
  appears during the peer turns (info level).
- `[WARN] [lane-routing] system one call failed: {"cause":"timeout", ...}` (Ollama `d3:4b` lookups time out).
- Spawn result: "Limit state: unknown (limit lookup timed out)".

## Gaps

1. Resume refused by the idle limit: the r4 lane thread was idle 5240 s, over the 600 s gate limit, so a fresh
   lane was started. Any repeat of the resume part needs a lane that ended less than 10 minutes earlier, which
   means a spawn turn in the same run.
2. The gate reported `recordsHeld 0` and "This host holds no record of that session", although the copied
   `ptah.db` holds the r4 `lane_outcome_records` row for agent `b7ad308b-...` (thread `01a19452-...`). That row has
   `workspace_root NULL` and `subagent_session_id NULL`. Not investigated here.
3. Completion is signalled per Codex turn, not per lane run: with a queued message, `Completion signal delivered`
   and the `Finished` row arrive at the end of turn 1 while turn 2 starts (1720, 1726). The lane outcome row was
   also written at the end of turn 1. This costs an extra main peer turn and would show the lane as finished while
   it is still working.
4. Scenario C after delivery (third appended, Completed after both turns) is still unproven. Queued delivery after
   a turn ends is now shown (1720 and the lane turn 2 user input).
5. A spawn result read in one `exec` script did not expose `agentId` (neither `structuredContent.agentId` nor
   `agentId`), so the follow-up `ptah_agent_message` failed once. The main agent recovered on the next call.
6. The budget guard counted turn starts at a 250 ms poll and two turns began 65 ms apart, so the cap was exceeded
   by one turn start before the kill. A future guard should stop the app as soon as the count reaches the cap when
   a further turn is expected (for example, a pending queued message plus a completion signal).
7. A lane `ptah_agent_report` adds a main report peer turn; the prompt said only "finish".
8. `cost_usd` is NULL for the Codex lane; `lane_outcome_report_receipts` is empty for plain `ptah_agent_report`.

## Settings restore

`~/.ptah/settings.json` was backed up to `F\settings.json.bak` before the build. The app changed it
(`autopilot.enabled true -> false`, workspace `a0c62d63bb367cb1` `authMethod thirdParty`, `anthropicProviderId
openai-codex`, `provider.thirdParty.openai-codex.selectedModel gpt-5.6-luna`,
`provider.openai-codex.mainAgent.modelTier.opus gpt-6.1-sol`). That copy is `F\settings.after.json`. After the app
stopped, the backup was copied back. `cmp settings.json.bak ~/.ptah/settings.json` exited **0** (identical).
`~/.codex/config.toml` was not touched, and MCP was not changed. No repository files were changed, except this
report.
