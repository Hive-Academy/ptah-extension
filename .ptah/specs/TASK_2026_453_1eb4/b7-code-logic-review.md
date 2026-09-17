# Code Logic Review — `TASK_2026_453_1eb4` Batch 7 (Task 7.1)

Scope: uncommitted diff of `transcript-render-window.ts`, `transcript-render-window.spec.ts`,
`chat-transcript.component.ts` (feed effect + cleanup only), `chat-transcript.replay-mount.spec.ts`,
`libs/frontend/chat/CLAUDE.md`. Both files read in full (273 and 700 lines respectively), not
only the diff hunks. Read `scroll-regression-analysis.md` (H1/H2 chains, fix design, §2.4/2.5),
`batches.md` Task 7.1 ACs 1-11 and the risk table (:898-908), `b7-codex-report.md`. Worktree HEAD
`d8951fa03`.

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 1        |
| Moderate issues     | 2        |
| Failure modes found | 2        |

## Five logic questions

### 1. How does this fail silently?

No silent failure was found in the retention state machine itself — every state transition is
guarded by `sameSet`/idempotence checks (`transcript-render-window.ts:150,141,159`) and every
release path (rAF win, timer win, new-replay cancel, destroy) clears both handles
(`chat-transcript.component.ts:674-690`), so a "stuck" retention that silently pins memory forever
is not reachable. The closest thing to a silent failure is the residual U1 race below: a
placeholder-to-nothing-visible-wrong swap that produces no error, no log, and no test failure — the
user just sees the transcript detach from the bottom, indistinguishable from any other unpin.

### 2. What user action produces unexpected behaviour?

A user who scrolls up to read an in-progress replay sees blank placeholders for everything above
the always-mounted tail until replay ends (`scroll-regression-analysis.md:95`, acknowledged
trade-off, not a defect). No new user action was found that breaks pinning; `onScroll`,
`scheduleStickToBottom`, and `restoreScrollOnActivation` are byte-identical to before this batch
(`git diff --stat` shows no hunk in any of the three).

### 3. What input data produces a wrong answer?

None found in the reviewed files for the retention mechanism itself. The one nearby residual is
inherited, not introduced: `placeholderHeight` (`transcript-render-window.ts:185-188`) returns
`boundingClientRect.height` for a released retained id, which is the bubble's own border-box
height and does not include the 12 px flex `gap` between slots (`scroll-regression-analysis.md`
F6). That gap is a property of the parent flex container, applied identically whether a slot holds
a bubble or a placeholder, so it does not appear inside the recorded height in either the pre- or
post-batch code — not a regression this diff introduced.

### 4. What happens when a dependency fails?

`IntersectionObserver` absent (jsdom/SSR): `isMounted` short-circuits `!this.supported` before any
retention/tail/intersecting check (`transcript-render-window.ts:171`), so retention is inert and
everything mounts, matching pre-batch behaviour. Covered by
`transcript-render-window.spec.ts:109-121`. A hidden document/tile that never delivers a
`requestAnimationFrame` callback still releases via the 50 ms `setTimeout` race
(`chat-transcript.component.ts:684-686`), covered by
`chat-transcript.replay-mount.spec.ts:379-405`.

### 5. What is missing that the requirements never mentioned?

