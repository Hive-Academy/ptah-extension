# Visual Review - TASK_2026_678_9083 - Phase E rounds 5 and 6 (short targeted check, head 2501d9670)

## Verdict

**NEEDS_REVISION, 7/10.** N-1, R4-4 and R3-1 are fixed and the dark and light idle pages show no regression. N-2 is fixed for a
clean workspace switch, but I found a new race (S-1 below) that leaves the page bound to the old session with the new workspace
label, and a command typed in that state is sent into the old workspace's session. Narrow trigger, real consequence, so Serious.

Counts: Blocking 0, Serious 1, Moderate 1, Minor 3.

## Launch commands

All from the worktree root, `NX_DAEMON=false`, one heavy process at a time, output filtered with `tail`.

1. `npx nx build-dev ptah-electron --parallel=1` (52 s, ok), then `npx nx copy-renderer-dev ptah-electron --parallel=1` (1 m 53 s, ok).
2. `tasklist //FI "IMAGENAME eq electron.exe"` showed none before launch.
3. `NODE_ENV=development ./node_modules/electron/dist/electron.exe --remote-debugging-port=9334 --use-fake-ui-for-media-stream
   --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=%TEMP%\ccv3\cmd16.wav dist/apps/ptah-electron/main.mjs`
   (real `Ptah Dev` profile, log `%TEMP%\ccv3r6\electron.log`). Port 9333 never touched.
4. Driven with `playwright-core` `connectOverCDP('http://127.0.0.1:9334')`, scripts in `%TEMP%\ccv3r6\`. Sizes other than the real
   892x735 are `page.setViewportSize` emulation (the "1440px x 900px" badge in one dark screenshot is that emulation overlay).
5. Synthetic aids (runtime only, no source edit): fake delegated agents (`AgentMonitorStore._agents`), a roster card
   (`pendingProposal.set`), a pending question (`store.setPendingInput`), and for the guard check `store.setSession(marked, sid,
   'D:\\simulated-previous-workspace')` to hold the "workspace differs from active" state open. All reset afterwards.
6. Closed at the end with `taskkill //F //IM electron.exe //T`; `tasklist` shows none.

## Screenshot table

Directory: `reports/visual/phase-e-r6/` (git-ignored).

| File | Theme | Viewport | State |
| --- | --- | --- | --- |
| dark-1440x900-n1-pre.png, -n1-final.png, -n1-t0.png | dark | 1440x900 | N-1: bogus `main.mjs` workspace, typed command fails; error toast and status "error" |
| dark-1440x900-n2-after-switch.png | dark | 1440x900 | switching in the sidebar from a workspace whose saved view was Chat (page unmounts by design) |
| dark-1440x900-n2-ptahfinalrunws-after.png, -n2-clean-to-*.png | dark | 1440x900 | clean switches with the page mounted (page follows) |
| dark-1440x900-n2-switch-window.png, dark-1440x900-n3-stuck.png, -n3-stuck-after-send.png | dark | 1440x900 | S-1 stuck state: new workspace label, old marked tab, "0 nodes" |
| dark-1440x900-n2-guard-status.png, -n2-guard-typed.png | dark | 1440x900 | refusal toast when the store workspace differs from the active one |
| dark-1100x700-3n.png, -3n-wheel-after.png | dark | 1100x700 | R4-4, two columns, rail not overflowing |
| dark-1100x700-roster-question-top.png, -scrolled.png | dark | 1100x700 | R3-1, roster card |
| dark-1100x700-24n-question-top.png, -scrolled.png | dark | 1100x700 | R3-1, 24 nodes plus pending question |
| dark-1440x900-idle.png, light-1440x900-idle-menu-closed.png | dark, light | 1440x900 | regression look (`light-1440x900-idle.png` has the theme menu open, a capture artefact) |

## Status of the checked items

