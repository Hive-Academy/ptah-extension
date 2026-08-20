# Code Logic Review — Batch 7 · TASK_2026_173 · Split-Pane Save (C2)

## Review Summary

| Metric              | Value                    |
| ------------------- | ------------------------ |
| Overall Score       | 7/10                     |
| Assessment          | APPROVED WITH FOLLOW-UPS |
| Critical Issues     | 0                        |
| Serious Issues      | 2                        |
| Moderate Issues     | 3                        |
| Failure Modes Found | 4                        |

All verification in this review was done independently against the working tree: `git diff HEAD`
on every changed file, live re-runs of every standing gate, a live jsdom+axe-core scan of the new
dialog markup, and a **deliberate reintroduction of the literal Task 7.2 hazard** in
`editor-panel.component.ts` to test whether the shipped suite would catch it. Full method and
results below (§ "Independent verification performed").

---

## The 5 Paranoid Questions

### 1. How does this fail silently?

Two ways, both real, neither hidden by the executor:

- **The residual one-CD-tick focus-change race** (report §10.2): if a keystroke could land in the
  window between `setFocusedPane`'s synchronous `activeFileContent.set(...)` and the effect that
  applies it to the Monaco model, that keystroke is discarded by the full-model
  `pushEditOperations` with **no trace left behind** — after the push, the pane's model again
  exactly equals the tab record, so `hasUnabsorbedPeerEdit` would see no divergence and the
  conflict prompt would never fire. I independently re-derived reachability (see Q4) and concur
  with the executor that this is not reachable through real keyboard/mouse timing — but the
  report's own framing, "this is the residual the conflict prompt backstops," is not correct as
  stated: _if_ the race were ever hit, the prompt would specifically **not** catch it, because the
  divergence it would need to detect is exactly what the race erases. This is a documentation
  precision issue, not a functional one, since I agree the race is unreachable — but it should not
  be read as "backstopped."
- **The regression-protection gap I found by direct experiment** (see Q5 below and the
  verification section): rebinding the focused pane's `[content]` to derive from the tab record —
  the literal, explicitly-forbidden Task 7.2 wording — passes the **entire** shipped test suite
  (259/259 relevant tests, one unrelated flaky perf test aside) without a single failure. The
  "permanent negative test" in `code-editor.component.spec.ts` protects the component's _internal_
  mechanism, not the actual vulnerable wiring point in `editor-panel.component.ts`. A future
  engineer who does precisely what `tasks.md` Task 7.2 says, word for word, ships silently.

### 2. What user action causes unexpected behavior?

Absorbing the peer's edits moves the caret to the end of the buffer in whichever pane you just
clicked into — confirmed correct-but-jarring, not a defect, acceptable as the report frames it: the
alternative (a minimal-diff apply preserving cursor position) is materially more work than this
batch should carry, and losing cursor position on a background pane you were not typing in is a far
smaller cost than losing keystrokes.

