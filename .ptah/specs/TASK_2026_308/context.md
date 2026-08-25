# Context

## Where this came from

The TASK_2026_306 review of the Electron dev-boot log turned up a fully broken
session importer, which was fixed in that task. These three are the residue —
findings recorded as **F3-1**, **F3-2** and **F3-3** in that task's handoff and
left unfixed because none of them was implicated in the boot failure.

They are grouped into one task because they share a lib, they are all small, and
they all have the same shape: _the code is correct today for a reason that is
not stated in the code_.

## F3-1 — a whitespace-only short file becomes a phantom session

`libs/backend/agent-sdk/src/lib/session-importer.service.ts`

The importer reads an 8 KB prefix to find session metadata:

```ts
const buffer = Buffer.alloc(METADATA_PREFIX_BYTES); // :200, and again :512
const { bytesRead } = await fd.read(buffer, 0, METADATA_PREFIX_BYTES, 0);
```

`bytesRead` is already consulted at `:80` for the trailing-newline decision, so
the signal is in hand. The fallback path is not gated on it. A file that is
whitespace-only AND under 8 KB therefore yields no parseable metadata, falls
through to the filename fallback, and is imported as `Session <date>` — the
phantom entry the sidecar guard was written to prevent.

**Fix:** gate the fallback on `bytesRead >= METADATA_PREFIX_BYTES`. If the whole
file fit in the prefix and still contained nothing, it is not a session.

## F3-2 — `initInFlight` depends on promise-reaction ordering

`sdk-agent-adapter.ts:286`

```ts
async initialize(): Promise<boolean> {
  if (this.initInFlight) {
    return this.initInFlight;          // :291
  }
  this.initInFlight = this.doInitialize();
  try {
    return await this.initInFlight;
  } finally {
    this.initInFlight = null;          // :298 — clears unconditionally
  }
}
```

The `finally` clears the slot without checking that the slot still holds _its
own_ promise. This is safe only because promise reactions run FIFO, so no later
caller can have installed a newer promise before this one's `finally` runs.

**Fix:**

```ts
const p = (this.initInFlight = this.doInitialize());
try {
  return await p;
} finally {
  if (this.initInFlight === p) this.initInFlight = null;
}
```

The identity check makes the invariant local and removes the dependence on the
scheduler. It is also the precondition for fixing F3-3 cleanly.

## F3-3 — concurrent `reset()` violates its own stated contract

`sdk-agent-adapter.ts:497`

```ts
async reset(): Promise<void> {
  // A reset must produce a genuinely fresh pass, so it must never be
  // ANSWERED by the in-flight guard. Let a running pass settle first (its
  // result is discarded), then dispose and initialize from a clean slate.
  if (this.initInFlight) {
    await this.initInFlight.catch(() => false);   // :503
  }
  this.dispose();                                 // :505
  await this.initialize();                        // :506
}
```

The comment is the contract. Two concurrent resets break it:

1. A and B both see the same `initInFlight` and both await it.
2. It settles. Both proceed.
3. Both call `dispose()` — a double dispose.
4. A calls `initialize()`, installing a fresh `initInFlight`.
5. B calls `initialize()`, **is answered by the guard**, and returns A's pass.

B was promised a genuinely fresh pass and got A's. Step 5 is precisely the
outcome `:499` says must never happen.

**Fix:** serialise resets — a `resetInFlight` slot, or reuse the in-flight
promise identity so a reset can tell "the pass I waited for" from "a pass
started after me". Whatever the mechanism, the double `dispose()` at step 3 must
also be addressed.

## Scope

All three fixes, each with a spec that goes red when the fix is reverted. F3-2
and F3-3 want a fake-timer or manually-settled-promise spec that can actually
interleave two calls — a spec that only exercises the happy path proves nothing
here, since the happy path already passes.

## Ordering note

Do F3-2 before F3-3. The identity check is the cleanest foundation for the
reset serialisation.
