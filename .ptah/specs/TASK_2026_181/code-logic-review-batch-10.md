# Code Logic Review — TASK_2026_181, Batch 10 (Phase 6: command palette + board keyboard navigation)

## Review Summary

| Metric                         | Value        |
| ------------------------------ | ------------ |
| Overall Score                  | 8/10         |
| Assessment                     | **APPROVED** |
| Critical Issues                | 0            |
| Serious Issues                 | 0            |
| Moderate Issues (non-blocking) | 3            |
| Minor / Informational Notes    | 2            |

**Scope reviewed** (uncommitted working tree; Batches 1–9 already committed, `a2d36a24c` = Batch 9):

- `libs/frontend/tasks-ui/src/lib/components/palette/` (new: `palette-match.ts`+spec, `palette-entries.ts`+spec, `task-command-palette.component.ts`+spec)
- `libs/frontend/tasks-ui/src/lib/components/keyboard-target.ts` (new)
- `libs/frontend/tasks-ui/src/lib/no-editor-dependency.spec.ts` (new, R11)
- `libs/frontend/tasks-ui/src/lib/components/board/task-board.component.ts` (modified) + `.spec.ts` (new)
- `libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts` (modified) + `.spec.ts` (modified, +133 lines)
- `libs/frontend/tasks-ui/src/lib/components/board/task-column.component.ts` (modified) + `.spec.ts` (modified, +55 lines)
- `libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts` (modified) + `.spec.ts` (modified, +338 lines)
- `libs/frontend/tasks-ui/src/index.ts` (modified, +18 lines — new palette exports)

Explicitly ignored per instructions: `libs/web/members/`, `apps/ptah-landing-page-e2e/` (unrelated, concurrently-growing work).

**Gate re-run, uncached, by this reviewer:**

```
npx nx run-many -t typecheck,test,lint -p tasks-ui --skip-nx-cache
```

Result: all green. `lint`: 0 problems. `typecheck`: clean (`ngc --noEmit`). `test`: **396/396, 16/16 suites**, 16.8s. This matches the claimed end-state total exactly. I could not independently re-verify the claimed **294 → 396** starting point or the "six consecutive clean gate runs" history (would require checking out prior commits, which I avoided — the working tree showed signs of concurrent live editing during this review, see note at the end). The **end state is directly confirmed**; the historical delta is plausible but unverified.

I also ran `npx nx run-many -t typecheck,lint -p tasks-ui` a second time independently — clean.

---

## Mutation verification (the four numbered items)

### 1. The keyboard double-fire fix — CONFIRMED, exactly as claimed

Deleted both `if (event.target !== event.currentTarget) return;` guards in `task-card.component.ts:onCardEnter`/`onCardSpace`, ran `nx test tasks-ui --skip-nx-cache`, reverted immediately after recording the result.

Result: **exactly 5 tests failed, 391/396 passed** — all five are the "does NOT open/toggle" tests (`does NOT open the card when Enter lands on the child rollup`, the 3-case `it.each` for Space on the status-menu trigger / Start / child rollup, and `does NOT open the card when Enter lands on a navigable parent crumb`). The two positive tests (`opens the card when Enter lands on the card itself`, `toggles the card when Space lands on the card itself`) stayed green, because they dispatch on `[role="button"]` itself where `target === currentTarget`. This is precisely the claimed discrimination — reproduced, not merely trusted.

Every one of these tests dispatches a real `KeyboardEvent('keydown', { bubbles: true })` on a real queried element (`task-card.component.spec.ts:268-276`, the shared `keydown()` helper) — none falls back to `.click()`. Confirmed by reading, not just by the mutation's shape.

**The disclosed jsdom gap is real, and I assessed the risk as low.** `does NOT open the card when Enter lands on the child rollup` (`task-card.component.spec.ts:342-353`) destructures `narrowed` (subscribed to `filterChildren`) from `withRollup()` but never asserts on it — it cannot, because jsdom does not synthesize an activation `click` from a dispatched `keydown`, so the rollup's own handler never fires in this harness regardless of the guard. Could the guard suppress the descendant's own action in a **real** browser? I read the guarded path closely: on the `target !== currentTarget` branch, `onCardEnter`/`onCardSpace` `return` immediately, calling neither `preventDefault()` nor `stopPropagation()`. Nothing in this component's handler chain interferes with the browser's native Enter/Space→click synthesis for the descendant `<button>`s. So the guard should not suppress the descendant's own action in production — but this is inferred from reading, not proven by a test, and the gap is honestly disclosed in the spec's own header comment rather than hidden. Non-blocking; recommend the R10 manual gate (VS Code / Electron) explicitly include "press Enter on the child rollup and confirm it still narrows the board" as one of its checked behaviors, since no automated test in this repo can currently prove it.

