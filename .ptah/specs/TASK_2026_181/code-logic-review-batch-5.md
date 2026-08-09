# Code Logic Review - TASK_2026_181, Batch 5 (Phase 3b: metadata editor + client write serialization)

## Review Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall Score       | 8/10     |
| Assessment          | APPROVED |
| Critical Issues     | 0        |
| Serious Issues      | 0        |
| Moderate Issues     | 2        |
| Minor Issues        | 2        |
| Failure Modes Found | 5        |

**Scope established independently**: `git status` against `HEAD` (`2f7426bf0`) shows 7
modified + 4 untracked files under `libs/frontend/tasks-ui/**` only. Nothing foreign staged.
Matches the Batch 5 inventory (Tasks 5.1–5.4) plus the disclosed out-of-inventory additions
(`task-metadata-write.ts`, the two wiring sites, the `chips()` rescoping, two new component
specs).

**Verification reproduced, uncached**:

- `npx nx test tasks-ui --skip-nx-cache` → **7 suites passed, 152/152 tests passed.** Matches
  the claimed 90 → 152 growth.
- `npx nx run-many -t typecheck,lint -p tasks-ui shared rpc-handlers vscode-lm-tools task-specs --skip-nx-cache`
  → all green; only pre-existing warnings in untouched files (`vscode-lm-tools`,
  `rpc-handlers`), 0 errors.
- `task-card.component.ts`: confirmed zero diff (`git diff --stat` empty) — Batch 3's
  zero-metadata pixel proof survives untouched.
- `task-start.service.ts`: confirmed zero diff — BR-8 holds.
- No new import of `@ptah-extension/editor` or any backend lib anywhere in the diff (grepped
  every added `from '@ptah-extension/...'` line — only `@ptah-extension/shared`). R11 and the
  frontend/backend isolation rule both hold.
- No local restatement of `32`, `12`, or a newline/Zod check anywhere in the diff (grepped for
  `MAX_LABEL`, `.max(`, `.min(`, `z.array`, `z.string()` — zero hits). The three label limits
  live only in the shared `TaskMetadataPatchSchema`.
- BR-7 literals (`task-tracking/`, `.ptah/tasks/`, `specs/TASK_2025_`, `TASK_2025_`): zero
  hits across the full diff and the four new files.

## The serialization primitive — `enqueueWrite`

Read against plan §3.5 verbatim; the shipped code matches the plan's pseudocode exactly,
including both load-bearing details.

**Interleavings constructed and traced:**

- **Two/three/six writes to the same task in one tick.** The store's own tests
  (`tasks-store.service.spec.ts:612`, `:637`) exercise 2 and 6 concurrent `applyMetadata`
  calls against a harness whose mock genuinely models overlap (see below) — zero spurious
  conflicts in both. Traced by hand: each `enqueueWrite` call synchronously reads
  `writeTails.get(taskId)` and synchronously re-`set`s it before returning, so N calls made
  in the same synchronous script are chained in call order with no gap where two could read
  the same `prev`.
- **A predecessor that rejects.** `prev.then(op, op)` — I verified this does not wedge the
  queue, both by tracing the code and by an isolated Node simulation (see below) and by the
  shipped test `does not wedge the queue when a predecessor rejects` (line 679), which
  reproduces exactly this: a successful `tasks:updateMetadata` followed by a `loadBoard()`
  that rejects. `first` rejects with the transport error; `second` (queued behind it) still
  runs and resolves successfully. Confirmed correct.
- **An early write settling beneath later ones.** The test at line 655
  (`keeps the queue intact when an early write settles under later ones`) enqueues four
  writes, settles the first while the second is in flight and the third is queued, then
  enqueues a fourth. I traced the promise-attachment order by hand: because writes 1–3 are
  all enqueued synchronously in the same tick, `writeTails` already holds write 3's tail
  _before any of the three ever settle_. When write 1's tail later resolves and its cleanup
  callback runs (`if (this.writeTails.get(taskId) === tail) delete`), the map already holds
  write 3's tail — a different object — so the identity check correctly refuses to delete,
  and write 4 (enqueued after) correctly waits behind write 3 instead of starting immediately
  and overlapping write 2. **The identity check does what it claims, under exactly the
  interleaving named in the docstring.**
