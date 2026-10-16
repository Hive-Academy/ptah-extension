# Visual review (after fix), items 11-17 - TASK_2026_681_738f

Verdict: **FAIL (NEEDS_REVISION)**. Score 6/10. Visual breaking 0, Serious 3, Moderate 5, Minor 2. All seven items are
implemented as described and none of them regressed the build. The Serious findings are a missing gutter in the flattened lane
view, a focus ring below 3:1 in the light theme, and the inspector staying visible in the compact view (item 16).

Screenshots: `screenshots/after-11-17/` (34 PNGs). Before set: `screenshots/before-11-17/` and `visual-before-11-17.md`.

## How captured

- Build (foreground, output tailed, no other build/test/e2e run, no source edited):
  `npx nx run ptah-electron:build-dev --parallel=1 --skip-nx-cache` (exit 0, 32.8 s) then
  `npx nx run ptah-electron:copy-renderer-dev --parallel=1 --skip-nx-cache` (exit 0). `dist/apps/ptah-electron/main.mjs` is dated
  17:56 and `renderer/index.html` 17:58, after the working-tree edits. Renderer URL confirmed as
  `file:///D:/projects/ptah-extension/.claude-worktrees/clean-session-followups/dist/apps/ptah-electron/renderer/index.html`.
  The page showed the new header (lucide icons), so the bundle under test is the fixed one.
- Launch (two deviations from the brief, both forced by the machine state):
  1. Port 9333 was taken by another worktree's electron (PID 21596, `task-647-setup-hub-chat-sessions`) and 9334 by
     `command-center` (PID 27624). I left both alone and used `--remote-debugging-port=9351`.
  2. That task-647 instance holds the real `Ptah Dev` profile, and `main.ts:54-56` hard-sets `userData` to it and then calls
     `requestSingleInstanceLock()`, so a second instance quits at once (verified twice). I wrote a launcher,
     `.ptah/tmp/a1117-launcher.mjs`, that sets NODE_ENV=development, redirects `userData` to a private copy of the profile
     (`.ptah/tmp/a1117-appdata/Ptah Dev`, robocopy without caches) and skips the lock, then imports this worktree's `main.mjs`.
     Sessions come from `~/.ptah/state/sessions-dev.sqlite`, so the same workspace and S4 session loaded. The copy had no effect on
     the original profile. The launcher is a test harness only; no repo file was changed.
- Playwright `connectOverCDP`, `setViewportSize` 1440 / 760 / 400 x 900, themes via `document.documentElement.dataset.theme`
  (`anubis` dark, `anubis-light` light). No prompt sent; only existing session "S4" (`ptah-final-run-ws`, two finished codex
  lanes) was opened. Workspace and Sessions sidebars closed as before. The lane hover card was dismissed (blur, pointer away, one
  Escape at 760) before every lane shot.
- Scripts and logs in `.ptah/tmp/`: `a1117-lib.mjs`, `a1117-hdr.mjs` (focus-header, Tab focus), `a1117-lane.mjs` and
  `a1117-x6.mjs` (lane-view 760 retake, ring contrast), `a1117-run2.mjs` (inspector, compact), `a1117-x3.mjs` (Escape),
  `a1117-x4.mjs` (scoped compact checks, scroll), `a1117-x5.mjs` (synthetic badges); logs `run-a1117-*.log`.
- Note: my first header pass was taken while the lane view was still selected from a probe; it was discarded and redone with
  the Orchestrator tab selected, as in the before set.

## Per-shot table

Before = `screenshots/before-11-17/<name>`, after = `screenshots/after-11-17/<name>`. All 22 before names have an after twin.

