# Visual Review - TASK_2026_678_9083 (voice Command Center page, gate B18)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 3/10 |
| Assessment | NEEDS_REVISION (one Blocking functional defect, several Serious; see verdict note) |
| Blocking | 2 |
| Serious | 8 |
| Moderate | 6 |
| Minor | 3 |
| Viewports tested | 892x735 (real default window), 900x800, 1440x900, 1600x1000 (viewport emulation), dark and light |
| Screenshots | 62 PNG files in `reports/visual/` (incl. 17 prototype captures) |
| Regions tested | scene, voice HUD, pending-input card, work list, session controls, toast, tooltip, shell tab |

Verdict note: the severity counts above include a Blocking item, which under the visual-reviewer
rubric is REJECTED. The requested verdict vocabulary is APPROVED or NEEDS_REVISION, so the verdict is
NEEDS_REVISION with the Blocking items called out first. Treat it as "not mergeable as is".

## Environment

- Build under review: head `eb52cdbb9`, worktree `D:/projects/ptah-extension/.claude-worktrees/command-center`.
  The worktree `dist/` held a stale `main.mjs` (Oct 16 01:14, older than head) and no `renderer/` or `preload.js`,
  so I rebuilt only what `nx serve ptah-electron` would build (skipping its `rebuild-native` step, which would write to the shared `node_modules`).
