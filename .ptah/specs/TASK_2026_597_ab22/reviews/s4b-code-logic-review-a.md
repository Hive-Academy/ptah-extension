# Code Logic Review — `TASK_2026_597_ab22` — Phase S4-b part A (compaction core, agent-sdk)

Diff base `ccd8a8a9c..HEAD`, worktree `task-597-s4`. Scope: `helpers/compaction/*` (capper, coordinator + state types, context-usage port, subagent budget monitor), `post-tool-use-hook-handler.ts`, `no-activity-watchdog.ts`, `compaction-hook-handler.ts`, `session-query-executor.service.ts`, `sdk-adapter-events.service.ts`, `session-lifecycle-manager.ts`, `di/register.ts`, plus the outliner bindings in the two host `phase-2-libraries.ts` files. Context read: batches.md § S4 Wave D plan (D.1-D.7, D-6), and the deviation sections of the 25a-28b reports.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Moderate issues     | 4              |
| Minor issues        | 9              |
| Failure modes found | 7              |

Why 6 and not 7: the A8 coordinator is OBSERVE_ONLY as required and every new external call fails open, but the one part of A8 that does act in production, the 300 s compaction dwell in the watchdog, is not gated by OBSERVE_ONLY. It aborts any session whose compaction runs longer than 300 s and reports the abort as a provider outage (S1). Why not 5: the capper keeps the response shape, the port makes one bounded read per turn, the coordinator's state machine is closed, the monitor stops each subagent at most once, and none of the reviewed paths turns an error into a success-looking result.

## Five logic questions

### 1. How does this fail silently?

- **The compaction tap depends on the watchdog.** `CompactionObservingWatchdog.observe` (`session-query-executor.service.ts:355-358`) is the only route by which stream messages reach the coordinator, the port and the subagent budget monitor. If a later change stops passing the watchdog to `StreamTransformer` (`stream-transformer.ts:423`), or skips `observe` on some path, all three stop receiving messages. Nothing errors, and the subagent safety stop simply never fires. No log line marks the loss (Minor m1).
- **Port readings and monitor state stay under the old id after a rekey.** The context-usage port's `lastReadings` and the monitor's sessions keep the pre-PostCompact id. `getLast(newId)` returns `undefined` until the next turn, so the advisor quietly skips one reading (Minor m6).
- **A stopped subagent becomes `completed`.** The registry then deletes the record (`subagent-budget-monitor.ts:388-391`, `subagent-registry.service.ts:310-328`). Anything that later looks up the record treats it as finished normally, not as stopped (Minor m5).

### 2. What user action produces unexpected behaviour?

- **A long compaction aborts the session.** On a slow route (proxy, local model, a 1M window), a user who lets a compaction run past 300 s sees the session aborted with "No stream activity for 180s — no response from provider … The provider may be unreachable". The provider was in fact compacting, and the retry hits the same bound again (S1).
- **A large file Read shows wrong line numbers.** The model receives the outline in `file.content`, but `startLine`, `numLines` and `totalLines` keep their original values. If the CLI numbers the content lines, the numbers the model sees do not match the file (M1).
- **Disabling compaction does not stop the subagent monitor.** A user who sets `compaction.enabled=false` still has subagents stopped at 150k context, because neither the monitor nor the capper reads `enabled` (M4).

### 3. What input data produces a wrong answer?

- **Whole-file Read over budget:** the outlined body is renumbered from `startLine` (M1).
- **Subagent usage without the `cache_creation` split** (some proxy providers): cache writes are priced at 1.25 even when the effective TTL is 1h (2.0), so `weightedUsed` is too low. Bounded and rare (Minor m3, known item 3).
- **A hand-edited invalid budget value:** `readBudget` writes a warn line on every `getConfig()` call. The capper calls it on every tool call and the monitor on every subagent assistant message (`compaction-config-provider.ts:160-171`, `subagent-budget-monitor.ts:257`), which floods the log (Minor m7).

### 4. What happens when a dependency fails?

