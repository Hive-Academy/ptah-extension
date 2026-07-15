/**
 * AssetSheet — the PROP-SHEET proof: the full curated, brandified CC0 prop set
 * arranged on the graded amber/emerald ink stage for a single go/no-go on the
 * look before real scene-building. Every prop is grounded (ContactShadow +
 * StudioFloor), lit by StageEnvironment's amber/emerald 3-point rig under ACES,
 * unified by brandify() into ONE PBR material language, and finished with the
 * FilmGrade 2D post. A slow lateral camera truck reveals the shelf; small
 * Icon3D badges tag the knowledge-base pillars.
 *
 * Props → pillars (docs/feature-knowledge-base.md):
 *   rocket   → SaaS launch                drone ×2 → agent squad (orchestration)
 *   robot    → hero agent (orchestration) computer → setup-wizard console
 *   hex prism→ Nx / hexagonal             server rack (primitive) → data unit
 *
 * Fully frame-driven / deterministic (GLB loads delayRender-gated in GltfModel;
 * grain seeded off useCurrentFrame(); no EffectComposer). Any-order safe.
 */
import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import * as THREE from 'three';
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
const ROCKET = 'models/rocket.glb';
const DRONE = 'models/drone.glb';
const COMPUTER = 'models/computer.glb';

[ROBOT, ROCKET, DRONE, COMPUTER].forEach(preloadGltf);

const FLOOR_Y = -1.55;
const SHADOW_Y = FLOOR_Y + 0.02;

/** Staggered ease-in helper. */
const rise = (frame: number, start: number, len: number): number =>
  interpolate(frame, [start, start + len], [0, 1], { ...CLAMP, easing: EASE });

