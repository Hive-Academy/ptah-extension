# Live Electron test p8i: Codex App Server runtime after Round 8o (head 552010a4e)

Date: 2026-10-29. The user approved this paid run. Test and report only: no tracked file was edited, staged or
committed. Only the git-ignored `dist/` in the worktree was written.

- Evidence folder F: `C:\Users\abdal\AppData\Local\Temp\ptah-live-p8i-20261029-033517\`
  (`app-run1.log`, `app-run2.log`, `app.log` = both joined, `build.log`, `wasm.log`, `build2.log`, `shots\`,
  `settings.json.bak`, `settings.after.json`, `mark-*.txt` log line offsets (`mark-t*` = run 1 in `app-run1.log`,
  `mark-r*` = run 2 in `app-run2.log`), Playwright scripts (`cdp.js` on port 9336, `s-*.js`), `scan.js`, `readmeta.js`,
  `dbrows.js`, `p8h-copy\` (read-only copy of the p8h `sessions.db`), `ws\` (workspace))
- Single-instance check: there was no default-profile Ptah Dev root electron. Two foreign root electrons with their own
  `--user-data-dir` were present: PID 9872 (Playwright e2e, `wizard-library-alignment`) and PID 14852
  (`lane-chat-order`, `D:/scratch/lane-order-profile/userData`). PID 14852 **held CDP port 9335**, so the coordinator
  approved port **9336** (it was free). I did not touch either process. 14852 exited on its own during run 1 (it was not
  in my kill tree). Before each connect I checked that 9336 was owned by my root PID (run 1: 16860, run 2: 35576; command
  line = this worktree's `dist/apps/ptah-electron/main.mjs ... F/ws`) and that the CDP page URL was this worktree's
  `dist/.../renderer/index.html`. I stopped my roots with `taskkill /T /F`.
- Built head: 552010a4e. After the runs the worktree head was `ea14437bc` (a docs commit by another agent), and
  the worktree was clean.
- Build: `build-dev` (under `verify.mjs --exec`, after about 12 minutes in the lock queue), `copy-wasm.js` and
  `copy-renderer-dev` (under `verify.mjs --exec`) all exited 0.
- Launch: `PTAH_CODEX_RUNTIME_DEV=1 PTAH_NO_DEVTOOLS=1`, CDP 9336, new DBs in F, workspace `F\ws` (a copy of the p8h
  `ws` with the model-made `g6dir`, `g6.txt` and `notes.md` removed). Run 2 reused the same DBs and workspace after a
  full stop.
- Setup through the UI: Settings > Reassign > OpenAI Codex · OAuth, model **GPT-6-Sol (`gpt-6-sol`)**, Save to "This
  workspace", "Use for main agent", Save. Card: `PROVIDER: OpenAI Codex MODEL: gpt-6-sol Effort: medium` (the card also
  showed "Desktop app override" and "Workspace override" badges). The new session's chip read `Full Auto (YOLO)`. I
  clicked "Disable Autopilot" and it read `Approval mode: Manual`. Manual carried over into run 2.
- Paid turns: **run 1: 8** (t1–t7 + `/compact`). **Run 2: 2** (r1, r2). Total 10. Every turn used `gpt-6-sol`.

## Verdict: E (question card), B/C (listing and title after restart), H, D21 and 8m-8 PASS. A (reads in Manual) still FAILS because the allowlist does not recognise the Codex wrapper. GAP-F, gap D and G6 remain. There is one NEW gap: the first follow-up after a restart shows a false "Codex is busy" error

| Item | Result | Evidence |
| --- | --- | --- |
| Codex process start line | PASS. Run 1: `{"binaryPath":"D:\\projects\\ptah-extension\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe","pinnedVersion":"0.165.0","pinStatus":"ok","startupDurationMs":17648}`. Run 2 (first resume): same binary, `pinStatus":"ok"`, `startupDurationMs":16553`. | app-run1.log:1593; app-run2.log:1040 |
| H: no `[CodexAccountUsage] … stage initialize` at startup | PASS. 0 `CodexAccountUsage` lines in either run. The composer PLAN meter showed `24%` / `25% Weekly · resets in 6d 5h`. Side note: the right-hand session panel shows "PLAN LIMITS Usage Unavailable" in the Codex chat while the composer meter works (only `[PlanUsage] OpenCode local usage unavailable` is logged). | `grep -c`; `shots\chat1`/`r0-start` text |
| A: plain reads auto-accept in Manual (D20 allowlist) | **GAP (not fixed in practice).** Every read still showed a card. t1 "What does README.md say?" showed **2** cards (`Get-Content -LiteralPath README.md`, then `Get-Item … ; Get-Content … -Raw; Get-ChildItem -Force …`). t2 "Show me the contents of missing.txt." showed 1 (`if (Test-Path …) { Get-Content … } else { Write-Output … }`). t7 `Get-Content missing.txt` showed 1. r2 "List the files in this folder." showed 1 (`Get-ChildItem -Force \| Select-Object Name, Mode`). **5 read cards in 4 read turns** (p8h: 5 in 4). `accepted read-only command` was logged **0** times. **Wrapper Codex sends** (rollout `command` array): `["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe","-Command","Get-Content -LiteralPath README.md"]`; the card shows `"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command 'Get-Content -LiteralPath README.md'`. So it is the **full-path `powershell.exe -Command '…'` wrapper with no `-NoProfile`**: not bare `Get-Content` and not `bash -lc`. Even the plain single-cmdlet bodies (t1 #1, t7) prompted. | `shots\t1-approval1/2.png`, `t2-approval1`, `t7-approval1`, `r2-approval1`; rollout `rollout-2026-10-29T04-01-57-01a1852d-….jsonl` |
| A: a write still shows the card before the action | PASS. "Create a folder named g6dir here." showed the card at +6.5 s (`New-Item -ItemType Directory -Path g6dir -Force \| Select-Object -ExpandProperty FullName`). `g6dir` did not exist while the card was pending. Allow created it, with no second prompt, and the turn ended `done` ("Created g6dir."). | `shots\t3-approval1.png`, `shots\t3b.png`, `ls ws` before/after |
| G6 fileChange path (plain prompt, 1 try) | GAP (same as p8h). "Create notes2.md containing hi." was a PowerShell command card: `Set-Content -LiteralPath notes2.md -Value 'hi'; Get-Content -LiteralPath notes2.md -Raw`. No `fileChange`/apply_patch. The file did not exist while the card was pending, and after Allow it contains `hi`. | `shots\t4-approval1.png`, `shots\t4b.png` |
| E: question uses the AskUserQuestion card | **PASS.** "Before you answer, ask me whether I prefer red or blue." showed the "Input needed" card at +3.2 s: "Which color do you prefer: red or blue?" with Red / Blue / Other and "No timeout". It was still there after 3 s (not cancelled). I chose Blue and clicked Submit. The turn continued and replied "Got it—you prefer blue." The reply was not duplicated and no markdown question appeared. Log: `canUseTool invoked: AskUserQuestion` → `AskUserQuestion request sent to webview` → `AskUserQuestion answered: {"answerCount":1}`. 0 `Chat error`/`CHAT_ERROR` in either log. | `shots\t5-card.png`, `t5-card3s.png`, `t5.png`; app-run1.log after mark-t5 (lines 1753–1762) |
| D21: no `rg --files ~/.codex/skills` lookups | PASS. 0 skill-lookup commands in all 10 turns (cards, log and rollout). In p8h this caused 3 of the 5 read prompts. | `grep -c` on both logs and the rollout |
| G4 header / GAP-F (note only) | Unchanged. t7 card header **"Command succeeded"**, body `Get-Content missing.txt failed with exit code 1: … Cannot find path '…\ws\missing.txt' because it does not exist.` | `shots\t7-card.png` |
| 8m-8: tool-call-only turn | PASS. "Create an empty file named empty.txt. Do not write any text reply." showed 1 card. After Allow the turn rendered "Worked for 11s · 1 tool" with no reply text and the rail/agent status went to `done`. `empty.txt` was created. (The prompt asked for no text. That tests the rendering, not the model.) | `shots\t6.png` |
| D9 / gap D: transcript after `/compact` | GAP (known). `/compact` was intercepted (`new-query`), `chat:continue success`, "1 compaction" was shown. Then `[ChatStore] Failed to reload session after compaction: … chat:resume failed for 01a1852d-…: No events found` and the tab showed the empty "Orchestrator ready" hero. | app-run1.log after mark-t8; `shots\t8-compact.png` |
| D9 / gap D: transcript after the restart | GAP (known). Run 2 restored the tab under its real title, but the body was the empty "Orchestrator ready" hero. Selecting the row in Previous sessions did not load any history. | `shots\r0-start.png`, `r0-open.png` |
| B: run-1 session listed after the restart | **PASS.** Previous sessions listed **"What does README.md say? · 7m ago · 14 msgs"**, and the rail showed the same row. The stored row has `workspace_key` `c:\Users\abdal\AppData\Local\Temp\ptah-live-p8i-…\ws` (only the drive letter is lowercased; p8h lowercased the whole path). | `shots\r0-prev.png`; `node dbrows.js sessions.db` |
| C: real title, not a placeholder | **PASS.** `name` = `What does README.md say?` (p8h: the session id). The rail and Previous sessions show the same title. | as above |
| Resume after the restart (thread made on this head) | PASS for delivery, **NEW GAP for the UI** (see GAP-I). `session:validate - native Codex session exists` → `chat:continue` resumed thread `01a1852d-…` → new app-server process → reply "OK" (in the rollout the prompt appears only once). The UI also showed a red "Message delivery failed. Codex is busy, try again when the current operation finishes" above the reply, logged `chat:continue failed (CODEX_BUSY)` and a renderer `console.error`. No "Start a new chat", as expected for a thread made after 5695d519d. The next turn (r2) on the live thread had no error. | `shots\r1.png`; app-run2.log after mark-r1 |
| Old-thread resume (D14a + prompt fingerprint) | **NOT REACHABLE.** (1) Run 2 had to reuse the run-1 DBs for B/C, and a third run is not allowed. (2) In the p8h DB (a read-only copy in `F\p8h-copy`), all 4 Codex rows have fully lowercased `workspace_key` (`c:\users\abdal\appdata\local\temp\ptah-live-p8h-…\ws`) and `name` = session id, so they predate 8c9ebb682 and, with no migration, stay hidden from `session:list`. No old thread could be opened from the UI. 0 paid turns used. | `node dbrows.js p8h-copy/sessions.db` |
| GAP-3 sonarqube scope | Unchanged. `~/.claude.json`: user-scope `mcpServers` = none. `sonarqube` is **project-scoped** under `projects["D:/projects/ptah-extension"]` (with `sentry`). Codex chat received `codex-user-mcp-configured` → `serverNames: ["smithery"]` (http), plus `ptah-mcp-attached` (Ptah MCP, path `/session/<tabId>/workspace/…ws`). No sonarqube. Nothing was edited and no values were copied. | app-run1.log:1574–1575 |
| Legacy marker `[SessionLifecycle] Starting SDK query with options:` | PASS: 0 in run 1, 0 in run 2 | `grep -c` |
| Secret scan | PASS: 0 leaks. 7 candidate values checked from the `~/.ptah` MCP/settings files: `app.log` has 24 raw hits, all non-secret (OAuth `serverKey` ids 4, `authMethod` names 15, `authEnvVar` name 5). Pattern scan (Bearer/Basic, `sk-`, JWT, `fc-`, `squ_`): **0** in `app.log`. My rollout (`…01a1852d…`): 0 value hits and 0 pattern hits. Two other new rollouts in `~/.codex/sessions` belong to other worktrees' Codex lanes (`retire-tribunal-page`, `claude-account-followups`; not in my logs) and were excluded. | `node scan.js` from F |

