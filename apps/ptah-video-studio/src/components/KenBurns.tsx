/**
 * KenBurns — optional slow zoom/pan wrapper for the background recording.
 *
 * Wraps children in a transform that eases scale 1.0 -> `maxScale` across the
 * clip, giving the static screen capture subtle cinematic motion. Disabled by
 * passing `enabled={false}` (renders children untouched).
 */
import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export interface KenBurnsProps {
  enabled?: boolean;
  maxScale?: number;
  children: React.ReactNode;
}

export const KenBurns: React.FC<KenBurnsProps> = ({
  enabled = true,
  maxScale = 1.04,
  children,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  if (!enabled) {
    return <>{children}</>;
  }

  const scale = interpolate(frame, [0, durationInFrames], [1, maxScale], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        transform: `scale(${scale})`,
        transformOrigin: 'center center',
      }}
    >
      {children}
    </div>
  );
};
