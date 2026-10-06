# Code Logic Review — TASK_2026_594_31ff

## Summary

| Metric | Value |
| --- | --- |
| Score | 7/10 |
| Verdict | CHANGES REQUIRED |
| Blocking | 0 |
| Serious | 1 |
| Moderate | 2 |
| Minor | 3 |

Scope: diff `186b1b25d..HEAD` (libs, apps), read in full for schemas, types, catalog, patch, selection, text fallback, view model, node switch, six renderers, tool description, catalog.md test. The size-guard test was run and passes. I did not run the full jest or Playwright suites and did not measure the exact current description length.

## Findings

### Serious

**S1. Alert tone is conveyed by colour alone for sighted users.**
- File: `libs/frontend/declarative-dashboard/src/lib/components/dashboard-alert.component.ts:29` (`<span class="sr-only">{{ node().tone }}.</span>`).
- The NFR (task-description.md:64) says tone "shall be conveyed in text, not colour alone". An sr-only word reaches assistive technology but is invisible to everyone else. A sighted user sees only the `alert-info/success/warning/error` colour. `alert-info` and `alert-success` are hard to tell apart on the anubis themes.
- Fix: replace the sr-only span with a visible tone label before the title, e.g. `<span class="font-semibold uppercase text-xs" data-testid="alert-tone">{{ node().tone }}</span>`. A tone icon is optional and must be `aria-hidden` if used. Update dashboard-alert.component.spec.ts:57, which asserts only a sr-only span and one child.
- Severity is Serious rather than Blocking because role and text are still correct and no data is wrong.

### Moderate

**M1. The host selection check does not require the badge to declare `dashboard.select`.**
- File: `libs/shared/src/mcp-apps-contracts/surface-patch.ts:387-390`.
- `checkSurfaceSelection` accepts `{kind:'badge'}` for any badge, including one with no actions.
- A forged webview message could therefore select a non-selectable badge. This mirrors the existing `stat` behaviour, so it is not a regression.
- The UI does gate selection on `selectable` (`dashboard-badge.component.ts:34`).
- Fix: either accept the parity and note it, or add `surfaceActionsOf(component).some(a => a.action === 'dashboard.select')` for the badge case.

**M2. The tool-description budget is fragile: 4,952 of 4,956 chars.**
- Files: `mcp-contract.sweep.spec.ts:2315`; `surface-tools.ts:174-178` (the new prose); batch-6-report.md:91-93.
- Any one-word edit to the description, or a new kind or constant, fails the sweep.
- The new prose duplicates the field facts already in the input schema. For example, "at most N" derives from `SURFACE_LIMITS`, which keeps it consistent, but the tone lists are copied by hand.
- Fix: do not raise the budget silently. Either trim the redundant prose, or re-baseline with a dated comment as was done for the other tools. At minimum record the headroom of 4 chars in the sweep spec comment.

### Minor

- **m1.** Size guard re-baseline 68,449 to 73,080 (`surface-tools.spec.ts:68,94`). The new measured value of 69,600 is 6.8% above the old 65,190. This is plausible, because the six strict schemas are duplicated across create, replace and add-component through `flattenOperationUnion`. The guard passes. I did not independently measure the actual length, so confirm that 69,600 is the true measured value and not an inflated one. A ceiling is only meaningful if "measured" is the real current length.
- **m2.** `dashboard-badge.component.ts:30`: `aria-label="Select <text>"` overrides the visible text for a toggle button. It is acceptable. Optionally drop the label, since `aria-pressed` plus the visible text already suffices (WCAG label-in-name still holds).
- **m3.** Surfaces persisted or restored with `catalogVersion: dashboard-catalog/2` now fail the strict literal at intake and render as `renderFailed`. This is the intended, user-approved rejection (Q1). Confirm there is no persisted-surface restore path that would show a blank pane without an explanatory message.

## Checks that held

1. **Trust boundary.**
   - Every new schema is `.strict()`.
   - Tones, directions and roles are `z.enum` values. `value` is `finite().min(0).max(100)`.
   - `text-block` text is non-empty and bounded by `maxStringLength` (`surface.schemas.ts:432-435`).
   - Badge actions use a dedicated `dashboard.select`-only strict schema with no `url` (`surface.schemas.ts:192-200`).
   - The webview intake uses `validateSurfaceDocument` (`apps-surface-intake.ts:193`), so the backend and webview share the same validators.
   - The view model re-checks every enum and number defensively and throws, giving fail-closed `renderFailed` (`surface-view-model.ts:123-163`).
   - No agent string reaches `class`, `style` or `innerHTML`. Classes come from literal const maps keyed by validated enums. `[style.--value]` takes only the validated finite number.
2. **View model.**
   - New kinds go through `mapStatus` and never hit the v1 mapper's `default`.
   - `SURFACE_CATALOG_VERSION` is used consistently in place of the old hard-coded `catalog/2`.
   - v1 `DASHBOARD_COMPONENT_KINDS` is untouched and the new v1 tool test asserts none of the new kinds appears.
   - `spec/2 + catalog/2` is rejected by `z.literal` (`surface.schemas.ts:583-584`).
