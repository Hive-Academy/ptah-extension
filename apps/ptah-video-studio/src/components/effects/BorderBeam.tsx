/**
 * BorderBeam — a bright light segment that travels around a card's border
 * loop, MagicUI's "border beam" look ported to Remotion's frame-driven model
 * (no CSS @property/animation, no framer-motion — a conic-gradient rotated by
 * `useCurrentFrame()`). Layer as an absolutely-positioned child of a
 * `position: relative` card with `overflow: hidden` and matching `borderRadius`.
 */
import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { THEME } from '../../theme';

export const BorderBeam: React.FC<{
  /** Full loop duration in ms. */
  durationMs?: number;
  /** Beam arc width in degrees. */
  arcDeg?: number;
  colorFrom?: string;
  colorTo?: string;
  /** Match the card's border thickness so the beam reads as the border lighting up. */
  thickness?: number;
}> = ({
  durationMs = 3200,
  arcDeg = 70,
  colorFrom = THEME.amber,
  colorTo = THEME.amberDeep,
  thickness = 2,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const loopFrames = Math.max(1, Math.round((durationMs / 1000) * fps));
  const angle = ((frame % loopFrames) / loopFrames) * 360;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: 'inherit',
        padding: thickness,
        WebkitMask:
          'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
        WebkitMaskComposite: 'xor',
        maskComposite: 'exclude',
        background: `conic-gradient(from ${angle}deg, transparent 0deg, ${colorFrom} ${arcDeg * 0.4}deg, ${colorTo} ${arcDeg * 0.5}deg, transparent ${arcDeg}deg, transparent 360deg)`,
        pointerEvents: 'none',
      }}
    />
  );
};