- **`getContextUsage` hangs or throws:** the read is bounded at 5 s, logs the error type, and the turn gets no reading (`context-usage.port.ts:135-162`). The turn is unaffected because the executor does not await the read (`session-query-executor.service.ts:310-322`). Correct.
- **The capper or the outline reducer throws:** `cap` catches the error and returns the original response (`tool-output-capper.ts:139-149`), and the hook catches it a second time (`post-tool-use-hook-handler.ts:107-124`). The spool write never throws, and its trailer says "full output could not be saved" (`apply-output-budget.ts:417-418`). Correct. The hook does have no time bound and ignores the abort signal (Minor m8).
- **Coordinator listener throws:** it is rethrown through `queueMicrotask` (`compaction-coordinator.ts:289-291`) as a process-level uncaught exception. The only subscriber today, `SdkAdapterEvents`, goes through `safeEmit`, which catches. A future subscriber that throws would reach the host's `uncaughtException` handlers (Minor m9).
- **`stopSubagent` fails:** the monitor logs it, sends no handoff and does not retry (`subagent-budget-monitor.ts:372-385`). **The parent push fails or times out:** it logs a warning (`:400-414`). Neither error is swallowed, but a failed stop is never retried, so the over-budget subagent keeps running with no further signal.

### 5. What is missing that the requirements never mentioned?

- The dwell bound is not scoped to sessions where the coordinator acts, and its timeout has no message of its own (S1).
- The tap and monitor release only on abort. A run that ends without an abort keeps its state (M2).
- Spooled raw Bash, Grep and MCP output goes into `<cwd>/.ptah/tmp/mcp-out/`, inside the user's repository (M3).
- The subagent stop has no kill switch (M4).
- The handoff message carries no task description. This is a known 28a deviation.

## Failure modes

### FM1 — Dwell timeout kills a healthy slow compaction (S1)

- Trigger: a compaction stays open for 300 s or more, on any session class.
- Symptom: the session is aborted with an error that blames the provider (`session-query-executor.service.ts:520-551`), and the compaction is lost. On the next turn the context is still over the threshold, so the compaction starts again and hits the same bound.
- Evidence: `no-activity-watchdog.ts:244-271` (`dwellExceeded` falls through to `onTimeout`); `compaction-state.types.ts` `COMPACTION_MAX_DWELL_MS = 300_000`. The watchdog does not check the coordinator state: every session registers OBSERVE_ONLY (`session-query-executor.service.ts:495-504`, `e2Passed: null`), yet the dwell bound still applies.
- Current handling: hard abort.
- Recommendation: see S1.

### FM2 — Outline renumbered as file lines (M1)

- Trigger: a whole-file Read over `toolOutputBudgetTokens`.
- Symptom: the model reads outline line N as file line N. The code reducer keeps lines verbatim and adds only `… N lines omitted …` notes (`code.reducer.ts:17`), with no source line numbers.
- Evidence: `tool-output-capper.ts:296-306` (only `content` is replaced); `:380-387` (outline body).

### FM3 — Per-session state outlives a run that ends without an abort (M2)

- Trigger: the stream ends (normal end of a one-shot query, child exit) and nothing calls `abort()`.
- Symptom: the coordinator record and the monitor's session state stay in memory. A resumed run reuses the stale coordinator record, because `bind` skips `register` when `getState` is defined (`session-query-executor.service.ts:290-301`).
- Evidence: the only release trigger is `session-query-executor.service.ts:508-512`. `StreamTransformer`'s `finally` calls only `activityWatchdog.stop()` (`stream-transformer.ts:881-885`). The port has a second release through the session-end registry (`context-usage.port.ts:86`); the coordinator and the monitor do not.

### FM4 — Raw tool output spooled into the user's workspace (M3)

- Trigger: Bash, Grep or third-party MCP output over budget.
- Symptom: a raw copy, which may include secrets such as env dumps or tokens in logs, is written to `<cwd>/.ptah/tmp/mcp-out/*.txt` and kept for up to 24 h (`spool.ts`). It can be committed if `.ptah/tmp` is not gitignored. Before this phase the spool held only Ptah's own MCP output; it now also covers built-in tools.
- Evidence: `tool-output-capper.ts:422-436` (`spoolRoot: cwd`).

### FM5 — Subagent stop with no opt-out (M4)

- Trigger: any subagent request with `input + cache read + cache write >= 150_000`.
- Symptom: the subagent is stopped, marked `completed`, and the parent gets an extra user turn. `compaction.enabled=false` has no effect.
- Evidence: `subagent-budget-monitor.ts:257-270`; no check of `enabled` anywhere in the monitor or the capper.

### FM6 — Stop fails, no retry

