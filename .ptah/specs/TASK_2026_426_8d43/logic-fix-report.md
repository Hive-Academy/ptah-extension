# Logic fix — `TASK_2026_426_8d43`, finding 1 (Serious): cross-clone body write

## Verdict

Fixed at the root cause, with a regression test that is red without the fix and
green with it. No backend, RPC-contract or out-of-library file was touched.

## What the defect actually was

Confirmed by reading the three cited sites before changing anything:

- `skill-clones-state.service.ts:105-119` — `loadDetail` set `selectedSlug` /
  `selectedKind` synchronously but left the PREVIOUS entry's `detail` in place
  for the whole round trip.
- `skill-clones-view.component.ts:446-449` — `canEditSelectedBody` reads
  `detailBody()`, which is `detail()?.body`. During the window above that is
  clone A's body while `selected()` is already clone B.
- `clone-detail-drawer.component.ts:264-275` — the Edit affordance is gated on
  `canEditBody() && !editing()` only, unlike the read-only render at `:293-299`
  which does consult `detailLoading()`.

So the Edit button appeared, labelled `Edit the body of beta`, seeded from
alpha's text. The review's own recommendation (add `&& !detailLoading()` to the
view's computed) treats the symptom: the stale `detail` would still be there,
readable by anything else, and it does not cover the second route to the same
state — two loads in flight landing out of order, after which `detailLoading` is
already `false` and the held detail belongs to the loser.

## The fix — one file, `skill-clones-state.service.ts`

`loadDetail` now keys the held detail to the entry it was fetched for
(`private detailKey: string | null`, a plain field: nothing renders it):

1. Selecting a DIFFERENT entry clears `detail` **before** the await. Between the
   click and the reply `body` is `null`, which the existing eligibility rule
   `canEditCloneBody(clone, body)` already refuses, and `detailLoading` is what
   the drawer renders instead ("Loading body…" / "Loading history…").
2. A reply is applied only while it is still the selected entry's key; a late
   reply is dropped and does not clear another request's `detailLoading`.
3. A repeat load of the SAME entry — the post-save reload that R3.4 depends on —
   does not clear, so nothing blanks on refresh.
4. `clearDetail()` resets the key and `detailLoading`, so closing the drawer
   mid-load cannot leave a stuck spinner behind now that the orphaned reply no
   longer clears it.

No new eligibility rule was introduced, so `clone-action-gating.ts` is untouched
and `canEditCloneBody` keeps its single condition — it is now simply never fed a
foreign body. The view component and the drawer are unchanged; the drawer's
metrics come from its `clone` input (the fresh selection), so clearing `detail`
does not blank them, which was the review's stated objection to this route.

## Regression evidence

Three new tests, all red before / green after.

Sequence test (the real one, against the REAL `SkillClonesStateService` with a
deferred `getClone`) — `skill-clones-view.component.spec.ts`, describe
`cross-clone edit during the detail load`: open alpha, resolve its body, assert
Edit present; open beta; assert Edit absent and the loading line shown; click the
(absent) affordance and assert no textarea was seeded; resolve beta and assert
Edit returns seeded with `# beta body`.

Unit tests — `skill-clones-state.service.spec.ts`: detail dropped on switching
entries; a late reply ignored after the selection moved on; the same-entry
reload keeps the visible detail.

Before the fix (`loadDetail` reverted in place, everything else identical):

```
● SkillClonesViewComponent — body save › cross-clone edit during the detail load › withholds Edit until the SELECTED entry’s own body has landed
  Received: <button aria-label="Edit the body of beta" ... data-testid="drawer-body-edit-btn"> Edit </button>
● SkillClonesStateService › drops the held detail the moment a DIFFERENT entry is selected
  Received: {"body": "# a", "clone": { ... "slug": "alpha" ...}}
● SkillClonesStateService › ignores a reply that lands after the selection moved on
  Expected: "# b"   Received: "# a"

Test Suites: 2 failed, 24 passed, 26 total
Tests:       3 failed, 400 passed, 403 total
```

The first failure is the defect itself: an Edit affordance for `beta` while
alpha's body is what the editor would seed from.

After the fix:

```
npx nx run-many -t test -p @ptah-extension/skill-synthesis-ui --skip-nx-cache
Running target test for project @ptah-extension/skill-synthesis-ui:   (1 project)
Test Suites: 26 passed, 26 total
Tests:       403 passed, 403 total
```

## Other verification

- `npx nx run-many -t typecheck -p @ptah-extension/skill-synthesis-ui` — success.
- `npx nx run-many -t lint -p @ptah-extension/skill-synthesis-ui` — success,
  0 errors, 1 warning. The warning is pre-existing and in a file this fix does
  not touch: `skill-synthesis-tab.component.ts` `max-lines` (1175 > 700).

## Files

- MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/services/skill-clones-state.service.ts`
- MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/services/skill-clones-state.service.spec.ts`
- MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.spec.ts`

No commit was created. Batch 5's files (`libs/backend/agent-generation/**`,
`clone-bulk-rebase.service.spec.ts`) were not touched.

## Still open from the review (not in this scope)

Finding 2 (R3.8 for a sidecar-less clone) and the three Moderate items — the
empty-draft message, the dirty-draft re-seed, and `canEditCloneBody` ignoring
its `clone` argument for orphaned entries — are untouched here.
