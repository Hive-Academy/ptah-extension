# Batch 22 report

## Files changed and deleted

- Changed `libs/frontend/onboarding/src/lib/home/onboarding-home.component.ts` and `.spec.ts`.
- Changed `libs/frontend/onboarding/src/lib/ready/ready-strip.component.ts` and `.spec.ts`.
- Deleted `ready/claude-readiness.store.ts`, `ready/claude-readiness.store.spec.ts`, `ready/claude-readiness-banner.component.ts`, and `ready/claude-readiness-banner.component.spec.ts`.
- No onboarding barrel named a deleted file.

## Home regions

1. Replaced the Claude banner and store imports with `ConnectionReadinessBannerComponent` and `ProviderReadinessStore`.
2. Switched the standalone component import to the connection banner.
3. Passed `chosen()` to the ready strip through its `connection` input.
4. Rendered the connection banner with `chosen()` in the existing position and placement.
5. Changed the footer link text to “Review your connection and settings.”
6. Injected `ProviderReadinessStore` and exposed its `chosen` signal.
7. Requested `refresh('mount')` on Electron Home entry.

## Spec cases

- Updated the Home mount, banner placement, banner clearing, footer text, and VS Code inert cases for the provider store and connection banner.
- Added the Home timeout case: the first strip item reads “Taking longer” and no banner appears.
- Removed the ready-strip cases for the deleted `claude` input; retained chosen connection, selection, settings, marker, and responsive cases.
- `ptah_get_diagnostics` reported no errors in the four edited TypeScript files. It reported 25 errors in sibling files outside this batch.

## Reference search

`grep -rn 'claude-readiness\|ClaudeReadiness' libs apps` returned 10 lines. Eight are the retained `deriveClaudeReadiness` symbol/type and its tests in `provider-readiness.derive.ts`, `provider-readiness.derive.spec.ts`, and `provider-readiness.store.ts`. Two are stale selectors at lines 64–65 of `libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/onboarding-ready-visual.e2e.spec.ts`. That importer is outside the allowed edit list, so it was reported rather than changed. No import of a deleted file remains in onboarding.

## Decisions

- Kept `deriveClaudeReadiness` in the provider-aware derivation. The plan explicitly retains Claude derivation as one provider branch; renaming it would touch files outside Batch 22. Reversible.
- Left the webview visual harness selectors for the parent to update because the task explicitly limits edits outside onboarding. Reversible.

## Not done

- Did not run Nx, npm verify, Jest, TypeScript CLI, browser, build, or app targets, per the batch instructions. CI will verify behavior. No Electron visual review was run.
- Did not change the webview visual harness selectors. They will need the new `connection-readiness-banner` and `connection-readiness-banner-action` test IDs.

## Follow-up: E2E harness

- Updated `libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/onboarding-ready-visual.e2e.spec.ts`. This follow-up supersedes the earlier “Did not change” note above.
- `HOME_BANNER`: `claude-readiness-banner` → `connection-readiness-banner`; `HOME_BANNER_ACTION`: `claude-readiness-banner-action` → `connection-readiness-banner-action`. These are the exact `data-testid` values in `ConnectionReadinessBannerComponent`.
- HOME_BANNERS missing and signed-out rows retain `data-state=missing` / `signed-out`, “Install Claude Code” / “Sign in”, and “Needs install” / “Needs sign-in”: the fixture selects `claude-cli` by default and the new banner and strip use that chosen connection.
- HOME_BANNERS error-timeout retains terminal `data-state=error`, “Check again”, and “Could not check”. The scenario now asserts the intermediate “Taking longer” strip word and absent banner, then advances the clock 11 seconds through the two five-second follow-ups before asserting the terminal state.
- The Home ready and checking cases still expect no rendered banner and their existing strip words. The contrast sweep Home missing action remains “Install Claude Code” because its fixture also chooses Claude. The new banner keeps the `data-state` attribute and these action labels.
- Read-only grep found no old Home footer text or ready-strip `claude` binding anywhere under `libs/frontend/webview-e2e-harness`; no outside-file hits to report.
- Scoped `ptah_get_diagnostics`: no errors in the edited visual spec; eight diagnostics in sibling harness files. Browser execution and screenshots were prohibited, so the timer-driven capture remains unverified visually.
