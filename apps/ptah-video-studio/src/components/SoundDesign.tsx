/**
 * SoundDesign — optional audio layer: sound effects cued to the on-screen
 * animations, plus a low music bed under the whole video. Every source is
 * best-effort: the parent only passes a src when the asset file actually exists
 * on disk (render-all.mjs probes `assets/sfx/whoosh.mp3` + `assets/music/bed.mp3`;
 * selfshot-render.mjs stages the wider `sfx` set), so a missing asset simply
 * renders nothing here — the video never fails.
 *
 * Timing:
 *  - Whooshes fire at each shot transition that CHANGES the focus (a real punch-
 *    in / reframe, not a no-op shot). Shot times are body-local (VO time), so
 *    we offset them by `introMs` to land on the composition timeline.
 *  - Overlay cues fire with the card's own motion (see ANIMATION CUES below).
 *  - The music bed is placed at frame 0, looped + trimmed to the composition
 *    length, and DUCKED under narration: its volume drops to ~0.12 while any
 *    narration clip plays and rises to ~0.32 in the gaps (250ms linear ramps),
 *    with a 1s fade-in at the head and a 1.5s fade-out at the tail. Narration
 *    windows come in body-local output ms (render-all) and are offset by introMs
 *    onto the composition timeline — the same shift used for the whooshes.
 *
 * ANIMATION CUES. `overlays` + `sfx` bind a sound to each overlay's motion so
 * the mix is scored to the picture rather than laid under it:
 *   - card land  → `pop`  at the overlay's first frame (its spring-in).
 *   - stat count → `ring` when the count-up settles.
 *   - full-frame graphic / b-roll → `whoosh` (it replaces the frame).
 *   - highlight ring → `ring` (a shot that draws a ring without moving focus).
 * Cues are de-duplicated per (sound, frame): two cards landing on the same frame
 * play one sound, not two stacked copies at double level.
 *
 * FPS. Every ms→frame conversion here MUST pass the composition's fps.
 * `msToFrames` defaults to the SHOWCASE rate (30); a self-shot runs at its
 * footage rate (24 for a Resolve export, 60 for screen capture), so omitting it
 * drifts every cue by the ratio of the two — at 24fps a cue 120s in lands 30s
 * late. Same class of bug as the one documented in `selfshot/Shell.tsx`.
 *
 * Volumes follow the roadmap: whoosh ~0.35, ducked bed ~0.12, open bed ~0.32.
 */
import React from 'react';
import {
  Audio,
  Sequence,
  interpolate,
  useVideoConfig,
} from 'remotion';
import { msToFrames, type NarrationWindow } from '../lib/load-manifest';
import { FULL, type FocusRect, type Shot } from '../lib/shots';

/**
 * The slice of a resolved overlay this component needs. Declared structurally
 * rather than importing `ResolvedOverlay` so `components/` keeps no dependency
 * on `selfshot/` (Shell imports downward, never the reverse).
 */
export interface OverlayCue {
  type: 'lower-third' | 'keyword' | 'stat' | 'graphic' | 'broll';
  atMs: number;
  durationMs: number;
  layout?: 'panel' | 'full' | 'pip';
}

/** Resolved SFX srcs, keyed by role. Any omitted key skips that cue. */
export interface SfxSources {
  /** Card/chip arrival — fires with the spring-in. */
  pop?: string;
  /** Something crystallizes: a stat count settling, a highlight ring drawing. */
  ring?: string;
}

export interface SoundDesignProps {
  shots: Shot[];
  /** Intro length (ms) — body-local shot/window times are offset by this. */
  introMs: number;
  /**
   * Narration windows in body-local OUTPUT ms (render-all). The bed ducks inside
   * these and rises between them. Empty → the bed holds its open level (only the
   * head/tail fades apply).
   */
  narrationWindows?: NarrationWindow[];
  /** Resolved overlays, for animation-locked cues. Omit to skip overlay SFX. */
  overlays?: OverlayCue[];
  /** Resolved SFX srcs for the overlay cues. Omit to skip overlay SFX. */
  sfx?: SfxSources;
  /** Resolved whoosh SFX src; omit to skip whooshes. */
  whooshSrc?: string;
  /** Resolved music-bed src; omit to skip the bed. */
  musicSrc?: string;
}

const WHOOSH_VOLUME = 0.35;
/** Card land — under the whoosh: it punctuates, it does not announce. */
const POP_VOLUME = 0.28;
/** Count settle / ring draw — the lightest cue in the palette. */
const RING_VOLUME = 0.22;
/**
 * Frame (within an overlay's own Sequence) at which its count-up finishes.
 * Mirrors the `count` keyframe in `selfshot/overlays.tsx:useEnvelope` — keep the
 * two in step, the same lockstep discipline as manifest.ts ↔ selfshot-resolve.mjs.
 */
const COUNT_SETTLE_FRAME = 26;
/** Bed level while narration plays (ducked) and in the gaps (open). */
const MUSIC_DUCK_VOLUME = 0.12;
const MUSIC_OPEN_VOLUME = 0.32;
/** Linear ramp between ducked/open around each narration window edge (ms). */
const DUCK_RAMP_MS = 250;
/** Head fade-in and tail fade-out at the composition edges (ms). */
const FADE_IN_MS = 1000;
const FADE_OUT_MS = 1500;

