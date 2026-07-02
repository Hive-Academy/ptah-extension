/**
 * ShowcaseVideo — the single parametric Remotion composition.
 *
 * Layer stack (bottom → top):
 *   <Backdrop>            animated gradient, continuous across all sections
 *   <Series>             intro card → body (device frame + VO + captions) → outro
 *   <Watermark>          persistent PTAH wordmark
 *   <ProgressBar>        thin amber playback bar
 *
 * Sections fade at their edges so the intro→body→outro cuts read as crossfades
 * through the shared backdrop. Narration is one <Audio> per beat placed at the
 * beat's recorded tMs; captions are footage-timed (offsetMs=0) so words and
 * voice stay locked. The recording is framed in a <DeviceFrame> that also clips
 * the capture's bottom padding band (see DeviceFrame + render-all detection).
 */
import React from 'react';
import {
  AbsoluteFill,
  Series,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { SceneManifest } from '@ptah-extension/showcase-manifest';
import { Backdrop } from './components/Backdrop';
import { type SourceInfo } from './components/DeviceFrame';
import { BodyScene } from './components/BodyScene';
import { IntroCard } from './components/IntroCard';
import { OutroCard } from './components/OutroCard';
import { ProgressBar } from './components/ProgressBar';
import { Watermark } from './components/Watermark';
import {
  msToFrames,
  OUTPUT_FPS,
  type CaptionToken,
  type Durations,
} from './lib/load-manifest';
import type { Shot } from './lib/shots';

export type ShowcaseVideoProps = {
  /** Remote URL or name relative to --public-dir (the scene dir) for raw.webm. */
  rawVideo: string;
  manifest: SceneManifest;
  /** Map of beat index (1-based) -> wav name relative to the scene dir. */
  narrationFiles: Record<number, string>;
  durations: Durations | null;
  captions: CaptionToken[];
  /** Detected source geometry; contentHeight clips the capture padding band. */
  source?: SourceInfo;
  /** Camera / annotation shots; empty falls back to idle Ken Burns. */
  shots?: Shot[];
  introCopy?: string;
  outroCopy?: string;
  introMs?: number;
  outroMs?: number;
  kenBurns?: boolean;
};

const DEFAULT_INTRO_MS = 1800;
const DEFAULT_OUTRO_MS = 2400;

function resolveSrc(value: string): string {
  // Remote URLs pass through; everything else is a name relative to the scene
  // dir (wired as Remotion's --public-dir) and resolves via staticFile. The
  // renderer's asset loader rejects absolute file:// paths, so local assets
  // MUST be served through staticFile's internal http server.
  if (/^https?:\/\//.test(value)) {
    return value;
  }
  return staticFile(value);
}

/** Fade a Series section in/out at its edges (crossfade through the backdrop). */
const SectionFade: React.FC<{
  children: React.ReactNode;
  inFrames?: number;
  outFrames?: number;
}> = ({ children, inFrames = 9, outFrames = 9 }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = Math.min(
    interpolate(frame, [0, inFrames], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
    interpolate(
      frame,
      [durationInFrames - outFrames, durationInFrames],
      [1, 0],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
    ),
  );
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

export const ShowcaseVideo: React.FC<ShowcaseVideoProps> = ({
  rawVideo,
  manifest,
  narrationFiles,
  captions,
  source,
  shots = [],
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

  const resolvedSource: SourceInfo = source ?? {
    width: manifest.res.width,
    height: manifest.res.height,
    contentHeight: manifest.res.height,
  };

  return (
    <AbsoluteFill style={{ backgroundColor: '#05060c' }}>
      <Backdrop />

      <Series>
        <Series.Sequence durationInFrames={introFrames}>
          <SectionFade>
            <IntroCard
              title={introCopy ?? manifest.title ?? manifest.scene}
              subtitle={introCopy ? undefined : 'Ptah'}
              videoHeight={height}
            />
          </SectionFade>
        </Series.Sequence>

        <Series.Sequence durationInFrames={bodyFrames}>
          <SectionFade>
            <BodyScene
              src={resolveSrc(rawVideo)}
              source={resolvedSource}
              manifest={manifest}
              narrationFiles={narrationFiles}
              captions={captions}
              shots={shots}
              kenBurns={kenBurns}
              resolveSrc={resolveSrc}
            />
          </SectionFade>
        </Series.Sequence>

        <Series.Sequence durationInFrames={outroFrames}>
          <SectionFade>
            <OutroCard
              copy={outroCopy ?? 'The whole team, in one place.'}
              videoHeight={height}
            />
          </SectionFade>
        </Series.Sequence>
      </Series>

      <Watermark videoHeight={height} />
      <ProgressBar />
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
