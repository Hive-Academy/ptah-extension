# Bounded correction — TASK_2026_710 marketplace `fitShellWidth`

One correction after revision 2. Independent review: the electron helper returned without the shell reaching the requested width, so screenshots could be saved under the target name. No local test, typecheck, lint, build, or e2e was run.

`ptah_agent_report` is not available (`search_tool` returned no MCP tools). This file is the spawn report.

## Files changed

1. `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/marketplace-visual.e2e.spec.ts` — `fitShellWidth` electron branch only (`:123-161`).
2. `libs/frontend/marketplace/src/lib/shell/marketplace-shell.component.ts` — host class, `max-w-[100vw]` removed (`:126`).
3. This file.

Not touched: contrast rules, `axe.ts` `data-glass` clear, license host `class: 'block'`, glass `::after` blur, popover host lift, `glass-roles.spec.ts`, `.gitignore`, `ci-revision-2.md`, `WIDTHS`, timeouts, click options, the VS Code branch of the helper.

## What was wrong in revision 2

`fitShellWidth` (`marketplace-visual.e2e.spec.ts`, then `:130-147`) returned on every miss:

- rounded viewport outside `[320, 8000]`
- non-finite or non-positive shell measure
- non-finite next correction
- six attempts finished without `|measured - target| <= 2` (the loop ended and the function returned)

Those returns were not success. Callers still wrote `marketplace-shell-electron-${width}.png`. `ci-revision-2.md` described that as acceptable because the spec does not assert width. That was inaccurate: the file name is the width claim, and a silent return hides the Playwright viewport failure the helper was meant to stop.

`max-w-[100vw]` on `marketplace-shell` was added without a measured discovery view. The revision 2 report already said no offending view was identified. The cap is removed. A repo search for `max-w-[100vw]` now has no matches.

## Helper now

Electron only. Seed stays `target + 260`. Budget stays six attempts. `WIDTHS` stay 720 / 1100 / 1750.

Each attempt:

1. Round the candidate. If it is not finite, or not in `(0, 10000000]`, throw before `setViewportSize`. Playwright closes the page outside that range.
2. Set the viewport and read `getBoundingClientRect().width` after one animation frame.
3. If the measure is not a positive finite width, throw.
4. If `|measured - target| <= 2`, return. That is the only electron return.
5. Otherwise set the next viewport to `target + (applied - measured)`. That is the measured chrome gap (sidebar, frame, dock), remeasured because the dock absorbs part of a viewport change until its floor.

After six attempts without a match, throw. Every throw includes `target`, the last applied `viewport`, and `measured` (`NaN` if no read has succeeded). The message names the reason: illegal next viewport, bad measure, or still outside 2px after six attempts.

The next viewport is not clamped into a smaller range and then treated as success. An unattainable width fails the test instead of labeling a screenshot with a width the shell does not have.

The VS Code branch still sets the viewport to `target` and returns. That host has no chrome gap to solve; the viewport is the requested width. It does not use the electron miss returns.

## Decisions

### Throw instead of clamping a miss

- Options: keep the `[320, 8000]` clamp and return; clamp then throw if the last measure misses; throw with no clamp.
- Evidence: the review names the silent returns at the old `:130-147`. A clamp that still returns success leaves the mislabeled screenshot. Playwright's own bound is `(0, 1e7]`, not 8000.
- Chose throw, and use `10000000` only as the refusal limit for `setViewportSize`.
- Reversible: restore the previous loop. Do not do that; it is the defect.

### Remove `max-w-[100vw]`

- Options: keep the cap as a shell-width ceiling; remove it.
- Evidence: revision 2 recorded that no discovery view was measured as the min-content offender. The review says the cap is unsupported unless that evidence exists.
- Chose remove. Host class is again `block h-full w-full min-w-0 overflow-hidden`.
- Reversible: put the class token back.

### Leave the VS Code branch

- Options: also measure and throw on VS Code; leave the direct `setViewportSize(target)`.
- Evidence: the cited lines are the electron loop. VS Code sets the requested width in one call. There is no convergence miss to hide.
- Chose leave it.
- Reversible: add the same measure-and-throw after the VS Code `setViewportSize`.

## Inaccuracies withdrawn from ci-revision-2

That file was not edited (this correction's scope is the helper, the host cap, and this report). These sentences in it are withdrawn:

- Returning early on a clamped viewport is an acceptable stabilization.
- Screenshots may land at a clamped width because the spec does not assert width.
- `max-w-[100vw]` is a required half of the fix.

The protocol risk (an illegal `setViewportSize` closes the page) is still why the helper refuses a non-legal width. Refusal is now a thrown error with the three numbers, not a return.

## Checks not run

No Jest, Playwright, `nx`, `tsc`, lint, or build. The helper was read back at `marketplace-visual.e2e.spec.ts:113-162`. `max-w-[100vw]` has zero matches in the worktree.

## Unknowns

Whether electron chrome settles inside 2px within six measured corrections is unproven here. If the dock's floor leaves the shell short of 720, 1100, or 1750, the test now fails with target, viewport, and measured instead of saving a mislabeled PNG. That failure, if CI shows it, needs a layout change with a measured gap, not another silent helper return.
