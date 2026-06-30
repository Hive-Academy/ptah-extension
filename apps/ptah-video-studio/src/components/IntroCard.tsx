/**
 * IntroCard — branded title card shown before the recording.
 *
 * Scene title (or configured intro copy) fades/slides in over a dark branded
 * background. Duration is owned by the parent <Series.Sequence>.
 */
import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export interface IntroCardProps {
  title: string;
  subtitle?: string;
  videoHeight: number;
}

export const IntroCard: React.FC<IntroCardProps> = ({
  title,
  subtitle,
  videoHeight,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 200 } });
  const y = interpolate(enter, [0, 1], [30, 0]);
  const titleSize = Math.round(videoHeight * 0.075);
  const subSize = Math.round(videoHeight * 0.03);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(circle at 50% 40%, #14213a 0%, #05060c 70%)',
        color: '#ffffff',
        fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif',
      }}
    >
      <div
        style={{
          opacity: enter,
          transform: `translateY(${y}px)`,
          textAlign: 'center',
          padding: '0 8%',
        }}
      >
        <div style={{ fontSize: titleSize, fontWeight: 800, letterSpacing: -1 }}>
          {title}
        </div>
        {subtitle ? (
          <div
            style={{
              marginTop: titleSize * 0.3,
              fontSize: subSize,
              fontWeight: 400,
              color: 'rgba(255,255,255,0.7)',
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
};
