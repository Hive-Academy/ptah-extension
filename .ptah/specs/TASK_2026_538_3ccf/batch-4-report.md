# Backend implementation — `TASK_2026_538`, batch 4

Executor: backend-developer subagent. No CLI lane was used. Every file in this batch was written by one subagent,
so standing rule 1 applies unchanged: the reviewer is a CLI lane running a logic-review prompt. Any family may be
used, because no lane family touched this batch.

**Tasks completed**: 4.1, 4.2, 4.3, 4.4, including both items carried from the Batch 1 review.

## Files

All paths are under `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\`.
Every file is new and uncommitted (`git status`: `??`). No existing file was edited: no v1 file, no barrel, no fixture,
and nothing from Batch 1.

| File | Lines | Task |
| --- | --- | --- |
| `surface-bindings.ts` | 406 | 4.1 |
| `surface-bindings.spec.ts` | 355 | 4.1 |
| `surface-patch.ts` | 421 | 4.2 |
| `surface-patch.spec.ts` | 448 | 4.2 |
| `surface-concurrency.ts` | 208 | 4.3 |
| `surface-concurrency.spec.ts` | 201 | 4.3 |
| `surface.validator.ts` | 549 | 4.4 |
| `surface-validator.spec.ts` | 614 | 4.4 |
| `surface-budgets.spec.ts` | 592 | 4.4 |

Every file is under the 700-line soft ceiling. None imports zod except through `surface.schemas` (validator only).
None uses `any`, `z.unknown()` or passthrough.

## Stack observed

- TypeScript 6.0.3 and zod 4.6.5 (root `package.json:283`, `:198`). Jest 30 via `@nx/jest`
  (`libs/shared/project.json`).
- `shared` is a pure util lib (`scope:shared, type:util`). There is no DI. Wiring is plain imports.
- Validation pattern: `dashboard-spec.validator.ts:134-231`. It uses an injected `DashboardJsonByteCounter`, an
  iterative structural walk, `safeParse`, and a catch-all that never throws. The v2 validator reuses
  `DashboardJsonByteCounter`, `DashboardSpecRejected` and `formatDashboardSpecIssues` from that file.
- Unused-variable lint allows a `^_` prefix (`eslint.config.mjs:420-424`).

## Task 4.1 — `surface-bindings.ts`

What was done:

- `collectSurfaceInputs(components)` returns inputs in document order. It uses `visitSurfaceComponents`, an iterative
  pre-order walk where the root is depth 1 and the visitor can stop early.
- `checkBindingCompatibility(inputs)` implements one documented rule:
  - Two inputs may share an exact path only if they have the same value type: text with text, checkbox with
    checkbox, or select/radio-group with an identical set of option values (order ignored; select and radio may
    mix).
  - Any overlap where one path is an ancestor or descendant of the other is rejected.
  - Paths are compared by segment, so `form.a` and `form.ab` do not overlap.
  - An invalid or denied path is rejected before any comparison.
  - The result names the path or paths.
- `checkDraftValue(input, value)`:
  - `undefined` (path absent) is always a valid draft (Req 4.4).
  - Text: any string up to `maxStringLength`. Short text and over-`maxLength` text are both valid drafts; length
    hints are enforced at submit (Req 3.6).
  - Checkbox: boolean only.
  - Select and radio-group: `null` or a declared option value. `''` is rejected, because `null` is the one
    documented empty value.
  - A rejection names the input id and path.
- `checkSubmitValues(inputs, model)` reads each path with the kind's empty value, then applies the draft check plus
  these rules:
  - Required text fails when blank after trimming.
  - `minLength` applies only to non-empty text, so an optional blank field passes.
  - `maxLength` always applies.
  - Required checkbox means `true`. Required select or radio means not `null`.
  - The result lists every failing path, not only the first, plus a joined `reason` (Req 10.2). On success it
    returns one `{ componentId, path, value }` per input, the `SurfaceSubmitRecord.values` shape.
- `collectSubmitScope(components, actionId)` returns `{ ok: false, code }` with one of three codes:
  - `undeclared`: no component declares the action.
  - `not-submit`: the action is not `surface.submit`.
  - `invalid-scope`: the action sits on a non-layout component, or the scope contains no inputs.
  - Otherwise it returns the scope component id and the inputs in that component's subtree (Req 10.6).
- Supporting exports: `visitSurfaceComponents`, `isSurfaceLayoutComponent`, `isSurfaceInputComponent`,
  `surfaceActionsOf` and `findSurfaceAction`.

Evidence (`surface-bindings.spec.ts`, 5 describe blocks):

- The walk visits in document order, reports depth, and stops early.
- Same-type sharing is accepted.
- Select and radio with identical option sets are accepted; with different sets they are rejected.
- Three cross-type pairs are rejected, naming the path.
- Ancestor or descendant overlap is rejected in both orders. `form.a` and `form.ab` are accepted.
- A `__proto__` path is rejected and `Object.prototype` is untouched.
- Every empty value and an absent path are valid drafts. `maxStringLength` is tested at the limit and at limit + 1.
- Eight wrong-type or non-option writes are rejected, each naming the path.
- A submit with five failing inputs names all five paths in order. Missing paths read as empty.
- A wrong-typed stored value is also rejected at submit.
- Scope is exact for two sibling submit sections. The three failure codes are covered by four cases.

## Task 4.2 — `surface-patch.ts`

What was done:

- `applySurfaceOps(state, ops)` works on `SurfacePatchState`, which is `Pick<SurfaceStateView, 'content' |
  'selection' | 'lastSubmit'>`. The host and the renderer can therefore run the same function on the wire shape.
- The function is atomic and copy-on-write. Untouched branches keep their identity and the input is never mutated.
- Tree edits (locate, then rebuild the ancestor path) are iterative.
- Consecutive data ops go to `applyDataModelOps` as one run.
- A missing component or parent id is an error that names the id and the surface (Req 5.3). These are also errors:
  - a non-layout parent;
  - `index > children.length`;
  - a `set-selection` that does not resolve.
- v1 content accepts only `set-selection` and `set-last-submit`; any other op gets a named refusal.
- The function never throws. It has a catch-all, and it reads the op discriminant defensively.
- The result's selection is always revalidated before it is returned, so the renderer's copy and the host's copy
  agree by construction.
- `checkSurfaceSelection(content, selection)` works for v2 and v1 content. It checks that:
  - the component exists;
  - the kind matches the target;
  - indexes are integers within the inline rows, items, series and points.
  A component backed by a data reference cannot be selected by index (Req 7.5). Batch 10 can reuse this for
  `surface:select`.
- `revalidateSelection(prev, next, ops | 'replace')` clears the selection, and never remaps it, when:
  - the surface was replaced whole;
  - a replace or remove op after the last `set-selection` targeted the selected component or any ancestor (chain
    taken from both the old and the new content);
  - the selection no longer resolves against the new content (Req 5.9).
- `isSurfaceStructureOp` is used by concurrency.

Evidence (`surface-patch.spec.ts`, 4 describe blocks):

- Adding at an index, appending at root, branch identity, and the input left unmutated.
- Nested replace and remove.
- Five rejection cases, each checking the named text: missing parent, missing replace target, missing remove target,
  non-layout parent, index past the end. Each one also checks that an earlier data op in the same list was not
  applied.
- `set-title` replaces the whole header: an omitted description clears it.
- Data runs across a structure op, with set, replace, remove and remove-missing.
- `__proto__` writes are rejected and `Object.prototype` is untouched.
- A selection is set, an out-of-range one is refused, and one can be cleared.
- The last-submit record is stored.
- The v1-only op rule.
- A hostile op or a throwing getter gives a clean failure.
- Selection is kept on unrelated edits.
- Selection is cleared by:
  - replacing the component with identical content;
  - replacing an ancestor;
  - removing the component;
  - removing an ancestor;
  - an index going out of range;
  - a whole replace.
- A selection set after a structure op is kept.
- Nine `checkSurfaceSelection` cases, plus a data-reference table.

## Task 4.3 — `surface-concurrency.ts`

What was done:

- Types: `SurfaceWriteFootprint`, which is one of `structure`, `data{paths}`, `data-wildcard` (`data:*`), `selection`
  or `submit-record`. Also `SurfaceWriteLog { floor, entries }`, `createSurfaceWriteLog(creationRevision)` and
  `surfaceOpsFootprint(ops)`.
- `surfaceOpsFootprint(ops)`: any structure op gives `structure`. Mixed categories, or an empty list, also give
  `structure` (fail closed). Data paths are de-duplicated.
- `appendWrite(log, entry)`:
  - More than `maxWriteLogPathsPerEntry` (16) paths collapses to `data:*`.
  - It keeps the last `maxWriteLogEntries` (32) entries.
  - Dropping an entry raises the floor to that entry's revision.
  - It returns a new log.
- `checkSurfaceConflict(log, current, base, mutation)` implements the Q4 table exactly:
  - agent and submit need `b === current`;
  - a v1 proposal is always accepted;
  - a UI change is stale only on a later `structure`, a later `data:*`, or a later data path that overlaps its own;
  - a UI select is stale on a later `structure` or `selection`.
- These bases are always stale: `null`, a non-integer, a value above `current`, and a value below the floor.
- A rejection is `stale-revision` with `currentRevision`, and a `detail` that names the conflicting revision and
  what it wrote.

Evidence (`surface-concurrency.spec.ts`, 3 describe blocks):

- The intended asymmetry is pinned in one test. A disjoint-path agent patch with an old base is rejected with
  `currentRevision: 11`; a disjoint-path UI change with the same base is accepted.
- Budgets at the limit and at limit + 1: 16 versus 17 paths, and 32 versus 33 entries (floor 10 becomes 11, and the
  oldest kept entry is 12).
- A base below the floor is stale; a base equal to the floor is provable.
- Nine footprint cases for a UI change: same path, ancestor, descendant, a sibling sharing a prefix, disjoint,
  `data:*`, structure, selection, submit record.
- Five footprint cases for a UI select.
- Writes at or below the base are ignored.
- A base that is newer, missing or non-integer is rejected.
- Exact-base rule for agent and submit.
- The v1 proposal is always accepted.
- Footprint derivation.

## Task 4.4 — `surface.validator.ts`

What was done:

- `validateSurfaceUpdateInput(input, countBytes)`:
  1. raw `ops` count against `maxPatchOps`;
  2. an iterative walk (component depth, total components across the whole request, children per node, data-value
     depth, array length and object width);
  3. request bytes against `maxUpdateRequestBytes`;
  4. the raw version pair of the carried surface, which names `surface.schemaVersion` or `surface.catalogVersion`.
     A v1 envelope is refused, naming `ptah_dashboard_propose_spec`;
  5. the `SurfaceUpdateInputSchema` parse;
  6. for create and replace only, the document byte budgets and the semantic checks.
- `validateSurfaceDocument(doc, countBytes)`: walk, then `maxDataModelBytes` and `maxSurfaceBytes` (each rejection
  names its budget, Req 4.3), then versions, then `SurfaceEnvelopeSchema`, then semantics. The semantic checks are:
  - unique component ids and unique action ids;
  - component count and depth;
  - `maxInputs`;
  - binding compatibility;
  - every bound path is reachable through objects and holds a valid draft (Req 3.4);
  - every submit action passes `collectSubmitScope`.
  An accepted document returns `bytes` and `dataModelBytes`.
- `validateSurfaceEnvelopeVersions(input)` checks against `DASHBOARD_CONTRACT_VERSION_PAIRS` and returns a `field`
  plus a `reason` that contains the field name. A missing or unknown schema version names `schemaVersion`; an
  unknown or mismatched catalog version names `catalogVersion`.
- `formatSurfaceIssues` is `formatDashboardSpecIssues` (the same reference).
- Nothing throws. A catch-all returns `could not be validated: <message>`, keeping only the message text.

Carried item 1 (walk before any parse, 10,000 levels):

- `surface-validator.spec.ts` has five 10,000-level component payloads: create, replace, patch `add-component`,
  patch `replace-component`, and `validateSurfaceDocument`. For each one it asserts:
  - no throw;
  - `{ ok: false }` with `over the maxTreeDepth limit of 8`;
  - `SurfaceUpdateInputSchema.safeParse` and `SurfaceEnvelopeSchema.safeParse` were never called (`jest.spyOn`).
- The same checks cover 10,000-level data nesting in a create data model and in a set-data value (`maxDataModelDepth`).
- Op count before parse: 101 garbage ops are rejected on `maxPatchOps`, with no parse call.
- Oversized bytes are rejected with no parse call.

Carried item 2 (non-finite numbers): `Infinity`, `-Infinity` and `NaN` are each rejected in all of these places,
through both the update validator and the document validator, with the path asserted:

- stat `value` (`surface.components.0.value`) and `delta`;
- chart series `x` and `y` (`series.0.points.0.x` / `.y`);
- data-model values (`surface.dataModel.n`, `dataModel.list`);
- set-data values (`ops.0.value`).

`Number.MAX_VALUE` is accepted.

Budget evidence (`surface-budgets.spec.ts`): each budget below is accepted at its limit and rejected at limit + 1.
Walk and byte rejections assert the budget name; schema rejections assert the path.

- `maxComponents`: once for the root list and once for the nested total (4 stacks × 49 children).
- Structure: `maxTreeDepth`, `maxChildrenPerNode`, `maxGridColumns`, `maxActionsPerComponent`.
- Inputs: `maxInputs`, `maxOptions`, `maxOptionValueLength`.
- Strings and ids: `maxStringLength`, `maxSurfaceIdLength`, `maxComponentIdLength`.
- Paths: `maxPathSegments`, `maxPathSegmentLength`.
- `maxDataModelDepth`: once for a model root and once for a set-data root.
- Data width: `maxDataModelArrayLength`, `maxDataModelObjectKeys`.
- Tables and charts: `maxTableRows`, `maxTableColumns`, `maxSeriesPoints` (summed across series).
- `maxPatchOps`.
- Byte budgets, with inputs built to exactly N and N + 1 bytes (the builder asserts the exact size):
  - `maxDataModelBytes`: 65,536 / 65,537;
  - `maxSurfaceBytes`: 262,144 / 262,145, with `bytes` reported;
  - `maxUpdateRequestBytes`: 307,200 / 307,201, with `bytes` reported.

Semantic evidence (`surface-validator.spec.ts`): nine document rejections, each through both entry points:

- duplicate component id;
- duplicate action id;
- a number at a checkbox path;
- a non-option at a select path;
- a bound path through a non-object value;
- incompatible shared binding;
- overlapping bindings;
- submit on a display component;
- submit with an empty scope.

Also accepted: an empty required field and short text as a stored draft, and a missing bound path. The version table
has eight cases.

## Edge cases and risks

- R12 (security), for the parts in Task 4.4:
  - Prototype-pollution paths are rejected in bindings and in patch, with `Object.prototype` untouched.
  - Untrusted strings in reasons are capped at 64 characters or quoted.
  - Exceptions never cross the boundary: only the message is kept, capped at 200 characters.
- R9 (concurrent shared edits): Batch 3's `libs/shared/src/lib/types/ai-provider.types.ts` edit was present while
  the verification ran, and verification passed with it. I did not touch that file. The team-leader re-runs
  verification before committing, per standing rule 5.
- Q4 asymmetry: pinned (Task 4.3 evidence).
- Selection clearing on replace, remove and out-of-range, never remapped: pinned (Task 4.2 evidence).
- Cancelling large patch:
  - Four ops of 300,000 characters set and then remove `blob`. `applyDataModelOps({}, ops)` returns
    `{ ok: true, next: {} }`, yet the validator rejects the request on `maxUpdateRequestBytes`.
  - 101 tiny set/remove pairs are rejected on `maxPatchOps`.
- Mixed or unknown version pair names the field (Req 1.3): the version table, the update validator
  (`surface.catalogVersion` / `surface.schemaVersion`) and the document validator.
- A v1-catalog envelope carrying `select` is rejected (Req 1.4):
  - by `validateDashboardSpec` (reason names `components.0`);
  - by the v2 validator, naming `surface.schemaVersion` for a v1 pair and `surface.catalogVersion` for a mixed pair.
- A path absent from the data model reads as the kind's empty value (Req 4.4): tested in the bindings and validator
  specs.
- The state-read budget sum is at or under `maxStateReadBytes`: the 272 KiB worst case against 320 KiB is asserted in
  `surface-budgets.spec.ts`.

## Verification

Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared`

