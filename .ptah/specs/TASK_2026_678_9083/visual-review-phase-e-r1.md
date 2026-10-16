# Visual re-review after Phase E revise round 1 - TASK_2026_678_9083 (voice Command Center page)

Head `be433c363`, worktree `D:/projects/ptah-extension/.claude-worktrees/command-center`. The reviewer ran the real DEV Electron
app on the real `Ptah Dev` profile (local STT base.en + local TTS af_heart). Screenshots: `reports/visual/phase-e-r1/` (83 PNG).
Prototype references reused from `reports/visual/proto-*.png`. Standard: WCAG 2.2 AA (the repo declares none), 3:1 for UI
components and focus indicators, 4.5:1 for text.

## Verdict

**NEEDS_REVISION.** 0 Blocking, 6 Serious, 7 Moderate, 6 Minor. Score 6.5/10.

The layout round fixed what it targeted: the page scrolls at every window size (N1), nothing is clipped at 1440 and 1600 (N2),
the command input is usable (N3), the toast is readable and no longer covers the card (N4), and F-1, M-1, M-d, M-c, M-f, M-h are
fixed. What stops approval: the turn still does not settle for voice turns (N5 only partly fixed, and `speaking` is never shown
while TTS plays), the roster layout regresses with a long roster (stage stretches to 1515 px and pushes the dock out of reach),
and the light pending-card input contrast fix did not take effect.

## Launch commands

All from the worktree root, `NX_DAEMON=false`, one heavy process at a time, output filtered with `tail`.

1. `npx nx build-dev ptah-electron --parallel=1` (45.7 s, ok)
2. `npx nx copy-renderer-dev ptah-electron --parallel=1` (67 s, ok; `assets/command-center/pcm-capture.worklet.js` present)
3. Fake audio: `%TEMP%\ccv3\cmd16.wav` (16 kHz mono PCM, "Say hello in five words.", 2 s silence either side, via PowerShell
   `System.Speech` + a Node script that rewrites a canonical 44-byte header). The first copy had a wrong header and gave a silent
   mic; Electron was restarted with the corrected file (only processes I started were stopped).
4. `NODE_ENV=development ./node_modules/electron/dist/electron.exe --remote-debugging-port=9334 --use-fake-ui-for-media-stream
   --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=%TEMP%\ccv3\cmd16.wav dist/apps/ptah-electron/main.mjs`
   (real profile `%APPDATA%\Ptah Dev`, not locked; no `main.mjs` patch, no profile copy). `electron.exe` check: none running before launch.
