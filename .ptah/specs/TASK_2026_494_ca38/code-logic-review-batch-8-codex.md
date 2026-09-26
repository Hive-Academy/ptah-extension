# Code Logic Review — `TASK_2026_494_ca38`

Round 1, Batch 8 / Task 8.1. Security and state ownership review.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 2 |
| Serious issues | 0 |
| Moderate issues | 2 |
| Minor issues | 1 |
| Failure modes found | 5 |

The literal-rendering paths examined and the existing tests work, but state can cross document boundaries and a retained draft can target a different field. Those data-integrity defects prevent a 7–8 score; the working rendering, synchronous commits and failure reporting distinguish this from a foundational 1–4 implementation.

Paths below are relative to the worktree. Abbreviations: **C** = `libs/frontend/declarative-dashboard/src/lib/components/`; **T** = `libs/frontend/declarative-dashboard/src/lib/trust-boundary.spec.ts`.

## Scope and verification

Read the new renderer, node, shared helper and all four new spec files in full; read index.ts, input wiring, layout composition, builder and relevant display sinks. Read task context, requirements, Batch 8 instructions, specified plan sections, executor report and existing style review (which concerns Batch 2).

Executed the seven named new/input Jest suites once: **7 suites / 89 tests passed**. This is functional evidence, not proof of the missing reset/path-change cases. An isolated reproduction using the installed Angular signal/linkedSignal implementation confirmed that restoring a previously emitted workspace-A state leaves workspace-B drafts active. Executing the actual source-stripper in memory confirmed finding 3. No source/spec file was changed.

Scoped ptah_get_diagnostics reported TS2367 for the impossible submit comparison (finding 5); its reported line was 181, while the current on-disk comparison is T:182. Jest's passing result does not resolve that semantic diagnostic.

ptah_search_files returned no AGENTS.md; root AGENTS.md and CLAUDE.md were absent. No direct file-read or Write tool was listed, so native reads/writing were used. The role prohibits all Git operations, so the requested git status/diff checks were not performed. Consequently, helper-move and layout-diff equivalence are **not certified**. The InputSignal annotations at C/dashboard-list.component.ts:82, C/dashboard-stat.component.ts:43 and C/dashboard-table.component.ts:96 are type-only in the examined source; unchanged input behavior is supported by the existing input suites. No broad review of those display implementations is claimed.

## MUST-CHECK rulings

| Check | Ruling | Evidence and effect |
| --- | --- | --- |
| R8 literal text, every pinned field | PARTIAL | Renderer title/description use interpolation (C/surface-renderer.component.ts:132); T:76–168 checks surface/layout titles, labels/options, placeholders, input value, text description, action label, issues/detail and the listed display fields with zero img/script (T:65). List URL is omitted: finding 4. No active HTML sink matched the raw non-spec scan of either lib. |
| R8 comment-stripped scan cannot trivially hide a sink | FAIL | T:274 removes HTML-comment spans across TypeScript strings and executable statements: finding 3. |
| Every non-submit/non-select action inert | PASS in examined paths | All six IDs are enumerated at T:206; control-set comparisons at T:211 and T:219 introduce no enabled control or action label. Layout filters again at C/surface-layout.component.ts:106; builder selects only dashboard.select at view-model/surface-view-model.ts:48. The fixture does not instantiate every kind/action Cartesian combination (e.g. v2 line chart), but shared rendering paths apply the same gates. |
| Parent state older than emitted state | FAIL | C/surface-renderer.component.ts:169,175–178,268: lifetime WeakSet membership of the exact object, not revision, time, surfaceId, workspace or generation. Any previously emitted object is refused, including an authoritative restore. See finding 1 and reset matrix below. |
| (a) Synchronous draft write and overlay before discard | PASS | C/surface-renderer.component.ts:220–227,267–270 synchronously update working state before emitting. Commit installs overlay before forwarding at :236–239; input emits removal after commit at C/surface-text-input.component.ts:203–204. Tests: C/surface-renderer.component.spec.ts:131,159. |
| (d) Throwing builder equals failed build | PASS | Both return null through C/surface-renderer.component.ts:69–79, render no subtree at :129 and emit at :208–209. Repeated-build/one-attempt behavior is pinned at C/surface-renderer.component.spec.ts:103–121. |
| (g) Swapped node removes old draft | PARTIAL | Missing ID and kind changes are removed at C/surface-renderer.component.ts:280–283 and tested at C/surface-renderer.component.spec.ts:228. Same-ID/same-kind path change survives: finding 2. |
| R5 layout/node import cycle | PASS | Node imports layout at C/surface-node.component.ts:33 and supplies child TemplateRef at :94–106. Layout imports NgTemplateOutlet, no node (C/surface-layout.component.ts:1–5,51). Recursive test/source assertion at C/surface-node.component.spec.ts:91–102 passes. |
| (f) Duplicate-ID @for tracking | PASS for view identity | Root :136, node display children :126, layout children :56 and submit actions :61 use index plus ID. Indices distinguish duplicates; changed IDs remount their positions. Root and nested duplicate rendering tests pass. This does not make ID-keyed draft state independent for duplicate input IDs; accepted-content uniqueness remains a separate contract. |
| R6 Apps scan non-vacuity | PASS for current tree | T:295–302 scans both roots and asserts nonzero source files. Re-run when page components land; current source presence cannot cover future components. |

