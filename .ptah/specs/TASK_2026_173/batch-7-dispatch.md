# Batch 7 Dispatch — TASK_2026_173 · Split-Pane Save (C2)

**To**: `frontend-developer` sub-agent (Recommended Executor, `tasks.md` Batch 7)
**Fallback**: `senior-tester`
**Execution mode**: sequential — Tasks 7.1 → 7.2 → 7.3 → 7.4, in order
**Predecessor**: Batch 6 committed as `b57d3c8d4` (`fix(editor): de-nest the tab, header and file-row buttons for a11y`)
**Tasks**: 4 | **Satisfies**: C2 | **Dependencies**: Batch 6 (sequential) and Batch 2 (hard — `editor-diff-split.ts` was rewritten there)

Plan §5.5 calls C2 **"the highest-uncertainty item after D2"** and says to isolate it. It is isolated.
Nothing else ships in this batch.

**CLI agent delegation is DISABLED for this task** (user decision, Checkpoint 0.1, `tasks.md:7`). You
are a sub-agent. Do not spawn CLI agents.

---

## 1. Read this section before you touch anything

### 1.1 Every line number in `tasks.md` Tasks 7.1–7.4 is STALE. The numbers below are not.

`editor-diff-split.ts` was rewritten by Batch 2 and `editor-panel.component.ts` has now been rewritten
by **Batch 4 and again by Batch 6**. Every offset in Batch 7's task bodies predates all of that.
Three batches running have each found drift on re-verification, so assume more.

I re-verified every citation against the working tree at `b57d3c8d4`. This table is the source of
truth; where it disagrees with `tasks.md`, **it wins**.

| `tasks.md` says                     | Actually at (verified `b57d3c8d4`)                                  | Symbol                                                                              |
| ----------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `editor-diff-split.ts:117-123`      | **`:302-304`**                                                      | `updateSplitContent`                                                                |
| `editor-diff-split.ts:139-141`      | **`:262-286`**                                                      | `openFileInSplit`                                                                   |
| `editor-panel.component.ts:654-659` | **`:659-663`**                                                      | `codeEditorContent` computed (`:653-657` is `codeEditorPath` — do not confuse them) |
| `code-editor.component.ts:399-411`  | **`:399-411`** — still correct, the one citation that did not drift | external-content-update branch inside `syncFile`                                    |
| `code-editor.component.ts:202-208`  | **`:202-211`**                                                      | per-pane model namespacing (`instanceId`)                                           |

Everything else you need, also verified:

| File                        | Line                | What                                                                                                                                          |
| --------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor-diff-split.ts`      | `:262-286`          | `openFileInSplit` — `:270` copies `existingTab.content`; `:274-285` is the no-tab RPC path                                                    |
| `editor-diff-split.ts`      | `:289-294`          | `closeSplit`                                                                                                                                  |
| `editor-diff-split.ts`      | `:297-299`          | `setFocusedPane`                                                                                                                              |
| `editor-diff-split.ts`      | `:302-304`          | `updateSplitContent` — a one-line setter today                                                                                                |
| `editor-tabs.ts`            | `:80-87`            | `switchTab`                                                                                                                                   |
| `editor-tabs.ts`            | `:90-97`            | `updateTabContent` — sets `content` **and `isDirty: true`**, then `syncTabsToCache()`                                                         |
| `editor-tabs.ts`            | `:100-107`          | `markTabClean`                                                                                                                                |
| `editor-file-ops.ts`        | `:110-124`          | `saveFile` — RPC only; **does not mark the tab clean**                                                                                        |
| `editor-workspace.ts`       | `:92-95`            | split state **restored** from the workspace cache                                                                                             |
| `editor-workspace.ts`       | `:103-105`          | split state reset when there is no cache                                                                                                      |
| `editor-workspace.ts`       | `:146-148`          | split state **persisted** to the workspace cache                                                                                              |
| `editor-internal-state.ts`  | `:18-20`, `:37-40`  | cached slice fields + the four writable split signals                                                                                         |
| `editor.service.ts`         | `:73-76`, `:96-102` | private split signals + their readonly exposures                                                                                              |
| `editor-panel.component.ts` | `:314`, `:320`      | LEFT pane `[content]="codeEditorContent()"`, `(contentChanged)="onContentChanged($event)"`                                                    |
| `editor-panel.component.ts` | `:386-389`          | RIGHT pane `[filePath]` / `[content]="editorService.splitFileContent()"` / `[isFocused]` / `(contentChanged)="onSplitContentChanged($event)"` |
| `editor-panel.component.ts` | `:621-624`          | `closeSplit(event: MouseEvent)` — **still calls `stopPropagation()`**, see §6.3                                                               |
| `editor-panel.component.ts` | `:629-631`          | `onPaneClick`                                                                                                                                 |
| `editor-panel.component.ts` | `:686-688`          | `onSplitContentChanged`                                                                                                                       |
| `editor-panel.component.ts` | `:693-698`          | `onSplitFileSaved`                                                                                                                            |
| `editor-panel.component.ts` | `:746-751`          | `onContentChanged`                                                                                                                            |
| `editor-panel.component.ts` | `:753-757`          | `onFileSaved`                                                                                                                                 |
| `code-editor.component.ts`  | `:135-136`, `:143`  | inputs `filePath`, `content`, `isFocused`                                                                                                     |
| `code-editor.component.ts`  | `:145-146`          | outputs `contentChanged`, `fileSaved`                                                                                                         |
| `code-editor.component.ts`  | `:194`              | `applyingExternalEdit` field                                                                                                                  |
| `code-editor.component.ts`  | `:258-263`          | the `effect()` that drives `syncFile` on input change                                                                                         |
| `code-editor.component.ts`  | `:350-419`          | `syncFile`                                                                                                                                    |
| `code-editor.component.ts`  | `:421-436`          | `getOrCreateModel` — URI `ptah-model://<instanceId>/<key>`                                                                                    |
| `code-editor.component.ts`  | `:473-474`          | content listener: `if (this.applyingExternalEdit) return;` then `contentChanged.emit(value)`                                                  |

