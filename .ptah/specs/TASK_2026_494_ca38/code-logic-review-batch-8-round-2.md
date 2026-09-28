# Code Logic Review — Batch 8 (`TASK_2026_494_ca38`), Round 2 (FINAL)

## Summary

| Metric              | Value     |
| -------------------- | --------- |
| Overall score         | 8/10      |
| Assessment             | APPROVED  |
| Blocking issues        | 0         |
| Serious issues         | 0         |
| Moderate issues        | 0         |
| Failure modes found    | 0 new (1 accepted, documented tradeoff carried to B15) |

Scope re-checked: `surface-renderer.component.ts` (+spec), `surface-node.component.ts` (+spec, unchanged since
Round 1), `surface-text-input.component.ts` (+spec), `trust-boundary.spec.ts`, `batch-8-fix-1-report.md`,
`batches.md` Batch 8 section. Read every changed file in full, traced the new `bindingOf`/`draftBindings`
WeakMap logic, the `parentState`/`state` linkedSignal, and `reconcileTyped` by hand against the specific
scenarios both Round-1 reviews flagged, then independently re-ran the verification commands rather than
trusting the fix report's numbers.

Verification re-run in this review:
- `npx tsc -p libs/frontend/declarative-dashboard/tsconfig.spec.json --noEmit` → exit 0, no output (TS2367 gone).
- `npx jest -c libs/frontend/declarative-dashboard/jest.config.ts surface-renderer.component.spec.ts
  surface-node.component.spec.ts surface-text-input.component.spec.ts trust-boundary.spec.ts` → **4 suites / 92
  tests passed**, 0 failures.

## Prior-findings table

| # | Source | Finding | Round-2 status | Evidence |
| - | ------ | ------- | -------------- | -------- |
| 1 | R1 (mine) Blocking | Stale-echo WeakSet guard rejects a legitimate parent restore across a surface switch | **Resolved (by removal, coordinator-accepted)** | Guard deleted; `state` is a plain `linkedSignal` over `parentState()` (`surface-renderer.component.ts:225-232`); 6 new specs cover snapshot replace, reset-to-empty, workspace switch, re-create, switch-away-and-back (`surface-renderer.component.spec.ts:205-288`), all green |
| 2 | R2 (codex) Blocking #1 | Same defect, framed as "authoritative saved state mistaken for a stale echo" | **Resolved**, same fix | Same evidence |
| 3 | R2 (codex) Blocking #2 | Same id+kind, changed path keeps the old draft and can commit it to the new field | **Resolved** | `bindingOf` (kind+path) tracked per `drafts` object in `draftBindings: WeakMap` (`:130-135,238,277-294,342-380`); 4 new specs, blur/Enter/submit/host-update-that-keeps-binding (`:291-337`), all green |
| 4 | R1 Moderate 1 / R2 Moderate #3 | Comment-stripped scan bypassable (HTML comment across string markers, split tokens, regex-vs-comment misread) | **Resolved** | `stripComments` now uses the real TS parser/printer instead of a regex heuristic (`trust-boundary.spec.ts:259-263`); `joined()` catches split/interpolated tokens (`:270-272`); 9 bypass regression cases plus 1 negative case, all pass (independently re-run) |
| 5 | R2 Moderate #4 | No list-URL fixture in the trust boundary | **Resolved** | New spec `v1: a list item URL renders as literal text, never as a link` (`trust-boundary.spec.ts:164-175`), asserts literal text, zero `<a>`, no attribute carrying the `javascript:` URL |
| 6 | R1 Moderate 2 / R2 Minor #5 | TS2367 on `action === 'surface.submit'` inside `v1Actions`, invisible to `nx run-many` | **Resolved** | Dead branch removed, `v1Actions` built by a direct `.map()` (`trust-boundary.spec.ts:197-199`); independently re-ran `tsc -p tsconfig.spec.json --noEmit`, exit 0 |
| 7 | R1 Moderate/failure mode | Malformed non-throwing `SURFACE_VIEW_MODEL_BUILDER` override result crashes in `SurfaceNodeComponent` instead of `renderFailed` | **Resolved** | `isRenderableNode` validates every node's shape by kind before it is accepted (`surface-renderer.component.ts:76-101`, invoked from `attemptBuild:109-124`); 12 malformed-shape cases plus 1 well-formed override, all render nothing / one `renderFailed` (`surface-renderer.component.spec.ts:131-167`) |
| 8 | R1 (mine) / R2 | `checkDraftValue` in `invoke()` could see unsanitized options from a non-default builder | **Resolved as a side effect of #7** | Options are now validated at the `attemptBuild` boundary, so a node reaching `invoke()`'s flush loop is already well-formed |
| 9 | R1 Minor 3 | `pruneDrafts` effect writes a signal it also reads (one extra self-terminating re-run) | **Unchanged, accepted** | Not touched; still one no-op extra pass, confirmed non-looping by the passing specs. Not worth flagging again — it was Minor, not correctness-affecting, and the fix report explains why it stays |

