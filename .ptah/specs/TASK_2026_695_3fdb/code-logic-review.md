# Code Logic Review - TASK_2026_695_3fdb

Review family: reviewer: Anthropic Claude subagent; implementer: codex.

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 7/10     |
| Assessment          | REVISE   |
| Blocking issues     | 0        |
| Serious issues      | 1        |
| Moderate issues     | 5        |
| Failure modes found | 6        |

Scope: full `git diff` of the 21 files, plus whole-function reads of `_saveInternal`, `create`, `enqueueWrite`, `get`, the three adapter write sites, the `chat:resume` and `session:list` readers, `session-loader.service.ts` resume flow, and `tab-manager.service.ts` binders. No tests were run by me; the orchestrator's pass results were taken as given.

## Five logic questions

### 1. How does this fail silently?

- Provider stays stale when the relaunch has no resolvable provider. `capacityRoute.providerId` is `null` for an unrecognised proxy (`session-query-executor.service.ts:142`), and `providerProfile` is undefined when the shared auth env serves the provider. `sdk-agent-adapter.ts:1317-1322` and `:1698-1703` then skip the write, so the old id survives. The session is now shown with a provider it no longer runs on, and nothing is logged. The "null never overwrites" rule is correct, but nothing records "unknown now".
- `SessionMetadataStore.create` ignores `providerId` when a record already exists (`session-metadata-store.ts:1384-1391`; the existing-record branch only bumps `lastActiveAt`). On the new-session init path (`sdk-agent-adapter.ts:1450-1484`) the provider is dropped silently if metadata was pre-created (a fork or child pre-create). No later hook records it, because only resume and slash relaunch call `updateProvider`.

### 2. What user action produces unexpected behaviour?

- Continue a restored session on a different provider and model. The tab keeps the old `tab.providerId`. `tabProvider()` (`command-center-projection.source.ts:44-50`) falls through live stats to the model-matched usage row, then the stored value. If the new run's model has no matching usage row yet, or `liveModelStats` is absent, the mark shows the old provider. The backend has already overwritten its record at init. Nothing on the frontend refreshes `tab.providerId` after `sessionIdResolved` or a turn.
- Opening an old session in Command Center with `chat:resume activate:true` (`chat-session.service.ts` ~1190-1215) launches a live query through `resumeSession`. When the SDK emits `init`, the resume callback (`sdk-agent-adapter.ts:1313-1322`) overwrites the stored provider with today's workspace provider. The user only opened the session and sent no turn. This is what focus item 2 asked to avoid. If the SDK emits init only after the first user message, the risk shrinks. I could not confirm which, so treat it as uncertain.

### 3. What input data produces a wrong answer?

- A resume that reports a forked id: `updateProvider(realSessionId)` finds no record and returns silently (`session-metadata-store.ts:1425-1426`), so the forked session has no provider. Unknown is the safe outcome here.
- The provider format is consistent across the profile id, route id and the `provider()` normaliser (`'anthropic'`, `'openrouter'`, `'openai-codex'`, `'github-copilot'`). No problem found.

### 4. What happens when a dependency fails?

- `executeSlashCommand` awaits `updateProvider` (`sdk-agent-adapter.ts:1698-1703`) after `executeSlashCommandQuery` has already relaunched the SDK query. `enqueueWrite` rethrows the operation's error (`session-metadata-store.ts`, the `enqueueWrite` implementation). If a storage write or a read in `get()` rejects, `executeSlashCommand` rejects. The new query is registered but never wrapped by `streamTransformer`, and `statsOwner.beginRun` (`:1704-1711`) and `rememberStreamTap` are skipped. See S1.
- In the resume callback (`:1317-1322`) and the init callback (`:1450-1484`), a metadata failure rejects an un-awaited async callback, so `emitSessionIdResolved` and the rest of the callback are skipped. `touch` already carried that risk. The new write adds another failure point to the same unprotected sequence.

### 5. What is missing that the requirements never mentioned?

- No root-only guard. `updateProvider` and `create(..., providerId)` also run for child or CLI sessions if they go through the same adapter callbacks. This is probably correct for such a session's own provider, but it is undocumented and untested.
- `updateProvider` always saves and emits `metadataChanged: 'updated'` even when the value is unchanged (`session-metadata-store.ts:1428-1435`). Every resume and slash command then triggers an extra index write and a UI list refresh.
- No test for a rejecting `updateProvider`, for a concurrent `save` plus `updateProvider`, or for a restored tab continued on another provider.

