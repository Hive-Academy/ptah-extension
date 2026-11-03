# Batch A follow-up

## Result

The core released-background compaction defect remains open. I did not change the release/timer contract because the existing agent-sdk resume API can return a dead query, and the working resume path crosses into RPC session preparation and stream broadcasting. Sending `/compact` after release without that integration would risk queuing it into a dead input channel.

## Release evidence

- `stream-transformer.ts:1211-1235` invokes `beforeLiveStatsDispose` and `onStreamEnd` in the stream iterator's `finally`, covering natural stream completion, error, abort, and consumer close. `session-query-executor.service.ts:1895-1897` calls `compactionTap.release('stream-end')` from both callbacks. `release()` emits `session-released` at line 454. The idle reducer clears the pending attempt at `idle-session.reducer.ts:407-413`; `idle-compaction.service.ts:98-102,498-500` also closes its group.
- A normal turn result alone does not call the stream `finally`; the stream input remains open for later messages. I found no tab-switch handler in this release chain. Thus switching tabs alone is not proven to release a query. A background tab whose stream was ended by any teardown path is affected.
- The registry idle sweep (`session-registry.service.ts:676-697`) evicts only records where `query === null`. It does not cause this release for a live query. A real close uses `SessionControl.endSession()` and deregisters the record.
- `SessionRegistry.setSessionQuery()` stores the query at `session-registry.service.ts:505-517`; stream teardown does not clear it. `SdkAgentAdapter.resumeSession()` at `sdk-agent-adapter.ts:1337-1390` returns the existing query when `existingSession.query` is set, including after the stream iterator ended. This is not a safe resume for idle compaction.
- The app's working resume path is `chat-session.service.ts:2400-2460`: it prepares workspace and provider configuration, calls `sdkAdapter.resumeSession`, and passes the returned iterable to `streamBroadcaster.streamEventsToWebview`. The owned idle service has none of those dependencies or a known open-tab lifetime. Directly calling `sendIdleCompact()` only performs `SessionStreamPump.sendMessage()` with `require-idle`, which checks the record but cannot prove an input consumer still exists.

## Required design to finish

Add an explicit query-terminal state to the registry when the stream iterator ends, fenced by record/run token so an old stream cannot clear a replacement. Expose a background resume operation through the existing RPC session preparation and broadcaster path, with a persisted/open-tab check and cancellation on close, activity, or resume failure. Keep the idle attempt across query release, fire at 0.9 of the cache TTL, then resume and send through a newly live input consumer. Test released-background resume, closed session, failed resume, and live query. This crosses the assigned `agent-sdk` scope; I stopped before an unsafe partial lifecycle change.

## Files changed

- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget-config.provider.ts`: unreadable-store fallback now retains the injected development token limit.
- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget-config.provider.spec.ts`: readable and unreadable store tests with a development limit.
- `libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.spec.ts`: development idle minimum consumer test.
- `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.helpers.ts`: structured warnings include a bounded, sanitized error class name; no error message or setting values are logged.
- `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.ts`: catches pass causes to those warnings. The reducer catch emits one warning instead of duplicating it.
- `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.spec.ts`: injected 10-second TTL checks arm at 9 seconds, fire at 9 seconds, and skip after expiry.

## Verification

- Mandatory `npm run verify -- -p agent-sdk`: exit 1 before project checks. Nx failed to load default and Jest/ESLint plugins because child-process spawn returned `EPERM`.
- Direct Jest fallback for the three changed specs: 3 suites passed, 189 tests passed, 0 failed. The first run found one duplicate warning assertion failure; fixed and reran to green.
- `ptah_get_diagnostics` scoped to the changed files twice: unavailable; the TypeScript compiler check remained running after the tool's 45-second timeout. No typecheck pass is claimed.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Do not send after release until a live resume exists | Send into retained query; create a new query through the prepared resume path | Retained query can have a closed stream, and the idle sender only checks the record's admission state | Yes |
| Log bounded error class names | Full message; class name | Error messages may include prompts or settings; class names identify the failing dependency without those values | Yes |

## Not done

Released-background resume and its four lifecycle regression tests are not implemented. The existing short TTL test verifies a bound query only. The spawned session must decide whether to extend the scope to the RPC resume/broadcaster boundary and tab lifecycle before the core fix can be completed.
