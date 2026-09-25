# Code Logic Review — `TASK_2026_533` Batch 9

## Summary

| Metric               | Value                                |
| --------------------- | ------------------------------------ |
| Overall score          | 6/10                                  |
| Assessment             | NEEDS_REVISION                        |
| Blocking issues        | 0                                     |
| Serious issues         | 1                                     |
| Moderate issues        | 2                                     |
| Failure modes found    | 3                                     |

Scope: all 6 new components + 6 specs in `libs/frontend/marketplace/src/lib/ui/`
(worktree `task533-b9`), read in full, cross-checked against
`data/provider-row.ts`, `@ptah-extension/ui`'s `CLI_TARGET_BRANDS`,
`BrandMarkComponent`, `ProviderMarkComponent`, `NativePopoverComponent`, and
`chat-ui`'s `installed-mcp-groups.ts` (`mcpTargetLabel`, `targetsOf`
upstream). Re-ran the scoped suite independently:
`NX_DAEMON=false npx jest -c libs/frontend/marketplace/jest.config.ts
libs/frontend/marketplace/src/lib/ui` → 6 suites, 80 tests, all green,
matching `batch-9-report.md`. Style findings (the `scale-[0.625]` workaround,
idle-region legibility) are already covered in `code-style-review-batch-9.md`
and are not repeated here except where they carry a distinct logic
consequence.

## Five logic questions

### 1. How does this fail silently?

It mostly doesn't — the batch is unusually good about surfacing failure
(clipboard rejection announces itself; blank commands render nothing rather
than a broken button). The one silent-adjacent case: `BulkActionBarComponent`
accepts `result: {removed:0, failed:[]}` and renders "Nothing removed"
(`bulk-action-bar.component.ts:34-39`, tested at
`bulk-action-bar.component.spec.ts:173`) with no way for a caller to
distinguish "the action ran and touched nothing" from "the action never ran."
That distinction is the parent's to make (this is a presentational
component), so it is not scored as a defect, only noted as a boundary a
Batch-13 consumer must get right.

### 2. What user action produces unexpected behaviour?

Rapid double-click on the copy button (`copy-command-button.component.ts:119`)
fires a second `navigator.clipboard.writeText` before the first settles;
`state`/`announcement` are overwritten by whichever promise resolves last, so
a user who clicks twice while the clipboard permission prompt is pending could
see the confirmation flicker or land on the wrong state. Minor — no data loss,
self-corrects on the next successful copy, not covered by a test.

### 3. What input data produces a wrong answer?

A `ProviderTarget.target` value that is not one of the seven
`McpInstallTarget` literals `CLI_TARGET_BRANDS` is keyed on. See Failure mode
1 below — this is the review's main finding.

### 4. What happens when a dependency fails?

- Clipboard: covered thoroughly (permission denial, missing API, destroy
  mid-flight all have specs: `copy-command-button.component.spec.ts:122-158`).
- `CLI_TARGET_BRANDS[item.target]`: not covered — see Failure mode 1.
- `NativePopoverComponent`'s own `FloatingUIService.position()` await
  (`native-popover.component.ts:192-198`) has no catch and is invoked from a
  `queueMicrotask` callback whose promise nobody awaits; a rejection there
  becomes an unhandled promise rejection reachable through
  `RemovalLockBadgeComponent`. This is pre-existing behaviour in a file
  outside Batch 9's scope (not one of the six reviewed files), so it is noted
  as context, not scored against this batch.

### 5. What is missing that the requirements never mentioned?

The review brief explicitly asks whether `TargetMarks` "handles... unknown
target," mirroring `StatusPill`'s explicit `unknown` case for
`ProviderStatus`. `StatusPillComponent` does this
(`statusPresentation()`, `status-pill.component.ts:74-85`, covers `unknown`
plus a blank-text fallback). `TargetMarksComponent` has no equivalent —
requirements never named it as a case to skip, and the sibling component in
the same batch demonstrates the codebase's own expected pattern for exactly
this situation.

## Failure modes

