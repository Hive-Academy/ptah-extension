# Live Electron test p8j (head cd947b54c), Codex App Server runtime

- Date: 2026-10-29. Model: gpt-6-sol only. Approval mode Manual except in D14a. CDP port 9336.
- Paid turns used: **8 of 10** (T1 to T8), one run (app restarts only). Run 1 pid 42436; later restarts 38484, 28140, 23952, 20448, 44460, 1844, 43952 (this worktree's roots only, stopped with `taskkill /T /F`).
- Evidence folder F: `C:\Users\abdal\AppData\Local\Temp\ptah-live-p8j-20261029\` (`app-run1..8.log`, `app.log` = all joined, `build.log`, `shots\`, `settings.json.bak`, `settings.after.json`, `mark-*.txt` log line offsets, helper scripts).
- settings.json restore: `cmp settings.json.bak ~/.ptah/settings.json` = **identical (CMP_OK)**. `settings.after.json` differs from the backup at line 47 (the app wrote settings during the run); it was restored to the backup.
- Build: `build-dev`, `copy-wasm.js`, `copy-renderer-dev` all exit 0. No foreign Ptah Dev root electron held the single-instance lock. Launch env as specified. Setup via UI: OpenAI Codex, gpt-6-sol, saved to This workspace, Manual (via "Disable Autopilot").
- Note: `git status` in the worktree shows `M .ptah/specs/TASK_2026_714_c8a2/batches.md` and `decisions.md`. I did not touch them (edited by another agent during the run).
- Legacy marker `Starting SDK query with options:` = **0** in all app logs.

## Verdicts

| Scenario | Expected | Observed | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| A (8p-1 read auto-accept) | 0 read cards for plain reads | **3 cards in 2 turns**, every read still prompted. `[CodexChatApprovalSink] accepted read-only command.` logged **0** times (no sink line at all). | **FAIL** | `shots\t1-approval1.png`, `t2-approval1/2.png`; app-run1.log lines 1486-1618 (`mark-t1/t1end/t2/t2end`) |
| Q (question card dismissed on Stop) | Card gone within seconds, stays gone after tab switch, idle, no error | Card ("Do you prefer option A or option B?") shown at +6.1 s. Stop clicked. Card gone in **0.5 s**, stayed gone 3 s later and after Apps/Chat tab switch. Rail went `done`, Stop button gone, no error banner. Log: `AskUserQuestion aborted` then `Cleaning up pending permissions` + `Pending permissions cleanup complete`, then `chat:abort success`. Minor: stale `sr-only` live-region text ("Question needs an answer in ws", session tile "... needs you") remained after the card was gone (invisible, 1x1 px). | **PASS** (minor gap: stale sr-only announcement) | `shots\q-card.png`, `q-after-stop.png`, `q-tabswitch.png`; app-run1.log 1619-1657 |
| Q follow-up T4 "Say OK." | Works normally | Replied "OK." with no error (0 `Chat error`/`CODEX_RUNTIME_FAILED`/`CODEX_BUSY`). | **PASS** | `shots\t4.png`; app-run1.log 1667-1686 |
| I (8p-2 first follow-up after restart) | One reply, no CODEX_BUSY, prompt delivered once | After full restart the chat was restored; T5 "Say OK again." gave exactly one "OK.". 0 `CODEX_BUSY`/"busy"/error lines. The rollout has one user message and one `turn_id` for the prompt. | **PASS** | `shots\t5.png`; app-run2.log 941-978; rollout `rollout-2026-10-29T18-19-31-01a1883e-...jsonl` lines 77-78 |
| D14a (policy-change refusal) | Mode change, restart, T6 shows "Codex cannot resume this chat because its execution profile has changed..." | **Refusal never reached.** (1) Changing the mode on a thread that is open (after a turn in the same app run) is rejected by the adapter: `config:autopilot-toggle failed CodexChatAdapterError: Codex chat permission: runtime-failed` (3 tries). The chip stays Manual and the UI shows **no error**. (2) Changing the mode while no thread is open works (chip updates, log `Autopilot state updated`). After a restart, T6 (Auto-edit), T7 (Plan Mode) and T8 (Full Auto/YOLO) all resumed and answered "OK." with **no refusal**. The rollout `turn_context` for every turn stayed `approval_policy: untrusted`, `sandbox_policy: workspace-write`: the resumed thread keeps its original policy while the chip shows the new mode. | **GAP** (refusal path not reachable via UI; the mode shown does not match the effective Codex policy) | `shots\d14-mode2.png`, `d14-enabled.png`, `d14b-enabled.png`, `d14c-plan.png`, `d14d-full.png`, `t6/t7/t8.png`; app-run2.log 996/1044/1091; rollout policy lines |
| Mode back to Manual | Manual | Chip reads "Approval mode: Manual" at the end | done | `shots\back-manual.png` |

## Read commands captured (scenario A)

Wrapper (rollout `command` array, 3 elements): `["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe","-Command","<body>"]`, cwd = workspace `F\ws`. Card text: `"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -Command '<body>'`.

- T1: `Get-Content -LiteralPath README.md -TotalCount 40`
- T2: `Get-Content -LiteralPath package.json -TotalCount 3`, then `Get-ChildItem -LiteralPath . -Name`

All three are plain single-cmdlet reads of the thread folder, yet all showed a card. `hasReason`: **not available**, because the sink's `accepted read-only command` line was never emitted (0 occurrences in app.log). Whether the requests carried a `reason` cannot be told from the app log. No file content appeared in logs (card text only shows the command).

Cause of the missed auto-accept is not determined. Candidates, none verified: (a) the session's `permissionLevel` is not `'ask'` when the chip shows Manual (the first toggle logged `{"enabled":false,"permissionLevel":"yolo"}`, i.e. Manual = autopilot off with the level string left at `yolo`); (b) `threadCwd` / `systemRoot` / path resolution failing closed (`acceptIfRealPathsStayInside` swallows errors and falls back to the card without a log line); (c) the cwd arriving as a `file:` URI (3 of the rollout entries show `cwd: file:///C:/...`). The sink logs nothing on a non-accept, so nothing in the log separates these. Reading the code: `codex-chat-approval-sink.ts:120` (the `'ask'` gate), `:127` (`threadCwd` gate), `:155-170` (fail-closed path check).

## New gaps

1. Mode change on an open Codex thread fails with `Codex chat permission: runtime-failed` and the UI shows nothing (chip silently stays on the old mode).
2. Mode change before a resume is accepted by the UI but has no effect on the Codex policy (`untrusted` / `workspace-write` kept for Auto-edit, Plan, Full Auto). The chip can show Full Auto (YOLO) while permission cards still apply. D14a's refusal text therefore cannot be triggered this way.
3. Approval sink gives no diagnostic when it declines to auto-accept (no log line), so a failed allowlist match is invisible.
4. After a restart the reloaded transcript can drop a reply: the 6:29 PM turn ("Say OK once more.") showed "OK." live in T7 but no reply on reload in run 8 (same family as the earlier "gap D" transcript reload issues). Also the T4 prompt/reply ("Say OK.") was missing from the transcript after the first restart.
5. Stale `sr-only` "needs your attention" announcements remain after a question card is dismissed by Stop.

## Blocked / not done

Nothing blocked. D14a was not completed as written because the refusal could not be reached (see above); no further paid turns were spent after T8.
