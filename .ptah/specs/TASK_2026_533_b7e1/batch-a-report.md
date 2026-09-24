# Batch A report: backend/shared (TASK_2026_533_b7e1)

Worktree: `D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement`, branch `fix/session-stats-disagreement`. No git commands that change history were run. Nothing was committed or stashed.

## Summary

- One backend owner, `SessionStatsOwnerService`, is now the only authority for session stats. It holds a fixed history prefix plus the latest cumulative result of each query run, keyed by `SessionRecord.token`.
- Every SDK `result` publishes the owner's snapshot as `ResultStatsPayload.sessionStats` on the existing `session:stats` broadcast. The per-result footer fields are unchanged.
- `chat:resume` now returns the same `SessionStatsEntry` shape. When the session already has an owner, it returns that owner's snapshot.
- Cost authority is `usageCostSource: 'reported' | 'unreported'`. It is classified once from the effective auth route when the query is created and stored on the record. This replaces the per-result `isDirectAnthropic` accounting branch.
- The agent count is the number of unique canonical subagent identities. It comes from the SDK hooks and from transcript file names, never from a file count.

## Files changed

### Shared contract (`@ptah-extension/shared`)
- MODIFIED `libs/shared/src/lib/types/rpc/rpc-session.types.ts`
  - `SessionStatsEntry` extended in place with optional fields: `knownCost`, `tokenCount`, row `cacheRead`/`cacheCreation`/`contextWindow`, `scope` (`'session' | 'current-context' | 'range'`), `revision`, `durationMs`, `contextSnapshot`.
  - Doc comments rewritten: a partial priced sum is never a total, and `agentSessionCount` counts identities.
- MODIFIED `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`: `ChatResumeResult.stats` is now `SessionStatsEntry | null`. The anonymous shape is gone.
- MODIFIED `libs/shared/src/lib/types/agent-adapter.types.ts`: `ResultStatsPayload` gains `sessionStats?: SessionStatsEntry`. Footer fields are unchanged.

### agent-sdk: accounting
- CREATED `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts`
  - The owner, with no logger and no disk state. Its API after Revision 1 is listed under "Owner API after Revision 1" below.
  - Pure `resolveRunBase` and `subtractRunBase`, see "Resume combination" below.
  - `parseSavedCostState`: a zod boundary check for transcript `cost-state` entries.
  - The `UsageCostSource` type.
- CREATED `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.spec.ts`
- MODIFIED `libs/backend/agent-sdk/src/lib/session-stats/session-usage-aggregator.ts`
  - One aggregator with two inputs, ledgers and contributions, sharing one row/total finishing function.
  - New `session` scope.
  - `totalCost` is `null` whenever any usage is unpriced; the priced part goes to `knownCost`.
  - Rows carry both cache classes; `tokenCount` added.
  - `subagentIds` is required and counted as unique canonical ids (`canonicalSubagentId`, `countUniqueSubagents`).
- MODIFIED `libs/backend/agent-sdk/src/lib/session-stats/session-usage-aggregator.spec.ts`
- MODIFIED `libs/backend/agent-sdk/src/lib/session-stats/session-stats-reader.service.ts`: passes canonical ids taken from the member file names.
- MODIFIED `libs/backend/agent-sdk/src/lib/session-stats/session-stats-reader.service.spec.ts`
- MODIFIED `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`
  - Removed the separate `aggregateUsageStats` loop.
  - Resume stats now build ledgers through the shared builder and run `aggregateSessionUsage` with lifetime `session` scope. Each model is priced by its own id through the resolver.
  - The result seeds the owner, and the reply is the owner's snapshot plus the separately extracted `contextSnapshot` and the backend-known row `contextWindow`.
  - New `readSessionUsagePrefix` for a cold resume. It also extracts the last `cost-state` entry.
- MODIFIED `libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts`

