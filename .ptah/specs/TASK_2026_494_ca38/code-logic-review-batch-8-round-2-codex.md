# Code Logic Review — `TASK_2026_494_ca38`, Batch 8, Round 2

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 1 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 1 |

The five numbered findings from my first review are resolved in their specific implementations. However, accepting restored state exposes a second object-identity guard in the text input: an already-consumed draft can be restored and displayed, but silently refused on blur or Enter. This reproduced correctness defect prevents approval. The working restore/path-change fixes and passing security regressions distinguish 6/10 from the previous 5/10; the remaining silent commit failure prevents the sound 7–8 band.

Paths below are relative to the worktree. **C** = `libs/frontend/declarative-dashboard/src/lib/components/`; **T** = `libs/frontend/declarative-dashboard/src/lib/trust-boundary.spec.ts`.

## Scope and verification

Read the renderer, node, text input, their complete specs, and trust-boundary spec; traced relevant layout and display consumers. Read both round-one reviews, the fix report, context, Batch 8 requirements/rulings, relevant requirements and implementation-plan sections, and the existing style review (Batch 2; no overlapping finding). Helper extraction and TS4029 equivalence are accepted from the coordinator's prior check, not re-reviewed.

- Scoped `ptah_get_diagnostics`: **0 errors, 0 warnings**.
- `npx tsc -p libs/frontend/declarative-dashboard/tsconfig.spec.json --noEmit`: **exit 0**, no output.
- Focused Jest run, `--runInBand --runTestsByPath`, on renderer, node, text-input and trust-boundary specs: **4 suites, 92 tests passed**.
- Additional targeted Jest probe: **1 failed, 38 skipped**, reproducing F1 below against the actual renderer and input. The probe was injected into Jest's in-memory source read; no source/spec file was edited. An initial probe had an invalid section fixture and failed before exercising the case; correcting it to preserve the valid existing `form()` yielded the behavioral failure reported below.
- `ptah_search_files` found no AGENTS.md. No direct file-read or Write tool was listed; native reads and the native patch writer were used.
- The reviewer role prohibits all Git operations, so no `git diff`/`git status` ran. Exact historical assertion-diff equivalence is **not certified**. The current assertions were checked against the old assertions quoted in the round-one review/fix report. This verification limitation is not the reason for NEEDS_REVISION.

## Prior-findings rulings

| Prior item | Ruling | Current evidence and effect |
| --- | --- | --- |
| My #1: renderer refuses authoritative saved states | RESOLVED at renderer boundary | C/surface-renderer.component.ts:226,232 accepts parent objects and re-adopts on surface-ID change. Specs at :183,205,215,231,246,259,282 prove the requested restores. F1 below is a separate remaining input-level guard. |
| My #2: same ID/kind with a different path retains old draft | RESOLVED | Renderer :133 includes kind and path; :293 remembers draft bindings; :347 prunes mismatches; :323 also excludes them during submit. Specs :306,317,324 cover blur/debounce, Enter and submit with unrelated drafts preserved; :330 preserves same-binding edits. |
| My #3: HTML-comment marker bypass | RESOLVED | T:259 uses the TypeScript parser/printer; T:312 pins the exact marker-spanning sample. T:313 also covers regex/comment ambiguity. |
| My #4: missing list URL fixture | RESOLVED | T:164 renders markup and `javascript:alert(1)` URLs; :170 asserts literal text, :171 zero anchors, :172 no attribute containing the script URL, :174 inert DOM. Production URL interpolation is C/dashboard-list.component.ts:58. |
| My #5: TS2367 | RESOLVED | T:197 maps the already-filtered actions directly. Scoped diagnostics and spec tsc are clean. |
| My requested historical helper/TS4029/layout diff check | RESOLVED by coordinator evidence | batches.md:436 records the team-leader's equivalence check. Accepted as directed; no redundant re-review. |
| Other review: malformed builder node / malformed choice options during flush | RESOLVED for the identified cases | Renderer :83 validates node identity, required input fields, options and recursive children; :109 catches build/validation exceptions. Renderer spec :135 covers twelve malformed cases and :158 a working override. |
| Other review: split-string scan bypass | RESOLVED with stated scope | T:270,277 joins common split literals; :315–320 pin bypass regressions. T:284 explicitly documents computed-name limits and the independent DOM backstop at :65. |
| Other review: extra prune-effect pass | Accepted, unchanged | Renderer :268 reads state and :344 may write it. Removing stale keys leaves the next pass with nothing to remove; bindings are carried at :374. Coordinator acceptance is batches.md:467. No unbounded loop established. |
| Earlier B15 clone workaround | Superseded | Renderer :161–169 documents synchronous verbatim parent feedback; the lifetime WeakSet is removed. No replacement echo heuristic is requested. |