### 2. The tab-stop count — CONFIRMED, and it measures rather than restates

`task-board.component.spec.ts:145-180` (`confines every tab stop on the board to the ONE focused card`) queries the real rendered DOM with `querySelectorAll('a[href], button, input, select, textarea, [tabindex]')` for the raw count and filters `tabindex !== '-1'` for the actual stops — it does not hardcode or restate a number from the docblock. I let the suite run this test as part of the full pass: **33 focusable nodes on a 3-card board (11 per card: root + status-menu trigger + the `<ul>` + 6 status-option buttons + isolate checkbox + Start), 11 tab stops after the fix, all confined to the one focused card.** Arithmetic checks out: 3 × 11 = 33, and 181 × 11 = 1,991, matching the batch note's extrapolation.

The "six focusable descendants" language in `task-card.component.ts`'s `focused` input docblock (lines 367-374: status-menu trigger, its menu, the parent crumb, the child rollup, the isolate toggle, Start) is a **grouping by control**, not a raw DOM-node count — the "its menu" group alone is 7 DOM nodes (the `<ul>` plus 6 `<button>` options). This is consistent with the batches.md framing and is not a discrepancy once read as categories rather than nodes; the test's raw 11/33 count is what is load-bearing and it is correct.

`task-column.component.spec.ts`'s `focus forwarding` describe block (new, 55 lines) independently confirms the board → column → card forwarding transferred from Task 7.3: exactly one `[data-task-id]` root carries `tabindex="0"` when a `focusedTaskId` is set, and none does when it is `null` (the column does not invent a default — correctly left to the board).

### 3. The R11 ratchet — CONFIRMED, but the docblock overclaims for half of what it checks

Reproduced both injections (via a scratch file, deleted immediately after each run — no stray files remain; `git status` confirmed clean before and after):

- **Package-specifier form** (`import '@ptah-extension/editor';`): `no-editor-dependency.spec.ts`'s "never imports @ptah-extension/editor" test correctly fails (1 offender), and separately, `nx lint tasks-ui --skip-nx-cache` on the same injected file reported **"✔ All files pass linting" — zero `@nx/enforce-module-boundaries` errors**, exactly as the docblock and the batch note claim. This is the half of the ratchet that is genuinely load-bearing: the boundary lint cannot see it because `scope:webview→scope:webview` and `type:feature→type:feature` are both permitted and `platform:angular` has no `depConstraints` entry.
- **Relative reach-back form** (`from '../../../editor/src/lib/quick-open/quick-open.component'`, and separately a dynamic `import('../../../editor/...')`): `no-editor-dependency.spec.ts`'s "never reaches the editor library by a relative path either" test correctly fails for both. **But `nx lint tasks-ui` on the same file reported a real error: `Projects cannot be imported by a relative or absolute path, and must begin with a npm scope  @nx/enforce-module-boundaries`.** This fired for both the static and the dynamic-import form.

This is a genuine, verified defect in the docblock's own claim, of exactly the kind this batch's guiding heuristic exists to catch: the opening paragraph states unconditionally that "`@nx/enforce-module-boundaries` **provably cannot** catch this edge" and "An import of the editor library added to this library therefore lints clean" — but that is only true for the package-specifier route. Nx's boundary lint carries a separate, tag-independent rule that forbids **any** relative cross-project import in this workspace, and it already catches the exact relative-reach-back pattern `FORBIDDEN_REACH_BACK` exists to close. The comment's "It is not redundant" framing is therefore only half right: the specifier check is not redundant with lint; the reach-back check largely is. Functionally this changes nothing (the ratchet still fails correctly on both injections, and defense-in-depth against a future lint-config change is a legitimate reason to keep `FORBIDDEN_REACH_BACK`), but the stated _justification_ overclaims. **Non-blocking — recommend narrowing the docblock** to say the reach-back check closes a bypass of _this ratchet's own specifier check_ (which is true and is what the following paragraph actually argues) rather than implying lint is blind to the relative-path route too.

