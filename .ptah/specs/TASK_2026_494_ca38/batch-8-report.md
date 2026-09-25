# Batch 8 report — Task 8.1: node, renderer, public API, trust boundary

Executor: frontend-developer. Worktree: `D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772`.
All paths below are under `libs/frontend/declarative-dashboard/src/`. No git state was changed.

## Files

| Change | File | Lines |
| --- | --- | --- |
| CREATE | `lib/components/surface-node.component.ts` | 261 |
| CREATE | `lib/components/surface-node.component.spec.ts` | 164 |
| CREATE | `lib/components/surface-renderer.component.ts` | 298 |
| CREATE | `lib/components/surface-renderer.component.spec.ts` | 272 |
| CREATE | `lib/trust-boundary.spec.ts` | 310 |
| CREATE | `lib/components/surface-input-messages.ts` (carry-over b) | 76 |
| CREATE | `lib/components/surface-input-messages.spec.ts` (carry-over b) | 66 |
| MODIFY | `index.ts` (public API) | 32 |
| MODIFY | `lib/components/surface-text-input.component.ts` (b) | 234 |
| MODIFY | `lib/components/surface-choice-input.component.ts` (b) | 159 |
| MODIFY | `lib/components/surface-checkbox-input.component.ts` (b) | 91 |
| MODIFY | `lib/components/dashboard-list.component.ts` (e) | 130 |
| MODIFY | `lib/components/dashboard-stat.component.ts` (e) | 63 |
| MODIFY | `lib/components/dashboard-table.component.ts` (e) | 158 |
| MODIFY | `lib/components/surface-layout.component.ts` (f, see deviation 2) | 144 |

Every non-spec file is at most 298 lines. No existing spec file was changed (`git diff --stat` lists only the
non-spec files above).

## Task 8.1 quality requirements

- `@switch` over all 13 kinds: `surface-node.component.ts:135-185`, one `@case` per kind. `SURFACE_NODE_KINDS`
  (`:61`) lists them. Pinned by "switches over all 13 catalog kinds, each to its own component"
  (`surface-node.component.spec.ts:73`), which checks that the set equals the 13 kinds and that each kind renders
  its own component.
- `@default` renders nothing and emits `renderFailed`: `surface-node.component.ts:184` (empty block); the effect at
  `:247-251` emits. The node forwards child failures at `:100`, and the renderer forwards them at
  `surface-renderer.component.ts:141`. Pinned by "renders nothing for an unknown kind and emits renderFailed"
  (`surface-node.component.spec.ts:83`).
- `SURFACE_VIEW_MODEL_BUILDER` root token that defaults to the pure builder: `surface-renderer.component.ts:39-42`
  (`providedIn: 'root'`, `factory: () => buildSurfaceViewModel`). Pinned by the
  `TestBed.inject(...) === buildSurfaceViewModel` assertion (`surface-renderer.component.spec.ts:84`).
- A builder that throws gives an empty subtree and `renderFailed`: `attemptBuild` (`surface-renderer.component.ts:69-79`)
  catches and returns `null`. The template renders only inside `@if (viewModel(); as model)` (`:129`). The effect at
  `:208-210` emits once per build attempt. `attempt` is a new object per renderable, so a new failing renderable is
  reported again, and a plain re-render is not.
- Only `surface.submit` and `dashboard.select` are controls. Submit comes from the layout (B6, unchanged). Select comes
  from the display components (B4/B5, only when `selectable`). The trust-boundary spec pins that no other action id
  becomes a control (see R8 below).
- No `innerHTML`, `bypassSecurityTrust`, `DomSanitizer`, `<iframe` or `@ptah-extension/markdown`: every new template
  uses interpolation or property/attribute binding. The source scan below pins this.
- Import boundary (the renderer is `type:ui`): the new files import only `@angular/core`, `@angular/common`,
  `@ptah-extension/shared` and `@ptah-extension/shared/mcp-apps-contracts/surface`, plus relative lib files.
  `lint` (with module-boundary rules) passes with 0 errors.
- OnPush on both new components. There are no timers; the only timer in the lib is still the text input's debounce.

## Carry-overs

### (a) Draft writes are synchronous; overlay before discard; renderer-level specs

