# Batch 8, fix round 1 — Task 8.1

Executor: frontend-developer. Worktree: `D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772`.
All paths are under `libs/frontend/declarative-dashboard/src/lib/`. No git command was run. Nothing outside this lib
was edited, and no tsconfig was touched.

Inputs: `code-logic-review-batch-8.md` (R1 below), `code-logic-review-batch-8-codex.md` (R2), `batch-8-report.md`,
`batches.md` Batch 8, and `mcp-apps-page/.../apps-surface-reducer.ts:336-354` (read only).

## Files

| Change | File | Lines |
| --- | --- | --- |
| MODIFY | `components/surface-renderer.component.ts` | 298 → 393 |
| MODIFY | `components/surface-text-input.component.ts` | 234 → 241 |
| MODIFY | `components/surface-renderer.component.spec.ts` | 272 → 453 |
| MODIFY | `components/surface-text-input.component.spec.ts` | 334 → 347 |
| MODIFY | `trust-boundary.spec.ts` | 310 → 341 |

## Fix 1 (BLOCKING, R1 blocking + R2 #1): view-state echo guard

**Choice: I dropped the guard.** I did not scope it per surface. My reasons:

- `SurfaceViewState` holds only `components` and `drafts` (`surface-view-state.ts:24-26`). With no revision field,
  nothing inside the renderer can tell "a late echo of my old write" apart from "the parent restoring that object".
  Any identity heuristic is wrong for one of the two.
- A per-surface or per-generation scope would still refuse an in-scope restore: an agent snapshot checkpoint, a reset
  to an empty object emitted earlier, or a re-created surface. Adding a revision would change a contract that the Apps
  lib shares.
- Carry-over (a) already makes the late echo impossible for a conforming parent. The parent stores each emitted object
  synchronously, and the reducer stores it by reference (`apps-surface-reducer.ts:353`).
- The F2 guard never needed the WeakSet. It needs the renderer to pass a `drafts` object holding the last write, and
  the synchronous working copy guarantees that.

**Code:**

- `surface-renderer.component.ts:226` adds `parentState`, a computed over `(surfaceId, viewState)`.
- `:232` makes `state` a plain `linkedSignal(() => normalized(parentState().viewState))`. Every object the parent
  passes replaces the working copy, and so does a surface-id change (the parent re-adopted even when it passes the
  same object).
- The `emitted` WeakSet and its `add` in `publish` (`:336`) are deleted.
- The class doc (`:105-128`) now states the contract.

**Knock-on fix found by the new specs, in `surface-text-input.component.ts:226-231`:**

- With restores now obeyed, a restore of exactly the `drafts` object the text was typed against showed `'a'` but
  committed `'ab'`. `TypedText.drafts` is the object from before the write, and `isStale` treats "same object" as "not
  yet round-tripped".
- The old WeakSet hid this by refusing such restores.
- Fix: `reconcileTyped` (called from the effect at `:127` and from `currentDraft` at `:209`) re-keys the typed text to
  the first new `drafts` object that holds it. From then on, a restore of the older object makes the typed text stale.
- All 11 existing F1/F2 specs in `surface-text-input.component.spec.ts` pass unchanged.

**Pre-existing assertion that encoded the buggy behaviour.** The old test `surface-renderer.component.spec.ts:145`
("ignores a late echo of an older emitted view state") asserted:

- that `host.viewState.set(host.emitted[0])` is refused, with drafts staying `'ab'`, the text showing `'ab'`, and blur
  committing `'ab'`;
- that a parent-made object replaces the working copy.