## Failure modes

### Slash-command relaunch aborted by a metadata write

- Trigger: `updateProvider` rejects (disk full, lock, storage closing) during `executeSlashCommand`.
- Symptom: the slash command rejects after the SDK query was relaunched. The stream is never consumed and run stats are never begun.
- Evidence: `sdk-agent-adapter.ts:1698-1711`.
- Current handling: none. A best-effort annotation is on the critical path.
- Recommendation: wrap in try/catch and log with a degradation-audit comment, or fire it after the stream is built. Apply the same to the resume callback.

### Stale provider after a relaunch with an unknown route

- Trigger: resume or slash relaunch where `providerProfile` is undefined and `capacityRoute.providerId` is null.
- Symptom: the old provider id stays on a session that now runs elsewhere.
- Evidence: `sdk-agent-adapter.ts:1317-1322`, `:1698-1703`; `session-query-executor.service.ts:142`.
- Current handling: skip the write.
- Recommendation: accept it, but log it, or clear the field when a launch is positively known to be unattributed.

### Provider dropped when the record already exists at create

- Trigger: init callback after metadata was pre-created.
- Evidence: `session-metadata-store.ts:1384-1391`.
- Recommendation: in the existing-record branch, set `providerId` through `_saveInternal(..., providerOverride)` when the existing record has none.

### Stale tab.providerId when a restored tab continues on another provider

- Evidence: `tab-manager.service.ts` `setSessionProvider` and `applyResumingSession` are the only writers. `command-center-projection.source.ts:44-50`.
- Recommendation: refresh the provider on session-id-resolved or the first result, or document that live stats are expected to win.

### Activation overwrites the provider of a merely opened session

- See question 2. Evidence: `sdk-agent-adapter.ts:1313-1322`, `chat-session.service.ts` activate path.

### Redundant change events

- `session-metadata-store.ts:1428-1435`: skip the save and the emit when `existing.providerId === knownProviderId`.

## Blocking issues

None.

## Serious issues

### S1. Best-effort provider write can abort a slash-command relaunch

