/**
 * CameraBubble — circular corner PiP of the founder's camera over a screen demo.
 *
 * A subtle branded border + soft drop shadow keep it reading as "the same brand
 * family" as the showcase device frame. The camera video is object-fit:cover'd
 * into a circle; a spring pop-in on mount makes it feel placed, not pasted.
 */
import React from 'react';
import { OffthreadVideo, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { THEME } from '../theme';

export type BubbleCorner = 'tl' | 'tr' | 'bl' | 'br';

export interface CameraBubbleProps {
  src: string;
  corner?: BubbleCorner;
  /** Diameter as a fraction of frame height (default 0.24). */
  sizePct?: number;
  muted?: boolean;
}

const MARGIN_PCT = 0.035;

export const CameraBubble: React.FC<CameraBubbleProps> = ({
  src,
  corner = 'br',
  sizePct = 0.24,
  muted = false,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const diameter = Math.round(height * sizePct);
  const margin = Math.round(height * MARGIN_PCT);

  const pop = spring({ frame, fps, config: { damping: 15, mass: 0.6, stiffness: 130 } });

  const pos: React.CSSProperties = {
    ...(corner.startsWith('t') ? { top: margin } : { bottom: margin }),
    ...(corner.endsWith('l') ? { left: margin } : { right: margin }),
  };

  return (
    <div
      style={{
        position: 'absolute',
        ...pos,
        width: diameter,
        height: diameter,
        borderRadius: '50%',
        overflow: 'hidden',
        border: `${Math.max(2, Math.round(diameter * 0.018))}px solid rgba(245,181,68,0.55)`,
        boxShadow: '0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)',
        transform: `scale(${0.6 + pop * 0.4})`,
        opacity: pop,
        background: THEME.bg,
      }}
    >
      <OffthreadVideo
        src={src}
        muted={muted}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    </div>
  );
};

/** Shared px helpers so ScreenDemo/Hybrid can co-locate the bubble consistently. */
export function bubbleMetrics(width: number, height: number, sizePct = 0.24) {
  void width;
  return { diameter: Math.round(height * sizePct), margin: Math.round(height * MARGIN_PCT) };
}
