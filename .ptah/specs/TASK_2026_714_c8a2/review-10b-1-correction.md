Verdict: REVISE
Score: 8/10
Review family: codex (reviewer) vs claude (author of correction)

## Defects

1. **Medium — `codex-app-server-lane.adapter.ts:326-328`.** The `.finally()` callback clears `starting` before the awaiting `start()` continuation assigns `active`. Promise continuation takes later microtasks, so a `continue()` call scheduled in that interval passes both guards and starts a second turn while the first is still being registered. Keep `starting` true through receipt registration and pending-event processing; clear it in an outer `finally` around `start()`. Add a controlled-promise regression case that attempts continuation at settlement before the first turn becomes active.

## Checked

- `starting` is set before `startTurn`; the timeout wrapper settles on resolution, rejection, or its 30-second watchdog. Its `.finally()` clears the flag on each of those paths. Abort/close also makes `closed` true, so later continuation is refused even while `startTurn` remains pending. No permanently stuck `starting` path found.
- The moved role-delivery assertion remains meaningful as an eventual-state check after a successful follow-up turn. It does not test the interim startup guard.
- Read-only source review only. No tests, checks, or source edits run. Ptah AST inspection was available; targeted line reads used native PowerShell because the Ptah inspection tool did not provide a line-range read. CLI skill loading was unavailable in this lane.
