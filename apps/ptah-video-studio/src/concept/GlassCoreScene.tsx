/**
 * GlassCoreScene — isolated checkpoint for the elevated glass hero (also the
 * visual spine of beat 5). Grain is composited BEHIND the 3D canvas (story-kit
 * GrainLayer) and FilmGrade runs grain-free over the canvas, so the crystal
 * stays clean while the backdrop keeps its film texture.
 */
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ConceptSceneProps } from '../PromoReel';
import { ConceptThreeCanvas } from '../concept3d/three-kit';
import { FilmGrade } from '../concept3d/three-assets';
import { GlassHero } from '../concept3d/GlassHero';
import { ShaderBackdrop, GrainLayer, Vignette, storyRootStyle, TEXT_SOFT } from './story-kit';
import { THEME } from '../theme';

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export const GlassCoreScene: React.FC<ConceptSceneProps> = ({ durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const reveal = interpolate(frame, [0, 28], [0, 1], CLAMP);
  const capOpacity = interpolate(
    frame,
    [10, 30, durationFrames - 12, durationFrames],
    [0, 1, 1, 0],
    CLAMP,
  );

  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.58} />
      <GrainLayer opacity={0.05} />
      <FilmGrade grain={0} aberration={0} vignette={0.42} contrast={1.05} saturate={1.05}>
        <ConceptThreeCanvas fov={40}>
          <GlassHero frame={frame} duration={durationFrames} reveal={reveal} />
        </ConceptThreeCanvas>
      </FilmGrade>
      <Vignette amount={0.4} />
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingBottom: Math.round(width * 0.06),
          opacity: capOpacity,
        }}
      >
        <div
          style={{
            fontFamily: THEME.font,
            color: TEXT_SOFT,
            fontSize: Math.round(width * 0.02),
            fontWeight: 500,
            letterSpacing: '-0.01em',
          }}
        >
          A hexagonal core
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
