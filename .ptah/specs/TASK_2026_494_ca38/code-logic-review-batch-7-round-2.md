# Code Logic Review — Batch 7, Round 2 (FINAL) — `TASK_2026_494`

## Summary

| Metric              | Value                                |
| -------------------- | ------------------------------------- |
| Overall score        | 8/10                                  |
| Assessment            | APPROVED                              |
| Blocking issues       | 0                                      |
| Serious issues        | 0                                      |
| Moderate issues       | 1 (carried, not new)                  |
| Failure modes found   | 0 new (1 pre-existing, out-of-scope, carried) |

Scope: `surface-text-input.component.ts`, `surface-choice-input.component.ts` (both changed by the round-1
fix), `surface-checkbox-input.component.ts` (unchanged — confirmed correctly out of scope for F1-F3), plus the
new spec cases in `surface-text-input.component.spec.ts:253-333` and
`surface-choice-input.component.spec.ts:189-224`. Independently ran
`npx jest -c libs/frontend/declarative-dashboard/jest.config.ts` against all three component specs:
`Test Suites: 3 passed, 3 total; Tests: 51 passed, 51 total`.

## Prior-findings rulings

| Finding | Ruling | Evidence |
| --- | --- | --- |
| Codex F1 (High) — consumed draft could commit twice | **RESOLVED** | `surface-text-input.component.ts:113,218,226-234`. A `consumed` marker `{componentId, drafts}` is recorded on every commit that passes the gate (`:218`). `currentDraft()` checks `typed !== null` FIRST (`:230`, always wins for a genuinely new edit) and only falls back to the `consumed` block when `typed === null` (`:231-232`), so a second same-tick blur/Enter/debounce-then-blur against the *same* `drafts` object reference returns `undefined` and `commitDraft()` no-ops at `:214`. Traced by hand through both new F1 specs (`surface-text-input.component.spec.ts:254-267,269-279`) against the actual source and independently re-ran green (see above). |
| Codex F2 (High) — stale local text survives host replacement / external draft removal | **RESOLVED** | `surface-text-input.component.ts:31-37` (`TypedText` now carries `componentId`, `path`, `hostValue`, and the `drafts` object it was typed against), `:241-245` (`isStale`), `:121-127` (proactive `effect()` that drops typed text and clears the debounce timer on every `node()`/`drafts()` change once stale), `:229` (the same guard re-checked at commit time as a second line of defense). Traced by hand through all four new F2 specs (`surface-text-input.component.spec.ts:283-293,295-304,306-314,316-323`) — host replacement, node swap, externally-cleared draft with an armed timer, and externally-replaced draft — against the actual source; all four scenarios correctly drop or redirect the stale buffer. |
| Codex F3 (Medium) — options filtering for render did not make validation safe | **RESOLVED** | `surface-choice-input.component.ts:108` (`checkedNode = { ...node(), options: options() }`, using the same filtered list that renders) is now what `errorText` (`:131`) and `chooseIndex` (`:153`) pass to `checkDraftValue`, so a `null` entry or non-array `options` can no longer reach the shared validator's unguarded iteration. Confirmed against the new `describe.each(['select','radio-group'])('malformed options validate like they render (F3, %s)', ...)` block (`surface-choice-input.component.spec.ts:189-224`), which exercises exactly the two throw scenarios Codex reproduced (a `null` entry beside a valid option, and a non-array `options` with string host/draft/pending values) and both pass without throwing. |
| Round-1 own ruling (a) — `draftChange` output | Unchanged, still ACCEPT | No change touched this in round 1; carried per instructions as a B8 wiring item, not a defect here. |
| Round-1 own ruling (b) — choice/checkbox snap-back, silent revert on host rejection | Unchanged, still ACCEPT/carried | `restoreDom()` (`surface-choice-input.component.ts:161-166`) and checkbox `toggle()` (`surface-checkbox-input.component.ts:92-99`) are untouched by this round's fixes; the host-rejection channel gap is an explicitly named B8/B13 carry-over per this round's instructions, not re-raised here. |
| Round-1 own ruling (c) — `role="radiogroup"` | Unchanged, still ACCEPT | No change in this round. |
| Round-1 own ruling (d) — duplicated label/error/issue helpers | Unchanged, CARRY-TO-B8 (explicitly excluded from B7 blocking by this round's brief) | Not re-raised. |
| Round-1 own ruling (e) — neutral error text | Unchanged, still ACCEPT | No change in this round. |
| Round-1 Moderate #1 — Enter-then-immediate-blur not spec-covered | **RESOLVED** by the new F1 specs | `surface-text-input.component.spec.ts:254` now fires Enter then blur with no change-detection tick in between and asserts exactly one commit, then proves a later real edit still commits — directly closing the gap round-1 flagged as untested. |
| Round-1 Moderate #2 — stale local buffer outlives an externally-cleared shared draft | **RESOLVED** by the F2 fix | This was the same defect Codex's F2 named with reproduction evidence; the fix (`isStale`/`effect()`) is the "defensive effect" round-1's own recommendation asked for. |

## Regression hunt (this round's specific charge)

- **F2 effect dropping typed text on unrelated drafts updates**: NOT observed. `isStale()` (`surface-text-input.component.ts:241-245`) only trips on a componentId/path mismatch, an `Object.is`-different `hostValue` (host values for a `text`-kind node are always strings per `surface-view-model.ts:63-69`'s `readSurfacePath`/`checkDraftValue` path, so `Object.is` compares by value, not reference — an unrelated re-render that leaves the string content unchanged does not trip this branch), or a *different* `drafts` object whose own entry for this id no longer equals the typed text. The non-regression pin `surface-text-input.component.spec.ts:325-332` ("keeps typed text across an unrelated drafts update") exercises exactly a new `drafts` object that adds an unrelated key while preserving this component's own entry, and it stays green.
- **F1 drafts-identity marker blocking a legitimate later edit**: NOT observed. `currentDraft()` (`:226-234`) checks `this.typed !== null` before ever consulting `consumed`, so any new `draftInput()` call (a genuine keystroke) always wins over a stale `consumed` marker — traced by hand through the exact "type `draft`, commit, type `draft` again, commit again → two commits" sequence in `surface-text-input.component.spec.ts:264-266`, which is green.
- **Timer leaks**: NOT observed. `commitDraft()` calls `clearDebounce()` unconditionally as its first line (`:212`); the proactive `effect()`'s `dropTyped()` also clears the debounce (`:246-249`); `DestroyRef.onDestroy` still clears it (`:122`, unchanged from round 1). No new `setTimeout`/`setInterval`/subscription was introduced by either fix; `effect()` is created once in the constructor (not per render) and is auto-disposed with the component's injector.
- **First commit before the parent round trip**: NOT observed to have regressed. `currentDraft()` still returns `typed.text` independent of the `drafts` input round trip whenever `typed !== null` and not stale (`:230`), and the pre-existing "commits once 600 ms..." spec (`surface-text-input.component.spec.ts:87-100`, unmodified) is still green, plus the new F1/F2 specs explicitly exercise commits before any `rerender()`.
- **IME Enter**: NOT observed to have regressed. `commitOnEnter()` (`:188-191`) is untouched by both fixes; `surface-text-input.component.spec.ts:111-118` is still green in this round's run.

No new failure mode was found in this round beyond what round 1 already carried (and that carry-item — silent revert on a host-level rejection — is the explicitly accepted B8/B13 item this round's brief said not to re-raise).

## Five logic questions

### 1. How does this fail silently?

No new silent-failure path was introduced by the fixes. The only pre-existing one — a host-level rejection of an applied `change`/`select` commit reverting the control with no error text, because `errorText` is driven solely by `checkDraftValue` which already passed locally (`surface-choice-input.component.ts:128-133`, `surface-checkbox-input.component.ts:75-80`) — is unchanged and is an accepted B8/B13 carry-over per this round's instructions, not re-raised as a finding here.

### 2. What user action produces unexpected behaviour?

Traced but not found: rapid double-commit sequences (Enter+blur, debounce+blur, both with and without an intervening change-detection tick) now behave identically to a single commit, and a genuine follow-up edit to the same string still commits — both directly pinned by the new specs and confirmed by hand-tracing the actual source against Angular's signal-input update timing (inputs update only on `detectChanges()`, not synchronously with a sibling `output()` emit, which is exactly the assumption the `consumed`/`isStale` guards are built on).

### 3. What input data produces a wrong answer?

Traced but not found new to this round: a `null` entry in `options` or a non-array `options` value no longer reaches the shared validator unfiltered (F3 fix), for both `errorText` evaluation and `chooseIndex` selection, across `select` and `radio-group`.

### 4. What happens when a dependency fails?

Unchanged from round 1: `checkDraftValue`/`readSurfacePath` remain pure and verified; nothing in these three components catches a throw from them, which is correct given the contract. No new dependency was introduced by either fix (no RPC, no new subscription).

### 5. What is missing that the requirements never mentioned?

Nothing new. The fix report's own "Notes for B8" section (`batch-7-fix-1-report.md:114-119`) already states the residual assumption explicitly: the F2 guard assumes the parent applies each `draftChange` write synchronously before passing the next `drafts` object; if a real parent batches writes such that a refreshed `drafts` holds an older keystroke than the typed text, the guard drops the typed text and the older draft becomes what commits. This is the accepted carry-over named in this round's brief ("the F2 guard assumes the parent writes drafts synchronously") — not re-raised as a finding.

## Failure modes

None found in this round beyond the round-1 carried item (silent revert on host-level rejection), which this round's instructions explicitly mark as an accepted B8 carry-over and not a B7 blocker.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- Moderate (carried, not new, explicitly accepted per this round's brief): "the F2 guard assumes the parent writes drafts synchronously" — `surface-text-input.component.ts:241-245`, documented as a B8-facing assumption in `batch-7-fix-1-report.md:114-117`. Not scored against this batch.
- Minor: `consumed`/`typed.drafts` each hold a reference to a whole `drafts` object until superseded; bounded by one object per field per commit cycle, not a growth-with-session concern.

## Data flow

1. Keystroke → `draftInput()` sets `typed` (now carrying componentId/path/hostValue/drafts identity) and emits `draftChange` — OK, unchanged from round 1's per-keystroke draft write.
2. Commit trigger (blur/Enter/600 ms) → `commitDraft()` → `currentDraft()` — OK: prefers `typed` when present and not stale (F2 guard), otherwise falls back to the `drafts` input unless blocked by the `consumed` marker from this component's own last commit against the same `drafts` object (F1 guard).
3. A second same-tick trigger against the still-unrefreshed `drafts` object → blocked by `consumed` — OK, verified by hand-trace and by the new specs.
4. `node()`/`drafts()` change (host replaced, draft externally cleared/replaced, node swapped) → the constructor's `effect()` proactively drops `typed` and its timer before any commit trigger can fire — OK, closes the timing window round 1 flagged as latent.
5. Choice/checkbox commit gate now validates against the same filtered `options()` that render (`checkedNode`) — OK, closes the F3 throw path for both `errorText` and `chooseIndex`.
6. Everything downstream of a successful commit (inputCommit before draftChange removal, DOM restore for choice/checkbox, neutral error text, ARIA wiring) is unchanged from round 1 and re-confirmed green by the independent test run.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| No `inputCommit` per keystroke | COMPLETE | None |
| Commit on blur, Enter, 600 ms (text), never twice for one user action | COMPLETE | None (F1 resolved) |
| Draft stays consistent with what the UI shows, including after external changes | COMPLETE | None (F2 resolved) |
| Malformed options skipped on render AND on validation | COMPLETE | None (F3 resolved) |
| One debounce timer per instance, cleared on commit/destroy | COMPLETE | None |
| Displayed value = draft ?? pending ?? host | COMPLETE | None |
| IME-safe Enter commit | COMPLETE | None |

Implicit requirements not addressed: none newly surfaced this round. The host-rejection channel for `change`/`select` commits remains the single carried, explicitly out-of-scope item.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Enter then blur, same tick, no CD in between | YES | `consumed` marker keyed by drafts-object identity | None |
| Debounce fires then blur, same tick, no CD in between | YES | Same `consumed` marker; debounce always cleared first | None |
| Host value replaced while a draft is armed | YES | `isStale` hostValue check + proactive `effect()` | None |
| Draft externally cleared while a debounce timer is armed | YES | Proactive `effect()` drops typed text and timer | None |
| Node swapped to a different component id/path | YES | `isStale` componentId/path check | None |
| Draft externally replaced with a different value | YES | `isStale` drafts-entry-mismatch check; commit uses the new value, not the stale typed text | None |
| Unrelated `drafts` update (a different component's entry changes) | YES | `isStale`'s drafts-entry-match short-circuit | None |
| Legitimate follow-up edit to the same string after a commit | YES | `typed !== null` always checked before `consumed` | None |
| `null` entry in `options` | YES | `checkedNode` reuses the filtered `options()` for validation too | None (F3 resolved) |
| Non-array `options` | YES | Same as above; filters to `[]` | None (F3 resolved) |
| Host-level rejection of an applied change/select commit | NOT YET (by design) | N/A | Accepted B8/B13 carry-over, not a B7 gap |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none within this batch's scope. The one residual assumption (parent applies each `draftChange` synchronously before the next `drafts` object arrives) is explicitly named by the fix author as a B8-facing contract, is consistent with how the reviewed test harness itself round-trips writes, and is accepted per this round's carry-over list.
- What a robust implementation would add: nothing required for this batch. For B8, a regression spec that drives a *batched* (non-synchronous) parent draft round trip would give positive confidence in the one named assumption, but that parent does not exist until B8.
