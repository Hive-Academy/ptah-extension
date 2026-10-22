# Visual review (Electron) - TASK_2026_710 glass theme, PR #805

Head 6ca25c128 (worktree `.claude-worktrees/ptah-glass-theme`). Reviewer: visual-reviewer. Rendered evidence only; no source edited.

## Verdict: PARTIAL (NEEDS_REVISION)

Glass surfaces, the `::after` blur layer, the theme picker, settings hit testing and the shared popover layering all behave. Two serious defects remain, both visible only in glass: the modal scrim does not cover the app header, and the light-glass answer card renders fenced code at 1.84:1.

Counts: Visual breaking 0, Serious 2, Moderate 2, Minor 2.

## Environment and method

- Built with `npx nx build-dev ptah-electron --parallel=1` (success, 33.7 s). `build-dev` does NOT build the renderer. `dist/.../renderer/index.html` was stale (20:21, while `styles.css` and `theme-toggle.component.ts` were edited at 20:52 and 21:35). I therefore also ran `npx nx copy-renderer-dev ptah-electron --parallel=1` (webview development build plus copy, success). Without it every screenshot would have shown the old bundle. Please treat this as part of the authorized build.
- Playwright `_electron`, 1440x900 viewport, script `shoot-electron-review.cjs` (copy of `shoot-electron.cjs`, original untouched). Final run: 0 page errors, 47 files in `shots-review/` (46 PNG plus `_log.txt` holding every measurement quoted below).
- Themes were switched through the real picker (no attribute injection). Gold accent everywhere; one rose shot of the picker.
- Fixtures: temp git workspace (one commit plus two dirty files), three seeded Claude CLI sessions in an isolated HOME. One session has Read and Bash tool calls plus a markdown answer with list, code fence and a long unbroken path.
- Contrast is pixel-sampled from the screenshot (modal background = most common colour in the box, foreground = mean of the 1% most distant pixels), so blur and scrim are included. This is a floor for thin text. Standard: WCAG AA, 4.5:1 text, 3:1 non-text.
- Electron app closed by the script at the end of every run.

## Results per surface x mode

Dark = ptah-glass, Light = ptah-glass-light. Paths are relative to `shots-review/`.