All temporary probe files were removed and `git status --porcelain -uall -- libs/frontend/tasks-ui/` was re-confirmed to match the pre-review state before moving on.

### 4. `KeyboardNavigationService` re-configuration — the clamp claim is CONFIRMED; the workaround is defensible but under-tested; and the "other consumers" risk is real

Read `libs/frontend/ui/src/lib/native/shared/keyboard-navigation.service.ts:100-111` directly: `configure()` only resets to `-1`→`0` when there were previously zero items, and otherwise only clamps (`itemCount - 1`) when the _current_ index has fallen out of bounds — it never unconditionally resets to `0` on a narrowed-but-still-populated list. This is pre-existing, intentional, and already pinned by the shared lib's own spec (`keyboard-navigation.service.spec.ts:40-46`, "should clamp active index when new itemCount is smaller"). The claim is accurate: **clamp, not reset.**

`task-command-palette.component.ts:onQueryChange` (lines 275-288) works around this by calling `configure()` + `setActiveIndex(0)` synchronously, ahead of the constructor's `effect()`. I mutation-tested this: removed the eager call, leaving only `this.query.set(value)`, and re-ran `resets the active row when the query narrows the list` (`task-command-palette.component.spec.ts:220-233`) in isolation.

**Result: the test stayed green even with the workaround removed.** The reason is specific to this fixture: the test narrows a 4-entry catalogue to a query ("reindex") that matches exactly **one** entry, so `KeyboardNavigationService`'s own clamp (`current index >= itemCount(1)` → clamp to `0`) produces the identical outcome whether or not `onQueryChange` resets eagerly — and Angular's `effect()` evidently _does_ flush synchronously within this TestBed's `fixture.detectChanges()` calls (no `await` was needed between `type()` and `press(fixture, 'Enter')` for the clamp to have already applied). This is exactly the "test that cannot fail" pattern the batch's own review heuristic warns about: the docblock ("The failure this pins: type, arrow down, retype — an index left pointing at the old list runs a command the user never saw highlighted") describes a scenario the fixture does not actually construct (a narrowed list of **more than one** entry, where a stale-but-in-bounds index would point at a different row than the one highlighted). The workaround's synchronous-vs-effect-timing rationale is still plausible for real browser usage (a fast type-then-Enter could race the effect scheduler outside this zone-flushed test harness), so I am not asking for the workaround to be removed — only flagging that the test asserting it does not, in fact, discriminate. **Non-blocking; recommend widening the fixture** (e.g., narrow to 2+ results with the stale index still in range) so the test can actually fail if the eager reset regresses.

**The clamp is a real, pre-existing latent behavior other consumers of the shared service already share**, not something Batch 10 introduced. `libs/frontend/ui/src/lib/native/autocomplete/native-autocomplete.component.ts:236-240` and `libs/frontend/chat/src/lib/components/file-suggestions/unified-suggestions-dropdown.component.ts:138-142` both configure `KeyboardNavigationService` **only** via the constructor's `effect()` on their suggestion-count signal, with no equivalent eager reset — so both are exposed to the same "stale index lands on the wrong row of a narrowed-but-still-populated list" defect the palette worked around. This is out of scope for Batch 10 to fix and is not a regression it caused, but it is worth a follow-up ticket against `@ptah-extension/ui`, since the diagnosis the palette's own comment makes ("a narrowed list whose active index is still pointing at the old row would run the wrong command") generalizes to at least two other keyboard-driven surfaces in this codebase.

---

## Adjudicated decisions

