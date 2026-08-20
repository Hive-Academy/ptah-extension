# Code Logic Review — TASK_2026_173 · Batch 6 (Accessibility, D1)

## Review Summary

| Metric              | Value                        |
| ------------------- | ---------------------------- |
| Overall Score       | 8/10                         |
| Assessment          | **APPROVED WITH FOLLOW-UPS** |
| Critical Issues     | 0                            |
| Serious Issues      | 0                            |
| Moderate Issues     | 2                            |
| Failure Modes Found | 4                            |

This review re-ran every live-runnable claim in `batch-6-report.md` rather than trusting the prose:
all four standing-gate suites, both DOM guards, the `stopPropagation` grep, and — independently,
outside the deleted throwaway harness — the axe-core `nested-interactive` /
`aria-required-children` / `aria-required-parent` claims for both the tablist trade (pre-decided,
verified only for factual accuracy per instructions) and the file-row list-ownership claim. Every
reproducible claim checked out. One causal claim in the report (why `host: { role: 'presentation'
}` was necessary) did **not** reproduce under an independent axe re-test — documented below as a
moderate finding, not a blocker, since the report's bottom-line result (0 violations on the
source-control tree) still holds regardless of the mechanism.

## The 5 Paranoid Questions

### 1. How does this fail silently?

The `role="tablist"` → close-button `aria-required-children` violation (pre-decided, accepted by
the user) is the one silent-ish failure: a screen reader user gets a slightly wrong tree shape
(the close button announced as an unexpected tablist child) but the control remains reachable,
labelled and operable, so this is a degraded announcement, not a broken one — consistent with the
user's ruling. The **empty-section `role="list"` child** (source-control-panel.component.ts:141-144,
201-204) is the more concerning silent failure: I confirmed independently (axe-core over the exact
markup) that it is a live `aria-required-children` **violation today, on both branches** — not a
theoretical risk "by inspection" as the report frames it. Nobody sees this because the populated-list
axe fixture never renders the empty branch.

### 2. What user action causes unexpected behavior?

Closing the _left-pane's_ active/inactive tab via the X button now also focuses the left pane
(§7.1 of the report). I traced the DOM: the tab strip (`editor-panel.component.ts:204`) sits inside
the left-pane container that carries `(click)="onPaneClick('left')"` at `:201`. With
`stopPropagation()` gone, the click genuinely bubbles there. This is a real, if minor, behavior
change — see §4 below for my ruling.

### 3. What data makes this produce wrong results?

None found — none of these components branch on data shape in a way the restructuring could
mis-render. The `@if (tab.diff && tab.diff.status !== 'fresh')` / dirty-dot conditionals are
untouched pass-throughs.

### 4. What happens when dependencies fail?

N/A for this batch — no new async/service dependency was introduced. `SourceControlService` calls
are unchanged in shape (same methods, just with `MouseEvent` params dropped, which were never used
for anything but suppression).

### 5. What's missing that the requirements didn't mention?

The dispatch (§7.2) told the executor to prefer axe-core wired into the e2e suite for AC1, and to
say plainly if that wasn't reachable. The executor's jsdom-out-of-band-axe compromise is reasonable
and disclosed, but it means **no axe assertion is committed to the repo** — the DOM-guard specs are
the only permanent AC1 regression protection. That is an acceptable trade given the constraints
(axe-core is only a transitive dependency), but it means a future refactor that reintroduces nesting
in a way the `parentElement?.closest()` walk doesn't catch (e.g., nesting two levels deep through a
non-element wrapper) would not be caught by axe at all — only by the hand-rolled walk. Low risk,
worth naming.

## Failure Mode Analysis

### Failure Mode 1: Empty-section list-ownership violation is real, not hypothetical

- **Trigger**: A `SourceControlPanelComponent` section (staged or unstaged) has zero files.
- **Symptoms**: `role="list"` region contains a plain `<div>` child instead of a `role="listitem"` —
  invalid ARIA ownership.
- **Impact**: Screen reader announces a malformed list structure whenever either section is empty —
  which, for "Staged Changes", is the common case (most working trees have nothing staged).
