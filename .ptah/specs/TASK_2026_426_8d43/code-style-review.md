# Code Style Review — `TASK_2026_426_8d43`

## Summary

| Metric          | Value          |
| --------------- | -------------- |
| Overall score   | 5/10           |
| Assessment      | NEEDS_REVISION |
| Blocking issues | 1              |
| Serious issues  | 5              |
| Minor issues    | 6              |
| Files reviewed  | 21             |

Scope: commits `5d94abb87`, `da107e522`, `13e105ce3`, `3415055ae` plus the
uncommitted working tree.

**Snapshot warning — the working tree moved during this review.** A concurrent
session was landing the `code-logic-review.md` fixes while I read.
`clone-body-editor.component.ts` went from 110 lines to 247 lines mid-review,
`test-report.md` appeared, and my first `lint` run reported a transient parse
error at a line number that did not yet exist on disk. Every finding below is
pinned to the snapshot in which `clone-body-editor.component.ts` has md5
`4ace9ebd6161ac259b97c692a761ff35` and 247 lines. If the concurrent session has
since moved that file, re-check the blocking issue first — it may already be
gone, and it is the only finding that could plausibly have been fixed in the
interval.

Evidence run in this worktree, uncached, against that snapshot:

- `nx run @ptah-extension/skill-synthesis-ui:lint --skip-nx-cache` → **1 error**,
  1 warning.
- `nx run @ptah-extension/skill-synthesis-ui:typecheck --skip-nx-cache` → **exit
  255**, `TS1005` ×3 and `TS1135` ×1.
- `nx run-many -t lint` for `marketplace`, `core`, `shared`, `rpc-handlers` → 0
  errors (19 pre-existing warnings, none in files this task touched).
- Import-boundary greps for the frontend↔backend rule and the
  `marketplace` ↔ `skill-synthesis-ui` edge → both clean (see Pattern
  compliance).

Why 5 and not 7: the committed work is genuinely strong — all five RPC
registration sites present, the new handler a faithful copy of its two
siblings, the sidecar rule documented at the line that enforces it, boundaries
clean — but the working tree does not compile, and user-facing copy is now
spread across four files in one lib with the barrel disagreeing about which of
them is contract. Why not 3: nothing here crosses an architectural boundary,
nothing branches on the host inside a shared lib, no `@ts-ignore`, no
`[innerHTML]`, and every `catch` narrows with `instanceof Error`.

---

## Five style questions

### 1. What breaks in six months?

The user-facing copy. This lib now keeps canonical sentences in four places:
`clone-action-gating.ts:36-98` (`BULK_REBASE_EXPLANATION`,
`KEEP_MINE_EXPLANATION`, `REBASE_EXPLANATION`),
`skill-clones-view.component.ts:90-100` (`DIVERGED_EMPTY_COPY`, `EMPTY_COPY`),
`clone-bulk-toolbar.component.ts:93-123` (the count sentences and the R1.1
disabled reason), and `clone-body-editor.component.ts:60-69`
(`EMPTY_BODY_REASON`, `BODY_CHANGED_UNDERNEATH`). The lib's own `CLAUDE.md`
names `clone-action-gating.ts` as the home for exactly this kind of sentence.
A copy revision six months out will find two of the four sets exported from
`index.ts` and two not, and will update the ones it can find.

Second: `harness-target-row.component.ts:131-135` and `:144-148` hold the same
four-line sentence twice, once in the `<button>` arm and once in the `<p>` arm.
Nothing in the spec suite compares the two.

### 2. What would a new team member misread?

`CloneBulkRebaseService`. It is exported from `index.ts:37`, and
`clone-bulk-rebase.service.ts:46-54` deliberately omits `providedIn` with an
eslint-disable and a paragraph of justification. A reader who takes the public
export at face value and injects it from another lib gets a `NullInjectorError`
at runtime, because the only provider is `skill-clones-view.component.ts:116`.
The export makes a surface-scoped service look global — the exact confusion the
comment on line 46 was written to prevent.

They would also misread `canEditCloneBody(clone, body)`
(`clone-action-gating.ts:144-149`), whose signature promises to consider the
clone and whose body reads only `body`.

### 3. What does this cost to maintain?

