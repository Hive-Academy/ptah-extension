# Visual Review - TASK_2026_871_0d04 (Tasks UI revamp, Electron)

**Verdict: PASS WITH ISSUES** (leaning FAIL against the approved prototype for the 1280 detail layout; see issue 1)

Reviewed in the real Ptah Electron app (Playwright `_electron`), head a2500bfab, dev build, real data from this worktree's `.ptah/specs` (287 tasks; board and the 22-file TASK_2026_871_0d04 folder). Themes `anubis` (dark) and `anubis-light`. Window content widths 1280 and 760 (height 820). Screenshots: `.ptah/specs/TASK_2026_871_0d04/visual-review/`.

## Screenshot to prototype comparison

| Screenshot | Prototype | Result |
| --- | --- | --- |
| board-dark-1280.png | prototype/screenshots/board-dark-1280.png | Close. Header, filter row, 6 lanes. Cancelled lane is cut off at the right edge (horizontal board scroll) where the prototype shows five 220px lanes plus a 58px Cancelled rail. Lanes are 242px, not 220px. |
| board-light-1280.png | board-light-1280.png | Close. Teal primary in light matches theme token; card-title glyph clipping (issue 3). |
| board-dark-760.png / board-light-760.png | board-*-760.png | Matches intent: header and filters wrap, board scrolls horizontally inside itself, no page scroll. |
| detail-dark-1280.png | detail-dark-1280.png | DEVIATES (issue 1). Prototype: full-page 3-column (file rail 248, reader flexible, metadata 268). Build: 384px overlay panel on the board with files, then reader stacked beneath. |
| detail-light-1280.png | detail-light-1280.png | DEVIATES, same as above. |
| detail-dark-760.png / detail-light-760.png | detail-*-760.png | Stacked layout is right in order and the file list is an internal scroller as specified, but the panel covers about 55% of the window and the reader starts below the fold (issue 2). |
| detail-focus-{dark,light}-{1280,760}.png | n/a | Focus state after 14 Tab presses. |
| reader-design-spec-{dark,light}-1280.png, reader-implementation-plan-{dark,light}-1280.png | detail reader area | Reader scrolled into view; markdown rendering (issues 4, 5). |

## Issues

1. **Serious - 1280 detail is not the approved 3-column layout.** The detail is a 384px (`w-96`) column beside the Kanban board; the reader is about 308px wide, metadata and activity sit even further down. Reader content is cramped (tables at 308px, text wraps every 5 to 6 words). Known and expected, but it is a prototype deviation. Likely: `libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts:271` (`[class.w-96]="detailRail()"`) and `.../detail/task-detail.component.ts:125-130,347` (`wide()` input).
2. **Serious - 760 detail: reader pushed below the fold.** The panel is about 416px of 760px; the board lanes behind are still visible and clickable, and the reader header (`design-spec.md`, Open in editor) starts at the bottom edge of the viewport. Spec said "reader begins near the fold" with a full-width reader. Same code as issue 1 (`task-detail.component.ts:130`, `tasks-view.component.ts:271`). Below roughly 1100px the detail should replace the board.
3. **Serious - light theme: first glyph of Kanban card titles is clipped on the left** ("Revamp" shows as "evamp", "Use" as "Jse", "Session" as "ession"). Visible in board-light-1280/760, detail-light-*, reader-*-light. Not present in dark. Likely: `.../board/task-card.component.ts:345-356` (title button with `line-clamp-2`, `!static`, `after:rounded-box`); check overflow clipping and the left edge of the clamp box in light.
4. **Moderate - inline code breaks mid-word in the narrow reader** ("Ne|w Task", "edi|tor", "tasks-sto|re.service.ts"), and shows boxed pills that wrap across lines. Likely `.prose code` rules in `apps/ptah-extension-webview/src/styles.css` (around 1288-1339 region) plus the 308px reader width.
5. **Moderate - markdown h1 differs from the prototype.** In the build `h1` is gold/amber with a bullet dot, and `h2` also gets a leading dot (prototype h1/h2 are plain `text-base-content`, h2 about 18px). The dot comes from the shared `.prose` list or heading marker styling (`apps/ptah-extension-webview/src/styles.css:1288`, `1468`). Measured: h2 16.9px, body 13px.
6. **Moderate - markdown elements not exercised.** The two documents rendered have 4 to 6 tables, many inline code spans, but no fenced code blocks and no links (`pre`=0, `a`=0), so link colour/underline and code-block horizontal scroll could not be verified. Raw HTML: 0 `script`/`iframe`/`img` nodes and no tag text visible in the body (sanitization looks OK on these two files). Tables render with borders and no overflow (`scrollWidth == clientWidth` 307/307).
7. **Minor - file rows mix affordances.** Rows for some files show an "external link" icon and "Markdown" while others show a document icon and "Present". The label "Markdown" is ambiguous next to "Present" (HANDOFF.md is openable in editor, not inline reader).
8. **Minor - Cancelled lane clipped at 1280** (horizontal scroll bar visible, lane at x>1248). Spec says all six statuses fit at 1280. Likely lane width in `.../board/task-column.component.ts`/`task-board.component.ts` (`w-[242px]`).

