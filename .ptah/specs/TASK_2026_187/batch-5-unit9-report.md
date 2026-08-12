# Batch 5 / Unit 9 report — split the daisyUI themes out of `styles.css`

**Status**: COMPLETE, not committed. Unit 7 and Unit 8 untouched (out of scope, per the brief).
**Headline**: initial total **2,536,716 B → 2,512,563 B (−24,153 B)**; transfer **523.59 → 518.46 kB**.
**2,500,000 B target: NOT MET. Exact remaining shortfall: 12,563 B.**

---

## 0. THE HEADLINE FINDING — the premise behind Unit 9 was wrong by an order of magnitude

`tasks.md:1079` and the brief both frame Unit 9 as attacking a **276,070 B** item and warn _"the available
headroom looks far larger than 36,716 B — do not convert that into a number until you have built it."_

Correct instinct, but the number went the **other** way. The 32 prebuilt themes are **not** most of
`styles.css`. They are **25,164 bytes** of it — 9.1%. The other 250,906 B is Tailwind base + utilities +
the daisyUI _component_ layer + `prism-tomorrow.css`, none of which is per-theme and none of which this
unit touches.

Measured two independent ways, agreeing exactly:

| Method                                                                                                            |                                               Result |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------: |
| Static: brace-match every rule in the built `styles.css` whose selector list is entirely prebuilt-theme selectors |             **25,164 B** across exactly **32** rules |
| Empirical: remove the 32 names from `tailwind.config.js`, rebuild                                                 | `styles.css` **276,070 → 250,906 B** = **−25,164 B** |

Per-theme it is ~786 B raw (min `bumblebee` 629 B, max `dracula` 901 B). daisyUI v4 emits a theme as one
flat block of ~30 CSS custom properties and nothing else; `styled: true` emits the component classes
**once**, not per theme. That is the whole reason the ceiling is 25 kB.

**So Unit 9 could never have closed 36,716 B, and it did not.** It bought 24,153 B net.
**Remaining shortfall: 12,563 B.**

Per Task 5.1 (`tasks.md:1141`) I have **STOPPED**: no fourth lever improvised, no launch surface deferred,
no budget raised, `libs/shared`/`zod` untouched. Whether to keep this change, and what to do about the
12,563 B, is a decision for the user — see §9.

---

## 1. Mechanism, and why this one

### 1a. Emitting the sheet — `@angular/build` `styles` entry, `inject: false`

**Verified in this workspace, not assumed.** `apps/ptah-extension-webview/project.json`:

```diff
         "styles": [
           "apps/ptah-extension-webview/src/styles.css",
-          "node_modules/prismjs/themes/prism-tomorrow.css"
+          "node_modules/prismjs/themes/prism-tomorrow.css",
+          {
+            "input": "node_modules/daisyui/dist/themes.css",
+            "bundleName": "theme-extra",
+            "inject": false
+          }
         ],
```

Two properties had to hold, and both were confirmed by build output:

1. **It is not counted as initial.** `theme-extra.css` appears under **`Lazy chunk files`** in Angular's
   own table (52.97 kB raw / 6.06 kB transfer). This was the make-or-break unknown — if a non-injected
   style bundle had still been tagged `initial`, the entire approach would have been worth zero.
2. **It is not linked from `index.html`.** Confirmed per-file in §5.

`outputHashing` is `none` in the production configuration, so the emitted name is the stable
`theme-extra.css` — which matters, because `index.html` references it by that name.

### 1b. Where the 32 themes come from — `daisyui/dist/themes.css`, not a second Tailwind config

The brief suggested _"a second Tailwind/daisyUI config that emits only the 32 prebuilt themes"_.
**I did not do that, and the reason is a real constraint rather than a preference**: `@angular/build`
resolves **one** Tailwind configuration per build (searched from the project root, then the workspace
root) and applies it to every entry in the `styles` array. There is no per-file config hook. A second
`@tailwind`-bearing entry file would therefore be compiled with the _same_ config and duplicate the
entire base + utilities + component layer into the second sheet — hundreds of kB of duplication, for
nothing.

`node_modules/daisyui/dist/themes.css` is the better answer and required no new source file:

- It contains **exactly** the 32 names, verified programmatically against the list removed from the
  config — `light … sunset`, 32/32, no extras, no omissions.
- It is the **same package** (`daisyui@4.12.24`) the plugin compiles from, so it cannot drift from the
  themes the picker offers when daisyUI is upgraded. A hand-generated committed artifact could.
- It has no `@tailwind` directives, so Tailwind's PostCSS pass is a no-op on it; Angular just minifies it.

**One caveat, checked rather than waved away.** `dist/themes.css` opens with two `:root` blocks (the
`light` theme, and a `dark` one inside `@media (prefers-color-scheme: dark)`) before any
`[data-theme=…]` block. Measured offsets in the built file: `:root` at 0, the media block at 684, the
first `[data-theme=…]` at **1428**, `[data-theme=dracula]` at 32356. `:root` and `[data-theme=x]` have
**equal specificity** (0,1,0) and both match `<html>`, so source order decides and the theme block —
always later in the file — always wins. The sheet also only ever loads for a user who is on one of the
32, and the loader validates the name against that list first, so there is no reachable state in which
those `:root` blocks are the winning declaration.

