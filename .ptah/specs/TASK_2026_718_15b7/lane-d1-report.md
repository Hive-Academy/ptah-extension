# Lane D1 — zoneless spec timing

## Result
The two production findings below are now fixed under the orchestrator's expanded scope. Latest single targeted run: **204 passed, 2 failed, 206 total; 5 suites passed, 1 failed**. Both original regression tests pass. Two other model-search tests needed their opening gesture changed from focus to click; those final setup edits preserve every assertion and have not been rerun because the follow-up explicitly requested one Jest run. No test setup/shared helper files or existing assertions/test cases were changed. No git commands were run. Earlier results below are historical; see the approved-production-fixes section for current status.

## Files changed and confirmed causes
- `libs/frontend/chat/src/lib/settings/ptah-ai/session-budget-settings.component.spec.ts`: added a macrotask drain to the existing settle helper before whenStable. Initial settings RPC Promise.all and subsequent write continuations were not covered by zoneless stability. Suite passes.
- `libs/frontend/chat/src/lib/settings/advanced/advanced-settings-group.component.spec.ts`: added the same drain to its existing settle helper. RPC reads and Promise.race loading completion were pending at DOM reads. The existing explicit fake-timer timeout test remains intact. Suite passes.
- `libs/frontend/chat/src/lib/settings/pro-features/system-prompt-drawer.component.spec.ts`: drain RPC continuations in the existing nested settle helper and successful-regeneration test. Regeneration awaits status refresh before emitting changed; whenStable alone returned too early. Suite passes.
- `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.spec.ts`: await async zero-duration fake-timer advancement after cancellation in two timer tests, and drain promises/await stability after cancellation in the superseded-probe test. Cancellation seam completion was not synchronous. Suite passes.
- `libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.spec.ts`: replace bounded microtask flushing with rendering, a macrotask drain and whenStable. Remaining failure persists after settling: focus opens the search and shows an empty query rather than the selected label (see Findings).
- `libs/frontend/chat/src/lib/settings/ptah-ai/cursor-credential-popover.component.spec.ts`: replace bounded microtask flushing with a macrotask drain and whenStable. The suite now completes rather than crashing its worker, exposing the deliberate destroy-during-save test's production lifecycle error (see Findings).

## Verification
Ran only the six assigned specs, sequentially with at most two Jest workers. Baseline: 6 suites failed, 77 failed / 112 passed / 189 tests counted (cursor worker failure prevented full counting). After edits: all 206 tests execute.

PowerShell command (final run):
```powershell
npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/settings/ptah-ai/session-budget-settings.component.spec.ts libs/frontend/chat/src/lib/settings/advanced/advanced-settings-group.component.spec.ts libs/frontend/chat/src/lib/settings/pro-features/system-prompt-drawer.component.spec.ts libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.spec.ts libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.spec.ts libs/frontend/chat/src/lib/settings/ptah-ai/cursor-credential-popover.component.spec.ts --coverage=false --maxWorkers=2 > "$env:TEMP/d1.log" 2>&1
Select-String -Path "$env:TEMP/d1.log" -Pattern "Tests:|Test Suites:|^FAIL|●" | ForEach-Object { $_.Line } | Select-Object -First 40
```

Filtered final result:
```text
● CursorCredentialPopoverComponent › M3: the confirmation survives the popover being destroyed mid-save (the row moved groups)
FAIL chat libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.spec.ts (6.359 s)
● MainAgentReassignPopoverComponent › model (compact search, drafted on selection) › "Enter a model ID…" swaps in a field (the footer waits); Use drafts the typed id and Save writes it (#35)
Test Suites: 2 failed, 4 passed, 6 total
Tests:       2 failed, 204 passed, 206 total
```

Read detailed failures from the saved log with Select-String -Context 0,18; no run was repeated just to reread output. Scoped ptah_get_diagnostics ultimately returned no diagnostics in the six requested files, and 255 errors in sibling files outside this lane's ownership. Initial diagnostics timed out at 45 seconds; the later result completed. No unrelated fixes made.

## Findings
1. **Production lifecycle defect:** `libs/frontend/chat/src/lib/settings/ptah-ai/cursor-credential-popover.component.ts:315` calls focusAfterRender after awaiting the save, even if the view was destroyed meanwhile. At `:332`, afterNextRender registers against the destroyed injector and throws NG0911. The existing M3 test intentionally destroys the fixture before resolving the save; its assertion must remain. Requires an out-of-scope production lifecycle guard while preserving the toast that outlives the popover.
2. **Behavior/assertion mismatch, not an unsettled RPC:** `libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.ts:471` focuses the recreated search input after Use. `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-search-field.component.ts:106` opens the panel on focus; `:305` clears the query; `:292-293` displays that empty query while open. Thus the preserved spec assertion at `main-agent-reassign-popover.component.spec.ts:495` expects "vendor/unlisted · not in current catalog" but receives "". Additional settling does not fix this. Caller must decide whether programmatic focus should open the search or the expected label should change; neither production nor assertions were changed here.
3. Scoped diagnostics reported sibling-file type errors (255), outside the six-file scope; no claim of a clean project typecheck.

