/**
 * AmbientOrbs — soft drifting light orbs layered behind promo content.
 *
 * Adds depth and continuous motion to the otherwise flat <Backdrop>. Cheap to
 * render (blurred radial gradients, no canvas/WebGL), so it works everywhere
 * the promo renders. Sized off the shorter video edge, so it reads the same in
 * vertical (1080x1920) and landscape (1920x1080).
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { THEME } from '../theme';

type Orb = {
  color: string;
  /** Diameter as a fraction of the shorter video edge. */
  size: number;
  /** Rest position (% of frame). */
  x: number;
  y: number;
  /** Drift amplitude (% of frame). */
  dx: number;
  dy: number;
  /** Drift speed (radians/sec). */
  speed: number;
};

const ORBS: Orb[] = [
  { color: THEME.amber, size: 0.52, x: 20, y: 24, dx: 6, dy: 5, speed: 0.5 },
  { color: THEME.indigo, size: 0.66, x: 82, y: 34, dx: -7, dy: 6, speed: 0.42 },
  // color for the low drift orb is supplied at render time (glow prop).
  { color: THEME.bgGlowLegacy, size: 0.78, x: 50, y: 84, dx: 5, dy: -7, speed: 0.34 },
];

export const AmbientOrbs: React.FC<{ intensity?: number; glow?: string }> = ({
  intensity = 0.16,
  // Default legacy blue so shipped scenes are unchanged; PromoReel passes the
  // emerald bgGlow for new-stage reels.
  glow = THEME.bgGlowLegacy,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const shortEdge = Math.min(width, height);

  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      {ORBS.map((o, i) => {
        const color = i === 2 ? glow : o.color;
        const cx = o.x + Math.sin(t * o.speed + i * 1.7) * o.dx;
        const cy = o.y + Math.cos(t * o.speed * 0.9 + i * 1.1) * o.dy;
        const d = shortEdge * o.size;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${cx}%`,
              top: `${cy}%`,
              width: d,
              height: d,
              marginLeft: -d / 2,
              marginTop: -d / 2,
              borderRadius: '50%',
              background: `radial-gradient(circle, ${color} 0%, transparent 68%)`,
              opacity: intensity,
              filter: `blur(${d * 0.05}px)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
