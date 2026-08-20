/**
 * Meteors — a handful of diagonal light streaks crossing the background layer,
 * MagicUI's "meteors" ported to Remotion (deterministic seeded positions/
 * timing instead of CSS animation-delay + Math.random, so headless per-frame
 * renders stay consistent). Place behind scene content, low opacity.
 */
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { THEME } from '../../theme';
import { seededSeries } from './seeded-random';

export const Meteors: React.FC<{
  count?: number;
  seed?: number;
  /** One full streak's travel time, ms. */
  travelMs?: number;
  color?: string;
}> = ({ count = 6, seed = 7, travelMs = 1400, color = THEME.amber }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const travelFrames = Math.max(1, Math.round((travelMs / 1000) * fps));
  // Stagger meteors across a longer cycle so they don't all streak at once.
  const cycleFrames = travelFrames * count * 0.6;
  const rand = seededSeries(seed, count * 3);

  return (
    <AbsoluteFill style={{ overflow: 'hidden', pointerEvents: 'none' }}>
      {Array.from({ length: count }, (_, i) => {
        const startX = rand[i * 3] * width;
        const startFrame = rand[i * 3 + 1] * cycleFrames;
        const length = 90 + rand[i * 3 + 2] * 120;
        const local = ((frame - startFrame) % cycleFrames + cycleFrames) % cycleFrames;
        if (local > travelFrames) return null;
        const progress = local / travelFrames;
        const dist = Math.min(width, height) * 1.2;
        const x = startX + progress * dist * 0.4;
        const y = -length + progress * (height + length * 2);
        const opacity = interpolate(
          progress,
          [0, 0.15, 0.8, 1],
          [0, 0.55, 0.55, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
        );
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: 2,
              height: length,
              opacity,
              background: `linear-gradient(180deg, ${color}, transparent)`,
              transform: 'rotate(215deg)',
              transformOrigin: 'top center',
              borderRadius: 999,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
