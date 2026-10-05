# Visual Review - TASK_2026_596_0a19 (plan-limit windows and lane usage)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | REVISE (NEEDS_REVISION) |
| Visual breaking | 1 |
| Serious | 1 |
| Moderate | 4 |
| Minor / notes | 3 |
| Viewports tested | 3 (280, 360, 440) x 2 themes (`anubis`, `anubis-light`); 280 and 440 for the contrast, keyboard and overflow probes |
| Screenshots taken | 60 harness captures + 9 probe captures |
| Components tested | plan-limit tile, lane tile, lane subtotal tile, limits alert, refresh-failed notice (strip and card), dashboard provider account card |

The strip meets the Gate 1.7 caveat and design Rev 5. The dashboard card has one real overlap at 280 px, and the light-theme focus ring is under 3:1. Both need a small fix. A third failure, light-theme Model and Context text, comes from existing cards. The score separates from 8 because of the overlap, and from 6 because the strip itself (the main surface) shows no clipping, no overflow and no contrast failure in the new code.

## Environment

- Build: `npx nx build ptah-extension-webview` from the worktree, exit 0 (includes the uncommitted Phase 6 fixes). Nx Cloud printed a 401 plan notice, which did not affect the build.
- Capture: `plan-limits-visual` run from `libs/frontend/webview-e2e-harness` with `SHOT_DIR` set. **12 passed, 0 failed (22.2 s)**, 48 base screenshots plus the 12 new `*-refresh-failed-*` ones.
- Served by: the harness fixture server serving `dist/apps/ptah-extension-webview`, which is the real bundle with a fixed clock (2026-10-05 12:00 UTC), UTC zone and `en-GB` locale.
- Probe: a temporary Playwright spec (deleted afterwards, no source touched) ran at 280 and 440 in both themes. It computed contrast from rendered colours (canvas-resolved, alpha-composited over the ancestor backgrounds) and drove the keyboard. Raw data: `screenshots/probe-strip-*.json` and `screenshots/probe-dash-*.json`.
- Expectation sources: design-spec.md Rev 5 (section 3.2, 3.3 incl. A1-A3, section 4, section 8), prototype, the user's Gate 1.7 caveat, and WCAG 2.1 AA (the standard design section 8 declares).
- Screenshot folder: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\.ptah\specs\TASK_2026_596_0a19\screenshots\`

## Findings

| # | Severity | Finding | Evidence | Design ref |
| --- | --- | --- | --- | --- |
| 1 | Visual breaking | **Status chip overlaps the owner title in the dashboard card.** The `service-unavailable` chip on the second "Claude account" section is drawn over the word "Claude". The title wraps to "Claude / account" and its first line runs under the chip. It occurs at 280 in both themes. At 360 and 440 the chip fits beside the title. Cause: `provider-account-card.component.ts:154-167`. The header is a single non-wrapping `flex` row with a `shrink-0` chip group and no `whitespace-nowrap`/`flex-wrap`/min-width on the chip, so the chip cannot give way. | `dashboard-card-owners-anubis-280.png`, `dashboard-card-owners-anubis-light-280.png` (both overlap); `dashboard-card-owners-anubis-360.png` (fine) | section 4 header + status chip; width behaviour "no state word truncates" |
| 2 | Serious | **Focus ring on tiles is under 3:1 in the light theme.** The ring is `2px info, offset 2px` as specified. The light `info` value is `oklch(0.68 0.169 237)`. Design section 8 measured light info at 2.59:1 on base-100, so the ring fails the 3:1 non-text criterion (WCAG 1.4.11/2.4.11 guidance). The dark ring `oklch(0.623 0.188 260)` is acceptable. The ring is present and 2px on every stop (verified), so it is visible but low contrast on a light card. | `probe-focus-closed-anubis-light-280.png` vs `probe-focus-closed-anubis-280.png`; `probe-strip-anubis-light-280.json` (`kb.ring`) | section 3.2 focus ring; section 8 "3:1 non-text" |
| 3 | Moderate | **Opened plan tile repeats its own face.** At 440 the opened Weekly-Opus tile shows label, value, reset line, chip and source chips, then the panel shows "Weekly · Opus / Limit reached / 100% used / Limit reached — resets..." and the same source chips again. At 280 it is two stacked blocks of near-identical text. The panel adds only the bar. | `plan-tile-open-at-limit-anubis-440.png`, `stats-strip-tiles-open-anubis-light-280.png` | section 3.2 expansion |
| 4 | Moderate | **Two owners are indistinguishable in the dashboard card.** Account A and account B are both headed "Claude account" with subtitle "Subscription quota"; only the chip and notice tell them apart. With four owners the card cannot say which account is which. | `dashboard-card-owners-anubis-light-360.png` | section 4; A1 owner identity |
| 5 | Moderate | **Restored lane shows the raw id "PTAH-CLI" and "Limit unknown"** even though its owner is a known different account with last-known Weekly 60% evidence. The open panel reads "Different owner · Claude account", then "No current read for this account · showing its last-known evidence" and "Window set not established, partial data". The face and the body disagree. Confirms harness open item 1. | `stats-strip-expanded-anubis-light-440.png`, `probe-all-open-anubis-light-280.png` | section 3.3 lane label; section 2.2 |
| 6 | Moderate | **Narrow-width caption wrapping at 280.** Tile captions ("Claude account plan limit") wrap to 3-4 lines and reset lines to 4-5 lines, so the plan tiles are about 2-3x taller than at 440. This matches the prototype's own "wrap, never truncate" rule and nothing clips, but the grid is hard to scan. A 280 px caption such as "Claude plan" would reduce it. | `stats-strip-expanded-anubis-280.png` | section 3.2 width behaviour |
| 7 | Minor, existing | **Model and Context text contrast fails in the light theme.** "Opus 4.1" `text-purple-400` is 1.86:1 and the "—" in `text-cyan-400` is 1.34 to 1.57:1. In dark, the Cost badge `badge-success` is 2.64:1. These cards predate this task, so they do not count against the new surfaces. | `probe-strip-anubis-light-280.json`, `probe-strip-anubis-280.json` | section 8 (existing cards) |
| 8 | Minor, note | **Lane tiles in the chat view carry no model scope.** The Codex lane face reads "Limit unknown" while its panel lists Codex windows. This is the known follow-up, not counted as a defect. | `lane-tile-open-different-owner-anubis-440.png` | section 3.3 |
| 9 | Minor | **Open tiles squared-corner join is not visible in light.** The tile and its panel read as two separate blocks in `anubis-light`; the dashed lane border and the solid plan border do show. | `stats-strip-tiles-open-anubis-light-280.png` | section 3.2 |

## Requested checks

### Gate 1.7 caveat and design structure
- **Plan windows are tiles in the same grid.** Model, Context, Tokens and Cost sit in the same 2-column grid. The plan tiles follow (5-HOUR, WEEKLY, MONTHLY, BURST, WEEKLY · OPUS, COOLDOWN), then the lane tiles. Duration and Agents are not in this capture because the fixture has no such data. No "Plan limits" or "Lane runs" title bars exist. PASS.
- **Each tile is expandable** (verified by keyboard, below). PASS.
- **Lanes are tiles, one per lane**, with no repeated section titles: OPENCODE, CODEX · REVIEW, CLAUDE · DOCS, COPILOT, PTAH-CLI. The "Context" label is used (not "Main context"). PASS.
- **Lane usage is visibly outside the session totals (Req 8).** All three cues are present: the "lane · not in totals" caption on every lane tile, a dashed border with a darker fill, and the "LANES · SUBTOTAL" tile (28.3k tokens known, $0.28 known cost, 5 lanes, 5 runs, 3 cost unknown). TOKENS 64.7k and COST $0.42 are unchanged. PASS.
- **A2** (a window with no session tile keeps full detail in the lane panel) is visible: the Codex lane shows its full 5-hour and Weekly windows. **A3** (open tiles stay open) was not changed by this review; the e2e flow kept both open tiles open across a refresh-failed pull. PASS.
- **Unknown is never 0.** MONTHLY and BURST read "unknown", the panels read "Used: unknown", the lane tiles read "unknown tokens / cost unknown", and no bar is drawn for unknown windows. The panel text in the capture contains no bare 0. PASS.
- **Estimate and model-scope-unknown read as info, not warning.** The estimated Codex limit shows as an info-bordered quoted note ("A local estimate suggests a limit · not confirmed", "~ Estimate"), and the dashboard shows "Estimated limit hit... (unconfirmed, informational)". Neither uses the warning or error treatment. PASS.
- **Refresh-failed notice is neutral:** info-coloured left rule, muted text, no error colour, `role="status"`. PASS (contrast below).

### Responsive (280 / 360 / 440)
- Strip: `scrollWidth == width` at 280 (196) and 440 (356), with no descendant outside the strip box. No horizontal overflow and no clipped state words in all six strip captures.
- Dashboard card: no overflow (222 and 382 px). The one failure is the chip overlap in finding 1.
- Heavy caption wrapping at 280 is confirmed (finding 6).

### Keyboard and focus (driven in the browser, both themes, 280 and 440)
- The tile button has `aria-expanded` and `aria-controls` (`ptah-stats-tile-panel-5`), and the id resolves to the panel.
- Enter: `false` to `true`, panel visible. Space: `true` to `false`, then back to `true`. (An immediate read right after the key press can still see the old value because Angular has not rendered yet; after a short wait it is correct.)
- Tab order follows the DOM: five plan tiles, cooldown, then lane tiles, then the collapse button, with no skipped or trapped element.
- Every stop shows `outline: solid 2px`, `offset 2px`. The ring colour is low contrast in light (finding 2).

## Contrast table (rendered colours, WCAG 2.1 AA, text 4.5:1)

Foreground and background are the composited sRGB values from the browser.

| Pair | Dark (`anubis`) | Light (`anubis-light`) | Result |
| --- | --- | --- | --- |
| `text-base-content-muted` tile labels on tile fill (design measured 4.46:1 light) | 152,146,145 on 24,24,29 = **5.80** (OPENCODE label on lane fill: 5.61) | 116,86,101 on 243,238,235 = **5.59** (lane fill 240,236,233: 5.48) | pass; the design's 4.46 does not occur in the rendered strip |
| `text-base-content-muted` reset line 11 px | 152,146,145 on 23,23,28 = **5.85** | 116,86,101 on 244,240,236 = **5.68** | pass |
| Dashboard "Subscription quota" 10 px muted | 5.95 | 6.05 | pass |
| Refresh-failed notice, strip (11 px) | 5.93 | 5.84 | pass |
| Refresh-failed notice, dashboard (12 px) | 5.92 | 6.04 | pass |
| State chips, text on tint (Near, Limit reached, Quota failure, Cooldown, Live, OK) | 11.15 to 12.88 | 11.67 to 13.17 | pass |
| Dashboard chips (Near, Limit reached, Cooldown) | 11.93 to 13.12 | 12.79 to 13.94 | pass |
| Tile values 14 px (`2.7k tokens`, `64.7k`) | 13.77 to 14.24 | 14.45 to 14.75 | pass |
| Focus ring colour vs card (non-text, 3:1) | `oklch(0.623 .188 260)`, acceptable | `oklch(0.68 .169 237)`, about 2.6 (design's measure) | **light fails** (finding 2) |
| Model "Opus 4.1" `text-purple-400` (existing) | 6.72 | **1.86** | existing, fails |
| Context "—" `text-cyan-400` (existing) | 9.83 | **1.34 to 1.57** | existing, fails |
| Cost `badge-success` (existing) | **2.64** | 6.01 | existing, fails in dark |

No new text in either surface falls below 4.5:1. Meters were not separately measured for non-text contrast; the percentage is always printed beside them, as the design requires.

## Prototype fidelity

- Approved prototype: `prototype/index.html`, with the Rev 5 amendments A1-A3 overriding it.
- Assessment: **MATCHES**, with the deviations in findings 1, 3 and 6.
- Chips, glyphs, source chips, dashed lane tiles and the subtotal tile all match section 4. No component was swapped for a text button.
- No before/after comparison was needed (prototype exists).

## Viewport results

| Surface | 280 | 360 | 440 |
| --- | --- | --- | --- |
| Collapsed alert (near, at-limit) | pass, wraps to 2-3 lines | pass | pass |
| Expanded grid | pass, no overflow, heavy wrapping | pass | pass |
| Tiles open | pass | pass | pass |
| Refresh-failed (strip) | pass | pass | pass |
| Dashboard card | **fail** (chip overlap) | pass | pass |

## Verdict

- Recommendation: **REVISE**. Fix finding 1 (let the dashboard header chip wrap or the header stack at narrow width) and finding 2 (a focus ring that reaches 3:1 on the light theme). Findings 3-6 are polish.
- Confidence: HIGH for the strip (real bundle, measured), MEDIUM for the dashboard card (fixture data stands in for real owners).
- Key concern: the status chip overlaps the owner title at 280 px.

## Look at these first (absolute paths)

All in `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\.ptah\specs\TASK_2026_596_0a19\screenshots\`:

1. `dashboard-card-owners-anubis-light-280.png` (the overlap, light)
2. `dashboard-card-owners-anubis-280.png` (the overlap, dark)
3. `stats-strip-expanded-anubis-280.png` (all tiles at the narrowest width, dark)
4. `stats-strip-expanded-anubis-light-440.png` (the whole grid, light, wide)
5. `stats-strip-tiles-open-anubis-light-280.png` (opened plan and lane tiles, light, narrow)
6. `stats-strip-tiles-open-anubis-440.png` (opened tiles, dark, wide)
7. `probe-focus-closed-anubis-light-280.png` (focus ring on the light theme)
8. `stats-strip-refresh-failed-collapsed-anubis-light-280.png` (neutral refresh-failed notice with the at-limit alert)
9. `dashboard-card-refresh-failed-anubis-440.png` (notice plus four owners, wide)

## Re-check (visual fix round)

Source of truth: current `screenshots/` (recaptured 2026-10-05 02:58 after the rebuild; see `phase-6-visual-fix-report.md`). No source edited, no temporary spec created.

**Verdict: APPROVED** (score 8/10, confidence MEDIUM-HIGH). Findings 1 and 5 are confirmed in the pixels. Finding 2 is confirmed in source and by computed contrast, not by a screenshot of the ring itself (see below).

| Finding | Fixed? | Evidence |
| --- | --- | --- |
| 1. Dashboard chip overlaps title at 280 | Yes | `screenshots/dashboard-card-owners-anubis-280.png` and `-anubis-light-280.png`: the `service-unavailable` chip and Refresh now sit on their own line under "Claude account"; the near-limit/limit chips beside their titles do not collide. `-anubis-light-360.png`: chip stays beside the wrapped title ("Claude / account") with no overlap; layout as before. 440 not regressed (card structure the same). |
| 2. Focus ring under 3:1 in anubis-light | Yes (by source and computation) | `stats-tile.styles.ts:22` now uses `focus-visible:outline-2 outline-offset-2 outline-base-content`. Light base-content (dark aubergine, about #291334) on the tile surface (243,238,235) is 14.7:1 per the fix report, which reproduced my earlier 2.59:1 for the old `info` value, so the method is the same. The harness probe crops (`probe-focus-*-anubis-light-*.png`) are clipped to the tile box, and the ring sits 2px outside it, so they show only the tile's own tone border. I could not confirm the ring in pixels. Residual risk is low, but a one-off screenshot with padding would close it. |
| 5. Restored lane face | Yes | `stats-strip-expanded-anubis-light-440.png`: the lane reads "PTAH CLI", "Restored · completed", "Last known · Weekly 60% used", "Provider API". No "Limit unknown" on it; the other restored lanes (Codex Review, Copilot, OpenCode), which have no known evidence, correctly keep "? Limit unknown". The same lane in `stats-strip-tiles-open-anubis-light-280.png` reads the same. The 60% matches the 60% weekly in the "Claude account / service-unavailable" card (`dashboard-card-owners-anubis-light-280.png`), so face and panel agree. I did not capture that lane's panel open, so I took the panel note from the specs the report lists. |

No new regression seen:
- Overflow: no horizontal overflow in the dashboard card at 280/360, nor in the expanded grid at 280/440 (both themes sampled).
- New text ("Last known · Weekly 60% used") wraps within its chip at 280 and 440; it uses existing neutral chip styling, so contrast matches the already-measured chips.
- Unknown values still print "unknown" (Monthly, Burst, unknown tokens, unknown cost); none renders as 0.
- Not reopened: the remaining 360 strip captures and the refresh-failed captures. The fix round did not touch them.

### Look at these first (absolute paths)

Base: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\.ptah\specs\TASK_2026_596_0a19\screenshots\`

1. `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\.ptah\specs\TASK_2026_596_0a19\screenshots\dashboard-card-owners-anubis-280.png` (finding 1, dark, 280)
2. `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\.ptah\specs\TASK_2026_596_0a19\screenshots\dashboard-card-owners-anubis-light-280.png` (finding 1, light, 280)
3. `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\.ptah\specs\TASK_2026_596_0a19\screenshots\stats-strip-expanded-anubis-light-440.png` (finding 5, light, 440)
4. `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\.ptah\specs\TASK_2026_596_0a19\screenshots\stats-strip-expanded-anubis-440.png` (finding 5, dark, 440)
5. `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\.ptah\specs\TASK_2026_596_0a19\screenshots\stats-strip-tiles-open-anubis-light-280.png` (opened tiles, light, 280)
6. `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\.ptah\specs\TASK_2026_596_0a19\screenshots\stats-strip-expanded-anubis-280.png` (whole grid, dark, 280)
7. `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\.ptah\specs\TASK_2026_596_0a19\screenshots\dashboard-card-owners-anubis-light-360.png` (finding 1, 360 unchanged)
8. `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\.ptah\specs\TASK_2026_596_0a19\screenshots\probe-focus-closed-anubis-light-440.png` (focus probe, light; ring is outside the crop)