```text
√  nx run @ptah-extension/shared:lint
√  nx run @ptah-extension/shared:test
√  nx run @ptah-extension/shared:typecheck
NX  Successfully ran targets typecheck, test, lint for project @ptah-extension/shared
Cache: 0/3 hit (0%)
```

- Static re-run: `Test Suites: 72 passed, 72 total`, `Tests: 2046 passed, 2046 total`. Batch 1 left 67 suites and
  1,882 tests. The five new suites account for 250 tests together with the two Batch 1 surface suites.
- Lint: `5 problems (0 errors, 5 warnings)`. None is in a Batch 4 file. Two are the accepted unused catch bindings in
  `surface-data-model.ts:102` and `:241`. The other three (two `max-lines`, one `preserve-caught-error`) are in files
  this batch did not touch.

## Plan deviations

1. **Check order: the walk runs before the byte count.** The batch text orders the checks as request bytes, then op
   count, then walk.
   - Evidence: with bytes first, all five 10,000-level payloads returned
     `surface request could not be validated: Maximum call stack size exceeded`. The injected `JSON.stringify`
     counter overflows inside the jest worker, so carried item 1 ("a clean `{ ok:false }` naming the depth budget")
     could not hold.
   - Fix: the order is now op count, then walk, then bytes, then versions, then zod, then semantics. Every parse
     still comes after the walk, and bytes are still measured on the value as received, before the parse.
   - The walk is kept linear: it stops one level past each budget, and it is capped at one visited data value per
     budget byte. This cap also stops a shared-subtree object graph that `JSON.stringify` would never finish; that
     case is tested.
   - Consequence: a rejection from the op-count or walk step carries no `bytes`, because nothing was measured. The
     module header documents this.
