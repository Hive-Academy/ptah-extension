Verdict: **REVISE — 6/10**

Review family: **codex (implementer: claude)**

The two reported recovery races are fixed. One static attach result path still leaves the view stale. The score remains 6/10: token and target fixes improve recovery, but snapshot attach is a specified, reachable path with no event stream to repair its view. That keeps the logic below the 7–8 band.

| Prior defect | Fixed? | Evidence file:line |
| --- | --- | --- |
| 1. Resync ends before its attach settles | **yes** | `libs/worker-protocol/src/lib/client/session-event-reducer.ts:105-128,248-267,352-363`: recovery remains until its attach succeeds and `last` reaches `target` with no held frames. A contiguous live frame alone cannot clear it; the regression at `session-event-reducer.spec.ts:309-327` covers failure and reconnect. |
| 2. Stale replay failure double-attaches | **yes** | `libs/worker-protocol/src/lib/client/session-event-reducer.ts:220-245,328-349`: each replacement attach gets a new token, and outcomes for superseded tokens are ignored. `session-event-reducer.spec.ts:290-307` exercises the old replay failure after overflow. |

## New defects

1. **Blocking — a snapshot attach discards its only view and can leave recovery stuck.** `libs/worker-protocol/src/lib/client/session-event-reducer.ts:191-203,248-267,352-363`. `session.attach` may succeed with `{ mode: 'snapshot', events, live: false }` for an unlogged session or while a desktop process holds the driver lock (`implementation-plan.md:421-430`; `methods.ts:165-181`). `attachSucceeded` marks the request settled but never puts `result.events` into the transcript. The documented `sessionView` therefore stays empty or shows the older baseline. After an overflow, `target` can be 1003 while `last` is 1; snapshot mode sends no frames, so `checkRecovery` cannot clear the recovery either. **Fix:** handle snapshot as a terminal, nonlive view update: publish its events (or an explicit snapshot outcome for the host to render), clear held/target/recovery as appropriate, and test a snapshot response both on first attach and after overflow.

## Checks and limits

Read the reducer, the relevant regression specs, the attach result schema, and the W8 snapshot contract. Scoped `ptah_get_diagnostics` reported zero errors in the reducer and its spec. The orchestrator reported `npm run verify -- -p @ptah-extension/worker-protocol` passed lint, test, and typecheck 3/3; I did not rerun it. The snapshot case is absent from the reviewed reducer specs, and passing checks do not exercise it.

## Decisions

| Decision | Evidence and alternatives | Reversible? |
| --- | --- | --- |
| Treat snapshot mode as a reducer obligation. | The reducer says the host feeds attach outcomes and reads `sessionView` (`session-event-reducer.ts:3-5`); W8 requires the snapshot events to render as a nonlive last saved state (`implementation-plan.md:421-430`). Ignoring it or relying on undocumented separate host handling leaves this public reducer contract incomplete. | Yes. |