### 1. Unmapped `McpInstallTarget` crashes `TargetMarksComponent`

- Trigger: `ProviderRow.targets` (built in
  `libs/frontend/marketplace/src/lib/data/provider-row.ts:448-465`, from
  `InstalledServerGroup.targets: McpInstallTarget[]`, itself RPC data) carries
  a `target` value that exists in the runtime payload but is not one of the
  seven keys of `CLI_TARGET_BRANDS`
  (`libs/frontend/ui/src/lib/native/brand-mark/brand-slugs.ts:57-67`). This is
  not hypothetical: the `McpInstallTarget` union has already grown once
  (`mcp-directory.types.ts:29-34`, the `antigravity` addition in
  TASK_2026_285), and a VS Code extension's webview bundle can lag behind a
  newly shipped CLI/backend by design — the exact condition needed to
  reproduce this.
- Symptom: `target-marks.component.ts:32-37`, `toView()` does
  `CLI_TARGET_BRANDS[item.target]` then immediately reads `brand.kind`.
  For an unmapped key this is `undefined.kind`, a `TypeError` thrown
  synchronously inside the `views` computed signal
  (`target-marks.component.ts:125`), which is read directly by the template.
  Because `views()` also feeds `visible()`, `overflow()`, and the sr-only
  label list, the whole component's change detection pass throws — in
  practice this breaks the enclosing list render for that row (and, depending
  on where in the `@for` of a parent table/list Angular is when it throws,
  can abort the rest of that CD pass), not just the one mark.
- Evidence: `target-marks.component.ts:32-37,125`;
  `brand-slugs.ts:57-67`; `mcp-directory.types.ts:36-43`;
  `provider-row.ts:448-465`. Confirmed no test exercises an out-of-union
  target: `target-marks.component.spec.ts` only uses the six current literals
  (`CLAUDE`, `VSCODE`, `OPENCODE`, `CURSOR`, `CODEX`, `COPILOT`).
- Current handling: none — no `Object.hasOwn` guard, no fallback mark, no
  `try`/`catch`.
- Recommendation: guard `toView()` the same way `provider-row.ts:440-446`
  already guards `ProviderStatus` (`Object.prototype.hasOwnProperty.call` /
  `Object.hasOwn(CLI_TARGET_BRANDS, item.target)`), falling back to a neutral
  glyph (e.g. `ptah-provider-mark` with its `Terminal` fallback, which already
  exists in this file for OpenCode) instead of indexing blindly. This is a
  one-function fix inside the batch's own file.

### 2. `mcpTargetLabel` returns `undefined` for the same unmapped value

- Trigger: same as above.
- Symptom: `installed-mcp-groups.ts:53-55` (`chat-ui`, upstream of this
  batch) does `TARGET_LABELS[target]` with no guard, so `ProviderTarget.label`
  is `undefined` at runtime despite its `string` type. `TargetMarksComponent`
  then renders that `undefined` as the mark's `title` and in the sr-only
  label `<li>` (`target-marks.component.ts:78,109`), showing literal text
  "undefined" to assistive tech and as a tooltip.
- Evidence: `installed-mcp-groups.ts:37-55`. This file is outside Batch 9's
  file list, so it is not scored against this batch, but it means fixing
  Failure mode 1 in `TargetMarksComponent` alone does not fully protect the
  row — the label itself is already corrupted one layer up. Worth flagging to
  whoever owns `installed-mcp-groups.ts`.
- Current handling: none.
- Recommendation: out of this batch's scope; note for a follow-up task.

### 3. Overlapping clipboard writes race the button's visible state

- Trigger: two clicks on the same `CopyCommandButtonComponent` before the
  first `navigator.clipboard.writeText` promise settles (e.g. a slow
  permission-prompt flow).
- Symptom: `state`/`announcement` are set by whichever `copy()` invocation's
  `await` resolves last, not necessarily the second click's own outcome; the
  visible "Copy"/"Copied" label and the live-region text can end up out of
  step with the user's most recent action for one feedback cycle.
