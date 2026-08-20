/**
 * McpResult — Act 4: THE PAYOFF. One bright packet leaves the sandbox and
 * arcs home to the agent. The context gauge that screamed red in Act 1 sits
 * small and green. The scene dims into the closing line.
 *
 *  p1 return  — the single result packet arcs chamber → agent, with a trail
 *  p2 lean    — agent flares on arrival; the tiny green CONTEXT gauge holds
 *  p3 close   — everything dims; "21 NAMESPACES / ONE TOOL CALL" + wordmark
 *
 * Fully frame-driven / deterministic (three-kit contract).
 */
import React, { useMemo } from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import * as THREE from 'three';
import type { ConceptSceneProps } from '../PromoReel';
import { CaptionRail } from '../concept/scene-kit';
import { BRAND } from '../brand.config';
import {
  breathAt,
  CameraRig,
  ConceptThreeCanvas,
  Glow,
  Label,
  LightRig,
  lerp3,
  PALETTE,
  Stars,
  type Vec3,
} from './three-kit';

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const EASE = Easing.inOut(Easing.cubic);

const AGENT: Vec3 = [-3.6, -0.1, 0];
const CHAMBER: Vec3 = [3.9, 0.4, -0.8];
const GREEN = '#34d399';

export const McpResult: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const pf = durationFrames / 3;
  const zBoost = width >= height ? 1 : 1.8;

  const enter = interpolate(frame, [0, pf * 0.3], [0, 1], { ...CLAMP, easing: EASE });

  // The one result packet, arcing home.
  const travel = interpolate(frame, [pf * 0.2, pf * 1.15], [0, 1], { ...CLAMP, easing: EASE });
  const arrived = travel >= 1;
  const flare = arrived ? interpolate(frame, [pf * 1.15, pf * 1.45], [1.6, 0.55], CLAMP) : 0;

  // p3: dim the scene, raise the closing type.
  const closeIn = interpolate(frame, [2 * pf, 2.45 * pf], [0, 1], { ...CLAMP, easing: EASE });
  const dim = 1 - closeIn * 0.75;

  const camPos: Vec3 = [
    interpolate(frame, [0, durationFrames], [0.5, 0], { ...CLAMP, easing: EASE }),
    interpolate(frame, [0, durationFrames], [1.0, 0.4], { ...CLAMP, easing: EASE }),
    interpolate(frame, [0, durationFrames], [10.6, 8.6], { ...CLAMP, easing: EASE }) * zBoost,
  ];

  const chamberEdges = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(2.4, 1.6, 1.6)),
    [],
  );

  const trailSteps = [0, 0.045, 0.09, 0.14, 0.2];

  return (
    <AbsoluteFill>
      <ConceptThreeCanvas>
        <LightRig />
        <CameraRig position={camPos} lookAt={[0, 0.2, 0]} />
        <Stars frame={frame} />

        {/* The sandbox, receding behind us. */}
        <group position={CHAMBER}>
          <lineSegments geometry={chamberEdges}>
            <lineBasicMaterial color="#8ea2ff" transparent opacity={0.35 * enter * dim} />
          </lineSegments>
          <Glow color={PALETTE.indigo} scale={2.4} opacity={0.25 * enter * dim} />
        </group>

        {/* The agent, waiting. */}
        <group position={AGENT}>
          <mesh>
            <icosahedronGeometry args={[0.34, 2]} />
            <meshStandardMaterial
              color={PALETTE.amber}
              emissive={PALETTE.amber}
              emissiveIntensity={(0.6 + breathAt(frame, 60) * 0.25 + flare) * dim}
              metalness={0.3}
              roughness={0.35}
            />
          </mesh>
          <Glow color={PALETTE.amber} scale={1.8 + flare} opacity={(0.5 + flare * 0.3) * dim} />
          <Label text="AGENT" position={[0, 0.72, 0]} height={0.26} opacity={dim} />
        </group>

        {/* The context gauge — small, green, calm. The anti-Act-1. */}
        <group position={[AGENT[0] - 1.1, -0.4, 0]}>
          <mesh>
            <boxGeometry args={[0.2, 1.4, 0.2]} />
            <meshStandardMaterial color="#0e1526" transparent opacity={0.85 * enter * dim} />
          </mesh>
          <mesh position={[0, -0.7 * (1 - 0.16), 0]}>
            <boxGeometry args={[0.21, 1.4 * 0.16, 0.21]} />
            <meshStandardMaterial color={GREEN} emissive={GREEN} emissiveIntensity={0.9 * dim} />
          </mesh>
          <Label
            text="CONTEXT"
            position={[0, -1.05, 0]}
            height={0.16}
            color={GREEN}
            opacity={enter * 0.9 * dim}
          />
        </group>

        {/* The single result packet + comet trail. */}
        {travel > 0 && !arrived
          ? trailSteps.map((back, k) => {
              const t = Math.max(0, travel - back);
              const p = lerp3(CHAMBER, AGENT, t);
              p[1] += Math.sin(t * Math.PI) * 1.1;
              return (
                <React.Fragment key={k}>
                  <Glow
                    color={k === 0 ? '#ffffff' : GREEN}
                    scale={k === 0 ? 0.5 : 0.4 - k * 0.06}
                    opacity={(k === 0 ? 1 : 0.5 - k * 0.09) * dim}
                    position={p}
                  />
                </React.Fragment>
              );
            })
          : null}

        {/* Closing type. */}
        <group position={[0, 0.55, 2]}>
          <Label
            text="21 NAMESPACES. ONE TOOL CALL."
            position={[0, 0.35, 0]}
            height={0.42}
            color="#ffffff"
            opacity={closeIn}
          />
          <Label
            text={BRAND.wordmark}
            position={[0, -0.42, 0]}
            height={0.62}
            color={PALETTE.amber}
            opacity={closeIn}
          />
          <Label
            text={BRAND.tagline}
            position={[0, -1.02, 0]}
            height={0.2}
            color="#9fb0e8"
            opacity={closeIn * 0.9}
          />
          <Glow color={PALETTE.amber} scale={5.5} opacity={closeIn * 0.16} position={[0, -0.4, -0.5]} />
        </group>
      </ConceptThreeCanvas>

      <CaptionRail slide={slide} durationFrames={durationFrames} width={width} />
    </AbsoluteFill>
  );
};
