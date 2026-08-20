/**
 * story-kit — shared building blocks for the "From Cold Clone to Scalable SaaS"
 * reel (promos/ptah-saas-story.json). One place for the muted neural-web
 * backdrop, a standalone film-grain layer (composited BEHIND the 3D canvas so
 * the glass crystal stays clean), the loaded fonts + the CSS custom properties
 * remocn's text/terminal components read, and the brand tokens.
 *
 * Determinism: the shader is frozen (speed→frame, deterministic); the grain
 * turbulence seed is a pure function of useCurrentFrame().
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import { THEME } from '../theme';
import { ShaderNeuroNoise } from '../remocn/components/remocn/shader-neuro-noise';

export const { fontFamily: INTER_FAMILY } = loadInter();
export const { fontFamily: MONO_FAMILY } = loadMono();

export const AMBER = THEME.amber; // #f5a524 — THE accent
export const AMBER_LIGHT = THEME.amberLight;
export const EMERALD = THEME.emerald; // active/success only
export const INK = THEME.bg;
export const TEXT_STRONG = THEME.textStrong;
export const TEXT_SOFT = THEME.textSoft;
export const TEXT_FAINT = THEME.textFaint;

/** Root style that binds remocn's --font-geist-* vars (undefined otherwise →
 *  the whole font-family declaration is invalid and the browser default serif
 *  leaks in) and sets the ink base. Spread onto each scene's root AbsoluteFill. */
export function storyRootStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    backgroundColor: INK,
    ['--font-geist-sans']: INTER_FAMILY,
    ['--font-geist-mono']: MONO_FAMILY,
    ...extra,
  } as React.CSSProperties;
}

/** Muted neural-web backdrop — reads as "intelligence" without a glow wash. A
 *  dark ink veil + radial sink keeps foreground type/product legible. */
export const ShaderBackdrop: React.FC<{ veil?: number }> = ({ veil = 0.5 }) => (
  <AbsoluteFill>
    <ShaderNeuroNoise
      speed={0.16}
      colorBack={INK}
      colorMid={'#0f1a16'}
      colorFront={'#243043'}
      brightness={0.03}
      contrast={0.32}
    />
    <AbsoluteFill style={{ backgroundColor: `rgba(6,8,10,${veil})` }} />
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(120% 120% at 50% 42%, rgba(0,0,0,0) 44%, rgba(4,5,7,0.72) 100%)',
      }}
    />
  </AbsoluteFill>
);

/** Standalone seeded film grain — composite BEHIND the 3D canvas so the crystal
 *  stays clean (the proof's main "noisy glass" nit). Pure fn of the frame. */
export const GrainLayer: React.FC<{ opacity?: number }> = ({ opacity = 0.05 }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity, mixBlendMode: 'overlay' }}>
      <svg width={width} height={height}>
        <filter id="story-grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves={2}
            seed={frame}
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#story-grain)" />
      </svg>
    </AbsoluteFill>
  );
};

/** Soft corner vignette overlay (front layer, cheap, deterministic). */
export const Vignette: React.FC<{ amount?: number }> = ({ amount = 0.45 }) => (
  <AbsoluteFill
    style={{
      pointerEvents: 'none',
      background: `radial-gradient(125% 118% at 50% 45%, rgba(0,0,0,0) 52%, rgba(0,0,0,${amount}) 100%)`,
    }}
  />
);

/** A centered kinetic-type line placed at a vertical offset (remocn text
 *  components center themselves via position:absolute/inset:0). */
export const CenterAt: React.FC<{ dy?: number; children: React.ReactNode }> = ({
  dy = 0,
  children,
}) => <AbsoluteFill style={{ transform: `translateY(${dy}px)` }}>{children}</AbsoluteFill>;
