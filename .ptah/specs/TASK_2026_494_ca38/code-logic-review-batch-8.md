# Code Logic Review — Batch 8 (`TASK_2026_494`), Round 1

## Summary

| Metric              | Value                                |
| -------------------- | ------------------------------------- |
| Overall score        | 5/10                                   |
| Assessment            | NEEDS_REVISION                        |
| Blocking issues       | 1                                      |
| Serious issues        | 0                                      |
| Moderate issues       | 2                                      |
| Failure modes found   | 3                                      |

Scope: `surface-node.component.ts` (+spec), `surface-renderer.component.ts` (+spec), `trust-boundary.spec.ts`,
`surface-input-messages.ts` (+spec), `src/index.ts` (MODIFY). Behaviour-preserving diffs (helper extraction in the
three input components, TS4029 annotations, the two-line `@for` tracking fix in `surface-layout.component.ts`) were
diff-checked only, confirmed equivalent to the pre-batch logic, and are not deep-reviewed below.

Verification re-run in this review: `npx nx run @ptah-extension/declarative-dashboard:test --skip-nx-cache` → 16
suites / 163 tests green (matches `batch-8-report.md`). `ptah_get_diagnostics` on the four MUST-CHECK files surfaced
one TS error the batch's own `typecheck` target cannot see (Moderate issue 2 below).

## Must-check table

| # | Item | Finding | Evidence |
| - | ---- | ------- | -------- |
| 1 | Renderer ignores an "older" parent view state — can this drop a legitimate reset? | **Yes, in the multi-surface case.** The guard is pure object-reference identity against every object this *one component instance* ever emitted, with no scoping to the currently active surface and no expiry. See Blocking issue below. | `surface-renderer.component.ts:169,175-179,267-271`; corroborated by `apps-surface-reducer.ts:336-354` (per-surface `viewState` kept by reference across reconciliation) and `batch-8-report.md` "Notes for B15" ("Store the object emitted by `(viewStateChange)` as-is") |
| 2 | (a) `draftChange` written synchronously; overlay before discard | Confirmed correct by trace and spec. | `surface-renderer.component.ts:220-228` (writeDraft → publish, synchronous); `:236-240` (commit installs overlay); `surface-text-input.component.ts:203-204` (inputCommit emitted, then draftChange(undefined) — overlay-then-discard order holds); spec `surface-renderer.component.spec.ts:159-172` |
| 3 | (d) throwing builder vs default `renderFailed` — identical output/emission | Confirmed identical. Both paths converge in `attemptBuild`'s `catch`, `renderFailed` is `output<void>()` so no payload can differ. | `surface-renderer.component.ts:69-79,158,208-210`; spec `surface-renderer.component.spec.ts:103-122` (asserts identical `innerHTML` and identical failure counts for both paths) |
| 4 | (g) node swap removes old id's draft; (f) `@for` duplicate-id tracking | Confirmed correct. `pruneDrafts` compares kind-per-id across renders and only removes drafts for ids that disappeared or changed kind; failed builds are skipped so a failure never erases drafts. All four `@for` loops (renderer root, node v1 children, layout children, layout submit actions) track `$index + ':' + id`. | `surface-renderer.component.ts:211-216,274-285`; `surface-node.component.ts:126`; `surface-layout.component.ts:56,61` (diff); specs `surface-renderer.component.spec.ts:228-241`, `surface-node.component.spec.ts:105-119` |
| 5 | R5 no import cycle; `@switch` covers all 13 kinds; `@default` emits `renderFailed`; only `surface.submit`/`dashboard.select` are controls | Confirmed. `SurfaceLayoutComponent` imports only `NgTemplateOutlet`; the node passes itself as a template, not an `imports` entry. All 13 kinds in `SURFACE_NODE_KINDS` have a `@case`; `@default` is empty and the `unknownKind` effect emits. Trust-boundary action-inertness tests confirm no other action id renders a control. | `surface-node.component.ts:61-65,78-91,135-185,245,249-251`; `surface-node.component.spec.ts:73-89,91-103`; `trust-boundary.spec.ts:172-224` |
| 6 | R8 trust boundary — every pinned field literal, zero `img`/`script`, scan not trivially bypassable | Field coverage and zero-element assertions confirmed comprehensive (v1 + v2, all listed fields). The source scan **is bypassable** by a token split across string literals or bracket-notation property access (e.g. `el['inner'+'HTML']`), which the regex-based, comment-stripped scan cannot see. This is an inherent limitation of a literal-token scan, not a defect unique to this implementation, but it does not meet "not trivially bypassable" literally. See Moderate issue 1. | `trust-boundary.spec.ts:75-170` (field coverage), `:278` (`FORBIDDEN` regex list), `:241-275` (`stripComments`) |