**Re-verify anything you are about to edit before you edit it.** The Edit tool matches exactly; a
stale read on a shared checkout fails loudly at best and patches the wrong region at worst.

---

### 1.2 🔴 The single most important thing in this dispatch: Task 7.2 as literally worded is DANGEROUS

`tasks.md` Task 7.2 says _"Both panes' `[content]` inputs derive from the tab record."_ Read
`code-editor.component.ts:395-398` before you act on that. It is a comment, and it is load-bearing:

> ```
> // External content update for an existing model (revert / reread): the
> // incoming `content` input never carries the user's own edits back (the
> // EditorService updates tab content, not activeFileContent, on edit), so
> // any divergence here is an outside change we must apply.
> if (!isNewModel && content !== model.getValue()) {
> ```

That invariant is **the only thing standing between `syncFile` and a full-model
`pushEditOperations` replacement on the user's own typing.** It holds today for exactly the reason
the comment states: the left pane reads `activeFileContent()` (`editor-panel.component.ts:659-663`),
which is written **only on open/switch** (`editor-tabs.ts:84-86`), while `onContentChanged`
(`:746-751`) writes the **tab record** instead.

Rebind the left pane's `[content]` to the tab record and you invert that. `updateTabContent`
(`editor-tabs.ts:90-97`) fires on **every keystroke**, so `content` would then carry the user's own
edits straight back into the effect at `:258-263` → `syncFile` → the `:399` comparison.

Value equality usually rescues it — the echoed string equals the model's, so `:399` is false and
nothing happens. **Usually is not always.** Signal effects are not synchronous with the keystroke, so
under fast typing the echo can lag the model by one or more characters, `:399` becomes true, and you
get a `getFullModelRange()` replacement of the buffer the user is typing into: **cursor jumps to the
end, undo stack collapses.** That is precisely the failure Task 7.3's own validation note warns about
("mirroring **only** into the unfocused pane prevents cursor-jump while typing") — but the note
anticipates it only for the mirroring path, not for 7.2's rebinding, which is where it actually bites.

Note that `tasks.md`'s own justification for 7.2 describes the _current_ arrangement as safe — "the
left pane already effectively does; `activeFileContent` is set on switch/open only, and
`onContentChanged` writes the tab, not the signal, so no feedback loop is introduced." That is a
correct description of what is there now. It is not a reason the rebinding is safe; it is the reason
the rebinding is what _introduces_ the loop.

**Therefore, execute Task 7.2 as a statement about ownership, not about bindings:**

> The tab record becomes the single **owner** (write target) of content for both panes. It does not
> become the **read source** for the focused pane.

Concretely:

