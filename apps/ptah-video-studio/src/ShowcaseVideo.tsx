/**
 * ShowcaseVideo — the single parametric Remotion composition.
 *
 * Layer stack (bottom → top):
 *   <Backdrop>            animated gradient, continuous across all sections
 *   <Series>             intro card → body (device frame + VO + captions) → outro
 *   <Watermark>          persistent PTAH wordmark
 *   <ProgressBar>        thin amber playback bar
 *
 * Section boundaries (intro→body→outro) use hand-rolled whip-pan / zoom-blur
 * bursts (see <SectionTransition>) instead of plain crossfades, so the cuts
 * read as energetic camera moves through the shared backdrop. Narration is one
 * <Audio> per beat placed at the beat's recorded tMs; captions are footage-timed
 * (offsetMs=0) so words and voice stay locked. The recording is framed in a
 * <DeviceFrame> that also clips the capture's bottom padding band (see
 * DeviceFrame + render-all detection). Optional whoosh SFX + music bed are layered
 * on top via <SoundDesign> when the asset files are present.
 */
import React from 'react';
import {
  AbsoluteFill,
  Series,
  staticFile,
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
import { SectionTransition } from './components/SectionTransition';
import { SoundDesign } from './components/SoundDesign';
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
  /**
   * True when the source footage is higher-res than this composition's output
   * size, so the virtual camera can punch in further and stay crisp. Set by
   * render-all when --out-res is smaller than the capture res.
   */
  supersample?: boolean;
  /**
   * Ms of dead lead-in trimmed from the FRONT of the footage. render-all sets
   * this to skip captured setup time (dialog dismissal, navigation, workspace
   * load) before the first narration beat; beats/shots/captions are shifted by
   * the same amount upstream so everything stays locked to the trimmed footage.
   */
  trimBeforeMs?: number;
  /**
   * Output composition size. When set (by render-all's --out-res), the
   * composition renders at THIS size while DeviceFrame scales the higher-res
   * capture down into it (crisper zooms). When omitted the composition falls
   * back to `manifest.res` (native = capture size). Consumed by Root's
   * calculateMetadata, not by the component body.
   */
  outRes?: { width: number; height: number };
  /**
   * Optional sound-design asset names (relative to --public-dir). Included only
   * when the files exist on disk; missing assets are simply omitted here and the
   * render proceeds silent — never fails. See render-all.mjs.
   */
  whooshSfx?: string;
  musicBed?: string;
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
  supersample = false,
  trimBeforeMs = 0,
  whooshSfx,
  musicBed,
}) => {
  // Card sizing keys off the OUTPUT height (composition size), which reflects
  // an --out-res override; falls back to capture res when no override is set.
  const { height } = useVideoConfig();
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
          {/* Intro punches out into the body with a zoom-blur burst. */}
          <SectionTransition exit="zoom">
            <IntroCard
              title={introCopy ?? manifest.title ?? manifest.scene}
              subtitle={introCopy ? undefined : 'Ptah'}
              videoHeight={height}
            />
          </SectionTransition>
        </Series.Sequence>

        <Series.Sequence durationInFrames={bodyFrames}>
          {/* Body whips in from the intro and whips out to the outro. */}
          <SectionTransition enter="whip" exit="whip" dir={1}>
            <BodyScene
              src={resolveSrc(rawVideo)}
              source={resolvedSource}
              manifest={manifest}
              narrationFiles={narrationFiles}
              captions={captions}
              shots={shots}
              kenBurns={kenBurns}
              supersample={supersample}
              trimBeforeMs={trimBeforeMs}
              resolveSrc={resolveSrc}
            />
          </SectionTransition>
        </Series.Sequence>

        <Series.Sequence durationInFrames={outroFrames}>
          {/* Outro zooms in as the body clears. */}
          <SectionTransition enter="zoom">
            <OutroCard
              copy={outroCopy ?? 'The whole team, in one place.'}
              videoHeight={height}
            />
          </SectionTransition>
        </Series.Sequence>
      </Series>

      <SoundDesign
        shots={shots}
        introMs={introMs}
        whooshSrc={whooshSfx ? resolveSrc(whooshSfx) : undefined}
        musicSrc={musicBed ? resolveSrc(musicBed) : undefined}
      />

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
