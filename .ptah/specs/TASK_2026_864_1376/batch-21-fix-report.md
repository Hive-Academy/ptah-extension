# Batch 21 fix report

## Files changed

- `libs/frontend/onboarding/src/lib/ready/ready-connection-step.page.ts:50` — restored the Continue anyway test ID.
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/onboarding-ready-visual.e2e.spec.ts:64-65` — scoped Home banner selectors to the Home host.

## D1 test-ID table

The deleted old page cannot be read without a git command, which this round forbids. I audited every stage-1 `ready-*` test ID currently referenced by `apps/ptah-electron-e2e/src` and `libs/frontend/webview-e2e-harness/src` against the new page and its child components.

| Referenced test ID | Consumer | New markup | Result |
| --- | --- | --- | --- |
| `ready-continue-anyway` | `onboarding.spec.ts:26` | `ready-connection-step.page.ts:50` | Restored on the Continue anyway button. |
| `ready-claude-panel` | `onboarding-ready-visual.e2e.spec.ts:164`; `onboarding-ready-capture.ts:34` | `provider-panel.component.ts:35` | Already rendered for Claude. |
| `ready-named-account-link` | `onboarding-ready-visual.e2e.spec.ts:351` | `provider-panel.component.ts:174` | Already rendered on the Claude account link. |
| `ready-strip` | `onboarding-ready-visual.e2e.spec.ts:158`; `onboarding-ready-capture.ts:34` | `ready-strip.component.ts:95`, mounted by `ready-connection-step.page.ts:24` | Already rendered. |
| `ready-connection-step` | `onboarding.spec.ts:25,35`; visual spec `:58` | `ready-connection-step.page.ts:21` | Already rendered on the new page host. |

The other `ready-*` references in those trees belong to stage 2 or are capture names, not old stage-1 test IDs. No further stage-1 test ID is referenced there.

## D2 change

`onboarding-ready-visual.e2e.spec.ts:64-65` now selects the existing `claude-readiness-banner` and action test IDs beneath `[data-testid="onboarding-home"]`. This matches today's `<ptah-claude-readiness-banner>` and remains valid when Batch 22 changes the component tag while keeping those IDs.

## Decisions

- Used the Home host as the stable selector scope because the banner's component tag changes in Batch 22; reversible selector choice.
- Left the ready page spec unchanged because the user scoped it to a test ID assertion only if needed; the e2e consumer already asserts the restored ID by clicking it.
- Ran no git, Nx, npm verify, Jest, TypeScript CLI, build, serve, package, or e2e commands. `ptah_get_diagnostics` was requested after edits but returned both changed TypeScript files unchecked because the compiler remained busy for 45 seconds.
