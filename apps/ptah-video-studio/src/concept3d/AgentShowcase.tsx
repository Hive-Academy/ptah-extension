/**
 * AgentShowcase — PROOF scene for the three-assets tier, graded to "premium
 * enterprise": real CC0 GLB props GROUNDED on a glossy reflective studio floor,
 * a motivated indigo/amber 3-point rig under ACES tone mapping, extruded Icon3D
 * badges, a slow frame-driven camera dolly, and a deterministic 2D film grade
 * (vignette + seeded grain + chromatic aberration) on top.
 *
 *  the agent    — the RobotExpressive android stands on the studio floor
 *  the props    — a glowing Lantern (left) + a glossy ToyCar (right) fly in
 *  the badges   — an amber spark + an indigo chip orbit the agent
 *
 * Fully frame-driven / deterministic. GLB loading is delayRender-gated inside
 * GltfModel; grain is seeded off useCurrentFrame(); no bloom EffectComposer
 * (see report) — emissive halos are additive Glow sprites. Frames render
 * correctly in any order.
 */
import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { ConceptSceneProps } from '../PromoReel';
import { CaptionRail } from '../concept/scene-kit';
import { THEME } from '../theme';
import {
  breathAt,
  CameraRig,
  ConceptThreeCanvas,
  Glow,
  Label,
  PALETTE,
  Stars,
  type Vec3,
} from './three-kit';
import {
  ContactShadow,
  FilmGrade,
  GltfModel,
  Icon3D,
  preloadGltf,
  StageEnvironment,
  StudioFloor,
} from './three-assets';

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const EASE = Easing.inOut(Easing.cubic);

const ROBOT = 'models/RobotExpressive.glb';
const LANTERN = 'models/Lantern.glb';
const TOYCAR = 'models/ToyCar.glb';

// Warm the parse cache at module load so the very first studio scrub is instant
// (headless workers still gate their own first frame via delayRender).
preloadGltf(ROBOT);
preloadGltf(LANTERN);
preloadGltf(TOYCAR);

const FLOOR_Y = -1.55;
const SHADOW_Y = FLOOR_Y + 0.02; // just above the floor to avoid z-fighting