## Checks that passed

- No page-level horizontal scroll at 1280 or 760 in either theme (`scrollWidth == innerWidth`; board scrolls inside its own container).
- Theme tokens: body bg `oklch(0.1886 ...)` dark and `oklch(0.9779 ...)` light, `data-theme` anubis / anubis-light, Inter font, matches the design-spec token map.
- Focus visibility: Tab stops show a solid 2px outline in `base-content` colour (dark `oklch(0.925...)`, light `oklch(0.236...)`) on file-list buttons (297x36 / 298x36). Selected card ring is visible in both themes.
- Primary action hierarchy: New Task is the single filled primary on the board; Open in editor is the single filled primary in the reader.
- Layout shift: none observed between navigations; the detail panel appears without moving the board.
- Not measured: numeric contrast ratios (only visual inspection; muted text and the disabled "Clear" button look low-contrast in light), empty and error states (not reachable with real data), links, fenced code.

## Commands used

```
node scripts/verify.mjs --exec --task visual-review -- npx nx run-many -t build-dev,copy-renderer-dev -p ptah-electron
node scripts/verify.mjs --exec --task visual-review -- node .ptah/specs/TASK_2026_871_0d04/visual-review/capture/capture.mjs dark
node scripts/verify.mjs --exec --task visual-review -- node .ptah/specs/TASK_2026_871_0d04/visual-review/capture/capture.mjs light
node scripts/verify.mjs --exec --task visual-review -- node .ptah/specs/TASK_2026_871_0d04/visual-review/capture/capture-reader.mjs dark|light
```

Scripts and raw metrics: `visual-review/capture/*.mjs`, `visual-review/metrics-*.json`, `visual-review/build.log`. The scripts launch `dist/apps/ptah-electron/main.mjs` with `_electron.launch`, a throwaway user-data dir whose `global-state.json` points the workspace at this worktree and sets `theme-v2`, and `ptah.onboarding.v1` in localStorage; they set the window size via `BrowserWindow.setContentSize`, push `switchView: tasks`, then click the card and a file row.

## Round 2

**Verdict: PASS WITH ISSUES.** Real Ptah Electron app, repo HEAD a8bd99df2 plus the orchestrator's uncommitted `tasks-view.component.ts` edit. Real data from this worktree's `.ptah/specs` (287 tasks, TASK_2026_871_0d04 folder with design-spec.md open). Themes anubis and anubis-light, content widths 1280 and 760 (height 820). Screenshots: `.ptah/specs/TASK_2026_871_0d04/visual-review/round-2/` (`board-{dark,light}-{1280,760}.png`, `detail-*`, `detail-focus-*`, `detail-focus-back-*`, `board-after-back-*`, `reader-design-spec-{dark,light}-1280.png`; 26 PNGs, metrics in `metrics-{dark,light}.json`).

