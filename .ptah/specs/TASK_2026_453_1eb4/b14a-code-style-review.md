# Code Style Review — `TASK_2026_453_1eb4` Batch 14A

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------- |
| Overall score   | 7/10                                  |
| Assessment      | APPROVED                              |
| Blocking issues | 0                                     |
| Serious issues  | 1                                     |
| Minor issues    | 3                                     |
| Files reviewed  | 5 (2 new, 3 modified)                 |

Scope: `transcript-prepend-anchor.directive.ts` (new), `transcript-prepend-anchor.directive.spec.ts` (new),
`chat-transcript.component.ts`/`.html` (modified), `libs/frontend/chat/CLAUDE.md` (one sentence appended).

## Five style questions

### 1. What breaks in six months?

`ngOnChanges` on a directive whose inputs are exclusively `input()`/`input.required()` signals
(`transcript-prepend-anchor.directive.ts:35-46, 54`) is unusual enough that a future edit adding
one more signal-derived condition will reach for `effect()` — the idiom every sibling directive
uses (`transcript-slot.directive.ts:36-41`, `transcript-older-history-sentinel.directive.ts:27-82`)
— and silently reintroduce the ordering bug this directive exists to avoid (an `effect()` runs
after Angular has already reconciled the `@for`, not before). The class doc at :22-31 states the
ordering requirement but not *why* `ngOnChanges` rather than `effect()` was the only way to satisfy
it; a maintainer six months out has to re-derive that from Angular's own change-detection contract
before touching this file safely.

### 2. What would a new team member misread?

`ChatTranscriptComponent.isPinnedToBottom()` (`chat-transcript.component.ts:606-608`) looks like a
public query method on first read, but it exists for exactly one caller: the template binding at
`chat-transcript.component.html:6`. A reader who greps for other call sites and finds none could
reasonably conclude it is dead code, or add a second call site believing it is a general-purpose
getter, when its only contract is "current value of the private mutable field for this one
directive input." Nothing in the method or its call site marks it as directive-only wiring.

### 3. What does this cost to maintain?

Two new public-surface members exist on `ChatTranscriptComponent` purely to feed the directive:
`sessionId` (promoted from `private _sessionId` to `protected sessionId`,
`chat-transcript.component.ts:320-322`) and `isPinnedToBottom()` (:606-608). Both are minimal and
justified — `onScroll`/`scheduleStickToBottom`/`restoreScrollOnActivation` are on the batch's
explicit do-not-touch list (`batches.md:141-142`), which rules out converting `pinnedToBottom` to a
signal (the lightest binding *given that constraint*). The maintenance cost is that a future reader
must know the constraint to understand why `pinnedToBottom` did not simply become a signal like
`isFinalizingTransition`/`replayMotionHold` on the same class — the constraint is not mentioned
anywhere near the two new members.

### 4. Where is this inconsistent with the rest of the repository?

Two points, both narrow:

- **Lifecycle idiom.** `TranscriptSlotDirective` and `TranscriptOlderHistorySentinelDirective` — the
  two structurally closest siblings in the same directory — both drive their logic from `effect()`
  and `untracked()`, never `ngOnChanges`. The new directive is the only one in this trio that mixes
  a signal-input surface with a pre-signals lifecycle hook. This is the one genuine style outlier
  the task flagged for review; see Blocking/Serious.
- **Attribute naming.** The same component's host bindings, four lines above the new template
  attribute, establish `data-ptah-file-links` / `data-ptah-tab-id` as the local `data-ptah-*`
  naming convention for Ptah-owned DOM contracts (`chat-transcript.component.ts:164-165`, with an
  explicit security rationale in the doc comment). The new attribute is `data-transcript-message-id`
  (`chat-transcript.component.html:41`), which drops the `ptah-` segment. It does not collide with
  anything and is easy to find by grep, but it is a second naming scheme introduced in the same file
  that already has one.

### 5. What would you have done differently, and why is that better rather than merely other?