- **DO** converge the write side (Task 7.1): `updateSplitContent` also writes the tab record.
- **DO** drive the **unfocused** pane from the tab record (Task 7.3). That is safe by construction —
  the unfocused pane is, by definition, not being typed into.
- **DO NOT** rebind the focused pane's `[content]`. Leave `codeEditorContent()` reading
  `activeFileContent()` at `:659-663` and leave the right pane reading `splitFileContent()` at `:387`
  **while that pane holds focus**.

If after reading the code you conclude a different shape is better, **you may take it — but you must
justify it in your report against the `:395-398` invariant specifically, and you must update or
delete that comment.** Leaving a comment in the tree that no longer describes the code is the failure
mode that produced this hazard in the first place. Do not silently invalidate it.

---

### 1.3 The root cause has FOUR legs, not the two Task 7.1 names

Task 7.1 names two: `openFileInSplit` copies content at open time, and split edits write only
`splitFileContent`. Both confirmed. There are two more, and neither is named anywhere in Batch 7.

**Leg 3 — the split pane's save never marks the tab clean.** Compare, verbatim:

```ts
// editor-panel.component.ts:753-757  (LEFT pane)
protected onFileSaved(event: { filePath: string; content: string }): void {
  void this.editorService.saveFile(event.filePath, event.content).then(() => {
    this.editorService.markTabClean(event.filePath);
  });
}

// editor-panel.component.ts:693-698  (RIGHT pane)
protected onSplitFileSaved(event: { filePath: string; content: string }): void {
  void this.editorService.saveFile(event.filePath, event.content);
}
```

`saveFile` (`editor-file-ops.ts:110-124`) is RPC-only and marks nothing clean; the caller does.
So **saving from the split pane leaves the tab's `isDirty` true forever** — the dirty dot stays lit on
a file that is saved on disk. That is **C2 AC4 failing today**, on a path that has nothing to do with
conflicts. It is not a Task 7.4 concern; fix it in Task 7.1/7.2 territory, before any conflict logic
exists, so the AC4 assertion is not entangled with the prompt.

**Leg 4 — the workspace cache is a second, independent store of the same content.**
`editor-workspace.ts:146-148` persists `splitFileContent` into the cached workspace slice, and
`:92-95` restores it. The tab record is persisted separately via `syncTabsToCache()`
(`editor-tabs.ts:37-45`). **Switch workspace away and back and the two can disagree** — a divergence
path that survives every fix in Tasks 7.1–7.3 because it round-trips through a different store.

Either make the cached `splitFileContent` derived from (or reconciled against) the tab record on
restore, or state in your report why the round-trip cannot produce a disagreement. **Do not leave it
unaddressed and claim C2 AC1** — "no silent divergence" is a claim about all paths, not the three
you fixed.

---

### 1.4 `openFileInSplit` can put a file in the split pane with NO tab record

`editor-diff-split.ts:262-286`, verbatim shape:

```ts
const existingTab = this.state.openTabs().find((t) => t.filePath === filePath);
if (existingTab) {
  this.state.splitFileContent.set(existingTab.content);   // :270
  return;
}
const result = await rpcCall<...>(..., 'editor:openFile', { filePath });   // :274
if (result.success && result.data) {
  this.state.splitFileContent.set(result.data.content ?? '');              // :281
}
```

The second branch **never creates a tab**. Task 7.1's wording — "when that path has an open tab" —
therefore silently leaves that case exactly as today.

That is defensible: with no tab, the split pane is the _only_ editing surface for that file, so there
is no second view to diverge from and C2 AC1 is vacuously satisfied. **But it must be reasoned, not
assumed.** State it explicitly in your report, and add a test pinning the no-tab case so a later
change cannot quietly turn it into a divergence. Do not "fix" it by creating a tab — that changes
observable behaviour (a new tab appears in the strip) and is out of scope.

---

## 2. Standing gates (apply to this batch, no exceptions)

1. **NFR-1 cross-project invariant — must not decrease.** Floor after Batch 6:
   `nx test ptah-electron` **145 passed / 4 skipped** and `nx test rpc-handlers` **1718 passed /
   31 skipped**; the sum **145 + 1718 = 1863** must never drop. Converting a failing test to skipped
   is a regression, not a fix.
2. **Typecheck** clean for every changed project.
3. **Lint, standalone per project** — `nx lint <project>` individually. Do **not** rely on a batched
   `nx run-many -t lint`; it has masked a real error in this repo. Baseline for
   `@ptah-extension/editor` is **0 errors / 14 warnings**, all pre-existing and all in files you are
   not touching. Zero new warnings in your files.
