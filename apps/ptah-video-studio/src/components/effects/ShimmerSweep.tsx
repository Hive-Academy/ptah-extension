/**
 * ShimmerSweep — a light-gradient band that sweeps once across its children
 * (text or a badge), MagicUI's "shimmer" ported to Remotion. Fires once on
 * mount (e.g. wrap in a phase that itself only mounts on enter) rather than
 * looping, so it reads as a one-time premium "reveal glint" not a distraction.
 */
import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

export const ShimmerSweep: React.FC<{
  children: React.ReactNode;
  /** Delay before the sweep starts, frames. */
  delayFrames?: number;
  /** Sweep travel time, frames. */
  durationFrames?: number;
  style?: React.CSSProperties;
}> = ({ children, delayFrames = 0, durationFrames = 24, style }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(
    frame,
    [delayFrames, delayFrames + durationFrames],
    [-120, 220],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <div style={{ position: 'relative', display: 'inline-block', overflow: 'hidden', ...style }}>
      {children}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: `linear-gradient(75deg, transparent 0%, transparent 40%, rgba(255,255,255,0.55) 50%, transparent 60%, transparent 100%)`,
          transform: `translateX(${progress}%)`,
          mixBlendMode: 'overlay',
        }}
      />
    </div>
  );
};