## Must-check table

| Check | Result | Evidence |
| --- | --- | --- |
| Legitimate snapshot, empty reset, workspace, recreation, mounted switch-away/back render | PASS for requested cases | Renderer spec :205,215,231,246,259 asserts rendered values and/or object identity. Same-reference surface switch is also pinned at :282. |
| Same ID/kind with changed path drops draft and never commits it | PASS | Renderer spec :306–327 asserts the stale value is absent, unrelated value remains, and exact commit sequences exclude the stale value. |
| Restored `a` displays and commits `a`, not typed `ab` | PASS for reported case; PARTIAL for general restores | Text input :226 re-keys typed text; text spec :334 and renderer spec :183 assert displayed and committed `a`. F1 covers a previously consumed restored object, absent from those cases. |
| B7 F1/F2 and commit before parent round trip | PASS for existing cases | Text spec :253,269 pins no duplicates; :282–331 pins stale-text removal/unrelated writes. Node spec :147–157 commits immediately after input without a render round trip; renderer spec :169 pins a non-feeding parent. All passed. |
| Scan hardening and runtime DOM backstop | PASS within documented limits | T:65,259,270,284,311,329. Both source roots contain files; fixtures assert literal text and no active elements/handlers. |
| List URL trust fixture | PASS | T:164–174. |
| Malformed builder nodes fail closed | PASS for identified malformed shapes | Renderer :83,109,266; spec :131–167. Empty subtree plus exactly one `renderFailed`; text fallback itself belongs to the consuming page, outside this batch. |
| TS2367 and spec tsc | PASS | T:197; executed tsc exit 0. No project.json change required. |
| Two changed assertions otherwise retain strength | PARTIAL verification | Renderer spec :188–195 now checks state identity, draft, display, commit and parent-created replacement. T:303–308 still checks removal of actual comments and preservation of strings/templates/regex, while retaining HTML-comment lookalikes. Consistent with quoted old assertions; exact Git comparison unavailable under role instructions. |
| Fix-round regression hunt | FAIL | F1: restored state is now admitted by renderer :232 but the consumed-reference guard at text input :212 refuses its commit. |

## Five logic questions

### 1. How does this fail silently?

Restoring a previously committed draft object displays its string but `currentDraft()` returns undefined because it still matches `consumed.drafts` (C/surface-text-input.component.ts:212). `commitDraft()` then returns without a commit, removal, or error (:194). See F1.

### 2. What user action produces unexpected behaviour?

Commit `a`, receive a newer host value, restore the saved pre-commit state, then blur or press Enter. The field shows `a`, but the host receives no new value. Both controls call the same gate (text input :82,166,170,191).

### 3. What input data produces a wrong answer?

The exact saved drafts record last consumed by this still-mounted text input, after an intervening empty drafts record and host-value update. No invalid data or delayed echo is required. Renderer :232 now correctly accepts that object; text input :198,212 mistakes it for the still-unacknowledged original commit.

### 4. What happens when a dependency fails?

Throwing/failed builders and the tested malformed tree shapes return null and emit `renderFailed` (renderer :109,266; spec :103,131). Host rejection remains visible through issues and resets local overlays (renderer :240; spec :355). There is no network call in this renderer. These checks do not certify every possible hostile DI override or the future page's fallback UI.

### 5. What is missing that the requirements never mentioned?

Consumed-draft acknowledgement must expire when a new drafts record is observed. The input's own comment promises this lifetime (text input :113–115), but there is no clearing path: :117 initializes it, :198 replaces it, and :212 can still recognize an arbitrarily old restored record. The renderer's accepted restoration contract makes that distinction necessary.

## Failure modes

### F1 — Blocking: a restored, previously consumed draft silently refuses to commit

- Trigger: Keep renderer/input mounted. Type `a`, save the emitted state reference, blur to commit, let the parent feed back the empty drafts record, receive a valid new snapshot with host value `new host` at the same binding, then restore the saved state and blur.
- Symptom: Display changes from `new host` to `a`; the second blur sends nothing. The host stays at `new host` while the field continues showing a valid restored draft, with no indication that the requested commit was ignored.
- Evidence: C/surface-text-input.component.ts:198 records the consumed drafts reference; :212 unconditionally rejects it later. The reconciliation effect at :127 only reconciles `typed`; :228 returns immediately when typed is null. Display at :131 still uses the restored draft. C/surface-renderer.component.ts:232 admits the restore and :240 clears overlays on the new host snapshot.
- Current handling: The deduplication guard has no expiry on an intervening drafts record, node update or host value. It outlives the round trip it is intended to protect. Submit's separate flush loop (renderer :320) does not use this guard, so the defect is specifically the input's own commit paths.
- Recommendation: Retire the consumed marker once a different drafts record is observed, while retaining it for Enter/blur/debounce before that acknowledgement. Account for binding/context changes as appropriate. Add the reproduction below while keeping the existing F1/F2 tests intact.

