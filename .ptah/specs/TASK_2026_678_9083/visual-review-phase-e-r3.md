# Visual re-review after Phase E rounds 3 and 4 - TASK_2026_678_9083 (voice Command Center page)

Head `14a642675` (worktree `D:/projects/ptah-extension/.claude-worktrees/command-center`). Real DEV Electron app on the real
`Ptah Dev` profile (local STT base.en + local TTS af_heart), Chromium fake mic. Screenshots: `reports/visual/phase-e-r3/` (58 PNG,
git-ignored). Prototype references: `reports/visual/proto-*.png`. Standard: WCAG 2.2 AA (the repo declares none): 3:1 for UI
components, 4.5:1 for text. Previous review: `visual-review-phase-e-r1.md`.

## Verdict

**NEEDS_REVISION.** 0 Blocking, 2 Serious, 5 Moderate, 4 Minor. Score 7.5/10.

All round 3 and round 4 targets that the brief listed are fixed except R4-4 (wheel over a non-overflowing rail), and S-E is only
half fixed (the page settles, but the failed start is silent). Voice turns now settle on the page (also after Chat and back), the HUD
shows Speaking during playback, the 24-node roster no longer pushes the dock away, the Tribunal card is reachable by pointer in both
layouts, the stacked work list scrolls again, and the light input contrast passes. Two new Serious items were found: a failed chat
start shows nothing to the user, and switching the workspace while the page is open leaves it bound to the old workspace session.

## Launch commands

All from the worktree root, `NX_DAEMON=false`, one heavy process at a time, output filtered with `tail`.

1. `npx nx build-dev ptah-electron --parallel=1` (1 m 29 s, ok)
2. `npx nx copy-renderer-dev ptah-electron --parallel=1` (ok; the renderer chunk contains the round 4 `scrollToNewPendingCard` code)
3. `tasklist //FI "IMAGENAME eq electron.exe"` showed none before launch.
4. `NODE_ENV=development ./node_modules/electron/dist/electron.exe --remote-debugging-port=9334 --use-fake-ui-for-media-stream
   --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=%TEMP%\ccv3\cmd16.wav dist/apps/ptah-electron/main.mjs`
   (real profile `%APPDATA%\Ptah Dev`; log `%TEMP%\ccv3r3\electron.log`). Port 9333 never touched.
5. Driven with `playwright-core` `connectOverCDP('http://127.0.0.1:9334')`, scripts in `%TEMP%\ccv3r3\`. Window sizes other than the
   real 892x735 are `page.setViewportSize` emulation. Workspace `ptah-final-run-ws` selected first. Themes via the app theme menu.
6. Synthetic aids (runtime only, no source edit): 3 and 24 fake delegated agents (`AgentMonitorStore._agents`), a Tribunal roster card
   (`page.pendingProposal.set(...)` with `options[0] = 'Decline'` so the card validates, and the private `handledRosterQuestionId`), a
   pending question (`store.setPendingInput`), a store toast (`store.setToast`), and for R3-2 the private `busy` / `awaitingBoundary`
   flags plus a no-op `onFrame` (so the looping fake mic cannot interfere). All removed or reset afterwards.
7. Closed at the end: `taskkill //F //IM electron.exe //T`; `tasklist` shows none.

## Screenshot table (key ones)

