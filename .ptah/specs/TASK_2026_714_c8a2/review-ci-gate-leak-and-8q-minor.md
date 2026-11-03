## Verdict

APPROVE. 9/10.

Review family: grok. Implementer family: codex. Both changes do what they claim. No production code moved. Tests were not executed; this lane was forbidden to run them.

## Findings

No findings.

## Checked

Skill: read `ptah-review-logic` (business-logic review command) before the review. Ptah MCP tools (`ptah_code_search_symbols`, `ptah_search_files`, `ptah_agent_report`, and the rest) were not connected in this session (`search_tool` returned no MCP tools). Fallback: `git diff` plus full-file reads and ripgrep. No diagnostics, nx, test, lint, or typecheck.

### A) CI gate leak

Diff is spec-only: `internal-query.service.spec.ts`, `internal-query-concurrency-gate.spec.ts`. Claims in `batch-ci-gate-leak-report.md` match the code.

Gate contract (`internal-query-concurrency-gate.ts`): a waiter that is not admitted immediately arms `setTimeout` for `queueTimeoutMs` or `DEFAULT_QUEUE_TIMEOUT_MS` (60000) at lines 343-378. Abort and timeout both go through `settleReject` → `detach`, which `clearTimeout`s that timer (391-410). `unref()` does not stop the timer inside a live Jest worker. `execute()` waits on `gate.acquire` with `config.abortController?.signal` (`internal-query.service.ts:190-196`) before `runOneShot`, so aborting a still-queued execute rejects with `AbortError` and never starts the runner.

Whole-file search, not only the diff:

- No remaining `void <promise>` in either spec. The only `void` hit is a type annotation on `emit` in the gate spec.
- Real-timer default-timeout queued waiters that previously ended with `void queued` / `void fifth` / `void fourth` now settle:
  - Service: configured global limit (fifth, ~438-445), same lane (~470-478), fourth lane at the global ceiling (~488-496), normalized lane name (~541-551), blank default lane (~559-567). Each aborts only after `settle()` and `expect(h.started())`, then `await expect(...).rejects` for `AbortError`. The abort controller is not shared with the holders, so the assertion that they stayed queued is unchanged.
  - Direct gate: two lanes (~78-89) and nonsensical limits (~162-186). Assertions of `inFlight`, per-lane counts, and `queued === 1` stay before the release. `releaseA()` then `(await queued)()` admits and releases that waiter on the normal path, which disarms its timer in `drain` → `detach`.
- Other real-timer queued acquires in both files already settled: FIFO and lane-order cases await and release; background-cap cases await `capped` / `foreground`; the governor-held real-timer case (~315-326) aborts and awaits; the 20ms `queueTimeoutMs` cases await `InternalQueryQueueTimeoutError` and are not on the default timer.
- Service executes that stay in flight (two lanes, user-action beside background lanes, early-break / close / reject follow-ups, governor drain via `Promise.all`) are admitted holders, not queued waiters. They do not arm the 60s queue timer. Left as they were.
- No new unhandled-rejection race. `await expect(promise).rejects` is attached in the same turn as `abort()` for the service cases, matching the existing abort-while-queued test (~370-371). In the fake-timer ceiling test, each `expect(queued).rejects` is created while the waiter is still pending, and `controller.abort()` runs only after both `onDeferralCeiling` assertions. `drain` returns immediately when `active >= limit` (~509), and the default-lane holder is released only after `await Promise.all(rejected)`, so those five waiters are still queued when aborted. A waiter admitted early would fail the `rejects` assertion instead of leaking.
- Fake timers: the governor suite uses `useFakeTimers` and `afterEach` `clearAllTimers` + `useRealTimers` (~352-360). The deferral-ceiling admission (~543-554) now `(await held)()`. The per-episode ceiling test (~557-603) aborts every backlog waiter, which clears both the deferral timer and the default queue timer armed at `deferExpired`. The other governor cases already await admission, timeout rejection, or abort, including `getTimerCount() === 0` on the abort and dispose tests.

### B) Idle notification spec

`codex-runtime.spec.ts` ~1685-1715, against `codex-context.ts`.

`turnPermissionLevel` (~209-217) returns `activeTurnPermissionLevel` only while `running` or `interrupting`. While idle it returns `settings.permissionLevel`. An idle `turn/started` (~403-406) copies `wirePermissionLevel` into `activeTurnPermissionLevel` and then sets `state = 'running'`. `start` writes `wirePermissionLevel = level` only at line 530, before `process.request`. The rejection path restores the previous wire level (~552). `updateNextTurn` (~782-845) updates `settings` and `levelPolicy` and does not assign `wirePermissionLevel`. `turn/completed` clears `activeTurnPermissionLevel` and returns to idle (~417-427) without touching the wire level.

Trace of the new test:

1. Open with `permissionLevel: 'plan'` plus `resolveCodexLevelPolicy('chat', 'plan', '/work')` and `codexProfileFingerprint`, the same construction as the existing plan-open test (~1638-1647). Constructor sets `wirePermissionLevel` to `plan` (~124).
2. `updateNextTurn({ permissionLevel: 'ask' })` stages ask. For consumer `chat`, ask is `approvalPolicy: 'untrusted'` and `sandboxPolicy` `workspace-write` with `writableRoots: ['/work']` (`codex-execution-profile.ts` ~167-187). `startTurn({ text: 'first' })` sends that policy. The frame assertion checks it. Fake `turn/start` (~207-212) emits `turn/started` while `start` has already set `state = 'running'` (~526), so that notification does not overwrite `activeTurnPermissionLevel`. Line 530 records ask as the last sent wire level.
3. `children[0].complete()` runs while `turnNumber` is still 1, so the completion id is `turn-1`, matching the id `start` stored. State returns to idle. `turnNumber = 2` is set only after that, matching the sibling idle-notification test (~1671-1682).
4. `updateNextTurn({ permissionLevel: 'plan' })` makes the idle getter return `plan` (staged settings). Wire stays ask.
5. A later idle `turn/started` snapshots wire, so the getter returns `ask`.

With line 530 the spec passes. Without it, wire stays at the opening `plan` (nothing else assigns it on the success path), the final expectation is `plan`, and the test fails. The older sibling that opens on `ask` would still pass without line 530, because opening level and last sent level are the same. This spec is the one that separates them. Helpers (`turn`, `children[0].frames` / `complete` / `notify`, `runtime` from `beforeEach`, `afterEach` `runtime.close()`) are the file's existing ones and are used in a valid order.
