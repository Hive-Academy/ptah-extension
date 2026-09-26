# Code Logic Review — Batch 19 (Lazy-load gate), Round 2 (FINAL), `TASK_2026_494_ca38`

Round-2 evidence re-check of the revised `lazy-load-gate.md` against round-1's findings
(`code-logic-review-batch-19.md`, 5/10 NEEDS_REVISION). All numbers below are re-derived
independently from `stats.json` in both worktrees using the reproduction script from the
round-1 review; the gate file was not edited and no build was re-run.

## Summary

| Metric | Value |
| --- | --- |
| Score | 7/10 |
| Verdict | **NEEDS_REVISION** |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Minor issues | 0 |

The Req 9.3 reconciliation — the substantive reason for round 1's NEEDS_REVISION — is now
correct and independently reproduced exactly: `753 + 4,081 + 65 + 131 − 814 = 4,216`, every
term re-derived from `stats.json` and matching the gate's own numbers to the byte. The
`_debug_node-chunk.mjs` relabelling, the B18 `+46 B` attribution, the noise-band correction,
and the `electron-layout.service.ts` line citations all independently verify as accurate.
One false claim survives, unrelated to the Req 9.3 arithmetic itself: the PASS/FAIL table's
R8 row still states "81 files each" for the zod count, three sections after the gate's own
"zod check" section corrected that exact figure to 95. Per this round's rule (NEEDS_REVISION
only for a false claim or arithmetic that does not reconcile), this single one-line
inconsistency is sufficient to withhold approval, even though it is trivial to fix and does
not touch Req 9.3 or the gate's overall PASS conclusions.

## Confirm table

