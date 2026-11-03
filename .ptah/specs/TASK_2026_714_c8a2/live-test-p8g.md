# Live Electron test p8g: Codex App Server runtime on bundled 0.165.0 (head adc8b9dd9)

Date: 2026-10-29. The user approved this run. It was a test and report only: no product source was touched and nothing was committed.

- Evidence folder F: `C:\Users\abdal\AppData\Local\Temp\ptah-live-p8g-20261029-003228\`
  (`app.log`, `build.log`, `build2.log`, `wasm.log`, `shots\`, `settings.json.bak`, `scan.js`, `init-time.js`,
  Playwright scripts copied from p8f, `mark-*.txt` log offsets)
- Single-instance check: the only other root electron was the Playwright e2e one (PID 9872, `wizard-library-alignment`,
  own `--user-data-dir`). It did not block the run and was never touched. My root electron.exe (PID 10516) was stopped
  with `taskkill /T /F /PID 10516`.
- Build: `build-dev`, `copy-wasm.js` and `copy-renderer-dev` all exited 0. Both Nx steps ran under `verify.mjs --exec`.
- Launch: `PTAH_CODEX_RUNTIME_DEV=1 PTAH_NO_DEVTOOLS=1`, CDP 9335, fresh DBs in F, workspace `F\ws\` (a copy of the p8f
  workspace with the stale `b.txt` removed).
- Setup through the UI: Settings > Reassign > OpenAI Codex, model **GPT-6-Sol (`gpt-6-sol`)**, "This workspace", then
  "Use for main agent" and Save. Card result: `PROVIDER: OpenAI Codex MODEL: gpt-6-sol`. I turned Autopilot off on the
  approval chip, which then read `Approval mode: Manual`. Screenshots: `shots\reassign-saved.png`, `shots\perm.png`.
- Binary: `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe`
  (`codex-cli 0.165.0`, 357,356,336 bytes, sha256 prefix `d4b2e6a054ea1dfe5321`).
- Paid turns: **0**. Two sends were tried (t1, t1-retry). Both failed at the app-server `initialize` handshake, before
  any thread or turn existed, so no model call happened. No Codex rollout file was created in this run.

## Verdict: BLOCKED. Codex chat cannot start because the host's 10 s `initialize` timeout is shorter than the bundled 0.165.0 binary's process start time on this machine

Both sends ended with "Message delivery failed. Codex chat could not start."
(`chat:start failed (CODEX_RUNTIME_FAILED)`). app.log:

```
[DEBUG] Codex process failure: {"reason":"Codex request timed out","method":"initialize","stderrTail":""}
[ERROR] [CodexChatAdapter] runtime-failed: open. Error: Codex context could not be opened
  [cause]: CodexProcessFailureError: Codex request timed out
