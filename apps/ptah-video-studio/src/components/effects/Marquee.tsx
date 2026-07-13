/**
 * Marquee — an infinite horizontal scroll row (MagicUI's "marquee" ported to
 * Remotion). Renders the item list twice back-to-back and shifts by exactly
 * one copy's width per loop so the seam is invisible — frame-driven, no CSS
 * animation. Useful for channel-chip rows, avatar rows, logo strips that would
 * otherwise sit static.
 */
import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';

export const Marquee: React.FC<{
  children: React.ReactNode;
  /** Time for one full loop (one copy's width) to pass, ms. */
  durationMs?: number;
  gap?: number;
  reverse?: boolean;
  style?: React.CSSProperties;
}> = ({ children, durationMs = 9000, gap = 16, reverse = false, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const loopFrames = Math.max(1, Math.round((durationMs / 1000) * fps));
  const progress = (frame % loopFrames) / loopFrames; // 0..1
  const dir = reverse ? 1 : -1;

  return (
    <div style={{ overflow: 'hidden', ...style }}>
      <div
        style={{
          display: 'flex',
          width: 'max-content',
          gap,
          transform: `translateX(${dir * progress * 50}%)`,
        }}
      >
        <div style={{ display: 'flex', gap }}>{children}</div>
        <div style={{ display: 'flex', gap }} aria-hidden>{children}</div>
      </div>
    </div>
  );
};
