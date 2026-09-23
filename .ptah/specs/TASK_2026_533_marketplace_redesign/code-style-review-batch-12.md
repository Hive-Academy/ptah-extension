# Code Style Review — `TASK_2026_533` Batch 12 (Shell, Nav, Status Bar — plan C6)

## Summary

| Metric          | Value                                             |
| --------------- | ------------------------------------------------- |
| Overall score   | 8/10                                              |
| Assessment      | APPROVED                                          |
| Blocking issues | 0                                                 |
| Serious issues  | 1                                                 |
| Minor issues    | 3                                                 |
| Files reviewed  | 6 (3 components + 3 specs; `.html` for the shell) |

## Five style questions

### 1. What breaks in six months?

The next store-derived cross-cutting read (say, a future page badge, or a breadcrumb sub-count) will look for a home and find `injectMarketplaceNavCounts()` sitting inside `marketplace-nav.component.ts:201-227` — a file whose declared subject is the nav UI, not derived state. A second consumer already exists (`marketplace-status-bar.component.ts:1-5` imports it), so the precedent is set: cross-cutting derivations attach themselves to whichever UI component happened to need them first, rather than living in a `data/`-shaped file the way every other C5 mapper does (`provider-row.ts`, `attention.ts`, `coverage.ts` are all still pending, but the pattern is already fixed by the plan at implementation-plan.md:332-351, "one subject per file"). Six months from now `marketplace-nav.component.ts` is either the de facto shared state module for the whole shell or someone duplicates the merge logic elsewhere.

### 2. What would a new team member misread?

`marketplace-status-bar.component.ts:1-5` imports `injectMarketplaceNavCounts` and `MarketplaceNavCounts` from `./marketplace-nav.component`. A reader who has not opened that file would reasonably guess the status bar depends on the nav component itself (a UI dependency), when the actual dependency is a store-reading function that happens to be co-located there. The breadcrumb's "Marketplace" root crumb (`marketplace-shell.component.ts:158-162`) always points to `{page:'overview'}` rather than to `route()`; a reader tracing `pageLabel()`/`route()` might expect the crumb's `href` to track the same signal and be surprised it is a fixed link built once in the constructor scope — worth the one-line comment it currently lacks.

### 3. What does this cost to maintain?

Low. The three components are small (244/397/111 lines against a 700-line soft cap), fully typed, OnPush/standalone/signal-based throughout, and every behavioural claim in the plan (zero-RPC on mount, header-per-host, breadcrumb-not-h1, `/`-shortcut scoping, tier flips with no manual `detectChanges()`) is pinned by a spec that exercises the real router and a real `ResizeObserver` stub rather than asserting on internal state. The maintenance cost this batch actually adds is the file-placement question in Q1: a mapper reachable only via a UI component's file, discoverable only by knowing to look inside it.

### 4. Where is this inconsistent with the rest of the repository?

- `injectMarketplaceNavCounts()` (marketplace-nav.component.ts:201) breaks the "one subject per file" discipline the plan itself states for this library's pure/near-pure layer (implementation-plan.md:332-351, C5) and that `CONVENTIONS.md:19` echoes for `src/lib/*` folders generally (`services/`, `utils/` — "one subject per file"). No other `inject*()`-shaped functional helper exists anywhere else in `libs/frontend` (repo-wide grep found exactly one other, in an unrelated `api/marketing` lib) — this is a new pattern for the repo, not a reuse of an established one.
- Everything else in this batch is consistent: `MarketplaceLayout` is wired exactly as Batch 3 specified (`useFactory: () => new MarketplaceLayout(inject(DestroyRef))` then `layout.observe(hostElement)`, marketplace-shell.component.ts:130-133, 188-190); `MarketplaceInventoryStore`/`ConnectorLinksStore` are `@Injectable()` with no `providedIn`, provided only here, matching Batch 5/6's stated contract; barrel imports are all through `@ptah-extension/core` / `@ptah-extension/shared`, no deep paths crossing project boundaries; no hex colours, no `innerHTML`, no `NgZone`.