```

The account-usage reader hit the same failure at startup (lines 1100 and 1405):
`[CodexAccountUsage] App Server account read unavailable: {"status":"service-unavailable","stage":"initialize"}`.

### Root-cause measurements (outside the app, read-only)

| Probe | Result |
| --- | --- |
| `codex.exe --version` from the bundled path (D:) | 12.6 s wall time (user CPU 0.015 s) |
| Same binary in `~\.codex\packages\app-server-daemon\releases\0.165.0-...\bin\codex.exe` (C:), identical sha256 | 1.5 s |
| `app-server` + `initialize` from the bundled path (`init-time.js`, cwd `F\ws`) | 13.6 s, 13.2 s, 13.0 s (main-checkout copy) |
| Same with an empty temporary `CODEX_HOME` | 12.9 s, so the delay does not depend on config or state |
| Same with the C: daemon copy | 1.8 s |
| `RUST_LOG=debug` | the first stderr line appears at +12.8 s, so the stall happens before Codex's own startup code runs |

The binary bytes and the directory layout (`bin`, `codex-path\rg.exe`, `codex-resources`) are identical in both places.
The ~11 s of extra time is spent loading the 357 MB executable from the D: path. Most likely an OS or antivirus scan
runs on every launch: there is no Zone.Identifier stream on the file, and I could not read the Defender preferences
(0x800106ba). The p8f run used the earlier, smaller pinned binary from the same D: tree and started fine. The host
timer in `codex-app-server-process.ts` starts before the spawned process is ready, and the `initialize` timeout is a
hard-coded `10_000` ms. On this machine every open therefore fails.

## Per-item results

| Item | Result | Evidence |
| --- | --- | --- |
| Startup: bundled 0.165.0 spawned, pin check passes | PARTIAL. The pin check passes: the code throws `Codex executable pin mismatch` before it spawns, and the log reaches `initialize` instead. The spawn uses the bundled binary path above (0.165.0), not the `codex.CMD` on PATH that CliDetection found. No explicit pin or version line is logged. The handshake then times out at 10 s on every open (2 of 2). | app.log 1461-1476 and 1516+; `shots\t1.png`, `shots\t1-retry.png` |
| G6 approvals (write cmd, file edit, Allow, Deny, file approval before item start, Manual read-prompt count) | NOT RUN. Blocked by the initialize timeout. | - |
| L1 Stop during approval, then follow-up + `/compact` on the same thread; `/clear` starts a new thread | NOT RUN. Blocked. | - |
| G1/L2 failed command output + "Command failed with exit code N" | NOT RUN. Blocked. | - |
| G2 Bash card without Arguments/cwd rows | NOT RUN. Blocked. | - |
| G3 no empty thinking blocks | NOT RUN. Blocked. | - |
| G4 Codex question shows the AskUserQuestion card | NOT RUN. Blocked. | - |
| D19 Deny with message | NOT RUN. Blocked. | - |
| D14a old ask/auto-edit thread shows "Start a new chat" | NOT RUN. Blocked: no Codex thread can be opened, and the fresh session DB holds no old ask/auto-edit Codex thread. | - |
| 8m-8 rail title + stored message count, tool-call-only reply | NOT RUN. Blocked. The rail showed the failed tab titled from the prompt ("What does README.md in this folder…", state `error`), but no Codex message was stored. | `shots\final.png` |
| MCP `ptah_*` call | NOT RUN. Blocked. Attach-side evidence (new since p8f, which resolves p8f D-3): `Ptah MCP is attached to Codex chat.: {"code":"ptah-mcp-attached","path":"/session/eb9ddfca-.../workspace/C%3A%5C...%5Cws"}`, a session-scoped path. | app.log 1456, 1529 |
| User MCP call (sonarqube) | NOT RUN. Blocked. Also expected to be NOT POSSIBLE in this setup even without the block: `codex-user-mcp-configured` lists only `["smithery"]`. `sonarqube` is defined only in `~/.claude.json` under `projects["D:/projects/ptah-extension"].mcpServers`, a Claude project scope for a different folder. The Codex chat override builder (`chat-session.service.ts:538-567`) merges only Smithery + OAuth + caller overrides, and it is not in `~/.codex/config.toml` (only `node_repl`, `ptah`). MCP config was not changed. | app.log 1455, 1528 |
| Legacy marker `[SessionLifecycle] Starting SDK query with options:` | PASS: 0 | `grep -c` on app.log |
| Rollout secret scan | PASS: 0 leaks. 7 candidate values from the `~/.ptah` MCP and settings files: app.log 21 raw hits, all non-secret (OAuth `serverKey` ids 8, `authMethod`/`authEnvVar` names 13). Pattern scan (Bearer/Basic Authorization, `sk-`, JWT, `fc-`, `squ_`): 0. New rollout files in `~/.codex/sessions`: 0 (no thread was created). | `node scan.js` from F |

## Gaps (suspected backend file, not fixed)

- **GAP-1 (blocker, high):** the Codex app-server `initialize` timeout (10 s) also has to cover OS process start-up. With
  the 357 MB 0.165.0 binary loaded from the repo's `node_modules` on D:, start-up alone takes about 12.6 s on this
  machine, so every Codex chat open fails with `CODEX_RUNTIME_FAILED`. Account usage fails in the same way. Suspected
  file: `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts` (the `sendRequest('initialize', ..., 10_000)`
  call around lines 200-210; the timer is armed right after `spawnProcess`). Options to consider: a longer or
  configurable handshake timeout, or a timer that starts only when the child process shows life. A related question is
  whether the Electron dev host should spawn from a C: or OS-trusted location. The resolver is in
  `apps/ptah-electron/src/di/codex-runtime-composition.ts` (`createElectronCodexExecutable`, which refuses anything
  outside the bundle).
- **GAP-2 (low, diagnosability):** the failure line has an empty `stderrTail`, and nothing says "handshake exceeded 10 s
  after spawn". The UI says only "Codex chat could not start". The binary path, version and pin result are not logged
  at open, so the startup checklist item cannot be proven from the logs alone. Suspected files:
  `codex-app-server-process.ts` (failure detail) and `codex-runtime-composition.ts` (`inspectElectronCodexBinary`, no
  info log of path/version/pin status).
- **GAP-3 (environment and scope, medium):** the user's `sonarqube` MCP server cannot reach Codex chat. Codex chat user
  MCP comes only from Ptah's Smithery and OAuth stores. Claude-scoped `~/.claude.json` servers are read only for the
  Installed-tab display (`libs/backend/cli-agent-runtime/src/lib/mcp-directory/claude-user-mcp.reader.ts`), not passed
  to Codex (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:538-567`). The server is also scoped
  to `D:/projects/ptah-extension`, not to the test workspace. To pass this item, sonarqube has to be installed through
  Ptah's MCP directory or Codex config, which is a user decision.

## Restore

- `~/.ptah/settings.json` was restored from `F\settings.json.bak`. `cmp` result: **CMP_OK** (identical).
  `~/.codex/config.toml` was never touched.
- Remaining root electron processes after the stop: only the foreign e2e PID 9872.
- A second app run was not started. It would hit the same handshake timeout, because the start-up delay reproduced on
  every launch from the D: path (8 of 8 probes), and source edits were not allowed.
