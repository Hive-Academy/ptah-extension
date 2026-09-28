# Code Logic Review — `TASK_2026_494` Batch 18 (Harness Prompt Isolation)

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 5/10                                 |
| Assessment          | NEEDS_REVISION                       |
| Blocking issues     | 0                                    |
| Serious issues      | 2                                    |
| Moderate issues     | 1                                    |
| Failure modes found | 2                                    |

## Scope examined

- `libs/frontend/harness-builder/src/lib/services/harness-workflow.service.ts` (diff only: `readonly surfaceId = this._surfaceId.asReadonly()` at line 152; `_surfaceId` field at line 127, typed `signal<SurfaceId | null>(null)`).
- `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:612-644` (`surfacePermissions`, `surfaceQuestions`).
- `libs/frontend/harness-builder/src/lib/components/harness-builder-view.prompt-isolation.spec.ts` (new, full file).
- `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.spec.ts` (existing, stubs at `makeWorkflowStub` line 190 and its two call sites at lines 234 and 665; assertions at 398-434).
- `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts` (full read of the routing-target API: `_promptTargetTabs`/`_questionTargetTabs` maps, `_routingTargetRevision` signal, `targetTabsFor`, `questionTargetTabsFor`, `hasSurfaceTargets`, `hasSurfaceQuestionTargets`).
- `libs/frontend/chat-routing/src/lib/stream-router.service.ts:383-472` (`routePermissionPrompt`, the caller of `attachPromptTargets`).
- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:63-82` and `libs/frontend/notification-center/src/lib/notification-center.store.ts:110` (the two existing consumers of the routing-target API, used as the "closest existing implementation" pattern).
- `libs/frontend/chat-state/src/lib/identity/ids.ts:123-125` (`SurfaceId` brand definition).
- Ran `npx nx run-many -t test -p @ptah-extension/harness-builder --skip-nx-cache` from the worktree root: all suites green (6 files, 128 tests).

## Five logic questions

### 1. How does this fail silently?

A legitimate harness prompt or question can be permanently hidden with no error, no console warning, and no visible failure — the UI simply never shows the card, and (per the comment at `permission-handler.service.ts:588-591`) the backend then blocks on `awaitQuestionResponse` until a 5-minute idle auto-pick. See Failure mode "Stale routing-target read" below; `harness-builder-view.component.ts:618-624` and `634-640` read `permissionHandler.targetTabsFor(...)`/`questionTargetTabsFor(...)` (backed by plain `Map`s) inside a `computed()` without reading `permissionHandler.routingTargetRevision()` first, so the computed only re-evaluates when `permissionRequests()`/`questionRequests()` (or `workflow.surfaceId()`) change identity — not when routing metadata is attached to an *existing* entry.

### 2. What user action produces unexpected behaviour?

Any harness session in which permission-prompt or question routing resolves the target surface *after* the item has already triggered one render pass (e.g. `StreamRouter.routePermissionPrompt` falling back to a later resolution — the method's own doc comment at `stream-router.service.ts:392-395` calls out "sessionId is unknown to the registry [yet]" as a real path) leaves the prompt/question invisible in the harness view for the rest of that computed's lifetime, or until an unrelated array-identity change (a new prompt/question arriving) forces a full re-filter that happens to pick up the now-correct target list.

### 3. What input data produces a wrong answer?

Not applicable to `!surfaceId` itself — `SurfaceId` is a branded `string` (`ids.ts:123`), so `!surfaceId` correctly covers both `null` and `''`. But see Q1/Q4: the wrong answer is produced by ordering, not by the input value of `surfaceId`.

### 4. What happens when a dependency fails?

`PermissionHandlerService`'s routing-target maps are not signals; the service publishes `routingTargetRevision` specifically so computed projections stay correct despite that (`permission-handler.service.ts:63-69`: "Consumers read this signal inside their computed projection before calling `targetTabsFor` / `questionTargetTabsFor`."). Two existing consumers honour the contract (`compact-session-card.component.ts:63-65`, `notification-center.store.ts:110`). The new `surfacePermissions`/`surfaceQuestions` do not, so when `StreamRouter` attaches targets on a delayed path, that write is invisible to the harness view's computed.

### 5. What is missing that the requirements never mentioned?

Neither the implementation plan (`implementation-plan.md:712-723`) nor the batch spec call out the `routingTargetRevision` contract, but it is a repository-established invariant for exactly this API (see Failure modes below) and this batch is the third consumer of `targetTabsFor`/`questionTargetTabsFor` to be added — it should have followed the same pattern as the other two.

## Failure modes

### Stale routing-target read (missing `routingTargetRevision` dependency)

- Trigger: `StreamRouter.routePermissionPrompt`/`routeQuestionPrompt` calls `attachPromptTargets`/`attachQuestionTargets` on the `PermissionHandlerService`'s `_promptTargetTabs`/`_questionTargetTabs` `Map`s (`permission-handler.service.ts:360-362`, `575-577`) in a call that happens after the prompt/question has already been added to `_permissionRequests`/`_questionRequests` and already triggered a render (e.g. the "registry didn't see the binding event yet" fallback path documented at `stream-router.service.ts:392-395`), or any later re-attachment of targets to an already-known id.
- Symptom: the harness view's `surfacePermissions`/`surfaceQuestions` computed does not re-run because its only tracked signal dependencies are `workflow.surfaceId()` and `permissionHandler.permissionRequests()`/`questionRequests()` — none of which change when the `Map` entries are mutated. A prompt/question that legitimately targets the harness surface stays invisible; for a question this means the agent blocks until the 5-minute idle auto-pick (per the precedent bug this exact API's doc comment describes, `permission-handler.service.ts:588-591`).
- Evidence: `harness-builder-view.component.ts:612-644` (no `routingTargetRevision()` read); contrast with `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:63-65` (`private readonly routingRevision = computed(() => this.permissionHandler.routingTargetRevision())`, then read inside `sessionQuestions`/`sessionPermissions`) and `libs/frontend/notification-center/src/lib/notification-center.store.ts:110`, both of which read the revision signal before calling the target accessors, matching the contract documented at `permission-handler.service.ts:63-66`.
- Current handling: none — the revision signal is never read by this component.
- Recommendation: add a private `computed(() => this.permissionHandler.routingTargetRevision())` (or read it directly as the first statement inside each of `surfacePermissions`/`surfaceQuestions`) so the computed re-evaluates whenever routing metadata changes, matching the pattern in `compact-session-card.component.ts` and `notification-center.store.ts`.
- Confirmed not caught by tests: `npx nx run-many -t test -p @ptah-extension/harness-builder --skip-nx-cache` is green, and the new spec's own test ordering (`attachPromptTargets`/`attachQuestionTargets` always called *before* the first `fixture.detectChanges()` in every test case, see `harness-builder-view.prompt-isolation.spec.ts:291-417`) never exercises "target attached after the item has already been rendered once," which is exactly the case that exposes the bug.

### Production shim retained past its stated purpose (confirmed)

- Trigger: `typeof this.workflow.surfaceId !== 'function'` branch in both `surfacePermissions` (`harness-builder-view.component.ts:613-618`) and `surfaceQuestions` (`:628-633`).
- Symptom: dead code path in production (the real `HarnessWorkflowService.surfaceId` is always a function per `harness-workflow.service.ts:152`), but the branch's fallback (`hasSurfaceTargets`/`hasSurfaceQuestionTargets`) is exactly the cross-surface-leak behaviour this batch exists to remove — its presence means a future refactor that accidentally breaks the `typeof` guard (e.g. a DI misconfiguration that yields `undefined` for `surfaceId`) silently reverts to leaky filtering instead of failing loudly.
- Evidence:
  - `harness-workflow.service.ts:152` — `surfaceId` is unconditionally a signal function in the real service; the `typeof !== 'function'` branch can never be hit through the real service.
  - `harness-builder-view.component.spec.ts:190-210` — `makeWorkflowStub()` (the file's single shared stub, used at both `harness-builder-view.component.spec.ts:234` and `:665`) has no `surfaceId` property at all, so every test using it takes the shim's fallback branch.
  - `harness-builder-view.component.spec.ts:398-409` — "includes a question targeted at a SURFACE id and renders its card" attaches `'surface-harness-1'` via `attachQuestionTargets` and asserts inclusion; this passes today only because the shim routes to `hasSurfaceQuestionTargets`, which is target-shape-based (non-tab id ⇒ included) and ignores `surfaceId` entirely. Confirmed by removing the shim mentally against this stub: `this.workflow.surfaceId` would be `undefined`, and `undefined()` throws — the spec would fail at runtime, not just assert wrong values.
  - `harness-builder-view.component.spec.ts:420-434` — the cross-wire guard test also depends on the fallback's target-shape check, not an actual `surfaceId` comparison.
- Current handling: the shim silently absorbs the gap so both the new spec and the pre-existing `TASK_2026_263` regression spec stay green without either spec's author having to touch the stub.
- Recommendation (confirms the team leader's assessment): remove the `typeof` branches from `harness-builder-view.component.ts` and update `makeWorkflowStub()` (`harness-builder-view.component.spec.ts:190-210`, both call sites at `:234` and `:665`) to add `surfaceId: signal('surface-harness-1' as SurfaceId).asReadonly()` (or equivalent). This requires re-verifying every existing assertion that depends on the fallback's *shape*-based predicate rather than a real `surfaceId` match — specifically:
  - `:398-409` ("includes a question targeted at a SURFACE id") — target `'surface-harness-1'` must equal the stub's new `surfaceId` value for the assertion to still hold under the real filter.
  - `:411-418` ("excludes a question targeted at a LIVE TAB id") — still passes under the real filter since `'tab-live' !== 'surface-harness-1'`, but for a different reason than before (previously "attached-map lookup found no result because `hasSurfaceQuestionTargets` never saw the id" is not what happens — verify this still holds).
  - `:420-434` (cross-wire guard, "targets attached on the PERMISSION map only") — still valid under the real filter (`questionTargetTabsFor` on a question id whose targets were attached via `attachPromptTargets` returns `[]`, so `.includes(surfaceId)` is `false`), but the two assertions `hasSurfaceTargets(...)` / `hasSurfaceQuestionTargets(...)` at `:430-431` are checking the *old* predicates that the production code no longer calls — they no longer pin production behaviour once the shim is removed, only the `PermissionHandlerService`'s own map isolation.
  - `:436+` ("excludes a question with no attached targets at all") — should be re-checked; `questionTargetTabsFor` returns `[]` for an unknown id, `.includes(surfaceId)` is `false`, so it still excludes, but confirm no other test in the file relies on the fallback's "no targets ⇒ not included" semantics diverging from the real filter's.
  - Any other `makeWorkflowStub()` callers not surfaced by this review's read window should be grepped before the shim is deleted, since the stub is shared.

## Blocking issues

None.

## Serious issues

### Missing `routingTargetRevision` dependency causes stale prompt/question visibility

- File: `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:612-644`
- Scenario: a permission prompt or question is dispatched to `PermissionHandlerService` and rendered once (empty target list, or no match against the current surface), then `StreamRouter` attaches or updates its target tabs afterward via a call that does not also change the `permissionRequests()`/`questionRequests()` array identity.
- Impact: the harness user never sees a prompt/question genuinely targeted at their surface; for questions this blocks the agent until the 5-minute idle auto-pick fires (documented consequence of this exact class of bug at `permission-handler.service.ts:588-591`).
- Fix: read `this.permissionHandler.routingTargetRevision()` as the first statement inside both computeds (or via a shared `computed()` dependency), following `compact-session-card.component.ts:63-65`.

### Production shim (`typeof this.workflow.surfaceId !== 'function'`) hides a real filter-correctness gap in the test suite

- File: `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:613-618, 628-633`
- Scenario: any regression in the real `surfaceId`-based filter (wrong id space, wrong signal wiring) would be masked in `harness-builder-view.component.spec.ts` because that file's shared stub takes the shim's fallback path, not the real filter path the new isolation spec exercises.
- Impact: the pre-existing `TASK_2026_263` regression spec no longer actually re-verifies the fix batch 18 claims to deliver — it verifies a different, soon-to-be-dead code path.
- Fix: as described above — add `surfaceId` to `makeWorkflowStub()`, delete the `typeof` branches, and re-validate every affected assertion.

## Moderate and minor issues

- `harness-builder-view.component.ts:613, 628` — `typeof this.workflow.surfaceId !== 'function'` is evaluated on every recomputation; harmless at runtime (constant-false in production) but is dead-code noise that a style reviewer should also flag for removal once the stub is fixed (noted here only because it's inseparable from the logic finding above; not double-counted against code-style-review.md).

## Data flow

1. `HarnessWorkflowService._surfaceId` set via `set(surfaceId)` at various lifecycle points (`harness-workflow.service.ts:283, 561`) or reset to `null` (`:350, 472`) — OK, type-safe (`SurfaceId | null`).
2. `readonly surfaceId = this._surfaceId.asReadonly()` exposes it — OK, minimal accessor addition, matches judgement 1 (nothing else in the service changed).
3. `HarnessBuilderViewComponent.surfacePermissions`/`surfaceQuestions` computed reads `workflow.surfaceId()` — OK when defined; gated by dead `typeof` shim — flagged above.
4. `!surfaceId` early-return for `null`/`''` — OK, correct for the branded-string type.
5. `permissionHandler.targetTabsFor(p.id)` / `questionTargetTabsFor(q.id)` read the `_promptTargetTabs`/`_questionTargetTabs` `Map`s — **gap**: read without first depending on `routingTargetRevision()`, so mutations to these maps that don't also change the requests array are invisible to the computed. See Serious issue above.
6. `.includes(surfaceId)` — OK; `targetTabsFor`/`questionTargetTabsFor` return `readonly string[]` populated by `StreamRouter` with either live `TabId`s or non-tab surface ids (harness/wizard/tribunal), and `HarnessWorkflowService._surfaceId` is typed `SurfaceId` — same string-keyed id space (`stream-router.service.ts:429-454` attaches `[claimed]`/`tabs`/`interactive`, all resolved surface/tab ids; `_surfaceId` is set from the same surface-id space per `harness-workflow.service.ts` call sites). No type mismatch found.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Expose `surfaceId` from `HarnessWorkflowService` | COMPLETE | None — single-field addition, verified via diff. |
| `surfacePermissions`/`surfaceQuestions` filter by `targetTabsFor`/`questionTargetTabsFor` against `surfaceId` instead of `hasSurfaceTargets`/`hasSurfaceQuestionTargets` | PARTIAL | Correct API and id space (judgement 4 confirmed), but missing `routingTargetRevision` reactivity means the new filter can go stale in exactly the scenario the old `hasSurfaceTargets` bug (`TASK_2026_263`) also involved. |
| "A prompt targeted at another surface id does not render" | COMPLETE (as tested) | New spec's own ordering (attach-before-first-render) does not exercise the stale-read path, so the property is proven only for the synchronous-attach case, not the general case. |
| Nothing beyond the two filters and the `surfaceId` accessor changed | COMPLETE | Diff confirmed limited to the three named hunks. |
| Existing `harness-builder-view.component.spec.ts` stays green without modification | COMPLETE (confirmed) but achieved via a shim that reintroduces the class of bug this batch fixes into the untested branch | See Serious issue #2. |

Implicit requirements not addressed: reactive correctness of the new filters under the `PermissionHandlerService`'s own documented consumer contract (`routingTargetRevision`); a production-shape-only implementation (no `typeof` escape hatch) that would force the existing spec's stub to be updated rather than silently bypassed.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| `surfaceId` is `null` | YES | `!surfaceId` early return | None. |
| `surfaceId` is `''` | YES | `!surfaceId` (branded string, falsy check) | None — `SurfaceId` values are never expected to be empty strings in practice, but the guard is correct either way. |
| Prompt targeted at another surface | YES (initial render) | `.includes(surfaceId)` false | Only proven for attach-before-first-render ordering; see stale-read finding. |
| Prompt's target attached after first render | NO | Computed doesn't re-run | Serious issue — silent, matches the precedent bug this API was built to prevent. |
| `surfaceId` transitions null → set → null again | YES (per new spec, `:385-417`) | Computed re-runs because `workflow.surfaceId()` is itself a signal dependency | None — this path is correctly reactive since `surfaceId` is a real tracked signal, unlike the `Map`-backed routing targets. |
| Mixed pool of own-surface and other-surface prompts | YES | New spec `:361-383` | None. |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: a harness permission prompt or question whose routing target is resolved after the item's first render (a documented, real path in `StreamRouter.routePermissionPrompt`) never appears in the harness view because the new computed signals don't depend on `PermissionHandlerService.routingTargetRevision()` — silently reproducing the class of bug (`TASK_2026_263`) this batch is meant to close for cross-surface leakage, just in the opposite direction (false negative instead of false positive).
- What a robust implementation would add: (1) read `routingTargetRevision()` inside both `surfacePermissions` and `surfaceQuestions` before calling `targetTabsFor`/`questionTargetTabsFor`, matching `compact-session-card.component.ts` and `notification-center.store.ts`; (2) remove the `typeof this.workflow.surfaceId !== 'function'` shim and instead give `makeWorkflowStub()` in `harness-builder-view.component.spec.ts` a real `surfaceId` signal, then re-verify the file's existing assertions (`:398-434`) still hold under the real filter, not the fallback's shape-based predicate; (3) add a regression test to the new spec that attaches routing targets *after* an initial `fixture.detectChanges()` has already rendered the item once, to actually pin the reactivity contract this batch depends on.

---

## Fix rounds 1-2 re-check

### Scope examined

- `git diff -- libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts` (final state).
- `harness-builder-view.component.spec.ts` — `makeWorkflowStub` (now parameterised, default `'surface-harness-1' as SurfaceId`, lines 191-214) and the `q-mixed` fixture (lines 448-466).
- `harness-builder-view.prompt-isolation.spec.ts` — full file, including the two new `describe` blocks: `does not render a permission/question prompt targeted at both the harness surface id and a live tab id` (lines 324-335, 372-383) and `delayed routing-target attachment (reactivity regression)` (lines 446-482).
- `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts` — re-read `hasSurfaceTargets` (lines 371-377) and `hasSurfaceQuestionTargets` (lines 594-600) to check what signals they read.
- `batch-18-fix-1-report.md`, `batch-18-fix-2-report.md` (both read in full).
- Ran `npx nx run-many -t test -p @ptah-extension/harness-builder --skip-nx-cache` from the worktree root: 6/6 suites green, 132/132 tests (matches fix-2 report's count).

### Final filter code (confirmed via diff)

```typescript
protected readonly surfacePermissions = computed(() => {
  this.permissionHandler.routingTargetRevision();
  const surfaceId = this.workflow.surfaceId();
  if (!surfaceId) return [];
  return this.permissionHandler
    .permissionRequests()
    .filter(
      (p) =>
        this.permissionHandler.hasSurfaceTargets(p.id) &&
        this.permissionHandler.targetTabsFor(p.id).includes(surfaceId),
    );
});
```
(`harness-builder-view.component.ts:612-625`; `surfaceQuestions` at `:627-641` is the structural twin using `hasSurfaceQuestionTargets`/`questionTargetTabsFor`.) No `typeof` branch remains anywhere in the file.

### Serious issue #1 (missing `routingTargetRevision`) — RESOLVED

Both computeds now read `this.permissionHandler.routingTargetRevision()` as their first statement, matching the pattern in `compact-session-card.component.ts:63-65` and `notification-center.store.ts:110`. This is proven, not just asserted: `harness-builder-view.prompt-isolation.spec.ts:447-463` and `:465-481` render the fixture once with the permission/question already in `permissionRequests()`/`questionRequests()` but with **no** routing target attached, assert zero cards, *then* call `attachPromptTargets`/`attachQuestionTargets` (which only bumps `routingTargetRevision` and mutates the `Map` — it does not touch the requests array), call `fixture.detectChanges()` again, and assert the card now renders. This is exactly the ordering the original review's spec gap identified as untested; it now is. Test run confirms both pass.

### Serious issue #2 (production shim) — RESOLVED

The `typeof this.workflow.surfaceId !== 'function'` branches are gone from both computeds (confirmed via `git diff`, no residual `typeof` anywhere in the file). `makeWorkflowStub` (`harness-builder-view.component.spec.ts:191-214`) now takes a `surfaceId: SurfaceId | null = 'surface-harness-1' as SurfaceId` parameter and always returns a real `surfaceId: signal(...).asReadonly()` — the component's real, unconditional filter path is what every test in the file now exercises, including the two call sites this review previously flagged (former lines 234 and 665; the second call site region still uses the same shared `makeWorkflowStub()` per the diff's file list). No dead branch remains for a future DI regression to silently fall back into.

### Existing-spec assertions — intent preserved, semantics upgraded correctly

Re-read every assertion the original review flagged as dependent on the fallback's shape-based predicate:

- `:398-409` ("includes a question targeted at a SURFACE id") — target `'surface-harness-1'` equals the stub's default `surfaceId`, so it now passes via the real `hasSurfaceQuestionTargets(...) && questionTargetTabsFor(...).includes(surfaceId)` predicate, not the old fallback. Same outcome, correct reason now.
- `:411-418` ("excludes a question targeted at a LIVE TAB id") — `'tab-live' !== 'surface-harness-1'`, so `.includes(surfaceId)` is false regardless of `hasSurfaceQuestionTargets`; still excluded, now for the real reason.
- `:420-434` (cross-wire guard) — `questionTargetTabsFor('q-crosswired')` is `[]` (targets were attached via `attachPromptTargets`, a different map), so `.includes(surfaceId)` is false; still excluded. The two direct `hasSurfaceTargets`/`hasSurfaceQuestionTargets` assertions at `:430-431` still document the map-isolation invariant `PermissionHandlerService` itself guarantees — they're not pinning dead code, they're pinning a still-relevant precondition the combined predicate depends on.
- `:440-446` ("no attached targets at all") — `questionTargetTabsFor` returns `[]` for an unrouted id; still excluded.
- `:448-466` ("keeps surface questions separate from tab questions in a mixed pool") — **this is the assertion the original review most wanted re-verified.** The `q-mixed` fixture (`['surface-harness-1', 'tab-live']`) was reportedly changed in fix round 1 and explicitly restored verbatim in fix round 2 (confirmed present at `:456-460` exactly as before). Under the new combined predicate, `q-mixed` is excluded via `hasSurfaceTargets`/`hasSurfaceQuestionTargets` returning `false` (it has a live-tab target), not via the surface-id match — this preserves the pre-existing "any live tab target ⇒ belongs to the tab" rule that a pure `targetTabsFor(...).includes(surfaceId)` filter (fix round 1's intermediate state) would have silently dropped. This is a real behavioural improvement over my original review's own recommendation, which named only the `routingTargetRevision` and shim fixes and did not anticipate this rule.
- `:468-479` ("drops the card once answered") — unaffected by either fix, still passes.

### New false-negative check requested by team-leader: stale/closed tab id in a target list

Traced `hasSurfaceTargets` (`permission-handler.service.ts:371-377`) and `hasSurfaceQuestionTargets` (`:594-600`): both call `this.tabManager.tabs().some(...)`, a direct signal read on `TabManagerService.tabs`. Because this call happens synchronously inside the `Array.prototype.filter` callback, which itself executes synchronously inside the outer `computed()` evaluation, Angular's dependency tracker (which tracks every signal read on the call stack during a computed's synchronous execution, regardless of call depth) registers `tabManager.tabs()` as a tracked dependency of `surfacePermissions`/`surfaceQuestions` — not just `routingTargetRevision()` and `workflow.surfaceId()`. Concretely: a prompt targeted at `[harnessSurfaceId, closedTabId]` where `closedTabId` was live at attach time but has since closed — when `tabManager.tabs()` updates to drop the closed tab, the computed re-evaluates (tracked dependency changed), `hasSurfaceTargets` now finds no live-tab match among the targets, returns `true`, and the harness view begins rendering the prompt it had previously suppressed. This is the *correct* behaviour (the tab that "owned" the prompt is gone, so the harness — the other listed target — should now claim it), not a false negative, and it is reactive rather than requiring an unrelated re-render to pick up. No new false negative found; if anything this is a case the combined predicate now handles better than a naive `targetTabsFor(...).includes(surfaceId)`-only filter would have (which was never tab-aware at all).

### Verification

`npx nx run-many -t test -p @ptah-extension/harness-builder --skip-nx-cache` — 6/6 suites, 132/132 tests green, run independently in this re-check (not just taken from the fix reports).

### Re-check verdict

| Metric              | Value |
| -------------------- | ----- |
| Overall score        | 9/10  |
| Assessment            | APPROVED |
| Blocking issues (new) | 0 |
| Serious issues (new)  | 0 |
| Moderate issues (new) | 0 |

- Recommendation: APPROVE
- Confidence: HIGH
- Both serious findings from the original review are resolved with direct code evidence and a regression test each; the combined `hasSurfaceTargets/hasSurfaceQuestionTargets && targetTabsFor/questionTargetTabsFor` predicate introduces no new false negative and, per the traced signal-tracking behaviour, correctly stays reactive to tab-close events as well as routing-target attachment. The `q-mixed` fixture restoration confirms the live-tab-precedence rule survived the refactor. Score is 9/10 rather than 10/10 only because the delayed-attach regression tests cover the permission/question arrival path but not a delayed *re-attachment* on an id that already had different targets (a narrower variant of the same mechanism); this is a minor coverage note, not a defect — the underlying reactivity mechanism (`routingTargetRevision` as a tracked dependency) is generic and already proven to work for the tested case.