## Five logic questions

### 1. How does this fail silently?

- **Cross-surface state bleed on tab switch** (see Blocking issue). No error, no `renderFailed`, no console output — the
  renderer just keeps showing the previous surface's drafts/component-presentation state under the newly active
  surface's node tree. `surface-renderer.component.ts:175-179`.
- A custom `SURFACE_VIEW_MODEL_BUILDER` that returns `{ renderFailed: false, viewModel: { components: [null] } }` (or
  any array of non-object/malformed entries) passes `attemptBuild`'s shape check (`Array.isArray` only,
  `surface-renderer.component.ts:74`) and is NOT reported as `renderFailed`. The failure only surfaces later, as an
  uncaught `TypeError` when `SurfaceNodeComponent` evaluates `node().kind` in the `@switch` (`surface-node.component.ts:135`).
  This is an internal-only seam (the token is only settable by trusted app code, not host/producer input), so it is
  Moderate rather than Blocking, but it is still a silent-then-crash path the "throwing builder ≡ renderFailed" pin
  does not actually cover (a non-throwing, malformed builder is not caught the same way a throwing one is).

### 2. What user action produces unexpected behaviour?

Switching the surface switcher (a tab a user already visited) back to that surface, after visiting at least one other
surface in between, in a persistent-renderer layout (see Blocking issue). The user sees stale drafts/expansion state
from whichever surface was last active, not the surface they switched back to.

### 3. What input data produces a wrong answer?

A custom view-model builder whose result passes the outer shape check but contains a malformed node (see silent-failure
item above) produces an uncaught exception instead of the documented `renderFailed` + empty subtree. Under the default
`buildSurfaceViewModel` (the only builder reachable from producer/host content) this cannot happen, because that
builder only ever emits catalog-shaped nodes from validated content — so this is a gap in the override seam, not in
the trust boundary itself.

### 4. What happens when a dependency fails?

- `SURFACE_VIEW_MODEL_BUILDER` throwing: handled identically to a `renderFailed` result (must-check 3, confirmed).
- `checkDraftValue` (imported from `@ptah-extension/shared/mcp-apps-contracts/surface`) is called directly on the raw
  view-model node inside the submit-flush loop (`surface-renderer.component.ts:257`), without the "sanitized options"
  treatment the choice input applies to itself via `checkedNode` (`surface-choice-input.component.ts:117`, comment:
  "so `checkDraftValue` cannot throw"). If a node reaches `invoke()` with malformed `options` (only reachable through
  a non-default builder, per the point above), `checkDraftValue` could throw inside the submit handler, which is not
  try-wrapped. Low likelihood (same override-only reachability as the item above), noted for completeness.

### 5. What is missing that the requirements never mentioned?

The plan and the batch's own quality requirements never state that the renderer's stale-echo guard (added specifically
to protect the B7 F2 "stale typed text" guard) must also be safe for **one renderer instance rendering more than one
surface over its lifetime** — which is exactly the shape B15's own guidance points the Apps page toward ("Notes for
B15": bind `[interaction]` to `computed(() => ops.interaction(id))`, implying one persistent renderer keyed by the
active surface id, not one renderer per surface). The B8 carry-over brief for (a) only asked for protection against "a
parent that applies writes late," which is the single-surface, same-renderable case the existing spec at
`surface-renderer.component.spec.ts:145` covers. It does not ask for, and the implementation does not provide, scoping
of the emitted-object memory to the surface it was emitted for.

## Failure modes

### Cross-surface stale-state after a tab switch-back (WeakSet identity guard is not surface-scoped)

- Trigger: one `SurfaceRendererComponent` instance renders surface A, the user edits it (renderer emits at least one
  `viewStateChange` object, call it `X1`), the app stores `X1` as surface A's persisted `viewState` (exactly what
  `apps-surface-reducer.ts:353` does per surface entry, and exactly what the batch's own "Notes for B15" instructs:
  "Store the object emitted by `(viewStateChange)` as-is"). The user switches to surface B (a new, distinct
  `viewState` object — passes through correctly). The user switches back to surface A; the parent re-binds
  `[viewState]` to the same `X1` reference it stored earlier.
