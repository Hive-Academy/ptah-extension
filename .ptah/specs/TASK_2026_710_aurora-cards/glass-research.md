# Ptah glass theme: material, not a palette

Research and prototype review, accessed **2026-10-21**. Numeric CSS values below are **starting hypotheses for Ptah**, not values specified by Apple, Microsoft, DaisyUI, or WCAG. Validate them in the actual Electron window at 100% and 125% scaling. The dark screenshot is a visual review, not a measured contrast or frame-time test.

## Summary

1. **Give the material something to transmit.** A glass card needs visible, spatially varied light or imagery behind its edges. A flat field cannot reveal blur. [1][2]
2. **Keep dark glass neutral and luminous.** The current navy-on-navy combination absorbs the backdrop. Start with smoke-gray translucent fill, then let backdrop color pass through. [1][3]
3. **Make one consistent light source.** A brighter top-left edge, weaker lower edge, restrained inner glint, and soft outer shadow sell thickness faster than more blur. [1][4]
4. **Blur is an optical effect, not the whole recipe.** Pair moderate blur with slight saturation, translucent fill, edge contrast, and a small amount of texture. [2][4][5]
5. **Use true glass selectively.** Navigation, the composer, and transient overlays can float; dense transcript cards, code, controls, and nested tiles should normally be stable fills. [1][4][6]
6. **Protect text independently of the backdrop.** Use a stable text plane, more opaque fills behind long copy, and measure the least favorable backdrop region. [1][7][8]
7. **Reserve saturated color for backdrop and action.** A single Ptah gold action can coexist with gray smoke; widespread gold outlines and blue panel tints make a conventional dark theme. [3][4]
8. **Build one glass recipe above DaisyUI themes.** Derive base and ink from v4's `--b1`, `--b2`, `--b3`, `--bc`, and accent from `--p`; override only backdrop, mode, and exceptional optical parameters. [9][10]
9. **Respect the escape hatches.** `prefers-reduced-transparency`, `prefers-contrast`, forced colors, and reduced motion should produce intentional solid surfaces. [1][4][11][12]
10. **Budget by blurred area and motion.** Keep blur on a few mostly static planes and profile the worst scrolling/overlay state on target hardware. No universal safe pixel or layer count is documented. [4][13][14]

## 1. Anatomy of convincing glass

The background must supply **local variation beneath the actual glass bounds**: a photograph, detailed wallpaper, or a mesh with light/dark fields crossing panel edges. A distant corner blob outside the panel contributes almost nothing. Photograph-based dark glass works particularly well when recognizable shapes remain as low-frequency silhouettes after blur. A flat single-color backdrop produces a translucent card, not perceptible frosting. [1][2][5]

Treat blur as the softening of *transmitted* light. Start around 12–20 CSS px for a 200–500 px panel, 20–28 px for a transient overlay, and 6–12 px for small floating controls. These are design starting ranges; perceived blur changes with display scale, image frequency, and fill opacity. Below roughly 8 px, high-contrast photo details can remain distracting. Above roughly 30 px, broad gradients often become uniform and the optical cue disappears. `saturate(1.1–1.25)` can keep color alive; `1.45` is a stylized boost that can make blue blobs more dominant. For dark smoke, `brightness(1.06–1.12)` can lift transmitted light, but it cannot fix a mostly opaque navy fill. [2][5]

The visible section of a glass object is a translucent face, a narrow directional edge, a subtle inner rim, and a soft separation shadow. A 1 px `inset` highlight suggests a polished lip; a second neutral/dark inset line can imply thickness. Use a border gradient with its strongest stop toward the shared light source and a weaker bottom stop. A broad white border on every side reads as an outline. Outer shadow establishes elevation; inner highlight establishes material. A restrained low-opacity monochrome noise layer can reduce the sterile gradient look, but coarse grain competes with 12 px UI text. Microsoft lists blur, tint, luminosity treatment, and noise as separate ingredients in Acrylic. [4]

Corner radius needs hierarchy and concentric geometry: 20–24 px top-level panels, 12–18 px internal blocks, 8–12 px small controls. If a child is inset 8 px, a 24 px outer radius and ~16 px inner radius align optically. Nested child surfaces should use fill and a weak edge, usually no second backdrop blur. Apple and Microsoft both warn against overusing layered translucent material. [1][4]

Text should behave as content *on* the material: use theme `--bc` at full opacity for primary text, a separately tested muted ink for labels, no thin/glowing display type, and solid or near-solid backing for long code/text regions. Keep accent text sparse; Apple recommends sparse color on Liquid Glass, and Microsoft cautions against accent text on Acrylic because of legibility. [3][4]

### Values that work

