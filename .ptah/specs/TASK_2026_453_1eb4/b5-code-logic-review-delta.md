# Code Logic Review (Delta, Revise Round 1) — `TASK_2026_453_1eb4` Batch 5 (C5 replay render-window fence)

## Summary

| Metric              | Value                                |
| -------------------- | ------------------------------------ |
| Overall score         | 8/10 (unchanged from base)           |
| Assessment            | APPROVED                             |
| Blocking issues       | 0                                     |
| Serious issues        | 0                                     |
| Moderate issues       | 1 (carried, unresolved by design)    |
| Failure modes found   | 2 (both pre-existing, carried)        |

Scope: uncommitted `git diff` of `chat-transcript.component.ts`,
`chat-transcript.component.html`, `transcript-render-window.ts`,
`transcript-render-window.spec.ts`, `libs/frontend/chat/CLAUDE.md`, plus the
untracked `chat-transcript.replay-mount.spec.ts`. Verified against
`b5-code-logic-review.md` (base, APPROVED, this reviewer's own prior work),
`b5-code-style-review.md` (NEEDS_REVISION, 2 serious findings driving this
round), and `b5-codex-report.md`'s "## Revise round 1" section. Round 1's own
claim — behaviour-neutral: delete dead `finalizedCount` field, rename
`syncMessages`'s parameter to `streamingBoundary`, two doc additions — is the
thing under test here, not assumed.

## Five logic questions

### 1. How does this fail silently?

No new silent-failure surface. The round-1 diff is a field deletion, a
parameter rename, and prose; none of the three changes an executable branch,
so there is nothing new that could report success while doing the wrong
thing. The base review's answer to this question (no silent-failure path in
the C5 diff) is untouched by round 1.

### 2. What user action produces unexpected behaviour?

None newly introduced. The base review's finding — a user scrolling up before
the `IntersectionObserver`'s first callback sees a slot drop to a placeholder
(A7 residual, `transcript-render-window.ts:142-146`) — is unaffected: that
file's `isMounted()` logic was not touched by round 1, only `syncMessages`'s
parameter name and doc comment (`transcript-render-window.ts:112-119`).

### 3. What input data produces a wrong answer?

Re-verified the base review's central claim under the new names: the
non-compaction resume path's synchronous `applyResumingSession` reset always
precedes an in-flight replay's next opportunity to observe supersession
(`session-loader.service.ts:657, 685-691`; `session-history-replayer.service.ts:215`),
so `streamingMessages()` never exposes a stale non-finalized tree with
`isStreaming=true`. Round 1 touches none of these files — `session-loader.service.ts`
and `session-history-replayer.service.ts` are absent from `git diff --stat`
(confirmed: only the 5 files listed in Scope changed). The compaction-targeted
reload gap the base review flagged (`session-loader.service.ts:677-679`,
reset deferred past the `chat:resume` await) is unchanged and still open;
`b5-codex-report.md`'s "Revise round 1" item 5 records it as an informational
follow-up with no code change, which matches what the diff shows.

### 4. What happens when a dependency fails?

Unchanged from base. The throw-mid-replay window between
`SessionHistoryReplayer`'s unconditional `finally` flag-clear
(`session-history-replayer.service.ts:224-227`) and the caller's
`applyResumeFailure` reset (`session-loader.service.ts:791-799`) is untouched
by round 1's file list and is recorded, not fixed, per the same "Revise round
1" item 5. No `IntersectionObserver`: `TranscriptRenderWindow.supported=false`
still forces `isMounted()` to `true` unconditionally
(`transcript-render-window.ts:142-143`, logic byte-identical pre/post rename)
— `streamingBoundary`'s value is still irrelevant to mounting in that
degraded mode.

### 5. What is missing that the requirements never mentioned?

Both open items from the base review remain open by design, and round 1 does
not claim to close them — it only documents them as follow-ups
(`b5-codex-report.md` "Revise round 1" item 5). No regression test exists
anywhere in the suite for either the compaction-reload race or the
throw-mid-replay window, same as the base review found. Round 1 does not
introduce a new implicit-requirement gap: the two doc bullets it adds
(`chat-transcript.component.ts:98-104` field doc;
`libs/frontend/chat/CLAUDE.md:77` rule-7 "Replay boundary" bullet) are
requested by the style review and match the actual code, so they close a
documentation gap rather than open a behavioural one.

## Verification of round 1's own "behaviour-neutral" claim

