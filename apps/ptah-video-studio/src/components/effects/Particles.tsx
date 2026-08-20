/**
 * Particles — a finer-grained ambient layer than <AmbientOrbs>: many small
 * soft glow dots drifting on individual sine paths, seeded deterministically.
 * MagicUI's "particles" ported to Remotion's frame-driven model.
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { THEME } from '../../theme';
import { seededSeries } from './seeded-random';

export const Particles: React.FC<{
  count?: number;
  seed?: number;
  color?: string;
  /** Base opacity at rest (each particle breathes ±40% around this). */
  opacity?: number;
}> = ({ count = 22, seed = 3, color = THEME.textStrong, opacity = 0.12 }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const rand = seededSeries(seed, count * 5);

  return (
    <AbsoluteFill style={{ overflow: 'hidden', pointerEvents: 'none' }}>
      {Array.from({ length: count }, (_, i) => {
        const baseX = rand[i * 5] * 100;
        const baseY = rand[i * 5 + 1] * 100;
        const size = 2 + rand[i * 5 + 2] * 4;
        const speed = 0.15 + rand[i * 5 + 3] * 0.3;
        const phase = rand[i * 5 + 4] * Math.PI * 2;
        const drift = Math.min(width, height) * 0.02;
        const x = baseX + (Math.sin(t * speed + phase) * drift) / width * 100;
        const y = baseY + (Math.cos(t * speed * 0.8 + phase) * drift) / height * 100;
        const breath = (Math.sin(t * speed * 1.3 + phase) + 1) / 2;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${x}%`,
              top: `${y}%`,
              width: size,
              height: size,
              borderRadius: '50%',
              background: color,
              opacity: opacity * (0.6 + breath * 0.4),
              boxShadow: `0 0 ${size * 2}px ${color}`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