`SaveCloneBodyResult` (`user-layer-mirror.service.ts:175-183`) states two rules
in comments that the type could carry: `historyTs` is `string | null` with
"null only when `written` is false", and `reason` is `string | null` with
"`'clone-missing'` when the target file/dir is not on disk" — and
`'clone-missing'` is the only value the implementation ever produces
(`:551-558`, `:590-597`). The cost is visible at the one call site:
`skills-synthesis-rpc.handlers.ts:1350` writes
`if (!result.written || result.historyTs === null)`, and the second clause
exists only because the type does not link the two fields.

Separately, `libs/frontend/skill-synthesis-ui/CLAUDE.md` was edited by this task
(the stale "do not Electron-gate this tab" line removed — correct) but its
`## Public API` section still lists four symbols and `## Internal Structure`
still lists two files. One RPC method, one service, three components and six
exports went unrecorded in the file a future reader opens first.

### 4. Where is this inconsistent with the rest of the repository?

- The barrel is inconsistent with itself. `CloneBulkToolbarComponent` and
  `BulkRebaseConfirmComponent` stay internal — correct — while
  `CloneBodyEditorComponent` (`index.ts:16`) and `CloneBulkRebaseService`
  (`:37`) are exported, with no consumer outside the lib for either.
- `SkillSaveCloneBodyParamsSchema` (`skills-synthesis-rpc.schema.ts:398-416`) is
  inserted between `SkillRebaseCloneParamsSchema` and
  `SkillKeepCloneParamsSchema`, splitting the rebase/keep pair. Every other
  registration site in this task places it after keep:
  `skills-synthesis-rpc.handlers.ts:266`, `:375`, `rpc.types.ts:1744`.
- `skill-clones-view.component.ts:291-338` still resolves a divergence with an
  inline dialog while the structurally identical bulk confirmation was extracted
  to `bulk-rebase-confirm.component.ts`. Same file, same problem, two shapes.

### 5. What would you have done differently, and why is that better?

Put the toolbar's count-to-English rules in `clone-action-gating.ts` as a pure
`bulkToolbarCopy(...)` function rather than in a component's `computed` block.
Better, not merely other, for three reasons that are local to this repository:
`clone-action-gating.ts` is already the framework-free module the lib's
`CLAUDE.md` calls "the correctness layer"; it already owns the other three
canonical sentences, so the R1.1 disabled reason would sit beside
`BULK_REBASE_EXPLANATION` which the user reads two clicks later; and the rules
become unit-testable without TestBed, which is how
`clone-action-gating.spec.ts` already tests every other gating rule.

And I would have extracted the reconcile dialog alongside the bulk one, so the
file has one answer to "how do we ask for destructive consent" instead of two.

---

## Blocking issues

### Unescaped backticks terminate the component's template literal — the lib does not compile

- File: `libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-body-editor.component.ts:133-135`
- Problem: the `template:` value is a backtick-delimited TypeScript template
  literal. The HTML comment inside it quotes two identifiers in backticks:

  ```
  133:         `role="status"` so the reason reaches a screen reader on its own: a
  134:         DISABLED button takes no focus, so an `aria-describedby` alone would
  ```

  The first backtick at 133:9 closes the template literal. Everything after it
  is parsed as expression syntax.

- Impact: `@ptah-extension/skill-synthesis-ui` fails both gates, reproduced
  uncached:
  - `typecheck` → exit 255, `TS1005: ',' expected` at `133:10`, `134:48`,
    `134:52`, and `TS1135: Argument expression expected` at `149:1`.
  - `lint` → `133:9 error Parsing error: ',' expected`.

    The Angular compiler never sees the component, so the whole lib's build and
    every consumer of it is down. This is not a warning that can be triaged.

