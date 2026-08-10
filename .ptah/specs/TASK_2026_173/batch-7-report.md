# Batch 7 Report — TASK_2026_173 · Split-Pane Save (C2)

**Executor**: `frontend-developer` sub-agent
**Dispatch**: `batch-7-dispatch.md`
**Predecessor**: Batch 6 (`b57d3c8d4`)
**Tasks**: 7.1 → 7.2 → 7.3 → 7.4, sequential. All four executed.
**Verdict**: implemented and green on all seven standing gates. Three shortfalls / residual
risks are flagged in §10 and are NOT rounded up.

**No git operations were performed.** No `add`, no `commit`, no `stash`, no `checkout`. The index
was empty when I started and is empty now (`git diff --cached --name-only` → no output).

---

## 1. Files modified

All six are under `libs/frontend/editor/**`. Nothing else was touched.

| File                                                                                                                              | Change                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor\editor-diff-split.ts`                                    | Task 7.1 + 7.3 + 7.4 core. `updateSplitContent` writes through to the tab record; new debounced `scheduleSplitMirror` / `mirrorToUnfocusedPane`; `setFocusedPane` now cancels the pending mirror and reconciles both panes; `closeSplit` absorbs an unmirrored split edit before tearing the gate down; `dispose` clears the mirror timer; new `hasUnabsorbedPeerEdit` conflict predicate; new private `sharedSplitTab()` gate. |
| `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor.service.ts`                                              | `updateTabContent` also schedules the mirror (primary-pane edit direction); new `hasUnabsorbedPeerEdit` passthrough.                                                                                                                                                                                                                                                                                                            |
| `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor\editor-workspace.ts`                                     | §1.3 leg 4. On workspace restore both pane content signals are derived from the tab record; the cached pane copies are used only for a path with no tab.                                                                                                                                                                                                                                                                        |
| `D:\projects\ptah-extension\libs\frontend\editor\src\lib\code-editor\code-editor.component.ts`                                    | New `contentIsPersisted` input; `syncFile` no longer adopts an unsaved mirror as a clean baseline (read `untracked`); new baseline-only effect that clears the badge when the peer pane saves; **both load-bearing comments rewritten** (`:202-208` model-namespacing rationale, `:395-398` external-update invariant).                                                                                                         |
| `D:\projects\ptah-extension\libs\frontend\editor\src\lib\editor-panel\editor-panel.component.ts`                                  | Task 7.2 + 7.4 surface. `sharedSplitTab` / `sharedContentIsPersisted` computeds; `contentIsPersisted` bound on both panes; both save paths routed through one `saveFromPane` (fixes leg 3); save-conflict `alertdialog` + Overwrite/Cancel handlers; `_quickOpenKeydown` renamed `_panelKeydown` and now maps Escape → Cancel.                                                                                                  |
| specs: `editor-diff-split.spec.ts`, `editor-workspace.spec.ts`, `code-editor.component.spec.ts`, `editor-panel.component.spec.ts` | +38 tests. Details in §7 and §8.                                                                                                                                                                                                                                                                                                                                                                                                |

---

## 2. Ruling on §1.2 — I left the focused pane's read path alone

**I did not rebind the focused pane's `[content]`. I did not rebind either pane's `[content]` at
all.** `codeEditorContent()` still reads `activeFileContent()`; the right pane still reads
`splitFileContent()`. Neither expression changed by a character.

Task 7.2 was executed as the dispatch re-scoped it — **ownership, not bindings**:

- **Write side converged** (7.1): a split-pane edit writes the tab record.
- **Unfocused pane driven from the tab record** (7.3): but _through the existing signals_. The
  mirror sets `activeFileContent` (when the right pane has focus) or `splitFileContent` (when the
  left does). The panes read what they always read; what changed is who writes those signals and
  when.

That placement is deliberate. Putting the mirror in the service rather than in the template means
the panel's read path is provably unchanged, so AC5 is not an argument — it is a diff.

The `:395-398` invariant is therefore preserved in substance but **its wording was no longer true**,
because `activeFileContent` is now written on an edit (the _other_ pane's edit, while this pane is
unfocused). Per the dispatch I rewrote it rather than leaving a comment that outlived its truth. It
now states the actual mechanism: nothing writes a pane's own edits back into its own `content`
input; a user edit goes out to the tab record, and the tab record comes back only into the pane
that does not have focus.

### I verified the hazard is real, and that my test catches it

I did not take the dispatch's word for the mechanism. I wrote a throwaway probe that wires the
component the dangerous way (`contentChanged` → `setInput('content', …)`, i.e. the literal Task 7.2
wording) and typed with a second keystroke landing before change detection flushed the echo:

```
Expected: -1
Received: 10
```

Ten `pushEditOperations` full-model replacements across ten simulated keystrokes. The hazard is
real, value equality does **not** absorb it once the echo can lag, and the probe was deleted after
confirming. The permanent negative test (§7) asserts **zero** pushes under the shape I shipped.

One correction to the dispatch's reasoning, for the record: with a _non-debounced_ signal echo the
lag it describes is largely absorbed, because a signal read always returns the newest value rather
than a queued one. The probe only produced pushes once a keystroke landed between the emit and the
flush. The conclusion still holds — and it holds _much_ more strongly for a **debounced** mirror,
which by construction carries a value captured 150 ms ago. That is exactly why the mirror never
targets a focused pane.

---

## 3. All four legs of §1.3

**Leg 1 — `openFileInSplit` copies content at open time.** Needs no change and got none. The copy
is taken from `existingTab.content`, i.e. from the owner, and every subsequent edit now writes back
to that owner. The copy is a read surface being seeded, not a second store. (The no-tab branch is
§1.4, below.)

**Leg 2 — split edits wrote only `splitFileContent`.** Fixed in `updateSplitContent`
(`editor-diff-split.ts`): it now also calls `tabs.updateTabContent(path, content)` when the split
path has an open tab, and schedules the mirror. Pinned by _"writes a split-pane edit through to the
tab record and marks it dirty"_.

Note the constraint the dispatch flagged: `updateTabContent` also sets `isDirty: true`, so dirty
state is now set from a path that never set it. That is correct (a split edit does dirty the file)
and nothing in the 20 pre-existing `editor-diff-split.spec.ts` tests pinned the old behaviour — see
§9 for what those 20 tests actually cover.

**Leg 3 — the split pane's save never marked the tab clean.** Fixed. Both `onFileSaved` and
`onSplitFileSaved` now route through a single private `saveFromPane` → `persistSave`, which awaits
`saveFile` and then calls `markTabClean`. There is now one save policy rather than two that drifted.
Pinned by two tests, one per pane.

**Leg 4 — the workspace cache is a second, independent store.** Addressed in `editor-workspace.ts`,
and it is worse than the dispatch describes. The cache holds **three** copies of the same text: the
tab record, `activeFileContent` and `splitFileContent`. Only the tab record is updated on edit —
`activeFileContent` is written on open/switch only (that is precisely the §1.2 invariant). So on
`switchWorkspace` away and back, the _pre-C2_ code restored `activeFileContent` to the snapshot
taken when the file was opened, `syncFile` saw it differ from the model, and pushed it: **the
primary pane's unsaved edits were reverted by a workspace round-trip.** That is live unsaved-work
loss on `main` today, not merely a split-pane divergence.

Fix: on restore, both pane signals are derived from the tab record when one exists; the cached pane
copies are the fallback only for a path with no tab. Four tests cover it, including a full
away-and-back round-trip. This also repairs the primary-pane data loss as a side effect — I am
flagging that as slightly wider than "split-pane save", because it is, and because it is the same
one-line reconciliation that AC1 requires (reconciling only the split half would leave the two
panes restoring from different stores).

---

## 4. The §1.4 no-tab case — reasoning and the tests that pin it

`openFileInSplit`'s second branch loads content over RPC and never creates a tab. I did **not**
change it, and I did not "fix" it by creating a tab.

**Reasoning:** the ownership rule C2 introduces is an arbitration rule between two views of one
file. With no tab record, the split pane is the _only_ editing surface for that file — there is no
second view to diverge from, no second buffer to overwrite, and nothing for a conflict prompt to be
about. C2 AC1 is vacuously satisfied. Creating a tab would put an entry in the tab strip that the
user never asked for, which is an observable behaviour change and out of scope.

**Pinned by three tests**, so a later change cannot quietly turn it into a divergence:

- `editor-diff-split.spec.ts` — _"(§1.4) leaves the no-tab split file exactly as it was: no tab is
  created, no throw"_: asserts `openTabs()` stays empty, `splitFileContent` still receives the text,
  and `hasUnabsorbedPeerEdit` answers `false` (so no prompt is reachable for it).
- `editor-workspace.spec.ts` — _"(§1.4) falls back to the cached content for a split file with NO
  tab record"_: the cache is authoritative precisely because nothing else owns the text; the leg-4
  reconciliation must not blank it.
- The `sharedSplitTab()` gate itself returns `null` without a tab, which every C2 behaviour is
  gated on.

---

## 5. AC5 evidence — the different-files case

Three independent lines of evidence, in decreasing order of strength.

**(a) The read path is byte-identical.** No `[content]` binding changed. `codeEditorContent()` and
`editorService.splitFileContent()` are the same expressions as at `b57d3c8d4`. The only new binding
is `[contentIsPersisted]`, whose value is `undefined` — the explicit "no information" case that runs
the exact pre-C2 code path — unless the two panes hold the same file _and_ it has a tab.

**(b) One gate, checked in the diff.** Every new behaviour in both the service and the component is
gated on a single predicate (`sharedSplitTab()` in the helper, `sharedSplitTab()` in the panel),
which requires `splitActive() && splitFilePath() === activeFilePath() && a tab exists`. There is no
second entry point.

**(c) Four explicit AC5 tests:**

- _"(AC5) does nothing at all when the two panes hold DIFFERENT files"_ — edits the split pane,
  advances 1000 ms, asserts `activeFileContent` is untouched.
- _"(AC5) `setFocusedPane` touches nothing when the panes hold different files"_ — both pane signals
  keep deliberately-stale values across a focus change.
- _"(AC5) is FALSE when the panes hold different files, whatever the tab records say"_ — the
  conflict predicate answers `false` for both paths even with both tabs dirty and diverged.
- _"(AC5) a save with DIFFERENT files in the two panes never prompts"_ (panel) — asserts no dialog,
  `saveFile` called, and that **both** panes received `contentIsPersisted === undefined`.

**One deliberate deviation, stated plainly.** `updateSplitContent`'s write-through is gated on _"the
split path has an open tab"_, per Task 7.1 and dispatch §3 — **not** on `splitFilePath ===
activeFilePath`. So in the different-files case, editing a file in the split pane now updates that
file's background tab record and lights its dirty dot, where before it did not. Test: _"writes
through even when the split file is NOT the active file"_.

This is in tension with the strictest reading of AC5, and I am not going to paper over it. Gating
7.1 on same-path would reopen the exact divergence C2 exists to close: open `b.ts` as a tab, split
open `b.ts`, edit it in the split, click the `b.ts` tab — the primary pane would show pre-edit text
and the next save would discard the edit. That is a straight AC1 failure. AC5's "no degradation of
the ordinary case" is satisfied in what it protects (no prompts, no mirroring, no cursor effects, no
change to either pane's read path); what changed is that a background tab is now correctly marked
dirty. **Reviewer's call if that reading is too generous.**

---

## 6. AC4 evidence for both dirty notions

The two notions are the tab record's `isDirty` (tab-strip dot) and `CodeEditorComponent`'s local
`isDirty` signal (per-pane "Modified" badge, driven from `baselines`). They are not the same object
and neither followed the other for free.

**Tab record.** Both save paths call `markTabClean`. Two tests: _"a save from the SPLIT pane marks
the tab clean, as the primary pane already did"_ and _"a save from the PRIMARY pane still marks the
tab clean"_.

**Per-pane badge.** This needed real work, and the naive version was wrong twice:

1. _A mirror was clearing the badge._ `syncFile:400` sets `baselines.set(key, content)` on every
   external update, which is right for a revert/reread and wrong for a mirror — the mirrored text is
   unsaved. Left alone, the mirrored pane would show "not modified" on a file the tab strip
   correctly showed dirty. Fixed with `contentIsPersisted === false` suppressing the baseline write.
   Test: _"applies a mirror of the other pane and keeps the pane marked modified"_.
2. _A peer save was not clearing the badge._ When the other pane saves, no content reaches this pane
   (it already has the text), so nothing re-ran to update its baseline. Fixed with the dedicated
   baseline-only effect. Test: _"clears the modified badge when the OTHER pane saves the shared file
   (AC4)"_.

**Why the badge fix is a separate effect and not a `syncFile` dependency.** `contentIsPersisted` is
derived from the tab's dirty flag, so it flips on the _first keystroke_. If `syncFile`'s effect took
a dependency on it, that keystroke would re-run `syncFile` with the primary pane's deliberately
stale `activeFileContent` and push it straight over the keystroke — the §1.2 hazard, reintroduced
by the AC4 fix. The new effect therefore touches `baselines` / `isDirty` only and never content, and
`syncFile` reads the input through `untracked()`. The negative typing test (§7) drives
`contentIsPersisted` on every keystroke specifically to hold this line.

Panel-side wiring pinned by _"hands both panes the tab record dirty state, and only for a shared
file"_: `[false, false]` when shared+dirty, `[true, true]` when shared+clean, `[undefined]` with no
split.

---

## 7. The negative typing test

`code-editor.component.spec.ts` →
**`(§1.2) continuous typing in the FOCUSED pane never pushes an edit into its own model`**

It wires the component the way the panel wires the pane that has focus: `contentChanged` is
subscribed and routed to a local stand-in tab record, and the _only_ thing derived from that record
and fed back in is `contentIsPersisted`, which flips `true → false` on the first keystroke. Twenty-
five keystrokes are then driven through the real Monaco content callback, with a change-detection
flush after each.

Asserts:

1. `model.pushEditOperations` was **not called** — the cursor never moved to the end of the buffer
   and the undo stack was never collapsed. This is the assertion the whole batch turns on.
2. `component.content()` is still `'AAA'` while `tabRecord.content` holds all 25 characters —
   i.e. **ownership moved to the tab record and the read source did not**. This is the structural
   assertion: rebinding `[content]` to the tab record breaks it immediately, so the hazard cannot be
   reintroduced silently by a later batch.
3. `component.isDirty()` is `true` — the pane still reports itself modified throughout.

**It passes.** And per §2 it has demonstrated teeth: the same harness with `content` re-fed produced
10 pushes.

---

## 8. Standing gates §2 — verbatim output

**Gate 1 — NFR-1 cross-project invariant (floor 145 + 1718 = 1863):**

```
$ npx nx test ptah-electron
Test Suites: 1 skipped, 13 passed, 13 of 14 total
Tests:       4 skipped, 145 passed, 149 total