| Property | Light starting value | Dark starting value | Why |
|---|---|---|---|
| Backdrop | lavender/peach mesh or light photo, visible under each panel | neutral charcoal with warm/cool light fields or dimmed photo | Local luminance variation reveals blur. |
| `backdrop-filter` | `blur(16px) saturate(1.15)` | `blur(16px) saturate(1.18) brightness(1.08)` | Moderate frosting while preserving transmitted light. |
| Main fill | `rgb(255 255 255 / .48–.64)` | `rgb(205 211 220 / .12–.22)` over dark scene | Light milky veil; dark smoke gains luminance instead of swallowing it. |
| Dense text fill | `rgb(255 255 255 / .72–.88)` | `rgb(25 28 34 / .72–.86)` | Stable contrast for long reading. |
| 1 px top/edge | white `.65–.85` at top, `.15–.35` at bottom | white `.28–.45` at top, `.06–.12` at bottom | Directional specular edge. |
| Inset / outer shadow | `inset 0 1px white/.8`; lavender shadow `.12–.22` | `inset 0 1px white/.25`; blue-gray/black shadow `.25–.4` | Separate material glint from elevation. |
| Noise | monochrome 1–2% opacity | monochrome 2–3% opacity | Adds microtexture without legibility cost. |
| Radius | 22 px shell / 14 px tile | 22 px shell / 14 px tile | Rounded silhouette with nested geometry. |

## 2. Dark glass: why it turns into an old dark UI

Dark glass fails when the backdrop and surface share the same hue and similar low luminance, or when the translucent fill is so opaque that there is no visible transmission. That is the current dark screenshot: bright cobalt at the far left, teal at the far right, navy cards in between, and nearly black transcript/code areas. The blue is an accent field around an opaque-looking interface rather than light traveling through panels. This is an inference from the supplied screenshot and CSS, not a claim about a measured physical simulation.

Three viable directions: **smoky photo** (low-contrast landscape/interior, desaturated and dimmed, with the image crossing panel boundaries); **vivid restrained blobs** (one cool and one warm glow placed partly behind key panels, not only in corners); **neutral smoke** (charcoal-to-graphite field with subtle localized silver/amber light). In all three, use neutral gray glass. Let the background, not the panel tint, carry strong hue. A dark panel should visibly *lift* a charcoal backdrop by a modest amount; in practice aim for a clearly visible 1 px bright rim and a few percent luminance difference over representative backdrop samples. Do not use that subjective difference as an accessibility threshold; text and controls have separate WCAG checks. [1][3][7][8]

Two concrete recipes to audition:

```css
/* Smoky neutral: subdued wallpaper or charcoal mesh behind this. */
--glass-fill: rgb(211 216 222 / .17);
--glass-filter: blur(18px) saturate(1.16) brightness(1.08);
--glass-edge-top: rgb(255 255 255 / .38);
--glass-edge-bottom: rgb(255 255 255 / .07);
--glass-shadow: 0 18px 46px -20px rgb(5 8 14 / .38);

/* Clearer media overlay: short labels only; add a tested text scrim. */
--glass-fill-clear: rgb(220 223 228 / .10);
--glass-filter-clear: blur(12px) saturate(1.18);
--glass-text-scrim: rgb(16 18 22 / .62);
```

For the first Ptah revision, keep the light palette. Replace dark navy base with `#17191d`, dark backdrop with a `#17191d → #292c31` field plus muted plum/amber/steel glows or a licensed photograph, and dark panel fill with `rgb(205 211 220 / .16)`. Put localized light behind the sidebar and right pane as well as the center. Keep the gold primary action, but stop using gold for every selected border and text label. [1][3][4]

### Values that work

| Property | Light value | Dark value | Why |
|---|---|---|---|
| Base scene | `#f3edfa` with peach/lavender | `#17191d` with gray/plum/amber | Light has successful color separation; dark needs neutral foundation. |
| Main tint | white `.58` | cool-neutral gray `.16` | Dark tint adds visible light. |
| Raised tint | white `.72` | cool-neutral gray `.23` | Raised panes need more light, not more navy. |
| Overlay tint | white `.88` | graphite `rgb(35 38 43 / .76)` | Reading and menus demand more opacity. |
| Saturation / brightness | `1.15 / 1` | `1.16 / 1.08` | Prevent dark transmission from looking dead. |
| Edge contrast | top `.8`, bottom `.25` | top `.38`, bottom `.07` | Clear directional rim. |

## 3. What platform materials teach us

**Apple Liquid Glass, iOS 26/macOS Tahoe era.** Apple describes a distinct floating layer for navigation and controls, with regular and clear variants. Regular adjusts blur/luminosity for legibility; clear is for rich media and may need a **35% dark dimming layer** on bright content. Apple specifically discourages filling the content layer with Liquid Glass. Its guidance also says small toolbars can adapt between light/dark with monochrome foregrounds, while larger sidebars become more opaque for legibility. Icons use specular highlights, refraction and translucency; visionOS glass limits background color range and uses vibrancy for foreground text/symbols. Transfer: differentiate material roles, adapt opacity to content density, reserve refraction for edges/large controls, keep foreground stable. CSS blur and borders only approximate the system shader; do not label the Ptah implementation as genuine Apple Liquid Glass. [1][3][15]