2. **The `checkSurfaceConflict` 4th parameter is a mutation descriptor**
   (`{ kind: 'agent' | 'v1-proposal' | 'ui-change' (path) | 'ui-select' | 'submit' }`), not a bare footprint. The Q4
   rule depends on the mutation kind: an agent data patch and a UI change can have the same footprint and still get
   different rules.
3. **Extra exports beyond the plan's function names.** Each one is used by another Batch 4 module, or is needed by
   Batches 9 and 10 for the Req 7.5 select check:
   - bindings: `visitSurfaceComponents`, `isSurfaceLayoutComponent`, `isSurfaceInputComponent`, `surfaceActionsOf`,
     `findSurfaceAction`;
   - patch: `checkSurfaceSelection`, `isSurfaceStructureOp`, `SurfacePatchState`;
   - concurrency: `createSurfaceWriteLog`, `surfaceOpsFootprint`.
   No barrel was edited; that is Task 6.5.
4. **Documented semantic choices the plan left open.** Each is written in JSDoc for the Batch 12 tool descriptions:
   - `set-title` replaces the whole header, so an omitted description clears it.
   - `add-component` with an index past the end is rejected, not clamped.
   - `''` is not an empty value for select or radio.
   - Required text is checked after trimming.
   - An empty optional text field is not held to its `minLength`.
   - A mixed op list gets the `structure` footprint.
   - A data-reference table, list or chart cannot be selected by index.
