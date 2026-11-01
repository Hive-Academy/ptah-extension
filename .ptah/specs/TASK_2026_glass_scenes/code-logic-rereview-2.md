# Code logic re-review 2 — commit 0cfea488e

**Verdict: APPROVED**

Scope: `git show 0cfea488e`, styles.css ~2650-2905, glass-scrim.spec.ts.

## S1 resolved (option a)
- Dark effective block is `:root[data-theme][data-glass='on'][data-glass-mode='dark']`, specificity (0,4,0) (styles.css:2708). It sets `--glass-saturation: 1.16` (:2709), `--glass-under: oklch(var(--b1)/0.18)` (:2711) and `--glass-tint-alpha: 0.7` (:2719).
- The ptah-glass block is (0,3,0) (:2856) and loses to it. The removed `--glass-saturation: 1.08` and `--glass-under: 0.3` were therefore dead. Removing them changes no rendered value.
- `--glass-tint-alpha-aurora` is now 0.70 (:2860). This matches the effective 0.7 from :2719. The previous 0.58 never rendered. The default scene's tint is unchanged, and the per-scene overrides (:2896-2905, also (0,4,0) and later in the file) still win for non-aurora scenes.
- The light block is untouched except blur. It keeps saturation 1.08 (:2877) and aurora 0.38 (:2882).

## Rendered values vs previous commit
- Pane blur: dark and light went 2px -> 0px (:2857, :2875). Neither (0,4,0) dark-mode block nor any other later rule sets `--glass-blur`. The base 16px (:2654) is lower specificity, so 0px wins. This is the intended change.
- Overlay blur stays 6px (:2858, :2876).
- No other value changed. The removals are dead tokens. The aurora alpha only aligns the declared token with the value that already rendered.
- temple-bg.webp was replaced (binary, 202014 -> 201998 bytes). I did not inspect it visually, and it is out of scope here.

## Spec asserts the effective cascade
- Floors use `[0.70, ...]` for ptah-glass aurora (spec:232), matching the CSS.
- Blur asserts `--glass-blur: 0px` and `--glass-blur-overlay: 6px` (spec:273-274).
- Saturation is asserted only for light. Dark asserts `not.toContain('--glass-saturation:')` (spec:276-277).
- Dark asserts `not.toContain('--glass-under:')` (spec:283).
- Limitation, non-blocking: these are textual checks on the block. They would not catch the dark-mode block being removed or changed (for example the effective 1.16 / 0.18). The value of "no dead tokens" is guarded, but the effective values themselves are not asserted.

## Verification
`npm run verify -- -p ptah-extension-webview` passed: lint, test and typecheck all succeeded, and all 3 results came from the Nx cache. The cached test result reflects the unchanged inputs, so it is valid for this commit.

## Residual
M1 (contrast re-measure) is recorded as accepted risk: the user reviewed the rendered look.