- Trigger: `dispatcher.stopSubagent` rejects.
- Symptom: `stopFired=true` is set before the attempt (`subagent-budget-monitor.ts:370`), so the subagent is never stopped again. It runs on past both limits, and the only trace is one warning.
- Recommendation: Minor. Either accept this and record it, or reset `stopFired` on failure with a retry cap.

### FM7 — Handoff push not ordered with steering pushes (known item 2)

- Trigger: a user steers the parent session (`sendToSubagent`, `subagent-message-dispatcher.ts:191`) in the same tick as a monitor stop.
- Symptom: the two single-message `streamInput` calls can reach the CLI in either order. Each message is whole; only their order is undefined. Minor m2.

## Blocking issues

None.

## Serious issues

### S1 — The 300 s compaction dwell aborts every session class, ignores OBSERVE_ONLY, and blames the provider

- File: `libs/backend/agent-sdk/src/lib/helpers/no-activity-watchdog.ts:244-271`; abort path at `session-lifecycle/session-query-executor.service.ts:516-559`.
- Scenario: a compaction takes 300 s or longer. TASK_2026_411 B8 measured 213-216 s on the direct route, so the margin is 84 s. Proxy, local and large-window routes have no measurement at all. Activity during the compaction does not reset the bound: `arm()` always caps the delay at the dwell remaining (`:244-249`).
- Impact: the user loses the turn and sees a misleading "provider may be unreachable" error. Because the context is still over the threshold, the next turn compacts again and is aborted again, so the session cannot recover on that route. This reverses B8's documented "never impose a runtime limit" for every session, while D.3 and the executor comment (`:495-496`) describe A8 as observe-only today. D-6 accepted the value of 300 s; it did not decide that the bound applies to OBSERVE_ONLY sessions.
- Fix, smallest first:
  1. Only enforce the dwell abort when the coordinator acts on the session. Pass a flag such as `enforceCompactionDwell` into the watchdog from the tap's registered state, so that OBSERVE_ONLY keeps B8's "report overdue, keep waiting".
  2. Give the dwell timeout its own error text, for example "Compaction did not finish within 300s", instead of the 180 s no-activity message.
  3. Optionally exempt `capacityRoute.kind === 'proxy'` until it has been measured.

## Moderate and minor issues

Moderate (record; under decision 11, none of these breaks a lane config or loses data, so a fix in this round is optional):

- **M1 — whole-file Read outline numbered as file lines.** `tool-output-capper.ts:296-306, 380-401`. Fix: prefix the kept lines with their source line numbers, or replace `startLine`/`numLines`, or make the trailer state that the line numbers are outline positions. Uncertainty: I did not confirm the CLI's Read renderer from source. The inference rests on the fact that only `content` is replaced while `startLine`/`numLines`/`totalLines` are copied unchanged.
- **M2 — tap, coordinator and monitor released only on abort.** `session-query-executor.service.ts:508-512`. Fix: also release from an overridden `stop()` in `CompactionObservingWatchdog`, which `StreamTransformer` calls on every teardown path. Alternatively, subscribe the coordinator and the monitor to `SessionEndCallbackRegistry` as the port already does (`context-usage.port.ts:86`). Uncertainty: I did not trace whether every natural stream end leads to `endSession` → `abort()`.
- **M3 — raw spool of non-Ptah tool output inside the workspace.** `tool-output-capper.ts:427`. Fix: spool built-in and third-party output to the OS temp directory (`spoolLocation` already supports a temp root), or make sure `.ptah/tmp/` is gitignored before writing. Uncertainty: I did not check whether Ptah writes a `.gitignore` for `.ptah/tmp`.
- **M4 — subagent handoff stop is active by default with no kill switch, and `compaction.enabled` is ignored.** `subagent-budget-monitor.ts:257-270`. The plan (D.4 10.1) asks for the stop, but A8 ships observe-only while this ships acting. Fix: gate the stop on `compaction.enabled` or a dedicated flag, or record the decision explicitly.

Minor:

