# Theme picker — independent source review

Author: Grok lane 49112e62-05fe-441a-8d75-34ae6f539ab5.
Reviewer: OpenAI parent session. Source inspection only. No execution.

## Verdict: INCOMPLETE — not accepted for merge

The report and source express the requested Light/Dark/Glass tabs, metadata-based partitions, compact four-color tiles, theme titles, selected marks, and accent controls. ThemeService still owns theme and accent writes. The native auto-popover and trigger remain. The parent read the implementation report, component diff, targeted component source, and spec excerpts. This is not a complete compilation, test, or rendered acceptance pass.

## Source findings

1. **Parent ink can become stale after a theme selection.** `theme-toggle.component.ts:334-345` delegates selection and focuses the tile. For a same-category selection, it does not schedule another color capture. `captureParentInk` at :478-493 copies concrete colors into inline custom properties. Those colors do not follow subsequent theme changes. Selecting a dark and then a light Glass theme while the panel stays open can retain the old selected/focus ink. The existing test at `theme-toggle.component.spec.ts:406-420` checks the initial copy only. A next correction must refresh colors after the new theme renders, without stealing unrelated focus.

2. **The initial height cap persists after tab content changes.** `place` at `theme-toggle.component.ts:496-549` writes `maxHeight` from the current content height. `selectCategory` at :351-358 changes the tiles without another placement pass. A short Glass panel can therefore retain its small cap when Light shows 18 tiles. The panel scrolls, but it does not expand into available space. Theme selection can also add or remove the accent footer without another placement pass. Verify tab changes, footer changes, and above-anchor placement together.

3. **Popup semantics need correction or explicit review.** The trigger at `theme-toggle.component.ts:185` uses `aria-haspopup="true"`, which denotes a menu. The panel at :198 uses `role="dialog"`. These values do not describe the same popup type. This is an accessibility source finding, not proof of a screen-reader failure.

## Other limits

- No Jest, diagnostics, typecheck, lint, build, serve, E2E, or Electron inspection ran.
- The `afterNextRender` test flush remains unverified in this Jest environment.
- Native Escape, outside dismissal, top-layer hit testing, focus, and dark/light contrast need real Electron evidence.
- Placement reads scrollHeight but caps a border-box. Inspect padding and border effects at narrow heights.
- The component grew to 613 lines with inline styles and template. Check the project file-size rule before acceptance.
- No service or storage source changed in this lane. That does not prove persistence behavior through the full app.

## Stop boundary

Preserve all changes. Record findings only. Do not start another correction lane, execute checks, commit, push, merge, close PR #799, or remove the worktree under this stop request.
