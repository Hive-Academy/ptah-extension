# Brand Config and Capture Runtimes

## Part A — Branding

### Current state (verified in source, as of this writing)

There is **no `brand.config.ts` yet**. Brand values are hardcoded across four
files in `apps/ptah-video-studio/src/`:

| File                       | Hardcoded value                                                                                   | What it renders                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `theme.ts`                 | `THEME = { bg, bgDeep, bgGlow, amber, amberDeep, indigo, textStrong, textSoft, textFaint, font }` | Colors + font stack, imported by `DeviceFrame.tsx`, `OutroCard.tsx`, `Watermark.tsx` (indirectly) |
| `components/Watermark.tsx` | Literal text `PTAH`                                                                               | Corner watermark                                                                                  |
| `components/OutroCard.tsx` | `tagline` prop default `'ptah.live'`; literal text `Get Ptah free` (not a prop)                   | Outro tagline + CTA pill                                                                          |
| `ShowcaseVideo.tsx`        | Literal `'Ptah'` passed as `IntroCard`'s `subtitle` when no `introCopy` override is given         | Intro card subtitle                                                                               |

Current values (read from `theme.ts`, `Watermark.tsx`, `OutroCard.tsx`,
`ShowcaseVideo.tsx`):

```
bg:      #05060c
amber:   #f5b544
indigo:  #4f6bed
font:    Inter, "Segoe UI", system-ui, -apple-system, sans-serif
wordmark:    PTAH
tagline:     ptah.live
ctaLabel:    Get Ptah free
productName: Ptah
```

### Planned target: `brand.config.ts`

The skill's design consolidates all of the above into one file,
`apps/<studio>/src/brand.config.ts`, exporting a single `BRAND` object:

```ts
export const BRAND = {
  wordmark: 'PTAH', // corner watermark string
  productName: 'Ptah', // default intro subtitle
  tagline: 'ptah.live', // outro tagline / domain
  ctaLabel: 'Get Ptah free', // outro CTA button text
  theme: {
    bg: '#05060c',
    bgDeep: '#0a0f1e',
    bgGlow: '#10203f',
    amber: '#f5b544',
    amberDeep: '#f59e0b',
    indigo: '#4f6bed',
    textStrong: '#ffffff',
    textSoft: 'rgba(255,255,255,0.72)',
    textFaint: 'rgba(255,255,255,0.45)',
    font: 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif',
  },
} as const;
```

| `BRAND` field | Consumed by                                    | Replaces                                                                         |
| ------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `wordmark`    | `Watermark.tsx`                                | The literal `PTAH` text node                                                     |
| `tagline`     | `OutroCard.tsx`                                | The `tagline` prop's default `'ptah.live'`                                       |
| `ctaLabel`    | `OutroCard.tsx`                                | The literal `Get Ptah free` text node (today NOT a prop — must be lifted to one) |
| `productName` | `ShowcaseVideo.tsx`                            | The literal `'Ptah'` subtitle fallback                                           |
| `theme`       | `theme.ts` re-exports `BRAND.theme` as `THEME` | The entire hand-written `THEME` object                                           |

Once this exists, **`brand.config.ts` is the only file that needs editing to
re-skin the pipeline for a different product** — every consumer above reads
through `BRAND`/`THEME`, never a literal. When implementing this migration:
`OutroCard.tsx`'s CTA text must be lifted from a hardcoded JSX child into a
prop (it currently has no `ctaLabel` prop at all — `copy`/`tagline` are the
only two), and `theme.ts` becomes a thin re-export (`export const THEME =
BRAND.theme;`) rather than the source of the color object.

## Part B — Capture Runtimes

Two Playwright fixture files provide the SAME `Director`/`page` API to a scene
but launch fundamentally different targets. A scene picks one by which fixture
module it imports:

```ts
import { test } from './_harness/showcase-fixtures'; // ELECTRON
// -- or --
import { test } from './_harness/browser-fixtures'; // WEB
```

### ELECTRON — `showcase-launcher.ts` + `showcase-fixtures.ts`