1. **Discriminated union + exhaustive `never` switch (BR-8) — SOUND.** `TaskPaletteAction` has 9 variants; `onPaletteRun`'s `switch` in `tasks-view.component.ts:751-786` has exactly 9 `case` arms plus `default: { const unhandled: never = action; ... }` — genuinely exhaustive, confirmed by `typecheck` passing and by reading the union against the switch arm-by-arm. `palette-entries.ts` imports nothing from `../../services/`; grepped the whole `palette/` folder for `TaskStartService` / `task-start.service` — zero hits. Two tests independently assert the negative under a maximal context (`palette-entries.spec.ts:54-80`, `tasks-view.component.spec.ts:945-965`).
2. **Palette DOM shape (backdrop-as-sibling-button, `role="option"` buttons, single-focusable trap) — SOUND.** The Tab-trap claim is measured, not asserted: `task-command-palette.component.spec.ts:257-271` queries the real focusable set and asserts it equals exactly `[input]`. A trap with one focusable element is a degenerate but genuine case — `Tab`/`Shift+Tab` are both unconditionally `preventDefault()`-ed (`event.key === 'Tab'`, regardless of `shiftKey`), so focus provably cannot leave the input either direction. The backdrop being a DOM **sibling** of the `role="dialog"` element (not a parent) is the standard, correct pattern for this kind of modal and does not weaken `aria-modal`.
3. **FR-C7.2/FR-C7.3 collapsed to the single act that exists today — RIGHT CALL, and it does not leave Batch 12 harder.** `onTaskToggle`/`onBoardEscape` are named for what Batch 12 will re-point, and neither `TaskBoardComponent` nor `TaskCardComponent` needs to change when the multi-select model lands — the board already emits an opaque `taskToggle`/`escapePressed` event and lets the host (`TasksViewComponent`) decide the semantics, which is exactly the seam Batch 12 needs.
4. **No selector interpolation — CONFIRMED, no exceptions found.** `task-board.component.ts:focusCardElement` (lines 262-271) reads `card.getAttribute('data-task-id')` in a loop rather than building `[data-task-id="${id}"]`. `palette-match.ts` builds no `RegExp` anywhere — every comparison is `startsWith`/`indexOf`/a character walk (confirmed by reading `scorePaletteMatch` and `scoreSubsequence` in full), and this is independently pinned by `palette-match.spec.ts:143-153` ("treats the query as literal text, never as a pattern").
5. **`keyboard-target.ts`'s `closest`-based `isTextEntryTarget` — CONFIRMED, and both stated callers use it.** `task-board.component.ts` and `tasks-view.component.ts` both import and call `isTextEntryTarget(event.target)` as their first guard. The `closest` (vs. a tag-name comparison) reasoning is correct: a `contenteditable` region's `keydown.target` is typically a descendant text node's parent, which `closest` correctly walks up to but a `tagName` check would miss.
6. **Score semantics (`0` for blank query, `null` for non-match) — CONFIRMED, no caller mistake.** `rankPaletteMatches` (the only caller of `scorePaletteMatch`) correctly tests `if (score !== null)` (`palette-match.ts:163`), never a bare truthiness check. Grepped for any other caller — none exists.

---

## Standing rules — verified

