Verdict: **APPROVED — 8/10**

Review family: **codex (implementer: claude)**

**Defect fixed: yes.** `libs/worker-protocol/src/lib/client/session-event-reducer.ts:237-260,305-319` sets `fenced` when a current-token snapshot is shown and ignores subsequent frames and `resync-required` without changing the view or requesting an attach. Late attach outcomes still fail the current-token check at `:268-289`. The regression tests at `session-event-reducer.spec.ts:486-520` cover late baselines, nonbaseline frames, resync control, and later log takeover. This closes the prior snapshot overwrite path. The score is in the 7–8 band because the state transition and tests cover the reported failure; a host refresh contract still needs a clear public note.

**Same-connection snapshot refresh: reconnect required and acceptable for watch-only Phase 1.** W8 specifies a nonlive, last-saved snapshot with manual refresh when the desktop holds the lock or a session is unlogged (`implementation-plan.md:421-430`). After a snapshot, a same-connection `session.attach` has no supported reducer action: `fenced` ignores frames and control, and `attach-succeeded` has no current recovery token (`session-event-reducer.ts:237-260,268-289`). The host must close and replace the socket, dispatch `connected` only after the new socket opens, then send the returned fresh attach (`:241-248`; `session-event-reducer.spec.ts:506-520`). Reconnecting is a valid implementation of the W8 refresh action; lock release alone need not turn the watch-only snapshot live. Add the explicit refresh rule to the public `SessionViewSource`/`SessionView.source` documentation at `session-event-reducer.ts:68-79` and the W8 host handoff, so a host does not dispatch `connected` on the old socket or send an untracked same-connection attach. This is a contract note, not a blocking defect in this batch.

## New defects

None located in the Batch 7.9 diff.

## Verification

Reviewed the specified diff, reducer transitions, targeted specs, and W8 snapshot contract. Scoped `ptah_get_diagnostics` found zero errors in the reducer and spec. The orchestrator reported `npm run verify -- -p @ptah-extension/worker-protocol` passed lint, test, and typecheck 3/3; I did not rerun it. This review does not establish a host refresh UI, which belongs to the later host integration.

## Decisions

| Decision | Evidence and alternatives | Reversible? |
| --- | --- | --- |
| Use a new connection as the snapshot refresh boundary. | Frames have no attach token (`session-event-reducer.ts:41-47`), and W8 calls snapshots nonlive with manual refresh (`implementation-plan.md:421-430`). A same-socket attach could mix old streams with new ones; a new socket ends those streams. | Yes; a future tagged-frame protocol could support same-socket refresh. |
