/**
 * McpRoundtrips — Act 1 of the code-execution story: THE PROBLEM.
 *
 * An agent node faces a wall of 25 MCP tool tiles. Packets ping-pong one at a
 * time — agent → tool → agent — each trip slow and serial, while a CONTEXT
 * gauge beside the agent fills toward red (every tool schema rides along in
 * the window). Three beats:
 *
 *  p1 round-trips — the serial ping-pong starts, one tool at a time
 *  p2 schema bloat — ghost schema cubes drift from the wall into the agent
 *  p3 saturation  — trips stack up, the gauge hits red and pulse-warns
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
  lerp3,
  PALETTE,
  Stars,
  type Vec3,
} from './three-kit';

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const EASE = Easing.inOut(Easing.cubic);

const AGENT: Vec3 = [-4.1, 0, 0];
const RED = '#f87171';
const GREEN = '#34d399';

/** 5×5 tool wall, facing the camera on the right side of frame. */
const WALL_COLS = 5;
const WALL_ROWS = 5;
const wallPos = (i: number): Vec3 => [
  2.35 + (i % WALL_COLS) * 0.62,
  -1.24 + Math.floor(i / WALL_COLS) * 0.62,
  0,
];

/** One serial round trip every TRIP_PERIOD frames, visiting seeded tools. */
const TRIP_PERIOD = 34;