- Symptom: because `X1` is a member of `this.emitted` (populated by every `publish()` this component instance has ever
  performed, for any surface), the `linkedSignal` computation at `surface-renderer.component.ts:176-178` treats `X1`
  as "a late echo of an object I emitted," not as "the parent legitimately restoring surface A's own state," and keeps
  `previous.value` — which is still surface B's working copy. The user sees surface A's node tree rendered with
  surface B's drafts/component presentation state (expansion, sort, filter, chart-as-table, etc.), silently and with
  no `renderFailed` or error.
- Evidence: `surface-renderer.component.ts:168-179` (the `emitted` WeakSet and the `state` `linkedSignal`, both scoped
  to the whole component instance, not to `surfaceId()`/`renderable()`); `:267-271` (`publish` adds every emission to
  `emitted` unconditionally); no read of `renderable()`/`surfaceId()` anywhere in the `state` linkedSignal's
  `computation`. Corroborated by the reducer's per-surface, reference-preserving `viewState` storage
  (`apps-surface-reducer.ts:336-354`) and by the batch's own B15 guidance to store emitted objects verbatim
  (`batch-8-report.md`, "Notes for B15"). The existing spec at `surface-renderer.component.spec.ts:145-157` only
  exercises the single-surface, same-`renderable` case (feeds back `host.emitted[0]` without ever changing
  `renderable`), so it cannot catch this.
- Current handling: none. The guard is unconditionally keyed on object identity for the lifetime of the component
  instance.
- Recommendation: scope the "ignore my own stale echo" protection to the currently active surface — e.g., key
  `emitted` (or a per-surface epoch counter) by `surfaceId()`/`renderable()` identity and clear/rotate it whenever
  `renderable()` changes to a different surface, or drop the WeakSet approach in favour of a monotonic write-counter
  carried on the emitted `SurfaceViewState` itself (increment-on-publish, compare-on-receive) so "older" is a real,
  surface-scoped ordering rather than a global "have I ever seen this reference" test. Add a spec that renders surface
  A, edits it, switches `renderable` to surface B, then switches `renderable` back to A while re-binding A's
  previously-emitted `viewState` object, and asserts A's own state (not B's) is shown.

### Malformed (non-default) view-model builder result crashes instead of failing gracefully

- Trigger: an app-level override of `SURFACE_VIEW_MODEL_BUILDER` (only reachable via Angular DI, never via
  producer/host content) returns `{ renderFailed: false, viewModel: { components: [<non-node value>] } }`.
- Symptom: `attemptBuild` accepts it (only checks `Array.isArray(viewModel.components)`,
  `surface-renderer.component.ts:74`); rendering proceeds into `SurfaceNodeComponent`, which throws when it evaluates
  `node().kind` in the template `@switch` (`surface-node.component.ts:135`) or in the `layoutNode`/`textNode`/etc.
  computeds (`:203-234`). This is an uncaught exception inside a signal-driven template, not the documented
  `renderFailed` + empty subtree.
- Evidence: `surface-renderer.component.ts:69-79` (shape check stops at the outer object/array level).
- Current handling: none beyond the outer shape check.
- Recommendation: either validate that every entry of `viewModel.components` is a plain object with a string `kind` in
  `attemptBuild` (cheap, same place the existing shape check lives), or document explicitly that
  `SURFACE_VIEW_MODEL_BUILDER` overrides are a trusted-code seam with no defensive contract (if that is the intended
  design, say so next to the `SurfaceViewModelBuilder` type, since the current doc comment only promises "an override
  that throws... is treated exactly like a renderFailed build" — which reads as covering malformed-but-non-throwing
  results too).

### Submit flush can call `checkDraftValue` on an unsanitized node

- Trigger: same override-only reachability as above; a node reaches `invoke()`'s flush loop with malformed
  `options`/shape that `checkDraftValue` cannot handle.
- Symptom: an uncaught exception from inside the submit button's click handler, versus the choice input's own
  self-protection via `checkedNode` (`surface-choice-input.component.ts:117`).
