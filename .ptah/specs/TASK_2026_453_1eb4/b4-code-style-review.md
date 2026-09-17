# Code Style Review — `TASK_2026_453_1eb4` Batch 4 (Task 4.1: C1 replay motion gate)

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 8/10                                 |
| Assessment      | APPROVED                             |
| Blocking issues | 0                                    |
| Serious issues  | 1                                    |
| Minor issues    | 2                                    |
| Files reviewed  | 12 (11 modified + 1 created)         |

## Five style questions

### 1. What breaks in six months?

The claim-keyed removal (`session-history-replayer.service.ts:227-240`) is the one piece of
state a maintainer could break without noticing: `markReplayFinished` silently no-ops when
`replayingClaims.get(tabId) !== claim.claim` (`:235`). That's correct today (an older replay's
`finally` must not clear a newer one's flag, verified at
`session-history-replayer.admission.spec.ts:416-439`), but nothing at the call site marks why the
early return exists beyond the one-line comment at `:114`. A future edit that adds a second
exit path to `replay()` and forgets to route it through `markReplayFinished` in the same
`finally` would leave a tab's motion permanently suppressed with no compiler or lint signal —
the class doc doesn't enumerate this contract the way it enumerates Claims/Chunks/Admission
(see Q4), so a reader who trusts the header won't find it.

### 2. What would a new team member misread?

