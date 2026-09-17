# Code Style Review — `TASK_2026_453_1eb4` Batch 7 (Task 7.1)

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 8/10                                 |
| Assessment      | APPROVED                             |
| Blocking issues | 0                                    |
| Serious issues  | 0                                    |
| Minor issues    | 2                                    |
| Files reviewed  | 4 (+ CLAUDE.md doc)                  |

Scope: uncommitted diff of `transcript-render-window.ts`, `transcript-render-window.spec.ts`,
`chat-transcript.component.ts`, `chat-transcript.replay-mount.spec.ts`,
`libs/frontend/chat/CLAUDE.md`. Read in full, not just changed hunks. Read
`batches.md` "Common rules" and Task 7.1 (:922-1027), `scroll-regression-analysis.md` §2,
`b7-codex-report.md`.

## Five style questions

### 1. What breaks in six months?

Nothing structural. The new state (`retained` signal, `replayRetentionActive` flag,
`retentionReleaseRafId`/`retentionReleaseTimeoutId`) is confined to
`TranscriptRenderWindow` and the one feed effect that owns it
(`chat-transcript.component.ts:530-548`). If a future change adds a second consumer of
`historyReplaying()` that also wants to gate mounting, it should extend
`setReplayRetention`, not add a third boolean edge-tracker beside `wasHistoryReplaying`
and `wasRenderWindowReplaying` — two already coexist by design (`chat-transcript.component.ts:242-243`)
because AC 5 required the render-window edge to be independent of the replay-motion-hold
effect's edge (`scroll-regression-analysis.md` §2.1 "Rising edge"). A third boolean would be
the point to extract a small shared edge-detector.

### 2. What would a new team member misread?

The two `was*Replaying` fields (`wasHistoryReplaying` at :244, `wasRenderWindowReplaying`
at :245) look like they duplicate the same bookkeeping. They do not — one drives the
300 ms motion-hold effect (:457-476), the other drives the retention feed effect
(:531-548) — but nothing at either declaration site cross-references the other. A
one-line comment at :245 pointing to the constructor effect would save a reader the trip.

### 3. What does this cost to maintain?

Two new timer handles (`retentionReleaseRafId`, `retentionReleaseTimeoutId`) plus a
cancel/schedule pair (`cancelReplayRetentionRelease`, `scheduleReplayRetentionRelease`,
:674-691). This mirrors the file's existing `scrollRafId` and `finalizingTimeoutId`/
`replayMotionHoldTimeoutId` null-sentinel cancel style exactly, so a maintainer who
already knows this file pays no new conceptual cost — only two more fields to null out in
`cleanup()` (:657-671, done).

### 4. Where is this inconsistent with the rest of the repository?

It is not. The rAF-raced-with-a-50ms-timer pattern also exists in
`session-history-replayer.service.ts:303-313` (admission paint yield, cited in Task 7.1's
own "pattern to follow"), but that version uses a `settled` boolean guard around a
`Promise` resolution. The component's version instead cancels the sibling handle inside
`release()` before acting, which is the same idiom already used by every other
timer/rAF pair in this file. Reusing the local idiom instead of importing the replayer's
`Promise`-based idiom is the right call here — this file has no other `Promise`-returning
scheduling, and matching the immediate neighbours (`scrollRafId` cancel style, :662-665)
is more consistent than matching a service two folders away.

### 5. What would you have done differently, and why is that better rather than merely other?

I would have added one cross-reference comment linking `wasHistoryReplaying` and
`wasRenderWindowReplaying` (point 2 above) and folded the class-level doc comment on
`TranscriptRenderWindow` (`transcript-render-window.ts:26-39`) to name replay retention as
a third policy alongside "which ids are mounted" and "last measured height" — right now
the policy is documented only at the method level (`setReplayRetention` :148,
`isMounted` :169-176), and the class doc's "Nothing else" line undersells what the class
now does. Neither is a functional gap; both are five-minute discoverability wins that
cost nothing to defer, which is why they are Minor rather than Serious below.

## Blocking issues

None.

## Serious issues

None.

## Minor issues