- Fix: drop the backticks from the comment — `role="status"` and
  `aria-describedby` read fine unquoted, which is what every sibling in-template
  comment already does (`clone-detail-drawer.component.ts:264-267`,
  `clone-bulk-toolbar.component.ts` has none, and
  `skill-clones-view.component.ts:114-115` keeps its backtick-free note *outside*
  the template). Escaping as `` \` `` would also compile but reads worse. Then
  re-run `typecheck` uncached — the Nx daemon served me a stale cached lint
  result for this file on the first attempt, so a cached green here proves
  nothing.

---

## Serious issues

### The escalated question, part 1 — `CloneBulkToolbarComponent`: keep the file, move the boundary

- File: `libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-bulk-toolbar.component.ts:1-124`
- Verdict: **KEEP — but the cut is in the wrong place.**
- It passes the nameability test outright: "clone bulk toolbar" is a domain
  name, not `helpers`/`utils`/`common`/`misc`. It did not push any constructor
  anywhere — `SkillClonesViewComponent` injects four dependencies
  (`skill-clones-view.component.ts:343-346`), well inside the ~8 guardrail. Two
  collaborators is inside the "prefer 2-3 over 6 fragments" guidance.
- Problem: the seam is wide and the concern is split. Five inputs and two
  outputs (`:78-87`) for 124 lines, with every input derived in the parent
  (`skill-clones-view.component.ts:203-209`) and all the state still owned
  there. About 35 of the 124 lines are the four `computed` string builders
  (`:93-123`) — and that is the concern the extraction actually claims:
  "the only place the count is turned into English" (`:8`). But English about
  clone actions already has a home. `clone-action-gating.ts` is pure,
  framework-free, named "the correctness layer" by the lib's `CLAUDE.md`, and
  already owns `BULK_REBASE_EXPLANATION`, `KEEP_MINE_EXPLANATION` and
  `REBASE_EXPLANATION`. Putting the count sentences in a component instead means
  the R1.1 disabled reason (`:118-123`) and the `BULK_REBASE_EXPLANATION` the
  user reads two clicks later now live in different files with different
  testing strategies.
- Tradeoff: the defence offered is that inlining crosses the 700-line ceiling.
  That is a cap argument, and the repository says in terms that line count alone
  is not the signal. The file survives on its own merit, not on that argument —
  so the argument should not decide where its edge sits.
- Recommendation: keep the component, but move `countLabel`, `buttonLabel`,
  `buttonText` and `disabledReason` into `clone-action-gating.ts` as one pure
  `bulkToolbarCopy({ eligibleCount, otherKindCount, progress })` returning the
  four strings. The component then binds them. Every count-to-English rule lands
  in one file, and `clone-action-gating.spec.ts` — which already covers every
  other gating rule without TestBed — covers these too.

### The escalated question, part 2 — `BulkRebaseConfirmComponent` is justified; its untouched twin is the finding

- File: `libs/frontend/skill-synthesis-ui/src/lib/components/clones/bulk-rebase-confirm.component.ts:1-90`
  vs `skill-clones-view.component.ts:291-338`
- Verdict on the extraction: **KEEP, unreservedly.** It is not a cap-driven
  fragment. It owns a contract no other file owns: the dialog role,
  `aria-modal` and accessible name (`:29-35`); the count stated in both the
  heading (`:39-41`) and the confirm control's accessible name (`:62-64`), so
  the count survives the button text changing mid-batch; and Confirm locking on
  `busy()` while Cancel stays reachable (`:53-66`). That is a reusable
  consent-gate contract, and it will still be one in six months. It was also
  named in the plan.
- Problem: the reconcile dialog, 200 lines below in the file the same batch
  owned alone, has the same shape and was left inline —
  `skill-clones-view.component.ts:291-338`: modal wrapper with
  `role="dialog"` + `aria-modal`, a title carrying the slug, an explanation
  paragraph, Cancel, and a destructive confirm disabled on `actionsLocked()`.
  Notably the inline one is the *weaker* of the two: its confirm button has no
  accessible name beyond its visible text, and its `aria-label` is the generic
  "Resolve divergence" rather than naming the entry.
- Tradeoff: extracting it was not in scope, and scope discipline is a real
  virtue. But the outcome is that one file now answers "how do we ask for
  destructive consent" two different ways, and the weaker answer is the one a
  reader meets second and may copy.
- Recommendation: follow-up, not blocking on this task — generalise
  `BulkRebaseConfirmComponent` into the reconcile dialog's shape (title slot,
  explanation, confirm label) and delete the inline block. Two dialogs, one
  contract.

### User-facing copy duplicated verbatim across two template branches

- File: `libs/frontend/marketplace/src/lib/harness/harness-target-row.component.ts:131-135`
  and `:144-148`
- Problem: the `<button>` arm and the `<p>" arm each carry their own copy of the
  same four-line sentence *and* the same pluralisation expression
  (`overwrittenLocalEdit.length === 1 ? 'edit' : 'edits'`). They are identical
  today and nothing keeps them so.
