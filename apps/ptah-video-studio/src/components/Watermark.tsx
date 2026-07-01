/**
 * Watermark — small persistent PTAH wordmark in the top-right, low opacity.
 */
import React from 'react';
import { THEME } from '../theme';

export const Watermark: React.FC<{ videoHeight: number }> = ({
  videoHeight,
}) => {
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
      PTAH
    </div>
  );
};
