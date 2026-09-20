# MCP server backoff repair report

## 1. Shared attempt-key namespace

The stderr path now always reports failures under the query's routing ID
(`sessionConfig.tabId ?? sessionId`), which is available before the CLI starts and
before the SDK UUID exists. `SdkQueryOptionsBuilder` registers that routing ID with
`McpServerBackoffService` before returning the SDK options.

The SDK init path still receives the canonical SDK UUID from
`SessionMcpStatusCallbackRegistry`, because that event contract is also consumed by
the UI. The backoff service now subscribes to the existing
`SessionIdResolvedCallbackRegistry` and maps that UUID back to the same routing ID.
An init failure that arrives before the asynchronous resolve notification is queued
with its original timestamp and flushed after the mapping is known. Resumed sessions,
whose routing ID is already their SDK UUID, resolve directly.

This makes the two sources use the same attempt key without relying on an SDK UUID in
the pre-init stderr path. The `sessionIdResolver` is no longer threaded into backoff;
it remains only where it is needed for routing the unrelated CLI connector notice.

## 2. Time-window fallback

`recordFailure` now compares keys whenever both the existing record and incoming
report have keys. Different keys count as distinct failures even inside 10 seconds,
while equal keys deduplicate regardless of elapsed time. The 10-second window is used
only when one side has no key.

This preserves fallback behavior for legacy/keyless programmatic reports, prevents
separate keyed attempts from being collapsed, and deduplicates a slow pair of stderr
and init reports even when they arrive more than 10 seconds apart.

## 3. Matched-tail trimming

The per-session buffer now consumes through:

```text
max(lastNewlineIndex + 1, lastMatchEnd)
```

Therefore a completed match is never retained merely because an earlier newline
exists. A notice completed without a trailing newline is detected once and cannot be
matched again when the next chunk arrives.

## 4. Per-session buffering and disposal

The singleton's process-wide string was replaced with buffers keyed by the query's
routing ID. Concurrent sessions can now interleave chunks without combining their
partial lines.

`SdkQueryOptionsBuilder` passes the query's `AbortSignal` when registering the stderr
session. The backoff service removes that session's buffer and UUID alias when the
signal aborts. Session teardown and bulk disposal already abort their query
controllers, so finished sessions release their buffers through the existing
lifecycle. A state-identity check prevents a late abort from an older query clearing a
new query that reused the same routing ID. The existing 16 KB per-buffer bound remains
unchanged.

## 5. Regression coverage

Added `mcp-server-backoff.service.spec.ts` with five passing tests:

1. stderr and SDK init reports for the same attempt count once, including a delay
   greater than 10 seconds;
2. two distinct keyed attempts within 3 seconds count twice;
3. a notice split across a chunk boundary is detected exactly once, including the
   earlier-newline/no-trailing-newline trim case;
4. two sessions can interleave partial stderr chunks without corrupting either match;
5. aborting a session releases its partial stderr buffer.

## Verification

Required command:

```text
npx nx run-many -t test -p @ptah-extension/agent-sdk --maxWorkers=2
```

The first attempts were terminated before Jest by command-wrapper timeouts, and a
subsequent attempt hit shared Nx plugin-worker connection timeouts. The successful run
used process-local `NX_DAEMON=false` and `NX_ISOLATE_PLUGINS=false` so it did not reset
or interfere with the shared Nx daemon. The requested target and Jest arguments were
unchanged.

Final output:

```text
NX   Running target test for project @ptah-extension/agent-sdk:

- @ptah-extension/agent-sdk

With additional flags:
  --maxWorkers=2

Test Suites: 2 skipped, 112 passed, 112 of 114 total
Tests:       3 skipped, 1989 passed, 1992 total
Snapshots:   0 total
Time:        37.069 s, estimated 39 s
Ran all test suites.

NX   Successfully ran target test for project @ptah-extension/agent-sdk
```

The new spec passed all 5 of its tests. No full-workspace suite, `nx reset`, commit, or
push was performed.

## Round 2

### Finding 1: launch-scoped attempt identity