- Impact: a copy revision that edits one arm ships two different sentences to
  Electron and VS Code. The specs will not catch it: both assert substrings on
  different strings —
  `harness-health-badge.component.spec.ts:439` checks `'Skills library'` on the
  button's `aria-label`, `:459` checks `'user layer'` on the paragraph's text.
  Neither compares the two arms.
- Tradeoff: the repository's settled answer for a canonical sentence is a named
  constant rendered verbatim by every surface —
  `clone-action-gating.ts`'s `KEEP_MINE_EXPLANATION` is documented in
  `CLAUDE.md` as being rendered "verbatim" by the card, drawer and modal for
  exactly this reason.
- Recommendation: hoist the sentence to one `computed<string>()` (it needs the
  count, so a constant alone will not do) and interpolate it in both arms; or
  keep one text block in an `<ng-template>` and `ngTemplateOutlet` it into both.
  Either leaves one sentence to edit.

### Six symbols added to the public API with no consumer outside the lib

- File: `libs/frontend/skill-synthesis-ui/src/index.ts:16`, `:23-31`, `:37-41`
- Problem: `CloneBodyEditorComponent`, `CloneBulkRebaseService`,
  `BulkRebaseOutcome`, `BulkRebaseProgress`, `canEditCloneBody`,
  `eligibleForBulkRebase`, `BULK_REBASE_EXPLANATION` and `CloneBodySaveRequest`
  were all added to the barrel. I grepped every `.ts` under `libs` and `apps`
  outside `libs/frontend/skill-synthesis-ui` for each: **zero hits for all of
  them.** `CloneBodyEditorComponent` is used only by
  `clone-detail-drawer.component.ts`; `canEditCloneBody` only by
  `skill-clones-view.component.ts:448`.
- Impact, worst case first: `CloneBulkRebaseService` is `@Injectable()` with
  `providedIn` deliberately omitted and an eslint-disable justifying it
  (`clone-bulk-rebase.service.ts:46-54`), provided only at
  `skill-clones-view.component.ts:116`. Exporting the token publicly invites an
  injection that fails at runtime with `NullInjectorError`, and it contradicts
  the very comment written to stop that confusion. The rest is surface that must
  now be kept API-stable for no caller.
- Tradeoff: the barrel was already wide before this task (`CloneCardComponent`,
  `CloneDetailDrawerComponent`, `EnhancePreviewDrawerComponent` are all
  exported), so there is precedent. But this task also demonstrates the right
  instinct twice — `CloneBulkToolbarComponent` and `BulkRebaseConfirmComponent`
  were correctly left internal. The barrel is inconsistent with itself within
  one commit.
- Recommendation: remove `CloneBulkRebaseService`, `BulkRebaseOutcome`,
  `BulkRebaseProgress` and `CloneBodyEditorComponent` from `index.ts`. Keep
  `CloneBodySaveRequest` (it is in `CloneDetailDrawerComponent`'s emitted
  output type, and that component is public, so it is genuinely reachable).
  Decide `canEditCloneBody` / `eligibleForBulkRebase` /
  `BULK_REBASE_EXPLANATION` as a set with the three gating constants already
  there — either the gating module is public API or it is not.

### The lib's `CLAUDE.md` was edited but not brought up to date

- File: `libs/frontend/skill-synthesis-ui/CLAUDE.md:63` (`## Public API`) and
  `:66-69` (`## Internal Structure`)
- Problem: the task edited this file — removing the stale
  "Do not Electron-gate this tab" guideline, which was right and matches the
  Runtime section already there. But `## Public API` still reads "From
  `src/index.ts`: `SkillSynthesisTabComponent`, `SkillSynthesisRpcService`,
  `SkillSynthesisStateService`, plus `SkillStatusFilter` type" against an
  `index.ts` that now exports ~25 symbols, and `## Internal Structure` still
  names two files against a `clones/` directory of twelve.
- Impact: the per-directory instruction file is the first thing a future reader
  and a future agent consult for this area's public surface and boundaries.
  It now understates the surface by an order of magnitude, and the
  "Library (clones) surface" section mentions neither the body editor, nor the
  bulk rebase, nor the diverged filter, nor `skillSynthesis:saveCloneBody`.