**Build caveat.** The renderer bundle in `dist` is from the build made at the start of this round (before the orchestrator's `flex-1` fix on `<ptah-task-detail>`). A second renderer rebuild failed on an Nx plugin-worker timeout and `dist` was not updated; `main.mjs` is the earlier build too (the main process is not touched by these UI changes). So the narrow-detail finding below is recorded as **fixed after build (tasks-view.component.ts), not re-verified**. The 1280 detail shots are from the pre-fix bundle and show the narrow page.

### Issue status from round 1

| # | Issue (round 1) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | 1280 detail was a 384px panel, not the 3-column page | Partly fixed | Now a full-page detail replacing the board, with Back, breadcrumb, Start in chat, Change status. But in this build the page is 889px wide of ~1216 (`detail-light-1280.png`, empty gutter on the right), so the container query gives the stacked layout, not the 248/1fr/268 columns. Cause: host without `flex-1`; orchestrator fixed it after this build. Not re-verified. |
| 2 | 760 detail: reader below the fold, board still clickable | Fixed | `detail-*-760.png`: full-width page (696px), board hidden, file list is a 290px internal scroller, reader header and the first heading are visible at y=638 to 820. |
| 3 | Light theme clipped first glyph of card titles | Fixed | `board-light-1280.png`, `board-light-760.png`: "Revamp", "Use", "Session" render in full; title spans have scrollLeft 0, clientWidth = scrollWidth. |
| 4 | Inline code broke mid-word in the narrow reader | Fixed | `reader-design-spec-light-1280.png`, `detail-*-760.png`: pills wrap at spaces, boxed; computed `word-break: normal`, `overflow-wrap: anywhere`. |
| 5 | h1/h2 gold with dots | Fixed | h1/h2 colour equals base-content in both themes (dark `oklch(0.925 ...)`, light `oklch(0.236 ...)`), no `::before` content, h1 18.85px, h2 16.9px. |
| 6 | Links and fenced code not exercised | Still open | design-spec.md: tables 6, pre 0, a 0. Other task files open in the editor, not the inline reader ("Opens in editor"), so no available document has a link or fenced block. Table: borders, no overflow (`bodyScroll` 747/747). Link colour and code-block scroll remain unverified. |
| 7 | File rows mix icons and "Markdown"/"Present" | Fixed | All rows use the document glyph, editor-only rows say "Opens in editor" (`detail-light-1280.png`). |
| 8 | Cancelled lane clipped at 1280 | Accepted, still visible | Lanes are 220px, Cancelled has tasks so it is a full lane; board scrolls inside its container (`board-*-1280.png`). Intentional per the fix report; the prototype shows an empty rail. No page-level scroll. |

### Checks

- Page-level horizontal scroll: none at 1280 or 760 in either theme (`scrollWidth == innerWidth`). Detail overflow count is 0 in all four cases (the board's 216 overflowing nodes are the lanes inside the board's own scroller).
- Back: the board returns in all four combinations (287 cards, detail gone, no page scroll; `board-after-back-*.png`). Not proven: selection and lane scroll restoration. The run never scrolled the board (scrollLeft 0 before and after) and `selected` could not be read, so only "board comes back intact" is evidenced.
- Focus: Back to board shows no outline when focused programmatically (`outlineStyle none`, ring may be box-shadow; not confirmed, see N2). Start in chat shows a 2px base-content outline in both themes. Tab stops through the file list keep a visible 2px outline (`detail-focus-*.png`).
- Clipped text: none seen; card titles, breadcrumb, header title wrap at 760 (title on two lines).
- Light theme contrast: the in-page ratio probe could not parse OKLCH backgrounds and its numbers (3.1) are not valid, so they are discarded. By lightness, body and headings are `oklch(0.236)` on `oklch(0.978)`, roughly 13:1 (passes). Muted labels ("Present", "Opens in editor", status badges, disabled Clear) look lighter, not measured, so not claimed. The Backlog focus colour in the status menu is `oklch(0.48 0.12 70)` on a light surface (looks acceptable).
- Prototype comparison: header, action hierarchy (single filled primary New Task; Open in editor primary in the reader), file rows, status/type/stage badges match the prototype detail shots at 760. At 1280 the layout deviates until the `flex-1` fix is in the build.

### New issues

- N1 **Serious (fixed after build, unverified):** 1280 detail page is 889px wide in a ~1216px surface, stacked instead of 3 columns (`detail-dark-1280.png`, `detail-light-1280.png`). `libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts` (`<ptah-task-detail>` host). Re-capture 1280 detail after the next renderer build.
- N2 **Moderate:** "Back to board" has `outline-style: none` when focused programmatically and the "Change status" menu items report a transparent 2px outline (`metrics-*.json` `focus-*`); the visible ring comes from somewhere else or is missing. Check `detail/task-detail-header.component.ts` (Back button and status menu items) with a keyboard-only Tab pass.
- N3 **Minor:** the status dropdown appears as two consecutive Tab stops ("Change status" twice). `detail/task-detail-header.component.ts` (`task-detail-status-menu`).
- N4 **Minor:** top-level `.ptah / specs / <folder>` breadcrumb text and the `.ptah/specs/<folder>/` path line duplicate each other directly under the title.

### Commands used

```
node scripts/verify.mjs --exec --task visual-review -- npx nx run-many -t build-dev,copy-renderer-dev -p ptah-electron   # build-dev (main) failed on plugin-worker timeout; renderer copied
node scripts/verify.mjs --exec --task visual-review -- npx nx run ptah-electron:copy-renderer-dev                          # failed on plugin-worker timeout; dist unchanged
node scripts/verify.mjs --exec --task visual-review -- node .ptah/specs/TASK_2026_871_0d04/visual-review/capture/capture-round2.mjs dark
node scripts/verify.mjs --exec --task visual-review -- node .ptah/specs/TASK_2026_871_0d04/visual-review/capture/capture-round2.mjs light
```

Script: `visual-review/capture/capture-round2.mjs` (Playwright `_electron`, throwaway user-data dir pointing at this worktree, same method as round 1). Earlier runs hit `page.screenshot` timeouts under machine load; the final script retries with a 90s timeout.