`SdkQueryOptionsBuilder.build()` now mints a fresh UUID with `randomUUID()` for every
query launch. The stable routing ID remains the lookup key that is available before SDK
init, but it is no longer used as the deduplication identity:

- `trackStderrSession` registers `routing ID -> launch UUID` and owns the stderr buffer
  under the launch UUID;
- the stderr callback reports failures with that launch UUID;
- `SessionIdResolvedCallbackRegistry` translates the SDK UUID through the routing ID to
  the same launch UUID;
- resumed launches whose routing ID is already the SDK UUID resolve through the same
  routing-to-launch map.

Retracking the same tab releases the prior launch's buffer and aliases before installing
the new launch. Consequently, equal keys mean one physical launch, while two launches
in the same tab have different keys and escalate normally. A new regression test runs
two launches in `tab-1` ten minutes apart and verifies `failureCount` advances from 1
to 2 and the second `backoffUntil` is extended by 120 seconds.

### Finding 2: bounded unresolved-init fallback

An init failure whose SDK UUID cannot be reconciled is no longer held or lost forever.
Pending init batches have a one-second reconciliation deadline. If no resolve
notification arrives (including a blank SDK session ID or a metadata-store rejection),
the service records every queued failure without a key, deliberately using the existing
10-second keyless fallback. If reconciliation identifies an already-finished launch,
the same keyless flush happens immediately.

The pending-session map remains capped at `maxTrackedServers`; cap eviction now flushes
the oldest batch keylessly instead of dropping it, and each batch's failure array is
also capped. Timers are cleared on reconciliation, eviction, and `clear()`.

The previously unbounded `stderrSessions` map is now capped at
`maxTrackedServers`. Oldest-session eviction removes its routing and SDK aliases as well
as its buffer. Retracking a routing ID also sweeps the previous launch. The existing
per-buffer 16 KB clamp, `{ once: true }` abort listener, and state-identity guard are
unchanged.

New tests verify that an unresolved blank-ID init report is counted keylessly after the
deadline and that the stderr-session cap evicts an old partial buffer.

### Finding 3: discriminating trim regression

The trim test now sends a complete match with an earlier newline and no trailing
newline in its first chunk:

```text
starting\nfirecrawl (CONNECT_TIMEOUT)
```

The second chunk only completes the line suffix. With the fixed
`Math.max(lastNewlineIdx + 1, lastMatchEnd)` trim, the second call returns `null` and
the failure remains counted once.

I temporarily restored the defective newline-first branch and ran the required suite.
The rewritten test failed for the intended reason:

```text
FAIL  mcp-server-backoff.service.spec.ts
McpServerBackoffService › does not retain a complete match after an earlier newline when no trailing newline exists

expect(received).toBeNull()
Received: "firecrawl"

Test Suites: 1 failed, 2 skipped, 111 passed, 112 of 114 total
Tests:       1 failed, 3 skipped, 1992 passed, 1996 total
Time:        22.397 s
```

I then restored the `Math.max(...)` implementation before final verification.

### Escalation, ceiling, and successful reset

A new test explicitly verifies the default durations are 1, 2, 4, 8, and 16 minutes,
then 30 minutes for failures 6 and 7. It publishes a `connected` SDK status and verifies
the record is deleted; the next failure starts again at failure 1 with a one-minute
backoff.

### Final agent-sdk run

Command (with process-local Nx isolation variables, no `nx reset`):

```text
npx nx run-many -t test -p @ptah-extension/agent-sdk --maxWorkers=2
```

Final output after restoring the trim fix:

```text
NX   Running target test for project @ptah-extension/agent-sdk:

- @ptah-extension/agent-sdk

With additional flags:
  --maxWorkers=2

Test Suites: 2 skipped, 112 passed, 112 of 114 total
Tests:       3 skipped, 1993 passed, 1996 total
Snapshots:   0 total
Time:        21.295 s
Ran all test suites.

NX   Successfully ran target test for project @ptah-extension/agent-sdk
```

This final run used process-local `NX_SKIP_NX_CACHE=true` and executed Jest rather than
reading the prior successful result from cache. No full-workspace suite, `nx reset`,
commit, or push was performed.