$ npx nx test rpc-handlers
Test Suites: 74 passed, 74 total
Tests:       31 skipped, 1718 passed, 1749 total
```

145 + 1718 = **1863**. Floor held exactly. No test converted to skipped.

**Gate 2 — Typecheck, every changed project:**

```
$ npx nx run @ptah-extension/editor:typecheck
Successfully ran target typecheck for project @ptah-extension/editor

$ npx nx run ptah-extension-webview:typecheck
Successfully ran target typecheck for project ptah-extension-webview
```

(The webview is the consumer of the changed public component surface, so it is typechecked too.)

**Gate 3 — Lint, standalone per project:**

```
$ npx nx run @ptah-extension/editor:lint --max-warnings=-1
✖ 14 problems (0 errors, 14 warnings)
Successfully ran target lint for project @ptah-extension/editor
```

**0 errors / 14 warnings — exactly the stated baseline.** All 14 are pre-existing and in files I did
not author (`branch-picker-dropdown.component.spec.ts`, `git-status-bar.component.ts`, plus
pre-existing non-null assertions in `code-editor.component.spec.ts` and `editor-workspace.spec.ts`).
My first pass added a 15th (a non-null assertion at `code-editor.component.spec.ts:551` in the new
typing test); it is removed and the count is back to 14. No repo-wide `nx affected` was used.

**Gate 4 — Affected unit tests:**

```
$ npx nx test @ptah-extension/editor
Tests:       260 passed, 260 total

