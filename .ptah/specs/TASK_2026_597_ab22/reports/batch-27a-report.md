# Backend implementation — `TASK_2026_597_ab22`, sub-batch 27a (Task 27.1 + hook-handler part of Task 27.2)

**Tasks completed**: 27.1 (bounded watchdog dwell); 27.2 hook-handler part (PreCompact / PostCompact → coordinator, PostCompact `session_id` rebind, fail-open).

## Files

- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/no-activity-watchdog.ts`: the `compacting` boolean is replaced by `compactingSinceMs` (from `performance.now()`), which is set when a compaction opens and cleared when it closes. A re-announced compaction keeps its original start. `arm()` caps the delay at the dwell time left, `min(timeoutMs, remaining)`. When the timer fires and an open compaction has reached `COMPACTION_MAX_DWELL_MS` (imported from `compaction/compaction-state.types`), the watchdog does not report overdue or re-arm. It takes the normal `fired = true; onTimeout()` path. Tools are still not capped. The class doc and the `NO_ACTIVITY_TIMEOUT_MS` doc are updated.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/no-activity-watchdog.spec.ts`: new describe `compaction dwell bound (TASK_2026_597 A8)` with 6 cases:
  - overdue reports, then a timeout at exactly 180 s with no re-arm;
  - with the production window, a compaction open at 180 s times out without an overdue report;
  - root activity does not push the deadline past the bound;
  - a compaction closed before the bound restores the normal window, and the next compaction gets a fresh bound;
  - a re-announced compaction keeps its original start;
  - an outstanding tool is still uncapped.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.ts`:
  - New optional 6th constructor parameter `@inject(SDK_TOKENS.SDK_COMPACTION_COORDINATOR) compactionCoordinator?: CompactionCoordinator`, a type-only import.
  - New private `notifyCoordinator(event, fn)`. It is fail-open: on a throw it writes one `warn` line, `'[CompactionHookHandler] Compaction coordinator failed on hook event'` `{event, error}`.
  - PreCompact calls `onPreCompact(resolvedSessionId, trigger)` after the boundary-registry step, using the payload-first resolved id.
  - PostCompact calls `onPostCompact(postFallbackSessionId, payloadSessionId)` only when the payload carries a `session_id`. `postFallbackSessionId` is the id resolved at PreCompact, or else the closure id. The call happens whether or not `sdkAdapterEvents` is present.
  - Nothing else changed: the curator `callbackRegistry.notifyAll`, `capturedCallback`, the boundary registry and retry logic, attempt timing, and `emitCompactionComplete` are untouched.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.spec.ts`:
  - New describe `compaction coordinator wiring (TASK_2026_597 A8)` with 4 cases. It uses the real `CompactionCoordinator`, registered with `{codexProxy:false, e2Passed:true}`, plus a throwing stub. The cases:
    - PreCompact is forwarded and the state becomes TRIGGERED;
    - PostCompact rebinds REAL → NEW, and the emit is unchanged;
    - a PostCompact without a payload id does not rebind;
    - a throwing coordinator leaves both hooks returning `{continue:true}`, the callback and the emit still run, no `error` is logged, and exactly one warn is logged per hook.
  - The B8 case "216 s compaction … overdue-but-continuing at 180 s" was rewritten for the new bound (Deviation 1). The rewritten case: the timeout fires at 180 s, and the late PostCompact at 216 s still emits and logs `durationMs: 216000`, with no secrets in the logs.
- MODIFIED (outside the 4 listed files, see Deviation 2) `libs/backend/agent-sdk/src/lib/helpers/no-activity-watchdog.lifecycle.spec.ts`: the `%s compaction survives long silence` case (`WINDOW*20`, no timeout) now asserts the bounded behaviour. The compaction is accounted until its explicit `compact_result` terminal arrives within 180 s, then the normal window applies.

## Stack observed

- tsyringe. The handler is registered with `useClass` + Singleton at `di/register.ts:561`. The coordinator is registered with `instanceCachingFactory` under `SDK_COMPACTION_COORDINATOR` at `di/register.ts:433` (26b). The token is at `di/tokens.ts:73`. The optional `@inject` parameter follows the existing optional-collaborator pattern of the handler (`callbackRegistry`, `sdkAdapterEvents`, `boundaryRegistry`). No registration change was needed.
- The coordinator API comes from `compaction-coordinator.ts:150` (`onPreCompact`) and `:213` (`onPostCompact`, which no-ops on an equal, empty or untracked id). Both return a boolean and are not documented to throw. The try/catch covers the fail-open requirement.

## Verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts no-activity-watchdog compaction-hook-handler`: 3 suites, **53 passed**.
- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-sdk --parallel=2`: exit 0, "Successfully ran targets test, lint, typecheck". No flakes.
- Typecheck of the agent-sdk importers (the affected set for `libs/backend/agent-sdk/src/index.ts`, which contains no `api-*`, `ptah-license-server` or `ptah-landing-page-e2e`): exit 0, "Successfully ran target typecheck for 18 projects".
- `npx nx run di-lint:lint`: exit 0.
- `npx nx run degradation-audit:lint`: exit 0, `libs/backend/agent-sdk: 4 ok (baseline 4)`. No new finding.
- `*.png`: none rewritten, per `git status`.

## Plan deviations

1. **Risk: this reverses TASK_2026_411 B8.** The B8 spec header says upstream summarization was measured at **213-216 s**. Before this change, the watchdog deliberately reported a slow compaction as overdue and kept waiting. With `COMPACTION_MAX_DWELL_MS = 180_000`, as Task 27.1, the plan :1244 and the brief require, a real 213-216 s compaction now hits the watchdog timeout path at 180 s. The coordinator moves to BACKOFF at the same bound. I implemented the requirement as written and rewrote the B8 case to match.
   - **Orchestrator decision**: if 180 s is too tight, raise `COMPACTION_MAX_DWELL_MS` in `compaction/compaction-state.types.ts` (owned by 26a), for example to 240 s or more. The watchdog and the coordinator both follow the constant, so no other code changes.
   - At the production window, an open compaction is never reported as overdue any more, because the first deadline equals the dwell bound. With a shorter window, overdue reports continue until the bound.
2. **`no-activity-watchdog.lifecycle.spec.ts` was edited.** It is a second colocated watchdog spec, not in the listed 4 files, and it pinned the old uncapped behaviour (`WINDOW*20` with no timeout). It had to change with 27.1. Only the one case was edited.
3. **What the bound means.** When the bound is reached, the watchdog fires a timeout even if root tools are also outstanding, which is the literal "stops re-arming". Root tools do not run during a compaction, so in practice this does not apply.

## Out-of-scope observations

- **27b keying**: PreCompact forwards the payload-first resolved id (the real SDK `session_id`), and PostCompact rebinds from that id. For the coordinator to act, 27b must `register` the session under the real SDK session id, not the tab id. An unknown id is silently ignored, because `onPreCompact` returns `false`.
- 26a's open question still applies: a PreCompact that arrives in COOLDOWN or BACKOFF is ignored by the coordinator. The hook forwards it anyway.

## Orchestrator follow-up

- `COMPACTION_MAX_DWELL_MS` was raised from 180_000 to **300_000** in `compaction/compaction-state.types.ts`, and its JSDoc gives the reason (the 213-216 s measured in B8). This resolves Deviation 1.
- Specs updated:
  - `compaction-coordinator.spec.ts`: the dwell case now asserts 300 s.
  - `compaction-hook-handler.spec.ts`: the B8 case is restored, so a compaction still open at 216 s is reported overdue at 180 s, completes and emits with no timeout. A new case checks the timeout at 300 s.
  - `no-activity-watchdog.spec.ts`: overdue count 29; with the production window the watchdog reports overdue at 180 s and times out at 300 s; the activity and re-announce cases are keyed to the constant.
  - `no-activity-watchdog.lifecycle.spec.ts`: still valid unchanged, because the terminal arrives within the bound.
- Checks:
  - Focused specs (4 suites): 86 passed.
  - `nx run-many -t test,lint,typecheck -p @ptah-extension/agent-sdk`: exit 0.
  - `di-lint:lint`: exit 0.
  - `degradation-audit:lint`: exit 0, agent-sdk 4 ok (baseline 4).
  - No `*.png` rewritten.
  - No 29a files touched.