- Tradeoff: none — the file was already open in this task.
- Recommendation: update `## Public API` to state the real surface (or a rule
  for it), add `clone-body-editor.component.ts`, `clone-bulk-toolbar.component.ts`,
  `bulk-rebase-confirm.component.ts` and `clone-bulk-rebase.service.ts` to the
  Library section, and record the sidecar rule that
  `saveCloneBody` depends on — it is the least obvious constraint in the task
  and it currently lives only in a backend docblock.

### A result type states in comments what it could state in the type

- File: `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:175-183`
- Problem: `historyTs: string | null` documented as "`null` only when `written`
  is false", `reason: string | null` documented as "`'clone-missing'` when the
  target file/dir is not on disk". The implementation produces exactly two
  shapes and exactly one `reason` literal (`:551-558`, `:576`, `:590-597`,
  `:613`). The declared type admits any string and every combination.
- Impact: measurable at the single call site.
  `skills-synthesis-rpc.handlers.ts:1350` must write
  `if (!result.written || result.historyTs === null)` — the second clause is
  dead under the documented contract and exists only because the type does not
  link the fields. `reason` being `string` also means a future third failure
  mode can be added without any consumer noticing.
- Tradeoff: the flat shape matches the sibling `RebaseResult`
  (`user-layer-mirror.service.ts:149-156`), and sibling consistency is a real
  defence. But `RebaseResult.reason` carries a free-form message out of a
  `catch`, so `string` is honest there; here the set is closed at one member.
- Recommendation: a discriminated union on `written`, so `historyTs` narrows to
  `string` on the success arm and `reason` to `'clone-missing'` on the failure
  arm. The handler's guard collapses to `if (!result.written)` and the two
  comments become unnecessary rather than load-bearing.

---

## Minor issues

- `skills-synthesis-rpc.schema.ts:398-416` — the new schema is inserted between
  `SkillRebaseCloneParamsSchema` and `SkillKeepCloneParamsSchema`, splitting the
  rebase/keep pair. Every other site orders it after keep.
- `libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts:184-185` — no blank
  line between `SkillSynthesisSaveCloneBodyParams` and
  `SkillSynthesisSaveCloneBodyResult`; every other interface pair in the file
  has one.
- `clone-action-gating.ts:144-149` — `canEditCloneBody(clone, body)` never reads
  `clone`, and the function is in the public API. The behavioural consequence is
  code-logic-review's finding ("the editor is offered for orphaned entries"); the
  style half is that an exported two-parameter signature reads one parameter, and
  `@typescript-eslint/no-unused-vars` cannot catch it because the unused argument
  precedes a used one.
- `clone-body-editor.component.ts:43` — `let nextEditorId = 0` is the only
  module-level id counter in `libs/frontend` (verified by grep). It works; it has
  no local precedent to follow.
- `clone-body-editor.component.ts:226-227`, `:244-246` — `viewChild` declared
  after the `computed` block and `ngAfterViewInit` last, whereas
  `bulk-rebase-confirm.component.ts` and `clone-bulk-toolbar.component.ts` keep a
  clean inputs → outputs → derived order. Nothing enforces member ordering here,
  so this is preference.
- Two spellings of the Electron check now coexist inside one task:
  `harness-health-badge.component.ts:211` uses the `vscodeService.isElectron`
  getter, `skill-clones-view.component.ts:365` the older
  `config()?.isElectron === true`. Both are genuinely reactive — the getter reads
  `_config()` at `vscode.service.ts:171-172` — and both have precedent
  (`update-dialog.component.ts:101` vs `memory-curator-tab.component.ts:298`), so
  this costs nothing today. The getter is the form to converge on.

---

## File-by-file

### `clone-body-editor.component.ts`

Score 3/10 — 1 blocking, 0 serious, 3 minor. The component's design is good: the
`DraftState` triple (`:50-57`) holding text, seed and incoming as one value so
the seed cannot drift from the text it explains is a genuinely better answer than
the `linkedSignal(() => this.value())` it replaced, and `onSave()` re-checking
`canSave()` (`:238-241`) treats the disabled attribute as affordance and the
guard as guarantee. But the file does not compile (`:133-135`), and the two new
copy constants at `:60-69` are the fourth home for user-facing sentences in this
lib.

### `clone-bulk-toolbar.component.ts`

