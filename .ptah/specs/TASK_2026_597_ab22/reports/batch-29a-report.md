# Backend implementation: `TASK_2026_597_ab22`, sub-batch 29a (Task 29.1 rescoped, Task 29.2, R-W2, R-W4)

**Tasks completed**: 29.1 (`SessionBudgetState.rotation`), 29.2 (`SessionRotationAdvisor` plus its wiring into `SessionBudgetService`), the R-W2 check, and the R-W4 spec note.

## Files

- MODIFIED `libs/shared/src/lib/types/session-budget.types.ts`: adds `SessionBudgetRotation { readonly contextTokens: number; readonly threshold: number }` and the optional field `SessionBudgetState.rotation?: SessionBudgetRotation`. No message constant and no `seedPrompt` were added.
- MODIFIED `libs/shared/src/lib/types/session-budget.types.spec.ts`: 2 cases. A state without the field is complete, and the field keeps exactly its two keys through a JSON round trip.
- CREATED `libs/backend/agent-sdk/src/lib/helpers/compaction/session-rotation-advisor.ts`: `SessionRotationAdvisor`, marked `@injectable`. Its constructor takes:
  - `@inject(TOKENS.LOGGER)`
  - `@inject(SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER)`
  - `@inject(SDK_TOKENS.SDK_CONTEXT_USAGE_PORT, { isOptional: true })`

  Methods:
  - `evaluate(sessionId, fallbackContextTokens)` reads the port's `getLast(sessionId)?.totalTokens`, else the fallback, and compares it with `getConfig().rotationSuggestTokens`.
    - At or above the threshold: the advisory is raised, with one INFO line per upward crossing. While the context stays above, the advisory keeps the latest `contextTokens`.
    - Below the threshold: the advisory clears and re-arms.
    - With no finite figure, the previous answer stands.
  - `current(sessionId)` is a read-only lookup.
  - `release(sessionId)` drops the session's entry.

  When no port is registered, the advisor gives no advisory and writes one INFO line in the constructor.
- CREATED `libs/backend/agent-sdk/src/lib/helpers/compaction/session-rotation-advisor.spec.ts`: 8 cases:
  - below the threshold
  - fires once per crossing
  - re-arm, then a second crossing
  - the port wins over the fallback
  - no figure keeps the previous answer
  - the threshold is read live
  - sessions are kept apart / `release`
  - port absent: no advisory, exactly one log line

  The R-W4 note is in the file header.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts`:
  - New constructor parameter `@inject(SessionRotationAdvisor) rotationAdvisor` (type `SessionBudgetRotationAdvisor = Pick<…,'evaluate'|'current'|'release'>`).
  - `acceptOrThrow` calls `evaluate(snapshot.sessionId, snapshot.contextSnapshot?.contextTokens)` on the disabled path and on every accepted enabled snapshot.
  - `composeState` and `disabledState` both attach `rotation` from `current()`.
  - `release` and `clearAll` also release the advisor's entries.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.spec.ts`: the harness builds a real advisor with a fake port and config. There is a new describe block with 7 cases:
  - attached at or above the threshold
  - snapshot fallback
  - cleared after compaction, then raised again
  - the disabled-budget path
  - carried on action results
  - dropped on `release`
  - R-W2: `preview-handoff` with the budget disabled

  It also carries an R-W4 comment.

## Design choice (to note for 31)

The advisory is a level, not a one-shot event. It is raised once per crossing: one log line, and a new crossing only after a re-arm. It stays on every published state until the context drops below the threshold. A one-shot field would be lost, because `composeState` runs for many reasons: `previous` in `applyEvaluation`, `canSend`, `act`. The banner would then flicker off on the next result. The 31 per-crossing dismissal (`sessionId + threshold`) works on top of this. One thing to know: if the user dismisses, and later the context drops and crosses the same threshold again, the key is the same. If 31 wants that case to show the banner again, it must clear its dismissal when `rotation` disappears.

## R-W2 result

`previewHandoff` (`session-budget.service.ts:~690`) does **not** refuse when there is no figure or no entry. It returns the kept copy, or else builds one through `buildHandoff`, with no budget embedded when the figure is null. `act` does not check `enabled`. The RPC handler (`rpc-handlers/.../session-budget-rpc.handlers.ts:59-65`) refuses only on invalid params or a missing service. No code change was needed. The behaviour is pinned by the spec "R-W2: preview-handoff works with the budget disabled for a session with a live stats entry".

## Stack observed

- tsyringe. The `@injectable` + `@inject(TOKENS.LOGGER)` + `@inject(SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER)` shape follows `compaction/tool-output-capper.ts:84-92`.
- Optional injection uses `{ isOptional: true }`, following `rpc-handlers/.../session-budget-rpc.handlers.ts:52`.
- Port API: `getLast(sessionId)` (`context-usage.port.ts:112`, report 26b).
- Threshold: `CompactionConfig.rotationSuggestTokens` (`compaction-config-provider.ts:50,132`).
- Fallback: `SessionStatsEntry.contextSnapshot.contextTokens` (`rpc-session.types.ts:426-432`).

## Verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts session-rotation-advisor session-budget.service`: 2 suites, 59 tests passed.
- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/shared @ptah-extension/agent-sdk --parallel=2`: exit 0, "Successfully ran targets test, lint, typecheck for 2 projects". This included 27a's in-progress files as they were on disk. No flakes.
- Typecheck of the affected set for `libs/shared/src/lib/types/session-budget.types.ts`, excluding `api-*`, `ptah-license-server` and `ptah-landing-page-e2e`: 67 projects selected, exit 0, "Successfully ran target typecheck for 63 projects". The other 4 have no typecheck target.
- `npx nx run di-lint:lint`: exit 0.
- `npx nx run degradation-audit:lint`: exit 0. Agent-sdk is at `4 ok (baseline 4)` and shared at `3 ok (baseline 3)`. The advisor adds no catch.
- `*.png`: none rewritten (`git status`).

## Plan deviations

1. A named `SessionBudgetRotation` interface was added for the field. Its shape is exactly the requested `{ readonly contextTokens; readonly threshold }`, so the advisor and the frontend have one name to share.
2. **Note for 29b:** `SessionBudgetService` injects `@inject(SessionRotationAdvisor)` by class, like `SessionHandoffBuilder`. So no token in `di/tokens.ts` is needed, and 29b only needs `container.registerSingleton(SessionRotationAdvisor)` before the `SDK_SESSION_BUDGET` registration (`register.ts:686`). The optional port parameter is decorated with `@inject(token, {isOptional:true})`, so no factory is needed. Until 29b lands, tsyringe auto-builds the advisor as an unregistered `@injectable` class. It is transient, but the budget service is a singleton, so in practice there is only one instance.
3. The port's own session-end registry release and the advisor's `release` are separate. The advisor is released through `SessionBudgetService.release`/`clearAll`. Neither registry is touched.

## Out-of-scope observations

- The advisor runs only when the budget observes a snapshot (result-stats path). A compaction that lowers the context shows up in `rotation` with the next result, not at the compaction itself. This follows R-W4, which is accepted.
- `CompactionConfigProvider.getConfig()` writes a debug line on every call. The advisor calls it once for each accepted snapshot whose context figure is known. This is not a problem, just noted.
