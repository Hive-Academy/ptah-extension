# Implementation report — TASK_2026_308

Date: 2026-08-28
Implemented by a `backend-developer` subagent. Two independent
`code-logic-reviewer` passes. **Three** revision rounds — each found something
real, and the last one corrected an error I had introduced by asking for the
wrong fix.

## The three defects

All three were latent: unreachable in normal operation, and each made correctness
depend on timing or on luck rather than on structure.

### F3-1 — the phantom session

A contentless file reached the filename fallback and produced exactly the phantom
`Session <date>` entry the sidecar guard exists to prevent.

The final guard is a **conjunction**:

```ts
const wholeFileInHand = bytesRead < METADATA_PREFIX_BYTES;
const prefixHasContent = content.trim().length > 0;
if (!sawSessionContent && (parsedRecords > 0 || (!prefixHasContent && wholeFileInHand))) return null;
```

It refuses only when the entire file is in the buffer **and** that buffer holds no
non-whitespace byte. Provable at any file size, not a claim about producers.

Getting there took two wrong turns, both worth recording.

**First**, the guard keyed on `parsedRecords`. That counts parse _successes_, so
it reads identically for "there is nothing here" and "I could not parse what is
here" — only the first is evidence of absence.

**Second — my error.** I asked for the `bytesRead` gate to be dropped in favour of
a content-only signal, and for the exactly-8192 case to be closed. The second
review disproved the result: a file whose prefix is whitespace but which has real
content past byte 8192 was now dropped, where the original imported it. Worse, the
code comment asserted that could not happen. I had asked for one unstated
assumption to be swapped for another, which is precisely the defect class this
task exists to remove. The conjunction restores the length signal beside the
content signal.

**What it deliberately misses**, named at the guard as accepted:

> a whitespace-only file of EXACTLY 8192 bytes or larger still imports as a
> phantom. `bytesRead === METADATA_PREFIX_BYTES` is indistinguishable from a
> truncated read, so no signal available here separates "8192 bytes of whitespace
> and nothing more" from "8192 bytes of whitespace and a session after it" without
> a second read. Do not add that read: a phantom is cosmetic, a dropped session is
> not, and it would cost a syscall on every import for a file shape nobody
> produces.

The trade-off is pinned by a spec pair rather than by prose, so nobody can
re-close the 8192 case unsafely without a test going red.

### F3-2 — `initInFlight` identity

`initialize` cleared the slot in a `finally`, and the guard was correct only
because promise reactions happen to run FIFO. An identity check removes the
dependence on scheduling order.

Its test is **white-box** — it writes the private slot, because no public sequence
can reach the interleaving. `initialize` is the sole writer and writes only when
the slot is null. The reviewer verified that and took a position: keep it. That
unreachability _is_ the defect — the invariant is a property of the current writer
set, not of the method, and a future edit that simplified the clear back would
pass every other spec in the file.

### F3-3 — concurrent reset

`reset` is now **serialised, not de-duplicated**. Each caller queues behind the
previous reset and runs its own dispose plus initialize.

De-duplicating was rejected on argument: a caller arriving after a running reset
had already disposed would be answered by a pass predating its own call — the same
contract violation by another route.

The test builds a lifecycle trace from `invocationCallOrder` across
`configureAuthentication` and `clearAuthentication`. Pre-fix the trace is missing
its trailing `init`: reset B disposed, was answered by the guard holding reset A's
pass, and never ran a pass of its own. Worse than the double-dispose the finding
described — B's dispose lands _while_ the pass it is about to receive is still
building the adapter.

The reviewer verified the contract holds for three concurrent resets and for a
reset arriving mid-dispose, found no wedge or leak, and enumerated every caller.
All four await. But it also found the concurrency is more reachable than assumed:
`RpcHandler.handleMessage` does not serialise by method name, and four frontend
actions have no in-flight guard, so two or three concurrent resets follow from
ordinary clicking.

## New scope, added on the implementer's judgement

A BOM-prefixed session imported under its **filename** rather than the SDK
`session_id` that `CLAUDE.md` makes canonical. Fixed at the decode step in a shared
`decodePrefix`.

The reviewer confirmed the strip is correct — only a leading U+FEFF, only once —
and that sharing the helper with `isTitleOnlySidecar` was the right call rather
than scoping it narrowly.

**The prune is the risky half**, because it deletes stored metadata. The reviewer
traced two cases and found no false-positive prune: a BOM-prefixed real session is
protected by the `system`/`user` early return, more robustly than before, since it
used to be "protected" only by failing to parse. Three specs now pin it, including
a **positive** counterpart the implementer added unasked — without it, the two
safety nets would also pass against a prune accidentally disabled altogether.

## An error the implementer corrected in the reviewer, and one they corrected in themselves

The first review rated F3-1 SERIOUS on a BOM scenario. The implementer wrote the
spec, ran it against the unfixed code, and showed it importing — the multi-line
case was never dropped. They adopted the new discriminator anyway, on the better
argument that the old guard was correct "for reasons not stated at the guard".

They also claimed the single-line BOM case was handled identically before and
after. The second review disproved it: the strip runs before line-splitting, so
that file now parses and imports with its real id where it was previously
discarded. Their own change rescued a file and they did not know it. Now pinned.

Their closing note is worth keeping: _"I had reasoned it through rather than run
it... The empirical check was one spec away and I should have written it before
asserting the conclusion."_

## Verification

`agent-sdk` 75 suites / 1149 tests, `cli-agent-runtime` 38 / 494, `rpc-handlers`
89 / 2498. Zero failures, no flakes on the final round. Typecheck green across all
three; lint warnings all pre-existing.

## Left open

- **TASK_2026_340** — phantom entries already in `SessionMetadataStore` are never
  pruned. Note the accepted ≥8192 whitespace phantom is now reachable by exactly
  one route, and that cleanup pass _can_ afford the second read this hot path
  cannot.
- **LOW, pre-existing** — `dispose()`'s `disposeAllSessions()` is fire-and-forget,
  and `dispose()` now runs once per queued reset rather than once per settle race.

## Outcome

Status `in_progress` → `done`.