## Must-check table

| # | Item | Result | Evidence |
| - | ---- | ------ | -------- |
| 1 | Switch-away-and-back / reset blocker resolved: snapshot replace, reset to empty, workspace switch, re-create, switch-away-and-back with renderer mounted | **Yes** | All 5 scenarios have dedicated specs (`surface-renderer.component.spec.ts:205,215,231,246,259`); independently re-run, all green. Traced the signal graph by hand (`parentState` → `state` linkedSignal) to confirm a surface-id value change, or any new `viewState` object, forces recomputation to the parent's exact object, with no spurious reset when only the `renderable` object identity changes but its `surfaceId` string and `viewState` reference stay equal |
| 2 | Same id+kind, changed path drops the draft | **Yes** | `bindingOf(node) = kind + '\0' + path`; `staleDraftIds` compares the binding recorded at write time (or adopted at first sight) against the *current* node's binding; traced through `writeDraft`, `bindingsOf`, `withoutDrafts` and `invoke`'s discard set by hand — a path-changed draft is pruned on the next `pruneDrafts` effect pass and is unconditionally excluded from `invoke`'s flush (never reaches `checkDraftValue` against the new binding) |
| 3 | Text-input fix (restore displayed 'a', committed 'ab') — displayed and committed now agree; B7 F1/F2 still hold | **Yes** | Traced `reconcileTyped`/`isStale` by hand for keystroke → round-trip → keystroke → restore-of-older-object; both `displayedValue` and `commitDraft`'s `currentDraft()` call the same `reconcileTyped`, so they can never diverge. New spec `surface-text-input.component.spec.ts:333-346` pins exactly the round-1-reported divergence; all pre-existing F1/F2 specs (diff shows only an addition, no other lines touched) still pass |
| 4 | `attemptBuild` validates nodes or routes malformed ones to `renderFailed` | **Yes** | `isRenderableNode` checks kind membership, id, `selectable`, per-kind required fields (label/path/hostValue, choice options, layout children/submitActions, v1 children-if-present), and rejects self-referential cycles; 12 malformed cases + 1 well-formed override case all pass |
| 5 | Scan: HTML-comment/split-string bypasses closed or documented with a runtime DOM backstop; list URL fixture | **Yes** | TS-parser-based `stripComments` + token-joining `joined()`; 9 regression cases (including the two exact bypasses both Round-1 reviews reported) all independently re-run and pass; the remaining limitation (computed property names via `atob`/`String.fromCharCode`/`Reflect.set`) is explicitly documented (`trust-boundary.spec.ts:283-291`) and backed by the runtime `expectInert` DOM assertion, not left as an implicit gap. List-URL fixture present and passing |
| 6 | TS2367 fixed, `tsc -p tsconfig.spec.json --noEmit` clean | **Yes** | Independently re-run in this review: exit 0, no output |
| 7 | Regressions from guard removal (e.g., a late echo rolling drafts back inside the renderer itself) | **No new regression found; one documented, coordinator-accepted tradeoff** | See "Carry-overs" below. Traced the synchronous-parent path (`writeDraft` → `state.set` → `viewStateChange.emit` → host `viewState.set` → `parentState`/`state` recompute) by hand: for a conforming (synchronous) parent this settles on the same object with no rollback, confirmed by the passing "writes every draft into its working copy synchronously" and all switch/reset specs. The only way to reproduce a rollback is a parent that violates the documented contract (holds an older emitted object and reapplies it after a newer one), which is out of this batch's contract by the coordinator's own ruling |

