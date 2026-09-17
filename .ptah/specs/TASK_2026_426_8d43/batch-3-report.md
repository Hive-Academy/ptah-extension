# Batch 3 report — Skills-UI primitives

Project: `@ptah-extension/skill-synthesis-ui` (only). Tasks 3.1–3.4 complete.

## Files

### Task 3.1 — bulk eligibility + editor predicate

- MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-action-gating.ts`
  — added `eligibleForBulkRebase(clones, kind)`, `canEditCloneBody(clone, body)`
  and `BULK_REBASE_EXPLANATION`.
  `eligibleForBulkRebase` filters on `kind` match AND `diverged` AND
  `orphaned !== true` AND the existing `hasUpstreamSource(c)`. `orphaned` is
  compared against `true` explicitly, so `orphaned: undefined` is INCLUDED.
  `BULK_REBASE_EXPLANATION` is `REBASE_EXPLANATION + …` — the canonical rebase
  sentence is composed, not restated.
- MODIFIED `.../clones/clone-action-gating.spec.ts` — 14 new cases across three
  new describes, including the `orphaned: undefined` trap, `orphaned: false`,
  `orphaned: true` excluded, authored/synth excluded, non-diverged excluded,
  other-kind excluded, empty list, a mixed-list ordering case, and the
  composition assertion on `BULK_REBASE_EXPLANATION`.

### Task 3.2 — batch runner

- CREATED `libs/frontend/skill-synthesis-ui/src/lib/services/clone-bulk-rebase.service.ts`
  — `CloneBulkRebaseService`, `@Injectable()` with NO `providedIn` (provided by
  the view; the eslint rule is disabled for one line with a written reason,
  following the `CoursePlayerStore` precedent). Signals `running`, `progress`,
  `outcomes`, plus a `failedSlugs` computed for the caller's summary toast.
  `run()` iterates the supplied set SEQUENTIALLY over the existing
  `SkillSynthesisRpcService.rebaseClone` — no `Promise.all`, no second rebase
  implementation. Each iteration is individually try/caught in `rebaseOne`; a
  thrown transport error and a `failed: true` result both become
  `{ ok: false, reason }` naming the slug and the loop continues. `running`
  clears in a `finally`.
- CREATED `.../services/clone-bulk-rebase.service.spec.ts` — 8 cases, including
  the 3-clone batch where clone 2 throws and clone 3 soft-fails (all three
  attempted, three outcomes, both slugs named), a peak-concurrency assertion
  proving sequential execution, `running` clearing on the failure path, and
  progress reporting.

### Task 3.3 — body editor

- CREATED `.../clones/clone-body-editor.component.ts` — `ptah-clone-body-editor`,
  standalone, OnPush, signals, `input()`/`output()`. The editor is a
  `<textarea>` bound through `FormsModule`; there is no `[innerHTML]` anywhere.
  `value` seeds a `linkedSignal` draft; `saving` disables Save and Cancel; the
  textarea carries a visible `<label for>` naming the clone; focus moves into
  the textarea in `ngAfterViewInit`.
- CREATED `.../clones/clone-body-editor.component.spec.ts` — 9 cases: seeding,
  markup-as-text, Save emits the edited draft, Cancel emits the bare intent and
  no draft, both disabled while saving, label association, Save-before-Cancel
  DOM order, focus on render.

### Task 3.4 — drawer edit mode

- MODIFIED `.../clones/clone-detail-drawer.component.ts` — declared
  `CloneBodySaveRequest { clone, body }` beside the existing output types
  (Concern 4). Added `canEditBody` / `bodySaving` inputs and a `bodySaved`
  output. Edit mode REPLACES the `ptah-markdown-block` render rather than
  hiding it beside a second copy. `editing` is a `linkedSignal` off `clone`, so
  switching entries drops a half-finished draft. Cancel emits nothing and hands
  focus back to the Edit button via `afterNextRender`. The drawer stays strictly
  presentational — no injected service beyond `Injector`.
- CREATED `.../clones/clone-detail-drawer.component.spec.ts` (Concern 5 — the
  file did not exist) — 10 cases: Edit affordance absent when `canEditBody()` is
  false, present as a real `<button>` with an `aria-label` when true, disabled
  while `busy()`, markdown block ABSENT in edit mode, editor seeded from the
  body, `bodySaved` carries clone + edited text, Cancel emits nothing and
  restores the read-only render, a failed save keeps edit mode and the draft, a
  successful save leaves edit mode, and a clone switch drops edit mode.

### Batch-owned barrel

- MODIFIED `libs/frontend/skill-synthesis-ui/src/index.ts` — added
  `BULK_REBASE_EXPLANATION`, `canEditCloneBody`, `eligibleForBulkRebase`,
  `CloneBodyEditorComponent`, `CloneBulkRebaseService`, and the types
  `CloneBodySaveRequest`, `BulkRebaseOutcome`, `BulkRebaseProgress`. This is the
  only batch that touches this file.

## Deviation

One, forced by the repository's own lint gate: the editor's cancel output is
named `cancelled`, not `cancel`. `@angular-eslint/no-output-native` is an ERROR
in this lib and rejects an output shadowing a standard DOM event; `cancelled` is
the spelling four other components in the repository already use. The reason is
recorded in the component's docblock. Behaviour is unchanged — it still carries
no payload.

## Verification

Commands run from the worktree root, in order. Each was scoped to this batch's
one project, and no `npx nx reset` was run.

```
npx nx run-many -t typecheck -p @ptah-extension/skill-synthesis-ui --skip-nx-cache
  → Successfully ran target typecheck for project @ptah-extension/skill-synthesis-ui