`inline-agent-bubble.component.ts:449-450` — `[auto-animate]` (a static directive) sits next to
`[autoAnimateDisabled]` (bound). A reader could think the disable input only mutes chained
animations inside an already-active controller, when in fact
(`inline-agent-bubble.component.spec.ts:139-155`, confirmed by the report's AC-6 evidence) it
prevents `autoAnimate()` from being invoked at all while `isFinalizing()` is true. This is
existing directive shape, not something Batch 4 introduced, so it's a read risk rather than a
finding.

### 3. What does this cost to maintain?

Two parallel "is this tab still authoritative" maps now exist on the same class:
`claims` (`:111`, current owner of a tab) and `replayingClaims` (`:115`, current owner of the
motion-suppression flag). They track genuinely different lifetimes — `claims` updates on every
`claim()` call, `replayingClaims` only on `replay()` entry/exit — so this is not accidental
duplication, but a maintainer changing one will need to reason about both. The cost is paid once
(the class doc should carry it, see Q4) and is otherwise small: the new surface is 14 lines
(`:114-117`, `:155-157`, `:227-240`) plus one call each at entry (`:192`) and in `finally`
(`:222`).

### 4. Where is this inconsistent with the rest of the repository?

`session-history-replayer.service.ts:1-36` is this class's own stated contract surface — the
header enumerates Claims, Chunks, Admission, Live-event fence, and Yield failures as bullets,
each with an `{@link}` to its method. `libs/frontend/chat/CLAUDE.md` rule 7 treats this header as
the source of truth ("Its class doc ... hold[s] the full contract; the rules to keep"). Task 4.1
adds a sixth public contract element — `replayingTabIds` / `isReplaying` — that changes the
class's public API and cross-cuts every exit of `replay()`, exactly the shape the existing five
bullets describe, but no bullet was added for it. The CLAUDE.md rule 7 bullet (`libs/frontend/chat/CLAUDE.md:76`)
documents the contract at the module level; the class itself, which is what the other five
elements are documented against, does not. This is the one place the diff doesn't follow the
pattern the file already established for itself.

### 5. What would you have done differently, and why is that better rather than merely other?

Add a sixth bullet to the header doc (`:1-36`) — "**Replay-tab signal.** `replay()` marks
`tabId` in `replayingTabIds` from entry through a claim-keyed `finally` (see
{@link markReplayStarted}, {@link isReplaying})." — mirroring the existing five. That's strictly
additive, costs three lines, and closes the exact gap Q4 identifies: a reader who opens this file
to learn its contract (the documented purpose of the header) currently has to go find the
CLAUDE.md bullet instead. This is better than leaving it as is because the header, not the
CLAUDE.md, is what `{@link}` references and IDE hovers surface at the call site.

## Blocking issues

None.

## Serious issues

### Class-level contract doc omits the new public API

- File: `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts:1-36`
- Problem: The header comment is this class's declared single source of truth for its contract
  (per `libs/frontend/chat/CLAUDE.md` rule 7's own framing) and enumerates five bullets — Claims,
  Chunks, Admission, Live-event fence, Yield failures — each describing a cross-cutting behavior
  with an `{@link}`. `replayingTabIds`/`isReplaying`/`markReplayStarted`/`markReplayFinished` is a
  sixth cross-cutting public contract (new signal, new public method, touches every exit of
  `replay()`) added with no corresponding bullet.
- Tradeoff: Documenting only in `CLAUDE.md` (done, `libs/frontend/chat/CLAUDE.md:76`) is not a
  substitute — that file is a directory-level guide a new contributor may never open before
  reading the class; the class doc is what IDE tooling and `{@link}` cross-references surface
  in-place. Leaving the header incomplete makes it look authoritative when it silently is not.
- Recommendation: Add one bullet to the header doc following the existing five, in the same
  format, pointing at `markReplayStarted`/`isReplaying`.

## Minor issues

- `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.spec.ts:280`
  removes a pre-existing `// eslint-disable-next-line @typescript-eslint/dot-notation` comment on
  an unrelated `onSendSubmit` bracket-access test, with no acceptance criterion or file-list entry
  covering it. Lint still reports 0 errors (per `b4-codex-report.md` §3), so this is not a defect,
  but it's an unexplained touch on a line Task 4.1 had no reason to visit — a smaller diff would
  have left it alone or, if it was a genuinely stale disable, called it out in the report.
- `message-bubble.component.spec.ts:227-286`'s `expectsAnimation: true` branch (AC 7's "with false
  the class is added" case) asserts only that `isFinalizing()` reads `false` and that the badge
  container renders — it does not assert `bubble-fade-enter` is applied or that
  `requestAnimationFrame` runs, unlike the well-pinned suppressed branch. The in-line comment is
  honest about the jsdom Web-Animations-API gap causing this, so it's not misleading, but the test
  name ("applies the badge motion gate for isFinalizing=%s") reads as verifying both directions
  symmetrically when only one is actually pinned behaviorally.

## File-by-file

### session-history-replayer.service.ts

Score 7/10 — 0 blocking, 1 serious, 0 minor. Implementation matches the plan's exact API shape
(`replayingTabIds`, `isReplaying`, claim-keyed clear) and sits well-placed next to `replay()`
(`:227-240`); the one real gap is the missing header-doc bullet (Serious, above).

### chat-view.component.ts / chat-view.component.html

Score 9/10 — clean. Exactly one injection (`:43`) and one accessor (`isHistoryReplaying`,
`:170-172`) as the file-size constraint (1,302 lines) demanded; the template binds
`[historyReplaying]="isHistoryReplaying(tabId)"` (`chat-view.component.html:69`) following the
existing per-tab input pattern on the same element.

### chat-transcript.component.ts / chat-transcript.component.html

Score 9/10 — `historyReplaying = input<boolean>(false)` (`:186`) and
`motionSuppressed = computed(...)` (`:263-265`) sit directly beside the signal they compose with,
`isFinalizingTransition` is untouched as required, and the template swap at `:22` is a single-line
diff. File is 622 lines, under the 700 ceiling.

### message-bubble.component.html / inline-agent-bubble.component.ts

Score 8/10 — both sites use the exact bound `isFinalizing() ? '' : '<class>'` form the plan
specified; the stale, misleading comment at the inline-agent-bubble footer
(the old comment described a `[data-finalizing]`-driven CSS override that was never implemented)
was correctly deleted rather than left to rot next to code that no longer matches it.

### chat-transcript.replay-motion.spec.ts (new)

Score 8/10 — follows the existing stub-component pattern used elsewhere in this directory
(inline `MessageBubbleStub`/`EmptyStateStub`, `TestBed.overrideComponent` swap, `ngx-markdown`
jest mock copied verbatim from sibling specs), keeps to one behavioral scenario as its name
promises, and is the only file carrying replay-motion transcript cases.

### session-history-replayer.admission.spec.ts

Score 9/10 — the plan's file-choice was "pick one file, not both"; all new replay-flag cases
landed here only, `session-history-replayer.service.spec.ts` has no diff. The claim-keyed
same-tab case (`:416-439`) is a genuine behavioral spec, not just an assertion bolted onto an
existing test.

### message-bubble.component.spec.ts / inline-agent-bubble.component.spec.ts

Score 7/10 — inline-agent-bubble's new auto-animate-controller-not-created test
(`:139-155`) is a clean, well-isolated addition with its own `@formkit/auto-animate` mock.
message-bubble's parametrized case has the asymmetric-assertion gap noted above (Minor).

## Pattern compliance

| Repository rule or nearby convention                                                    | Status | Evidence                                                                 |
| ----------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| Angular: signals + `inject()`, OnPush                                                     | PASS   | `signal<ReadonlySet<string>>` (`session-history-replayer.service.ts:116`), `computed` (`chat-transcript.component.ts:263`) |
| No `V2`/`Legacy` copies; replace in place                                                 | PASS   | `git grep` for `V2\|Legacy` in changed files finds only pre-existing, unrelated hits in `chat-view.component.ts:700-1034` |
| No `content-visibility`, no scroll-method edits                                           | PASS   | Confirmed via diff review; `chat-transcript.component.css` has no diff   |
| `execution-node.component.ts` unchanged                                                   | PASS   | No diff in `git status`                                                  |
| File under 700 lines where required                                                       | PASS   | `chat-transcript.component.ts` 622 lines                                 |
| `chat-view.component.ts` gets only injection + one accessor                               | PASS   | `chat-view.component.ts:43,162,170-172`                                  |
| CLAUDE.md rule 7 gains exactly one new bullet                                              | PASS   | `libs/frontend/chat/CLAUDE.md:76` is the only addition to rule 7          |
| Spec placement: replayer cases in one file only                                           | PASS   | Only `session-history-replayer.admission.spec.ts` has replay-flag cases  |
| Class doc enumerates every cross-cutting contract element (established by this file's own header) | FAIL   | No bullet for the replay-tab signal at `session-history-replayer.service.ts:1-36` |
| Import boundaries (frontend-only, same-lib collaborator injection)                        | PASS   | `chat-view.component.ts` imports `SessionHistoryReplayer` from the same lib's `chat-store/` folder |

## Maintenance debt

- Introduced: one new signal + two private helpers on `SessionHistoryReplayer`; one new input +
  one computed on `ChatTranscriptComponent`; one new accessor on `ChatViewComponent`; four bound
  animate expressions replacing four static ones.
- Retired: one stale, inaccurate comment block in `inline-agent-bubble.component.ts` describing an
  override mechanism that was never built.
- Net: small positive — the new surface is narrow, well-placed, and matches the plan's exact
  shape; the only debt left behind is the undocumented class-header gap (Serious) and the two
  Minor items.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: the class's own contract header, which `CLAUDE.md` names as the authoritative doc
  for this collaborator, was not updated for the new public API it just gained.
- What a 10/10 version would do differently: add the sixth header bullet (Q5); make the
  message-bubble spec's enabled branch assert `bubble-fade-enter` presence or a real
  `requestAnimationFrame` call rather than only the gate's boolean state; leave the unrelated
  `onSendSubmit` eslint-disable line untouched or explain its removal in the report.