### Exactly which resets are accepted?

Based on C/surface-renderer.component.ts:175–178:

| Parent action | Actual behavior |
| --- | --- |
| Snapshot replacement, fresh parent-created viewState | Accepted, assuming input object changes. |
| Snapshot replacement, previously emitted state object | Rejected even with a different renderable/surfaceId. |
| Reset to a fresh empty state object | Accepted. |
| Reset to an empty object emitted earlier (e.g. after commit) | Rejected after subsequent writes. |
| Reset to the same parent input reference while working state has advanced without feedback | No input change, so linkedSignal does not recompute. |
| Workspace A → B → A, restoring stored emitted states | A's old object is rejected and B's current working copy remains. |
| Same surface recreated in a retained renderer | No generation reset; saved emitted state can be rejected. |
| Renderer component itself destroyed and recreated | New WeakSet: previously stored objects are accepted on initial evaluation. |

## Five logic questions

### 1. How does this fail silently?

The WeakSet guard silently discards an authoritative parent reset, leaving success-looking fields from the previous context (C/surface-renderer.component.ts:178). The scan can report no forbidden sink after erasing executable code between string markers (T:274,300). Findings 1 and 3.

### 2. What user action produces unexpected behaviour?

Switch away and back using retained emitted state objects, or restore an emitted empty state: the displayed state does not match the parent (C/surface-renderer.component.ts:175). Submitting after an input path changes can commit the previous field's draft (C/surface-renderer.component.ts:255–259). Findings 1 and 2.

### 3. What input data produces a wrong answer?

A replacement text component with the same ID and kind but a different path preserves the old draft, because pruning compares only kind (C/surface-renderer.component.ts:277,282). The draft remains a valid string and therefore reaches inputCommit rather than an error (same file:257–259).

### 4. What happens when a dependency fails?

A builder throw or failed result gives an empty subtree and renderFailed (C/surface-renderer.component.ts:69–79,129,209); a host rejection arrives through issues and resets the local overlay when interaction changes (:181–193; test :174). There is no network dependency in these components. Arbitrarily malformed successful override trees are not recursively validated by attemptBuild (:74); accepted-content inputs and trusted overrides remain the scope assumption, not a new remote-input validator.

### 5. What is missing that the requirements never mentioned?

An explicit authoritative reset/generation protocol, and draft identity including the binding path. SurfaceViewState has only components and drafts (lib/surface-view-state.ts:24–26), so it cannot distinguish an old echo from an intentional restore on its own. C/surface-renderer.component.ts:175 and :275 implement heuristics without that distinction.

## Failure modes / numbered findings

### 1. Blocking — authoritative saved state is mistaken for a stale echo

- Trigger: Keep one renderer alive, emit/save state A, emit/save state B, then parent restores A. A and B can belong to different workspace slices or surfaces.
- Symptom: Parent says A while UI and subsequent commits retain B.
- Evidence: C/surface-renderer.component.ts:169,175–178,267–270. source tracks only viewState; emitted records every object for the entire component lifetime.
- Current handling: Any known emitted object is ignored. It does not test whether that object is chronologically older within the same document.
- Impact: Silent state mismatch and possible cross-workspace draft disclosure or wrong-context commit. The precise reuse condition is a retained renderer with restored emitted references; a fresh renderer is unaffected.
- Reproduction: Installed Angular signal/linkedSignal with the exact computation and publish ordering yielded parent drafts `{reason:"workspace A"}`, working drafts `{reason:"workspace B"}`.
- Fix: Add an explicit workspace/surface-incarnation/reset scope or version protocol. Accept authoritative state on scope/reset changes; reject only proven stale acknowledgments in the same generation. Do not infer authority from WeakSet membership alone.

