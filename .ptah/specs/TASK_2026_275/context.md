# TASK_2026_275 — split external-marketplaces.component

Raised by the code-style review of TASK_2026_270 (commit `9334758c5`).

## What is already right

The child components are genuinely thin and presentational —
`external-consent-dialog`, `external-plugin-row`, `external-installed-row` all
rate themselves Level 1 and earn it. The problem is only the parent.

## Suggested shape

An injectable `ExternalMarketplaceStore` owning the RPC calls and the signals
(marketplaces, suggestions, installed, listings, pendingPlan, pendingReason,
per-key inflight sets), with the component reduced to rendering and event
forwarding. Mirrors the `ChatStore` facade pattern this repo already uses.

## Do not regress

The two-call consent protocol is a security property with e2e coverage:
`apps/ptah-electron-e2e/src/specs/marketplace/external-marketplace.spec.ts`
(7 tests) plus `external-marketplaces.component.spec.ts`. Both must pass
**unedited** across the refactor — if the split forces a test edit, the split
changed behaviour, and that is the finding rather than the test.

Specifically preserve: the first install call carries no `consentToken` and
writes nothing; the dialog renders MCP command lines verbatim; a confirm answered
`consent-required` re-renders the new plan without claiming upstream changed
(`approval-expired` also covers a lapsed TTL and a host restart); cancel issues
no second call.

## Related watch-item, deliberately not its own task

`PluginRpcHandlers` is at 8 constructor params, exactly the repo's stated
over-injection threshold. It grew by 2 in TASK_2026_270. Nothing to do yet — but
the NEXT namespace added to that handler should trigger a split rather than a
ninth param.