- **Writes to different tasks.** `does not serialize writes to different tasks against each
other` (line 704) confirms two tasks proceed in parallel (`harness.pending()` reaches 2
  before either settles). The map is keyed per task id — no cross-task coupling exists in the
  code, so this is structural, not incidental.
- **Map leak check.** The cleanup `void tail.then(() => { if (map.get(id) === tail) delete })`
  fires for every tail, and the identity check means exactly one delete succeeds per
  chain — the one belonging to the currently-current tail. A task with no further writes
  therefore always empties out of the map once its chain settles. No leak.
- **`applyMetadata` never resolves ahead of the board.** `writeMetadata` performs the RPC
  write, checks `data.success`, and only then (when `reload` is true, the default) awaits
  `loadBoard()` (and `openTask()` for the currently-open task) before returning. The entire
  write-plus-reload sequence is the `op` the queue serializes, exactly as claimed — there is
  no path that returns success before the reload it promises.

**The `prev.then(op, op)` vs `prev.then(op)` claim — verified correct.** I built an isolated
Node simulation of four variants (store `tail` vs store `run` in the map, crossed with
two-handler vs single-handler `.then`) against the exact "predecessor rejects" scenario the
store spec drives:

```
SHIPPED (store tail, two-handler):        second runs, resolves cleanly — no wedge
MUTANT  (store run, single-handler):      second is wedged — rejects immediately, never runs
store run,  two-handler:                  second still runs (op ignores its argument)
store tail, single-handler:               second still runs (prev is always fulfilled)
```

This confirms the developer's reasoning precisely: **either safeguard alone is already
sufficient** for this scenario (storing `tail` means `prev` never rejects, regardless of
handler count; using two handlers means a rejected `prev` still runs `op`, regardless of what
is stored). The rejection handler is genuinely unreachable _as wired_ today — `prev` is always
a promise that will fulfil, never reject, because everything stored in the map is `tail`,
which swallows both outcomes. Only the **combined** regression (store `run` _and_ drop to
`then(op)`) reproduces a real wedge, and that is exactly the pair the batch pinned together.
The claim that this is deliberate defence-in-depth rather than dead code is correct, and the
comment states the mechanism precisely rather than overclaiming what today's code path
exercises.

## The guarantee's boundary — stated accurately

The docstring on `enqueueWrite` (`tasks-store.service.ts:686`) and the class-level docstring
on `applyMetadata` both say, in nearly identical language: this queue provides no
correctness — the writer's pre-write re-read does; the queue's only job is to stop the UI
from manufacturing a `TASK_CONFLICT` against itself. This is accurate and does not overclaim.
It would have been easy to write a comment implying "safe concurrent writes" without the
qualifier; the code doesn't do that, and the store spec's own comment block above
`describe('per-task write serialization', ...)` (line 538) repeats the same boundary. Good —
this is exactly the kind of comment that prevents someone from later "cleaning up" the
pre-write re-read as redundant.

## Adjudicated developer decisions

1. **All relation writes consolidated in `TaskRelationsComponent`, deviating from Task
   5.2/5.3's literal split.** Sound. The metadata editor (`task-metadata-editor.component.ts`)
   contains no relation logic at all; every add/remove for `dependsOn`/`duplicates`/`relatesTo`
   lives in `task-relations.component.ts`, including the cross-carrier `blocks` write. Splitting
   add from remove across two components would have meant two independent places computing a
   full-replacement patch for the same three arrays — precisely the shape Task 5.1 (one client
   mutation funnel) exists to prevent. Both components still emit through the identical
   `TaskMetadataWrite` → `apply` output → `applyMetadata`, so there is no functional
   duplication, only a UI-ownership deviation from the batch text. Not a rule violation.

