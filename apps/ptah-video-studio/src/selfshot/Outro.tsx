/**
 * Outro — the branded end card as a STANDALONE clip.
 *
 * `EndCard` already is the house outro (wordmark, "free & open source", the
 * Builders Early Adopter CTA, the free founding year, and a scannable QR), but
 * now it could only exist as a tail appended to a self-shot body. A tutorial cut
 * in an external editor needs the same card as its own file, so this composition
 * wraps it in the chrome the Shell would otherwise supply: the branded backdrop
 * behind it and the persistent wordmark above it.
 *
 * Deliberately NOT a ProgressBar — an outro has nothing left to be partway
 * through — and deliberately no music, matching the SFX-only sound design of the
 * reels it ships alongside.
 *
 * The fps comes from props because the clip has to be spliced back into footage
 * shot at its own rate; rendering a 30fps outro onto a 24fps timeline judders at
 * the splice, the same trap documented in `Shell.tsx` and `selfshot-render.mjs`.
 */
import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { Backdrop } from '../components/Backdrop';
import { Watermark } from '../components/Watermark';
import { EndCard } from './EndCard';

/** Frame at which EndCard's QR springs in — mirrors its `qrPop` offset. */
const QR_POP_FRAME = 14;
/** Tail fade to black so the clip can end a video rather than just stop. */
const FADE_OUT_FRAMES = 14;

const WHOOSH_VOLUME = 0.3;
const RING_VOLUME = 0.22;

/**
 * A type alias, NOT an interface: Remotion's <Composition> constrains its props
 * to `Record<string, unknown>`, and an interface never satisfies that (it can be
 * declaration-merged, so TS won't grant it an implicit index signature). Same
 * reason `ResolvedSelfShotProps` is a z.infer alias.
 */
export type OutroProps = {
  /** Big line at the top of the card. Defaults to the brand product name. */
  headline?: string;
  res: { width: number; height: number };
  fps: number;
  durationMs: number;
  /** Staged SFX names (relative to --public-dir); omit either to skip its cue. */
  whoosh?: string;
  ring?: string;
};

export const Outro: React.FC<OutroProps> = ({ headline, whoosh, ring }) => {
  const frame = useCurrentFrame();
  const { height, durationInFrames } = useVideoConfig();

  const fade = interpolate(
    frame,
    [durationInFrames - FADE_OUT_FRAMES, durationInFrames - 1],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <AbsoluteFill style={{ backgroundColor: '#05060c' }}>
      <Backdrop />
      <EndCard headline={headline} />
      <Watermark videoHeight={height} />

      {/* Sound scored to the card's own motion, not laid under it: the card
          resolves in on frame 0, the QR pops on frame 14. */}
      {whoosh ? (
        <Sequence from={0} name="outro-whoosh">
          <Audio src={staticFile(whoosh)} volume={WHOOSH_VOLUME} />
        </Sequence>
      ) : null}
      {ring ? (
        <Sequence from={QR_POP_FRAME} name="outro-ring">
          <Audio src={staticFile(ring)} volume={RING_VOLUME} />
        </Sequence>
      ) : null}

      <AbsoluteFill style={{ backgroundColor: '#000000', opacity: fade }} />
    </AbsoluteFill>
  );
};
