# Live test 10d.P r3: native Codex CLI lanes in Electron (after fix 10d.L4)

- Date: 2026-10-31 23:42 to 2026-11-01 00:01 local. Worktree `codex-runtime-integration`, head `16218ed0a`
  (code `c4266a3dc` + docs).
- F: `C:\Users\abdal\AppData\Local\Temp\ptah-live-p10dL3-20261031-234219\` (`app.log`, `a.json`, `b.json`,
  `mark-a.txt`, `mark-b.txt`, `launch-epoch.txt`, `lane-out.after-a.txt`, `ptah.db`, `sessions.db`, `shots\`,
  `settings.json.bak`, `settings.after.json`, `build.log` `wasm.log` `build2.log` and `*.exit`, helper scripts
  `cdp.js` `s-*.js` `turns.js` `db.js`).
- Preflight: no root `electron.exe` without `--type=` was running. Three installed Ptah Store `codex.exe` processes
  were running (parent 16236). This run's root PID was 21180 (parent 12008). It was stopped with
  `taskkill /T /F /PID 21180`. After that `tasklist` showed no `electron.exe`. The Store app's `codex.exe` processes
  (parent 16236) were left alone and were still running.
- The main checkout already had 2 untracked paths (`.ptah/specs/TASK_2026_motion_investigation/`, a `.mp4` under
  `apps/ptah-video-studio/promos/`) before this run. This run did not add to or change them.
- UI setup: Settings > Main agent > Reassign > OpenAI Codex > GPT-5.6-Luna > This workspace > Use for main agent >
  Save (`shots/02-reassign-before-save.png`, `shots/04-confirm.png`; card after save: `Workspace override`,
  `Provider: OpenAI Codex`, `Model: gpt-5.6-luna`). New session > Create (`shots/06-session.png`). Approval mode
  changed from Full Auto (YOLO) to Manual with "Disable Autopilot" (`shots/07-modemenu.png`,
  `shots/08-manual.png`: `Manual · gpt-5.6-luna · Medium`, footer `OpenAI Codex`).

## Builds

- `build-dev ptah-electron`: exit 0. It waited 453 s in the verify queue, then held the lock for 52.4 s
  (`build.log`).
- `copy-wasm.js dist/apps/ptah-electron`: exit 0, `wasm.log`.
- `copy-renderer-dev ptah-electron`: exit 0 (lock 24.0 s), `build2.log`.
- No other build, test, verify or install was run.

## Model turns used: 8 of 8

Counted by `turn_context` records in rollouts under `~/.codex/sessions/2026/10/31/` newer than the launch
(`/11/01/` did not exist):

- Main chat `rollout-2026-10-31T23-55-50-01a193f6-3c5b-7091-98e6-b2ff06bbe3d1.jsonl`: 6 (A spawn, A report peer
  turn, A completion peer turn, B resume, B report peer turn, B completion peer turn).
- Lane `rollout-2026-10-31T23-56-18-01a193f6-a807-77f1-bed7-b343f5fdf741.jsonl`: 2 (A, B).
- Not counted: `rollout-2026-10-31T23-54-10-01a193f4-...jsonl` (1 turn). Its `session_meta` has `cwd`
  `...\.claude-worktrees\surface-session-motion` and `originator codex_sdk_ts`, so another session wrote it, not
  this app.

The budget was reached after B, so no other prompt was sent.

## Timeline

| Step | Prompt (plain) | Result |
| --- | --- | --- |
| A | `Spawn one codex lane (no role). Its task: write lane-out.txt containing "lane ok" in the workspace, then call ptah_agent_report. Declare lane-out.txt as a deliverable. Do not wait for it.` | One `mcp__ptah__elicitation` (spawn) approval, allowed (`shots/a-approval1.png`). Five more Manual-mode prompts came from the main chat's own turns (4 Bash, 1 fileChange) and were allowed (`shots/a-approval2..6.png`). Spawn on the first try: agent `a9cad055-9364-4937-886f-b641518072de`, cliSessionId `01a193f6-a807-77f1-bed7-b343f5fdf741` (app.log 1643). Report delivered (1678). The lane ended while the report peer turn was still running. The completion signal was delivered after that turn ended (1707). Chat shows `Codex CLI · Report`, then `Codex CLI · Completed · Finished in 26s · 1 report · 1/1 files` (`shots/a-end.png`). In its report peer turn the main agent rewrote the file to `lane ok` plus a newline (its fileChange approval). After A the file is `lane ok\n` (8 bytes, `lane-out.after-a.txt`). |
| B | `Resume that codex lane with resume_session_id 01a193f6-a807-77f1-bed7-b343f5fdf741. Task: append "second" to lane-out.txt, then call ptah_agent_report. Do not wait for it.` | One spawn approval, allowed (`shots/b-approval1.png`). `Resume gate: decision resume` (1776). New lane app-server started (1791). New agent `3f559cee-a1d9-40b0-b48d-72855b3a1d4c` on the same cliSessionId (1799). Report delivered (1832). Completion signal delivered (1839) after the report turn ended (1836 stats, 1838 stream end). Chat shows Report, a main-agent reply, Completed (`Finished in 33s`) and a final main-agent reply, in that order (`shots/b-end.png`). File is `lane ok\nsecond` (14 bytes, no trailing newline). |

## Observations

| # | Gap | Result | Evidence |
| --- | --- | --- | --- |
| G1 | Resume of a completed lane (writer handoff) | **PASS** | app.log: `already has an active writer` = 0, `Codex context could not be opened` = 0. 1776 `Resume gate ... decision resume, reason within the context and idle limits, idleMs 157994, recordsHeld 1`. 1791 `Codex process started`. 1799 spawn result with the same `cliSessionId 01a193f6-a807-...`. 1804 `Dropped orphaned output key for re-associated agent a9cad055...`. The lane rollout `01a193f6-a807-...` has 2 `turn_context` records (same thread). No `Codex process exited` / `Codex process failure` line was logged for the earlier lane app-server in this run (r2 logged one at its 1839). |
| G2-A | Completion signal delivered to the main chat (fresh lane) | **PASS** | 1678 report delivered. 1682 `Agent exited ... a9cad055` while the report peer turn ran. That turn's stats come at 1704 (`duration 59273`), then 1706 stream end. 1707 `[LaneCompletionNotifier] Completion signal delivered: {agentId a9cad055..., parentSessionId 01a193f6-3c5b-..., verdict delivered, deliverables 1}`. Main rollout: report turn 21:56:36.375Z to 21:57:35.555Z, lane `task_complete` 21:56:38.244Z (inside the busy turn), completion turn `task_started` 21:57:35.642Z (87 ms after the report turn ended). |
| G2-B | Completion signal for a resumed lane, queued while the chat turn is busy | **PASS** | 1832 `[AgentReportRouter] Report delivered` (agent `3f559cee...`). 1836 report-turn stats (`duration 2839`). 1838 stream end. 1839 `[LaneCompletionNotifier] Completion signal delivered: {agentId 3f559cee..., parentSessionId 01a193f6-3c5b-..., status completed, verdict delivered, deliverables 1}`. 1844 completion-turn stats. Main rollout timestamps: B report peer turn `task_started` 21:59:47.319Z, `task_complete` 21:59:50.039Z. The lane rollout `task_complete` is 21:59:49.584Z, inside that busy turn. The completion turn `task_started` is 21:59:50.215Z, 176 ms after the report turn ended. Whole app.log: `Codex chat turn: busy` = 0, `delivery-failed` = 0, `parent-session-not-active` = 0, `no-parent-recorded` = 0, `[ERROR]` = 0. Chat order for B: Report row, then Completed row (`shots/b-end.png`). The queue itself writes no INFO line. The "queued while busy" claim rests on these timestamps. |
| G3 | Lane `ptah_agent_report` under `approval_policy never` | **PASS** | `approval policy is never` = 0 in app.log and 0 in the lane rollout. 1679 and 1833 `tool result ... ptah_agent_report, callerKind agent, isError false`. 1678 and 1832 `Report delivered` to parent `01a193f6-3c5b-...`. |
| G4 | MCP errors show real text, not "null" | **NOT-OBSERVED** | No MCP tool error happened in this run (`isError":true` = 0 in app.log). |
| G5 | Lane token columns and report receipts in `ptah.db` | **FAIL (still open)** | `lane_outcome_records` (read-only with better-sqlite3): 2 rows, `a9cad055...` (duration 26047 ms) and `3f559cee...` (33345 ms). Both have `verdict delivered`, `model gpt-6-sol`, `parent_session_id 01a193f6-3c5b-7091-98e6-b2ff06bbe3d1`, and NULL `input_tokens` / `output_tokens` / `cost_usd`. `lane_outcome_report_receipts`: 0 rows after 2 delivered reports. The UI shows the lane totals (68,884 and 62,553 tokens). |