- Evidence: `copy-command-button.component.ts:119-135` — no re-entrancy guard
  (no `if (this.state() === 'copied') return;` or a `pending` state) around
  `copy()`.
- Current handling: none; self-corrects after `COPIED_FEEDBACK_MS` since the
  timer is always rescheduled via `scheduleReset()`/`cancelFeedbackTimer()`.
- Recommendation: low priority — guard `copy()` with an early return while a
  write is in flight, or disable the button during the await. Not scored as
  Serious because the window is narrow, nothing is lost, and every current
  caller (`RemovalLockBadgeComponent`) only shows one button per popover.

## Blocking issues

None.

## Serious issues

### `TargetMarksComponent` crashes on a `McpInstallTarget` outside `CLI_TARGET_BRANDS`

- File: `libs/frontend/marketplace/src/lib/ui/target-marks.component.ts:32-37`
- Scenario: a server row's `targets` includes a CLI target id the frontend
  bundle does not yet know (backend/CLI shipped a new install target before
  the extension's webview bundle updated — demonstrated possible by the
  `antigravity` precedent cited in `mcp-directory.types.ts:29-34`).
- Impact: the row (and potentially the surrounding list's change-detection
  pass) throws and fails to render, for every user on a stale bundle, with no
  fallback UI — a worse outcome than the `unknown`-status handling this same
  batch's `StatusPillComponent` demonstrates is the established pattern for
  exactly this class of drift.
- Fix: see Failure mode 1 — bound the lookup with `Object.hasOwn` and fall
  back to a neutral mark, mirroring `provider-row.ts:440-446`'s existing
  `unknown` pattern for status.

## Moderate and minor issues

