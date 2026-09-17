# Code Logic Review — `TASK_2026_453_1eb4` Batch 14A

## Summary

| Metric              | Value                                 |
| -------------------- | ------------------------------------- |
| Overall score        | 7/10                                   |
| Assessment           | APPROVED                               |
| Blocking issues      | 0                                       |
| Serious issues       | 0                                       |
| Moderate issues      | 2                                       |
| Failure modes found  | 2 (both defended, one under-tested)     |

Scope reviewed: `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-prepend-anchor.directive.ts` (134 lines), its spec (170 lines), the diff to `chat-transcript.component.ts` / `.html`, and the one `CLAUDE.md` sentence. Cross-checked against `implementation-plan.md` (ii).2 A-ii-2, (ii).9 R-ii-2, User Decision 2026-09-17 ("Narrow scroll write"), and the installed Angular 21.2.6 source (`node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs`) to settle the signal-input/`ngOnChanges` question the task raised.

## Five logic questions

### 1. How does this fail silently?

- If the anchor slot cannot be found after render (element filtered out, id typo, DOM restructuring not covered by `data-transcript-message-id`), `restoreAfterRender` (`transcript-prepend-anchor.directive.ts:113`) just `return`s. The user's reading position silently drifts — no console warning, no telemetry. This is deliberate ("Missing-anchor behavior... covered", b14a-codex-report.md #3) and matches native `overflow-anchor` behaviour (which also fails silently), so it is consistent with the surrounding contract rather than a new gap. Still, it is a real silent-failure path with zero observability, which the plan does not call out as intentional.
- A capture that finds an anchor but the write computes a **negative** delta (edge case: server returns a shorter-than-expected page, or a future change makes the prepend land below the anchor) would still fire the single write, moving `scrollTop` the wrong way with no bounds check or sanity clamp (`transcript-prepend-anchor.directive.ts:116`). Nothing validates that `nextOffset - anchor.offset` is plausible before writing it.

### 2. What user action produces unexpected behaviour?

- Scrolling to exactly `scrollTop === 0` and clicking "Load earlier" while the container is pinned to a *very* short (non-scrollable) session produces no write (gate `!pinnedToBottom()`, `:71`) — correct, and is exactly the V5/U1 case Batch 14 separately measured (0.00 px). No unexpected behaviour there.
- Switching tabs (or defocusing the canvas tile) in the small window between click and `afterNextRender` firing correctly cancels the write via the revision counter (`transcript-prepend-anchor.directive.ts:52,59,75,104`) — verified by tracing `active` binding to `mainPanelShowing()`/`SESSION_VISIBLE` (`chat-view.component.ts:559-563`), which does flip `active` on tab/tile visibility changes and therefore re-enters `ngOnChanges`, bumping `revision`.

### 3. What input data produces a wrong answer?