4. **Affected unit tests** — `nx test @ptah-extension/editor` and `nx test ptah-extension-webview`.
   Editor baseline after Batch 6: **16 suites / 222 tests, all passing.**
5. **Three-runtime build** — **not required**, provided you touch no `libs/shared` and no
   `libs/backend` file. This batch should not need to. If you find yourself editing either, stop and
   report — that is a scope change, not a detail.
6. **Scope discipline (NFR-9)** — work confined to the files in §3–§6. Anything broken that
   originates outside this batch is **reported and the batch stopped**, never fixed opportunistically.
   `--no-verify` is forbidden.
7. **NFR-2** — `ChangeDetectionStrategy.OnPush` on every component touched; signals + `inject()`;
   any new state workspace-partitioned.

---

## 3. Task 7.1 — `updateSplitContent` writes the tab record

**File**: `libs/frontend/editor/src/lib/services/editor/editor-diff-split.ts` (`:302-304`, and
`:262-286` for context)
**Requirement**: C2 AC1, AC2 (+ the AC4 leg from §1.3)

Today:

```ts
/** Update the content of the split (right) pane. */
public updateSplitContent(content: string): void {
  this.state.splitFileContent.set(content);           // :303 — the whole method
}
```

Make it also write through to the tab record when `splitFilePath()` has an open tab, so the tab
becomes the single owner of content for both panes. `EditorDiffSplitHelper` does not hold
`EditorTabsHelper` today — check its constructor (`:62`) and the callbacks object it already
receives, and route through the existing wiring rather than adding a new cross-helper reference if
one already fits. `editor.service.ts:140-143` shows how the helpers are composed.

**Constraints:**

- `updateTabContent` (`editor-tabs.ts:90-97`) also sets `isDirty: true`. That is correct here — a
  split-pane edit genuinely does make the file dirty — but be aware you are now setting dirty state
  from a path that never did, and check it against the existing `editor-diff-split.spec.ts`
  (20 tests, 19 of them split-aware) before assuming nothing pins the old behaviour.
- Fix the §1.3 Leg 3 asymmetry here: `onSplitFileSaved` (`editor-panel.component.ts:693-698`) must
  mark the tab clean the same way `onFileSaved` (`:753-757`) does.
- Do **not** change `openFileInSplit`'s no-tab branch (§1.4).

---

## 4. Task 7.2 — content ownership converges on the tab record

**File**: `libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts` (`:659-663`, `:314`,
`:386-389`)
**Requirement**: C2 AC4, AC5

**Read §1.2 first. It changes what this task means.** Execute it as _write-side ownership_, not as a
rebinding of the focused pane's `[content]`.

What must be true when you are done:

- Exactly one place owns the content of a file open in both panes: the tab record.
- The focused pane's read path is unchanged, so no echo can reach `syncFile:399`.
- **AC5 — the different-files case must be EXACTLY as today.** Every branch you add here is gated on
  `splitFilePath() === activeFilePath()`. If the two panes hold different files, not one line of new
  behaviour may execute. This is the single highest-risk regression in the batch: the ordinary
  split-pane case is the common one, and C2 exists to fix the rare one.