| Shot (dark and light, same name pattern) | Change | Intended? |
| --- | --- | --- |
| `focus-header-1440-*` | model chip `claude-opus-5-5` gone; `▣ Compact` / `⋯` / `× Close` text buttons became three 24x24 icon buttons | Yes (11, 12) |
| `focus-header-760-*` | glyph buttons (`▣ ⋯ ×`, 17-20 px wide) became 24x24 lucide icon buttons | Yes (12) |
| `focus-header-400-*` | same icon buttons; `ⓘ` details toggle still a Unicode glyph, 22x24 | Yes (12); glyph left as is (see Moderate 4) |
| `lane-view-1440-*` | "Back to conversation" gone; card frame, `codex` name badge, chevron, CLI id badge, `↑ 11.9k ↓ 56` bar gone; `completed`, Resume, elapsed, usage row, collapsed Task remain | Yes (14, 17); content now flush to the pane edges (Serious 1) |
| `lane-view-760-*` | same as 1440 (card retaken after dismissing the hover card) | Yes; same gutter defect |
| `lane-view-400-*` | same as 1440; page-level overflow still clips the right edge | Yes; same gutter defect |
| `inspector-agents-1440-*` | Model tile is now label over bold 15 px value with tile padding; AGENTS rows lost the `Usage: ...` line and `· 66h` suffix, got a duration badge; first row now shows the activity `pong` | Yes (13, 15) |
| `inspector-agents-400-*`, `-400-scrolled-*` | same Model tile and AGENTS rows in the sheet | Yes (13, 15) |
| `compact-1440-*` | before: header label change only, body unchanged. After: condensed card (title, status, model line, last activity, lanes, stats footer); transcript and composer hidden; inspector aside still shown | Yes (16); inspector still visible (Serious 3) |
| `compact-400-*` | same card, clipped on the right by the pre-existing page overflow | Yes (16) |

Extra shots: `compact-760-dark.png`, `focus-header-focus-1440-{dark,light}.png` plus `-clip` crops (Tab focus on the compact button),
`lane-view-details-open-1440-dark.png` (Task expanded), `escape-after-1440-dark.png`,
`inspector-agents-badges-synthetic-{1440,400}-{dark,light}.png` and `-280-dark-full.png` (synthetic badges, see item 15).

## Per-item evidence

### 11 - no model chip in the focus header: PASS
At 1440 the header text is `S4 done`; `chips` query (spans containing claude/opus/gpt/sonnet) returned `[]`. Before: `S4 claude-opus-5-5 done ...`.
`ptah-canvas-focus-header` text at 760 and 400 unchanged (`S4 done`, plus `ⓘ` at 400).

### 12 - icon-only lucide header buttons: PASS (one Serious ring finding)
| Button | text | title | aria-label | svg | box |
| --- | --- | --- | --- | --- | --- |
| `[data-compact]` | empty | `Switch to compact view` | `Switch to compact view` | `svg.lucide.size-4` (16x16) | 24x24 |
| `[data-header-menu]` | empty | `More session actions` | `More session actions` | yes | 24x24 |
| Close | empty | `Close session` | `Close session` | yes | 24x24 |
In compact mode the same button reads `Switch to full view` (title and aria-label). Same results at 760 and 400.
Keyboard focus (Shift+Tab then Tab onto the compact button): `:focus-visible` true, `outline: 2px solid`, offset 2 px; ring visible in
`focus-header-focus-1440-dark.png` (blue, 3.59:1 against `rgb(19,19,23)`) and `-light.png`. The light ring is weak, see Serious 2.
Targets 24x24 meet the WCAG 2.2 AA 24 px minimum (2.5.8); the 44 px figure is vendor guidance only.

### 13 - inspector Model tile: PASS
`<div class="col-span-2 rounded-md border border-surface-border bg-surface-1 p-2.5"><div class="text-[11px] text-base-content-muted">Model</div><div class="text-[15px] font-semibold" title="claude-opus-5-5">Opus 5.5</div></div>`.
Label and value are separate block elements (font-weight 400 and 600, 11 px and 15 px). Padding `10px`, identical to the Context, Tokens,
Cost and Agents tiles (all `p-2.5`; their values are weight 600). Before: one `div` with two inline spans, `textContent` `ModelOpus 5.5`.
Same at the 400 sheet.