A dedicated regression test for "flag flips true while the tile is queued behind C2 admission,
zero chunks have arrived yet" — the exact F5 trigger shape from the analysis doc. The mechanism
covers it by construction (rising edge seeds from whatever is currently mounted, which is nothing
or very little at that point, and `syncMessages` unions each subsequent chunk's tail in), but every
new component-level test starts `historyReplaying: true` with `trees` already populated
(`chat-transcript.replay-mount.spec.ts:284,320`), not with the flag true and zero trees for a beat
before the first chunk lands. Low risk given the mechanism is chunk-count-agnostic, but it is the
one scenario named twice in the review brief that has no test built around its exact shape.

## Failure modes

### F1 — Post-replay placeholder swap can still coincide with live growth below (U1, open)

- Trigger: a live `chat:chunk` is delivered (held-fence release, or ordinary live continue) inside
  the window between the falling edge of `historyReplaying` and the deferred release actually
  firing (one rAF, raced with 50 ms).
- Symptom: the deferred release (`transcript-render-window.ts:149-162` via
  `chat-transcript.component.ts:674-681`) unmounts an off-screen retained bubble in favour of a
  measured-height placeholder in the same change-detection pass that a live message grows content
  below the anchor. That is the exact H1 shape (shrink/placeholder swap above the anchor + growth
  below, in one layout), just relocated from "during replay" to "at release."
- Evidence: `scroll-regression-analysis.md:104` (§2.3, "Robust root fix in `onScroll`") and
  `b7-codex-report.md:41` ("U1 remains open") both name this exact race and both defer it to the
  forbidden `onScroll` change. `batches.md:903` carries it in the risk table as "LOW (residual)."
  Nothing in this diff reduces its probability versus the pre-existing plan — the deferred release
  narrows the H1 window from "every chunk boundary during an 8-chunk replay" to "one rAF/50 ms
  slice after replay," which is a large reduction, but it does not close the mechanism.
- Current handling: none inside the reviewed files; explicitly scoped out to Batch 8's 23-attempt
  Electron re-check and, if that surfaces failures, to a future `onScroll` anchoring-aware fix
  (`scroll-regression-analysis.md:104`, marked "a user decision").
- Recommendation: none required of this batch — the forbidden-file list correctly excludes
  `onScroll` from Task 7.1's scope, and the plan already has an escalation path (A4 extension to
  `replayMotionHold`, then the `onScroll` fix). Flagging here because the review brief asked
  directly whether release timing can "re-create H1 at release time," and the honest answer is:
  narrowed, not eliminated. Batch 8's pass/fail on this exact shape is the real gate, not this
  review.

### F2 — Effect-ordering dependency for "release strictly after `replayMotionHold` starts"