### 2. Blocking — same-ID input rebinding carries a draft into a different field

- Trigger: User drafts text in `id=reason, path=form.old`; document replaces it with `id=reason, kind=text, path=form.new` while retaining presentation state.
- Symptom: Old text appears as the new field's draft. Clicking submit sends that old value for the currently bound component.
- Evidence: C/surface-renderer.component.ts:275–283 retains only kind metadata; :255–259 flushes the retained draft against the new node; :237–238 installs it at the new path. C/surface-text-input.component.ts:226 detects the path change for typed text, but :213–217 then falls back to the still-present draft record.
- Current handling: Missing IDs and kind changes are pruned; path changes are not. The parent read path also retains existing viewState (libs/frontend/mcp-apps-page/src/lib/state/apps-surface-reducer.ts:351–353).
- Impact: Data intended for one field can be written into another valid field without a validation error.
- Fix: Track binding identity (at least ID, kind and path, scoped to the surface incarnation). Prune a draft when that identity changes, before it can display or flush against the new binding. Preserve drafts for ordinary same-binding host updates.

### 3. Moderate — HTML comment stripping can hide live TypeScript sinks

- Trigger: Source contains `const start = '<!--'; element.innerHTML = agentText; const end = '-->';`.
- Symptom: The security scan returns no forbidden token.
- Evidence: T:274 applies a global HTML-comment regex after preserving string literals; T:299–302 trusts its result.
- Current handling: Executing the actual stripComments function on that sample produced `const start = '';`; /innerHTML/ returned false.
- Impact: Regression protection falsely passes a real executable sink. This is a test-gate defect, not evidence of an existing remotely exploitable sink in production source.
- Fix: Strip TypeScript comments with a TypeScript-aware scanner. Handle actual Angular/HTML template comments separately without deleting through TypeScript string boundaries; alternatively retain HTML comments conservatively. Add this exact regression and template/regex cases.

### 4. Moderate — “every v1 display text field” fixture misses list URL

- Trigger: A later change turns the list item's URL text into HTML or a link.
- Symptom: The claimed complete fixture can still pass because no list URL is rendered.
- Evidence: T:136 supplies only text/detail; T:152 asserts only those two. The separate URL interpolation exists at C/dashboard-list.component.ts:58.
- Current handling: Global zero-link assertion at T:65 only observes fields present in the fixture.
- Impact: Explicit Batch 8 “every v1 display text field” coverage is incomplete. Current URL rendering is interpolation; no present XSS is asserted.
- Fix: Add the hostile fixture in a list item's URL display branch (and a validated URL containing hostile-looking text if validation is included), assert its literal text and zero anchors/img/script.

### 5. Minor — trust spec retains an impossible action comparison

- Trigger: Semantic TypeScript checking of the spec.
- Symptom: TS2367: narrowed inert action union cannot equal surface.submit.
- Evidence: T:24 removes submit/select; T:182 compares against submit again. Scoped diagnostics reported this error.
- Current handling: Jest passes; isolatedModules is enabled in libs/frontend/declarative-dashboard/tsconfig.spec.json:9.
- Impact: A semantic-checking verification lane is not clean despite the runtime tests passing.
- Fix: Map the already filtered actions directly; remove the impossible branch and unnecessary cast where inference permits. Recheck scoped diagnostics.

## Blocking issues

Findings **1** and **2** above: both can silently carry incorrect data into the displayed/committed state. They must be fixed before approval.

## Serious issues

None established.

## Moderate and minor issues

Findings **3–4** are moderate security-test gaps; finding **5** is a minor semantic verification defect. These are not style-review duplicates.

## Data flow