- `writeDraft` (`surface-renderer.component.ts:220-228`) writes the working copy `state` (`:175-179`, a
  `linkedSignal` over the `viewState` input) inside the same call, then emits `viewStateChange` (`publish`, `:267-271`).
  Nothing is batched or queued. Inputs read `state().drafts` (`:138`), so the next `drafts` object always holds the
  last write, whether the parent feeds the state back or not.
- Extra hardening: the renderer records every object it emitted in a `WeakSet` (`:169`, `:268`). A late echo of an
  OLDER emitted object does not replace the working copy (`:175-179`), so a parent that applies writes late cannot
  roll a newer draft back and trip the B7 F2 guard. A view state the parent made itself still replaces the copy.
- Overlay before discard: `commit` (`:236-240`) installs a renderer-local overlay (`localOverlays`, `:181-185`) for
  the input's path, then forwards `inputCommit`. The text input then emits the draft removal (B7 order: commit, then
  removal). `effectiveInteraction` (`:186-193`) layers the local overlays over `interaction.pendingValues`. The local
  overlays reset when the parent passes a new `interaction` or `renderable`, and the parent's answer takes over.
- Specs (`surface-renderer.component.spec.ts`):
  - `:131` "writes every draft into its working copy synchronously, even when the parent never feeds it back": the
    state is checked before any change detection runs;
  - `:145` "ignores a late echo of an older emitted view state, so a newer draft is not rolled back";
  - `:159` "installs the pending overlay before the committed draft is discarded": at the moment `inputCommit` is
    emitted, the draft is still present and the overlay already holds the value. Afterwards the value stays shown
    with no parent overlay;
  - `:185` draft error propagation: a host-read error shows; an over-length draft shows its error, is never
    committed and stays in view state;
  - `:203` submit flushing: `inputCommit` comes before `actionInvoke`, the invalid draft stays, and the debounce never
    commits again. `:218`: a draft equal to the committed value is discarded without a commit.
  - The submit flush lives in `invoke` (`:252-265`).

### (b) Shared label/error/issue helper

