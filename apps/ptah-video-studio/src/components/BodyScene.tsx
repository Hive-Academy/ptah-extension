/**
 * BodyScene — the middle section: camera-driven recording + narration + the
 * annotation layer (highlight rings live inside DeviceFrame; callouts and the
 * caption sit above the camera transform so they stay crisp).
 *
 * The active shot (by wall-clock nowMs) decides the caption position and which
 * callout, if any, is shown.
 */
import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { SceneManifest } from '@ptah-extension/showcase-manifest';
import { DeviceFrame, type SourceInfo } from './DeviceFrame';
import { LowerThird } from './LowerThird';
import { Callout } from './Callout';
import { msToFrames, type CaptionToken } from '../lib/load-manifest';
import { activeShot, type Shot } from '../lib/shots';

export interface BodySceneProps {
  src: string;
  source: SourceInfo;
  manifest: SceneManifest;
  narrationFiles: Record<number, string>;
  captions: CaptionToken[];
  shots: Shot[];
  kenBurns?: boolean;
  /** Footage is higher-res than the output composition (crisper punch-ins). */
  supersample?: boolean;
  /** Ms of dead lead-in trimmed from the front of the footage (see render-all). */
  trimBeforeMs?: number;
  resolveSrc: (v: string) => string;
}

export const BodyScene: React.FC<BodySceneProps> = ({
  src,
  source,
  manifest,
  narrationFiles,
  captions,
  shots,
  kenBurns = true,
  supersample = false,
  trimBeforeMs = 0,
  resolveSrc,
}) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const nowMs = (frame / fps) * 1000;
  const active = activeShot(shots, nowMs);

  return (
    <AbsoluteFill>
      <DeviceFrame
        src={src}
        source={source}
        shots={shots}
        kenBurns={kenBurns}
        supersample={supersample}
        trimBeforeMs={trimBeforeMs}
      />

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

      {active?.callout ? (
        <Callout
          text={active.callout.text}
          pos={active.callout.pos}
          shotStartMs={active.fromMs}
          videoHeight={height}
        />
      ) : null}

      <LowerThird
        captions={captions}
        videoHeight={height}
        offsetMs={0}
        position={active?.captionPos ?? 'bottom'}
      />
    </AbsoluteFill>
  );
};
