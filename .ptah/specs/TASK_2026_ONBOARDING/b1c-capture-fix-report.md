# B1c capture fix report

## Root causes

1. Accounts: `onboarding-ready-visual.e2e.spec.ts:234-237` searched for the Accounts tab *inside* `[data-testid="connection-detail-drawer"]`. That ID marks only the header (`connection-detail-drawer.component.ts:69-76`); the tab group is its sibling (`:78-82`). The failure snapshot shows the dialog and `Accounts` tab present and selected, so this was a harness locator error, not missing Electron support. The fixture explicitly installs the Electron host at `onboarding-ready.fixtures.ts:195`.
2. Credentials: `onboarding-ready-visual.e2e.spec.ts:313-314` selected every descendant `code` in `credentials-cli`. The component renders two command-row codes (`credentials-tab.component.ts:137-145`) and a third inline explanatory `claude` code (`:146`). The failure snapshot's three values match that markup; the app commands are correct.

## Changed files

- `libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/onboarding-ready-visual.e2e.spec.ts`: scope the Accounts assertion to the named dialog and the command assertion to direct command-row codes. The selected-tab assertion and both exact command values remain.
- `.ptah/specs/TASK_2026_ONBOARDING/b1c-capture-fix-report.md`: this report.

No production file, fixture, capture helper, backend, host, or shared command constant changed.

## Checks

- `/tmp/onb-capture.log`: 108 passed, 8 failed (two assertions across four themes). Failure contexts in `libs/frontend/webview-e2e-harness/test-results/` show the selected Accounts tab and all three credentials codes.
- `ptah_get_diagnostics` scoped to the changed spec: zero errors in the requested file; eight sibling-project diagnostics from its compiler mode, including existing `import.meta` module-mode reports. The project verify result below is the authoritative typecheck.
- `npm run verify -- -p @ptah-extension/webview-e2e-harness -t typecheck` (output filtered to target/status lines): exit 0; `NX 1 task: 1 succeeded`. It waited for the shared verify memory/lock slot without changing concurrency or cache settings.
- Rendered evidence after these edits: **not run**. This lane was explicitly barred from build, e2e, screenshots, and browser execution; the coordinator must rebuild and capture.

## Decisions

- **Dialog locator rather than a host/config change.** Options: change the selector; change the Electron host setup; change production drawer markup. Evidence: the failed DOM snapshot contains `dialog "Claude (Subscription) connection details"` with `tab "Accounts" [selected]`, and `installHost(..., 'electron', ...)` is already present. The selector change is reversible.
- **Select command-row codes rather than accept the third code or change copy.** Options: narrow the selector; change expected values to three; edit production markup. Evidence: component lines 137-146 distinguish the two command rows from the explanatory sentence. The selector change is reversible.

## Blockers

- Visual capture gate remains unmet until the coordinator rebuilds the post-merge webview and reruns all captures. `HANDOFF.md:107-110` says merge `b2a081065` made the previous build stale; its later note supersedes the older build-current wording at `:115`. No production correction is indicated by these two failures.

## Next exact capture command

Run in the coordinator's permitted screenshot step, from this worktree, after the post-merge build:

```sh
node scripts/verify.mjs --exec --task onboarding-ready-webview-build -- npx nx run ptah-extension-webview:build
node scripts/verify.mjs --exec --task onboarding-ready-captures -- npx nx run @ptah-extension/webview-e2e-harness:e2e --skip-nx-cache --output-style=static -- onboarding-ready-visual > /tmp/onb-capture.log 2>&1
```