Executed reproduction, injected only into the existing renderer suite's in-memory source:

```typescript
const { host, text, type, blur, commits, rerender } = setup();
type('a');
const checkpoint = host.viewState();
blur();
host.renderable.set({
  ...form(), dataModel: { form: { reason: 'new host' } },
} as SurfaceRenderable);
rerender();
expect(host.failures).toBe(0);               // passed
expect(text().value).toBe('new host');        // passed
host.viewState.set(checkpoint);
rerender();
expect(text().value).toBe('a');               // passed
blur();
expect(commits()).toEqual([
  { componentId: 'reason', value: 'a' },
  { componentId: 'reason', value: 'a' },
]);                                         // failed: only the first entry exists
```

## Blocking issues

### Restored draft is suppressed by stale consumed identity

- File: C/surface-text-input.component.ts:212.
- Scenario: F1 above; legitimate snapshot update and authoritative state restoration, synchronous parent feedback throughout.
- Impact: Silent failure to commit the displayed valid value. The old renderer guard concealed this path by refusing the restore altogether; fixing admission without expiring the input guard leaves restore behavior incomplete.
- Fix: Bound consumed-marker lifetime to the pending input round trip and add the regression above. Do not reinstate the renderer echo guard.

## Serious issues

None established.

## Moderate and minor issues

No new issue assigned. The assertion-diff limitation is disclosed under verification, and the no-op prune pass is accepted by the coordinator.

## Data flow

1. Accepted content → builder → shape validation: OK for reviewed cases (renderer :109).
2. Failed attempt → empty subtree and failure output: OK (:186,266).
3. Parent view state → working state: OK; authoritative restoration now works (:226,232).
4. Draft write → remembered binding → synchronous state and output: OK (:277,336).
5. Changed binding → prune / submit exclusion: OK (:323,347).
6. Restored draft → displayed input: OK (text input :131).
7. Blur/Enter → typed reconciliation → consumed guard: GAP; old consumed references remain effective (:209,212).
8. Allowed commit → overlay → emitted commit → draft removal: OK for commits admitted by that gate (renderer :303; text input :199).
9. Producer text → interpolation/property binding → inert DOM assertions: OK in exercised paths (T:65,76,164).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Authoritative parent state renders across requested lifecycle cases | COMPLETE | Renderer spec :205–287 passes. |
| Restored displayed value can commit through normal input actions | PARTIAL | F1, text input :212. |
| Draft binding includes path; unrelated drafts survive | COMPLETE | Renderer :133,347; spec :306–336. |
| Synchronous writes, overlay-before-discard, host rejection issues | COMPLETE | Renderer spec :169,340,355. |
| Builder failure and tested malformed nodes report failure | COMPLETE | Renderer spec :103,131. |
| Trust scan and literal URL fixture | COMPLETE | T:164,259,311,329. |
| Semantic spec type-check clean | COMPLETE | Executed tsc exit 0; T:197. |

Implicit requirement not addressed: consumed-draft acknowledgement expires after its round trip (text input :113–117,212).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Restore uncommitted older draft | YES | Renderer spec :183; text spec :334 | None found in tested sequence. |
| Restore previously consumed draft after new host state | NO | Text input :212 suppresses it | F1. |
| Empty reset / workspace / mounted surface switch-back | YES | Renderer spec :215,231,259 | Parent must follow synchronous feedback contract. |
| Binding path changes before blur/Enter/submit | YES | Renderer spec :306,317,324 | No stale commit in tested paths. |
| Immediate commit before parent render round trip | YES | Node spec :147–157 | Preserve during F1 repair. |
| Repeated Enter/blur/debounce | YES | Text spec :253,269 | Preserve during F1 repair. |
| Builder null/unknown/nested malformed/cyclic nodes | YES | Renderer spec :135 | Tested shapes, not exhaustive arbitrary executable overrides. |
| Split sink names / HTML-comment markers | YES | T:311 | Computed-name limitation documented at :284. |

## Verdict

- Recommendation: REVISE.
- Confidence: HIGH for F1, reproduced through the actual Angular renderer/input with a conforming parent.
- Top risk: a restored field can display valid data while silently declining the user's commit.
- What a robust implementation would add: expire the consumed marker after acknowledgement; retain the no-double-commit tests; pin the previously-consumed restore sequence.

One-line summary: **6/10 NEEDS_REVISION — the original fixes pass 92 focused tests and spec tsc, but a reproduced stale consumed-draft guard still suppresses a legitimate restored value's commit.**