### 5. What would I have done differently?

Move `MarketplaceNavCountKey`, `MarketplaceNavCounts`, and `injectMarketplaceNavCounts` out of `marketplace-nav.component.ts` into a new `shell/marketplace-nav-counts.ts` (or `data/marketplace-nav-counts.ts`, mirroring the C5 folder), and have both `marketplace-nav.component.ts` and `marketplace-status-bar.component.ts` import it from there. That is a mechanical, low-risk move — the function has no dependency on anything else in the nav file — and it removes the sibling-imports-sibling coupling entirely.

## Blocking issues

None.

## Serious issues

### `injectMarketplaceNavCounts` lives in the wrong file

- File: `libs/frontend/marketplace/src/lib/shell/marketplace-nav.component.ts:178-227`
- Problem: this file's stated subject is `MarketplaceNavComponent`, a presentational nav. It also carries a store-reading derivation (`MarketplaceNavCounts`, `injectMarketplaceNavCounts`) consumed by a _different_ component, `MarketplaceStatusBarComponent` (`marketplace-status-bar.component.ts:1-5`). The plan's own convention for this exact kind of unit — a pure/near-pure function turning store output into a view model — is "one subject per file" (implementation-plan.md:332-335, C5), and `CONVENTIONS.md:19` states the same rule for `src/lib/*` generally. This is the only `inject*()`-shaped free function found anywhere in `libs/frontend`; there is no existing sibling pattern that justifies parking it inside a component file.
- Impact: a second consumer already had to reach across `./marketplace-nav.component` to use unrelated state; a third consumer (a future page reading `servers`/`skills` counts, say) would either repeat the reach-through or duplicate the merge. It also means deleting or renaming `MarketplaceNavComponent` later carries collateral: the status bar's import breaks even though its dependency is conceptually unrelated to the nav UI.
- Fix: extract `MarketplaceNavCountKey`, `MarketplaceNavCounts`, and `injectMarketplaceNavCounts` into their own file (e.g. `shell/marketplace-nav-counts.ts`), imported by both `marketplace-nav.component.ts` and `marketplace-status-bar.component.ts`. No behavioural change; both spec files' assertions (`marketplace-nav.component.spec.ts:334-347`, `marketplace-status-bar.component.spec.ts:114-121`) continue to hold unchanged since they test through the components, not the helper's location.

## Minor issues

- `marketplace-nav.component.ts:36-37`: `MARKETPLACE_SURFACE` (a `ViewType` constant) is also exported from the nav file and re-imported by the shell (`marketplace-shell.component.ts:32`) purely as a route-building constant unrelated to the nav UI — the same "wrong home" pattern as the Serious finding above, on a smaller scale. Rolling it into the same extracted file (or a `route`-adjacent file) alongside the counts helper would resolve both at once.
- `marketplace-status-bar.component.ts:33-56`/`marketplace-shell.component.spec.ts` (deviation, accepted): the status bar renders "6 Ptah plugins" rather than the v3 prototype's "6/9 plugins" fraction (`screenshots/v3-overview-1440.png` footer: "12 servers · 1 connector · 6/9 plugins"). This is a reasonable, plan-consistent simplification — the denominator (catalogue total) is not data this shell-scoped, zero-RPC status bar has ("Nav badges never trigger a load", batches.md:127), and the fraction belongs to the Overview KPI card (C7, still pending). It is pinned by a spec (`marketplace-status-bar.component.spec.ts:109-111`) but has no code comment explaining the departure from the prototype's counter format; a one-line comment at `marketplace-status-bar.component.ts:28-32` would save the next reader a screenshot comparison.
- `marketplace-shell.component.ts:158-162`: the breadcrumb's "Marketplace" root crumb is a fixed link to `{page:'overview'}`, built once as a class field, rather than derived from `route()`. This is defensible (a section-root crumb conventionally goes to the section's home, not back to itself), and it is the second stated deviation the task named ("breadcrumb root links to /marketplace/overview") — but, as with the plugins-count deviation, nothing in the file says this was a deliberate choice rather than an oversight; a short comment would remove the ambiguity noted in Q2.