## Five logic questions

### 1. How does this fail silently?

No new silent-failure path was found in this round. The one residual case — a parent that violates the "store and
reapply the emitted object synchronously" contract can roll a draft back with no error signal — is unchanged from
the accepted tradeoff below; it was not silent before either (the old guard silently *dropped a legitimate restore*
instead, which was strictly worse and is what round 1 flagged as Blocking).

### 2. What user action produces unexpected behaviour?

None found for a conforming parent (the shape every current call site and every new B8 spec uses). The
switch-away-and-back scenario that was previously broken (`surface-renderer.component.spec.ts:259-280`) now
round-trips correctly: surface A's state, B's state, and back to A's, are each shown as their own parent-supplied
object, not blended.

### 3. What input data produces a wrong answer?

None found for the default builder's inputs (validated end-to-end by `isRenderableNode`). A non-default
`SURFACE_VIEW_MODEL_BUILDER` override that returns malformed nodes now fails closed (`renderFailed`, empty
subtree) instead of throwing an uncaught `TypeError` in the template.

### 4. What happens when a dependency fails?

Same as Round 1 (unaffected by this round's changes): a throwing builder and a `renderFailed: false` result with
`viewModel: null` both fail closed identically; both are pinned by spec. `checkDraftValue` can no longer see a
malformed node in `invoke()`'s flush loop, because `attemptBuild` now rejects such nodes before they are ever
rendered.

### 5. What is missing that the requirements never mentioned?

Nothing new. The one remaining implicit requirement — a synchronous, verbatim parent write-back of every emitted
`viewState` object — is now the renderer's explicit, documented contract (`surface-renderer.component.ts:160-179`)
rather than an unstated assumption enforced by a guard that broke legitimate restores. It is correctly carried
forward to B15 in `batch-8-fix-1-report.md`'s "Out of scope" section and in `batches.md:463-464`.

## Failure modes

### Accepted: a parent that reapplies an older emitted object late can roll a draft back

- Trigger: a parent violates the documented contract — it holds an object the renderer emitted, applies a
  *newer* emitted object first, then later (asynchronously) applies the *older* one.
- Symptom: the renderer treats the older object as authoritative (by design, now that "authoritative" is decided
  purely by what the parent currently passes, not by identity history) and the newer draft is lost.
- Evidence: `surface-renderer.component.ts:160-179` (class doc, states the contract); `batch-8-fix-1-report.md`
  "Accepted consequence" section (explicitly not spec-pinned, by design).
- Current handling: none inside this lib; `SurfaceViewState` carries no revision field to detect this
  (`surface-view-state.ts:24-26`, confirmed by both Round-1 reviews and unchanged in this round).
- Impact: scoped to a parent that does not honour the B8 carry-over (a) contract. Every call site inside this
  batch (the test host, `feedBack = true` or `false`) honours it. This is a **carry-over risk for B15**, not a
  defect in this batch — see below.
- Recommendation: unchanged from the fix report — B15's Apps-page wiring must apply `viewStateChange` to its
  store synchronously (no debounce, no async middleware hop) before any other surface state can be read. This is
  already flagged in `batches.md:463-464` as a coordinator-accepted, documented tradeoff, not something this
  round should re-litigate as a blocking implementation gap.

No other failure mode was found in this round's re-read. I looked specifically for: a race between `writeDraft`'s
synchronous `publish()` and the host's synchronous re-application of `viewState` (traced by hand, settles correctly
because `normalized()` returns the identical object reference when its shape is already `{components, drafts}`);
a WeakMap leak or cross-contamination in `draftBindings` (keyed by the `drafts` object itself, so bindings for a
discarded object are simply garbage-collected, and a fresh, never-seen parent object correctly falls back to
adopting the currently-rendered bindings rather than stale ones); and the cyclic-node and non-array-children
validation paths in `isRenderableNode` (traced by hand, correctly terminates and rejects).

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

