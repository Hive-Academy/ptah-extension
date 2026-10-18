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