## Other observations

- Each app start spawns the app-server on the first chat send (17.6 s in run 1, 16.6 s on the run-2 resume). The run-2
  resume also logged a 15.2 s event-loop freeze (`[event-loop] lag: {"maxMs":15200.2}`) just before
  `Codex process started`.
- The composer footer keeps a stale "What does README.md say? needs you" line after every approval was resolved (seen
  after t1 and in every later turn).
- A new session in this profile started at `Full Auto (YOLO)`, so the Manual setting had to be set per chip, as in
  p8h.
- An internal `SdkQueryRunner` haiku query (`bypassPermissions`, Ptah MCP) ran on the first send. It is not the
  legacy marker; I think it is the enhancement or title role.

## New gaps (suspected backend file, not fixed)

- **GAP-A2 (medium): the read-only allowlist never matches what Codex sends on Windows.** Codex 0.165.0 sends
  `["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe","-Command","<body>"]`. Ptah renders that as
  `"C:\\…\\powershell.exe" -Command '<body>'`, with the full quoted path, no `-NoProfile`, and single quotes around the
  body. `unwrap()` in `libs/backend/agent-sdk/src/lib/codex-app-server/codex-read-only-command.ts` accepts only
  `^(?:powershell|pwsh)(?:\.exe)?\s+-NoProfile(?:\s+-NoLogo)?\s+-(?:Command|c)\s+(["'])…`. So the string falls through
  as a plain command whose first token is the quoted `C:\…\powershell.exe`, which is not in the allowlist, and the
  card is shown. Even `Get-Content -LiteralPath README.md` and `Get-Content missing.txt` prompted. `[CodexChatApprovalSink]
  accepted read-only command.` was logged 0 times in 10 turns. Fix area: unwrap the full-path `powershell.exe`
  executable with or without `-NoProfile`, or classify the argv array (`details.command` as an array, if the App Server
  provides it) instead of the rendered string, in `codex-read-only-command.ts` and the caller in
  `codex-chat-approval-sink.ts` (around line 108). Separately, the model often chains reads with `;` or
  `if (…) {…}`, which the grammar rejects by design. Those cases are expected to keep the card.
