/**
 * Shared shapes for the showcase Director manifest (`beats.json`).
 *
 * This is the single source of truth for the machine-readable timeline that the
 * Director emits alongside each `.webm` recording. It is imported by both the
 * Director (the `ptah-electron-e2e` app) and the Remotion compositions (the
 * `ptah-video-studio` app) via the `@ptah-extension/showcase-manifest` package
 * alias — never re-declared on either side, so the capture and render halves
 * can never drift. It lives in its own `type:util` lib (not inside either app)
 * because Nx forbids importing one application/e2e project from another.
 *
 * Timing model: beat `tMs` and `recordStartMs`/`durationMs` use `Date.now()`
 * wall-clock. This is acceptable here (unlike workflow scripts, where wall-clock
 * is brittle) because the Director runs inside the live Playwright process that
 * drives Electron in real time, and Playwright's `.webm` is itself real-time
 * wall-clock. Beat `tMs` and the recorded video frames therefore share one
 * clock, so dropping narration/captions at `tMs` lines up with the footage.
 */

export interface Beat {
  /** ms from recordStartMs to when this caption beat fired (Playwright wall-clock). */
  tMs: number;
  /** Terse on-screen caption text (also the TTS source pre-polish). */
  text: string;
  /** Scene slug, e.g. "editor-tour". */
  scene: string;
  /**
   * Index of this line in the scene's script file (`scripts/<scene>.json`),
   * emitted by `director.say(i)`. Locks the beat to its pre-generated narration
   * clip (`wav/{i+1}.wav`) even when a conditional beat is skipped at capture —
   * without it, downstream wav mapping falls back to the beat's array position.
   */
  scriptIndex?: number;
}

export interface SceneManifest {
  scene: string; // slug
  title: string; // Playwright test title (for intro card copy fallback)
  recordStartMs: number; // Date.now() baseline captured at director construction
  durationMs: number; // recordStartMs → flush time (approx recording length)
  res: { width: number; height: number };
  beats: Beat[];
}

/**
 * Normalized region of the CONTENT (0..1). `x`/`w` are over the capture width,
 * `y`/`h` over the content height (the cropped card space in `DeviceFrame`).
 * Mirrors `FocusRect` in `ptah-video-studio/src/lib/shots.ts`.
 */
export interface ShotFocusRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A single virtual-camera shot in `shots.json`. Shapes match `shotSchema` in
 * `ptah-video-studio/src/lib/shots.ts` (the zod source of truth the file is
 * validated against downstream); this interface keeps the Director's emitter
 * and the Remotion consumer from drifting.
 *
 * Timing: `fromMs` shares the SAME clock as `Beat.tMs` — `Date.now()` ms from
 * `recordStartMs`. Remotion places both the body footage and the VO/beats at
 * that offset inside a rebased `<Series.Sequence>`, so footage time, beat time
 * and shot time are all one body-local coordinate (see `manifest.types.ts`
 * timing note and `ptah-video-studio` BodyScene/DeviceFrame).
 */
export interface Shot {
  /** ms from recordStartMs to when this shot's interaction fired (wall-clock). */
  fromMs: number;
  /** Camera target region; omit for a full-frame ease-out. */
  focus?: ShotFocusRect;
  /** Move the caption off a close-up. */
  captionPos?: 'top' | 'bottom';
  /** Tight amber outline around the focused element. */
  ring?: ShotFocusRect;
  /** Optional floating corner card. */
  callout?: { text: string; pos: 'tl' | 'tr' | 'bl' | 'br' };
  /** Camera transition duration into this shot, ms (default ~750 downstream). */
  transMs?: number;
  /** Motion profile: 'ramp' fast-attack (default), 'smooth' ease, 'cut' instant. */
  ease?: 'ramp' | 'smooth' | 'cut';
}

/** The on-disk `shots.json` shape — mirrors `shotsFileSchema` downstream. */
export interface ShotsFile {
  scene: string;
  shots: Shot[];
}
