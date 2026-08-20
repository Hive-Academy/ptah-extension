/**
 * story-kit-3d — the 3D cinematic siblings of story-kit: frame-driven camera
 * dolly helpers (push-in / orbit / keyframed dolly) and a Story3DBackdrop that
 * composites the 2D shader/grain/vignette layers with an optional sparse 3D
 * glass-node field rendered behind the foreground scene content.
 *
 * DETERMINISM CONTRACT (same as three-kit):
 *  - All motion derives from useCurrentFrame() / the `frame` arg. No useFrame
 *    with delta, no THREE.Clock, no Math.random, no CSS animation/transition.
 *  - The backdrop's glass-node field is posed purely from `frame` (interpolate
 *    + breathAt), so any frame renders identically in any order.
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
import { MeshTransmissionMaterial } from '@react-three/drei';
import {
  breathAt,
  CameraRig,
  ConceptThreeCanvas,
  Glow,
  PALETTE,
  Stars,
  type Vec3,
} from '../concept3d/three-kit';
import {
  ShaderBackdrop,
  GrainLayer,
  Vignette,
  storyRootStyle,
} from './story-kit';
import { THEME } from '../theme';
import { NumberWheel } from '../remocn/components/remocn/number-wheel';

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const EASE = Easing.inOut(Easing.cubic);

export type { Vec3 };

// ───────────────────────────────────────────────────────────────────────────
// Camera helpers — pure functions of `frame`, return Vec3 poses
// ───────────────────────────────────────────────────────────────────────────

/**
 * CinematicPushIn — eased interpolation between two camera positions across the
 * beat. Returns the current frame's camera position. `lookAt` is passed through
 * unchanged (the caller can animate it separately if needed).
 */
export function CinematicPushIn(
  frame: number,
  durationFrames: number,
  startPos: Vec3,
  endPos: Vec3,
  lookAt: Vec3 = [0, 0, 0],
): { position: Vec3; lookAt: Vec3 } {
  const t = durationFrames > 0 ? Math.min(1, Math.max(0, frame / durationFrames)) : 0;
  const eased = interpolate(t, [0, 1], [0, 1], { easing: EASE });
  const position: Vec3 = [
    startPos[0] + (endPos[0] - startPos[0]) * eased,
    startPos[1] + (endPos[1] - startPos[1]) * eased,
    startPos[2] + (endPos[2] - startPos[2]) * eased,
  ];
  return { position, lookAt };
}

/**
 * CinematicOrbit — a deterministic circular camera path around `center` at the
 * given `height` and `radius`, completing `revolutions` turns over the beat.
 * The lookAt is always the center. `phase` offsets the starting angle so scenes
 * don't all begin from the same compass point.
 */
export function CinematicOrbit(
  frame: number,
  durationFrames: number,
  radius: number,
  height: number,
  center: Vec3 = [0, 0, 0],
  revolutions = 0.5,
  phase = 0,
): { position: Vec3; lookAt: Vec3 } {
  const t = durationFrames > 0 ? frame / durationFrames : 0;
  const angle = phase + t * Math.PI * 2 * revolutions;
  const position: Vec3 = [
    center[0] + Math.cos(angle) * radius,
    center[1] + height,
    center[2] + Math.sin(angle) * radius,
  ];
  return { position, lookAt: center };
}

// ───────────────────────────────────────────────────────────────────────────
// useCinematicDolly — keyframed camera dolly hook
// ───────────────────────────────────────────────────────────────────────────

export type DollyKeyframe = {
  /** Frame index at which this keyframe applies. */
  frame: number;
  position: Vec3;
  lookAt: Vec3;
};

/**
 * useCinematicDolly — interpolate { position, lookAt } across an ordered list
 * of keyframes using remotion's `interpolate` with cubic ease-in-out. Falls
 * back to the first/last keyframe outside the range (clamped). Hook form so it
 * reads `useCurrentFrame()` itself and stays a pure function of the frame.
 */
export function useCinematicDolly(
  keyframes: DollyKeyframe[],
): { position: Vec3; lookAt: Vec3 } {
  const frame = useCurrentFrame();
  const frames = keyframes.map((k) => k.frame);
  const pos: Vec3 = [
    interpolate(frame, frames, keyframes.map((k) => k.position[0]), {
      ...CLAMP,
      easing: EASE,
    }),
    interpolate(frame, frames, keyframes.map((k) => k.position[1]), {
      ...CLAMP,
      easing: EASE,
    }),
    interpolate(frame, frames, keyframes.map((k) => k.position[2]), {
      ...CLAMP,
      easing: EASE,
    }),
  ];
  const lookAt: Vec3 = [
    interpolate(frame, frames, keyframes.map((k) => k.lookAt[0]), {
      ...CLAMP,
      easing: EASE,
    }),
    interpolate(frame, frames, keyframes.map((k) => k.lookAt[1]), {
      ...CLAMP,
      easing: EASE,
    }),
    interpolate(frame, frames, keyframes.map((k) => k.lookAt[2]), {
      ...CLAMP,
      easing: EASE,
    }),
  ];
  return { position: pos, lookAt };
}

