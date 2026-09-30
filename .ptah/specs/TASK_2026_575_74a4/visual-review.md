# Visual Review - TASK_2026_575_74a4 (Batch 4 — analytics partial-pricing marker)

## Summary

| Metric            | Value                                |
| ------------------ | ------------------------------------- |
| Overall score      | 9/10                                  |
| Assessment         | APPROVED                              |
| Visual breaking    | 0                                     |
| Serious            | 0                                     |
| Moderate           | 1                                     |
| Viewports tested   | 1280, 480 (dark + light), plus 1 extra dark-only state at 1280 |
| Screenshots taken  | 5                                     |
| Components tested  | `ptah-session-analytics` section, `ptah-session-metrics-cards`, `ptah-session-stats-card` (x2/x3), range selector |

## Environment

- **Build verified**: real Angular webview bundle, built from THIS worktree at
  HEAD `5b22a67b1` (`fix/task-575-session-cost-accounting`, Batch 4 commit
  `5b9f468f3` confirmed an ancestor via `git merge-base --is-ancestor`) with
  `NX_DAEMON=false npx nx build ptah-extension-webview --skip-nx-cache` — exit
  0, `dist/apps/ptah-extension-webview/browser/` produced (only warning:
  initial bundle budget 3.45 MB > 2.50 MB, unrelated to this change).
- **Harness**: `libs/frontend/webview-e2e-harness`, `test.use({ useAppBuild: true })`,
  `installCspStub` + `installPostMessageBridge` + `installRpcAutoResponder`
  (from `marketplace.fixtures.ts`, same helpers the baseline used). Host
  config `{ ...vscodeHostConfig('analytics'), workspaceRoot: 'C:\\ptah-e2e-ws-a', workspaceName: 'ptah-e2e-ws-a' }`
  set in one `addInitScript`, matching `screenshots/before/README.md`'s
  documented wiring exactly (`vscodeHostConfig()` alone omits `workspaceRoot`,
  which would show "No workspace detected").
- Temporary spec:
  `libs/frontend/webview-e2e-harness/src/lib/scenarios/_tmp-after-575/after.e2e.spec.ts`
  — run via `npx playwright test src/lib/scenarios/_tmp-after-575/after.e2e.spec.ts --config=playwright.config.ts --workers=2 --reporter=list` (3 passed), then a second `-g "a11y spot-checks"` run (1 passed) for the computed-style checks below. **Deleted after the run** — `git status --short` in this worktree shows only this review's own deliverables plus unrelated concurrent-executor changes (apps/ptah-tui, agent-stats.service, session-cost-contract.spec.ts — none created by this review).
- Base URL: harness's local `fixtureServer.url` (Playwright-managed static
  server serving the built bundle), not a persistent dev server.
- Viewports covered: 1280×1400 → resized to 480×1400 (dark, light); one
  additional 1280×1400 dark-only capture for the "unpriced next to priced"
  state.

## Fixture

Reused `screenshots/before/README.md`'s exact 3-session fixture (`sess-full`,
`sess-partial`, `sess-1m`), unchanged for `sess-full` and `sess-partial`, with
**one** change for `sess-1m` per the task brief: the fixed backend now prices
`claude-opus-5-5[1m]` at base Opus 5.5 rates.

**Rate computation, stated explicitly**: `DEFAULT_MODEL_PRICING` in
`libs/shared/src/lib/utils/pricing.utils.ts:64-109` carries **no Claude
entry at all** — only `gpt-4o`/`gpt-4o-mini`/`gpt-4-turbo`/`gpt-4`/`gpt-3.5-turbo`/`local`/`:cloud`.
Real Anthropic rates (including "Opus 5.5") are registered at runtime via
`registerProviderPricing`, never bundled as a static default; grepping the
whole repo for a `claude-opus-5-5` pricing entry outside test files and doc
comments returns nothing. The task brief's instruction to read the rate off
`DEFAULT_MODEL_PRICING` therefore cannot be satisfied literally. The closest
traceable substitute, from the same named file, is `pricing.utils.spec.ts`'s
own `OPUS` fixture constant for `'claude-opus-5-5'`
(`pricing.utils.spec.ts:250-251`): `inputCostPerToken: 5e-6` ($5/M),
`outputCostPerToken: 25e-6` ($25/M). Applied to `sess-1m`'s 300000 input +
4000 output tokens:

```
300000 * 5e-6  = $1.50
  4000 * 25e-6 = $0.10
                 -------
                 $1.60
```

