# Batch A Code Logic Review — `TASK_2026_863_cfae`

## Verdict

**CHANGES** — **6/10**. One major finding and three minor findings.

The development hooks and shared state field are present. The required query-lifecycle recovery is absent. The score stays below 7 because the research plan's lifecycle fix is missing. Correct timing and production gates keep the score above 5.

## Findings

| Severity | Evidence | Problem | Suggested fix |
|---|---|---|---|
| **major** | `research-report.md:29`; `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:1895-1897`; `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-session.reducer.ts:407-413`; `.ptah/specs/TASK_2026_863_cfae/batch-a-report.md:47-50` | Stream teardown clears the idle attempt. No code resumes the query or preserves the attempt. A released background tab still cannot compact. The plan required a lifetime split or explicit resume, plus lifecycle tests. | Implement the planned lifetime split or explicit query resume. Add query-executor tests for background, released, rebound, and closed sessions. Never send into a dead query. |
| **minor** | `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget-config.provider.ts:90-100,124-151` | An unreadable settings store returns `SESSION_BUDGET_DEFAULT_CONFIG`. This discards `devBudgetTokens`. The development threshold silently returns to 50,000,000 tokens. | Apply `devBudgetTokens` to the fallback config too. Add an unreadable-store test with the override active. |
| **minor** | `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.spec.ts:27-105,161-194`; `libs/backend/agent-sdk/src/lib/di/dev-overrides.spec.ts:15-39`; `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget-config.provider.spec.ts:17-35` | Tests parse the overrides but do not test the injected values in their consumers. Short-TTL arm, fire, expiry, and tiny-budget behavior lack direct regression coverage. | Inject a short TTL into the service harness. Test its arm, fire, and expiry times. Construct both config providers with development values and assert the effective limits. |
| **minor** | `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.ts:153-171,342-369,381-401` | Several catches discard the original error. Logs contain only `signal-failed` or `lookup-failed`. A settings or reducer failure remains hard to diagnose. | Include a sanitized error name or message in the structured warning. Keep setting values and secrets out of the log. |

## Background-session answer

No reviewed idle-path code reads the visible or active tab. The service groups signals by session ID at `idle-compaction.service.ts:93-102`. The fire gate checks settings, cache class, timing, context, activity, claims, rate limits, and turn phase at `idle-fire-gate.ts:25-58`. It has no tab-visibility condition.

A background session with a live bound query can arm and fire. The service-level case at `idle-compaction.service.spec.ts:162-171` covers this state. It does not construct the query executor or a real stream.

Release on stream teardown is correct for a dead query. It prevents a later `/compact` send to that query. Normal turn results do not invoke stream teardown. The release callbacks run from the stream `finally` block at `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:1211-1235`.

Release can explain the symptom only when the background query ended earlier. The reviewed code does not show that a tab switch alone ends the query. Batch A adds no recovery after release. Therefore, the released-background failure mode remains open.

## Five logic questions

### 1. How does this fail silently?

A stream ends while its tab remains open. `session-released` clears the timer without a user-visible error. No later component resumes the query. The session remains open but cannot idle-compact. See Finding 1.

An unreadable budget settings store also returns a valid-looking default config. With a development override active, that config has the wrong effective limit. See Finding 2.

### 2. What user action produces unexpected behavior?

The user leaves a background tab open after its SDK stream ends. The user expects idle compaction before cache expiry. The released session cannot receive it. Switching tabs alone has no demonstrated release effect.

### 3. What input data produces a wrong answer?

Malformed, zero, negative, fractional, and oversized environment values are rejected by `dev-overrides.ts:9-13,22-26`. Non-boolean close-source values fall back to `false` at `session-budget-config.provider.ts:154-162`. No incorrect parsing was found.

### 4. What happens when a dependency fails?

Idle settings or reducer failures keep the previous state and emit a generic warning at `idle-compaction.service.ts:153-171`. Fire lookups become `lookup-failed` at `idle-compaction.service.ts:381-408`. Send failures become feedback signals at `idle-compaction.service.ts:446-473`. These paths do not report false compaction success, but some discard the cause.

Budget settings failures return defaults at `session-budget-config.provider.ts:90-100`. Finding 2 covers the development-override loss.

### 5. What is missing that the requirements never mentioned?

The user request does not define recovery for an open tab with a dead SDK query. The research plan does require a split lifetime or explicit resume. The implementation must supply that behavior or record an explicit scope decision.

An end-to-end hidden-tab lifecycle test is also absent. The current service test cannot prove that tab switches preserve the query.

## Focused checks

| Check | Result | Evidence |
|---|---|---|
| TTL at no-arm check | PASS | `idle-session.reducer.ts:64-70` uses `ctx.cacheTtlMs ?? IDLE_CACHE_TTL_MS`. |
| TTL at fire and expiry | PASS | `idle-session.reducer.ts:184-208` uses the same effective TTL for both values. |
| Fire fraction | PASS | `idle-compaction.types.ts:7-10` retains `0.9`, 60,000 ms lateness, and the production floors. |
| Development minimum floor | PASS | `di/register.ts:577-580` injects the override. `compaction-config-provider.ts:242-245` applies only that injected value. |
| Packaged-build protection | PASS | `apps/ptah-electron/src/di/phase-2-libraries.ts:222-225` passes `devHost: !app.isPackaged`. `di/dev-overrides.ts:20-21` rejects overrides when false. |
| Close-source validation | PASS | `session-budget-config.provider.ts:124-151` reads the boolean through the existing validator. |
| Close-source publication | PASS | `session-budget.service.ts:529-539,563-580` publishes it in measured and disabled states. |
| Typing and console use | PASS | The added-line diff contained no new `any` or `console` call. |
| Error handling | PARTIAL | Failures become signals, but Finding 4 records discarded causes. |

## Requirements fulfilment

| Requirement | Status | Gap |
|---|---|---|
| Close-source setting, validation, and state publication | COMPLETE for Batch A | Frontend behavior belongs to Batch B. |
| Bounded development overrides and DI | COMPLETE with minor gaps | Store fallback and consumer tests need fixes. |
| Electron-only development activation | COMPLETE | The source uses the requested `!app.isPackaged` gate. |
| Effective TTL and structured logs | COMPLETE with minor gaps | TTL consumer tests and error causes are missing. |
| Cancel on dead query | COMPLETE | The reducer clears the attempt and timer. |
| Background idle-compaction fix | PARTIAL | Live queries work. Released queries have no recovery. |

## Verification limits

- This review did not run tests, builds, serve, e2e, commits, or pushes.
- Scoped `ptah_get_diagnostics` ran twice. Both calls timed out after 45 seconds with all nine files unchecked.
- The implementation report says direct Jest and TypeScript checks passed. This review did not independently confirm those results.
- The implementation report says mandatory Nx verification did not start because of `EPERM` errors.