| ID | Status | Evidence |
| --- | --- | --- |
| N-1 failed start is silent | **FIXED** | Bogus `main.mjs` workspace, typed "Say hello in five words.": at 0.5 s `shownSessionStatus` = `error` (header "Session new - error"), toast "The Command Center turn could not finish." in the alert region, tab `loaded`, messages 6 -> 8. It stays `error` and the toast stays (checked at +4 s). No billed turn: the start fails with the spawn error. `dark-1440x900-n1-final.png`. |
| N-2 page stays bound to the old workspace (clean switch) | **FIXED** | With the page mounted (the other workspace's saved view is Command Center) the page is the same element before and after. `store.workspace()` and `markedTabId` follow within about 170 to 250 ms with no navigation: `ptah-final-run-ws / ae228d (session dc4806)` <-> `main.mjs / 71e384`, stage keeps the Ptah node, `nodes` 1. Switching to a workspace whose saved view is Chat unmounts the page by design (`workspace-coordinator.service.ts:161-183` swaps the view slice), so it cannot be stale there. |
| N-2 refusal in the switching window | **FIXED (guard), see S-1 for the residual race** | With the store workspace forced to differ from the active one: the real Status button click gives the toast "Command Center is switching to the selected workspace. Send again when it is ready." and the marked tab's message count stays 6 and status `loaded` (no turn sent). A typed command plus Enter gives the same toast, count stays 6, and `canSend()` starts the reopen: the store workspace returns to `ptah-final-run-ws` within 2.5 s. The real window (active changed, store not yet) is under one frame, so I could not hit it by pointer; the forced state is the evidence. |
| R4-4 wheel over non-overflowing rail | **FIXED** | 1100x700, columns 416 px + 336 px, rail 420 of 420 (not overflowing). Wheel 300 over the work list, over the lower rail and over the stage each move the page 0 -> 120 (r3: 0 -> 0 over the list). The work list `ul` is `overflow-y: auto` but does not overflow, so it does not capture the wheel. `dark-1100x700-3n-wheel-after.png`. |
| R3-1 rail scrolls, answer controls reachable | **FIXED (still holds)** | Roster card + question at 1100x700: rail 420 of 803, wheel moves rail top 0 -> 383, then the page 0 -> 120 (chaining at the end works); Decline (81x48) and Confirm Tribunal (140x48) are `hit` by `elementFromPoint` after the rail scroll (blocked by the dock before it, as in r3, reachable by scrolling). 24 nodes + question: rail 420 of 1797, scrolls to 1377; at the top the answer input (300x48) and Send answer (116x48) at y 442 and 502 are `hit`. Confirm was not clicked. |

## New findings

### Blocking

None.

### Serious

**S-1. An in-flight send overwrites the new workspace binding, leaving the page on the old session (wrong-workspace send).**
Reproduced twice, deterministically. From `main.mjs` (page mounted), a typed command is sent in the same task as the sidebar click
that switches to `ptah-final-run-ws`. The switch rebinding runs first and is correct (`ws = ptah-final-run-ws`, marked `ae228d`,
session `dc4806`), then about 350 ms later the send resolves and sets the page back to
`ws = ptah-final-run-ws`, marked `71e384` (the old workspace's tab, no longer in the active tab list), session empty, status
`idle`. Log of the poll: `after-send typed -> true ... marked 71e384, sess ""`. The stage shows "0 nodes" and no Ptah sphere
(`dark-1440x900-n2-switch-window.png`), the same symptom as r3 N-2. It is stuck there until the user leaves the page and returns.
Cause: `session-coordinator.ts:264-265` after `await this.sender.send(...)` calls
`store.setSession(tabId, sessionId, this.store.workspace())` and `setSessionStatus('running')` with the `tabId` captured before the
await, and nothing checks that the binding is still the one the send started on. In the stuck state `store.workspace() ===
tabs.activeWorkspacePath`, so the new guard (`:239-249`) and `canSend` both pass. A typed command then goes to the old tab: tab
`71e384` (workspace `main.mjs`) messages 13 -> 14, status `streaming`, while the page header says "idle" and the workspace is
`ptah-final-run-ws`; the backend log shows `chat:continue` for that session. Trigger: pressing Enter (or a voice transcript ending)
and switching workspace within the roughly 0.4 s the send takes. Narrow, but a wrong-workspace turn that the page reports as idle.
Fix: in `send` re-check after the await (`markedTabId() === tabId` and `workspace() === tabs.activeWorkspacePath`) and skip the
`setSession`/`setSessionStatus` writes when the binding moved; or write the result into the tab-scoped status only.
Not checked: the same race for the Tribunal launch turn and for `answerQuestion` (same write pattern is likely).

### Moderate

- **M-1. Refused send discards the typed text.** After the "switching" refusal the input is empty
  (`dark-1440x900-n2-guard-typed.png`, placeholder shown). The user must retype the command that the toast tells them to send again.
  Fix: clear the input only when `sendCommand` returns true.

### Minor

- **m-1. Stale "switching" toast.** The "switching to the selected workspace" toast stays after the rebinding finished (the store
  workspace was back to normal at +2.5 s and the toast was still shown). Dismiss it on a successful rebind.
- **m-2. Error toast persists and pushes the dock** (carried r3 M-2): the N-1 toast does not auto-dismiss and moves the dock down by
  about 60 px, so the input and mic are cut by the fold at 900 px high (`dark-1440x900-n1-final.png`).
- **m-3. Idle dock hint cut at 900 px high** (carried r3 M-3/stacked layout family): the second hint line of the dock is at the fold
  in the idle screenshots; reachable by page scroll.

## Quick regression look (check 4)

Dark (Anubis) and light (Anubis Light) at 1440x900 idle: geometry identical in both themes (stage 756x620 at 274,128; rail 336x620
at 1046,128; dock 1108x162 at 274,764; input 285x44; mic 56x56), page scroll height 902 for a 860 client height. Compared with
`phase-e-r3/dark-1440x900-idle.png` and `light-1440x900-idle.png`: same header, stage, sphere, selected-card and work-list copy, same
colors; the only difference is the page text (no reply card because this run's session has no reply on the page). Nothing new
broken. The theme was restored to Anubis at the end.

## Could not reach

- The true switching window (active workspace changed, store not yet rebound) by real pointer: it is less than one frame.
  Covered with the forced state, as described above.
- Whether the Tribunal Confirm and `answerQuestion` paths share the S-1 race (not clicked, per the rules).
- Real voice turn: not run (no billed voice turn needed for these checks).

## Side effects (billed turns)

**Two real model turns ran, over the budget of one**, both caused by my S-1 reproduction, not by the checks themselves:
the in-flight typed command of the race (it ran in the `ptah-final-run-ws` session, cost about $0.13) and the typed command sent from the
stuck state (about $0.12). N-1 (no turn, spawn fails), the guard checks, R4-4, R3-1 and the regression look billed nothing. The
sessions are in the `Ptah Dev` profile under `ptah-final-run-ws`, tab `71e384` ("Command Center") with a few "Say hello" /
"typed during switch" messages. The app added the `.opencode/agent/` line to `.gitignore` (left for the orchestrator to remove).
Electron closed.
