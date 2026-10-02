VERDICT: APPROVED
Score: 9/10

## Scope examined

- `git diff` of `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` — only the two `@defer (on immediate)` wrappers removed (filter bar ~line 100, organization chips ~line 334). No other template changes in the diff.
- `app-shell.component.html` full read of changed regions: both components still inside `@if (organizationAvailable())` blocks (lines 97, 324); remaining `@defer` blocks at lines 3, 10, 20 (confirm dialog, transcript overlay, organization editor) untouched.
- `app-shell.component.ts:39,41,130-131` — `SessionFilterBarComponent` and `SessionOrganizationChipsComponent` still imported and in `imports`.
- `app-shell.organization.spec.ts` — still exercises both paths (vscode/unavailable at lines 276-277, available at lines 334/428).
- No other `@defer (on immediate)` occurrences remain under `libs/frontend/chat/src`.

## Findings

1. **Stale spec comments (Minor)** — `app-shell.organization.spec.ts:235` states "The filter bar, chips and editor sit in `@defer` blocks" and `:346` says "After the deferred blocks settled". After this revert only the editor remains deferred. The assertions themselves remain valid (synchronous render still satisfies `not.toBe(null)`), so no test behaviour changes, but the comments now misdescribe the template. Cosmetic only.

2. **CLS/trigger analysis (informational, supports the change)** — `@defer (on immediate)` defers rendering out of the initial synchronous pass, so with `organizationAvailable()` true the rows render before the filter bar/chips, producing the 1–3 frame gap and CLS up to 0.106 recorded in `visual-review-C1.2-r2.md`. Rendering synchronously inside the same `@if` removes the gap. No lazy-loading benefit is lost: both components were already statically imported in the component's `imports` (app-shell.component.ts:130-131), so `@defer` provided no bundle-splitting effect anyway — only the frame gap.

## Logic checks

- **Silent failure**: none introduced. Revert strictly widens what renders in the first change-detection pass; a failure of these child components now surfaces in the same pass as the rows rather than one frame later. No success-looking error path added.
- **Unexpected user action**: none identified. The VS Code branch (`organizationAvailable()` false, local search at line ~103, local chips absent at 276-277) is byte-identical in behaviour; the `@else` branches are untouched.
- **Wrong answer from input data**: none. The components' inputs (`listQuery()`, `session`) are unchanged; the binding shape is unchanged.
- **Dependency failure**: unchanged. `SessionFilterBarComponent`/`SessionOrganizationChipsComponent` contracts are unchanged; spec imports both (lines 50, 52) and still passes structurally.
- **Missing from requirements**: the noted bundle caveat holds — removing `@defer` adds no new lazy chunk risk because the components were already eagerly imported; webview build reportedly passes at 3,457 kB vs the 3,500 kB budget.

## Data flow

Entry: `organizationAvailable()` signal → `@if` → (now) synchronous `<ptah-session-filter-bar>` / `<ptah-session-organization-chips>` render in the same CD pass as the session rows. OK. Editor/confirm/transcript overlays still deferred at lines 3/10/20 — intentional, unchanged. OK.

## Residual uncertainty

- The spec's regex at line 65 still expects the _editor_ inside `@defer` — still true (line 20 defer untouched), verified by inspection.
- Full jest run not executed here; the assertions that exist are timing-tolerant (they check presence after settling / absence for the vscode path), so the revert does not invert any assertion. A focused `jest -p` run of `app-shell.organization.spec.ts` would confirm but is not evidence of a defect.