npx nx run-many -t lint -p @ptah-extension/skill-synthesis-ui --skip-nx-cache
  → Successfully ran target lint for project @ptah-extension/skill-synthesis-ui
    1 problem (0 errors, 1 warning)
    warning: skill-synthesis-tab.component.ts 733:1 — File has too many lines
    (1161). Maximum allowed is 700 [max-lines]
    PRE-EXISTING and untouched by this batch: that file is batch 4's.

npx nx run-many -t test -p @ptah-extension/skill-synthesis-ui --skip-nx-cache
  → Running target test for project @ptah-extension/skill-synthesis-ui
    (single-project form; N = 1, the number of names passed)
    Test Suites: 26 passed, 26 total
    Tests:       380 passed, 380 total
    → Successfully ran target test for project @ptah-extension/skill-synthesis-ui
```

Batch verification checklist:

- All created files contain real implementations, no stubs, no `TODO`.
- `skill-clones-state.service.spec.ts` still green (inside the 26 passing
  suites); `SkillClonesStateService.divergedCount` was not touched.
- `git status --porcelain` for this batch shows only:
  `src/index.ts`, `clones/clone-action-gating.{ts,spec.ts}`,
  `clones/clone-detail-drawer.component.ts` (modified) and the five created
  files. `skill-clones-view.component.ts` and `skill-synthesis-tab.component.ts`
  are UNTOUCHED, and no `project.json` appears.
- No file under `libs/backend/**`, `libs/shared/**`, `libs/frontend/core/**` or
  `libs/frontend/marketplace/**` was edited by this batch.
- No git commit was created.

## Notes for batch 4

- `CloneBulkRebaseService` must be listed in `SkillClonesViewComponent`'s own
  `providers`, not registered in root.
- The drawer binding for cancel is `(cancelled)`, not `(cancel)` — see the
  deviation above. The drawer already wires that internally; batch 4 binds
  `[canEditBody]`, `[bodySaving]` and `(bodySaved)` only.
- The drawer leaves edit mode when the reloaded `body` input equals the text
  that was saved, so batch 4's `state.loadDetail(...)` after a successful save
  is what closes the editor. A failed save must leave `body` unchanged.
