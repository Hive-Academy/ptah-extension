# Code Logic Review - batch 10d.L5, revision 2

Score: 8/10. Verdict: APPROVED. Blocking 0, Serious 0, Moderate 3.

Scope: the uncommitted diff of `libs/backend/lane-outcomes/src/lib/di/start.ts` and `start.spec.ts`, the r2 report, `register.ts` (lane-outcomes and cli-agent-runtime), `callback-registry.base.ts`, and `sdk-adapter-events.service.ts` emit paths. No tests, lint, build or diagnostics were run, per the rules. The registration-order claims about Electron/VS Code/CLI bootstrap (`bootstrap.ts`, settings registrations) are taken from the report's citations; I did not re-read those files.

## 1. Recorder lifetime and state across calls: OK

- `lane-outcomes/di/register.ts:76-77` registers the recorder with `instanceCachingFactory`, so it is a singleton once a construction succeeds. Each callback calling `recorder()` gets the same instance, and state such as the `markSubagentBudgetStop` then `recordSubagentEnded` hand-off for one agent is kept.
- A construction that throws is not cached, so the next callback retries it. No half-built instance with partial state exists.
- Other resolvers of the recorder were already lazy: the notifier getter (`cli-agent-runtime/di/register.ts:309-312`) and the pipeline's row-inserted hook (`lane-outcomes/di/register.ts:69-72`). Nothing else resolves the recorder eagerly (grep over `LANE_OUTCOME_TOKENS.RECORDER` found only those two plus `start.ts`).

## 2. Resolve throwing inside a callback: caught and logged, event lost without retry

- Subagent stop and budget stop: `CallbackRegistryBase.register` wraps every subscriber in try/catch and logs `subscriber threw` with the Error (`callback-registry.base.ts:25-43`). This also covers a rejected promise.
- `subagentEnded`: `SdkAdapterEvents.emitSubagentEnded` goes through `safeEmit`, which wraps the emit in try/catch (`sdk-adapter-events.service.ts:272-290`), so the emitter does not crash.
- Cost: an event that arrives while the recorder cannot be built is dropped, with an error log per event and no queue or retry. The report's argument is that agents cannot spawn before settings registration, which is plausible but not enforced by code.
- Moderate: if the scope resolver never registers (no workspace source), every event logs an error and no outcome is written, but the app stays up. That is acceptable degradation, and each log carries the message because the registry passes a top-level Error to the logger.

## 3. Callbacks skipped by the old failure: yes, all now registered

- In the old code the recorder resolve sat at `start.ts:79-81`, outside the `try` that starts at the first `isRegistered` check. A throw there escaped `startLaneOutcomes`, so none of the three callbacks (subagent stop, budget stop, `subagentEnded`) were subscribed, and the drain stayed the no-op set by `startAndRegisterLaneOutcomes`. Subagent-path outcome rows were therefore never written in Electron, and the pipeline was never drained at shutdown.
- Now startup resolves only the pipeline (`start.ts:79-81`), then attaches all three callbacks and registers the bounded disposer, so those paths and the shutdown drain are restored. Native lane completion writes were unaffected, as that path uses the lazy notifier getter.

## 4. Is the phase-4 move (2d1c69dd2) still needed: not needed, now misleadingly commented

- The report's reason for keeping it is that "callback registries and SQLite storage are registered before startup". But the registries come from `registerSdkServices` (phase 2, before the old start position) and SQLite is registered at `phase-2-libraries.ts:~385`, also before the old start. So the move is harmless but not required.
- Moderate: the comment at `apps/ptah-electron/src/di/container.ts:46` says outcomes start after every phase "so eager recorder resolution sees the complete graph". The recorder is no longer resolved eagerly, so the comment is stale. The text-order assertion in `container.smoke.spec.ts` now guards a constraint that no longer matters. Reword the comment, or revert the move in a separate change.
- Other hosts: the report's notes are consistent with the fix. VS Code (`phase-2-libraries.ts:268`) and CLI (`container.ts:799`) start before their settings registration and would hit the same eager chain, which the lazy resolution now defers. The report words this as "could fail", which is appropriately hedged since no live run for those hosts exists.

## 5. Does the new spec fail on the old code: yes

- `start.spec.ts` (new test, "subscribes and drains before workspace scope is registered"): the recorder factory throws until the scope token is registered. With the old eager resolve, `startLaneOutcomes` throws, the warning `start failed` is logged, no listener is attached, and `expect(listener).toBeDefined()` fails. With the new code it asserts no recorder resolution at start, no warning, then one resolution on the first event, a recorded event, and a pipeline drain on dispose.
- The edited "start itself throws" spec now throws from the pipeline factory, which is the only eager resolution left, so it still covers the no-op drain path.
- Gaps (minor): no test covers a recorder throw during a callback (that path is swallowed by the registry, not by `start.ts`), and the stray `registeredDisposer(container);` call before the event has no effect.

## Other notes

- `start.ts` still logs message plus stack in all four catches (from r1), unchanged.
- Types: `recorder` is a typed `() => LaneOutcomeRecorder`; no `any` or cast added.

## Verdict

APPROVED, confidence MEDIUM-HIGH. Top risk: outcome events that arrive before workspace settings are registered are logged and lost, with no retry; the stale `container.ts:46` comment should be fixed.
