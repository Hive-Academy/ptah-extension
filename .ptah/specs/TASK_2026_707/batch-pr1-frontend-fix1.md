# TASK_2026_707 — PR 1 frontend, fix round 1

Fixes for code-logic-review-pr1.md defects 3 and 6, the partial Ollama read
presentation, and the coverage loss the review listed. Frontend batch only:
`libs/frontend/dashboard/src/lib/components/provider-account-card/**` and
`provider-account-tile/**`. No file under `libs/backend/**` or
`libs/shared/**` was touched.

## Files changed

- `D:/projects/ptah-extension/.claude-worktrees/plan-limit-tiles/libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.ts`
- `D:/projects/ptah-extension/.claude-worktrees/plan-limit-tiles/libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/plan-limit-tiles/libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.html`
- `D:/projects/ptah-extension/.claude-worktrees/plan-limit-tiles/libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.spec.ts`

## Defect 3 — typed statusReason now wins (Antigravity CLI failures)

- `plan-tile-view.model.ts:89-126` — new `PLAN_LIMIT_REASON_LABELS`
  (`Record<PlanLimitStatusReason, string>`) with the 12 exact labels from the
  lane brief, plus `planLimitReasonLabel()` which also maps
  `no-open-session` and falls back to `null` for an unknown runtime value.
- `plan-tile-view.model.ts:544-549` — `statusNoticeText` returns the typed
  reason label for a window-less owner before any per-provider sentence.
  The stale notice keeps its earlier branch.
- `plan-tile-view.model.ts:583` — `serviceUnavailableText`'s
  "Open Antigravity to read local quota" is now fallback only.
- `plan-tile-view.model.ts:637-646` — `statusPill` (no-windows chain) checks
  `statusReason` first, then the notice, then the per-status sentence. The
  `windowsExist` branch is unchanged.

## Defect 6 — PlanLocalUsage.models is now presented

- `plan-tile-view.model.ts:220` — `PlanTileSecondaryView` gained
  `accessibleText`.
- `plan-tile-view.model.ts:720-741` — `modelDetailLines()` ranks models by
  requests (name as tie-break), caps at 5 lines and appends "and N more".
- `plan-tile-view.model.ts:780-785` — `secondaryLine` puts "Top models:" and
  the per-model lines ("glm-5.3 · 185 requests") in the tooltip and the
  one-line summary in `accessibleText`. The visible line keeps the total.
- `provider-account-tile.component.html:114-120` — an `sr-only` span
  (`tile-secondary-detail`) next to the secondary line carries the same
  detail for screen readers, because tooltips are not reliably announced.

## Partial Ollama reads

A window-less owner with `statusReason` `balance-unavailable` or
`balance-auth-rejected` now gets the bar-slot pill "Plan limits unavailable
right now; showing request counts" / "API key cannot read plan limits;
showing request counts" from the same statusReason chain, while the request
counts stay on the secondary line. The generic "no limits" sentence can no
longer win for these owners.

## Exact-range tooltip restored

- `plan-tile-view.model.ts:765-770` — the secondary tooltip now shows
  `Range: <exact ISO range> (last N days)`: the compact label annotates the
  exact range instead of replacing it. Backwards or unparseable ranges fall
  back to `Range: <raw string>`.

## Coverage restored (old card spec cases the review listed)

- `plan-tile-view.model.spec.ts` — new describe
  `buildPlanTile window facts (restored coverage)`:
  - "reports a passed reset and the next reset as separate facts, usage
    unknown" (old spec lines 725-754)
  - "colours the primary bar by state: ok, near-limit and limit-reached"
  - "keeps a neutral bar for aged, estimate-only and not-confirmed windows"
    (old lines 1113-1177, 1262-1333)
  - "separates active, expired and estimated owner evidence" (old lines
    1357-1438)
- `plan-tile-view.model.spec.ts` — secondary line:
  - "shows tokens and cost for a local CLI, plus compacted lifetime tokens"
    now asserts the exact-range tooltip (old lines 427-487)
  - "falls back to the raw string for a backwards or unparseable range"
  - "lists per-model request counts in the tooltip, capped at five, with an
    accessible equivalent"
- `plan-tile-view.model.spec.ts` — new describe
  `buildPlanTile typed statusReason priority (review defect 3)` (old lines
  804-852, 910-948):
  - "lets the typed reason win over the generic Antigravity app message"
  - "keeps the generic app message only as the fallback without a typed
    reason"
  - "tells a rejected Antigravity sign-in apart from a closed app"
  - "distinguishes an Ollama Cloud key failure, a missing key and no usage
    source"
  - "says plan limits are unavailable for a partial Ollama read, keeping the
    request counts"
- `plan-tile-view.model.spec.ts` — `planLimitReasonLabel`: exact labels for
  `balance-unavailable` and `balance-auth-rejected`, and a typed unknown
  reason still returns null.
- `provider-account-tile.component.spec.ts`:
  - "renders a neutral fill and the 90% tick for aged, estimate-only and
    not-confirmed windows" (`bg-base-content/45`, `.bar-tick` at 90%)
  - "exposes the per-model request detail to screen readers beside the
    secondary line"

## Test results

```
npx jest -c libs/frontend/dashboard/jest.config.ts \
  <tile component spec> <plan-tile-view.model.spec> <card component spec> \
  --coverage=false --maxWorkers=1

Test Suites: 3 passed, 3 total
Tests:       60 passed, 60 total
Snapshots:   0 total
Time:        5.226 s
```

One earlier run failed 3 assertions; all three were stale spec expectations
(two trailing periods on the `api-key-no-subscription-quota` label, and the
old exact estimated-evidence sentence that now carries the observed time).
The specs were corrected; no production change was needed for them.

## Decisions

- **statusReason priority:** the typed reason wins in `statusNoticeText`
  after the stale branch and first in the `statusPill` chain. Stale keeps
  priority: it is a freshness fact about data, while `statusReason` is
  documented as a window-less cause. The `windowsExist` pill branch stays
  unchanged (a window-less reason never applies there). Reversible.
- **Partial reads may duplicate the sentence:** for `balance-*` owners the
  notice row and the pill can show the same text. Precision beats brevity;
  the review asked for the cause to be visible. Reversible.
- **Models detail:** sorted by requests with a name tie-break, capped at 5
  plus "and N more", tooltip for sighted users and an `sr-only` equivalent
  beside the line for screen readers. Alternatives were a DOM tooltip
  component or dropping the detail to PR 2; the review asked for a bounded
  path now. Reversible.
- **Range tooltip:** exact range first, compact label in parentheses, raw
  fallback for unparseable ranges. The previous compact-only form dropped
  the exact range the old card showed. Reversible.
- **Unknown reason handling:** the map is a compile-time exhaustive
  `Record`, and `planLimitReasonLabel` still returns null at runtime for a
  value a newer backend sends (`Object.hasOwn` guard). The spec covers this
  with one deliberate cast. Reversible.
- **Two label texts corrected in specs, not the map:** the pre-existing
  expectations for `api-key-no-subscription-quota` ended with a period the
  lane brief's exact label list does not carry; the map follows the brief
  and the specs were aligned to it.