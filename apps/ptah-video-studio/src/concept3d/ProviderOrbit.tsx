/**
 * ProviderOrbit — the first true-3D concept scene: Ptah's hexagonal core with
 * every AI provider orbiting it as a swappable adapter. Four phases, one per
 * caption, on ONE persistent canvas (no PhaseStage remounts — the orbits never
 * stop, which IS the message):
 *
 *  p1 core     — the hexagonal core forms and starts its slow spin
 *  p2 orbit    — six provider nodes fly in to the orbital ring, staggered
 *  p3 dock     — one provider leaves orbit and docks to a hex face; an energy
 *                beam pulses core↔adapter with packets flowing along it
 *  p4 hot-swap — the docked provider releases back to orbit while another
 *                docks mid-flight; the work never pauses
 *
 * Fully frame-driven / deterministic (see three-kit's contract): every
 * position, weight, and pulse is interpolate()/math over useCurrentFrame().
 */
import React, { useMemo } from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
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
  LightRig,
  lerp3,
  PALETTE,
  saw,
  Stars,
  type Vec3,
} from './three-kit';

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const EASE = Easing.inOut(Easing.cubic);

/** The adapter families — distinct hues that read on the dark backdrop. */
const PROVIDERS = [
  { name: 'Claude', color: '#f0925c' },
  { name: 'Codex', color: '#7fd4c1' },
  { name: 'Copilot', color: '#7aa2ff' },
  { name: 'Kimi', color: '#b48cff' },
  { name: 'GLM', color: '#5eead4' },
  { name: 'Ollama', color: '#e2e8f0' },
] as const;

const CORE_R = 1.15; // hex prism circumradius
const ORBIT_R = 3.2; // provider ring radius
const ANCHOR: Vec3 = [1.95, 0, 0]; // dock point off the +X hex face
const DOCK_A = 0; // Claude docks in p3
const DOCK_B = 3; // Kimi hot-swaps in in p4
const ORBIT_SPEED = 0.006; // rad/frame — a stately ~11s revolution at 30fps