### 1c. Keeping the two custom themes eager

`apps/ptah-extension-webview/tailwind.config.js` — the `anubis` / `anubis-light` objects at `:48-156`
are **unchanged**; only the 32 string entries at `:158-189` were removed, replaced by a comment that
states where they went and what re-adding one costs.

```diff
       },
-      // DaisyUI v4 prebuilt themes
-      'light',
-      'dark',
-      … 30 more …
-      'sunset',
+      // The 32 daisyUI v4 prebuilt themes are DELIBERATELY ABSENT here.
+      //
+      // They are NOT deleted — `DAISYUI_THEMES` … still exposes all 34 themes
+      // in the picker and they all still work. They are compiled into a
+      // SEPARATE, non-injected stylesheet (`theme-extra.css` …) fetched only
+      // by users whose persisted theme is one of those 32.
     ],
     darkTheme: 'anubis',
```

**Nothing was deleted.** `ThemeName` (34 members) and `DAISYUI_THEMES` (34 entries) are byte-for-byte
unchanged. The picker still offers all 34.

---

## 2. Files changed

**Modified**

- `apps/ptah-extension-webview/project.json` — the `styles` entry above (§1a)
- `apps/ptah-extension-webview/tailwind.config.js` — 32 theme names removed (§1c)
- `apps/ptah-extension-webview/src/index.html` — the pre-paint loader (§4)
- `libs/frontend/core/src/lib/services/theme.service.ts` — localStorage mirror + runtime sheet loader
- `libs/frontend/core/src/lib/services/theme.service.spec.ts` — +8 tests

**Created**

- `apps/ptah-extension-webview/src/app/theme-boot-lists.spec.ts` — +5 tests; the sync gate between
  `index.html`'s hard-coded name lists and `DAISYUI_THEMES`

**Deliberately NOT changed**

- `ThemeName`, `DAISYUI_THEMES`, the picker (`chat-ui/…/theme-toggle.component.ts`)
- `project.json:61` `maximumError` — that is Unit 8, mandatory-last, not mine
- `message-bubble.component.css` — that is Unit 7, not mine
- The I-8 DO-NOT-TOUCH list — all six paths verified clean. TASK_2026_196 not touched.
- No extension-host or Electron-main file. The change is entirely inside the webview artifact, which is
  why it needs no coordinated host change (see §4b).

---

## 3. Measurement

### 3a. BEFORE — my own baseline (`--skip-nx-cache`, 2026-08-09T21:26:14Z)

| File                |       Raw (B) |      Transfer |
| ------------------- | ------------: | ------------: |
| `chunk-3AJTUKQV.js` |       643,865 |     138.21 kB |
| `chunk-GSXVN24C.js` |       636,224 |     119.66 kB |
| `styles.css`        |       276,070 |      34.60 kB |
| `chunk-UWKWCTKO.js` |       223,137 |      43.00 kB |
| `main.js`           |       186,827 |      44.09 kB |
| `chunk-OW4MB5WX.js` |       146,813 |      36.19 kB |
| `chunk-7V2KZ4E5.js` |       109,959 |      20.63 kB |
| `chunk-CTJANIJZ.js` |        89,863 |      22.20 kB |
| `scripts.js`        |        48,202 |      14.01 kB |
| `chunk-3RGT2QIX.js` |        39,700 |       8.42 kB |
| `polyfills.js`      |        35,726 |      11.58 kB |
| `chunk-SULELTWL.js` |        30,767 |      10.68 kB |
| `chunk-B63YIMHG.js` |        18,423 |       6.54 kB |
| `chunk-LJZR7JKA.js` |        17,463 |       5.18 kB |
| `chunk-S62IZLL7.js` |        16,400 |       3.70 kB |
| `chunk-PSKPQPYR.js` |        15,737 |       4.13 kB |
| `chunk-6F4HVVOU.js` |         1,378 |         601 B |
| `chunk-LW5LSEOG.js` |           162 |         162 B |
| `chunk-JXTWWDFB.js` |             0 |           0 B |
| **Initial total**   | **2,536,716** | **523.59 kB** |

Lazy total 1,116,437 B. Angular's budget line: _"not met by 36.72 kB"_ → 2,500,000 + 36,716 = 2,536,716.
**Byte-identical to Batch 4's closing number** — see §6.

### 3b. AFTER — initial

