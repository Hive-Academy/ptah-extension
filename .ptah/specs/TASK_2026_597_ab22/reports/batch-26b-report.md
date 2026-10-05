# Backend implementation — `TASK_2026_597_ab22`, sub-batch 26b (Tasks 26.2 rescoped by D.3, 26.3)

**Tasks completed**: 26.2 (`IContextUsagePort` + `ContextUsagePort`) and 26.3 (tokens + registration).

## Files

- CREATED `libs/backend/agent-sdk/src/lib/helpers/compaction/context-usage.port.ts`: `IContextUsagePort`, `ContextUsagePort` (`@injectable`, singleton), `ContextUsageReading {totalTokens, maxTokens, autoCompactThreshold?, source}`, `ContextUsageSource` (the plan :1246 union; the port only produces `'sdk-getContextUsage'`), `ContextUsageQuery = Pick<Query,'getContextUsage'>`, `CONTEXT_USAGE_READ_TIMEOUT_MS = 5000`.
- CREATED `libs/backend/agent-sdk/src/lib/helpers/compaction/context-usage.port.spec.ts`: 11 cases.
- MODIFIED `libs/backend/agent-sdk/src/lib/di/tokens.ts`: `SDK_COMPACTION_COORDINATOR = Symbol.for('SdkCompactionCoordinator')` and `SDK_CONTEXT_USAGE_PORT = Symbol.for('SdkContextUsagePort')`, placed after `SDK_CODE_OUTLINER`.
- MODIFIED `libs/backend/agent-sdk/src/lib/di/register.ts`: the coordinator is registered with `useFactory: instanceCachingFactory(() => new CompactionCoordinator())`, the same factory style as the 25a capper. The port is registered with `useClass` + `Lifecycle.Singleton`. Both registrations come right after the capper.
- MODIFIED, outside the listed files (see Deviations): `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`. This change is additive. It adds `totalTokens: number` and `maxTokens: number` to `ContextUsageReadBack`, and adds an optional `opts?: {detail?: 'summary'|'full'}` parameter to `Query.getContextUsage`.

`session-control.service.ts` was not touched (D-3).

## Port API (for 27b and 29a)

- `readAtTurnEnd(sessionId, turnId, query)`: makes at most one `getContextUsage({detail:'summary'})` call per session and turn. Concurrent and repeated callers for the same turn share one promise. A new `turnId` starts a new read.
- `getLast(sessionId)`: returns the most recent successful reading. When a turn fails, the previous good reading is kept.
- `release(sessionId)`: drops both cache maps. If a read is still in flight when the session is released, its result does not repopulate the cache.
- When the accessor is missing, the port returns `undefined` and writes one `debug` line. When the accessor throws, times out after 5 s, or answers without finite token counts, the port returns `undefined` and writes one `warn` line. The log line carries the error type only. The port never throws.
- The port releases a session automatically on session end. Its constructor subscribes to `SDK_SESSION_END_CALLBACK_REGISTRY`, the same pattern as `memory-trigger.service.ts` and `chat-session.service.ts`. **27b note**: the session end delivers `SessionEndPayload.sessionId`, so 27b must key `readAtTurnEnd` on that same id. That means the real SDK id, if that is what `endSession` passes.

## Stack observed

- tsyringe. `@injectable` + `@inject(TOKENS.LOGGER)` is the sibling pattern (`compaction/tool-output-capper.ts:33-48`). Registrations use `useClass`/Singleton or `instanceCachingFactory` (`di/register.ts:403-426`).
- The SDK contract was read from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`. `getContextUsage(opts?: {detail})` returns `SDKControlGetContextUsageResponse`, which has `totalTokens`, `maxTokens` and `autoCompactThreshold?`.
- The coordinator constructor is `(timers?: CompactionTimers)` with no default, so `Function.length` is 1. It is undecorated, so tsyringe `useClass` would throw "TypeInfo not known". That is why it uses a factory.

## Verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts context-usage.port`: **11 passed**, exit 0. This was re-run after the audit fix.
- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-sdk --parallel=2 --skip-nx-cache`: exit 0, "Successfully ran targets test, lint, typecheck". No flakes appeared. The run used the port before the audit refactor described below. After the refactor, `lint,typecheck -p @ptah-extension/agent-sdk` was re-run (exit 0), along with the port spec.
- `npx nx run-many -t typecheck -p <affected by libs/backend/agent-sdk/src/index.ts>`: exit 0, "Successfully ran target typecheck for 18 projects". No `api-*`, `ptah-license-server` or `ptah-landing-page-e2e` project was in the affected set.
- `npx nx run di-lint:lint`: exit 0.
- `npx nx run degradation-audit:lint`: the first run exited 1, with `libs/backend/agent-sdk: 5 FAIL (baseline 4)`. The new finding was `catch-return-sentinel` at `context-usage.port.ts:166`. I restructured the read: the catch now logs and sets `failed = true`, and the mapping and shape check moved into `toReading`. The re-run exited 0, with `agent-sdk: 4 ok (baseline 4)`.
- `*.png`: none rewritten, per `git status`.

## Plan deviations

1. **`session-lifecycle-manager.ts` edited (outside the batch file list).** The brief requires reusing `ContextUsageReadBack`, with "no second SDK type", mapped to `{totalTokens, maxTokens, ...}`. However, the narrowed type only had `autoCompactThreshold?` and `isAutoCompactEnabled`, and the accessor took no `opts`. Plan :1247 requires `{detail:'summary'}`. Widening the existing type was the only way to meet the brief without a second type. The SDK guarantees both fields, so they are required. The existing `session-control.service.spec.ts` fakes are cast through `unknown`, and the agent-sdk typecheck, its tests and the importer typecheck all pass. The port still checks the shape at runtime. If you want to avoid touching that file, the alternative is a local intersection type in the port.
2. **Session-end auto-release** is wired inside the port, as a subscriber of the existing registry, in addition to the public `release`. The brief asked for "release on session end", and the repository pattern for that is the registry.
3. **5 s timeout** on the control request. It follows the `withApplyTimeout` precedent in `session-control.service.ts:869` and the external-call rule.

## Out-of-scope observations

- `apps/ptah-extension-vscode` reports `8 ok (baseline 9)` in the degradation audit, so its baseline could be tightened.
- 27b decides the turn key and who calls `readAtTurnEnd`. N8's tighten step still calls `getContextUsage` directly through `session-control` (D-3). Nothing else calls it per turn yet.
