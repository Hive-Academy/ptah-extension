# Shared popover correction

## Root cause

The test expectation was wrong; the component does not need changing. The original `native-popover.component.spec.ts:510` helper read private Angular `ɵcmp.styles`, then line 529 onward expected the production stylesheet to survive Jest transformation. `libs/frontend/ui/jest.config.ts:8` configures jest-preset-angular. Its installed transformer, `node_modules/jest-preset-angular/build/transformers/replace-resources.js:118`, removes literal `styles` metadata (returns undefined at line 122). The component declares such an array at `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts:115`. Runtime stylesheet assertions therefore cannot verify this component's styling in this test environment.

An additional latent flaw was the raw-text rejection of `will-change:`: that text occurs in the explanatory CSS comment at component line 122, without declaring that property. This was the initial source hypothesis; investigation of the installed transformer established the more immediate cause above.

## Changes

- `libs/frontend/ui/src/lib/native/popover/native-popover.component.spec.ts:494`: retain the native HTMLElement prototype type; install test methods with Object.defineProperty and restore their complete original descriptors, deleting only properties absent before the test. Removes the first new double cast.
- Same file, line 514: replace private Angular metadata assertions with rendered shell lifecycle assertions: initially absent, manual popover while open, containing the panel, absent again after close. Remove the metadata helper and its double cast; rename the test to describe what Jest can verify.
- Component source unchanged. Public inputs, outputs, styling and production behavior unchanged. Existing casts at spec lines 70–71 preserved; those are the only remaining `as unknown as` occurrences. No new `any` or suppression directives.

## Verification

The permitted Jest command was invoked twice total. The latest run, before the final removal of unsupported style assertions, reported:

`Tests:       1 failed, 36 passed, 37 total`

Its sole failure was the temporary computed-style replacement (`pointerEvents`: expected `none`, received `auto`), confirming that production styles are unavailable in this harness. The final edit removes those unsupported assertions. **The final revision was not rerun because the two-run ceiling was reached; a passing final spec is not claimed.** Acceptance still needs a scoped Jest run by the invoking workflow when authorized.

Required scoped `ptah_get_diagnostics` after the final edit reported no diagnostics in the changed spec. It reported eight errors outside this scope: IntersectionObserver mock typing in aurora-effect, index-signature access in surface-tile, and BigInt target errors in shared capability/attention files. These were left untouched. The tool used its TypeScript compiler backend; no separate tsc, Nx, lint, build, Electron, or other test command was run.

## Decisions

1. Correct the spec rather than the component. Options: alter working component styling, inspect private metadata, or assert rendered behavior. Evidence: Jest's transformer removes styles and the component template at line 89 already mounts the manual shell conditionally. Chosen: rendered behavior. Reversible and confined to this spec.
2. Preserve prototype descriptors rather than casting to a generic record or relying on spyOn for APIs that jsdom may omit. Evidence: existing tests deliberately install missing browser APIs. Descriptor restoration preserves original property attributes as well as values. Reversible test-only change.
3. Leave transparency, hit testing and native backdrop painting to browser verification; do not inject duplicate test-only CSS or change Jest configuration. Evidence: the harness strips styles, and configuration edits/browser launch are outside the assigned scope. Reversible if future authorized browser coverage is added.

## Not done

- Final passing Jest verification remains outstanding due to the explicit two-run limit.
- No Electron launch or real top-layer painting/hit-testing verification.
- No unrelated file edits, git operations, or changes to theme-toggle files or .gitignore.

Only the spec and this deliverable were written.
