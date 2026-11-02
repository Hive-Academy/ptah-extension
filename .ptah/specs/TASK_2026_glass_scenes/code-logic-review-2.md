# Code logic review 2: glass scenes, phase 2

**Verdict: REVISE**

This is a narrow revise. The dark Ptah Glass tokens that batch-report-2 says were changed are partly overridden by the cascade, so the contrast numbers do not describe what ships. I did not argue the approved look.

Scope: commits f12cc59c0, 9d59f8fe5 and 57ea18aa9, plus the uncommitted blur 2px -> 0px diff. Files: `styles.css`, `glass-scrim.spec.ts`, `src/backgrounds/*.webp`, `project.json`.

## Findings

### Serious

**S1. Dark `ptah-glass` blur and tint values are overridden by a more specific token block, so they are dead tokens for the default dark theme.**
- `styles.css:2708` is `:root[data-theme][data-glass='on'][data-glass-mode='dark']`, specificity (0,4,0).
- It sets `--glass-saturation: 1.16` (2709), `--glass-under: oklch(var(--b1) / 0.18)` (2711) and `--glass-tint-alpha: 0.7` (2719).
- The Ptah Glass block `:root[data-theme='ptah-glass'][data-glass='on']` at `styles.css:2856-2875` is only (0,3,0). It comes later in the file but loses on specificity.
- `index.html:2` and `theme.service.ts:268` both set `data-glass-mode='dark'` on the root, so the dark block always applies to this theme.
- Effective dark values:
  - `--glass-under` stays 0.18, not 0.30.
  - `--glass-saturation` stays 1.16, not 1.08.
  - The aurora tint alpha stays 0.70, not 0.58. Aurora has no `[data-scene]` rule, and `data-scene` is unset by default (`theme.service.ts:280`).
- Dark ember, tide, horizon, pyramid and temple are not affected for tint. Their scene rules at `styles.css:2898-2902` are (0,4,0) and come later, so they win.
- `--glass-blur: 0px` and `--glass-blur-overlay: 6px` do take effect, because the dark block does not set them.
- The light theme is fine. Light has no (0,4,0) token block for these properties. `styles.css:3360` sets only line, sheen, elevation and glow tokens, and `ptah-glass-light` at 2876 ties the base block at (0,3,0) and wins by order.
- Impact: the dark contrast model in batch-report-2 assumed a 0.30 under-scrim (dark chrome 5.42:1 caption on Temple, 6.52:1 body). The shipped value is 0.18, so those figures are optimistic.
- The user approved the look as rendered. That means the effective values, not the intended ones.
- The spec at `glass-scrim.spec.ts:285-286` only does a text match on the block. It asserts `--glass-under >= 0.3` in the dead declaration, so it passes while the effective cascade differs. It pins intent, not the computed result.
- Decision for the owner, since fixing it changes the approved look:
  - (a) Delete the dead tokens (`--glass-under`, and the saturation and aurora alpha values that do not apply) and record the real values.
  - (b) Raise the specificity, for example add `[data-glass-mode='dark']`, to make the intended values real and re-measure.
- Either way, make the spec assert the effective declaration.

### Moderate

**M1. With pane blur at 0px, the contrast numbers need a rerun on the effective values.**
- The model used the unblurred scene for the worst pixel, so the 0px blur itself does not invalidate it.
- Two inputs are wrong or stale:
  - Dark under-scrim: 0.30 modelled, 0.18 effective (S1).
  - Tint alphas at 0.68 and 0.55 for pyramid and temple: the report's rows 0.68/0.55 are the current values, but the measurement predates the temple-bg.webp replacement (57ea18aa9, 2752x1536 at a 16:9 crop).
- Worst-case risk is dark chrome over the bright pyramid or temple pixels. Caption contrast would likely fall under the 4.5:1 target. I did not recompute it.
- The `--glass-under-bar` (0.6) bars and the content and plate scrims are unaffected.
- With zero blur, small high-frequency scene detail sits directly behind pane text. Contrast at the single worst pixel understates the perceived noise. This is a risk to accept knowingly, not a defect.

### Minor

**m1. The uncommitted spec edit at `glass-scrim.spec.ts:273` was tightened, not loosened.**
It now pins `--glass-blur: 0px`, 6px overlay and 1.08 saturation. Note that the 1.08 saturation assertion also passes on the dead declaration (see S1).

**m2. The comment above the tint rules at `styles.css:2917-2921` is partly stale.**
It still describes the "measured" per-theme values, which now differ from the tint alphas set in 9d59f8fe5.

## Checks that passed

- **Theme scoping.** Every changed value sits in `:root[data-theme='ptah-glass'|'ptah-glass-light'][data-glass='on']` (`styles.css:2856` and `2876`). The nord, cupcake and dracula overrides at 2925-2934 are untouched, so there is no leak into other glass or non-glass themes.
- **var() chains.** `blur(0px)` is valid. `--glass-filter` (2658) still builds `blur(var(--glass-blur)) saturate(...)`.
- **Fallbacks.** The `@supports not backdrop-filter` block (2748) and the `prefers-reduced-transparency` / `prefers-contrast: more` block (2765) are at (0,4,0) and set `--glass-filter: none`, `--glass-under` and the opaque tints. They still beat the Ptah Glass (0,3,0) values. With reduced transparency the tint is opaque, so a high-contrast user is safe.
- **Overlay surfaces.** `--glass-filter-overlay` still applies the 6px blur at `styles.css:2981`, with a 0.9 fill. Overlay readability is fine.
- **Asset URL (f12cc59c0).**
  - `url("./backgrounds/*.webp")` sits in a custom property in the same stylesheet.
  - The existing dist has `browser/media/pyram...` and `templ...`, so the Angular esbuild css-resource plugin hashes and emits the images. Emitted CSS paths resolve relative to the stylesheet.
  - Electron: `copy-renderer.js:179` sets `<base href="./">`, and the CSP `img-src 'self' https: data: blob:` (`copy-renderer.js:163`) permits the same-origin media file.
  - VS Code: `webview-html-generator.ts:298` has `img-src ${webview.cspSource} ...`. `angular-webview.provider.ts:96` includes `webview/browser` and `extensionUri` in `localResourceRoots`, and the stylesheet comes through `asWebviewUri`.
  - I did not inspect the emitted CSS string and did not run a build, which the task forbids.
- **Dead assets.** `project.json` still copies `public/` and has no reference to the old `public/images` path.

## Five logic questions

1. **Does it do what was asked?** Partly. The scene-showing look is delivered for light and for non-aurora dark scenes. Dark aurora is unchanged in effect, and dark under, saturation and aurora tint are not what the report claims (S1).
2. **What can fail?** Dark chrome contrast on bright image scenes at 0px blur (M1). The failing cases are not tested by the spec.
3. **What did the requirements leave unspecified?** Effective-value verification, and a contrast floor at zero blur.
4. **Does the evidence exercise the new behaviour?** No. The spec is text-matching and the contrast model used the unshipped 0.30.
5. **What is the blast radius?** Only the two Ptah Glass themes. Fallbacks and other themes are intact.

## Verification

Command: `npm run verify -- -p ptah-extension-webview`

Result: passed. Exit code 0, with lint, test and typecheck all succeeding (3 of 3, 0 cache hits, 45.0s). The pass does not cover S1, because the spec asserts declarations, not the cascade.

## Decisions

- Verdict set to REVISE on S1 alone. It is cheap to fix, but it needs an owner choice because the fix alters the approved dark look.
- No fix made, since this role is review only.
