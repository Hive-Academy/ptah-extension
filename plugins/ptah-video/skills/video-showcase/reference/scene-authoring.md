# Authoring a Scene

A "scene" is a Playwright spec that drives a real app on camera and emits two
JSON manifests consumed by the render half. It is **not** a test: it asserts
almost nothing, runs no destructive actions, and is tuned for how it looks and
sounds.

Source of truth for everything in this file:
`apps/ptah-electron-e2e/src/showcase/_harness/director.ts`,
`.../showcase-fixtures.ts`, `.../browser-fixtures.ts`, `.../prewarm.ts`, and
the scene pair `dashboard-tour.scene.ts` / `scripts/dashboard-tour.json`.

See `camera-and-render.md` for what happens to the emitted JSON downstream, and
`brand-and-runtime.md` for the two runtime fixtures (`showcase-fixtures.ts` vs
`browser-fixtures.ts`) a scene chooses between.

## The scene/script pair

Every scene is two files:

| File              | Location                                       | Contents                                                                   |
| ----------------- | ---------------------------------------------- | -------------------------------------------------------------------------- |
| `<slug>.scene.ts` | `apps/ptah-electron-e2e/src/showcase/`         | Playwright test body driving `page` + `director`                           |
| `<slug>.json`     | `apps/ptah-electron-e2e/src/showcase/scripts/` | `{ "scene": "<slug>", "lines": ["...", "..."] }` — ordered narration lines |

