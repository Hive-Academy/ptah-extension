# Code Logic Re-review — `TASK_2026_678_9083` Phase B fix round (8FA–8FE)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 2 |
| Reviewer family | grok |
| Implementer family | codex (8FA–8FE) |
| Range | 5d52cfa5b..HEAD |

S1–S7 and M1–M3, M5–M7 are closed against Decision D18–D22 and the 8FA–8FE task text. Amendment A1 holds on the paths that answer the question: the discovery answer is the fixed non-Confirm sentence, and timeout, decline, a bad proposal, and a consumed id do not call `sendLaunchTurn`. Tests, typecheck, and lint were not re-run (the task forbids `nx` and Jest). One new Serious issue: `pageExit` drops an answered proposal while `confirm` is still awaiting discovery, and that in-flight confirm still sends the launch turn.

## Finding re-check

| ID | Status | Evidence (file:line) | Pinning spec (file:line or "no spec") |
| --- | --- | --- | --- |
| S1 | CLOSED | `open` answers only after `rosterIsAvailable` (`tribunal-run-coordinator.ts:138-147`), then `answered` (`:158`). Post-answer failures return retryable and leave the entry in place (`:160-186`, `:203-208`, `:232`). `specTaskId` is kept (`:178-186`); `runId` is assigned once (`:188`). Role is omitted when absent (`:195-198`). Failed send calls `removeManifest` then one `failure()` (`:215-232`, `:235-240`). Only `terminate` consumes, and only for `launched` or `declined` (`:221`, `:242-249`). | `batches.md:129`, `:1455-1484` |
| S2 | CLOSED | A pending, answered, or consumed id declines `context.questionId` / `context.questionKey` and returns null. The map is not written (`tribunal-run-coordinator.ts:85-92`). | `batches.md:1462-1463` |
| S3 | CLOSED | Marked tab with a session id, `messages.length === 0`, and `hasLiveSession` falsy calls `switchSession(id, { targetTabId })`. `running` is set only after it resolves. A throw toasts and returns null; the tab is not unmarked (`session-coordinator.ts:73-96`). A completed resume is not this state: `switchSession` throws when `chat:resume` has no events (`session-loader.service.ts:1123-1132`) and `applyResumingSession` only clears messages for the duration of that load (`tab-manager.service.ts:2776-2784`). One coordinator cannot re-enter `openOrResume` while its own load is in flight (`session-coordinator.ts:42-52`). | `batches.md:1345-1348` |
| S4 | CLOSED | Another tab from `findTabBySessionId` is switched to, toasted, and returned as null with no create and no attach (`session-coordinator.ts:107-114`). Otherwise `switchSession(SessionId.from(id), { targetTabId: TabId.from(tabId) })` (`:118-121`). `ChatStore.switchSession` forwards `opts`, including `targetTabId` (`chat.store.ts:223-227`). | `batches.md:130`, `:1338-1344` |
| S5 | CLOSED | `ProposalAvailability` is required (`tribunal-roster-proposal.ts:39-42`, `:99-104`). `rankAvailableLanes` drops `AT LIMIT` and disabled CLIs (`:44-52`). `parseRosterProposal` rejects unless `rosterIsAvailable` (`:128-130`), which requires every lane's id and cli, rejects `AT LIMIT`, and rejects disabled CLIs (`:83-95`). `confirm` checks availability again before the answer (`tribunal-run-coordinator.ts:139-143`). | `batches.md:1432-1438` |
| S6 | CLOSED | `newCommandCenter` calls `stopVoiceLocally` (`session-coordinator.ts:171`), which releases the lock, sets `voiceState` to `'idle'`, and calls `resetLevels` (`:194-197`). `mute` stays `'muted'` and zeroes meters (`:187-191`). `stop` stays `'stopped'` and zeroes meters (`:210-212`). | `batches.md:130`, `:1362-1365` |
| S7 | CLOSED | Every run emits `lane:<runId>:<laneId>` under `tribunal:<runId>` (`work-projection.ts:123-143`). `kind` `none` or `unavailable` emits `phase:<runId>:stage` with the run state (`:168-176`). Relay and crucible keep their phase nodes (`:146-167`). A lane agent whose `agentId` matches parents under that lane (`:179-196`). | `batches.md:133`, `:1569-1575` |
| TL-1 / M1 | CLOSED | `runs` is stored by `runId` (`command-center-records.ts:125-133`). Read keeps an entry whose key is `runId` or `rootTabId` and re-keys it by `runId`; other entries are skipped (`:64-72`). `readRunManifests` filters by root and sorts by `startedAt` (`:116-122`). `removeRunManifest` / `removeRunManifests` delete one run or one root (`:136-147`). | `batches.md:1161-1168` |
| TL-2 / M2 | CLOSED | Lane `role` is `nonEmpty.optional()` (`command-center-records.ts:18`). The coordinator writes `{ laneId }` when `role` is absent and never `''` (`tribunal-run-coordinator.ts:195-198`). The coordinator spec writes a role-less Council manifest through `CommandCenterRecordsService` (`tribunal-run-coordinator.spec.ts:102-121`). | `batches.md:132`, `:1182-1186`, `:1492-1493` |
| TL-3 / M3 | CLOSED | Confirmed close of a tab with a Command Center origin calls `removeRunManifests(workspace, tabId)` and passes the boolean to `recordCommandCenterWrite` as `'runManifest'` (`tab-manager.service.ts:75`, `:1417-1426`). Cancel returns first (`:1371-1373`). A tab that left the active list returns first (`:1380-1381`). The close path does not write last-session. | `batches.md:1195-1198` |
| M5 | CLOSED | `resetLevels` sets both levels to 0 and `lastLevelUpdateAt` to null (`command-center.store.ts:150-154`). `updateLevels` still returns inside 500 ms (`:140-144`). | `batches.md:1372-1374` |
| M6 | CLOSED | Persisted children whose session id is absent from the live map get `'unknown'` (`work-projection.ts:71-83`). A live child with that session id is the only candidate, so it wins (`:66-70`, `:77-78`). `'unknown'` is on `CommandWorkState` (`command-center.store.ts:15-23`). | `batches.md:1576-1577` |
| M7 | CLOSED | `success` with a `sessions` array returns found/not-found (`session-coordinator.ts:147-150`). `success` without an array falls through, retries, then returns null (`:147-162`). The caller toasts and does not call `newCommandCenter` (`:102-104`). | `batches.md:1350-1351` |

