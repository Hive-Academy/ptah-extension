# PR 586 Docs Review — TASK_2026_540_0940

Scope: `git diff -- .ptah/specs/TASK_2026_540_0940/batches.md .ptah/specs/TASK_2026_540_0940/implementation-plan.md`
(34 insertions / 59 deletions across the two files). Lane account reviewed: `pr-586-fix-docs.md`. Code verified
against the current worktree state (concurrent lane edits to other files ignored, per instructions).

## Verdict: APPROVE

Every factual claim in the new/changed prose was checked against the code it cites and matches exactly, including
line ranges that could plausibly have drifted. No invented behaviour, no leftover stale text outside the permitted
locations, both tables render correctly, and nothing correct was deleted.

## Findings

None blocking, serious, or moderate. Two minor observations, neither wrong:

- **Minor** — `implementation-plan.md:530` (inside "Revision log") still reads "consumed by a keyed `@for` host in
  `ElectronShellComponent`". This is correctly left alone: it is the historical record of what revision 2 originally
  specified, immediately followed at :531 by the acknowledgement that findings were later superseded, and the lane's
  account explicitly scopes the Revision log as untouched history. Not a defect.
- **Minor** — `pr-586-fix-docs.md:28` gives the pre-edit line number for Finding 3's second table row as "88" but the
  table in `pr-586-fix-docs.md` itself (lines 27-28) is malformed (a 2-column header row over a 3-column data row,
  and the header separator row is missing a column). This is in the lane's own account document, not in the two
  files under review, so it is out of scope for this verdict but worth a follow-up cleanup if that file is ever
  read as documentation rather than a working note.

## Verification detail

### 1. batches.md — sequential-vs-parallel contradiction (CodeRabbit comment 1)

- Old text (`git diff` context): "Batches run one at a time, in order... Every batch depends on the one before it"
  — flatly contradicted lines 20-30, which already stated Batch 2/3 and Batch 6/7 parallel exceptions.
