# Backend implementation — `TASK_2026_597_ab22`, sub-batch 27b (Task 27.2, executor + events part)

**Tasks completed**: 27.2 executor wiring (register under the real SDK id, feed `status:'compacting'` / `compact_boundary`, one port call per turn end, release on session end, fail-open) and events wiring (`compactionStateChanged` at INFO).

## Files

- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`
  - New exported type `CompactionCoordinatorSink`: a `Pick` of the coordinator methods the executor drives.
  - New private class `CompactionSessionTap`, one per query run:
    - **Keying.** The tap reads the real SDK session id from the `session_id` of main-loop messages (`init` first). This is the id the 27a hooks forward, and the id `endSession` passes to the session-end registry (`session-control.service.ts:235,310`, `rec.realSessionId ?? rec.tabId`).
    - **Registration.** It registers once per id with `{codexProxy: rec.capacityRoute?.providerId === 'openai-codex', e2Passed: null}`. Every session is therefore OBSERVE_ONLY today, and the state is logged at INFO. When the PostCompact hook has already moved the record to the new id, the tap only follows and does not re-register. Earlier ids stay tracked until release, so a late rebind still finds its source.
    - **Feeding.** `status:'compacting'` goes to `onStatusCompacting`. `compact_boundary` goes to `onCompactBoundary(id, {preTokens: pre_tokens, postTokens: post_tokens})`. Subagent messages (`parent_tool_use_id`) are skipped.
    - **Turn end.** A main-loop `result` calls `coordinator.onTurnEnd`, then calls `port.readAtTurnEnd(realId, '<rec.token>:<n>', sdkQuery)` once. The token in the turn id means a resumed run never hits a cached turn from an earlier run. A reading feeds `onContextUsage`.
    - **Release.** Registered on the run's `abortController` `abort`; `endSession`, dispose-all and the init-failure rollback all abort. It unregisters every tracked id from the coordinator and calls `port.release(id)`. It is idempotent through a `released` flag, and nothing is fed after it.
    - **Fail-open.** Each coordinator call, each port call and the whole message handler are guarded. A failure writes one `warn` line, `'[SessionLifecycle] … ; the turn continues'` `{event, sessionId, error: <error name>}`, and nothing is rethrown.
  - New private class `CompactionObservingWatchdog extends NoActivityWatchdog`. It overrides `observe` to call `super.observe(message)` and then `tap.observe(message)`. The run's watchdog is now this subclass, which is still assignable to `ExecuteQueryResult.activityWatchdog`.
  - Two optional trailing constructor params: `compactionCoordinator`, `contextUsagePort` (default `null`).
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts`: `makeHarness` takes an optional `{coordinator, port, logger}`. A new describe has 8 cases:
  - registration under the real id, not the tab id, registered once, OBSERVE_ONLY;
  - a Codex route is classed `codexProxy: true`;
  - status and boundary are fed (TRIGGERED → COMPACTING → COOLDOWN with pre/post);
  - subagent messages are ignored;
  - one port call per turn end, keyed on the real id with the query; the reading ARMs the coordinator; distinct turn ids;
  - release on session end is idempotent, and nothing is fed after it;
  - fail-open: a throwing coordinator and a rejecting port give exactly 5 warn lines, no error, and no throw;
  - no coordinator or port: no-op.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-events.service.ts`:
  - New `SdkAdapterCompactionStateChangedEvent` (`CompactionStateChange` + `timestamp`).
  - New event-map entry, `emitCompactionStateChanged` and `onCompactionStateChanged`.
  - `emitCompactionStateChanged` follows the `:131-137` pattern: an INFO line `'[SdkAdapterEvents] Compaction state changed'` `{sessionId, from, to, trigger, preTokens, postTokens}`, then `safeEmit`.
  - The constructor takes an optional `@inject(SDK_TOKENS.SDK_COMPACTION_COORDINATOR, {isOptional:true})` and subscribes to it. Both are container singletons, and `CompactionCoordinator.dispose()` drops the subscription.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-events.service.spec.ts`: a new describe with 5 cases, using a real coordinator:
  - INFO log for IDLE→TRIGGERED and TRIGGERED→COOLDOWN with pre/post;
  - subscribers receive the event with a timestamp;
  - an OBSERVE_ONLY session logs nothing;
  - a throwing listener does not stop the log or the transition (one warn);
  - construction works without a coordinator.