export const AgentShowcase: React.FC<ConceptSceneProps> = ({
  slide,
  durationFrames,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const zBoost = width >= height ? 1 : 1.7;
  const pf = durationFrames / 3;

  // ── entrances (staggered) ───────────────────────────────────────────────
  const floorIn = interpolate(frame, [0, pf * 0.5], [0, 1], { ...CLAMP, easing: EASE });
  const robotIn = interpolate(frame, [pf * 0.15, pf * 0.9], [0, 1], { ...CLAMP, easing: EASE });
  const lanternIn = interpolate(frame, [pf * 0.55, pf * 1.25], [0, 1], { ...CLAMP, easing: EASE });
  const carIn = interpolate(frame, [pf * 0.75, pf * 1.5], [0, 1], { ...CLAMP, easing: EASE });
  const badgeIn = interpolate(frame, [pf * 1.2, pf * 1.9], [0, 1], { ...CLAMP, easing: EASE });

  // ── slow camera dolly: wide establish → gentle push + drift ──────────────
  const camKeys = [0, pf, 2 * pf, durationFrames];
  const camPos: Vec3 = [
    interpolate(frame, camKeys, [-0.4, 0.3, 0.9, 1.3], { ...CLAMP, easing: EASE }),
    interpolate(frame, camKeys, [1.5, 1.2, 0.95, 0.8], { ...CLAMP, easing: EASE }),
    interpolate(frame, camKeys, [9.4, 8.2, 7.1, 6.4], { ...CLAMP, easing: EASE }) * zBoost,
  ];
  const camLook: Vec3 = [
    interpolate(frame, camKeys, [0, 0.1, 0.2, 0.15], { ...CLAMP, easing: EASE }),
    0.05,
    0,
  ];

  // ── gentle idle motion (all frame-derived) ───────────────────────────────
  const robotBob = breathAt(frame, 150) * 0.12;
  const lanternBob = breathAt(frame, 120, 40) * 0.16;
  const lanternGlow = 0.65 + breathAt(frame, 90) * 0.5;
  const badgeSpin = frame * 0.012;
  const badgeBobA = breathAt(frame, 110) * 0.16;
  const badgeBobB = breathAt(frame, 130, 55) * 0.16;

  const robotScale = useMemo<Vec3>(
    () => [2.55 * robotIn, 2.55 * robotIn, 2.55 * robotIn],
    [robotIn],
  );

  return (
    <AbsoluteFill>
      <FilmGrade aberration={0.5}>
        <ConceptThreeCanvas fov={38}>
          <StageEnvironment intensity={1} exposure={1.08} />
          <CameraRig position={camPos} lookAt={camLook} />
          <Stars frame={frame} count={30} />

          {/* Glossy reflective studio floor (fades into the backdrop). */}
          <StudioFloor y={FLOOR_Y} size={24} opacity={floorIn} />

          {/* Soft baked contact shadows — ground each prop on the stage. */}
          <ContactShadow position={[0, SHADOW_Y, 0.1]} radius={1.35} opacity={robotIn * 0.75} scale={[1, 0.85]} />
          <ContactShadow position={[-2.9, SHADOW_Y, -0.2]} radius={0.7} opacity={lanternIn * 0.6} />
          <ContactShadow position={[2.6, SHADOW_Y, 0.6]} radius={1.5} opacity={carIn * 0.6} scale={[1.35, 1]} />

          {/* The agent — hero android on the studio floor. */}
          {robotIn > 0.001 ? (
            <group position={[0, FLOOR_Y + robotBob, 0]} scale={robotScale}>
              <GltfModel
                src={ROBOT}
                normalize
                // normalized unit-cube model: lift so feet sit on the floor.
                position={[0, 0.5, 0]}
                rotation={[0, 0.35, 0]}
                // Amber hero body; the near-black visor mesh (head_4) glows emerald.
                brandify={{
                  base: PALETTE.amber,
                  accent: PALETTE.amberLight,
                  glowParts: ['head_4'],
                  emissive: PALETTE.emeraldLight,
                  emissiveIntensity: 0.75,
                }}
                envMapIntensity={1.2}
              />
            </group>
          ) : null}
          {/* Emerald back-halo + faint amber rim glow behind the hero. */}
          <Glow color={PALETTE.emerald} scale={3.8} opacity={robotIn * 0.16} position={[0, 0.35, -0.7]} />
          <Glow color={PALETTE.amber} scale={2.6} opacity={robotIn * 0.16} position={[0, -0.2, -0.5]} />
          <Label
            text="AGENT"
            position={[0, FLOOR_Y + 0.12, 1.5]}
            height={0.24}
            color={THEME.textSoft}
            opacity={robotIn * 0.72}
          />

          {/* Glowing lantern prop (left) — emissive, layered amber bloom halo. */}
          {lanternIn > 0.001 ? (
            <group position={[-2.9, FLOOR_Y + 0.9 + lanternBob, -0.2]} scale={[1.5 * lanternIn, 1.5 * lanternIn, 1.5 * lanternIn]}>
              <GltfModel
                src={LANTERN}
                normalize
                rotation={[0, -0.5, 0]}
                brandify={{ base: PALETTE.amberDeep, accent: PALETTE.amber, glowParts: ['glass', 'light', 'lantern', 'candle'], emissive: PALETTE.amberLight }}
                envMapIntensity={1.25}
              />
            </group>
          ) : null}
          <Glow color={PALETTE.amber} scale={2.1 * lanternGlow} opacity={lanternIn * 0.55} position={[-2.9, FLOOR_Y + 0.72, -0.2]} />
          <Glow color="#fff2d6" scale={0.9 * lanternGlow} opacity={lanternIn * 0.7} position={[-2.9, FLOOR_Y + 0.72, -0.2]} />

          {/* Glossy toy car (right) — clearcoat PBR reads the env reflections. */}
          {carIn > 0.001 ? (
            <group position={[2.6, FLOOR_Y + 0.62, 0.6]} scale={[2.3 * carIn, 2.3 * carIn, 2.3 * carIn]}>
              <GltfModel
                src={TOYCAR}
                normalize
                rotation={[0.05, -0.9, 0]}
                brandify={{ base: PALETTE.emerald, accent: PALETTE.amber }}
                envMapIntensity={1.5}
              />
            </group>
          ) : null}
          <Glow color={PALETTE.emerald} scale={2.8} opacity={carIn * 0.24} position={[2.6, FLOOR_Y + 0.7, 0.6]} />

          {/* Extruded icon badges orbiting the agent (tilted so the beveled
              depth catches the light — reads as 3D, not a flat sprite). */}
          <group scale={[badgeIn, badgeIn, badgeIn]}>
            <Glow color={PALETTE.amber} scale={1.15} opacity={badgeIn * 0.4} position={[-1.7, 1.55 + badgeBobA, 0.9]} />
            <Icon3D
              glyph="spark"
              color={PALETTE.amber}
              size={0.62}
              position={[-1.7, 1.55 + badgeBobA, 0.9]}
              rotation={[0.18, badgeSpin, 0.05]}
              emissiveIntensity={0.7}
            />
            <Glow color={PALETTE.emerald} scale={1.05} opacity={badgeIn * 0.4} position={[1.75, 1.95 + badgeBobB, 0.6]} />
            <Icon3D
              glyph="cpu"
              color={PALETTE.emerald}
              size={0.54}
              position={[1.75, 1.95 + badgeBobB, 0.6]}
              rotation={[0.18, -badgeSpin, -0.05]}
              emissiveIntensity={0.7}
            />
          </group>
        </ConceptThreeCanvas>
      </FilmGrade>

      <CaptionRail slide={slide} durationFrames={durationFrames} width={width} />
    </AbsoluteFill>
  );
};