- `lib/components/surface-input-messages.ts` holds:
  - `plainText`, `committedInputValue`, `displayedInputValue` (Rule 4 order) and `inputErrorText` (host-read error,
    then `checkDraftValue`, with an optional validation node for the choice input's sanitized options);
  - `issueTextsOf`, `issueIdOf`, `describedByOf`;
  - the shared empty `NO_DRAFTS`, `NO_PENDING_VALUES` and `NO_ISSUES`.
- Rewired: text `surface-text-input.component.ts:17-28` (imports) and the `displayedValue`, `baseline`, `issueTexts`,
  `errorText`, `describedBy` and `issueId` members; choice `:18-28`; checkbox `:13-23`. The duplicated private
  copies were deleted. The three existing specs pass unchanged (334 + 252 + 130 lines, 0 edits).
- Spec: `surface-input-messages.spec.ts`, 6 tests.

### (c) Host rejection channel — no silent revert

- The channel is the renderer's existing `interaction` input, through `interaction.issues`
  (`ReadonlyMap<componentId, string[]>`). It flows renderer → node (`surface-node.component.ts:143,152,112`) →
  input `issues` → `issueTextsOf` → issue text with `aria-invalid="true"` and `aria-describedby`.
- When the parent passes the new `interaction` without the overlay, the renderer drops its local overlay, so the input
  shows the host value AND the rejection text.
- Why no second input: the Apps lib already routes change rejections into exactly this map. See
  `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-lanes.ts:594-601` (`setIssue(surfaceId, op.componentId,
  message)`) and `apps-surface-operations.service.ts:417-430,160`. A dedicated rejection input would give the same
  text two sources of truth.
- Spec: "surfaces a host rejection of a commit as the input issue, not a silent revert"
  (`surface-renderer.component.spec.ts:174`). Also "shows a checkbox commit at once through the local overlay until
  the parent answers" (`:263`).

### (d) Throwing override and default `renderFailed` behave the same

- Both paths go through `attemptBuild`, which returns `null` (`surface-renderer.component.ts:69-79`). A result that is
  not `{ renderFailed: false, viewModel: {components: []} }` also returns `null`.
- `renderFailed` is `output<void>()` (`:158`), so the two emissions cannot differ.
- Spec `:103`: the same `innerHTML` for the renderer element, zero children, one emission each, a second emission for
  a second failing renderable, and none for a re-render. Spec `:124` covers a malformed builder result.

### (e) TS4029

- `dashboard-list.component.ts:82`, `dashboard-stat.component.ts:43` and `dashboard-table.component.ts:96` now declare
  `public readonly node: InputSignal<XNode> = input.required<XNode>()`, with `type InputSignal` imported. The behaviour
  is unchanged.
- The new node component needed the same treatment for `statNode`, `tableNode` and `listNode`
  (`surface-node.component.ts:219,223,227`, `Signal<… | null>`).
- `npx tsc -p libs/frontend/declarative-dashboard/tsconfig.lib.json --noEmit --declaration`: exit 0, no output.
  Before this batch it reported the three TS4029 errors.

### (f) `@for` tracking with duplicate ids

- Every child loop tracks `$index + ':' + id`:
  - renderer root `surface-renderer.component.ts:136`;
  - node v1 children `surface-node.component.ts:126`;
  - layout children and submit actions `surface-layout.component.ts:56,61`.
- A duplicate id stays a distinct view. A position swapped to another id gets a fresh view (the old input's
  `DestroyRef` clears its timer).
- Specs:
  - `surface-node.component.spec.ts:105` renders both duplicates inside a stack, then swaps a position and asserts a
    new element;
  - `surface-renderer.component.spec.ts:243` renders both root duplicates.

### (g) Swapped input's draft is removed

- `pruneDrafts` (`surface-renderer.component.ts:274-285`) runs from an effect on the view model and the drafts
  (`:211-216`). It skips failed builds, so a failure never erases drafts. It removes a draft whose id is no longer an
  input, or whose id now names a different input kind (compared with the previous render). It then publishes the
  pruned state through `viewStateChange`.
- Spec `surface-renderer.component.spec.ts:228`: an id swap drops `reason` and keeps `notes`; a text-to-checkbox kind
  swap on `notes` drops it.

## Risks

- **R5**: `SurfaceLayoutComponent` still imports only `NgTemplateOutlet`. The node passes its own `#child` template
  (`surface-node.component.ts:94-108`) as the layout's `childTemplate`. The import runs one way (node → layout).
  - The node references itself only from its template (standalone self-reference), not in `imports`, so there is no
    ES-module or `imports` cycle. `ngc` typecheck passes.
  - Pinned by `surface-node.component.spec.ts:91`: recursive render through grid → card → stat, a source scan that
    the layout has no `SurfaceNodeComponent|surface-node`, and that the node imports `./surface-layout.component`.
  - The existing layout pin (`surface-layout.component.spec.ts:54`) still passes.
- **R6**: the scan of `libs/frontend/mcp-apps-page/src` is not vacuous at B8. B10-B14 have landed nine non-spec files
  (state, services, focus directive), and the spec asserts `files.length > 0` for each lib. The B15 components do not
  exist yet, so the spec must be re-run in B15/B16 as planned.
- **R8**: `lib/trust-boundary.spec.ts` checks three things.
  - Literal rendering of `'<img src=x onerror=alert(1)><script>alert(2)</script>'` in:
    - surface title and description;
    - section and card title and description;
    - text, select, radio (legend) and checkbox labels;
    - select and radio option labels;
    - placeholder (attribute), text description and action label;
    - a bound data-model string (`input.value`);
    - submit issues on all three input kinds;
    - `detail` notices for `rejected`, `not-found` and `unsupported`;
    - every v1 display field: stat title, value, unit and description; table title, description, caption, column
      label and cell; list title, description, item text and detail; chart title and description, series names in
      the legend and in the table view, axis labels, and the first x value in the SVG.

    Each render asserts no `img`, `script`, `iframe`, `object`, `embed`, `style`, `[style]` or `a[href]` element, and
    no `on*` attribute anywhere.
  - Comment-stripped scan: a stripper that respects strings, template and regex literals and removes HTML comments,
    with its own self-test. It scans both libs' non-spec `.ts`/`.html` for `innerHTML`, `outerHTML`,
    `insertAdjacentHTML`, `bypassSecurityTrust`, `DomSanitizer` and `<iframe`, and the renderer lib for
    `@ptah-extension/markdown`.
  - Every action id except submit and select (`dashboard.refresh`, `pin`, `export`, `copy`, `open-url`,
    `drill-down`), attached to a card, a grid and every v2 display kind, and to every v1 display kind, gives exactly
    the same enabled-control list as the same document without actions, and none of their labels renders.

## Plan-validation edge case owned by 8.1

"Markup in every v1 and v2 text field renders literally; no `img`/`script` element" is covered by the four
literal-render tests in `trust-boundary.spec.ts:76,110,131,163`.

## Deviations

1. **(c) reuses `interaction.issues`** instead of adding a new renderer input. The reason and the evidence are above.
   If the team-leader wants a separate input anyway, it is a small additive change.
2. **`surface-layout.component.ts` was modified**, although the scope note does not list it. Its child and submit
   `@for` loops tracked by id alone, which (f) requires to change. Two template lines changed; the layout spec is
   unchanged and green.
3. **`renderFailed` carries no payload** (`void`). This is what makes carry-over (d)'s "same emission" hold. The
   Apps page (B15) only needs the event to show the mono fallback.
4. **Submit flush covers every valid draft on the surface**, not only the submit's subtree. Every flushed value would
   commit on blur anyway, and the Apps submit flow waits for the queue.
5. **Re-selecting the selected target emits `null`** (clears), which matches the `SurfaceSelectionChange` type and
   `AppsSurfaceOperations.select(…, null)` (`apps-surface-operations.service.ts:204-205`).
6. **Stale-echo guard** (the `WeakSet` in (a)) goes beyond the brief. It protects the F2 guard against a late parent.
7. **Public API**: `index.ts` exports:
   - `SurfaceRendererComponent`, `SURFACE_VIEW_MODEL_BUILDER` and `SurfaceViewModelBuilder`;
   - `buildSurfaceViewModel` and `SurfaceViewModelBuild`, so an override can delegate.

   `SurfaceNodeComponent` and the input components stay internal: no consumer needs them.
8. The scan also forbids `outerHTML` and `insertAdjacentHTML` (stricter than the plan).

## Tests

- Before: 12 suites, 125 tests (baseline run on this worktree before any change).
- After: 16 suites, 163 tests (+38):

  | Spec | Tests |
  | --- | --- |
  | node | 6 |
  | renderer | 15 |
  | trust boundary | 11 |
  | helper | 6 |

- Lint: 0 errors, 58 warnings, all `@typescript-eslint/no-non-null-assertion` in spec files. This is the same
  pattern as the existing specs; no non-spec file has a warning.
- No `console.*` or `NG0xxx` output during the test run.

## Verification

Command:

```
npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard --skip-nx-cache --parallel=2 --output-style=static
```

Exit 0. Tail:

```
Test Suites: 16 passed, 16 total
Tests:       163 passed, 163 total
✖ 58 problems (0 errors, 58 warnings)

 NX   Successfully ran targets lint, typecheck, test for project @ptah-extension/declarative-dashboard

  Run duration:      12.3s
  Cache:             Skipped (--skip-nx-cache)
```

Declaration check: `npx tsc -p libs/frontend/declarative-dashboard/tsconfig.lib.json --noEmit --declaration`, exit 0,
no diagnostics.

## Notes for B9

- `SurfaceRendererComponent` is the render entry point for `budget-render.spec.ts`. Count `(renderFailed)` emissions
  to prove "no renderFailed at each limit".
- `SURFACE_NODE_KINDS` is exported from `surface-node.component.ts` (not from `index.ts`) if the spec needs it.

## Notes for B15

- Bind these to stable signals or computeds, not method calls that build a new object on each change detection:
  - `[renderable]`, `[viewState]="slice viewState"` and `[interaction]="computed(() => ops.interaction(id))"`;
  - a new `interaction` object resets the renderer's local overlays. That is harmless while `change()` installs its
    overlay synchronously, but a per-check object is wasted work.
- Store the object emitted by `(viewStateChange)` as-is. Late echoes of older emitted objects are ignored by design.
- Keep routing change and select rejections through `setIssue`: that is the host-rejection channel the inputs render.
- `(renderFailed)` has no payload. Show the mono fallback on it; `SURFACE_VIEW_MODEL_BUILDER` can be overridden with a
  throwing builder for the Req 3.6 spec.
- Re-run `trust-boundary.spec.ts` after B15 (R6). The Apps components will then be inside the scan.