- **R10, `host:`-bound keydown, never `window`/`document`.** Reproduced the claimed proof by mutation: added a `document.addEventListener('keydown', ...)` alongside the existing `host:` binding in `tasks-view.component.ts` (temporary; reverted immediately), and `is bound to the host element, not to the document (R10)` (`tasks-view.component.spec.ts:862-877`) correctly turned red — the palette opened for a keydown dispatched on a `div` appended directly to `document.body`, outside the component tree. This is a real, working proof, not a vacuous one: Angular's `TestBed`/`BrowserTestingModule` does attach the fixture's root element into `document.body` (via `DOMTestComponentRenderer`), so the "outside" `div` and the component genuinely share one DOM tree, and a `document`-level listener really would have caught the dispatched event. Reverted; suite re-confirmed green (396/396) afterward.
- **BR-8 / R12 (no run action, no `TaskStartService` import under `palette/`)** — confirmed by grep, zero hits.
- **FR-C6.9 (no new runtime dependency)** — confirmed; no changes to any `package.json` or lockfile in the diff.
- **FR-C6.8 (palette local to `tasks-ui`)** — confirmed; `task-command-palette.component.ts` imports only `@ptah-extension/ui`'s `KeyboardNavigationService` (an allowed `type:ui` edge) plus `lucide-angular`/`@angular/*`.
- **Every key ignored inside `<input>`/`<textarea>`/`[contenteditable]`** — confirmed via `keyboard-target.ts` usage in both host handlers, and directly tested (`tasks-view.component.spec.ts:830-844`, `task-board.component.spec.ts:298-311`).
- **No new `text-base-content/NN`** — grepped the full diff (`git diff ... | grep '^\+'`) for `text-base-content/[0-9]+` across every changed/new file in scope: zero new occurrences. Pre-existing occurrences in `task-card.component.ts` (from earlier batches) are untouched by this diff.
- **OnPush / signals + `inject()` / `track` on every `@for`** — confirmed on all five components in scope (`TaskBoardComponent`, `TaskColumnComponent`, `TaskCardComponent`, `TaskCommandPaletteComponent`, `TasksViewComponent`); every `@for` in the changed templates carries a `track` expression.
- **BR-7 (no per-task filename literal / forbidden path strings)** — grepped every file in scope for `task-tracking/`, `.ptah/tasks/`, `specs/TASK_2025_`, `TASK_2025_`: zero hits.
- **TS 5.9 strict / no `any` / no stubs or TODOs** — grepped for `TODO`, `FIXME`, `: any`, `as any`, "not implemented" across every file in scope: zero real hits (one false-positive grep match was prose containing the word "editor", not a marker).
- **The Batch 5 private-member test-access exception was not re-cited as precedent.** `task-card.component.spec.ts` does contain one `as unknown as { onStatusPick: ... }` cast, but `git diff` on that file confirms it is **pre-existing** (not part of this batch's `+133` lines) and is untouched by Batch 10. No new file or new test in this batch's diff reaches into a private/protected member.

---

## Findings

### Moderate (non-blocking)

1. **R11 docblock overclaims for the relative-reach-back half of the ratchet.** `no-editor-dependency.spec.ts:7-25` states unconditionally that the Nx boundary lint "provably cannot catch this edge" and that an editor import "therefore lints clean." Verified by injection that this is true **only** for the `@ptah-extension/editor` package-specifier form; a relative reach-back (`'../../../editor/...'`, static or dynamic `import()`) is independently caught by `nx lint tasks-ui` today, via `@nx/enforce-module-boundaries`'s separate, tag-independent "no relative cross-project imports" rule. `FORBIDDEN_REACH_BACK` is not wasted (it is genuine defense-in-depth and closes a bypass of the ratchet's _own_ specifier regex, which is what the second half of the docblock actually argues), but the opening paragraph's blanket claim is factually wrong for that half. **File**: `libs/frontend/tasks-ui/src/lib/no-editor-dependency.spec.ts:9-25`. **Fix**: qualify the claim to the package-specifier route, or note that the reach-back check is currently redundant with a separate Nx rule and is kept for resilience against a future lint-config change.
2. **The "resets the active row" palette test cannot fail for the scenario it claims to pin.** Verified by mutation: removing the eager `configure()`+`setActiveIndex(0)` in `onQueryChange` left `task-command-palette.component.spec.ts:220-233` green, because the fixture narrows to exactly one matching entry, and `KeyboardNavigationService`'s own clamp-on-shrink produces the same result independent of the workaround. **File**: `libs/frontend/tasks-ui/src/lib/components/palette/task-command-palette.component.spec.ts:220-233`. **Fix**: widen the fixture so the narrowed list still has ≥2 entries with the stale index in range, so the test can distinguish "reset" from "clamp."
3. **The shared `KeyboardNavigationService.configure()` clamp is a latent risk beyond this batch.** Confirmed two other consumers (`libs/frontend/ui/src/lib/native/autocomplete/native-autocomplete.component.ts:236-240`, `libs/frontend/chat/src/lib/components/file-suggestions/unified-suggestions-dropdown.component.ts:138-142`) rely solely on the constructor `effect()` with no equivalent eager reset, so they can hit the same "stale index into a narrowed, differently-ordered list" defect the palette worked around. Out of scope for Batch 10; recommend a follow-up ticket against `@ptah-extension/ui`.

### Minor / informational

4. **Keyboard double-fire guard test coverage is narrower than the docblock's "every focusable node" claim.** The Space `it.each` (`task-card.component.spec.ts:355-369`) covers only the status-menu trigger, Start, and the child rollup — not the isolate checkbox, despite the card's own docblock (lines 367-374) naming the isolate toggle as one of the six roved descendants. Enter is only tested as a negative for the child rollup and the parent crumb, not for the status-menu trigger or Start. The guard mechanism (`event.target !== event.currentTarget`) is generic enough that this is very unlikely to hide a real defect, but the parametrization is incomplete relative to what is claimed. Non-blocking.
5. **The rollup's own action is not asserted after a keyboard Enter**, disclosed honestly in the spec's own comment as a jsdom limitation (jsdom does not synthesize `click` from a synthetic `keydown`). Assessed the guard code path directly: it calls neither `preventDefault()` nor `stopPropagation()` on the non-matching-target branch, so it should not suppress the descendant's native activation in a real browser — but this is inferred, not test-proven anywhere in this repo. Recommend folding this into the R10 manual gate's checklist explicitly (open a card with children, tab to the rollup, press Enter, confirm the board narrows).

