# Dashboard v2 visual fix

## Findings

1. **Plan-limit grid:** The container breakpoint for four columns is now 1400px; the existing three-column base remains for 1000–1399px, two columns for 640–999px, and one below 640px. Compact tile sizing is unchanged. `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:57-77`. Spec: `provider-account-card.component.spec.ts` (existing tile and grid coverage). Dashboard Jest: 52/52 passed across two suites.
2. **Partial badge keyboard tooltip:** Focus adds DaisyUI `tooltip-open`, blur removes it, and `aria-describedby` points to the same source text in a screen-reader-only element. `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-dashboard.component.html:42-56`, `usage-dashboard.component.ts:99`. Spec: `usage-dashboard.component.spec.ts:245-255` covers focus, blur and description. Dashboard Jest: passed.
3. **Harness popover overflow:** The footer and action group now wrap within the existing `w-80` popover. `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts:188-210`. Spec: `harness-health-badge.component.spec.ts` (existing action rendering and behavior). Marketplace Jest: 25/25 passed.
4. **Grok owner name:** Added `grok: 'Grok'` to the canonical backend provider display-name map, yielding `Grok CLI login · <id>` for CLI-store owners. `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:98`. Spec: `provider-owner.resolver.spec.ts:520` asserts the label. Auth-providers Jest: 68/68 passed.
5. **Daily chart labels and height:** Moved y ticks and date labels from the scaling SVG to an aligned HTML layer with fixed 11px text. The plot fills the width and its height clamps to 220–260px; hover and focus columns remain in the SVG. `libs/frontend/dashboard/src/lib/components/usage-dashboard/stacked-bar-chart.component.html:33-40,127-135`. Spec: `usage-dashboard.component.spec.ts:388-400,547-562,619-640` covers the label layer, cap class and existing values. Dashboard Jest: passed.

## Verification

- `npx jest -c libs/frontend/dashboard/jest.config.ts libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-dashboard.component.spec.ts libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.spec.ts --coverage=false --maxWorkers=2 --silent` — final run: 2 suites, 52 tests passed. An earlier run failed three assertions still expecting SVG text or 30 days; those assertions were updated, then the suite passed.
- `npx jest -c libs/frontend/marketplace/jest.config.ts libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.spec.ts --coverage=false --maxWorkers=2 --silent` — 1 suite, 25 tests passed.
- `npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.spec.ts --coverage=false --maxWorkers=2 --silent` — 1 suite, 68 tests passed (Node emitted a non-failing ES module config warning).
- `ptah_get_diagnostics` was called after edits, scoped to changed TypeScript files. Twice it reported TypeScript checking unavailable after a 45-second timeout; HTML is unrecognized by this diagnostic tool. Jest's Angular template compilation and TypeScript transform passed for the changed components and specs.

## Decisions

- Kept the existing container-query approach for the grid. Evidence: the component already establishes `container-type: inline-size`; changing thresholds meets the specified widths. Reversible.
- Changed the canonical backend provider map for Grok rather than overriding the tile label. Evidence: `ownerForCliStore('grok')` builds the owner through `quotaOwnerRefFromKey`, which uses that map; the frontend renders `ownerDisplayLabel`. Reversible.
- Used an HTML axis-label layer instead of a per-chart ResizeObserver. Evidence: the SVG viewBox was scaling its text, while overlay positions can use the same viewBox ratios and retain fixed CSS font size. This adds no observer lifetime. Reversible.

## Not done

- No fresh Electron screenshot or live visual measurement was captured; this batch's visual behavior is verified by source inspection and focused tests only.
- Ptah TypeScript diagnostics remained unavailable after two scoped attempts. No build, serve, e2e or workspace-wide run was made.
