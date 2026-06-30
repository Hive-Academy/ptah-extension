/**
 * Shared shapes for the showcase Director manifest (`beats.json`).
 *
 * This is the single source of truth for the machine-readable timeline that the
 * Director emits alongside each `.webm` recording. It is imported by both the
 * Director (this e2e app) and the Remotion compositions (the video-studio app)
 * via the `@ptah/showcase-manifest` TS path alias — never re-declared on either
 * side, so the capture and render halves can never drift.
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
}

export interface SceneManifest {
  scene: string; // slug
  title: string; // Playwright test title (for intro card copy fallback)
  recordStartMs: number; // Date.now() baseline captured at director construction
  durationMs: number; // recordStartMs → flush time (approx recording length)
  res: { width: number; height: number };
  beats: Beat[];
}
