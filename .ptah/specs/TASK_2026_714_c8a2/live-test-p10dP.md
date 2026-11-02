# Live test 10d.P: native Codex CLI lanes in Electron

- Date: 2026-10-31, 20:34 to 20:46 local. Worktree `codex-runtime-integration`, head `168678765`.
- F: `C:\Users\abdal\AppData\Local\Temp\ptah-live-p10dP-20261031-203424\` (`app.log`, `a.json` `b.json` `c.json`
  `c2.json` `d.json`, `shots\`, `sessions\3cd27680-...\agent-output.*.json`, `settings.json.bak`, `settings.after.json`).
- Preflight: no root `electron.exe` without `--type=` was running. This run's root PID was 10168. It was stopped with
  `taskkill /T /F /PID 10168`. The installed Ptah Store app's codex.exe (PID 33808, parent 16236) was left alone.
- UI setup: Settings > Main agent > Reassign > OpenAI Codex > GPT-5.6-Luna > This workspace > Save (`shots/02-saved.png`:
  `Provider: OpenAI Codex`, `Model: gpt-5.6-luna`, `Workspace override`). New session; approval mode changed from
  Full Auto (YOLO) to Manual (`shots/06-manual.png`). The composer showed `Manual · gpt-5.6-luna · Medium`.

## Builds

- `build-dev ptah-electron`: exit 0 (lock 28.9 s), `build.log`.
- `copy-wasm.js dist/apps/ptah-electron`: exit 0, `wasm.log`.
- `copy-renderer-dev ptah-electron`: exit 0 (lock 66.9 s), `build2.log`.
- No other build, test, verify or install was run.

## Model turns used: 9 of 10

Counted by `turn_context` records in the rollouts under `~/.codex/sessions/2026/10/31/`:

- Main chat `rollout-...-01a19341-816c-7b43-8489-1d1acfa08330.jsonl`: 5 turns (A, B, C, C2, D), all `gpt-5.6-luna`,
  `effort medium`, `approval untrusted`, `workspace-write`.
- Lane thread `rollout-...-01a19341-f031-7311-aa9b-2934bca5b5e4.jsonl`: 4 turns (A, B, C2 aborted, D), all
  `gpt-6-sol`, `effort high`, `approval never`, `workspace-write`, `network_access false`.

The C resume attempt failed before any lane turn. I added two steps so the abort and the resume could be observed:
C2 sent the network task with ptah_agent_message and then called stop. D was a fresh resume after the stop.

## Timeline

| Step | Prompt (plain) | Result |
| --- | --- | --- |
| A | spawn one codex lane: write lane-out.txt "lane ok", call ptah_agent_report, deliverable | Main agent's first spawn failed with `role no_roles` (`role: "writer"` was passed and ws has no roles). The retry without a role succeeded: agent `132f9680-...`, cliSessionId `01a19341-f031-...`. The lane wrote `lane ok`. Main agent used `ptah_agent_wait`. Two `Allow ptah_agent_spawn` prompts appeared and were allowed (`shots/a-approval1.png`, `a-approval2.png`). |
| B | ptah_agent_message: append "second" | `[AgentMessageRouter] Message routed: mode queue-next-turn`. Lane turn 2 ran on the same rollout. The file is now `lane ok\r\nsecond`. |
| C | resume lane via resume_session_id, run curl, stop if running | **Failed.** `Resume gate: decision resume`, then `thread/resume` was rejected with RPC -32600. stderr said `thread-store conflict: thread 01a19341-f031-... already has an active writer`. Error: `Codex context could not be opened`. The A/B lane app-server (PID 24548) was still alive after `Agent exited: completed`. Nothing was stopped. |
| C2 | ptah_agent_message to the original lane: run curl; stop if running | Message queued. Lane turn 3 started; `ptah_agent_stop` gave `Agent stopped`. The rollout has `turn_aborted reason interrupted` (2.5 s). Status became `stopped`, exit code 1. The app-server exited (`Codex process exited`). curl never ran. |
| D | resume lane via resume_session_id, run curl, wait | Resume succeeded on the same thread (new agent `334c0813-...`; turn 4 is in the same rollout). curl ran inside the sandbox and failed: `The underlying connection was closed`, exit 1. The lane completed with exit 0, verdict `unverified`. |

## Observations

| # | Observation | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Inspected executable, version, SHA-256, CODEX_HOME | **PASS (partial evidence)** | `Codex process started: binaryPath D:\projects\ptah-extension\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe, pinnedVersion 0.165.0, pinStatus ok` appears 4 times (main plus 3 lane starts). `Adapter resolved: detectedVersion 0.165.0`. The MCP client reported `codex-mcp-client 0.165.0`. The SHA-256 is checked in code (launchGuard `binarySha256`, `pinStatus`), but the hash value and CODEX_HOME are **not logged**. CODEX_HOME is only verified in code (`CodexHomeMismatchError` was not raised). |
| 2 | Native App Server, no SDK markers | **PASS** | `[SessionLifecycle] Starting SDK query with options:` = **0**. `codex-sdk` = 0. Every lane start logs `Codex process started` (App Server). `codex.exe app-server` children of electron 10168 were seen. The log line `[AgentProcessManager] Spawning SDK agent` is a misleading name only. |
| 3 | Same thread across A, B, C | **PASS for A, B, C2, D / FAIL for C** | All 4 lane turns are in rollout `01a19341-f031-7311-aa9b-2934bca5b5e4`. C's resume failed with `already has an active writer` (gap G1). The `<agent-lane-completed>` signal never reached chat (gap G2), so the id came from the spawn result. |
| 4 | Lane frames; one usage segment per turn | **PARTIAL** | Stored segments: `text`, `tool-call` (`commandExecution`, `ptah/ptah_agent_report`), `tool-result`, `tool-result-error`, and `info "Codex turn usage."`. There is exactly one usage segment for each completed turn (A 63090, B 53454, D 57772 tokens). No reasoning segments (the rollout has `reasoning` items). No file-change events (the lane wrote files with PowerShell). The aborted turn C2 is not visible because agent-output for `132f9680` is capped at 200 segments. `lane_outcome_records.input_tokens/output_tokens` are NULL for all 4 records (gap G5). |
| 5 | Approval decline line (D26) | **NOT-OBSERVED** | The lane runs with `approval_policy never`, so Codex never sent an approval request. curl was blocked by the sandbox (`network_access false`) without one. `declin` = 0 in app.log. Codex rejected every lane MCP call itself: `MCP tool call requires approval, but approval policy is never` (gap G3). |
| 6 | Report attributed to parent; deliverable; file content | **FAIL (report) / PASS (deliverable, file)** | The lane's `ptah_agent_report` failed in all 3 turns (above). No `ptah_agent_report` reached the host log, and `lane_outcome_report_receipts` is empty. Deliverable: `ptah_agent_wait` said `Deliverables: ...lane-out.txt: 7 bytes`, and the outcome verdict was `delivered` for A and B. The file is `lane ok` and then `lane ok\r\nsecond` (correct). The main agent wrongly told the user the lane "called ptah_agent_report". Stored `tool-result-error` content is the string `"null"`, so the error text is lost (gap G4). |
| 7 | Abort via ptah_agent_stop; status leaves running; no console window | **PASS (stop) / NOT-VERIFIED (window)** | `Agent stopped`, rollout `turn_aborted interrupted`, `Agent exited: status stopped, exitCode 1`. ptah_agent_status reported `stopped`. Each `codex.exe app-server` has a `conhost.exe` child (PIDs 35368, 15236). I did not see a visible console window during the run, but I took no desktop screenshot, so this is not proven. |
| 8 | Effective config in logs | **PARTIAL** | `Lane policy: model gpt-6-sol, modelSource setting, effort high, effortStep 2, detectedCliVersion 0.165.0, prefixKeys applied`. The lane `turn_context` matches (gpt-6-sol/high). The canary `Lane policy id: ptah-lane-policy-v1` appears **once** in the lane rollout across 4 turns. Ptah MCP is present (29 `mcp__ptah__` refs in the lane rollout). User MCP `smithery` is absent from the lane rollout (0 hits); `codex-user-mcp-configured [smithery]` is logged once for main chat only. The lane model is the CLI-agent setting (gpt-6-sol), not the main-chat model. |
| 9 | Errors, crashes, hangs, not-installed, pin failure | **1 error, no crash** | `[ERROR] Codex context could not be opened` (C, G1). No crash, no hang, no "not installed", no pin failure (`pinStatus ok` x4). `[LaneCompletionNotifier] Completion signal not delivered: reason parent-session-not-active, parentSessionId 3cd27680-...` appeared after every lane end. A stale `Permission: mcp__ptah__elicitation ... needs you` banner stayed after the prompts were allowed (`shots/99-final.png`). |

Score: PASS 2 (1, 2), PARTIAL or mixed 5 (3, 4, 6, 7, 8), NOT-OBSERVED 1 (5), and 9 has one error. Hard FAILs: C resume (3),
report delivery (6).

## Gaps

- **G1 (blocker for resume after a completed lane):** a completed lane keeps its `codex.exe app-server` alive.
  That keeps queue-next-turn messaging working, but the process still holds the thread writer. A
  `resume_session_id` spawn of the same thread then fails with `thread-store conflict ... already has an active writer`.
  The resume gate said `resume`, so the conflict is not caught before spawn. The fix could be to reuse the live lane,
  or to close it before resume.
- **G2:** the lane completion signal is never delivered. `parent-session-not-active` with `parentSessionId` = the tab
  id `3cd27680-...`, while the active Codex session is `01a19341-816c-...`. The parent mapping looks wrong for Codex
  main chat. `parent_session_id` in `lane_outcome_records` is NULL as well.
- **G3 (blocker for reports):** lanes run with `approval_policy never`, and Codex 0.165.0 rejects Ptah MCP tool calls
  that need approval. The Ptah MCP server tools need to be marked as not needing approval (per-server or per-tool
  approval config) for native lanes. Otherwise `ptah_agent_report` (and spawn/message from a lane) can never work.
- **G4:** an MCP tool error is stored as `tool-result-error` with content `"null"`, so the rejection reason is not
  shown in Ptah.
- **G5:** lane outcome token columns are NULL even though usage segments exist.
- **G6:** D26 decline line not exercised: with `never` there are no approval requests, so the decline path cannot be
  hit through lanes in this setup.
- **G7:** no reasoning segments in lane output (the rollout has reasoning items, likely no summary text).
- **G8:** the main agent passed `role: "writer"` in a workspace with no roles, and its first spawn failed (`no_roles`).
  It retried without the role on its own.
- **G9:** a stale "needs you" permission banner stays after the approvals were answered (two prompts appeared for one
  spawn call sequence).
- Logging: the SHA-256 value and CODEX_HOME are not in the logs. `Spawning SDK agent` names the native path wrongly.

## Settings restore

`~/.ptah/settings.json` was backed up to `F\settings.json.bak` before the build. The app changed it (main agent
reassign); that copy is `F\settings.after.json`. After the app stopped, the backup was copied back.
`cmp settings.json.bak ~/.ptah/settings.json` exited **0** (identical). `~/.codex/config.toml` was not touched. No
repository files were changed, except this report.
