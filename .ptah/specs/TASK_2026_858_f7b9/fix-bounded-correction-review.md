Verdict: **REVISE — 6/10**

Review family: **codex (implementer: claude)**

**Snapshot finding: fixed.** `libs/worker-protocol/src/lib/client/session-event-reducer.ts:263-302,204-218` accepts only the current token, publishes `result.events` as a `source: 'snapshot'` view, and resets epoch, last, target, held frames, and recovery while retaining `nextToken` through `resetForNewLog` (`:330-341`). A later baseline returns the view to `source: 'log'` (`:442-461`). The four targeted tests are at `session-event-reducer.spec.ts:416-499`.

**Self-reported new-epoch weakness: acceptable for this correction.** For a log result whose epoch differs from the current state, `attachSucceeded` does not use the new `headSeq`, so a recovery with `last === target` can clear before the first new-epoch frame (`session-event-reducer.ts:275-281,391-397`). Once a frame arrives, `applyEvent` resets to that epoch and either applies its baseline or requests replay for a gap (`:312-327`). A silent stream stall would leave the view stale even if the recovery flag remained set, because the reducer has no timer or failure signal. This is a bookkeeping limitation, not a demonstrated additional loss path under the stated event delivery contract.

## New defects

1. **Major — late frames from a superseded attach can undo a snapshot.** `libs/worker-protocol/src/lib/client/session-event-reducer.ts:290-327,330-341`. After overflow, an older replay can still be streaming when the newer fresh attach returns snapshot mode. `showSnapshot` resets `epoch` and `last` to `null` and `0`, then clears recovery; event frames carry no attach token. A late baseline from the old replay is therefore treated as the first frame of a new log and replaces the saved snapshot. A late nonbaseline frame is held as a gap and can request another attach, even though the snapshot was deliberately nonlive. The token guard at `:252-273` protects attach outcomes, not these frames. **Fix:** fence frames from superseded attaches at the host/stream boundary or retain a snapshot generation barrier until a deliberately new attach starts; test a snapshot after overflow followed by an old replay frame.

## Verification

Reviewed the specified diff, full reducer paths, snapshot regression tests, attach result schema, and the W8 snapshot contract. Scoped `ptah_get_diagnostics` found zero errors in the reducer and its spec. The orchestrator reported `npm run verify -- -p @ptah-extension/worker-protocol` passed lint, test, and typecheck 3/3; I did not rerun it. The targeted tests do not cover a frame arriving from a superseded attach after the snapshot.