**Windows 11.** Mica is **opaque**, subtly wallpaper-tinted, and suited to large foundation/title surfaces; Acrylic is frosted, brighter in Windows 11, and intended for transient menus/flyouts or overlapping navigation; Smoke dims interaction behind dialogs. Acrylic has blur, tint, luminosity treatment, and noise, and switches to solids for transparency-off/high contrast/low-end contexts. Transfer: keep broad app foundations cheap; use actual blur where context shows through, use a separate modal scrim, and support a solid fallback. [4][6][16]

**Material 3.** Its surface/elevation system is useful for hierarchy and tonal roles, but it is not a frosted-glass specification. Borrow disciplined elevation and color roles rather than borrowing a blur recipe from it. The direct material references above should govern the glass effect.

### Values that work

| Property | Light value | Dark value | Why |
|---|---|---|---|
| Material roles | opaque/milky foundation; clear control only over rich area | opaque graphite foundation; smoke nav; clear accent control | Apple and Windows reserve clearer material for functional/contextual layers. |
| Adaptive tint | `.55–.85` by content density | `.15–.25` chrome; `.72–.86` reading overlays | Density and context, not one alpha globally. |
| Dimming | `rgb(0 0 0 / .28–.35)` if clear over bright media | `rgb(0 0 0 / .2–.35)` if needed | Apple gives 35% as a bright-media clear-glass example. |
| Foreground | `oklch(var(--bc))` plus tested muted ink | same, full-opacity primary ink | Vibrancy principle: foreground remains legible over changing light. |

## 4. Picky details that make it read immediately

Place the key light at approximately **top left** and honor it everywhere: brightest border from top-left through top edge, small upper inner glint, softer right/bottom edge, shadow falling down/right. A subtle 1–2 px inset rim plus a darker interior line gives a lens/thickness hint. Avoid a continuous neon gradient outline or a large fake refraction fringe. True refraction displaces imagery; CSS can only hint at it with a narrow border and slight highlight. Apple explicitly names specular highlight and refraction for its icons; the CSS treatment is a restrained analogy. [15]

Use shadows colored by the local environment: lavender-gray for the pastel theme, neutral charcoal/blue-gray for dark smoke. Avoid pure black `.75–.8` on every panel; it makes them appear cut out. Hover should slightly increase fill and edge brightness (`+ .05` opacity / top edge `+ .08`), with no new blur; press can reduce the outer shadow and move down 1 px. Focus ring is a functional state: 2 px solid theme primary or high-contrast ink with 2 px offset; test it against the adjacent area, never rely on the 1 px specular edge. Scrollbars should be thin but visible (`thumb` ~`.3–.45` over track) and not glow. Dividers inside a pane should be weaker than its outline (`white/.08–.14` dark, ink/.1–.16 light). Icons should use current text color and a consistent stroke; reserve colorful icons for semantic statuses. [3][4][8]

### Values that work

| Property | Light value | Dark value | Why |
|---|---|---|---|
| Top glint | `inset 0 1px rgb(255 255 255 / .8)` | `inset 0 1px rgb(255 255 255 / .26)` | Polished upper lip. |
| Border gradient | white `.8 → .18` | white `.38 → .06` | Light direction and thickness. |
| Hover fill | main alpha `+ .06` | main alpha `+ .05` | Surface response without another render pass. |
| Press | `translateY(1px)`, shadow reduced ~30% | same | Feels like contact; honor reduced motion. |
| Focus | 2 px dark-violet/gold, 2 px offset | 2 px bright gold or white, 2 px offset | State must survive variable background. |
| Divider | ink `.12` | white `.10` | Internal hierarchy quieter than outer rim. |

## 5. Accessibility on variable backdrops

Evaluate **the least favorable pixel region** behind each text run and each meaningful control boundary, including hover, scrolled content, and a bright photograph. Blur does not guarantee readable contrast; it changes background values. WCAG 2.2 AA requires **4.5:1** for normal text, **3:1** for large text, and **3:1** for essential UI boundaries/states. Treat labels under 14 px as normal text. Test final composited screenshots at multiple positions rather than calculating from just the fill color. If the worst region fails, increase local fill opacity or add a stable inner text scrim; do not darken the whole scene reflexively. [7][8]

Use `@media (prefers-reduced-transparency: reduce)` to remove blur, texture and translucent fill, with solid token-based surfaces. Also provide an explicit in-app solid-material choice: MDN marks this media query as limited availability, so OS preference alone is not a complete fallback. For `prefers-contrast: more` and `forced-colors: active`, use solid surfaces and system colors where appropriate, strengthen control boundaries, and leave focus visible. `prefers-reduced-motion` should remove background drift, hover movement and material animation; a static backdrop is already a good default. [11][12][17]

