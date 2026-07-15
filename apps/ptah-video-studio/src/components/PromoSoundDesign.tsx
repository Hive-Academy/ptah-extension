/**
 * PromoSoundDesign — sound layer for the capture-free PromoReel pipeline.
 * Simpler than the showcase pipeline's <SoundDesign>: a promo slide has
 * exactly ONE known VO clip (already resolved by render-promo.mjs into
 * `clipDurationsMs`/`narrationFiles`), so ducking just needs each slide's
 * [start, start+clipDuration] window instead of a general shot/narration-
 * window model.
 *
 * Whoosh at slide boundaries is handled here; whoosh at PHASE boundaries
 * (inside a concept scene's own `PhaseStage`) is handled locally by
 * `PhaseStage` itself (see scene-kit.tsx) since only the scene knows its own
 * phase timing — both draw from the same staged `sfx-whoosh.mp3` file.
 */
import React from 'react';
import { Audio, Sequence, interpolate, useVideoConfig } from 'remotion';

export interface VoWindow {
  /** Composition-timeline frame the slide's VO clip starts at. */
  fromFrame: number;
  /** Clip length in frames. */
  durationFrames: number;
}

const MUSIC_DUCK_VOLUME = 0.12;
const MUSIC_OPEN_VOLUME = 0.28;
const DUCK_RAMP_FRAMES = 8;
const FADE_IN_MS = 800;
const FADE_OUT_MS = 1200;
const WHOOSH_VOLUME = 0.32;

export const PromoSoundDesign: React.FC<{
  musicSrc?: string;
  musicVolume?: number;
  voWindows: VoWindow[];
  /** Frames (composition timeline) at which a slide cut happens (skip index 0). */
  whooshFrames?: number[];
  whooshSrc?: string;
}> = ({
  musicSrc,
  musicVolume = MUSIC_OPEN_VOLUME,
  voWindows,
  whooshFrames = [],
  whooshSrc,
}) => {
  const { fps, durationInFrames } = useVideoConfig();
  const fadeInFrames = Math.max(1, Math.round((FADE_IN_MS / 1000) * fps));
  const fadeOutFrames = Math.max(1, Math.round((FADE_OUT_MS / 1000) * fps));

  const duckLevelAt = (frame: number): number => {
    let level = MUSIC_OPEN_VOLUME;
    for (const w of voWindows) {
      const start = w.fromFrame;
      const end = w.fromFrame + w.durationFrames;
      if (frame <= start - DUCK_RAMP_FRAMES || frame >= end + DUCK_RAMP_FRAMES) continue;
      let v: number;
      if (frame < start) {
        v = interpolate(frame, [start - DUCK_RAMP_FRAMES, start], [MUSIC_OPEN_VOLUME, MUSIC_DUCK_VOLUME], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
      } else if (frame <= end) {
        v = MUSIC_DUCK_VOLUME;
      } else {
        v = interpolate(frame, [end, end + DUCK_RAMP_FRAMES], [MUSIC_DUCK_VOLUME, MUSIC_OPEN_VOLUME], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
      }
      level = Math.min(level, v);
    }
    return level;
  };

  const musicVolumeAt = (frame: number): number => {
    const fade = Math.min(
      interpolate(frame, [0, fadeInFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
      interpolate(frame, [durationInFrames - fadeOutFrames, durationInFrames], [1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
    );
    return (duckLevelAt(frame) / MUSIC_OPEN_VOLUME) * musicVolume * fade;
  };

  return (
    <>
      {musicSrc ? (
        <Audio src={musicSrc} volume={musicVolumeAt} loop trimAfter={durationInFrames} />
      ) : null}
      {whooshSrc
        ? whooshFrames.map((from, i) => (
            <Sequence key={`slide-whoosh-${i}`} from={from} name={`slide-whoosh-${i}`}>
              <Audio src={whooshSrc} volume={WHOOSH_VOLUME} />
            </Sequence>
          ))
        : null}
    </>
  );
};