- **m1 (known item 1) — tap through a watchdog subclass.** `session-query-executor.service.ts:345-359`. It is correct today: every stream message passes `stream-transformer.ts:423` before any other processing, `tap.observe` is guarded by try/catch (`:206-213`), and `super.observe` runs first, so watchdog behaviour is unchanged. The risk is the hidden coupling described in Q1. Prefer an explicit `onMessage` hook on `StreamTransformer`, or add a spec that pins "the tap sees `result`, `status` and `compact_boundary` through the transformer".
- **m2 (known item 2) — handoff push outside `serialisedPush`.** `subagent-message-dispatcher.ts:95-112` serialises only `sendToSubagent` pushes, not the main prompt pump. Bypassing it affects only the relative order of two whole single-message pushes. The handoff also omits `origin` (`subagent-message-dispatcher.ts:205` sets it), so the CLI may classify the message differently from a steering message. Exporting a `pushParentMessage` from the dispatcher would fix both.
- **m3 (known item 3) — omitted TTL.** `subagent-budget-monitor.ts:172-175`; `session-query-executor.service.ts:229-249`. The fallback weight applies only when `cache_creation` is absent. In that case the undercount is at most 0.75 × cacheWrite per request on a 3,000,000 stop limit, and the context-based handoff stop at 150k usually fires first. Record it; thread `subagentTtl.effective` through later.
- **m4 (known item 4) — 26b catch restructure.** `context-usage.port.ts:151-162`. No error is swallowed: the catch logs the error class, sets `failed`, and the port returns `undefined`, which the executor treats as "no reading" (`session-query-executor.service.ts:315`). A synchronous throw from `accessor(...)` is inside the `try`. The race attaches handlers to the losing promise, so a late rejection after the timeout is not unhandled. No change needed.
- **m5 (known item 5) — `completed` as "not resumable".** `subagent-budget-monitor.ts:388-391`. Effects:
  1. The record is deleted at once (`subagent-registry.service.ts:327`), so a later SubagentStop or `task_notification` update for that tool call finds nothing (debug log only).
  2. If the parent is in teardown and the record is already `interrupted`, the update is ignored and the record stays resumable (`:314-326`). That is an edge case that contradicts "never offered for resume".
  3. The record's `lastActivityAt` and agent id are gone before the Task tool result arrives. Normal completion deletes at about the same moment, so this is comparable.
  The model is told the truth by the handoff message. A dedicated `stopped` status would be more honest; record it.
- **m6 — PostCompact rekey covers only the coordinator.** `compaction-coordinator.ts:213-224` against `context-usage.port.ts:76-78` and the monitor's `sessions` map. `getLast(newId)` misses for one turn.
- **m7 — `getConfig()` per tool call and per subagent message,** with a debug line each time and a warn line per invalid key (`compaction-config-provider.ts:145-171`). Cache the value per turn, or warn once.
- **m8 — PostToolUse cap has no time bound and ignores `options.signal`** (`post-tool-use-hook-handler.ts:69-72, 100-125`). A slow tree-sitter outline holds the tool result until the SDK's hook timeout.
- **m9 — coordinator rethrows listener errors via `queueMicrotask`** (`compaction-coordinator.ts:283-293`). This becomes an uncaught exception in the extension host or Electron main. Log through a logger instead.
- Note: ARMED is unreachable in practice. `shouldInitiateCompact` is not in `CompactionCoordinatorSink` (`session-query-executor.service.ts:138-147`), and every session is OBSERVE_ONLY. If a class ever acts, ARMED is never cleared by `onTurnEnd` (`compaction-coordinator.ts:195-206`) and waits for PreCompact. This is consistent with OBSERVE_ONLY; record it for the E2 follow-up.

## Data flow