### 14 - no "Back to conversation", Escape returns: PASS (with a focus caveat)
- `backBtn` count 0 at 1440, 760, 400 (buttons list in the lane view has no back control).
- Escape with focus inside the lane view (clicked the lane header, then Escape): lane tab selection returned to Orchestrator
  (`sel:["true","false","false"]`), the focused element became `TEXTAREA` (composer). Repeated at 760 and 400 (`ESC-760`, `ESC-400`:
  Orchestrator tab selected, chat view visible).
- Caveat: Escape pressed while focus is still on the lane tab (outside the lane view) only closes the hover card and leaves the lane
  open (`onDocumentEscape` in `canvas-lane-tabs.component.ts:366` consumes it; the lane's own handler is on the lane host,
  `canvas-lane-view.component.ts:50`). A mouse user who clicks the tab then presses Escape needs two presses or a click first. This is
  expected by design, not a defect I am filing.

### 15 - AGENTS rows: PASS, with caveats on data coverage
- No raw usage line: `/Usage:/` absent from the AGENTS text; row aria-labels are `codex, CLI lane, done 67h 14m. pong` and
  `codex, CLI lane, done 67h 25m`. Row 1 now shows the real last activity `pong` (before: the usage line replaced it).
- Badges: both rows show the duration badge (`ptah-duration-badge`, e.g. `4034m 14s`). The token and cost badges did not render because
  both fixture lanes carry no `usageTotals` (lane view shows `ctx — —`, cost `—`). So token and `~` cost badges were not exercised
  with real data. I inserted synthetic badges with the exact classes from `inspector-agents-section.component.ts` (`11.9k tokens`,
  `~$0.12 est.` from `formatEstimatedCost`, plus the real duration badge): the estimate marker is `~` plus ` est.`, the badge
  container is `mt-1.5 flex flex-wrap items-center gap-1.5`, and nothing overflowed.
- Overflow: real DOM at the 1440 aside (319 px root, li 309 px): `scrollWidth == clientWidth`, `rootOver` false. With the synthetic
  badges at 360, 320 and 280 px asides: li `scrollWidth == clientWidth` each time (349/309/269), `rootOver` false. In the 400 sheet
  (li 390 px) with synthetic badges: no overflow. Screenshots: `inspector-agents-badges-synthetic-*.png`.
- Pre-existing 400 px page overflow is separate (see below).

### 16 - Compact shows the condensed card: PASS for the card, FAIL for "inspector hidden"
- Pressing the header button at 1440, 760 and 400 shows `ptah-compact-session-card` inside `ptah-canvas-focus-area`: title `S4`, `Done`
  status plus `DONE` pill, workspace, model line `— · claude-opus-5-5 · —`, `NOW` last activity ("A second Codex completion signal ..."),
  `LANES 2 done` with two clickable codex rows (`Open codex output, done`, durations 67h 15m / 67h 26m), footer
  `467.0k tokens  Cost —  1 agents  Context 0%  +3710 -0`. Empty sections: 0 (`emptyBlocks` 0). Transcript and composer
  are not visible (`chatInput:false`, `transcriptVisible:false`), as the plan accepts (review item M2).
- Full-view action in the card (`Full view` button, 1440): card gone, header reads `Switch to compact view`, composer and transcript
  back. Header button: same result at 1440, 760 and 400.
- Scroll position kept: set 700, round trip via the card gives 684; set 1200, round trip via the header gives 1184. About 16 px
  drift per round trip (about one line), position otherwise preserved.
- Inspector: at 1440 `ptah-session-inspector` stays visible in compact (`inspectors: ["aside.other"]`, the "This session" panel in
  `compact-1440-*.png`). The `hostsInspector` fix in `chat-view.component.ts` only governs chat-view's own inspector; in the Canvas the
  aside is hosted by `canvas-rail-board.component.ts:207`, which is not tied to the tab's compact state. At 760 and 400 no inspector
  is shown anyway (sheet closed). See Serious 3.