| Surface | Dark | Light | Observed |
| --- | --- | --- | --- |
| a. Picker open (Glass tab, selected mark, accent footer) | `dark-a1-picker-open.png` | `light-a1-picker-open.png` | PASS. Panel is in the top layer (`inTopLayer:true`, hit test OK) at x=1136,y=43, 256 px wide, 188 px tall. Selected tile has ring plus check. Footer "Primary accent" has 3 swatches. Tab labels 15.3:1 dark, 16.5:1 light. See D3 for the tab pill. |
| a. Tab switch (height grows) | `dark-a2-picker-tab-{light,dark,glass}.png` | `light-a2-picker-tab-{light,dark,glass}.png` | PASS. Height 188 (Glass, 6 tiles) to 272 (Light, 18 tiles) to 230 (Dark, 12 tiles). Panel stays anchored under the button; the Light tab scrolls. Identical numbers in both modes. |
| a. Pick another theme in same tab | `dark-a3-...-dracula.png`, `dark-a4-...-focus-selected-dracula.png` | `light-a3-...-cupcake.png`, `light-a4-...-focus-selected-cupcake.png` | PASS. Selected ring, check and focus ink follow the new theme (white ring on Dracula, dark ring on Cupcake). Height drops 188 to 118 because the accent footer renders only for ptah-glass and ptah-glass-light (`theme-toggle.component.ts:256`); this is by design, but note the abrupt resize. Restoring the theme gives `dark-a5` / `light-a5`, 188 again. |
| a. Rose accent | `dark-a6-picker-rose.png` | n/a | PASS. `data-accent=rose`; primary button, sidebar rule and selected row turn rose; rose swatch ringed. |
| b. Native popover over a modal | `dark-b1/b2/b3/b4-*.png` | `light-b1/b2/b3/b4-*.png` | PASS with a substitution (see "Not captured"). Picker opened while Previous sessions is open: above the modal, tile hit test OK, tab click works. Escape closes the popover only (`pickerVisible 0`, `modalVisible 1`). A click on the scrim dismisses the popover and then the modal (both gone, one click). Second Escape closes the modal. |
| b. Settings popover (Reassign main agent) | `dark-e4-settings-popover-reassign.png` | `light-e4-settings-popover-reassign.png` | PASS. Panel above the cards, readable, no clipping by the scroller (the fixed-containing-block bug the `::after` change targets is not reproduced). |
| c. Previous sessions modal | `dark-c1-previous-sessions.png` | `light-c1-previous-sessions.png` | PASS for the scrim, FAIL for header coverage (D1). One scrim layer only: a single `dialog.modal-open` of 1430x900, `rgba(8,10,14,0.5)` dark, `oklch(...)/0.28` light; no double dimming. Modal box is readable: light meta text 4.72:1, row title and header legible. Dark pixel measurements of modal text were unreliable (the sampler hit dimmed list text behind), so dark modal text is judged from the screenshot only. |
| d. Chat, tool disclosures, answer card | `dark-d1-chat.png`, `dark-d2-chat-disclosures.png`, `dark-d3-chat-answer-card.png` | `light-d1-chat.png`, `light-d2-...`, `light-d3-...` | Dark PASS. Answer text 11.98:1, bullets 13.06:1, inline code 6.36:1, code block 7.77:1. Card padding 8px 12px, radius 14px. Light FAIL for the code fence (D2); light body text 5.79:1 (floor), bullets 9.77:1. Disclosure-to-card gap is about 4 px, read from the screenshot (D6). |
| e. Settings Providers / Advanced / Search & Voice | `dark-e1/e2/e3-*.png` | `light-e1/e2/e3-*.png` | PASS. `elementFromPoint` at the button centre returns the tab label span for Advanced and Search & Voice in both modes. No full-viewport fixed layer on Advanced or Search & Voice (`fixedLayers: []`). Tabs and cards legible. |
| f. Chrome, bars, Git dock | `dark-f1-chrome-git-dock-open.png` | `light-f1-chrome-git-dock-open.png` | PASS. Computed style: bar, sidebar, sidebar-tab, canvas and rail all have `backdrop-filter: none` on the element and `blur(16px) saturate(1.16) brightness(1.06)` on `::after` (light 1.15 / 1). Blur and fill visible; header and sidebar text readable (workspace row 7.38:1 dark, 5.0:1 light; header nav 9.93:1 dark, 5.43:1 light). Git dock open with a real diff, no stray fixed layer. See D4. |
| Control, non-glass (Anubis dark) | `control-anubis-modal.png`, `control-anubis-modal-popover.png`, `control-anubis-picker.png` | n/a | PASS. `data-glass` absent. Modal covers and dims the header, and header clicks are blocked. Appearance unchanged from plain daisy styling. |
| Control, Dracula | `control-dracula-modal.png` | n/a | Dracula is a glass-flagged theme in this app (`data-glass=on`), so it is NOT a non-glass control; Anubis was used as the true control. |

## Defects

### D1 Serious: modal scrim does not cover the app header in glass; header stays clickable and undimmed in dark

- Evidence: `dark-c1-previous-sessions.png`, `light-c1-previous-sessions.png`. With the modal open, `elementFromPoint` on the header "Voice" returns the header's own span; Playwright `click({trial:true})` reports the header actionable in both glass modes (`dark.header.trialClickVoice`, `light.header.trialClickVoice`). In Anubis the same trial click is blocked by the scrim (`control.header.trialClickVoice`). Dark header text is unchanged under the modal (213,215,220 in both states). Light is dimmed, but it is still clickable.
- Cause (read, not edited): the dialog is `z-[990]` but sits inside a `[data-glass-surface]` that now isolates (`apps/ptah-extension-webview/src/styles.css:2807` and `:2824`, `isolation: isolate`), so its z-index is trapped. The header bar is lifted to `z-index: 30` at `styles.css:2919` in the root context and paints above it.
- Impact: a user can open settings, the picker, or navigate away while a modal is open, and the modal does not read as modal in dark.
- Suggested fix: lift the ancestor surface while it hosts an open `.modal-open` (as done at `styles.css:2931` for `.popover-panel`), or render modals in the top layer (`showModal`; the dialog currently reports `:modal` false).

### D2 Serious: light glass answer card code fence is nearly illegible

- Evidence: `light-d3-chat-answer-card.png`, `light-a2-picker-tab-light.png`. Fenced TypeScript tokens are pale gold, pink and olive on the lilac card: 1.84:1 (`light.chat.codeBlockInAnswer`). Dark equivalent is 7.77:1. The Read tool's code block in the same view is fine.
- Cause (likely, not proven): markdown in the answer renders with a hard-coded `prose-invert` palette, `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts:193`, `:218`, `:238`. The `variant='auto'` option exists at `libs/frontend/markdown/src/lib/markdown-block.component.ts:47` but these call sites do not use it. The exact token-colour source was not located. This probably predates the branch and is exposed by the light glass theme.
- Fix: use the auto variant or per-theme token colours with at least 4.5:1.

