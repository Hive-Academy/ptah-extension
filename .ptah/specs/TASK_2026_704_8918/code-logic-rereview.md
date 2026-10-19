# Code logic rereview — TASK_2026_704_8918

## Verdict

**APPROVED — 8/10.** No new blocking, serious, moderate, or minor findings in the scoped fix round. The earlier Serious finding is resolved: the handler starts its clock before listing, races the list against the remaining 8 seconds, and forwards only the time left to the production lookup (`lane-plan-limits-rpc.handlers.ts:108-111,128-138,156-180`; `lane-limit-lookup.service.ts:128-138,141-180`). This is a sound result rather than a 9–10 because no live renderer check was provided and the handler's bound on `limits()` relies on the lookup service honoring `deadlineMs`; a lower band would require a demonstrated remaining failure in the production path.

## Numbered findings

None in this rereview. The earlier Moderate finding about stale renderer timeout rows remains a recorded follow-up and is outside this round.

## Checks

1. **Slow or hung list and slow lookup:** `bounded()` sets the list timer from the entry clock and rejects at the remaining budget (`lane-plan-limits-rpc.handlers.ts:108-111,132,162-177`). The catch produces the fixed unavailable error (`:139-145,189-193`). After a successful list, `limits()` receives `max(8,000 - elapsed, 0)` (`:133-138`). The production namespace forwards the option (`agent-namespace.builder.ts:531-535`), and the lookup service races each lane read with that deadline, then returns one result per row (`lane-limit-lookup.service.ts:128-138,151-180,237-255`). Formatting occurs after lookup (`lane-plan-limits-rpc.handlers.ts:115-118,215-232`), using the 2-second renderer margin rather than an additional hard timer.
2. **Timer and losing rejection:** `bounded()` attaches a rejection handler to `step` before the race and `Promise.race` also observes it (`lane-plan-limits-rpc.handlers.ts:161,168-177`). Its `finally` clears the budget timer on either result (`:178-180`). The spec checks zero outstanding fake timers after each deadline test (`lane-plan-limits-rpc.deadline.spec.ts:210-220`); it does not inject a late rejection, so that point is established by code inspection.
3. **Zero remaining lookup time:** The forwarded value is floored at zero (`lane-plan-limits-rpc.handlers.ts:133-138`), and the lookup service uses nullish coalescing, so zero remains a real `setTimeout(0)` deadline and produces the normal timeout outcome and row shape (`lane-limit-lookup.service.ts:152-161,237-255`). A list still pending when the 8-second list timer fires takes the unavailable path. The specs do not directly pin the narrow case where listing wins but no time remains; the implementation is explicit.
4. **Shape and callers:** The handler still returns the same six result fields and five row cells (`lane-plan-limits-rpc.handlers.ts:215-243`). `AgentNamespace.limits` takes an optional second argument, and omitting it retains the lookup service's default deadline (`types.ts:330-333`; `agent-namespace.builder.ts:531-535`; `lane-limit-lookup.service.ts:155-160`).
5. **Spec value:** The new tests use a 6-second list followed by a deadline-honoring lookup and a never-settling list, advance fake time to 8 seconds, and assert partial rows or fixed unavailable text respectively (`lane-plan-limits-rpc.deadline.spec.ts:134-183,273-333`). They exercise the previously missed list boundary. The fix-round report records 34 passing scoped handler tests; I did not run checks under this lane's explicit prohibition (`fix-round-report.md`, Verification).

## Five logic questions

1. **Silent failure:** A slow lane becomes a successful response containing timeout/unknown rows (`lane-limit-lookup.service.ts:247-255`; `lane-plan-limits-rpc.handlers.ts:115-118,220-232`). This is the existing partial-result contract, with the renderer refresh issue already recorded separately.
2. **Unexpected user action:** Opening Plan Limits during a cold detection can now receive fixed unavailable text at 8 seconds if listing hangs, rather than a renderer RPC timeout at 10 seconds (`lane-plan-limits-rpc.handlers.ts:132,162-193`; `lane-plan-limits-rpc.deadline.spec.ts:310-333`).
3. **Wrong-answer data:** The scoped change introduces no new data conversion; counts and rows still derive from the lookup result (`lane-plan-limits-rpc.handlers.ts:215-250`). A malformed result fails into the fixed error during response building (`:112-118`).
4. **Dependency failure or timeout:** Rejected or hung listing is caught or timed out by `bounded()` (`lane-plan-limits-rpc.handlers.ts:130-140,156-180`). Slow production lane reads race their own deadlines (`lane-limit-lookup.service.ts:151-180`); an unexpected replacement implementation that ignores `deadlineMs` would remain outside the handler's timer, which is a contract dependency rather than an observed defect in the bound production path (`agent-namespace.builder.ts:531-535`).
5. **Unspecified requirement:** A 0-ms remainder has no direct regression test, although the explicit zero forwarding and nullish deadline handling establish its behavior (`lane-plan-limits-rpc.handlers.ts:133-138`; `lane-limit-lookup.service.ts:152-161`).

## Decisions and limits

- Review the explicitly named RPC fix despite this task folder's older NG0956 carrier (`task.md`; `fix-round-report.md`). The named files and fix-round report provide a concrete scope. Reversible.
- Treat the prior stale-row Moderate as a follow-up, as requested; it is neither re-raised nor counted in this verdict (`code-logic-review.md:19`; `fix-round-report.md`, Not done). Reversible.
- Source and tests were read; no source was edited, and no build, test, typecheck, lint, serve, e2e, or history-changing git command was run. The runtime timing claim remains based on code inspection and the implementer's reported scoped Jest result.
