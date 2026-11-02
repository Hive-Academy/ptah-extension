# Review 10b-1 — Codex App Server lane adapter core

Verdict: REVISE
Score: 6/10
Review family: ollama-cloud/Glm (reviewer) vs codex (implementer)

## Defects

1. **blocking** — `codex-app-server-lane.adapter.ts:298` (`pump`): the event stream ending while no
   turn is active is silently ignored, leaving a dead lane. The guard `if (!closed && active) throw`
   fires only mid-turn. Failure scenario: turn 1 completes (context stays open for continuation), the
   App Server closes the stream between turns; `pump` returns with no error segment, `closed` stays
   `false`, and `supportsContinuation()` still reports `true`. The host calls `continue()`;
   `startTurn` resolves, no event can ever arrive, and the returned `done` never settles — no
   watchdog bounds turn event flow (`withCodexLaneStartupTimeout` covers only `startTurn`). The lane
   hangs permanently with no diagnostic. Fix: treat a stream end as fatal whenever `!closed` — emit
   the error segment and `await close()` (the existing close path rejects any in-flight turn start).

2. **minor** — `codex-app-server-lane.adapter.ts:366` (`continue`): `roleDelivery` flips to
   `'task-prompt'` before the adapter knows the turn will start. Failure scenario: `continue()` runs
   after the lane closed or while a turn is active; `runTurn` rejects, but `getRoleDelivery()` now
   permanently reports `task-prompt` although the role block never went out on that channel — it
   still lives in the developer instructions. A host that reads role provenance from this getter
   gets wrong state for the rest of the run. Fix: set `roleDelivery` inside the turn's success path,
   after the receipt settles.

## Checked

- Exactly one `runtime.open` per run; continuation reuses the same context (spec asserts one `open`
  across two turns).
- No double settle: every path that settles a turn (`close`, terminal event, model rejection, pump
  failure) clears `active` before settling, and promise semantics make the remaining overlap safe.
- Usage emitted once per turn: the mapper defers `usage` snapshots and emits only on terminal.
- Abort ordering outside startup is sound: `close()` is idempotent under `closed`, the abort listener
  re-enters it safely, and `start()` re-checks `closed` after `startTurn` resolves.
- Context closed and timer cleared on: open failure, identity/persist/account-binding failure,
  `startTurn` failure, stream throw mid-turn, non-completed terminal, abort after done. Timer cleanup
  asserted by the fake-timer spec (`jest.getTimerCount() === 0`); startup-abort double close is the
  already-known exception.
- Resume gating: stored identity must parse and match every profile field, the opened identity is
  re-checked before persistence, and `processGeneration` is correctly not compared across processes.
- `onAccountBinding` awaited after persist and before the first `startTurn` (spec order
  `['open', 'persist', 'binding']`, inputs empty at binding time).
- Approval sink: `kind` is a closed union and `toolName` is regex-validated, so the emitted line
  cannot leak command text, path, cwd, message or details; `'decline'` is a valid
  `CodexApprovalOutcome`.
- Queue-only capabilities `{ steer: false, interrupt: false, continuation: true }`; no
  `@openai/codex-sdk` import; pre-turn events buffer in `pending` and replay only after `active` is
  set, so nothing is dropped or misattributed (the mapper also filters by turnId).
- Spec hygiene: no `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`, no readonly-mock
  assignment, no excess properties in the typed approval request literal; fake timers restored in
  `finally`.
- Known, not re-reported: adapter.ts:233 TS7030; adapter.ts:234/241 double close on startup abort.