## File-by-file

### marketplace-shell.component.ts / .html

Score 9/10 — 0 blocking, 0 serious, 1 minor (breadcrumb-root comment, listed above). Matches the C6 contract point for point: stores and `MarketplaceLayout` provided exactly as Batch 3 specified, header-in-both-hosts with the back button gated on `!vscode.isElectron`, no shell `<h1>`, `<main>` as the `ptah-mp-content` container and scroll owner, route memory recorded on `NavigationEnd`, and a host-scoped (not `document`-scoped) `/`-shortcut handler that correctly excludes input/textarea/select/contenteditable. `isEditableTarget` and `marketplaceRouteOfUrl` are private, single-consumer helpers appropriately kept local.

### marketplace-nav.component.ts

Score 6/10 — 0 blocking, 1 serious (wrong-file placement of `injectMarketplaceNavCounts`), 1 minor (`MARKETPLACE_SURFACE` co-located for the same reason). The nav UI itself is correct and well-tested: 56px rail with `aria-label`/`title` per item, 240px sidebar with group headings, `routerLinkActive` + `ariaCurrentWhenActive="page"`, and a deliberate `SUBSET_MATCH`/`EXACT_MATCH` split (`:230-243`, `:384-391`) so a source page and its parent installed-list item are never both marked current — a subtlety the spec (`marketplace-nav.component.spec.ts:369-389`) directly exercises.

### marketplace-status-bar.component.ts

Score 7/10 — 0 blocking, 0 serious (its own code is fine; the serious finding is charged to the file it imports from), 1 minor (missing rationale comment for the counter-format deviation). Correctly reads only `ready` slices, never calls a loader (asserted at `marketplace-status-bar.component.spec.ts:114-121`), and the `plural()`/`marketplaceStatusSummary()` pair is a clean, independently testable pure function.

### marketplace-shell.component.spec.ts

Score 9/10 — thorough and disciplined: drives a stub `ResizeObserver` and asserts tier flips through `autoDetectChanges()`/`whenStable()` alone, with no `detectChanges()` call after a resize, which is the literal proof the Batch 12 acceptance criterion (batches.md:691) demands for the "no `NgZone.run`" claim. Mounts the real `MarketplaceInventoryStore`/`ConnectorLinksStore` (not stubs) behind spied RPC/catalogue boundaries, so the zero-RPC assertion is meaningful rather than tautological. The 400px compact-render check is a structural proxy (no fixed-width class beyond the rail, no `overflow-x-auto`) appropriate for jsdom's lack of layout, and is clearly commented as such.

### marketplace-nav.component.spec.ts / marketplace-status-bar.component.spec.ts