`sess-1m` fixture set to `totalCost: 1.60`, `knownCost: 1.60`,
`pricingCoverage: 'full'`, `modelUsageList[0].costUSD: 1.60`. `sess-full`
and `sess-partial` are byte-identical to the baseline fixture
(`sess-partial`: `totalCost: null`, `knownCost: 1.15`,
`pricingCoverage: 'partial'`).

Extra state (dark only, "2 days" range): `sess-priced` (full pricing,
`totalCost/knownCost: 2.00`) next to `sess-unpriced`
(`totalCost: null`, `knownCost: null`, `pricingCoverage: 'none'`) — designed
to exercise the total's "≥" marker with **zero** partially-priced
contributors, so the Avg/Session marker must NOT appear (per
`metrics-cards.component.ts`'s `avgIsLowerBound`, which gates only on
`partiallyPricedSessionCount`, not `unknownCostSessionCount`).

## Before/after comparison

| # | Field | Before (baseline) | After (this build) | Screenshot |
|---|---|---|---|---|
| 1 | EST. TOTAL COST | `$4.82` (sess-partial and sess-1m silently dropped) | `≥ $7.57` = 4.82 + 1.15 + 1.60, with "≥" marker | analytics-dark.png |
| 2 | AVG / SESSION | `$4.82` (averaged over 1 contributor) | `≥ $2.52` = 7.57 / 3, "≥" marker present (sess-partial contributes) | analytics-dark.png |
| 3 | TOTAL TOKENS | 592.0K | 592.0K (unchanged — token sums were never the bug) | analytics-dark.png |
| 4 | MESSAGES / SESSIONS / SUBAGENTS | 78 / 3 / 0 | 78 / 3 / 0 (unchanged) | analytics-dark.png |
| 5 | Notes line | "Cost unknown for 2 sessions..." **and** "Some usage in 1 session has no rate-card price..." | Only "Some usage in 1 session has no rate-card price; the priced part is included (marked ≥), so the total is a lower bound." — the unknown-cost note is gone (0 sessions now unknown) | analytics-dark.png |
| 6 | Auth refactor card | EST. COST $4.82, $/MSG $0.11 (unchanged, always correct) | Same | analytics-dark.png |
| 7 | Mixed-agent debugging card | EST. COST **"Unknown"**, $/MSG **"$--"** — the known $1.15 appeared only in the per-model row, never on the card or in the total (defect 3) | EST. COST **"≥ $1.15"**, $/MSG **"≥ $0.04"** — the card and the $/msg figure now carry the priced subtotal with its lower-bound marker | analytics-dark.png |
| 8 | Long context session ([1m]) card | Badge "Opus 5.5 (1m)", EST. COST **"Unknown"**, $/MSG **"$--"** — defect 4, the fixture reproduced the pre-fix backend's `costUSD: null` | EST. COST **"$1.60"** (no lower-bound marker — pricing is full), $/MSG **"$0.18"** | analytics-dark.png |
| 9 | Mixed-agent per-model row `opencode-go/glm-5.3` | `60.0K / 5.0K Unknown` | Unchanged — `60.0K / 5.0K Unknown`, correctly still unpriced (this provider genuinely has no rate card entry; only the Claude-family model-id normalization was the bug) | analytics-dark.png |
| 10 | Light theme (1280) | Same figures, light palette | Identical figures reproduced in `anubis-light`; badges, notes and per-model rows all legible against the cream background | analytics-light.png |
| 11 | Dark 480px | Cards stack to 1 column, no overflow | Cards stack to 1 column; all six metric tiles readable at 2-per-row; no truncation of "≥ $7.57", "≥ $2.52", "$1.60", or the notes line; no horizontal scroll | analytics-dark-480.png |
| 12 | Light 480px | Same | Same — confirmed no layout regression at 480 in light theme either | analytics-light-480.png |
| 13 | Extra state: unpriced-next-to-priced (2 days, dark, new capture, no baseline equivalent) | n/a | EST. TOTAL COST **"≥ $2.00"** (sess-priced's $2.00 only; sess-unpriced excluded), AVG/SESSION **"$2.00"** with **no** "≥" marker, notes line reads "Cost unknown for 1 session (no current rate-card price); the total leaves it out, so it is a lower bound.", Unpriced session card shows **"Unknown"** / **"$--"** in a muted grey, not green | analytics-dark-unpriced-vs-priced.png |

## Findings by severity

### Visual breaking

None found.

### Serious

None found.

### Moderate and minor

#### 1. Task brief's cited pricing source does not exist in the codebase

- Severity: Moderate (documentation/traceability gap, not a UI defect)
- File: `libs/shared/src/lib/utils/pricing.utils.ts:64-109` (`DEFAULT_MODEL_PRICING`)
- Problem: the task brief asks to price `sess-1m` "at base Opus 5.5 rates ...
  from `DEFAULT_MODEL_PRICING`", but that constant has no Claude entries at
  all (Opus 5.5's real rate is registered dynamically, never bundled). This
  review substituted `pricing.utils.spec.ts`'s own `OPUS` test constant
  ($5/M in, $25/M out) from the same file, computing $1.60, and states that
  assumption above rather than silently inventing a number.
- Impact: none on the shipped UI — this is a fixture-authoring note for
  whoever wired the real backend rate card, not a rendering defect. Flagging
  it so the number in this report is traceable rather than asserted.
- Fix: none required for this review; if a future capture needs an
  authoritative Opus 5.5 rate, source it from wherever the real rate card is
  registered at runtime (not `DEFAULT_MODEL_PRICING`).

No other moderate or minor visual findings. The `opencode-go/glm-5.3` row
staying "Unknown" (item 9 above) is correct behaviour, not a defect — that
provider has no rate-card entry at all; only the Claude-family `[1m]`/prefix
normalization was in scope for this fix.

## Prototype fidelity

- Approved prototype: None found under this task folder — this is a
  bugfix task with no new UI surface (context.md: "UI touched only for the
  analytics partial marker (no new surface)").
- Fidelity assessment: NOT APPLICABLE
- Before/after comparison (no prototype): see the table above. Every entry
  compares the same screenshot pairing method used for `screenshots/before/`
  (same harness, same fixture shape, same element-screenshot target). No
  structural, component, or spacing regression observed — the diff is
  confined to the numbers and markers the fix targets (total, average,
  per-card cost, per-card $/msg, and the notes line).

## Viewport results

| Screen | Elements checked | Status | Screenshot |
|---|---|---|---|
| Analytics, dark, 1280 | header, badge, range selector, 6 metric tiles, notes line, 3 session cards, per-model usage rows | PASS | analytics-dark.png |
| Analytics, light, 1280 | same | PASS | analytics-light.png |
| Analytics, dark, 480 | 1-column card stack, 2-column metric tile grid, no overflow/truncation | PASS | analytics-dark-480.png |
| Analytics, light, 480 | same | PASS | analytics-light-480.png |
| Analytics, dark, 1280, extra state (2-day range, 2 sessions) | total "≥" marker present, avg marker absent, "Unknown"/"$--" muted-colour card | PASS | analytics-dark-unpriced-vs-priced.png |

Audit-selection note: 1280 and 480 were the two widths this task specified
(matching the baseline capture exactly); this review did not open additional
intermediate widths since the fix touches numeric display logic, not layout
breakpoints, and the baseline's own viewport sweep already covers the
card-grid reflow (`sm:grid-cols-2 xl:grid-cols-3` on the card grid,
`grid-cols-2 sm:grid-cols-3 xl:grid-cols-6` on the metric tiles).

## Component and interaction results

| Component | States tested | Status | Screenshot / evidence |
|---|---|---|---|
| `ptah-session-metrics-cards` (EST. TOTAL COST tile) | default (has ≥ marker), native `title` tooltip content | PASS — tooltip text confirmed via `getAttribute('title')`: `"Estimated from recorded usage and current rate card. Lower bound: 1 session with no price (left out)."` | analytics-dark-unpriced-vs-priced.png + console evidence below |
| `ptah-session-metrics-cards` (Avg/Session tile) | with 1 partial contributor (marker shown), with 0 partial contributors / 1 unpriced-only contributor (marker absent) | PASS — `innerText()` of the avg tile in the extra state returned exactly `"$2.00"`, no `≥` glyph | analytics-dark.png (marker shown), analytics-dark-unpriced-vs-priced.png (marker absent) |
| `ptah-session-stats-card` (partially priced) | EST. COST shows `≥ $1.15` not `Unknown`, "Partial" badge | PASS | analytics-dark.png |
| `ptah-session-stats-card` (fully priced `[1m]`) | EST. COST shows `$1.60` not `Unknown`, "Opus 5.5 (1m)" badge, no lower-bound marker | PASS | analytics-dark.png |
| `ptah-session-stats-card` (fully unpriced) | EST. COST shows `Unknown`, `$/MSG` shows `$--`, colour is muted not green | PASS | analytics-dark-unpriced-vs-priced.png |
| Range selector (`join` button group) | keyboard Tab reachability | PASS — first Tab stop from page load landed on `<button class="join-item btn btn-xs" aria-pressed="false"> 3 days </button>` (a real, visible, focusable element) | console evidence below |

Console evidence from the a11y spot-check run (temporary spec, deleted):

```
UNKNOWN_COLOR oklch(0.630482 0.00745 23.428)
PRICED_COLOR  oklch(0.627052 0.169912 149.214)
TOTAL_TILE_TITLE Estimated from recorded usage and current rate card. Lower bound: 1 session with no price (left out).
AVG_TILE_TEXT "$2.00"
FIRST_FOCUSABLE <button type="button" class="join-item btn btn-xs" aria-pressed="false"> 3 days </button>
```

## Design system compliance

No design-token changes were in scope for this batch (context.md: "UI
touched only for the analytics partial marker"). Observed colour usage is
consistent with the rest of the card: green (`text-success`/`costValueClass`
truthy path) for a known cost, the shared `text-base-content-muted` class for
`Unknown`/`$--`/the notes line, `text-warning` for the "Partial" badge and
status lines — no ad hoc colours introduced. No violation found.

## Accessibility audit

Standard applied: WCAG 2.2 AA (repository declares no explicit standard in
the reviewed files; AA is this review's default per instructions).

- **Colour, not contrast ratio, verified precisely.** `getComputedStyle` in
  this Chromium build reports colours in `oklch()`, not `rgb()`, so an exact
  sRGB-relative-luminance contrast ratio was not computed. What was verified:
  the "Unknown" text's OKLCH chroma is `0.00745` (essentially achromatic
  grey) versus the priced green's chroma `0.169912` — confirming the
  "Unknown"/`$--` text is rendered in a distinct **neutral muted** colour,
  never the green success colour, satisfying the "no green for unknown"
  requirement stated in the task brief. Both colours' lightness (`L≈0.63`)
  sits in a range that read clearly legible against both the near-black dark
  background and the cream light background in every screenshot above;
  residual uncertainty: a precise 4.5:1 ratio was not numerically confirmed
  for either colour against its background.
- **Target size**: range-selector buttons (`btn-xs`, ~28-30px tall in the
  1280px captures) were not measured with `boundingBox()` in this pass;
  visually they render similarly to the baseline's own controls captured at
  the same widths, so no new target-size regression is introduced by this
  fix (the fix changes numeric/colour logic only, not button markup).
- **Focus order**: confirmed reachable — first Tab stop from page load is
  the "3 days" range button, a real visible element (see console evidence).
  A full Tab sweep of every interactive element on the card (range buttons,
  each session card's open affordance) was not performed in this pass; this
  review scoped the focus check to confirming keyboard reachability is not
  broken by the fix, since no new interactive elements were added.
- **Tooltip reachability**: the total-cost tile's explanatory text is a
  native `title` attribute (confirmed present and correctly worded above).
  A native `title` is not reachable by keyboard-only users without a mouse
  hover equivalent in most browsers — this is pre-existing to the baseline
  (same `[title]` binding pattern was already in `metrics-cards.component.ts`
  before this batch) and out of scope for Batch 4, which only changed what
  the number and the tooltip text say, not the tooltip mechanism.

## Visual performance

No animation, loading-state, or layout-shift concerns observed. Every
screenshot in this review was taken only after `[aria-label="Session
analytics"]` was visible, exactly 3 (or 2, for the extra state)
`ptah-session-stats-card` elements were present, and no
`[aria-busy="true"]`/`.loading-spinner` element remained — the same
wait-for-settled discipline the baseline README documents. No mid-transition
or skeleton-state captures.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: none blocking. The one moderate note (task brief cites a
  pricing constant, `DEFAULT_MODEL_PRICING`, that does not contain the model
  in question) is a documentation/traceability gap in the request, not a
  defect in the shipped UI — this review substituted and disclosed a
  traceable alternative rate from the same file rather than inventing a
  number silently. All four target behaviours from the task brief were
  directly observed and screenshotted: the total now includes the partial
  session's known $1.15 and the newly-priced sess-1m with a "≥" marker and
  tooltip; the Avg/Session marker appears only when a partial contributor
  exists (and is confirmed absent in the unpriced-only extra state); the
  partial card shows "≥ $1.15" instead of "Unknown"; unknown/unpriced values
  render in a neutral muted colour, never green, and never as "$0"; and no
  layout breakage, overflow, or truncation was found at 480px in either
  theme.