| File | Theme | Viewport | State |
| --- | --- | --- | --- |
| dark-1440x900-idle.png, light-1440x900-idle.png | dark, light | 1440x900 | idle, versus prototype (light shows a real reply card) |
| dark-1440x900-24n-top.png, dark-900x800-24n-top.png | dark | 1440x900, 900x800 | 24 nodes, dock on first screen, no stray plate |
| dark-1100x700-roster-3n/24n-arrived/wheel/bottom.png | dark | 1100x700 (two-column) | roster card arrives, rail wheel scroll |
| dark-892x735-roster-3n/24n-arrived/wheel/bottom.png | dark | 892x735 (stacked, 560 px container) | roster card, page scroll |
| light-1100x700-roster-*, light-892x735-roster-* | light | 1100x700, 892x735 | same, light |
| dark-892x735-24n-worklist-wheel.png | dark | 892x735 | stacked work list scrolls inside its cap |
| dark-1100x700-3n-wheel-nooverflow.png, dark-1100x700-24n-rail-end.png | dark | 1100x700 | R4-4 wheel behaviour |
| voice-dark-listening/thinking/speaking/playing-speaking/settled/muted.png | dark | 1440x900 | real voice turn (S-A, S-B) |
| dark-1440x900-voice-turn-after-return-settled.png, chat-surface.png, dark-1440x900-back-from-chat.png | dark | 1440x900 | voice turn after Chat and back |
| r32-pending-speaking/after.png, r32-nopending-speaking/after.png | dark | 1440x900 | R3-2 |
| light-1440x900-pending-question.png, light-*-question-bottom.png | light | 1440, 1600, 900, 892 | S-D contrast, N1/N2 |
| dark-1440x900-failstart-t2.png, -failstart-toast.png, -failstart-3s.png | dark | 1440x900 | S-E failed start (no toast) |
| light-1440x900-toast.png | light | 1440x900 | toast pushes the dock |

## Previous findings status

| ID | Status | Evidence |
| --- | --- | --- |
| S-A voice turns do not settle | FIXED | Real voice turn on the page: tab `streaming` -> `loaded`, rev 1 -> 2, page "running" -> "idle", node running -> idle at 37.6 s, reply card shown; a second turn in the same run also settled (rev 4). After Chat and back (`v2`), a new voice turn settled in 11 s (tab loaded, rev 6, idle) without opening Chat (`dark-1440x900-voice-turn-after-return-settled.png`). |
| S-B speaking never shown | FIXED | HUD "Ptah is speaking / Playing Ptah audio / Interrupt speech" while `playback.playing` (46.7 s, `voice-dark-playing-speaking.png`); afterwards `listening` or `thinking` according to the next state; no "playing while Listening" line was logged. |
| R3-2 question spoken mid-turn | FIXED | `busy=true`, pending set, `onPendingPrompt` spoken: `speaking` for both clips (no flicker between clips), then `listening` (HUD "Listening to you", `r32-pending-after.png`). Same with no pending input: ends `thinking`. Caveat: `busy` was forced, not a real mid-turn question. |
| S-C 24 nodes push the dock away | FIXED | 1440x900: stage 756x620, rail 336x620 (scrolls, scrollHeight 1535), dock y 764, mic 817-873, input 793-837 (all on the first screen). 900x800: mic 675-731 in view; see Moderate M-3 for the input. |
| R3-1 rail scroll, Decline/Confirm reachable | FIXED | 1100x700 two-column (3 and 24 nodes): the rail scrolls by wheel (0 -> 735), on arrival the card is scrolled into view once (rail top 135, `elementFromPoint` hits Decline 719,487 and Confirm Tribunal 808,487), no re-scroll after re-renders (`o1`: rail top 0 stays 0). 892x735 stacked: the page scrolls to the card (665 px), Decline 287,674 and Confirm 376,674 hit inside the 735 viewport. Same in light. Latest reply readable by scrolling up in the rail (see Minor m-1). |
| S-D light input contrast | FIXED | Light pending question input: border `oklch(.23574 .066 313.19 / .5)` = 3.28:1 against the input background (3.19:1 against the card), placeholder `/ .8` = 8.7:1. |
| S-E failed chat start | PARTIAL | The tab no longer stays "running": it settles to `loaded` / page "idle" in under 1 s. But no fixed-text toast is shown (see Serious N-1). |
| S-F stray plate over the stage header | FIXED | 24 nodes at 1440x900 and 900x800: only the Ptah plate (top-left, 15,67) and one real plate are shown; the others are hidden (position 0,0 of the page). No text over "LIVE ORCHESTRATION". |
| R4-1 stacked work list scroll | FIXED | 892x735 and 900x800: `.work-list-region` overflow-y auto, 560x384 box, scrollHeight 1351; wheel over it scrolls the list 0 -> 300, page stays at 700. |
| R4-4 wheel over a non-overflowing rail | OPEN | Two-column, rail not overflowing (3 nodes, 1100x700): wheel over the work list or the lower rail does not scroll the page (page top 0 -> 0 over the list; 0 -> 120 over the stage and over the selected card). Setting `overscroll-behavior: auto` on the rail at runtime makes it scroll (0 -> 120), so `contain` causes it. See Moderate M-1. |
| N1 page scroll at every size | OK | Host scrolls at 1440 (902/860), 1600, 900x800 (1658/760), 892x735 (1658/695); no horizontal scroll. |
| N2 nothing clipped at 1440/1600 | OK | Mic, input and card buttons inside the viewport at the top and after scrolling. |
| N3 command input usable | OK | Typed commands sent at 1440. |
| N4 toast readable | OK, with a layout side effect | See Moderate M-2. |