- AC4 — the dirty indicator is correct **in both panes** after a save from either. Note there are two
  dirty notions in play and they are not the same object: the tab record's `isDirty`
  (`editor-tabs.ts:93`, drives the tab strip's dot) and `CodeEditorComponent`'s own local
  `isDirty` signal (`code-editor.component.ts:216`, driven from `baselines` at `:417-418`, drives the
  per-pane "Modified" badge). **AC4 is a claim about both.** Reconcile them or explain why the local
  one follows for free.

---

## 5. Task 7.3 — unfocused-pane mirroring

**File**: `libs/frontend/editor/src/lib/code-editor/code-editor.component.ts` (split-pane case only)
**Requirement**: C2 AC1, AC6

When the same path is open in both panes, the **unfocused** pane receives the focused pane's content
on a short debounce. Mirroring only into the unfocused pane is what prevents cursor-jump while
typing — this is not a nicety, it is the mechanism.

**Use the existing machinery. Do not build a second one.** `syncFile`'s external-update branch
(`:399-411`) already applies outside content via `pushEditOperations` guarded by
`applyingExternalEdit` (`:194`), and the content listener honours that guard at `:473` before
emitting `contentChanged` at `:474`. So an applied mirror does **not** echo back out as a user edit,
and undo survives. `isFocused` is already an input (`:143`) and is already bound for both panes
(`:316-319` left, `:388` right).

**C2 AC6 is a hard constraint**: the independent per-pane Monaco models
(`code-editor.component.ts:202-211`, URIs namespaced `ptah-model://<instanceId>/<key>` at `:428-430`)
are a deliberate design decision and **must be preserved**. The save path is what changes, not the
model strategy. Do not merge the panes onto one model, and do not un-namespace the URIs — the doc
comment at `:202-208` explains they also prevent "model URI already in use" collisions.

**But that same doc comment says the independence exists "matching the pre-existing independent-edit
behaviour."** After C2 the two panes are no longer independently _edited_ in the same-file case, only
independently _modelled_. **Update that comment** so it states the model-identity reason (URI
collision avoidance, per-pane view state) rather than an edit-independence rationale that C2 has just
removed. Same rule as §1.2: do not leave a comment that outlives its truth.

---

## 6. Task 7.4 — conflict prompt at save

**Files**: `libs/frontend/editor/src/lib/services/editor/editor-diff-split.ts`,
`libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts`
**Requirement**: C2 AC2, AC3, AC4

If the tab record carries a write from the other pane that this pane has not absorbed, prompt:
_"This file was also edited in the other pane — Overwrite / Cancel."_

### 6.1 R-10 is the governing risk, and it cuts against the prompt

**A prompt on every split-pane save would be worse than today's silent behaviour.** With Tasks 7.1
and 7.3 in place, a genuine unabsorbed divergence should be reachable only under a real race — the
mirror debounce window. **Prefer reconciliation over prompting wherever the content allows it.**

If you find the prompt is reachable in ordinary use, that is evidence 7.1/7.3 are incomplete, not
evidence the prompt needs to be friendlier. Say so and fix the cause.

### 6.2 Test the prompt's _absence_, not just its presence

The AC3 assertion everyone writes is "a conflicting save prompts." The assertion that actually
protects the user experience is **"an ordinary save does not."** Cover both:

- same file, both panes, no divergence → save completes silently, no prompt
- different files → save completes silently, no prompt, behaviour byte-identical to today (AC5)
- same file, genuine unabsorbed divergence → prompt, and Cancel really does abort the write

### 6.3 🚫 Do NOT touch `closeSplit`'s `stopPropagation`

`editor-panel.component.ts:621-624`:

```ts
protected closeSplit(event: MouseEvent): void {
  event.stopPropagation();
  this.editorService.closeSplit();
}
```

This was explicitly out of Batch 6's scope and it is explicitly out of yours. It is the last live
`stopPropagation()` in this file and it will look like an obvious leftover while you are working in
the split-pane chrome ten lines away. **Leave it.** NFR-9: it gets filed, not fixed here. Cleaning it
up blurs a save-semantics diff with an unrelated accessibility change and costs the reviewer the
ability to read either one cleanly.

---

## 7. Verification — what "done" means

### 7.1 Acceptance criteria (all must pass)

| AC         | Criterion                                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **C2 AC1** | Same file in both panes, edit in one → the other reflects it **or** is visibly marked diverged. Silent divergence does not occur — **on every path, including the workspace-cache round-trip of §1.3 Leg 4** |
| **C2 AC2** | A save never discards the other pane's edits without informing the user                                                                                                                                      |
| **C2 AC3** | A save that would overwrite the other pane's unsaved changes prompts or reconciles — it never completes silently                                                                                             |
| **C2 AC4** | Dirty indicator correct **in both panes** after a save from either — tab-strip dot _and_ per-pane "Modified" badge (§4)                                                                                      |
| **C2 AC5** | **Different files in the two panes behave exactly as today.** No degradation of the ordinary case                                                                                                            |
| **C2 AC6** | Independent per-pane Monaco models preserved (`code-editor.component.ts:202-211`)                                                                                                                            |
| Gates      | §2 items 1–7                                                                                                                                                                                                 |

### 7.2 Tests

Extend in place; do not create parallel spec files for these components.

- `editor-diff-split.spec.ts` — **20 existing tests, 19 split-aware. All must stay green.** Add the
  write-through, the no-tab case (§1.4), and the workspace-cache round-trip (§1.3 Leg 4).
- `editor-panel.component.spec.ts` — **23 existing tests including Batch 4's drag specs and Batch 6's
  D1 specs. Do not modify either family.** Add the AC4 dirty-indicator assertions for both panes and
  both save paths.
- `code-editor.component.spec.ts` — 14 existing tests. Add the mirroring case, and specifically a
  test that the focused pane does **not** receive a mirror.
- `editor-workspace.spec.ts` — 15 existing tests, 11 split-aware. Cover the cache round-trip if you
  address Leg 4 there.

**The test that matters most is a negative one**: typing continuously in the focused pane must never
trigger a `pushEditOperations` on that pane's own model. That is the §1.2 hazard, and it is the one
failure a passing AC1/AC2/AC3 suite would not catch.

---

## 8. Concurrency — the branch is shared and the index is hostile

**Another session is working TASK_2026_177 on this same branch (`ak/license-server-validation-pipe`)
and commits mid-flight.** It landed `54650edee` during Batch 5, and as of Batch 6's commit it has
~32 dirty entries across `libs/web/**`, `libs/api*/**`, `apps/ptah-license-server/**` and
`marketing/**`.

- **Run no git commands beyond read-only `git status` / `git diff`.** You do not commit — the
  team-leader does, after review.
- **Never stage anything.** Not `git add -A`, not `git add .`, not a path. The index must be exactly
  as you found it (empty) when you hand back.
- Failures originating in TASK_2026_177's files are **not yours**. Report them; do not fix them.
- Scope every command to your project (`nx lint @ptah-extension/editor`), never repo-wide
  `nx affected`, which will surface the other session's state as noise or failure.

---

## 9. ⛔ SEQ-2 — this batch does NOT clear the gate for Batch 8

Batch 8 (D2, hunk stage/revert) sits behind **SEQ-2**, an absolute blocking precondition:

> Batch 8 must not start until **Batch 2's A1–A4 acceptance criteria are independently verified** —
> not "implemented", not "committed", _independently verified_.

**Completing Batch 7 does not satisfy that and must not be reported as if it does.** SEQ-2 is a
data-integrity constraint, not a scheduling one: a hunk stage/revert applies a derived patch to the
user's git index or working tree, and is only as correct as the diff it derives from. Against A1
unfixed it can apply cleanly at a shifted offset and silently corrupt the file; against A2 unfixed it
stages the exact content the user deliberately left unstaged; against A3 unfixed it stages a
fabricated whole-file addition whose real HEAD content was never read. The index holds work about to
be committed and the working tree holds work that may exist nowhere else — corruption there is not
recoverable by undo.

Note also the **natural cut line (R-7) sits immediately after this batch.** Batches 0–7 form a
coherent shippable unit. If the task runs long, stopping here costs the D2 feature and nothing else.
So finish Batch 7 cleanly rather than leaving anything half-done in anticipation of Batch 8.

---

## 10. Report back

Write `.ptah/specs/TASK_2026_173/batch-7-report.md` and return a summary. Required content:

1. **Files modified**, absolute paths, one line each on what changed.
2. **Your ruling on §1.2** — did you leave the focused pane's read path alone, or take a different
   shape? If different: justify it against the `code-editor.component.ts:395-398` invariant
   specifically, and confirm you updated or deleted that comment.
3. **All four legs of §1.3** — how each is handled, or why a leg needs no handling. Leg 4 (the
   workspace-cache round-trip) is the one most likely to be quietly skipped.
4. **The §1.4 no-tab case** — the reasoning, and the test that pins it.
5. **AC5 evidence** — how you know the different-files case is unchanged. This is the regression most
   likely to ship unnoticed.
6. **AC4 evidence for both dirty notions** (tab record and per-pane badge).
7. **The negative typing test** from §7.2 — what it asserts and that it passes.
8. **Standing gates §2, verbatim output**, all seven.
9. **Found and NOT fixed (NFR-9)** — everything you noticed outside scope, including
   `closeSplit`'s `stopPropagation` at `:621-624`. Report it; do not fix it.
10. **Anything you could not verify.** State it as a gap. Batch 6's report named its own gaps
    explicitly (Electron never launched, one detector initially vacuous) and that honesty is why it
    was approved on the first pass. Do not round anything up.

**Do not create git commits.** No `git add`, no `git commit`, no `--no-verify`. The team-leader
verifies, requests review, and commits.
