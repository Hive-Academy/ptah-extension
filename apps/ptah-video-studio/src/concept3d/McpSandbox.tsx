/**
 * McpSandbox — Act 3, the HERO scene: inside the code-execution engine.
 *
 * A glass chamber materializes; the agent's code card flies in; the `ptah`
 * core ignites with all 21 API namespaces orbiting it as a constellation.
 * Then the code EXECUTES: a highlight bar steps through the lines while
 * packets fly card → namespace → card, and finally everything fires at once —
 * chained calls at machine speed, intermediate results never leaving the box.
 *
 *  p1 chamber  — the sandbox walls draw in, the code card docks
 *  p2 the api  — `ptah` core + 21 namespace nodes pop in, staggered
 *  p3 execute  — line-by-line: each line lights its namespace, packets fly
 *  p4 machine  — every node pulses, simultaneous packet storm, core blazes
 *
 * Fully frame-driven / deterministic (three-kit contract). The code texture
 * is drawn synchronously into a CanvasTexture (no async loads).
 */
import React, { useMemo } from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import * as THREE from 'three';
import type { ConceptSceneProps } from '../PromoReel';
import { CaptionRail } from '../concept/scene-kit';
import { seededSeries } from '../components/effects/seeded-random';
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

/** The real PtahAPI namespaces (ptah-api-builder.service.ts). */
const NAMESPACES = [
  'workspace', 'search', 'diagnostics', 'files', 'context', 'project',
  'relevance', 'dependencies', 'ast', 'ide', 'orchestration', 'agent',
  'git', 'json', 'browser', 'web', 'skill', 'memory', 'corpus', 'code', 'harness',
] as const;

/** The code the agent "wrote" — each line executes against one namespace. */
const CODE_LINES: { segments: [string, string][]; namespace: string }[] = [
  {
    segments: [['const files = await ', '#c9d4f5'], ['ptah.search', '#5eead4'], ['.findFiles(', '#c9d4f5'], [`'src/**'`, '#f5b544'], [')', '#c9d4f5']],
    namespace: 'search',
  },
  {
    segments: [['const tree = await ', '#c9d4f5'], ['ptah.ast', '#5eead4'], ['.analyze(files[0])', '#c9d4f5']],
    namespace: 'ast',
  },
  {
    segments: [['const past = await ', '#c9d4f5'], ['ptah.memory', '#5eead4'], ['.search(', '#c9d4f5'], [`'auth'`, '#f5b544'], [')', '#c9d4f5']],
    namespace: 'memory',
  },
  {
    segments: [['await ', '#c9d4f5'], ['ptah.browser', '#5eead4'], ['.screenshot()', '#c9d4f5']],
    namespace: 'browser',
  },
  {
    segments: [['const run = await ', '#c9d4f5'], ['ptah.agent', '#5eead4'], ['.spawn({ task })', '#c9d4f5']],
    namespace: 'agent',
  },
  {
    segments: [['return', '#8ea2ff'], [' summarize(run)', '#c9d4f5']],
    namespace: 'code',
  },
];

const CARD_POS: Vec3 = [-1.7, 0.12, 0.45];
const CARD_W = 2.6;
const CARD_H = 1.7;
const CORE_POS: Vec3 = [1.45, 0, 0];
const RING_R = 1.7;

