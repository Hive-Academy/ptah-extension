# Live Electron re-check D9 fix 9, Codex App Server runtime

- Date: 2026-11-02, Africa/Cairo. Scratch worktree L: `D:\projects\ptah-extension\.claude-worktrees\d9-live`; source files under test matched W after temporary debug code was removed.
- Final evidence folder: `C:\Users\abdal\AppData\Local\Temp\ptah-live-d9d-final-20261102-185929\`. It contains fresh copies of `ptah.db`, `sessions.db`, available WAL/SHM companions, `ws`, and helper scripts from the original `ptah-live-d9-20261102-170847` folder. The original was not modified. The launch retained the original folder's `ws` path; `PTAH_DB_PATH` and `PTAH_SESSIONS_DB_PATH` pointed to the final evidence copies. `PTAH_CODEX_RUNTIME_DEV=1`, `PTAH_NO_DEVTOOLS=1`, CDP port 9335.
- Build: locked `ptah-electron:build-dev`, locked WASM copy, and locked `ptah-electron:copy-renderer-dev` all exited **0** (`build.log`, `wasm.log`, `renderer.log`). No install, tests, lint, typecheck, general verify, or git command was run.
- Playwright `chromium.connectOverCDP` reopened session `01a19cd2-dc3c-7680-ae77-a7c9363246e9` and captured screenshots in `shots`. The actual final run used the final evidence DB copies after correcting the launch helper's shared evidence-folder pointer; earlier screenshots from the diagnosis-folder DB copy were superseded by the final checks.
- The final app log records a successful `chat:resume` with **24** JSONL events, zero resumable subagents, and zero CLI sessions. The completed native child was still skipped by the backend resumable registry, as expected; the frontend restored it from the returned events.
- Settings were backed up before launch, restored after shutdown, and verified by `cmp.exe` exit **0** (`settings-restore.txt`). Only the verified Electron root and its launcher were stopped; neither remained afterward.
- No chat message was sent. The whole-task global Codex `turn_context` count changed **100 → 101**, with the extra entry timestamped before the final Electron launch during the coding session. No `turn_context` occurred during the final app-run window, so runtime paid-turn delta was **0**. This is a limitation of using the global counter across concurrent agent work.

## Verdict

| Check | Verdict | Observed result and evidence |
| --- | --- | --- |
| Completed child card output before reload | **PASS** | The `subagent-tile` contained PINEAPPLE as child output, visibly below the completed Codex header. `final-open-result.json`, `shots/history-open.png`. |
| Child lane before reload | **PASS** | Opening the child lane showed PINEAPPLE in `lane-panel`; the unavailable notice was absent. `final-child-result.json`, `shots/child-lane.png`. |
| AGENTS panel before reload | **PASS** | AGENTS showed Orchestrator and a completed Codex sub-agent. `final-agents-result.json`, `shots/agents-panel.png`. |
| Completed child card after one renderer reload and rail reselect | **PASS** | The card still contained PINEAPPLE after reselecting the rail and Orchestrator lane. `final-reload-result.json`, `shots/history-reopened-fixed.png`. |
| Child lane after reload | **PASS** | PINEAPPLE remained in the child lane, with no unavailable notice. `final-reload-result.json`, `shots/child-lane-reloaded-fixed.png`. |
| AGENTS panel after reload | **PASS** | The panel still listed the completed Codex child and Orchestrator. `final-reload-result.json`, `shots/agents-panel-reloaded-fixed.png`. |

The screenshots were visually compared with the previous failed run's `history-open.png`, `child-lane.png`, and `agents-panel.png`. The prior card lacked the standalone child answer, the lane showed “This agent is not available yet,” and AGENTS had only Orchestrator. The final screenshots show the output, transcript, and second agent row. No separate design reference was supplied.
