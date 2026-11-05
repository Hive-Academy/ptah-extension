# Code Logic Review — `TASK_2026_858_f7b9`

Reviewer family: codex. Implementer family: claude.

Score: **5/10**. Verdict: **REVISE**.

The method table, pairing-code normalization, fixed worker error copy, SSH alias pattern, shared RPC registration, and host capability gate match the plan. There is 1 blocking, 5 major, and 2 minor findings. The score is below the 7–8 band because recovery and validation defects remain in the client and reducer; it is above the 3–4 band because the main protocol shape and host gating are coherent and scoped verification passes. Scope: Phase B diff `8ca164796..7ea368e4b`, not the later gateway or worker service.

## Five logic questions

1. **How does this fail silently?** A throwing push tap with no logger is swallowed (finding 6); a reducer replay failure after its cap returns no attach request (finding 2).
2. **What user action produces unexpected behaviour?** Reconnecting while a busy session has a sequence gap can leave rendered history stale after replay failure (finding 2). A transport send failure leaves the client reporting `open` while other calls wait (finding 3).
3. **What input data produces a wrong answer?** A baseline event missing a required field, or with an arbitrary `eventType`, passes the wire schema as `FlatStreamEventUnion` (finding 1). A multi-byte frame can exceed the 1 MiB wire limit while passing the client length check (finding 4).
4. **What happens when a dependency fails?** `send` failure rejects one request only (finding 3), and `ping` failure escapes its timer callback (finding 7). Local listener delivery survives a throwing tap, but capture loss can be invisible (finding 6).
5. **What is missing that the requirements never mentioned?** A recovery transition for buffer overflow followed by failed replay (finding 2), and a bounded representation or compaction strategy for long event streams (finding 5). The later gateway must enforce the pre-authentication size limit before JSON parsing (finding 4).

## Findings

1. **Major — baseline event validation accepts invalid union members.** `libs/worker-protocol/src/lib/frames.ts:123-131,135-138`. `FlatStreamEventSchema` checks only `id`, `eventType`, and `timestamp`, then asserts the value is `FlatStreamEventUnion`. For example, `text_delta` without its required `messageId` passes; the existing `frames.spec.ts:22-27` fixture demonstrates that shape. A malformed worker baseline can pass `parseWorkerFrame`, be stored as valid history, and reach a renderer that assumes required fields. **Fix:** validate the discriminant and each type's required fields with a real union schema; test malformed baseline rejection mapping to close 4400.

2. **Blocking — held-frame overflow can strand replay recovery.** `libs/worker-protocol/src/lib/client/session-event-reducer.ts:129-136,170-179`. On the 1,001st held frame, `holdPastGap` clears the buffer but preserves `replayFrom`. If the outstanding replay fails, `replay-failed` sees an empty buffer, clears `replayFrom`, and emits no attach. With no later live event, the view stays behind indefinitely. The cap test at `session-event-reducer.spec.ts:200-209` checks storage only. **Fix:** represent overflow as a resync state and request a fresh attach/baseline on replay failure; test cap → replay-failed → baseline.

3. **Major — thrown socket send leaves unrelated requests and connection state stale.** `libs/worker-protocol/src/lib/client/worker-client.ts:336-352`. The catch rejects only the request being sent and assumes a close event will reject others. A `WebSocketLike` can throw without emitting one; existing calls then wait for their 30-second timers, and later calls still use an `open` client. The current test at `worker-client.spec.ts:314-330` asserts only the failed call. **Fix:** treat send failure as connection loss, tear down the socket, reject all pending calls, and notify close once; test two pending calls and state after send throws.

4. **Major — frame size uses UTF-16 code units; the inbound parser has no byte bound.** `libs/worker-protocol/src/lib/client/worker-client.ts:384-395`; `libs/worker-protocol/src/lib/frames.ts:339-341,377-389`. Non-ASCII JSON can be under `maxPayloadBytes` in JavaScript `.length` yet exceed 1 MiB in UTF-8. The client-frame parser also parses arbitrarily large JSON; W1's 4 KiB pre-authentication limit is not implemented here. A peer can cause excess parse work unless the later gateway rejects bytes first. **Fix:** count UTF-8 bytes before parsing, and enforce phase-specific 4 KiB/1 MiB limits in the later gateway before calling `parseClientFrame`; test multi-byte and pre-auth boundaries. This is a Phase B boundary contract gap, not a claim that the unimplemented gateway already fails it.

5. **Major — each streamed event copies all rendered records.** `libs/worker-protocol/src/lib/client/session-event-reducer.ts:264-275`. Every event appends with `[...state.view.records, record]`; processing *n* events copies O(n²) references. Long sessions with many chunk events can make live rendering progressively slow and allocate large temporary arrays. **Fix:** keep records in bounded chunks or another persistent append structure, and flatten only at the view boundary; verify a long stream without quadratic growth.

6. **Minor — a throwing push tap is silent when the optional logger is absent.** `libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.ts:37-41,159-170`. `tap` and `logger` can be supplied independently, but the catch calls `this.tapLogger?.error`. A worker capture tap that throws with no logger loses the event while local listeners receive it, with no diagnostic, contrary to C5's “caught and logged by error name” rule. **Fix:** require a logger with a tap, or provide a safe default sink logging only the error name; test tap-only configuration.

