# Code logic review — lofi polish

Review family: reviewer grok, implementer codex

Score: 6/10

Verdict: REVISE

Scope: uncommitted block `apps/ptah-extension-webview/src/styles.css:2537-2572` (one lofi-only block). Compared with the templates named in the brief, the earlier unlayered tab rules at `styles.css:2494-2505`, the glass `@layer components` block that closes at `styles.css:3124`, and the unlayered glass overrides at `styles.css:3126-3151`. `code-style-review.md` is absent. No Nx, Jest, tsc, lint, build, or serve.

A 7 would need every declared pane rule to attach. A 5 would need a second target to miss or a theme/glass leak. The other four targets match, every selector is gated with `:root[data-theme='lofi']`, and lofi does not turn glass on.

## Decisions

- Severity of the dead sidebar selector is Major. The pane still has `bg-surface-1` and `border-r`, so it does not look broken, but the new declarations never apply. Options were Moderate (visual delta is small) or Major (the rule is a no-op). Evidence: `workspace-sidebar.component.ts:43-45` has no `surface-1` class. Reversible: yes, selector-only.

## Five logic questions

1. Silent success: `styles.css:2538` matches no element, so the workspace pane keeps its old utilities and a screenshot can still look tinted.
2. User action: choosing lofi does not apply the new sidebar fill, edge, or shadow reset. Workspace-row hover stays the old `surface-1` → `surface-2` step.
3. Wrong answer without an error: the selector asks for a class the template never sets. No other theme receives these declarations.
4. Dependency: glass rules need `data-glass='on'`. `theme.service.ts:111` does not set `glass` for lofi, and `theme.service.ts:226-231` removes the attribute. The later unlayered glass block (`styles.css:3127`) does not apply. The layered glass recipe cannot override this unlayered block, and it does not need to while glass stays off.
5. Unspecified: no new `:focus-visible` rules. Existing outlines are not cleared. The Sessions footer button (`canvas-rail.component.ts:240-241`, `btn-outline`, test id `canvas-footer-new-session`) is outside the hero selector.

## Findings

1. Major — workspace sidebar rule never matches. `styles.css:2538` requires `.electron-shell-body > ptah-workspace-sidebar > .surface-1`. The only direct child is a `div` whose class is `bg-surface-1`, not `surface-1` (`workspace-sidebar.component.ts:43-45`). Background, `border: 0`, `border-inline-end`, and `box-shadow: none` are dead. The comment at `workspace-sidebar.component.ts:39` says "surface-1 panel"; the class attribute does not. Fix: target that div (for example `> div`), or a class the template actually has. Do not stop at the rename; see finding 2.

2. Moderate — the declared pane fill is the same color as the row hover. `styles.css:2539` sets `background: oklch(var(--b2))`. `--surface-2` is defined as `oklch(var(--b2))` at `styles.css:151`. Workspace rows hover with `hover:bg-surface-2` (`workspace-sidebar.component.ts:64`). Once finding 1 is fixed as written, hover no longer changes the row. Fix: keep the pane on a token that is not `--surface-2` (the existing `--surface-1` mix already is), or add a lofi rule so `.sidebar-item:hover` uses `oklch(var(--b3))`.

## Checks that held

- Sessions aside: `ptah-canvas-rail` (`canvas-rail.component.ts:38`) directly wraps `aside[aria-label="Sessions"]` (`canvas-rail.component.ts:82-84`). `styles.css:2544` matches.
- Vertical tabs: both are direct children of `.electron-shell-body` (`electron-shell.component.ts:358-371` and `:425-431`) and the control is a `button` (`sidebar-tab.component.ts:57`). `styles.css:2549` and `:2553` match. Hover fill is `--b3`, which is not the rest fill `--b2`. Component glass transparency (`sidebar-tab.component.ts:38-41`) runs only under `data-glass='on'`.
- Hero: `canvas-rail-board.component.ts:171-174` is `data-testid="canvas-hero-new-session"` plus `btn-primary`. `styles.css:2556` and `:2561` match that button only. Rest color is `oklch(var(--pc))` on `oklch(var(--p))`, DaisyUI's own primary pair. Hover changes background to `oklch(var(--p) / 0.88)` and does not replace the color set at `styles.css:2559`.
- Setup card: `section` is the direct child of `ptah-project-setup-card` (`project-setup-card.component.ts:8-12`). `styles.css:2564` matches. Unlayered `background`, `border`, `border-radius`, and `box-shadow: none` beat the layered `.surface-3` shadow at `styles.css:401-405`. The host shadow at `project-setup-card.component.ts:40` is anubis-light only.
- Header tabs: `styles.css:2570` matches `.electron-tabs.tabs-lifted > .tab` (`electron-shell.component.ts:194-198`). Specificity beats the inactive `--tab-bg: b2` rule at `styles.css:2494`. Active tabs were already `--b1` (`styles.css:2500-2501`).
- Tokens used by the rules that match: `--surface-border` and `--surface-border-strong` at `styles.css:153-154` (all themes, including lofi); `--b2`, `--b3`, `--p`, `--pc`, and `--rounded-box` are DaisyUI theme channels. Lofi muted ink is `--bcm: 40% 0 0` (`styles.css:267-268`), which is the measured secondary tier on base surfaces. This pass did not re-open the generated DaisyUI sheet or sample the screenshot pixels.
- No leak to other themes: each new selector starts with `:root[data-theme='lofi']`. Glass themes use other `data-theme` values (`theme.service.ts:93-94`).

## Uncertainty

Runtime appearance was not rechecked in a browser. Contrast numbers were not recomputed with a meter. If lofi were later given `glass: true`, these unlayered rules would beat the layered glass recipe on the same elements; that combination is not possible through `ThemeService` today.