### D3 Moderate: selected picker tab is barely distinguishable

- Evidence: pixel sample of the selected-tab pill against the panel is 1.39:1 dark and 1.02:1 light (`*.picker.selectedTabPillVsPanel`). Selected text is not heavier or darker than unselected (15.3 vs 15.3 dark, 15.3 vs 16.5 light). See `light-a1-picker-open.png`. The only selection cue is `--glass-sel`.
- Location: `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts:87-92`. The selected style exists only under `[data-glass='on']`. Not verified for non-glass themes.
- Fix: add a 3:1 indicator (underline, border or stronger fill).

### D4 Moderate: composer model chip overlaps its icon in the narrow chat pane

- Evidence: `dark-f1-chrome-git-dock-open.png`, `light-f1-chrome-git-dock-open.png`. "Default (recommended)" is overprinted by an icon glyph when the Git dock narrows the chat column. Not seen at full width. Source not located; likely not caused by this branch.

### D5 Minor: ghost text behind the open picker in dark

- Evidence: `dark-a1-picker-open.png`, `dark-a6-picker-rose.png`. Faint sessions-panel text ("S", "No sessions yet") is visible through the lower part of the popover. Panel text stays readable (tab labels 15.3:1, legend 15.6:1). Not measured further.

### D6 Minor: tight spacing between the last disclosure and the answer card

- Evidence: `dark-d3-chat-answer-card.png`. Disclosure bottom edge to card top is about 4 px (the card's previous sibling gap is 0; `answerGap` in `_log.txt`), versus about 12 px between other blocks. Cosmetic.

## Not captured or not fully tested

- A native `ptah-native-popover` inside a modal: no reachable modal in this build hosts one (the Previous sessions "Date range" panel is inline; modals with selects use OS selects). I used the picker, which is a top-layer native popover, opened programmatically while the modal was open. Layering, hit testing, Escape order and outside-click dismissal were verified for that case only.
- Git dock resize handle and dock menus/popovers: only the open dock was captured.
- Rose accent in light, moonstone, and hover states: not captured.
- The accent footer after switching tabs in Light and Dark tabs (footer only for the two ptah themes).
- Dark modal text contrast by pixel sampling (sampler picked dimmed background rows).
- Other viewport sizes: only 1440x900.
- Non-glass control for the picker's selected-tab styling: not measured.

## Decisions

- Built the renderer in addition to `build-dev` because `build-dev` leaves the renderer stale. Reversible: no source change.
- Used Anubis, not Dracula, as the non-glass control because Dracula is glass-flagged in `theme.service.ts`.
- Verdict PARTIAL rather than FAIL: no layout breakage or unreadable core surface; the two serious items are scoped to modal stacking and one markdown palette.

## Re-check after round 3 fixes (2026-10-23)

Build: `ptah-electron:build-dev` + `copy-renderer-dev`, then `shoot-electron-review.cjs`.
Earlier shots kept in `shots-review-before/` (local only, not committed).

| Item | Before | After | Result |
|---|---|---|---|
| D1 header under modal scrim (dark) | header clickable under modal | `hit: div.psm-scrim`, trial click blocked (same as anubis control) | PASS |
| D1 header under modal scrim (light) | header clickable under modal | `hit: div.psm-scrim`, trial click blocked | PASS |
| D2 glass-light code block in answer | contrast 1.84 | contrast 4.8 (inline code 4.66) | PASS |
| Picker popover over modal (dark + light) | top layer | `topLayerHost: true`, tile hit OK | PASS |
| Picker selected tab | low contrast | outlined pill, label readable in both modes (dark-a1, light-a1) | PASS (visual) |
| Model chip in composer (default width) | clipped | `Default (recommended)` full and aligned (dark-d1, light-a1) | PASS |
| Settings reassign popover (light) | - | above the provider cards, readable (light-e4) | PASS |

Known measurement noise, unchanged from before: `modal.title` / `userBubble` ratios sample the
scrim or the page, not the text background. The screenshots show readable text.
Not shot: the composer model chip at a narrow window width.

E2E in Electron: `compaction-duplicate-session` + `theme/theme.spec.ts`: 7 passed (1.9 min).

Verdict: PASS for the D1, D2, picker and top-layer items. Open: native-autocomplete is still an
in-page fixed overlay (not changed in this PR).