A keyboard-only user cannot use split-pane save at all: `onPaneClick` is bound to `(click)` on a
`<div>` at both `editor-panel.component.ts:203` and `:366`, and nothing else updates
`focusedPane()`. I independently confirmed `Ctrl+S` is gated on `isFocused()`
(`code-editor.component.ts:555-556`), so a Tab-focused Monaco instance that never received a mouse
click cannot save. This is pre-existing (Batch 6's scope, not this one) and correctly filed, not
fixed, per NFR-9 — but it now has sharper teeth, since split-pane save is the exact feature this
batch ships.

### 3. What data makes this produce wrong results?

Genuine unabsorbed divergence (edit in pane A, save attempted from pane B before the 150ms mirror
flushes) correctly prompts, verified both by reading `hasUnabsorbedPeerEdit` and by the
`editor-diff-split.spec.ts` unit tests, which exercise it against real signal state rather than a
stub. I could not find a case where an ordinary (non-racing) same-file, same-pane save produces a
false-positive prompt, nor a genuine cross-pane divergence that fails to prompt — outside the
CD-tick race in Q1, which I judge unreachable.

### 4. What happens when dependencies fail?

Reasoned through the actual event-loop mechanics of the focus-change race rather than taking the
executor's "I believe" at face value: the webview shell runs Zone-based change detection
(`CLAUDE.md`: "zoneless in libs / Zone in webview shell"). `onPaneClick`'s synchronous handler sets
`focusedPane` and (via `reconcilePanesToTabRecord`) `activeFileContent`/`splitFileContent`
synchronously inside the same click task; Angular's effect scheduler flushes as a microtask, and
microtasks fully drain before the browser dequeues the next macrotask (a subsequent native
`keydown`). A human cannot physically produce a keystroke inside a sub-millisecond microtask-drain
window. I agree with the executor's conclusion, but for a more rigorous reason than "one CD cycle
immediately following a mouse click" — the mechanism that makes it unreachable is the JS
single-threaded event-loop ordering, not merely CD cadence, and that mechanism does **not** depend
on the debounce timing at all. Low risk, correctly deprioritized, but the report's stated
"backstop" via the conflict prompt (Q1 above) should be corrected or dropped, not carried forward.

### 5. What's missing that the requirements didn't mention?

An explicit "these two panes are showing different content for the same file" affordance. The tab
strip's dirty dot is used today, and it is ambiguous — it also lights for an ordinary single-pane
unsaved edit, so it does not specifically communicate "the other pane disagrees with what you're
looking at." I address this as a Rule item (§ "Ruling on the two invited judgement calls") below.

---

## Independent verification performed

1. **Diffed every changed file against `HEAD`** (`code-editor.component.ts`,
   `editor-diff-split.ts`, `editor-panel.component.ts`, `editor.service.ts`,
   `editor-workspace.ts`, and all four spec files). Confirmed the report's line-by-line narrative
   matches the actual diff in every instance I checked, including the specific claim that
   `[content]="codeEditorContent()"` (left pane, `editor-panel.component.ts:314-316` area) and
   `[content]="editorService.splitFileContent()"` (right pane, `:386-389`) are **not present in any
   diff hunk** — i.e. genuinely byte-identical to `HEAD`, only `[contentIsPersisted]` was added
   alongside each.
2. **Re-ran all seven standing gates live**, not from the report's transcript:
   - `nx test @ptah-extension/editor` → **260/260 passed**, 16 suites, matches exactly.
   - `nx run @ptah-extension/editor:typecheck` → clean, matches.
   - `nx run @ptah-extension/editor:lint --max-warnings=-1` → **0 errors / 14 warnings**, same 14
     locations reported (branch-picker spec, git-status-bar, code-editor spec non-null asserts,
     editor-workspace spec non-null asserts). Matches exactly.
   - `nx test ptah-extension-webview` → **25/25 passed**, 5 suites, matches.
   - `nx test ptah-electron` → **145 passed / 4 skipped**, matches the stated floor component.
   - `nx test rpc-handlers` → **1718 passed / 31 skipped**, matches the stated floor component.
     145 + 1718 = **1863**, floor held exactly as claimed.
3. **Reintroduced the literal Task 7.2 hazard and ran the full suite against it** (then reverted
   and re-confirmed a clean diff and a clean 260/260 rerun before finishing — no residual changes,
   confirmed via `git status --porcelain` on `libs/frontend/editor/`). This is the single most
   important thing I did in this review; see § "Finding: the negative test does not cover the real
   vulnerable site" below.
4. **Ran `axe-core@4.12.1` over the exact new dialog markup in jsdom** (transitively available in
   `node_modules`, same technique Batch 6 used, temp script created outside the repo's tracked tree
   and deleted after use, no residual files). **0 violations**, 1 `incomplete` (`color-contrast`,
   expected and meaningless in unstyled jsdom — no CSS loaded). This confirms the report's implicit
   claim that the static ARIA shape (`role="alertdialog"`, `aria-modal`, `aria-labelledby`,
   `aria-describedby`) is sound. It does **not** and cannot address the focus-trap gap (§ below) —
   axe-core has no automated rule for keyboard focus-trapping; that is a manual-interaction concern
   axe was never going to catch, and the report is honest that it never ran a scanner at all, so
   this closes that specific stated gap for the static markup while leaving the focus-trap gap,
   correctly, still open.
5. **Read `editor-tabs.ts:90-107`** directly to confirm `updateTabContent` sets `isDirty: true` and
   `markTabClean` sets `isDirty: false` — matches every claim built on top of it.
6. **Confirmed `closeSplit`'s `stopPropagation()` is still present, unchanged, at line 704** (report
   cites `:621-624` from the dispatch's pre-batch line numbers) — outside any diff hunk. Confirmed
   `onPaneClick` is still bound only to `(click)` on non-interactive `<div>`s at `:203` and `:366`,
   also outside any diff hunk. Both "found and not fixed" claims in §9 are accurate.

---

## Finding: the negative test does not cover the real vulnerable site (Serious)

**File**: `libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts:741-745`
**Scenario**: A future engineer executes `tasks.md` Task 7.2 exactly as literally worded — "Both
panes' `[content]` inputs derive from the tab record" — by changing:

```ts
protected readonly codeEditorContent = computed(() =>
  this.editorService.activeDiffTab() || this.editorService.isActiveFileImage()
    ? ''
    : this.editorService.activeFileContent(),
);
```

to derive from `sharedSplitTab()?.content` instead. I made exactly this change, ran
`nx run @ptah-extension/editor:typecheck` (clean) and `nx test @ptah-extension/editor`
(**259/260 passed, only an unrelated pre-existing flaky perf timing spec —
`perf-m2-indicator-scaling.spec.ts` — failed, on an assertion about GC/timing noise that has
nothing to do with this change**), then reverted and re-confirmed a clean tree.

**Impact**: The dangerous rebinding this entire dispatch exists to prevent can be reintroduced at
its actual location with **zero test failures**. The "permanent negative test" the report leans on
(`code-editor.component.spec.ts` — _"continuous typing in the FOCUSED pane never pushes an edit
into its own model"_) is a real, well-constructed test, but it proves a narrower claim than the
report implies: it proves that _if_ `content` is never re-fed with the tab record while
`contentIsPersisted` flips, no push happens. It does not, and structurally cannot, prove that the
panel continues to honor that precondition, because it wires `CodeEditorComponent` directly with a
hand-built stand-in and never touches `editor-panel.component.ts` at all.

**Current handling**: None. The report is candid that "AC5 is not an argument — it is a diff" (§2)
and that the read path is "provably unchanged" by inspection — that inspection is accurate today,
but nothing in CI enforces it stays that way.

**Recommendation**: Not a blocker for this commit — the code as shipped is correct, and I verified
that independently. But this should be filed as an immediate, cheap follow-up: one assertion in
`editor-panel.component.spec.ts` that binds a spy/stub to `EditorPanelComponent.codeEditorContent`
(or asserts the rendered `StubCodeEditorComponent`'s `content` input stays equal to
`activeFileContent()` and never equals the shared tab's content while that pane holds focus) would
close this gap in under an hour. Given the emphasis this entire dispatch places on this exact
hazard, and the standing instruction to be suspicious of a test suite that looks stronger than it
is (the vacuous a11y detector precedent), this is worth fixing before Batch 8 rather than letting it
ride indefinitely — but it does not need to block this batch's commit, since the shipped code itself
is correct.

---

## Ruling on the two invited judgement calls

### 1. Divergence after Cancel — accept as shipped, recommend (not require) a follow-up

The executor's core judgment — auto-reconciling on Cancel would destroy exactly the edits Cancel was
pressed to protect — is correct, and I would make the same call. Two things independently support
accepting the "marked only by the dirty dot" state as adequate for this batch, beyond the executor's
own reasoning:

- **The state is not a one-shot miss.** I traced `cancelSaveConflict()` — it only clears
  `saveConflict`; it touches nothing else. `hasUnabsorbedPeerEdit` is derived from `shared.isDirty`
  and `shared.content !== content`, neither of which Cancel changes. So the **next** save attempt
  from either pane re-evaluates the same predicate and prompts again. A user who tries to save twice
  in a row gets warned twice; the gap is only "read the file without saving," which by definition
  cannot itself lose data.
- **AC1's own wording is disjunctive** ("reflects it **or** is visibly marked diverged") and the tab
  strip's dirty dot is a real, if generic, visible signal — not a silent no-op.

I do not think this rises to a blocking defect. I do think the report's own hedge ("defensible, not
airtight") is honest and correct, and I'd register the same recommendation the executor already
made: a dedicated divergence affordance in the pane chrome (distinct from the ordinary dirty dot) is
worth scheduling, because the current signal is genuinely ambiguous between "this pane has unsaved
edits" and "this pane disagrees with its sibling." Non-blocking.

### 2. The residual focus-change race — reachability confirmed unreachable, but correct the "backstop" framing

Addressed under Q1/Q4 above. My independent conclusion: unreachable through real UI interaction,
for a more specific reason than the report gives (single-threaded JS event-loop ordering between a
click task's microtask flush and the earliest possible subsequent native keydown), not merely "one
CD cycle." I would ask that report §10.2's closing sentence — "This is the residual the conflict
prompt backstops" — be corrected in the next status update: if this race were somehow hit, the
resulting state is a silently dropped keystroke with **no** residual divergence for the conflict
predicate to catch, since the overwrite brings the pane back into exact agreement with the tab
record. The prompt does not backstop this specific failure mode; the fact that it is unreachable is
what makes it acceptable, not the prompt. This is a documentation correction, not a code change.

---

## The debounced-mirror correction — assessed and correct, and independently corroborated by code

The report's correction to the dispatch's mechanism claim (non-debounced echo is "largely absorbed"
by signal latest-value semantics; the hazard requires a race; the same conclusion holds "much more
strongly" for a debounced mirror) is prose that reads ambiguously about which "conclusion" it means,
but the substance is right: a value that is, _by construction_, up to 150ms stale will essentially
never equal live-typed content, so if it were ever bound to a focused pane's `content` input it would
push on nearly every keystroke rather than only under a rare race — which is exactly why the
implementation must never let that happen. I do not need to rely on the prose being airtight, because
the actual code enforces the invariant structurally, and I verified this two ways:

- `mirrorToUnfocusedPane()` (`editor-diff-split.ts`) re-reads `this.state.focusedPane()` at flush
  time, not at schedule time, and always targets whichever pane is **not** currently focused.
- The test _"NEVER writes into the pane that has focus — the mirror re-reads focus at flush time"_
  exercises exactly the case where focus changes mid-debounce and confirms the stale-focus pane is
  never targeted.

So even if the prose justification were weaker than it is, the design does not depend on it — the
gate is structural, not just reasoned-about. I assess this correctly and conclude the correction is
right in substance.

---

## Failure Mode Analysis

### Failure Mode 1: Task 7.2's literal hazard is silently reintroducible

- **Trigger**: A future change to `editor-panel.component.ts`'s `codeEditorContent`/right-pane
  `content` binding, following `tasks.md`'s original (superseded) wording.
- **Symptoms**: None until a user types fast enough, mid-session, to hit the race the deleted probe
  found (10/10 in the probe's synthetic harness) — cursor jumps to buffer end, undo stack collapses.
- **Impact**: Serious — silent, intermittent data/UX damage, exactly the class of bug this whole
  batch exists to prevent.
- **Current handling**: None at the panel level (see finding above).
- **Recommendation**: Add the panel-level regression test described above. Non-blocking for this
  commit; recommended before Batch 8.

### Failure Mode 2: Conflict dialog has no focus trap (new code, this batch)

- **Trigger**: Keyboard user opens the split-pane save conflict dialog and presses Tab repeatedly.
- **Symptoms**: Focus leaves the modal into background content that is still interactable (the modal
  is visually blocking but not focus-trapped); on close, focus is not restored to the editor.
- **Impact**: Moderate-to-serious accessibility regression, and unlike most of §9's "found and not
  fixed" items, this is **new code introduced in this batch**, one batch after Batch 6 explicitly
  raised this file's accessibility bar. It is reachable in ordinary keyboard use, unlike the CD-tick
  race.
- **Current handling**: Focus-on-open (to Cancel) and Escape-to-cancel are both implemented and
  tested. Tab-containment and focus-restore-on-close are not.
- **Recommendation**: **Fix now, not Batch 9.** Batch 9 is scoped to unrelated future work; this gap
  sits inside the exact file and exact kind of change (a new modal) that Batch 6 was about. A basic
  focus trap (cycle Tab between Cancel/Overwrite, restore focus to the pane that raised the dialog on
  close) is a small, contained addition to a component already using `viewChild` and an `effect()`
  for focus management — it does not require reopening the save-semantics logic this review is
  primarily judging. I would not block the commit on this alone, since it does not touch data
  correctness, but it should not be deferred as far as "Batch 9."

### Failure Mode 3: Ambiguous divergence signal after Cancel

- **Trigger**: User cancels a save conflict and does not immediately retry.
- **Symptoms**: The two panes show different content for the same file; the only visible cue is the
  ordinary tab-strip dirty dot, indistinguishable from a plain unsaved edit.
- **Impact**: Moderate — UX ambiguity, not data loss (see ruling above: no data is lost, and any
  subsequent save re-triggers the prompt).
- **Current handling**: Accepted as shipped per the ruling above.
- **Recommendation**: Track as a follow-up, not a blocker.

### Failure Mode 4: Pre-existing right-pane self-echo, unchanged and unworsened

- **Trigger**: Fast typing in the split (right) pane in the **different-files** case (no shared tab).
- **Symptoms**: `onSplitContentChanged` → `updateSplitContent` still does
  `this.state.splitFileContent.set(content)` as its first line — the same self-referential pattern
  Task 7.2's hazard describes, just pre-existing and un-debounced. I confirmed via diff that this
  exact line is untouched from `HEAD`.
- **Impact**: Theoretically the same race class as Failure Mode 1, but **pre-existing**, not
  introduced or worsened by this batch, and correctly left alone per NFR-9 (removing it would be a
  read-path change AC5 forbids, and fixing it would blur this batch's diff).
- **Current handling**: Unaddressed, correctly, and disclosed in report §9 item 4.
- **Recommendation**: File separately. Not this batch's problem.

---

## Critical Issues

None.

## Serious Issues

### Issue 1: Negative regression test does not cover the actual vulnerable binding site

- **File**: `libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts:741-745`
  (`codeEditorContent`) and `:386-389` (right pane `[content]` binding)
- **Scenario**: See Finding above and Failure Mode 1.
- **Impact**: The batch's stated central risk-mitigation claim ("the negative test... is the one
  failure a passing AC1/AC2/AC3 suite would not catch") is true of the suite that exists, but the
  suite does not close the loop at the one place a future regression would actually be introduced.
- **Evidence**: Live experiment, reverted; see "Independent verification performed" §3.
- **Fix**: Add a panel-level assertion pinning that `codeEditorContent()`/the right pane's `content`
  binding never equals the shared tab's content while that pane holds focus, distinct from
  `contentIsPersisted` wiring (which is already tested).

### Issue 2: New conflict dialog lacks a focus trap and focus restoration

- **File**: `libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts:503-548` (dialog
  markup), `:625-632` (`_panelKeydown`)
- **Scenario**: See Failure Mode 2.
- **Impact**: New, reachable, ordinary-keyboard-use accessibility defect landing one batch after this
  file's accessibility bar was explicitly raised.
- **Evidence**: Read the dialog markup and `_saveConflictFocus` effect directly — confirmed
  focus-on-open and Escape-to-cancel exist; confirmed no `keydown.tab` handling or focus-restore
  logic exists anywhere in the diff.
- **Fix**: Add a minimal Tab-cycle guard between the two buttons and restore focus to the
  save-initiating pane's editor on both Cancel and Overwrite.

## Moderate Issues

### Issue 3: Report's "conflict prompt backstops" claim is inaccurate for the specific race it describes

Addressed under Q1/Q4/Ruling 2 above. Correct in the status update, not in code.

### Issue 4: AC5 "one deliberate deviation" (different-files split edit now dirties a background tab)

Reviewed and accepted — this fixes a genuine pre-existing bug (Leg 2) rather than degrading the
AC5 case; no new prompts, mirroring, or read-path changes occur for different files. Non-blocking,
consistent with the report's own framing and test coverage (_"writes through even when the split
file is NOT the active file"_).

### Issue 5: Workspace-cache round-trip fix (Leg 4) is wider than "split-pane save"

The report is upfront that this also repairs a **primary-pane** data-loss bug
(`switchWorkspace` away-and-back reverting unsaved edits) that predates C2 and has nothing to do
with the split pane. I verified this claim directly against `editor-workspace.ts`'s diff: yes, the
fix derives both `activeFileContent` and `splitFileContent` from the tab record on restore, which
is strictly wider than what C2 AC1 requires in isolation. This is the correct fix (reconciling only
the split half would leave the two panes restoring from different stores, as the report notes), and
it is well covered by four tests including a full round-trip. Flagging only because it is scope
creep by the letter of NFR-9, even though it is the right one-line fix and the report disclosed it
plainly rather than hiding it inside "Leg 4 addressed." Non-blocking.

---

## Data Flow Analysis

```
Same-file, split-pane edit, FOCUSED pane types:
  Monaco content listener (focused pane)
    -> contentChanged.emit(value)                         [code-editor.component.ts:474]
    -> onContentChanged / onSplitContentChanged            [editor-panel.component.ts:915 / :768]
    -> EditorService.updateTabContent / DiffSplitHelper.updateSplitContent
    -> tab record updated SYNCHRONOUSLY, isDirty=true      [editor-tabs.ts:90-97]
    -> scheduleSplitMirror(path) — 150ms debounce armed    [editor-diff-split.ts]
  Focused pane's OWN [content] input: UNCHANGED (still activeFileContent()/splitFileContent(),
    read-only from this edit's perspective) -> syncFile sees content === model.getValue() -> no push.
  [GAP, closed only by inspection, not by CI: nothing prevents a future change from feeding the
   tab record's content back into this same pane's `content` input — see Serious Issue 1.]

  ...150ms later, unfocused pane...
    -> mirrorToUnfocusedPane() re-reads focusedPane() at flush time
    -> writes activeFileContent or splitFileContent for whichever pane is NOT focused
    -> that pane's syncFile sees content !== model.getValue() -> full-model pushEditOperations
       (applyingExternalEdit=true, so no contentChanged echo)

  ...focus change before the debounce fires...
    -> setFocusedPane(pane) -> cancelPendingMirror() -> reconcilePanesToTabRecord()
       [SYNCHRONOUS signal writes; effect flush is a microtask, provably faster than any
        subsequent native keydown — see Q4]

  ...save from either pane...
    -> saveFromPane -> hasUnabsorbedPeerEdit(filePath, content)
       -> shared.isDirty && shared.content !== content  => prompt
       -> else                                          => saveFile + markTabClean, silent
```

### Gap points identified:

1. The read-path invariant that prevents the whole hazard class is enforced by _convention plus
   manual diff inspection_, not by an automated test at the point where it actually matters
   (Serious Issue 1).
2. The conflict dialog itself is a new, unguarded focus boundary (Serious Issue 2).
3. Post-Cancel divergence has no dedicated visible marker beyond the generic dirty dot (Moderate,
   accepted).

---

## Requirements Fulfillment

| Requirement                                                               | Status   | Concern                                                                                                                                                |
| ------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C2 AC1 (no silent divergence, all paths incl. workspace-cache round-trip) | COMPLETE | Verified via diff + live test re-run, including Leg 4's four tests                                                                                     |
| C2 AC2 (save never silently discards peer edits)                          | COMPLETE | `hasUnabsorbedPeerEdit` verified against real signal state                                                                                             |
| C2 AC3 (conflicting save prompts or reconciles, never silent)             | COMPLETE | Prompt + Cancel/Overwrite paths tested and read; Cancel genuinely writes nothing                                                                       |
| C2 AC4 (dirty indicator correct in both notions, both panes)              | COMPLETE | Both `isDirty` (tab) and local badge (`contentIsPersisted`) paths read and tested                                                                      |
| C2 AC5 (different-files case unchanged)                                   | PARTIAL  | Read path byte-identical (verified); one accepted deviation (background-tab dirtying) — reasoned and tested, not a regression in the ordinary UX sense |
| C2 AC6 (independent per-pane Monaco models preserved)                     | COMPLETE | Model namespacing untouched; only the doc comment was rewritten, verified accurate to the new mechanism                                                |

### Implicit requirements not fully addressed:

1. Regression protection for the panel-level read-path invariant (Serious Issue 1).
2. Focus containment for the new modal (Serious Issue 2).
3. An unambiguous "these panes disagree" indicator distinct from the ordinary dirty dot (accepted
   as a follow-up, not required now).

---

## Edge Case Analysis

| Edge Case                                          | Handled          | How                                                               | Concern                                                               |
| -------------------------------------------------- | ---------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| No-tab split file (§1.4)                           | YES              | `sharedSplitTab()` returns null without a tab; three tests pin it | None found                                                            |
| Workspace switch away/back with unsaved split edit | YES              | Leg 4 fix, four tests incl. full round-trip                       | None found                                                            |
| Different files in both panes                      | YES              | Byte-identical read path; one accepted, tested deviation          | See AC5 note above                                                    |
| Rapid typing in focused pane                       | YES (as shipped) | Read path never receives own echo                                 | Regression protection gap at the real site (Serious 1)                |
| Focus change mid-debounce                          | YES              | `setFocusedPane` cancels timer + reconciles synchronously; tested | Sub-microtask race theoretically exists, practically unreachable (Q4) |
| Save with genuine peer divergence                  | YES              | Prompts, Cancel aborts fully, Overwrite writes through            | None found                                                            |
| Cancel then walk away                              | PARTIAL          | State stays divergent, only generic dirty dot signals it          | Accepted, follow-up recommended                                       |
| Keyboard-only pane focus / save                    | NO               | Pre-existing gap, correctly filed not fixed                       | Sharper now that split-save is shipped                                |
| New dialog keyboard trap                           | NO               | Open/Escape only                                                  | Serious Issue 2                                                       |

---

## Integration Risk Assessment

| Integration                                                | Failure Probability                                | Impact                                           | Mitigation                                                             |
| ---------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| CodeEditorComponent ↔ EditorPanelComponent content binding | LOW today, MED over time                           | High if hit (silent buffer corruption)           | Manual diff-reading only; needs a panel-level pinning test (Serious 1) |
| EditorDiffSplitHelper mirror timer ↔ focus changes         | LOW                                                | Low (self-corrects on next reconciliation)       | Well tested, re-reads focus at flush                                   |
| Save conflict dialog ↔ keyboard navigation                 | HIGH (any keyboard user who tabs past the buttons) | Low-to-moderate (a11y regression, not data loss) | None yet (Serious 2)                                                   |
| Workspace cache ↔ tab record                               | LOW                                                | High if hit (silent data loss, pre-existing)     | Fixed and tested this batch (Leg 4)                                    |

---

## Verdict

**Recommendation**: APPROVE WITH FOLLOW-UPS
**Confidence**: HIGH
**Top Risk**: The regression-protection gap at the actual Task 7.2 vulnerable site (Serious Issue
1). The shipped code is correct — I verified this by trying to break it and failing to find a
working exploit against the real invariant, only against the test suite's coverage of it — but the
suite would not stop someone from undoing that correctness later. Combined with the new,
un-trapped modal (Serious Issue 2), I would not let this ship completely open-ended; I would ask
for both to be closed in a fast follow-up (not necessarily before this commit lands, but before
Batch 8's SEQ-2 verification work begins, since Batch 8 depends on this file's editing surface
staying correct).

This does **not** touch SEQ-2 or Batch 8 readiness, which remain exactly as the executor stated:
gated on independent verification of Batch 2's A1–A4, unaffected by anything in this batch or this
review.

## What Robust Implementation Would Include

- A panel-level test that pins the read-path invariant directly, not just the component-level
  mechanism (closes Serious 1).
- A focus trap + focus-restore on the conflict dialog (closes Serious 2), consistent with the
  precedent Batch 6 set one batch earlier in this same file.
- A dedicated "panes diverged" visual marker distinct from the ordinary dirty dot, so AC1's
  disjunction ("reflects it or is visibly marked diverged") is met unambiguously rather than
  defensibly.
- End-to-end verification in a running Electron/webview instance at some point before this ships to
  users — everything here, on both sides (executor and this review), is jsdom plus a faked Monaco
  whose `pushEditOperations` is a whole-value assignment. It proves _whether_ a push happens, not
  what real Monaco does to cursor/undo/IME composition state when one does. This does not undermine
  any specific AC — the negative test's assertion (`pushEditOperations` not called) is meaningful
  regardless of Monaco's internals — but it is a real gap between "proven in jsdom" and "proven in
  production," worth closing before this feature is considered fully hardened.

---

## Round 2 re-verification

Scope: narrow re-check of the two Serious findings only, per the coordinator's instruction. Not a
re-audit of anything already cleared in Round 1. Report basis:
`batch-7-report.md` § "Round 2 — serious findings addressed" (lines 405–645).

### A. Serious 1 — the guard is genuinely non-vacuous (CONFIRMED)

I reproduced my own Round 1 experiment against the Round 2 code, independently, without reading the
executor's numbers first beyond knowing which two files changed:

- Reintroduced the literal Task 7.2 hazard at **both** binding sites: `codeEditorContent` (left
  pane, now `:760-764`) rebound to `this.sharedSplitTab()?.content ?? this.editorService.activeFileContent()`,
  and the right pane's `[content]` (`:390`) rebound to
  `sharedSplitTab()?.content ?? editorService.splitFileContent()`.
- `nx run @ptah-extension/editor:typecheck` — clean. The hazard compiles silently, as it must for
  this to be a meaningful regression test.
- `nx test @ptah-extension/editor --skip-nx-cache` — **2 failed, 267 passed, 269 total.** The
  failures are exactly and only the two new guards:
  `EditorPanelComponent — focused-pane read path (C2 §1.2 regression guard) › keeps the focused
primary pane OFF the tab record however much is typed into it` and `› binds each pane to its OWN
read surface, not to the shared tab record, while it holds focus`.
- The failure messages pin the read path specifically, not an incidental value: test 1 expected
  `'v0'`, received `'v0the quick brown fox'` (the pane's `content()` had visibly absorbed the typed
  text that should never reach it); test 2 expected `'v0'`, received `'OWNER v1'` (the pane's
  `content()` had visibly absorbed the tab record's value while deliberately different from it).
  Both are strict-equality checks against values that are _only_ equal under the correct, unrebound
  wiring — not an assertion that a refactor could satisfy by accident (e.g. neither test asserts on
  a boolean flag or a call count that a different bug could also flip).
- Reverted both edits by hand (not via git), re-ran typecheck (clean) and the full suite
  (**269/269 passed**), and confirmed `git status --porcelain -- libs/frontend/editor/` shows only
  the batch's own nine files with no residue.

This matches the executor's own reported numbers exactly (they report 262 total for the isolated
experiment because they ran it before adding the axe/focus tests that bring the suite to 269; the
delta is consistent — 260 baseline + 2 new guards = 262 at the point they ran their probe, then +7
focus-management tests = 269 final). **The guard is real.** It fails for the right reason, at the
right place, and disappears cleanly on revert. This closes Serious 1.

One nuance I did not initially find via the isolated component-level test in Round 1 but is now
covered: test 2's design (driving the tab record to a value that differs from _both_ pane signals
simultaneously) specifically defeats the "value equality accidentally hides a rebinding" failure
mode I raised in Round 1's finding — it is a materially stronger regression guard than a naive
typing-loop test alone would be, because it does not depend on timing/debounce races to manifest a
difference. I did not ask for this refinement and it exceeds what I required to close the finding.

### B. Serious 2 — the focus trap genuinely contains Tab (CONFIRMED)

Ran the 7 new focus-management tests in isolation:
`nx test @ptah-extension/editor --testPathPattern="editor-panel.component.spec.ts" -t "focus management"`
→ **7 passed, 7 total** (262 skipped, rest of file). All pass against the real rendered
`EditorPanelComponent` and real `document.activeElement`, not a stub of the focus behavior:

- Tab cycles Cancel → Overwrite → Cancel, with `preventDefault()` confirmed via the
  `dispatchEvent(...)` return value (`false` = default was prevented) at each step.
- Shift+Tab is contained the same way (single toggle between two elements, as the implementation
  claims — verified this is not merely asserted but actually exercised with `shiftKey: true`).
- A non-Tab key (`'a'`) is confirmed to pass through untouched (`dispatchEvent` returns `true`),
  which rules out the handler over-broadly swallowing all keydowns.
- Focus-on-open (to Cancel) and Escape-to-cancel are both still exercised and pass — no regression
  from Round 1.
- Focus restoration is tested on **both** dismiss paths independently (Cancel and Overwrite), plus
  Escape, plus a defensive case where the raising element has been removed from the DOM before the
  dialog closes (`isConnected` guard) — I read `closeSaveConflict()` directly and confirmed the
  guard is real, not just asserted in the test.
- I also read `saveFromPane` to confirm `saveConflictReturnFocus` is captured **before**
  `saveConflict.set(...)` runs, i.e. before the open-effect moves focus to Cancel — so it genuinely
  captures the pane that raised the dialog rather than capturing whatever the open-effect just
  focused. This is the detail that makes the restoration meaningful rather than a no-op that
  "restores" focus to Cancel itself.

This closes Serious 2 functionally. jsdom does not implement native browser Tab traversal, so this
proves the handler's own logic (prevents default, moves focus deliberately) rather than observing
an actual browser trap the OS/browser would otherwise walk through — the report discloses this
limit honestly in its own "Still not verified" section, and I agree it is the correct, standard
caveat for this technique, not a gap specific to this fix.

### C. The axe run is real and covers the rendered dialog (CONFIRMED, with one independent addition)

I did not take the transcript in the report on faith. I added a temporary test to the real spec
file (using the existing `save-conflict dialog focus management` describe block's own
`beforeEach`/`openConflict()` harness, which mounts the real `EditorPanelComponent`), ran it, and
deleted it afterward — confirmed via `git status --porcelain` that no residue remains and the full
269-test suite still passes cleanly post-cleanup.

- **Scoped to `.modal.modal-open` (the same subtree the executor targeted), dialog genuinely open**:
  `axe-core@4.12.1` → `{"violations":[],"incomplete":["color-contrast"]}`. Matches the report's
  claimed result exactly.
- **Baseline control I added myself, not in the report**: ran the identical axe scan with the
  dialog **never opened** (no `openConflict()` call). Same result:
  `{"violations":[],"incomplete":["color-contrast"]}`. This confirms `color-contrast` is generic
  jsdom noise (no stylesheet loaded, so axe cannot compute a contrast ratio anywhere in the tree),
  not a signal about the dialog specifically — closing the one gap I could imagine in the executor's
  single-sample result.
- **One incidental, out-of-scope observation, explicitly not part of this finding**: an unscoped
  axe run across the _entire_ `fixture.nativeElement` (not just the modal) surfaces one
  pre-existing `aria-required-children` violation on the tab strip's `.overflow-x-auto` /
  `role="tablist"` region, present identically with or without the dialog open. This is unrelated
  to Round 1 or Round 2 of this batch (same tab-strip markup Batch 6 already worked in and
  discussed trade-offs for), is not touched by any diff in this batch, and is outside the narrow
  re-check I was asked to do. Noting it only for the record, not as a finding against this batch —
  consistent with "do not re-audit what you already cleared."

axe confirms the static ARIA shape is clean; per both my Round 1 review and the report, axe has no
rule for focus-trap behavior, so the trap itself is proven by §B's behavioural tests, not by axe.
This division of proof is correct and I would not expect axe to do more here.

### Also checked, per the coordinator's request

- **§10 items 1, 3, 4, 6 untouched**: confirmed by direct comparison — the original §10 text (lines
  354–390 of the pre-Round-2 file, now unchanged ahead of the `---` separator at line 402) is
  byte-identical to what I reviewed in Round 1. Round 2 explicitly reaffirms items 1/3/4/6 are out
  of scope for this round and does not touch them (report lines 632–645). I re-confirm: no-running-
  app gap (item 1), caret-to-end on absorb (item 3), post-Cancel divergence (item 4), and the
  stubbed panel predicate for AC5 (item 6) are all exactly as I ruled on them in Round 1. No new
  information changes any of those rulings.
- **Moderate issues disposition**:
  - **Moderate 3** ("conflict prompt backstops the race" claim) — corrected in the report text
    itself (documentation-only, as I recommended; I independently confirm via
    `grep -rn "backstop" libs/frontend/editor/src/` that no code comment ever carried the
    inaccurate claim, so there was nothing in code to fix).
  - **Moderate 4** (AC5 background-tab dirtying) — no action; remains disclosed, as I accepted in
    Round 1.
  - **Moderate 5** (Leg 4 wider than "split-pane save") — no action; remains disclosed, as I
    accepted in Round 1.
- **Filed items carry concrete fixes, not open questions**: verified the "Filed for Batch 9"
  section (report lines 558–586) — all six items (keyboard pane-focus via `(focusin)`,
  `closeSplit`'s `stopPropagation`, the pre-existing right-pane self-echo, a "diverged" badge chip,
  declaring `axe-core` as a devDependency, and bringing the delete-confirm/name-input modals up to
  the same accessible shape) each state a specific change, not a vague "investigate this." None are
  open questions.

### Round 2 gate re-verification

Re-ran all gates live, independent of the report's transcript:

```
nx test @ptah-extension/editor          → 269/269 passed, 16 suites
nx run @ptah-extension/editor:typecheck → clean
nx run @ptah-extension/editor:lint --max-warnings=-1 → 0 errors / 14 warnings (same 14 locations)
nx test ptah-extension-webview          → 25/25 passed
nx test ptah-electron                   → 145 passed / 4 skipped
nx test rpc-handlers                    → 1718 passed / 31 skipped
```

145 + 1718 = **1863**. NFR-1 floor held exactly. All match the report's Round 2 numbers.

### Round 2 verdict

Both Serious findings from Round 1 are genuinely closed, not just claimed closed — I reproduced the
failing case for Serious 1 and the passing behavioural proof for Serious 2 independently, including
one control (the axe baseline) the report itself did not run. No new issues surfaced during this
narrow re-check. The three Moderate issues remain open by design (accepted/filed, not blocking),
consistent with my Round 1 disposition, and nothing in Round 2 changes that disposition. §10 items
1/3/4/6 are confirmed untouched and still stand as ruled in Round 1.

**Updated recommendation**: APPROVED. No outstanding blockers. The filed follow-ups (Batch 9 list,
6 items, all with concrete fixes) are appropriately deferred, not swept under the rug.
