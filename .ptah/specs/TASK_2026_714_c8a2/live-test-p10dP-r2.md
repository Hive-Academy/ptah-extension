# Live test 10d.P r2: native Codex CLI lanes in Electron (after 10d.L fixes)

- Date: 2026-10-31, 21:57 to 22:10 local. Worktree `codex-runtime-integration`, head `0feebb6ab`.
- F: `C:\Users\abdal\AppData\Local\Temp\ptah-live-p10dL-20261031-215714\` (`app.log`, `a.json` `a2.json` `a3.json`
  `b.json` `b2.json`, `pid30144.txt`, `shots\`, `sessions\01a1938d-...\agent-output.498d54e4-....json`,
  `settings.json.bak`, `settings.after.json`, `build.log` `wasm.log` `build2.log`).
- Preflight: no root `electron.exe` without `--type=` was running. This run's root PID was 10824. It was stopped with
  `taskkill /T /F /PID 10824`. The installed Ptah Store app's codex.exe (PID 42904, parent 16236) was left alone and
  was still running afterwards.
- UI setup: Settings > Main agent > Reassign > OpenAI Codex > GPT-5.6-Luna > This workspace > Use for main agent >
  Save (`shots/04-confirm.png`: `Provider: OpenAI Codex`, `Model: gpt-5.6-luna`, `Workspace override`, toast "Saved
  main agent model to This workspace"). New session (`shots/06-session.png`); approval mode changed from Full Auto
  (YOLO) to Manual with "Disable Autopilot" (`shots/08-manual.png`: `Manual · gpt-5.6-luna · Medium`).

## Builds

- `build-dev ptah-electron`: exit 0 (lock 60.4 s), `build.log`.
- `copy-wasm.js dist/apps/ptah-electron`: exit 0, `wasm.log`.
- `copy-renderer-dev ptah-electron`: exit 0 (lock 23.3 s), `build2.log`.
- No other build, test, verify or install was run.

## Model turns used: 7 of 10

Counted by `turn_context` records in the rollouts under `~/.codex/sessions/2026/10/31/` newer than the launch
(nothing under `/11/01`):

- Main chat `rollout-...-01a1938d-b0c7-7521-a84d-b2dbd1760892.jsonl`: 5 (A spawn, A report peer turn, A completion
  peer turn, B resume, B report peer turn).
- Lane `rollout-...-01a1938e-23cc-7830-b9e1-a2645d310087.jsonl`: 2 (A, B).

Scenario C was skipped for budget: it needs at least 3 more turns (main + lane + the report peer turn), and a delivered
completion signal would add a fourth, which would exceed 10.

## Timeline

| Step | Prompt (plain) | Result |
| --- | --- | --- |
| A | `Spawn one codex lane (no role). Its task: write lane-out.txt containing "lane ok" in the workspace, then call ptah_agent_report. Declare lane-out.txt as a deliverable. Do not wait for it.` | One `Allow ptah_agent_spawn` prompt, allowed (`shots/a-approval1.png`). Spawn on the first try, no role error. Agent `efd0d77f-bee7-4922-86ec-fefc421b54bd`, cliSessionId/thread `01a1938e-23cc-7830-b9e1-a2645d310087` (app.log 1678). Lane wrote `lane ok` (7 bytes) and its `ptah_agent_report` succeeded (1713-1714). The report reached chat as a peer row; then `<agent-lane-completed>` was delivered (1722) and rendered as a `Codex CLI · Completed` peer row (`shots/a-peer-row2.png`). The completion turn ran a read-only PowerShell check that needed a Manual-mode Bash approval (allowed, `shots/a-verify-approval1.png`). |
| B | `Resume that codex lane with resume_session_id 01a1938e-23cc-7830-b9e1-a2645d310087. Task: append "second" to lane-out.txt. Do not wait for it.` | One spawn approval, allowed. `Resume gate: decision resume` (1836). The idle A lane app-server (PID 30144) exited at 22:06:37.86, 17 s after the prompt was sent (`pid30144.txt`; app.log 1839 `Codex process exited`), then a new app-server started (1842). New agent `498d54e4-9544-43ac-bd18-c616dc5ed62f` on the same cliSessionId (1850); turn 2 is in the same rollout. Report delivered (1867). **Completion signal not delivered** (1869, `delivery-failed`, `Codex chat turn: busy`). File is now `lane oksecond` (13 bytes, no newline). |
| C | not run | Skipped for budget (see above). |

## Observations

| # | Gap | Result | Evidence |
| --- | --- | --- | --- |
| G1 | Resume of a completed lane (writer handoff) | **PASS** | app.log: `already has an active writer` = 0, `Codex context could not be opened` = 0. 1836 `Resume gate ... decision resume, recordsHeld 1`; 1839 `[DEBUG] Codex process failure: {"reason":"Codex process exited", ...}` (the prior idle context closing); 1842 `Codex process started`; 1850 spawn result with the same `cliSessionId 01a1938e-...`. Process check: lane app-server PID 30144 (created 22:02:04, parent 10824) exited at 22:06:37.86 when the resume started. The lane rollout `01a1938e-...` has 2 `turn_context` records (same thread). File holds both strings (`lane ok` + `second`). The "completion delivered again" part fails, see G2. |
| G2 | `<agent-lane-completed>` delivered to the main chat as a peer message | **PASS for A / FAIL for B** | A: 1722 `[LaneCompletionNotifier] Completion signal delivered: {agentId efd0d77f..., parentSessionId 01a1938d-..., verdict delivered, deliverables 1}`; the chat shows a `Codex CLI · Completed · Finished in 23s · 1 report · 1/1 files` peer row, followed by a main-agent turn (`shots/a-peer-row2.png`). `parent-session-not-active` = 0, `no-parent-recorded` = 0. B: 1869 `[WARN] [LaneCompletionNotifier] Completion signal not delivered: {"reason":"delivery-failed", agentId 498d54e4..., parentSessionId 01a1938d-..., "detail":"Codex chat turn: busy"}`. The lane's report (1867) had just started a main-chat peer turn; the completion signal arrived while that turn ran and was dropped, not queued. No `Completed` row for B (`shots/b-peer-rows.png`). |
| G3 | Lane `ptah_agent_report` under `approval_policy never` | **PASS** | `approval policy is never` = 0 in app.log and 0 in the lane rollout. 1714 `tool result ... ptah_agent_report, callerKind agent, isError false`; 1713 / 1867 `[AgentReportRouter] Report delivered` (parent `01a1938d-...`) for A and B. Both reports appear in chat as `Codex CLI · Report` peer rows. |
| G4 | MCP errors show real text, not "null" | **NOT-OBSERVED** | No MCP tool error happened in this run. The stored agent output for the session has no `tool-result-error` segment. |

Other records:

- `lane_outcome_records` (F\ptah.db, read-only with better-sqlite3): 2 rows, `efd0d77f...` and `498d54e4...`, both
  `verdict delivered`, `parent_session_id 01a1938d-b0c7-7521-a84d-b2dbd1760892` (resolved session id, not a tab id).
  `input_tokens` / `output_tokens` are NULL in both (G5 still open). `lane_outcome_report_receipts` has 0 rows even
  though 2 reports were delivered.
- Agent output: only `agent-output.498d54e4-....json` exists; app.log `Dropped orphaned output key for re-associated
  agent efd0d77f...` shows the A output was replaced when B re-used the CLI session. Segments: text 86, tool-call 2,
  tool-result 2, info 2 (one `Codex turn usage.` with 60219 in / 481 out / 60700 total). No reasoning (`thinking`)
  segments, while the lane rollout has 4 `reasoning` items.
- UI: the lanes panel shows `Codex CLI · gpt-6-sol · 60.7k`; the orchestrator Tokens and Cost cells stay `—`.
- Stale banner: after the A spawn approval, the top banner `Permission: mcp__ptah__elicitation in ws. Needs your
  attention.` and the session card `needs you` stayed after Allow (a.json tail, `shots/a-peer-row.png`). The card
  cleared by the end of B (`shots/b-peer-rows.png`).
- The main agent rendered its summaries as a `PTAH-UI` block with raw JSON: `Not rendered: unknown element
  {"id":"lane-task",...}` (A, twice).
- `[CodexChatApprovalSink] read-only command not accepted` (reason `details-gate` / `not-command`) appears 3 times; the
  main-chat read-only PowerShell check still needed a Manual approval.
- Native App Server only: `Starting SDK query with options` = 0; `pinStatus ok` x3 (main + 2 lane starts).

## Gaps

1. **G2-B (new, blocking for the proof):** the completion signal is dropped when the parent Codex chat is busy
   (`delivery-failed`, `Codex chat turn: busy`, app.log 1869). The lane's own `ptah_agent_report` starts a peer turn in
   the main chat, so a lane that reports and then ends hits this race. A worked only because its report turn ended
   (1.8 s) before the lane exited. The signal should be queued for the next turn or retried.
2. G5 (still open): `lane_outcome_records.input_tokens/output_tokens` are NULL although the lane usage segment has
   the numbers. `lane_outcome_report_receipts` is empty after 2 delivered reports.
3. Reasoning segments are not stored for Codex lanes (rollout has `reasoning` items).
4. A resumed lane replaces the earlier agent's stored output (`Dropped orphaned output key`), so A's usage segment
   and frames are no longer visible.
5. The prior lane app-server close during the writer handoff is logged as `[DEBUG] Codex process failure` with the
   old stderr tail; there is no explicit writer-handoff log line.
6. Stale `needs you` / elicitation banner after Allow (cosmetic, persisted until a later turn).
7. Main agent emits an unknown `PTAH-UI` element (cosmetic, model output).
8. File content is `lane oksecond` without a line break. This is the lane's (model's) choice for the plain "append"
   task, not a runtime issue; recorded so "both lines" is not overstated.
9. Scenario C (ptah_agent_message after the handoff) was not run (budget).

## Settings restore

`~/.ptah/settings.json` was backed up to `F\settings.json.bak` before the build. The app changed it (workspace main
agent `openai-codex` / `gpt-5.6-luna`, `provider.openai-codex.mainAgent.modelTier.opus`, `autopilot.enabled false`,
top-level `authMethod`); that copy is `F\settings.after.json`. After the app stopped, the backup was copied back.
`cmp settings.json.bak ~/.ptah/settings.json` exited **0** (identical). `~/.codex/config.toml` was not touched. No
repository files were changed, except this report.
