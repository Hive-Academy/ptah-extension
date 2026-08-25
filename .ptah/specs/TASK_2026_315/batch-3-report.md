# Batch 3 — A2: Tasks board refetches forever against no workspace

**Status**: complete. Tasks 3.1 and 3.2 implemented.
**Executor**: frontend-developer
**Backend**: untouched. `tasks-rpc.handlers.ts:1455-1469` (`resolveRoot`) was read
only, and is unchanged. The whole fix is in `libs/frontend/tasks-ui`.

## Files changed (4, all under `libs/frontend/tasks-ui/`)

| File                                                                                                | Change                                        |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `D:\projects\ptah-extension\libs\frontend\tasks-ui\src\lib\services\tasks-store.service.ts`         | Task 3.1 — refusal state + reconcile gate     |
| `D:\projects\ptah-extension\libs\frontend\tasks-ui\src\lib\components\tasks-view.component.ts`      | Task 3.2 — third empty state + header actions |
| `D:\projects\ptah-extension\libs\frontend\tasks-ui\src\lib\services\tasks-store.service.spec.ts`    | 6 new store tests (the named deliverable)     |
| `D:\projects\ptah-extension\libs\frontend\tasks-ui\src\lib\components\tasks-view.component.spec.ts` | 3 new component tests                         |

**One file beyond the declared "Files touched" list**, disclosed deliberately:
`tasks-view.component.spec.ts`. Task 3.2's acceptance criteria are about what
renders and what the new block does NOT offer, and nothing in the store spec can
assert that. It is a spec file in the same lib as the other three, so it cannot
collide with the concurrent backend batch. No other file was opened for writing.

## How the fetch is gated, and where workspace state is read from

**Workspace state is read from `AppStateManager.workspaceInfo` and nowhere else.**
No new workspace signal was added. The store's existing `activeRoot()`
(`:1913`) and `activeKey()` (`:1918`) already read it; they are what scope every
`tasks:*` RPC, what key the per-workspace board cache, and what
`setupWorkspaceSwitch`'s effect watches. All three are unchanged.

The one signal added is `_noWorkspace` — a **fetch outcome**, in the same family
as `_error` and `_loaded`, not a second answer to "is a folder open". It records
only this: _the last `tasks:board` for the active workspace came back refused
with the typed `WORKSPACE_NOT_OPEN` code._ The distinction matters in the other
direction too, and is written into the doc comment on the field: deriving the
flag from `workspaceInfo` would have been wrong, because the webview's copy can
lag the host's (it is seeded from `window.ptahConfig` and pushed by the shell),
and a board blanked on a stale local read is worse than one blanked on the
host's own answer. So the host's answer is what latches it, and `workspaceInfo`
is what releases it.

**Three edits, in `tasks-store.service.ts`:**

1. `fetchBoard` — the response is now three-way, not two-way. Success clears the
   flag; `result.errorCode === 'WORKSPACE_NOT_OPEN'` sets it and clears
   `_error`; **anything else** clears the flag and sets `_error` exactly as
   before. The code is matched exactly, so a timeout, a scan crash or a dropped
   message still surfaces as an error banner and still stays retryable.
2. `setupVisibilityReconcile` — one new guard, `if (this._noWorkspace()) return;`,
   after the existing `_loaded() && !_loading()` pair. This is the fix.
3. `onWorkspaceSwitch` — clears the flag alongside the existing `_error.set(null)`,
   before the fetch. This is the release path, and it is why opening a folder
   needs no manual refresh: `workspaceInfo` moves → `activeKey()` changes → the
   existing effect calls `onWorkspaceSwitch` → clean slate → fetch.

`isEmpty` was also made explicitly false while the refusal holds, so the two
states are mutually exclusive at the store rather than by template branch order.
A second surface therefore cannot reach the create CTA by asking the questions
in the other order.

### On the root cause, precisely — and what was deliberately NOT changed

`fetchBoard`'s `finally` still sets `_loaded = true` on the non-success path.
That is intentional and is argued in a code comment at the new guard.