- `launchShowcase()` calls `_electron.launch()` against a **built dist**:
  `resolveElectronEntry()` resolves
  `dist/apps/ptah-electron/main.mjs` (five `path.resolve('..', ...)` hops up
  from `_harness/`). Throws with a clear message (pointing at `nx run
ptah-electron-e2e:showcase`) if that file is missing.
- Sets `NODE_ENV=development` (so the app resolves local-dev API URLs, same as
  `nx serve ptah-electron`) and `PTAH_NO_DEVTOOLS=1` (suppresses the DevTools
  popup that would otherwise land in frame).
- **Reuses the persistent user-data dir** (no fresh `mkdtemp`) so auth/provider
  keys already set up via `nx serve` carry over. Override with
  `PTAH_SHOWCASE_USER_DATA_DIR` for a dedicated profile.
- The app holds a **single-instance lock** — quit any running `nx serve
ptah-electron` before capturing, or the launch exits immediately.
- Does deterministic window placement math (enumerate displays, pick the
  best-fitting scale factor, `setContentSize`) so the on-screen capture region
  matches the requested resolution 1:1, then measures the actual CSS viewport
  and returns it as `res` — this is the coordinate space the Director
  normalizes shot rects against, NOT the requested resolution.
- Use when: filming the real desktop product against live local
  services/agents.

### WEB — `browser-fixtures.ts`

- Launches a **fresh headless Chromium context** via `chromium.launch()` +
  `browser.newContext({ viewport, recordVideo, deviceScaleFactor: 1 })` — no
  Electron, no local backend, no auth.
- Films a **public web page** (a live site or dev server) via `page.goto(url)`
  inside the scene body — see `landing-page-tour.scene.ts`'s
  `SITE_URL = process.env['PTAH_SHOWCASE_LANDING_URL'] ?? 'https://ptah.live'`.
- Passes a **typed placeholder** (`null as unknown as ElectronApplication`)
  as the Director's `app` constructor param — safe because `Director` never
  dereferences `this.app` anywhere in `director.ts`; it drives everything
  through `page`. This is how one `Director` class serves both runtimes
  unmodified.
- Default capture resolution **1440p** (2560×1440, not 1080p) — the docstring
  rationale: a marketing landing page reads as a premium full-bleed canvas at
  that width, and the extra pixels keep camera punch-ins crisp after
  `render-all --out-res 1080p` supersamples down. Override with
  `PTAH_SHOWCASE_RES`.
- `reducedMotion: 'no-preference'` — deliberately keeps the site's own
  entrance/scroll CSS animations active on camera.
- Use when: filming a marketing site / any web app that doesn't need a local
  authenticated backend.

Both fixtures write to the identical `RECORDINGS_ROOT` structure
(`dist/apps/ptah-electron-e2e/recordings/<slug>/`) and rename Playwright's
random `.webm` to `raw.webm` in teardown, so `render-all.mjs` and the rest of
the render half never need to know which runtime produced the footage.

### The one hardcoded coupling to generalize per target

| File                                              | Coupling                                                                                                                                                                                                                                   | Fix when porting                                                                                                                                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `showcase-launcher.ts` → `resolveElectronEntry()` | Hardcoded relative path ending in `dist/apps/ptah-electron/main.mjs` — the **project name** `ptah-electron` is baked into the path, not parameterized.                                                                                     | Change the literal path segments to your target Electron app's build output (`dist/apps/<your-electron-app>/main.mjs`), or thread it through an env var / `ShowcaseLaunchOptions` field if multiple apps must reuse the same launcher. |
| `browser-fixtures.ts` / scene files               | `SITE_URL` / base URL is a **per-scene** env-overridable constant (`PTAH_SHOWCASE_LANDING_URL` in `landing-page-tour.scene.ts`), not a harness-level setting — every web scene that needs a different target defines its own env var name. | Decide whether to keep this per-scene pattern or centralize a single `PTAH_SHOWCASE_BASE_URL` in the harness; nothing in `browser-fixtures.ts` itself assumes a specific site — the coupling lives in scene bodies, not the fixture.   |

Everything else in both fixture files (recordings root resolution, script/
duration loading, `raw.webm` renaming, Director construction) is already
generic and needs no changes beyond the package-alias rename covered in
`install.md`.
