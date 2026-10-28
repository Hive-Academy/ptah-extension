# Live Electron test p8f: native Codex chat with Ptah MCP + user MCP + live thread (head f3ea834f1)

Date: 2026-10-28. User-approved run; test and report only, no product source touched, nothing committed.

- Evidence folder: `C:\Users\abdal\AppData\Local\Temp\ptah-live-p8f-20261028-173047\`
  (`app.log`, `build.log`, `build2.log`, `wasm.log`, `shots\`, `settings.json.bak`, `scan.js`, Playwright scripts, `mark-*.txt` log offsets)
- Single-instance check: only the foreign Playwright e2e electron (`wizard-library-alignment`, own `--user-data-dir`) ran; never touched.
  The launch worked; my root electron.exe (PID 40208) was stopped with `taskkill /T /F /PID 40208`.
- Build: `build-dev`, `copy-wasm.js`, `copy-renderer-dev`: all exit 0 (under `verify.mjs --exec`).
- Launch: `PTAH_CODEX_RUNTIME_DEV=1 PTAH_NO_DEVTOOLS=1`, CDP 9335, fresh DBs, workspace `ws\` (copy of the p8e workspace).
- Setup via UI: Settings > Reassign > OpenAI Codex, GPT-5.6-Luna, "This workspace"; chip set to Manual (`shots\perm-after.png`).
- Paid turns: 9 sent to Codex luna (a, a2, ptah, umcp, b, b2, c, d, e) + `/compact` (one compaction call, counted as the 10th). Limit 10 respected.

## Verdict: PASS for the new features, with one scenario unprovable (user MCP tool call) and 3 defects

| Scenario | Result | Evidence |
| --- | --- | --- |
| a. first turn "Reply with the word OK." | PASS. Reply "OK", tab goes `done`, stats arrive (D8 stays fixed) | `shots\a.png`, log: chat:start success, stats 17426 in / 5 out |
| a2. follow-up in same session | PASS. `session:validate` -> "native Codex session exists", `chat:continue` on the same thread id `01a182f0`, NO new `chat:start`, no MCP `initialize` (live thread kept), 0 interrupt lines, 0 cold resume. Context carried (input 22703 vs 17426). UI went to `done` like turn 1 (turn_state is not logged; judged from UI) | `shots\a2.png` |
| ptah_* call (`ptah_workspace_analyze`) | PASS. `tools/call` -> `[MCP] tool result ... "tool":"ptah_workspace_analyze","callerKind":"session"` isError false; UI shows a normal tool card "Ptah / ptah workspace analyze" under "Worked for 5s / 1 tool", reply DONE | `shots\ptah.png`, `shots\ptah-card.png` |
| user MCP tool call | NOT PROVEN (environment). Only `smithery` is attachable (`codex-user-mcp-attached` x2, serverNames `["smithery"]`). The two OAuth servers (sentry, hyperframes) are skipped: `MCP OAuth override skipped — no valid token`. The smithery host `mcp.smithery.run` no longer resolves (DNS NXDOMAIN, confirmed with Resolve-DnsName); Codex stderr shows `rmcp::transport::worker ... error sending request for url (https://mcp.smithery.run/...)`. The model replied "FAILED: no read-only HubSpot tool ... available" | `shots\umcp.png`, stderrTail in the `Codex process failure` line |
| b. approval, Allow | PASS on retry. Turn 1 of b (plain prompt): Codex ran in a read-only sandbox, failed, never asked for approval (model choice, not a host defect). With "request require_escalated" the host showed the normal PermissionRequest card (Allow / Always / Deny / Deny...) inline plus the Needs-you rail card; after Allow `b.txt` was created, turn finished `done` | `shots\b-prompt.png`, `shots\b2-prompt.png`, `shots\b2-after.png` |
| c. approval, Deny | PASS. Card shown, Deny clicked, `c.txt` not created, turn ended `done` | `shots\c-prompt.png`, `shots\c-after.png` |
| d. Stop during running turn (waiting on approval) | PARTIAL. UI went to `done`, approval card removed, Stop button gone. Backend: `chat:abort`, "aborted by user after 3 events", but also logs `Codex process failure: {"reason":"Codex server request failed","method":"item/commandExecution/requestApproval"}` (the abort kills the app-server process, not a clean turn interrupt). Next send in that same session then failed (see D-1) | `shots\d-before-stop.png`, `shots\d-after-stop.png` |
| `/compact` right after d (same session) | FAIL. `Codex chat is unavailable. Reconnect and try again.` (`CODEX_UNAVAILABLE`), message "Message delivery failed. Codex chat could not start." | `shots\compact.png`, app.log |
| `/compact` in a healthy new session (e) | PASS. Interceptor -> `chat:continue` success -> "Context compacted" banner, session reloads | `shots\compact2.png` |
| e. new session, one send | PASS. `chat:start` success, `codex-user-mcp-attached`, Codex MCP client `initialize`, reply OK, `done` | `shots\e.png` |
| f. normal close | NOT RUN as a graceful close (stopped with taskkill per procedure) | - |

## Required checks

- Legacy marker `[SessionLifecycle] Starting SDK query with options:` count: **0**.
- `codex-user-mcp-attached` present (2 starts, names only: `smithery`). `Ptah MCP is not attached` / `codex-user-mcp-not-attached` / `ptah-mcp-not-attached`: **0**.
- Session-scoped Ptah MCP URL: the literal `/session/{id}/workspace/...` path is not logged anywhere (0 `/session/` hits in app.log and rollouts), so the URL itself could not be read. Evidence that the call reached the session-scoped endpoint: tool result logged with `callerKind":"session"`, and Codex's MCP client `initialize`/`tools/list` hit the CodeExecutionMCP at chat start. The user MCP result: not obtainable (dead host).
- Follow-up turn: no interrupt, no cold resume, same thread id; see a2.
- Approvals in Manual: normal PermissionRequest card (no more dropped payload; p8e D11 fixed).
- Secret leak scan (7 candidate values from `~/.ptah/mcp-installed.json`, `mcp-oauth-installed.json`, `smithery-installed.json`, `settings.json`; `settings.json` holds no MCP headers):
  - Codex rollouts changed since launch: `rollout-...17-36-13-01a182f0...jsonl` 0 hits; `rollout-...17-41-38-01a182f5...jsonl` 0 hits.
  - `app.log`: 21 raw hits, all non-secrets: OAuth `serverKey` fields are the public server ids (e.g. `oauth-mcp.sentry.dev-mcp`, 8 hits), `authMethod` / `authEnvVar` config names (13 hits). Real secret values (Firecrawl API key, smithery key): 0 hits. **Secret leaks: 0.**
- Notes: the `[SdkQueryRunner] Starting internal query` (haiku, Claude CLI) lines are the background memory-curator one-shot, not chat; it is not the legacy marker.

## Defects

- D-1 (new, medium): after Stop on a turn that is waiting for approval, the Codex session is dead and the next send in the same tab fails with `CODEX_UNAVAILABLE` ("Codex chat could not start") instead of reopening/resuming the thread. `chat:abort` closes the app-server process (`Codex process failure ... requestApproval`) rather than sending `turn/interrupt`. Localize: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:566-568` maps adapter code `unavailable` to `CODEX_UNAVAILABLE`; the slash-command path that hit it is `chat-slash-command-router.service.ts:260-330` (`new-query` branch); the abort path is the Codex chat adapter's stop/interrupt (not read in depth). A plain follow-up after d was not tested (turn budget), so whether only `/compact` or every send fails after abort is unconfirmed.
- D-2 (low, cosmetic): a failed command card is headed "Command succeeded" while its body says `"error": "Codex could not complete this operation."` (read-only sandbox denial, text hides the real "access denied"); the Sessions-rail preview also kept the stale text "Now Created `b.txt` successfully." after later turns.
- D-3 (low, diagnosability): the session-scoped Ptah MCP URL and the attach of the Ptah MCP are not logged (no `ptah-mcp-attached` code), so check "reaches `/session/{id}/workspace/...`" cannot be proven from logs; also `codex-user-mcp-attached` is logged for `smithery` even though the server is unreachable (attached means configured, not connected; Codex only reports the failure in stderr at debug level).
- Pre-existing, unchanged: after turn 1 the renderer calls `chat:resume` and gets `Session file not found ... eventCount 0` (history reader does not read native Codex sessions; p8e D9). Not a regression of this change.

## Restore

- `~/.ptah/settings.json` restored from `settings.json.bak`; `cmp` result: **CMP_OK** (identical). `~/.codex/config.toml` never touched.
- Remaining electron processes after stop: only the foreign e2e one.
