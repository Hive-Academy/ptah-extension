# Visual Review - TASK_2026_650_2c78

Verdict: FAIL (REJECTED). Score 4/10.

Counts: Blocking 2, Serious 3, Moderate 4, Minor 2.

## Environment

- Electron dev app from the worktree, already running with CDP on http://127.0.0.1:9335. I did not launch, restart or kill it. Renderer `dist/apps/ptah-electron/renderer/index.html` (built 19:31, after the last commit at 19:27), so the bundle is current.
- Playwright `connectOverCDP`, scripts in `%TEMP%\ptah650-visual` (outside the repo).
- The native window is 795x735, not 1184. "Wide" below means 795. 400 and 360 use `Emulation.setDeviceMetricsOverride`, cleared afterwards.
- Themes: Anubis (dark, the original theme) and Anubis Light. Final theme restored to Anubis.
- Expectations come from design-spec 2.1, 2.7, 2.8 and the one-primary rule, with implementation-plan.md as authority per D11. WCAG AA: 4.5:1 text, 3:1 UI and focus, 24px targets.
- Screenshots are in `.ptah/specs/TASK_2026_650_2c78/visual/`.

## Results table

| Screen | Theme | Width | Screenshot | Result |
| --- | --- | --- | --- | --- |
| Setup Hub (new cards) | dark | 795 | hub-anubis-795.png | PASS (cards match recipe, grid reflows, no Running line per B09) |
| Setup Hub | light | 795 | hub-anubis-light-795.png | PASS WITH ISSUES (S3) |
| Setup Hub | dark/light | 400, 360 | hub-anubis-400/360.png, hub-anubis-light-400/360.png | App-shell overflow (M1), not caused by this task |
| Agent generation tab | dark | 795 | agents-anubis-795.png, agents-bottom-anubis-795.png | FAIL (B1, B2) |
| Agent generation tab | light | 795 | agents-anubis-light-795.png, agents-bottom-anubis-light-795.png | FAIL (B1, B2) |
| Agent generation tab | dark/light | 400, 360 | agents-*-400/360.png | FAIL (B1, B2, M1) |
| Guidance tab | dark | 795 | guidance-top-anubis-795.png, guidance-anubis-795.png | PASS WITH ISSUES (B1, S1) |
| Guidance tab | light | 795 | guidance-top-anubis-light-795.png, guidance-bottom-anubis-light-795.png | PASS WITH ISSUES (B1, S1, S2) |
| Guidance tab | dark/light | 400, 360 | guidance-*-400/360.png | FAIL (B1, M1) |
| Focus pass (guidance) | light | 795 | guidance-focus2-anubis-light-795.png, guidance-focus5-anubis-light-795.png, guidance-toggle-focus-anubis-light-795.png | PASS WITH ISSUES (S2) |
| Chat rail (duplicate-tab check) | light | 795 | chat-rail-anubis-light-795.png | PASS |

## Findings

### Blocking

**B1. The shell stacks the panel above the chat with no height budget, so the chat and composer are pushed out of view.**
- Evidence: agents-anubis-795.png and agents-bottom-anubis-795.png. The panel (`div.min-h-0.overflow-y-auto`) is 694px tall (scrollHeight 1645) and the chat embed is squeezed to 48px. The composer textarea is at top=790 in a 735px viewport. That is unreachable on the agent tab at every width tested.
- The guidance tab fits, but the embed is about 130px tall (guidance-top-anubis-795.png).
- Source: `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts:63-65` (panel has no max-height or flex basis) and `:242-243` (`min-h-0 flex-1` embed).
- Design deviation: design-spec 2.1 and plan line 98 specify the chat region plus a 336px docked sidebar.

**B2. The responsive bands from design-spec 2.7 are missing.**
- At 795 (the 720-959 band) there is no docked 336px sidebar, header strip, workspace chip or workflow badge. At 360/400 there is no peek bar, no sheet and no 32px Stop beside it.
- The panel is a single stacked column at every width. D11 only waives the per-tab provider picker and the composer-during-run behaviour, not this layout.
- Source: same file, `:49-66`.
- Screenshots: agents-anubis-795.png, agents-anubis-400.png.

