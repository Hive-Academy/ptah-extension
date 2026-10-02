
## Batch 14

Scope: three new cells (Merged, Retired, Dormant) appended after Rejected in `role="group" aria-label="Candidates by status"` of `skill-pipeline-status.component.ts` (uncommitted diff, +18 lines of template).

### Method

Not the Playwright webview harness (it needs a full webview build plus Thoth shell RPC mocking, far heavier than a 3-cell change warrants) and no temporary worktree was needed. Used an isolated render of the exact markup:

- BEFORE markup extracted with `git show HEAD:libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.ts`; AFTER from the working tree file (read-only, nothing in the worktree edited, no stash/checkout, no install).
- `{{ counts.* }}` substituted with static values: small case 578/12/1876/40/7/3 (Candidates/Promoted/Rejected/Merged/Retired/Dormant) and a 4-5 digit case 12345/1234/98765/4321/1007/2048.
- Styled with the real webview stylesheet: `apps/ptah-extension-webview/src/styles.css` + its `tailwind.config.js` (daisyUI, `base-content-muted`) compiled by the repo's tailwindcss 3.4.19 CLI; themes `anubis` (dark) and `anubis-light`.
- Chromium via the repo's Playwright. Widths 320, 400 (VS Code sidebar) and 1280. Card is the real section classes plus placeholder text for the other bands, which are not under review (Last analysis and Refresh are stand-ins, so only the by-status band is valid evidence). Source is static HTML, so the live `skillSynthesis:diagnostics` wiring and Thoth shell mount were NOT exercised.
- Build scripts and fixtures: `visual/batch-14/_work/` (`build.mjs`, `shoot.cjs`, `c.cjs`); raw numbers in `visual/batch-14/metrics.json`.

### Screenshots (`.ptah/specs/TASK_2026_578_3b00/visual/batch-14/`)

24 PNGs named `{before|after}_{small|big}_{dark|light}_{320|400|1280}.png`. Key ones:
- `before_small_dark_320.png`, `after_small_dark_320.png`, `before_small_light_320.png`, `after_small_light_320.png`
- `after_small_dark_400.png`, `after_big_dark_400.png`, `after_big_light_320.png`
- `before_small_dark_1280.png`, `after_small_dark_1280.png`, `after_small_light_1280.png`

### Results

| Check | Result |
| --- | --- |
| Wrap at 320 (small values) | 3 lines, 56 px tall (BEFORE 2 lines, 36 px). Line 1: label + Candidates; line 2: Promoted, Rejected, Merged; line 3: Retired, Dormant. Each cell stays intact (number never separated from its label). |
| Wrap at 400 | small: 2 lines (36 px, same height as BEFORE); big (4-5 digit): 3 lines (56 px). |
| Wrap at 1280 | single line, 16 px, ends around x=660 of 1264. |
| Overflow / clipping | None at any width; no horizontal scroll (`scrollWidth <= innerWidth` in all 24 captures). |
| Contrast, number (`text-base-content`) on card background | dark 14.59:1, light 15.25:1 |
| Contrast, label (`text-base-content-muted`) | dark 5.22:1, light 4.80:1; both meet WCAG AA 4.5:1 for 12 px text. Background is the card's `bg-base-200/40` composited on `bg-base-100`. |
| Focus order | Unchanged. The new cells are plain spans (no tabindex/links); the only tabbable in the card remains Refresh. Group semantics (`role=group`, label) retained; the three new items add no new announcements beyond their text. |
| Layout shift with growing values | The band height is stable for a given width until a cell no longer fits on its line; the 400 px case moves from 2 to 3 lines when values go from 1-3 digits to 4-5 digits (+20 px). This is flex-wrap reflow of a card at the bottom of band 1, not a moving control, and `tabular-nums` keeps digit widths stable. No jitter inside a width class. |

### Findings

BLOCKING: none.

SERIOUS: none.

MODERATE: none.

MINOR
1. At 320-400 px the 6 values wrap 3-2-2 style with a ragged last line ("Retired / Dormant" alone). Evidence: `after_small_dark_320.png`, `after_small_light_320.png`. Not a defect (clean wrap, no clipping), but a `grid grid-cols-2 sm:flex` or `gap-x-4` would give a more even block if the extra 20 px matters. Optional.
2. The leading label "Candidates by status" is itself a flex item, so it consumes the first line slot together with "Candidates"; it is also the group's `aria-label`, so it is visually redundant for sighted users but harmless. Pre-existing, not introduced by Batch 14.
3. Muted label contrast in light theme is 4.80:1, close to the 4.5:1 floor (pre-existing token `--bcm`, unchanged).

### Verdict: APPROVED

Confidence: MEDIUM-HIGH. Limits: static fixture (not live data or the Thoth shell mount), stand-in header content, Chromium only. Consistent with the existing three cells (same markup and classes), no regression in contrast, focus or overflow.
