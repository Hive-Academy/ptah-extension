# B16 lane report

## Files changed

- `libs/frontend/chat/src/lib/settings/pro-features/system-prompt-drawer.component.ts`: derives the running state and elapsed seconds from the host `regenerationStartedAt`, subscribes to shared second and coarse clocks while open, refreshes status on coarse ticks, and reconciles a cleared flag against `generatedAt`. Removed the local timeout inference and two-budget fallback.
- `libs/frontend/chat/src/lib/settings/pro-features/system-prompt-drawer.component.spec.ts`: covers running status on mount, coarse-tick success and failure, an absent field from an older host, and status refresh after a failed regenerate RPC. Updated prior expectations for the new host-owned flow.
- `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts`: replaces `_elapsedSeconds` and `probeTimer` with a probe start timestamp and `injectWallClock('second')`; clears the start on settlement and invalidation; cancels an active probe on destroy. Cancellation failures no longer use `console.error`.
- `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.spec.ts`: covers wall-clock elapsed time, destroy cancellation, invalidation clearing the start, and cancellation failure state.
- `libs/frontend/chat/src/lib/settings/providers/accounts/ambient-account-row.component.ts`: uses `injectWallClock('coarse')` instead of a row-owned interval.
- `libs/frontend/chat/src/lib/settings/providers/accounts/ambient-account-row.component.spec.ts`: asserts the age advances on one coarse tick and the clock is released on destroy.

## Lane check

Ran the required foreground command once:

```powershell
npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="system-prompt-drawer|provider-setup-wizard|ambient-account-row" | Select-Object -Last 60
```

The check exited 1. Terminal tail:

```text
NX   1 task: 0 succeeded, 1 failed
✖ nx run @ptah-extension/chat:test
  full log: C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\2779051641209755292
[verify 2026-10-30T20:12:09.385Z] lock slot 0 acquired after 110s: verify test (@ptah-extension/chat)
  Run duration:      12.4s
  Critical path:     12.3s (1 task)
[verify 2026-10-30T20:12:29.890Z] lock released after 20.5s, exit code 1
```

The detailed Jest log reported 4 suites, 100 tests: 97 passed and 3 failed. Failures were the drawer's immediate post-RPC assertion, the drawer's status-block assertion after a click, and the wizard's assumption that all Jest timers disappear on component destroy. I updated the first assertion to await the RPC continuation, made the second await `confirmRegenerate()` directly, and removed the global timer-count assertion while retaining the cancellation assertion. These edits occurred after the single permitted run, so their result is unverified.

## Decisions

- An absent or unparseable `regenerationStartedAt` is treated as no host-reported run; the host lock remains responsible for rejecting a duplicate on older hosts.
- A cleared host flag with a changed `generatedAt` emits `changed`; a cleared flag without a changed timestamp announces the fixed failure. An active flag keeps Regenerate disabled after RPC success, error, or timeout.
- Missing elapsed start data displays `—`; elapsed seconds are derived from wall-clock time and clamped at zero only when a start exists.
- `ENHANCED_PROMPTS_RUN_CEILING_MS` was not present in `libs/shared/src` during this lane. The drawer does not need that constant because the host flag controls its running state. The existing RPC timeout remains 120 seconds.

## Not done

- The post-fix tests were not rerun because the lane instructions permit one foreground lane check only.
- No rendered screenshot was taken: the lane forbids build, serve, dev, and e2e targets, and no running UI or in-workspace HTML artifact was supplied for the drawer. Visual quality was not inferred from source or tests.
- No typecheck or cross-host check was run under the lane's single-check restriction.