2. **Client-side pre-validation is load-bearing.** Verified: `tasks-rpc.handlers.ts:498-506`'s
   `parse<T>` collapses every Zod failure to the literal string `'Invalid task request
parameters.'`, with no way for the wire to carry the specific issue message. Both
   `TasksStore.applyMetadata` and the two editing components import `TaskMetadataPatchSchema`
   from `@ptah-extension/shared` (not a local copy — confirmed by import statements and by the
   test helper `schemaMessage()` in three separate spec files, which reads the message directly
   out of the same schema rather than hardcoding a string). The `it.each` table in
   `tasks-store.service.spec.ts:493` explicitly asserts the surfaced text is **not** the RPC's
   generic sentence. Confirmed as described.

3. **`updateStatus` now issues `tasks:updateMetadata`, not `tasks:updateStatus`.** Confirmed.
   `registerUpdateStatus` and `registerUpdateMetadata` (`tasks-rpc.handlers.ts:335`, `:370`)
   both delegate to writer methods that share `applyFrontmatterPatch` (Batch 4), have
   structurally compatible result shapes (`TasksUpdateMetadataResult`'s error-code union is a
   superset — adds `INVALID_PARAMS`, which cannot occur on the `{ status }` patch since it is
   built internally, never from free text), and neither has separate telemetry. `task.md`
   docstring at `tasks-view.component.ts:56` ("... then `tasks:updateStatus` on success") is
   now stale — see Minor Issue 2 below — but that is a comment, not a behavioural gap. Nothing
   is lost on this path.

4. **Out-of-inventory files.** `task-metadata-write.ts` is a clean, single-purpose type with a
   docstring that correctly explains why `taskId` is carried explicitly (FR-B4.3's
   cross-carrier write). The `task-detail.component.ts` / `tasks-view.component.ts` wiring
   routes on `write.taskId`, confirmed never on `selectedTaskId()`
   (`tasks-view.component.ts:517`: `this.store.applyMetadata(write.taskId, write.patch)`). The
   `chips()` rescoping in `task-detail.component.spec.ts` is a correct, minimal, well-commented
   fix for a real selector collision the new remove buttons introduced. All four are legitimate.

## Failure Mode Analysis

### Failure Mode 1: Silent failure when the post-write board reload throws

- **Trigger**: `tasks:updateMetadata` succeeds, but the immediately following
  `this.loadBoard()` (inside `writeMetadata`, `tasks-store.service.ts:~795`) throws instead of
  resolving to a failed `RpcResult` — the exact "broken transport" scenario the code's own
  comment on the _write_ call acknowledges ("a broken transport can still throw").
- **Symptoms**: The carrier write already succeeded on disk. `store.applyMetadata(...)`
  (and therefore `store.updateStatus`) rejects. `TasksViewComponent.onApplyMetadata`
  (`tasks-view.component.ts:517`) awaits this inside a `try/finally` with **no `catch`**, so
  the rejection propagates out of an `async` method invoked from a template event binding —
  an unhandled promise rejection. `store.error()` is never set (the code path that sets it
  only wraps the `tasks:updateMetadata` call, not the reload), so no error banner appears.
  The webview does have a global `ErrorHandler` (`app.config.ts`) and
  `provideBrowserGlobalErrorListeners()`, so the rejection is caught and `console.error`'d
  rather than crashing anything — but nothing user-visible happens. The user has no way to
  tell "my edit was saved but the screen didn't refresh" from "my edit failed."
- **Impact**: No data loss — the write itself succeeded — but a confusing, silent UX gap in
  exactly the batch whose brief is "the user can now lose data from the UI." A user who
  retries the same edit believing it failed will not encounter a conflict (since the RPC
  write already changed the file and their new patch is still a valid full replacement), so
  this degrades to "confusing" rather than "harmful," but it is still a genuine gap.
