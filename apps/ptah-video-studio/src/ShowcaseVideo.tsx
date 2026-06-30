/**
 * ShowcaseVideo — the single parametric Remotion composition.
 *
 * Layout (Phase 1, audio-follows-video):
 *   [IntroCard]  ->  [ recording + narration + captions ]  ->  [OutroCard]
 *
 * - Background: <OffthreadVideo> of raw.webm wrapped in optional <KenBurns>.
 *   OffthreadVideo (ffmpeg frame extraction) is mandatory over <Video> for
 *   reliable webm seeking in headless render.
 * - Narration: one <Audio> per beat inside a <Sequence from={msToFrames(tMs)}>,
 *   dropped at the beat's recorded wall-clock tMs (FR-11).
 * - Captions: word-synced <LowerThird>, offset so caption timings (relative to
 *   the concatenated narration track) line up with where audio actually plays.
 */
import React from 'react';
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  Series,
  staticFile,
} from 'remotion';
import type { SceneManifest } from '@ptah-extension/showcase-manifest';
import { KenBurns } from './components/KenBurns';
import { LowerThird } from './components/LowerThird';
import { IntroCard } from './components/IntroCard';
import { OutroCard } from './components/OutroCard';
import {
  msToFrames,
  OUTPUT_FPS,
  type CaptionToken,
  type Durations,
} from './lib/load-manifest';

export type ShowcaseVideoProps = {
  /** Absolute path or staticFile() ref to raw.webm. */
  rawVideo: string;
  manifest: SceneManifest;
  /** Map of beat index (1-based) -> absolute/staticFile path to its wav. */
  narrationFiles: Record<number, string>;
  durations: Durations | null;
  captions: CaptionToken[];
  introCopy?: string;
  outroCopy?: string;
  introMs?: number;
  outroMs?: number;
  kenBurns?: boolean;
};

const DEFAULT_INTRO_MS = 1500;
const DEFAULT_OUTRO_MS = 2000;

function resolveSrc(value: string): string {
  // Absolute paths are passed straight through; relative paths resolve from the
  // Remotion public/ dir via staticFile.
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('file:')) {
    return value;
  }
  return staticFile(value);
}

export const ShowcaseVideo: React.FC<ShowcaseVideoProps> = ({
  rawVideo,
  manifest,
  narrationFiles,
  captions,
  introCopy,
  outroCopy,
  introMs = DEFAULT_INTRO_MS,
  outroMs = DEFAULT_OUTRO_MS,
  kenBurns = true,
}) => {
  const height = manifest.res.height;
  const introFrames = msToFrames(introMs);
  const bodyFrames = Math.max(1, msToFrames(manifest.durationMs));
  const outroFrames = msToFrames(outroMs);

  return (
    <AbsoluteFill style={{ backgroundColor: '#05060c' }}>
      <Series>
        <Series.Sequence durationInFrames={introFrames}>
          <IntroCard
            title={introCopy ?? manifest.title ?? manifest.scene}
            subtitle={introCopy ? undefined : 'Ptah'}
            videoHeight={height}
          />
        </Series.Sequence>

        <Series.Sequence durationInFrames={bodyFrames}>
          <AbsoluteFill>
            <KenBurns enabled={kenBurns}>
              <OffthreadVideo
                src={resolveSrc(rawVideo)}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </KenBurns>

            {manifest.beats.map((beat, i) => {
              const file = narrationFiles[i + 1];
              if (!file) return null;
              return (
                <Sequence
                  key={`vo-${i}`}
                  from={msToFrames(beat.tMs)}
                  name={`beat-${i + 1}`}
                >
                  <Audio src={resolveSrc(file)} />
                </Sequence>
              );
            })}

            <LowerThird captions={captions} videoHeight={height} offsetMs={0} />
          </AbsoluteFill>
        </Series.Sequence>

        <Series.Sequence durationInFrames={outroFrames}>
          <OutroCard
            copy={outroCopy ?? 'Try Ptah free'}
            videoHeight={height}
          />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};

/** Total composition length in frames for a manifest (intro + body + outro). */
export function totalDurationInFrames(
  manifest: SceneManifest,
  introMs = DEFAULT_INTRO_MS,
  outroMs = DEFAULT_OUTRO_MS,
): number {
  return (
    msToFrames(introMs) +
    Math.max(1, msToFrames(manifest.durationMs)) +
    msToFrames(outroMs)
  );
}

export { OUTPUT_FPS };