- **GAP-I (medium, NEW): false "Codex is busy" error on the first follow-up after a restart.** On the first send to a
  restored Codex thread, `chat:continue` resumes the thread
  (`[RPC] Session 01a1852d-… resumed successfully`), the turn runs and replies, and then the same RPC fails with
  `RPC: chat:continue failed (CODEX_BUSY)` →
  `[ERROR] [renderer] console.error: "[MessageSender] Failed to continue chat: Codex chat is busy. Try again when the current operation finishes."`.
  The UI shows the red "Message delivery failed…" banner above the correct reply. The rollout has the user prompt only
  once, so the resume path delivered it and the second `sendMessageToSession` was refused as busy. Suspect:
  `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`. The `justResumed` path (around lines
  1896–1926) resumes the Codex thread with the prompt or config, and line 1272 then always calls
  `sdkAdapter.sendMessageToSession` again. A second suspect is the Codex chat adapter's resume/send busy guard in
  `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts`.

## Still open from p8h

- **GAP-D** (transcript after `/compact` and after the restart; `chat:resume … No events found`), **GAP-F** ("Command
  succeeded" header on a failed command), **GAP-G** (plain prompts never reach `fileChange` on Windows), **GAP-3**
  (sonarqube is project-scoped to `D:/projects/ptah-extension`; Codex chat gets only `smithery` + Ptah MCP), stale
  "needs you" footer.
- Fixed since p8h: GAP-B (listing), GAP-C (title), GAP-E (question card), GAP-H (usage initialize), the skill-lookup
  part of GAP-A (D21).

## Restore

- `~/.ptah/settings.json` was restored from `F\settings.json.bak` (the post-run copy, which the app had changed, is kept
  as `settings.after.json`). `cmp` result: **CMP_OK** (identical). `~/.codex/config.toml` and `~/.claude.json` were not
  touched.
- Root electrons left after the stop: only the foreign e2e PID 9872.
- Workspace files the model created in `F\ws` (`g6dir`, `notes2.md`, `empty.txt`) are left in F as evidence.