- Exact commands (all from the worktree root, `NX_DAEMON=false`, one heavy process at a time):
  1. `npx nx build-dev ptah-electron --parallel=1` (45 s, exit 0: main, preload, workers, wasm)
  2. `npx nx copy-renderer-dev ptah-electron --parallel=1` (96 s, exit 0: webview development build copied to `dist/apps/ptah-electron/renderer`)
  3. `NODE_ENV=development ./node_modules/electron/dist/electron.exe --remote-debugging-port=9333 dist/apps/ptah-electron/main.mjs`
     (background; profile `%APPDATA%/Ptah Dev`, so it did not collide with the user's installed `Ptah.exe`).
- Driving: `playwright-core` `chromium.connectOverCDP('http://127.0.0.1:9333')` from scripts in `%TEMP%\ccv\` (outside the repo).
  Window resize through `Browser.setWindowBounds` is not supported by this Electron (`Browser.getWindowForTarget` not found),
  so widths other than the default were produced with `page.setViewportSize` (viewport emulation). Emulation resets when the script disconnects,
  which is why `cc-dark-1440-after-send-*.png` and `cc-dark-default-first.png` are at the real window size 892x735.
- Theme was switched through the app's own theme menu (Anubis / Anubis Light, ThemeService writes `data-theme`). Left on Anubis (dark), the original.
- Route reached through the shell tab "Command Center" (`electron-shell.component.ts:150-157`, `openCommandCenter()`), then "New Command Center".
- Base: Electron `file://.../renderer/index.html`, CSP from `apps/ptah-electron/scripts/copy-renderer.js:161`.
- Stopped at the end: the Electron process tree I started (port 9333 no longer answers). No dev server, nx daemon or node helper of mine remains.
  The user's installed `Ptah.exe` was not touched.
- Prototype: `prototype/command-center.html` opened in installed Chrome at 1440x900 and 900x800, dark and light, preview states idle / 24 nodes / question / mic denied.

### Side effects of running the real app (please read)

- `git status` now shows ` M .gitignore` (adds `.opencode/agent/`). That is Ptah's harness-sync managed block rewriting the file at app start. I did not revert it (no discarding git commands allowed). Revert before commit if unwanted.
- The launch argument `dist/apps/ptah-electron/main.mjs` was registered as a workspace named "main.mjs" in the `Ptah Dev` profile (bogus folder; it made the first session creation fail until I selected a real workspace).
- Workspace used: `ptah-final-run-ws`. Three real chat turns were sent to Claude (about $0.36 for the first; trivial prompts), producing 3 sessions in that workspace.
  No tool was approved; the question tool was answered with `release/next`.
- Delegated nodes in the multi-node screenshots are synthetic: I wrote 5 / 23 fake `MonitoredAgent` entries into `AgentMonitorStore._agents` through `window.ng` (dev build). They exist only in the renderer memory and are gone after the process exit.

## Screenshots

All under `.ptah/specs/TASK_2026_678_9083/reports/visual/`.

| File | Theme | Viewport | State |
| --- | --- | --- | --- |
| shell-initial.png | dark | 892x735 | shell before opening the page (workspace "main.mjs" bogus) |
| cc-dark-default-first.png | dark | 892x735 | page, no session (empty scene) |
| cc-dark-wide-1600-idle.png | dark | 1600x1000 | page, no session |
| cc-dark-default-1440-newsession.png | dark | 1440x900 | after New Command Center (bogus workspace, no session) |
| cc-light-1440-fresh-empty.png | light | 1440x900 | after New Command Center, no session yet |
| cc-dark-1440-typed.png, cc-dark-1440-after-send-0..5.png | dark | 892x735 | first text turn running, root orb appears |
| cc-dark-default-1440.png, cc-dark-default-1440-session.png, cc-dark-default-1440-after-turn.png | dark | 1440x900 | session with root (status stays "running") |
| cc-light-default-1440.png | light | 1440x900 | same state |
| cc-dark-narrow-900.png | dark | 900x800 | root only |
| cc-light-narrow-900.png, cc-light-narrow-900-top.png | light | 900x800 | root only (second one scrolled to top) |
| cc-dark-wide-1600.png, cc-light-wide-1600.png | dark/light | 1600x1000 | root only |
| cc-dark-hover-start-voice.png | dark | 1440x900 | hover on Start voice |
| cc-dark-1440-voice-0..3.png | dark | 1440x900 | after Start voice: mic error, toast, Start disabled |
| cc-dark-focus-0..5.png | dark | 1440x900 | Tab stops (scene plate, link, work row, buttons, input) |
| cc-light-1440-pending.png | light | 1440x900 | pending question card |
| cc-dark-1440-pending.png | dark | 1440x900 | pending question card |
| cc-dark-1440-answer-chosen.png | dark | 1440x900 | card gone after clicking a choice |
| cc-dark-1440-after-approval-attempt.png | dark | 1440x900 | second send had no visible effect (approval card not reached) |
| cc-dark-1440-5nodes.png | dark | 1440x900 | 5 synthetic delegates |
| cc-dark-1440-23nodes.png, cc-dark-1440-23nodes-measured.png | dark | 1440x900 | N=24 stress |
| cc-light-1440-23nodes.png | light | 1440x900 | N=24 stress |
| cc-dark-narrow-900-23nodes.png, cc-light-narrow-900-23nodes.png | dark/light | 900x800 | N=24 stress, stacked layout |
| cc-dark-wide-1600-23nodes.png, cc-light-wide-1600-23nodes.png | dark/light | 1600x1000 | N=24 stress |
| cc-dark-1600-node-hover.png, cc-dark-1600-node-selected.png | dark | 1600x1000 | plate click, tooltip card |
| proto-{dark,light}-{1440,900}-{idle,24-nodes,question,mic-denied}.png, proto-dark-1440.png | both | 1440 / 900 | approved prototype (reference) |

## Findings

### Blocking

#### B1. Voice capture cannot start: the PCM AudioWorklet module is blocked by the renderer CSP

- Screenshots: `cc-dark-1440-voice-1.png`
- Source: `libs/frontend/command-center/src/lib/voice/pcm-capture.ts:95-97` (blob URL passed to `audioWorklet.addModule`), CSP `apps/ptah-electron/scripts/copy-renderer.js:161` (`script-src 'self'`, no `blob:`).
- Evidence: from the page, `getUserMedia({audio:true})` succeeds, while `audioWorklet.addModule(blobUrl)` rejects with `AbortError: Unable to load a worklet's module.` (worklet loading is governed by `script-src`, so `worker-src blob:` does not help). `pcm-capture.ts:131-133` turns it into `CaptureError('worklet')`, the toast reads "Microphone worklet. Use text or check microphone permissions."
- Impact: the listening, thinking, speaking, muted and barge-in states, which are the point of the page, are unreachable in this Electron shell. Only the text box works.
- Fix: load the worklet from a packaged same-origin file (`'self'`) instead of a blob, or add the allowance deliberately to the shell CSP and its `copy-renderer` test. Add a smoke check that `addModule` resolves under the real CSP.

#### B2. Scene spheres render at 45% of the specified size

- Screenshots: `cc-dark-default-1440.png`, `cc-dark-1440-5nodes.png`, `cc-dark-1440-23nodes.png` (vs `proto-dark-1440-idle.png`, `proto-light-1440-24-nodes.png`)
- Source: `libs/frontend/command-center/src/lib/scene/sprite-cache.ts:123` allocates `size * 2.2` px per sprite (glow padding), while `libs/frontend/command-center/src/lib/scene/command-scene-renderer.ts:258-264` draws that sprite into a `node.radius * 2` square, so the visible sphere is `size / 2.2`.
- Measured: Ptah sphere about 70 px against the specified 154 px (ring about 190 px so the sphere sits in a large empty circle); delegates about 26 px against 58 px, smaller than their own status ring (radius about 30). Prototype delegates are about 60 px and Ptah 154 px.
- Impact: the "illuminated orbital instrument" hero is a small bead, provider faces and marks are barely legible, and the status ring dominates the sphere. At N=24 the scene reads as rings, not spheres. This is a visual-breaking divergence from the approved prototype.
- Fix: draw the sprite at `size * 2.2` centred on the node (or crop the padding), then re-check the Ptah keep-out and label placement.

### Serious

#### S1. Mic error is mislabelled, persists forever and disables Start voice (dead end)

- Screenshots: `cc-dark-1440-voice-1.png`, `cc-light-1440-pending.png`
- Source: `command-center-page.controller.ts:48-56` classifies any toast containing "Microphone" as `mic-denied`; `command-voice-hud.component.ts:114-120` disables Start voice while `errorKind() === 'mic-denied'`; no dismissal path for `store.toast`.
- Problem: a worklet failure shows "Microphone permission was denied." (wrong cause; permission was granted). The toast and the HUD both persist across "New Command Center" and the 3 later turns; Start voice stays disabled, so even after the user fixes the real problem there is no retry. The "Open Voice settings" action is the recovery offered for an OS microphone problem, which does not match (prototype: "Open permissions").
- Fix: carry a typed error kind in the toast instead of string-matching, clear on retry/new session, keep Start enabled as the retry.

#### S2. "Open Voice settings" link fails contrast in both themes

- Screenshots: `cc-dark-1440-voice-1.png` (3.35:1), `cc-light-1440-pending.png` (1.25:1)
- Source: `command-voice-hud.component.ts:28-33` and `:38-43` (`btn btn-link`, 13px semibold). Measured by script: dark fg rgb(37,99,235) on rgb(26,26,32) = 3.35:1; light fg rgb(68,235,211) on rgb(239,234,230) = 1.25:1. WCAG AA 1.4.3 needs 4.5:1.
- Fix: use a state-ink/content token with AA contrast per theme (the repo already has `state-ink-contrast.spec.ts`).

#### S3. Text inputs have no perceivable boundary or focus ring

- Screenshots: `cc-dark-focus-5.png`, `cc-light-1440-pending.png`
- Source: `command-session-controls.component.ts:44` and `command-pending-input.component.ts:114` (`input input-bordered`). Measured: border `oklch(.925 .007 88 / 0.2)` = 1.72:1 dark; light 1.21:1 (needs 3:1, 1.4.11). Focus outline on the input is the same 20% alpha colour (`oklch(0.925 0.007 88 / 0.2)`) so the focus ring is a faint halo, while the buttons get a 2px opaque orange ring.
- Impact: in light theme the answer field is an unframed cream rounded bar next to a Send button; keyboard focus on the input is hard to see in both themes.
- Fix: opaque border token and `focus-visible:outline-warning` like the other controls.

#### S4. "Action required" eyebrow fails contrast in light theme

- Screenshot: `cc-light-1440-pending.png`
- Source: `command-pending-input.component.ts:24` (`text-xs ... text-warning`, 12px). Light 2.20:1 (needs 4.5:1); dark 6.18:1 passes. Card border light 2.46:1.

#### S5. Delegated work and plates carry no identity ("CLI agent" x N)

- Screenshots: `cc-dark-1440-5nodes.png`, `cc-dark-1600-node-selected.png`
- Source: `work-projection.ts:227` hard-codes the label `'CLI agent'` / `'SDK agent'`; `command-work-list.component.ts:64` and `command-overlay.component.ts:98` show raw metadata ("Provider: codex · Parent: Ptah · State: running", "Provider: Unknown").
- Problem: every lane is named identically, so plates and rows cannot be told apart except by logo. The prototype names work ("Architecture 1", "Codex · completed") and shows a status icon at the row end. `MonitoredAgent` already has `displayName`, `task`, `model`.
- Also: the root "Ptah" is listed as delegated work ("Delegated work · 1" with no delegation; 24 with 23 children).

#### S6. No Ptah hero before the first message, and its face loses the brand

- Screenshots: `cc-light-1440-fresh-empty.png`, `cc-dark-default-first.png`, `cc-light-default-1440.png`, `cc-light-1440-23nodes.png`
- Source: `command-center-page.controller.ts:188-194` returns an empty projection until the tab has a `claudeSessionId`; the first-run page shows only orbit lines and the HUD says "Voice · Idle". After the first turn the root face is the vendor mark (Anthropic "A\", or "P" for Unknown), not the approved gold "P" orb. In the light theme the mark is cream on cream and invisible (blank pearl).
- Impact: the approved empty state ("Ready for your voice" with the gold Ptah orb) is not what a user sees; nothing visible for the voice ring to attach to.

#### S7. Stop is disabled while a text turn is running

- Screenshots: `cc-dark-default-1440.png`, `cc-dark-1440-voice-1.png` (status "Command Center · running", Stop and Mute greyed)
- Source: `command-voice-hud.component.ts:107-113` (`canStop` requires `turnAbortable`, wired in `command-center-page.component.ts:121` as `voiceState === 'thinking'`). The design spec says Stop is never disabled while a turn can be aborted and stays actionable in every voice state. For a typed command the user cannot abort.
- Related behaviour seen: after the first turn finished (backend logged "Session stats received"), the page stayed "Command Center · running", node state "running", and the reply text never showed in the rail (`latestReply` null). I could not rule out a dev-environment cause; code-logic review should confirm.

#### S8. 24-node scene at the stacked layout: rings collide and no names are drawn

- Screenshots: `cc-light-narrow-900-23nodes.png`, `cc-dark-narrow-900-23nodes.png`
- Source: `command-center-page.component.ts:74` (`min-h-[320px]`; spec: stage 460 px under 720, 360 under 480 px). In a 600x320 stage the status rings of neighbouring nodes overlap each other and the Ptah voice ring (several spheres sit inside it), and 0 label plates are visible (script: `visibleLabels: 0`). Spec rule "never place a sphere inside Ptah's voice ring plus 12 px" is broken.
- At 1440x900 and 1600x1000 the stage is fine (9 and 12 plates, 0 overlaps, none outside the canvas), but Ptah's plate is hidden at 1440 (spec: Ptah, selected, awaiting and failed keep priority; several failed and awaiting nodes also have no plate).

### Moderate

- M1. Shell tab "Command Center" wraps to two lines at 892 and 900 px and its second line ("Center") spills below the 40 px title bar (also "Setup hub"); `electron-shell.component.ts:150-157` (`cc-dark-default-first.png`, `cc-light-narrow-900.png`).
- M2. Toast is an unstyled inline `<p>` at the top of the rail with no surface, icon, dismiss or auto-expiry (`command-center-page.component.ts:104-105`); inserting it shifts the HUD down 70 px (layout shift, `cc-dark-default-1440.png` vs `cc-dark-1440-voice-1.png`).
- M3. Pending card insertion pushes the work list about 330 px down and the rail starts scrolling (`cc-dark-1440-pending.png`); the prototype keeps the card compact. Answer field has no placeholder (prototype: "e.g. release/next").
- M4. Page chrome is much thinner than the prototype: header is bare text ("Command Center") with no session chip, provider/settings button, selected-node card, stage header/foot hints, FPS meter or mic orb dock. Session controls sit at the bottom of the rail rather than a dock, and "New Command Center" is the highest-contrast (white-bordered) control while Start voice is the primary orange (action hierarchy differs from "mic orb primary, session secondary"). The 56 px mic orb is absent.
- M5. Clicking a plate only opens a tooltip card (overlaps neighbouring nodes, `cc-dark-1600-node-selected.png`) and does not set selection (`selectedId` stayed null); selection exists only from the list. No visible selection halo reached.
- M6. Disabled controls (Stop, Mute, Interrupt speech, Send) are very low contrast (1.76:1 dark, 1.46:1 light); exempt under 1.4.3 but they read as missing; "New Command Center" has the same white border as a focus ring (confusing focus state).

### Minor

- m1. Body copy 12-13 px in rail (spec minimum 11 px: passes); helper text 5.4-5.7:1 passes.
- m2. Hover on Start voice shows no distinguishable change from rest (`cc-dark-hover-start-voice.png`, but the button was enabled only before the mic error).
- m3. Work-row text "Provider: Unknown" shows an internal placeholder for the root.

## Region comparison vs prototype

| Region | Result | Deviation |
| --- | --- | --- |
| Header (72 px bar, session chip, provider, theme, demo) | DEVIATES | Only a text title; no session chip or provider button (M4). |
| Stage panel / canvas | DEVIATES | No panel border or stage header/foot; spheres at 45% size (B2); empty state has no orb (S6). |
| Ptah hero orb | DEVIATES | Vendor mark instead of gold "P"; invisible mark in light (S6); small (B2). |
| Delegate spheres and plates | DEVIATES | 26 px, identical "CLI agent" names, provider chip/status icon missing (B2, S5). |
| 24-node layout | PARTIAL | Inner/outer ring geometry matches at wide; collides at stacked layout (S8); Ptah plate dropped at 1440. |
| Voice HUD / dock | DEVIATES | No mic orb, level meter or subtext; four equal text buttons; error copy wrong (S1, S7). |
| Pending question card | PARTIAL | Content, choices and answer field present; weaker hierarchy, no placeholder, contrast failures (S3, S4, M3). |
| Work list | DEVIATES | No status icons, raw metadata strings, root counted as work (S5). |
| Session controls | DEVIATES | Not a dock; "New" is the strongest control (M4). |
| Toasts | DEVIATES | Unstyled paragraph, no dismiss (M2). |
| Dark and light tokens | PARTIAL | Both themes render through app tokens; light has contrast failures (S2, S4) and an invisible orb mark (S6). |

## Viewport results

| Viewport | Layout | Status | Evidence |
| --- | --- | --- | --- |
| 892x735 (default window) | stacked (container under 720), page scrolls | functional; tab bar wraps (M1) | cc-dark-default-first.png |
| 900x800 | stacked, scene 600x320 | N=24 collides, no plates (S8) | cc-*-narrow-900*.png |
| 1440x900 | rail 336 px, scene 814x788 | ok at root and N=24 (no plate overlap, 9 plates) | cc-*-1440-*.png |
| 1600x1000 | scene 974x888 | ok (12 plates, no overlap) | cc-*-wide-1600*.png |
| Horizontal scroll | none at any width (`scrollWidth == innerWidth`) | pass | scripts |

## Accessibility audit (WCAG 2.2 AA; sources: design-spec "Accessibility and contrast", app theme tokens)

| Pair | Dark | Light |
| --- | --- | --- |
| Header, toast, HUD, list titles, buttons | 13.9 to 14.9 | 14.2 to 15.9 |
| Work-row meta and helper text (12 px) | 5.65 | 5.39 |
| "Open Voice settings" | 3.35 FAIL | 1.25 FAIL |
| "Action required" eyebrow | 6.18 | 2.20 FAIL |
| Input border / focus ring | 1.72 FAIL | 1.21 FAIL |
| Disabled controls | 1.76 (exempt) | 1.46 (exempt) |

- Targets: buttons 48 px tall, plates 44x51, work rows 70 px tall: pass.
- Tab order (dark): scene plate "Ptah", then HUD link, work row, New Command Center, Status, text input, then shell controls. Disabled Start is skipped. Order is logical; buttons show a 2 px orange ring; the input ring is the failure above. Scene canvas is `aria-hidden` with a role=group wrapper; the plate buttons mirror nodes.
- `role="status"` present on HUD messages and toast.

## Visual performance

- Meter text ("FPS idle") is not visible in the page (no stage foot), so FPS and p95 draw could not be read; no jank noticed in screenshots at N=24. Not measured.
- Layout shift: toast insertion (70 px) and pending-card insertion (about 330 px) both reflow the rail (M2, M3).
- Loading state: the first-paint empty scene has no skeleton or message; "No work in this session yet." only.

## What I could not reach

- Listening / thinking / speaking / muted / barge-in / transcription and playback errors: blocked by B1 (and would need a real provider).
- Tool-approval card: a second typed turn ("run echo hi with Bash") produced no pending card within 42 s and no backend log line; left alone to avoid more model spend.
- Tribunal groups (Crucible with satellites), terminal tribunal states, child-session nodes, N>24 overflow chip: need real runs; only CLI-agent nodes were synthesised.
- Reduced-motion and live FPS: not measured.
- Window resize through the OS window (unsupported over this CDP target); widths are viewport emulation.

## Verdict

**NEEDS_REVISION** (not mergeable: B1 breaks voice, B2 diverges from the approved prototype visibly).
Confidence: HIGH on B1, B2, S1 to S4 (measured and reproduced); MEDIUM on S7 status-stuck behaviour.
Key concern: voice cannot start under the shipped renderer CSP, and the scene draws spheres at under half the approved size.