$ npx nx test ptah-extension-webview
Test Suites: 5 passed, 5 total
Tests:       25 passed, 25 total
```

Editor baseline after Batch 6 was 16 suites / 222 tests. Now **260** — 222 preserved, **+38 added**,
zero modified, zero skipped. No Batch 4 drag spec and no Batch 6 D1 spec was touched; the only edit
inside an existing test family was adding `contentIsPersisted` to the shared
`StubCodeEditorComponent` and four `jest.fn()`s to the shared `makeEditorServiceStub()` — both are
additive fixture declarations, no assertion changed.

New tests by file: `editor-diff-split.spec.ts` +19, `editor-panel.component.spec.ts` +10,
`code-editor.component.spec.ts` +5, `editor-workspace.spec.ts` +4.

**Gate 5 — Three-runtime build:** not required and not run. No `libs/shared` file and no
`libs/backend` file was touched (`git diff --stat` covers six files, all under
`libs/frontend/editor/src/lib/`).

**Gate 6 — Scope discipline (NFR-9):** work confined to `libs/frontend/editor/**`. Nothing outside
this batch was fixed opportunistically; see §9. `--no-verify` not used (no commit made at all).
Working-tree entries under `apps/ptah-license-server/**`, `libs/api*/**`, `libs/web/**`,
`marketing/**` and other `.ptah/specs/TASK_2026_17{1,7,9}` folders belong to the concurrent
TASK_2026_177 session and were left untouched.

**Gate 7 — NFR-2:** `ChangeDetectionStrategy.OnPush` unchanged on both components touched
(`CodeEditorComponent`, `EditorPanelComponent`) and on the new stub. Signals + `inject()` throughout;
the new state is one `signal` on the panel and one timer handle on the helper. The mirror is keyed
off `splitFilePath`/`activeFilePath`, which are already workspace-partitioned, and the leg-4 change
strengthens that partitioning rather than adding new unpartitioned state.

---

## 9. Found and NOT fixed (NFR-9)

1. **`closeSplit`'s `stopPropagation` at `editor-panel.component.ts:621-624`.** Untouched, as
   instructed. It is now ~90 lines from where I worked and still looks like a leftover. Filed, not
   fixed.
2. **`onPaneClick` is bound on a non-interactive `<div (click)>`** for both panes
   (`:363` and the left pane's container). Same class of a11y issue Batch 6 addressed for the tab
   strip. Not in D1's scope and not in mine. Note it interacts with my work: pane focus — and
   therefore the reconciliation that closes the divergence window — is reachable by mouse only. A
   keyboard user who tabs into the other Monaco does not change `focusedPane`, so that pane cannot
   save either (`code-editor.component.ts:482` gates Ctrl+S on `isFocused()`). No data-loss risk,
   but split-pane editing is effectively mouse-required. **Recommend filing as its own item.**
3. **The delete-confirmation and name-input modals (`:443-500`) have no `role`, no `aria-modal`, no
   focus management, and a clickable `modal-backdrop` div.** My new conflict dialog does not repeat
   any of that (`role="alertdialog"`, `aria-modal`, `aria-labelledby`/`describedby`, focus moved to
   Cancel, inert backdrop), which means this file now has one accessible modal and two inaccessible
   ones. Not fixed — it is an unrelated a11y change and would blur the save-semantics diff.
4. **The right pane already had the `content` echo loop before this batch**
   (`splitFileContent` is set from the right pane's own `contentChanged`). I did not remove it; it
   is masked by last-write-wins signal semantics, and removing it would be a read-path change
   AC5 forbids. It is worth knowing it exists.
5. **The dispatch's existing-coverage figures are overstated.** `editor-diff-split.spec.ts` has 20
   tests, but **0** of them are split-aware — all 20 are diff-tab tests; the 19/20 claim does not
   match the file (the split signals appear only in the `makeState()` fixture). Same for
   `editor-workspace.spec.ts`: 15 tests, **0** split-aware. Before this batch there was no assertion
   anywhere on split-pane behaviour. Counts of 20/15/14/23 total tests are correct.

---

## 10. What I could not verify, and where this falls short

Stated straight, not rounded up.

1. **Nothing was verified in a running app.** Everything here is jsdom + a faked Monaco. The Monaco
   fake models `pushEditOperations` as a whole-value assignment, so it proves _whether_ a push
   happens, not what real Monaco does to the cursor or undo stack when one does. I never launched
   the extension, Electron or the webview. **The mirroring and the conflict dialog have not been
   seen by a human.**
2. **Residual race: one change-detection tick at focus change.** `setFocusedPane` reconciles both
   panes by setting a signal; the target pane's model updates on the next CD flush. If the user
   typed into the newly focused pane inside that window, the reconciliation would push over those
   characters. The window is one CD cycle immediately following a mouse click, so I believe it is
   not reachable through the UI, but I could not construct a test that proves it _unreachable_ —
   only that the reconciliation happens. This is the residual the conflict prompt backstops.
3. **Absorbing the peer's edits moves the cursor in the pane you just clicked into.** When you click
   into a pane that is behind, it receives a full-model replacement and the caret lands at the end
   rather than where you clicked. This is correct-but-jarring and is the price of "absorb rather
   than show stale text". A minimal-diff apply would fix it; that is a larger change than this batch
   should carry.
4. **After Cancel, the two panes remain different until the next focus change.** AC3 says Cancel must
   abort the write, and it does — no RPC, no tab mutation. But the panes are then knowingly out of
   step, marked only by the tab-strip dirty dot. I judged auto-reconciling on Cancel to be worse:
   it would destroy exactly the edits the user pressed Cancel to protect. **This is a defensible
   reading of AC1's "reflects it or is visibly marked diverged", not an airtight one, and a reviewer
   may reasonably want an explicit divergence marker in the pane chrome instead.**
5. **The conflict dialog has no focus trap.** Focus moves to Cancel on open (tested), and Escape
   cancels (tested), but Tab can leave the dialog, and focus is not restored to the editor on close.
6. **The panel-level AC5 test leans on a mocked predicate.** `hasUnabsorbedPeerEdit` is stubbed in
   the panel spec, so the "different files never prompt" assertion there proves the wiring, not the
   gate. The gate itself is proved in `editor-diff-split.spec.ts` against real state. They are
   complementary, not redundant — I mention it so nobody reads the panel test as stronger than it is.
7. **No axe run.** Batch 6 established the a11y bar for this file. I added ARIA by construction and
   avoided the patterns that produced Batch 6's findings (no interactive handler on a
   non-interactive element in the new markup), but **I did not run an accessibility scanner**, so I
   cannot claim the new dialog is violation-free — only that it was written to avoid the known ones.

---

## 11. ⛔ SEQ-2 — this batch does NOT clear the gate for Batch 8

Completing Batch 7 does not satisfy SEQ-2 and must not be read as doing so. Batch 8 (D2, hunk
stage/revert) remains blocked until **Batch 2's A1–A4 acceptance criteria are independently
verified** — not implemented, not committed, independently verified. Nothing in this batch touched
Batch 2's correctness, and nothing here constitutes that verification.

The natural cut line (R-7) sits immediately after this batch. Batches 0–7 are complete and coherent
as delivered; stopping here costs the D2 feature and nothing else.

---

# Round 2 — serious findings addressed

Review: `batch-7-code-logic-review.md` (APPROVED WITH FOLLOW-UPS, 0 critical / 2 serious /
3 moderate). The coordinator overrode the reviewer's "fast follow-up" disposition on both serious
issues; both are fixed here, in this batch, before commit.

**Still no git operations.** No `add`, `commit`, `stash`, `checkout`, `reset` or `restore`. The
index is untouched and empty. The hazard probe and the axe probe were both reverted/deleted by file
copy and `rm`, never by git.

Files changed in Round 2 — two, both already in the batch:

| File                                                                                                  | Change                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `D:\projects\ptah-extension\libs\frontend\editor\src\lib\editor-panel\editor-panel.component.ts`      | Serious 2: `#saveConflictOverwrite` viewChild, `(keydown)` Tab-cycle guard on the dialog container, `saveConflictReturnFocus` capture + `closeSaveConflict()` restore, both dismiss paths routed through it. |
| `D:\projects\ptah-extension\libs\frontend\editor\src\lib\editor-panel\editor-panel.component.spec.ts` | +9 tests: 2 read-path regression guards (Serious 1), 7 focus-management tests (Serious 2). Three signals added to the shared stub's type cast.                                                               |

Test count **260 → 269**. No existing test modified.

---

## Serious 1 — the guard now sits at the real vulnerable site

The reviewer was right, and the finding is the more serious of the two: my permanent negative test
proved a property of `CodeEditorComponent` in isolation, wired by hand. It never touched
`editor-panel.component.ts`, which is where the binding a future engineer would actually change
lives. The reviewer made that change and the whole suite stayed green. A guard that cannot fail
reads as protection and is worse than none — the same defect class Batch 6's executor caught in its
own work and fixed on the spot.

**Added** — `editor-panel.component.spec.ts`, new describe
_"EditorPanelComponent — focused-pane read path (C2 §1.2 regression guard)"_:

1. **`keeps the focused primary pane OFF the tab record however much is typed into it`** — the stub
   service's `updateTabContent` is given a real implementation that moves the tab record on every
   call, so the panel drives a genuine typing loop: 19 keystrokes emitted through the rendered
   pane's `contentChanged`, change detection flushed after each. Asserts the owner advanced to the
   full typed string **and** that the focused pane's `content` input is still `'v0'` and
   `not.toBe(ownerContent())`.
2. **`binds each pane to its OWN read surface, not to the shared tab record, while it holds focus`**
   — drives the tab record to `'OWNER v1'` while both pane signals hold `'v0'`. Value equality
   normally hides _which_ of the two a binding reads; separating them makes a rebinding of **either**
   pane an observable value change. Asserts per pane, with that pane focused.

Test 2 exists because test 1 alone cannot cover the right pane: `updateSplitContent` legitimately
writes `splitFileContent` and the tab record to the same value, so during a right-pane typing loop
the two are equal by construction and no typing-based assertion can distinguish them.

### Non-vacuity proof — both directions, as instructed

I reintroduced the hazard at **both** binding sites (`codeEditorContent` deriving from
`sharedSplitTab()?.content`, and the right pane's `[content]` likewise — the literal `tasks.md`
Task 7.2 wording), then ran the full suite:

```
hazard reintroduced
  ● EditorPanelComponent — focused-pane read path (C2 §1.2 regression guard) › keeps the focused primary pane OFF the tab record however much is typed into it
  ● EditorPanelComponent — focused-pane read path (C2 §1.2 regression guard) › binds each pane to its OWN read surface, not to the shared tab record, while it holds focus
Tests:       2 failed, 260 passed, 262 total
```

**Exactly the two new guards fail, and nothing else.** Compare the reviewer's result for the same
change against the shipped suite: 259/259 green, zero failures.

Reverted by restoring the pre-probe copy of the file, then re-verified:

```
Tests:       262 passed, 262 total
```

and confirmed both bindings are byte-identical to `HEAD` — `git diff` on
`editor-panel.component.ts` contains **no** `[content]` line, and the two bindings read
`[content]="codeEditorContent()"` (`:316`) and `[content]="editorService.splitFileContent()"`
(`:390`) as before.

---

## Serious 2 — conflict dialog focus containment

**Fixed**, not deferred. This was new code from this batch, reachable in ordinary keyboard use, one
batch after Batch 6 raised this file's bar.

- **Tab containment.** `(keydown)="onSaveConflictKeydown($event)"` on the labelled dialog container.
  The dialog has exactly two focusable elements, so Tab and Shift+Tab are the same two-way toggle;
  the handler `preventDefault()`s and moves focus between Cancel and Overwrite. I used this rather
  than a general focus trap because it is small enough to verify exhaustively, and because putting
  the handler on the container (catching the buttons' bubbled keydown) means **no new tab stop** is
  introduced — the container never becomes focusable itself.
- **Focus restoration.** `saveConflictReturnFocus` captures `document.activeElement` in
  `saveFromPane` _before_ the signal flips — i.e. before the open-effect moves focus to Cancel — so
  it records the editor whose Ctrl+S raised the dialog. `closeSaveConflict()` clears the signal and
  restores focus, guarded on `isConnected`. Cancel, Overwrite and Escape all route through it.
- **Preserved and still tested:** focus-on-open to Cancel, and Escape-to-cancel.

**7 tests added**: Tab cycles Cancel→Overwrite→Cancel with `preventDefault` asserted on each
(via the `dispatchEvent` return value); Shift+Tab contained; non-Tab keys pass through untouched;
focus restored on Cancel, on Overwrite, and on Escape; and no throw when the raising element has
been removed from the DOM.

### axe — run, not assumed

I ran `axe-core@4.12.1` over the **rendered** `.modal.modal-open` subtree of the real
`EditorPanelComponent` (not hand-copied markup), with the Round 2 focus changes in place, via a
temporary spec deleted immediately afterwards:

```
AXE_RESULT {"violations":[],"incomplete":[{"id":"color-contrast","nodes":1}]}
```

**0 violations.** The single `incomplete` is `color-contrast`, which is meaningless in unstyled
jsdom — no CSS is loaded, so axe cannot compute a ratio. This matches the reviewer's independent
scan and closes the gap I flagged in §10.7.

Two honest limits on that result, neither hidden:

1. **axe has no automated rule for focus trapping.** It could not have caught Serious 2 and cannot
   confirm the fix. The trap is covered by the 7 behavioural tests above, not by axe.
2. **I did not leave the axe check as a permanent spec.** `axe-core` is not a declared dependency of
   this repo — only `@axe-core/playwright` is, and `axe-core` is reachable only transitively. A
   permanent spec importing it would break silently on a dependency bump. Declaring `axe-core` as a
   devDependency means editing `package.json`, which is outside my "touch only
   `libs/frontend/editor/**`" constraint. **Filed below rather than done.**

---

## The three moderate issues

**Moderate 3 — "the conflict prompt backstops the race" is wrong. Correcting it here.**

Report §10.2's closing sentence says the residual focus-change race is "the residual the conflict
prompt backstops." The reviewer is right that this is backwards, and the reasoning matters:
`hasUnabsorbedPeerEdit` fires on `shared.content !== content`. If the race were ever hit, the
full-model push would have brought the pane into _exact_ agreement with the tab record — erasing
the very difference the predicate needs. The prompt would specifically **not** fire.

**The corrected statement**: what makes the race acceptable is that it is unreachable, not that
anything catches it. And the reviewer's mechanism for unreachability is better than mine — it is
single-threaded event-loop ordering (a click task's microtasks fully drain before the browser
dequeues the next native `keydown`), not merely change-detection cadence. I accept that correction.
§10.2 stands as written for the record; **this paragraph supersedes its final sentence.**
I checked the source for the same claim: `grep -rn "backstop" libs/frontend/editor/src/` returns
three hits, all pre-existing and unrelated (`diff-view.component.ts:261`, `editor.service.ts:180`,
`git-branches.service.ts:240`). No code comment carries the inaccurate claim, so this is
documentation-only, as the reviewer said.

**Moderate 4 — AC5 background-tab dirtying.** Reviewed and accepted by the reviewer as fixing a
genuine pre-existing bug rather than degrading AC5. No action; it remains disclosed in §5.

**Moderate 5 — Leg 4 is wider than "split-pane save".** Accepted as the correct one-line fix, flagged
as scope creep by the letter of NFR-9. No action; it remains disclosed in §3.

---

## Filed for Batch 9 — concrete fixes, not open questions

Each has a specific one-line change, per the instruction not to leave a confirmed defect as a
"maybe".

1. **Keyboard users cannot focus a split pane, therefore cannot save from one.** `focusedPane` is
   updated only by `(click)` on the pane `<div>`s (`:203`, `:366`); `Ctrl+S` is gated on
   `isFocused()`. **Fix**: add `(focusin)="onPaneClick('left'|'right')"` alongside the existing
   `(click)` on both pane containers, so focus entering a pane by keyboard sets `focusedPane` the
   same way a click does.
2. **`closeSplit`'s `stopPropagation()`.** Untouched across both rounds, as instructed. **Fix**:
   delete the `event.stopPropagation()` line and drop the `MouseEvent` parameter — the close button
   is already a sibling of the pane container after Batch 6's de-nesting, so nothing depends on the
   suppression.
3. **Pre-existing right-pane self-echo** (reviewer's Failure Mode 4). `updateSplitContent`'s first
   line still sets `splitFileContent` from the right pane's own `contentChanged`. **Fix**: drop that
   line and let the right pane's `[content]` read the shared tab record when one exists, falling back
   to `splitFileContent` only for the no-tab case — which requires the new §1.2 guards to be
   re-pointed at the same time, so it is genuinely a batch of its own.
4. **No dedicated "these panes disagree" affordance.** After Cancel, the only cue is the generic
   dirty dot. **Fix**: add a `badge badge-warning` "Diverged" chip to the split pane's header bar,
   shown when `hasUnabsorbedPeerEdit(splitFilePath(), splitFileContent())` is true.
5. **`axe-core` is not a declared dependency.** **Fix**: add `"axe-core": "^4.12.1"` to
   `devDependencies` and convert the deleted probe into a permanent spec, so dialog accessibility is
   enforced by CI rather than by a reviewer remembering to scan.
6. **The delete-confirm and name-input modals** (`:443-500`) still have no `role`, no `aria-modal`,
   no focus management, and clickable backdrops. **Fix**: apply the same shape this batch's dialog
   now uses — `role="alertdialog"` + `aria-modal` + `aria-labelledby`/`describedby`, the shared Tab
   toggle, and `closeSaveConflict`-style focus restore.

---

## Standing gates — re-run after Round 2, verbatim

```
$ npx nx run @ptah-extension/editor:lint --max-warnings=-1
✖ 14 problems (0 errors, 14 warnings)

$ npx nx run @ptah-extension/editor:typecheck
Successfully ran target typecheck for project @ptah-extension/editor

$ npx nx run ptah-extension-webview:typecheck
Successfully ran target typecheck for project ptah-extension-webview

$ npx nx test @ptah-extension/editor
Tests:       269 passed, 269 total

$ npx nx test ptah-extension-webview
Tests:       25 passed, 25 total

$ npx nx test ptah-electron
Tests:       4 skipped, 145 passed, 149 total

$ npx nx test rpc-handlers
Tests:       31 skipped, 1718 passed, 1749 total
```

145 + 1718 = **1863**. NFR-1 floor held exactly. Lint still **0 errors / 14 warnings** — the same
14 pre-existing locations; the 9 new tests added none. Gate 5 (three-runtime build) still not
required: no `libs/shared` or `libs/backend` file was touched in either round. Gate 7: OnPush
unchanged; the new focus state is one private field and one `viewChild`.

`git status --porcelain -- libs/frontend/editor/` shows exactly the six files this batch owns and
no untracked residue from either probe.

### One flake worth naming

`perf M2 scaling — directory indicator lookup (B3 AC2)` failed once during Round 2 with
`Expected: < 3 / Received: 23.89` and passed on three subsequent runs. It is a timing/GC-noise
assertion in Batch 3's work, unrelated to anything here — the reviewer hit the same flake
independently. **Not mine, not fixed, but it is a real flaky test in CI and should be filed.**

---

## Still not verified after Round 2

Unchanged from §10 and not rounded up:

- **Nothing has been run in a real app.** Everything remains jsdom plus a faked Monaco whose
  `pushEditOperations` is a whole-value assignment. The negative and regression guards prove
  _whether_ a push happens; they cannot prove what real Monaco does to cursor, undo or IME
  composition state when one does.
- **The focus trap is verified in jsdom.** jsdom does not implement native Tab traversal, so the
  tests assert the handler's behaviour (focus moved, default prevented) rather than observing the
  browser's own focus walk. This is the standard limit of the technique, and it is why item 5 above
  matters.
- Report §10 items 1, 3, 4 and 6 were explicitly ruled out of this round by the coordinator and are
  unchanged.