1. Accepted content enters renderable and the injectable builder — OK for stated trust contract (C/surface-renderer.component.ts:150,160).
2. Builder failure becomes null and renderFailed — OK (:69–79,208).
3. Parent viewState enters working state — GAP: identity-based rejection crosses scope/reset boundaries (:175).
4. Node selects one of 13 fixed components and forwards events — OK (C/surface-node.component.ts:94–184).
5. Text/value bindings render producer fields literally — OK in the examined sinks and passing fixture (T:76–168); URL fixture missing.
6. DraftChange synchronously updates working state then emits — OK (C/surface-renderer.component.ts:220,267).
7. Replaced input nodes trigger pruning — GAP: path not tracked (:274).
8. Commit installs path overlay, emits inputCommit, then removes draft — ordering OK (:236; C/surface-text-input.component.ts:203).
9. Submit flushes valid drafts and emits action — ordering OK, but stale binding draft can pass (:252–264).
10. Parent interaction echo/rejection replaces renderer overlay — OK (:181–193); authoritative viewState resets remain subject to finding 1.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| 13 fixed node kinds; unknown-kind failure | COMPLETE | Node switch and failure test pass (C/surface-node.component.ts:135,249; spec:83). |
| Root builder token and fail-closed builder result | COMPLETE | C/surface-renderer.component.ts:39,69,129. |
| Literal rendering and complete trust regression gate | PARTIAL | Findings 3–4. |
| Inert unsupported actions | COMPLETE | T:206–223; layout filter at :106. |
| Synchronous drafts and overlay ordering | COMPLETE | Renderer :220,236; spec:131,159. |
| Commit rejection channel | COMPLETE | Node issues forwarding :112,143,152; renderer spec:174. |
| Remove swapped component drafts | PARTIAL | Finding 2. |
| Correct parent/workspace reset | PARTIAL | Finding 1. |
| R5 recursion / duplicate-ID view tracking | COMPLETE | MUST-CHECK evidence above. |
| Behavior-preserving diff verification | PARTIAL | Git forbidden by reviewer role; no baseline diff inspected. |

Implicit requirements not addressed: distinguishing authoritative reset from echo, surface incarnation identity, and ownership of a draft after its binding path changes.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty component tree | YES | Array accepted and loop empty (:74,136) | None found. |
| Builder throws/returns failed build | YES | Empty tree and event (:69,209) | Malformed successful override internals not covered. |
| Parent delays old echo | YES | WeakSet refuses reference (:178) | Also refuses legitimate restores. |
| Fresh empty parent state | YES | normalized incoming (:178,288) | Reused emitted empty reference is refused. |
| Workspace switch and switch back | NO | No scope key in guard (:176) | Finding 1. |
| Same-ID kind change | YES | Kind comparison (:282) | Verified existing spec:228. |
| Same-ID path change | NO | Path absent from pruning (:277) | Finding 2. |
| Duplicate IDs in rendered loops | YES | Index plus ID (:136; node:126; layout:56,61) | State identity still follows contract IDs. |
| Invalid/very long draft | YES | checkDraftValue skips commit (:257) | Existing spec:185. |
| Host rejection | YES | issues text, local overlay reset (:181; node:143) | Existing spec:174. |
| Sink inside marker-spanning TS source | NO | Global HTML comment removal (T:274) | Finding 3. |

## Exact fix list

1. Replace lifetime WeakSet authority inference with scope/reset-aware acknowledgment handling. Test A→B→A restoration, fresh/reused empty reset, snapshot replacement, same-surface recreation and delayed same-generation echo.
2. Include path and incarnation in draft ownership. Test old-path→new-path rebinding followed by blur, Enter and submit: no old draft may commit; unrelated drafts must survive.
3. Make source comment stripping language-aware, retaining sinks between HTML-comment string markers. Pin the reproduced bypass.
4. Render/assert the v1 list URL field in the trust fixture with zero anchors/img/script.
5. Remove the impossible submit comparison and clear the scoped semantic diagnostic.
6. Have an authorized coordinator perform the requested baseline diff check for helper extraction, type annotations and the two layout tracking edits; this review cannot certify that check.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for findings 1–3 and fixture omission; MEDIUM for full integration impact until the Apps page binds the renderer.
- Top risk: a retained renderer can show or submit a draft belonging to a different workspace or field.
- What a robust implementation would add: explicit reset authority, binding-aware draft invalidation, and a scanner regression that cannot hide live code behind string markers.

One-line summary: **NEEDS_REVISION — literal rendering passes the existing tests, but reset identity and path rebinding can misroute state, and the security scan is bypassable.**