### Values that work

| Property | Light value | Dark value | Why |
|---|---|---|---|
| Text contrast | ≥4.5:1 normal, ≥3:1 large | same | WCAG AA, assessed at worst visible position. |
| Essential control edge/state | ≥3:1 where edge conveys state | same | A decorative specular edge can remain subtle; functional edge cannot. |
| Long-text scrim | white `.78–.9` | graphite `.78–.9` | Stable reading plane. |
| Reduced transparency | solid `oklch(var(--b1))` | solid `oklch(var(--b1))` | Keeps theme semantics without blur. |
| More contrast | solid fills; explicit 2 px focus | solid fills; explicit 2 px focus | Avoid variable backdrop behind text. |

## 6. Chromium/Electron performance

`backdrop-filter` samples and filters pixels behind an element; its visual effect requires transparency. Work increases with sampled area, filter radius, changing content underneath, and overlapping filter regions. A large static pane can be cheaper in practice than many small blurred cards in a scrolling transcript; nested blur increases complexity and can make glass muddy. Blur radius interacts with sampled bounds, so `24px` is not a free stylistic increase over `12px`. This is a qualitative budget, **not a published universal per-pixel cost formula**. Chromium has documented reports of severe regressions for backdrop blur over video/animation and complex updates; those reports are case evidence, not a benchmark for Ptah. [2][18][19]

For Ptah, start with **at most the persistent shell/sidebar/composer and one transient overlay**, roughly 2–4 visible backdrop-filter planes at once. Use fill-only rows/cards inside the transcript and tables. Avoid an animated full-window mesh behind those planes. Never put `will-change: backdrop-filter` on every glass element: MDN warns that broad, persistent `will-change` can increase memory and rendering work. A desktop app with a fixed viewport can use a static photo or mesh; the expensive case is content moving behind the blur. [4][13][14]

Measure on the actual Electron build and a modest GPU: open DevTools Performance, record scroll in the longest conversation with modal/dropdown active, inspect paint flashing/layers, and compare blur on/off at the same scale. A **Ptah acceptance target**, not a Chromium guarantee: sustained 60 fps where target hardware permits, no obvious whole-window repaint during transcript scroll, and no major frame-time spike when opening a menu. If it fails, reduce blurred area first, then remove nested/animated backdrops, then reduce radius. [13][14]

### Values that work

| Property | Light value | Dark value | Why |
|---|---|---|---|
| Persistent blur | 12–18 px, 2–4 visible planes initial budget | same | Reviewable starting budget, to profile. |
| Overlay blur | 16–24 px, one open at a time | same | Transient, higher emphasis. |
| Scrolling rows | no blur | no blur | Avoid moving sampled regions. |
| `will-change` | `auto` | `auto` | Do not retain speculative layers. |
| Backdrop motion | static | static | Avoid repeated blur of changing pixels. |

## 7. One glass layer across DaisyUI v4 themes

The **v4.12.24 source contains exactly 32 named themes**. The current DaisyUI site shows 35; `abyss`, `caramellatte`, and `silk` are not in the v4.12.24 source and should not enter this matrix. DaisyUI theme variables provide semantic base/ink/accent roles; they do not encode a photograph, local light position, suitable alpha, or a theme's design intent. Therefore, use **one optical layer** and a **small explicit mode/backdrop override map**, not 32 copied theme definitions. [9][10]

Architecture: set `<html data-theme="nord" data-glass="on" data-glass-mode="light">` only for opted-in themes. The app's theme registry supplies `data-glass-mode`, because CSS cannot reliably branch on a computed `color-scheme` property. The glass layer consumes `oklch(var(--b1))`, `--b2`, `--b3`, `--bc`, and `--p` as DaisyUI v4 **channel** values; do not use v5's renamed `--color-base-100` tokens. Use `[data-glass-surface="chrome|content|overlay|tile"]` on selected elements, not global `.card` selectors. `chrome` may blur, `content` and `tile` are stable fills, `overlay` is opaque enough for reading. Make per-theme overrides only for `--glass-scene`, optional `--glass-tint`, `--glass-ink`, and rare radius/style choices. A theme can opt out by omitting `data-glass="on"`. [9][10]

Example override map: `cupcake/pastel/valentine` → pastel mesh; `nord/winter` → cool low-contrast landscape; `dracula/synthwave` → restrained purple/coral photo or blobs with neutral glass; `dark/dim/night` → charcoal smoke plus one localized glow; `coffee/retro` → warm photograph/amber field. For `black`, `lofi`, and `wireframe`, preserve their deliberate flat/high-contrast geometry by default. For `cyberpunk`, default opt-out because square neon brutality is the identity; an explicit opt-in can become a separate creative treatment, but is not the core Ptah glass. A suitable theme still requires screenshot contrast review; suitability is a visual judgment, not a property DaisyUI declares. [9]