`_loaded` means "a fetch resolved, stop showing the first-visit spinner", and
that is true of a failure too. More importantly, leaving the reconcile armed
after a _generic_ failure is correct behaviour — a timeout can succeed on the
next focus, and this is the surface's only recovery path for it. What was
actually missing is narrower: one refusal is permanent until an external event,
and nothing in the store said so. With `_loaded` latched, the
`_loaded() && !_loading()` pair could never gate anything, and every `focus` and
`visibilitychange` bought one more rejected round trip — nine in the captured
log. Suppressing `_loaded` on the error path would have stopped the loop by
disabling recovery for every other failure class as well; the typed gate stops
exactly the one case that cannot recover on its own.

## The three UI states, and their `data-testid` values

`tasks-view.component.ts`, body region. Branch order:
spinner → **no-workspace** → empty-with-CTA → board/filtered-empty.

| State                    | Condition                | `data-testid`                                       | Create affordance        |
| ------------------------ | ------------------------ | --------------------------------------------------- | ------------------------ |
| Not loaded               | `loading() && !loaded()` | — (spinner)                                         | —                        |
| **No folder open (new)** | `store.noWorkspace()`    | `tasks-no-workspace` (+ `tasks-no-workspace-retry`) | **none**                 |
| Empty with CTA           | `store.isEmpty()`        | — (pre-existing)                                    | "Create your first task" |
| Filter matches nothing   | `store.filteredEmpty()`  | `tasks-filtered-empty`                              | none                     |

The new block copies the filtered-empty shape at `:441-470`: centred column,
`aria-hidden` glyph, heading, explanatory sentence, one outline button. It reads
"No folder is open" and explains that the board reads `{{ specRoot }}` out of
the open folder — the path comes from the shared `SPEC_ROOT` constant already
exposed on the component, never hand-written.

Three deliberate calls in this block:

- **No create CTA.** A task is a folder under `.ptah/specs`; with no workspace
  there is nowhere to put one, so the button could only produce the same refusal
  the user is already reading.
- **The glyph uses `text-base-content-muted`, not `text-base-content/20`.** The
  no-alpha ratchet in `apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts`
  records this exact file as holding **two** `/20` decorative exceptions, keyed
  to the class string AND an exact count, and a third would be an offender. Using
  the non-alpha token keeps the count at two and left that app's file untouched.
  Verified by running that spec (below).
- **"Check again" is not the recovery path.** Opening a folder is, and it reloads
  by itself. The button exists for the one case this state cannot detect locally
  — the webview's view of the workspace having drifted from the host's. One
  click, one request; it re-asks, it does not resume polling.

Four header buttons (Registry, Tidy finished, Reindex, New Task) are now disabled
while `noWorkspace()` holds, and New Task gained `data-testid="tasks-create-trigger"`.
Each of them writes into `.ptah/specs` through the same namespace and could only
earn the same refusal — rendered as a red banner over a panel that has just
calmly explained that no folder is open. Disabling them is what makes "offers no
create affordance" true of the whole screen rather than of one block in the
middle of it. The palette trigger is deliberately left enabled: it acts on the
board and the selection, both empty here.

## The store test: "no workspace → one call, N focus events → still one call"

`tasks-store.service.spec.ts`, new top-level describe **`TasksStore — no workspace open`**
(6 tests). The named one is:

> `calls tasks:board once with no workspace, and N focus events buy no more`

`AppStateManager` is provided as `{ workspaceInfo: signal(null) }` — the state
`workspace:removeFolder` leaves behind. The RPC double answers every
`tasks:board` with the host's typed refusal
(`{ success: false, error: 'No workspace folder open.', errorCode: 'WORKSPACE_NOT_OPEN' }`).
One `loadBoard()`, then **five** iterations of `focus` + `visibilitychange` with
a microtask flush between each. Asserts one call total.

It also asserts `loaded() === true` and `loading() === false` before the loop, so
the test pins that the OLD guard is genuinely wide open at that moment. Without
that, the test could later start passing for the wrong reason (a stuck spinner,
say) if `_loaded` semantics move.