I would have kept the `ngOnChanges` mechanism (it is the correct tool for "read the DOM before the
`@for` reconciles," which `effect()` cannot guarantee) but named the class doc's justification more
prominently — e.g. a one-line note at the top of `ngOnChanges` itself: "Not `effect()`: change
detection resolves this directive's inputs strictly before its content children, `effect()` does
not." That is a documentation change, not a design change, and it removes the six-month risk in
question 1 without touching behavior. I would also have named the field-exposure trio
(`isPinnedToBottom()`, `sessionId`, `[messages]`) with a shared comment (or grouped them in the
class body) explicitly marked "read by `TranscriptPrependAnchorDirective` only" — the same
technique the file already uses for the host-binding contract at :158-163.

## Blocking issues

None.

## Serious issues

### `ngOnChanges` reimplements input diffing that Angular's signal inputs already provide

- File: `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-prepend-anchor.directive.ts:35-82`
- Problem: The directive keeps four hand-rolled "previous value" fields (`previousMessages`,
  `previousTabId`, `previousSessionId`, `wasActive`) and a manual revision counter purely to detect
  what Angular's `SimpleChanges` (the actual payload of `ngOnChanges`) already carries, but the
  directive never reads `SimpleChanges` — it re-reads every signal via its own getters instead. That
  makes `ngOnChanges` here a bare "some input changed" trigger with all the diffing done by hand a
  second time, while every sibling directive in the same folder gets the equivalent diffing for free
  from the signal graph via `effect()`.
- Tradeoff: the documented reason for choosing this over `effect()` — needing to read the DOM before
  the `@for` reconciles — is real and Angular does guarantee `ngOnChanges` runs synchronously ahead
  of content-child update, which `effect()` does not promise. So the escape from the repo's `effect()`
  convention is justified. The residual cost is that the class carries two competing tracking
  mechanisms (Angular's own unused `SimpleChanges` object, and this directive's own scalar diff) for
  the same four inputs, which is what the five style questions flag as the six-month risk.
- Recommendation: either accept `SimpleChanges` and let it do the "did tabId/sessionId/active change"
  checks it was built for (dropping `previousTabId`/`previousSessionId`/`wasActive` in favor of
  `changes['tabId']`, etc., with `previousMessages` and `revision` staying because they need value
  history `SimpleChanges` also carries via `.previousValue`), or add one code comment at the top of
  `ngOnChanges` naming why it exists in place of `effect()` here specifically, so the next person who
  reaches for the repo's default idiom does not "fix" the ordering bug back in.

## Minor issues

- `chat-transcript.component.html:41` — `data-transcript-message-id` breaks the file's own
  `data-ptah-*` naming convention established four lines earlier at :164-165 in the `.ts` host
  bindings. No collision risk, but a second naming scheme in one file.
- `chat-transcript.component.ts:606-608` — `isPinnedToBottom()` has no comment marking it as
  directive-only wiring; a doc line matching the style already used for `renderWindow`
  (`:178-183`) would prevent a future caller from treating it as a general query method.
- `transcript-prepend-anchor.directive.ts:39` — `MessageIdentity` (`{ readonly id: string }`) is a
  fine minimal-surface type for the anchor comparison, but it silently accepts any object with an
  `id` field, including a completely different domain type. This is not a stated rule violation
  (the file has no external boundary to validate against) and is not blocking; naming it as
  `TranscriptMessageIdentity` would make the intentional narrowing explicit rather than incidental.

## File-by-file

### `transcript-prepend-anchor.directive.ts`

Score 7/10 — 0 blocking, 1 serious, 1 minor. Selector prefix (`ptahTranscriptPrependAnchor`),
`inject()`, and `input()`/`input.required()` all match the two sibling directives exactly
(`transcript-slot.directive.ts:26-33`, `transcript-older-history-sentinel.directive.ts:16-24`). The
one real deviation is the `ngOnChanges`/signal-input mix (Serious, above) — technically justified,
under-documented. `afterNextRender` with an injected `Injector` and a monotonic revision guard for
cancellation (:101-119) is idiomatic and matches the zoneless-safety bar the rest of the transcript
subtree holds itself to (e.g. `chat-transcript.component.ts:562-571` uses the identical
`afterNextRender({ injector })` pattern).

### `transcript-prepend-anchor.directive.spec.ts`

Score 8/10 — 0/0/0. TestBed host-component harness with a `scrollTop` getter/setter spy and
explicit jsdom geometry stubs (`installDynamicSlotGeometry`, :70-81) is a reasonable way to test
layout-dependent code jsdom cannot lay out for real. Coverage matches the acceptance list: exact
write count and value, non-zero scrollTop leaves it alone, the three eligibility gates
(pinned/replaying/inactive), the four non-prepend shapes (append/replacement/session/tab switch),
and a missing-anchor-after-render no-op. No gap found against the stated ACs.

### `chat-transcript.component.ts`

Score 7/10 — 0/0/2 (both listed above). 716 lines, 6 over the 700 soft ceiling introduced by this
batch (was 710). Line count alone is not a signal per the repo's own file-size rule, and the added
lines are wiring (an import, one array entry, a promoted field, a four-line getter) rather than new
logic — a facade extraction here would not pass the nameability test (there is no coherent
"transcript wiring" collaborator distinct from the transcript itself) and would risk violating the
batch's own do-not-touch list by moving code near `onScroll`/`scheduleStickToBottom`. No split is
warranted at this size for this reason.

### `chat-transcript.component.html`

Score 8/10 — 0/0/1 (the attribute-naming minor, above). The six new directive input bindings on
`#messageContainer` (:3-8) read cleanly against the directive's own input list; the new
`[attr.data-transcript-message-id]` on the persistent slot (:41) is additive and does not disturb
the existing `[ptahTranscriptSlot]` binding beside it.

### `libs/frontend/chat/CLAUDE.md`

Score 9/10 — 0/0/0. The appended sentence ("The only paging-path scroll write is the top-boundary
prepend anchor exception at exactly `scrollTop === 0`, while active, unpinned, and not replaying.")
is verified accurate against the directive's actual gate at
`transcript-prepend-anchor.directive.ts:68-73` (`isPrepend && !historyReplaying() &&
!pinnedToBottom() && scrollTop === 0`, where `isPrepend` itself requires `wasActive && active`).
Placed at the end of the existing "Tail paging" bullet it documents, not as a new bullet — correct
placement per the file's own convention of one bullet per contract area.

## Pattern compliance

| Repository rule or nearby convention                                                    | Status         | Evidence                                                                                   |
| ----------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| Selector prefix matches sibling directives (`ptahTranscript*`)                            | PASS           | `transcript-prepend-anchor.directive.ts:33` vs `transcript-slot.directive.ts:26`             |
| Signal `input()`/`input.required()`, no constructor DI                                    | PASS           | `transcript-prepend-anchor.directive.ts:39-46`                                               |
| Lifecycle idiom matches siblings (`effect()`+`untracked()`, not `ngOnChanges`)             | FAIL (justified) | `transcript-prepend-anchor.directive.ts:54` vs `transcript-slot.directive.ts:36`, `transcript-older-history-sentinel.directive.ts:28` |
| `data-ptah-*` naming convention for Ptah DOM contracts in this file                        | FAIL (minor)   | `chat-transcript.component.html:41` vs `chat-transcript.component.ts:164-165`                |
| Never edit `onScroll`, `scheduleStickToBottom`, `restoreScrollOnActivation`, `lastScrollTop`, CSS | PASS     | `git diff` shows no hunks inside those methods or `chat-transcript.component.css`             |
| Facade rule / file-size guardrails (no sub-150-line split, no forced extraction at 716)    | PASS           | No new file created for the component; only the directive (133 lines, independently nameable) |
| OnPush / zoneless safety (`afterNextRender` with injected `Injector`, no direct DOM writes outside render hooks) | PASS | `transcript-prepend-anchor.directive.ts:101-119`                                              |
| CLAUDE.md sentence accuracy and placement                                                 | PASS           | Verified against directive gate, above                                                       |

## Maintenance debt

- Introduced: one new directive + spec (133 + 170 lines) as a genuinely nameable collaborator, not
  a size-driven fragment; two new narrow-purpose exposures on the component (`sessionId` visibility
  change, `isPinnedToBottom()`); one new `data-*` attribute naming scheme alongside an existing one.
- Retired: nothing.
- Net: small, targeted increase. The directive itself is well-isolated and well-tested; the debt is
  concentrated in under-documented rationale (why `ngOnChanges`, why this attribute name) rather
  than in structure.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: the `ngOnChanges`/signal-input mix is the one real pattern deviation in the batch,
  and it is justified by a real ordering requirement `effect()` cannot give — but that justification
  lives only in a class-level doc comment, not at the point of use, so it is one confused refactor
  away from being "fixed" back into the ordering bug it prevents.
- What a 10/10 version would do differently: add a one-line comment at `ngOnChanges` itself naming
  why it is not `effect()`; rename `isPinnedToBottom()`/mark `sessionId` as directive-only wiring;
  use the file's own `data-ptah-*` convention for the new attribute.