None new. Carried forward, not re-scored: the `pruneDrafts` effect's one self-terminating extra pass (R1 Minor 3,
explicitly left as-is with a documented reason in the fix report) and the inherent limitation that a
computed-at-runtime property name (`el[key]`, `Reflect.set`, etc.) is invisible to any source-token scan — this is
now explicitly documented in `trust-boundary.spec.ts:283-291` with the runtime DOM assertion named as the backstop,
which is the correct way to close out a Moderate finding that cannot be fully closed by a text scan.

## Data flow

1. `renderable` input changes → `attempt` computed rebuilds via `SURFACE_VIEW_MODEL_BUILDER` inside `attemptBuild`,
   which now validates every node's shape (`isRenderableNode`), not just the outer container → OK, both the
   throwing-builder and malformed-node gaps from Round 1 are closed.
2. `viewState`/`surfaceId` change → `parentState` computed → `state` linkedSignal recomputes to the parent's exact
   object, unconditionally (no identity-history guard) → OK, confirmed by 6 specs covering every reset/restore
   shape named in the MUST-CHECK brief.
3. Keystroke → `draftChange` → `writeDraft` records the write's binding (kind+path) in `draftBindings`, writes the
   working copy synchronously, publishes → OK, unaffected by this round beyond the added binding bookkeeping.
4. View model rebuild (renderable/kind change) → `pruneDrafts` effect computes `staleDraftIds` from the *current*
   binding of each still-present input vs. the binding recorded when its draft was written → drops drafts whose
   input vanished, changed kind, **or changed path** (new in this round) → OK, 4 new specs cover blur/Enter/submit/
   host-update-that-keeps-binding.
5. Submit → `invoke()` discards stale-binding drafts up front (never reaches `checkDraftValue` or `commit()` for
   them), flushes the rest → OK, confirmed by the "never commits it on submit" spec.
6. Text input keystroke/restore → `reconcileTyped` either drops stale typed text or re-keys it to the newest
   `drafts` object that still holds it → `displayedValue` and `commitDraft`'s `currentDraft()` share this single
   reconciliation, so display and commit can no longer diverge → OK, closes the Round-1-reported 'a'-shown/'ab'-
   committed divergence.
7. Trust-boundary scan: source → TS-parser-based `stripComments` (compiler-accurate comment/string/regex
   boundaries) → `joined()` (catches split/interpolated tokens) → `FORBIDDEN` pattern match against both views →
   OK, 9 regression cases including both Round-1-reported bypasses pass; documented residual limit (runtime-
   computed property names) is backed by the runtime DOM assertion, not left silent.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| B8 carry-over (a): synchronous draft write, overlay before discard | COMPLETE | none (unchanged, still confirmed) |
| B8 carry-over (g): swapped node's draft removed, **including a path-only change** | COMPLETE | none (Fix 2 closes the path-change gap both Round-1 reviews found) |
| Renderer state correctness across a persistent, multi-surface lifetime (Round-1 Blocking) | COMPLETE | none, for a parent that honours the documented synchronous write-back contract; a non-conforming parent can still roll back a draft, which is now an explicit, coordinator-accepted contract rather than a silent defect |
| Malformed non-default builder override fails closed | COMPLETE | none |
| R8 trust boundary scan not trivially bypassable | COMPLETE | the two concrete bypasses from Round 1 are closed; the documented, provably-unclosable residual (runtime-computed property names) is now explicit and backed by the runtime DOM assertion instead of being an implicit gap |
| R8 list URL fixture | COMPLETE | none |
| Spec-file type-checking clean | COMPLETE | none (added to batch verification commands, not `project.json`, per coordinator ruling) |

