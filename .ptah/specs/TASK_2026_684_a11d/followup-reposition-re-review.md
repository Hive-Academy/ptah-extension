# Follow-up reposition re-review, round 1

**Score: 8/10 · Verdict: APPROVED.** The shared update failure path from the prior review is fixed. No new logic finding in the changed paths. Approval covers code logic and the targeted specs; the orchestrator owns the rendered viewport check.

## Prior findings

1. **Resolved — failed latest compute.** `libs/frontend/ui/src/lib/native/shared/floating-ui.service.ts:192-210` catches a rejection, checks both the live request token and latest sequence, then tries one fresh compute. A second rejection logs and stops. The bounded retry, cleanup, and reopen cases are pinned at `libs/frontend/ui/src/lib/native/shared/floating-ui.service.spec.ts:151-217`. An older result cannot overwrite a successful retry.
2. **Partially resolved, no longer a code-review blocker — verification gap.** The scheduled-after-close no-op is now covered at `libs/frontend/ui/src/lib/native/popover/native-popover.component.spec.ts:103-120`, and the service specs cover failure and lifecycle races. The chat spec still only checks the reposition call (`libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.spec.ts:697-707`); real content growth and viewport containment await the orchestrator's rendered check.

## Five logic questions

1. **Silent failure:** two consecutive update compute failures leave the last position; this is now bounded and logged in dev mode (`floating-ui.service.ts:198-207`).
2. **User action:** changing the kind still schedules the explicit post-render reposition (`decision-model-row.component.ts:218`; `native-popover.component.ts:288-291`).
3. **Wrong answer from valid input:** overlapping successful computes apply only the latest result; a failed latest compute starts a fresh guarded measurement (`floating-ui.service.ts:193-197,206`).
4. **Dependency failure:** compute rejection is caught; the retry does not write after cleanup or reopen (`floating-ui.service.ts:194,198-207,221-222`).
5. **Missing requirement:** rendered containment under actual browser layout remains to be verified by the orchestrator; the mocked tests cannot establish it (`floating-ui.service.spec.ts:151-217`).

## Verification and decision

The requested UI Jest command passed **49/49 tests** across two suites. Jest also emitted a worker teardown warning; no test failed. Scoped `ptah_get_diagnostics` found no errors in the requested files; it reported three errors in sibling files outside this diff. No browser, Electron, build, or workspace-wide check was run.

**Decision:** Accept the one-retry recovery. Options were to retain the old position indefinitely or remeasure once; the latest-sequence and request-token guards at `floating-ui.service.ts:193-206` make the bounded retry the safer reversible choice. The score is below exemplary because layout correctness still depends on the separate rendered check.
