# P2 fix re-review

Verdict: **REVISE**  
Score: **8/10**  
Review family: **reviewer codex, implementer Claude**

Scope: `9ba611cde -- libs/`, the original findings 1–3, fix reports 1–4, and decisions D22/D24. Source files and git state were not changed.

Evidence paths below are relative to `libs/backend/auth-providers/src/lib/accounts/` unless otherwise stated.

| Finding | Status | Evidence |
| --- | --- | --- |
| 1. Physical identity at auth launch | closed | `claude-account-command.ts:90`, `:105`, `:320`, `:327`, `:338`, `:345` restore physical revalidation, creation-time guards and post-probe revalidation before returning auth results. `claude-login-console.ts:100` and `:116` guard console creation. The worker evaluates the supplied identity immediately before creation at `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner-source.ts:247` (identity comparison at `:215` and `:229`). Replaced-directory tests assert zero launches in `provider-account-auth-env.spec.ts:318` and `claude-login-console.spec.ts:155`; post-close replacement is covered at `provider-account-auth-env.spec.ts:334`. |
| 2. Late child close restores progress | open | Per-child receipts and the sign-in/sign-out ledger work at `claude-account-command.ts:145`, `provider-account-actions.service.ts:78`, `:94`, `:596`. Status/logout late-close and never-close coverage exists at `provider-account-actions.service.spec.ts:371`; registry coverage starts at `:474`. However, `provider-account-actions.service.ts:484` discards registry receipts during a status action, permanently preventing its late close from releasing the reservation. The test at `provider-account-actions.service.spec.ts:543` explicitly pins that incomplete behavior. |
| 3. Malformed successful registry output | closed | `claude-auth-settings-scan.ts:160` rejects headerless values and requires a header or a direct subkey. Both Policies (`:323`) and SOFTWARE fallback (`:331`) use it. Empty, whitespace-only and value-only regression cases for both branches are at `claude-auth-settings-scan.spec.ts:305`. |

Finding 2 remaining fix: retain every registry receipt returned to `runStatus`, subscribe to each, and release the status reservation only once all have closed, preserving prior state. Keep it held when any child remains unproved; dispose listeners on service disposal. Replace the test at `:543` with late-close release and never-close controls. The report-4 decision to exclude this caller does not satisfy this re-review's registry-probe requirement.

## New defects

1. **Moderate — shared runner now leaves ownerless close receipts in certification paths.**

   **Locations:** `claude-account-command.ts:286`–`:292`; `claude-route-certifier.ts:193`–`:196`.

   **Failure scenario:** A `--version` child outlives timeout/cancellation and kill grace. The changed `run()` intentionally keeps its close/error/stream listeners attached and returns a receipt, but `certifyExecutable()` returns only a refusal and termination boolean. No owner can dispose the receipt when the service is disposed. Similarly, run certification receives an unterminated status result and immediately returns a refusal without transferring or disposing its receipt, including the route-changed branch. A child that never closes retains those listeners indefinitely. Previously the shared runner detached on bounded settlement, so this is introduced by the fix, not merely an old unavailable late-close feature.

   **Fix:** Give every receipt an explicit owner on every return path. Pass executable-probe receipts through preparation into the auth ledger where late-close recovery is required. For certification callers intentionally unable to observe late closes, explicitly dispose the receipt while retaining `terminated:false`, as the new `withoutReceipts` helper already does for policy refusals. Add timeout/grace/disposal coverage for executable certification and run-certification status; assert child listener removal and no duplicate settlement.

## Decisions

- **D22 / deviation (a): accepted.** A direct subkey line contains the queried path and supplies structural evidence without a redundant header. The parser rejects unrelated/nested paths. Empty or whitespace-only output has neither structural witness; a value-only line before the header immediately refuses. Both query branches therefore fail closed for the reported malformed cases. Refusing a genuinely empty key is conservative. This judgement agrees with the recorded output examples in `implementation-plan.md:386`–`:408`; I did not independently run `reg.exe`.
- **D24 / deviation (b): accepted as deferred type hardening.** Production preparation includes the reserved route (`claude-route-certifier.ts:298`). Missing routes fail `claudeAccountRouteHolds` before status, logout or console spawn. No reviewed account-auth spawn bypasses that check. Route-independent version and registry probes are separate from these guarded credential operations. A required field would improve compile-time enforcement, but optionality does not reopen finding 1.
- No new logging of secrets, paths or CLI output, environment mutation, module-namespace `jest.spyOn`, or spec `process.cwd()` use was found in this diff. Reviewed receipt/ledger callbacks are idempotent; time and PID do not reclaim reservations. The ownership gaps above prevent a blanket listener-lifecycle approval.

## Not checked

- Ran `npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.spec.ts --maxWorkers=2 --silent`: **1 suite, 48 tests passed** (39.17 s). Node emitted a Jest-config ES-module loading warning. This suite currently pins the status/registry retention gap; passing it does not close finding 2. Other regression specs were inspected only.
- No full suites, builds, installs, workspace verification, live Claude/conhost/registry processes, OAuth or Electron end-to-end behavior were exercised.
- No whole-phase re-review or independent revalidation of the fix reports' claimed verification runs.
