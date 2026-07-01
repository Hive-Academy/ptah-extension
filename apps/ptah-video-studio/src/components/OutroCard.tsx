/**
 * OutroCard — branded call-to-action shown after the recording.
 *
 * Transparent base (global <Backdrop> shows through). The headline springs in,
 * an amber CTA pill scales up with a soft pulse, and a small tagline settles
 * underneath.
 */
import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { THEME } from '../theme';

export interface OutroCardProps {
  copy: string;
  videoHeight: number;
  tagline?: string;
}

export const OutroCard: React.FC<OutroCardProps> = ({
  copy,
  videoHeight,
  tagline = 'ptah.live',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 20, mass: 0.6 } });
  const pill = spring({ frame: frame - 8, fps, config: { damping: 16, mass: 0.5 } });
  const pulse = 1 + Math.sin((frame / fps) * 3.2) * 0.02;
  const size = Math.round(videoHeight * 0.062);
  const pillSize = Math.round(videoHeight * 0.03);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: THEME.textStrong,
        fontFamily: THEME.font,
      }}
    >
      <div
        style={{
          opacity: enter,
          transform: `translateY(${interpolate(enter, [0, 1], [26, 0])}px)`,
          fontSize: size,
          fontWeight: 800,
          letterSpacing: -1.5,
          textAlign: 'center',
          padding: '0 8%',
        }}
      >
        {copy}
      </div>

      <div
        style={{
          marginTop: size * 0.55,
          opacity: pill,
          transform: `scale(${interpolate(pill, [0, 1], [0.8, 1]) * pulse})`,
          padding: `${pillSize * 0.6}px ${pillSize * 1.5}px`,
          borderRadius: 999,
          background: `linear-gradient(90deg, ${THEME.amber}, ${THEME.amberDeep})`,
          color: '#1a1200',
          fontWeight: 800,
          fontSize: pillSize,
          letterSpacing: 0.5,
          boxShadow: `0 14px 40px rgba(245,158,11,0.4), 0 0 0 1px rgba(255,255,255,0.15) inset`,
        }}
      >
        Get Ptah free
      </div>

      <div
        style={{
          marginTop: size * 0.5,
          opacity: pill * 0.8,
          fontSize: Math.round(videoHeight * 0.024),
          fontWeight: 600,
          letterSpacing: 3,
          textTransform: 'lowercase',
          color: THEME.textFaint,
        }}
      >
        {tagline}
      </div>
    </div>
  );
};
