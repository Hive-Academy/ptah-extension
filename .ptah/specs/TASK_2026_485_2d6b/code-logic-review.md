# Code Logic Review — TASK_2026_485_2d6b (adversarial)

Scope: `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts` (+ spec),
`libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.ts` (+ spec).

## Verdict

**PASS**

Ran both in-scope spec files directly (bypassing `nx run-many`, which on this
box also drags in unrelated flaky suites in `platform-electron` —
`electron-state-storage-worker-loop.spec.ts`,
`workspace-watch-host.entry.spec.ts`, `electron-state-storage-commit-store.spec.ts`,
none of them touched by this diff):

- `libs/backend/platform-electron`: `npx jest electron-state-storage-worker-protocol.spec.ts` → 38/38 passed.
- `libs/backend/cli-agent-runtime`: `npx jest agent-events.spec.ts` → 11/11 passed.
- `ptah_get_diagnostics` on both changed source files: 0 errors, 0 warnings.

I went in hunting for the five listed failure classes and did not find a
defect that survives evidence. What follows is what I checked and why each
lead did not pan out, plus two Minor items that are real but not blocking.

## Hunt 1 — truthiness guard vs. presence guard (data loss?)

**Refuted, with evidence.** `saveAgentOutput`'s own body
(`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:677-687`) already
normalizes every optional field before doing anything else:

```
const stdout = output.stdout ?? '';
const streamEvents = output.streamEvents ?? [];
const hasOtherOutput = (output.segments?.length ?? 0) > 0 || streamEvents.length > 0;
```

`output.stdout ?? ''` and `output.segments?.length ?? 0` produce the identical
value whether the caller's object has `stdout: ''` as an own key or has no
`stdout` key at all, and identically whether `segments: []` is present or
absent. There is exactly one implementation of `saveAgentOutput`
(`grep` confirms `session-metadata-store.ts` is the sole definition; every
other match is a call site or a jest mock), so this normalization is not
platform-specific — it applies whether `this.storage` takes the async
(`replaceJsonSequence`, `agent-events.ts` line 689) or sync (`storage.update`,
line 704-709) branch, because `segments`/`streamEvents`/`stdout` are computed
*before* that branch runs.

So the truthiness guard at `agent-events.ts:429-435` (`persistedOutput.stdout
? {...} : {}`, `persistedOutput.segments?.length ? {...} : {}`) cannot lose an
"empty but real" value relative to a presence guard, because the consumer
collapses both representations to the same normalized value before it does
anything observable (write to storage, or drop the write entirely when both
`segments` and `streamEvents` end up empty, line 687). An empty-string stdout
or an empty segments array was never going to persist a distinguishable
"explicit empty" record either way — `record` (line 704-709) itself only ever
adds `segments`/`streamEvents` keys when their length is `> 0`, which is
pre-existing code untouched by this diff.

Checked, found nothing: no pre-existing spec in `agent-events.spec.ts` asserts
an *explicitly-present* empty key (`grep` for `stdout: ''`, `segments: []`,
`hasOwnProperty` finds none before this diff's own additions), so there is no
regression against prior test expectations either.

## Hunt 2 — `shouldRetry` dead branches / over-broad substring match

**Partially real, Minor only — no lost retry on a transient error found.**

`agent-events.ts:444-464` has two blocks that check almost the same thing
twice:

```ts
if (error instanceof Error) {
  if (error.name === 'ElectronStateWorkerProtocolError' || ...) return false;
}
const msg = error instanceof Error ? error.message : String(error);
return (!msg.includes('Parent session not found') && ... && !msg.includes('ElectronStateWorkerProtocolError'));
```

The second block is reachable only when `error instanceof Error` is true and
none of the first block's five conditions matched (in which case its four
`msg.includes` checks are trivially true — they were just proven false a
statement earlier) or when `error` is not an `Error` at all (then `msg =
String(error)`, and the five checks are live). So: not fully dead, but for
every `Error` instance the second block's four substring checks are
functionally inert; they only matter for a non-Error throw. The extra
`!msg.includes('ElectronStateWorkerProtocolError')` check in the second block
tests the **message** text for the **class name**, which `.message` never
contains (only `.name` is set to that string) — this one clause is dead in
practice. This is a Minor clarity issue (redundant, confusing control flow),
not a functional bug: I could not construct an `Error` for which block 1 and
block 2 disagree.