## New findings

### Blocking

None.

### Serious

**N-1. A failed chat start is silent (S-E only half fixed).** With the bogus `main.mjs` workspace, a typed command ends with the
backend logging `spawn ... ENOTDIR` and "Stream ended: aborted" (0 events). The page goes running -> idle in under 1 s
(`store.setSessionStatus` log: `running`, `idle`), the tab is `loaded`, `lastTerminalReason` is null, no terminal pulse exists, and the
store toast stays null. The user sees the input clear and "idle" and no reply or error on the Command Center page; the only trace is
the app bell counter and an assistant message in the Chat surface ("Session could not be resumed..."). Cause:
`command-center-turn-status.ts:81-96` treats `failed` as `lastTerminalReason` set and not 'completed'; an aborted start has no reason,
so the branch settles to `idle` and the toast at `:93` is not raised. Screenshots: `dark-1440x900-failstart-toast.png`,
`dark-1440x900-failstart-3s.png`. Fix: treat a streaming -> not streaming transition with no reply (messages unchanged, no assistant
text since the send) as `error` and raise the same fixed toast.

**N-2. Switching the workspace while the page is open leaves it bound to the old workspace session.** After selecting
`ptah-final-run-ws` from the sidebar while the Command Center was already shown, the sidebar highlights the new workspace but
`store.workspace()` stays `...\dist\apps\ptah-electron\main.mjs` and `markedTabId` stays the old session (`71e384...`); the stage briefly
showed "0 nodes" with no Ptah sphere (`light-1440x900-idle.png` first capture). Navigating to Chat and back re-bound it
(`ws = ptah-final-run-ws`, marked tab `ae228d`). A command typed in the meantime would go to the old workspace session (not sent, to
avoid a billed turn; the binding evidence is the store values). Likely cause: the workspace/marked-tab binding is made at page
creation, not on workspace change (`command-center-page.controller.ts` marked-tab effect). Fix: react to the workspace signal
(re-mark or reset the page) or show which workspace the page runs in.

### Moderate

- **M-1 (R4-4).** `.rail { overscroll-behavior: contain }` (`command-center-page.component.ts:78-80`) blocks wheel chaining to the page
  when the rail does not overflow: at 1100x700 with few nodes the work-list and lower-rail area (about a quarter of the content width)
  does not scroll the page. Also at the end of an overflowing rail further wheel does not move the page (24 nodes, rail top 1115 of
  1115, page 0). Fix: `overscroll-behavior: auto` on the rail (verified at runtime), or set `contain` only while the rail overflows.
- **M-2 Toast pushes the dock.** The error toast is an in-flow banner above the dock (287,777 1082x50 at 1440x900): the dock moves
  down 60 px, the mic orb is cut by the fold (`light-1440x900-toast.png`) and the input target moves from y 793 to 852 while the user
  may be clicking it. Fix: reserve the toast row, or overlay it (fixed position) without moving the dock.
- **M-3 Stacked layout, command input on the first screen.** At 900x800 and 892x735 the dock is at y 649-905: mic and Stop are on the
  first screen but the command input is at 772-816 (viewport 800 and 735), so it is partly or fully below the fold with or without a
  roster (stage min-height 460 plus header). It is reachable by page scroll. Carried from round 1, not caused by the roster.