- **Current Handling**: Untouched by this batch (confirmed via `git diff` — the empty-state `<div>`
  lines fall entirely outside every hunk). Report calls it "by inspection... unverified."
- **My re-test**: I built the exact empty-state markup
  (`<div role="list"><div>No staged changes</div></div>`) and ran `axe-core` over it directly. It
  is a **critical `aria-required-children` violation**, reproducible, not merely suspected.
- **Recommendation**: This is correctly out of Batch 6's scope (pre-existing, not introduced here),
  but given it's now _confirmed_ rather than speculative, it should be a concrete Batch 9 item, not
  a vague "worth investigating."

### Failure Mode 2: Tab-close-focuses-pane behavior change

- **Trigger**: User clicks the close (X) button on any tab in the left pane while the right pane
  (split view) has focus, or vice versa.
- **Symptoms**: Closing the tab silently steals pane focus, which changes which pane subsequent
  keyboard actions (e.g. `Ctrl+W`, arrow-key file nav if any) target.
- **Impact**: Low — the report is correct that clicking the tab label already did this, so behavior
  becomes _more_ consistent, not less. But "silently steals focus as a side effect of closing" is
  the kind of thing a keyboard-heavy user in split-view could notice and find surprising the first
  time. Not a data-loss or correctness bug.
- **Current Handling**: Disclosed, not fixed, no test added specifically pinning the new
  cross-pane-focus behavior (only that `switchTab` is not called — AC5's assertions don't cover
  `onPaneClick` firing).
- **Recommendation**: Acceptable as landed; add a one-line regression test asserting
  `onPaneClick`/focused-pane behavior if this needs to be pinned intentionally, otherwise leave as a
  documented incidental change.

### Failure Mode 3: Small hit-area losses on tab/file-row edges

- **Trigger**: User clicks the outer 12px right margin of a tab, the 8px edge padding of a file row,
  or directly on the status badge / action-cluster gaps of a file row.
- **Symptoms**: Previously these clicks activated the row/tab (open diff / switch tab); now they do
  nothing, because that geometry moved from inside the button to the (non-clickable) wrapper.
- **Impact**: Minor UX regression, most noticeable on the status badge — "click near the file to open
  its diff" muscle memory partially breaks. The executor explicitly declined negative-margin
  workarounds rather than risk AC6 geometry drift.
- **Current Handling**: Disclosed, not fixed, no test asserts the _loss_ is bounded to just those
  margins.
- **Recommendation**: Acceptable trade — chasing pixel-perfect hit-area parity while also proving
  zero visual drift is a real tension, and the executor made the conservative choice (drop hit area,
  keep geometry exact) rather than the risky one (negative margins, threaten AC6). Not a blocker.

### Failure Mode 4: AC6 "35/35 identical" cannot be independently re-verified — the harness is gone

- **Trigger**: Any reviewer (this one included) who wants to confirm the pixel/geometry claims.
- **Symptoms**: The Playwright/Tailwind/daisyUI probe page described in report §5 was built,
  measured, and then deleted ("throwaway harness deleted"). There is no artifact in the tree to
  rerun.
- **Impact**: The single most load-bearing AC6 claim (0/35 differences) rests entirely on the
  report's prose for the geometry/paint numbers specifically — unlike the AC5/AC1 claims, which I
  could and did reproduce independently via grep, live test runs, and a fresh axe-core script.
- **Current Handling**: Honestly framed as "not rendered-pixel verified," and the one thing the
  harness _did_ catch (the `uppercase` regression) is independently corroborated: I confirmed via
  `node_modules/tailwindcss/lib/css/preflight.css:188-190` that `button, select { text-transform:
none }` is real, and the fix (repeating `uppercase` on the toggle button) is present in the
  committed source with a matching regression test. That gives circumstantial credibility to the
  rest of the measurement claims, but it is not the same as re-running them.
- **Recommendation**: Not a blocker — the code-level evidence (identical class lists moved rather
  than rewritten, per-file diffs) is consistent with "no visual change," and the one bug the harness
  did catch is real and fixed. But note for the record that AC6's headline number is unverifiable
  post-hoc.

## Critical Issues

None found.

## Serious Issues

None found.

## Moderate Issues

### Issue 1: The `host: { role: 'presentation' }` causal claim does not reproduce

