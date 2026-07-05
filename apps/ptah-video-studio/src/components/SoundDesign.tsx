/**
 * SoundDesign — optional audio layer: a subtle whoosh on each camera punch-in
 * and a low music bed under the whole video. Both are best-effort: the parent
 * only passes `whooshSrc` / `musicSrc` when the asset files actually exist on
 * disk (render-all.mjs probes `assets/sfx/whoosh.mp3` + `assets/music/bed.mp3`),
 * so a missing asset simply renders nothing here — the video never fails.
 *
 * Timing:
 *  - Whooshes fire at each shot transition that CHANGES the focus (a real punch-
 *    in / reframe, not a no-op shot). Shot times are body-local (VO time), so
 *    we offset them by `introMs` to land on the composition timeline.
 *  - The music bed is placed at frame 0, looped + trimmed to the composition
 *    length, and DUCKED under narration: its volume drops to ~0.12 while any
 *    narration clip plays and rises to ~0.32 in the gaps (250ms linear ramps),
 *    with a 1s fade-in at the head and a 1.5s fade-out at the tail. Narration
 *    windows come in body-local output ms (render-all) and are offset by introMs
 *    onto the composition timeline — the same shift used for the whooshes.
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
  /** Resolved whoosh SFX src; omit to skip whooshes. */
  whooshSrc?: string;
  /** Resolved music-bed src; omit to skip the bed. */
  musicSrc?: string;
}

const WHOOSH_VOLUME = 0.35;
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
  whooshSrc,
  musicSrc,
}) => {
  const { fps, durationInFrames } = useVideoConfig();
  const introFrames = msToFrames(introMs);

  // Frames (composition timeline) at which the camera actually reframes.
  const whooshFrames: number[] = [];
  if (whooshSrc) {
    for (let i = 1; i < shots.length; i++) {
      const prev = shots[i - 1].focus ?? FULL;
      const cur = shots[i].focus ?? FULL;
      if (focusChanged(prev, cur)) {
        whooshFrames.push(introFrames + msToFrames(shots[i].fromMs));
      }
    }
  }

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
  const fadeInFrames = Math.max(1, msToFrames(FADE_IN_MS));
  const fadeOutFrames = Math.max(1, msToFrames(FADE_OUT_MS));
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

      {whooshFrames.map((from, i) => (
        <Sequence key={`whoosh-${i}`} from={from} name={`whoosh-${i}`}>
          <Audio src={whooshSrc as string} volume={WHOOSH_VOLUME} />
        </Sequence>
      ))}
    </>
  );
};
