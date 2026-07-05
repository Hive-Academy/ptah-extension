/**
 * SectionTransition — hand-rolled whip-pan / zoom-blur burst wrapping a Series
 * section (intro / body / outro). Replaces the plain edge crossfade with a
 * quick scale + blur + translate burst at each boundary (~350–450ms), so the
 * intro→body→outro cuts read as energetic camera moves rather than dissolves.
 *
 * No `@remotion/transitions` dependency — everything is `interpolate` + `spring`
 * over the section's own local frame. The section still fades through the shared
 * <Backdrop> (opacity ramp) so consecutive bursts overlap cleanly.
 *
 * Direction:
 *  - `enter='whip'` slides in from the side with a blur streak that resolves.
 *  - `enter='zoom'` punches in from a scaled-up, blurred state.
 * The matching `exit` variant pushes the outgoing section the same way. Boundary
 * bursts are asymmetric on purpose (fast attack, quick settle) to sell speed.
 */
import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export type TransitionKind = 'whip' | 'zoom';

export interface SectionTransitionProps {
  children: React.ReactNode;
  /** Burst style for the section entering; omit to skip an entry burst. */
  enter?: TransitionKind;
  /** Burst style for the section leaving; omit to skip an exit burst. */
  exit?: TransitionKind;
  /** Whip direction: +1 slides in from the right, -1 from the left. */
  dir?: 1 | -1;
  /** Burst duration in ms (roadmap target ~350–450ms). */
  burstMs?: number;
}

const DEFAULT_BURST_MS = 420;
/** Peak directional-blur radius during a whip/zoom burst (px). */
const BURST_BLUR_PX = 18;
/** Whip horizontal travel as a fraction of frame width. */
const WHIP_TRAVEL = 0.16;

export const SectionTransition: React.FC<SectionTransitionProps> = ({
  children,
  enter,
  exit,
  dir = 1,
  burstMs = DEFAULT_BURST_MS,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width } = useVideoConfig();
  const burst = Math.max(1, Math.round((burstMs / 1000) * fps));

  // Local progress 0..1 for the entry burst (start of section) and a mirrored
  // 0..1 for the exit burst (end of section). Fast attack via easeOutQuint.
  const easeOutQuint = (k: number) => 1 - Math.pow(1 - k, 5);
  const enterK = easeOutQuint(
    interpolate(frame, [0, burst], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const exitRaw = interpolate(
    frame,
    [durationInFrames - burst, durationInFrames],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  // Ease the exit with a fast attack too (it's played forward as the section
  // leaves, so a plain power curve reads as an accelerating push-out).
  const exitK = exitRaw * exitRaw;

  // Compose transform + blur from whichever bursts are active.
  let scale = 1;
  let tx = 0;
  let blur = 0;
  let opacity = 1;

  if (enter && enterK < 1) {
    const g = 1 - enterK; // 1 at cut → 0 settled
    opacity *= interpolate(enterK, [0, 0.5], [0, 1], {
      extrapolateRight: 'clamp',
    });
    blur += BURST_BLUR_PX * g;
    if (enter === 'whip') {
      tx += dir * width * WHIP_TRAVEL * g;
    } else {
      scale *= 1 + 0.14 * g;
    }
  }

  if (exit && exitK > 0) {
    const g = exitK; // 0 at start of exit → 1 at cut
    opacity *= interpolate(exitK, [0.5, 1], [1, 0], {
      extrapolateLeft: 'clamp',
    });
    blur += BURST_BLUR_PX * g;
    if (exit === 'whip') {
      tx -= dir * width * WHIP_TRAVEL * g;
    } else {
      scale *= 1 + 0.14 * g;
    }
  }

  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `translateX(${tx}px) scale(${scale})`,
        filter: blur > 0.15 ? `blur(${blur.toFixed(2)}px)` : 'none',
        willChange: blur > 0.15 ? 'transform, filter, opacity' : undefined,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};
