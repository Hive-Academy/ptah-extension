# Batch B — bounded stream transport sends

## Design

Chose design **(a)**: `StreamBatchBuffer.push()` returns
`void | Promise<void>`. Below the cap it returns `undefined`, so the normal
event path allocates no back-pressure promise and does not wait for a transport
round trip. When the in-flight window is full, it returns a promise that the
`ChatStreamBroadcaster` producer awaits until one send settles.

The exported cap is `STREAM_BATCH_MAX_IN_FLIGHT = 4`. Four preserves useful
overlap for frame-length sends while bounding a stalled transport to four
retained batches—at the normal 64-event batch limit, at most 256 events already
handed to the transport. `flush()` also defers handing off a fifth batch, so the
bound holds even if a caller ignores the producer contract. The defer happens
before splicing; once capacity opens, splicing and the sink call remain
synchronous. Flush failures still route through `onError`, the timer remains
unref'd, and `settle()` still awaits every send already handed to the transport.

## Tests added

`stream-batch-buffer.spec.ts`:

- `caps unresolved transport sends at STREAM_BATCH_MAX_IN_FLIGHT`
- `releases producer back-pressure when a transport send settles`
- `returns undefined below the cap without blocking the fast path`
- `settle() waits for every send already handed to the transport`
- `calls the sink in order when the first send settles after the second`

`chat-stream-broadcaster.service.spec.ts`:

- `pauses the SDK drain at the transport cap and resumes when sends settle`
- `calls transport in event order even when its second batch settles first`

The existing test was renamed to
`does not await transport below the cap, so ordinary bursts drain without stalling`
so its name distinguishes the fast path from cap-only back-pressure.

## Verification

`npx nx run @ptah-extension/rpc-handlers:test` — **PASS (exit 0)**:

```text
Test Suites: 91 passed, 91 total
Tests:       31 skipped, 2619 passed, 2650 total
Snapshots:   0 total
Time:        30.684 s, estimated 632 s
```

Nx replayed the output from its cache on the final verification invocation; the
same implementation had already completed the full target. Jest also reported:

```text
A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.
```

No test in either modified spec is skipped.

`npx nx run @ptah-extension/rpc-handlers:typecheck` — **PASS (exit 0)**:

```text
NX   Successfully ran target typecheck for project @ptah-extension/rpc-handlers
```

TypeScript emitted no diagnostics or pass/fail item count.

`npx nx run @ptah-extension/rpc-handlers:lint` — **PASS (exit 0)**:

```text
✖ 18 problems (0 errors, 18 warnings)
NX   Successfully ran target lint for project @ptah-extension/rpc-handlers
```

All 18 findings are pre-existing warnings in files outside this batch's four
owned files. Nx replayed the lint output from its cache on the final invocation.

No commit was created.

---

## Orchestrator review — one defect found and fixed

**`settle()` did not await a flush deferred at the cap.** A batch that
`deferFlushUntilCapacity` is holding still has its events in `pending`, so it is
in no promise `inFlight` holds. `settle()` therefore returned while a whole
batch was unsent — and `ChatStreamBroadcaster`'s teardown
(`chat-stream-broadcaster.service.ts:361-362`) is `batch.dispose()` immediately
followed by `await batch.settle()`, after which it deletes the session. The
`await batch.flush()` above it is conditional on the turn state being
`generating`, so the normal exit path relied on `settle()` alone.

The window opens precisely when the transport is slow, which is the condition
the cap exists to handle — so the new bound made a pre-existing teardown race
reachable in exactly the scenario it was introduced for.

`settle()` now also awaits `blockedFlush`, which resolves to the flush it
eventually performs. It cannot stall: it waits on `Promise.race(inFlight)` and
is only created while that set is non-empty.

Pinned by `settle() also waits for a flush DEFERRED at the cap`. The test
releases only the in-flight window, one send at a time — an earlier version used
`releaseAll()`, which also unblocks the deferred batch's own send and made the
test pass with and without the fix. Verified to fail on the unfixed code and
pass on the fixed code.

## Orchestrator verification (`--skip-nx-cache`, no cache replay)

| Gate                                | Result                             |
| ----------------------------------- | ---------------------------------- |
| `test @ptah-extension/rpc-handlers` | 91 suites, 2620 passed, 31 skipped |
| `test ptah-electron`                | 409 passed, 4 skipped              |
| `typecheck` both                    | clean                              |
| `lint` both                         | 0 errors                           |