- **File**: `libs/frontend/editor/src/lib/source-control/source-control-file.component.ts:137-140`
- **Scenario**: Report §3.3 claims "the dispatch did not mention the host element, but
  `<ptah-source-control-file>` sits between the panel's `role=\"list\"` and this row's
  `role=\"listitem\"`, which breaks ARIA ownership... axe confirms it works... **Without this the fix
  would have swapped one axe violation for another.**"
- **Evidence**: I independently built both variants in jsdom with `axe-core@4.12.1` (same version the
  report cites) — a `role="list"` containing an unroled custom-element host wrapping a
  `role="listitem"` div, and the same structure with `role="presentation"` added to the host. **Both
  pass `aria-required-children` and `aria-required-parent` with zero violations.** An unroled custom
  element with no implicit ARIA semantics appears to already be transparent to axe's required-owned-
  element computation, with or without an explicit `role="presentation"`.
- **Impact**: None functionally — the addition is harmless, and the report's bottom-line claim ("0
  violations on the source-control tree") is still correct and independently reproduced by me
  separately (see Requirements Fulfillment table). This is a case of the report overstating _why_
  something works, not _whether_ it works.
- **Fix**: No code change needed. Report language should be softened from "confirmed necessary" to
  "added defensively"; not worth a re-review cycle over.

### Issue 2: Empty-list violation downgraded from "confirmed" to "by inspection" in the report

- **File**: `libs/frontend/editor/src/lib/source-control/source-control-panel.component.ts:141-144,
201-204`
- **Scenario**: See Failure Mode 1. The report treats this as an unverified inspection-only risk;
  I confirmed it is a live, reproducible critical axe violation today.
- **Impact**: Doesn't change the scope decision (still correctly pre-existing, still correctly out of
  Batch 6), but the team-leader triaging "what goes into Batch 9" should treat this with the priority
  of a confirmed defect, not a maybe.
- **Fix**: File a concrete Batch 9 task: give the empty-state message `role="listitem"` (trivial,
  one-line fix, no visual change) rather than leaving it as an open question.

## Data Flow Analysis

```
User click on tab-close button (File A)
  → real bubbling MouseEvent (confirmed genuine `dispatchEvent(new MouseEvent(...bubbles:true))`
    in specs, not `.click()` shortcut)
  → onTabClose(filePath) fires [SIBLING of tab button — cannot reach onTabClick, confirmed
    structurally: close.parentElement === tab.parentElement, both direct children of the
    role="presentation" wrapper]
  → event continues bubbling (no stopPropagation anywhere in the chain — grep confirms only
    editor-panel.component.ts:622 `closeSplit` still calls it, out of scope)
  → reaches left-pane container's (click)="onPaneClick('left')" [confirmed via source read:
    the tab strip literally is a descendant of that pane div]
  → focusedPane signal flips — DISCLOSED, not a bug, minor behavior change (Failure Mode 2)
```

### Gap Points Identified:

1. Empty-section list content (Failure Mode 1) — pre-existing, confirmed real, not yet ticketed
   concretely.
2. AC6's central "35/35 identical" claim has no re-runnable artifact (Failure Mode 4) — inherent
   limitation of a throwaway-harness methodology, correctly disclosed but worth naming as residual
   risk.

## Requirements Fulfillment