5. **Spec count.** "Batch 4 verification" says "4 production files and 6 specs". The task file lists name 5 spec
   files, and those 5 were created. The count in `batches.md` looks like a typo.
6. **Budgets not covered in this batch:** `maxRpcRequestBytes` (RPC handler, Batch 11) and `maxSubmitMessageBytes`
   (submit formatter, Batch 6). No Batch 4 module enforces either. The write-log budgets are in
   `surface-concurrency.spec.ts`.

## Out-of-scope observations

- `surface-data-model.ts:102` and `:241` still have unused `catch (error: unknown)` bindings. They were accepted in
  review, and the file is not in Batch 4's list, so I left them.
- `SurfaceComponentSchema` (`surface.schemas.ts:403-419`) still has no depth bound of its own. Any caller that parses
  it directly, bypassing this validator, is exposed. Everything in Batch 4 goes through the walk first. Batches 11 and
  12 must call `validateSurfaceUpdateInput` / `validateSurfaceDocument` and never the schemas directly.

## Revision 1 (review round 1: `code-logic-review-batch-4.md`, codex, NEEDS_REVISION 5/10)

Executor: the same backend-developer subagent, with no CLI lane. Only Batch 4 files were edited. No commits were made.

### Files

All paths are under `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\`.

| File | Lines | Change |
| --- | --- | --- |
| `surface-patch.ts` | 446 | Finding 1 |
| `surface.validator.ts` | 646 | Findings 2, 3 and 4 |
| `surface-patch.spec.ts` | 526 | Finding 1 regressions |
| `surface-validator.spec.ts` | 797 | Findings 2, 3 and 4 regressions |
| `surface-budgets.spec.ts` | 608 | Binding-depth budget case |

`surface-validator.spec.ts` is 797 lines, over the 700-line soft ceiling. That ceiling covers production files, and lint
flags nothing new. The spec could be split by describe block if the reviewer wants.

### 1. BLOCKER: selection moving to other data through a transient ancestor

Fixed in `surface-patch.ts`.

- `applySurfaceOps` now invalidates the selection as each structure op applies. It uses the tree before that op
  (`survivesStructureOp`): a replace or remove of the selected component, or of any ancestor in the pre-op chain,
  clears it.
- After each structure op, and again on the final result, a selection that no longer resolves is cleared.
- Only a later explicit `set-selection` can set a selection again.
- `revalidateSelection(prev, next, ops)` no longer rebuilds ancestry from the two end states. It replays `ops` from
  `prev` with the same per-op rule. It keeps `next.selection` only if the replay produced the same selection and that
  selection resolves against `next.content`; otherwise it returns null. `'replace'` still clears.

Specs added in `surface-patch.spec.ts`, describe "selection through a transient ancestor":

- The reviewer's 4-op sequence: add `temporary` containing `t`, select row 0, remove `temporary`, add root `t` with
  `[['Grace']]`. The result is `ok`, the roots are `['only', 't']`, and the selection is `null`.
  `revalidateSelection` given the forged selection also returns `null`.
- Replacing the transient ancestor gives a `null` selection.
- The same 4 ops followed by an explicit `set-selection` keep that new selection.

All earlier selection specs still pass unchanged.

### 2. MAJOR: bindings that can never hold a value

Fixed in `surface.validator.ts`, in `boundPathBreach`.

- The model root counts as one container, so a value at N segments needs N nested objects. A binding with more than
  `maxDataModelDepth` (6) segments is therefore rejected. The reason names the input id, the path, the segment count
  and `maxDataModelDepth`.
- The Batch 1 path grammar is unchanged: `maxPathSegments` stays 8 for request paths such as `remove-data`.
- A representable missing path is still a valid empty draft.

Specs:

- `surface-validator.spec.ts`: a missing 6-segment binding is accepted. `applyDataModelOps({}, set-data)` on it
  succeeds, and the written document validates.
- `surface-validator.spec.ts`: 7- and 8-segment bindings are rejected by `validateSurfaceDocument`, naming the input,
  path and budget, and by create.
- `surface-budgets.spec.ts`: a new case, "input binding segments (maxDataModelDepth)", tests 6 against 7.
- The old `maxPathSegments` budget case used an 8-segment binding, which is now correctly rejected. It was moved to a
  `remove-data` request path (8 against 9), so it still tests only the grammar.

### 3. MINOR: the catch formatter could throw

Fixed in `surface.validator.ts` with `safeErrorDetail`.

- It starts from the constant `'unexpected error'`.
- It reads a detail only from a string, or from an `Error`'s string `message`.
- `instanceof` and the `message` read happen inside `try`, and a failure keeps the constant.
- `String(object)` is never called.

Specs: for each of three thrown values, a counter that throws it makes both public validators return
`{ ok: false, reason: '... could not be validated: unexpected error ...' }`. The three values are:

- `Object.create(null)`;
- an `Error` whose `message` accessor throws;
- a Proxy whose traps throw.

### 4. MINOR: deep nesting under keys the walk did not follow

Fixed in `surface.validator.ts`, with a bounded generic preflight.

- `findRawDepthBreach` is an iterative walk over every raw key and array item. It runs after the dedicated walks, so
  component and model breaches still name their own budgets, and before the byte counter. It is used in both public
  validators.
- The new exported constant `SURFACE_MAX_RAW_JSON_DEPTH` is `2 * maxTreeDepth + 8`, which is 24. It is derived from
  the deepest legal nesting, 22:
  - the request, then `surface` or ops/op, then the components array;
  - two levels per tree level;
  - at most four fixed levels in a leaf, for example `series` > series > `points` > point.
- Visits are capped at one per budget byte, like the data walk. There is no recursion.
- The constant lives in the validator because `surface-catalog.ts` belongs to Batch 1. It can move to the catalog
  later if the architect wants every budget there.

Specs:

- The deepest legal shape (an 8-level tree whose leaf is a chart with `series` and action `params`) is accepted by
  `validateSurfaceDocument`, by create and by a patch `add-component`.
- A 10,000-level `{a:…}` is rejected, naming `SURFACE_MAX_RAW_JSON_DEPTH of 24` and carrying no `bytes`, in each of
  these places:
  - under an unknown document key;
  - under an unknown key of a create surface;
  - in the action `params` of an added component;
  - in table `rows`.

### Resource-bound note, carried from the reviewer

The walks are iterative and capped per visit. Even so:

- `Object.keys` materializes all keys of a huge shallow object before the width check.
- The injected byte counter serializes the whole raw payload before its result can be compared.

Both are work that grows linearly with the input and happens before the rejection. Batch 4 therefore claims no
strict bounded-resource guarantee. That guarantee holds only if the transport enforces a raw request-byte cap, which
is outside this batch and was not verified. The same note is now in the `surface.validator.ts` module header.

### Revision 1 verification

Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared 2>&1 | tail -30`