---

## A note on the working tree during this review

Partway through verifying the R11 mutation, a direct `grep`/`Read` of `palette-match.ts` briefly showed an injected relative import to the editor library (lines 173-174) that was not present moments before or after — consistent with a concurrent process actively editing this same working tree during the review window, not with anything I introduced (I had not yet touched that file at that point). The file was clean again on the next check, `git status` matched the original scope throughout, and the final gate run (396/396, clean lint/typecheck) was taken from a settled, stable state. Flagging this only so the team is aware the working tree was not exclusively under this review's control while it ran — not as a finding against the batch.

---

## Re-review (round 2) — three fixes verified against the edited files

The coordinator reported three of this review's non-blocking findings were addressed and asked for the two that touch already-verified files to be re-run against the new state (prior injection/mutation results on an edited file do not carry over). All three re-verifications below were done by direct mutation against the current working tree, then reverted; `git status --porcelain -uall -- libs/frontend/tasks-ui/` matched the original batch scope before, during (between mutations), and after.

### 1. R11 docblock — re-verified against the edited ratchet, CONFIRMED

`no-editor-dependency.spec.ts`'s docblock now states the narrowed claim precisely: the package-specifier form is "the gap, and it is this file's reason to exist," and the relative-path form is "already covered by lint" with `FORBIDDEN_REACH_BACK` recast as "a second line, not the primary one." Re-ran both injections against this edited file (prior results discarded, as instructed):

- **Package specifier** (`import '@ptah-extension/editor';` in a scratch file): `nx lint tasks-ui --skip-nx-cache` → **"✔ All files pass linting"**, zero errors. `nx test tasks-ui` → exactly 1 failure (`never imports @ptah-extension/editor`), 408/409 otherwise green.
- **Relative reach-back** (`from '../../../editor/src/lib/quick-open/quick-open.component'`): `nx lint tasks-ui --skip-nx-cache` → **fails** with `Projects cannot be imported by a relative or absolute path, and must begin with a npm scope  @nx/enforce-module-boundaries`. `nx test tasks-ui` → exactly 1 failure (`never reaches the editor library by a relative path either`), 408/409 otherwise green.

The narrowed claim is now exactly true in both directions: a skeptic testing the relative form finds the file agreeing with them (lint fails on it too), and the package-specifier form is the one genuine gap the file exists to close. Both probe files were deleted immediately after each run; working tree confirmed clean between and after.

### 2. The narrowing test — re-verified, no longer vacuous

Read the new `NARROWING_CATALOGUE` (seven entries) and the rewritten test (`task-command-palette.component.spec.ts:259-292`). The fixture now genuinely leaves four survivors after narrowing to `'filter'`, with three prefix matches outranking the interior `Clear all filters` match — so index 3 (arrowed to before narrowing) lands on a real, still-present row (`Clear all filters` → `clearFilter`) rather than being clamped out of existence. The assertion names the exact expected action (`openTask TASK_2026_300`, row 0) rather than inferring it, which is only possible because each of the four surviving rows carries a distinct action.

Mutation: removed the eager `configure()` + `setActiveIndex(0)` from `onQueryChange` (leaving only `this.query.set(value)` and the scroll call), ran the isolated test.

**Result: it now fails, correctly** — `runs` was `[{ kind: 'clearFilter' }]` (the stale row 3) instead of the expected `[{ kind: 'openTask', taskId: 'TASK_2026_300' }]`. This is the discrimination the original test lacked. Reverted; full suite re-confirmed green at 409/409.

### 3. The DESCENDANTS table — re-verified, 13 red confirmed exactly