- File: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1698-1703`
- Scenario: storage write or read fails during `updateProvider`, after `executeSlashCommandQuery` has started the query.
- Impact: the user's slash command fails and a launched SDK query is left registered with no stream consumer and no stats run. This is a new failure path for a pure annotation.
- Fix: catch and log the write failure, or move it after the `transform` setup. Apply the same guard at `:1317-1322` so `emitSessionIdResolved` still runs.

## Moderate and minor issues

- Moderate: `create()` ignores `providerId` for an existing record, `session-metadata-store.ts:1384-1391`.
- Moderate: `updateProvider` writes and emits even when the value is unchanged, `session-metadata-store.ts:1428-1435`.
- Moderate: stale `tab.providerId` after a provider change on a restored tab (see failure modes).
- Moderate: `activate:true` resume overwrites an old session's provider with today's workspace provider; confirm when the SDK emits `init`.
- Moderate: missing tests for the failing `updateProvider`, a concurrent write, and a restored tab with a mismatched model.
- Minor: `tab-manager.service.ts` (`setSessionProvider` inserted between the `/** Resume-failure path */` comment and `applyResumeFailure`) leaves that doc comment on the wrong method.
- Minor: `setSessionProvider` clears a list-seeded id when `chat:resume` omits `providerId`. Both come from the same record, so this is consistent today.
- Minor: `chat-types.ts` `providerId` in `TabState` sits between `claudeSessionId` and the gateway link doc, but is otherwise fine. `rpc-chat.types.ts` reuses `ChatResumeResult.providerId` for two meanings (success provider vs AUTH_REQUIRED provider), documented only in a comment.
- Minor: `_saveInternal` makes the existing provider always win over `metadata.providerId`, so `save()` can never change it. This is intended (the override parameter exists), but undocumented on `save`.

## Data flow

1. New session: `startChatSession` passes `providerProfile?.providerId ?? capacityRoute?.providerId` into `createSessionIdCallback` (`:1009-1013`). OK. The callback runs on SDK init with the real UUID, and blank ids are rejected (`:1421`). OK.
2. `create(..., providerId)` writes `providerId` for a new record. OK. Gap: dropped when the record exists.
3. Resume: callback keyed by `realSessionId` after `bindRefused`. OK. `touch` then `updateProvider` are two queue entries, and each is serialised. OK. Gap: unprotected rejection.
4. Slash command: `updateProvider(sessionId)` uses the real session id and a no-op if no record. Gap: S1.
5. `_saveInternal` preserves the existing id on every unrelated `save`, `create` and `touch` (`:662-665`). OK, and the `updateProvider` read-then-write runs inside one queue entry, so there is no lost update. OK.
6. Storage: `indexEntry` and `toSessionRecordInput` copy the whole record minus `cliSessions`, so the repository rows and index carry `providerId`. OK. The Electron `summaryFields` addition only affects one-time legacy migration, and legacy items have no field. Harmless.
7. Readers: `chat:resume` (`chat-session.service.ts:1232`) and `session:list` (`session-rpc.handlers.ts:482`) spread only a truthy id. OK. The resume read happens before activation completes, so it returns the previous launch's provider. Acceptable.
8. Shared: `ChatSessionSummarySchema.providerId` is added with `trim().min(1).optional()`. A whitespace-only id would fail the whole summary parse, but the backend never emits one. `ChatResumeResult.providerId` already existed. OK.
9. Frontend: `applyResumingSession` seeds from the matching list row. `setSessionProvider` runs after `isCurrent`, `requireTargetTab` and the stale-compaction checks, and re-checks `claudeSessionId === sessionId`. OK. `rebindTabSession` and `resetTabToFresh` clear it, and keep it only for the same session id. OK. `sanitizeRestoredTab` trims and bounds. OK.
10. `tabProvider()`: live then model-matched usage then stored. With `model` undefined, `find` matches rows whose `model` is undefined, which is effectively none, so removing the early return is safe.

## Requirements fulfilment

| Requirement                                   | Status   | Gap                                                              |
| --------------------------------------------- | -------- | ---------------------------------------------------------------- |
| Record provider at new-session init           | COMPLETE | Dropped when a record already exists                             |
| Record provider on resumed turn               | PARTIAL  | Skipped for unresolved route; failure path unprotected           |
| Record provider on slash-command relaunch     | PARTIAL  | S1                                                               |
| Return on `chat:resume` and `session:list`    | COMPLETE | None                                                             |
| Frontend tab stores it, used as last fallback | COMPLETE | Stale after provider change on a restored tab                    |
| Old sessions stay unknown                     | COMPLETE | None                                                             |
| Never derive from today's provider on view    | PARTIAL  | Activation relaunch records today's provider (uncertain)         |

Implicit requirements not addressed: a root-only guard, log or observability for a skipped write, rejection-path tests.

## Edge cases

| Case                                   | Handled | How                                             | Concern                                   |
| -------------------------------------- | ------- | ----------------------------------------------- | ----------------------------------------- |
| Blank or null provider id              | YES     | `blankToUndefined`, truthy checks               | None                                      |
| Blank session id                       | YES     | Rejected in callbacks and `updateProvider`      | None                                      |
| Unrelated `save` with stale record     | YES     | Existing id wins in `_saveInternal`             | Cannot change via `save`                  |
| Concurrent `save` plus `updateProvider`| YES     | Same write queue                                | No test                                   |
| Storage write rejects                  | NO      | Propagates to adapter                           | S1                                        |
| Stale resume reply                     | YES     | `isCurrent`, `claudeSessionId` re-check         | None                                      |
| Tab reset or rebind                    | YES     | Cleared unless same session                     | None                                      |
| Corrupt persisted tab value            | YES     | zod trim, min 1, max 128                        | None                                      |
| Fork on resume                         | YES     | No record, no-op                                | Fork has no provider                      |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM-HIGH (the `activate` and SDK `init` timing is unverified)
- Top risk: an annotation write on the slash-command critical path (`sdk-agent-adapter.ts:1698`) can fail the relaunch after the query has started.
- What a robust implementation would add: a try/catch with a logged degradation on the three metadata writes in the adapter; skip the write when the provider is unchanged; set the provider on an existing record in `create`; a rejection-path adapter test and a concurrent-write store test; clarify whether `activate:true` should record the provider.

## Re-review (fix round 1)

Scope: diff of `sdk-agent-adapter.ts` and `session-metadata-store.ts` against S1 and the Moderate items. Specs and checks were taken from the fix-round report; I ran nothing.

| Item | Status | Evidence |
| --- | --- | --- |
| S1 slash-command write aborts relaunch | FIXED | try/catch with `logger.error` at `sdk-agent-adapter.ts` ~1717-1729. `prepared.run` / `statsOwner.beginRun`, `notifyActivity` and `streamTransformer.transform` all still follow, in the original order. |
| Resume write blocks id resolution | FIXED | try/catch at ~1313-1329 sits after `touch` and before `emitSessionIdResolved` and `sessionIdResolvedRegistry.notifyAll`; both still run on failure. |
| `create()` drops provider for an existing record | FIXED | `session-metadata-store.ts` ~1382-1392 applies a non-blank id through the `providerOverride`; blank input keeps the existing id. |
| `updateProvider` writes and emits when unchanged | FIXED | `existing.providerId === knownProviderId` returns before `workspaceId` is set, so no save and no emit (~1430). |
| Concurrent save + updateProvider test | ADDED | Both go through the same write queue; the provider-preserving merge in `_saveInternal` covers the stale-record case. |
| Tab refresh after a provider switch | ACCEPTED as decision | Out of this round's file ownership. Live stats and the model-matched usage row take priority, so the stale value shows only in a narrow window. Acceptable as a follow-up, not a blocker. |
| `activate:true` resume records the launched provider | ACCEPTED as decision | Matches the approved "latest launched provider" policy; reversible. The `init` timing is still unconfirmed, so keep it as a documented follow-up. |

Ordering and delay: the caught writes are still awaited. A write waits only for the metadata write queue, which `touch` in the same callback already waits on. A failure costs one logged error and no skipped step. The only residual risk is a write that never settles, which would also stall the pre-existing `touch`, so it adds nothing new.

New observations from the fix (none Serious):
- Moderate: the new-session init callback now also wraps the original `metadataStore.create` in try/catch (`sdk-agent-adapter.ts` ~1459-1503). Before, a create failure rejected the un-awaited callback and the id never resolved. Now the id is bound and resolved while no metadata record exists, and the only trace is a `logger.error`. The session then runs but is missing from the session list after restart. This goes beyond the provider scope. Either keep it deliberately or limit the catch to the provider argument.
- Minor: an unrelated Prettier reformat of the `sessionBudget` `Pick<...>` type at `sdk-agent-adapter.ts:277-281` is in the diff.
- Minor: `create()` reads `existing` outside the write queue (pre-existing), so a concurrent `updateProvider` could be overwritten by `updated` only for the provider field. The override is applied only for a non-blank id, which keeps this safe.

Updated result: score 8/10, verdict APPROVED. Blocking 0, Serious 0, Moderate 3 open (tab refresh, `activate:true` timing, the create-catch behaviour change), failure modes 4 open.

## Re-review (bounded correction)

Scope: `createSessionIdCallback` in `sdk-agent-adapter.ts` (~1409-1500) and the related spec changes. Nothing was run by me; the pass results are the orchestrator's.

- Failing create: the try/catch is gone. `await this.metadataStore.create(...)` sits directly in the callback again, so a rejection stops the callback before `flushPendingUserActivity`, `emitSessionIdResolved` and `notifyAll`. That is the same as main. The bind and the `statsOwner.rebind` still happen before it, as on main. The "invoked un-awaited" rejection behaviour is therefore unchanged and no new swallowing remains.
- Both branches: `workingDirectory === workspaceId` passes `('created', undefined, blankToUndefined(providerId))`. The other passes `('created', workingDirectory, blankToUndefined(providerId))`. `create()` defaults are `kind='created'` and `workingDirectory=undefined` (`session-metadata-store.ts:1358-1365`), and `create` itself applies `blankToUndefined(workingDirectory) ?? workspaceId`, so passing `undefined` explicitly is identical to omitting it. With no provider, `blankToUndefined(undefined)` is `undefined`, so the store behaves exactly as for main's 3-argument and 5-argument calls.
- Test change: the spec previously asserted the 3-argument call shape (`toHaveLength(3)`). It now asserts the explicit 6-argument shape plus a rejected-create propagation test. That is a legitimate update of a call-shape assertion, not a weakened behaviour check.
- New defects: none found. The long "extra arguments are passed only when the cwd differs" comment was dropped, and it no longer applies.

The earlier open Moderate item about the init-create catch is closed. Remaining open items are only the two accepted decisions (tab refresh after a provider switch, `activate:true` timing).

Final verdict: APPROVED, score 8/10. Blocking 0, Serious 0.