- MODIFIED, **outside the 4 listed files** (see Deviation 1): `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`. It adds two optional injections (`SDK_COMPACTION_COORDINATOR`, `SDK_CONTEXT_USAGE_PORT`, `isOptional: true`) and passes them to `new SessionQueryExecutor(...)`. That is 13 lines.

No 29a file (`session-budget/*`, `compaction/session-rotation-advisor*`, `session-budget.types*`) was touched.

## Stack observed

- tsyringe with optional `@inject(..., {isOptional:true})` collaborators, the facade pattern (`session-lifecycle-manager.ts` constructor).
- The executor is a plain class built by the facade (`session-lifecycle-manager.ts:394`).
- The coordinator token is registered with `instanceCachingFactory` (`di/register.ts:433`). `SdkAdapterEvents` is a Singleton (`di/register.ts:357-361`).
- Messages reach the run only through `activityWatchdog.observe(sdkMessage)` in `stream-transformer.ts:423`.
- Coordinator API: `compaction-coordinator.ts`. Listener payload type: `compaction-state.types.ts`. Port API: `context-usage.port.ts:52-66`.

## Verification

- Focused specs:
  - `npx jest -c libs/backend/agent-sdk/jest.config.ts session-query-executor.service`: 27 passed.
  - `… sdk-adapter-events.service`: 35 passed.
- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-sdk --parallel=2`: exit 0, "Successfully ran targets test, lint, typecheck". No flakes.
- Importer typecheck, the affected set for `libs/backend/agent-sdk/src/index.ts` minus `api-*`, `ptah-license-server` and `ptah-landing-page-e2e`: exit 0, 18 typecheck tasks.
- `npx nx run di-lint:lint --skip-nx-cache`: exit 0.
- `npx nx run degradation-audit:lint --skip-nx-cache`: exit 0, `libs/backend/agent-sdk: 4 ok (baseline 4)`. Every new catch logs one warn line, and none returns a sentinel.
- `*.png`: none rewritten, per `git status`.

## Plan deviations

1. **Facade edited (`session-lifecycle-manager.ts`).**
   - Why: the executor is not in the container. Its collaborators come only through the facade's `new SessionQueryExecutor(...)`. Without passing the coordinator and the port there, the executor wiring would be dead in production.
   - Scope: the change is additive and optional. 26b edited the same file for the same reason.
2. **The message tap goes through a watchdog subclass.**
   - Why: the executor never sees stream messages itself. `StreamTransformer` (not in this batch) consumes the query and calls only `activityWatchdog.observe`. Subclassing the run's watchdog inside the executor file was the only seam within the assigned files, and it adds no new parameter to the transformer.
   - Alternative: an explicit `onMessage` option on `StreamTransformer`, if the reviewer prefers that.
3. **Turn end is taken from the main-loop `result` message** on the same tap, not from `registry.markTurnEnded`. That registry call lives in `session-control.service.ts` and gives the executor no callback.
4. **Session end is the run's `abort` signal**, which every end path triggers. This is in addition to the port's own session-end registry release from 26b. A double release is harmless.

## Out-of-scope observations

- `e2Passed` is hard-coded to `null`, because no source of E2 results exists yet. Once one does, it is the single place to change, in the executor's `CompactionSessionTap` construction.
- Nothing calls `coordinator.shouldInitiateCompact` or `requestManualCompact` yet. The act path (streamed `/compact`) is not part of 27b.
