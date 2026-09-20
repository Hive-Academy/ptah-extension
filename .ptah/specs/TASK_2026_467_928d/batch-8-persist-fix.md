## Reproduction

The offending value is `undefined` at `$.value.parentToolUseId` in a tagged persisted stream-event item. A root ptah-cli `text_delta` event writes `parentToolUseId` even when there is no parent (`libs/backend/agent-sdk/src/lib/message-transform/stream-event.transformer.ts:465` and `:474`), and the regression payload is reproduced at `libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.spec.ts:592`. Before the protocol change, that spec failed from `assertJsonCompatibleValue` with `ElectronStateWorkerProtocolError: Worker message contains a non-cloneable JSON value`.

## Decision

**B** — make the protocol treat an `undefined` object property like `JSON.stringify` and omit that property. This matches the storage contract without broadly sanitizing or silently coercing other unsupported data. Top-level and array-element `undefined`, functions, symbols, bigint values, non-finite numbers, cycles, and non-plain objects remain rejected. Rejections now identify the exact JSON path.

## Change

1. `libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.ts:55` — preprocess protocol JSON objects to omit only `undefined` properties before Zod returns the worker message, so structured-clone transport and worker validation receive the same JSON-safe shape.
2. `libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.ts:621` — add object-property omission and JSON-path formatting helpers.
3. `libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.ts:669` — make the bounded payload walk skip `undefined` object properties while retaining rejection of unsupported array values and attach paths to rejected values.
4. `libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.ts:812` — apply the same object-property semantics and path-aware errors to JSON compatibility validation.
5. `libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.ts:1014` — make paged snapshot generation omit `undefined` object properties and report paths for values it still rejects.
6. `libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.spec.ts:592` — add the real ptah-cli `text_delta` persistence regression and prove the parsed worker request omits `parentToolUseId`.
7. `libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.spec.ts:724` — pin path-bearing errors for root `undefined`, a nested function, and an `undefined` array element.

## Error message

Before:

```text
Worker message contains a non-cloneable JSON value
```

After, for a genuinely unsupported nested function:

```text
Worker message contains a non-cloneable JSON value (function) at $.value.handler
```

The original `undefined` object property at `$.value.parentToolUseId` no longer throws; the protocol omits it. An `undefined` array element still throws `Worker message contains a non-cloneable JSON value (undefined) at $[0]`.

## Tests

Spec: `libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.spec.ts`

Pre-fix reproduction command:

```text
npx nx run-many -t test -p @ptah-extension/platform-electron -- --runInBand --testPathPatterns=electron-state-storage-worker-protocol.spec.ts
```

Observed pre-fix output:

```text
FAIL platform-electron libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.spec.ts
  ● Electron state worker protocol › assertJsonCompatibleValue and bounded traversal › accepts a real ptah-cli stream event with an undefined optional property

    Error name:    "ElectronStateWorkerProtocolError"
    Error message: "Worker message contains a non-cloneable JSON value"

Test Suites: 1 failed, 1 total
Tests:       1 failed, 38 passed, 39 total
NX   Running target test for project @ptah-extension/platform-electron failed
```

Final required command:

```text
npx nx run-many -t test -p @ptah-extension/platform-electron
```

Observed final output (after running the test suite's stated prerequisite `npx nx run ptah-electron:build-workspace-watch-host`):

```text
Test Suites: 2 skipped, 36 passed, 36 of 38 total
Tests:       4 skipped, 3 todo, 619 passed, 626 total
Snapshots:   0 total
Time:        40.083 s, estimated 50 s
Ran all test suites.

NX   Successfully ran target test for project @ptah-extension/platform-electron

NX   Nx detected a flaky task
  @ptah-extension/platform-electron:test
```

Additional verification:

```text
npx nx run-many -t typecheck lint build -p @ptah-extension/platform-electron

NX   Successfully ran targets typecheck, lint, build for project @ptah-extension/platform-electron and 3 tasks it depends on
```

Lint reported 0 errors and 7 existing warnings.

## Revision 1 — review findings, applied by the orchestrator

`batch-8-review.md` returned `accept` with four LOW findings, all described as
polish rather than merge blockers. Two are fixed, two are declined with reasons.

### Finding 1 — the "matches `JSON.stringify`" wording is wrong for ARRAYS. FIXED (wording).

The reviewer is right and this correction belongs in the record.

`JSON.stringify(["a", undefined])` succeeds and emits `["a",null]`. This
protocol REJECTS that payload at all four validation sites. So the rule is not
"treat an `undefined` object property like `JSON.stringify`" without
qualification. The accurate statement is:

> An `undefined` OBJECT PROPERTY is dropped, the way `JSON.stringify` drops it.
> An `undefined` ARRAY ELEMENT is REJECTED, where `JSON.stringify` would coerce
> it to `null`.

The asymmetry is deliberate, not an oversight. `null` and absent carry
different meanings in this protocol — `nextCursor: z.string().nullable()` at
`:478`, and the `found` versus `value` split at `:464-472` — so coercing an
`undefined` element to `null` would silently change what a payload says. A loud
rejection is the safer answer. No real payload reaches it today: sparse arrays
and `JSON.parse` output cannot enter the walk, and the observed field failure
was an object property.

### Finding 3 — the fifth walker disagreed with the new semantics. FIXED.

`estimateElectronStateJsonBytes` was not updated, so a nested `undefined` would
reach `Object.entries(undefined)` and throw a raw `TypeError` instead of an
`ElectronStateWorkerProtocolError`. The reviewer traced both production callers
and showed neither can feed it one, so this is latent rather than live.

Fixed anyway, because it costs one comparison and it keeps the file's error
taxonomy whole. The function is an ESTIMATOR and never a validation gate, so it
MEASURES the absence rather than rejecting it: an `undefined` object property is
dropped before persistence and occupies nothing, so it returns 0. Rejecting here
would make a size estimate into a fifth validation gate, which is exactly the
divergence the finding complains about, pointing the other way.

### Finding 2 — per-node path allocation. DECLINED.

The reviewer recommends threading the path as a mutable stack so
`formatJsonPath` runs only in an error handler, and marks it optional.

Declined. The reviewer's own measurement is that this changes the constant, not
the scaling, and that the walks already visit every node. Converting two
recursive walks to push/pop stack discipline is a real change to the traversal
of a file whose job is to reject malformed input — the risk of getting the
unwind wrong on an error path is larger than the allocation it saves. The cost
is bounded three ways already: `MAX_PROTOCOL_NODES` (65,536), `MAX_PROTOCOL_DEPTH`
(64), and the 256 KB message budget.

If this ever shows up in a profile, the change is still available and the
finding records how to make it.

### Finding 4 — the host cache holds the raw value, disk holds the cleaned one. DECLINED, recorded as residue.

`worker-host.ts:252` caches the value as given, while the worker persists the
cleaned copy. A cache hit therefore answers `{ a: undefined }` where a restart
answers `{}`.

The reviewer searched `libs/` for anything that could tell those apart —
`hasOwnProperty`, `in`, `Object.hasOwn` on a persisted key, and `prefault` — and
found zero matches. Under property access, `JSON.stringify` and Zod `.optional()`
the two shapes are identical.

Declined because cleaning on the host side means running the walk twice per
write on the main thread, which is the cost finding 2 objects to, paid for a
difference no consumer can observe. Recorded as a known residue: a future
consumer that uses `Object.hasOwn` on a persisted key would need this closed.