Read the new `DESCENDANTS` table (`task-card.component.spec.ts:377-384`): six distinct focusable descendants (status-menu trigger, a status-menu option, Start, the isolate toggle, the child rollup, the parent crumb), each driven through both `it.each` blocks (Enter and Space) via the shared `fixtureFor()` helper, which correctly switches between `withRollup()` and the new `withParent()` fixture since parentage and the rollup are mutually exclusive on one card. Plus the one named, separately-called-out rollup/Enter test.

Mutation: removed both `if (event.target !== event.currentTarget) return;` guards in `task-card.component.ts` (`onCardEnter`/`onCardSpace`), ran the full `tasks-ui` suite.

**Result: exactly 13 failed, 396 passed of 409** — matching the claim precisely (6 Enter + 6 Space + the 1 named rollup case = 13). Reverted; full gate (`typecheck`, `test`, `lint`) re-run clean afterward: 409/409, 16/16 suites, 0 lint problems, clean typecheck.

### Not re-verified, by design

- **`KeyboardNavigationService` (finding #3)** — untouched by this batch, correctly spun out to `TASK_2026_184`. No re-check needed; nothing in `libs/frontend/ui` changed.
- **Finding #5 (jsdom cannot synthesize activation `click`)** — moved to the R10 manual checklist rather than fixed in code, which is the correct disposition for a harness limit rather than a weak test. Nothing to re-verify.
- **Contrast fixes** — per the coordinator's instruction, not re-assessed for contrast (that is `visual-reviewer`'s pass). I did read the current template (`task-command-palette.component.ts:82-259`) to confirm the DOM/ARIA changes are presentation-only: `role="dialog"`/`aria-modal="true"` on the same element, `role="listbox"` + `[attr.aria-activedescendant]="activeOptionId()"` unchanged, options still `role="option"` `tabindex="-1"`, backdrop still a `tabindex="-1"` sibling button. The single-focusable-element trap is unaffected — only the query input lacks `tabindex="-1"` — so `task-command-palette.component.spec.ts:316-330` ("traps Tab...") still holds structurally. The two new construct-absence tests (`carries no primary-on-primary text anywhere in the list`, `carries no opacity modifier on any row, active or disabled`) are sound as tests: both assert against the real rendered `className` strings across every option and its full descendant subtree, not against a hardcoded expectation, and I confirmed by reading the template that `bg-primary`/`text-primary-content`/`opacity-\d`/`text-base-content/\d` are in fact absent from the current markup (replaced by `bg-base-300` + text/shape signaling). This matches the Batch 7 construct-absence pattern and is not vacuous.

### Totals re-confirmed

`npx nx run-many -t typecheck,test,lint -p tasks-ui --skip-nx-cache`, uncached, run twice (once as the clean baseline before mutating, once as the final check after all three reverts): **409/409 tests, 16/16 suites, 0 lint problems, clean typecheck**, both times identical. This matches the claimed 396 → 409 end state exactly (I could not independently reconstruct the three-consecutive-clean-runs history, same caveat as round 1).

### Verdict (round 2): unchanged — **APPROVED**

All three re-verifications landed exactly as reported; none surfaced a new issue or reopened a closed one. No blocking issues in either round.

---

## Verdict

**Recommendation**: **APPROVE.**

**Confidence**: HIGH on all four numbered mutation-verification items and the standing-rules checklist (all directly reproduced or directly read against the code, not inferred from prose). MEDIUM on the "294 baseline" / "six consecutive clean gate runs" totals claim, which I did not independently reconstruct.

**Top risk carried forward, not blocking this batch**: the `KeyboardNavigationService.configure()` clamp-vs-reset behavior (Moderate #3) is pre-existing shared-lib behavior that two other consumers already share unguarded — worth a follow-up ticket, not a reason to hold Batch 10.

No critical or serious issues were found. Every claim explicitly flagged for mutation verification in the review brief was reproduced directly (double-fire guard: exactly 5 tests, confirmed; tab-stop count: 33→11, confirmed by real DOM measurement; R11 ratchet: both injection forms caught, confirmed; R10 host-binding: confirmed via a working document-listener mutation) except for two claims (the R11 docblock's blanket "lint cannot catch this" framing, and the "resets the active row" test's discriminating power), which mutation testing showed to be partially or fully unsupported by the evidence offered — both are documentation/test-quality gaps rather than functional defects, and neither changes the runtime behavior of the shipped feature.
