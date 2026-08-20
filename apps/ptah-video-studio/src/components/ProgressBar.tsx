/**
 * ProgressBar — thin amber playback bar pinned to the bottom edge. Reads as a
 * subtle "story" progress indicator for social clips.
 */
import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { THEME } from '../theme';

export const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();
  const p = durationInFrames > 0 ? Math.min(1, frame / durationInFrames) : 0;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        bottom: 0,
        height: 5,
        width: width * p,
        background: `linear-gradient(90deg, ${THEME.amber}, ${THEME.amberDeep})`,
        boxShadow: `0 0 12px ${THEME.amberDeep}`,
      }}
    />
  );
};