## New issues

### Serious — page exit does not stop an in-flight confirm, so the launch turn still goes out

- File: `libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.ts:111-116`, `:160-161`, `:203-232`, `:123-124`, `:251-253`
- Scenario: The card calls `confirm`. Availability passes and `answer` delivers `CONFIRMED_DISCOVERY_ANSWER`, so the entry is `answered` and `inFlight` holds the promise (`:144-158`, `:125-130`). `discoveryComplete()` is still pending. `pageExit()` sees `answered` and deletes the pending entry (`:115`). It does not cancel the promise. When discovery resolves, `confirmEntry` still has the object and calls `writeManifest` and `sendLaunchTurn` (`:203-219`). A paid launch is sent after the page dropped the proposal. If the send then returns false, the method returns `{ ok: false, retryable: true }` (`:232`) but the entry is neither pending nor consumed, so the next `confirm` hits `:123-124` and returns `not-launchable` (not retryable) and calls `reportFailure` again. `decline` and `timeout` also return without cancelling once the entry is `answered` or in flight (`:251-253`); that part matches "act only on open entries". Concurrent `confirm` calls do share one promise (`:119-121`); that part is fine.
- Fix: Remember that `pageExit` dropped the id. After each await, if the id is no longer pending, skip `sendLaunchTurn`, roll back a manifest already written for `entry.runId`, and do not report the result as retryable.