- Evidence: `surface-renderer.component.ts:257` calls `checkDraftValue(node, draft)` directly, without the
  "well-formed options" massaging the choice input applies to itself.
- Current handling: none; not try-wrapped.
- Recommendation: low priority given the same trusted-seam reachability as the previous item; if the malformed-builder
  gap above is fixed at the `attemptBuild` boundary, this one is fixed for free.

## Blocking issues

### Renderer's stale-echo guard is not scoped to the active surface

- File: `surface-renderer.component.ts:168-179`, `:267-271`
- Scenario: one persistent `SurfaceRendererComponent` renders more than one surface over its lifetime (the shape the
  batch's own "Notes for B15" guidance points toward), and the app stores/restores each surface's `viewState` by the
  exact object reference the renderer emitted (also directed by "Notes for B15"). Switching the active surface away
  and back reintroduces an object reference this same component instance previously emitted for the surface being
  switched back to.
- Impact: the user silently sees the wrong surface's presentation state (drafts, expansion, sort/filter, chart
  toggle) attached to the surface they switched to, with no error signal. This is exactly the class of defect the task
  brief's MUST-CHECK 1 asks to rule out ("workspace switch to another slice's view state," "same surface re-created");
  it is not ruled out — it is reachable under the architecture the batch itself documents as the intended consumption
  pattern for B15.
- Fix: see "Failure modes" above — scope the identity guard (or replace it with a real ordering signal) to the
  surface it was emitted for, and add a switch-back regression spec before B15 wires a persistent renderer across
  surfaces.

## Serious issues

None found. (The two builder/override gaps above are Moderate: they require a trusted-code, non-default DI override
to reach, not producer/host-controlled input, and the codebase's default builder cannot produce the malformed shapes
that trigger them.)

## Moderate and minor issues

1. **Trust-boundary source scan is bypassable by construction, not by this batch's oversight** — `trust-boundary.spec.ts:278`'s
   `FORBIDDEN` regex list (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `bypassSecurityTrust`, `DomSanitizer`,
   `<iframe`) matches literal source tokens only. A token split across concatenated string literals or accessed via
   computed bracket notation (`el['inner' + 'HTML']`) defeats it. This is an inherent property of any regex/text-based
   scan (not something a "smarter" comment-stripper fixes), and the batch's own claim is appropriately scoped
   ("comment-stripped source scan," never "cannot be bypassed"); the MUST-CHECK phrasing asks for "not trivially
   bypassable," and a same-file, no-tooling string-split does count as trivial. Recommend documenting this as an
   accepted, inherent limitation of the R8 gate (defense-in-depth against accidental sinks and obvious markup
   injection, not a proof of absence) rather than leaving it implicit.
2. **`trust-boundary.spec.ts:181` has a real, invisible TS2367 error** — `ptah_get_diagnostics` reports "This
   comparison appears to be unintentional because the types … and '\"surface.submit\"' have no overlap" for
   `action === 'surface.submit'` inside the `v1Actions` `flatMap`. `INERT_ACTIONS` (`:24`) is built with
   `SURFACE_ACTIONS.filter(action => action !== 'surface.submit' && action !== 'dashboard.select')`; under this
   TypeScript configuration `.filter()`'s inferred predicate already excludes both literals from `action`'s type at
   `:181`, making the ternary's true branch (`[]`) permanently dead code. This is invisible to the batch's own
   verification: `project.json`'s `typecheck` target only checks `tsconfig.lib.json` (`libs/frontend/declarative-dashboard/project.json:20-25`),
   which — per the standard Angular-lib convention this repo follows — excludes `*.spec.ts`, and `tsconfig.spec.json`
   sets `isolatedModules: true` (`libs/frontend/declarative-dashboard/tsconfig.spec.json:9`), so ts-jest performs no
   full type-check on spec files either. Functionally harmless (the dead branch never executes, and the test's
   behaviour is unaffected), but it is exactly the "a passing check that does not exercise the new behaviour is not
   evidence for that behaviour" case the review brief calls out: 0-errors-reported is true for the commands run, not
   true for the file. Fix: drop the now-redundant `action === 'surface.submit' ? [] : ...` guard in `v1Actions`
   (`trust-boundary.spec.ts:182-184`), since `INERT_ACTIONS` already excludes it.