7. **Major — ping and close exceptions escape asynchronous transport callbacks.** `libs/worker-protocol/src/lib/client/worker-client.ts:274-294,502-513`. `socket.ping?.()` runs inside a timer after the pong deadline is scheduled, without a catch. A synchronous failure escapes the callback and can become an uncaught process exception; the client remains open until the deadline. `socket.close()` is unguarded on connect timeout and socket error, so a throwing adapter can bypass rejection or cleanup. **Fix:** catch transport method failures, use the idempotent connection-loss path, reject pending calls, and guard cleanup calls; test throwing `ping` and `close` adapters.

8. **Minor — untrusted WebSocket close reason crosses into host callbacks unchanged.** `libs/worker-protocol/src/lib/client/worker-client.ts:283-290,446-464`. A peer can set its close reason to arbitrary text, including a path or secret, and `onClose` receives it despite fixed worker error copy. A host displaying or logging that callback can expose peer-controlled text. **Fix:** expose a fixed reason selected from known close codes; retain raw reason only in a separately redacted local diagnostic path.

## Decisions

| Judgment | Evidence and alternatives | Reversible? |
| --- | --- | --- |
| Accept a baseline past a sequence gap. | W8 permits a fresher baseline to replace stale history; `session-event-reducer.ts:156-160` applies it and the spec at `:269-282` covers it. Sequential replay first would keep an obsolete view. | Yes. |
| Accept optional transport ping for Phase 1. | `WorkerClient` uses protocol ping when its socket provides it; browser WebSocket has no ping method. Electron transport can provide it; later browser support needs a separate liveness design. No current host enables remote machines. | Yes. |
| Accept executor-defined admin methods, goodbye payload, and version-detail client shape. | These are bounded, typed additions consistent with W2/W5/W6; no conflicting Phase B consumer was found. The future gateway must preserve fixed copy and close-code rules. | Yes. |
| Accept host gating and interim Electron exclusion. | `libs/backend/rpc-handlers/src/lib/host-profile/host-profile.ts:92` sets `remoteMachines: false`; Electron omits the capability; `manifest.ts:562-565` gates the methods; `apps/ptah-electron/src/di/rpc-surface.spec.ts:46-56` derives the temporary exclusion from the manifest. CLI and VS Code absent lists include it. | Yes. |
| Accept SSH alias validation. | `libs/shared/src/lib/types/rpc/rpc-machines.types.ts:46` requires an alphanumeric first character, rejecting `-oProxyCommand=...`; it bounds total length to 64. | Yes. |

## Data flow and requirement coverage

The wire path is `WebSocketLike` text → `parseWorkerFrame` → `WorkerClient` callback → `SessionEventReducer` → rendered records. Envelope errors close with 4400, but baseline event members are not fully checked (finding 1), byte size is miscounted (finding 4), and the reducer can stop requesting recovery (finding 2). The outgoing path is typed method params → in-flight request → socket send → correlated response; the in-flight cap, timeout, and late-response guard work, while a thrown send does not close the whole path (finding 3). The CLI push path de-batches → tap → local emit; order and local isolation work, while a tap-only failure lacks a diagnostic (finding 6).

| Requirement | Status | Evidence or gap |
| --- | --- | --- |
| W1/W2 frame envelopes, correlation, timeout, close 4400 | Partial | Malformed envelopes are rejected; byte limits and transport exceptions remain (findings 4, 7). |
| W3 pairing code and W12 fixed error copy | Partial | Normalization and error-frame copy are sound; peer close reason remains raw (finding 8). |
| W7/W8 duplicate, gap, epoch, baseline, history-mark | Partial | Ordinary cases work; cap plus failed replay can leave a stale view (finding 2). |
| W11/C2 shared Machines RPC contract | Complete for Phase B | 17 methods and two push types are registered; alias validation rejects leading SSH options. |
| C3 capability surface | Complete for Phase B | Remote Machines stays off on all hosts; Electron's temporary exclusion follows the manifest. |
| C5 host profile and push tap | Partial | Profile is forwarded and tap runs before local emit; missing logger permits silent tap failure (finding 6). |

## Verification and remaining uncertainty

- Ran only the authorized `npm run verify -- -p @ptah-extension/worker-protocol`; lint, test, and typecheck passed (3/3 tasks). Tests cover ordinary correlation, timeouts, duplicates/gaps, and the held cap, but not the failure combinations in findings 2, 3, or 7.
- Read the Phase B diff, task context and description, batch notes, relevant plan sections, repository instructions, and the new protocol/client/reducer files. Batch notes report earlier host-wide verification; I did not rerun it because this review restricts tests to worker-protocol.
- `ptah_get_diagnostics` was requested twice with scoped files; both returned unavailable while its TypeScript compiler was still running. Scoped verify supplies compiler evidence for worker-protocol. No source files or git state were changed.
- Skill loading was unavailable in this lane's listed tools; no skill rules were inferred or applied.