```text
√  nx run @ptah-extension/shared:lint
√  nx run @ptah-extension/shared:test
√  nx run @ptah-extension/shared:typecheck
NX  Successfully ran targets typecheck, test, lint for project @ptah-extension/shared
Cache: 0/3 hit (0%)
```

- Static re-run: `Test Suites: 72 passed, 72 total`, `Tests: 2061 passed, 2061 total`. The first submission had
  2,046 tests; Revision 1 adds 15.
- Lint: `5 problems (0 errors, 5 warnings)`. These are the same five as before, and none is in a Batch 4 file.

## Revision 2 (review round 2: re-review after Revision 1, codex, NEEDS_REVISION 6/10)

The re-review marked findings 1-4 CLOSED and raised two new defects that Revision 1 introduced. Both are fixed below.
Executor: the same backend-developer subagent, with no CLI lane. Only Batch 4 files were edited. No commits were made.

### Files

All paths are under `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\`.

| File | Lines | Change |
| --- | --- | --- |
| `surface.validator.ts` | 658 | Finding 5 |
| `surface-patch.ts` | 462 | Finding 6 |
| `surface-validator.spec.ts` | 908 | Finding 5 specs |
| `surface-patch.spec.ts` | 579 | Finding 6 specs |

`surface-validator.spec.ts` is now 908 lines, over the 700-line soft ceiling. That ceiling covers production files, and
lint reports no new warning. The spec can be split by describe block if the reviewer wants.

### 5. SERIOUS: the raw preflight charged its budget on pops, not on scheduling

Fixed in `surface.validator.ts`, in `findRawDepthBreach`.

- The budget, one value per budget byte, is now charged when a child is scheduled, before it is read or queued.
- For an array, `length` is compared with the remaining budget before any element is touched. If the array is too
  wide, it is rejected with the named budget and zero element reads.
- For an object, keys are enumerated with `for…in` plus an own-property check. Each key is charged before its value
  is read or queued, so enumeration stops as soon as the budget is spent.
- Result: at most `maxValues` values are read or queued in total.
- One caveat remains. The engine's own key enumeration for a proxy or an exotic object is outside the validator's
  control; the module header's resource note already covers this.

Specs added in `surface-validator.spec.ts`, describe "Revision 2 (review finding 5)":

- A `maxUpdateRequestBytes + 1` array proxy under an unknown create-surface key:
  - it is rejected at `request.surface.extra`, naming the budget;
  - **0** element reads;
  - the byte counter (`jest.fn`) and `SurfaceUpdateInputSchema.safeParse` are never called.
- A `maxSurfaceBytes + 1` table `rows` proxy in a document: rejected, naming `maxSurfaceBytes`, with 0 row reads. The
  counter and `SurfaceEnvelopeSchema.safeParse` are never called.
- A `maxSurfaceBytes + 1` key object proxy under an unknown document key: rejected, with value reads
  `<= maxSurfaceBytes`. The counter and the parse are never called.
- A legal 1,000-row table is still accepted.

### 6. MODERATE: standalone selection revalidation depended on key order

Fixed in `surface-patch.ts`, in `sameSelection`.

- The old `JSON.stringify` comparison is gone.
- The comparison now checks `componentId`, then the discriminant `kind`, then only that kind's defined fields:
  - `stat`: no further fields;
  - `table-row`: `rowIndex`;
  - `list-item`: `itemIndex`;
  - `chart-point`: `seriesIndex` and `pointIndex`.
- An unknown kind gives `false`, which fails closed.

Specs added in `surface-patch.spec.ts`, describe "standalone revalidation compares targets by field":

- Unchanged selections whose keys are in a different order are kept: a table-row target and a chart-point target
  (both built with `JSON.parse`), each returned by identity.
- A changed row index clears the selection, and so does a changed kind (stat changed to list-item).

### Unchanged by this revision

- All Revision 1 fixes and their specs pass.
- The Q4 asymmetry specs (`surface-concurrency.spec.ts`) and the draft-versus-submit specs (`surface-bindings.spec.ts`)
  pass untouched.

### Revision 2 verification

Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared 2>&1 | tail -30`

```text
√  nx run @ptah-extension/shared:test
√  nx run @ptah-extension/shared:lint
√  nx run @ptah-extension/shared:typecheck
NX  Successfully ran targets typecheck, test, lint for project @ptah-extension/shared
Cache: 0/3 hit (0%)
```

- Static re-run: `Test Suites: 72 passed, 72 total`, `Tests: 2067 passed, 2067 total`. Revision 1 had 2,061 tests;
  Revision 2 adds 6.
- The surface specs alone: 7 suites and 271 tests passed.
- Lint: `5 problems (0 errors, 5 warnings)`. These are the same five as before, and none is in a Batch 4 file.