Score 6/10 — 0 blocking, 1 serious, 0 minor. Clean, OnPush, presentational,
decides no eligibility rule, starts no write, and every `computed` is documented
with the requirement it serves. The file earns its existence; the boundary is
drawn at the render seam rather than the concern seam, leaving count-to-English
in one file and action-to-English in another.

### `bulk-rebase-confirm.component.ts`

Score 8/10 — 0 blocking, 0 serious, 0 minor. The best-argued file in the task.
Its docblock states what it is not (`:8` — "NOT a `helpers` split") and then
earns the claim with an accessible dialog contract no other file owns. The one
mark against it is external: its twin at `skill-clones-view.component.ts:291-338`
was left inline.

### `skill-clones-view.component.ts`

Score 6/10 — 0 blocking, 1 serious (shared with the confirm dialog), 1 minor.
Smart/presentational split is respected throughout: every child gets derived
inputs and emits intent, every write path sets a busy flag in a `try` and clears
it in a `finally` (`:607-623`, `:626-639`, `:681-692`), and every `catch` is
`(err: unknown)` narrowed through `toMessage` (`:744-746`). The
`divergedFilterRequested` input with its docblock explaining why it is *not* a
second `consumeSkillsDivergedRequest()` read (`:348-357`) is exactly the Concern 3
decision, implemented and documented. Holds two dialog idioms and two copy
constants that belong in `clone-action-gating.ts`.

### `skills-synthesis-rpc.handlers.ts`

Score 8/10 — 0 blocking, 0 serious, 1 minor. `registerSaveCloneBody`
(`:1318-1377`) is a faithful sibling of `registerRebaseClone` and
`registerKeepClone`: same `parseParams`-outside-`try` ordering, same
`requireDesktop` pair, same `getBySlug` existence check with the same message
shape, same `RpcUserError` rethrow then `report` then `toUserError` tail. The
`as SkillRegistryKind` / `as SkillCloneKind` casts are the established sibling
pattern (`:1243`, `:1268`), not new looseness. The docblock explains the
no-registry-write rule, which is the non-obvious part. Only mark: the redundant
`|| result.historyTs === null` at `:1350`, which is the result type's fault.

### `user-layer-mirror.service.ts`

Score 7/10 — 0 blocking, 1 serious, 0 minor. `saveCloneBody` (`:537-546`) is
correctly a thin `withSlugLock` dispatcher over two private kind-specific
methods, matching the shape of the reconcile paths beside it, and both private
methods call `assertUnderUserLayer` on every path they build before touching it
(`:556-557`, `:585-586`). The docblock is the best in the task: it states why
this is not `writeEnhancedSkill`, and it states the sidecar rule at the place
that enforces it rather than in a spec. Loses a point only for the result type.

### `harness-target-row.component.ts`

Score 5/10 — 0 blocking, 1 serious, 0 minor. The capability input +
navigation output shape is right: the row learns nothing about `AppStateManager`
and the badge does the injecting (`harness-health-badge.component.ts:206`,
`:158-162`), so the presentational component stays presentational and the
`Complexity Level` note in the docblock was updated to match (`:35`). Marked down
for the duplicated sentence.

### `app-state.service.ts`

Score 8/10 — clean. `_skillsDivergedRequest` (`:276-281`) is kept outside
`ViewSlice` with the reason stated — retained navigation pointers versus a
one-shot intent — and `consumeSkillsDivergedRequest` (`:608-613`) is an honest
read-and-clear that the spec pins twice (`app-state.service.spec.ts:218-227`:
true then false). This is the file that keeps `marketplace` and
`skill-synthesis-ui` from knowing about each other, and it does the job in 18
lines.

### `index.ts`

Score 4/10 — 1 serious. Six symbols with no consumer, one of which cannot be
injected by the consumers the export invites.

### `libs/frontend/skill-synthesis-ui/CLAUDE.md`

Score 4/10 — 1 serious. The one change made was correct and overdue. Everything
the task added went unrecorded.

---

## Pattern compliance