| File                |       Raw (B) |      Transfer |
| ------------------- | ------------: | ------------: |
| `chunk-AIEQYFRF.js` |       644,876 |     138.51 kB |
| `chunk-ACY4UYIB.js` |       636,224 |     119.67 kB |
| `styles.css`        |   **250,906** |  **29.06 kB** |
| `chunk-AMPZFQWW.js` |       223,137 |      43.00 kB |
| `main.js`           |       186,827 |      44.18 kB |
| `chunk-OPFTZMGU.js` |       146,813 |      36.22 kB |
| `chunk-6G5MWHGZ.js` |       109,959 |      20.63 kB |
| `chunk-NP352ZVP.js` |        89,863 |      22.21 kB |
| `scripts.js`        |        48,202 |      14.01 kB |
| `chunk-7CPQFQGC.js` |        39,700 |       8.42 kB |
| `polyfills.js`      |        35,726 |      11.58 kB |
| `chunk-JGWJML63.js` |        30,767 |      10.66 kB |
| `chunk-3GFS4WA3.js` |        18,423 |       6.54 kB |
| `chunk-XUYPGHFV.js` |        17,463 |       5.18 kB |
| `chunk-YMNF6BG7.js` |        16,400 |       3.69 kB |
| `chunk-OIUUV46U.js` |        15,737 |       4.13 kB |
| `chunk-6F4HVVOU.js` |         1,378 |         601 B |
| `chunk-U2HVU2WB.js` |           162 |         162 B |
| `chunk-JXTWWDFB.js` |             0 |           0 B |
| **Initial total**   | **2,512,563** | **518.46 kB** |

Summed filesystem bytes = 2,512,563. Angular's budget line: _"not met by 12.56 kB with a total of
2.51 MB"_ → consistent to the byte (12,563 renders as 12.56 kB).

### 3c. AFTER — lazy

| File                  |       Raw (B) |    Transfer | Identity                                 |
| --------------------- | ------------: | ----------: | ---------------------------------------- |
| `chunk-73OXYZKH.js`   |       539,414 |   101.17 kB | editor (Batch 1)                         |
| `chunk-W6GH4KXG.js`   |       302,548 |    57.80 kB | Thoth group (Batch 3)                    |
| `chunk-AETDKYZ7.js`   |       122,867 |    26.68 kB | tasks-ui board (Batch 4)                 |
| **`theme-extra.css`** |    **52,973** | **6.06 kB** | **NEW — the 32 prebuilt daisyUI themes** |
| `chunk-LD2FKMVQ.js`   |        52,230 |    11.25 kB | marketplace                              |
| `chunk-4NCTP566.js`   |        46,253 |    11.67 kB | tribunal                                 |
| `chunk-N3RTYSRE.js`   |        41,190 |     9.52 kB | harness-builder + setup-hub              |
| `chunk-HG3P62SC.js`   |         6,599 |     2.29 kB |                                          |
| `chunk-GMUVK3YH.js`   |         5,000 |     1.77 kB |                                          |
| `chunk-C54KNAKT.js`   |           336 |       336 B |                                          |
| **Lazy total**        | **1,169,410** |             |                                          |

### 3d. Delta, and where every byte went

| Metric                             |      Before |           After |                                        Δ |
| ---------------------------------- | ----------: | --------------: | ---------------------------------------: |
| **Initial total (raw)**            | 2,536,716 B | **2,512,563 B** |                            **−24,153 B** |
| **Initial total (transfer)**       |   523.59 kB |   **518.46 kB** |                             **−5.13 kB** |
| `styles.css` (raw)                 |   276,070 B |       250,906 B |                            **−25,164 B** |
| `styles.css` (transfer)            |    34.60 kB |        29.06 kB |                                 −5.54 kB |
| core chunk (`3AJTUKQV`→`AIEQYFRF`) |   643,865 B |       644,876 B | **+1,011 B** (the `ThemeService` loader) |
| `main.js` (raw)                    |   186,827 B |       186,827 B |                                    **0** |
| Lazy total (raw)                   | 1,116,437 B |     1,169,410 B |                                +52,973 B |
| **Gap to 2,500,000 B**             |      36,716 |      **12,563** |                                  −24,153 |

−25,164 (themes out) + 1,011 (loader in) = **−24,153**. Nothing else moved.

**Expected vs actual.** `tasks.md:1079` labels the expectation **UNMEASURED** and forbids predicting it.
I measured it _before_ predicting, in both directions (static scan then empirical build), and the two
agreed at 25,164 B. **Actual −24,153 B net. The lever is ~3× too small for the gap it was chosen to
close.**

### 3e. I-4 — `main.js`

|        |       Raw | Transfer |
| ------ | --------: | -------: |
| Before | 186,827 B | 44.09 kB |
| After  | 186,827 B | 44.18 kB |

**Raw byte-identical.** The +0.09 kB transfer is gzip-estimate noise from renamed chunk specifiers of
identical length (`chunk-GSXVN24C` → `chunk-ACY4UYIB`); the file content is otherwise unchanged.
Against the I-4 baseline of **353.23 kB** there is no question here. **I-4 satisfied.**

### 3f. Build determinism

Built four times (baseline, probe, final, confirmation). The final two produced identical hashes and
byte sizes.

---

## 4. THE NO-FLASH ANALYSIS

This is the section the change lives or dies on. Property targets from `tasks.md:1125-1128`.

### 4a. The load-bearing fact, verified rather than assumed

