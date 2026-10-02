# Visual Review (AFTER) - TASK_2026_586_2b3e

Verdict: APPROVED

## Environment and run result

- Rendering path: same as `visual-review-before.md` (Playwright harness `libs/frontend/webview-e2e-harness`, real `ptah-extension-webview` bundle, in-page RPC auto-responder). Chromium only; viewports 375x812, 1024x768, 1366x768 (audit selection, not a support contract); themes `anubis` (dark) / `anubis-light` (light).
- Disk check: D: had ~52 GB free (A5 / R13 satisfied; no ENOSPC).
- Rebuild: `npx nx build ptah-extension-webview --configuration=development --skip-nx-cache` on branch `fix/task-586-thoth-activity-feed` (HEAD 2f53d1868), exit 0, 1m42s. All `*.map` files under `dist/apps/ptah-extension-webview` deleted afterwards (as at BEFORE).
- Spec run: `SHOT_DIR=.../screenshots/after npx playwright test --config=playwright.config.ts thoth-feed-visual --workers=2` -> **6 passed (26.3s), 36 PNGs** in `.ptah/specs/TASK_2026_586_2b3e/screenshots/after/`. All Batch 6 assertions passed (tile 2 -> 3, no accordion / triggers panel on Activity, status card + enabled Refresh, newest error first, sess-1001 one row with x5 and newest id, same-ms rows with distinct ids, triggers card on Skills > Settings and feed absent there).
- Fixture / locator patches: **none**. The spec was run unmodified; no production source edited.

## Findings (AFTER vs BEFORE)

BEFORE defects 1-8 re-checked:

| # | BEFORE defect | AFTER | Evidence |
| --- | --- | --- | --- |
| 1 | Oldest-first, newest 5 hidden | FIXED. First row = `error` 32s ago; order newest -> oldest ending `ineligible 6h ago`. All three viewports, both themes. | `03-event-feed-closeup-{375,1024,1366}-{dark,light}.png` |
| 2 | Duplicate rows | FIXED. `analyze-run x5 sess-1001` and `analyze-run x2 sess-3001` badges (dark: outlined white-on-dark, light: pale pill, both legible). Distinct errors/sessions are not merged. | 03 at 1366 dark/light |
| 3 | Colliding row identity | FIXED in DOM (distinct `data-event-id`, asserted); visually the two same-ms `ineligible` rows (sess-2002, sess-2001) render in correct newest-first order. | 03-1366 |
| 4 | Stale status chip from oldest event | FIXED. The orange "ineligible" chip is gone because the newest event is `error` (chip only shows for ineligible / rate-limited latest, `skill-pipeline-status.component.ts:429-431`). Consistent with parity A3. | `04-pipeline-status-closeup-*` vs before 02/04 |
| 5 | Overlapping summaries / accordion | FIXED. One status card (Last analysis w/ absolute time, Last curator pass, sessions today, histogram, Candidates by status), then Drain runs, Stage cost, then Recent events. No accordion, no repeated "Last analyze run" cards. `Refresh` button top-right of card, enabled, text contrast fine in both themes. | `02-skills-activity-full-*`, `04-*` |
| 6 | Stale shell tile | FIXED. Tile "2 pending" at first load (01) becomes "3 pending" after the Skills tab click (workspace scope), not the all-workspace 7. | `01-*` (2) vs `02-*` (3), all viewports/themes |
| 7 | Triggers inside Activity | FIXED. Activity has no triggers; Skills > Settings shows a "Triggers" card ("Changes here save immediately.") with 5 checkboxes + 3 numeric inputs, turn-complete unchecked as fixtured. Checkbox/field borders visible in dark and light. | `05-*-1024/1366-*`, `06-settings-*` |
| 8 | Silent truncation | UNCHANGED (see M2). | 03 |

No overlap, no new horizontal overflow, no layout shift observed between shots (static captures; shift not measured with traces).

### BLOCKING

None.

### MODERATE

- M1. 375px shell clipping persists (identical to BEFORE, pre-existing, not introduced here): content column wider than viewport, "Run Curator", "Candidates", "Memory" cut on the left, tabs "Settings" cut right (`02-skills-activity-full-375-*`, `01-*-375-*`). Compared against BEFORE, pixel layout of the shell is the same. Out of scope; recommend a follow-up task.
- M2. Narrow-width degradation of feed rows (`03-event-feed-closeup-375-*`): the relative time wraps to two lines ("32s / ago", visible on the error row also at 1366: `03-event-feed-closeup-1366-*`), session id truncates to `sess-30...` / `se...`, and the long error message ellipsises with no title/expand (BEFORE defect 8 retained, unrelated to ordering). The newest-error row, which matters most, is the one that truncates; consider `title`/wrap for error rows and `whitespace-nowrap` on the time column.

### MINOR

- m1. `05-trigger-toggles-closeup-375-{dark,light}.png` do not show the Triggers card: the element screenshot lands on "Max attempts per item" under the sticky shell tiles (capture artifact of element-clip at 375 with the clipped shell). Triggers at 375 are verified in `06-settings-375-dark.png` (card fully visible, inputs 40px high). Spec locator/scroll for 375 could be adjusted if a closeup is wanted; not patched per instructions (assertions pass).
- m2. Triggers card sits below the form's "Save settings" button, so a user may read the single Save as covering the toggles; the card's subtitle "Changes here save immediately." mitigates (`06-settings-1366-light.png`).
- m3. Settings form fields render empty (the settings RPC is not fixtured, only the Providers/triggers RPCs); this is a fixture limitation, not a UI defect (`06-settings-1366-light.png`).
- m4. "Analyze current session" is disabled with hint "Open a session to analyze it manually"; disabled low contrast is exempt (WCAG 1.4.3) and the hint text is legible (`03-1366-dark/light`).
- m5. Shot "full" captures are clipped to the viewport height because the page scrolls inside the shell (same as BEFORE).
- m6. Skills tile (3, workspace scope) intentionally differs from the stats strip Candidates 7 (fixture status RPC returns all-workspace totals); not a regression, but a fixture-level inconsistency worth knowing when reading 02.

## Contrast / focus / overflow notes

- Contrast was assessed visually from the screenshots, not numerically (no browser evaluation was run in this pass). Primary text, badges (error red, curator-pass blue, analyze-run green, ineligible orange, count badges x2/x5) and Refresh read clearly in both themes at all widths. Pre-existing light-theme faint "0 running" Messaging tile is unchanged from BEFORE.
- Focus states: not exercised by this spec (no Tab-through captured); not evaluated. Residual risk: LOW (no new interactive primitives other than Refresh and checkboxes using existing components).
- Overflow: no horizontal overflow inside the new cards at any viewport; the only overflow is the pre-existing 375 shell (M1).

## Residual uncertainty

Static screenshots only; no live-update (new event arrival) motion, hover, or keyboard focus evidence. Chromium only.