Implicit requirements not addressed: none found beyond the already-carried-forward B15 synchronous-write-back
contract, which is explicitly documented rather than silently assumed.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Switch away and back to a surface whose stored `viewState` is a previously self-emitted reference | YES | `state` linkedSignal re-adopts the parent's exact object on any `surfaceId`/`viewState` change | none |
| Same-id, same-kind, changed-path draft | YES | `bindingOf` (kind+path) tracked per `drafts` object; pruned and excluded from submit | none |
| Restore of the exact `drafts` object typed text was drafted against | YES | `reconcileTyped` re-keys typed text to the newest vouching object; display and commit agree | none |
| Non-throwing builder override returning a malformed node | YES | `isRenderableNode` rejects it at the `attemptBuild` boundary; `renderFailed` + empty subtree | none |
| HTML comment spanning a string-literal sink assignment | YES | TS-parser-based `stripComments` never treats in-code `<!--` as a real comment | none |
| Split-token / bracket-notation / template-interpolated sink access | YES | `joined()` view catches these in addition to the raw stripped view | residual: a runtime-computed property name (`el[var]`) is still invisible to a source scan — documented, backed by the runtime DOM assertion |
| List item URL rendering | YES | new fixture asserts literal text, zero `<a>`, no attribute leak | none |
| A parent that violates the synchronous write-back contract | NO (by design) | none inside this lib; `SurfaceViewState` has no revision field | carried to B15 as a wiring requirement, not a code defect in this batch |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none within this batch's contract. The one residual risk — a non-conforming parent rolling back a
  draft — is an explicit, documented, coordinator-accepted contract for the consumer (B15), not a defect in this
  batch's code, and it replaces a strictly worse defect (silently dropping a legitimate restore) that Round 1
  correctly blocked on.
- What a robust implementation would add, if the contract ever needs to be relaxed: a revision/generation field on
  `SurfaceViewState` so the renderer could distinguish "older" from "restored" without relying on the parent's
  write-back timing — explicitly out of scope for this batch per the coordinator's ruling, and correctly deferred
  rather than half-implemented.

## Carry-overs

- **To B9** (`budget-render.spec.ts`): unaffected by this round's changes. The constructor effect still emits
  `renderFailed` once per new failing `attempt` object; this is unchanged by the node-validation addition to
  `attemptBuild`, confirmed still passing in the renderer's own build-failure specs.
- **To B15**: the renderer's contract is now unconditional — it will show and act on whatever `viewState` object
  the parent passes, with no staleness protection of its own. B15's Apps-page wiring (the store/reducer that owns
  `viewStateChange` → `viewState`) **must** apply each emitted object synchronously, in the same tick, before any
  other surface's state can be read or before the same surface's state can be reapplied from an older source (e.g.
  a stale closure, a debounced dispatch, or an async round trip that could reorder). If B15's actual wiring cannot
  guarantee this, that is the point to reopen this contract (e.g., add a revision field), not to re-litigate B8.

## One-line summary

Both Round-1 blocking findings (the WeakSet guard rejecting legitimate restores, and same-id/same-kind path
changes keeping a stale draft) are fixed and spec-pinned, the trust-boundary scan's two concrete bypasses are
closed with a compiler-accurate comment stripper, the list-URL fixture and TS2367 gaps are closed, and independent
re-verification (tsc clean, 92/92 tests green across the four re-checked spec files) found no new defect — the
one residual risk is an explicit, coordinator-accepted contract carried to B15, not a code defect in this batch.