- New text (`batches.md:38-43`): states sequential execution as the **default**, then lists the same two exceptions
  already recorded at lines 20-24 (Batch 2/3, "started before Batch 1 was committed... depend only on Batch 1's
  exports") and 24-30 (Batch 6/7, "may run as two parallel `codex` lanes... disjoint file lists... commits stay in
  order: Batch 6, then Batch 7"). The new wording is a faithful restatement — same facts, same order, no new claims,
  contradiction resolved. Verified by reading `batches.md:1-50` in full.

### 2. implementation-plan.md:88 — MD056 pipe escape (CodeRabbit comment 2)

- Old text: `` `setCurrentView('setup-wizard' | 'harness-builder' | 'tribunal')` `` — three unescaped `|` inside a
  table cell, splitting a 3-column row into 5 cells.
- New text: `` `setCurrentView('setup-wizard' \| 'harness-builder' \| 'tribunal')` `` — escaped.
- Ran `npx markdownlint-cli2` against both files directly (not trusting the lane's own report): **0 MD056 findings**
  in either file, 157 pre-existing findings of other rule types untouched by this diff. Also confirmed the file's
  fenced code blocks stay balanced (14 ``` markers, an even count) after the large deletions in Decision 2 item 5-6,
  so no block comments or tables were left malformed by the surrounding edits.

### 3. implementation-plan.md — stale keyed-remount / unconditional-focus / "cannot fail" passages (CodeRabbit comment 3)

Checked every changed sentence against the actual shipped code:

- **`SurfaceRouterService.remountActiveSurface()`** (`surface-router.service.ts:165-173`): code reads
  `this.outletContexts.getContext(PRIMARY_OUTLET)` (`ChildrenOutletContexts` injected at `:67`, `PRIMARY_OUTLET`
  imported at `:6`), early-returns on `!ctx?.outlet?.isActivated || !ctx.route`, captures `route`/`injector` before
  `ctx.outlet.deactivate()`, then calls `ctx.outlet.activateWith(route, injector)`. No try/catch anywhere in the
  method. This matches `implementation-plan.md:324` and the Revision 3 override block (`:13-16`) exactly, including
  the claim that a component-less route (the `chat` route, confirmed to carry no `component`/`loadComponent` at
  `apps/ptah-extension-webview/src/app/app.routes.ts:66-69`) makes the call a no-op.
- **The remount effect** (`electron-shell.component.ts:331-353`): code matches the doc's description feature for
  feature — `lastHandledTick` captured at construction (`:331`), the effect returns early on an unchanged tick
  (`:334`) and on `tick === 0` (`:336`), then inside `untracked` returns while `pendingSurface() !== null` (`:338`,
  and `lastHandledTick` is already advanced before that check, so the skip is real, not deferred — the next distinct
  tick is what triggers the next remount, matching the doc's "skipped, not deferred" claim and the corresponding spec
  case `electron-shell.config-gate.spec.ts:353-364`), records `document.activeElement` and `host.contains(active)`
  before calling `remountActiveSurface()` (`:339-342`), and registers `afterNextRender` to focus the re-read host
  only when `active === document.body || !active?.isConnected || wasInside` (`:343-351`). Host markup
  (`:241-248`): `#configurationSurfaceHost`, `data-test="configuration-surface-host"`, `tabindex="-1"`, un-keyed
  `<ptah-app-shell>` inside an `outline-none` div — line numbers match the doc's citations exactly, unaffected by the
  concurrent lane's edits elsewhere in the file.
- **`AppStateManager`**: `ConfigurationSurfaceSlots` interface at `:83` (doc cites `:83`, exact); constructor effect
  writes `openSurface` first and unconditionally with an unchanged-value skip at `:481-494` (doc's fix-docs account
  cites `:484-492`, within the same block); `_configurationSurfaceRemountTick`/`configurationSurfaceRemountTick` at
  `:380` / `:604-605` (doc cites `:604-605`, exact); `switchWorkspace` stay-branch (`:789-850`) bumps the tick once
  and skips the restore navigation exactly as described, and the JSDoc comment at `:785-787` in the source itself now
  says "the shell's effect calls `SurfaceRouterService.remountActiveSurface()`" — the code's own comment already
  agrees with the doc's replacement text. Grepped the whole file for `recordSettledView` and
  `updateConfigurationSurfaceSlot`: zero hits, confirming the doc's "no such methods exist" claim.
- **`electron-shell.config-gate.spec.ts`**: every test-plan claim in the new `implementation-plan.md:168` diff line
  has a matching test — "remounts exactly once... never at tick 0, on a repeat value, or from a non-zero
  construction-time tick" ↔ tests at `:261-270, 305-315, 317-329`; "a bump while `pendingSurface()` is non-null skips
  (not defers)" ↔ `:353-364`; "focus conditional on the three pre-remount conditions" ↔ `:272-283, 331-341, 343-351`.
  No fabricated test claims.
- **"Cannot fail" → "can fail"** (`implementation-plan.md:414` and the Failure-behaviour section): the new text says
  a remount CAN fail because the re-created component's constructor/`ngOnInit` can throw, `remountActiveSurface()`
  does not catch it, and the shell's effect adds no handler, so the error surfaces through Angular's `ErrorHandler`.
  This is accurate: `remountActiveSurface()` (`surface-router.service.ts:165-173`) has no try/catch, and the calling
  effect (`electron-shell.component.ts:332-353`) has no try/catch around the `remountActiveSurface()` call either —
  an uncaught synchronous throw during `ctx.outlet.activateWith(...)` (e.g. from a re-created component's
  constructor) would propagate out of the effect body. Angular routes uncaught errors during change detection /
  effects to the injected `ErrorHandler`, which is the standard behaviour the doc claims — no special handling exists
  in this codebase to contradict it.
- **Deletions**: the removed `@for` keyed-host code block, the removed "why the whole shell" rationale paragraph, the
  removed `queueMicrotask` focus code block, and the removed "remount also destroys the canvas tiles" bullet all
  described the superseded design, not the shipped one — none of them describe current behaviour, so removing them
  loses nothing true. The replacement "remount re-creates the routed surface component only" bullet is consistent
  with the component-less `chat` route fact above (the canvas is not the routed component when a configuration
  surface is open, and `chat` itself has no routed component to re-create).
- **Stale-text sweep**: grepped the whole file for `keyed remount`, `` keyed `@for` ``, `keyed block`,
  `queueMicrotask`, and `cannot fail` / `cannot "fail"`. Every remaining hit is either inside the binding "Revision 3
  overrides" block (`:9`, describing what override 1 *replaces* — correct), inside the historical "Revision log"
  section (`:530`, explicitly scoped as untouched history and immediately followed by the supersession note), or a
  new corrected sentence that itself explains the supersession (`:324`, `:414`, `:482` — "no keyed blocks"). No stale
  claim survives outside those two permitted locations.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| batches.md: state sequential as default, list exceptions | COMPLETE | none |
| implementation-plan.md:88 MD056 pipe escape | COMPLETE | none |
| implementation-plan.md: replace stale keyed-remount/unconditional-focus/"cannot fail" text with shipped behaviour | COMPLETE | none |
| Revision 3 overrides block stays intact and binding | COMPLETE | verified untouched (diff starts at line 40; overrides block is lines 3-36) |
| No invented behaviour | COMPLETE | every claim traced to file:line in the actual code |
| Tables render (column counts) | COMPLETE | markdownlint: 0 MD056 in both files |

## Residual uncertainty

Line-number citations for facts the lane did **not** change (e.g. bootstrap-slice migration `:686-701` cited in the
TASK_2026_533 handoff note) were not re-verified here since they were outside the diff; if the concurrent lane's
edits to `electron-shell.component.ts` or `app-state.service.ts` land in a way that shifts those specific ranges,
they would need a separate pass — but that is pre-existing content this diff did not touch, not a defect introduced
by it.
