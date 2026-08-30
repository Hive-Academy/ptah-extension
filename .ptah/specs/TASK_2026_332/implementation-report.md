# Implementation report — TASK_2026_332

Date: 2026-08-28
Implemented by a `backend-developer` subagent, reviewed by an independent
`code-logic-reviewer`, revised once after that review found the first attempt's
central decision was defeated a layer above where it was made.

## Defect 1 — the re-pointing operation queue

An instance-level queue over the `.mcp.json` ownership operation, with two rules.

**Serialize.** Every mutation — `ensureRegisteredForSubagents`, the folder-change
re-point, and `stop()`'s unregister — joins one promise chain through
`enqueueMcpOp`, so a job reads `registeredMcpJsonPath` only after every earlier
job has finished updating it. That alone kills the stale read that let both
operations in scenario (a) capture workspace A.

**Latest wins.** Each re-point captures a monotonic `repointGeneration` and is
dropped before touching disk if superseded. In A→B→C the B job never writes, so
there is no entry in B to strand.

Scenario (b) is the same mechanism from the other end. `stop()` bumps the
generation, cancelling anything queued, sets `stopped` so a folder event arriving
mid-drain is dropped, and then enqueues its unregister **behind** the queue
rather than jumping it — so a re-point already inside its critical section
finishes and the unregister removes the entry from wherever it actually landed.

The reviewer probed the worst interleaving: a B job already past its guard and
mid-flight when C arrives. `syncMcpJsonRegistration` does not re-check the
generation once started, so B is written — and then immediately unregistered by
the C job, which reads live state at its own start. Final state is correct; the
cost is one wasted write/unregister pair. Strict FIFO over a single queue is what
lets every later job self-heal from whatever a predecessor left.

## Defect 2 — the lock deadline now fails the mutation

`withFileLock` throws `FileLockTimeoutError` past the deadline instead of running
the task unlocked.

Chosen over the two alternatives on evidence, not taste. Warn-and-write keeps the
lost update and merely narrates it into a log whose reader discovers the loss as
"the agent cannot see my MCP tools". Merge-after-write is not expressible in
`withFileLock`, whose task is opaque, and re-running an idempotent task twice
ping-pongs rather than converges.

Two deliberate non-changes, both confirmed correct by the reviewer:
`acquireFileLock` still returns an unheld handle so the reconciler can inspect
`lock.acquired` and proceed degraded; and an uncreatable lock directory stays a
distinct `no-lock-directory` reason that still proceeds, because nobody holds
anything there.

## What the review caught — the decision was being swallowed

The first attempt shipped the throw and stopped there. The reviewer traced where
it landed and found it never left the building.

`registerInMcpJson` and `unregisterFromMcpJson` each wrapped their whole body —
lock call included — in a generic `try/catch` that logged and returned normally.
`FileLockTimeoutError` landed in the same branch as an ordinary `EACCES`.
`ensureRegisteredNow` awaited without its own catch, so `enqueueMcpOp`'s chain
never rejected, so **`ensureRegisteredForSubagents()` resolved successfully when
the entry was never written** — against a docstring that says to await it before
spawning anything that reads `.mcp.json`.

`gateway-chat-bridge.ts` was the sharpest evidence: it already had an outer catch
written specifically to degrade `mcpServerRunning` on a lock failure. That catch
could never fire, and `mcpServerRunning` stayed `true`.

The first attempt's own new spec pinned the broken behaviour — it asserted
`.resolves.toBeUndefined()` and no write, together.

## The fix — a typed result, not a rejection

`ensureRegisteredForSubagents(): Promise<McpSubagentRegistration>` returning
`{ registered: boolean; reason?: 'not-started' | 'no-workspace' | 'lock-timeout' | 'write-failed' }`.

Rejection was rejected on evidence: three of the six call sites have no local
catch, and a fourth sits inside a catch that releases the proxy lease and
**rethrows**. Throwing would abort a whole chat session, or fail a CLI spawn,
because a config file was contended for two seconds. That is a worse outcome than
the defect.

The typed result maps onto something already present at every site: all five
chat callers compute an `mcpServerRunning` boolean and thread it into the session
they are starting. The result is not merely returned — it is the value that
decides that flag.

`isFileLockTimeoutError` now has production consumers, giving `lock-timeout`
(deliberate refusal, retryable) its own branch and log line, distinct from
`write-failed` (likely to repeat).

**A sixth call site the brief missed** was found by grep:
`vscode-core/src/services/subsystem-bringup.ts`. Its inline structural type was
widened and it now logs the failure, which previously left no trace at activation
at all.

Also corrected: both `ensureRegisteredNow` and `syncMcpJsonRegistration` now
decline to write into the new file when the old entry could not be removed.
Otherwise a live `ptah` entry sits in two repositories while the record of the
stale one is overwritten, so nothing can ever clean it up.

## Proof the tests are not vacuous

Three separate falsifications, each isolating one mechanism:

| Reverted                               | Result                                  |
| -------------------------------------- | --------------------------------------- |
| `http-mcp-server.service.ts` to `HEAD` | exactly the 4 queue specs fail          |
| the lock inside `withMcpConfigLock`    | exactly concurrency test 1 fails        |
| the 3 caller files to `HEAD`           | exactly the 2 caller-honesty specs fail |

The `harness-sync` mock factory was changed to `jest.requireActual` the real
`FileLockTimeoutError`, because the code branches on `instanceof` and a
look-alike would have certified the wrong branch.

## Weak specs, labelled rather than deleted

The reviewer confirmed that two of the three concurrency specs pass with the lock
removed: both facet critical sections are fully synchronous, so `Promise.all`
cannot interleave them in one process. Only test 1, with its manual `harnessGate`
yield, creates a real window.

They are kept as wiring smoke tests and now say so — titles prefixed
`CONCURRENCY:` / `WIRING:` / `WIRING:`, plus a header section stating plainly
that only the first proves anything about the lock. A reader who skips the header
still sees it.

## Verification

`npx nx run-many -t test -p @ptah-extension/vscode-lm-tools @ptah-extension/harness-sync @ptah-extension/rpc-handlers @ptah-extension/cli-agent-runtime @ptah-extension/gateway-chat-bridge`
— 5 of 5 projects. `harness-sync` 40/322, `cli-agent-runtime` 38/494,
`vscode-lm-tools` 44/885, `gateway-chat-bridge` 2/66, `rpc-handlers` 89/2498.
Zero failures. `typecheck` green across 6 projects, `lint` clean.

One transient on the first pass — a `rpc-handlers` setup spec doing a real network
fetch of an agent-pack manifest — passed alone and on re-run. Not related.

## Left open

- **`chat-session.service.ts`'s two sites have no direct unit coverage.** That
  class takes 22 injected dependencies and no `chat:start` harness exists;
  standing one up to assert one boolean would have dwarfed the fix. The contract
  is pinned at the two sites that do have doubles. Worth a follow-up.
- **`mcpRegisteredForSubagents` defaults to `true`** on `autoResumeIfInactive`,
  because the other two callers never register and have nothing to report. A
  future caller that forgets it gets the optimistic answer.
- **Pre-existing, filed as TASK_2026_339**: `chat:resume --activate` and
  `ensureSessionActiveForRewind` resume sessions with `mcpServerRunning: true`
  while never calling `ensureRegisteredForSubagents` at all.
- The `start()`/`stop()` shared-field race and the unwired `disposeAsync()` were
  left alone deliberately — both are TASK_2026_338.

## Outcome

Status `in_progress` → `done`.
