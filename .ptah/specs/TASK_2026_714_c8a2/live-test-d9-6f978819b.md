# Live Electron re-check D9 (head 6f978819b), Codex App Server runtime

- Date: 2026-11-02, Africa/Cairo. Detached worktree `D:\projects\ptah-extension\.claude-worktrees\d9-live`, head `6f978819b`; final `git status --short` was empty.
- Evidence folder F3: `C:\Users\abdal\AppData\Local\Temp\ptah-live-d9c-20261102-183457\`. Copied `ptah.db`, `sessions.db`, both `-wal`/`-shm` pairs, `ws`, and helper scripts from the original `ptah-live-d9-20261102-170847` folder without modifying it. Launch retained that original folder's `ws` path, recorded in `F3\workspace-path.txt`; database paths pointed to F3.
- CDP port **9335** was free in `netstat` before launch. Playwright `chromium.connectOverCDP` inspected the Electron renderer and captured screenshots in `F3\shots`.
- Build: locked `ptah-electron:build-dev`, WASM copy to `dist/apps/ptah-electron`, and `ptah-electron:copy-renderer-dev` all exited **0** (`F3\build.log`, `F3\wasm.log`, `F3\renderer.log`). The first build invocation could not spawn `sh` because it was absent from PATH; adding Git's `sh` to that process's PATH and rerunning the exact locked command succeeded. No install, source edit, test, lint, typecheck, general verify target, or chat message was run.
- Launch environment: `PTAH_CODEX_RUNTIME_DEV=1`, `PTAH_NO_DEVTOOLS=1`, `PTAH_DB_PATH=F3\ptah.db`, `PTAH_SESSIONS_DB_PATH=F3\sessions.db`. Launcher PID **21248** and Electron root PID **33268** were confirmed by command line. Only that Electron process tree was shut down; root, port 9335 process, and launcher remaining **0** (`F3\shutdown.log`).
- Settings: `~/.ptah/settings.json` backed up to `F3\settings.json.bak` before building, restored after shutdown, and verified by `cmp.exe` exit **0** (`F3\settings-restore.txt`).
- Paid turns: **0**. Today's Codex rollout `turn_context` totals were **99 before and 99 after**, delta **0** (`F3\rollouts-before.tsv`, `F3\rollouts-after.tsv`, `F3\paid-turns.txt`).

## Verdict

| Check | Verdict | Observed result and evidence |
| --- | --- | --- |
| Completed child card output before reload | **FAIL** | Reopened session `01a19cd2-dc3c-7680-ae77-a7c9363246e9`; one completed `codex` card appeared. Its only PINEAPPLE occurrence was in the child prompt/activity, with no OUTPUT label or standalone answer in the card. The parent answer contains PINEAPPLE. `F3\shots\history-open.png`, `F3\d9c-open.js`. |
| Child lane before reload | **FAIL** | Clicking the card's open control showed “This agent is not available yet”; no child transcript loaded. `F3\shots\child-lane.png`, `F3\d9c-child.js`. |
| AGENTS panel before reload | **FAIL** | Panel displayed `0 running · 1` and one Orchestrator row; no codex child row. `F3\shots\agents-panel.png`, `F3\d9c-agents.js`. |
| Completed child card output after one renderer reload and rail re-selection | **FAIL** | The completed card remained, but still showed the prompt/activity only; no OUTPUT label or standalone PINEAPPLE answer in the card. `F3\reload-results.json`, `F3\shots\history-reload.png`, `F3\shots\history-reopened.png`. |
| Child lane after reload | **FAIL** | Opening the card again showed “This agent is not available yet”; no transcript loaded. `F3\reload-results.json`, `F3\shots\child-lane-reloaded.png`. |
| AGENTS panel after reload | **FAIL** | Still `0 running · 1`, with Orchestrator only and zero codex rows. `F3\reload-results.json`, `F3\shots\agents-panel-reloaded.png`. |
| Requested log exclusions and native child warnings | **PASS** | Two `chat:resume` calls succeeded, each loading 24 JSONL events. No `HISTORY_FAILED`, invalid protocol frame, `thread/list` occurrence/WARN, or native child recovery/cache WARN. `F3\log-findings.txt`, `F3\app.log`, `F3\app.err.log`. |

The screenshots were visually compared with the previous run's `history-open.png` and `agents-panel.png`; the card and AGENTS panel remain materially unchanged. No separate design reference was supplied. The logs show the completed historical child skipped twice by `SubagentRegistryService.registerFromHistoryEvents`, with `resumableSubagentCount:0` on both resumes (`app.log` lines 867–869 and 1104–1106). This is an observation, not a proven root cause.

`app.err.log` contains 22 WARN lines: 10 event-loop lag, 7 slow RPC handlers (including two `chat:resume`), 2 renderer Zone.js notices, 2 development Codex routing notices, and 1 MCP port collision. None concerns native child recovery/cache. The frame-size and descendant filtering paths were not visibly exercised.
