VERDICT: APPROVED

Score: 8.5/10 (round 1; round 0 was REVISE 6.5/10, kept below)

Counts after round 1: visual breaking 0, serious 0, moderate 1, minor 1.

## Round 1 re-check (revise round 1, same harness, fresh dev build of the working tree)

Evidence: `visual-c22/round1/` (screenshots and `results.json`), scripts `run2.mjs`, `tab2.mjs`. Dark `anubis` and light `anubis-light` at 360/800/1400.

| Finding / claim                   | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Dot contrast (serious)         | FIXED. All dots are 10px with a `border-base-content/70` ring. Ring vs card: 7.68:1 dark, 6.21:1 light (executor claimed 7.69/6.18, within rounding). Ring over each fill vs card: 9.5 to 12.7 in both themes; "not open" is a hollow ring (7.68 dark, 6.21 light). Fills alone are still 2.37 to 2.59 in light, but the ring now carries the 3:1 shape. `round1/card-three-anubis-light-*.png`.                                                                                                                                                                                                                            |
| 2. Truncated phase text (serious) | FIXED. Two lines: line 1 icon, up to 5 dots, `+2`, `7 sessions`; line 2 every phase in words, wrapping (T5 crowded card: `1 failed · 1 background work · 1 sleeping · 3 idle · 1 not open` on two lines, phase height 40px, `phaseTruncated:false`, line 1 no overflow, no card or document overflow). 3-session card: `1 running · 1 idle · 1 not open`. `round1/card-long-anubis-light-1400.png`, `card-long-anubis-1400.png`. The first-session-first emphasis is gone (counts are grouped by phase); acceptable.                                                                                                        |
| 4. `+N` marker                    | VERIFIED. T5 shows `+2` with aria-label and title "2 more sessions not shown as dots"; absent when all sessions fit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 3. Layout shift (moderate)        | PARTLY. With the 1200 ms delayed `session:listForTasks` on first visit the fetch starts with the view but the board arrives first, so cards still grow when the response lands: T2 160 to 208, T3 140 to 188, T4 136 to 184 (up 48px each, taller than round 0 because the row is now two lines), T3 top 511 to 559, CLS 0.0286 (still under 0.1, T1 without sessions does not move). Revisit: after switching to chat and back, rows are present at 150 ms (map kept), height already 207.5, with a background refetch of both RPCs. `round1/shift-before-fetch-800.png`, `shift-after-fetch-800.png`. Remaining moderate. |
| Regression checks                 | Unchanged and passing: row absent with no sessions and with `{available:false}` (0 rows, 5 cards); PR link 24px high, 34.8 to 54.3px wide, text contrast 14.86 dark / 15.92 light; link focus ring 2px (`oklch(0.58 0.132 75)` light, `oklch(0.7665 0.1387 91.06)` dark); roving order T1:0 then ArrowDown T2:0, Tab reaches `task-card-session-pr`; click and Enter on the link open the PR URL and fire no `tasks:get`; reduced motion stops the pulse; 0 console errors.                                                                                                                                                 |

Remaining items: moderate, first-visit shift of up to 48px when the row arrives (cannot be reserved without knowing which tasks have sessions; consider fetching before the first board paint if it matters); minor, 10px row text and the pre-existing 360px header overlap (left as is, both accepted). Confidence HIGH. VERDICT: APPROVED.

---

# Round 0 (superseded)

# Visual Review - TASK_2026_580_9f77 Batch C2.2 (linked-sessions row on the task card)

## Environment

- Build: `npx nx build ptah-extension-webview --configuration=development` run in the worktree after the C2.2 files were in the working tree (so the bundle contains C2.2). Served from `dist/apps/ptah-extension-webview/browser` by a throwaway Node static server on 127.0.0.1 (random port), driven by Playwright Chromium. The Electron app was not launched.
- Host stub: VS Code-style (`ptahConfig.isVSCode`, `workspaceRoot` set so `workspaceInfo` exists, `acquireVsCodeApi` shim). RPC fixtures: `tasks:board` (5 tasks) and `session:listForTasks` (seeded; `{available:false}` for the VS Code state; delayed 1200 ms for the shift test). View entered with the `switchView` message to `tasks`.
- Themes: `anubis` (dark) and `anubis-light`. Viewports: 360, 800, 1400 (height 900). Repo documents no support matrix, so these are the requested audit selection.
- Before/after: before = the host-without-store state (`{available:false}`), which renders exactly what HEAD renders (no row): `visual-c22/before-equivalent-unavailable-800.png`. A true HEAD build was not made (about 2 min build, and the no-row state is the same DOM). After = `visual-c22/after-<theme>-<width>.png`.
- Scripts and raw numbers: `visual-c22/run.mjs`, `visual-c22/tab.mjs`, `visual-c22/results.json`. All processes were stopped (server closed, browser closed, no Electron).

## Findings

### Serious

#### 1. Light-theme phase dots fail 3:1 non-text contrast (WCAG 1.4.11)

