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
 *  - The music bed is placed at frame 0, trimmed to the composition length, and
 *    faded in/out at the edges via a per-frame volume ramp.
 *
 * Volumes follow the roadmap: whoosh ~0.35, music bed ~0.08.
 */
import React from 'react';
import {
  Audio,
  Sequence,
  interpolate,
  useVideoConfig,
} from 'remotion';
import { msToFrames } from '../lib/load-manifest';
import { FULL, type FocusRect, type Shot } from '../lib/shots';

export interface SoundDesignProps {
  shots: Shot[];
  /** Intro length (ms) — body-local shot times are offset by this. */
  introMs: number;
  /** Resolved whoosh SFX src; omit to skip whooshes. */
  whooshSrc?: string;
  /** Resolved music-bed src; omit to skip the bed. */
  musicSrc?: string;
}

const WHOOSH_VOLUME = 0.35;
const MUSIC_VOLUME = 0.08;
/** Music fade in/out at the composition edges (ms). */
const MUSIC_FADE_MS = 900;

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

  // Per-frame volume ramp for the music bed (fade in at head, out at tail).
  const fadeFrames = Math.max(1, msToFrames(MUSIC_FADE_MS));
  const musicVolume = (f: number): number =>
    MUSIC_VOLUME *
    Math.min(
      interpolate(f, [0, fadeFrames], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
      interpolate(
        f,
        [durationInFrames - fadeFrames, durationInFrames],
        [1, 0],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
      ),
    );

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
