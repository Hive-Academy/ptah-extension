/**
 * OutroCard — branded call-to-action card shown after the recording.
 */
import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export interface OutroCardProps {
  copy: string;
  videoHeight: number;
}

export const OutroCard: React.FC<OutroCardProps> = ({ copy, videoHeight }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 200 } });
  const scale = interpolate(enter, [0, 1], [0.92, 1]);
  const size = Math.round(videoHeight * 0.06);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(circle at 50% 60%, #1a2c1f 0%, #05060c 70%)',
        color: '#ffffff',
        fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif',
      }}
    >
      <div
        style={{
          opacity: enter,
          transform: `scale(${scale})`,
          fontSize: size,
          fontWeight: 800,
          letterSpacing: -1,
          textAlign: 'center',
          padding: '0 8%',
        }}
      >
        {copy}
      </div>
    </div>
  );
};