`tasks.md:1123` calls the synchronous readability of the persisted theme _"the single load-bearing fact
in this task"_ and tells me to verify it myself. I did, **and it is only half true.**

| Host                | `window.vscode.getState()` readable in `<head>`? | Evidence                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Electron**        | **YES**                                          | `apps/ptah-electron/src/preload.ts:23-33` exposes `vscode.getState` via `contextBridge`, backed by `ipcRenderer.sendSync('get-state')`. Preload runs before any document script.                                                                                                                                                                                                         |
| **VS Code webview** | **NO**                                           | `apps/ptah-extension-vscode/src/services/webview-html-generator.ts:164-173` injects `const vscode = acquireVsCodeApi(); window.vscode = vscode;` by replacing **`</body>`**. At `<head>` parse time `window.vscode` does not exist. Calling `acquireVsCodeApi()` myself in `<head>` is not an option — it may be called **once** per webview, and the host's own later call would throw. |

**That asymmetry is the central design constraint of this unit and it is not stated anywhere in the
plan.** Everything below follows from it.

### 4b. What I built

**`localStorage` is the pre-paint hint; `vscode.getState('theme')` stays authoritative.** `localStorage`
is synchronously readable in `<head>` in _both_ hosts, and it is already proven to work in both here —
`app-state.service.ts:330,475` persists `ptah-layout-mode` through it. `ThemeService.setTheme` now
mirrors the theme to `localStorage['ptah-theme']` on every call; the persisted VS Code state is
unchanged and remains the source of truth.

`index.html` gained two things in `<head>`:

```html
<link id="ptah-theme-extra" rel="ptah-deferred-stylesheet" href="theme-extra.css" />
```

An inert URL carrier. `rel` is deliberately an unknown token — no browser fetches a link whose `rel` it
does not recognise, so a default-theme user pays nothing for it. Its only job is to let the **host**
resolve the URL: the VS Code generator rewrites every `href` in the document to a `vscode-resource:`
URI (`webview-html-generator.ts:174-196`), and Electron's `copy-renderer.js` rewrites `<base href="/">`
to `"./"` for the `file:` origin. Reading `marker.href` yields a correct absolute URL in both hosts
**without this document, or `ThemeService`, ever constructing one.** That is what makes the change
host-agnostic and removes any need to touch the extension host or the Electron main process.

Then a classic inline script (runs at parse time, before `styles.css` finishes loading):

1. Read `window.vscode.getState().theme` — Electron.
2. Else read `localStorage['ptah-theme']` — both hosts, and the only source in VS Code.
3. Nothing, or an unrecognised value → **return**. `<html data-theme="anubis">` stands, nothing is fetched.
4. `anubis` / `anubis-light` → write `data-theme` + `data-theme-mode`, **return**. Nothing is fetched.
5. One of the 32 → write `data-theme` + `data-theme-mode`, then create
   `<link rel="stylesheet" blocking="render">` pointing at `marker.href` and append it to `<head>`.

Step 5 is the guarantee. A stylesheet appended to `<head>` while the parser is still running is
render-blocking; `blocking="render"` (Chromium 105+, and both hosts are far past that) states it
explicitly rather than relying on that behaviour. The first painted frame therefore already carries the
user's theme **and** the CSS that defines it.

### 4c. The three required properties

**1. Non-default-theme user: correct theme on the first painted frame — and this is a strict improvement
over today.**

Worth stating plainly: **the flash this unit is required not to introduce already exists on `main`.**
Today `index.html` hard-codes `<html data-theme="anubis">` and the FOUC script guarding it reads
`window.ptahConfig.savedTheme` — a property **nothing in this repository ever sets** (repo-wide grep:
the only non-`node_modules` hits are the three lines of that dead script itself). So today, _every_
launch for a `dracula` user paints `anubis` and then flips when `ThemeService`'s effect runs. After this
change that is fixed for those users, permanently in Electron and after the first launch in VS Code.

**2. Default-theme user never fetches the sheet.** Structural: the script returns at step 3 or 4 without
touching the marker, and the marker itself is non-fetching. Nothing else in the document references
`theme-extra.css`. `theme-boot-lists.spec.ts` asserts the marker never carries
`rel="stylesheet"`/`"preload"`. **But the brief requires this be proven by observation, not by reading
the code — that is human-gate item H2 (§10).**

**3. All 34 themes still work from the picker.** `ThemeName` and `DAISYUI_THEMES` are unchanged.
`setTheme` loads the sheet on demand for the 32 — see §4e.

### 4d. The edge cases the brief named, handled explicitly