### Moderate — last-write dedup lets a persisted provisional id hide the live row

- File: `libs/frontend/command-center/src/lib/model/work-projection.ts:60-64`, `:66-83`, `:95-107`, `:202`
- Scenario: Live child `{ tabId: 'temporary', sessionId: 'child-sdk', parentSessionId: 'root', state: 'running' }` and persisted child `{ sessionId: 'temporary', parentSessionId: 'root' }`. The persisted id is not in `childBySession` (that map is keyed by `child-sdk`), so it stays, with state `'unknown'`. `canonical('temporary')` is `child-sdk`, so both candidates emit `child:child-sdk`. The `Map` keeps the later write. The node state is `'unknown'`.
- Fix: Key the persisted filter and the dedup by `canonical(sessionId)`, and when two candidates share a node id keep the live state over `'unknown'`.

### Moderate — a root key and a run key for one run: the later object key wins

- File: `libs/frontend/chat-state/src/lib/command-center-records.ts:64-72`
- Scenario: Stored `runs` contains both `runs[<runId>]` (newer `startedAt`, new lanes) and `runs[<rootTabId>]` (same `runId`, older body). Both keys match. `Object.entries` assigns `empty.runs[runId]` twice. If the root key is enumerated last, `readRunManifests` returns the older manifest and the newer body is gone. The writer does not persist both shapes; a mixed record still loads this way.
- Fix: When the destination `runId` is already filled, keep the entry whose stored key is `runId`, or the greater `startedAt`. Do not let a root-keyed body replace a run-keyed body.

### Minor — `removeManifest` false is ignored

- File: `libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.ts:227-232`
- Scenario: `sendLaunchTurn` returns false and `removeManifest` returns false. The method still reports `launch-send-failed` and stays retryable. The manifest remains until a later `writeManifest` replaces that `runId`. A throw is caught and follows the same path, which the rollback comment allows; the boolean is not.
- Fix: If `removeManifest` returns false, keep the launch-send failure and leave the same `runId` for the retry rewrite (already true). Surface the false only if a later reader must not see a run that never launched; the smallest code change is to retry the remove once or treat false like the catch and still return `launch-send-failed`.

### Minor — Decline's boolean is ignored on receive and on lanes-unavailable

- File: `libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.ts:90`, `:140-142`, `:254-255`
- Scenario: A duplicate `receive` calls `answer(..., 'Decline')` and returns null even when that call returns false, so the new question stays open until the host times out. On `lanes-unavailable`, a false Decline still `terminate`s the id. The host question stays open until its Decline-first timeout. No launch is sent from those paths. The confirm-answer path does check both deliveries (`:149-156`).
- Fix: On `receive`, if Decline returns false, leave the first entry untouched (already true) and do not pretend the new question is closed. On `lanes-unavailable`, if Decline returns false, stay `open` and retryable, matching the undelivered-answer branch.

Checked and not filed: concurrent `confirm` shares one promise and clears it on settle (`tribunal-run-coordinator.ts:119-130`). A launch-send retry reuses `entry.runId` (`:188`) and `writeRunManifest` replaces that key (`command-center-records.ts:132`). The S3 condition does not re-load a tab whose restore already replayed events. Timeout and decline do not call `sendLaunchTurn`. The fixed discovery answer does not contain Confirm, yes, approve, or proceed (`tribunal-run-coordinator.ts:14-15`). No launch starts from `timeout` or from an auto-resolve symbol; nothing in this range references `ASK_USER_QUESTION_AUTO_RESOLVED`.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the closed findings and for the in-flight `pageExit` path; MEDIUM only on whether D18's "without sending a turn" was intended to mean "do not Decline" rather than "do not launch"
- Top risk: the user confirms, leaves the page while discovery is still finishing, and the coordinator sends the launch turn anyway

Verdict: NEEDS_REVISION