The first half is exactly the refusal both reviews call blocking: the parent passes an object and the UI shows
something else. I rewrote it in place (`:183`, "treats an older emitted view state the parent passes back as
authoritative, never as a stale echo") to assert:

- `renderer.state()` is that object;
- drafts `{reason: 'a'}`, the text shows `'a'`, and blur commits `'a'`.

The second half (a parent-made state replaces the copy, and `'from parent'` shows) is kept verbatim.

**New specs, all in `surface-renderer.component.spec.ts`.** Each asserts that the parent's object is what renders, and
where relevant what commits:

- `:205` agent snapshot replace: a new renderable plus a checkpoint object emitted earlier.
- `:215` view state reset to empty: an empty object emitted earlier after a commit, then a fresh empty object.
- `:231` workspace switch: another slice's state for the same surface id, then back. Blur commits the restored draft.
- `:246` same surface re-created: a restored saved object, then a fresh one.
- `:259` switch away and back between surfaces `a` and `b`, with the renderer kept mounted and a per-surface store:
  A → B → A → B.
- `:282` surface switch where the parent passes the same object (a never-feeding parent): the new surface's copy is
  adopted.
- `surface-text-input.component.spec.ts:335` (unit level): a parent restoring the `drafts` object the text was typed
  against is obeyed, showing and committing `'a'`.

**Red/green.** I patched the WeakSet guard back into a temp copy of the renderer, ran
`-t "parent|authoritative"`, then restored the file:

```
Tests:       7 failed, 29 skipped, 2 passed, 38 total
● ... treats an older emitted view state the parent passes back as authoritative, never as a stale echo
● ... agent snapshot replace ...        ● ... view state reset to empty ...
● ... workspace switch ...              ● ... same surface re-created ...
● ... switching away and back between two surfaces with the renderer kept mounted
● ... re-adopts the parent's copy on a surface switch ...   Expected: ""  Received: "only in the working copy"
```

Then I removed the `reconcileTyped` re-key line from a temp copy of the text input and ran the text-input and
renderer specs:

```
● SurfaceTextInputComponent › ... (F2) › obeys a parent that restores the drafts object the text was typed against
● SurfaceRendererComponent › treats an older emitted view state the parent passes back as authoritative, ...
Tests:       2 failed, 62 passed, 64 total
```

Both files were restored from their backups, and the full run below is green.

**Accepted consequence (R2 fix-list 1, "delayed same-generation echo").** A parent that breaks carry-over (a) and
passes an older emitted object late is now obeyed: that is a rollback. I did not add a spec that pins the rollback,
because it is out of contract. The synchronous-parent path (`feedBack = true`, every spec) and the never-feeding path
(`:169`) both keep every draft.

## Fix 2 (BLOCKING, R2 #2): same id and kind, new path

A draft now belongs to a binding, `kind + '\0' + path` (`bindingOf`, `surface-renderer.component.ts:133`):

- **Where bindings live.** In a `WeakMap` keyed by the `drafts` record (`:238`). A record the renderer emitted carries
  the bindings it was typed against, and so does a restored record, on any surface. This replaces the old
  `previousInputKinds` field, which was lifetime-scoped: it compared kinds against whatever surface rendered last, the
  same flaw as the guard.
- **Where bindings are written.** `writeDraft` (`:277`) records the binding of the input that wrote the draft.
  `withoutDrafts` (`:374`) carries the bindings over on every removal.
- **Records the parent made itself.** `bindingsOf` (`:362`) adopts the bindings of the inputs rendered when such a
  record is first seen, and judges it against those from then on.
- **Pruning.** `staleDraftIds` (`:347`) marks a draft stale when its id is no longer an input or its binding changed.
  `pruneDrafts` (`:342`) drops those drafts.
- **Submit.** `invoke` (`:320-333`) also skips and discards them directly (`:323`), so a submit can never commit one,
  even without a prune pass in between.

New specs (`surface-renderer.component.spec.ts:291-337`). The node `reason` moves from `form.reason` to `form.moved`,
and an unrelated draft `notes` is kept:

- `:306` blur (plus the debounce): the stale draft is dropped, `notes` is kept, and the only commit is `notes`' own
  debounce;
- `:317` Enter: no commit;
- `:324` submit: only `notes` is flushed, then the action;
- `:330` a host update that keeps the binding (new label and title, new host value) keeps the draft.

The existing kind-swap spec (`:409`) passes unchanged.

**Red/green.** I made `bindingOf` return `node.kind` (the old comparison) in a temp copy, then restored the file:

```
● ... changes its path › drops the stale draft, keeps the unrelated one, and never commits it on blur
● ... changes its path › never commits it on Enter
● ... changes its path › never commits it on submit; the unrelated draft is flushed
Tests:       3 failed, 35 passed, 38 total
```

## Fix 3 (R1 Moderate 1 + R2 #3): source-scan bypasses

`trust-boundary.spec.ts` has five changes.

- **Comment stripping (`:259`).** `stripComments` now uses the TypeScript parser and printer
  (`ts.createPrinter({ removeComments: true })`, with `import * as ts from 'typescript'`, root devDependency 6.0.3).
  - The compiler, not a heuristic, decides string boundaries and regex versus division.
  - Strings, template literals (with any HTML comment inside an Angular template) and regex literals stay and are
    scanned.
  - `<!--` in TypeScript code is kept, because it is not a comment in an ES module.
  - An `.html` file is scanned whole. Neither lib has one today.
- **Joined view (`:270`).** `joined` removes `${…}` interpolations, quotes, backticks, `+` and whitespace. This catches
  `'inner' + 'HTML'`, a split across lines, `` `inner${''}HTML` `` and `'bypassSecurity' + 'TrustHtml'`.
- **One scan path (`:277`).** `sinkFindings` scans both the stripped code and the joined view. Both lib scans (`:329`)
  use it.
- **Regression cases (`:311-323`).** Nine cases, which must all be found:
  - R2's exact sample, `const start = '<!--'; element.innerHTML = …; const end = '-->';`;
  - a regex literal that the old heuristic misread as a block comment, `if (ok) /[/*]/.test(s); el.innerHTML = v; // */`
    (a second bypass that I found);
  - bracket access;
  - a split string, and a split string across lines;
  - template concatenation;
  - a split method name;
  - an HTML comment inside a template string;
  - a split `<iframe` in a template.

  `:325` checks the negative: a token that only real comments mention is not flagged.
- **Documented limit (`:284-291`).** Names computed at run time (`el[key]` from variables, `atob`, `String.fromCharCode`,
  `Reflect.set`) are not source tokens. The defence that does not depend on the scan is the runtime DOM assertion: every
  pinned field is rendered with the 538 fixture as literal text, with zero `img`/`script` or other active element
  (`expectInert`, `:65`).

**Pre-existing assertion changed** (`:296`, "strips comments but keeps strings…"):

- **What it asserted.** The code-position `<!-- bypassSecurityTrust -->` in its sample was stripped
  (`not.toMatch(/innerHTML|DomSanitizer|bypassSecurityTrust/)`).
- **Why that encoded the bypass.** Treating `<!--` in TypeScript code as a comment is R2 #3's mechanism.
- **What it asserts now.** The sample string is unchanged. Real comments are stripped (`not.toMatch(/innerHTML|DomSanitizer/)`),
  and the HTML-comment look-alike is kept (`toMatch(/bypassSecurityTrust/)`). The three "keeps" assertions are
  unchanged.

**Red/green.** I ran the pre-fix `stripComments`, copied verbatim into a temp script outside the repo and then deleted,
against the nine samples:

```
MISSED  an HTML comment spanning string markers
MISSED  a regex literal that looks like a block comment
FOUND   bracket access
MISSED  a split string
MISSED  a split string across lines
MISSED  template concatenation
MISSED  a split method name
MISSED  an HTML comment inside a template string
MISSED  a split tag in a template
```

The new scan finds all nine (green in the run below). It reports no false positive in either lib.

## Fix 4 (R2 #4): list item URL fixture

`trust-boundary.spec.ts:164`: a v1 list with `url: markup` (the 538 fixture) and `url: 'javascript:alert(1)'`.

- `dashboard-list.component.ts:58` renders the URL as text in `<p class="break-all">`. The spec asserts that both
  strings render literally there.
- It asserts zero `<a>` elements of any kind, and that no attribute anywhere contains the `javascript:` URL.
- It also runs `expectInert`.

## Fix 5 (R1 Moderate 2 + R2 #5): TS2367 and spec type-checking

- `trust-boundary.spec.ts:196-199`: the impossible `action === 'surface.submit' ? [] : …` branch and the
  `as DashboardAction` cast are gone. `v1Actions` is now `INERT_ACTIONS.map(...)` typed `readonly DashboardAction[]`,
  with a comment saying why submit needs no exclusion.
- `npx tsc -p libs/frontend/declarative-dashboard/tsconfig.spec.json --noEmit`:
  - before: `trust-boundary.spec.ts(182,74): error TS2367: …` (the only error);
  - after: exit 0, no output.

  No tsconfig was edited. `typecheck` (`project.json`) still checks only `tsconfig.lib.json`. Making spec types part of
  the target is a `project.json` change outside my file ownership: see "Out of scope".

## Fix 6 (R1 failure modes 2 and 3): malformed override result

`surface-renderer.component.ts:69-124`:

- **Node validation.** `attemptBuild` now requires every node to pass `isRenderableNode` (`:83`):
  - an object with a string `kind` among the 13 `SURFACE_NODE_KINDS` (imported from the node component), a string `id`
    and a boolean `selectable`;
  - inputs: string `label` and `path`, a defined `hostValue`, and for select/radio an array of `{value: string, label:
    string}` options;
  - layouts: array `children` and `submitActions`;
  - v1 display nodes: `children` must be an array when present;
  - a node that is its own ancestor fails, so the check always ends.
- **Failure path.** Any failure returns `null`, the same `renderFailed` path as a throwing builder. The doc on
  `SURFACE_VIEW_MODEL_BUILDER` still holds, and `attemptBuild`'s doc now names malformed nodes.
- **R1 failure mode 3 is fixed with it.** Choice options are validated here, so `checkDraftValue` in `invoke` (`:326`)
  can no longer receive malformed options.
- **Default builders are unaffected.** `buildSurfaceViewModel` and `buildDashboardViewModel` only emit nodes that pass:
  - `mapDisplayNode` throws on an unknown kind (`dashboard-view-model.ts:80-81`);
  - `mapInput` validates the label, the path and the options (`surface-view-model.ts:72-90`).

  All 16 suites pass unchanged.

New specs (`surface-renderer.component.spec.ts:131-167`). Twelve malformed cases each render nothing and report
exactly one `renderFailed`:

- a null node;
- an unknown kind;
- a missing id;
- a missing `selectable`;
- a text input without a path;
- an input without a host value;
- a select with malformed options;
- a layout without children;
- a layout without `submitActions`;
- a malformed nested child;
- non-array v1 children;
- a cycle.

`:158`: a well-formed delegating override still renders, and its submit flushes the draft.

**Red/green.** I replaced the per-node check with `true` in a temp copy, ran `-t "malformed"`, then restored the file:
`Tests: 12 failed, 25 skipped, 1 passed` (all 12 malformed cases fail, and the well-formed case passes).

## Every other finding

| Review / item | Disposition |
| --- | --- |
| R1 must-check 2, 3, 4, 5 (confirmed correct) | No change needed. Carry-over (g) now also covers path changes (Fix 2). |
| R1 minor 3: the prune effect writes `state`, which it also reads | **Not changed.** It is still one self-terminating re-run. After a prune, the new record's bindings are known (`withoutDrafts`, `:374`), so the second pass finds nothing stale and publishes nothing. Removing the re-read would mean moving the prune out of an effect into every `state` writer, a larger change for no behaviour gain. |
| R1 carry-over to B15 ("clone the emitted object before storing") | **No longer needed.** Storing the emitted object as-is (batch-8-report "Notes for B15") is now correct for any number of surfaces and one mounted renderer. Restores are obeyed (Fix 1). |
| R2 fix-list 1, "delayed same-generation echo" test | Out of contract by design (Fix 1, "Accepted consequence"). Reset, restore, snapshot, re-creation, workspace and switch-back cases are all covered. |
| R2 fix-list 2, "blur, Enter and submit; unrelated drafts survive" | Done: specs `:306`, `:317`, `:324`, `:330`. |
| R2 fix-list 6, baseline diff check of the helper move, TS4029 and layout tracking | Not applicable to this executor (git is forbidden). The team-leader already recorded it in `batches.md:436-443`. |
| R2 "R6 re-run after page components land" | Unchanged. This is still a B15/B16 step. |

## Tests

| | Suites | Tests |
| --- | --- | --- |
| Before (batch-8-report) | 16 | 163 |
| After | 16 | 198 |

The +35 break down as:

- renderer: 15 → 38 (+23);
  - 6 new view-state specs, plus 1 rewritten in place;
  - 4 path-change specs;
  - 12 malformed cases and 1 well-formed override;
- text input: +1;
- trust boundary: 11 → 22 (+11): 1 list URL, 9 bypass cases and 1 comment-only negative.

No existing assertion was deleted. The two changed ones (renderer `:183`, trust `:296`) are explained above.

## Verification

```
npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard --skip-nx-cache --parallel=2 --output-style=static
Test Suites: 16 passed, 16 total
Tests:       198 passed, 198 total
✖ 62 problems (0 errors, 62 warnings)
 NX   Successfully ran targets lint, typecheck, test for project @ptah-extension/declarative-dashboard
```

The lint warnings are all `@typescript-eslint/no-non-null-assertion` in `*.spec.ts`. They went from 58 to 62, all 4
new ones in `surface-renderer.component.spec.ts`, which is the existing spec pattern. No non-spec file has a warning.

```
npx tsc -p libs/frontend/declarative-dashboard/tsconfig.spec.json --noEmit             → exit 0, no output
npx tsc -p libs/frontend/declarative-dashboard/tsconfig.lib.json --noEmit --declaration → exit 0, no output
```

## Deviations

1. **Fix 1 drops the guard rather than scoping it** (the reasoning is above). As a result, a parent that violates
   carry-over (a) can roll a draft back. That is the documented contract, not a regression.
2. **`surface-text-input.component.ts` was modified** (the `reconcileTyped` re-key). This was needed for Fix 1 to be
   correct at commit time, not just at display time. It stays inside this lib, and every B7 F1/F2 spec passes unchanged.
3. **Two pre-existing assertions were changed**, each explained above:
   - renderer `:183`: it pinned the refusal of a restore;
   - trust `:296`: it pinned the HTML-comment strip in TypeScript code.
4. **The trust spec imports `typescript`** (already a root devDependency) for a compiler-accurate comment stripper.

## Out of scope (not touched)

- `project.json`'s `typecheck` runs `ngc` on `tsconfig.lib.json` only, and ts-jest uses `isolatedModules`, so spec type
  errors stay invisible to `nx run-many`. Adding `tsc -p tsconfig.spec.json --noEmit` to the target (or a separate
  target) would make this permanent. That is a `project.json` change, owned by the team-leader or devops.
- A note for B15: the renderer now re-adopts the parent's `viewState` on any `surfaceId` change. Store and rebind each
  surface's emitted object as-is; no cloning is needed.
