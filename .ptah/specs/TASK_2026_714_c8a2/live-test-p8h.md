# Live Electron test p8h: Codex App Server runtime with the 60 s initialize budget (head d6602359e)

Date: 2026-10-29. The user approved this run. It was a test and report only: no product source was touched and nothing
was committed.

- Evidence folder F: `C:\Users\abdal\AppData\Local\Temp\ptah-live-p8h-20261029-010924\`
  (`app-run1.log`, `app-run2.log`, `app.log` = both runs joined for the scan, `build.log`, `build2.log`, `wasm.log`,
  `shots\`, `settings.json.bak`, `settings.after.json`, `scan.js`, `readmeta.js`, Playwright scripts, `mark-*.txt` log
  offsets; `mark-t*` = run 1, `mark-r*` = run 2)
- Single-instance check: the only other root electron was the Playwright e2e one (PID 9872, `wizard-library-alignment`,
  own `--user-data-dir`). It did not block the runs and was never touched. My root electrons were stopped with
  `taskkill /T /F` (run 1 PID 35596, run 2 PID 39492).
- Build: `build-dev`, `copy-wasm.js` and `copy-renderer-dev` all exited 0. Both Nx steps ran under `verify.mjs --exec`.
- Launch: `PTAH_CODEX_RUNTIME_DEV=1 PTAH_NO_DEVTOOLS=1`, CDP 9335, fresh DBs in F, workspace `F\ws\` (a copy of the p8g
  workspace). Run 2 reused the same DBs and workspace after a full stop, so the restart and resume behaviour could be
  checked.
- Setup through the UI: Settings > Reassign > OpenAI Codex, model **GPT-6-Sol (`gpt-6-sol`)**, "This workspace", then
  "Use for main agent" and Save. Card result: `PROVIDER: OpenAI Codex MODEL: gpt-6-sol`. I turned Autopilot off on the
  approval chip, which then read `Approval mode: Manual`, and Manual persisted into run 2.
- Paid turns: **run 1: 10** (t1-t9 + `/compact`). **Run 2: 6** (r1, r3, r4, r5, r6, r7; `/clear` is a native command and
  makes no model call). Total 16. Both limits were respected (≤ 10 per run, 2 runs).

## Verdict: the runtime now starts and works. Core approvals, Deny, Deny with message, Stop + follow-up + `/compact`, `/clear`, failed-command output and the Ptah MCP call PASS. Gaps remain in read prompts, the question card, native session listing and title, and history after `/compact`

| Item | Result | Evidence |
| --- | --- | --- |
| Startup: bundled 0.165.0, pin check, start line | PASS. `[INFO] Codex process started: {"binaryPath":"D:\\projects\\ptah-extension\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe","pinnedVersion":"0.165.0","pinStatus":"ok","startupDurationMs":15398}`. Run 2 shows three more starts (one per new chat): 15711, 14502 and 17692 ms. No `initialize` timeout. The binary resolves to the main checkout's `node_modules`, which the worktree reaches through its `node_modules` link. | app-run1.log:1457; app-run2.log:1254, 1377, 1541 |
| G6 write command (mkdir) | PASS. "Create a folder named g6dir here." showed one approval card (`New-Item -ItemType Directory -Name g6dir`) at +5.5 s, before the folder existed. After Allow it was created, with no second prompt, and the turn ended `done`. | `shots\t3-approval1.png`, `shots\t3.png` |
| G6 file edit | PASS for the approval order, GAP for the path. "Create a file g6.txt containing hello." showed the card while `g6.txt` did not exist yet (`fileExists:false` at the approval). Allow created it with no second prompt. The model wrote the file with a PowerShell `Set-Content` command, not `apply_patch`, so the card was a Bash/command card. The same happened in run 2 ("Write a notes.md file…"). | `shots\t4-approval1.png`, `shots\r4-approval1.png` |
| G6 file approval before item start (fileChange) | NOT REACHED with plain prompts. On Windows GPT-6-Sol wrote every file through PowerShell (3 of 3 tries), so no `fileChange` approval came up. | t4, t5, r4 |
| G6 plain Deny | PASS. "Change g6.txt so it says goodbye.": card, Deny. The file kept `hello`, the turn stopped with no reply text (like a Claude deny/interrupt) and ended `done`. | `shots\t5-approval1.png`, `shots\t5.png` |
| G6 Manual-mode prompts for plain reads | GAP. Every plain read prompted: t1 "What does README.md say?" gave **2** prompts (`Get-Content README.md`, plus an extra `rg --files ~/.codex/skills \| rg ptah-surface-authoring`). t7 gave 1 (`Get-Content missing.txt`). r3 gave 2 extra read prompts (the same skill lookups). Total **5 read-only prompts**. In Manual mode Claude does not prompt for Read/Glob/Grep. | `shots\t1-approval1.png`, `shots\r3-approval*.png` |
| L1 Stop during a pending approval | PASS. "Create a file stop.txt containing x.": card shown, Stop clicked. The UI went idle and the card was removed, `stop.txt` was not created, and the log shows `chat:abort success`, "aborted by user after 18 events". No `Codex process failure`. | `shots\t8-before-stop.png`, `shots\t8-after-stop.png` |
| L1 plain follow-up after Stop (same thread) | PASS (p8f D-1 fixed). `session:validate`: native Codex session exists, then `chat:continue` on the same thread `01a18496-…`. Reply "OK". No new process and no `CODEX_UNAVAILABLE`. | `shots\t9.png`, app-run1.log after mark-t9 |
| L1 `/compact` on the same thread | PASS for the backend, GAP in the UI. The interceptor ran (`new-query`), `chat:continue success` and the "Context compacted" banner appeared. The renderer then logged `Failed to reload session after compaction: chat:resume failed for 01a18496…: No events found` and the tab showed the empty "Orchestrator ready" hero: the whole transcript disappeared from view. | `shots\t10.png` |
| L1 `/clear` starts a new thread | PASS. `/clear` was intercepted (`native`), the tab reset to "New Chat", and the next send did `chat:start` with a new thread `01a184a2-…` (the previous one was `01a184a0-…`). | `shots\r2-clear.png`, `shots\r3.png` |
| G1/L2 failed command | PASS for the body, cosmetic GAP in the header. "Show me the contents of missing.txt." shows the real PowerShell error (`Cannot find path 'missing.txt'…`, 8 lines) and `Command failed with exit code 1`, but the card header still says **"Command succeeded"**. | `shots\t7-card.png` |
| G2 Bash card rows | PASS. The cards show only `Command` (with copy) and the result/output. There are no "Arguments" or cwd rows. | `shots\t7-card.png`, `shots\r7-card.png` |
| G3 no empty thinking blocks | PASS. No thinking/reasoning elements or empty blocks in the finished turns (DOM check: 0 elements, 0 "Thinking" labels, run 1 and run 2). While r1 was streaming, a transient italic quote block with partial text (`" Almost th \| "`) appeared and then went away; it was not empty. | `shots\r1.png`, `shots\r1b.png` |
| G4 Codex question shows the AskUserQuestion card | GAP. "Before you answer, ask me whether I prefer red or blue." gave a plain markdown answer: "Do you prefer red or blue?" plus a Blue/Red list, then the question **again** as text (rendered twice). No question card, and no `requestUserInput` in the log. The renderer logged `[ChatStore] Chat error: [object Object]` during the turn, and the turn took 42 s. | `shots\r1b.png`, app-run2.log after mark-r1 |
| D19 Deny with message | PASS. "Create a file d19.txt containing hi.", then Deny... with the message "Do not create files. Instead reply with only the word BANANA." The reply was **BANANA** and `d19.txt` was not created. The UI labels say "Deny with a message to Claude" / "Message to Claude" in a Codex chat (cosmetic). | `shots\t6-denymsg.png`, `shots\t6.png` |
| D14a old ask/auto-edit thread shows "Start a new chat" on resume | NOT RUN, with partial evidence. (1) The profile has no pre-existing ask/auto-edit Codex thread. (2) A native thread cannot be reopened from the UI after a restart: Previous sessions is empty (see 8m-8). (3) A third app run would be needed to resume a thread made in run 2. What I could check: a thread started in **Auto-edit** (`01a184a4-…`) and continued after switching the chip to Manual kept working on the live thread (`chat:continue success`, reply "YES", no "Start a new chat"). That is expected, because the profile check runs only on resume. | `shots\r5.png`, `shots\r6.png` |
| 8m-8 rail title + stored message count | PARTIAL / GAP. **Count: PASS in storage.** `codexMessageCount` in `sessions.db` = 14 for the run-1 thread (7 completed turns; the denied t5, stopped t8 and `/compact` are not counted), and 2, 4 and 6 for the run-2 threads. **Title: FAIL.** Every native row keeps `name` = the session id placeholder (for example `"01a18496-d2c5-…"`); the adapter title was never stored. **Rail after restart: FAIL.** Run 2 restored the open tab under its tab title, but once that tab was closed the rail said "No sessions yet" and **Previous sessions** was empty, although `session:list` succeeded and 4 native rows exist for this workspace. Cause found: the native rows have `workspace_key = c:\users\abdal\appdata\local\temp\ptah-live-p8h-…\ws` (fully lowercased), while every other row keeps the original case after the drive letter (`c:\Users\abdal\…`). So `listForWorkspace` does not match them. **Tool-call-only reply: NOT PROVEN.** No plain prompt produced a reply that was only a tool call (r7 "Delete t.txt." still answered "Deleted t.txt."; its count went 4 → 6). | `shots\r2-prev.png`, `shots\r2-prev2.png`, `readmeta.js` / sqlite reads of `F\sessions.db` |
| MCP `ptah_*` call | PASS. "Use the ptah_workspace_analyze tool and tell me the project type in one line." gave `[MCP] tool result: CodeExecutionMCP {"tool":"ptah_workspace_analyze","callerKind":"session",…,"isError":false}`, a "1 tool" card, and the reply "Project type: general." It was attached as `ptah-mcp-attached` with path `/session/<tabId>/workspace/…ws`. | `shots\t2.png`, app-run1.log after mark-t2 |
| User MCP (sonarqube) | NOT RUN / GAP-3. sonarqube is defined only in `~/.claude.json` under `projects["D:/projects/ptah-extension"]`, and Codex chat gets only Ptah-installed servers (`codex-user-mcp-configured` → `["smithery"]`). Optional check: the Marketplace "Installed" list for the `ws` workspace shows firecrawl, node_repl, hyperframes, sentry, ptah and smithery_hubspot, **no sonarqube**. So Claude chat in `F\ws` would not list it either (it is project-scoped to a different folder). No MCP config was changed. | `shots\marketplace.png` |
| Legacy marker `[SessionLifecycle] Starting SDK query with options:` | PASS: 0 in run 1, 0 in run 2 | `grep -c` |
| Secret scan | PASS: 0 leaks. 7 candidate values from the `~/.ptah` MCP and settings files: the joined app.log has 40 raw hits, all non-secret (OAuth `serverKey` ids 18, `authMethod`/`authEnvVar` names 22). Pattern scan (Bearer/Basic Authorization, `sk-`, JWT, `fc-`, `squ_`): 0 in both logs. 6 new rollout files in `~/.codex/sessions`: 0 value hits and 0 pattern hits each. | `node scan.js` from F |

## Other observations

- `[CodexAccountUsage] App Server account read unavailable: {"stage":"initialize"}` still appears 8 times across both
  runs, so the account/plan usage reader does not get the 60 s budget (or uses its own shorter limit).
- Each new chat spawns its own app-server process (14.5–17.7 s start-up each), so the first reply of every new chat
  waits for that start-up.
- The composer footer keeps a stale "… needs you" line after the approval was resolved (for example "What does
  README.md in this folder… needs you" after t1, "Create an empty file named t.txt. needs you" after r3).
- The rail preview shows raw markdown links (`Created [notes.md](ws/notes....`).
- The Autopilot popover text says "Claude is automatically approving actions…" in a Codex chat.

## Gaps (suspected backend file, not fixed)

- **GAP-A (medium): plain reads prompt in Manual.** Read-only shell commands (`Get-Content`, `rg --files`,
  `Get-ChildItem`) all ask for approval, and the model adds skill-lookup reads to unrelated turns (5 read prompts in 4
  turns). Claude Manual does not prompt for reads. Suspect: the Codex Manual-mode approval/sandbox policy mapping in
  `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts` (approval routing) and the execution
  profile builder in `libs/backend/codex-runtime/` (Manual sandbox → `untrusted`/read-only command policy). The extra
  `ptah-surface-authoring` lookups come from instructions that point the model at `~/.codex/skills`, probably the
  enhanced prompt or skill injection for Codex chat.
- **GAP-B (medium): native sessions missing from session:list.** The Codex rows are written with a fully lowercased
  `workspace_key`, so `listForWorkspace` does not match them and Previous sessions and the rail after restart are
  empty. Suspect: the workspace id the Codex metadata port passes (`createCodexChatMetadataPort`, the
  `normalizedWorkspaceId` / `codexExecution.workspaceId` lowercasing) and the key derivation in
  `libs/backend/agent-sdk/src/lib/session-metadata-store.ts` (records `listForWorkspace`).
- **GAP-C (medium): native title not stored.** `name` stays as the session-id placeholder for all 4 native rows.
  Suspect: the title hand-off in the Codex chat adapter (`codex-app-server/codex-chat-adapter.ts`, which never sends a
  title) and the placeholder-replace rule in `session-metadata-store.ts`.
- **GAP-D (medium): transcript lost from view after `/compact`.** The renderer reloads through `chat:resume`, which
  finds no events for a native Codex thread (the history reader does not read native sessions; same root as p8e D9).
  Suspect: `SDK_SESSION_HISTORY_READER` / the session loader path for `codex-app-server` rows in
  `libs/backend/agent-sdk` and `chat-session.service.ts` (`chat:resume`).
- **GAP-E (medium): no question card for a Codex question (G4).** A plain prompt makes the model write the question as
  markdown, rendered twice, and the renderer logs `Chat error: [object Object]`. Suspect: no `requestUserInput`
  (AskUserQuestion) bridge is offered to the model in the default collaboration mode
  (`libs/backend/codex-runtime/` server-request handling and the Codex chat adapter's tool/collaboration-mode setup).
  The duplicate text points to the adapter emitting the final agent message on top of the streamed one
  (`codex-chat-adapter.ts` event mapping).
- **GAP-F (low): failed command header.** The card says "Command succeeded" over `Command failed with exit code 1`.
  Suspect: the status mapping of `commandExecution` items (the exit code is not used for the tool result's error flag)
  in the Codex chat adapter's item→tool-result mapping.
- **GAP-G (low): file approval path not reachable with plain prompts on Windows.** GPT-6-Sol edits files through
  PowerShell, so the `fileChange` approval-before-item-start path stayed unexercised. Product side to check: whether the
  Codex profile should steer edits to `apply_patch` (Codex instructions/profile in `libs/backend/codex-runtime/`).
- **GAP-H (low): account usage still fails at initialize.** Suspect:
  `libs/backend/codex-runtime/src/lib/codex-account-usage-client.ts` (its own open/abort timing does not get the 60 s
  initialize budget).
- **GAP-3 (environment and scope): sonarqube unavailable to Codex chat.** It is project-scoped in `~/.claude.json`, and
  Codex chat gets only Ptah-installed servers
  (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:538-567`;
  `claude-user-mcp.reader.ts` feeds only the Installed-tab display, and not for this workspace either).
- Cosmetic: "Deny with a message to Claude" / "Message to Claude"
  (`libs/frontend/chat-ui/src/lib/molecules/permissions/deny-message-popover.component.ts`) and "Claude is automatically
  approving…" (`libs/frontend/chat-ui/src/lib/molecules/chat-input/autopilot-popover.component.ts`) in Codex chat; stale
  "needs you" footer; raw markdown in the rail preview.

## Restore

- `~/.ptah/settings.json` was restored from `F\settings.json.bak` (the post-run copy is kept as `settings.after.json`).
  `cmp` result: **CMP_OK** (identical). `~/.codex/config.toml` was never touched. No MCP config was changed.
- Remaining root electron processes after the stop: only the foreign e2e PID 9872.
- Workspace files the model created in `F\ws` (`g6dir`, `g6.txt`, `notes.md`) are left in F as evidence.