`<slug>` is derived automatically from the scene filename (`sceneSlug()` in
both fixture files strips `.scene.ts` from the test file's basename) — it also
becomes the output directory name under
`dist/apps/ptah-electron-e2e/recordings/<slug>/`.

The script file is read by three things, always by array index:

1. `Director.say(index, …)` — speaks `script[index]` during capture.
2. `narrate.mjs` — synthesizes `wav/0001.wav`, `wav/0002.wav`, … (1-based,
   zero-padded) from `script[i]` **before** capture (audio-first pipeline).
3. Nothing else — `beats.json` written during capture carries a `scriptIndex`
   on each beat so the render step maps a beat back to its clip even if a
   conditional beat was skipped mid-capture.

A minimal script file (`scripts/dashboard-tour.json`):

```json
{
  "scene": "dashboard-tour",
  "lines": ["How much did your AI agents cost you this week? If you do not know, keep watching.", "This is Ptah, the AI coding orchestra — and its dashboard is home base for every agent you run. Let us take the tour."]
}
```

## Audio-first pacing: why `say()` exists

The old flow was `caption(text); hold(estimate); caption()` — the estimate
(chars × ms) produced silent gaps or clipped lines because it never matched
the real TTS clip length. `say(index, opts)`:

1. Calls `caption(script[index], opts.target, index)` — records a beat
   (`scriptIndex: index`) and, if `silentCaptions` isn't set, draws the
   lower-third.
2. Runs `opts.during?.()` (your interaction — click, hover, scroll…) while the
   line is "playing".
3. Holds for the **real** clip length (`clipDurationsMs[index]`, loaded from a
   pre-capture `narrate.mjs` run's `durations.json`) plus `opts.breathMs`
   (default 350ms), minus time already spent in `during`.
4. Clears the caption.

Falls back to `Math.round(line.length * 65) + 500` ms when no
`durations.json` exists yet (a dry run before narration). **Run `narrate.mjs`
before capturing** for locked pacing — see `camera-and-render.md`.

## `Director` API reference

Constructed as `new Director(app, page, opts: DirectorOptions)` by the fixture
(never directly in a scene). All methods are on the `director` fixture value.

### `DirectorOptions`

| Field             | Default                         | Purpose                                                                    |
| ----------------- | ------------------------------- | -------------------------------------------------------------------------- |
| `cps`             | `22`                            | Typing speed, characters/sec, for `type()`.                                |
| `beatMs`          | `900`                           | Default hold duration for `hold()`.                                        |
| `agentTimeoutMs`  | `6 * 60_000`                    | Max wait for `waitForAgentTurn()`.                                         |
| `scene`           | `'unknown'`                     | Slug stamped on every beat/shot.                                           |
| `title`           | `''`                            | Playwright test title — intro-card copy fallback.                          |
| `res`             | `{ width: 1920, height: 1080 }` | Capture resolution; the coordinate space shot rects normalize against.     |
| `script`          | `[]`                            | Ordered narration lines from `scripts/<scene>.json`.                       |
| `clipDurationsMs` | `[]`                            | Real per-line clip durations from `durations.json`, indexed like `script`. |

### Methods

| Method             | Signature                                                          | Purpose                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `installOverlays`  | `(): Promise<void>`                                                | Inject (or re-inject after navigation) the synthetic cursor, click-ring, caption and spotlight DOM overlays. Call again after any full page load. |
| `hold`             | `(ms = beatMs): Promise<void>`                                     | Wait `ms` so the viewer can absorb the frame.                                                                                                     |
| `caption`          | `(text?, target?, scriptIndex?): Promise<void>`                    | Show/clear a lower-third caption; always records a `Beat`; with `target`, also records a camera `Shot` from that element's box.                   |
| `say`              | `(index, { during?, target?, breathMs? }): Promise<void>`          | Audio-locked narration: caption + optional interaction + hold for the real clip length + clear. See above.                                        |
| `flushBeats`       | `(outPath): Promise<void>`                                         | Write `beats.json` (the `SceneManifest`). Called by the fixture teardown while the page is still alive.                                           |
| `flushShots`       | `(outPath): Promise<void>`                                         | Write `shots.json`. No-op if this run recorded zero shots (never clobbers a hand-authored track).                                                 |
| `dismissDialogs`   | `(): Promise<void>`                                                | Best-effort click through known dismiss affordances (`Maybe Later`, `Dismiss`, `Not now`, `Close`, `close`), up to 4 passes.                      |
| `moveTo`           | `(target: Locator): Promise<void>`                                 | Smoothly ease the synthetic cursor to a target's center (12–60 steps by distance). Throws if the target has no bounding box.                      |
| `click`            | `(target: Locator): Promise<void>`                                 | `moveTo` + record a shot + hold 250ms + pulse the click ring + real click + hold 300ms.                                                           |
| `type`             | `(target: Locator, text: string): Promise<void>`                   | `click()` then type at `cps` chars/sec via `pressSequentially`, then hold 400ms.                                                                  |
| `hover`            | `(target: Locator, dwellMs = 600): Promise<void>`                  | Ease onto a target and dwell, no click; records a shot; degrades to a plain hold if the target has no box.                                        |
| `spotlight`        | `(target: Locator, ms = 1600): Promise<void>`                      | Draw a glowing ring around a target for `ms`, then clear it; records a shot.                                                                      |
| `scrollThrough`    | `(target?, { steps=6, dwellMs=650, andBack=true }): Promise<void>` | Smoothly pan a scrollable region top→bottom (and back), resolving the best scrollable ancestor/descendant of `target` (defaults to the page).     |
| `wheel`            | `(dy: number): Promise<void>`                                      | Mouse-wheel at the current cursor position, then hold 400ms.                                                                                      |
| `waitForAgentTurn` | `(scope?: Locator): Promise<void>`                                 | Wait for `[data-testid="chat-stop-btn"]` to appear then detach within a scope (default `body`) — one real agent turn.                             |

`page` (the raw Playwright `Page`) is also exposed on the fixture for anything
not covered above (raw locators, `page.goto`, `page.evaluate`, …).

## How targeting auto-punches the camera

Any call that passes an element (`caption(text, target)`, `say(i, {
target })`, `click`, `hover`, `spotlight`) resolves the element's
`boundingBox()` and calls the private `recordShot(box)`:

- Boxes under ~3% of the frame on either axis (scrollbars, dividers) are
  **skipped** — never a real camera subject.
- Boxes covering >70% of the frame produce a **full-frame shot** (`{ fromMs
}`, no `focus`) so the camera eases back out instead of punching into
  "everything".
- Otherwise: `focus` = element box padded ~13% each side (clamped 0..1);
  `ring` = tight box + 5px pad; `captionPos: 'top'` is set when the element's
  center sits in the lower half of the frame (lifts the caption off a
  close-up).
- **Debounce**: a shot within a quarter-frame of the last shot's center, fired
  under 1200ms later, is dropped — consecutive interactions on the same region
  don't spam the camera track.

`flushShots()` only writes `shots.json` when at least one shot was recorded
this run — a reverse-engineered scene's hand-authored `shots.json` is never
silently overwritten by a scene that made no targeted calls.

## Non-destructive convention

Every existing scene follows the same rule, enforced only by convention (no
code gate): **never click a control that starts a paid/irreversible action**
(launching an agent run, submitting a form, an outbound checkout/download
link). Use `hover` + `spotlight` for those. Non-destructive local-only actions
(a date-range filter that re-reads local history, opening a file into a
read-only editor view) are fine to `click`.

## Pre-warming a heavy surface

Some UI (Monaco, Thoth's SQLite/embedder-backed tabs) pays a large first-mount
cost. If that mount happens between two narration beats it airs as dead
footage. `render-all.mjs`'s lead-in trim (see `camera-and-render.md`) discards
everything before the first beat minus 700ms, so forcing the first-mount
**before** your first `say()` call is free. `_harness/prewarm.ts` exports:

- `prewarmNavSurface(page, navName, ready, timeoutMs=20_000)` — click a
  top-nav tab, wait for a ready selector, restore the original tab.
- `prewarmThoth(page, tabIds)` — enter the Thoth shell and click each
  requested inner tab (`'memory'|'skills'|'cron'|'gateway'`) so its data
  mounts.
- `prewarmEditor(page)` — open the editor panel, open a leaf file to mount
  Monaco, close the panel again if it wasn't already open.

These use **raw** Playwright actions only (never `Director` helpers), so they
never pollute `shots.json`. Call them before your first `director.say()`.

## Annotated template scene

```ts
// apps/ptah-electron-e2e/src/showcase/my-feature-tour.scene.ts
import { test } from './_harness/showcase-fixtures'; // Electron; or browser-fixtures for web
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';

/**
 * SHOWCASE — "<one-line hook>".
 * Non-destructive: <state exactly what it clicks/never clicks>.
 * Prereqs: <auth state / running services this scene assumes>.
 */

async function isVisible(loc: Locator): Promise<boolean> {
  return loc
    .first()
    .isVisible()
    .catch(() => false);
}

test('SHOWCASE — my feature tour', async ({ page, director }) => {
  // 1. Everything before the first say() is trimmed by render-all's lead-in
  //    trim — do setup/navigation/dialog-dismissal here, it never airs.
  await director.dismissDialogs();
  await page.getByRole('tab', { name: 'My Feature' }).click();
  await director.dismissDialogs();
  await director.hold();

  // 2. HOOK — fire immediately so the video opens on a question, not dead air.
  await director.say(0);

  // 3. Targeted beat: camera auto-punches onto `card` as this line plays.
  const card = page.locator('[data-testid="my-card"]').first();
  if (await isVisible(card)) {
    await director.say(1, {
      target: card,
      during: async () => {
        await director.hover(card, 700);
        await director.spotlight(card, 1800);
      },
    });
  }

  // 4. Closing line — extra breath before the outro whip-transition.
  await director.say(2, { breathMs: 950 });
});
```

Companion `scripts/my-feature-tour.json`:

```json
{
  "scene": "my-feature-tour",
  "lines": ["Hook line that opens on a question.", "Line that names the card the camera is about to punch onto.", "Closing line."]
}
```

## Fixture responsibilities (what you don't have to do yourself)

`showcase-fixtures.ts` (Electron) / `browser-fixtures.ts` (web) both:

- Derive the scene slug and create `dist/apps/ptah-electron-e2e/recordings/<slug>/`.
- Load `scripts/<slug>.json` and, if present, `durations.json` in that scene dir.
- Construct the `Director` with the resolved `script`/`clipDurationsMs`/`res`.
- In teardown (before the page/app closes — reverse fixture order), call
  `director.flushBeats(.../beats.json)` then `director.flushShots(.../shots.json)`.
- Rename Playwright's randomly-named `.webm` to `raw.webm`.

You never call `flushBeats`/`flushShots` yourself in a scene body.
