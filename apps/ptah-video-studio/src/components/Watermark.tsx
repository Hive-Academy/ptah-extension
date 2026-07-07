/**
 * Watermark — small persistent brand wordmark in the top-right, low opacity.
 * Text comes from `BRAND.wordmark`; an empty wordmark hides it entirely.
 */
import React from 'react';
import { THEME } from '../theme';
import { BRAND } from '../brand.config';

export const Watermark: React.FC<{ videoHeight: number }> = ({
  videoHeight,
}) => {
  if (!BRAND.wordmark) return null;
  return (
    <div
      style={{
        position: 'absolute',
        right: '3.2%',
        top: '4.2%',
        fontFamily: THEME.font,
        fontSize: Math.round(videoHeight * 0.02),
        fontWeight: 800,
        letterSpacing: 3,
        color: 'rgba(255,255,255,0.42)',
        textShadow: '0 2px 10px rgba(0,0,0,0.5)',
      }}
    >
      {BRAND.wordmark}
    </div>
  );
};