// ───────────────────────────────────────────────────────────────────────────
// Story3DBackdrop — shader + grain + vignette + optional 3D glass-node field
// ───────────────────────────────────────────────────────────────────────────

/**
 * A sparse field of small refractive glass icosahedrons drifting in the deep
 * background behind a scene — reads as "intelligence in the air" without a
 * glow-blob wash. Deterministic: positions from a fixed lattice + a per-node
 * breath offset; opacity/scale fade in across the beat.
 *
 * Rendered INSIDE its own ConceptThreeCanvas so the grain/vignette/shader
 * layers composite over it correctly and the foreground scene (which mounts its
 * own canvas) stays clean. Kept deliberately subtle (veil 0.5–0.65 in the
 * caller's ShaderBackdrop; node opacity ≤ 0.4).
 */
const GlassNodeField: React.FC<{
  frame: number;
  duration: number;
  count?: number;
  spread?: number;
  opacity?: number;
}> = ({
  frame,
  duration,
  count = 14,
  spread = 8,
  opacity = 0.35,
}) => {
  const reveal = interpolate(frame, [0, Math.min(30, duration * 0.3)], [0, 1], CLAMP);
  const bg = useMemo(() => new THREE.Color('#1a2230'), []);

  // Deterministic lattice — a 3D grid of candidate positions, thinned to `count`.
  const nodes = useMemo(() => {
    const out: { pos: Vec3; scale: number; phase: number; accent: boolean }[] = [];
    let i = 0;
    const step = spread / 3;
    for (let x = -spread; x <= spread && out.length < count; x += step) {
      for (let y = -spread / 2; y <= spread / 2 && out.length < count; y += step) {
        for (let z = -spread; z <= spread && out.length < count; z += step) {
          // Thin via a deterministic stride — no Math.random.
          if (i % 3 !== 0) { i++; continue; }
          const pos: Vec3 = [x, y, z - 1];
          out.push({
            pos,
            scale: 0.18 + ((i % 5) / 5) * 0.12,
            phase: i * 17,
            accent: i % 5 === 0,
          });
          i++;
        }
      }
    }
    return out;
  }, [count, spread]);

  return (
    <>
      {nodes.map((n, idx) => {
        const bob = breathAt(frame, 120, n.phase) * 0.18 - 0.09;
        const spin = frame * 0.01 + idx;
        const s = n.scale * reveal;
        const nodeOpacity = Math.min(1, reveal * opacity * 1.4);
        return (
          <group
            key={idx}
            position={[n.pos[0], n.pos[1] + bob, n.pos[2]]}
            scale={[s, s, s]}
            rotation={[spin * 0.6, spin, spin * 0.3]}
          >
            <mesh>
              <icosahedronGeometry args={[0.5, 0]} />
              <MeshTransmissionMaterial
                samples={4}
                resolution={256}
                transmission={1}
                thickness={0.35}
                roughness={0.08}
                ior={1.45}
                chromaticAberration={0.02}
                distortion={0}
                distortionScale={0}
                temporalDistortion={0}
                attenuationColor={n.accent ? PALETTE.emerald : '#dce8f4'}
                attenuationDistance={1.6}
                color={'#ffffff'}
                background={bg}
                transparent
                opacity={nodeOpacity}
              />
            </mesh>
            <Glow
              color={n.accent ? PALETTE.emerald : PALETTE.amberLight}
              scale={0.32}
              opacity={reveal * 0.14}
            />
          </group>
        );
      })}
    </>
  );
};

export type Story3DBackdropProps = {
  /** Shader veil strength (0..1) — higher = darker, more legible foreground. */
  veil?: number;
  /** Grain opacity. */
  grain?: number;
  /** Vignette darkness at corners. */
  vignette?: number;
  /** Render the sparse 3D glass-node field (default true). */
  glassField?: boolean;
  /** Glass field node count. */
  glassCount?: number;
  /** Glass field spread radius. */
  glassSpread?: number;
  /** Glass field opacity ceiling. */
  glassOpacity?: number;
  /** Camera FOV for the glass-field canvas. */
  fov?: number;
  /** Optional children rendered ABOVE the backdrop layers (e.g. a foreground
   *  2D overlay) — the 3D glass field always sits BEHIND. */
  children?: React.ReactNode;
};