| Edge case                                                                                                       | What happens                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`getState` returns `undefined` when `window.vscode` is absent** (`vscode.service.ts:214-217`)                 | This is the _normal_ VS Code `<head>` case, not an error case. Step 1 is guarded by a `typeof … === 'function'` check inside a `try`, falls through to `localStorage`, and if that is empty too the script returns having changed nothing and fetched nothing — i.e. it degrades to exactly today's behaviour. It is never a throw and never a stuck state.                                                               |
| **VS Code theme-kind mapping at first launch — can it ever select a non-Anubis theme with no persisted state?** | **No, and this is a clean structural answer.** `theme.service.ts:171-174` maps only `config().theme === 'light'` → **`anubis-light`**. That is one of the two themes still in `styles.css`. **The theme-kind path can never select a theme that needs the deferred sheet**, so no first-launch user ever fetches it.                                                                                                      |
| **The `data-theme-mode` marker written alongside `data-theme` (`:143-153`)**                                    | The pre-paint script writes **both**, using the same dark/light classification. Today `data-theme-mode` is absent until Angular boots, so brand tokens keyed on it are unset for the whole pre-bootstrap window. This is a small improvement, not a regression. The dark list is duplicated into the inline script (it cannot import), which is why `theme-boot-lists.spec.ts` exists — it fails if the two ever diverge. |
| **Persisted value is garbage / a theme removed in a future daisyUI**                                            | Validated against the 32-name list _before_ the sheet is fetched. Unknown → return, default `anubis` stands, no fetch.                                                                                                                                                                                                                                                                                                    |
| **`localStorage` unavailable** (disabled, quota, partitioned)                                                   | Both the read and the write are in `try`/`catch`. Cost of failure is one frame of `anubis` on the next launch — today's behaviour.                                                                                                                                                                                                                                                                                        |
| **The sheet 404s or fails to load**                                                                             | The `error` listener resolves the same promise as `load`, so the picker is never stranded on the old theme; the user gets `:root` (anubis) variables under a `dracula` label. Covered by a unit test.                                                                                                                                                                                                                     |

**The one honest gap, stated rather than buried.** On the **first VS Code launch after this ships**, an
existing user on one of the 32 has no `localStorage` mirror yet — the pre-paint script cannot see their
theme, so they get one more `anubis` frame. `initializeTheme` now re-arms the mirror from the
authoritative `vscode.getState('theme')` on every construction, so it happens **once** and never again.
Electron users never hit it at all (`getState` works in `<head>` there). Net: today every non-default
launch flashes; after this, at most one does, on one host.

### 4e. Runtime theme switch — what the user actually sees

The failure mode if handled naively: flip `data-theme` to `nord` before the sheet lands and
`[data-theme=nord]` matches nothing, so every variable falls back to `:root` — which is **anubis, a dark
theme**. A user switching between two _light_ themes would get a dark strobe. That is worse than a
short delay, so `setTheme` does not do it.

```ts
setTheme(theme: ThemeName): void {
  this.vscode.setState(THEME_STATE_KEY, theme);   // always synchronous
  this.writeThemeHint(theme);                     // always synchronous
  if (EAGER_THEMES.has(theme) || this.deferredSheetReady) {
    this._currentTheme.set(theme);                // synchronous
    return;
  }
  const pending = this.loadDeferredThemeSheet();
  if (!pending) { this._currentTheme.set(theme); return; }
  void pending.then(() => this._currentTheme.set(theme));
}
```