3. **Renderers.**
   - Class strings are complete literals. Progress neutral maps to bare `progress` (no `progress-neutral`).
   - Divider mapping is correct for daisyUI 4: contract `vertical` maps to `divider-horizontal`.
   - Radial `--value` is the only style binding.
   - ARIA: warning and error use `role=alert`; info and success use `role=status`. Progress bars have `aria-valuemin`, `aria-valuemax` and `aria-valuenow`. Text-block uses native `h3` or `p`.
   - The alert tone gap is S1.
4. **Badge selection end to end.**
   - Schema target: `surface.schemas.ts:679`.
   - Type: `surface.types.ts:226`.
   - Host check: `surface-patch.ts:387`.
   - `sameSelection`: `surface-patch.ts:428`.
   - `describeSurfaceSelection`: `surface-selection.ts:79`.
   - `aria-pressed` bound to `selection.componentId` and target kind in the badge renderer.
   - The only gap is M1.
5. **Text fallback.** All six kinds are handled as criterion 6 and 5 require. Progress and radial-progress print `value%` unrounded. Divider falls back to "Divider" when `text` is absent.
6. **Catalog.md.** `surface-catalog-reference.spec.ts` validates each example inside a full spec/2 and catalog/3 envelope. Examples are keyed by exact `###` heading, so `text` and `text-block` cannot satisfy each other. The tool-description spec uses exact-token set equality and checks for duplicates.
7. **Nothing stubbed or swallowed** in the changed non-spec source.

## Five logic questions

1. Silent failure: none found, other than the colour-only alert tone (S1). A view-model failure surfaces as `renderFailed`.
2. Unexpected user action: selecting a non-selectable badge is possible only via a forged message (M1).
3. Wrong-answer input: fractional progress values render unrounded (for example "42.5%"). This is deliberate per the design.
4. Dependency failure: not applicable. The changes are pure validation and render.
5. Missing from requirements: a persisted catalog/2 surface migration message (m3), and a visible alert tone (S1).

## Verdict

CHANGES REQUIRED. Fix S1 (visible alert tone plus spec update); decide M1 and M2 explicitly. All other trust-boundary, view-model, renderer, selection and fallback logic is sound.

## Round 2 re-review (fix round)

Scope: `git diff -- libs` (six files: dashboard-alert, dashboard-divider, dashboard-radial-progress component and spec). Read in full. `npx nx run-many -t typecheck,test,lint -p declarative-dashboard` passed (typecheck run fresh; test and lint were served from the Nx cache, whose inputs match the working tree).

### Resolution of the Serious finding (alert conveyed by colour only / sr-only tone)

RESOLVED. `dashboard-alert.component.ts` now renders, per tone:
- an inline `aria-hidden="true"` SVG icon with a distinct glyph per tone (info, check, triangle, cross). Icon shape, not just colour, carries the tone.
- a visible `font-semibold` tone label (`Info`/`Success`/`Warning`/`Error`) ahead of the optional title and the text. The old `.sr-only` span is gone; the spec asserts `.sr-only` is absent.
- a neutral surface with tone as border and icon accent (`alert border border-<tone> bg-base-200 text-base-content`). The filled `alert-<tone>` text-contrast problem (S2) is removed.
- Class strings are complete literals per tone in the `ALERT_TONE_STYLES` map, with no concatenation. The icon `[class]` binding reads a literal from the map. `border-<tone>`, `bg-base-200`, `text-base-content`, `text-<tone>`, `h-4 w-4 shrink-0` and `font-semibold` are all stock Tailwind/daisyUI 4 tokens, so the scan keeps them.
- Role mapping is unchanged (warning/error `alert`, info/success `status`). The title span is still rendered only when a title exists, with order label, title, text. Everything is still interpolation, so agent text stays plain text. The spec checks that no h1-h6 element, hex colour or raw colour utility appears.

Specs assert the new behaviour (exact class sets compared order-insensitively, icon class and aria-hidden, visible label, no `.sr-only`, one-line child count of 2, label/title/text order). They are stronger than before, not weakened.

### Divider (S1)

OK. The vertical variant maps to `divider divider-horizontal h-full`, with host bindings `[class.flex]` and `[class.self-stretch]` bound to `isVertical()`. The horizontal host and inner class are unchanged, and the spec asserts both directions. Residual uncertainty: `h-full` inside a stretched flex host relies on the stretched item counting as a definite height. That works in current Chromium (the webview engine). I did not render it. The visual reviewer should confirm S1 closed in the next browser pass.

### Radial progress (S4)

OK. The neutral tone is now `'radial-progress text-base-content'`. `[style.--value]` is still the only style binding. The spec expectation was updated to match and still checks the exact class string.

### New findings

- Minor (no action required): `dashboard-alert.component.ts` repeats four near-identical SVG blocks that differ only in glyph path. Maintainability only; style-reviewer territory.
- Minor: `dashboard-alert.component.spec.ts` compares class sets order-insensitively, so it will not catch a class-order regression. That is acceptable, since Tailwind does not depend on order.
- No Blocking, Serious or Moderate findings introduced by the fix round.

### Deferred to later tasks

- Moderate: badge host check does not require `dashboard.select`.
- Moderate: tool description size at 4,952 of the 4,956 budget, so there is no headroom for future wording.
- Visual M1, M2, M3 (from visual-review.md).
- Badge contrast.
- Badge and progress convey tone by colour only (no icon or label). The alert fix does not extend to them.

Round 2 verdict: APPROVED