**1. Dead field removed, no remaining reader.** `grep -rn "finalizedCount"
libs/frontend/chat` returns zero hits in any `.ts`/`.html` file (production or
spec). `TranscriptViewModel` (`chat-transcript.component.ts:96-107`) now
exposes only `streamingBoundary`; `EMPTY_VIEW_MODEL` (`:112-119`) has no
`finalizedCount:` entry; `vm()`'s object literal (`:424-433`) no longer
assigns it. The one production consumer of the old field
(`chat-transcript.component.html:21`, the `[isStreaming]` binding) was
already migrated to `streamingBoundary` in the base C5 diff, so this
deletion has no live caller to break — confirmed, not assumed, by the
whole-repo grep. `.ptah/specs/**` still contains the string in prose
documents (`implementation-plan.md`, `batches.md`, the base reviews) — those
are historical narrative, not code, and are outside this delta's remit.

**2. `syncMessages` rename is a pure identifier change.** Diffing
`transcript-render-window.ts` before/after round 1: the parameter name
changes (`finalizedCount` → `streamingBoundary`, `:119`), the doc comment is
rewritten to describe both the live and replay cases (`:112-118`), and the
loop body is otherwise unchanged — `for (let i = Math.max(0, streamingBoundary); i < messageIds.length; i++)`
(`:128`) is character-for-character the same loop as
`for (let i = Math.max(0, finalizedCount); i < messageIds.length; i++)`
before it, modulo the identifier. No conditional, no new branch, no changed
constant (`ALWAYS_MOUNTED_TAIL` untouched). `transcript-render-window.spec.ts`'s
`makeAttached` helper (`:82-98`) and its one in-body comment (`:191`) are
renamed identically; the test bodies (assertions, `ids()`, `entry` fixtures)
are untouched — confirmed by reading the full diff hunk, not sampling it.

**3. Every caller passes the right value.** `rg -n "syncMessages\("
libs/frontend/chat` (per the codex report, and independently re-run by this
reviewer via grep) finds exactly one production call site
(`chat-transcript.component.ts:535-537`, `view.streamingBoundary`) and the
declaration (`transcript-render-window.ts:119`); all other hits are inside
`transcript-render-window.spec.ts`. There is no orphaned call still passing a
variable named `finalizedCount` by coincidence — the one production caller
was already updated to `view.streamingBoundary` in the base diff, and round 1
only renamed the parameter it lands in, which is the callee side, not the
caller side. No latent double-rename bug (e.g., a caller now passing the old
finalized count into a parameter whose name implies something else) exists,
because the caller's argument expression (`view.streamingBoundary`) and the
parameter's name (`streamingBoundary`) now agree, closing exactly the
style review's "two semantics, one name" finding without changing what value
flows through.

**4. Specs not weakened.** The style review's two Serious findings both asked
for either a fix or a scoping comment, never for weakening or deleting an
assertion. Comparing `transcript-render-window.spec.ts`'s diff: the one test
whose in-body comment changed (`"never unmounts a streaming message,
whatever the observer says"`, `:185-191`) still asserts the same behavior —
"streamingBoundary 0 → every id is streaming, none may unmount" — with a
renamed but equally strict assertion body (unchanged in this diff). No
`it(...)` block was removed, no assertion loosened (e.g., no `toBeGreaterThanOrEqual`
substituted for a prior `toBe`), and no test skipped (`xit`/`it.skip`) was
introduced. `chat-transcript.replay-mount.spec.ts` (the only other spec in
scope) is untouched by round 1's file list per the codex report and
independently confirmed by `git status --short` showing it staged
identically to before round 1 began — it is not among the 5 files round 1
changed.

**5. Base verdict still holds.** The base review's APPROVE rested on: (a) the
`streamingBoundary` derivation reading raw `historyReplaying()` with no
motion-hold contamination — untouched; (b) the supersession-ordering proof
for the non-compaction resume path — untouched, no file in that proof's
evidence chain changed; (c) two named, accepted residuals (compaction race,
throw-mid-replay window) — carried forward verbatim, now additionally
recorded in the codex report rather than left implicit. Nothing in round 1
reopens any of the three pillars the original APPROVE stood on.

## Failure modes

Unchanged from base review (`b5-code-logic-review.md`, "Failure modes"
section) — both are pre-existing, out of this batch's file scope, and
explicitly recorded (not fixed) in `b5-codex-report.md`'s "Revise round 1"
item 5:

### Compaction-reload race leaves a pre-reset window (pre-existing, out of scope, now recorded)

- Trigger: a compaction-triggered targeted reload superseding an in-flight,
  chunked replay of the same tab.
- Symptom: a stale non-finalized tree could theoretically render with
  `isStreaming=true` for one change-detection pass.
- Evidence: `session-loader.service.ts:677-679` vs `:685-691` (base review's
  citation; file unchanged by round 1, re-verified absent from `git diff --stat`).
