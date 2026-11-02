# Live Electron test D9 (head a51a470ad), Codex App Server runtime

- Date: 2026-11-02, 17:08–17:18 Africa/Cairo. Detached worktree `D:\projects\ptah-extension\.claude-worktrees\d9-live`, head `a51a470ad` (preflight `git log -1`; `git status --short` was empty before and after).
- Model: Settings > Main agent showed OpenAI Codex, `gpt-5.6-luna`, This workspace. The composer showed GPT 5.6 Luna. All three native `turn_context` records used `gpt-5.6-luna` and `approval_policy: untrusted` (Manual). No other model was used for these turns.
- CDP port: 9335, free by `netstat` before launch. Playwright used `chromium.connectOverCDP` against the Electron renderer.
- Paid turns used: **3 of 3**, counted by native rollout `turn_context`: parent first prompt, spawned child prompt, parent `Say OK.` follow-up. No further prompt was sent after the cap.
- PIDs: launcher `node.exe` **19688**; this run's Electron root **17576**, verified by command line to point at D9 and port 9335. `taskkill /T /F /PID 17576` ended its tree; Electron root remaining: 0. No unrelated Electron/Codex process was targeted. See `shutdown.log`.
- Evidence folder F: `C:\Users\abdal\AppData\Local\Temp\ptah-live-d9-20261102-170847\`. Copied p8l helpers and new D9 helpers, logs, JSON captures, and screenshots live there. Helpers were edited only in F.
- Settings: `~/.ptah/settings.json` was backed up to `F\settings.json.bak` before the build. Manual was confirmed before shutdown (`final-manual.json`, `shots/final-manual.png`). After shutdown the backup was restored; Git `cmp.exe` exited **0**, and the restored SHA-256 matched the backup (`settings-restore.txt`, `settings-restore-hash.txt`).
- Build: first locked `build-dev` invocation could not start `sh` from PATH (`spawn sh ENOENT`, exit 1). Retried with `C:\Program Files\Git\bin\sh.exe`: `ptah-electron:build-dev` exit **0** (`build.log`); `copy-wasm.js` exit **0** (`wasm.log`); `ptah-electron:copy-renderer-dev` exit **0** (`renderer.log`). All successful steps used the `electron-live-test` machine lock. No install, other build, test, lint, typecheck, or verify target was run.
- Launch: `apps/ptah-electron/scripts/launch.js` with `PTAH_CODEX_RUNTIME_DEV=1`, `PTAH_NO_DEVTOOLS=1`, isolated `PTAH_DB_PATH`/`PTAH_SESSIONS_DB_PATH` in F and workspace `F\ws`.

## Rollouts (`~/.codex/sessions/2026/11/02/`)

| Session | Rollout file | Native contexts and evidence |
| --- | --- | --- |
| Parent | `rollout-2026-11-02T17-13-47-01a19cd2-dc3c-7680-ae77-a7c9363246e9.jsonl` | Lines 8 and 45: first prompt and follow-up `turn_context`, both `gpt-5.6-luna` / `untrusted`. Line 24: one completed `spawn_agent` call; line 32: one completed `wait` call; line 40: final text `The sub-agent said: **PINEAPPLE**.`; line 52: final `OK.`. |
| Child | `rollout-2026-11-02T17-13-52-01a19cd2-f223-74a2-8d7b-c5d007774da7.jsonl` | Line 8: one `turn_context`, `gpt-5.6-luna` / `untrusted`, with the same root turn as the parent's first context. Line 16: completed child output `PINEAPPLE`. |

## Verdicts

| Scenario | Expected | Observed | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| 1. Sub-agent | Card appears in chat and agents panel; closes exactly once as completed; parent quotes child output. | One `codex done · 2s` card was visible in the live parent chat. Opening it showed the child lane, `done`, and `PINEAPPLE`; the parent replied `The sub-agent said: PINEAPPLE.` The parent rollout has one completed spawn and one completed wait. The live open-to-close transition was missed, so the exact UI closure count was not observed. | **PARTIAL** | `shots/t1-final.png`, `shots/t1-child-detail.png`, `t1-monitor.json`; parent rollout lines 24, 32, 40; child rollout line 16. |
| 2. History after reload/reopen | Both user bubbles, both assistant replies, and the same sub-agent card/output remain, with no duplicate or missing items. | After renderer reload and selecting the session from the sidebar, both user bubbles and both assistant replies remained once each. The sub-agent card and lane were absent (`turn-agent-chip` count 0); child output was only quoted in parent text. Resume reported `HISTORY_FAILED`. | **FAIL** | `shots/history-reload.png`, `shots/history-reopened.png`, `reload.json`, `reopen.json`; `app-run1.log` 1563–1565, 1742–1747; `app-run1.err.log` 58, 71. |
| 3. D9 M1 follow-up | `Say OK.` in the same parent tab streams and finishes idle, without Stop or skeleton. | The same tab streamed an `OK.` branch, then returned idle; Stop was absent and the user bubble appeared once. | **PASS** | `t2.json` samples at 33, 1182 and 1373 ms; `shots/t2-followup.png`; parent rollout lines 45, 52; `final-manual.json` (`stop: 0`). |
| 4. `thread/list` warnings | Capture any WARN entries and their issue paths. | **No `thread/list` WARN entries** in either app log, and no issue filesystem path was reported. Two DEBUG failures did name method `thread/list` and reason `Codex invalid protocol frame`; the matching WARN entries were `chat:resume` `HISTORY_FAILED` with the session ID only. | **PASS (capture)** | `app-run1.log` 1563–1564, 1742, 1746; `app-run1.err.log` 58, 71. |
| 5. Legacy/proxy logs | Zero legacy SDK-query marker and zero translation-proxy start logs. | Exact marker `[SessionLifecycle] Starting SDK query with options:` occurred **0** times; translation-proxy start patterns occurred **0** times in `app-run1.log` and `app-run1.err.log`. | **PASS** | Both app logs; log scan recorded in this report. |

Screenshots were visually inspected against the requested chat-card, lane, history, idle-state, model, and Manual-mode checks. No separate design reference was supplied.

## New gaps

1. **Sub-agent history is lost on reload.** The parent text and both turns rehydrate, but the completed `codex` card and child lane do not. The native child rollout still contains `PINEAPPLE`. `chat:resume` hit `Codex invalid protocol frame` for `thread/list` twice (`app-run1.log` 1563, 1742) and returned `HISTORY_FAILED` twice (`app-run1.err.log` 58, 71). This run does not establish whether that resume failure is the sole cause of the missing card.
2. The live child lane displayed `PINEAPPLE` while also saying `No saved output for this agent` (`shots/t1-child-detail.png`). The meaning of that empty-output notice was not determined.

## Blocked / not done

- The initial live-monitor helper threw after the first prompt was sent. Monitoring resumed after the turn completed; therefore the card's running state and exact-once close transition were not captured. No extra paid prompt was sent to repeat it because the child and follow-up exhausted the three-context cap.
- A full app restart was not attempted; renderer reload and sidebar session re-selection were completed. The latter required a forced Playwright click because the selected rail-card surface intercepted ordinary clicks.
- No matching skill invocation mechanism was exposed to this CLI for this live-test task, so no skill was loaded. Repository source files were not edited.
