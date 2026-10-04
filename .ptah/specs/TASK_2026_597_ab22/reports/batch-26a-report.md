# Backend implementation — `TASK_2026_597_ab22`, sub-batch 26a (Task 26.1)

**Tasks completed**: 26.1 (state types and coordinator).

## Files

- CREATED `libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-state.types.ts`: `CompactionState` (a const object plus a union of IDLE, ARMED, TRIGGERED, COMPACTING, COOLDOWN, BACKOFF and OBSERVE_ONLY), `COMPACTION_MAX_DWELL_MS = 180_000`, `COMPACTION_ARM_RATIO = 0.8`, `COMPACTION_ALREADY_RUNNING_MESSAGE = 'compaction already running'`, `CompactionTransitionTrigger`, `CompactionSessionClass {codexProxy, e2Passed: boolean|null}`, `CompactionStateChange {sessionId, from, to, trigger, preTokens?, postTokens?}`, `CompactionTimers` seam, `ManualCompactDecision`.
- CREATED `libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.ts`: `CompactionCoordinator`, a pure class with no tsyringe decorator and no DI token. The constructor is `(timers?: CompactionTimers)`. When no timers are passed it uses Node timers, `unref`'d. Constructor `length` is 0, so 26b can register it with `useClass` or `useFactory`.
- CREATED `libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.spec.ts`: 32 cases.

No other file was touched. No `di/tokens.ts`, `di/register.ts`, `index.ts`, post-tool-use or app DI file was edited.

## API (for 26b, 27a and 27b)

- `register(sessionId, sessionClass)` returns IDLE only when `!codexProxy && e2Passed === true`. Otherwise it returns OBSERVE_ONLY, which is the default class today because `e2Passed` is null. `unregister`, `getState`, `subscribe(listener) → unsubscribe`.
- Event inputs, each returning `true` when a transition happened (an out-of-order event is ignored and returns `false`):
  - `onContextUsage(id, {totalTokens, maxTokens})`: IDLE→ARMED at ≥80%.
  - `onPreCompact(id, 'auto'|'manual')`: IDLE/ARMED→TRIGGERED. Starts the dwell timer.
  - `onStatusCompacting`: TRIGGERED→COMPACTING.
  - `onCompactBoundary(id, {preTokens, postTokens?})`: →COOLDOWN, with pre/post tokens.
  - `onTurnEnd`: COOLDOWN/BACKOFF→IDLE.
  - Dwell timeout: TRIGGERED/COMPACTING→BACKOFF (`'dwell-timeout'`).
- `onPostCompact(id, postCompactSessionId)` rebinds when the id differs. It moves the record and its open dwell timer, and replaces any record already held under the new id.
- `requestManualCompact(id)` returns `{action:'deduped', message:'compaction already running'}` while TRIGGERED or COMPACTING, and `{action:'send'}` otherwise.
- `shouldInitiateCompact(id)` is true when ARMED. The caller sends the compact over the streamed `/compact` path. The coordinator never talks to the SDK.
- In OBSERVE_ONLY the coordinator never transitions, never initiates and never dedupes.
- The state-change callback `(sessionId, from, to, trigger, preTokens?, postTokens?)` is emitted after the state is committed. If a subscriber throws, the error is rethrown on a microtask, so the transition and the other subscribers are not affected.
- `dispose()` is synchronous and idempotent. It clears every timer, session and subscriber, and every call after it is a no-op.

## Stack observed

- TypeScript with tsyringe. Sibling services are `@injectable()` with `@inject(TOKENS.LOGGER)`, for example `slash-command-interceptor.ts:22-41` and `compaction/tool-output-capper.ts:34-48`. The brief asked for no token yet, so the coordinator is an undecorated plain class and has no logger. The INFO log belongs to 27b's subscriber.
- `compaction-hook-handler.ts` was inspected with `ptah_ast_analyze` only: `createHooks(sessionId, cwd, onCompactionStart)`, `dispose()`, with PreCompact and PostCompact guards. It is not modified; 27a wires it.

## Verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts compaction-coordinator`: 1 suite, **32 passed**.
- `npx nx run-many -t lint,typecheck -p @ptah-extension/agent-sdk --parallel=2`: "Successfully ran targets lint, typecheck", exit 0. No lint output names the new files.
- `npx nx run di-lint:lint`: exit 0.
- `npx nx run degradation-audit:lint`: exit 0. The subscriber `catch` holds a statement (a microtask rethrow), so it is neither empty nor a sentinel return.
- Not run, as the brief allows: the full agent-sdk test target and the agent-sdk importer typecheck. Both are unnecessary because the three files are new and nothing imports them yet: no barrel export, no registration.
- `*.png`: none rewritten, according to `git status`.

## Plan deviations

1. **TRIGGERED → COOLDOWN on `compact_boundary`** is accepted in addition to the plan's COMPACTING → COOLDOWN. The boundary proves the compaction finished. Without this transition, a missed `status:'compacting'` message would leave the session open and the dwell timer would put it in BACKOFF by mistake. This adds a transition and removes none. Specced.
2. **The dwell timer runs from TRIGGERED entry** and spans COMPACTING, which bounds the total open time at 180 s. The plan's "TRIGGERED or COMPACTING → BACKOFF within `COMPACTION_MAX_DWELL_MS`" allows either reading. One timer per session was the simpler choice.
3. **OBSERVE_ONLY is set at `register` and is terminal.** No state-change event is emitted for it, because no real transition happens. 27b can log the value `register` returns.

## Out-of-scope observations

- Following the plan strictly, a PreCompact that arrives in COOLDOWN or BACKOFF is ignored, for example a manual `/compact` sent right after an auto-compact. In that case the coordinator does not track the second compaction. 27a or the reviewer should decide whether COOLDOWN/BACKOFF → TRIGGERED should be added.
- The plan's ARMED state has no way back to IDLE when the context drops without a compaction. Today this is harmless, because `shouldInitiateCompact` stays true until a PreCompact.