- Current handling: none specific; now named in `b5-codex-report.md` as a
  needed future regression test.
- Recommendation: unchanged from base — file a follow-up ticket; not this
  batch's scope.

### Throw-path window between `finally` flag-clear and `applyResumeFailure` (pre-existing, out of scope, now recorded)

- Trigger: a chunk throws mid-replay.
- Symptom: one change-detection pass could show a non-finalized bubble as
  `isStreaming=true` after `historyReplaying` already reads false.
- Evidence: `session-history-replayer.service.ts:224-227` vs
  `session-loader.service.ts:791-799` (unchanged by round 1).
- Current handling: none beyond eventual correction by `applyResumeFailure`.
- Recommendation: unchanged from base — needs a focused throw-path
  state-transition test in a future task, per the codex report's own
  acknowledgment.

## Blocking issues

None.

## Serious issues

None. Both of the base style review's Serious findings (dead field, stale
parameter name) are resolved by round 1 with no logic change — verified
above, not merely asserted by the report.

## Moderate and minor issues

- Moderate (carried, unresolved by design): the compaction-reload race has no
  regression test anywhere in the suite. Round 1 explicitly declines to add
  one, correctly scoping it as future work rather than silently dropping it —
  recorded in `b5-codex-report.md` "Revise round 1" item 5. Not a regression
  from round 1; still worth tracking as a follow-up ticket.
- Minor: the two new doc additions (`chat-transcript.component.ts:98-104`,
  `libs/frontend/chat/CLAUDE.md:77`) are accurate against the code as read —
  no drift between prose and implementation found.

## Data flow

1. `vm()` computed derives `streamingBoundary` from raw `historyReplaying()`
   (`chat-transcript.component.ts:429-431`) — OK, unchanged logic, field name
   is now the only name (no dead twin).
2. Template binds `[isStreaming]="i >= vm().streamingBoundary"`
   (`chat-transcript.component.html:21`) — OK, unchanged by round 1.
3. Feeding effect passes `view.streamingBoundary` into
   `renderWindow.syncMessages` (`chat-transcript.component.ts:535-537`) — OK,
   caller argument and callee parameter name now agree textually as well as
   semantically.
4. `TranscriptRenderWindow.syncMessages` computes the always-mounted tail
   using the renamed parameter (`transcript-render-window.ts:119-134`) — OK,
   loop bodies byte-identical to pre-round-1, confirmed by diff inspection.
5. `libs/frontend/chat/CLAUDE.md` rule 7 now documents the replay boundary
   contract (`:77`) — OK, matches the code exactly, closes the style
   review's "no bullet for this contract change" finding.

## Requirements fulfilment

| Requirement (round 1's own stated scope) | Status | Gap |
| --- | --- | --- |
| Remove dead `TranscriptViewModel.finalizedCount` | COMPLETE | none — zero remaining readers repo-wide |
| Rename `syncMessages`'s parameter to `streamingBoundary`, update doc | COMPLETE | none — logic byte-identical, all callers consistent |
| Field-level doc on `streamingBoundary` | COMPLETE | none |
| CLAUDE.md rule-7 bullet for the replay boundary contract | COMPLETE | none |
| Behaviour-neutral (no logic change) | COMPLETE | verified by diff inspection, not merely by the report's claim |
| Record (not fix) the two logic follow-ups | COMPLETE | none — both named in `b5-codex-report.md` item 5, matching this reviewer's independent re-check |

Implicit requirements not addressed: none new. The two pre-existing residuals
remain untested, as before.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Grep for remaining `finalizedCount` readers | YES | zero hits in `libs/frontend/chat/**/*.ts,html` | none |
| `syncMessages` argument/parameter name agreement | YES | caller passes `view.streamingBoundary` into parameter `streamingBoundary` | none |
| Test assertions weakened or removed in round 1 | NO | none found; only identifiers/comments changed | none |
| New doc claims matching code | YES | both additions read against source, accurate | none |
| Compaction-reload race | NO (unchanged) | recorded as follow-up, no test | pre-existing, tracked |
| Throw-mid-replay window | NO (unchanged) | recorded as follow-up, no test | pre-existing, tracked |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: unchanged from base — the compaction-reload race and the
  throw-mid-replay window both remain unpinned by any test, in files this
  batch correctly did not touch. Round 1 does not raise the risk profile; it
  lowers the maintenance-drift risk the style review named (dead field,
  stale parameter name) to zero.
- What a robust implementation would add: (1) the two follow-up regression
  tests already named in `b5-codex-report.md` item 5, filed as their own
  future task; (2) nothing further for round 1 itself — the round is
  behaviour-neutral as claimed and closes both style Serious findings
  cleanly.