5. Driven with `playwright-core` `connectOverCDP('http://127.0.0.1:9334')`, scripts in `%TEMP%\ccv3\`. Widths other than the real
   window (892x735) are `page.setViewportSize` emulation. Themes via the app theme menu (Anubis, Anubis Light).
   Synthetic aids (runtime only, no source edit): injected pending question (`store.setPendingInput`), 24 synthetic delegated agents
   (`AgentMonitorStore._agents`, session id `syn-session-1`), a rejecting `getUserMedia` stub (removed afterwards), a `sendCommand`
   stub while testing TTS playback (removed afterwards, `hasOwnProperty` false).
6. Selecting workspace `ptah-final-run-ws` is required: the app opens with the bogus workspace entry `main.mjs` selected and a
   chat start there fails (see Serious S-E).

## Screenshot table (key ones)

| File | Theme | Viewport | State |
| --- | --- | --- | --- |
| dark-892x735-open.png, launch-real.png | dark | 892x735 real | first view of the page, header chip |
| dark-892x735-idle-top/wheel/bottom.png | dark | 892x735 | wheel scroll reaches the dock (input 268 px) |
| dark-892x735-pending-top/wheel/bottom.png, light-892x735-pending-*.png | both | 892x735 | pending card, work list, dock reachable |
| dark-900x800-pending-*.png, light-900x800-pending-*.png | both | 900x800 | stacked layout scrolls |
| dark-1440x900-pending-top/bottom.png, light-1440x900-pending-*.png | both | 1440x900 | one-row dock, Send answer visible |
| dark-1600x1000-pending-*.png, light-1600x1000-pending-*.png | both | 1600x1000 | nothing clipped |
| dark-1440x900-mic-denied.png, light-1440x900-mic-denied.png, light-892x735-mic-denied.png | both | 1440 / 892 | toast, recovery link |
| dark-1440x900-turn1-running.png, -settled.png | dark | 1440x900 | typed turn running (Stop on) then idle with reply |
| dark-1440x900-failed-start-running.png, -after-stop.png, -after-start-new-failed.png | dark | 1440x900 | failed chat start never settles |
| dark-1440x900-reopen-idle.png, nav-away.png | dark | 1440x900 | F-1 reopen |
| voice-dark-listening/thinking.png, voice-dark-turn3-muted.png, chat-surface-after-voice-turn.png | dark | 1440x900 | real voice turns, unsettled until Chat is shown |
| speak-dark-playing-state-listening.png, speak-dark-listening/thinking/muted.png | dark | 1440x900 | TTS plays while HUD says Listening |
| dark/light-1440x900-24n-top/mid.png, dark-1600x1000-24n-*.png, dark-900x800-24n-*.png | both | 1440 / 1600 / 900 | 24 nodes (light-1440x900-24n-mid.png shows the app theme menu over the page) |
| dark/light-chip-hover/focus/click-settings.png | both | 1440x900 | provider chip |
| dark/light-settings-voice-engines.png, -stt-details.png, -tts-details.png, light-settings-searchvoice.png | both | 1440x900 | Settings > Search & Voice |
| dark/light-1440x900-idle-fresh.png | both | 1440x900 | idle, versus prototype |
| light-focus-0..6.png, light-892x735-pending-focus-3.png | light | 1440 / 892 | keyboard focus stops |

## Previous findings

| ID | Status | Evidence |
| --- | --- | --- |
| N1 page scroll | FIXED | Host `ptah-command-center-page` is the single scroll owner (`overflow-y:auto`, scrollHeight 1180 vs 695 at 892x735). Wheel moves scrollTop 0 -> 485 (idle) / 767 (with pending card) and reaches dock, pending card, work list, selected card. Keyboard Tab auto-scrolls each stop into view. Command input 268 px (892), 276 px (900). Dark and light. `dark-892x735-pending-bottom.png`, `light-900x800-pending-bottom.png`. |
| N2 clipping at 1440 / 1600 | FIXED | Dock bottom 884 / 900 (1440) and 984 / 1000 (1600); recovery link visible at y 834 (`dark-1440x900-mic-denied.png`); no `100vh` overflow; Stop bounding box 63x48 fully inside the viewport (the focus ring was not captured while Stop was enabled because the running window is short; geometry has 16 px of slack). |
| N3 / M-h input width, dock row | FIXED | Input 285 px at 1440, 370 px at 1600. Dock is one row at 1440 (container 1150 px, HUD 519 + controls 551) and 1600, as in the prototype; wraps cleanly below. |
| N4 toast contrast | FIXED | `bg-base-100 text-base-content`: 14.86:1 dark, 15.92:1 light. Dismiss button 14.86 / 15.92. |
| M-f toast covers selected title | FIXED | Toast sits in rail flow above the card: toast y 128-178, card title y 231-259 (1440). At 892x735 the toast is below the fold, see Moderate. |
| N5 turn settles | PARTIAL | See "Voice states reached" and S-A/S-B. Typed turn: running -> idle in about 5 s, reply card "Hello there, nice to meet.", `lastTurnStateRevision` = 2. Two real voice turns stayed `streaming`/running for 60-90 s (backend logged "Session stats received", no reply); after opening the Chat surface the tab flushed to `loaded`, rev 2, reply "Hello, it's great seeing you.". |
| F-1 reopen shows idle | FIXED | Navigate Tasks -> Command Center on an idle session: badge reads "Session 1dbd3340 . idle" in 6 consecutive samples at 150 ms, never "running". |
| M-1 Mute / Stop / Start voice during typed turn | FIXED | Mic never started: Mute disabled, Stop enabled, Start voice enabled (`dark-1440x900-turn1-running.png`). |
| M-d stale "Microphone muted" after Start new | FIXED | Muted + running session, Start new -> HUD "Ready for your voice", Mute/Stop disabled (`dark-1440x900-after-start-new-muted.png`). |
| M-a pending card | PARTIAL | "Send answer" fully visible, no card clipping (FIXED). Light input border still 1.21:1 and placeholder 3.28:1 (OPEN, S-D). Dark: border about 4.5:1, placeholder 9.75:1. |
| M-b plates | PARTIAL | With 24 nodes the Ptah plate is visible at 1440, 1600 and 900; no two plates overlap (0 overlaps at all three); every plate is 44 px high, two-line sized (widths 100-156 px). New defects: stray plate over the stage header (S-F), only 2 plates at 900, Ptah plate far from its sphere at 900. |
| M-c light delegate marks | FIXED | Delegate spheres show white provider glyphs on blue pearls in light (`light-1440x900-24n-mid.png`). |
| M-e shell tab strip scrollbar over labels | OPEN | Unchanged at 892/900: scrollbar and arrows cover "Chat", "Apps", "Tasks" (`dark-892x735-open.png`). |
| M-g disabled controls | OPEN | Disabled Send/Mute/Stop still 1.76:1 dark, 1.46:1 light (exempt under 1.4.3, reads as missing). |
| Badge 10 px | OPEN (Minor) | `text-[11px]` is set (`command-center-page.component.ts:139`) but the computed size is still 10 px (daisyUI `.badge` wins). The chip itself is 11 px. |

## Voice states reached

| State | Reached | Evidence |
| --- | --- | --- |
| idle | yes | `dark-1440x900-idle-fresh.png` |
| running (typed turn) -> idle | yes | badge running -> idle in about 5 s, node running -> idle, reply card shown, rev 2 |
| listening | yes | real fake-mic capture, ring teal, HUD "Listening to you / Mic level is live" (`voice-dark-listening.png`) |
| thinking | yes | local `voice:transcribe` of the fake utterance took 5.6 s, then the transcript was sent (`voice-dark-thinking.png`) |
| muted | yes | Mute / Unmute round trip |
| mic denied (simulated) | yes | typed toast, HUD "Voice needs attention", recovery link, Start voice stays enabled |
| speaking | NO (real turn) | no voice turn settled while the page was open (S-A). With the real TTS path forced (`voice.speak(...)`, no model cost) the audio played (`playback.playing` true, output level 1, about 6 s) but the HUD stayed "Listening to you" and the sphere ring stayed teal, so `speaking` is never visible (S-B). |
| listening after reply | n/a | same cause |
| barge-in / interrupt | inconclusive | the looping fake mic speech overlapped playback once; playback ended after 2.8 s which equals natural completion, so no interruption can be claimed |

Also checked: after a voice turn the marked tab has `lastTurnStateRevision` undefined until the Chat surface is shown (then 2).
Billed model turns: 3 (see Side effects).

## Provider chip and Settings parity (user request, item 10)

- Header chip: "Local . base.en / af_heart" with a green readiness dot, 214x44 px, 11 px mono, text 14.21:1 light / 14.86:1 dark.
  Tooltip and aria-label: "Voice: speech-to-text Local base.en, ready; text-to-speech Local af_heart, ready. Open voice settings".
  Visible focus ring 2 px (`dark-chip-focus.png`, `light-chip-focus.png`). Click opens Settings (`light-chip-click-settings.png`).
- Settings > Search & Voice > VOICE ENGINES (both themes): table Direction | Provider | Model / Voice | Status | Details.
  Speech-to-text: "Local (Whisper / Kokoro)" provider select, "base.en", status badge "Ready". Text-to-speech: same provider, "af_heart", "Ready".
  Details drawer ("Voice engines", opens from the chevron buttons) has Source (Curated / HF repo id / Local folder), the Whisper model
  select (tiny.en ... large-v3-turbo), a Download row with "Downloaded" badge and a "Ready" button; the TTS tab adds the Kokoro voice
  select (Heart (US, female) ...), "Downloaded" badge, Preview and Ready (`light-settings-stt-details.png`, `dark-settings-tts-details.png`).
- **Parity: AGREE.** Model/voice (`base.en`, `af_heart`) and status (Ready) are identical in the chip text/tooltip and the Settings rows.
  The chip uses the short provider name "Local" while Settings spells "Local (Whisper / Kokoro)" (Minor, a documented decision in
  `phase-e-r1b-report.md` F-4). The ElevenLabs row could not be compared live without changing the user's provider config (not done);
  the table renders the same four cells for both providers from one template.
- Minor: the status word "Ready" is only in the tooltip/aria-label; the visible chip carries a coloured dot only.

## New findings

### Blocking

None.

### Serious

**S-A. Voice turns do not settle while the page is on Command Center (N5 still partial).** Two real voice turns (after the typed one)
stayed `tab.status = streaming`, page "running", node "running", no reply card, rev undefined for 60-90 s although the backend
logged "Session stats received" (turn cost 0.011 / 0.012). Opening the Chat surface flushed the buffered stream: tab `loaded`, rev 2,
reply shown. The page-visible registration in `libs/frontend/command-center/src/lib/components/command-center-turn-status.ts:33-43`
skips registration when the tab is already in `visibleTabIds()` (`:38`) and only unregisters its own registration. Likely cause
(hypothesis, not proven because the turn budget was spent): a tab that the Chat surface had registered before is left to that surface,
which unregisters it on leaving, so the page loses the stream. The typed turn that settled ran on a tab created by Start new.
Screenshots: `voice-dark-turn3-muted.png`, `chat-surface-after-voice-turn.png`. Fix: hold the registration with a ref count, or
register unconditionally and unregister only what the page registered.

**S-B. The `speaking` state is never visible while local TTS plays.** `command-voice-loop.ts:519` sets `speaking` at enqueue time, but the
next mic frame resets it to `listening` because playback has not started yet (`:278-280`: `!playing && !busy && voiceState === 'speaking'`),
and `finishTurn` does the same (`:543`). Local synthesis took about 3.5 s before audio started; from then on playback runs while the
HUD says "Listening to you" and the ring is teal (`speak-dark-playing-state-listening.png`). The user hears the reply with no speaking
feedback and cannot tell when to interrupt. Fix: set `speaking` when playback actually starts (playback `onStart`) and keep it until it ends.

**S-C. A long roster stretches the stage and pushes the dock out of reach.** With 24 delegates the grid row takes the rail's natural height:
stage 756x1515 at 1440x900 (916x1515 at 1600x1000), dock at y 1659 (host scrollHeight 1797 vs 860), Ptah sphere and plate at
y 976 (below the 900 fold). The mic, Stop and command input are about 1000 px below the first screen while 24 agents run
(`dark-1440x900-24n-top.png`, `-mid.png`). `command-center-page.component.ts:53-57` (`grid-template-rows: minmax(0,1fr) auto`, `.layout flex: 1 0 auto`)
and `:66-68` (`.stage flex: 1 1 auto; min-height: 420px`). Fix: cap the work list height (`max-h` with its own scroll, as before) or
make the stage row `minmax(420px, 640px)` and let the rail scroll inside it.

**S-D. Light theme pending-card input: border 1.21:1 and placeholder 3.28:1 (M-a/S3 not fixed).** The class change at
`command-pending-input.component.ts:116` (`border-base-content/50`, `placeholder:text-base-content/80`) never wins: the theme rule
`[data-theme="anubis-light"] .input { border-color: oklch(var(--b3)) }` has higher specificity, so computed border stays
`oklch(0.91586 0.006 53.44)` and the placeholder `rgba(.., 0.5)`. Fails 1.4.11 and 1.4.3. `light-1440x900-pending-bottom.png`.
Fix: use an `!important`/arbitrary-property override or a wrapper border (the session input uses a bordered form and measures 14.21:1).

**S-E. A failed chat start leaves the page "running" forever.** With the bogus `main.mjs` workspace selected the turn was sent, the backend
logged `spawn ... ENOTDIR` and "Stream ended: aborted" with 0 events, yet the tab stayed `streaming`, the badge "running" and no
toast appeared. Stop set the store to `stopped` but the shown status stayed "running" because `shownSessionStatus` derives it from
the tab (`command-center-turn-status.ts:15-18`). Only Start new recovered (`dark-1440x900-failed-start-running.png`,
`-after-stop.png`). Fix: on stream error/abort set the tab to loaded or show an error toast and settle the shown status.

**S-F. A stray plate sits on top of the stage header with a long roster.** At 24 nodes the plate "Review release plan 23 / Grok . completed"
renders at the stage's top-left corner over "LIVE ORCHESTRATION / idle . 25 nodes" at 1440, 1600 and 900
(`dark-1440x900-24n-top.png`, `dark-900x800-24n-top.png`): unreadable overlap of two texts. Source: overlay plate placement,
`libs/frontend/command-center/src/lib/components/command-overlay.component.ts` (the node's projected position is missing, so it
falls back to the origin). Fix: skip the plate when its anchor is not projected, or clamp it inside the keep-out area.

### Moderate

- M-r1-1 Focus order differs from visual order in the stacked layout (<720 px): Tab goes plate -> "Type an answer" (rail, scrollTop 767) ->
  Start voice (dock, scrollTop 316). DOM order is stage, aside rail, dock (`command-center-page.component.ts:153,202,296`) while CSS
  `order` puts the dock before the rail (`:85-98`). WCAG 2.4.3 / 1.3.2. `light-892x735-pending-focus-3.png`.
- M-r1-2 Focus ring colour `oklch(0.72 0.18 55)` is 2.20-2.46:1 on the light surfaces (7.05:1 dark); below 3:1 for the focus indicator.
- M-r1-3 At 892x735 the error toast sits at y 977 (below the fold) and the recovery link at y 739-787; after clicking Start voice the user
  sees only "Voice needs attention" (`light-892x735-mic-denied.png`). The alert role announces it, sighted users do not see it.
- M-r1-4 Shell tab strip scrollbar overlays the labels at 892/900 (M-e, `electron-shell.component.ts` not changed).
- M-r1-5 Disabled Send/Mute/Stop contrast unchanged (M-g).
- M-r1-6 At 900x800 with 24 nodes only 2 plates show and the Ptah plate sits in the stage's top-left corner (289,240) about 280 px from its sphere.
- M-r1-7 The "+1 completed" overflow chip at 900x800 has a square lighter backing box at the stage corner (`dark-900x800-24n-top.png`).

### Minor

- Session badge computed 10 px (below the 11 px floor), see table.
- Pending description scroll region: a 4-line description shows a thin scrollbar with arrows and clips the last line at 1440/1600
  (`dark-1440x900-pending-bottom.png`); only a synthetic long text was tested.
- At 892 the header wraps: "Voice settings" drops under the chip and badge (about 120 px tall header).
- The orange outline on the session input is cut at the right edge where it meets the send button (`dark-1440x900-turn1-settled.png`).
- No FPS meter; Stop is not red; the idle selected card has no "Ordinary Ptah chat session" lines (prototype extras, carried over).
- Chip status is colour only on screen (text only in the tooltip), see parity section.

## Region comparison vs prototype (idle, 1440x900, both themes)

| Region | Result |
| --- | --- |
| Header (eyebrow, h1, session, voice settings) | Matches in structure; provider chip now present ("Local . base.en / af_heart" instead of "LOCAL VOICE"); badge and "Voice settings" use heavy white outlines versus the prototype's subtle gold chrome. No serif heading. |
| Stage (orbits, gold P, plate, hints) | Matches (gold P orb in both themes, dark P in light, one plate under the sphere, hints at the foot); FPS line missing. |
| Rail (selected card, work list) | Matches; selected card lacks the prototype's two meta lines. |
| Dock (mic orb, level meter, Mute, Stop, input, Start new) | Matches in order and is one row at 1440; Status button is an addition; Stop is white, not red; the mic orb is a round 56 px orange ring (the prototype uses a gold rounded square). |
| Pending card | Matches (compact, "Action required" eyebrow, Send answer visible). |
| Mic-denied | Matches in behaviour (toast, recovery link). |

## Accessibility (WCAG 2.2 AA) summary

- Text contrast on all page text: 5.2-15.9:1 light, 5.65-14.9:1 dark (eyebrows 5.21 / 6.18, muted 5.39 / 5.65); disabled controls exempt but 1.46-1.76:1.
- Targets: chip 214x44, Voice settings 123x48, plates 44x44+, mic orb 56x56, Start new 94x48, toast dismiss 26x32 (>= 24x24 AA).
- Focus order (wide): chip, Voice settings, Ptah plate, Start voice, input, Start new, Status; every stop shows a 2 px ring; in light the ring is 2.2-2.5:1.
- Roles: toast `role="alert"` (error) / `status`, chip aria-label, session badge `role="status"`.

## Could not reach

- A real `speaking` state and barge-in (voice turns never settle on this page, S-A; budget of 3 model turns was spent).
- The Stop focus ring while Stop is enabled at 1440/1600 (geometry checked instead).
- A live ElevenLabs row for the Settings parity (would require changing the provider config).
- Pending card with real choice buttons (a synthetic injected question without choices was used; no extra model turn).

## Side effects

- **Billed model turns: 3** (typed "Say hello in five words." $0.2024 turn cost incl. cache creation; two voice turns "Say hello in 5 words." $0.0114 and $0.0120; about $0.23 total).
  One extra chat start failed before reaching the model (bogus workspace, no cost). STT/TTS ran locally (free). "Status" was not clicked.
- Real profile: two sessions of "Command Center" in workspace `ptah-final-run-ws` were resumed/extended; one notification (bell badge "1")
  from the completed turns. No Settings value was changed (drawers only opened). The `main.mjs` workspace entry already existed in the
  profile copy used by the previous review (visible in `cc-dark-892x735-real-pending.png`), so it is not new.
- **`.gitignore` was modified by the app: a line `.opencode/agent/` was added (`git diff` shows +1 line).** Not committed. The
  orchestrator should revert it (`git checkout -- .gitignore`). Other git changes are the pre-existing spec files.
- Processes: I started Electron twice (PIDs 18180, then 5960); both trees stopped with `taskkill /T /F`. `electron.exe` count 0; port 9334 is closed.
  The stale `127.0.0.1:9333` entry (PID 21596) is untouched.
- Files written outside the repo: `%TEMP%\ccv3\` (scripts, wav, logs). Repo: this report and the PNGs in `reports/visual/phase-e-r1/`.

## Decisions

- Used direct `voice.speak()` with a stubbed `sendCommand` to exercise the real local TTS path without a model turn (options: spend a 4th turn,
  or skip). Evidence of the defect (S-B) comes from the unmodified playback code; the stub only prevented transcripts of the looping fake mic
  from becoming billed turns. Reversible, stub removed.
- Did not remove the `main.mjs` workspace entry from the profile (it pre-existed).
- Filed the stray plate as Serious (between Moderate and Visual breaking: text collision, not a layout break).