- **M-4 "+1 completed" chip backing box (carried M-r1-7).** A square lighter box sits at the stage corner at 1440 and 900, and at
  1100x700 the chip overlaps the "SELECT A SPHERE FOR STATUS" hint (`dark-1100x700-roster-24n-arrived.png`).
- **M-5 Ptah plate far from its sphere with 24 nodes (carried M-r1-6).** At 900x800 and 1440x900 the Ptah plate is in the stage's
  top-left corner (15,67) about 300 px from the sphere; the other plates are hidden.

### Minor

- m-1 On arrival the rail auto-scroll (135 px) puts the pending card in view but scrolls the selected card and the latest reply
  out of the 420 px rail; scrolling up reveals them. By design of `block: 'nearest'`; consider keeping the reply's first lines visible.
- m-2 `.work-list-region` keeps `tabindex="0"` in the two-column layout where it no longer scrolls (scrollHeight == clientHeight 1351):
  a redundant tab stop (code review R4-4).
- m-3 The reply card shows raw markdown (`**Hola, Bonjour...**`) (`light-1440x900-idle.png`).
- m-4 The dock is 162 px tall at 1440x900 versus the prototype's single 80 px row, so the page scrolls 42 px at 1440x900 where the prototype
  needs none (`dark-1440x900-idle.png` versus `proto-dark-1440-idle.png`).

## Region comparison vs prototype (idle, 1440x900)

Dark (Anubis) and light (Anubis Light) match the prototype structure: header with eyebrow, h1, provider chip, session badge, Voice
settings; stage with gold P orb, orbits, one plate, hints; rail with selected card and work list; dock with mic, level meter, Mute,
Stop, input, Start new. Known deviations (unchanged from round 1): no serif heading, no FPS line, selected card without the two
meta lines, white Stop (not red), round orange mic orb (prototype: gold rounded square), added Status button, two-row dock. Not
regressed by rounds 3 and 4.

## Accessibility (WCAG 2.2 AA) spot checks

- Light pending input border 3.28:1 (needs 3:1), placeholder 8.7:1 (needs 4.5:1).
- Pending card buttons: Decline 81x48 / Confirm Tribunal 140x48 (>= 24x24).
- Roster card buttons are hit-testable (`elementFromPoint`) in both layouts and themes after the auto-scroll.
- Toast has `role="alert"`; HUD changes and the status badge are text, not colour only.

## Could not reach

- A real mid-turn question or roster proposal spoken during a live model turn (would need the model to ask one; R3-2 was checked with
  forced `busy`/`awaitingBoundary` and a no-op `onFrame`).
- The real Tribunal confirm path (paid spawn; Confirm and Decline were never clicked).
- Whether a command typed after N-2 really goes to the old workspace (not sent, to avoid a billed turn).
- Barge-in by the user speaking over playback (the looping fake mic gave no clean interruption).

## Side effects

- 3 billed model turns (two voice turns in one run, one more after Chat and back; about 0.01 each) in workspace `ptah-final-run-ws`.
- 3 failed chat starts in the `main.mjs` workspace (no model cost); app bell shows 3 notifications.
- Theme returned to Anubis (it was Anubis at start); the selected workspace is left on `ptah-final-run-ws`.
- `.gitignore` got the app's `.opencode/agent/` line (left for the orchestrator). `dist/` rebuilt (git-ignored).
- Electron closed; no electron.exe left.

## Decisions

- Treated 892x735 as the stacked layout (container 560 px < 720) and used 1100x700 (container 768 px) as the two-column case; the
  brief's "892x735 in the two-column layout" does not occur at that window size.
- Rated N-2 Serious on the stored binding values alone (not on a sent command), because a wrong-workspace send is not recoverable by
  the user and the "file in the higher class" rule applies.
- Counted "page shown stuck as running" only when the tab was `streaming`; the brief's "reply shown" was verified through the rev and
  message count plus the reply card.
