# Code Logic Review — `TASK_2026_876_4949`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Verdict | REVISE |
| Blocking | 2 |
| Serious | 2 |
| Moderate | 1 |
| Minor | 0 |

The implementation covers the ordinary handoff path, but timing and persistence failures can leave a successful handoff without a durable link, falsely clear a live caller, or misattribute adopted lanes. This is below the 5–6 band because two acceptance-critical outcomes fail silently; it is above the 1–2 band because the basic stop, RPC, and inspector paths are present. Review is static; no tests or builds were run, as requested.

## Findings

### Blocking

1. **A fast successor init permanently loses the chain edge.** `SessionHandoffService` starts the successor at `session-handoff.service.ts:260`, but installs `pending[tabId]` only after `start()` resolves and adoption settles (`:288-294`, `:603-610`). The id-resolved callback immediately returns when the binding is absent (`:613-617`). If the SDK init callback fires during the awaited start, the only resolution event is lost; the successful handoff has no persisted edge and Linked sessions stays absent after restart. Bind before launch with a provisional state, or retain resolved ids until the attempt settles; commit the edge only after success within the deadline and discard both sides on refusal/timeout.

2. **The caller is reported idle even when stopping it fails.** `stopCaller` forces both liveness ids idle at `session-handoff.service.ts:585-595` before awaiting `endSession` at `:597`; failure is only logged at `:598-600`, and the one-shot arm was already removed at `:577-579`. A rejected stop leaves a live SDK process with an idle list dot and no retry. Await a confirmed stop before publishing idle, retain/rearm the stop intent on failure, and keep the UI's live state truthful.

### Serious

3. **Adopted lanes can remain attributed to the placeholder tab id.** A kept handoff emits the reparent event using the successor tab id (`agent-process-manager.service.ts:2151-2156`). The webview resolves tab parents to the SDK id only at `agent-monitor.store.ts:2251-2262`; `reparentAgents` later writes the supplied tab id verbatim (`:2292-2307`). If the successor's `SESSION_ID_RESOLVED` message arrives before `AGENT_MONITOR_REPARENTED`, no later alias pass occurs. The successor's AGENTS section and running cap then omit running lanes. Resolve the incoming parent through a persistent tab→SDK alias in the store, or emit the canonical SDK id when it is known.

4. **Concurrent chain writes can persist stale snapshots.** `appendInner` mutates a shared document and awaits `retryPersist` (`session-handoff-chain.store.ts:230-253`); `retryPersist` passes the mutable `doc.links` to an asynchronous update, then clears `dirty` after its own await (`:343-364`). Two successor resolutions in one workspace can start overlapping updates; an older update completing last can overwrite the newer edge in storage, while memory reports both and `dirty` is false. Serialize read-modify-write per workspace, write immutable snapshots with a generation, and clear dirty only for the latest persisted generation.

### Moderate

5. **The chain store accepts branches and cycles as valid handoff history.** `appendInner` rejects only non-UUID or identical endpoints (`session-handoff-chain.store.ts:206-215`) and checks only exact duplicate edges (`:221-229`). A second edge from the same predecessor, an edge into an already-linked successor, or a cycle is stored; `orderComponent` then supplies a topological order with a fallback for cycles (`:94-144`). The inspector's continued-from/continued-in relation assumes a linear chain, so malformed or conflicting persisted links yield a plausible but wrong direction. Reject an edge if its predecessor already has a successor, its successor already has a predecessor, or it joins nodes already connected. Validate stored documents against the same invariants before showing them.

## Acceptance criteria

| # | Status | Evidence / limit |
| --- | --- | --- |
| 1 | Met | Stop is armed after `start` returns and invoked from broadcaster flush (`session-handoff.service.ts:288-305`, `chat-stream-broadcaster.service.ts:317-334`). |
| 2 | Met with risk | Flush precedes stop on normal and error paths (`chat-stream-broadcaster.service.ts:326-334`, `:352-386`); stop failure handling is defective (finding 2). |
| 3 | Not met | Failed stop can falsely publish idle (finding 2). |
| 4 | Not met | Resolved-id/reparent event ordering can strand lanes under tab id (finding 3). |
| 5 | Met | Timeout/refusal reverts adoption; `remember`, stop arm and chain bind occur only after an on-time success (`session-handoff.service.ts:271-305`). |
| 6 | Met | Inspector derives linked entries outside rail and opens via row action (`session-inspector.component.ts:233-240`, `:335-341`). |
| 7 | Met | Empty chain yields no entries; rail returns null id (`handoff-chain.client.ts:49-53`, `session-inspector.component.ts:233-235`). |
| 8 | Not met | A fast init loses the durable edge; concurrent writes can lose one after restart (findings 1, 4). |
| 9 | Not met | Missing edge or conflicting graph prevents a reliable full linear chain (findings 1, 4, 5). |
| 10 | Met | Tool success text says stopped/history kept (`session-tool-handlers.ts:344-345`). |
| 11 | Met with static evidence | Optional chain and flush dependencies are guarded (`session-handoff.service.ts:159-172`, `:624-625`); no runtime check was run. |
| 12 | Not met | Stored individual edges are Zod-parsed, but their graph invariants are not validated (finding 5). |
| 13 | Not met | Binding is created after init can already have reported the SDK id (finding 1). |

## Five logic questions

1. **Silent failure:** the id-resolved event can arrive before the binding, producing a success response but no chain (`session-handoff.service.ts:260`, `:603-617`). A persistence error also leaves an in-memory edge while `append` returns normally (`session-handoff-chain.store.ts:161-174`, `:362-369`).
2. **Unexpected user action:** open the successor inspector after an early init or after restart; Linked sessions can be absent despite a successful handoff (finding 1).
3. **Wrong input answer:** a stored branch or cycle passes edge shape validation and yields a misleading linear relationship (`session-handoff-chain.store.ts:206-229`, `:94-144`).
4. **Dependency failure:** when `endSession` rejects, the UI may already be idle and the one-shot arm is gone (`session-handoff.service.ts:577-600`). When storage update rejects, the chain remains memory-only without an RPC failure (`session-handoff-chain.store.ts:343-369`).
5. **Missing requirement:** define what the UI should report when the SDK stop or durable chain write fails after the handoff tool has returned success; current behavior reports success and can silently diverge. The implementation should at least preserve truthful liveness and retry/diagnose persistence.

## Decisions

- **Verdict REVISE; reversible:** the explicit criteria require durable real-id links and truthful stopped state. The cited races violate both. No source code was changed.
- **No verification commands:** the user explicitly prohibited tests and builds. Static review cannot establish runtime scheduling or host composition conclusively.
