# Code Logic Review — TASK_2026_597 PR 2 (N1, N2, N6; Batches 37-41, 46, 47)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 7/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 3        |
| Failure modes found | 5        |

Scope: combined diff `5bb19f9fb..HEAD` excluding `.ptah` and `scripts`. I read the non-spec source of the builder, the shared resolver and cache-state utils, registry and state store, injector, subagent and agent RPC handlers, the accumulator hookup and the agent-monitor store. For the settings UI and providers-settings state I read only the commit-service diff and the grep hits for the setting. I did not run tests or diagnostics; the executor reports cover those.

## Five logic questions

### 1. How does this fail silently?

- Builder without `IWorkspaceProvider` reads the setting as `'auto'` (`sdk-query-options-builder.ts:1160-1165`). `PLATFORM_TOKENS.WORKSPACE_PROVIDER` is registered in all three hosts (`platform-vscode/src/registration.ts:78`, `platform-electron/src/registration.ts:154`, `platform-cli/src/registration.ts:81`), so in production the setting is read. The silent fallback to `auto` only occurs where the token is missing (unit tests).
- Builder pitfall: a user who sets `5m` explicitly gets `sdkValue='5m'`. A user who sets a hand-edited invalid value gets `auto`. Both are logged at `:1175` and the UI reports them via `getSubagentPromptCacheTtl` (`agent-rpc.handlers.ts:1122-1146`). Consistent.
- `calculateMessageCost` treats a missing cache price as 0 (`pricing.utils.ts:410-413`). A model with a price but no cache price gets an underestimated, not-null cost (Minor, M3).

### 2. What user action produces unexpected behaviour?

- Interrupting a long-running foreground subagent (abort, then next message). `markAllInterrupted` (`subagent-registry.service.ts:654-666`) sets `interruptedAt` but does not stamp `lastActivityAt`. SubagentStop does not fire on abort, so the activity time stays at registration. The injector therefore prints, for example, "interrupted 2 min ago - cache: cold (idle 45 min)" for an agent whose cache was warm at the interrupt. See M1.
- Setting 5m while the host env var is 1h: the env wins in the SDK, and `envOverride` is reported. OK.

### 3. What input data produces a wrong answer?

- N2 wrong-resume: the stale-low direction (reading warm agents as cold) is the only error direction found, and it is conservative: the injector tells the model to start fresh, which costs tokens but loses no work. The note `SUBAGENT_CACHE_ESTIMATE_NOTE` discloses this to the model.
- Wrong-warm risk was checked and not found. History-replayed records are written via `store.set` with no `lastActivityAt` (`subagent-history-registrar.ts:154-160`), so they are cold. `restoreResumableBySession` keeps a carried value or none. A future-dated timestamp gives warm, idle 0 (documented).
- Env value `" 1h "` with surrounding spaces is treated as invalid, because `asTtl` does not trim (`subagent-prompt-cache-ttl.ts:35,58-62`). That is likely also what the SDK does, so it is reported as `'invalid'` and `effective` falls back to the setting. It is a guess about SDK parsing (Minor).

### 4. What happens when a dependency fails?

- `chat:subagent-query` failure in `loadSubagentCacheInfo` logs and leaves the record as it was, so the cache state stays `'unknown'` and no badge is shown (`agent-monitor.store.ts`). Correct.
- An older host without `cacheInfo` also leaves the state `'unknown'`. OK.
- `workspace.getConfiguration` throwing is not guarded in the injector or `withCacheInfo`; the existing `subagent:query` try/catch covers the latter. The injector call is in the chat-send path. Low probability.

### 5. What is missing that the requirements never mentioned?

- No tests of the two TTL call sites agreeing with each other beyond the shared resolver. They do agree by construction (see below).
- Subagent message sends (`subagent:send-message`) do not stamp activity. This is the accepted AS-N2 limitation.
- `_subagentRequestUsage` entries for a `parentToolUseId` that never gets a record are never evicted (M2).

## Failure modes

### Cold-read of an interrupted foreground subagent