- `chat-transcript.component.ts:530` — the feed effect's comment was shortened from a
  3-line rationale ("Reads the GATED `vm` and `active` only, so a hidden transcript
  neither re-derives its tail nor processes callbacks — the same freeze the view model
  applies to the DOM") to one line ("Feed retention from the raw replay flag and content
  from the gated vm."). The dropped rationale is not lost information — the sibling
  content-follow effect at :489-491 states the same GATED-freeze contract for the same
  `vm()`/`active()` pair — but the new effect also reads a third, un-gated signal
  (`historyReplaying()`) and the comment does not say why that one is deliberately raw
  while the other two are gated. A reader diffing this effect against the ones above it
  has to infer that from AC 5 / rule 7, not from the code. Not a compression-to-hit-700
  concern: the file's net change is a legitimate +27 lines (673 → 700, verified via
  `git diff --stat` and `wc -l`), not a deletion elsewhere to make room.
- `transcript-render-window.ts:26-39` — the class doc says the window "decides which
  message ids are mounted, and remembers each one's last measured height. Nothing else."
  Replay retention is now a third first-class policy (its own signal, its own public
  setter, its own branch in `isMounted`/`handleEntries`/`evictAbsent`) but is not named at
  the class level, only inside the individual method docs (`setReplayRetention` :148-149,
  `isMounted` :173-176). A reader skimming the class doc alone would not know retention
  exists.

## File-by-file

### `transcript-render-window.ts`

Score 9/10 — 0 blocking, 0 serious, 1 minor (class doc, above). `retained` follows the
exact shape of `tail`/`intersecting` (private `signal<ReadonlySet<string>>`, `sameSet`
short-circuit before every write: :141, :159, and the `evictAbsent` addition at :255-263
mirrors the existing `intersecting` prune loop at :245-253 line for line). `setReplayRetention`
sits next to `syncMessages`, the method it is coupled to, matching the file's existing
grouping of related setters (`setActive` immediately follows it). `isMounted`'s new branch
(:173-176) reads cleanly as "retention on → check retained; off → fall through to the
existing behaviour," which is the same short-circuit shape the method already used for
`tail`. No naming issue: `retained`/`replayRetentionActive`/`setReplayRetention` read as
what they do, not how (no `helper`/`manager`/mechanism nouns).

### `transcript-render-window.spec.ts`

Score 9/10 — 0/0/0. Five new tests map 1:1 to AC 9(a)-(e) (`scroll-regression-analysis.md`
§2.4 items 1-5): tail-leaver retained without a callback, never-mounted intersecting id
stays unmounted, retained height recorded and released to that exact height (not the
120 px fallback), rising-edge seeding from an already-intersecting id, and eviction
pruning `retained` while restoring `tail ∪ intersecting` on release. Test names state the
behaviour under test, not the mechanism, matching the file's existing style (e.g. "keeps a
streaming message mounted while it grows past the tail").

### `chat-transcript.component.ts`