| # | Item | Ruling | Evidence |
| --- | --- | --- | --- |
| 1 | Req 9.3 reconciliation: `753 + 4,081 + 65 + 131 − 814 = 4,216` | **CONFIRMED, exact** | Re-derived independently from both `stats.json` files (script below). Large-bucket sum (15 files, `\|Δ\|>10`) = 4,899 B, matching `753 (new files: 717+36) + 4,081 (8 named existing changes: 1787+760+508+501+233+198+48+46) + 65 (5 untraced-but-immaterial: 15+14+12+12+12)`. Noise bucket (125 files, `\|Δ\|≤10`) sums to +131 B. Grand total of all 140 changed inputs = 5,030 B. Gap = featGap `(-730058)` − baseGap `(-729244)` = **−814**, exact. `753+4081+65+131−814 = 4216`, matching the independently-computed Initial-total delta `3,399,489 − 3,395,273 = 4,216`. All five components reconcile to the byte. |
| 2 | +1,787 B labelled as shared `@angular/core` runtime chunk, no dev-mode wording left as a mislabel | **CONFIRMED** | `lazy-load-gate.md:209` ("**Relabelled.**... production rendering/DI/compiler internals... not a build-config or dev-mode defect"). The only remaining use of "dev-mode" is a negation ("not... a dev-mode defect"), not a residual mislabel. |
| 3 | +46 B attributed to B18 (`a3dbaceea`) | **CONFIRMED** | `lazy-load-gate.md:217` cites "Batch 18... commit `a3dbaceea`". `batches.md:1103` heading reads "## Batch 18: Harness prompt isolation — COMPLETE (commit a3dbaceea)", and `batches.md:1114-1116` describes exactly the `harness-workflow.service.ts` change (`readonly surfaceId = this._surfaceId.asReadonly()`, filter replacement) the gate cites. Commit and file match. |
| 4 | Noise range stated truthfully (−10..+10 B, 125 files, net +131 B); all 15 `\|Δ\|>10` files listed | **CONFIRMED** | Independent re-run of the reproduction script reproduces exactly 15 large-delta files (identical set and deltas to the gate's table at `lazy-load-gate.md:207-223`) and exactly 125 small-delta files summing to +131 B with range −10 to +10. No 16th large file and no file misclassified into the wrong bucket. |
| 5 | zod count corrected to 95 in each tree, method given, sets identical | **PARTIALLY CONFIRMED — stale duplicate elsewhere** | The "zod check" section (`lazy-load-gate.md:126-134`) is correct: independently recomputed 95 files in each tree via substring match on `node_modules/zod/` across the ten initial outputs per tree, sets set-equal (0 files unique to either tree). However, the PASS/FAIL table's R8 row (`lazy-load-gate.md:350`) still reads "**81 files each**" — an uncorrected duplicate of the exact number round 1 flagged as wrong. See Moderate finding below. |
| 6 | `electron-layout.service.ts` citations match the current file | **CONFIRMED, exact** | Verified directly against the file: signal declaration `:75` (`_appsSplitWidth = signal(...)`); readonly exposure + min/max `:89-91`; `setAppsSplitWidth()` `:215-222` with the clamped assignment at `:217-221`; `commitAppsSplitWidth()` `:224-226`; `persistLayout()`'s `appsSplitWidth` field `:623` and `setState` call `:625`; `restoreLayout()`'s typed read shape `:645` and guarded restore call `:667-668`. All eight citations match the file at the cited lines exactly. |
| 7 | Req 9.3 PASS/FAIL row consistent with revised section; other sections unchanged except where a number depended on them | **Req 9.3 row: CONFIRMED. R8 row: NOT consistent** | `lazy-load-gate.md:349` (Req 9.3 row) restates the exact reconciliation (753/4,081/65/131/814/4,216) and matches the revised section verbatim in substance. `lazy-load-gate.md:350` (R8 row) was not updated when the zod section above it was corrected from 81 to 95 — an internal contradiction within the same document (95 stated at line 127, 81 restated at line 350 for the same fact). All other sections (Check 1/2/6/7 material, B20's 501 B row, builds tables, test/tsc verification tails) are unchanged from round 1 and were not re-litigated here since round 1 already confirmed them and this round's brief scoped the check to the Req 9.3 revision and its dependents. |

## Reproduction (independent, this round)

```
node -e "... (script identical to round 1's, run against both worktrees' stats.json)"
```

Output (large-delta bucket, 15 files):
```
1787 .../_debug_node-chunk.mjs
760  apps/.../styles.css
717  .../surface-update-inbox.service.ts
508  .../electron-shell.component.ts
501  .../electron-layout.service.ts
233  .../lucide-angular.mjs
198  .../app.routes.ts
48   .../app.config.ts
46   .../harness-workflow.service.ts
36   .../electron-only-surface.guard.ts
15   .../tab-manager.service.ts
14   .../compact-session-activity.component.ts
12   .../session-stats-summary.component.ts
12   .../mcp-directory-browser.component.ts
12   .../plugin-catalog-panel.component.ts
---
total changed files: 140 | large(|d|>10): 15 sum 4899
small(|d|<=10): 125 sum 131 range -10 to 10
grand total: 5030
featGap -730058 baseGap -729244 deltaGap -814
feat total 3399489 base total 3395273
```

Zod: `feat zod count 95, base zod count 95, onlyFeat 0, onlyBase 0`.

All figures match the gate's revised document exactly, except the stale R8 zod count.

## Moderate issue

### R8 row of the PASS/FAIL table restates the pre-fix zod count (81, not 95)

- File: `lazy-load-gate.md:350`
- Scenario: a reader scans only the PASS/FAIL summary table (the document's most-consulted
  section) and takes "81 files each" as the zod count, while the "zod check" section three
  screens earlier (`lazy-load-gate.md:126-134`) already states, and this review independently
  confirms, the true count is 95 in each tree.
- Impact: an internal contradiction within the same, supposedly-finalized document — the
  exact defect round 1 flagged (`code-logic-review-batch-19.md`, "zod file count cited as 81,
  actual is 95") was fixed at its original location but not at this second citation of the
  same fact. It does not change the R8 verdict (PASS is still correct — the sets are
  identical either way) and does not touch the Req 9.3 arithmetic, which is the primary
  subject of this round's re-check and reconciles exactly.
- Fix: change `lazy-load-gate.md:350` from "81 files each" to "95 files each" (a one-line
  edit; no rebuild, no re-derivation needed — the correct number is already computed and
  stated at line 127).

## One-line summary

Req 9.3's reconciliation is now exact and independently reproduced to the byte across all
five components (753 + 4,081 + 65 + 131 − 814 = 4,216), the `_debug_node-chunk.mjs` label,
the B18 `+46 B` attribution, the noise band, and the `electron-layout.service.ts` citations
all verify correctly — but the PASS/FAIL table's R8 row still restates the pre-fix "81"
zod count, a factual inconsistency with the document's own corrected section, so this final
round returns NEEDS_REVISION for that single stale line rather than APPROVED.