### Serious

**S1. Two primary buttons are visible at once on the guidance tab.** "Generate guidance" and "Regenerate guidance" are both `btn-primary` (guidance-top-anubis-795.png). The design allows one primary in the sidebar. A third `btn-primary` is at `generation-guidance-page.component.ts:40`, probably for the unavailable state, which was not reachable. Sources: `guidance-run-card.component.ts:83`, `guidance-result-panel.component.ts:71`.

**S2. In light theme the "Use project guidance" switch focus ring is too faint.** The focus outline is oklch(0.85 0.138 181) on a cream background, roughly 1.3:1 against the 3:1 minimum (guidance-toggle-focus-anubis-light-795.png). The ring is visible but fails 1.4.11. Source: the toggle in `guidance-result-panel.component.ts`, which uses DaisyUI toggle's primary outline.

**S3. In light theme the new hub card CTA text measures 3.67:1.** "Generate Agents" and "Generate Project Guidance" are 12px gold on cream. Dark theme is 8.24:1. It is the same recipe as the existing cards, so this is a shared token issue, but it does affect the new cards. Screenshot: hub-anubis-light-795.png. Source: `libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts`.

### Moderate

- **M1.** At 400 and 360 the app shell overflows horizontally (document scrollWidth 722/723). The cause is the nav and the tab bar (`electron-tabs`) and the header theme toggle. The Hub and both generation tabs clip on the right (agents-bottom-anubis-400.png). Pre-existing app shell, and Electron may not go this narrow. Reported for completeness.
- **M2.** The 15 agent checkboxes are 20x20px, under 24px. They are spaced out, so the 2.5.8 spacing exception likely applies. The whole card appears to be the label (not verified).
- **M3.** The "Generate guidance" button sits flush between two cards with no vertical gap (guidance-top-anubis-795.png).
- **M4.** The panel has no visible title or header on the agents tab at the top: "Agent generation / idle" is a plain card. The "Select agents" h2 is larger than the other section labels (agents-anubis-795.png).

### Minor

- The "Setup hub" top-nav label wraps to two lines and overlaps the tab underline (pre-existing, visible in every screenshot).
- The "Configured" badge on Workspace Analysis in light theme is 2.12:1 (pre-existing).

## What passed

- Hub: the two new cards use the same card recipe and sit in the same grid. There is no Running line, as B09 intends. The grid reflows. Dark contrast is fine (CTA 8.24:1).
- Generation panels: automated text contrast scan inside the panel found 0 text below AA in both themes, on both tabs.
- Keyboard focus: the Tab order was tested on the guidance tab in light theme. Each of the first 14 stops showed a 2px outline (S2 aside). The agent tab was not Tab-tested.
- Second click: the Chat rail stayed at 9 tiles after opening each entry once and then clicking each again twice, with the same single "Generate agents" header. There was no duplicate tab. This is by tile count only.
- Guidance tab: the source label reads "Checked when the run starts" and no raw paths or host errors appeared. The saved time is formatted ("Sep 4, 2026, 4:52:26 PM"). The result panel shows the toggle, "Refresh cache status", "View content", "Download" and "Regenerate guidance".
- Widget (static check): `project-setup-card.component.ts` renders one `<ptah-setup-status-widget />`. The widget (`setup-status-widget.component.ts:127-146`) has one "Generate agents" and one "Project guidance" `btn-outline`, and the analysis Configure/Update primary is intact. No duplicates.

## Not reviewed

