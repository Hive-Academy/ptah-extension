# Code Logic Re-review 10d-L r1

Verdict: APPROVED. Score: 8.5/10. BLOCKER: 0. MAJOR: 0. MINOR: 4.

Scope: the uncommitted diff for batch R (codex-app-server-lane.adapter.ts and its spec) and batch N (codex-chat-adapter.ts, codex-chat-turn-stream.ts, agent-process-manager.service.ts, lane-completion-notifier.service.ts, lane-completion-outcome.ts, lane-outcome-recorder.service.ts). I did not re-read batch M. Nothing was run; this is static review only.

## Batch R: close retry and writer registry

- Once-only success: `close()` returns the cached `closePromise` (codex-app-server-lane.adapter.ts, `close` around L309-330). A second or concurrent caller gets the same promise, so there is no double close.
- Retry on failure: `closePromise` is cleared when `released` is false. `closeContext` removes its entry from `closePromises` in the `.catch` before rethrowing. Both caches therefore reset on failure, and the next `close()` retries the real `opened.close()`. The spec "refuses resume when the old writer cannot close" shows close called twice, the second succeeding.
- A failed close keeps the writer registered. The registry delete only runs on the success branch, and the resume path restores `previous` over the reservation (`this.writers.set(resume.threadId, previous)`). No stale reservation remains.
- Every reservation exit path was traced:
  - Open fails with a non-config error: the catch calls `close()` and then deletes the entry only if it is still `reservation`.
  - Config-retry fails: same cleanup.
  - Open succeeds: the writer replaces the reservation under the `prior !== reservation && prior !== writer` guard.
  - Abort during startup: the `closed || aborted` check after `set` deletes the writer, and the abort listener's `close()` deletes it if registration already happened.
  - Close of the previous writer fails: `previous` is restored.
  - Identity mismatch before registration: the outer catch deletes the reservation.
- Concurrency: the `isBusy` check and the reservation `set` are synchronous, with no `await` between them. The second resume therefore sees the reservation (`isBusy` is true) and gets `CodexLaneWriterConflictError`.
- Specs:
  - The concurrent-resume spec gates `oldContext.close`, awaits `closeStarted`, and issues the second resume while the first is mid-close. It asserts one close and `open` called twice in total. This is a real race.
  - The abort-during-registration spec hooks `writers.set` to call `writer.close()` immediately after registration. This exercises the `closed` re-check.
  - The "clears a reservation after open fails" spec asserts `writers.has` is false.

MINOR 1 (adapter L430-440): if `close()` returns false on the open-failure path, the reservation is still deleted. The context may then be left open and unregistered. This is a narrow double-fault; log-only is acceptable.

MINOR 2: when `previous.close()` fails, the old lane is left half-closed (`closed` is true and its abort controllers have fired) but is re-registered as a live writer. Retry works, but a follow-up send to that lane would fail. This is acceptable and mildly confusing.

## Batch N: codex-chat-adapter sendMessageToSession

Option keys of `AIMessageOptions` (libs/shared/src/lib/types/ai-provider.types.ts L88-115), with Claude's handling from `SdkAgentAdapter.sendMessageToSession` (sdk-agent-adapter.ts L1806-1830):

| Key | Claude | Codex now |
| --- | --- | --- |
| files | forwarded | handled |
| images | forwarded | handled |
| clientMessageId | forwarded | handled |
| admission | forwarded (`require-idle`) | handled via `publishUntilAdmitted` |
| origin | forwarded; peer renders `inboundPeer` | peer handled; other kinds ignored (see MINOR 3) |
| model, temperature, maxTokens, correlationId, timeout, streaming, metadata | not forwarded (ignored) | ignored |

Dropping the refusal therefore introduces no new silent drop relative to Claude. The keys that Codex now ignores are also ignored by Claude.

- Peer label: Claude uses `origin.name?.trim()` if non-empty, else `NEUTRAL_PEER_LABEL` ('peer session') (sdk-message-transformer.ts L84-92). Codex uses `origin.name?.trim() || 'peer session'`. They are equivalent, and neither uses `from`.

MINOR 3: `origin.kind` values `channel`, `task-notification` and `coordinator` are accepted but have no effect on Codex. They are delivered as plain user text, and Claude also stamps the SDK message with the origin. Claude's transformer drops the echo for those kinds (L335 area), so rendering is similar. The provenance stamp is lost, though. This is acceptable now; document it, or log a debug line.

MINOR 4:
- Codex validates peer `from` as `min(1)`, which Claude does not. An empty `from` makes the send throw `messageOptions`. This is stricter, but it does fail loudly.
- When both `inboundPeer` and `clientMessageId` are present, the peer branch wins and the `codex-user:` echo is skipped. Claude keeps `beforeClientMessageId`. Peer messenger sends carry no `clientMessageId`, so there is no practical impact.

## Batch N: parent session map, notifier and outcome

- The `resolvedParentSessions` map is capped at 256. `delete` then `set` gives recency ordering, and eviction removes the oldest key. `dispose` clears it. Tab reuse overwrites the mapping on every `resolveParentSessionId`, and blank ids are rejected earlier in the function. Real ids not in the map pass through unchanged.
- The map is applied at both `AgentProcessInfo` construction sites (spawn and ptah-cli).
- A lane spawned from a reused tab before the new real session id resolves would map to the previous conversation's session. The window is tiny, because the SDK init message precedes tool use. I treat this as accepted risk.
- Outcome `parentSessionId` is persisted only when `SessionId.safeParse` succeeds and the adapter reports the session active; otherwise it is null. The recorder uses `input.parentSessionId ?? null`. The behaviour is conservative and correct.
- Notifier: `isSessionActive` now runs before the outcome enqueue. It was previously called after the refusal checks. `RoutingAgentAdapter.adapter()` can throw for an unsupported runtime. If it did, `signal()` would abort after `remember(key)`, with no outcome and no delivery. That is the closed union's unreachable default, so it is very unlikely. Wrapping the call in try/catch would be cheap hardening, but this is not blocking.

## Five questions, brief

1. Silent failure: none new. A failed close is logged and surfaces as a typed error on resume.
2. Odd user action: two simultaneous resumes of one thread. The second gets a typed conflict, and the registry is clean.
3. Wrong answer from input: peer message with no name renders as 'peer session', matching Claude.
4. Dependency failure: `context.close` rejects, retry is possible and the writer stays registered.
5. Missing: origin kinds other than peer have no Codex effect (MINOR 3).

## Verdict

APPROVE. All earlier findings I could map to these two batches are addressed, and no new BLOCKER or MAJOR defect was found. Confidence: MEDIUM-HIGH, since this is static reading without running specs.