- Moderate — `installed-mcp-groups.ts:53-55` (`mcpTargetLabel`, outside this
  batch's files) has the same unmapped-key gap feeding `ProviderTarget.label`;
  fixing Failure mode 1 alone still leaves a `title="undefined"` /
  `<li>undefined</li>` in the sr-only list until this upstream file is also
  guarded.
- Moderate — `copy-command-button.component.ts:119-135`: no re-entrancy guard
  against overlapping `copy()` invocations (Failure mode 3).
- Minor — `bulk-action-bar.component.ts:34-39`: `{removed:0, failed:[]}`
  renders "Nothing removed" indistinguishably from "no action ran yet" other
  than `result !== null`; a parent must not conflate the two states in its own
  wiring.

## Data flow

1. RPC `InstalledServerGroup.targets: McpInstallTarget[]` → `targetsOf()`
   (`provider-row.ts:448-465`) — OK for known targets; no guard for an
   unrecognised value (inherited gap, not this batch).
2. `ProviderRow.targets` → `TargetMarksComponent.targets` input — OK, typed
   pass-through.
3. `toView()` (`target-marks.component.ts:32-37`) resolves each target
   through `CLI_TARGET_BRANDS` — **gap**: throws on an unmapped key (Failure
   mode 1).
4. `views()`/`visible()`/`overflow()` computed signals — OK once step 3
   returns cleanly; correct slicing math for `Infinity`, `0`, negative and
   fractional `maxVisible`.
5. Template renders `ptah-brand-mark` or `ptah-provider-mark` per `kind`, plus
   the always-present sr-only `<ul>` — OK, exhaustive over the two `kind`
   values once a `TargetMarkView` exists.
6. `StatusPillComponent`: `ProviderRow.status`/`statusText` →
   `statusPresentation()` (`status-pill.component.ts:74-85`) — OK, the
   `unknown` branch is the exact defence `TargetMarksComponent` lacks.
7. `CopyCommandButtonComponent`: click → `navigator.clipboard.writeText` →
   success (`state='copied'`, timer scheduled) or failure
   (`selectCommandText()`, message keyed off `error.name`) — OK, `destroyed`
   flag correctly guards both branches against a component torn down mid-await
   (spec-verified).
8. `RemovalLockBadgeComponent`: `toggle()` → `NativePopoverComponent.isOpen`
   → popover's own Escape/backdrop handling → `closed` → `close()` — OK, no
   duplicate Escape handler added, verified by both this review and the style
   review.
9. `BulkActionBarComponent`: `selectedCount`/`busy`/`result` inputs → derived
   `idle`/`selectionLabel`/`summary` — OK, pure and total for every input
   combination tried, including the `removed:0,failed:0` edge case.
10. `DockedInspectorComponent`: `heading`/`closeLabel` inputs, `ng-content` —
    OK, never calls `.focus()`, verified by source-text and three behavioural
    specs (appear, content-change, user-placed focus).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| StatusPill covers every `ProviderStatus` incl. `failed`, `needs-input`, `unknown` with raw text, never colour alone | COMPLETE | Icon + text pair for all 9 known statuses plus `unknown`; blank-text fallback to "Unknown" tested. |
| TargetMarks handles both union kinds and the `vscode` monogram | COMPLETE | `brand`/`provider-mark` both exercised; VS Code monogram tested. |
| TargetMarks handles an unknown target | MISSING | No guard around `CLI_TARGET_BRANDS[item.target]`; crashes instead of degrading (Failure mode 1). |
| CopyCommandButton: clipboard success/rejection/select fallback, live-region reset, timer cleanup on destroy | COMPLETE | All four covered with dedicated specs, including the destroy-before-rejection race. |
| RemovalLockBadge: popover open/close, no copy button without a command | COMPLETE | Toggle, Escape (via popover), backdrop, and all four "blank-ish" `fixCommand` variants (`undefined`/`null`/`''`/`'   '`) tested. |
| BulkActionBar: count and result summary correctness | COMPLETE | `bulkSelectionLabel`/`bulkResultSummary` pure functions unit-tested across all count/result combinations, including the all-zero case. |
| DockedInspector: no focus steal on content change, close output | COMPLETE | Three focus scenarios plus a source-text `.focus()` ban. |

Implicit requirements not addressed: graceful degradation for a
`McpInstallTarget` value the frontend bundle does not yet recognise (the
review brief's own framing — "unknown target" — implies this was expected
alongside `StatusPill`'s `unknown` handling).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| `status = 'unknown'`, blank/absent `statusText` | YES | Falls back to "Unknown" | none |
| `target` outside `CLI_TARGET_BRANDS` | NO | — | Failure mode 1, throws |
| `maxVisible = Infinity` / `0` / negative / fractional | YES | `Math.max(1, Math.floor(...))`, `NaN` check | none |
| Clipboard API absent | YES | `clipboardFailureMessage` treats any non-`NotAllowedError` shape as "unavailable" | none |
| Component destroyed mid-clipboard-await | YES | `destroyed` flag checked in both branches, timer cleared in `onDestroy` | none |
| Double-click before clipboard settles | NO | Last-resolved promise wins | Minor UI flicker only (Failure mode 3) |
| `fixCommand` is `undefined`/`null`/`''`/whitespace | YES | `command()` computed normalises all four to `null` | none |
| `result = {removed:0, failed:[]}` | YES | "Nothing removed" | Ambiguous vs. "no action yet" from the parent's perspective; documented in tests, not a component bug |
| Docked inspector heading/content change while user has focus elsewhere | YES | No `.focus()` call anywhere in the file | none |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: `TargetMarksComponent` throws for any `ProviderTarget.target` not
  already a key of `CLI_TARGET_BRANDS`, which this codebase's own history
  (the `antigravity` union addition) shows is a real, recurring event for a
  VS Code extension whose webview bundle can trail its backend/CLI — and the
  review's own focus named this exact case ("unknown target") as an expected
  capability that `StatusPill`, in the same batch, already demonstrates the
  pattern for.
- What a robust implementation would add: an `Object.hasOwn(CLI_TARGET_BRANDS,
  item.target)` guard in `toView()` with a neutral fallback mark (mirroring
  `provider-row.ts:440-446`'s `unknown`-status pattern), plus the matching
  guard in `mcpTargetLabel` (`installed-mcp-groups.ts:53-55`, outside this
  batch) so the label itself never becomes `undefined`; a re-entrancy guard on
  `CopyCommandButtonComponent.copy()` for completeness, though this is low
  priority.

## Deviation judgments (requested by the review brief)

- `selectTarget: HTMLElement` required input on `CopyCommandButtonComponent`
  (deviation 1): reasonable. It trades the precedent's per-call parameter
  (`oauth-surface.component.ts`'s `copyRedirectUri(field)`) for a persistent
  input, which fits this component's only current caller
  (`RemovalLockBadgeComponent`, which always has a `<code>` sibling) and keeps
  the component free of its own copy of the command text. No logic defect.
- `ptah-provider-mark` scaled `0.625` inside a `24px` tile (deviation 2): a
  visual/style tradeoff, not a logic defect — already scored in
  `code-style-review-batch-9.md` (Serious there, for maintainability, not
  correctness). No behavioural failure found: the scale transform is centred
  within the overflow-hidden tile, so nothing is clipped or misaligned at
  today's `ProviderMarkComponent` box size.
- No Escape handling in `DockedInspectorComponent` (deviation 3): acceptable.
  `NativePopoverComponent` (used by `RemovalLockBadgeComponent`, a sibling in
  this same batch) already closes on Escape via its own host `keydown`
  listener (`native-popover.component.ts:224-234`), so the codebase's
  established pattern is that Escape-to-close is either owned by the widget
  that traps focus (popover) or, for a non-modal docked pane, by the page per
  the Batch 12 contract ("the status bar lists ↑↓ / Enter / Esc hints — pages
  from Batch 13 on must implement those keys, or the batch that lands a page
  without them trims the hints", `batches.md:62`; C7's "Close ⇔ ... Esc in
  docked" also assigns this to the page, not the primitive,
  `implementation-plan.md:398`). Adding a second Escape handler inside
  `DockedInspectorComponent` would risk exactly the double-close the executor
  flagged. This is correctly out of Batch 9's scope; it is a forward
  obligation on Batch 13, not a gap in this batch.

## Round 2 (revise round 1)

Re-read both changed files in full in the same worktree
(`target-marks.component.ts`, `copy-command-button.component.ts`) and their
specs. Independently re-ran the scoped suite:
`NX_DAEMON=false npx jest -c libs/frontend/marketplace/jest.config.ts
libs/frontend/marketplace/src/lib/ui` → 6 suites, **89** tests (up from 80),
all green — matches the executor's claimed 33 suites / 808 marketplace tests.
Also ran `ptah_get_diagnostics` scoped to both changed files: 0 errors in
scope; the 6 errors reported are the same pre-existing ones named in
`batch-9-report.md` (`mock-rpc-service.ts` x4, `connected-surface.component.spec.ts`
x1, `harness-health.store.spec.ts` x1), untouched by this round.

### Serious finding — verified fixed

`target-marks.component.ts:45-62` now guards the lookup with
`isTabledTarget()` (`Object.hasOwn(CLI_TARGET_BRANDS, target)`, own-keys only
— the same style used for the pre-existing `constructor`-safety pattern
elsewhere in this codebase), and `toView()` returns a `'monogram'` view built
from the raw id instead of indexing blindly. The template's `@switch` gained
a `@default` case (`:126-128`) rendering `<ptah-monogram-tile [label]="mark.id"
size="sm">`, so an unrecognised target degrades to a monogram instead of
throwing. `label = item.label?.trim() || target` (`:54`) correctly falls back
to the raw id for `undefined`/`null`/`''`/whitespace-only labels (`||`, not
`??`, is required here since `''` must also fall through — correct choice).

Tests added at `target-marks.component.spec.ts:147-184` cover: an unmapped id
(`zed`) rendering a monogram without throwing, the exact "Z" grapheme, that
neither `ptah-brand-mark` nor `ptah-provider-mark` render for it, and that the
sr-only list still names it; the literal string `'constructor'` as a target
id (proving `Object.hasOwn` beats a bare index/`in` check); and all four
blank-label shapes for both an unmapped id and a *known* id (`claude` with no
label) — the fallback-to-raw-id path is exercised on both branches of
`isTabledTarget`, not just the new one. This closes Failure mode 1 from Round
1 completely, including the label half of it (though `mcpTargetLabel` in
`installed-mcp-groups.ts`, upstream and outside this batch, is unchanged —
harmless now, since `TargetMarksComponent` itself no longer trusts an
upstream `undefined` label).

**Type-contract check (the coordinator's specific concern):** `TargetMarkItem`
changed from `Pick<ProviderTarget, 'target' | 'label'>` (so `target:
McpInstallTarget`, `label: string`, both required) to a standalone `{ target:
string; label?: string | null }`. This is a **widening of what the component
accepts**, not a narrowing of what a caller must supply: `ProviderTarget`'s
`target: McpInstallTarget` is assignable to `string`, and its required
`label: string` is assignable to the now-optional-nullable `label?: string |
null` (supplying more than required is always valid). `data/provider-row.ts`'s
`ProviderTarget` interface itself is untouched — `McpInstallTarget` is not
weakened anywhere else, and no other file reads `TargetMarkItem['target']`
expecting the narrow union (grepped for `TargetMarkItem` — only this file and
its spec reference it; Batch 10, per `batches.md`, has not landed yet). No
page loses type safety; the only thing that changed is that this one
presentational leaf can no longer statically assume its input is exhaustive,
which is exactly the point of the fix. No defect introduced by the widening.

### Moderate finding — verified fixed

`copy-command-button.component.ts:126-135`: `copy()` now checks a private
`pending` flag before doing anything (`if (this.pending || command.trim()...)
return;`), sets it before the `await`, and clears it in a `finally` around the
extracted `writeOrSelect()` — correct placement, since `finally` runs whether
`writeOrSelect` resolves or the catch branch inside it handles a rejection
(note `writeOrSelect` itself swallows the clipboard rejection into the
`'selected'` state, so `copy()`'s own `try` never sees a rejection to not
catch — the `finally` still fires on the normal return). `destroyed` is
checked inside `writeOrSelect`, independently of `pending`, so the
destroy-mid-flight guarantee from Round 1 is intact.

Tests at `copy-command-button.component.spec.ts:140-166`: a second click
while the first `writeText` promise is unresolved is proven to *not* call
`writeText` again (`toHaveBeenCalledTimes(1)`), and resolving the first call
still lands on `'Copied'` — this pins that the second click is dropped, not
queued or coalesced into a different outcome. A follow-up test proves a click
*after* the previous copy settles is accepted normally (second `writeText`
call, selection fallback path). This is a correct, complete fix; no new
re-entrancy or lost-click paths found (a rejected first write also flips
`pending` back to `false` via the same `finally`, so failure does not
permanently lock the button — not explicitly asserted by a test, but follows
directly from the `finally` placement and is low enough risk not to require
one).

### `h-6 w-6` / OpenCode scale comments

Both are documentation-only changes (`:114`, `:118`), matching what
`code-style-review-batch-9.md` already scored as a Serious *style* issue
(maintainability, not correctness) and explicitly said was acceptable to ship
undocumented-workaround — now it is documented. No logic content changed; not
re-scored here.

### Round 2 summary

| Metric | Value |
| --- | --- |
| Overall score | 9/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Open from Round 1 | Failure mode 3 was already Moderate-and-fixed; the two Round-1-noted-but-out-of-scope items (`installed-mcp-groups.ts` upstream label gap; `NativePopoverComponent`'s unawaited `position()` promise) remain, unchanged, outside this batch's files — carried forward as follow-ups, not blockers for Batch 9. |

- Recommendation: APPROVE
- Confidence: HIGH
- Residual risk: none within the six reviewed files. The one thing worth a
  future task (not this batch): `installed-mcp-groups.ts:53-55`
  (`mcpTargetLabel`) still returns `undefined` for an unmapped target, so any
  *other* future consumer of that function (outside `TargetMarksComponent`,
  which no longer trusts it) inherits the same gap Round 1 found here.