- **Current handling**: None beyond the global console-only error handler.
- **Recommendation**: Wrap the reload/`openTask` continuation inside `writeMetadata` in its
  own try/catch, and on failure still return `data` (the write's own success/failure) while
  setting a distinct message such as "Saved, but the board could not refresh — reload
  manually." This preserves the write result's truthfulness instead of collapsing "write
  failed" and "refresh failed" into one rejection.
- **Confidence**: Medium-high on the mechanism (traced through the actual source, cross-checked
  against the store's own "predecessor rejects" test, which knowingly exercises and pins this
  exact rejection). Lower confidence on real-world frequency — `rpc.call` throwing (as opposed
  to resolving to a failed `RpcResult`) is stated by the developer's own comment to be rare.
  **Note for context**: this same unguarded-throw shape (`loadBoard`'s and `openTask`'s
  internal `rpc.call` are not wrapped either) already exists pre-Batch-5 throughout this store
  (e.g. the original `updateStatus`, `openTask`). Batch 5 does not introduce the underlying
  gap; it does add a new caller (`onApplyMetadata`) that inherits it without a catch, at the
  exact moment this task family starts letting users mutate data from the UI. Rated Moderate,
  not Serious, given the pre-existing pattern and no data loss — but flagged explicitly per
  the instruction to name uncertain risks rather than omit them.

### Failure Mode 2: `writing` is a single global flag, not per-task

- **Trigger**: The "this task blocks X" affordance issues a write to X's carrier while the
  currently open detail panel belongs to A. `TasksViewComponent.writing` (a single boolean)
  is set for the duration of _any_ outstanding write issued from the open panel, regardless of
  which carrier it targets.
- **Symptoms**: While that write is outstanding, every control in A's own editor (labels,
  estimate, parent) is also disabled, even though A's carrier is untouched by the in-flight
  write.
- **Impact**: Minor, and disclosed — `onApplyMetadata`'s own comment says as much ("only a UI
  affordance"). The store's actual per-task serialization is correct regardless of what
  `writing` displays, so this is conservatism, not a correctness bug. Not blocking.
- **Current handling**: Intentional simplification; documented.
- **Recommendation**: None required; noting for completeness only.
- **Confidence**: High that this is cosmetic only, not a data-safety issue.

### Failure Mode 3: Removing one duplicate-relation chip removes every copy

- **Trigger**: A carrier authored (by hand, or by an agent) with a literal duplicate entry in
  `depends_on` / `duplicates` / `relates_to` — legal per FR-B4.8, which explicitly allows the
  parser to preserve repeats. The relations component de-duplicates for **display**
  (`task-relations.component.ts:381`) and, on remove, filters the whole array **by value**
  (`onRemove`, line 467-472) — so pressing the single displayed chip removes _every_ copy of
  that id, not just one.
- **Symptoms**: A user with a hand-authored `dependsOn: [X, X]` who presses "remove" on the
  one visible `X` chip ends up with `dependsOn: []`, silently dropping a second entry they may
  not have known was there.