### agent-sdk: live path and wiring
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`
  - The config now requires `runToken` and `usageCostSource`, and the owner is injected.
  - Run rows use the SDK's own model id and all four token classes; unreported runs keep their row rate.
  - Every result goes to the owner, whether or not a UI callback is registered. Per-turn `usage` without `modelUsage` marks the run incomplete and is not counted.
  - The snapshot is attached to the unchanged footer payload. `onTurnEnd` still runs first, unconditionally.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.spec.ts`: the harness supplies a run token and a route-classified authority to older specs; new describe block added.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts`: `SessionRecord.usageCostSource` is readonly and set at `register()`.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`: new `classifyUsageCostSource(effectiveAuthEnv)`. It honours `authEnvOverride`, freezes the value on the record and returns it.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts`
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`: `ExecuteQueryResult.usageCostSource`.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts`: records the agent identity on start and on stop, independent of the registry's `toolUseId` gate.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.spec.ts`
- MODIFIED `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
  - A new session gets `startNew`; a cold resume or slash command gets `prepareRun`, awaited before the query launches.
  - The owner is rebound when the canonical id resolves.
  - Every transform (new, resume, active reuse, slash command) passes the run token and cost authority.
  - The owner is released on `endSession`, `endSessionIfTokenMatches` (when the session actually ended), `interruptSession` and `dispose`.
- MODIFIED `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts`
- MODIFIED `libs/backend/agent-sdk/src/lib/di/tokens.ts`: `SDK_SESSION_STATS_OWNER = Symbol.for('SdkSessionStatsOwner')`.
- MODIFIED `libs/backend/agent-sdk/src/lib/di/register.ts`: registers the owner as a singleton before the services that use it.

### cli-agent-runtime
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts`: forwards `sessionStats` on `SESSION_STATS` when present; logs its total and revision.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.spec.ts`

## Failing specs: before and after

The first fail-first run happened before the coordinator's two corrections. The specs were then rewritten for the corrected contract, as described under "Resume combination".

| Spec | Failure before the fix | After the fix |
| --- | --- | --- |
| `session-stats/session-usage-aggregator.spec.ts` › "returns unknown total for mixed pricing and preserves both cache columns" | `expect(entry.totalCost).toBeNull()`, Received: `2` | PASS |
| `session-stats/session-stats-owner.service.spec.ts` (new) | `TS2307: Cannot find module './session-stats-owner.service'` | PASS: 31 tests (`resolveRunBase` 5, `subtractRunBase` 4, owner 22) |
| `sdk-agent-adapter.spec.ts` › "seeds cold history before launching a resumed query and never reseeds active reuse", plus the boundary fixtures | `TS2307: Cannot find module './session-stats/session-stats-owner.service'` and `TS2554: Expected 17 arguments, but got 19` | PASS |
| `helpers/stream-transformer.spec.ts` › "uses frozen cost authority and attaches snapshot without changing footer fields" and 4 siblings | `TS2307` (owner module) and `TS2554: Expected 6 arguments, but got 7` | PASS |

Other specs added and passing:
- History reader: per-model cache classes and counting a streamed message once; identities not files; a frozen prefix ignores a grown transcript; the last valid `cost-state` is extracted; a malformed `cost-state` is treated as absent; a missing transcript gives a `null` prefix.
- Hook handler: identity recorded without a `toolUseId`; five agents with start, stop and alias count as five.
- Executor: route classification, and the override winning and being frozen.
- `sdk-callbacks`: the snapshot is forwarded, or omitted when absent.

## Verification

Command: `npx nx run-many -t test,typecheck,lint -p @ptah-extension/shared,@ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime`. Exit code 0: "Successfully ran targets test, typecheck, lint for 3 projects".

| Project | test | typecheck | lint |
| --- | --- | --- | --- |
| @ptah-extension/shared | 65 suites; 1796 passed | pass | 0 errors, 3 warnings (existing, in files not touched) |
| @ptah-extension/agent-sdk | 119 suites passed, 2 skipped; 2131 passed, 3 skipped | pass | 0 errors, 49 warnings (see below) |
| @ptah-extension/cli-agent-runtime | 64 suites; 1018 passed, 1 skipped | pass | 0 errors, 42 warnings (existing, in files not touched) |

Lint warnings in touched files, compared with HEAD using `git show HEAD:<file> | eslint --stdin`:
- `max-lines` in `sdk-agent-adapter.ts` already existed; the count grew from 947 to 1044.
- `max-lines` in `session-history-reader.service.ts` already existed; the count shrank from 883 to 787.
- The other warnings (`no-useless-assignment` in `jsonl-reader.service.ts` and the adapter, and a non-null assertion in the executor spec at line 500) also exist at HEAD.
- The one new warning (an unused import in the owner) was fixed.

## Changes outside the file list, with reasons

1. `libs/backend/agent-sdk/src/lib/session-stats/session-usage-ledger.ts`: `visit(line)` was split so the new `visitRecord(raw)` holds the parse logic. The history path can now reuse the same per-message-id dedupe rules without re-serialising lines. No behaviour change.
2. `libs/backend/agent-sdk/src/lib/helpers/history/history.types.ts` and `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts`: they keep the raw `cost-state` payload as `SessionHistoryMessage.costState`. This is needed for the coordinator's rule 1: the converted history message dropped `totalCostUSD`, `modelUsage` and `hasUnknownModelCost`. The payload is unvalidated here and validated in `parseSavedCostState`.
3. Existing specs that compile against changed constructors or records. Each needed a one-line fix:
   - `libs/backend/agent-sdk/src/lib/session-history-reader.events-read.spec.ts`, owner constructor argument
   - `libs/backend/agent-sdk/src/lib/message-transform/artifact-parity.spec.ts`, owner constructor argument
   - `libs/backend/agent-sdk/src/lib/helpers/session-fork.service.spec.ts`: `SessionRecord` literal gains `usageCostSource`
4. `libs/backend/agent-sdk/src/lib/session-stats/index.ts` was edited and then reverted. `register.ts` imports the owner module directly, so the barrel is unchanged.

## Frontend compile breaks for Batch B

- Library typecheck passes for `@ptah-extension/rpc-handlers`, `dashboard`, `chat`, `chat-state`, `chat-ui`, `harness-builder` and `chat-types`. Batch A changed only optional or additive fields at the lib level.
- `tsc -p tsconfig.spec.json` shows two errors in `libs/frontend/chat`. Both are about types Batch A did not change (`TabId`, `liveModelStats`), so they are existing or unrelated, not caused by Batch A:
  - `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts:1716`
  - `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.spec.ts:176`
- What Batch B must consume:
  - `payload.sessionStats` on `session:stats` (install it, do not add to it).
  - The resume `stats` object, which is now a readonly `SessionStatsEntry` with `scope: 'session'`, `revision`, `tokenCount`, `knownCost`, and rows carrying `cacheRead` and `cacheCreation`. The resume path returns `null` when the snapshot is empty.

## Resume combination

### Corrections received during the batch

1. The prompt's "verified fact" was wrong: it said a resumed SDK run starts its cumulative figures at 0.
   - `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:5366/5374` (and `:5452/5460`) document `total_cost_usd` and `modelUsage` as follows: "a resumed or forked session continues from the totals its transcript saved, when it has them (so the first result already carries the earlier turns)", "a mid-session /clear resets the running total", and "crash/startup-error results may carry zeroed values".
   - I read these lines myself and they confirm the correction.
2. The coordinator's transcript evidence:
   - Claude sessions restore exactly: next `cost-state` = previous `cost-state` + usage in between (6100 + 59839 = 65939; 65939 + 5195 = 71134; 71134 + 31694 = 102828).
   - Proxy (GLM) sessions sometimes reset: 58471, then 22014 with 1316 output in between.
   - Only 22 of 200 recent transcripts have a `cost-state` entry.
   - So restore is conditional and must be detected for each run.
   - I sampled one entry myself to confirm the shape: `{"type":"cost-state","totalCostUSD":0.1028805,"modelUsage":{"claude-opus-5[1m]":{"inputTokens":506,...,"costUSD":0.1028805}},"hasUnknownModelCost":false}`. Model keys are the SDK's own ids, including suffixes such as `[1m]`.

### Rule as implemented (`session-stats-owner.service.ts`)

- **Snapshot** = history prefix (the JSONL aggregate from `aggregateSessionUsage`, lifetime scope) + the sum over runs of each run's own spend.
- **Run base.** Decided once, by `resolveRunBase(saved, firstAcceptedResult)`, on the run's first accepted result:
  - `saved` is `null` → the base is zero.
  - The first result is at least `saved` for every model in `saved`, in each of the four token classes → restored, and the base is `saved`. A model missing from the first result reads as zero. A model that is new in the first result does not prevent restore. Cost is not compared.
  - Otherwise → reset, and the base is zero.
- **Subtraction** (`subtractRunBase`): a run's spend is its figures minus its base, per model and per token class.
  - Reported runs: dollars are `result − base` for the total and for each row. The result is `null` if either side is unknown or the saved state has `hasUnknownModelCost`.
  - Unreported runs: each row's token difference is repriced with that row's own rate, and the total is the sum, or `null` if any row is unpriced. The SDK's saved dollars are not authoritative on those routes.
- **Known limit**, as stated in the code comment: "a reset whose first result already exceeds a tiny saved state in every class is read as restored, and the error is bounded by that saved state."
- **Within a run** (changed in Revision 2):
  - A result is accepted only if it keeps every model the run already reported and no counter of a shared model decreased. New models are allowed.
  - An identical result is a no-op.
  - Anything else — a truncated map, a decreased counter, or counters moving in both directions — is rejected atomically and logged once per run.
  - There are no in-run `/clear` segments. Ptah handles `/clear` natively and never sends it to the SDK (`slash-command-interceptor.ts:37` `NATIVE_COMMANDS`; `chat-slash-command-router.service.ts:82-96` calls `interruptSession`). The next message starts a new run, whose base is detected by `resolveRunBase`.
  - An error or startup result (`subtype !== 'success'` or `is_error`) with all-zero usage is ignored.
- **Where `saved` comes from** (changed in Revision 1, F1): for each run, the raw last `cost-state` on disk when that run is prepared, bound to the run by `beginRun`.
  - The first run of an owner takes it from the prefix read.
  - Every later run re-reads only that entry (`readLastSavedCostState`); for slash commands this happens after the previous query ended and before the new one starts.
  - A malformed entry is treated as `null`.
- **Specs covering both outcomes:**
  - Owner spec: restored (prefix 10, cost-state 10, R1 13 → 13, then 15 → 15); reset (R1 3 → 13); no cost-state (R1 3 → 13); a new model in R1 is still restored; R1 below in one class only is a reset.
  - Adapter spec: a Ptah `/clear` then the next message is a new run with a restored base ($13, then 15, not 28).
  - Adapter spec: SDK boundary fixtures for both outcomes. The comment cites `sdk.d.ts:5374`, and the claim that the SDK resets on resume has been removed.

## Open issues

1. `messageCount` counts transcript assistant messages from the prefix only. Live runs add 0, because an SDK result has no reliable per-run assistant-message count.
2. Resolved in the durationMs follow-up (below): `durationMs` is filled for sessions started in this process and `null` for resumed sessions.
3. Resolved in Revision 1 (F6): `loadAgentSessions` now reports unreadable members.
4. Legacy "warmup" agent files, which the replay layer filters out, still count as identities in both the list and resume paths.
5. Resolved in Revision 1 (F7): browsing no longer creates owners. The cost is that activating a resume reads the transcript twice: once for `chat:resume` and once for the owner prefix.
6. Pricing now uses the frozen per-query env (Revision 1, F4). Context-window precedence (`isDirectAnthropic(authEnv)`) still reads the global env; capacity precedence belongs to TASK_2026_418.
7. Two intentional behaviour changes:
   - Resume stats are now lifetime (pre-compaction usage is included).
   - Sessions-list totals with partial pricing are now `null`, with a `knownCost` subtotal.

   The existing specs were updated to pin both. The public `'current-context'` / `'range'` list scopes are unchanged.
8. Adapter `max-lines` grew from 947 at HEAD to 1110 (the warning already existed). The history reader went from 883 at HEAD to 860. Extracting the adapter's stats-lifecycle helpers into their own collaborator would need a new registration, which the plan did not ask for.

## Revision 1: response to code-logic-review.md (REVISE 4/10)

For each finding, a failing reproduction was run first against the Batch A code. It was a temporary spec written against the unchanged API, deleted after the failures were recorded. The fix and its permanent specs followed.

| Finding | Failure before the fix | Fix | Permanent specs (all pass) |
| --- | --- | --- | --- |
| F1: restore candidate | Tokens: expected 170, received **270**. Dollars after an unreported then reported run: expected $13, received **$10**. | `savedStateBefore` and `toSavedState` were removed. `prepareRun` returns a `RunPreparation` whose `candidate` is the raw last `cost-state` on disk now: taken from the prefix read for an owner's first run, re-read through the new `SessionHistoryReaderService.readLastSavedCostState` for later runs (a streaming read that parses only `cost-state` lines). `beginRun` binds it to the run's token. For slash commands, `SlashCommandConfig.beforeRelaunch` runs after the old query ends and before the new one starts, so the read happens between the two. Normalized or rate-card dollars are never used as a base. | Owner: "run B restores the disk state run A never saved: lifetime 170/$17" and "an unreported run then a reported run: $13, not $10". Adapter: "reads a slash-command run candidate between the old query ending and the new one starting" (order end → read → launch; the candidate is bound to the run). History: `readLastSavedCostState` returns the last entry; malformed or failed reads give `null`. |
| F2: truncated map treated as a reset | Tokens: expected 150, received **260**. | A decrease is a `/clear` only when no shared model grew (`isReset`; missing models and new models are allowed). Otherwise the outcome is `rejected-incomplete`: state is unchanged and the transformer logs once per stream. | "rejects a truncated map atomically, then recovers: 150/$15 → 150/$15 → 170/$17"; "a reset may drop models when none of the shared ones grew"; 10 → 15 → 2 → 4 = 19 kept. |
| F3: incompleteness | Total expected `null`, received **5**. | Incompleteness is tracked per segment. While any segment is incomplete, `totalCost` is `null`, `knownCost` is the priced amount, `pricingCoverage` drops from `full` to `partial`, and coverage is `partial`. An accepted complete cumulative result clears the current segment's flag. A flag sealed with an earlier segment stays. | "a gap nulls the total, keeps the priced subtotal, and recovers" (6, complete, full); "a gap sealed into an earlier segment stays after a reset" (null, knownCost 7). |
| F4: global auth in pricing (scope narrowed by the coordinator) | Costs expected `[1, 1]`, received `[1, 200]` (the global tier change re-priced the running query). | The executor freezes a copy of the effective env (`authEnvOverride ?? global`) on the record as `accountingAuthEnv`, beside `usageCostSource`. It is returned in `ExecuteQueryResult` and passed to `StreamTransformConfig.accountingAuthEnv`. `resolveForCost(model, accountingAuthEnv)` keeps alias resolution. History and list pricing policy are unchanged (TASK_2026_475 owns lookup). | Transformer: "a global tier change mid-query does not re-price the running query" (costs `[1, 2]` for 100 then 200 tokens) and "an override query prices with its own frozen mapping". Executor: "freezes a copy of the effective auth env for pricing". |
| F5: owner generations | A late result after clear **recreated** the owner. | Each owner has a `generation`, plus an `epoch` that advances synchronously on every `prepareRun`. `replaceRun`, `markRunIncomplete`, `beginRun` and `rebind` act only on the matching generation. They run after the transformer's pricing awaits and never create an owner (`stateForRun` was removed; the result is `stale-owner`). Teardown captures `leaseOf` before awaiting, and `release(key, lease)` succeeds only if both generation and epoch still match. `StreamTransformConfig.statsGeneration` is captured when the run is prepared. | Owner: "a late result after release cannot resurrect the owner; the next prepareRun seeds normally"; "an old teardown after a replacement leaves the replacement intact"; "a teardown of a replaced owner is a no-op". Transformer: "drops a late result for a released owner without recreating it". Adapter: "an old teardown finishing after a replacement run leaves the replacement owner intact". |
| F6: unreadable subagents | Total expected `null`, received **2**. | `loadAgentSessions(dir, parent, onUnreadable?)` now reports each member it could not read: a nested file with its owned file-name identity, a flat legacy file with no owner, and a directory that exists but cannot be listed (anything other than ENOENT/ENOTDIR). `buildUsagePrefix` passes the real `unreadableSubagents` count and the known owned ids. In the aggregator, unreadable members set `pricingCoverage` to `partial`, which makes `totalCost` `null` while `knownCost` is kept. This applies to the list path too. | History: "parent $2 + one unreadable owned agent: no total, knownCost 2, one agent, partial" (both the prefix and the resume reply). jsonl-reader: nested, legacy and unlistable-directory reporting. |
| F7: owners created by browsing | 3 reads produced **3 owners** (expected 0). | `seedHistory` was removed. A history read returns the owner's snapshot if an owner exists, otherwise the aggregate directly. Owners are created only by `startNew` (new session) or `prepareRun` (a query run being activated). | History: "creates no owner for three history reads without activation"; "answers with the owner snapshot once a run is active, never re-adding a grown transcript". |

### Owner API after Revision 1
- `startNew(key) → OwnerLease`
- `prepareRun(id, { loadPrefix, loadSavedCostState }) → RunPreparation { generation, epoch, candidate }`
- `beginRun(key, generation, token, candidate)`
- `replaceRun(id, generation, token, result) → { outcome, snapshot | null }`. Outcomes: `accepted`, `duplicate`, `segment-started`, `ignored-error`, `rejected-invalid`, `rejected-incomplete`, `stale-owner`.
- `markRunIncomplete(id, generation, token)`
- `rebind(from, to, generation)`
- `recordAgent`, `snapshot`, `leaseOf`, `release(key, lease)`, `clearAll`

### Additional changes outside the file list (Revision 1)
- `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts`: the `onUnreadable` callback and `listAgentDirectory`. Needed for F6; existing callers are unchanged.
- `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.spec.ts`: three loader specs for F6.
- `libs/backend/agent-sdk/src/lib/helpers/history/history.types.ts`: the `UnreadableAgentMember` type, needed for F6.
- `libs/backend/agent-sdk/src/lib/helpers/session-fork.service.spec.ts`: the `SessionRecord` literal gains `accountingAuthEnv` (compile only, F4).
- `session-lifecycle-manager.ts` (already in the list) gains `SlashCommandConfig.beforeRelaunch`, for F1 timing.

### Decisions and limits
- F2: a rejected truncated map keeps the accepted state as it is (150/$15). It does not mark the segment incomplete, as the coordinator specified. Marking it incomplete would make the total unknown until a complete map arrives.
- F1: between reading the candidate and the new process restoring, a previous process that is still writing could change the file. The window is short (read, then query start), and any error is bounded by the saved state.
- `markRunIncomplete` or `replaceRun` for a token that was never begun create a run with no candidate (zero base). The adapter begins every run it launches.
- Workspace isolation still relies on session ids being globally unique (the review's residual assumption; not changed).

### Verification (Revision 1)
Command: `npx nx run-many -t test,typecheck,lint -p @ptah-extension/shared,@ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime --skip-nx-cache`. Exit code 0: "Successfully ran targets test, typecheck, lint for 3 projects".

| Project | test | typecheck | lint |
| --- | --- | --- | --- |
| @ptah-extension/shared | 65 suites; 1796 passed | pass | 0 errors, 3 warnings (existing) |
| @ptah-extension/agent-sdk | 119 suites passed, 2 skipped; 2149 passed, 3 skipped | pass | 0 errors, 47 warnings. In touched files: only the existing `max-lines` in the adapter and history reader, and the existing `no-useless-assignment` at adapter:262. |
| @ptah-extension/cli-agent-runtime | 64 suites; 1018 passed, 1 skipped | pass | 0 errors, 42 warnings (existing) |

## Revision 2: response to the code-logic re-review (F2 partial, F5 partial, N1)

As before, each failing spec was written first and run against the Revision 1 code.

| Finding | Failure before the fix | Fix | Permanent specs (all pass) |
| --- | --- | --- | --- |
| N1: a real `/clear` with counters moving in both directions lost a completed segment | This spec already passed before the fix. Your in-run rule redefines the expected outcome (reject, then accept the next grown result), and the Revision 1 code happened to produce it for this input. The defect itself was the segment model, which could seal or lose spend on mixed movement. That model is now removed entirely, so the class of defect is gone rather than patched. | The in-run `/clear` logic is removed: the `segment-started` outcome, `isReset`, `sealed` segments and per-segment incompleteness. The only in-run rule is now `isGrown`: every previously accepted model is present and no counter (or known cost) decreased. Otherwise the outcome is `rejected-non-monotonic`: state unchanged, and `firstRejection` is `true` only once per run, so the transformer logs once per run (the per-stream flag is gone). F3 is kept: `incomplete` is per run, gives `totalCost` `null` plus `knownCost`, and a later accepted result clears it. | Owner: "rejects mixed counter movement, then accepts the next grown result: 10/100/$11 → 10/100/$11 → 30/120/$15". Adapter: "a Ptah /clear then the next message is a new run with a restored base, never double-counted" ($13, then $15, not $28). The 10 → 15 → 2 → 4 = 19 spec and the other segment specs were deleted. |
| Residual F2: an unchanged surviving row turned a truncated map into a segment | Tokens: expected 150, received **250**. | The same rule: a missing model is never accepted. | "rejects a truncated map whose surviving row is unchanged: 150/$15, then 170/$17" (it also pins the once-per-run report). The growing-A/missing-B spec is kept, now with `rejected-non-monotonic`. |
| Residual F5: a rebind during the awaited interrupt made the release miss its owner | Owner: `release` returned **false**. Adapter: the canonical owner **remained** after the interrupt. | `release(lease)` no longer takes a key. It finds the owner by its generation wherever it is keyed now, still checks the epoch, and never clears whatever owner occupies a freshly looked-up key. The adapter captures leases (deduplicated by generation) before awaiting and releases them afterwards. | Owner: "releases the captured owner after a provisional-to-canonical rebind" (true, no snapshot under the canonical id). Adapter: "releases the owner when init binds the canonical id while the interrupt awaits". The existing "old teardown after replacement" and "replaced owner" specs still hold. |

### API changes in Revision 2
- `replaceRun(...)` now returns `{ outcome, snapshot, firstRejection }`. Outcomes: `accepted`, `duplicate`, `ignored-error`, `rejected-invalid`, `rejected-non-monotonic`, `stale-owner`.
- `release(key, lease)` is now `release(lease)`.

### Files touched in Revision 2 (all already in the Batch A or Revision 1 lists; no new out-of-list files)
- `session-stats-owner.service.ts` and its spec
- `stream-transformer.ts` and its spec (updated `release` call)
- `sdk-agent-adapter.ts` and its spec

### Verification (Revision 2)
Command: `npx nx run-many -t test,typecheck,lint -p @ptah-extension/shared,@ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime --skip-nx-cache`. Exit code 0: "Successfully ran targets test, typecheck, lint for 3 projects".

| Project | test | typecheck | lint |
| --- | --- | --- | --- |
| @ptah-extension/shared | 65 suites; 1796 passed | pass | 0 errors, 3 warnings (existing) |
| @ptah-extension/agent-sdk | 119 suites passed, 2 skipped; 2151 passed, 3 skipped | pass | 0 errors, 47 warnings (unchanged from Revision 1) |
| @ptah-extension/cli-agent-runtime | 64 suites; 1018 passed, 1 skipped | pass | 0 errors, 42 warnings (existing) |

## Follow-up: durationMs

This is an uncommitted change on top of `f00c30d44`. No frontend files and no TASK_2026_418 files were touched.

**Why:** Batch B moved the stats panel to the snapshot, and `SessionStatsEntry.durationMs` was never filled. The Time chip (for example "25m 2s") therefore disappeared on live sessions.

**Rule** (`session-stats-owner.service.ts`):
- `RunUsageResult.durationMs` carries the SDK result's `duration_ms`, which is per turn. `stream-transformer.ts` passes `sdkMessage.duration_ms`, the same value the footer `duration` uses.
- `replaceRun` adds it to the run's `durationMs` only when the outcome is `accepted` and the value is finite and non-negative. `duplicate`, `rejected-invalid`, `rejected-non-monotonic`, `ignored-error` and `stale-owner` add nothing.
- The snapshot's `durationMs` = `prefixDurationMs` + the sum of run durations, and only while the prefix duration is known:
  - `startNew` (brand-new session): known `0`.
  - `prepareRun` (history prefix): unknown, so the snapshot's `durationMs` is `null` and the panel hides the Time chip, as it did for resumed sessions before this task.
- Duration is never derived from JSONL timestamps.

**Failing specs first** (the type-only field was added first, so these compiled and failed on behaviour). The pre-fix failure for all five was `durationMs` `undefined`.
- New session, results with 1000 then 1500 accepted: expected 2500 (and 0 before any result).
- Duplicate (700), rejected (900), invalid (800) and zeroed error (600) results: expected to stay at 2500.
- An accepted result with an invalid duration (−5, NaN): the result is accepted, and the duration stays at 1000.
- Resumed session with a history prefix: `null` even after accepted results (the cost of 13 is still correct).
- Stale-owner result (5000): no change; the replacement owner shows only its own 300.

All five pass after the fix. The transformer spec also pins that two accepted results with `duration_ms` 100 publish 100, then 200.

**Verification:** `npx nx run-many -t test,typecheck,lint -p @ptah-extension/shared,@ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime --skip-nx-cache`. Exit code 0.

| Project | test | typecheck | lint |
| --- | --- | --- | --- |
| @ptah-extension/shared | 1796 passed | pass | 0 errors, 3 warnings (unchanged) |
| @ptah-extension/agent-sdk | 2156 passed, 3 skipped | pass | 0 errors, 47 warnings (unchanged) |
| @ptah-extension/cli-agent-runtime | 1018 passed, 1 skipped | pass | 0 errors, 42 warnings (unchanged) |

**Files changed:**
- `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts` and its spec
- `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts` and its spec