| Case                                                                              | Behaviour                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| → `anubis` / `anubis-light`                                                       | **Synchronous**, exactly as before. Never fetches.                                                                                                                                                                                   |
| → one of the 32, sheet not yet loaded (**first such switch in the session only**) | Sheet is inserted, theme applies on its `load`. Until then the UI stays on the **old** theme — no intermediate frame, no strobe. The picker's selection lags by one local read (`file:` / `vscode-resource:`, 52,973 B, no network). |
| → one of the 32, sheet already loaded                                             | **Synchronous.** Includes every launch where the pre-paint script inserted it, because the constructor detects the existing `#ptah-theme-extra-sheet` link and marks the sheet ready.                                                |
| Sheet fails to load                                                               | Theme applies anyway (see §4d).                                                                                                                                                                                                      |
| No marker in the document (unit tests, the host's `generateFallbackHtml` path)    | Applies immediately. Never blocks on something that cannot arrive.                                                                                                                                                                   |

Persistence is **always** synchronous and always happens first, so closing the window mid-load still
records the choice, and the next launch renders it pre-paint.

**So: the launch path is flash-free by construction; the only cost is a sub-frame delay on the first
non-default pick of a session.** That is the trade the brief permits, taken in the direction it permits.

---

## 5. R7 — `index.html` diff, and one thing I will not overstate

**The `modulepreload` list did not change at all.** Ten entries before, ten after, identical raw sizes in
the same order, and the total preloaded bytes are **1,148,645 → 1,148,645**, unchanged from Batch 4:

| Size (B) | Before (Batch 4) | After            |
| -------: | ---------------- | ---------------- |
|  636,224 | `chunk-GSXVN24C` | `chunk-ACY4UYIB` |
|  223,137 | `chunk-UWKWCTKO` | `chunk-AMPZFQWW` |
|  109,959 | `chunk-7V2KZ4E5` | `chunk-6G5MWHGZ` |
|   89,863 | `chunk-CTJANIJZ` | `chunk-NP352ZVP` |
|   39,700 | `chunk-3RGT2QIX` | `chunk-7CPQFQGC` |
|   17,463 | `chunk-LJZR7JKA` | `chunk-XUYPGHFV` |
|   16,400 | `chunk-S62IZLL7` | `chunk-YMNF6BG7` |
|   15,737 | `chunk-PSKPQPYR` | `chunk-OIUUV46U` |
|      162 | `chunk-LW5LSEOG` | `chunk-U2HVU2WB` |
|        0 | `chunk-JXTWWDFB` | `chunk-JXTWWDFB` |

**No new `modulepreload` entries.** Hash names moved only because `theme.service.ts` changed.

**The honest statement about `theme-extra.css`.** The string _does_ appear in `index.html` — a naive
`grep` returns a hit. It appears **once**, as the inert marker:

```html
<link id="ptah-theme-extra" rel="ptah-deferred-stylesheet" href="theme-extra.css" />
```

That is **not** a fetch. Machine-checked on the built artifact:

- `rel="stylesheet"` / `rel="preload"` / `rel="modulepreload"` pointing at `theme-extra.css`: **none**,
  in either attribute order.
- Every one of the ten lazy files was checked individually against `index.html`; only `theme-extra.css`
  matches, and only via this marker.
- `theme-boot-lists.spec.ts` locks this: it asserts the marker keeps `rel="ptah-deferred-stylesheet"`
  and that no `stylesheet`/`preload` rel is ever adjacent to `theme-extra.css`.

An unknown `rel` token is ignored by the HTML link-processing algorithm — no resource is obtained. **But
that is inference about browser behaviour, which is precisely the class of claim R7 exists because it
fails silently.** DevTools confirmation is human-gate item **H2**, and it is the single most important
one in §10.

Also verified: `theme-extra.css` is copied into **both** host artifacts (`scripts/copy-webview.js:16`
`fs.cpSync(browser, …, {recursive})`; `apps/ptah-electron/scripts/copy-renderer.js` `copyRecursive`), and
it contains **zero** occurrences of `copilot|codex|claude|openai|anthropic`, so it does not trip the
marketplace scanner's non-JS-file rule (root `CLAUDE.md`, BLOCKING).

---

## 6. Did the tree shift mid-batch? — NO

**`HEAD` did not move**: `5fd739b03` at both ends, Batch 4's closing commit.

Checked by **mtime**, not by the `git status` letter, across `libs/frontend`, `libs/shared` and
`apps/ptah-extension-webview`. My baseline build ran at **21:26 UTC**. Every file in those trees with an
mtime after 21:26 is one of my own six edits (21:36-21:47). The newest file that is not mine is
`app.config.ts` at **20:42 UTC**, 44 minutes before my baseline — Batch 4's committed work.

The concurrent session's one dirty file, `libs/backend/agent-sdk/…/session-query-executor.service.ts`,
is **outside** the webview graph (`libs/frontend` never imports `@ptah-extension/agent-sdk`).
`apps/ptah-cli/README.md` was dirty at batch start and is clean now — also outside the graph.

Strongest evidence: my independently measured baseline came out **byte-identical to Batch 4's closing
2,536,716 B**, and Angular's budget line agreed to the byte (36.72 kB). The −24,153 B is attributable to
this unit alone.

---

## 7. Gates

| Gate                                      | Command                                                              | Result                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `core` (incl. 8 new theme tests)          | `nx test core`                                                       | ✅ **23 suites, 479 tests** (was 471)                                          |
| webview (incl. the 5 new list-sync tests) | `nx test ptah-extension-webview --skip-nx-cache`                     | ✅ **5 suites, 25 tests** (was 20)                                             |
| Typecheck                                 | `nx run-many -t typecheck -p ptah-extension-webview,core,chat`       | ✅ **3/3**                                                                     |
| Lint                                      | `nx run-many -t lint -p ptah-extension-webview,core --skip-nx-cache` | ✅ **2/2, 0 errors** (10 warnings, all pre-existing, none in a file I touched) |
| Build                                     | `nx build … --configuration=production --skip-nx-cache`              | ✅ green, reproduced                                                           |

### `theme.service.spec.ts` — kept passing, and extended

All 16 pre-existing tests pass **unchanged**. That is not an accident of mocking: in a jsdom document
there is no marker link, so `loadDeferredThemeSheet()` returns `null` and `setTheme` stays synchronous —
the same "never block on a sheet that cannot arrive" branch that protects the host's fallback HTML. The
async path is therefore covered by tests that build the marker explicitly:

- mirrors the theme into `localStorage` on `setTheme`
- re-arms the mirror from persisted state on construction (the upgrade path in §4d)
- **never** inserts the sheet for `anubis` / `anubis-light`
- holds the theme back until `load` fires on the first deferred switch
- applies later switches synchronously and reuses a single sheet
- still applies the theme when the sheet `error`s
- applies immediately when the document has no deferred sheet
- treats a sheet already inserted pre-paint as ready (synchronous)

### `theme-boot-lists.spec.ts` — the duplication gate

The pre-paint script cannot import, so it hard-codes three name lists. This spec reads `index.html` off
disk and asserts `EAGER ∪ DEFERRED === DAISYUI_THEMES`, `EAGER ∩ DEFERRED === ∅`, `EAGER` is exactly the
two Tailwind still compiles, and `DARK` matches the `isDark` flags. **Adding a 35th theme to
`DAISYUI_THEMES` without adding it to `DEFERRED` would otherwise ship a theme that silently renders as
anubis; this fails the build instead.**

### I-6 / R13 / R12a — `nx reset`

`project.json` was edited, so the reset was **mandatory and was not skipped**. R12a reproduced exactly:
`npx nx reset` failed **twice** with `EPERM … \\?\D:\projects\ptah-extension\.nx\workspace-data`, after
stopping the daemon and recreating `.nx/cache/terminalOutputs` both times. The documented sequence did
not clear it on this machine today.

**What did work, and it is worth recording for Unit 8**, which has to do this again: the daemon _did_
stop, and the failure is only the recursive removal of `.nx/workspace-data`. Deleting the four graph
artifacts inside it directly — `project-graph.json`, `file-map.json`, `source-maps.json`,
`nx_files.nxt` — succeeded, and that is the thing I-6 actually cares about: the project graph was
recomputed from the edited `project.json` rather than read stale (F-11). The proof it worked is in the
output itself — the build picked up the new `styles` entry and emitted `theme-extra.css`, which a stale
graph could not have produced.

**Unit 8 should expect `nx reset` to fail here and should use that targeted deletion rather than treating
it as a blocker.**

### Remaining budget warnings

1. `bundle initial … not met by 12.56 kB` — **§9**.
2. `message-bubble.component.css … not met by 977 bytes` — **Unit 7, deliberately not mine.**
3. Three `@xterm/* is not ESM` warnings — I-7, unactioned by design.

---

## 8. Invariant compliance

| Invariant                                                     | Status                                                                                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **I-1 / R2** `useValue`, never `useFactory`                   | ✅ N/A — no provider changed this unit                                                                                              |
| **I-2 / R3** `resolveWhen` trigger-gated                      | ✅ N/A — untouched                                                                                                                  |
| **I-3 / R4** services eager, components not                   | ✅ N/A — no `MESSAGE_HANDLERS` service touched. `ThemeService` is not a message handler                                             |
| **I-4** `main.js` must not grow                               | ✅ **raw byte-identical**, 186,827 B (§3e)                                                                                          |
| **I-5** Monaco untouched                                      | ✅ `provideMonacoEditor` and the asset globs are untouched; `project.json` changed only the `styles` array                          |
| **I-6 / R13** `nx reset` before a `project.json` budget check | ✅ done, with the R12a failure and the working substitute recorded above                                                            |
| **I-7** xterm CJS warnings unactioned                         | ✅ all three still emitted                                                                                                          |
| **I-8** DO-NOT-TOUCH                                          | ✅ all six paths clean; TASK_2026_196 not touched                                                                                   |
| **I-9** restore `maximumError`                                | ⏸️ Unit 8, mandatory-last, deliberately not mine — **and see §9, it cannot honestly be done yet**                                   |
| **R15** launch surface                                        | ✅ **not applicable by construction** — no view, component or route was deferred. This is exactly why Unit 9 was chosen over Unit 6 |

---

## 9. THE TARGET IS NOT MET

|                                 |                    Bytes |
| ------------------------------- | -----------------------: |
| Initial total after Unit 9      |            **2,512,563** |
| Budget (`maximumWarning` 2.5mb) |                2,500,000 |
| **Remaining shortfall**         | **12,563 B (12.27 KiB)** |

Per `tasks.md:1141` I have **stopped here**. No fourth lever, no launch surface deferred, no budget
raised, `libs/shared`/`zod` untouched.

**This blocks Unit 8.** Task 5.4's first acceptance box is _"build green with zero initial-bundle budget
warnings"_, and `tasks.md:1214` is explicit: _"If Unit 9 did not close the gap, do NOT tick this and do
NOT change `maximumError`."_ Restoring `maximumError` to `3.5mb` would still build (2,512,563 is under
3,500,000), so Unit 8 **can** be executed — but it would land with the initial-bundle **warning still
present**, which is not what I-9 asks for. **That is a user decision, and it is the decision this task now
turns on.** I am not making it.

