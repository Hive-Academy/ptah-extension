/**
 * Callout — a floating annotation card that slides into a frame corner while a
 * shot is active. Fixed size (lives above the camera transform) so text stays
 * crisp regardless of how far the camera has zoomed.
 */
import React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { THEME } from '../theme';

export interface CalloutProps {
  text: string;
  pos: 'tl' | 'tr' | 'bl' | 'br';
  shotStartMs: number;
  videoHeight: number;
}

const CORNER: Record<CalloutProps['pos'], React.CSSProperties> = {
  tl: { top: '7%', left: '4%' },
  tr: { top: '7%', right: '4%' },
  bl: { bottom: '13%', left: '4%' },
  br: { bottom: '13%', right: '4%' },
};

export const Callout: React.FC<CalloutProps> = ({
  text,
  pos,
  shotStartMs,
  videoHeight,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = frame - (shotStartMs / 1000) * fps;
  const enter = spring({
    frame: localFrame,
    fps,
    config: { damping: 16, mass: 0.5, stiffness: 120 },
  });
  const dx = pos === 'tr' || pos === 'br' ? 24 : -24;
  const fontSize = Math.round(videoHeight * 0.026);

  return (
    <div
      style={{
        position: 'absolute',
        ...CORNER[pos],
        display: 'flex',
        alignItems: 'center',
        gap: fontSize * 0.6,
        padding: `${fontSize * 0.62}px ${fontSize}px`,
        borderRadius: fontSize * 0.7,
        background: 'rgba(10, 12, 20, 0.86)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 18px 44px rgba(0,0,0,0.55)',
        backdropFilter: 'blur(8px)',
        opacity: enter,
        transform: `translateX(${dx * (1 - enter)}px)`,
        fontFamily: THEME.font,
      }}
    >
      <div
        style={{
          width: fontSize * 0.34,
          height: fontSize * 1.4,
          borderRadius: 99,
          background: `linear-gradient(180deg, ${THEME.amber}, ${THEME.amberDeep})`,
          boxShadow: `0 0 14px ${THEME.amberDeep}`,
        }}
      />
      <span
        style={{
          color: THEME.textStrong,
          fontWeight: 700,
          fontSize,
          letterSpacing: 0.3,
        }}
      >
        {text}
      </span>
    </div>
  );
};