| Repository rule or nearby convention                                                   | Status         | Evidence                                                                                                                                                        |
| -------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend libs must not import backend libs                                             | PASS           | Grep for `@ptah-extension/{agent-generation,rpc-handlers,platform-*,vscode-core,persistence*}` across `skill-synthesis-ui`, `marketplace`, `core` → zero hits    |
| No new edge between `marketplace` and `skill-synthesis-ui`                             | PASS           | Neither lib imports the other; the deep link goes `harness-health-badge.component.ts:206` → `AppStateManager` → `skill-synthesis-tab.component.ts:729`          |
| `libs/shared` is the one bridge for cross-side types                                   | PASS           | `rpc-skill-clone.types.ts:179-193` declares both param and result types; frontend and backend both import from `@ptah-extension/shared`                          |
| RPC dual-registration (`rpc.types.ts` + runtime prefix guard)                          | PASS           | `rpc.types.ts:1744` + `:3597`; `ALLOWED_METHOD_PREFIXES` already carries `'skillSynthesis:'` at `vscode-core/.../rpc-handler.ts:81`, correctly left unedited     |
| All five registration sites present (manifest invariant)                                | PASS           | `rpc.types.ts:1744`, `:3597`; `skills-synthesis-rpc.handlers.ts:266` (`METHODS`), `:375` (`register*` call); `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts:149` |
| Zod schema at the external boundary, before any path is built                           | PASS           | `skills-synthesis-rpc.schema.ts:412-416`; `parseParams` runs outside the `try` at `skills-synthesis-rpc.handlers.ts:1331-1335`, before `join`                    |
| Never expose a raw error message across the boundary                                    | PASS           | `skills-synthesis-rpc.handlers.ts:1372-1375` reports then `toUserError`; pinned by the `EPERM` spec at `skills-synthesis-rpc.handlers.spec.ts` (`PERSISTENCE_UNAVAILABLE`) |
| `catch (error: unknown)` narrowed with `instanceof Error` before `.message`              | PASS           | `clone-bulk-rebase.service.ts:41-43`; `skill-clones-view.component.ts:744-746`; `skill-clones-state.service.ts:184-186`                                          |
| No `@ts-ignore`                                                                         | PASS           | None in the changed set; the one suppression is `@angular-eslint/use-injectable-provided-in` with a stated reason (`clone-bulk-rebase.service.ts:53`)             |
| `export type` for type-only re-exports                                                  | PASS           | `index.ts:12-15`, `:28-31`, `:38-41` all use `export type`                                                                                                       |
| No `[innerHTML]` on model-generated content                                             | PASS           | Editor is a plain `<textarea>` with `[ngModel]` (`clone-body-editor.component.ts:84-93`); read-only half stays `ptah-markdown-block`                             |
| `ChangeDetectionStrategy.OnPush` mandatory                                              | PASS           | `bulk-rebase-confirm.component.ts:27`, `clone-bulk-toolbar.component.ts:26`, `clone-body-editor.component.ts:74`                                                  |
| Signals + `inject()`, no constructor injection                                          | PASS           | `skill-clones-view.component.ts:343-346`; `clone-bulk-rebase.service.ts:56`; constructors hold only `effect()`                                                    |
| `kebab-case.ts` file naming                                                             | PASS           | All four new files                                                                                                                                               |
| New RPC method / schema / type names read like their siblings                            | PASS           | `skillSynthesis:saveCloneBody` beside `keepClone`/`rebaseClone`; `SkillSaveCloneBodyParamsSchema`, `SkillSynthesisSaveCloneBody{Params,Result}` all follow form   |
| `UPPER_SNAKE` DI tokens via `Symbol.for(...)`                                            | NOT_APPLICABLE | No new DI token; the new service is an Angular `@Injectable()`                                                                                                    |
| Adapters named `{platform}-{capability}.ts`                                              | NOT_APPLICABLE | No new adapter                                                                                                                                                   |
| No environment branching inside a shared lib                                            | PASS           | The host check is a capability *input* on the presentational row (`harness-target-row.component.ts:135`), decided by the smart parent                             |
| File-size soft ceiling (700, warn)                                                      | PASS (with note) | `skill-clones-view.component.ts` counts 591 and reports 0 problems. `skill-synthesis-tab.component.ts` warns at 1175 — pre-existing, and this task added ~31 lines to it |
| Canonical user-facing sentence lives in one named constant                               | **FAIL**       | Four homes: `clone-action-gating.ts:36-98`, `skill-clones-view.component.ts:90-100`, `clone-bulk-toolbar.component.ts:93-123`, `clone-body-editor.component.ts:60-69`; plus the verbatim duplication at `harness-target-row.component.ts:131-135`/`:144-148` |
| `src/index.ts` is the only public surface, and exports have consumers                    | **FAIL**       | Six new exports, zero consumers outside the lib (`index.ts:16`, `:23-31`, `:37-41`)                                                                              |
| Per-lib `CLAUDE.md` records the public surface it promises                                | **FAIL**       | `libs/frontend/skill-synthesis-ui/CLAUDE.md:63`, `:66-69` unchanged against ~25 exports and twelve `clones/` files                                                |
| Project lint and typecheck green                                                        | **FAIL**       | `clone-body-editor.component.ts:133` — `lint` 1 error, `typecheck` exit 255 (`TS1005` ×3, `TS1135`), both reproduced with `--skip-nx-cache`                       |

