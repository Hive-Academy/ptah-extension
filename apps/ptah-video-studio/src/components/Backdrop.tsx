/**
 * Backdrop — the continuous animated background behind every section.
 *
 * A slowly drifting radial gradient with a soft amber glow and an inset
 * vignette. Rendered once at the composition root so the intro → body → outro
 * cuts read as one continuous space (the section content fades over it).
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { THEME } from '../theme';

export const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = durationInFrames > 0 ? frame / durationInFrames : 0;
  const gx = 50 + Math.sin(t * Math.PI * 2) * 12;
  const gy = 42 + Math.cos(t * Math.PI * 2) * 9;

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(130% 95% at ${gx}% ${gy}%, ${THEME.bgGlow} 0%, ${THEME.bgDeep} 46%, ${THEME.bg} 100%)`,
      }}
    >
      <AbsoluteFill
        style={{
          background: `radial-gradient(38% 30% at ${100 - gx}% ${18 + gy}%, rgba(245,181,68,0.16), transparent 70%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(34% 26% at ${gx}% ${88 - gy * 0.3}%, rgba(79,107,237,0.14), transparent 72%)`,
        }}
      />
      <AbsoluteFill
        style={{ boxShadow: 'inset 0 0 340px rgba(0,0,0,0.72)' }}
      />
    </AbsoluteFill>
  );
};