export const ProviderOrbit: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const pf = durationFrames / 4;

  // ── p1: the core forms ──────────────────────────────────────────────────
  const coreIn = interpolate(frame, [0, pf * 0.55], [0, 1], { ...CLAMP, easing: EASE });
  const ringIn = interpolate(frame, [pf * 0.5, pf], [0, 1], { ...CLAMP, easing: EASE });
  const coreRot = frame * 0.0045;

  // ── p3/p4: dock weights (0 = orbiting, 1 = docked at the hex face) ──────
  const dockIn = pf * 0.32;
  const wA = interpolate(
    frame,
    [2 * pf, 2 * pf + dockIn, 3 * pf, 3 * pf + dockIn],
    [0, 1, 1, 0],
    { ...CLAMP, easing: EASE },
  );
  const wB = interpolate(frame, [3 * pf + dockIn * 0.45, 3 * pf + dockIn * 1.45], [0, 1], {
    ...CLAMP,
    easing: EASE,
  });
  const dockTotal = Math.max(wA, wB);

  // ── camera dolly: wide → drift → punch in on the dock → pull back ───────
  const camKeys = [0, pf, 2 * pf, 2.6 * pf, 3.3 * pf, durationFrames];
  const zBoost = width >= height ? 1 : 1.8; // vertical promos sit further back
  const camPos: Vec3 = [
    interpolate(frame, camKeys, [0, 0.4, 2.6, 2.6, 1.2, 0], { ...CLAMP, easing: EASE }),
    interpolate(frame, camKeys, [2.8, 2.3, 1.3, 1.3, 1.9, 2.7], { ...CLAMP, easing: EASE }),
    interpolate(frame, camKeys, [10.5, 9.4, 6.6, 6.6, 8.2, 10.8], { ...CLAMP, easing: EASE }) *
      zBoost,
  ];
  const camLook: Vec3 = [
    interpolate(frame, camKeys, [0, 0, 1.0, 1.0, 0.4, 0], { ...CLAMP, easing: EASE }),
    0,
    0,
  ];

  // ── provider nodes: staggered fly-in during p2, then perpetual orbit ────
  const nodes = PROVIDERS.map((provider, i) => {
    const enter = interpolate(
      frame,
      [pf * (1 + i * 0.09), pf * (1 + i * 0.09) + pf * 0.5],
      [0, 1],
      { ...CLAMP, easing: EASE },
    );
    const angle = (i / PROVIDERS.length) * Math.PI * 2 + frame * ORBIT_SPEED;
    const radius = interpolate(enter, [0, 1], [ORBIT_R * 3.4, ORBIT_R]);
    const orbitPos: Vec3 = [
      Math.cos(angle) * radius,
      Math.sin(angle * 2 + i * 1.7) * 0.16,
      Math.sin(angle) * radius,
    ];
    const dock = i === DOCK_A ? wA : i === DOCK_B ? wB : 0;
    return { provider, enter, dock, position: lerp3(orbitPos, ANCHOR, dock) };
  });

  // ── the energy beam core↔docked adapter ─────────────────────────────────
  const beamFrom = CORE_R * 0.92;
  const beamTo = ANCHOR[0] - 0.24;
  const beamLen = beamTo - beamFrom;
  const beamColor =
    wB > wA ? PROVIDERS[DOCK_B].color : PROVIDERS[DOCK_A].color;
  const beamOpacity = dockTotal * (0.45 + 0.4 * breathAt(frame, 26));

  const corePulse = 0.45 + dockTotal * 1.1 + breathAt(frame, 70) * 0.25;

  // Clean hex outline — EdgesGeometry drops the coplanar triangulation lines a
  // plain `wireframe` material would draw across every face.
  const coreEdges = useMemo(
    () => new THREE.EdgesGeometry(new THREE.CylinderGeometry(CORE_R, CORE_R, 0.6, 6)),
    [],
  );

  return (
    <AbsoluteFill>
      <ConceptThreeCanvas>
        <LightRig />
        <CameraRig position={camPos} lookAt={camLook} />
        <Stars frame={frame} />

        {/* Hexagonal core — the shared Ptah runtime every adapter plugs into. */}
        <group rotation={[0, coreRot, 0]} scale={[coreIn, coreIn, coreIn]}>
          <mesh>
            <cylinderGeometry args={[CORE_R, CORE_R, 0.6, 6]} />
            <meshStandardMaterial
              color="#131a30"
              metalness={0.55}
              roughness={0.3}
              emissive={PALETTE.indigo}
              emissiveIntensity={corePulse}
            />
          </mesh>
          <lineSegments geometry={coreEdges} scale={[1.02, 1.02, 1.02]}>
            <lineBasicMaterial color="#aebcff" transparent opacity={0.55} />
          </lineSegments>
        </group>
        <Glow color={PALETTE.indigo} scale={4.6} opacity={coreIn * (0.32 + dockTotal * 0.25)} />
        <Label
          text="PTAH CORE"
          position={[0, -1.05, 0]}
          height={0.22}
          color={THEME.textSoft}
          opacity={coreIn * (1 - dockTotal * 0.35)}
        />

        {/* Orbital ring the providers ride. */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[ORBIT_R, 0.006, 8, 160]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.13 * ringIn} />
        </mesh>

        {/* Provider adapters. */}
        {nodes.map(({ provider, enter, dock, position }, i) => (
          <group key={provider.name} position={position}>
            <mesh>
              <icosahedronGeometry args={[0.22, 1]} />
              <meshStandardMaterial
                color={provider.color}
                metalness={0.25}
                roughness={0.35}
                emissive={provider.color}
                emissiveIntensity={0.5 + dock * 0.9 + breathAt(frame, 48, i * 11) * 0.2}
                transparent
                opacity={enter}
              />
            </mesh>
            <Glow color={provider.color} scale={1.15 + dock * 0.6} opacity={enter * 0.5} />
            <Label
              text={provider.name}
              position={[0, 0.52, 0]}
              height={0.24}
              opacity={enter * 0.92}
            />
          </group>
        ))}

        {/* Energy beam + packets while an adapter is docked. */}
        {dockTotal > 0.01 ? (
          <>
            <mesh
              position={[(beamFrom + beamTo) / 2, 0, 0]}
              rotation={[0, 0, Math.PI / 2]}
            >
              <cylinderGeometry args={[0.035, 0.035, beamLen, 12]} />
              <meshBasicMaterial
                color={beamColor}
                transparent
                opacity={beamOpacity}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </mesh>
            {Array.from({ length: 3 }, (_, k) => {
              const t = saw(frame, 24, k * 8);
              return (
                <Glow
                  key={k}
                  color={beamColor}
                  scale={0.3}
                  opacity={dockTotal * (1 - t * 0.35)}
                  position={[beamFrom + beamLen * t, 0, 0]}
                />
              );
            })}
          </>
        ) : null}
      </ConceptThreeCanvas>

      <CaptionRail slide={slide} durationFrames={durationFrames} width={width} />
    </AbsoluteFill>
  );
};