### Values that work

| Property | Light value | Dark value | Why |
|---|---|---|---|
| DaisyUI base | `oklch(var(--b1))`; inner `--b2/--b3` | same | Preserves each theme's color system. |
| Ink/accent | `oklch(var(--bc))`, `oklch(var(--p))` | same | Theme text and focus/primary remain semantic. |
| Opt-in | `data-glass="on"` | same | No unwanted glass on flat themes. |
| Role | `chrome` blur; `content/tile` fill | same | Prevents blanket component blur. |
| Theme override count | backdrop + mode, occasional tint | same | One recipe, small curated exceptions. |

## 8 Critique of prototype C

The screenshot comparison is decisive: light shows milky cards over lavender/peach; dark shows blue/navy blocks with little visible transmission. The prototype has several sound decisions (static backdrop, existing reduced-transparency branch, restrained nested intent, clear focus outline), but these issues block the dark goal:

1. **Navy is embedded at every depth.** `glass/c/theme.config.js:14,44–53` sets lapis neutral and three navy bases. `glass/c/glass-layer.css:39–43,48` adds navy canvas/panels/overlay. **Fix:** set dark `base-100: #17191d`, `base-200: #202329`, `base-300: #2a2e35`, `neutral: #30343a`; use `--g-fill-1: rgb(205 211 220 / .16)`, raised `.23`, and overlay `rgb(31 34 40 / .82)`. Keep `--bc` near `#f2f2f1` and test muted ink. The primary gold can stay. [1][3]
2. **The dark panel fill hides the optical cue.** `glass/c/glass-layer.css:41–42` uses navy alpha `.66/.72`, so only a third of the background reaches the pane; `:48` uses `.86` for overlays. **Fix:** use neutral `.16–.23` for chrome, and reserve graphite `.78–.86` for menus/long text. Blur should then be visible on chrome. [2][4]
3. **Backdrop light misses the panels.** `glass/c/glass-layer.css:172–179` concentrates vivid blue/teal/gold at the viewport corners, while large panel centers sit over dark navy. **Fix:** use neutral base `#17191d`, add a muted `rgb(190 196 205 / .18)` field at `30% 34%` and warm `rgb(196 150 114 / .16)` at `75% 70%`; place one glow partly behind each major glass pane or use a dimmed photo. Reduce cobalt to `.18` if retained. [1][2]
4. **Saturation magnifies the blue backdrop.** `glass/c/glass-layer.css:28,221–222` sets `saturate(1.45)` for all blurred surfaces. **Fix:** dark `--g-sat: 1.16`; consider `brightness(1.08)` for chrome. Set light to `1.15` unless visual review favors its current strength. [2][4]
5. **The edge has no directional shape.** `glass/c/glass-layer.css:52–54,218–220` uses one uniform border plus a top inset line. **Fix:** retain a 1 px border but render a stronger top-left to weaker bottom-right gradient (`white/.38 → white/.06` dark) with a masked pseudo-element; inner top highlight `white/.24`. Keep the border gradient aligned across all shell panels. A flat 1 px stroke is less glass-like. [15]
6. **Heavy near-black shadows make panes look cut out.** `glass/c/glass-layer.css:57–58` sets `.75/.8` shadow alpha with broad spreads. **Fix:** `0 18px 46px -20px rgb(5 8 14 / .38), 0 2px 8px rgb(5 8 14 / .18)` for dark chrome; overlay can rise to `.5`. The light theme's tinted shadow at `:115–116` is a better model. [4]
7. **The blur rule catches nested cards before the nested rule.** `glass/c/glass-layer.css:212–246` applies `.card` globally, then attempts to cancel inside cards. The nested selector's `:where(...) .card .card` should win for straightforward card nesting, but other descendants such as `.surface-3` and arbitrary card wrappers can still be blurred; specificity/order and component overrides need visual verification. **Fix:** opt in only `[data-glass-surface="chrome"]`, `[data-glass-surface="overlay"]`; make `[data-glass-surface="tile"]` and transcript cards fill-only. Remove blanket `.card` and `.surface-3` blur. [1][4]
8. **Nested tint keeps the navy visual identity.** `glass/c/glass-layer.css:43–46,241–244` gives very low-opacity white tiles over already navy top-level fill, so the resulting tiles remain dark navy rather than visually frosted. **Fix:** use `rgb(255 255 255 / .07)` for a subtle dark nested tile, but surround it with neutral smoke chrome; for reading cards use `rgb(28 31 37 / .78)` instead of pretending all nested blocks are glass. [1][4]
9. **The entire app is forced into a two-theme implementation.** `glass/c/glass-layer.css:3–4,25,38,96` and `glass/c/theme.config.js:26,89` duplicate optical parameters within a bespoke theme pair. **Fix:** move optical properties to `[data-glass="on"]`, derive fill/ink/accent from v4 DaisyUI channels, and keep an override map for backdrop/mode. The brand theme pair can remain curated showcase presets. [9][10]
10. **Every selected/primary detail reinforces gold as decoration.** `glass/c/glass-layer.css:47,55,59–66,381–386,558–561` paints gold selected fill, border, text, glow, and button. Gold is a valid Ptah action accent, but repetition competes with material highlights. **Fix:** keep the primary CTA gold; use neutral selected tint `rgb(255 255 255 / .12)` and edge `white/.28` in dark, with a separate small gold indicator only where selection must be emphasized. [3][4]
11. **Reduced-transparency fallback retains the navy theme and lacks high-contrast branch.** `glass/c/glass-layer.css:810–845` correctly disables blur, but dark fallback remains lapis and there is no `prefers-contrast`/forced-colors treatment. **Fix:** use solid `oklch(var(--b1))` and theme ink, add `prefers-contrast: more` and `forced-colors: active`; remove noise/specular ornament in those modes. [11][12]
12. **The code/long text is deliberately opaque but contributes to the flat dark reading.** `glass/c/glass-layer.css:69–70,770–775` uses a nearly black code surface over navy. **Fix:** keep code opaque enough for readability, but lift its environment: neutral gray shell, graphite code `rgb(28 30 36 / .86)`, a restrained top edge, and no blue cast. Never trade code contrast for a clearer blur effect. [7]