3. Minor: `pruneDrafts`'s effect (`surface-renderer.component.ts:211-216`) writes to a signal (`state`, via `publish`)
   that the same effect also reads, causing one extra no-op re-run per prune (self-terminating, not a loop — confirmed
   by the spec at `:228` passing without warnings). Not worth a structural change, noted only for anyone touching this
   code next.

## Data flow

1. `renderable` input changes → `attempt` computed rebuilds via `SURFACE_VIEW_MODEL_BUILDER` inside `attemptBuild`,
   catching throws and rejecting malformed outer shapes → OK, except the inner-node shape gap noted above (Moderate).
2. `viewModel()` null → constructor effect emits `renderFailed` once per new failing `attempt` object → OK, confirmed
   by spec (`surface-renderer.component.spec.ts:103-122`).
3. `viewState` input changes → `state` linkedSignal recomputes: echoes of self-emitted objects are dropped, everything
   else replaces the working copy → **gap**: "self-emitted" is not scoped to the currently active surface (Blocking
   issue).
4. Keystroke → text input's `draftChange` → renderer's `writeDraft` writes into `state` synchronously and publishes
   (`emitted.add`, `state.set`, `viewStateChange.emit`) → OK, confirmed synchronous by spec (`:131-143`).
5. Blur/Enter/debounce → text input's `commitDraft` emits `inputCommit` then `draftChange(undefined)` → renderer's
   `commit()` installs the local overlay before forwarding `inputCommit`, so the overlay is in place before the
   subsequent `draftChange(undefined)` discards the draft → OK, confirmed by spec (`:159-172`).
6. Host answers via a new `interaction` object → `localOverlays` linkedSignal resets to empty (tracks `interaction()`
   and `renderable()`) → `effectiveInteraction` falls back to the host's own `pendingValues`/`issues` → a rejection
   shows as an issue, not a silent revert → OK, confirmed by spec (`:174-183`).
7. Submit invoked → `invoke()` flushes every valid, changed draft (commit, then discard) before emitting
   `actionInvoke` → OK for the default builder's well-formed nodes; **gap** for a malformed-node input to
   `checkDraftValue` under a non-default builder (Moderate finding above).
8. View model rebuilds (any renderable/kinds change) → `pruneDrafts` effect removes drafts for ids that vanished or
   changed kind, skips pruning entirely while the current build has failed → OK, confirmed by spec (`:228-241`).

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| `@switch` over all 13 kinds, `@default` renders nothing + `renderFailed` | COMPLETE | none |
| `SURFACE_VIEW_MODEL_BUILDER` root token, default pure builder | COMPLETE | none |
| Builder throw → empty subtree + `renderFailed`, same as default `renderFailed` | COMPLETE | none for the throwing case; a non-throwing malformed result is not equally hardened (Moderate) |
| Only `surface.submit`/`dashboard.select` are controls | COMPLETE | none |
| No `innerHTML`/`bypassSecurityTrust`/`DomSanitizer`/`<iframe`/markdown import | COMPLETE (scan passes) | scan is regex-based and trivially bypassable by a determined author (Moderate, inherent) |
| R5 no import cycle (layout never imports node) | COMPLETE | none |
| (a) synchronous draft write; overlay before discard | COMPLETE | none |
| (b) shared label/error/issue helper, three inputs rewired | COMPLETE | none (behaviour-preserving, diff-confirmed) |
| (c) host-rejection channel, no silent revert | COMPLETE | none (accepted deviation: reuses `interaction.issues`) |
| (d) throwing override ≡ default `renderFailed` | COMPLETE | none |
| (e) TS4029 fixes | COMPLETE | none (diff-confirmed behaviour-preserving) |
| (f) `@for` duplicate-id tracking | COMPLETE | none |
| (g) swapped node's draft removed | COMPLETE | none |
| R6 scan is not vacuous | COMPLETE (nine non-spec Apps files exist at B8; will be re-run at B15) | deferred to B15 as planned |
| R8 literal rendering of every pinned field, zero `img`/`script` | COMPLETE | none |
| Renderer state correctness across a persistent, multi-surface lifetime | **MISSING** | not a stated acceptance criterion anywhere in the B8 brief, but it is the shape B15's own guidance steers toward, and it is what MUST-CHECK 1 in this review's brief specifically asked to rule out |

