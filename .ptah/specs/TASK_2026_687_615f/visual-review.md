# Visual Review - TASK_2026_687_615f (Electron acceptance, head ef22bac4e)

## Verdict

**NEEDS_REVISION, 7/10.** No Blocking issue. Every plan item that was reachable passes, but the new icon-only tab
breakpoint leaves the tab labels clipped between 900 and 963 px (Serious), and the fixed toast covers the app header
(Serious). Counts: Blocking 0, Serious 3, Moderate 3, Minor 4.

## Launch and connection notes

- App already running from the worktree (`dist/apps/ptah-electron/renderer/index.html`, Electron 44.4.3). Connected with
  playwright-core `chromium.connectOverCDP('http://127.0.0.1:9334')`. Port 9333 untouched, nothing launched, closed or killed,
  no Nx/Jest/build. Scripts in `%TEMP%\cc687\` (not in the repo).
- Window was reported as 892x735 at the start; every other size is `page.setViewportSize` emulation. After the run the
  emulation is gone and the window reports its natural 1628x983 (it is no longer at 892x735).
- Themes: `data-theme` attribute set to `anubis` (dark) / `anubis-light` (light); ended on `anubis`.
- Workspace `ptah-final-run-ws`, session dc480655, Command Center page mounted. No model turn was billed: every send path was
  stubbed during the roster/confirm check (see "What was and was not exercised").
- Synthetic aids (runtime only, all reset at the end, no source edit): 24 fake delegated agents
  (`projectionSource.monitor._agents`), `store.setToast`, `store.setVoiceError`, `store.setPendingInput`, a roster card
  (`roster.pendingProposal.set` with `options[0]='Decline'`), temporary stubs of `roster.tribunal.confirm/decline`,
  `roster.transport.cancelDiscovery`, `coordinator.send/sendStatusTurn/sendLaunchTurn` and `page.retryInvalidDecline`.
  Reset verified: no own-property stubs left, `pendingProposal` null, agents `[]`, nodes 1.

## Screenshot table

Directory: `.ptah/specs/TASK_2026_687_615f/reports/visual/` (70 PNG).

| Pattern                                                                                | Theme | Viewports   | What                                              |
| -------------------------------------------------------------------------------------- | ----- | ----------- | ------------------------------------------------- |
| `shell-{dark,light}-{892x735,900x800,1100x700,1440x900}.png`, `shell-dark-800x735.png` | both  | 4 (+800)    | tab strip; 900x800 shows the clipped labels (F-1) |
| `page-{dark,light}-<vp>-idle.png`                                                      | both  | 4           | idle page, dock, input                            |
| `toast-{dark,light}-<vp>.png`                                                          | both  | 4           | error toast with Retry speech (F-2)               |
| `micfail-{dark,light}-<vp>.png`                                                        | both  | 4           | mic-denied recovery at stacked top                |
| `scene24-{dark,light}-{900x800,1440x900}.png`, `crop-*.png`                            | both  | 2           | 25 nodes, root plate, overflow pill               |
| `roster-*`, `question-*`                                                               | both  | 4           | roster card, mid-turn question card               |
| `confirm-typed-*`, `confirm-focus-*`                                                   | both  | 1440        | typed "confirm", Confirm focus ring               |
| `retry-decline-*`                                                                      | both  | 892         | Retry Decline toast button                        |
| `pin-1440-pinned.png`, `pin-900-after-relayout.png`                                    | dark  | 1440 to 900 | overlay unpin and focus handoff                   |
| `hub-*`                                                                                | both  | 1440        | Setup hub, Command Center card focus (F-3)        |

## Per-item results

| Item                                                           | Result                          | Evidence                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1a Tab labelled "Voice" with Mic icon                          | PASS                            | All 7 tabs have an svg; aria-label and title "Voice" (`shell-*`).                                                                                                                                                                                                                   |
| 1b No scrollbar over labels                                    | PASS                            | `::-webkit-scrollbar` display none, strip `overflow-x:auto` with `scrollbar-width:none`; 0 px scrollbar height at all sizes.                                                                                                                                                        |
| 1c Collapse to icons below ~900 px with tooltip and aria-label | PASS at <900                    | 892 and 800: label hidden, tab 40x32, `title` and `aria-label` set.                                                                                                                                                                                                                 |
| 1d Labels readable at 900 to 963 px                            | **FAIL (F-1)**                  | At 900x800 every label wraps under its icon and is clipped by the 32 px tab (`shell-light-900x800.png`). Wrap detected for 900..963 px, gone at 965.                                                                                                                                |
| 1e Labels do not shift                                         | PASS with Minor                 | 1440: 1 px drift when the active tab changes. Icon mode: subsequent tabs move 6 px (active tab is 46 px, others 40) at 800, 850, 892 (F-9).                                                                                                                                         |
| 1f Active tab kept in view                                     | PASS                            | At 560 and 480 px, selecting Setup hub moves `scrollLeft` 0 to 43 and 0 to 123 and the tab sits inside the strip.                                                                                                                                                                   |
| 1g All 7 tabs reachable at 800-900 px                          | PASS                            | At 800, 850, 892 the strip is 286 px, no overflow; Tab order Chat..Setup hub, all within x 182-468 (800).                                                                                                                                                                           |
| 2a Compact dock, input above fold, stacked                     | PASS                            | Input y 674-718 at 892x735 and 900x800 (above 735/800); 1100x700 y 589; 1440x900 y 789. No horizontal scroll at any size.                                                                                                                                                           |
| 2b Toast outside dock, no layout shift                         | PASS (layout)                   | With and without the toast, dock, input and stage rects are identical at 4 viewports x 2 themes. Toast is `position: fixed` (`command-center-page.component.ts:218`). See F-2 for the overlap it causes.                                                                            |
| 2c Mic failure and recovery at top of stacked page             | PASS                            | 892 and 900: recovery message y 403-479, "Open Voice settings" y 431, above the stage (y 517), inside the 735/800 fold. At 1100/1440 it stays in the dock (not stacked), at the fold bottom (y 778-826 of 700 at 1100; 850-926 of 900 at 1440), reachable by page scroll.           |
| 2d Disabled controls legible                                   | PASS (see F-8)                  | Dark Mute/Stop 5.60:1, Send 5.93:1; light Mute/Stop 3.68:1, Send 4.09:1 (settled values; first reads after a theme switch lag one frame). Native `disabled` kept.                                                                                                                   |
| 3a Focus ring contrast, light                                  | PASS                            | `focus-visible:outline-base-content` ring is oklch(0.236 0.066 313) = rgb(41,19,52): 14.2 to 15.9:1 against input, dock and card backgrounds (Voice settings, send, Start new, Status, Start voice, sphere label, input, Confirm Tribunal). Dark 13.9 to 14.9:1. 2 px, offset 2 px. |
| 3b Light pending input placeholder and border                  | PASS                            | Placeholder 6.21:1 (eff rgb 103,87,110 on 250,247,245); border 5.88:1 against the card, 6.59:1 against the input. Dark 7.68 and 7.36:1.                                                                                                                                             |
| 4a Root plate near root or leader                              | PASS at 1440, weak at 900 (F-6) | 1440, 25 nodes: plate beside the root sphere (upper left, about 70 px from the ring). 900: plate about 110 px from the ring, no leader drawn, sits next to a child node.                                                                                                            |
| 4b No canvas square behind overflow pill                       | PASS                            | `crop-pill-light-900.png`, `crop-pill-dark-1440.png`: text only.                                                                                                                                                                                                                    |
| 4c Pill clear of caption and hints                             | PASS                            | Pill (729,222,92x24) at 900, (917,177) at 1440; caption "01 / Voice command" sits above it (about y 195-208 at 900); "SELECT A SPHERE FOR STATUS" is bottom-left. No overlap.                                                                                                       |
| 5 Pinned plate hidden by relayout unpins and focuses its row   | PASS                            | 1440: pinned `cli:syn-0` with Enter (`pinnedNodeId` set, card open). Resized to 900: `pinnedNodeId` null, card closed, `document.activeElement` is the work-list row "Reviewer 1 / Codex / running" (`inWork` true). Selection retained.                                            |
| 6a Setup hub card opens with Space, no scroll                  | PASS                            | Real Space key on the focused card: `defaultPrevented` true, view switched to Command Center in dark and light.                                                                                                                                                                     |
| 6b Enter                                                       | PASS                            | Opens Command Center in both themes.                                                                                                                                                                                                                                                |
| 6c Visible focus on the card                                   | PARTIAL (F-3)                   | A 2 px amber outline is visible in both themes; light-theme contrast is 2.25:1 (dark 7.73:1).                                                                                                                                                                                       |
| 7a Mid-turn question card                                      | PASS (visual)                   | Card with Answer input and disabled Send answer renders at 4 viewports. At 892/900 it is at y 1061, below the fold (F-4).                                                                                                                                                           |
| 7b Click-only Confirm                                          | PASS (stubbed)                  | Typed "confirm" plus Enter in the dock input: `tribunal.confirm` calls `[]`, the text went to `coordinator.send` as an ordinary command. Clicking "Confirm Tribunal": one `confirm` call. Light and dark.                                                                           |
| 7c Retry Decline toast button                                  | PASS                            | `retry-decline` toast shows "Retry Decline" (96x32 px, 13.9 to 14.2:1) and a dismiss; a real click called `retryInvalidDecline` once.                                                                                                                                               |

## Contrast numbers (measured in the running app)

| Pair                                             | Light          | Dark           |
| ------------------------------------------------ | -------------- | -------------- |
| Focus ring vs surface (CC controls)              | 14.2 to 15.9:1 | 13.9 to 14.9:1 |
| Setup hub card focus ring vs page                | **2.25:1**     | 7.73:1         |
| Pending input placeholder                        | 6.21:1         | 7.68:1         |
| Pending input border (vs card)                   | 5.88:1         | 7.36:1         |
| Disabled Mute/Stop text                          | 3.68:1         | 5.60:1         |
| Disabled Send text                               | 4.09:1         | 5.93:1         |
| Toast text, Retry buttons                        | 14.2 to 15.9:1 | 13.9 to 14.9:1 |
| Setup hub CC card CTA text "Open Command Center" | **1.14:1**     | 10.37:1        |
| Setup hub CC card mic icon                       | **1.13:1**     | 8.44:1         |

## Console summary

- Command Center page, tabs, toast, mic, scene, roster, question and Setup hub walks: zero renderer warnings or errors.
- One batch of `Angular Error: TypeError: Cannot read properties of undefined (reading 'map' | 'length' | 'charAt')` (about
  80 lines, from `capitalise` and chat/agent views) appeared while I clicked through Chat, Apps, Tasks, Tribunal and
  Analytics with the 24 synthetic agents still injected. My fake agents are incomplete `MonitoredAgent` objects, so I
  attribute them to the aid. After clearing the agents the same tab walk logged nothing. Not a product finding.

## Findings

### Blocking

None.

### Serious

**F-1. Tab labels wrap and are clipped from 900 to 963 px.** `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:106-118`
hides labels only below 900 px (`@media (max-width: 899px)`). From 900 to about 963 px the flex strip shrinks (`min-w-0`),
the label wraps under the icon (DaisyUI `.tab` wraps) and the 32 px tab clips it. Requested size 900x800 is affected, in
both themes (`shell-dark-900x800.png`, `shell-light-900x800.png`). Impact: the exact "readable tab labels" criterion
fails at the first non-collapsed width. Fix: raise the collapse breakpoint to about 980 px, or add `flex-nowrap` to the
tabs and let the strip scroll.

**F-2. The fixed toast covers the app header and the page's own header controls.** `command-center-page.component.ts:218`
(`fixed right-4 top-4 z-50`, max-w-md). The error toast does not auto-dismiss, and while it shows it sits over the top bar:
at 892 it hides the Tribunal, Analytics and Setup hub tabs and the right-hand header icons (toast x 428-876, y 16-74); at
1440 it covers the top bar icons and half of "Voice settings" and the Session chip (`toast-light-892x735.png`,
`toast-dark-1440x900.png`). The Voice settings button is the recovery action for a mic or speech error. The page layout does not
shift (item 2b passes), but navigation and recovery are obstructed until the user clicks the small x. Fix: anchor the toast
below the page header inside the page container (for example `absolute` at the top of the scroll area with its own
reserved gutter) or at the bottom, and keep it clear of the 40 px shell bar.

**F-3. Setup hub card: light-theme contrast failures (CTA, icon, focus ring).** `libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts:778,832` (`text-accent` CTA) and `:814` (mic icon):
"Open Command Center" text is 1.14:1 and the mic icon 1.13:1 in `anubis-light` (rgb 255,214,167 on 239,234,230); the
sibling Tribunal card has the same 1.14:1 (`hub-light-1440x900-settled.png`). The card keyboard focus ring is the default
amber (rgb 229,151,0) at 2.25:1 against the light page, below 3:1 (`hub-focus-light-1440x900.png`). The CTA token and
Tribunal card pre-date this task; the focus ring on the new Space/Enter card is in this task's scope. Fix: use a
darker accent token in light for CTA and icon, and add `focus-visible:outline-base-content` to the card.

### Moderate

**F-4. Stacked layout hides the Action Required question card below the fold.** At 892x735 and 900x800 the pending
question or Tribunal roster card sits at y 1061 (viewport 735/800) with no cue at the top of the page and no automatic
scroll (`question-*-892x735.png`, `roster-*-900x800.png`). The voice session is waiting on it. At 1100 the card is inside
the rail and Decline/Confirm are below the rail's own fold (rail scroll reaches them). Fix: surface a one-line "Question
waiting" banner with a jump button at the top of the stacked page, or order the card above the stage.

**F-5. Mic recovery below the fold at non-stacked widths.** At 1100x700 the mic-denied message and "Open Voice settings"
land at y 778-826 (viewport 700) and at 1440x900 at y 850-926. The stacked fix (item 2c) does not apply here, so on a 700 px
high window the user sees the red mic state only after scrolling (`micfail-dark-1100x700.png`).

**F-6. Root plate is detached from the root at 900 px with 24 agents.** The plate sits about 110 px outside the root ring,
beside a child node (R1 / red failed node), and no leader is drawn (`crop-root-dark-900.png`). It reads as belonging to the
neighbouring child. At 1440 it is within about 70 px and acceptable (`crop-root-light-1440.png`). Check the
leader-fallback threshold in `scene-layout.ts` / `command-scene-renderer.ts:227`.

### Minor

- F-7. Light disabled Mute/Stop text 3.68:1 on a filled grey chip (Send 4.09:1). Disabled controls are exempt under WCAG
  1.4.3 but the chips read as heavy blobs next to the dark treatment (`scene24-light-1440x900.png`).
- F-8. After a theme switch, disabled button colours lag a frame behind the theme (measured with a stale colour right after the switch,
  corrected after rendering). Cosmetic.
- F-9. Icon-mode tabs: the active tab is 46 px, the others 40 px, so tabs to its right move 6 px when the active tab changes (1 px
  at 1440). Setup hub active gives a 6 px scrollable overflow (`scrollWidth` 292 vs 286).
- F-10. The shell theme menu's gold item focus ring is 1.3:1 on light rows (outside this task; seen while tabbing, `shell` chrome).

## Prototype fidelity

No `prototype/` folder is part of this task; not applicable. Compared against the earlier accepted reviews
(`TASK_2026_678_9083/visual-review-phase-e-r6.md`): idle geometry unchanged at 1440x900 (stage 756x620, rail 336x620,
input 291x44), no regression.

## What was and was not exercised

- Exercised for real: tab strip layout, keyboard order, scroll-into-view, focus rings, Setup hub Space and Enter, toast,
  Retry Decline click, Confirm click, typed "confirm", overlay pin and relayout handoff, 25-node scene.
- Stubbed: Tribunal confirm/decline, command sends and `retryInvalidDecline` (to avoid billed turns and real launches), so
  the typed-"confirm" result shows the page does not route typed text to confirm, not that a live Tribunal ignores it.
- Not exercised: voice "confirm" through the microphone, voice barge-in, the F-10 completion sound, a real mid-turn model
  question, a real mic denial (the HUD state was injected), Retry Decline after three real failed declines.

## Verdict

- Recommendation: REVISE. Confidence: HIGH for layout and contrast numbers, MEDIUM for interaction paths that were stubbed.
- Key concern: F-1 (tab labels clipped at 900-963 px) and F-2 (toast covers the header and Voice settings).

## Re-check (round 2)

Run on the already-running Electron dev app (PID 29516, CDP 9334 only, nothing launched, killed or built). The renderer
bundle (`dist/apps/ptah-electron/renderer/main.js`, 17:39:47) is newer than the edited sources (latest 17:08), so the
build under test contains the fixes. Themes `anubis` (dark) and `anubis-light`; viewports 900x800, 1100x700, 1440x900
(tab strip also 930, 963, 1000, 1023, 1024, 1040). Screenshots: `reports/visual/recheck-*.png` (30 files). Synthetic
aids as in round 1 (`store.setToast`, `setVoiceError`, `setPendingInput`, 24 fake agents with valid statuses only); all
reset at the end (pending input null, toast null, agents `[]`, nodes 1, theme `anubis`, window 1628x983). Side effect to
disclose: my console walk clicked the workspace and git panel toggles; I restored both to their original state
(workspaces open, git collapsed) and confirmed it. Some CDP screenshots intermittently timed out (20 s) in the question
and mic states; the DOM geometry below was measured in the same state, and a passing screenshot exists for each item.

| Finding                          | Status                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1 Tab labels clip 900-963 px   | FIXED                       | 900, 930, 963, 1000, 1023: 7 tabs, mic icon on Voice, labels hidden (icon-only), strip 286/286 (no overflow), tab 32 px high, `title` and `aria-label` set. 1024, 1100, 1440: 7 labels on one line (`white-space: nowrap`, label 24 px high, `scrollWidth` = `clientWidth`), strip 641/641, last tab right edge 758 at 1024 with the right icons at x 924. No document overflow at any width (`recheck-tabs-{dark,light}-{900,963,1023,1100}.png`). |
| F-2 Toast covers app chrome      | FIXED                       | Toast is `position: absolute` inside the stage column: 900x800 at (378,289) 448x58 dark, (378,237) light; 1100 and 1440 at y 192. Zero overlap with the Tribunal, Analytics and Setup hub tabs and with the "Voice settings" button at every size and theme (`recheck-toast-*`). Retry speech and dismiss still present.                                                                                                                            |
| F-3 Hub card light contrast      | FIXED (Command Center card) | Light: CTA 14.21:1 (was 1.14), mic icon 14.03:1 (was 1.13), focus ring 3 px rgb(41,19,52) 15.92:1 (was 2.25). Dark: CTA 13.89, icon 11.30, ring 14.86. The Tribunal card CTA is now 14.21 light and 13.89 dark (`recheck-hub-{light,dark}-1440x900.png`). Residual, pre-existing and out of this task: see N-2.                                                                                                                                     |
| F-4 Question card below the fold | FIXED                       | Stacked 900x800: a "Question waiting · Show question" button sits at the top of the page (y 165-209, 568x44) above the stage; the card is auto-scrolled into view (y 557-800 light); activating the cue scrolls the card to y 0 (height 243, inside 800). At 1100 and 1440 the card is inside the rail (y 285 and 280) and the cue is not rendered (not stacked). `recheck-question-light-900x800.png`.                                             |
| F-5 Mic recovery below the fold  | FIXED                       | The header now carries "Microphone access blocked / Open Voice settings" (160x48) at y 49-52 at 900, 1100 and 1440, dark and light, inside every fold (700, 800, 900). The dock HUD keeps its single `role=status` live message. `recheck-mic-{dark,light}-*.png`.                                                                                                                                                                                  |
| F-6 Detached root plate          | FIXED                       | 25 nodes at 900x800 (scene 566x458) in both themes: the root plate "Ptah / idle" now has a leader line to the root sphere (`recheck-scene24-{dark,light}-900x800.png`). 1440x900 plate unchanged and near the root.                                                                                                                                                                                                                                 |

### New findings

- **N-1 (Minor).** In the mic-denied state at 900 and 1100 the recovery link appears twice, plus the pre-existing
  "Voice settings" button (header banner at y 49, dock link at y 541, header button at y 158): three controls for one
  destination. The banner adds no second live region. Optional: drop the dock link or the header banner.
- **N-2 (Moderate, pre-existing, outside this task).** Setup hub light theme: Tribunal card icon 1.13:1, "AI Team
  Builder" card CTA 1.25:1 and icon 1.21:1 (dark 3.35 and 3.08), "Workspace" and "New Project" cards CTA 3.67:1 (icon
  3.27). Decorative icons are exempt from 1.4.3, CTA text is not. Same `text-accent` pattern the F-3 fix replaced on the
  Command Center card.
- **N-3 (Minor).** F-7 to F-10 from round 1 were not re-measured and are unchanged in scope. The theme-switch colour lag
  (F-8) reappeared: dark hub values were stale after 1.5 s and settled after 5 s.

No regression found on the Voice tab idle page (document width = viewport at all sizes), the tab strip (label "Voice"
with a mic icon, no clipping, labels from 1024 up), the Command Center page or the setup hub.

### Verdict (round 2)

**APPROVED, 9/10.** All three Serious (F-1, F-2, F-3) and all three Moderate (F-4, F-5, F-6) findings are fixed in dark
and light and re-measured; the new items are Minor or pre-existing. Counts: Visual breaking 0, Serious 0, Moderate 1
(N-2, pre-existing), Minor 5. Residual uncertainty: question and mic screenshots were partly flaky to capture; geometry
was measured in the same state. Console result (no product errors reproduced): `reports/console-audit.md`.