Score 8/10 each — table-driven, cover the zero-`ensure()`/zero-`reload()` rule explicitly, and the nav spec's `marketplacePageLabel` table doubles as a spec for the breadcrumb label mapping. Both inherit the Serious finding's blast radius (they'd need a one-line import change if the helper moves) but that is a fix-time concern, not a defect in the specs themselves.

## Pattern compliance

| Repository rule or nearby convention                                                                                                       | Status         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OnPush + standalone + signals + `inject()`                                                                                                 | PASS           | All three components: `marketplace-shell.component.ts:126,148-152`; `marketplace-nav.component.ts:275`; `marketplace-status-bar.component.ts:70`                                                                                                                                                                                                                                                        |
| `MarketplaceLayout` provided via factory, not `@Injectable`, per Batch 3 deviation                                                         | PASS           | `marketplace-shell.component.ts:130-133, 188-190`                                                                                                                                                                                                                                                                                                                                                       |
| Stores `@Injectable()` with no `providedIn`, provided only by the shell                                                                    | PASS           | `marketplace-inventory.store.ts:262`, `connector-links.store.ts:173`, `marketplace-shell.component.ts:128-129`                                                                                                                                                                                                                                                                                          |
| Barrel-only imports across project boundaries, no deep paths                                                                               | PASS           | Only `@ptah-extension/core`, `@ptah-extension/shared`, `lucide-angular`, and relative in-lib paths appear in the shell files                                                                                                                                                                                                                                                                            |
| Theme tokens only, no hex                                                                                                                  | PASS           | `grep` for `#[0-9a-f]{3,6}` across the 4 non-spec files returns nothing                                                                                                                                                                                                                                                                                                                                 |
| No `[innerHTML]`, no `NgZone.run`                                                                                                          | PASS           | `grep` confirms; the one `NgZone` hit is a doc comment describing the absence                                                                                                                                                                                                                                                                                                                           |
| `eslint.spec-change-detection.mjs` / OnPush-in-specs discipline                                                                            | NOT_APPLICABLE | `libs/frontend/marketplace/eslint.config.mjs:27` disables the rule project-wide (a pre-existing, documented exception shape per the shared file's own header comment) — this batch does not introduce or need the exemption file, and its spec test hosts declare `ChangeDetectionStrategy.OnPush` explicitly anyway (`marketplace-shell.component.spec.ts:36`, `marketplace-nav.component.spec.ts:38`) |
| One `h1` per page, none in the shell                                                                                                       | PASS           | `marketplace-shell.component.html:1-68` has no `<h1>`; asserted at `marketplace-shell.component.spec.ts:389-393,418`                                                                                                                                                                                                                                                                                    |
| a11y: `aria-label`/`title` on rail items, `aria-current`/`ariaCurrentWhenActive`, `focus-visible` rings, `aria-hidden` on decorative icons | PASS           | `marketplace-nav.component.ts:326-330`, `marketplace-shell.component.html:16,25,31,53`                                                                                                                                                                                                                                                                                                                  |
| Transitions ≤200ms, disabled under `prefers-reduced-motion`                                                                                | PASS           | `marketplace-nav.component.ts:279-288`; breadcrumb link `marketplace-shell.component.html:45`                                                                                                                                                                                                                                                                                                           |
| 700-line soft cap                                                                                                                          | PASS           | 244 / 397 / 111 lines respectively, well under cap                                                                                                                                                                                                                                                                                                                                                      |
| Pure/near-pure derivations get one file each (C5 convention)                                                                               | FAIL           | `injectMarketplaceNavCounts` + `MarketplaceNavCounts` embedded in `marketplace-nav.component.ts:178-227`, consumed by a sibling file — see Serious finding                                                                                                                                                                                                                                              |
| ESLint clean                                                                                                                               | PASS           | `npx eslint` on all 6 batch files (3 components + 3 specs) returns no output                                                                                                                                                                                                                                                                                                                            |

## Maintenance debt

- Introduced: one small, correctly-scoped nav/status-bar UI pair with full spec coverage of the batch's hardest acceptance criterion (zone-free tier flips); one file-placement debt (the nav-counts helper) that is cheap to pay down now and gets more expensive the more consumers it picks up.
- Retired: nothing yet — the old `marketplace-hub.component.ts` header/nav is untouched pending Batch 17's switch-over, as scheduled.
- Net: small positive. The debt is contained to one clearly-identified extraction, not spread across the batch.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: `injectMarketplaceNavCounts` (and `MARKETPLACE_SURFACE`) should move out of `marketplace-nav.component.ts` into their own file before a third consumer arrives — non-blocking, but worth doing in this batch or the very next one that touches this folder.
- What a 10/10 version would do differently: extract the nav-counts helper and `MARKETPLACE_SURFACE` into a dedicated file up front; add one-line comments at the two accepted-but-unexplained deviation points (plugin count format, breadcrumb-root target) so a future reader does not have to reconstruct the reasoning from a screenshot and a batches.md line.
