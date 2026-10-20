# Code Style Review (Phase 3) - TASK_2026_692_f748

Scope: `git diff ec61276b1..HEAD -- libs/` (Batches 14-17), 14 files, read with `-w`. `npx eslint` on compaction-marker.component.ts: clean. No heavy checks run.

Verdict: NEEDS_REVISION (0 Blocking, 1 Serious, 1 Moderate, 3 Minor)

## Serious

### S1. Inline `{ readonly preTokens: number }` repeated in about 10 places instead of a named shared type

Occurrences (production code):
- libs/shared/src/lib/types/execution/stream.ts:292 (the source of truth)
- libs/frontend/chat-state/src/lib/conversation-registry.service.ts:42 (readonly) and :281 (mutable variant, drift)
- libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:139
- libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:~207 and ~417 (two result shapes)
- libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts:363 and :756
- libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-marker.component.ts:105 (non-readonly `{ preTokens: number }`)
- Backend twin: `IdleBoundaryNotice` in libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.types.ts:263 has the identical shape.

Boundary check: every one of these libs already imports from `@ptah-extension/shared` (for example `CompactionMeasurement` in compaction-marker.component.ts:1 and conversation-registry.service.ts). The sibling type `CompactionMeasurement` is already a named, exported interface next to `CompactionCompleteEvent` (stream.ts:~279). Importing a new shared type adds no module-boundary edge in any lib, and shared is a lower layer than all of them.

Problem: the notice has a domain meaning (idle-compaction notice) that a future field would have to change in about 10 places. A mismatch is already visible: the readonly/mutable inconsistency at conversation-registry.service.ts:281 and compaction-marker.component.ts:105. The most direct sibling, `measurement`, uses the named type, so this is also inconsistent with how the same problem is solved next to it.

Recommendation: add `export interface IdleCompactionNotice { readonly preTokens: number }` (with the doc) beside `CompactionMeasurement` in stream.ts, export it through the shared barrel, use it on `CompactionCompleteEvent.idleCompaction` and in all frontend sites. Optionally alias the backend `IdleBoundaryNotice` to it, or leave the backend alone since agent-sdk's type is internal.

## Moderate

### M1. Idle-aware marker label is not reflected in the detail modal title or tokenLine semantics

compaction-marker.component.ts: the chip text switches on `idleCompaction()`, but the modal title (still the literal "Context compacted", ~line 55) and the "View" flow are unchanged, and `tokenLine()` (:117-132) is rendered after a full sentence that already ends in "(was N tokens).", giving "... (was 12,345 tokens). · shrank 12,345 → 3,000 tokens". The pre-token count is shown twice. Decide whether the idle sentence should drop "(was N tokens)" when a measurement is present, or confirm the duplication is intended and test it. No spec covers idle + measurement together (spec lines 103-117 only cover idle alone).

## Minor

- compaction-marker.component.ts:105: the input type is `{ preTokens: number }` while the event field is `readonly`; align via S1.
- stream.ts:291 doc says "matched to this SDK boundary" but does not say it is absent for manual and auto compaction, nor what `preTokens` means (tokens before the idle compact). One more sentence prevents misuse. The doc also sits on a field whose siblings (`boundaryId`, `measurement`) have none, so this is acceptable, but note the existing interface doc block above `CompactionMeasurement` is actually the `CompactionCompleteEvent` doc (pre-existing misplacement, not introduced here).
- compaction-marker.component.spec.ts:103-116: the "always renders Context compacted title" test gained an unrelated `not.toContain('manual')` assertion; it asserts absence of text that no code path produces, so it guards nothing. The idle test queries `querySelector('span')` (first span) which couples it to template order; prefer a data-testid or class. The multi-line exact-string assertion also breaks if the template wording is edited (acceptable, it pins copy).

## Checks that passed

- Angular conventions in compaction-marker.component.ts: `input()` signals, `ChangeDetectionStrategy.OnPush`, standalone, `@if ... as` / `@else` control flow, no `*ngIf`. `format` changed from private to protected correctly because the template now uses it (:222 area); nothing else widened.
- Template text: single sentence, whitespace collapses acceptably; consistent with the existing "shrank ... tokens" phrasing.
- Wiring: the field is forwarded at every hop (transformer -> accumulator-core:586 -> streaming-handler results -> chat.store:428 -> compaction-lifecycle -> registry -> chat-view.component.html binding); no hop dropped it. Registry persistence parse (conversation-registry.service.ts:~392) validates number, finite, non-negative, matching the validation style used for `measurement`.
- Prettier-only churn in streaming-handler.service.ts and compaction-lifecycle.service.ts is formatting only (confirmed with `diff -w`); chat-view.component.html is a one-line change.
- Backend: system-message.transformer.ts:109 uses `idleCompactionNoticeFor?.()` optional call and spread-if-defined, matching the neighbouring `measurement` pattern. The optional call on a non-optional method may be there for test doubles; low cost.
- No `any`, `@ts-ignore`, or `eslint-disable` added. No deep cross-lib imports added.

## Five style questions (short)

1. Six months: a second field on the notice means about 10 edits (S1).
2. Misread: the readonly/mutable mismatch suggests the registry mutates the notice; it does not.
3. Maintenance: the repeated inline type is the only avoidable cost.
4. Inconsistency: `measurement` is named and shared; `idleCompaction` is not (S1).
5. Differently: one shared named interface, and a decision on the duplicated token count in the marker (M1).

## Score

7/10. Wiring and Angular conventions are sound and consistent; the named-type omission is the one real gap.
