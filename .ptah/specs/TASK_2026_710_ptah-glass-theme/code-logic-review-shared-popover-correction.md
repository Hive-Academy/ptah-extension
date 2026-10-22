# Code logic review: shared popover spec correction

## Review family

Reviewer: Claude (Sonnet 5.5). Implementer: codex (OpenAI). Source-only review; no checks run. Orchestrator reported 37/37 passing after the change, which I accept as given and did not re-run.

## Verdict

APPROVED (spec correction). Top-layer acceptance still needs browser evidence (items below).

## Findings

1. Claim check, true. `spec.ts` has no `any` or `@ts-ignore`. `as unknown as` appears only at lines 70-71 (pre-existing). The descriptor mocks use `Object.defineProperty` on `HTMLElement.prototype` with no casts. Severity: none.

2. Minor, spec `installPopoverApi` (about lines 497-515) and its users. Restoration is by a returned `restore()` called in `finally`, not `afterEach`. It restores the full original descriptor, or deletes the property when it was absent. The `finally` blocks run on assertion failure. No leak is visible between tests. Residual: if a future test installs without `try/finally`, the stub leaks and the "no popover API" test (`still positions and opens...`) would silently change meaning. Moving restore into `afterEach` would be sturdier. Severity: Minor.

3. Minor, test "wraps the panel in a transparent manual popover shell only while open". The name still says "transparent" in the diff header and the body only checks the `popover="manual"` attribute, containment, and removal on close. It would fail if the shell were removed or never unmounted, because the `.ptah-popover-layer` query returns null. It would not fail if `showPopover` were never called. That is covered separately by "promotes the shell with showPopover before computePosition", "hides on close" and "hides on destroy", which do guard promotion order and hide. Meaningful coverage is retained. The name should drop "transparent" (or keep it only if the final spec already renamed it). Severity: Minor.

4. Moderate, coverage lost. Transparency of the shell and native backdrop, `pointer-events: none` on the full-viewport shell and `auto` on panel and backdrop, and `will-change` absence are no longer asserted anywhere. Jest strips inline styles (codex's root-cause is plausible given `jest-preset-angular` replace-resources). Failure scenario: a CSS regression makes the shell an opaque, click-blocking full-viewport layer, and CI stays green. Record as REQUIRING BROWSER EVIDENCE (Electron, dark and light). Severity: Moderate, accepted as a limit.

5. Minor, `hides on close` test. It appends `fixture.nativeElement` to `document.body` and never removes it (the `pins a failed panel` test does the same). Leaked DOM nodes could affect `document.activeElement` assertions in later tests. TestBed teardown removes fixture roots by default, so this is probably harmless. Severity: Minor.

## Prior-review items still open (unchanged by this correction)

- Fallback to in-DOM placement when `showPopover` is missing or throws does not fix ancestor stacking. Fallback opening must not count as repair. Open.
- Nested native dialog Escape arbitration: unverified in Electron. Open.
- Pointer hit testing (`hasBackdrop=false`, nested and multiple top-layer surfaces): unverified. Open.
- Small-viewport overflow in the Floating UI failure fallback: unclamped. The new test only pins left and top under the trigger. Open.
- The double-cast item (prior finding 1) is now resolved for the new code.
- Real top-layer painting, Electron dark and light checks and the full required-evidence list from the prior review remain outstanding.