## Recommended token set

This block is a **reference implementation**, not a tested drop-in patch. It assumes DaisyUI v4 theme variables are present on the same root, the app sets `data-glass-mode`, and only chosen elements receive `data-glass-surface`. The fallback branch is part of the recipe. Use `color-scheme` from the active DaisyUI theme for native controls. [9][10]

```css
:root[data-theme][data-glass='on'] {
  --glass-base: oklch(var(--b1));
  --glass-base-2: oklch(var(--b2));
  --glass-base-3: oklch(var(--b3));
  --glass-ink: oklch(var(--bc));
  --glass-accent: oklch(var(--p));
  --glass-blur: 16px;
  --glass-blur-overlay: 22px;
  --glass-saturation: 1.15;
  --glass-brightness: 1;
  --glass-radius: 22px;
  --glass-radius-inner: 14px;
  --glass-fill: rgb(255 255 255 / .58);
  --glass-fill-raised: rgb(255 255 255 / .72);
  --glass-fill-content: rgb(255 255 255 / .82);
  --glass-fill-overlay: rgb(255 255 255 / .88);
  --glass-fill-tile: color-mix(in srgb, var(--glass-base-2) 70%, transparent);
  --glass-edge-top: rgb(255 255 255 / .8);
  --glass-edge-bottom: rgb(255 255 255 / .18);
  --glass-inner-glint: rgb(255 255 255 / .8);
  --glass-shadow: 0 18px 44px -20px rgb(86 68 132 / .22);
  --glass-divider: color-mix(in srgb, var(--glass-ink) 12%, transparent);
  --glass-scene: radial-gradient(at 18% 10%, #cdbdf5, transparent 46%),
    radial-gradient(at 86% 78%, #ffd9bd, transparent 48%), #f1ecf6;
}
:root[data-theme][data-glass='on'][data-glass-mode='dark'] {
  --glass-saturation: 1.16;
  --glass-brightness: 1.08;
  --glass-fill: rgb(205 211 220 / .16);
  --glass-fill-raised: rgb(205 211 220 / .23);
  --glass-fill-content: rgb(28 31 37 / .80);
  --glass-fill-overlay: rgb(31 34 40 / .84);
  --glass-fill-tile: rgb(255 255 255 / .07);
  --glass-edge-top: rgb(255 255 255 / .38);
  --glass-edge-bottom: rgb(255 255 255 / .06);
  --glass-inner-glint: rgb(255 255 255 / .24);
  --glass-shadow: 0 18px 46px -20px rgb(5 8 14 / .38);
  --glass-divider: rgb(255 255 255 / .10);
  --glass-scene: radial-gradient(at 29% 33%, rgb(190 196 205 / .18), transparent 42%),
    radial-gradient(at 77% 73%, rgb(196 150 114 / .16), transparent 45%),
    linear-gradient(145deg, #25282e, #17191d 65%, #272a30);
}
:root[data-glass='on'] { background: var(--glass-scene); color: var(--glass-ink); }
:root[data-glass='on'] [data-glass-surface='chrome'],
:root[data-glass='on'] [data-glass-surface='overlay'] {
  position: relative;
  isolation: isolate;
  border-radius: var(--glass-radius);
  background: var(--glass-fill);
  border: 1px solid var(--glass-edge-bottom);
  box-shadow: inset 0 1px var(--glass-inner-glint), var(--glass-shadow);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation)) brightness(var(--glass-brightness));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation)) brightness(var(--glass-brightness));
}
/* The masked 1px rim is decorative; focus still needs its own solid outline. */
:root[data-glass='on'] [data-glass-surface='chrome']::before,
:root[data-glass='on'] [data-glass-surface='overlay']::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  pointer-events: none;
  background: linear-gradient(145deg, var(--glass-edge-top), var(--glass-edge-bottom) 70%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
}
:root[data-glass='on'] [data-glass-surface='overlay'] {
  background: var(--glass-fill-overlay);
  backdrop-filter: blur(var(--glass-blur-overlay)) saturate(var(--glass-saturation));
  -webkit-backdrop-filter: blur(var(--glass-blur-overlay)) saturate(var(--glass-saturation));
}
:root[data-glass='on'] [data-glass-surface='content'] {
  background: var(--glass-fill-content);
  border-radius: var(--glass-radius-inner);
  color: var(--glass-ink);
}
:root[data-glass='on'] [data-glass-surface='tile'] {
  background: var(--glass-fill-tile);
  border-radius: var(--glass-radius-inner);
  border: 1px solid var(--glass-edge-bottom);
}
:root[data-glass='on'] :focus-visible {
  outline: 2px solid var(--glass-accent);
  outline-offset: 2px;
}
@supports not (backdrop-filter: blur(1px)) {
  :root[data-glass='on'] [data-glass-surface] { background: var(--glass-base); }
}
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  :root[data-glass='on'] [data-glass-surface] {
    background: var(--glass-base);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
  :root[data-glass='on'] [data-glass-surface]::before { display: none; }
}
@media (forced-colors: active) {
  :root[data-glass='on'] [data-glass-surface] {
    background: Canvas;
    color: CanvasText;
    border: 1px solid CanvasText;
    box-shadow: none;
    backdrop-filter: none;
  }
  :root[data-glass='on'] :focus-visible { outline-color: Highlight; }
}
@media (prefers-reduced-motion: reduce) {
  :root[data-glass='on'] [data-glass-surface] { transition: none; animation: none; }
}
```