/** Draw the code panel once, synchronously, into a texture (module cache). */
let codeTexture: THREE.CanvasTexture | null = null;
function getCodeTexture(): THREE.CanvasTexture {
  if (codeTexture) return codeTexture;
  const W = 1024;
  const H = Math.round((W * CARD_H) / CARD_W);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  ctx.fillStyle = 'rgba(9, 14, 28, 0.94)';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(142, 162, 255, 0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
  // Title bar.
  ctx.fillStyle = 'rgba(142, 162, 255, 0.12)';
  ctx.fillRect(0, 0, W, 74);
  ctx.font = `700 34px ${THEME.font}`;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText('execute_code · sandbox', 32, 50);
  // Code lines.
  const mono = '600 31px Consolas, "Cascadia Code", monospace';
  CODE_LINES.forEach((line, i) => {
    const y = 74 + 56 + i * 84;
    ctx.font = mono;
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillText(String(i + 1), 26, y);
    let x = 70;
    for (const [text, color] of line.segments) {
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      x += ctx.measureText(text).width;
    }
  });
  codeTexture = new THREE.CanvasTexture(canvas);
  codeTexture.colorSpace = THREE.SRGBColorSpace;
  return codeTexture;
}

/** World-space Y (card-local) of a code line's center, for the highlight bar. */
function lineLocalY(i: number): number {
  const H = Math.round((1024 * CARD_H) / CARD_W);
  const centerPx = 74 + 56 + i * 84 - 13;
  return CARD_H / 2 - (centerPx / H) * CARD_H;
}

/** Position of namespace node i on the inclined ring around the core. */
function nodePos(i: number, ringRot: number): Vec3 {
  const a = (i / NAMESPACES.length) * Math.PI * 2 + ringRot;
  return [
    CORE_POS[0] + Math.cos(a) * RING_R,
    CORE_POS[1] + Math.sin(a) * 0.52,
    CORE_POS[2] + Math.sin(a) * RING_R * 0.62,
  ];
}

export const McpSandbox: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const pf = durationFrames / 4;
  const zBoost = width >= height ? 1 : 1.8;

  // ── p1: chamber + card (brisk — an empty chamber is a dead frame) ───────
  const chamberIn = interpolate(frame, [0, pf * 0.4], [0, 1], { ...CLAMP, easing: EASE });
  const cardT = interpolate(frame, [pf * 0.15, pf * 0.6], [0, 1], { ...CLAMP, easing: EASE });
  const cardPos = lerp3([-6.5, 1.4, 2.6], CARD_POS, cardT);

  // ── p2: ptah core + namespace ring ──────────────────────────────────────
  const coreIn = interpolate(frame, [pf * 0.7, pf * 1.15], [0, 1], { ...CLAMP, easing: EASE });
  const ringRot = frame * 0.0035;

  // ── p3: line-by-line execution ──────────────────────────────────────────
  const execStart = 2 * pf;
  const execDur = pf;
  const perLine = execDur / CODE_LINES.length;
  const rawLine = (frame - execStart) / perLine;
  const activeLine = frame >= execStart ? Math.min(CODE_LINES.length - 1, Math.floor(rawLine)) : -1;
  const lineLocal = frame >= execStart ? Math.min(1, rawLine - activeLine) : 0;
  const executing = activeLine >= 0 && frame < 3 * pf;

  // ── p4: machine-speed storm ─────────────────────────────────────────────
  const storm = interpolate(frame, [3 * pf, 3.35 * pf], [0, 1], { ...CLAMP, easing: EASE });
  const stormTargets = seededSeries(41, 24).map((v) => Math.floor(v * NAMESPACES.length));

  const corePulse =
    0.55 + coreIn * 0.3 + (executing ? 0.9 : 0) + storm * 1.4 + breathAt(frame, 40) * 0.25;

  // ── camera: wide → settle → punch in on the ring → easing pull-back ─────
  const camKeys = [0, pf, 2 * pf, 3 * pf, durationFrames];
  const camPos: Vec3 = [
    interpolate(frame, camKeys, [0, 0.8, 1.7, 1.0, 0.3], { ...CLAMP, easing: EASE }),
    interpolate(frame, camKeys, [1.6, 1.0, 0.55, 0.8, 1.2], { ...CLAMP, easing: EASE }),
    interpolate(frame, camKeys, [10.8, 8.8, 6.4, 7.4, 9.2], { ...CLAMP, easing: EASE }) * zBoost,
  ];
  const camLook: Vec3 = [
    interpolate(frame, camKeys, [0, 0.3, 0.9, 0.5, 0], { ...CLAMP, easing: EASE }),
    0,
    0,
  ];

  const chamberEdges = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(6.0, 3.6, 3.6)),
    [],
  );

  return (
    <AbsoluteFill>
      <ConceptThreeCanvas>
        <LightRig />
        <CameraRig position={camPos} lookAt={camLook} />
        <Stars frame={frame} />

        {/* The sandbox chamber — glass walls + drawn edges. */}
        <group scale={[chamberIn, chamberIn, chamberIn]}>
          <mesh>
            <boxGeometry args={[6.0, 3.6, 3.6]} />
            <meshStandardMaterial
              color="#101a33"
              transparent
              opacity={0.1}
              metalness={0.6}
              roughness={0.15}
              side={THREE.BackSide}
            />
          </mesh>
          <lineSegments geometry={chamberEdges}>
            <lineBasicMaterial color="#8ea2ff" transparent opacity={0.4 * chamberIn} />
          </lineSegments>
          <Label
            text="SANDBOXED EXECUTION ENGINE"
            position={[0, 2.15, 0]}
            height={0.2}
            color="#9fb0e8"
            opacity={chamberIn * 0.85}
          />
        </group>

        {/* The agent's code, docked inside the chamber. */}
        <group position={cardPos} rotation={[0, (1 - cardT) * 0.9 + 0.16, 0]}>
          <mesh>
            <planeGeometry args={[CARD_W, CARD_H]} />
            <meshBasicMaterial map={getCodeTexture()} transparent opacity={Math.min(1, cardT * 1.2)} />
          </mesh>
          {/* Execution highlight bar sweeping the active line. */}
          {executing ? (
            <mesh position={[0, lineLocalY(activeLine), 0.01]}>
              <planeGeometry args={[CARD_W * 0.96, 0.17]} />
              <meshBasicMaterial
                color={PALETTE.amber}
                transparent
                opacity={0.22 + breathAt(frame, 14) * 0.1}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </mesh>
          ) : null}
        </group>

        {/* The ptah core. */}
        <group position={CORE_POS} rotation={[0, frame * 0.006, 0]} scale={[coreIn, coreIn, coreIn]}>
          <mesh>
            <cylinderGeometry args={[0.42, 0.42, 0.26, 6]} />
            <meshStandardMaterial
              color="#131a30"
              metalness={0.55}
              roughness={0.3}
              emissive={PALETTE.indigo}
              emissiveIntensity={corePulse}
            />
          </mesh>
        </group>
        <Glow color={PALETTE.indigo} scale={2.6 + storm} opacity={coreIn * (0.35 + storm * 0.3)} position={CORE_POS} />
        <Label
          text="ptah"
          position={[CORE_POS[0], CORE_POS[1] - 0.62, CORE_POS[2]]}
          height={0.26}
          color="#aebcff"
          opacity={coreIn}
        />

        {/* All 21 namespaces, orbiting the core. */}
        {NAMESPACES.map((name, i) => {
          const pop = interpolate(
            frame,
            [pf * 0.8 + i * 2.2, pf * 0.8 + i * 2.2 + pf * 0.35],
            [0, 1],
            { ...CLAMP, easing: EASE },
          );
          const pos = nodePos(i, ringRot);
          const isActive = executing && CODE_LINES[activeLine].namespace === name;
          const stormPulse = storm * breathAt(frame, 18, i * 5);
          const intensity = 0.45 + (isActive ? 1.6 : 0) + stormPulse * 1.2;
          return (
            <group key={name} position={pos}>
              <mesh scale={[pop, pop, pop]}>
                <icosahedronGeometry args={[0.085, 1]} />
                <meshStandardMaterial
                  color="#5eead4"
                  emissive="#5eead4"
                  emissiveIntensity={intensity}
                  metalness={0.3}
                  roughness={0.4}
                />
              </mesh>
              <Glow color="#5eead4" scale={0.5 + (isActive ? 0.5 : 0) + stormPulse * 0.4} opacity={pop * 0.55} />
              <Label
                text={name}
                position={[0, 0.24, 0]}
                height={0.13}
                color={isActive ? '#ffffff' : '#9ce8db'}
                opacity={pop * (isActive ? 1 : 0.75)}
              />
            </group>
          );
        })}

        {/* p3 packets: card → active namespace → card. */}
        {executing
          ? (() => {
              const target = nodePos(
                NAMESPACES.indexOf(CODE_LINES[activeLine].namespace as (typeof NAMESPACES)[number]),
                ringRot,
              );
              const from: Vec3 = [cardPos[0] + CARD_W / 2 - 0.2, lineLocalY(activeLine) + cardPos[1], cardPos[2]];
              const outward = lineLocal < 0.5;
              const t = outward ? lineLocal * 2 : (lineLocal - 0.5) * 2;
              const p = outward ? lerp3(from, target, t) : lerp3(target, from, t);
              p[1] += Math.sin(t * Math.PI) * 0.3;
              return (
                <>
                  <Glow color="#ffffff" scale={0.3} opacity={0.95} position={p} />
                  <Glow color={outward ? PALETTE.amber : '#5eead4'} scale={0.7} opacity={0.55} position={p} />
                </>
              );
            })()
          : null}

        {/* p4 storm: simultaneous packets to many namespaces. */}
        {storm > 0.05
          ? Array.from({ length: 8 }, (_, k) => {
              const t = saw(frame, 20, k * 6);
              const target = nodePos(stormTargets[k % stormTargets.length], ringRot);
              const p = lerp3(CORE_POS, target, t);
              return (
                <Glow
                  key={k}
                  color={k % 2 === 0 ? PALETTE.amber : '#5eead4'}
                  scale={0.22}
                  opacity={storm * (1 - t * 0.4)}
                  position={p}
                />
              );
            })
          : null}
      </ConceptThreeCanvas>

      <CaptionRail slide={slide} durationFrames={durationFrames} width={width} />
    </AbsoluteFill>
  );
};