### 17 - flat lane thread: PASS (spacing defect aside)
`LANEVIEW` at 1440, 760, 400: card frame computed `border: 0px solid`, `border-radius: 0px`, transparent background; name badges
(`badge` with text `codex`) 0; chevrons (`Collapse/Expand ...` aria-labels) 0; `↑ n / ↓ n` bar entries 0. Remaining: `completed` status badge,
Resume button (`title="Resume session"`, `aria-label="Resume agent session"`, success-coloured icon), elapsed `67h 8m`, usage row
`ctx — —` (`role=group aria-label="Lane usage"`, duration no longer duplicated there), `<details>` Task collapsed
(`open:false`, summary `Task  Parent: 18e50e43…`). Expanded (`lane-view-details-open-1440-dark.png`): task text plus
`CLI session: 01a136d5-22fb-7f41-b6c8-a314083dc65e`. Not present in this data: model (the lane has none, same as before), Stop (lane is
done; Resume shown instead).

## Findings

### Serious

#### 1. Flat lane view has no gutter; content touches the pane edges
- File: `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts:76` (`p-2` removed from the cli wrapper) and `:146`
  (`p-2` removed from the subagent wrapper); `agent-card.component.ts` adds `!px-0` for flat on the usage row, `<details>`, summary and
  body; `cli-agent-output.component.ts` flat mode.
- Viewports: 1440, 760, 400, dark and light.
- Screenshots: `lane-view-1440-dark.png`, `lane-view-1440-light.png`, `lane-view-760-dark.png`, `lane-view-400-light.png`,
  `lane-view-details-open-1440-dark.png`.
- Problem: measured layout at 1440: lane view, card, header, usage row, details and output all at x=368, width 720, padding `0px`.
  The focus header above has a 12 px inset (`S4` text at x=380). `completed`, `ctx —`, `Task`, and the output text `pong` sit flush
  against the left pane edge; `67h 12m`, the cost `—` and `Parent: 18e50e43…` sit flush against the right edge, next to the inspector
  border. Before, the card frame supplied an 8 px margin and 8 px inner padding.
- Impact: the thread reads as unstyled and misaligned with the header; long task text and the CLI session id run edge to edge. Text
  touching a scroll/pane boundary is hard to read and looks like a clipping bug.
- Fix: give the flat lane container a horizontal inset equal to the header (`px-3`), applied once on the wrapper at lines 76 and 146
  rather than per row.

#### 2. Focus ring on the icon buttons is 1.4:1 in the light theme
- File: `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts:164, 220, 272`
  (`focus-visible:outline-primary`).
- Viewport: all; light theme.
- Screenshot: `focus-header-focus-1440-light.png`, `focus-header-focus-1440-light-clip.png`.
- Problem: computed outline `2px solid oklch(0.85 0.138 181.071)` = rgb(68,235,211) against header background rgb(250,247,245):
  contrast 1.4:1. Dark theme ring is `oklch(0.546 0.215 262.9)` = 3.59:1 and is fine.
- Impact: keyboard users in the light theme can barely see which header button is focused. Criterion: WCAG 2.2 AA 1.4.11 Non-text
  Contrast (3:1) for focus indicators.
- Fix: use a ring token that holds 3:1 on `base-100` in both themes (for example `outline-base-content`, which the Model tile button in
  `inspector-session-stats.component.ts` already uses), or a theme-aware focus colour.

#### 3. Inspector stays visible while compact in the Canvas (item 16 expectation not met)
- File: `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` (`hostsInspector`, now false while the card shows) versus
  `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:207` (the aside the user sees).
- Viewport: 1440 (aside exists only there).
- Screenshot: `compact-1440-dark.png`, `compact-1440-light.png`.
- Problem: after Compact, `ptah-session-inspector` is still visible in `aside` (DOM `inspectors:["aside.other"]`), duplicating the card's
  stats (Tokens 467.0k, Agents, lanes) beside it.
- Impact: the compact view is not condensed in the Canvas; the brief says the inspector is hidden while compact.
- Fix: have the board hide its inspector aside when the focused tab's `viewMode` is `compact`, or confirm that the board aside is
  meant to stay and amend the expectation.

### Moderate and minor

