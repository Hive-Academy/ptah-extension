# PR #639 webview e2e fix

## Root cause

`OrchestrationSettingsComponent` renders the new session-budget chunk with
`@defer (on viewport)` at
`libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:83`.
At the 1024x768 e2e viewport it could remain outside the viewport, but its
placeholder at `:86-89` was incorrectly marked `[aria-busy="true"]` before
the section had begun any read. `waitForSettled()` therefore correctly found one
busy element. This was layout/platform-sensitive, which explains the Windows
pass and Linux failure.

The settings fixture also mapped every `settings:get` request to the unrelated
`ptahCliAgents` response (`settings.fixtures.ts:532` before this change), so it
had no N7 `sessionBudget.*` values when the chunk did load. Finally, the product
read used the RPC default timeout rather than an explicit loading boundary.

## Changes

- `orchestration-settings.component.ts:83-89` retains viewport deferral (and
  its bundle-saving behavior) but removes the inaccurate busy state from the
  not-yet-requested placeholder. The mounted card still announces its real
  loading state through its status message.
- `session-budget-settings.component.ts:39,365` passes a 5,000ms timeout for
  each `settings:get`. The existing unsuccessful-result/catch handling at
  `:366-380` then switches the card to its accessible Retry error state rather
  than retaining loading indefinitely.
- `settings.fixtures.ts:170-190,554` adds all ten `sessionBudget.*` fixture
  values and routes only those keys to them; the existing `ptahCliAgents` key
  retains its old fixture.
- `session-budget-settings.component.spec.ts:131-137` regression-tests the
  explicit bounded timeout.

## Verification

- `npx nx run @ptah-extension/webview-e2e-harness:e2e -- --grep "baseline smoke|live-shaped values"`
  passed on the final run (36 tests, two workers). The earlier matrix-popover
  timeout was not reproduced; none of the four original `waitForSettled()`
  failures recurred.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/webview-e2e-harness --parallel=2`
  was invoked; `@ptah-extension/webview-e2e-harness:lint` passed from cache.
  The process launcher did not return a final Nx summary. Scoped diagnostics
  subsequently reported no diagnostics in the four changed files; it did
  report 246 pre-existing sibling `chat` errors.

## PNG files rewritten by e2e

`git diff --name-only -- "*.png"` reported 104 files in the following filename
groups. They were not reverted or otherwise changed by this work:

- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-claude-cli-credentials-{electron,vscode}-{anubis,anubis-light}-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-moonshot-{credentials,models}-{electron,vscode}-{anubis,anubis-light}-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-moonshot-{electron,vscode}-{anubis,anubis-light}-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-sovereigneg-{advanced,models}-{electron,vscode}-{anubis,anubis-light}-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-sovereigneg-{electron,vscode}-{anubis,anubis-light}-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-live-{orchestration,providers}-{electron,vscode}-{anubis,anubis-light}-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-main-agent-{model-search,popover,save-to}-{electron,vscode}-{anubis,anubis-light}-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-{modal-add,order-popover,popover-copilot,popover-cursor,popover-effort,popover-model,popover-permission,role-popover,roles-open}-{electron,vscode}-{anubis,anubis-light}-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-modal-tiers-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-modal-tiers-vscode-{anubis,anubis-light}-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-{electron,vscode}-{anubis,anubis-light}-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-provider-catalog-{electron,vscode}-{anubis,anubis-light}-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-providers-{electron,vscode}-{anubis,anubis-light}-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-scope-popover-{electron,vscode}-{anubis,anubis-light}-1024x768.png`