1. A tool finishes → PostToolUse hook → `capper.cap` (`post-tool-use-hook-handler.ts:75`). OK: fail-open, same reference when nothing changed, and `updatedToolOutput` is supported for all tools in SDK 0.3.278 (`sdk.d.ts:2579`). Gap: M1 for Read.
2. `capSlots` splits the budget and calls `applyOutputBudget` → spool → trailer. OK: the spool never throws and the trailer is honest. Gap: M3.
3. The fan-out runs on the raw `tool_response` (`post-tool-use-hook-handler.ts:131-160`). OK: exit-code derivation is unchanged.
4. Stream message → `StreamTransformer` → `CompactionObservingWatchdog.observe` → tap. OK. Gap: m1.
5. The tap binds the root `session_id`, then calls `coordinator.register` → OBSERVE_ONLY (`e2Passed: null`). OK. The state is logged once.
6. `status:'compacting'` / `compact_boundary` → coordinator: a no-op under OBSERVE_ONLY. The watchdog opens and closes `compactingSinceMs`. Gap: S1.
7. Root `result` → `onTurnEnd`, then one port read keyed `runToken:turn`. OK: once per turn, deduplicated, not awaited, and a release during the read is not undone (`context-usage.port.ts:100-106`).
8. Subagent message (`parent_tool_use_id`) → `monitor.observe(parentSessionId, msg)`, fire-and-forget with a catch (`session-query-executor.service.ts:229-250`). OK. Same-`message.id` replacement prevents double counting. `stopFired` is set synchronously before the first await, so there is no double stop.
9. Stop → `dispatcher.stopSubagent` → registry `completed` → parent `streamInput`, bounded at 10 s. Gaps: m2, m5, FM6.
10. Session end → abort → `tap.release` → coordinator unregister, port release, monitor release. Gap: M2 when no abort happens.
11. PreCompact/PostCompact hooks → coordinator `onPreCompact` / `onPostCompact` rebind (`compaction-hook-handler.ts:364-367, 479-493`). OK: fail-open with one warning. Gap: m6.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| A3 capper, shape-preserving (AS9), fail-open, Ptah MCP excluded | COMPLETE | M1 (Read line numbering), M3 (spool location) |
| Outliner optional; hosts bind `SDK_CODE_OUTLINER` | COMPLETE | Lookup happens at the capper's first resolution; the bindings are lazy factories |
| A8 coordinator state machine, OBSERVE_ONLY default | COMPLETE | ARMED never consumed (note) |
| 26.2 single per-turn port read, cached per session and turn | COMPLETE | Not rekeyed on PostCompact (m6) |
| 27.1 watchdog compaction bound, 300 s (D-6) | PARTIAL | Applies to OBSERVE_ONLY sessions; misleading timeout text (S1) |
| Session-end release of per-session state | PARTIAL | Abort-only for the coordinator and the monitor (M2) |
| 10.1 per-subagent `contextTokens`/`weightedUsed` + safety stop via `stopSubagent` | PARTIAL | TTL fallback (m3); stop failure not retried (FM6) |
| 10.2 advice function | COMPLETE | — |
| Handoff to parent | PARTIAL | No ordering lock or `origin` (m2); no task description (known deviation) |

Implicit requirements not addressed: an opt-out for the acting subagent stop (M4); a dedicated timeout message for the compaction dwell (S1).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Tool response of unexpected shape (string Bash output, image Read, notebook) | YES | `isObject` / field checks pass the response through | — |
| MCP mixed text and image blocks | YES | Only `type:'text'` blocks are rewritten, by index | `structuredContent` left uncapped |
| Spool write fails | YES | Trailer says "could not be saved" | — |
| `getContextUsage` missing, hanging or malformed | YES | Debug or warn line, 5 s bound, shape check | — |
| Two port reads for one turn | YES | `turnId` cache | — |
| Release during an in-flight port read | YES | Identity check before caching | — |
| Repeated `message.id` across content blocks | YES | Replaces the previous share | — |
| Over budget before the task id is known | YES | Deferred, logged once, retried on the next message | — |
| Stop fails | PARTIAL | Logged | Never retried (FM6) |
| Compaction longer than 300 s | NO | Abort | S1 |
| Stream ends without abort | NO | — | M2 |
| PostCompact id change | PARTIAL | Coordinator rekeyed | Port and monitor not rekeyed (m6) |
| Coordinator listener throws | PARTIAL | Microtask rethrow | m9 |

## Verdict

- Recommendation: REVISE (one Serious).
- Confidence: MEDIUM. Every changed file in scope was read through its diff. The CLI's Read rendering (M1) and the natural-end abort path (M2) are inferred, not traced.
- Top risk: the 300 s dwell aborts real compactions on every session class, including the OBSERVE_ONLY default, and reports them as a provider outage, which can wedge a session on slow routes.
- What a robust implementation would add:
  - a dwell abort gated on the coordinator acting, with its own error text;
  - release on `stop()` or through the session-end registry for the coordinator and the monitor;
  - source line numbers, or adjusted metadata, in Read outlines;
  - an OS-temp spool for non-Ptah tools;
  - a kill switch for the subagent stop;
  - a dispatcher-exported `pushParentMessage` that shares the lock and `origin`;
  - the effective subagent TTL threaded through to the monitor.