| Requirement                                              | Status                                    | Concern                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 AC1 — no nested interactive elements                  | COMPLETE                                  | Verified: DOM-guard specs use the corrected `el.parentElement?.closest(sel)` form (confirmed present at all three call sites), and I independently reproduced the axe result — new shape passes `nested-interactive` in both trees.                                                                        |
| D1 AC2/AC3 — independent focus, Enter and Space          | COMPLETE, with disclosed jsdom limitation | Honest scope statement about jsdom not simulating the UA default action; reasonable given real `<button>` elements are used throughout.                                                                                                                                                                    |
| D1 AC4 — distinct, accurate label/role                   | COMPLETE                                  | Labels present and asserted per control in specs; spot-checked in source.                                                                                                                                                                                                                                  |
| D1 AC5 — `stopPropagation` deleted, isolation structural | COMPLETE                                  | Independently confirmed: grep finds exactly one live `stopPropagation()` call in the three files (`closeSplit`, correctly out of scope), all four target methods lost their `MouseEvent` params, and all three specs contain a genuine root-listener test proving the click still bubbles (not swallowed). |
| D1 AC6 — visual appearance unchanged                     | LIKELY COMPLETE, partially unverifiable   | Code-level evidence (class lists relocated intact, `uppercase` bug independently confirmed real via Tailwind preflight source) is consistent with the claim; the underlying Playwright measurement harness was deleted and cannot be re-run (Failure Mode 4).                                              |
| D1 AC7 — visible focus indicator                         | COMPLETE                                  | `focus-visible:outline-2` present on every touched control; arbitrary Tailwind utilities (`outline-offset-[-2px]`, `outline-[oklch(var(--s))]`) independently confirmed to compile via a live `tailwindcss` CLI run against the actual project config.                                                     |
| Standing gates §2                                        | COMPLETE                                  | All reproduced live — see below.                                                                                                                                                                                                                                                                           |

### Implicit Requirements NOT Addressed:

1. No permanent axe assertion in the repo — acceptable given the transitive-dependency constraint,
   but means AC1's long-term regression protection is entirely the hand-rolled DOM walk.
2. The empty-list ownership defect (pre-existing) has no tracking artifact beyond a paragraph in
   §8 of the report.

## Edge Case Analysis

| Edge Case                                              | Handled                         | How                                                                    | Concern                                                                     |
| ------------------------------------------------------ | ------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Empty staged/unstaged section                          | NO                              | Plain `<div>` inside `role="list"`                                     | Confirmed live axe violation (Failure Mode 1); pre-existing, not introduced |
| Rapid double-click on close button                     | Not explicitly tested           | `closeTab` presumably idempotent via signal-based tab list             | Not exercised by new specs; low risk, out of scope                          |
| Click that lands exactly on the now-dead margin strips | Explicitly NOT handled          | Documented in report §7.2                                              | Minor, deliberate trade-off (Failure Mode 3)                                |
| Two panel instances mounted simultaneously             | YES                             | `stagedListId`/`unstagedListId` derived from a static instance counter | Verified present in source; prevents `duplicate-id`                         |
| Tab close event bubbling to pane click                 | Handled, but with a side effect | Structural sibling isolation                                           | New cross-pane-focus behavior (Failure Mode 2), disclosed                   |

## Integration Risk Assessment

| Integration                                                                      | Failure Probability                     | Impact                                                                                      | Mitigation                                                                                                                         |
| -------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `role="tablist"` ARIA ownership vs. close button                                 | Certain (already landed, user-accepted) | Screen reader gets slightly wrong tree shape for the close button; control remains operable | Pre-decided by user; filed to Batch 9                                                                                              |
| Empty-list ARIA ownership                                                        | Certain, confirmed live                 | Screen reader gets malformed list on the common "nothing staged" case                       | Pre-existing; recommend concrete Batch 9 ticket (Issue 2)                                                                          |
| Tailwind preflight resetting `text-transform` on any future button-wrapped label | Medium (recurring pattern risk)         | Silent caps-loss, as already happened once this batch                                       | No systemic guard beyond the one regression test added; future de-nesting work in other components should watch for this same trap |

## Verdict

**Recommendation**: APPROVE
**Confidence**: HIGH
**Top Risk**: The empty-section `role="list"` violation is confirmed real (not hypothetical) and
should get a concrete follow-up ticket rather than remaining a footnote — otherwise it is easy to
lose track of between now and Batch 9.

## What Robust Implementation Would Include (beyond what's here)

- A permanent (not throwaway) axe-core assertion wired somewhere in the CI-reachable path, even if
  it can't reach the full Electron e2e suite yet — a jsdom-based axe check could be committed as a
  lightweight per-component guard without needing the Electron launch the executor correctly
  identified as too expensive for this batch.
- A one-line fix for the empty-state `role="listitem"` (this review confirms it is trivial and
  visually inert) rather than leaving a confirmed violation as a someday-item.
- A regression test pinning the new tab-close → pane-focus interaction, since it's a genuine (if
  minor) behavior change now baked into the structural fix.
