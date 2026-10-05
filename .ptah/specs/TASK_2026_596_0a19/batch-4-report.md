# Batch 4 report: rate-limit mapper, signal registry and stream branch

Executor: backend-developer. All three tasks are done. Nothing was committed or staged.

## Files

Worktree root: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets`

- CREATED `...\libs\backend\agent-sdk\src\lib\helpers\plan-limits\claude-rate-limit.mapper.ts`. The pure mapper, with `claudeModelFamily` and `opensClaudeTurn`.
- CREATED `...\libs\backend\agent-sdk\src\lib\helpers\plan-limits\claude-rate-limit.mapper.spec.ts`
- CREATED `...\libs\backend\agent-sdk\src\lib\helpers\plan-limits\session-plan-limit-callback-registry.ts`. It extends `CallbackRegistryBase<SessionPlanLimitEvent>`, and the payload is `{sessionId, signal}`.
- CREATED `...\libs\backend\agent-sdk\src\lib\helpers\plan-limits\session-plan-limit-callback-registry.spec.ts`
- MODIFIED `...\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts` (+84 lines). Adds a constructor dependency, the per-turn S1 state, the turn-start trigger, one early branch and the S1 success emission.
- CREATED `...\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.plan-limits.spec.ts`. It is a sibling spec, following the `sdk-query-options-builder.*.spec.ts` pattern.
- MODIFIED `...\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.spec.ts` (+3 lines). The two `new StreamTransformer(...)` sites now pass the new registry stub.
- MODIFIED `...\libs\backend\agent-sdk\src\lib\di\tokens.ts`. Adds `SDK_SESSION_PLAN_LIMIT_REGISTRY: Symbol.for('SdkSessionPlanLimitRegistry')`.
- MODIFIED `...\libs\backend\agent-sdk\src\lib\di\register.ts`. Registers the registry as a singleton next to the MCP-status registry and imports it through a deep path.
- MODIFIED `...\libs\backend\agent-sdk\src\index.ts` (+10 lines, now 387; R2). Exports `SessionPlanLimitCallbackRegistry` and the types `SessionPlanLimitEvent`, `SessionPlanLimitSignal`, `ClaudePlanLimitEvidence` and `ClaudeTurnBilling`. The mapper functions are left for Task 5.3.

I did not touch any never-touch file: `sdk-adapter-events.service.ts`, `session-query-executor.service.ts`, compaction files, settings paths and `helpers/index.ts` are all unchanged. `git diff --stat -- libs/backend/agent-sdk` lists only the five modified files above.

## Stack observed

- **Language and DI:** TypeScript with tsyringe. Classes use `@injectable` and `@inject(token)`, and the registry is registered with `Lifecycle.Singleton` (`di/register.ts`).
- **Registry pattern:** `CallbackRegistryBase`, which uses an eventemitter3 fan-out with a try/catch per subscriber (`callback-registry.base.ts:12-52`). The new registry mirrors `session-mcp-status-callback-registry.ts`.
- **Logging:** the injected `Logger` from `TOKENS.LOGGER`.
- **SDK types:** re-exported from `@anthropic-ai/claude-agent-sdk` (`claude-sdk.types.ts`). I checked the shapes in `sdk.d.ts`: `SDKRateLimitInfo` at :5333, `SDKAPIRetryMessage` at :3383, and `SDKAssistantMessage.error` at :3405 and :3484.
- **Shared imports:** from `@ptah-extension/shared`: `normaliseInstant`, `PlanWindowKey`, `PlanLimitSource` and `PlanLimitCooldown`.

## Per-task evidence

### 4.1 Mapper and registry

- **Window mapping (plan :589):**
  - `five_hour` → `five_hour`
  - `seven_day` → `weekly`
  - `seven_day_opus` → `weekly_model:opus` (scope `opus`)
  - `seven_day_sonnet` → `weekly_model:sonnet` (scope `sonnet`)
  - `seven_day_overage_included` and `overage` → `overage`
  - An unknown or absent type gives no window. A rejected event with an unknown or absent type becomes owner evidence (`rejected-unknown-window`) and keeps the reset the event stated.
- **Status:** `status === 'rejected'` sets `exhausted: true`. `allowed` and `allowed_warning` set `exhausted: false`.
- **Reset:** `resetsAt` is normalised with `normaliseInstant`, so seconds become ms. A reset that cannot be parsed is left absent.
- **G1:** the mapper reads only `status` and `rateLimitType` from the info by destructuring, plus `resetsAt`, `isUsingOverage` and `overageInUse`. `grep -n utilization claude-rate-limit.mapper.ts` matches only lines 12 and 129, which are both doc comments. `utilization` is never assigned, read or carried.
- **Billing:** `billingFromRateLimitInfo` returns:
  - `overage` if `isUsingOverage` or `overageInUse` is true;
  - otherwise `plan` when the status is not `rejected`;
  - otherwise `unknown`.
- **`api_retry`:** a retry counts when `error === 'rate_limit'` or `error_status === 429`. It becomes owner evidence with source `error-derived` and a cooldown `{until: observedAt + retry_delay_ms, observedAt, rawUntil}`. It never carries a `resetsAt`. A negative or non-finite delay gives no cooldown.
- **Assistant error:** `error === 'rate_limit'` becomes owner evidence with no window and no reset.
- **Signal union:** `turn-start {observedAt}`, `evidence {evidence}` and `success {turnScopes, billing, observedAt}`.

### 4.2 StreamTransformer

- **Per-turn state:** `turnScopes: Set<string>`, `turnBilling: 'plan'|'overage'|'unknown'` (starts `unknown`, which stands for "unseen") and `turnStartPending`.
- **Scope:** comes from main-loop `message_start` only, inside the existing `!sdkMessage.parent_tool_use_id` guard, through `claudeModelFamily`. `result.modelUsage` is never read for the scope.
- **The one early branch:** `isRateLimitEvent || isAPIRetryMessage || (isAssistantMessage && error === 'rate_limit')`, then `mapClaudePlanLimitMessage`. The latest event's billing wins, and evidence goes to `notifyAll`.
  - It sits inside a try/catch. A failure logs at debug with `{sessionId, messageType, error: error.name}` only, never the payload.
  - It does not `continue`, so forwarding is unchanged:
    - `rate_limit_event` and `api_retry` were already absent from the forwarding list.
    - A rate-limited assistant message is still forwarded.
- **Result handling:** the result branch calls `onTurnEnd?.()` first, as before. A success result with `!is_error` then sends the S1 `success` signal with the frozen scopes and billing. Every result, error results included, resets the scopes, sets billing to `unknown` and arms `turnStartPending`.
- **Session id:** the branch comes after the `init` handling, so the signals carry the real session id.

### 4.3 DI

The token, the singleton registration and the barrel exports are listed under Files.

## Turn-start trigger chosen (AS1)

`turn-start` fires at the first turn-opening SDK message of a stream, and at the first turn-opening message after each `result`.

"Turn-opening" means anything except the trailers the SDK documents after a `result` (`sdk.d.ts` doc on `SDKResultMessage`): `prompt_suggestion`, `system/task_notification`, and a `system/session_state_changed` whose state is not `running`.

I excluded those trailers on purpose. Without the exclusion, a trailing `prompt_suggestion` would fire `turn-start` between turns. The G2 account re-read would then happen before the user's next prompt and could miss an account switch made in between. The per-turn state itself is reset at the `result`, so the trigger only decides when the signal is sent. It fires at most once per turn.

Task 5.1 should drop the probe cache on this signal.

## Fixtures covered

| Fixture | Where | Assertion |
| --- | --- | --- |
| F13 | mapper spec | `seven_day_opus` rejected → `weekly_model:opus` exhausted, reset in ms, only that window |
| F13a | mapper spec (utilization 0.82, 82, 1) and stream spec (0.97) | evidence is exactly reset, status and window; no `used` or `utilization` property |
| F14 | mapper spec | `allowed` and `allowed_warning` → `exhausted: false` |
| F15 | mapper spec and stream spec | 429 retry → owner evidence with a cooldown and no `resetsAt`; a 500 retry → nothing |
| F16 | mapper spec and stream spec | assistant `rate_limit` → owner level, still forwarded |
| F62 (signal side) | stream spec | Sonnet turn with a no-overage event → `success {turnScopes:['sonnet'], billing:'plan'}` |
| F75 | stream spec | Turn 1 Opus rejected → `weekly_model:opus` evidence, success scope `['opus']`. Turn 2: Sonnet main loop, an Opus subagent partial, and cumulative `modelUsage` listing Opus give scope `['sonnet']` and billing `plan` |
| F76 | stream spec | billing across three turns: `overage`, then `unknown` (no event), then `plan` |
| Plan :633 | stream spec | a `rate_limit_event` gives one registry notification and is not forwarded |

Extra stream cases:

- Within a turn, the latest event decides billing.
- An error result sends no success but still resets the turn.
- A mapper failure logs at debug without the payload, and the stream continues.

## Verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk --parallel=2 -- --maxWorkers=2`:
  - test passed.
  - lint passed.
  - typecheck failed only because `--maxWorkers` was forwarded to `tsc` ("Unknown compiler option"). This was my invocation error, not a code error.