Score 8/10 — 0 blocking, 0 serious, 1 minor (the shortened comment, above). Field
declarations (`retentionReleaseRafId`, `retentionReleaseTimeoutId`,
`wasRenderWindowReplaying`) sit beside their same-shaped siblings
(`scrollRafId`/`wasHistoryReplaying`), not appended at the end of the class — this is the
file's existing convention and it was followed. `scheduleReplayRetentionRelease`/
`cancelReplayRetentionRelease` (:674-691) are private, single-purpose, and named for what
they do; `cleanup()` calls the cancel unconditionally (:666), matching how `scrollRafId`
and `finalizingTimeoutId` are torn down two lines above and below it. The file is exactly
700 lines post-diff by an ordinary net addition (see Minor issue 1), not by a deletion
elsewhere — no evidence of compression to hit the ceiling. No structural split is
warranted at 700 lines: per the root CLAUDE.md file-size rule, 700 is the warn threshold
(confirmed by the codex report's lint output showing no `max-lines` warning) and "past
1000 means a deliberate look" — this file is 300 lines under that bar, and the added
surface (one effect edge + one cancel/schedule pair) is exactly the kind of small,
file-local addition the facade rule is not meant to force out into a collaborator.

### `chat-transcript.replay-mount.spec.ts`

Score 9/10 — 0/0/0. The rewritten `:297-301` case is rewritten in place, not deleted, and
its new name ("defers a never-mounted intersection until replay retention releases")
describes the corrected rule rather than the old one it replaces, avoiding a stale name
on new behaviour. The five new tests (monotonic growth across three chunk sizes,
frame-deferred release at measured height, timer-fallback release, destroy cancellation,
restart cancellation) split AC 10(h) — which bundled "hidden-window release" and "destroy
with a pending release" into one plan bullet — into two focused tests instead. That is a
legitimate one-assertion-per-test split, not scope creep: both plan-listed behaviours are
present, just not sharing a test body. The private-field inspection via
`componentInstance as unknown as { retentionReleaseRafId: ...; retentionReleaseTimeoutId: ... }`
(:393-396, :418-421, :447-450) is not a new pattern in this file — it matches
`chat-transcript.replay-motion.spec.ts:199-219`, which already inspects
`replayMotionHoldTimeoutId` the same way.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| No `content-visibility`, no edit to `onScroll`/`scheduleStickToBottom`/`restoreScrollOnActivation`/`lastScrollTop`/`.css` | PASS | `git diff --stat` lists only the 4 code files + CLAUDE.md; no `.css`/`.html` in the diff; grep of the diff for `content-visibility` and the four scroll symbols is empty |
| CLAUDE.md rule 7 bullet extended, not duplicated | PASS | `libs/frontend/chat/CLAUDE.md` diff shows one bullet's text extended in place, no new bullet added |
| No `V2`/`Legacy` copies; replace in place | PASS | No duplicate API surface; `isMounted`/`handleEntries`/`evictAbsent` each gained a branch, not a sibling method |
| No `TODO`/stub/sentinel-catch | PASS | No `catch` blocks added; no `TODO`/`FIXME`/`stub` strings in the diff |
| Null-sentinel cancel style for timer/rAF handles (`scrollRafId`, `finalizingTimeoutId`) | PASS | `retentionReleaseRafId`/`retentionReleaseTimeoutId` follow the identical `!== null` guard + null-reset shape (`chat-transcript.component.ts:684-690`) |
| Signal write short-circuit (`sameSet`) before every mutation | PASS | `retained.set(...)` gated by `sameSet`/size checks at :141, :153, :159; `evictAbsent` only writes when a prune actually removed an id (:263) |
| File-size soft ceiling 700 (warn-level) | PASS (at the line, not over it) | `chat-transcript.component.ts` is exactly 700 lines; codex report's lint run shows 0 `max-lines` warnings |
| Facade-rule split trigger (only past ~1000, and only for a real fragmentable concern) | NOT_APPLICABLE | File is 300 lines under the "deliberate look" mark; the added surface is one effect edge + one cancel pair, not a separable concern with its own name |

## Maintenance debt

- Introduced: one new signal (`retained`), one boolean flag, two timer handles, one public
  method (`setReplayRetention`), two private helpers (`scheduleReplayRetentionRelease`/
  `cancelReplayRetentionRelease`), one edge-tracking boolean (`wasRenderWindowReplaying`).
  All follow existing shapes already present in the same two files.
- Retired: nothing. The prior behaviour (observer-reported ids mount immediately during
  replay) is replaced, not removed as dead code — its test coverage was rewritten to the
  new rule per AC 10(i).
- Net: small, local addition with no new abstraction layer, no new dependency, and no
  cross-file API surface beyond the one new method on `TranscriptRenderWindow` that its one
  consumer already knew how to call (`setActive` sits right beside it).

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: none blocking; the two minor documentation gaps (edge-tracker
  cross-reference, class-doc mention of retention as a named policy) cost a reader a few
  minutes of inference, not correctness.
- What a 10/10 version would do differently: add the one-line cross-reference comment
  between `wasHistoryReplaying` and `wasRenderWindowReplaying`, and extend the
  `TranscriptRenderWindow` class doc to name replay retention as a third policy the class
  owns, alongside mount and height.