---

## Maintenance debt

- **Introduced**: a fourth home for user-facing copy in one lib, and a fifth
  copy-of-a-copy in `marketplace`. Six public exports with no consumer, one of
  which is not injectable by anyone the export invites. Two dialog idioms in one
  file. A per-lib `CLAUDE.md` whose Public API section is now an order of
  magnitude out of date. Two type-level rules kept as comments, costing one
  redundant guard.
- **Retired**: a genuinely wrong instruction — the "do not Electron-gate this
  tab" guideline in `libs/frontend/skill-synthesis-ui/CLAUDE.md`, which
  contradicted the Runtime section directly above it. The `DraftState` rework in
  `clone-body-editor.component.ts:50-57` also retires the silent-draft-loss
  behaviour rather than papering over it, and `skill-clones-state.service.ts:112`
  retires the stale-detail hazard with a `detailKey` guard rather than a comment.
- **Net**: mildly negative on structure, positive on correctness documentation.
  The docblocks in this task are unusually good — several of them state a rule at
  the line that enforces it, which is the opposite of debt. The debt is that the
  same instinct was not applied to the barrel or to `CLAUDE.md`, and that the
  effort went into splitting a 591-counted-line file while the 1175-line
  `skill-synthesis-tab.component.ts` it wires into took new wiring untouched.

---

## Verdict

- Recommendation: **REVISE**
- Confidence: HIGH on the blocking issue (reproduced twice, uncached, with
  compiler output) and on the boundary and registration findings (greps and
  file:line on every claim). MEDIUM on the two extraction verdicts, which are
  judgement calls on a guardrail the repository states as approximate. LOW on
  the stability of the working tree — a concurrent session was editing
  `clone-body-editor.component.ts` throughout this review.
- Key concern: `clone-body-editor.component.ts:133-135` closes the component's
  template literal with an unescaped backtick, so the lib does not compile.
  Everything else is structural and can be scheduled.
- What a 10/10 version would do differently:
  1. Remove the backticks at `:133-135` and re-verify `typecheck` uncached — the
     Nx daemon served a stale cached lint result for this exact file.
  2. Move `countLabel` / `buttonLabel` / `buttonText` / `disabledReason` out of
     `clone-bulk-toolbar.component.ts:93-123` into a pure `bulkToolbarCopy(...)`
     in `clone-action-gating.ts`, beside `BULK_REBASE_EXPLANATION`. Move
     `DIVERGED_EMPTY_COPY` / `EMPTY_COPY` and `EMPTY_BODY_REASON` /
     `BODY_CHANGED_UNDERNEATH` there too. One home for every sentence.
  3. Hoist the `harness-target-row.component.ts` sentence to a single
     `computed<string>()` and interpolate it in both arms.
  4. Drop `CloneBulkRebaseService`, `BulkRebaseOutcome`, `BulkRebaseProgress`
     and `CloneBodyEditorComponent` from `index.ts`.
  5. Make `SaveCloneBodyResult` a discriminated union on `written`, and delete
     the now-dead `|| result.historyTs === null` at
     `skills-synthesis-rpc.handlers.ts:1350`.
  6. Update `libs/frontend/skill-synthesis-ui/CLAUDE.md` — real Public API, the
     four new `clones/` files, and the sidecar rule that `saveCloneBody` depends
     on.
  7. Generalise `BulkRebaseConfirmComponent` over the reconcile dialog and
     delete the inline block at `skill-clones-view.component.ts:291-338`, so the
     surface has one consent-gate contract.