Other records:

- app.log 52: `[WARN] Lane outcomes start failed (non-fatal): {"error":{}}`. The error object is empty, yet
  `lane_outcome_records` rows were still written.
- `[CodexChatApprovalSink] read-only command not accepted` appears 7 times (1613, 1681, 1690, 1693, 1696, 1700,
  1753; reasons `details-gate` / `not-command`). As a result, the main chat's read-only checks needed Manual approvals.
- `Host routing step failed: {stage scope, code unavailable}` twice (1584, 1752), once per user prompt.
- MCP port 51820 was in use (the installed Ptah app), so this run's MCP server used 51821.
- `[SessionHistoryReader] Session file not found` for the main session (1661), a one-time warning.
- The main agent again emitted `PTAH-UI` blocks that render as `Not rendered: unknown element` (A and B).
- The `needs you` banner on the session card stayed after the approvals (a.json tail), as in r2.
- 29 `[event-loop] lag` warnings (max about 1.27 s).

## Gaps

1. G5 (still open): `lane_outcome_records.input_tokens/output_tokens` are NULL, and `lane_outcome_report_receipts`
   is empty after 2 delivered reports.
2. `Lane outcomes start failed (non-fatal)` logs an empty `{}` error at startup (app.log 52). The cause is not visible.
3. Peer queueing has no log line. Queue and dequeue of a peer message for a busy native Codex chat are not logged,
   so G2-B is proven by rollout timestamps, not by an explicit log line.
4. The writer handoff still has no explicit log line. This run logged no close of the earlier lane app-server either.
5. A resumed lane still replaces the earlier agent's stored output (`Dropped orphaned output key`, 1804).
6. Stale `needs you` banner after Allow, and the unknown `PTAH-UI` element (cosmetic, as in r2).
7. In A the main agent rewrote `lane-out.txt` (adding a newline) during its report peer turn. So the final
   `lane ok\nsecond` content is not all lane output. The model chose to do this; it is not a runtime issue.
8. Scenario C (ptah_agent_message after the handoff) was not run (budget reached at 8).

## Settings restore

`~/.ptah/settings.json` was backed up to `F\settings.json.bak` before the build. The app changed it (workspace
`authMethod thirdParty`, `anthropicProviderId openai-codex`, `provider.thirdParty.openai-codex.selectedModel
gpt-5.6-luna`, `provider.openai-codex.mainAgent.modelTier.opus`, `autopilot.enabled false`). That copy is
`F\settings.after.json`. After the app stopped, the backup was copied back. `cmp settings.json.bak
~/.ptah/settings.json` exited **0** (identical). `~/.codex/config.toml` was not touched, and MCP was not changed. No
repository files were changed, except this report.