- **Impact**: Low — duplicate entries in a relation array are semantically redundant (the
  relation either holds or it doesn't; a duplicate carries no extra information), so collapsing
  them on an explicit user edit is arguably the more correct outcome, not a bug. It is also the
  only implementable behaviour given full-replacement-by-value semantics and a UI that cannot
  visually distinguish which physical duplicate the user meant. The behaviour is disclosed in
  the docstring and pinned by a test (`removes every copy of a repeated authored entry in one
action`).
- **Current handling**: Deliberate design choice, documented and tested.
- **Recommendation**: None required. Flagging only because "the array shrinks by more than the
  one chip that was clicked" is worth a reviewer's explicit sign-off given `.ptah/**` has no
  undo — and on inspection, the choice is sound.
- **Confidence**: High that this is intentional and reasonable, not a defect.

### Failure Mode 4: No-op patches are pre-empted client-side but rely on per-control guards, not a shared one

- **Trigger**: Every "would this patch actually change anything" check
  (`onEstimate`'s `(this.task().estimate ?? null) === next`, `onSetParent`'s
  `value === task.parent`, `onAdd`'s `held.includes(ref)` / `already depends on this task`) is
  hand-written per control rather than centralized. A future fifth field added to the editor
  that forgets its own no-op guard would reach the shared schema's
  `.refine((p) => Object.values(p).some((v) => v !== undefined))`, which only rejects a patch
  with **no** field present at all — not a patch whose one field is unchanged from the current
  value — and the write would proceed, needlessly touching `updated` and burning a
  no-op round trip through the writer.
- **Symptoms**: A future control without a guard silently issues real writes for unchanged
  values. Nothing today is missing a guard, so no live bug exists in this diff.
- **Impact**: None today; a latent consistency risk for whoever adds the sixth control later.
- **Current handling**: Every existing control (labels add/remove, estimate, parent
  set/clear, all four relation kinds) does have its own guard, verified by reading each
  handler individually.
- **Recommendation**: Non-blocking. Worth a one-line note in `TaskMetadataWrite`'s docstring
  for the next implementer, but not worth blocking this batch over.
- **Confidence**: High that no live instance exists in this diff; this is a forward-looking
  note, not a finding against Batch 5's actual code.

### Failure Mode 5: The "two rapid edits" mock is a reasonable proxy, not a byte-for-byte replica, of the writer's conflict check

- **Trigger**: The real backend refuses a write only when the on-disk **content** changed
  between read and write. The store-spec mock (`installWriteMock`,
  `tasks-store.service.spec.ts:560`) instead refuses whenever a second `tasks:updateMetadata`
  call for the same `taskId` arrives while an earlier one for that same id is still
  "active" (unsettled) — a proxy for "concurrent," not "content-changed."
- **Symptoms**: None in this suite — the proxy is stricter than the real writer (any overlap
  triggers it, not just an overlap that actually changes bytes), which makes it a valid
  _conservative_ substitute: if the client-side queue ever let two writes to the same task
  overlap, this mock would catch it every time, with no false negatives. It could in
  principle produce a false _positive_ relative to real-writer behaviour (flagging an overlap
  that the real writer would have tolerated, e.g. two reads racing but landing writes far
  enough apart), but that direction only makes the test stricter, never looser.
- **Impact**: None — I traced this by hand (see the primitive section above) and confirmed the
  mock cannot report zero conflicts unless the queue genuinely serialized the calls; it is not
  a tautology.
- **Recommendation**: None required.
- **Confidence**: High.

## Minor Issues

### Minor Issue 1: `AUTHORED_RELATION_FIELD`'s "unrepresentable" claim is slightly stronger than the type system enforces

- **File**: `libs/frontend/tasks-ui/src/lib/components/detail/task-relations.component.ts:26-39`
- The docstring says the absence of `blocks`/`duplicated_by` from `AUTHORED_RELATION_FIELD`
  makes removing a derived entry "unrepresentable... rather than merely unimplemented."
  `AUTHORED_RELATION_FIELD` is typed `Partial<Record<TaskRelationGroup, ...>>`, so nothing in
  the type system actually forbids a future edit from adding `blocks: 'dependsOn'` to the
  object literal — `Partial` permits any subset. The current _absence_ is correct and
  verified (confirmed `origin === 'authored'` is also false for the `blocks` group per
  `TASK_RELATION_GROUP_ORIGIN`, so there's a second independent guard), but "unrepresentable"
  overstates what the type alone guarantees; "not populated, and guarded a second way by
  origin" would be more precise. Not a functional defect — both guards are real and correct
  today.
- **Fix**: Optional wording tweak only; not blocking.

### Minor Issue 2: Stale docstring on `TasksViewComponent` still names `tasks:updateStatus`

- **File**: `libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts:56`
- Pre-existing comment: "...then `tasks:updateStatus` on success". As of this batch,
  `TaskStartService` → `store.updateStatus` → `applyMetadata` → `tasks:updateMetadata` on the
  wire. The comment was not touched by this diff and is now inaccurate about which RPC method
  fires. Purely documentation drift; not a behavioural issue, but exactly the kind of stale
  comment that could mislead someone answering the same "is anything lost?" question this
  review had to answer by reading the handler code directly.
- **Fix**: One-line comment update in a later batch; not blocking Batch 5.

## Edge Case Analysis

| Edge Case                                       | Handled         | How                                                                                                | Concern                                                                                                                                              |
| ----------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two writes to the same task, same tick          | YES             | Per-task promise tail                                                                              | None — traced and test-confirmed                                                                                                                     |
| Six-write burst to one task                     | YES             | Same mechanism                                                                                     | None — test-confirmed                                                                                                                                |
| Predecessor write rejects                       | YES             | `prev.then(op, op)`                                                                                | None — verified not to matter today (prev never rejects) but present as defence-in-depth, confirmed genuinely load-bearing under the paired mutation |
| Early write settles beneath later ones          | YES             | Identity check before `delete`                                                                     | None — hand-traced through actual promise attachment order                                                                                           |
| Writes to two different tasks                   | YES             | Per-key map                                                                                        | None — independent chains                                                                                                                            |
| Reload throws after a successful write          | **NO**          | Unhandled — propagates to a global console-only handler                                            | Silent UX gap, no data loss (Failure Mode 1)                                                                                                         |
| Duplicate relation entry, remove one chip       | YES (by design) | Removes all copies, filtered by value                                                              | Disclosed and tested; sound given full-replacement + de-duplicated display                                                                           |
| Over-long pre-existing label blocks other edits | YES             | Verbatim schema message; removing the offender itself succeeds                                     | None — recoverable, tested                                                                                                                           |
| Hostile label text (`<img onerror=...>`)        | YES             | `{{ interpolation }}` only, no `[innerHTML]`                                                       | None — tested, DOM has no `<img>`                                                                                                                    |
| Newline in a label via the input control        | N/A             | HTML value-sanitization strips CR/LF before `.value` is read; asserted at the store funnel instead | None — correctly reasoned and displaced to the layer that can actually receive one                                                                   |

## Requirements Fulfillment

| Requirement                                                                | Status   | Concern                                                                         |
| -------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------- |
| FR-B5.8 (same-task serialization)                                          | COMPLETE | None                                                                            |
| One client mutation funnel (`applyMetadata` / `tasks:updateMetadata`)      | COMPLETE | Verified no second path issues a carrier write from `tasks-ui`                  |
| Full-replacement semantics, `[]`/`null` removal, `dependsOn: []` exception | COMPLETE | Verified client never special-cases the removal asymmetry — the writer owns it  |
| FR-B4.3 — "B blocks A" writes A                                            | COMPLETE | Verified by test; no `blocks:` key anywhere in the diff                         |
| Three label limits live only in the shared schema                          | COMPLETE | No local restatement found anywhere in the diff                                 |
| `TaskIdRefSchema` imported, not reimplemented                              | COMPLETE | Consumed transitively via `TaskMetadataPatchSchema`; no local schema defined    |
| `deferNotify` has no production caller                                     | COMPLETE | Confirmed by grep — only definition + specs reference it                        |
| No backend imports; R11 (no `tasks-ui → editor`)                           | COMPLETE | Confirmed — only new imports are from `@ptah-extension/shared`                  |
| OnPush + `track` on every `@for`                                           | COMPLETE | Verified on all touched/new components; track-key choices assessed individually |
| Untrusted text via interpolation only                                      | COMPLETE | Verified with an explicit hostile-markup test                                   |
| Batch 3's zero-metadata pixel proof survives                               | COMPLETE | `task-card.component.ts` confirmed zero diff                                    |

## Verdict

**Recommendation**: APPROVE
**Confidence**: HIGH on the concurrency primitive and the binding-rule compliance (independently
traced, hand-simulated, and test-reproduced); MEDIUM on Failure Mode 1's real-world likelihood
(the mechanism is real and verified by reading the code, but the triggering condition —
`rpc.call` throwing rather than resolving to a failed result — is stated by the developer's own
comment to be rare, and the same gap pre-dates this batch elsewhere in the store).
**Top risk**: Failure Mode 1 — a post-write board refresh that throws produces an unhandled
rejection and no user-visible error, even though the underlying carrier write already
succeeded. Not blocking (no data loss, pre-existing pattern, narrow trigger), but worth a
follow-up fix given this is explicitly the batch where `.ptah/**` write correctness matters
most to the user.

## What a more bulletproof implementation would additionally include

- A try/catch around the reload continuation inside `writeMetadata`, distinguishing "write
  failed" from "write succeeded, refresh failed" in the returned result and in `store.error()`.
- A per-task (not global) `writing`/busy signal, so an in-flight cross-carrier `blocks` write
  does not disable an unrelated task's own editor controls.
- A shared "would this patch be a no-op" helper alongside `TaskMetadataPatchSchema`, so future
  controls inherit the guard instead of re-deriving it per field.