On the "does a transient error now get skipped" question: I grepped every
`'Worker message'` string in the repo
(`libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.ts`
lines 638, 648, 654, 670, 683, 690, 707, 782, 792, 804, 818, 831, 988, 1013,
1027, 1042, 1056). Every one of them is a deterministic structural-validation
failure (payload too large, too many values, depth exceeded, non-finite
number, cyclic value, non-plain object, non-JSON-compatible value) — none of
them represents a transient/worker-crash condition. Actual transient/crash
errors from the worker host (`electron-state-storage-worker-host.ts`) use
different, disjoint wording — `"State storage worker exited with code ..."`,
`"State storage worker is not running"`, `"Worker returned an unknown
operation id"` — none contains the substring `'Worker message'`. So the broad
match does not catch a genuinely transient failure today. It *is* a coupling
risk (a future error message that happens to start "Worker message..." for a
transient reason would silently stop retrying), but that is a "what the
requirements never mentioned" note, not a demonstrated regression.

One adjacent gap, not introduced by this diff: `StateStorageValueTooLargeError`
(`libs/backend/platform-core/src/state-storage-errors.ts:21-31`) is also a
deterministic, non-retriable failure (the value's size does not change on
retry) but its name/message match none of the five patterns, so it still gets
three retries. Out of scope for this diff (it wasn't one of the three named
throw sites and the diff didn't touch that error class), but worth naming
under "what is missing that requirements never mentioned."

## Hunt 3 — old message string matched elsewhere?

**Refuted.** `grep -r "non-cloneable"` across the whole repo returns six hits:
the two remaining literals in `agent-events.ts` (correctly still comparing
against the *old* wording for backward compatibility with errors thrown by an
un-upgraded worker — reasonable), the two task-spec docs, and one comment in
`apps/ptah-electron-e2e/src/specs/state.spec.ts:100-109`. That e2e spec's
`'non-cloneable'` is prose in a code comment, not an assertion — the test only
checks `result.threw` and a subsequent read (`state.spec.ts:119-128`), never
`.message` text. The rename does not break it.

## Hunt 4 — would the new specs fail before this change?

**Confirmed yes, for all three.**

- `agent-events.spec.ts:251-277` ("yields no own keys ...") — before the fix,
  the literal at `agent-events.ts:428` (pre-diff) unconditionally set
  `segments: persistedOutput.segments` and `streamEvents:
  persistedOutput.streamEvents`; with only `stdout` in the mocked
  `readOutputForPersistence`, those two keys would exist with value
  `undefined`, so `hasOwnProperty('segments')` would be `true` against the
  test's expectation of `false`. Fails on old code.
- `agent-events.spec.ts:432-476` ("does not retry ...") — before the fix,
  `shouldRetry` only excluded `'Parent session not found'`, so the injected
  `ElectronStateWorkerProtocolError` would be retried 3 times
  (`saveAgentOutput` called 4 times total), against the test's
  `toHaveBeenCalledTimes(1)`. Fails on old code.
- `electron-state-storage-worker-protocol.spec.ts:695-702` — asserts
  `message: 'Worker message contains a non-JSON-compatible value'` against
  `assertJsonCompatibleValue(undefined)`, which before the rename threw
  `'Worker message contains a non-cloneable JSON value'`. Fails on old code.

All three are real regression tests, not tautologies.

## Hunt 5 — third throw site at `:1053` (not named in the brief)

**Correct and reachable, not collateral.** `generateSnapshotOperations`
(`electron-state-storage-worker-protocol.ts:975-1058`) is called from
production code in both `electron-state-storage-worker-host.ts:322,518` and
`electron-state-storage-worker-runtime.ts:682,720` on real state-storage
writes — not test-only. Its parameter is typed `Record<string, JsonValue>`,
but the runtime still needs the defensive final `throw` (now renamed
consistently with the other two sites) because a value can arrive as
`undefined`/function/symbol/bigint at runtime despite the static `JsonValue`
type (e.g. an object literal with an actually-`undefined`-valued property).
The rename here is the third of three literally-identical throw messages and
is applied uniformly; nothing about it is dead or mismatched with the other
two.

## Minor findings (non-blocking)

1. `agent-events.ts:444-464` — `shouldRetry`'s second block is functionally
   redundant for every `Error` instance (see Hunt 2). Recommend collapsing to
   a single check; not required for correctness.
2. `agent-events.ts:478-481` — the log line
   `` `${tag} Failed to persist CLI session reference after retries` `` fires
   verbatim whether the failure exhausted 3 retries or (as of this fix) was
   never retried at all, which now under-describes the deterministic-failure
   case for anyone reading logs. Cosmetic.

## What I did not find

No blocking or serious issue. No lost data from the truthiness guard (Hunt 1),
no demonstrated lost retry on a transient failure (Hunt 2), no broken message
match elsewhere in the repo (Hunt 3), the new specs are real regression tests
(Hunt 4), and the third throw site is correct and reachable (Hunt 5).
