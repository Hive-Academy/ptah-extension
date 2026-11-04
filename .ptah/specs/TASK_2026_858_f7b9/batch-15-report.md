## Files changed

- Added `libs/backend/worker-runtime/src/lib/event-capture.ts` and `event-capture.spec.ts`: synchronous capture and routing hook with drop count.
- Added `libs/backend/worker-runtime/src/lib/session-event-log.ts` and `session-event-log.spec.ts`: per-session 0600 JSONL, validated records, torn-tail truncation, interrupted-turn recovery, replay, and latest history mark.
- Added `libs/backend/worker-runtime/src/lib/session-log-writer.ts` and `session-log-writer.spec.ts`: ordered bounded queue, append-before-publish, periodic `fdatasync`, fail-closed writer, failure callback, and degraded control frame.
- Added `libs/backend/worker-runtime/src/lib/fan-out.ts` and `fan-out.spec.ts`: replay-boundary buffering and isolated subscribers.
- Exported these APIs from `libs/backend/worker-runtime/src/index.ts`.
- Verification: `npx tsc --noEmit -p libs/backend/worker-runtime/tsconfig.lib.json` passed. Prettier completed. Scoped Jest could not start: Nx preset was denied its daemon socket (`EPERM`); orchestrator verification is pending.

## Decisions

- Decision: `SessionEventLog` owns file I/O; `SessionLogWriter` owns sequence and send ordering. Options: write from the capture tap, or drain in the writer. Evidence: W7 requires the tap to observe only and frames to publish after append. Reversible: yes.
- Decision: the writer reports append failure through `onAppendFailed` for the session driver to abort the active turn, and sends `ctl session-state` itself. Options: import the future session driver, or use the callback boundary. Evidence: W7 failure signal and Batch 15's file scope. Reversible: yes.
- Decision: fan-out accepts a replay boundary at subscription time and buffers later frames until `finishReplay`. Options: replay inside fan-out, or let the attach caller read the file. Evidence: W7 assigns file replay to attach while fan-out buffers live frames. Reversible: yes.

## Spec coverage

- Strict per-session sequence: `assigns strictly ordered sequence numbers per session`.
- Torn last line and interrupted session: `recovers a torn tail and appends an interrupted turn in sequence`.
- **No `evt` frame with `seq > head`**: `No evt frame with seq > head under an injected slow write`.
- **Append failure mid-turn**: `Append failure mid-turn aborts, sends ctl degraded, and returns SESSION_LOG_FAILED`.
- `latestMark` rebuilt on open: `rebuilds latestMark on open from the newest mark`.
- Malformed non-tail record: `rejects a malformed non-tail record with TRANSCRIPT_UNAVAILABLE`.
- Capture routing: `routes only captured events synchronously without assigning sequence numbers`.
- Replay buffering: `buffers live frames until replay finishes and omits frames inside the replay boundary`.

## Not done / Clarifications Needed

- Jest specs were written but could not run in this sandbox because the Nx preset attempted a denied daemon socket. The orchestrator must run the prescribed project verify.
- The session driver's `chat:abort` wiring to `onAppendFailed` is outside Batch 15; the callback is exercised by the failure spec.