- **Empty-to-populated transition (the case the review explicitly asked about).** `isStrictHeadPrepend` returns `false` when `previous.length === 0` (`:127`), so a resume's first population (or a full reload with `active`/`tabId`/`sessionId` unchanged) is correctly rejected. This guard is **not** merely defensive: it is the ONLY thing that stops a genuine, very common real path from mis-firing. When a tile's history replay finalizes, `tab.messages` jumps from `[]` to N items while `active`, `tabId`, `sessionId` typically stay the same across that same tick (only `historyReplaying` flips) — `wasActive` is already `true` by then (set on the very first `ngOnChanges` call), so the `previous.length === 0` branch, not the `wasActive` gate, is what saves this path from a bogus "prepend" detection. See "Edge cases" — **no spec exercises this exact transition**, only the isolated harness which never starts from an empty list.
- A future change that lets `next.length` grow by exactly `previous.length` items but with a duplicate id collision (e.g. `HistoryPagingService`'s own de-dup, P23/A-ii-5 in implementation-plan.md, fails) would still pass `isStrictHeadPrepend` as long as the suffix matches; the directive has no independent duplicate check of its own. This is acceptable — de-dup is explicitly out of this directive's scope per the plan — but it means a defect one layer up would not be caught here either.

### 4. What happens when a dependency fails?

- `Injector`/`ElementRef` are structural Angular services; no external I/O in this directive. `afterNextRender`'s auto-cleanup on injector destruction (standard Angular behaviour) means a torn-down tile does not crash retro-actively; confirmed indirectly since `querySelectorAll` on a detached node is a no-op, not an exception, so even if the callback somehow ran post-destroy it would degrade to the same "anchor not found" silent no-op path in question 1.
- No timers, subscriptions or observers are opened by this directive that would need explicit disposal — nothing to leak.

### 5. What is missing that the requirements never mentioned?

- No instrumentation/log when the compensating write actually happens or when it is skipped for "anchor not found" — useful for diagnosing a regression in the field, not required by any AC.
- No upper bound / sanity check on the magnitude of the compensating write (see Q1). A pathological anchor mismatch could scroll the container to an implausible position with no safeguard.
- The anchor scan (`findFirstVisibleSlot`, `:84-99`; the `.find` in `restoreAfterRender`, `:107-112`) is unscoped: it walks **every** `[data-transcript-message-id]` slot in the container, not just the visible window. For a 2,000-event / few-hundred-message session (the AC-11 fixture size), this is a `querySelectorAll` plus up to a few hundred `getBoundingClientRect()` calls (forced synchronous layout) triggered by a single user click. It is outside the measured AC-11 window and is a rare, user-initiated action, so it does not affect the perf budget, but it is unbounded and undocumented as such.

## Failure modes

### Anchor not found after render

- Trigger: the captured message id is unmounted/removed by the time `afterNextRender` fires (covered by spec `transcript-prepend-anchor.directive.spec.ts:156-164`).
- Symptom: no compensating write; native `overflow-anchor` is the only remaining safety net, so the user may see a small jump depending on browser anchoring heuristics.
- Evidence: `transcript-prepend-anchor.directive.ts:113`.
- Current handling: silent early return.
- Recommendation: acceptable as-is (matches native-anchoring's own silent-failure character); at minimum a dev-mode `console.debug` would make future regressions traceable, but this is not a requirement gap that blocks approval.

### Empty-list → populated-list transition (real path, not just a theoretical edge case)

- Trigger: every ordinary tile open — `tab.messages` goes from `[]` to N items on replay finalization while `active`/`tabId`/`sessionId` are unchanged.
- Symptom: none observed — `isStrictHeadPrepend`'s `previous.length === 0` guard (`:127`) correctly rejects this as a prepend, so no incorrect write occurs.
- Evidence: `transcript-prepend-anchor.directive.ts:127`; call path via `chat-transcript.component.html:4-9` binding `[ptahTranscriptPrependAnchor]="vm().messages"`, which is fed from `finalizeSessionHistory` (unaffected by this batch).
- Current handling: correct by construction, but **only** proven by static reading of the code, not by a test that starts a harness instance at `previous = []` and asserts no write when it becomes populated with `active` already `true`. `transcript-prepend-anchor.directive.spec.ts`'s harness component always starts with 2 messages (`:26-29`), so this exact branch is never exercised by any spec.
- Recommendation: add one case to the directive spec (or the transcript's own replay-mount spec) that starts from an empty list and transitions to populated with `active` held `true`, asserting zero writes. Moderate, not blocking, since the code path itself is correct and simple enough to verify by inspection.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- **Moderate** — Missing spec coverage for the empty-list → populated-list transition (the most common real invocation of this directive). `transcript-prepend-anchor.directive.spec.ts:26-29`; see Failure modes above.
- **Moderate** — No documentation or bound on the cost of `findFirstVisibleSlot` / the `.find` scan in `restoreAfterRender` over every message slot in a long transcript (`transcript-prepend-anchor.directive.ts:84-99, 107-112`). Not perf-budget-relevant (outside the AC-11 window, user-click-triggered), but undocumented and unbounded.
- **Minor** — No sanity bound on the magnitude of the single `scrollTop` write (`:116`); a wrong-direction or oversized delta from a future regression upstream would be applied unconditionally.
- **Minor** — No debug-level logging when the anchor-not-found silent-skip path is taken, which will make a future regression here harder to diagnose than it needs to be.

## Data flow

1. `ChatTranscriptComponent` template binds `[ptahTranscriptPrependAnchor]="vm().messages"` plus `tabId`, `sessionId`, `active`, `historyReplaying`, `pinnedToBottom` on the scroll container (`chat-transcript.component.html:1-9`) — OK, all six inputs are the ones the directive declares (`transcript-prepend-anchor.directive.ts:39-46`).
2. Angular's preOrder hooks run `NgOnChangesFeatureImpl`'s wrapped hook for this directive **before** the parent view's child views (the `@for` producing `.chat-msg-slot` divs) are refreshed in the same change-detection pass — confirmed against the installed Angular 21.2.6 source (`node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs:356-390`, `ngOnChangesSetInput` wraps signal-input `setInput` to still populate a `SimpleChanges` object and invoke `ngOnChanges`). This directly answers the review's open question: **signal inputs on this directive do not disable `ngOnChanges` in this Angular version** — OK, the implementation's central timing claim holds.
3. `ngOnChanges` captures the pre-update DOM via `findFirstVisibleSlot` only when `isStrictHeadPrepend` plus the three gates (`!historyReplaying`, `!pinnedToBottom`, `scrollTop === 0`) all hold (`:61-76`) — OK, strict and multiply-gated.
4. `afterNextRender` schedules the restore for the render that commits the new `@for` output; a monotonic `revision` cancels a stale restore if a later `ngOnChanges` call (any input change, not just a real prepend) supersedes it before the callback runs (`:59, 75, 104`) — OK, correctly conservative (over-cancels rather than risking a stale write).
5. The single `root.scrollTop = ...` write (`:116`) is a native DOM mutation, not an Angular-bound input, so it cannot re-trigger this directive's own `ngOnChanges` — OK, no feedback loop possible through this path.
6. The write increases `scrollTop` (content is pushed down by the prepend), so the existing, **unedited** `onScroll` (`chat-transcript.component.ts`) sees a downward movement and neither unpins nor re-pins; the existing, unedited `TranscriptOlderHistorySentinelDirective` arms only on a *decrease*, so it is not re-armed by this write — OK by construction (verified by reading the gate values, not by re-deriving `onScroll`'s logic from scratch, since the user decision forbids touching it).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| 1 — Detect only a strict HEAD prepend | COMPLETE | None; suffix-match logic verified correct for append, replacement, session/tab switch, and (by code reading) the empty-list case |
| 2 — Apply every eligibility gate (active, same tab/session, not replaying, not pinned, `scrollTop===0`) | COMPLETE | None |
| 3 — Capture before DOM update; restore after render | COMPLETE | Timing claim independently verified against Angular 21.2.6 source, not just trusted from the report |
| 4 — One downward write; no sentinel re-arm | COMPLETE | None; reasoned from the (unedited) sentinel/onScroll gate conditions |
| 5 — Facade discipline / nameable collaborator | COMPLETE | Directive is self-contained, component stays a thin binder |
| 6 — Required specs | PARTIAL | Empty-list → populated-list transition untested (see Failure modes) |
| 7 — Tail-paging documentation | COMPLETE | `libs/frontend/chat/CLAUDE.md` rule 7 bullet updated |
| No edit to `onScroll`, `scheduleStickToBottom`, `restoreScrollOnActivation`, CSS | COMPLETE | Confirmed via `git diff` — only the two transcript files listed, plus the new directive/spec/CLAUDE.md sentence |

Implicit requirements not addressed: bounding the cost of the full-list DOM scan on very large sessions; observability for the silent skip path.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty previous list | YES (code) / NO (test) | `previous.length === 0` guard | No dedicated spec |
| Live append at tail | YES | Suffix mismatch at index 0 | None |
| Full replacement | YES | Suffix mismatch (or length gate) | None |
| Tab switch mid-flight | YES | `tabId !== previousTabId` blocks detection; if switch happens between capture and render, `active` flip bumps `revision` | None |
| Session switch | YES | `sessionId !== previousSessionId` | None |
| Pinned-to-bottom | YES | Explicit gate | None |
| Replaying | YES | Explicit gate, also structurally impossible (replay grows at tail, not head) | None |
| Anchor removed before render | YES | `.find` returns `undefined` → early return | Silent, no log |
| Non-zero `scrollTop` | YES | Explicit `=== 0` gate; native anchoring handles the rest | None |
| Rapid double-prepend before first restore fires | YES (reasoned, not spec'd) | Second `ngOnChanges` bumps `revision`, cancelling the first pending write, and captures its own anchor if still at `scrollTop===0` | Not covered by a spec case |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the one path proven only by inspection — a resume's empty-to-populated transition — is also the most frequently executed path through this directive in production. It is implemented correctly, but a regression there would not be caught by the current spec suite.
- What a robust implementation would add: (1) one directive-spec case (or a transcript-level replay-mount case) starting from an empty message list to lock in the guard that currently exists only in `isStrictHeadPrepend`'s early return; (2) a debug-level log on the "anchor not found, skipped" branch; (3) a documented (or bounded) cost note for the full-list DOM scan given the AC-11 fixture's message counts.