- Trigger: user aborts a foreground subagent that ran longer than the TTL after its last stamp.
- Symptom: the injector marks it "cache: cold" and instructs a fresh start, although its cache is probably still warm.
- Evidence: `subagent-registry.service.ts:654-666` (no stamp); `chat-subagent-context-injector.service.ts:164-170`.
- Current handling: conservative. The result is wasted tokens, not wrong work. The disclosure note is injected.
- Recommendation: in `markAllInterrupted`, set `record.lastActivityAt = interruptedAt` (the agent's last real request is at the interrupt). Alternatively, have the injector use `max(lastActivityAt, interruptedAt)`.

### TTL resolution duplicated at three call sites

- Trigger: change to one call site.
- Symptom: displayed TTL differs from the injected or sent TTL.
- Evidence: all of the builder `:1166-1173`, injector `resolveEffectiveTtl`, `subagent-rpc.handlers.ts withCacheInfo` and `agent-rpc.handlers.ts:1129` call the single shared `resolveSubagentPromptCacheTtl`. The env var name literal is repeated in four files (batch-38 deviation 3).
- Current handling: agree today. The injector, `withCacheInfo` and the agent handler pass `canSpawnSubagents: true`, and the builder passes the real value, which is always true for the claude_code preset (`sdk-query-options-builder.ts:1160-1171`). `auto` resolves to `1h` in the main session, as required.
- Recommendation: export the env name constant from shared.

### Pre-existing: `currentTokenUsage` overwritten by subagent message_complete

- Evidence: `accumulator-core.service.ts:535` runs `state.currentTokenUsage = event.tokenUsage` before the new subagent branch, for subagent events too. This line is not in the diff, so it is out of scope, but the new branch shows that subagent events reach it.
- Recommendation: check separately.

### Request-usage map growth

- Trigger: `message_complete` events with a `parentToolUseId` that has no record.
- Evidence: `agent-monitor.store.ts` `onSubagentMessageComplete` creates a map entry even when no record exists. It is cleared only in `ngOnDestroy`.
- Impact: a small per-message entry per orphan id. It is bounded by the session's subagent count and the comment states the lifecycle.

### Stale warm/cold badge

- No timer re-evaluates warm/cold, by design ("no timers"). A badge computed at render time stays "warm" until something re-renders the row. Acceptable and documented.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- M1 (Moderate): `markAllInterrupted` does not stamp activity, so the cold-read above. `subagent-registry.service.ts:654-666`.
- M2 (Moderate): `_subagentRequestUsage` has no eviction for ids that never get a record. `agent-monitor.store.ts` (`onSubagentMessageComplete`).
- M3 (Moderate): the cost estimate multiplies summed tokens by the latest model's price, and uses a 0 price when the model lacks a cache price. The result can be underestimated when the model changes mid-run. Label the cost as an estimate (it already is).
- Minor: `providers-commit.service.ts` and `providers-settings-state.service.ts` carry large formatting-only churn mixed with the 1-line setting additions. Hard to review and a conflict risk, but not a logic defect.
- Minor: env var name literal duplicated in four files.
- Minor: `update()` stamps `lastActivityAt` for every update, including ones that are not model activity (isBackground and output-path updates). The effect is an over-warm reading in rare cases. (`subagent-registry.service.ts:309`)

## Data flow

1. Setting written via `agent:setConfig`: validated against `SUBAGENT_PROMPT_CACHE_TTL_SETTINGS` (`agent-rpc.handlers.ts:362-370`), stored under `agentOrchestration.subagentPromptCacheTtl`. The key is in file-settings-keys, settings-export and SCOPED_SETTING_KEYS. OK.
2. Read in `build()`: shared resolver, then flag-settings JSON `subagentPromptCacheTtl` (a valid `Settings` field, `sdk.d.ts:8542` in `interface Settings`). The child env inherits `process.env` (`:1315`), so the env override wins in the SDK. OK.
3. Registry stamps at register and on every update. Gap: M1. History-replayed records have no stamp, so they read cold. OK.
4. `subagent:query` attaches `cacheInfo`. The injector builds the prompt with warm/cold. OK; the missing-activity branch prints "idle unknown" and never "idle 0 min" (`formatCacheState`).
5. UI: `message_complete` with `parentToolUseId` calls `onSubagentMessageComplete`. Usage is keyed by `messageId` (replay-safe); missing cache fields stay `undefined`, never 0 (`readRequestUsage`, `addOptional`, `sumRequestUsage`). Cost uses the shared `calculateMessageCost`. The cache TTL arrives only via `loadSubagentCacheInfo` on row open, so there are no timers or polls. OK.

## Requirements fulfilment

| Requirement                                                  | Status   | Gap                                              |
| ------------------------------------------------------------ | -------- | ------------------------------------------------ |
| N1 setting and `auto` = 1h for subagent-capable main session | COMPLETE | None                                             |
| N1 env override precedence and UI display                    | COMPLETE | `envOverride` reported, including `'invalid'`    |
| N1 effective value logged                                    | COMPLETE | `:1175`                                          |
| N2 `cacheState` and effective TTL in status                  | COMPLETE | `cacheInfo` optional for older webviews          |
| N2 resume-when-warm / fresh-when-cold guidance               | COMPLETE | Precision limited by AS-N2 plus M1               |
| N2 missing activity treated as cold                          | COMPLETE |                                                  |
| N6 context, cache state, tokens, estimated cost per agent    | COMPLETE | CLI lanes show "not reported" (deferred batches) |
| N6 missing never 0, no timers, shared pricing                | COMPLETE | M3 nuance                                        |

Implicit requirements not addressed: none beyond M1 to M3.

## Edge cases

| Case                         | Handled | How                                    | Concern                          |
| ---------------------------- | ------- | -------------------------------------- | -------------------------------- |
| Env var blank                | YES     | Treated as unset                       | None                             |
| Env var invalid              | YES     | `envOverride: 'invalid'`, setting used | Whitespace not trimmed           |
| Subagent tool disallowed     | YES     | `canSpawnSubagents` false gives unset  | Not reachable in `build()` today |
| Missing/NaN lastActivityAt   | YES     | Cold, idle unknown                     | None                             |
| Future timestamp             | YES     | Warm, idle 0                           | None                             |
| Idle exactly equal to TTL    | YES     | Cold                                   | None                             |
| Replayed `message_complete`  | YES     | Keyed by `messageId`                   | None                             |
| Older host without cacheInfo | YES     | State `'unknown'`                      | None                             |
| Interrupted foreground agent | PARTIAL | Reads cold                             | M1                               |

## Verdict

- Recommendation: APPROVE (the 3 Moderate items can follow up)
- Confidence: MEDIUM-HIGH
- Top risk: the N2 cold-read after an abort (M1), which costs tokens but loses no work.
- What a robust implementation would add: stamp activity in `markAllInterrupted`; evict the usage map for orphan ids; export the env-var name constant from shared; trim the env value; split the formatting-only churn out of the providers-settings files.
