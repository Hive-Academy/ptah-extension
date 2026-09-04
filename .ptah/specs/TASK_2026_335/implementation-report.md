# Implementation report — TASK_2026_335

Date: 2026-08-28
Implemented by a `frontend-developer` subagent, reviewed by an independent
`code-logic-reviewer`. No revision round was needed — the review found no
serious or moderate defects.

## The governing rule

Silent truncation of a user's own content is a defect, not an optimization. The
fixes had to make loss **visible**, not raise a bound. TASK_2026_323 measured
those caps as necessary.

**No cap was widened.** `MAX_AGENT_SEGMENTS` (500), `MAX_FRONTEND_BUFFER` (50 KB)
and `MAX_AGENT_STREAM_EVENTS` (2000) are unchanged, verified by the reviewer. A
new `AGENT_SEGMENTS_CAP_SLACK` of 100 permits a momentary overshoot before a trim
runs — that is a batched ceiling, not a raised one, and it mirrors the
`AGENT_STREAM_EVENTS_CAP_SLACK` amortization already accepted for the
neighbouring cap. Without it the fold would run on every delta past 500, which is
exactly the shape of the `slice(-500)` it replaces.

## Defect 1 — the segment fold

Three keep passes, then a fold. Recent 100 segments; then the newest landmarks;
then any unclaimed budget returned to the most recent remaining segments. That
third pass matters: without it an adapter that emits few landmarks discards
hundreds of recoverable segments to honour a budget nothing is using.

`info` counts as a landmark deliberately — Codex and Copilot report per-turn token
usage there and the stats bar re-derives totals from them, so dropping old ones
silently rewrites the user's token counts.

### What is still unrecoverable, stated plainly

`text` and `thinking` are folded into one synthetic segment each, in
first-dropped order, so they render as the leading prose block they were.

**Landmarks that still do not fit are counted, not folded.** Tool name, args,
result, exit code and change kind are genuinely gone for those — only a headcount
survives. That is a real limit, and the marker is honest about it: the reviewer
confirmed the invariant `preserved + dropped === trimmed` holds, and a spec pins
the all-landmark case at `preserved === 0`.

One `info` marker leads the card carrying both numbers. The reviewer verified it
cannot stack, cannot be dropped by a later trim, and cannot double-count across
successive trims — `isSegmentTruncationMarker` excludes it from all three keep
passes, and `readSegmentMarker` rolls its counts forward without counting the
marker itself as content.

The same treatment now applies at `loadCliSessions`, which carried its own copy of
the bare slice. That is where loss was permanent, because the persisted
`CliSessionReference` is the last copy.

## Defect 2 — the teardown flush

Four signals funnel into one idempotent `flushPendingSave()`: `pagehide`,
`beforeunload`, `visibilitychange` → hidden, and `DestroyRef.onDestroy`.

`pagehide` is the load-bearing one for VS Code: by the time the host's
`onDidDispose` fires the webview is already gone, so the host cannot ask it to
flush and the webview has to notice for itself.

Reviewer-verified: the flush is genuinely idempotent, several signals in one
unload write at most once, `onDestroy` flushes **before** removing the listeners,
and `localStorage.setItem` really is synchronous through the whole call chain —
that was checked rather than assumed.

The `visibilitychange` flush does fire during ordinary use, such as switching
editor tabs. Confirmed cheap: a hide with nothing pending costs one boolean check.

### The Electron claim, and the gap the review added

The implementer argued no Electron wiring is needed, because `app.quit()` closes
the window, which unloads the renderer and fires `beforeunload` synchronously.
The reviewer confirmed that, and confirmed `reloadWindow` deliberately uses
`app.quit()` rather than `app.exit()` for the same class of reason.

They found one path the write-up did not name: **OS-level session termination** —
a Windows logoff or shutdown, where the OS may kill the process before an
in-flight `beforeunload` write completes. No `session-end` listener exists
anywhere. Not a regression, and inherent to any `beforeunload` strategy, but the
"no wiring needed" framing was slightly too clean.

### The resume discard, deliberately out of scope

`session-loader.service.ts:793` calls `chat:resume` and drops `data.events` and
`data.messages` on the floor as "already cached from localStorage". Reconciling
needs a divergence oracle that does not exist: the primary payload is `events`,
so reconciling means clearing the tab and replaying the whole transcript, and
gating that on a message-count comparison is unsafe because compaction and
tool-only messages make the counts legitimately unequal. A naive guard would fire
a full reload on most restores.

With the teardown flush in place the loss is closed at source. The reconcile would
only cover crash, OOM and quota — a real but separate task.

## Defect 3 — the stdout truncation marker

The card now leads with `… N characters of earlier output were dropped to bound
this card.` It renders as a distinct `info` block, and on stderr it is classified
informational rather than painted in the red error box — without an explicit rule
it fell through to the unknown-pattern default, which is "error".

The count is cumulative: `capBuffer` strips and re-reads its own previous notice
before computing the new one. That also means the notice cannot be eaten by a
later trim, since it lives at the head, which is the part the function eats.

## Proof the tests are not vacuous

Every fix was reverted in place and the tests re-run, at both store and DOM level:

| Reverted                      | Observed                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `slice(-500)` restored        | 4 failures — `Expected substring: "chunk-0"` against a string starting at `chunk-150`; markers absent |
| rendered DOM                  | 2 failures — card `textContent` literally begins at step 150                                          |
| `_armTeardownFlush()` removed | 4 failures, one per signal — stored `messages` array empty                                            |
| marker-less `capBuffer`       | 2 failures — no notice line at all                                                                    |
| rendered card                 | 2 failures — head segment typed `text` not `info`; stderr notice typed `error`                        |

## Verification

`chat-state` 14 suites / 283, `chat` 59 suites / 869, `chat-streaming` 19 suites / 365. Typecheck green across all three. Ten downstream consumers of `chat-state`
and `chat-streaming` run in two batches of five — all passed.

The known load-sensitive perf assertion at
`execution-tree-builder.service.spec.ts:495` failed once under three-project
parallel load and passed on a solo re-run, as it has all run.

## Left open

- **LOW — the stdout notice has no opaque sentinel.** Recognition is a regex over
  arbitrary agent text. An agent whose own stdout emitted a byte-identical line
  would have it absorbed and its digits rolled into the count. Very unlikely given
  the wording and leading `…`, but the detection is textual rather than
  structural.
- **LOW — OS session termination**, described above.
- **The "mirrors the streamEvents spec" claim was slightly overstated.** The
  reviewer checked: the older spec bounds by `MAX` alone, which holds there only
  because its data folds to a handful of events per trim. The new bound is the
  more honest one for its own data shape.

## Outcome

Status `in_progress` → `done`.
