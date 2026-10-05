# Batch 16 report: `PlanLimitsStore` and the Context rename (TASK_2026_596_0a19)

Executor: frontend-developer (Claude sub-agent). I ran no git commands. Nothing is staged.

## Files

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\core\src\lib\services\plan-limits.store.ts`: the root `PlanLimitsStore`.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\core\src\lib\services\plan-limits.store.spec.ts`: 20 cases.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\core\src\index.ts`: exports `PlanLimitsStore` and `PLAN_LIMITS_CLOCK_TICK_MS`. The barrel is 52 lines, within the 150-line limit.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\apps\ptah-extension-webview\src\app\app.config.ts`: adds the import and `{ provide: MESSAGE_HANDLERS, useExisting: PlanLimitsStore, multi: true }` after `BackOfficeActivityService`.
- VERIFIED, NOT EDITED `...\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.ts` and `.spec.ts`. These hold the Task 16.2 rename. The team-leader stages them with this batch.

I did not touch anything under `libs/backend/**`, any settings path, `stats-bar.utils.ts` or `agent-monitor.store.ts`.

## Task 16.1: `PlanLimitsStore`: COMPLETE

How the store follows the repository's patterns:
- It is `@Injectable({ providedIn: 'root' })`, uses `inject()` and signals, and implements `MessageHandler`, with `handledMessageTypes = [MESSAGE_TYPES.PLAN_LIMITS_CHANGED]`.
- It follows the same shape as `back-office-activity.service.ts` (root handler, single interval, `DestroyRef`).
- Its only transport is `ClaudeRpcService.call('provider:getPlanLimits', …)`, typed through `RpcMethodRegistry`. The method is registered at `libs/shared/src/lib/types/rpc.types.ts:1137`. Its params are `ProviderGetPlanLimitsParams` (`rpc-providers.types.ts:215-224`), and the result and push payload are `PlanLimitsSnapshot` (`plan-limit.types.ts:170`).
- There is no zod. Push and RPC data are checked by a structural guard, `isPlanLimitsSnapshot`, which is private to the file.

Public API:
- Signals: `snapshot()` (`null` before the first data), `loading()` and `now()`.
- Methods: `ownerByKey(key)`, backed by a computed `Map`; `sessionOwner(sessionId)`, which uses an own-property check; and `load(params)`.

Plan requirements and the evidence for each:
- **Generation guard.** Every `load` increments `loadGeneration`. A stale response is dropped, and `loading` clears only for the newest load, the same as `provider-account-state.service.ts:27-43`. Specs: "drops a response that a newer load superseded" and "stays loading until the newest load settles".
- **`load` accepts `ownerKeys`.** It accepts the whole `ProviderGetPlanLimitsParams`: `providerId`, `sessionIds`, `ownerKeys` and `refresh`. Spec: the first `load` case.
- **One 30 s interval.** It starts on the first `load`, never in the constructor, and repeated loads do not add timers. It is cleared through `DestroyRef.onDestroy`. Specs:
  - "does not tick before the first load" (`getTimerCount() === 0`)
  - "starts ONE 30 s interval…" (`getTimerCount() === 1` after 3 loads)
  - "clears the interval when the injector is destroyed" (0 after `TestBed.resetTestingModule()`)
- **RPC failure gives an empty snapshot.** This covers an error result, a thrown call and a malformed result. Each sets `{generatedAt, owners: [], sessionOwners: {}}`, so surfaces show "Usage / Unavailable" and never 0. Three specs cover this.
  - A thrown call logs only `error.name`, never the message. This follows the F71 posture.
- **A malformed push is ignored and logged.** The last good snapshot is kept. A parametrised spec covers 5 shapes: `null`, missing owners, an owner without a key, a window without `observedAt`, and a session owner with a numeric key.
- **A push replaces the snapshot.** Spec: "replaces the snapshot with the pushed one".

Two behaviours I added beyond the plan's text (both are in the store's doc comment):
1. **Monotonic `generatedAt`.** A snapshot older than the one held is not applied. Without this, a slow pull could overwrite a newer push that arrived while it was in flight. Spec: "keeps a newer push when a slower pull returns an older snapshot".
2. **Retained request scope.** Each `load` replaces only the fields it names (`providerId`, `sessionIds`, `ownerKeys`). `refresh` is never retained.
   - The reason: the chat view (Batch 20, `{sessionIds, ownerKeys}`) and the dashboard (Batch 21, `{providerId}`) share this one snapshot, and the host's push repeats the last request's scope (Batch 15, accepted deviation 2).
   - Without this, a dashboard load would drop the chat session's `sessionOwners` entry until the next chat load.
   - Spec: "keeps the scope of earlier loads and sends refresh only when asked".
   - If the team-leader prefers the literal per-call scope, the change is to remove `scope` and `definedFields`.

`now()` is also set to `Date.now()` whenever a snapshot is applied, so "resets in …" text is fresh right after a read.

## Task 16.2: the "Context" rename: VERIFIED, no edit

`git diff` of the two files shows exactly:
- the stats-strip label `Main context` → `Context` (`session-stats-summary.component.ts:86`)
- the stats-card label `Main context` → `Context` (`:243`)
- tooltip line 1, `Main context unknown: …` → `Context unknown: …` (`:821`)
- tooltip line 2, `Main context used (latest main request): …` → `Context used (latest main request): …` (`:824`)
- spec `:175-176`, which now asserts `toContain('Context')` and `not.toContain('Main context')`

A grep for `Main context` in `libs/frontend/chat-ui/src/lib/molecules/session` finds only the negative assertion in the spec. The spec passes 11/11 (output below).

## Carry-forwards

- **Time zone and `zoneNameLocale` passed explicitly (Batches 18-21).** Not applicable here. The store formats no text: it exposes raw epoch-ms instants and the `now()` clock, and leaves `LocalTimeOptions` to the view model.
- **`model-scope-unknown` and `estimated-limit` are informational, never warnings.** Not applicable. The store produces no reason wording and no severity.
- **Unknown is never shown as 0.** The store never fabricates a value. An absent `used` stays absent (spec: "preserves an unknown used value as absent, never 0"), and a failed read gives an empty owner list rather than zeroed windows.
- **R5 hotspots.** I did not touch `agent-monitor.store.ts`, `stats-bar.utils.ts` or `session-stats-summary.component.ts` (verified only).
- **Boundaries.** core → shared only. No orchestrator imports, no zod, and no settings paths.

## Verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core @ptah-extension/chat-ui ptah-extension-webview`
  - Result: "Successfully ran targets typecheck, test, lint for 3 projects", 9/9 tasks, 0 cache hits.
  - The Nx Cloud 401 notice in the output is about the plan and is unrelated.
- `npx jest -c libs/frontend/core/jest.config.ts plan-limits.store`: 1 suite, 20/20 passed.
- `npx jest -c libs/frontend/chat-ui/jest.config.ts session-stats-summary.component`: 1 suite, 11/11 passed.

## Out-of-scope observations

- The Batch 15 broadcaster pushes the last request's scope (the host keeps one scope). The store's retained scope keeps chat and dashboard requests from undoing each other's scope. But if two webviews (panel and sidebar) issue different scopes, the host still pushes whichever asked last. That is a host-side design point; I made no change for it.