**Two things the decision should be made with, and neither is a proposal I am acting on:**

1. **Unit 9 was mis-sized, not mis-executed.** The 276 kB figure in `tasks.md:1105` is `styles.css`'s
   total, not its theme content. Nothing about the mechanism underperformed — it moved 100% of the
   available theme bytes, and the 32-theme ceiling was 25,164 B before a line was written. There is no
   remaining CSS in `styles.css` of comparable size that is per-user-state and therefore deferrable; the
   rest is Tailwind utilities and the daisyUI component layer, which every user needs on every view.
2. **Every remaining candidate is already ruled out by this task's own record**: `zod` at 304 kB (plan
   §7, I-8, needs `libs/shared` split across ~149 import sites), the two shells (plan §5, explicitly
   rejected), and `setup-wizard` 109.0 kB / `dashboard` 35.7 kB / `canvas` ~118 kB — all three
   disqualified by R15 with evidence. **12,563 B is genuinely smaller than any lever left that does not
   cost latency.**

**Whether to keep this change at all is also open.** It is a net positive independent of the budget — it
removes 24,153 B, and it _fixes_ a real pre-existing theme flash (§4c) rather than introducing one. But
it does add a cross-host pre-paint contract that has to be maintained, and it does not achieve what it
was scheduled to achieve. Reverting it is three file reverts plus two spec files.