- Trigger: none under current code — this is a fragility finding, not an observed failure.
- Symptom: if a future edit reorders the constructor's `effect()` calls, or Angular's effect-flush
  order ever stops being registration order, the retention-release effect
  (`chat-transcript.component.ts:531-549`) could run before the motion-hold effect
  (`chat-transcript.component.ts:457-476`) on the same `historyReplaying` falling edge, changing
  the order the review brief asked about ("rAF/50 ms race runs strictly after finalize and after
  the replayMotionHold start").
- Evidence: both effects independently read `historyReplaying()` and neither declares an explicit
  ordering dependency on the other; the current relative order is purely a consequence of
  constructor declaration order (motion-hold effect declared at :457, retention effect at :531).
- Current handling: none — order is implicit.
- Recommendation: not a required fix for this batch (today's order is correct and the code comment
  at `chat-transcript.component.ts:530` documents the intent), but worth a one-line comment noting
  the ordering dependency on the motion-hold effect, so a future reorder does not silently change
  H2 behaviour. This is the same discoverability gap the style review already flagged for the
  `wasHistoryReplaying`/`wasRenderWindowReplaying` pair — logic-adjacent, not purely cosmetic,
  because the ordering is load-bearing for H2 even though nothing enforces it.

## Blocking issues

None.

## Serious issues

### U1 race not closed by this batch (see F1)

- File: `chat-transcript.component.ts:674-681` (release scheduling),
  `transcript-render-window.ts:149-162` (release effect)
- Scenario: a live event lands in the rAF/50 ms gap after replay finalizes, while an off-screen
  retained bubble is being converted to a placeholder.
- Impact: the exact scroll-sanity failure this whole task exists to close can still occur, at
  lower probability and in a narrower window than before. A user watching a tile that transitions
  straight from replay into live streaming could still see it detach from the bottom.
- Fix: none owed by this batch — correctly out of scope (forbidden-file list), and the plan already
  routes this to Batch 8's empirical re-check with a named escalation (A4, then the `onScroll` fix).
  Recorded as Serious rather than Blocking because the mechanism is bounded (single narrow window,
  not the "every chunk" exposure H1 originally had) and because closing it requires a file this
  batch is explicitly forbidden to touch.

## Moderate and minor issues

- `chat-transcript.component.ts:531-549` — the two edge-tracking booleans
  (`wasHistoryReplaying` at :244, `wasRenderWindowReplaying` at :245) are read by two different
  effects reacting to the same signal with no cross-reference; the relative ordering between them
  is load-bearing for H2 (F2 above) but not documented as such. Moderate: correctness today, but a
  latent trap for a future reorder.
- `chat-transcript.replay-mount.spec.ts:284,320` — no test starts from `historyReplaying: true`
  with an empty or near-empty tree list before the first `setTrees` call, which is the literal
  "flag true before first chunk while queued behind C2 admission" shape named in the review brief
  and in `scroll-regression-analysis.md` F5. Moderate: the mechanism handles it by construction
  (verified by inspection above), but the one scenario that produced the original 31,155 px and
  132 px failures has no test shaped like it.

## Data flow

1. `SessionHistoryReplayer` flips the raw `historyReplaying` signal true before or with the first
   chunk — OK, seeding is chunk-count-agnostic (retained starts from whatever is currently mounted,
   which for a fresh replay is empty or small).
2. Component's retention effect (`chat-transcript.component.ts:531-549`) sees the true edge, cancels
   any pending release, calls `renderWindow.setReplayRetention(true)` — OK, seeds
   `tail ∪ intersecting` (`transcript-render-window.ts:156-161`).
3. Each `syncMessages` call (once per chunk, or once per activation catch-up while hidden) unions
   the current last-6 tail into `retained` — OK, monotonic, bounded to ~6 ids per call, not the
   whole visible history (`transcript-render-window.ts:138-144`).
4. `handleEntries` records real heights for retained ids as they scroll out of the margin, via the
   `wasMounted` check now including `retained.has(id)` — OK for any retained id that is ever
   observed crossing the intersection boundary; an id seeded into `retained` but never observed
   crossing (e.g., it stayed inside the tail the whole replay) has no recorded height, but such an
   id also never needs a placeholder height because it never leaves `tail`/`retained` before
   release — no gap in practice.
5. `historyReplaying` flips false (same synchronous task as finalize, per
   `session-history-replayer.service.ts:221-226`, unchanged by this batch). The retention effect
   sees the false edge and schedules a deferred release instead of releasing inline — OK, this is
   the H2 mitigation; one CD pass sees finalize with retention still active, so no shrink coincides
   with the finalize-edge height changes.
6. rAF or 50 ms timer fires; `release()` clears both handles and calls
   `setReplayRetention(false)` — OK, retained is cleared in one write
   (`transcript-render-window.ts:152-154`); ids that are off-screen fall through to `intersecting`,
   using their recorded height; ids still on-screen stay mounted through `intersecting`. This is
   where F1/U1 lives: if a live event grows content below in the same pass, H1's shape re-forms
   here rather than during replay.
7. A new replay's rising edge, or `cleanup()`, cancels a pending release before it fires — OK,
   verified by dedicated tests (`chat-transcript.replay-mount.spec.ts:407-455`).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| AC1 `setReplayRetention` on/off + idempotence | COMPLETE | none |
| AC2 monotonic union in `syncMessages` + `evictAbsent` pruning | COMPLETE | none |
| AC3 `isMounted` retention policy + unsupported-path passthrough | COMPLETE | none |
| AC4 `handleEntries` records retained heights; release uses measured height | COMPLETE | none |
| AC5 rising edge reads raw flag, runs before `syncMessages`, no `replayMotionHold`/`motionSuppressed` read | COMPLETE | none |
| AC6 deferred release, own rAF handle, raced with 50 ms timer, cancel-on-new-replay | COMPLETE | none |
| AC7 `cleanup()` cancels both handles | COMPLETE | none |
| AC8 no diff in forbidden files/tokens | COMPLETE | none |
| AC9 (a)-(e) pure policy specs | COMPLETE | verified non-vacuous: (a) and (b) would fail against pre-batch `isMounted` (tail/intersecting only) |
| AC10 (f)-(i) component specs | COMPLETE | verified non-vacuous: (f) monotonic-mount test would fail pre-batch (observer-driven swap above anchor) |
| AC11 CLAUDE.md rule 7 extended in place | COMPLETE | none |
| H1 mechanism removed during replay | COMPLETE | closed for the replay window itself |
| H1/H2 fully closed end-to-end (including post-release race) | PARTIAL | F1/U1: narrowed, not eliminated; scoped to Batch 8 + optional future `onScroll` fix |

Implicit requirements not addressed: none beyond F1/U1, which the task's own planning documents
already carry as an open, explicitly-deferred item.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Retention rising edge with observer already reporting intersecting slots | YES | seeded from `tail() ∪ intersecting()` at the moment retention turns on | none |
| Tile queued behind C2 admission, flag true before first chunk | YES (by construction) | seed is whatever is currently mounted (often empty); each later chunk unions in | not exercised by a test shaped exactly like it (Moderate, above) |
| Superseding replay (newer claim replaces older, same tab) | YES | flag may not visibly toggle; stale ids get pruned by `evictAbsent` once `vm().messages` reflects the new session; a genuine false→true toggle cancels any pending release and idempotently no-ops the re-seed since retention was never turned off | none |
| Tile becomes active mid-replay after being hidden for several chunks | YES | retention effect reads raw `historyReplaying()` directly (not nested inside the gated `vm()`), so it still fires while hidden; `vm()` catch-up on activation delivers one large `syncMessages` call whose `nextTail` is still bounded to the last 6 ids | content that arrived while hidden and is not near the viewport renders as ordinary (correctly measured-or-placeholder) windowed content, not specially retained — acceptable, not a regression |
| No `IntersectionObserver` (jsdom/SSR) | YES | `isMounted` short-circuits before any retention check | none |
| Live streaming resumes immediately after replay, before the deferred release fires | PARTIAL | retention effect does not re-schedule since `wasRenderWindowReplaying` is already false; `syncMessages` keeps unioning while still technically active | this is the F1/U1 window — release still eventually fires and can coincide with the live growth |
| Destroy with a pending release | YES | `cleanup()` cancels both handles unconditionally | none |
| Restart (new replay) with a pending release | YES | rising edge cancels before re-seeding (re-seed is a no-op since retention never turned off) | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: F1/U1 — the post-replay placeholder-vs-live-growth race is narrowed to a single
  rAF/50 ms window but not eliminated, and nothing in this batch (correctly, per its forbidden-file
  scope) closes it. Batch 8's 23-attempt Electron re-check is the actual proof; if it surfaces a
  failure with a small (non-132-multiple) distance, this is the mechanism to suspect first.
- What a robust implementation would add: (1) a one-line comment tying the retention effect's
  ordering to the motion-hold effect it must run after (F2); (2) a component test that starts
  `historyReplaying: true` with zero or near-zero trees before the first chunk lands, matching the
  original F5 trigger shape exactly rather than by construction only; (3) the already-planned
  `onScroll` anchoring-aware fix, if Batch 8 shows F1/U1 firing in practice.

## Delta

Scope: revise round 1 per `b7-codex-report.md:174-193` — two new specs in
`chat-transcript.replay-mount.spec.ts` (:352-374 zero-tree queued replay, :376-402 H2 effect-order
pin), the feed-effect comment at `chat-transcript.component.ts:530` (replaced, net zero lines), and
the class doc at `transcript-render-window.ts:27-28` (extended, net zero lines). Diff re-read in
full (`git diff` on both source files and the spec file); no other file touched.

### Spec 1 — `enables retention before an admission-queued replay receives its first chunk` (:352-374)

Non-vacuous. Starts `historyReplaying: true, trees: []` (the exact F5 shape: flag true, zero
chunks yet), grows to 50 then 98 trees, and asserts the original tail (indices 44-49 of the
first-50 list) stays mounted after the tail moves to indices 92-97 of the 98 list, while an
explicitly-non-emitted, never-intersecting middle slot (index 20) never mounts. Traced against
pre-batch `isMounted` (`tail.has(id) || intersecting.has(id)`, no `retained`): once the tail moves
to the last 6 of 98, ids 44-49 drop out of `tail`, and since this harness's fake observer only
populates `intersecting` on an explicit `h.observer.emit(...)` call (none was made for those
slots), `intersecting.has(id)` is also false for them — so the pre-batch check yields `false` and
the assertion `.toBeTruthy()` on `firstTail` at :370-371 would fail on `d8951fa03`. This directly
closes the Moderate 2 finding from the base review (no test shaped like the admission-queue
trigger existed before this round).

### Spec 2 — `starts the replay motion hold before scheduling retention release` (:376-402)

Non-vacuous under a source-order swap. The spy replaces
`component.scheduleReplayRetentionRelease` and asserts `component.replayMotionHold()` is already
`true` at the instant that method is invoked, then delegates to the real implementation. Today the
motion-hold effect (`chat-transcript.component.ts:457-476`) is declared before the render-window
feed effect (`:531-549`); both react to the same `historyReplaying` falling edge in the same
change-detection flush, and Angular's effect scheduler flushes dirty effects in registration order,
so the motion-hold effect's synchronous `this.replayMotionHold.set(true)` (:470) runs and settles
before the feed effect calls `scheduleReplayRetentionRelease()`. If the two `effect()` registrations
in the constructor were swapped, the feed effect would run first in that flush, calling
`scheduleReplayRetentionRelease()` before the motion-hold effect has set the flag, so
`replayMotionHold()` would still read `false` at the assertion point and the spec would fail. This
closes the F2 fragility finding from the base review, and does so more durably than the one-line
comment I had recommended — a comment can rot silently, this spec fails loudly on a reorder. One
caveat carried forward: the guarantee both the code and this spec rely on (same-flush effects fire
in registration order) is Angular's current observed behaviour, not a documented contract; that
residual fragility is now pinned by a test instead of undocumented, which is the meaningful
improvement, not a full elimination of the dependency.

### Comment / doc edits

Both are text-only. `git diff` on `transcript-render-window.ts` shows only the JSDoc block above
`export class TranscriptRenderWindow` changing; every runtime line (fields, methods, signal
writes) is byte-identical to the version already reviewed above. `git diff` on
`chat-transcript.component.ts` shows the same for the feed-effect leading comment and the
`cleanup()` doc comment — no statement inside either function changed. Confirmed no behaviour
change: re-diffing both files against the versions read for the base review turns up zero
non-comment hunks beyond what was already reviewed and approved.

### Style reviewer's two minors (`b7-code-style-review.md`)

- Minor 1 (raw-vs-gated rationale, `chat-transcript.component.ts:530`): closed. The new one-line
  comment ("Read replay raw across hides; vm/active keep hidden content work gated.") states the
  distinction the old comment omitted — that `historyReplaying` is deliberately unGated while
  `vm`/`active` stay gated. Terser than the original 3-line rationale, but the specific gap the
  reviewer named (why the third signal is raw) is now stated, not just implied.
- Minor 2 (class doc undersells retention, `transcript-render-window.ts:27-28`): closed. The class
  doc now names "retains the monotonic replay mount set" as a third policy beside mount-decision
  and measured-height, replacing the stale "Nothing else" undersell.

### Verdict

- Recommendation: APPROVE (unchanged)
- Confidence: HIGH
- Both revise-round specs are non-vacuous by direct trace against pre-batch code and against a
  hypothetical effect-order swap; neither comment/doc edit changed behaviour; both style minors
  are closed.
- Open finding (unchanged, not addressed this round because it was explicitly out of scope): F1 /
  Serious — the post-replay release-window race (a live event growing content below during the
  single rAF/50 ms release interval can still recreate the H1 layout shape at lower probability).
  Revise round 1's own report (`b7-codex-report.md:184`) confirms this is deliberately untouched
  and remains routed to Batch 8's 23-attempt Electron re-check and the U1 `onScroll` escalation.
  This is the one item this review carries forward as still open.