## Decisions
- Reuse each applicable local settle/flush helper, adding a macrotask drain; options were local helpers, a shared helper, or timer rewrites. The one symbol search returned zero indexed hits; text fallback found no generic flushPromises helper. Core's settleSurfaceNavigation is specifically for router navigation and calls TestBed.tick(), so importing that router-specific abstraction into these specs would misstate its purpose. Existing local helpers are the appropriate reuse. Reversible spec-only change.
- For wizard tests already using fake timers, use advanceTimersByTimeAsync(0), not runAllTimersAsync: active checking uses a repeating elapsed timer. Zero-duration advancement drains cancellation promises without exhausting a live interval or changing the elapsed-time assertions. Reversible.
- Keep the two failing assertions and report evidence rather than masking lifecycle errors or changing production behavior, per the explicit scope constraint.
- Source evidence: chat/src/test-setup.ts uses setupZonelessTestEnv; these specs use TestBed/component fixtures and existing local helpers. CLAUDE.md mandates scoped, bounded verification. Task context specifies a plan-free bugfix; no batches or implementation plan exists in this task folder. The direct lane assignment defines ownership.

## Not done
The final two click-gesture test setup edits still need a verification run by the invoking workflow. The original findings are resolved by the approved production fixes below. No existing assertions, broad tests, builds, e2e or git operations were changed/run.

## Approved production fixes and final verification status
- `libs/frontend/chat/src/lib/settings/ptah-ai/cursor-credential-popover.component.ts`: inject DestroyRef, register an onDestroy callback that sets a private destroyed flag, and return early from focusAfterRender after destruction. Save completion still announces its toast; only invalid focus scheduling is guarded. The existing destroy-during-save test passes in the single requested run.
- `libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.ts`: add `[openOnFocus]="false"` to the main-agent model field, matching `cli-tier-mapping-modal.component.ts:118`. Returning focus after Use preserves the drafted label. Existing #35 passes. Shared UI code is unchanged; its click handler still opens the panel.
- `libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.spec.ts`: after the run exposed two tests opening the list with synthetic focus, change exactly those two setup gestures to `input.click()`. Existing filtering/keyboard/ARIA and Escape assertions remain unchanged. Source confirmation: `provider-model-search-field.component.ts:107` binds click to openPanel. These last two setup edits were not rerun, honoring the explicit one-run limit.
- Decisions: follow the orchestrator-approved DestroyRef flag and openOnFocus input, without other refactoring. Adapt the existing opening gestures to the explicitly approved click-to-open behavior rather than altering assertions or restoring focus-to-open behavior. These edits are reversible and remain within the expanded ownership.
- Ran the same six-spec Jest command above exactly once for this follow-up. Filtered result:
  - MainAgentReassignPopoverComponent: `filters as the user types; arrows and Enter pick a model into the draft (keyboard, ARIA combobox)` failed at the expanded-state assertion because focus no longer opens the list.
  - MainAgentReassignPopoverComponent: `Esc closes the open model list first, and only the next Esc closes the popover` failed because its focus-only setup left the list closed.
  - `Test Suites: 1 failed, 5 passed, 6 total`
  - `Tests: 2 failed, 204 passed, 206 total`
- Both failures above motivated the final click-gesture edits, not any assertion changes. The saved log remains at `%TEMP%/d1.log`; it contains no Cancel probe failed console line. No cli-tier suite or broad checks were run.
- Scoped diagnostics for the two production files, then for those files plus the final spec edit, each returned unavailable after 45 seconds with TypeScript still running. No completed typecheck claim is made for this follow-up.

## Follow-up: expected cancellation error console output
- Changed only `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.spec.ts` for this follow-up. The rejection test intentionally supplies `Promise.reject(new Error('RPC cancel failed'))`. Production logs `console.error('[ProviderSetupWizardComponent] Cancel probe failed:', errorType)` at `provider-setup-wizard.component.ts:2186`, so this output is expected.
- Added a per-test `console.error` spy with a no-op implementation; asserted exactly one call with `'[ProviderSetupWizardComponent] Cancel probe failed:'` and `'Error'`. Wrapped the test body in try/finally and restore the spy in finally, including on assertion failure. All existing behavioral assertions remain. No global console stub was added.
- Decision: explicitly verify the intentional error logging, as authorized by the follow-up, rather than changing the rejection mock and losing cancellation-failure coverage. Reversible, confined to this test.
- Re-ran the same six-spec Jest command above exactly once. Filtered result: `Test Suites: 2 failed, 4 passed, 6 total`; `Tests: 2 failed, 204 passed, 206 total`. The wizard suite passes. The only failures remain the cursor destroyed-view test and main-agent model-label assertion documented under Findings.
- `Select-String -Path "$env:TEMP/d1.log" -SimpleMatch "Cancel probe failed"` found **0 occurrences**. The test verifies the expected log through the spy instead.
- Follow-up scoped ptah_get_diagnostics for the wizard spec returned unavailable after 45 seconds with the background TypeScript check still running; no claim of completed follow-up type diagnostics. Jest verification completed.