The root `--glass-scene` is a default. A host shell that paints its own opaque `background` must be made transparent **only within the glass opt-in**. Add a small curated `[data-theme='…'][data-glass='on']` map for scene overrides; do not duplicate the whole block. Check browser support and rendering of `mask-composite` in the pinned Electron version before using the decorative rim; a plain top inset highlight is a safe fallback. The `@supports` branch should check both prefixed/unprefixed support if Ptah ever targets non-Chromium engines. [2]

## DaisyUI theme matrix

Suitability is editorial: **ready** means optical style fits with a normal backdrop; **custom** means a carefully chosen photo/mesh is required; **opt out** preserves the stock theme's distinctive flat or high-contrast intent. The names are all 32 v4.12.24 themes. [9]

| Theme | Glass suitability | Backdrop | Notes |
|---|---|---|---|
| light | Ready | lavender/peach mesh | Neutral ink supports milky glass. |
| dark | Custom | charcoal smoke/photograph | Stock flat charcoal needs localized light. |
| cupcake | Ready | cream/pink mesh | Soft palette matches milk glass. |
| bumblebee | Custom | cream/amber mesh | Keep yellow away from small text. |
| emerald | Ready | sage/pearl mesh | Cool green accent, neutral face. |
| corporate | Custom | blue-gray architectural photo | Stock compact radii need 18–22 px glass shell override. |
| synthwave | Custom | restrained violet/coral night photo | Keep neon in backdrop, not borders. |
| retro | Custom | warm paper/interior photo | Preserve warm tone; avoid shiny chrome excess. |
| cyberpunk | Opt out | none by default | Square neon geometry conflicts with core glass. |
| valentine | Ready | pink/peach mesh | Watch pink text contrast. |
| halloween | Custom | smoky charcoal/orange glow | Avoid orange outline everywhere. |
| garden | Ready | muted foliage/cream | Organic scene fits. |
| forest | Custom | dim forest photo | Lift neutral panes over dark green. |
| aqua | Custom | aquatic photo/teal field | Prevent blue-on-blue flattening. |
| lofi | Opt out | none | Deliberately austere flat contrast. |
| pastel | Ready | lavender/peach mesh | Close to successful Ptah light reference. |
| fantasy | Ready | pearl/purple mesh | Keep primary accent restrained. |
| wireframe | Opt out | none | Wireframe outline language is incompatible. |
| black | Opt out | none | Pure black/square high-contrast identity. |
| luxury | Custom | low-key warm photo | Gold/black needs restrained smoke and careful ink. |
| dracula | Custom | muted plum/coral scene | Neutral gray face avoids purple slab effect. |
| cmyk | Custom | mostly neutral photo with one CMYK light | Multiple strong accents can overwhelm material. |
| autumn | Ready | ochre/peach landscape | Warm smoke works. |
| business | Custom | gray architectural photo | Conservative chrome; test text density. |
| acid | Custom | pale lime/stone mesh | Saturation down; text scrims essential. |
| lemonade | Ready | pale yellow/cream mesh | Milky material, dark ink. |
| night | Custom | graphite with amber/steel light | Avoid stock dark slab. |
| coffee | Custom | café/interior photo, warm charcoal | Sepia smoke, neutral faces. |
| winter | Ready | ice-blue/pearl mesh | Easy cool milk-glass pairing. |
| dim | Custom | dark gray/plum scene | Requires visible light behind each pane. |
| nord | Ready | foggy mountain/cool mesh | Low-chroma scene and cool smoke. |
| sunset | Custom | dusk photo, charcoal foreground | Warm gradients need text scrims. |