- File: `libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts` (`SESSION_PHASE_DOT_CLASSES`, about line 98; dot span with `w-2 h-2 rounded-full`).
- Viewports: all (360/800/1400), `anubis-light` only. Dark passes (3.84 to 8.81).
- Evidence (dot fill vs card background, measured via computed colour): generating (`bg-info`) 2.59, idle (`bg-success`) 2.37, awaiting-background (`bg-warning`) 2.46; failed 3.57, sleeping 4.11, not-open ring 3.28 pass. Screenshot: `card-three-anubis-light-1400.png`, `card-three-anubis-light-360.png`.
- Impact: the dots are the only visual carrier of phase for sessions 2..N (only the first session's phase is written in text), so low-vision users cannot distinguish them on the light theme.
- Fix: use darker fills in light theme (for example `bg-info`/`bg-success`/`bg-warning` with a darker content token, or a 1px `border-base-content/60` ring around every dot) so each reaches 3:1 against the card. Re-measure.

#### 2. Written phase for the first session is truncated away when the row is crowded (WCAG 1.4.1 fallback lost)

- File: `task-card.component.ts`, the `data-testid="task-card-session-phase"` span (class `truncate`) inside a row that also holds 5 dots, a count and a 54px PR link.
- Viewports: all (card is a fixed 240px wide in every viewport). Screenshot: `card-long-anubis-1400.png` (renders `7 sessions · b…`; the word "background work" is cut to 23px).
- Evidence: results.json, `TASK_T5_long` `phaseTruncated: true`, `phaseWidth: 23`. With 3 dots and `#42` it fits (`3 sessions · running`).
- Impact: with 4+ sessions and a PR link the only non-colour phase statement vanishes visually. The `title` and `aria-label` still carry it (screen readers fine, mouse users need hover), so sighted users see only multi-hue dots.
- Fix: let the phase text go to its own line (`flex-wrap`) or drop it before the dots (for example hide it below the count when the row is narrower than needed), or show the count/PR first and move the phase into a tooltip-only slot while keeping a text fallback such as the worst phase. Re-check at 240px with 5 dots plus `#1234`.

### Moderate

3. Cards grow when the row arrives after the fetch. With a 1200 ms RPC delay at 800px the cards with sessions grew 160 to 190, 140 to 170 and 136 to 162 px, pushing the cards below them down by up to 30px (T3 top 511 to 541). Measured CLS 0.0144 (below the 0.1 "good" line), cards without sessions (T1) did not move. Evidence: `shift-before-fetch-800.png`, `shift-after-fetch-800.png`, results.json `shift`. Not blocking; a short reserved-height skeleton is only possible if the fetch resolves per board before cards render, so it is reported rather than required.
4. Dot-cap overflow is silent: T5 has 7 sessions, 5 dots shown, count says "7 sessions". The cap is by design, but nothing indicates "+2" (acceptable because the count states 7; noted for the C2.3 detail list).

### Minor

5. Row text is `10px` (`text-[10px]`) matching the card's other micro text; legible at 14.86:1/15.92:1 contrast but small. Consistent with neighbours, so not raised.

Pre-existing, not part of C2.2: at 360px the board header controls overlap ("List" collides with "Commands", `after-anubis-light-360.png`).

## Checks that passed (evidence)

| Check                                   | Result                                                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No sessions: row absent                 | T1 `row:false`, all viewports and themes.                                                                                                                                                              |
| `{available:false}` (real VS Code host) | 0 rows across 5 cards (`unavailable`), `before-equivalent-unavailable-800.png`.                                                                                                                        |
| 3 sessions, generating/idle/not open    | 3 dots; running pulse, idle green, hollow ring for "not open"; `role="note"` aria-label "3 linked sessions: Implement service, running; Review pass, idle; Old spike, not open".                       |
| PR with number / without / none         | `#42` link; `PR` link (T3); T4 has no link. All hrefs http(s).                                                                                                                                         |
| Phase not colour-only                   | Written phase on the first session plus `role="note"` label on every row (see Finding 2 for the visual gap).                                                                                           |
| Hollow dot contrast                     | Not-open ring 4.48 dark, 3.28 light.                                                                                                                                                                   |
| PR link hit area                        | 24px high by 34.8 to 54.3px wide (min 24x24, SC 2.5.8 AA met; exactly at the floor).                                                                                                                   |
| Link text contrast                      | 14.86:1 dark, 15.92:1 light, underlined.                                                                                                                                                               |
| Focus ring                              | Link: solid 2px, offset 1px, `:focus-visible` true; dark `oklch(0.7665 0.1387 91.06)`, light `oklch(0.58 0.132 75)`; `focus-link-anubis*.png`. Card ring also 2px.                                     |
| Roving tab order                        | Initial tabindex T1:0, others -1; ArrowDown moves the 0 to T2; Tab from T2 reaches select, menus, then `task-card-session-pr` (10 stops). Link `tabindex` is -1 on non-owner cards and 0 on the owner. |
| Link click/Enter does not open card     | Click opens the PR URL as a popup and no `tasks:get` RPC; Enter on the focused link behaves the same. Clicking the row body does fire `tasks:get` (control).                                           |
| Reduced motion                          | off: `animation-name: pulse`, 2s, 1 running animation; on: `none`, 0 animations (`motion-safe:` works). `running-reduced-*.png`.                                                                       |
| Layout/wrapping in card                 | No card or document horizontal overflow at 360/800/1400, both themes; row never exceeds the card; long task title wraps/clamps in the title area.                                                      |
| Console errors                          | 0 in all seeded runs.                                                                                                                                                                                  |

## Prototype fidelity

No `prototype/` folder was provided in the request; NOT APPLICABLE. Before/after comparison: dark and light after-shots for each width exist (`after-anubis-*.png`, `after-anubis-light-*.png`); before equals the no-row state (`before-equivalent-unavailable-800.png`); no regressions found on the rest of the card (header, labels, actions unchanged).

## Verdict

REVISE. No breaking defects; the row is well structured, accessible by name and keyboard, and robust at all three widths. Two serious items need fixing before merge: light-theme dot contrast (Finding 1) and the truncated first-session phase text on crowded rows (Finding 2). Confidence: HIGH (computed values from a real browser, both themes). Score reasoning: 6.5/10, sound structure and behaviour with two real accessibility gaps; it would move to 8+ once the dots reach 3:1 in light and the phase text no longer disappears.