- Re-ran `npx nx run-many -t typecheck -p @ptah-extension/agent-sdk`: passed.
- `npx tsc --noEmit -p libs/backend/agent-sdk/tsconfig.spec.json`: no errors.
- After `prettier --write` on the new and changed files, the targeted jest run passed 5 suites and 144 tests: the new mapper, registry and stream specs, the existing stream-transformer spec, and the DI smoke spec. Prettier changed formatting only; the stream-transformer diff stays at +84 lines, with no reflow of existing code.
- `eslint` on the changed files: clean.
- The `utilization` grep is reported above: comments only.

## Plan deviations

- **Billing type:** `ClaudeTurnBilling` is `'plan'|'overage'|'unknown'`, with no `'fallback'`. Fallback billing belongs to the ledger (Component 5), not to a Claude stream.
- **Rejected events:** a rejected event without overage flags makes the turn billing `unknown`. This follows from "latest event wins" plus the rule that `plan` needs `status !== 'rejected'`.
- **Trailer exclusion:** the turn-start trigger skips the documented post-result trailers, as explained above. This narrows AS1's "first SDK message after the previous `result`".
- **Constructor order:** the registry is the last constructor parameter of `StreamTransformer`, to keep spec churn small.

## Risk handling

- **R2:** the barrel grew by 10 lines, with only what the ledger consumes. The mapper exports are left to 5.3.
- **R5:** no file shared with 597 was edited.
- **Logging:** no payload, `accountInfo` or event content is logged.
- **Turn reset:** the `success` signal is sent after `onTurnEnd`, so the TASK_2026_294 turn-claim release keeps its order. The per-turn reset runs before any pricing `await`.