export const McpRoundtrips: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const pf = durationFrames / 3;
  const zBoost = width >= height ? 1 : 1.8;

  const enter = interpolate(frame, [0, pf * 0.4], [0, 1], { ...CLAMP, easing: EASE });

  // Serial trips: which trip is in flight, and how far along it is.
  const tripIndex = Math.floor(frame / TRIP_PERIOD);
  const tripLocal = (frame % TRIP_PERIOD) / TRIP_PERIOD;
  const tripTargets = seededSeries(31, 64).map((v) => Math.floor(v * WALL_COLS * WALL_ROWS));
  const target = wallPos(tripTargets[tripIndex % tripTargets.length]);
  // Out for the first half, back for the second — with a vertical arc.
  const outward = tripLocal < 0.5;
  const t = outward ? tripLocal * 2 : (tripLocal - 0.5) * 2;
  const packetPos = outward ? lerp3(AGENT, target, t) : lerp3(target, AGENT, t);
  packetPos[1] += Math.sin(Math.min(1, outward ? t : 1 - t) * Math.PI) * 0.55;
  const packetVisible = enter >= 1 ? 1 : 0;

  // Context gauge fills with each completed trip; red by p3.
  const gaugeFill = interpolate(frame, [pf * 0.4, durationFrames * 0.92], [0.08, 1], {
    ...CLAMP,
    easing: Easing.out(Easing.quad),
  });
  const gaugeColor = gaugeFill < 0.45 ? GREEN : gaugeFill < 0.75 ? PALETTE.amber : RED;
  const gaugeWarn = gaugeFill > 0.9 ? breathAt(frame, 16) * 0.5 : 0;

  // Ghost schema cubes drifting wall → agent from p2 on.
  const ghosts = seededSeries(53, 10 * 3);
  const ghostsIn = interpolate(frame, [pf, pf * 1.5], [0, 1], CLAMP);

  // Slow lateral dolly with a gentle push-in.
  const camPos: Vec3 = [
    interpolate(frame, [0, durationFrames], [-0.7, 0.7], { ...CLAMP, easing: EASE }),
    interpolate(frame, [0, durationFrames], [1.1, 0.55], { ...CLAMP, easing: EASE }),
    interpolate(frame, [0, durationFrames], [10.6, 9.2], { ...CLAMP, easing: EASE }) * zBoost,
  ];

  const GAUGE_H = 2.1;

  return (
    <AbsoluteFill>
      <ConceptThreeCanvas>
        <LightRig />
        <CameraRig position={camPos} lookAt={[0, 0, 0]} />
        <Stars frame={frame} />

        {/* The agent. */}
        <group position={AGENT} scale={[enter, enter, enter]}>
          <mesh>
            <icosahedronGeometry args={[0.34, 2]} />
            <meshStandardMaterial
              color={PALETTE.amber}
              emissive={PALETTE.amber}
              emissiveIntensity={0.6 + breathAt(frame, 60) * 0.25}
              metalness={0.3}
              roughness={0.35}
            />
          </mesh>
          <Glow color={PALETTE.amber} scale={1.8} opacity={0.5} />
          <Label text="AGENT" position={[0, 0.72, 0]} height={0.26} />
        </group>

        {/* Context gauge beside the agent. */}
        <group position={[AGENT[0] - 1.15, 0, 0]}>
          <mesh>
            <boxGeometry args={[0.22, GAUGE_H, 0.22]} />
            <meshStandardMaterial color="#0e1526" transparent opacity={0.85 * enter} />
          </mesh>
          <mesh position={[0, (-GAUGE_H / 2) * (1 - gaugeFill), 0]}>
            <boxGeometry args={[0.23, GAUGE_H * gaugeFill, 0.23]} />
            <meshStandardMaterial
              color={gaugeColor}
              emissive={gaugeColor}
              emissiveIntensity={0.8 + gaugeWarn}
            />
          </mesh>
          <Glow color={gaugeColor} scale={1.3} opacity={enter * (0.2 + gaugeWarn * 0.5)} />
          <Label
            text="CONTEXT"
            position={[0, -GAUGE_H / 2 - 0.34, 0]}
            height={0.17}
            color={gaugeColor}
            opacity={enter * 0.9}
          />
        </group>

        {/* The MCP tool wall. */}
        {Array.from({ length: WALL_COLS * WALL_ROWS }, (_, i) => {
          const pos = wallPos(i);
          const isTarget =
            i === tripTargets[tripIndex % tripTargets.length] && tripLocal > 0.4 && tripLocal < 0.62;
          const tileIn = interpolate(
            frame,
            [i * 1.1, i * 1.1 + pf * 0.3],
            [0, 1],
            { ...CLAMP, easing: EASE },
          );
          return (
            <mesh key={i} position={pos} scale={[tileIn, tileIn, tileIn]}>
              <boxGeometry args={[0.44, 0.44, 0.16]} />
              <meshStandardMaterial
                color={isTarget ? PALETTE.indigo : '#1b2440'}
                emissive={isTarget ? PALETTE.indigo : '#25305a'}
                emissiveIntensity={isTarget ? 1.4 : 0.3 + breathAt(frame, 90, i * 7) * 0.12}
                metalness={0.4}
                roughness={0.4}
              />
            </mesh>
          );
        })}
        <Label
          text="MCP TOOLS × 25"
          position={[3.6, 2.0, 0]}
          height={0.22}
          color="#9fb0e8"
          opacity={enter * 0.85}
        />

        {/* The one packet in flight — serial, always just one. */}
        <Glow color={outward ? PALETTE.amber : PALETTE.indigo} scale={0.42} opacity={packetVisible} position={packetPos} />

        {/* Ghost schema cubes drifting into the agent's context. */}
        {Array.from({ length: 10 }, (_, i) => {
          const drift = ((frame * (0.004 + ghosts[i * 3] * 0.003) + ghosts[i * 3 + 1]) % 1);
          const pos = lerp3(
            [2.4 + ghosts[i * 3] * 2.4, -1.4 + ghosts[i * 3 + 1] * 2.8, 0.4],
            [AGENT[0] - 0.9, -0.3 + ghosts[i * 3 + 2] * 0.8, 0.3],
            drift,
          );
          return (
            <mesh key={i} position={pos} rotation={[frame * 0.01 + i, frame * 0.008, 0]}>
              <boxGeometry args={[0.16, 0.16, 0.16]} />
              <meshBasicMaterial
                color="#8ea2ff"
                wireframe
                transparent
                opacity={ghostsIn * 0.35 * (1 - Math.abs(drift - 0.5) * 0.8)}
              />
            </mesh>
          );
        })}
      </ConceptThreeCanvas>

      <CaptionRail slide={slide} durationFrames={durationFrames} width={width} />
    </AbsoluteFill>
  );
};
