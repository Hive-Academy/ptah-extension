/**
 * AnimatedGridPattern — a subtle moving dot-grid texture for backgrounds,
 * MagicUI's "animated grid pattern" ported to Remotion (frame-driven vertical
 * drift instead of CSS keyframes). Sits above <Backdrop>, below scene content.
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { THEME } from '../../theme';

export const AnimatedGridPattern: React.FC<{
  cellSize?: number;
  color?: string;
  opacity?: number;
  /** Full vertical drift cycle, ms — one cell height per cycle so it tiles seamlessly. */
  driftMs?: number;
}> = ({ cellSize = 56, color = THEME.textStrong, opacity = 0.05, driftMs = 6000 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const driftFrames = Math.max(1, Math.round((driftMs / 1000) * fps));
  const offset = ((frame % driftFrames) / driftFrames) * cellSize;

  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        opacity,
        backgroundImage: `radial-gradient(circle, ${color} 1px, transparent 1px)`,
        backgroundSize: `${cellSize}px ${cellSize}px`,
        backgroundPosition: `0px ${offset}px`,
      }}
    />
  );
};
