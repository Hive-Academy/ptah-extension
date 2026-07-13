/**
 * McpOneTool — Act 2: THE COLLAPSE. The 25-tile tool wall spirals inward and
 * fuses into a single glowing portal ring — `execute_code` — and the camera
 * flies THROUGH the ring, handing off to the sandbox act. Three beats:
 *
 *  p1 gather   — tiles leave the grid, spiraling toward the center
 *  p2 fuse     — the portal torus ignites as the last tiles melt into it
 *  p3 through  — one clean packet enters; the camera dollies through the ring
 *
 * Fully frame-driven / deterministic (three-kit contract).
 */
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ConceptSceneProps } from '../PromoReel';
import { CaptionRail } from '../concept/scene-kit';
import { seededSeries } from '../components/effects/seeded-random';
import {
  breathAt,
  CameraRig,
  ConceptThreeCanvas,
  Glow,
  Label,
  LightRig,
  PALETTE,
  Stars,
  type Vec3,
} from './three-kit';

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const EASE = Easing.inOut(Easing.cubic);

const TILES = 25;
const PORTAL_R = 1.5;

export const McpOneTool: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const pf = durationFrames / 3;
  const zBoost = width >= height ? 1 : 1.8;

  const rnd = seededSeries(17, TILES * 2);

  // Portal ignition and pulse.
  const portalIn = interpolate(frame, [pf * 0.9, pf * 1.6], [0, 1], { ...CLAMP, easing: EASE });
  const portalPulse = 0.7 + breathAt(frame, 30) * 0.5 + portalIn * 0.4;

  // The single packet passing through in p3.
  const packetT = interpolate(frame, [2 * pf, 2.7 * pf], [0, 1], { ...CLAMP, easing: EASE });
  const packetPos: Vec3 = [
    interpolate(packetT, [0, 1], [-5.2, 0.6]),
    Math.sin(packetT * Math.PI) * 0.35,
    interpolate(packetT, [0, 1], [0.4, -1.2]),
  ];

  // Camera: settle on the portal, then FLY THROUGH it as the act ends.
  const camPos: Vec3 = [
    interpolate(frame, [0, 2 * pf, durationFrames], [0.5, 0, 0], { ...CLAMP, easing: EASE }),
    interpolate(frame, [0, 2 * pf, durationFrames], [1.0, 0.3, 0], { ...CLAMP, easing: EASE }),
    interpolate(frame, [0, 2 * pf, 2.55 * pf, durationFrames], [10.4, 8.6, 8.6, 0.7], {
      ...CLAMP,
      easing: Easing.in(Easing.cubic),
    }) * zBoost,
  ];

  return (
    <AbsoluteFill>
      <ConceptThreeCanvas>
        <LightRig />
        <CameraRig position={camPos} lookAt={[0, 0, -1]} />
        <Stars frame={frame} />

        {/* Tiles spiraling from their old grid slots into the portal rim. */}
        {Array.from({ length: TILES }, (_, i) => {
          const gridPos: Vec3 = [
            2.35 + (i % 5) * 0.62,
            -1.24 + Math.floor(i / 5) * 0.62,
            0,
          ];
          const gather = interpolate(
            frame,
            [i * 1.6, i * 1.6 + pf * 1.1],
            [0, 1],
            { ...CLAMP, easing: EASE },
          );
          // Spiral path: angle winds 1.5 turns while radius shrinks to the rim.
          const targetAngle = rnd[i * 2] * Math.PI * 2;
          const angle = targetAngle + (1 - gather) * Math.PI * 3;
          const radius = interpolate(gather, [0, 1], [4.6, PORTAL_R]);
          const spiralPos: Vec3 = [
            Math.cos(angle) * radius,
            Math.sin(angle) * radius * 0.55,
            interpolate(gather, [0, 1], [0.6 + rnd[i * 2 + 1] * 1.4, -1.2]),
          ];
          const pos: Vec3 = [
            gridPos[0] * (1 - gather) + spiralPos[0] * gather,
            gridPos[1] * (1 - gather) + spiralPos[1] * gather,
            gridPos[2] * (1 - gather) + spiralPos[2] * gather,
          ];
          // Melt into the ring: shrink + fade as the portal ignites.
          const melt = interpolate(gather, [0.82, 1], [1, 0], CLAMP);
          const s = 0.9 * melt + 0.05;
          return (
            <mesh key={i} position={pos} rotation={[gather * 4, gather * 5 + i, 0]} scale={[s, s, s]}>
              <boxGeometry args={[0.4, 0.4, 0.14]} />
              <meshStandardMaterial
                color="#1b2440"
                emissive={PALETTE.indigo}
                emissiveIntensity={0.35 + gather * 1.3}
                transparent
                opacity={melt}
              />
            </mesh>
          );
        })}

        {/* The portal — one tool. */}
        <group position={[0, 0, -1.2]}>
          <mesh scale={[portalIn, portalIn, portalIn]}>
            <torusGeometry args={[PORTAL_R, 0.055, 16, 100]} />
            <meshStandardMaterial
              color={PALETTE.amber}
              emissive={PALETTE.amber}
              emissiveIntensity={portalPulse}
              metalness={0.4}
              roughness={0.25}
            />
          </mesh>
          <Glow color={PALETTE.amber} scale={4.2} opacity={portalIn * 0.4} />
          <Glow color="#fff3d6" scale={1.6} opacity={portalIn * 0.25} />
          <Label
            text="execute_code"
            position={[0, 0, 0]}
            height={0.3}
            color="#fff3d6"
            opacity={portalIn}
          />
          <Label
            text="ONE TOOL"
            position={[0, PORTAL_R + 0.5, 0]}
            height={0.22}
            color="#ffffff"
            opacity={portalIn * 0.85}
          />
        </group>

        {/* The single packet that replaces 25 round trips. */}
        {packetT > 0 ? (
          <>
            <Glow color="#ffffff" scale={0.5} opacity={0.95} position={packetPos} />
            <Glow color={PALETTE.amber} scale={1.1} opacity={0.5} position={packetPos} />
          </>
        ) : null}
      </ConceptThreeCanvas>

      <CaptionRail slide={slide} durationFrames={durationFrames} width={width} />
    </AbsoluteFill>
  );
};
