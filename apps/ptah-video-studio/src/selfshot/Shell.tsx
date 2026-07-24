/**
 * SelfShotShell — shared chrome around a mode-specific "stage".
 *
 * Every self-shot composition (TalkingHead / ScreenDemo / Hybrid) supplies only
 * its stage (the video layout) as children; the shell layers on everything else
 * that is common, reusing the showcase pipeline's parts:
 *   - <Backdrop>            branded animated gradient (shared with ShowcaseVideo)
 *   - word-timed captions   via <LowerThird> (whisper words.json → CaptionToken[])
 *   - beat overlays         corner overlays + full-screen b-roll cutaways
 *   - separate voice track   <Audio> when a manifest supplies input.audio
 *   - <EndCard>             branded waitlist CTA after the body
 *   - <SoundDesign>         music bed ducked under the whole body + punch whooshes
 *   - <Watermark>/<ProgressBar>  same persistent chrome as the showcase videos
 *
 * Body time is composition time: the body <Series.Sequence> starts at frame 0,
 * so every resolved ms (captions/overlays/shots) is already on this clock.
 */
import React from 'react';
import { AbsoluteFill, Audio, staticFile } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { Backdrop } from '../components/Backdrop';
import { Watermark } from '../components/Watermark';
import { ProgressBar } from '../components/ProgressBar';
import { LowerThird } from '../components/LowerThird';
import { SoundDesign } from '../components/SoundDesign';
import { msToFrames } from '../lib/load-manifest';
import { EndCard } from './EndCard';
import { CornerOverlayLayer, FullBrollLayer } from './overlays';
import { END_TRANSITION_FRAMES } from './constants';
import type { ResolvedSelfShotProps } from './resolved';

function resolveSrc(value: string): string {
  if (/^https?:\/\//.test(value)) return value;
  return staticFile(value);
}

export const SelfShotShell: React.FC<{
  props: ResolvedSelfShotProps;
  videoHeight: number;
  children: React.ReactNode;
}> = ({ props, videoHeight, children }) => {
  const bodyFrames = Math.max(1, msToFrames(props.bodyMs));
  const endMs = props.endCard?.durationMs ?? 0;
  const endFrames = endMs > 0 ? msToFrames(endMs) : 0;
  const overlap =
    endFrames > 0
      ? Math.max(0, Math.min(END_TRANSITION_FRAMES, bodyFrames - 1, endFrames - 1))
      : 0;

  // Duck the music bed under the whole body (continuous founder voice).
  const narrationWindows = props.music
    ? [{ startMs: 0, endMs: props.bodyMs }]
    : [];

  const body = (
    <AbsoluteFill>
      {/* Stage (mode-specific video layout). */}
      {children}
      {/* Corner overlays: lower-third / keyword / stat / PiP b-roll. */}
      <CornerOverlayLayer overlays={props.overlays} />
      {/* Word-timed captions. */}
      <LowerThird captions={props.captions} videoHeight={videoHeight} />
      {/* Full-screen b-roll cutaways sit ABOVE captions (they replace frame). */}
      <FullBrollLayer overlays={props.overlays} />
      {/* Separate voice track (when the video audio is muted). */}
      {props.muteVideo && props.audioSrc ? <Audio src={resolveSrc(props.audioSrc)} /> : null}
    </AbsoluteFill>
  );

  return (
    <AbsoluteFill style={{ backgroundColor: '#05060c' }}>
      <Backdrop />

      {endFrames > 0 ? (
        // Reuse @remotion/transitions to fade the body into the end card.
        <TransitionSeries>
          <TransitionSeries.Sequence durationInFrames={bodyFrames}>{body}</TransitionSeries.Sequence>
          <TransitionSeries.Transition
            presentation={fade()}
            timing={linearTiming({ durationInFrames: overlap || 1 })}
          />
          <TransitionSeries.Sequence durationInFrames={endFrames}>
            <EndCard headline={props.endCard?.headline} />
          </TransitionSeries.Sequence>
        </TransitionSeries>
      ) : (
        <AbsoluteFill>{body}</AbsoluteFill>
      )}

      <SoundDesign
        shots={props.shots}
        introMs={0}
        narrationWindows={narrationWindows}
        whooshSrc={props.whoosh ? resolveSrc(props.whoosh) : undefined}
        musicSrc={props.music ? resolveSrc(props.music) : undefined}
      />

      <Watermark videoHeight={videoHeight} />
      <ProgressBar />
    </AbsoluteFill>
  );
};

export { resolveSrc };