export const AssetSheet: React.FC<ConceptSceneProps> = ({
  slide,
  durationFrames,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const zBoost = width >= height ? 1 : 1.7;
  const pf = durationFrames / 3;

  // ── staggered entrances (left→right across the shelf) ────────────────────
  const floorIn = rise(frame, 0, pf * 0.5);
  const rocketIn = rise(frame, pf * 0.1, pf * 0.7);
  const droneLIn = rise(frame, pf * 0.25, pf * 0.7);
  const robotIn = rise(frame, pf * 0.4, pf * 0.7);
  const droneRIn = rise(frame, pf * 0.55, pf * 0.7);
  const computerIn = rise(frame, pf * 0.7, pf * 0.7);
  const hexIn = rise(frame, pf * 0.9, pf * 0.7);
  const boomboxIn = rise(frame, pf * 1.05, pf * 0.7);
  const badgeIn = rise(frame, pf * 1.4, pf * 0.8);

  // ── slow lateral truck + gentle push: reveal the shelf ───────────────────
  const camKeys = [0, pf, 2 * pf, durationFrames];
  const camPos: Vec3 = [
    interpolate(frame, camKeys, [-2.2, -0.6, 0.9, 2.0], { ...CLAMP, easing: EASE }),
    interpolate(frame, camKeys, [1.7, 1.5, 1.35, 1.2], { ...CLAMP, easing: EASE }),
    interpolate(frame, camKeys, [11.6, 10.8, 10.2, 9.8], { ...CLAMP, easing: EASE }) * zBoost,
  ];
  const camLook: Vec3 = [
    interpolate(frame, camKeys, [-1.4, -0.3, 0.5, 1.1], { ...CLAMP, easing: EASE }),
    0.1,
    0,
  ];

  // ── idle motion (frame-derived) ──────────────────────────────────────────
  const robotBob = breathAt(frame, 150) * 0.1;
  const droneLBob = breathAt(frame, 120, 0) * 0.22;
  const droneRBob = breathAt(frame, 120, 60) * 0.22;
  const hexSpin = frame * 0.012;
  const badgeSpin = frame * 0.01;

  const hexEdges = useMemo(
    () => new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.52, 0.52, 0.72, 6)),
    [],
  );

  return (
    <AbsoluteFill>
      <FilmGrade aberration={0.5}>
        <ConceptThreeCanvas fov={40}>
          <StageEnvironment intensity={1} exposure={1.08} />
          <CameraRig position={camPos} lookAt={camLook} />
          <Stars frame={frame} count={30} />
          <StudioFloor y={FLOOR_Y} size={34} opacity={floorIn} />

          {/* Contact shadows ground every prop. */}
          <ContactShadow position={[-4.3, SHADOW_Y, -0.4]} radius={1.0} opacity={rocketIn * 0.65} />
          <ContactShadow position={[-2.5, SHADOW_Y, 0.3]} radius={0.8} opacity={droneLIn * 0.5} />
          <ContactShadow position={[0, SHADOW_Y, 0.7]} radius={1.3} opacity={robotIn * 0.75} scale={[1, 0.85]} />
          <ContactShadow position={[2.5, SHADOW_Y, 0.3]} radius={0.8} opacity={droneRIn * 0.5} />
          <ContactShadow position={[4.3, SHADOW_Y, -0.4]} radius={1.1} opacity={computerIn * 0.6} />
          <ContactShadow position={[-1.5, SHADOW_Y, 2.1]} radius={0.7} opacity={hexIn * 0.6} />
          <ContactShadow position={[1.6, SHADOW_Y, 2.1]} radius={0.9} opacity={boomboxIn * 0.6} scale={[1.3, 1]} />

          {/* SaaS launch — rocket on a pad (far left). */}
          {rocketIn > 0.001 ? (
            <group position={[-4.3, FLOOR_Y + 1.15, -0.4]} scale={[2.2 * rocketIn, 2.2 * rocketIn, 2.2 * rocketIn]}>
              <GltfModel
                src={ROCKET}
                normalize
                rotation={[0, 0.5, 0]}
                brandify={{ base: PALETTE.amberDeep, accent: PALETTE.emerald, glowParts: ['window', 'thruster', 'flame'], emissive: PALETTE.amberLight }}
                envMapIntensity={1.3}
              />
            </group>
          ) : null}
          {/* Pad. */}
          <mesh position={[-4.3, FLOOR_Y + 0.06, -0.4]} scale={[rocketIn, 1, rocketIn]}>
            <cylinderGeometry args={[0.85, 1.0, 0.12, 8]} />
            <meshStandardMaterial color={THEME.bgDeep} metalness={0.85} roughness={0.4} emissive={PALETTE.emerald} emissiveIntensity={0.12} envMapIntensity={1.2} />
          </mesh>
          <Glow color={PALETTE.amber} scale={2.0} opacity={rocketIn * 0.3} position={[-4.3, FLOOR_Y + 0.9, -0.4]} />

          {/* Agent squad — drone (left, hovering). */}
          {droneLIn > 0.001 ? (
            <group position={[-2.5, FLOOR_Y + 1.1 + droneLBob, 0.3]} scale={[1.4 * droneLIn, 1.4 * droneLIn, 1.4 * droneLIn]}>
              <GltfModel
                src={DRONE}
                normalize
                rotation={[0.1, 0.6, 0]}
                brandify={{ base: PALETTE.emerald, accent: PALETTE.amber, glowParts: [], emissive: PALETTE.emeraldLight }}
                envMapIntensity={1.3}
              />
            </group>
          ) : null}
          <Glow color={PALETTE.emerald} scale={1.4} opacity={droneLIn * 0.4} position={[-2.5, FLOOR_Y + 1.1, 0.3]} />

          {/* Hero agent (center). */}
          {robotIn > 0.001 ? (
            <group position={[0, FLOOR_Y + robotBob, 0.7]} scale={[2.6 * robotIn, 2.6 * robotIn, 2.6 * robotIn]}>
              <GltfModel
                src={ROBOT}
                normalize
                position={[0, 0.5, 0]}
                rotation={[0, 0.2, 0]}
                brandify={{ base: PALETTE.amber, accent: PALETTE.amberLight, glowParts: ['head_4'], emissive: PALETTE.emeraldLight, emissiveIntensity: 0.75 }}
                envMapIntensity={1.2}
              />
            </group>
          ) : null}
          <Glow color={PALETTE.emerald} scale={3.6} opacity={robotIn * 0.15} position={[0, 0.5, -0.2]} />
          <Glow color={PALETTE.amber} scale={1.9} opacity={robotIn * 0.08} position={[0, 0.1, -0.1]} />
          <Label text="AGENT" position={[0, FLOOR_Y + 0.14, 1.7]} height={0.24} color={THEME.textSoft} opacity={robotIn * 0.7} />

          {/* Agent squad — drone (right, hovering). */}
          {droneRIn > 0.001 ? (
            <group position={[2.5, FLOOR_Y + 1.1 + droneRBob, 0.3]} scale={[1.4 * droneRIn, 1.4 * droneRIn, 1.4 * droneRIn]}>
              <GltfModel
                src={DRONE}
                normalize
                rotation={[0.1, -0.6, 0]}
                brandify={{ base: PALETTE.emerald, accent: PALETTE.amber, glowParts: [], emissive: PALETTE.emeraldLight }}
                envMapIntensity={1.3}
              />
            </group>
          ) : null}
          <Glow color={PALETTE.emerald} scale={1.4} opacity={droneRIn * 0.4} position={[2.5, FLOOR_Y + 1.1, 0.3]} />

          {/* Setup-wizard console (right). */}
          {computerIn > 0.001 ? (
            <group position={[4.3, FLOOR_Y + 0.55, -0.4]} scale={[1.6 * computerIn, 1.6 * computerIn, 1.6 * computerIn]}>
              <GltfModel
                src={COMPUTER}
                normalize
                rotation={[0, -0.6, 0]}
                brandify={{ base: '#454b55', accent: PALETTE.emerald, glowParts: ['screen', 'monitor', 'display'], emissive: PALETTE.emeraldLight, metalness: 0.5, roughness: 0.52 }}
                envMapIntensity={1.1}
              />
            </group>
          ) : null}
          <Glow color={PALETTE.emerald} scale={1.8} opacity={computerIn * 0.3} position={[4.3, FLOOR_Y + 0.7, -0.4]} />

          {/* Nx / hexagonal — a brandified hex prism, front-left. */}
          <group position={[-1.5, FLOOR_Y + 0.42, 2.1]} scale={[hexIn, hexIn, hexIn]}>
            <mesh rotation={[0, hexSpin, 0]}>
              <cylinderGeometry args={[0.52, 0.52, 0.72, 6]} />
              <meshStandardMaterial color={PALETTE.amber} metalness={0.62} roughness={0.46} emissive={PALETTE.amber} emissiveIntensity={0.08} envMapIntensity={1.15} />
            </mesh>
            <lineSegments geometry={hexEdges} rotation={[0, hexSpin, 0]} scale={[1.03, 1.03, 1.03]}>
              <lineBasicMaterial color={PALETTE.emeraldLight} transparent opacity={0.7} />
            </lineSegments>
          </group>

          {/* Nx / data-center unit — a brandified primitive server rack
              (no reliable CC0 rack GLB existed; see CREDITS.md). */}
          <group position={[1.6, FLOOR_Y + 0.7, 2.0]} rotation={[0, -0.35, 0]} scale={[boomboxIn, boomboxIn, boomboxIn]}>
            <mesh>
              <boxGeometry args={[0.95, 1.4, 0.7]} />
              <meshStandardMaterial color="#3c424c" metalness={0.7} roughness={0.42} envMapIntensity={1.2} />
            </mesh>
            {[0.5, 0.24, -0.02, -0.28, -0.54].map((sy) => (
              <mesh key={sy} position={[0, sy, 0.36]}>
                <boxGeometry args={[0.72, 0.08, 0.03]} />
                <meshStandardMaterial color={PALETTE.emerald} emissive={PALETTE.emerald} emissiveIntensity={1.4} toneMapped={false} />
              </mesh>
            ))}
          </group>
          <Glow color={PALETTE.emerald} scale={1.6} opacity={boomboxIn * 0.28} position={[1.6, FLOOR_Y + 0.7, 2.0]} />

          {/* Pillar badges — small extruded Icon3D tags above key props. */}
          <group scale={[badgeIn, badgeIn, badgeIn]}>
            <Icon3D glyph="play" color={PALETTE.amber} size={0.42} position={[-4.3, FLOOR_Y + 2.7, -0.4]} rotation={[0.15, badgeSpin, 0]} emissiveIntensity={0.7} />
            <Icon3D glyph="bolt" color={PALETTE.emerald} size={0.46} position={[0, FLOOR_Y + 3.15, 0.5]} rotation={[0.15, -badgeSpin, 0]} emissiveIntensity={0.7} />
            <Icon3D glyph="cpu" color={PALETTE.emerald} size={0.4} position={[4.3, FLOOR_Y + 2.0, -0.4]} rotation={[0.15, badgeSpin, 0]} emissiveIntensity={0.7} />
            <Icon3D glyph="shield" color={PALETTE.amberLight} size={0.34} position={[-1.5, FLOOR_Y + 1.5, 2.1]} rotation={[0.15, -badgeSpin, 0]} emissiveIntensity={0.65} />
          </group>
        </ConceptThreeCanvas>
      </FilmGrade>

      <CaptionRail slide={slide} durationFrames={durationFrames} width={width} />
    </AbsoluteFill>
  );
};