**Fail-before / pass-after, verified by execution.** With
`if (this._noWorkspace()) return;` neutered to `if (false && …)`:

```
● TasksStore — no workspace open › calls tasks:board once with no workspace, and N focus events buy no more
  Expected number of calls: 1
  Received number of calls: 6
```

Six, not eleven, because `focus` and `visibilitychange` inside one flush collapse
via the pre-existing `_loading` debounce — one refetch per iteration, which is
exactly the captured log's shape. Guard restored, test green.

The other five store tests:

- refusal is recorded as `noWorkspace`, with `error() === null` **and**
  `isEmpty() === false` — it is neither the banner nor the create-CTA state;
- a generic failure (`err('scan-failed')`, no `errorCode`) still sets `error()`,
  leaves `noWorkspace()` false, and **is still retried on the next focus** (2 calls);
- setting `workspaceInfo` from `null` to a real folder loads the board with the
  new `workspaceRoot` and no manual refresh;
- an explicit reload that succeeds re-arms the focus reconcile;
- closing a folder again (`workspaceInfo` back to `null`) re-latches: one call,
  then focus buys nothing.

Component tests (`no folder open` describe): the panel renders with no
`.alert-error` on screen; no create affordance anywhere (no "Create your first
task" text, `tasks-create-trigger` and `tasks-sweep-trigger` both `disabled`);
"Check again" issues exactly one additional `tasks:board` and the state holds.

## Commands run

| Command                                                                                                         | Result                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx test tasks-ui --skip-nx-cache` (first attempt)                                                          | **FAILED** — my template comment contained backticks inside the component's template literal, breaking the parse. Fixed by writing those comments without backticks (the file's existing template comments never use them).                               |
| `npx nx test tasks-ui --skip-nx-cache`                                                                          | **PASS** — 18 suites, 571 tests (was 514 + 9 new + the suite that had failed to parse)                                                                                                                                                                    |
| `npx jest --config libs/frontend/tasks-ui/jest.config.ts -t "focus events buy no more"` with the guard neutered | **FAILED as required** — expected 1, received 6                                                                                                                                                                                                           |
| same, guard restored (inside the full run above)                                                                | **PASS**                                                                                                                                                                                                                                                  |
| `npx nx lint tasks-ui --skip-nx-cache`                                                                          | **PASS** — 0 errors. 3 pre-existing `max-lines` warnings (`task-list.component.ts` 911, `tasks-view.component.ts` 1078, `tasks-store.service.ts` 1037); all three were already over before this batch and `task-list.component.ts` was not touched at all |
| `npx nx typecheck tasks-ui --skip-nx-cache`                                                                     | **PASS**                                                                                                                                                                                                                                                  |
| `npx jest --config apps/ptah-extension-webview/jest.config.ts --testPathPatterns no-alpha`                      | **PASS** — 11 tests. Run to prove the new glyph did not consume the ratchet budget; that app's files are unmodified                                                                                                                                       |
| `git status --short`                                                                                            | the only files I modified are the four tasks-ui files above                                                                                                                                                                                               |

No git commit was created.

## Constraints checked

- No backend lib import added; the only cross-lib imports are `@ptah-extension/core`
  (`AppStateManager`, `ClaudeRpcService`) and `@ptah-extension/shared`, both
  pre-existing. `WORKSPACE_NOT_OPEN` is compared against `RpcResult.errorCode`,
  whose `RpcUserErrorCode` union already lives in
  `libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts` — `libs/shared` is the
  bridge, as required.
- `ChangeDetectionStrategy.OnPush` unchanged; signals + `inject()` throughout; no
  `@for` added, so no `track` obligation.
- No stubs, no `// TODO`, no placeholder returns.
- Out-of-scope list re-checked: `resolveRoot` untouched; no gating added to
  `skillSynthesis:listCandidates`, `cron:list` or `gateway:*`; harness-sync not
  opened.

## Two things a reviewer should know

1. **`TaskViewsService` also issues a `tasks:*` call** (`tasks:getViews`) and will
   receive the same refusal, surfacing it through its own error slot. It is
   called once at init, not on focus, so it does not loop and it was not in this
   batch's file list — left alone. Worth a follow-up if the saved-views error
   reads badly with no folder open.
2. **The refusal does not block `fetchBoard` itself**, only the automatic
   focus/visibility loop. Every other caller is either user-initiated (a header
   action, "Check again", a bulk run's single reload) or push-driven
   (`tasks:changed`, which the host only broadcasts when a workspace's index
   actually moves). Each is bounded by construction, and each gets an
   authoritative answer that updates the flag either way. Widening the gate to
   `fetchBoard` would have made the state unrecoverable in the drift case.

---

# Post-review revision

Addresses `code-logic-review-batch-3.md` (6/10, NEEDS_REVISION): Serious Issue 1
(palette bypass), Minor Issue 1 (`board:reindex` must keep its `busy` case), and
Moderate Issue 1 (`_noWorkspace` doc comment overstates the guarantee). Moderate
Issue 2 (`TaskViewsService`) left alone per the coordinator's ruling.

The reviewer was right and the report's "whole screen" claim was wrong. `Ctrl+K`
-> "Create a task" opened the modal and its submit painted a generic red
"Failed to create task" banner over the calm no-workspace panel; "Reindex the
workspace tasks" did the same. Both 100% reproducible, no race.

## How the gate was unified, and where the single source of truth now lives

**`TasksStore.canWriteSpecs`** — a `computed()` in
`D:\projects\ptah-extension\libs\frontend\tasks-ui\src\lib\services\tasks-store.service.ts`.
It is the one answer to "may this surface write into `.ptah/specs` right now",
and it has exactly two readers:

- the four header buttons, now `[disabled]="… || !store.canWriteSpecs()"`
  (previously each carried its own `store.noWorkspace()`);
- `TaskPaletteContext.canWriteSpecs`, passed once from the `paletteEntries`
  computed in `tasks-view.component.ts`.

It is `!noWorkspace()` and nothing more today. The value is the name and the
single read site, so the next precondition (a read-only workspace, an indexing
pass holding the specs dir) lands in one place rather than in five.

**The palette side is structural, not two more ternaries.** The catalogue is a
pure function and cannot read a signal, so the gate is applied to the _finished_
catalogue in one pass, keyed off the **action union** rather than off any entry's
own idea of its preconditions — in
`D:\projects\ptah-extension\libs\frontend\tasks-ui\src\lib\components\palette\palette-entries.ts`:

```ts
const ACTION_WRITES_SPECS: Record<TaskPaletteAction['kind'], boolean> = { … };
…
if (context.canWriteSpecs) return entries;
return entries.map(gateWrite);
```

The exhaustive `Record` over `TaskPaletteAction['kind']` closes the "forgotten
kind" failure mode: a new write action added to the union without being
classified does not compile. **Verified by execution, not asserted** — deleting
`reindex: true` from the map produces
`error TS2741: Property 'reindex' is missing in type … but required in type
Record<"reindex" | "openTask" | … , boolean>`. Restored afterwards.

> **Second pass corrected this claim.** The `Record` guarantees every kind is
> _listed_; it cannot guarantee any of them is classified _correctly_, and I got
> `applyView` wrong. See `## Second revision` below — the table above is the
> shape of the gate, not proof that its contents are right.

`gateWrite` **overrides** an existing `disabledReason`. With no folder open,
"No task is selected — open a task first" sends the user looking for a task list
that cannot exist, and "wait for it to finish" implies waiting will help. The
root condition is the one worth saying. `NO_WORKSPACE_REASON` follows the
existing `NO_SELECTION_REASON` / `NO_CHECKED_TASKS_REASON` convention, and the
entries stay listed-and-saying-why per FR-C6.6.

**Minor Issue 1 is handled and pinned.** All three combinations are covered:
`busy` alone still yields "already running"; `canWriteSpecs: false` alone yields
the no-folder sentence; both yields the no-folder sentence. Two tests, one for
the override and one asserting the busy reason survives untouched while a folder
is open.

## Every `tasks:*` entry point on this surface, enumerated

Not "these two were the last" — the store and `TaskViewsService` were grepped for
every `rpc.call('tasks:…')` and each was traced back to the control reaching it.

| RPC                                                | Kind      | Reached from                                                                                                                 | Covered by                                                                                                            |
| -------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `tasks:board`                                      | read      | init, workspace switch, focus reconcile, `tasks:changed` push, "Check again"                                                 | The latch + the reconcile guard (original fix)                                                                        |
| `tasks:create`                                     | **write** | Header "New Task"; palette `board:create`                                                                                    | `canWriteSpecs` — both                                                                                                |
| `tasks:reindex`                                    | **write** | Header "Reindex"; palette `board:reindex`                                                                                    | `canWriteSpecs` — both                                                                                                |
| `tasks:generateRegistry`                           | **write** | Header "Registry" only — no palette action variant exists                                                                    | `canWriteSpecs`                                                                                                       |
| `tasks:sweepFinished`                              | **write** | Header "Tidy finished" -> preview -> confirm; no palette variant                                                             | `canWriteSpecs` on the trigger, so the preview modal is unreachable                                                   |
| `tasks:updateMetadata`                             | **write** | Card/row status control, detail-panel editor, `TaskStartService` after a successful start, palette `setStatus` / `setLabels` | Palette route gated by `ACTION_WRITES_SPECS`; the other three all require a task on the board, and the board is empty |
| `tasks:bulkUpdateStatus` / `tasks:bulkUpdateLabel` | **write** | Bulk bar (only rendered with a selection); palette `bulkSetStatus`                                                           | Palette route gated; the selection is cleared on workspace switch and cannot be rebuilt with no cards                 |
| `tasks:get`                                        | read      | Card/row click; palette `task:<id>` entries                                                                                  | Unreachable — the board is empty, so `context.tasks` is empty and no such entries are built                           |
| `tasks:getArtifact`                                | read      | Detail panel only, requires an open task                                                                                     | Unreachable                                                                                                           |
| `tasks:saveViews`                                  | **write** | Saved-views menu, which the template renders only behind `@if (store.totalIndexed() > 0)`                                    | Unreachable — `totalIndexed()` is 0, so the whole view bar is absent                                                  |
| `tasks:getViews`                                   | read      | `TaskViewsService.load()` at init                                                                                            | **Not covered — out of scope**, per the coordinator and Failure Mode 3. Once at init, no loop                         |

After this revision the only ungated `tasks:*` path with no folder open is
`tasks:getViews`, a one-shot read, which is the ruled-out follow-up.

## The new tests

**`palette-entries.spec.ts`** — new describe `when the host will not accept a
write (canWriteSpecs: false)`, 5 tests:

- `board:create` and `board:reindex` each carry the no-folder reason and stay
  listed (`it.each`);
- **every** write-capable entry is disabled — asserted by filtering the whole
  catalogue for write kinds with `disabledReason === null` and expecting `[]`,
  from a context that produces one of each write action at once, so it cannot
  pass by covering only the two board entries. The same test asserts reads
  (`task:<id>`, the filter facets) stay runnable, so the gate is not "disable
  everything";
- the root reason overrides `busy` and `NO_SELECTION_REASON`;
- the `busy` reason survives when a folder IS open (Minor Issue 1);
- `canWriteSpecs: true` produces a catalogue identical to the default context's.

**`tasks-view.component.spec.ts`** — one test inside the existing `no folder open`
describe: `offers no runnable write command in the palette either`. It opens the
palette through the real trigger button, finds the two options by rendered label,
asserts `data-testid="task-palette-option-disabled"` + `aria-disabled="true"` +
the visible "No folder is open" sentence, then **clicks both** and asserts no
create modal appears and neither `tasks:reindex` nor `tasks:create` was called.
This is what the coverage hole was missing: a unit test on the catalogue alone
would not prove the component passes the flag through.

**Fail-before / pass-after, verified by execution.** With the gate bypassed
(`if (context.canWriteSpecs || true) return entries;`):

```
● TasksViewComponent › no folder open › offers no runnable write command in the palette either
  Expected: "task-palette-option-disabled"
  Received: "task-palette-option"
```

Restored, green.

## The comment change (Moderate Issue 1)

`_noWorkspace`'s doc comment gained a `## The trade this makes, stated plainly`
section. It now says outright that release depends on an external event moving
`workspaceInfo` or on a later fetch succeeding; that a refusal arriving without a
matching `workspaceInfo` change leaves `activeKey()` still, `onWorkspaceSwitch`
unfired and the reconcile guarded, so recovery in that case is manual through
"Check again"; and that this is a deliberate trade — the old code self-healed a
spurious refusal at the price of an unbounded loop, this buys the bounded loop
and pays with a manual escape hatch in a case that requires the host to be wrong
about its own workspace. It closes with "Do not 'fix' it by re-arming the
reconcile — that is the defect", so the next reader does not undo the batch.

## Files changed in this revision (6 for the batch overall, +2 new)

| File                                                                          | Change                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `…\libs\frontend\tasks-ui\src\lib\services\tasks-store.service.ts`            | `canWriteSpecs` computed; `_noWorkspace` trade-off note                                                                                                                 |
| `…\libs\frontend\tasks-ui\src\lib\components\palette\palette-entries.ts`      | **new to this batch** — `canWriteSpecs` context field, `NO_WORKSPACE_REASON`, `ACTION_WRITES_SPECS`, `gateWrite`, one-pass application, `EMPTY_PALETTE_CONTEXT` default |
| `…\libs\frontend\tasks-ui\src\lib\components\palette\palette-entries.spec.ts` | **new to this batch** — 5 gate tests                                                                                                                                    |
| `…\libs\frontend\tasks-ui\src\lib\components\tasks-view.component.ts`         | header buttons read `!store.canWriteSpecs()`; `canWriteSpecs` passed into the palette context                                                                           |
| `…\libs\frontend\tasks-ui\src\lib\components\tasks-view.component.spec.ts`    | palette test in the `no folder open` describe                                                                                                                           |
| `…\libs\frontend\tasks-ui\src\lib\services\tasks-store.service.spec.ts`       | unchanged in this revision                                                                                                                                              |

Still zero backend files, still one lib.

## Commands run (revision)

| Command                                                                                                                        | Result                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx test tasks-ui --skip-nx-cache`                                                                                         | **PASS** — 18 suites, **578** tests (571 -> +7)                                                                                                                             |
| `npx jest --config libs/frontend/tasks-ui/jest.config.ts -t "no runnable write command in the palette"` with the gate bypassed | **FAILED as required** — `Expected: "task-palette-option-disabled"`, `Received: "task-palette-option"`                                                                      |
| `npx tsc --noEmit -p libs/frontend/tasks-ui/tsconfig.lib.json` with `reindex: true` deleted from `ACTION_WRITES_SPECS`         | **FAILED as required** — `TS2741: Property 'reindex' is missing … but required in type Record<…>`. The "cannot reopen by construction" claim, verified rather than asserted |
| `npx nx lint tasks-ui --skip-nx-cache`                                                                                         | **PASS** — 0 errors; the same 3 pre-existing `max-lines` warnings                                                                                                           |
| `npx nx typecheck tasks-ui --skip-nx-cache`                                                                                    | **PASS**, re-run after restoring both temporary edits                                                                                                                       |
| `git status --short`                                                                                                           | 6 modified files, all under `libs/frontend/tasks-ui/`                                                                                                                       |

No git commit was created.

## Correction to the original report

The sentence _"the palette trigger is deliberately left enabled: it acts on the
board and the selection, both empty here"_ was wrong for `board:create` and
`board:reindex`, which are board-scoped and selection-independent. The trigger is
still left enabled — the palette is how a user finds out what this surface can do,
and every entry in it is now either runnable or listed with the reason it is not
— but the justification is no longer "its commands are all harmless here". It is
"its write commands read the same gate the header does".

---

# Second revision

Addresses Serious Issue 2 from `## Re-review after revision`:
**`ACTION_WRITES_SPECS.applyView` was `false` and should be `true`.**

The reviewer is right, and the framing is the part worth keeping. I built a
mechanism that makes a _missing_ classification impossible, then put a _wrong_
value into one of the ten entries it forced me to fill. The type system checks
completeness, not truth. Worse, I wrote a code comment — "so do the filter,
exclusions and saved-view entries, which touch nothing but local UI state" —
asserting the false premise, so the wrong value came with a note telling the
next reader not to check it.

`TaskViewsService.applyView` (`task-views.service.ts:321-329`) applies the lens
locally and then **unconditionally** `await`s `persist(this._views(), view.id)`
(`:508-522`), which calls `tasks:saveViews`. The backend routes that through the
same `resolveRoot` as every other `tasks:*` write. Nothing clears `_views()` on a
workspace change, so a saved view from a folder that has since closed stays
listed in the palette and stays clickable — the ordinary "still on the Tasks tab
when the folder goes away" flow this whole task is about.

This also invalidates one row of my own enumeration table above: the
`tasks:saveViews` row said "Unreachable — the view bar is behind
`@if (store.totalIndexed() > 0)`". That is true of the header's saved-views
dropdown and false of the palette, which lists `view:<id>` entries independently
of that `@if`. I checked where the _menu_ renders instead of what the _action_
calls, which is the same mistake as the classification, made twice.

## The table, re-derived from source

Every kind re-checked by opening the dispatcher arm in
`tasks-view.component.ts:onPaletteRun`, following it into the method it calls,
and reading that method for an `rpc.call`. Evidence, not intent:

| kind             | dispatcher arm calls                                               | that method does                                                                                                    | reaches                            | writes                   |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------ |
| `openTask`       | `TasksStore.openTask` (`tasks-store.service.ts:1081`)              | sets the detail signals, then one fetch                                                                             | `tasks:get` (`:1091`) — **read**   | `false`                  |
| `applyView`      | `TaskViewsService.applyView` (`task-views.service.ts:321`)         | `store.setFilter` + `setSort` (local), then **unconditional** `await this.persist(…)` (`:328`) → `persist` (`:508`) | `tasks:saveViews` (`:518`)         | **`true`** — was `false` |
| `setStatus`      | `TasksStore.updateStatus` (`:1403`)                                | one line: `await this.applyMetadata(taskId, { status })`                                                            | `tasks:updateMetadata` (`:2089`)   | `true`                   |
| `setLabels`      | `TasksStore.applyMetadata` (`:1325`)                               | validates the patch, then writes                                                                                    | `tasks:updateMetadata` (`:2089`)   | `true`                   |
| `bulkSetStatus`  | `TasksStore.requestBulkStatus` (`:1633`) → `requestBulk` (`:1622`) | **above** the confirm threshold it only sets `_bulkRequest`; **at or below** it calls `runBulk` immediately         | `tasks:bulkUpdateStatus` (`:1827`) | `true`                   |
| `createTask`     | the component's `openCreate` (`:1128`)                             | raises the modal only — no RPC in this callee; the modal's submit calls `TasksStore.createTask` (`:1408`)           | `tasks:create` (`:1412`)           | `true`                   |
| `setFilter`      | `TasksStore.setFilter` (`:1490`)                                   | `this._filter.set(filter)` and nothing else                                                                         | nothing                            | `false`                  |
| `clearFilter`    | `TasksStore.clearFilter` (`:1495`)                                 | `this._filter.set(EMPTY_TASK_FILTER)`                                                                               | nothing                            | `false`                  |
| `openExclusions` | the component's `openExclusions` (`:1140`)                         | `this.exclusionsOpen.set(true)`                                                                                     | nothing                            | `false`                  |
| `reindex`        | `TasksStore.reindex` (`:1428`)                                     | one write, then a board reload                                                                                      | `tasks:reindex` (`:1435`)          | `true`                   |

Two notes on the rows that are not a simple "the callee issues an RPC":

- **`createTask` is classified on the flow it OPENS.** `openCreate` only raises a
  modal. It is a write because letting a user fill that modal in and submit it
  into a guaranteed refusal is the same defect one step later.
- **`bulkSetStatus` writes on one of its two branches.** Above the confirm
  threshold `requestBulk` only records the request; at or below it, it runs the
  write immediately. Classified as a write on the strength of the immediate
  branch — and the deferred branch would only move the refusal to the Confirm
  click anyway.

`applyView` is the only value that changed. The other nine were confirmed
against source rather than carried forward.

## The comment (item 3)

`ACTION_WRITES_SPECS`'s doc comment now leads with
`## READ THIS BEFORE ADDING A KEY: the type checks COMPLETENESS, not TRUTH`. It
states that a wrong value looks exactly like a right one — it compiles, the tests
pass — names `applyView` as the case that proves it, instructs the next person to
open the method the dispatcher arm calls and follow it to the RPC rather than
guessing from the name, and carries the evidence table above inline so the
derivation is next to the values it produced. The false "touches nothing but
local UI state" sentence is gone. `applyView: true` also sits under a short
inline note explaining why it is the non-obvious one.

## The tests (item 4)

Three added, two of them pinning the stale-saved-view case specifically at the
two levels the original bypass was pinned at:

1. **`palette-entries.spec.ts` — `disables a STALE saved view left over from a
closed folder`.** `canWriteSpecs: false` with one saved view in the context;
   asserts `view:v1` carries the no-folder reason and stays listed.
2. **`palette-entries.spec.ts` — `leaves saved views runnable while a folder IS
open`.** The companion, so the fix cannot swing into disabling views outright.
3. **`tasks-view.component.spec.ts` — `disables a stale saved view in the
palette, and clicking it writes nothing`.** `renderRefused` now takes a views
   list; the test opens the real palette, finds "Apply view: Done work", asserts
   `task-palette-option-disabled` + the visible reason, **clicks it**, and
   asserts `tasks:saveViews` was never called.

The existing completeness test was also strengthened, because it was complicit:
it listed the write kinds by hand and simply did not include `applyView`, and its
context had no views. It now includes `applyView` in the set, seeds a saved view,
and — this is the part that matters — **asserts up front that at least one entry
of every kind in its set actually exists in the catalogue**, so it can no longer
pass by silently proving nothing about a kind. It deliberately does not import
`ACTION_WRITES_SPECS`: a test that reads the map it is checking agrees with the
implementation by construction, including when the implementation is wrong,
which is exactly how `applyView: false` survived.

**Fail-before / pass-after, verified by execution.** With `applyView` set back to
`false`:

```
● buildPaletteEntries › … › disables a STALE saved view left over from a closed folder
  Received has value: null
● TasksViewComponent › no folder open › disables a stale saved view in the palette, and clicking it writes nothing
  Expected: "task-palette-option-disabled"
  Received: "task-palette-option"
Tests: 2 failed, 1 passed, 581 total
```

Restored to `true`, all green.

## Commands run (second revision)

| Command                                                                                           | Result                                                                               |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npx nx test tasks-ui --skip-nx-cache`                                                            | **PASS** — 18 suites, **581** tests (578 -> +3)                                      |
| `npx jest --config libs/frontend/tasks-ui/jest.config.ts -t "saved view"` with `applyView: false` | **FAILED as required** — the two new tests fail, the companion passes (output above) |
| `npx nx lint tasks-ui --skip-nx-cache`                                                            | **PASS** — 0 errors; the same 3 pre-existing `max-lines` warnings                    |
| `npx nx typecheck tasks-ui --skip-nx-cache`                                                       | **PASS**                                                                             |
| `git status --short -- libs/frontend/tasks-ui`                                                    | the same 6 files, no new ones; 831 insertions / 6 deletions total for the batch      |

No git commit was created. Nothing outside `libs/frontend/tasks-ui/` was touched
in this pass.

## What I would tell the next reader

The gate's structure is sound and the reviewer confirmed it twice. Its weak point
is not the mechanism, it is that ten booleans have to be true, and the compiler
cannot tell. The comment now says that in the file, the evidence table records
how each value was derived, and the completeness test refuses to be written from
the map it checks. That is as close to self-checking as this design gets; the
remaining requirement is that whoever adds the eleventh kind reads the method it
dispatches to.
