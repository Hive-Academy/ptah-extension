# Review fix D — concurrent Stop

## Root cause

`abortWithConfirmationFor` checked one global stopping flag before awaiting the running-agent query. Two calls could pass that check. The later call could then return success after `abortCurrentMessageFor` skipped its abort, and its `finally` could clear the first call's flag.

## Change

- `ConversationService` now tracks an in-flight outcome by captured tab ID and session ID. An ownership symbol gates cleanup; only the owner removes its entry, and `isStopping` remains true while any target is in flight.
- A second Stop for the same target joins the first outcome. Different targets proceed independently. The returned boolean reflects the abort RPC result; cancellation and abort failure return false. The no-argument abort still captures the active target once.
- Query, confirmation, abort, queue cleanup, and failure fallback continue to use the captured target. No new service or public API was added.

## Tests

- Added overlapping same-target cases for successful and failed aborts: one running-agent query, one abort RPC, matching results, and a flag that clears after the owner finishes.
- Added different-target overlap: both abort RPCs run, and the flag remains set until both settle.
- Updated the existing abort-failure expectation to reflect the actual failed outcome.

## Verification

`npm run verify -- -p @ptah-extension/chat` passed in the foreground: 3 of 3 Nx tasks succeeded (lint, test, typecheck), exit code 0. The first run found two pre-existing timing tests affected by a deferred start; the implementation was corrected to start synchronously, and the second full gate passed. `ptah_get_diagnostics` was attempted after edits but timed out while its TypeScript check was still running; the passing project typecheck supplies the final type result.

## Decisions

- **Same-target overlap:** join the in-flight promise, rather than return false. This gives every caller the actual outcome and prevents a second query or abort. It is reversible and requires no new API.

## Limitations

- The host did not expose a skill-loading tool for `angular-frontend-patterns`; repository guidance and the existing service pattern were followed.
