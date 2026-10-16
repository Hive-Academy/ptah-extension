# B1 roster extraction report

## Changes and specs

| Item | Change | Specs |
| --- | --- | --- |
| Style M1 | Moved Tribunal coordinator, request and nonce state, question filtering, pending input and speech effects, timeout and Decline handling into one plain `CommandCenterRosterProvider` composed by the controller. Controller line count: **350** (`(Get-Content <file>).Count`), below the 700-line limit. | New provider spec covers roster lifecycle and guard behavior; existing controller spec still exercises the page facade. |
| Guard M-3 | Confirm captures the old nonce before awaiting; it clears expected state only if that nonce still owns the request. Pending card clearing also checks proposal id. | Provider spec interleaves a second request with an unresolved Confirm and asserts the second nonce survives. |
| S1 M-A | Exported `isRosterIdleWithoutPendingRequest`. The 12-second grace is armed only after a skipped pulse or an active status and only for `loaded`/`fresh`/`draft` with no root question or permission. Activity, pending request, response, second pulse, session teardown and destroy clear the timer. Active turns have no wall-clock expiry. | Provider fake-clock specs cover a long stream, resumed activity, idle expiry, second-pulse settlement and predicate states. |
| S1 M-B | Kept the invalid-Decline gate and exposed `retryInvalidDecline` through the controller facade for B3 toast wiring. Automatic failures say “Retrying” until the cap, then “Retry”; success says “request cancelled”. | Provider fake-clock spec checks 250 ms retry, three-attempt cap, manual retry and final text; controller spec keeps send-gate checks. |
| S1 M-C | Decline and roster timeout timers have teardown and DestroyRef cleanup. Retry timer is cancelled on manual retry or vanished question. | Provider timer specs and existing controller exit and proposal timeout specs cover these paths. |

Confirm remains a card-only action. The ordinary-question Confirm gate and invalid-Decline send gate remain in place. No page providers or DI cycle were introduced.

## Preserve contract checklist

| Controller member | Status |
| --- | --- |
| `tribunal` | Kept; delegates to `roster.tribunal`. |
| `pendingProposal` | Kept; delegates to `roster.pendingProposal`. |
| `rosterTimedOut` | Kept; delegates to `roster.rosterTimedOut`. |
| `ordinaryQuestion` | Kept; delegates to `roster.ordinaryQuestion`. |
| `ordinaryChoices` | Kept; delegates to `roster.ordinaryChoices`. |
| `permissionRequest` | Kept; delegates to `roster.permissionRequest`. |
| `shownInput` | Kept; delegates to `roster.shownInput`. |
| `shownProposal` | Kept; delegates to `roster.shownProposal`. |
| `undeclinedInvalidQuestionId` | Kept; delegates to `roster.undeclinedInvalidQuestionId`. |
| `confirmProposal` | Kept; delegates to `roster.confirmProposal`, preserving `Promise<void>`. |
| `declineProposal` | Kept; delegates to `roster.declineProposal`, preserving `void`. |
| `timeoutProposal` | Kept; delegates to `roster.timeoutProposal`, preserving `void`. |
| `retryInvalidDecline` | Kept; delegates to `roster.retryInvalidDecline`, preserving `void`. |
| `sendCommand` | Kept; Tribunal request lifecycle delegates to `roster.sendRequest`, preserving `Promise<boolean>`. |
| `teardownSessionState` | Kept; delegates roster teardown and clears armed voice turns. |

## Verification

- Controller count: **350 lines**.
- `ptah_get_diagnostics` after the extraction reported no errors in the four requested files. The final retry after the toast wording edit timed out while the TypeScript check continued, so that last edit was not checked by diagnostics. The completed project result included sibling errors in B2-owned files and integration specs; B1 did not edit them.
- Nx, Jest, tsc, build, serve and e2e were not run, per the parallel-lane instruction. Orchestrator owns those checks.

## Files changed

- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts`
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-center-roster.provider.ts` (new)
- `libs/frontend/command-center/src/lib/components/command-center-roster.provider.spec.ts` (new)
- `.ptah/specs/TASK_2026_687_615f/reports/b1-report.md` (this deliverable)

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep page facade signals as references to roster signals. | Alias signals / duplicate computed state. | Preserve contract requires identical names and return types with one roster source of state. | Yes. |
| Use a plain composed class and lazy voice port. | Composed class / Angular page provider. | Approved plan and the controller voice callback would create a DI cycle through an injected roster provider. | Yes. |
| Use 12 seconds of idle grace after observed activity. | Fixed request TTL / idle grace. | Approved plan permits 10–15 seconds only after skipped pulse or active-status exit; streaming can be legitimately long. | Yes. |
| Keep manual Decline retry available after three automatic attempts. | Permanent block / manual retry. | S1 M-B requires an explicit retry action while retaining the send gate until Decline succeeds or the question vanishes. | Yes. |