- Setup status widget and project setup card in the running app: they only render on the empty single-chat view or the canvas no-tiles screen. This workspace has 9 sessions, and I would have had to close user sessions. Checked statically only.
- Run states: progress, checkpoint and Resume cards, the countdown with Skip, the completion and error blocks, and the Stop control. These need a real run, which was forbidden.
- Agent selection with items checked and the target preview. I did not toggle checkboxes in the shared workspace state.
- Guidance "Back to chat" and the unavailable state: not reachable.
- Light and dark Tab pass on the agent tab, and focus screenshots at 400 and 360.
- Layout shift: no measurement beyond observing that the panel did not move on load.

## Steps taken

1. Read design-spec.md 2.1, 2.7 and 2.8, decisions.md and the shell component source.
2. Connected over CDP and listed pages. The window was 795x735.
3. Opened Setup hub and screenshotted it. Opened the theme menu and recorded the options (Anubis, Anubis Light).
4. Per theme and width (795, 400, 360): `flow.cjs` clicked the Hub card for Agents and for Guidance and screenshotted the top and the scrolled bottom of the panel. It measured overflow and the composer position.
5. `audit.cjs` computed contrast with canvas colour conversion and checked target sizes for each tab and theme. `hubc.cjs` measured the hub CTA contrast.
6. `focus.cjs` pressed Tab 14 times on the guidance tab in light theme and recorded the outline of each stop. `tog.cjs` took the toggle focus shot and did the duplicate-tab check.
7. Restored the Anubis theme and cleared the metrics override.

## V1 re-check (2026-10-18)

Verdict: PASS. Score 8/10.

Counts: Blocking 0, Serious 0 (new), Moderate 3 new, Minor 1 new. Deferred and known: S3, M1 (still open).

### Environment

- Same running Electron dev build (CDP 9335, not launched or closed by me). `dist/apps/ptah-electron/renderer/main.js` was built 20:51, after commit 11ddf3949 (20:50), so the bundle contains the revision.
- Native window 795x735 (Electron `minWidth` is 800, `apps/ptah-electron/src/windows/main-window.ts:119`). 400 and 360 via `Emulation.setDeviceMetricsOverride`, cleared afterwards (innerWidth back to 795). Themes Anubis (dark) and Anubis Light; restored to Anubis.
- No generation was started. The only state touched was one agent checkbox, checked to open the "Review generation targets" preview, dismissed with Cancel, then unchecked.
- Screenshots are in `visual/`, prefixed `v1-`.

### Per-finding table

| Finding | Status | Evidence |
| --- | --- | --- |
| B1 chat and composer pushed out of view | FIXED. At 795 the chat region and the composer (textarea top 600, height 60) are visible beside the sidebar in dark and light. At 400 and 360 the peek row sits above the chat and the composer is visible. | v1-agents-anubis-795.png, v1-guidance-anubis-light-795.png, v1-agents-anubis-400.png, v1-guidance-anubis-light-360.png |
| B2 responsive bands missing | FIXED. 795: header strip (title, workspace chip, status) plus a 336px docked sidebar (measured 336 wide, left 532 at 900px). 400/360: peek row button with `aria-expanded`, sheet as `role=dialog` `aria-modal=true`. Stop button beside the peek row is in code but needs a bound run, not testable here. | v1-agents-anubis-795.png, v1-sheet-closed-*, v1-sheet-open-* |
| S1 two primary buttons on guidance tab | FIXED. Only "Regenerate guidance" is `btn-primary` in the sidebar (dark and light). | v1-toggle-focus-light-795.png |
| S2 faint switch focus ring in light theme | FIXED. Outline is now oklch(0.236 0.066 313), 2px, on a cream background (about 13:1). Dark ring is oklch(0.925 ...) on dark (high contrast). | v1-toggle-focus-light-795.png, v1-toggle-focus-dark-795.png |
| S3 light-theme Hub CTA contrast | STILL OPEN (deferred). Text oklch(0.58 0.132 75) on oklch(0.94 ...), unchanged, about 3.7:1. | v1-hub-light-795.png |
| M1 app nav overflow at 360/400 | STILL OPEN (deferred). Document scrollWidth 722 at both widths. Cause: `electron-shell.component.ts` has `min-w-[400px]` on the main region (from release 0.2.32) beside a 32px rail, and the nav tabs overflow. Not reachable in the real app (min window 800). | v1-agents-anubis-400.png |