Implicit requirements not addressed: safety of the stale-echo/self-emitted-object guard when one renderer instance
serves more than one surface over its lifetime (see Blocking issue).

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Parent never feeds `viewStateChange` back | YES | working copy still updates synchronously, drafts still typeable | none |
| Late echo of an older self-emitted object, same surface, same renderable | YES | WeakSet identity skip | none (this is the case the guard was designed for) |
| A genuinely new object from the parent (any shape, any surface) | YES | replaces working copy unconditionally | none |
| **Switch away and back to a surface whose stored `viewState` is a previously self-emitted reference** | **NO** | WeakSet identity skip fires incorrectly | Blocking issue above |
| Component destroyed and re-created for the same surface | YES | fresh component instance ⇒ fresh empty `emitted` WeakSet, no false-positive | none |
| Duplicate ids at the same level, or an id whose position swaps to a new id/kind | YES | `$index + ':' + id` tracking, `pruneDrafts` kind comparison | none |
| Builder throws | YES | caught in `attemptBuild`, `renderFailed` emitted | none |
| Builder returns a non-object or `components` that is not an array | YES | rejected by the outer shape check | none |
| Builder returns `components` containing a malformed/non-object node | NO | passes the outer shape check, crashes later in `SurfaceNodeComponent` | Moderate finding above |
| Host rejects a commit via `interaction.issues` | YES | shown as an issue, local overlay cleared by the new `interaction` object | none |
| Submit with one invalid and one valid draft | YES | valid one flushed and committed, invalid one stays with its error, never committed | none |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: the renderer's own "ignore a stale self-echo" protection (built to defend the B7 F2 guard) is scoped to
  "any object this component instance ever emitted," not to "the surface currently being shown." Combined with the
  batch's own guidance to store and rebind emitted `viewState` objects verbatim per surface, and the reducer's
  confirmed per-surface, reference-preserving state (`apps-surface-reducer.ts:353`), a user switching the Apps
  surface switcher back to a previously visited surface can silently see another surface's drafts/presentation state
  rendered under the wrong surface's document.
- What a robust implementation would add: scope the stale-echo guard to the active surface (per-surface epoch/token,
  or a real monotonic write counter instead of raw object identity) plus a regression spec for the switch-away-and-back
  case; harden `attemptBuild`'s shape check to reject malformed individual nodes, not just a malformed outer container;
  drop the now-dead `action === 'surface.submit'` branch in `trust-boundary.spec.ts`'s `v1Actions` and confirm with a
  scoped `tsc --noEmit` against `tsconfig.spec.json` (not just `tsconfig.lib.json`) that spec files carry no type
  errors going forward.

## Carry-overs

- **To B9** (`budget-render.spec.ts`): when counting `(renderFailed)` emissions at budget limits, be aware the
  constructor effect emits once per new failing `attempt` object (`surface-renderer.component.ts:160-162,208-210`);
  a re-render of the same failing renderable does not re-emit. This is already documented in `batch-8-report.md`'s
  "Notes for B9" and is unaffected by the findings above.
- **To B15**: before wiring one persistent `<ptah-surface-renderer>` across a multi-surface switcher (the shape
  implied by "Notes for B15"'s `computed(() => ops.interaction(id))` guidance), either fix the Blocking issue above
  in `declarative-dashboard`, or — if B15 cannot wait — do NOT store/rebind the exact `(viewStateChange)`-emitted
  object across a surface switch; clone it (`{ ...state }`) before writing it back into the per-surface store, which
  defeats the WeakSet match at the cost of losing the F2 late-echo protection for that one round trip (a worse but
  known-safe trade-off) until the guard is fixed here. Also carry: the malformed-builder crash gap matters directly
  to B15's Req 3.6 mono-fallback spec only if B15's own override could ever return a non-throwing malformed result
  (a throwing override, which is what the plan actually asks for at plan:740, is already fully covered).

## One-line summary

Batch 8's node/renderer/trust-boundary work is thorough and its own carry-over items (a, d, f, g) are correctly and
verifiably implemented, but the renderer's stale-echo guard is scoped to "ever emitted by this instance" rather than
"emitted for this surface," which — combined with the batch's own B15 guidance to persist and rebind emitted
`viewState` objects per surface — can silently show one surface's state under another surface's document on a tab
switch-back; that gap, plus a real-but-invisible TS error in the new trust-boundary spec and a trivially-bypassable
(inherently so) source scan, drive the NEEDS_REVISION verdict.