---

## 10. OUTSTANDING — HUMAN GATE

**Nothing below can be inferred from a green build. Items H1-H3 are the Unit 9 acceptance gate named at
`tasks.md:1180`; H2 is the one I would not ship without.**

| #       | What to do                                                                                                                                                                                                                                                                                            | Why it cannot be inferred                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H1**  | **Launch with a persisted non-default theme (e.g. `dracula`) and confirm no `anubis` flash on the first painted frame.** Do it on **both** hosts. Record with a video/frame capture if possible — this is a single-frame artefact.                                                                    | Render-blocking behaviour of a script-inserted stylesheet is the entire mechanism, and no automated gate in this task observes a painted frame.                                                                                                                                                                                                                                                                                             |
| **H1b** | **The VS Code upgrade path specifically**: with a pre-existing profile that has `dracula` in VS Code state but **no** `ptah-theme` in `localStorage`, launch **twice**. Expect one anubis frame on the first launch and **none** on the second.                                                       | §4d — the one honest gap. Confirming it self-heals is what makes it acceptable.                                                                                                                                                                                                                                                                                                                                                             |
| **H2**  | **Launch on `anubis` (and on `anubis-light`) and confirm from the DevTools Network panel that `theme-extra.css` is NEVER requested.**                                                                                                                                                                 | **The single highest-value check here.** Property 2 is stated in the brief as provable _"from the network panel or an equivalent observation, not by reading the code"_, and the marker link puts the string `theme-extra.css` in `index.html` (§5). Static analysis says an unknown `rel` is never fetched; R7 exists because that class of inference fails silently. If it _is_ fetched, the change is worth zero and should be reverted. |
| **H3**  | **Switch themes at runtime from the picker on a profile that has never loaded the sheet.** Confirm the new theme applies; confirm all **34** are selectable; confirm no dark strobe when switching between two _light_ themes (e.g. `cupcake` → `nord`). Then switch again and confirm it is instant. | §4e. The first switch is deliberately delayed by one local read; the delay must be imperceptible, and the absence of a strobe is the reason the delay exists.                                                                                                                                                                                                                                                                               |
| **H4**  | **Spot-check several of the 32 for visual fidelity** — they now come from `daisyui/dist/themes.css` instead of the plugin's output. `synthwave`, `retro`, `wireframe`, `black`, `nord` are the ones most likely to expose a difference.                                                               | Same package and same source data, so they _should_ be identical, but "should be identical" is an inference about a vendor's build.                                                                                                                                                                                                                                                                                                         |
| **H5**  | **Confirm `anubis` and `anubis-light` are visually unchanged.**                                                                                                                                                                                                                                       | They are the two that stayed in `styles.css`; a regression here would mean the config edit did more than remove 32 names.                                                                                                                                                                                                                                                                                                                   |
| **H6**  | **Confirm `theme-extra.css` is present in both packaged artifacts** — `dist/apps/ptah-extension-vscode/webview/browser/` and `dist/apps/ptah-electron/renderer/`.                                                                                                                                     | Both copy scripts copy the directory recursively (verified by reading them), but neither host build was run in this unit — the full-build gate is Task 5.3.                                                                                                                                                                                                                                                                                 |

### e2e — could it cover this? Yes, partly. I did not write it; the tester owns e2e.

There is **no theme coverage anywhere in the e2e suites today.** What is mechanisable, and what is not:

- **Mechanisable, and worth it**: Electron Playwright can seed the state file / `localStorage`, launch,
  and assert `document.documentElement.getAttribute('data-theme')` plus — the valuable part —
  `performance.getEntriesByType('resource')` filtered for `theme-extra.css`. That turns **H2 into an
  automated regression gate**, which is the one item here that most deserves to stop being manual. A
  runtime-switch spec (H3) is equally mechanisable.
- **Not mechanisable at reasonable cost**: H1 itself. Asserting _"no wrong-coloured frame was ever
  painted"_ needs frame-level capture; a settled-state assertion cannot see it. The nearest honest proxy
  is asserting the sheet's `resource` entry has a `responseEnd` earlier than first contentful paint.
  That is a proxy, and it should be labelled one.
- **`specs/perf/startup-tti.spec.ts` is not required.** No view is deferred and no module hop is added;
  the launch path gains one synchronous `localStorage` read for everyone and one local stylesheet fetch
  for non-default users only. If anything, default users get 25 kB _less_ CSS to parse. If a reviewer
  wants it run anyway, it is cheap — but there is no hypothesis for it to test.