/** Two focus rects differ enough to count as a real reframe (whoosh-worthy). */
function focusChanged(a: FocusRect, b: FocusRect): boolean {
  const eps = 0.01;
  return (
    Math.abs(a.x - b.x) > eps ||
    Math.abs(a.y - b.y) > eps ||
    Math.abs(a.w - b.w) > eps ||
    Math.abs(a.h - b.h) > eps
  );
}

export const SoundDesign: React.FC<SoundDesignProps> = ({
  shots,
  introMs,
  narrationWindows = [],
  overlays = [],
  sfx,
  whooshSrc,
  musicSrc,
}) => {
  const { fps, durationInFrames } = useVideoConfig();
  const introFrames = msToFrames(introMs, fps);
  /** Body-local ms → composition frame. */
  const atFrame = (bodyMs: number) => introFrames + msToFrames(bodyMs, fps);

  const cues: { src: string; volume: number; frame: number; tag: string }[] = [];
  const cue = (src: string | undefined, volume: number, frame: number, tag: string) => {
    if (!src || frame < 0 || frame >= durationInFrames) return;
    cues.push({ src, volume, frame, tag });
  };

  // Camera: whoosh where a shot actually reframes; ring where a shot draws a
  // highlight without moving the focus (a `highlight` beat).
  for (let i = 1; i < shots.length; i++) {
    const prev = shots[i - 1];
    const cur = shots[i];
    const frame = atFrame(cur.fromMs);
    if (focusChanged(prev.focus ?? FULL, cur.focus ?? FULL)) {
      cue(whooshSrc, WHOOSH_VOLUME, frame, 'whoosh');
    } else if (cur.ring && !prev.ring) {
      cue(sfx?.ring, RING_VOLUME, frame, 'ring');
    }
  }

  // Overlays: a card pops in with its spring; a full-frame graphic / b-roll
  // whooshes because it replaces the frame; a stat rings when its count lands.
  for (const overlay of overlays) {
    const frame = atFrame(overlay.atMs);
    const replacesFrame =
      (overlay.type === 'graphic' || overlay.type === 'broll') && overlay.layout === 'full';
    if (replacesFrame) {
      cue(whooshSrc, WHOOSH_VOLUME, frame, 'whoosh');
    } else {
      cue(sfx?.pop, POP_VOLUME, frame, 'pop');
    }
    if (overlay.type === 'stat') {
      cue(sfx?.ring, RING_VOLUME, frame + COUNT_SETTLE_FRAME, 'ring');
    }
  }

  // Two beats landing on the same frame play ONE sound — stacking identical
  // <Audio> at one frame just doubles the level and reads as a click.
  const fired = new Set<string>();
  const played = cues.filter(({ tag, frame }) => {
    const key = `${tag}@${frame}`;
    if (fired.has(key)) return false;
    fired.add(key);
    return true;
  });

  // Narration windows shifted onto the composition timeline (body-local +
  // introMs), in ms — the ducking envelope reads these per frame.
  const duckWindows = narrationWindows.map((w) => ({
    startMs: introMs + w.startMs,
    endMs: introMs + w.endMs,
  }));

  // Ducking level (ms → volume) with linear ramps around each window edge; the
  // MINIMUM across windows wins so overlapping ramps stay ducked. Open level in
  // the gaps, ducked inside speech.
  const duckLevel = (tMs: number): number => {
    let level = MUSIC_OPEN_VOLUME;
    for (const w of duckWindows) {
      if (tMs <= w.startMs - DUCK_RAMP_MS || tMs >= w.endMs + DUCK_RAMP_MS) {
        continue;
      }
      let v: number;
      if (tMs < w.startMs) {
        v = interpolate(
          tMs,
          [w.startMs - DUCK_RAMP_MS, w.startMs],
          [MUSIC_OPEN_VOLUME, MUSIC_DUCK_VOLUME],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
        );
      } else if (tMs <= w.endMs) {
        v = MUSIC_DUCK_VOLUME;
      } else {
        v = interpolate(
          tMs,
          [w.endMs, w.endMs + DUCK_RAMP_MS],
          [MUSIC_DUCK_VOLUME, MUSIC_OPEN_VOLUME],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
        );
      }
      level = Math.min(level, v);
    }
    return level;
  };

  // Head fade-in / tail fade-out multiplier (0..1), applied over the duck level.
  const fadeInFrames = Math.max(1, msToFrames(FADE_IN_MS, fps));
  const fadeOutFrames = Math.max(1, msToFrames(FADE_OUT_MS, fps));
  const musicVolume = (f: number): number => {
    const fade = Math.min(
      interpolate(f, [0, fadeInFrames], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
      interpolate(
        f,
        [durationInFrames - fadeOutFrames, durationInFrames],
        [1, 0],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
      ),
    );
    return duckLevel((f / fps) * 1000) * fade;
  };

  return (
    <>
      {musicSrc ? (
        <Audio
          src={musicSrc}
          volume={musicVolume}
          loop
          // Trim to the composition length so a long/looped bed doesn't overrun.
          trimAfter={durationInFrames}
        />
      ) : null}

      {played.map(({ src, volume, frame, tag }) => (
        <Sequence key={`${tag}-${frame}`} from={frame} name={`${tag}-${frame}`}>
          <Audio src={src} volume={volume} />
        </Sequence>
      ))}
    </>
  );
};