/**
 * Story3DBackdrop — the full backdrop stack for a v2 story scene, in z-order:
 *   1. ShaderBackdrop (neural-web shader + ink veil + radial sink)
 *   2. GlassNodeField in its own ConceptThreeCanvas (behind the scene)
 *   3. GrainLayer (composited BEHIND the scene's own 3D canvas, like GlassCoreScene)
 *   4. caller's `children` (the foreground scene content)
 *   5. Vignette (front overlay)
 *
 * The scene's own 3D canvas (GlassHero, terminal frame, etc.) is mounted by the
 * CALLER on top of this backdrop — so the glass-node field reads as depth
 * behind the hero, and the grain stays behind both so the crystal stays clean.
 */
export const Story3DBackdrop: React.FC<Story3DBackdropProps> = ({
  veil = 0.55,
  grain = 0.05,
  vignette = 0.42,
  glassField = true,
  glassCount = 14,
  glassSpread = 8,
  glassOpacity = 0.35,
  fov = 42,
  children,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={veil} />
      {glassField ? (
        <ConceptThreeCanvas fov={fov}>
          <CameraRig position={[0, 0, 8]} lookAt={[0, 0, 0]} />
          <ambientLight intensity={0.3} />
          <directionalLight position={[4, 6, 5]} intensity={1.1} />
          <directionalLight position={[-5, -2, -4]} intensity={0.4} color={PALETTE.emerald} />
          <Stars frame={frame} count={24} />
          <GlassNodeField
            frame={frame}
            duration={durationInFrames}
            count={glassCount}
            spread={glassSpread}
            opacity={glassOpacity}
          />
        </ConceptThreeCanvas>
      ) : null}
      <GrainLayer opacity={grain} />
      {children}
      <Vignette amount={vignette} />
    </AbsoluteFill>
  );
};

// ───────────────────────────────────────────────────────────────────────────
// Shared 2D overlay atoms reused across the v2 scenes (kept here so the scenes
// stay focused on their 3D + kinetic-type composition)
// ───────────────────────────────────────────────────────────────────────────

/** Phase window opacity — fades a sub-element in at `a` and out at `b`. */
export function win(frame: number, a: number, b: number, fade = 14): number {
  return interpolate(frame, [a - fade, a, b, b + fade], [0, 1, 1, 0], CLAMP);
}

/** Small labelled chip — same grammar as story-scenes' Chip. */
export const Chip: React.FC<{ label: string; accent?: boolean; s: number }> = ({
  label,
  accent = false,
  s,
}) => (
  <div
    style={{
      padding: `${10 * s}px ${20 * s}px`,
      borderRadius: 999,
      border: `1px solid ${accent ? PALETTE.amber : 'rgba(255,255,255,0.14)'}`,
      background: 'rgba(255,255,255,0.03)',
      color: accent ? PALETTE.amber : THEME.textSoft,
      fontFamily: THEME.font,
      fontSize: 26 * s,
      fontWeight: 600,
      letterSpacing: '-0.01em',
      whiteSpace: 'nowrap',
    }}
  >
    {label}
  </div>
);

/** Small caption kicker at the top of a beat. */
export const Kicker: React.FC<{ text: string; s: number; opacity?: number }> = ({
  text,
  s,
  opacity = 1,
}) => (
  <AbsoluteFill
    style={{ alignItems: 'center', justifyContent: 'flex-start', paddingTop: 120 * s, opacity }}
  >
    <div
      style={{
        fontFamily: THEME.font,
        color: THEME.textFaint,
        fontSize: 24 * s,
        fontWeight: 600,
        letterSpacing: '0.02em',
      }}
    >
      {text}
    </div>
  </AbsoluteFill>
);

/** A centered kinetic-type line placed at a vertical offset. */
export const CenterAt: React.FC<{ dy?: number; children: React.ReactNode }> = ({
  dy = 0,
  children,
}) => <AbsoluteFill style={{ transform: `translateY(${dy}px)` }}>{children}</AbsoluteFill>;

/** Inline NumberWheel wrapper (fixed count window) for a numeric payoff. */
export const NumberWheelInline: React.FC<{ to: number; s: number; color?: string }> = ({
  to,
  s,
  color = PALETTE.amber,
}) => (
  <div
    style={{
      position: 'relative',
      width: to >= 10 ? 130 * s : 80 * s,
      height: 90 * s,
    }}
  >
    <NumberWheel from={0} to={to} fontSize={Math.round(84 * s)} color={color} />
  </div>
);