1. Moderate - Duration badge unit: `formatDurationMs` (`libs/shared/src/lib/utils/usage-format.utils.ts:9-21`) never rolls minutes into
   hours, so the AGENTS badges read `4034m 14s` while the lane view and aria-label read `67h 14m` for the same lane
   (`inspector-agents-1440-dark.png`). The done lane's value also keeps growing between shots (4028m 57s to 4045m 36s), because these
   restored lanes have no end time; that part also shows in the before shots (66h 27m to 66h 47m).
2. Moderate - Tokens are no longer visible anywhere for restored lanes: the up/down stats bar is removed (item 17), the raw usage line is
   hidden (item 15), and the new token and cost badges need `usageTotals`, which these lanes lack (lane `ctx — —`). The data existed before
   as `↑ 11.9k ↓ 56`. Show a token badge from the parsed usage segment when `usageTotals` is absent, or confirm that live lanes always carry
   `usageTotals`. Not verifiable here (no running lane, no prompt allowed).
3. Moderate - Compact card repeats information: title `S4` is shown in the header and again in the card; status appears three times (header
   pill, `Done`, `DONE` pill); card `Full view` duplicates the header toggle (`compact-1440-dark.png`). Composer and transcript are hidden
   (accepted in decisions row 20, M2).
4. Moderate - At 400 the `ⓘ` details toggle (`canvas-focus-header.component.ts`, `[data-details]`) is still a Unicode glyph and visibly differs
   from the lucide icons beside it (`focus-header-400-dark.png`). Not in the item 12 list.
5. Moderate - Lane hover card at 760 stays open after click, blur and pointer move; it needs an Escape and covers the lane header
   (`TIP [0,1]` then `[1,0]` after Escape). Pre-existing behaviour of `canvas-lane-tabs`, noted because it hides the lane in a naive shot.
6. Minor - Scroll position after compact round trip drifts by about 16 px (700 to 684, 1200 to 1184).
7. Minor - In the dark theme the synthetic token badge (`badge-outline`) renders with a near-white outline that outweighs the ghost cost and
   duration badges beside it (`inspector-agents-badges-synthetic-400-dark.png`).

## Regressions vs before

- Flush lane content (Serious 1) is the only visual regression caused by the change; everything else moved as intended.
- Cost tile: `$0.55` in the first dark shot, `cost unavailable` in later ones. `inspector-session-stats.component.ts` does not touch the
  cost tile (diff is the Model tile only), so this is data loading drift, the same flip the before report recorded. The shots show both
  states: `lane-view-1440-dark.png` ($0.55) and `inspector-agents-1440-dark.png` (unavailable).
- Known pre-existing 400 px horizontal overflow: unchanged. `document.documentElement.scrollWidth > innerWidth` is true at 400 in
  `focus-header-400-*`, `lane-view-400-*`, `compact-400-*` (lane pane 312 px wide starting at x=120 ends at 432). The top nav tabs and
  "New Session" stay clipped; the compact card and lane view are clipped by the same overflow. 760 and 1440 do not overflow.

## Not captured, and why

- Token and cost badges with real data: the only available lanes have no `usageTotals`; sending a prompt or spawning a lane was out of
  scope. Covered by synthetic DOM insertion (labelled above).
- Running lane (Stop button, live elapsed, permission prompts) and a lane with a model value: none exist in the fixture.
- Subagent lane view (`canvas-lane-view.component.ts:146`) has the same removal of padding but was not opened; assume the same gutter
  defect, to be rechecked after the fix.
- Compact at 760 in light, inspector sheet at 760: not requested (a dark `compact-760-dark.png` was taken as a bonus).
- Port 9333 and the real `Ptah Dev` profile were occupied by another worktree's electron, so the run used port 9351 and a profile copy
  (see How captured).

## Cleanup

Electron processes launched by me (launcher `a1117-launcher.mjs`, two instances, one was an error-dialog left by a bad path in the first
launcher version) were stopped with `taskkill /T /F`; none of them remain. Port 9351 is free. Port 9333 is still held by
PID 21596 (`task-647-setup-hub-chat-sessions`), which is not mine and was left running.
