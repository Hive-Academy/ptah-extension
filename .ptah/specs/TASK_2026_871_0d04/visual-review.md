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