### Narrow sheet checks (400 and 360, dark and light)

| Check | Result |
| --- | --- |
| Opens and closes from the peek row | PASS. Sheet goes from hidden (0x0) to 400x611 under the peek row and `aria-expanded` flips. |
| Focus moves into the sheet | PASS. First control receives focus (toggle on guidance, model select on agents). The embed gets `inert` and `aria-hidden`. |
| Escape closes the sheet and returns focus | PASS. Focus returns to the peek button, `inert` is removed. |
| Dialog opened from inside the sheet is not clipped | PASS. The "Review generation targets" wrapper measures 0,0,400,735 (full viewport), the sheet computed `transform` is `none` after the 180ms animation. Cancel closes only the dialog. |
| Widening to 900 closes the sheet | PASS. Peek row is gone, sidebar docks at 336px, `role` and `aria-modal` removed, embed no longer inert. |
| Reduced motion | Not run. The code guards the animation with `prefers-reduced-motion`. |

Screenshots: v1-sheet-closed-light-400.png, v1-sheet-open-light-400.png, v1-sheet-esc-light-400.png, v1-sheet-widened-light-400.png, v1-agents-sheet-open-light-400.png, v1-agents-dialog-light-400.png, v1-agents-dialog-dark-400.png, and the dark and 360 variants (`v1-sheet-*-dark-*`, `v1-sheet-*-light-360.png`).

### Viewport table

| Screen | Theme | 795 | 400 | 360 |
| --- | --- | --- | --- | --- |
| Agent generation | dark | PASS | PASS apart from M1 clipping | PASS apart from M1 clipping |
| Agent generation | light | PASS | PASS apart from M1 | PASS apart from M1 |
| Project guidance | dark | PASS | PASS apart from M1 | PASS apart from M1 |
| Project guidance | light | PASS | PASS apart from M1 | PASS apart from M1 |

The shell itself never overflows. Its host is 400px wide at both 400 and 360, because of the app shell `min-w-[400px]`, so the right 32px (at 400) or 72px (at 360) is clipped by the app shell, not by this task's code.

### New findings

- **N1 (Moderate, consequence of M1).** At 400 and 360 the clipped band hides the right end of the header strip status ("idle" is cut off) and of the peek row (the chevron, and the 32px Stop button when a run is bound). Opening the sheet focuses a control and scrolls the overflow-hidden app region by 32px, so the left rail disappears (v1-sheet-open-light-400.png). Cleared by fixing M1; not reachable at the 800px minimum window.
- **N2 (Moderate).** In narrow mode the header strip (`Agent generation`, workspace chip, status) and the peek row repeat the same title and status one under the other (v1-agents-anubis-400.png). Consider hiding the title and status in the header strip when `narrow()` is true. `generation-workflow-shell.component.ts` header and peek row.
- **N3 (Moderate).** In the target preview dialog the "Replaces existing file" notice breaks mid-word ("Replac/es", "R/eplaces") next to long paths (v1-agents-dialog-dark-400.png). Add `whitespace-nowrap` to the notice or put it on its own line.
- **N4 (Minor).** The "Setup hub" nav label still wraps to two lines at 795 (pre-existing, same as before). M2 (20px checkboxes), M3 and M4 from the earlier review were not re-evaluated.

### Not re-checked

- Needs-attention badge and the Stop button (need an error or a bound run).
- Run, countdown, completion and error states, and the status widget in chat.
- Tab pass with focus screenshots at 400 and 360.

### Verdict

PASS, 8/10. Both blockers and both serious findings are fixed, and the narrow sheet behaves to the contract. The score is held back by the open deferred items (S3, M1), the N1 to N3 polish items, and the states that could not be exercised without a real run.