## Sources

All accessed **2026-10-21**. Versioned source [9] is the authority for the Ptah theme list; newer DaisyUI documentation is not used to count v4 themes.

1. Apple, [Human Interface Guidelines: Materials](https://developer.apple.com/design/human-interface-guidelines/materials). Liquid Glass roles, variants, 35% dimming example, visionOS adaptation/vibrancy.
2. MDN, [`backdrop-filter`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter). Transparent background requirement and filter semantics.
3. Apple, [Human Interface Guidelines: Color](https://developer.apple.com/design/human-interface-guidelines/color). Adaptive appearance and sparing color on Liquid Glass.
4. Microsoft, [Acrylic material](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic). Optical recipe, layering, legibility, performance and solid fallback.
5. UX Pilot, [12 Glassmorphism UI Features, Best Practices, and Examples](https://uxpilot.ai/blogs/glassmorphism-ui), published 2025-11-25. Secondary design reference.
6. Microsoft, [Materials in Windows](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/materials). Mica/Acrylic/Smoke roles.
7. W3C, [WCAG 2.2: Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Text thresholds.
8. W3C, [WCAG 2.2: Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). Control/state thresholds and least-contrasting gradient regions.
9. DaisyUI, [v4.12.24 theme source](https://raw.githubusercontent.com/saadeghi/daisyui/v4.12.24/src/theming/themes.js). Exact 32 stock theme names and color-scheme/radius values.
10. DaisyUI, [v4 themes documentation](https://v4.daisyui.com/docs/themes/). User-supplied v4 documentation URL; unavailable to the browsing tool during this research. Token use corroborated by Ptah's v4 prototype config and v4 package source; verify compiled channel output in Ptah before integration.
11. MDN, [`prefers-reduced-transparency`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-transparency). Limited-availability system preference.
12. MDN, [`prefers-contrast`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-contrast). Contrast preference semantics.
13. MDN, [`will-change`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/will-change). Memory and rendering cost of overuse.
14. Chrome for Developers, [Identify rendering performance issues](https://developer.chrome.com/docs/devtools/rendering/performance). Paint flashing and layer-border inspection.
15. Apple, [Human Interface Guidelines: App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons). Specular highlights, refraction and translucency of Liquid Glass icons.
16. Microsoft, [In-app acrylic](https://learn.microsoft.com/en-us/windows/apps/develop/ui/in-app-acrylic). Tint, luminosity opacity and fallback knobs.
17. MDN, [`prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion). Motion preference.
18. Chromium issue tracker, [Backdrop blur and complex dynamic content](https://issues.chromium.org/issues/484692946), 2026 report. A reported regression, not a universal benchmark.
19. Chromium issue tracker, [`dialog` backdrop-filter performance report](https://issues.chromium.org/issues/495538197), 2026 report. A reported regression, not a universal benchmark.

## Decisions

- Keep the successful light material direction and Ptah gold primary action.
- Rebuild dark on neutral smoke/light transmission; begin with the specific values in section 8, then tune against the supplied smoky-photo reference.
- Implement one opt-in glass layer by surface role across DaisyUI v4, with a small backdrop/mode map; do not generate 32 copied theme variants.
- Default `black`, `lofi`, `wireframe`, and `cyberpunk` to their stock visual language.
- Treat code/transcript reading regions as stable surfaces, and true blur as a selective chrome/overlay treatment.

## Open questions

1. Which dark backdrop should be the product default: licensed photo, static neutral mesh, or user wallpaper? This determines exact tint/contrast tuning.
2. Which theme picker entries should expose glass opt-in? The matrix gives visual suitability, but product preference and maintenance cost determine the shipped subset.
3. What are the actual worst-case contrast and frame-time results in Ptah's pinned Electron/Chromium build on target hardware? The supplied screenshots and CSS do not provide those measurements.
4. Does the pinned Electron version render the masked gradient rim consistently at different scale factors? Fall back to a simple inset top highlight if it does not.
