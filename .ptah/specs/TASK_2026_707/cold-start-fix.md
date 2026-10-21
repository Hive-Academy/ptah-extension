# Analytics cold-start fix

## Root cause

On the fresh pre-fix launch, `cold-host-out.log` records `source timed out` for `detection`, `cli-store`, and `lane`, followed by a *successful* `provider:getPlanLimits` RPC. `cold-host-err.log` records two 12,004/12,007 ms plan-limit handlers. Detection continued afterward (`Antigravity detected`, then other CLIs). The dashboard therefore accepted a valid but incomplete two-owner roster. `plan-limit-owner-discovery.service.ts:212-245` gives detection a 12-second deadline and derives CLI-store/lane owners from its result; `plan-limits-snapshot.service.ts:149-158` returned that roster without indicating that discovery was incomplete; `plan-limits.store.ts:175-181` applied it and made no automatic follow-up request.

The earlier visual review recorded a Usage error, but its exact error was not captured there. In my pre-fix launch, `analytics:spendSummary` **succeeded** after 22,474 ms and Usage loaded. There was therefore no reproduced backend Usage exception to diagnose. The client timeout was 30 seconds (`claude-rpc.service.ts:135`), equal to the host's 30-second scan budget (`analytics-rpc.handlers.ts:33,84-85`), making a timeout during a slower startup plausible but unproven. Startup competition is visible in the same host log: CLI detection reused an in-flight promise, Git calls saturated the process gate, a workspace index rebuild ran, and event-loop lag reached 1,103 ms.

## Caused by v2?

**Yes for the incomplete roster.** `batch-v2-a-limits-roster.md` documents the new bounded detection phase and 12-second read reserve; the live log shows that deadline dropping all detection-dependent owners. The v2 Usage flow also has an equal client/host timeout budget, but the earlier Usage failure's precise cause cannot be established from available logs. I did not compare `origin/main` directly because this lane's role forbids running git.

## Fix

- `plan-limit-owner-discovery.service.ts:194,283-285` marks a roster when detection missed its deadline; the in-flight detector remains available to a later request.
- `plan-limits-snapshot.service.ts:154-158` and `plan-limit.types.ts:236-241` carry the marker to the client.
- `plan-limits.store.ts:107-122,169-196,333-345` applies the first roster immediately, then makes up to three automatic follow-up pulls at one-second intervals until discovery completes. The timer is cleared on a new load or store destruction; newer requests still win through the existing generation guard.
- `analytics-usage.store.ts:122-127` gives this RPC a 40-second client timeout, leaving ten seconds beyond the host's bounded 30-second scan for startup scheduling and transport. The global RPC timeout is unchanged.

## Specs + Jest results

- Discovery spec checks the incomplete marker on a hung detector and a complete marker after successful detection: **36/36 passed** (`cold-jest-cli.log`).
- Snapshot service spec checks propagation to the RPC payload: **13/13 passed** (`cold-jest-rpc.log`).
- Store spec checks automatic recovery without a manual refresh: **35/35 passed** (`cold-jest-core.log`).
- `nx build-dev ptah-electron --parallel=1` and `nx copy-renderer-dev ptah-electron --parallel=1` succeeded after edits (`cold-fixed-build.log`, `cold-fixed-copy.log`). Scoped `ptah_get_diagnostics` was unavailable because its TypeScript check exceeded 45 seconds twice; the builds and focused Jest runs completed.

## Cold-start measurement before/after

| State | First cells | All six cells | Usage |
| --- | ---: | ---: | --- |
| Pre-fix visual review, two launches | 40.5 s | Never by 105.8 s; manual Refresh took another 24.3 s | Error; manual Retry required |
| Fixed fresh Electron launch, CDP sampling | 33.4 s | 52.4 s, automatic | Loaded at 40.8 s, automatic |

The second fixed launch's `cold-fixed-cdp-2.log` has the measurements; `cold-fixed-host-out-2.log` records two detection timeouts, then a later successful plan-limit RPC as detection completed. Its Usage RPC succeeded in 20,104 ms (`cold-fixed-host-err-2.log`). The screenshot is `visual/v2r3/cold-fixed-dark.png`; it shows all six owner tiles. The Usage panel was below the screenshot viewport, while CDP body text confirmed its loaded state. The recorded Electron PID trees (35032, 19020, 39216) were stopped by ID.

## Decisions

| Decision | Alternatives and evidence | Reversible |
| --- | --- | --- |
| Signal incomplete discovery and retry a bounded number of times | Raising the 24-second snapshot budget would collide with the 30-second client timeout. Retrying only when detection was cut preserves normal request volume. The cold logs prove the omitted owners came from that source. | Yes |
| Keep the first partial roster visible | Waiting for cold detection would leave no cells for tens of seconds. The first response already has readable Claude and Ollama owners. | Yes |
| Give only Usage a 40-second client timeout | The host already bounds its scan at 30 seconds and may return a partial summary at that boundary. A global timeout change would affect unrelated RPCs. The previous Usage error's exact cause remains unproven. | Yes |

## Not done

- No direct `origin/main` comparison: the backend-developer lane prohibits git commands.
- No deterministic reproduction of the earlier Usage error; the pre-fix and fixed launches both returned Usage successfully.
- Temporary CDP `.mjs` scripts, PID files and the start-time file remain in this task folder because the execution policy rejected the cleanup command. Build, host, Jest and CDP logs remain as measurement evidence.
