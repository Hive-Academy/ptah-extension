/**
 * three-kit — shared R3F scaffolding for 3D concept scenes (scene-kit's
 * sibling for the third dimension). One place for the canvas wrapper, light
 * rig, per-frame camera rig, and deterministic texture/sprite helpers so every
 * 3D scene stays visually cohesive with the 2D promo grammar.
 *
 * DETERMINISM CONTRACT (stricter than scene-kit — WebGL makes drift visible):
 *  - All motion derives from useCurrentFrame(). Never useFrame((_, delta)),
 *    THREE.Clock, timers, or Math.random (use mulberry32/seededSeries).
 *  - Textures are generated synchronously via CanvasTexture — no async
 *    loaders, so no delayRender bookkeeping and no flaky first frames.
 *  - <ThreeCanvas> (from @remotion/three) bridges Remotion's React contexts
 *    into the R3F reconciler, so useCurrentFrame()/useVideoConfig() keep
 *    working inside meshes.
 */
import React, { useLayoutEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { ThreeCanvas } from '@remotion/three';
import { useVideoConfig } from 'remotion';
import { seededSeries } from '../components/effects/seeded-random';
import { THEME } from '../theme';

export type Vec3 = [number, number, number];

/** Brand accents lifted into 3D — mirrors the 2D scenes' palette discipline. */
export const PALETTE = {
  indigo: THEME.indigo,
  amber: THEME.amber,
} as const;

/**
 * Full-size transparent WebGL canvas — the shared Backdrop / grid / orbs
 * cinematic layer stays visible behind the 3D scene, exactly like the 2D
 * concept scenes sit on it.
 */
export const ConceptThreeCanvas: React.FC<{
  children: React.ReactNode;
  fov?: number;
}> = ({ children, fov = 42 }) => {
  const { width, height } = useVideoConfig();
  return (
    <ThreeCanvas
      width={width}
      height={height}
      style={{ backgroundColor: 'transparent' }}
      gl={{ alpha: true, antialias: true }}
      camera={{ fov, position: [0, 2.4, 10] }}
    >
      {children}
    </ThreeCanvas>
  );
};

/**
 * Sets the camera pose for the CURRENT frame. Callers derive `position` /
 * `lookAt` from useCurrentFrame() via interpolate(), so the dolly is a pure
 * function of the frame — Remotion can render frames in any order.
 */
export const CameraRig: React.FC<{ position: Vec3; lookAt?: Vec3 }> = ({
  position,
  lookAt = [0, 0, 0],
}) => {
  const camera = useThree((s) => s.camera);
  const [px, py, pz] = position;
  const [lx, ly, lz] = lookAt;
  useLayoutEffect(() => {
    camera.position.set(px, py, pz);
    camera.lookAt(lx, ly, lz);
  }, [camera, px, py, pz, lx, ly, lz]);
  return null;
};

/** Neutral key + indigo rim over a soft ambient — the default scene mood. */
export const LightRig: React.FC = () => (
  <>
    <ambientLight intensity={0.45} />
    <directionalLight position={[5, 8, 6]} intensity={1.7} />
    <directionalLight position={[-6, -3, -5]} intensity={0.6} color={PALETTE.indigo} />
  </>
);

/**
 * Shared white radial-glow texture, tinted per-sprite via material color.
 * Drawn once, synchronously, on first use (module singleton — the studio and
 * every render worker each build their own copy).
 */
let glowTexture: THREE.CanvasTexture | null = null;
function getGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}

/** Additive halo sprite — the cheap, deterministic stand-in for bloom. */
export const Glow: React.FC<{
  color: string;
  scale?: number;
  opacity?: number;
  position?: Vec3;
}> = ({ color, scale = 1, opacity = 1, position = [0, 0, 0] }) => (
  <sprite position={position} scale={[scale, scale, scale]}>
    <spriteMaterial
      map={getGlowTexture()}
      color={color}
      transparent
      opacity={opacity}
      depthWrite={false}
      blending={THREE.AdditiveBlending}
    />
  </sprite>
);

/**
 * Text drawn into a CanvasTexture sprite — labels that live IN the scene and
 * move with their node. Synchronous (no font/asset loading), cached per text.
 */
const labelCache = new Map<string, { texture: THREE.CanvasTexture; aspect: number }>();
function getLabelTexture(text: string, color: string): { texture: THREE.CanvasTexture; aspect: number } {
  const key = `${color}|${text}`;
  const cached = labelCache.get(key);
  if (cached) return cached;
  const fontPx = 72;
  const pad = fontPx * 0.5;
  const font = `800 ${fontPx}px ${THEME.font}`;
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d');
  if (!measure) throw new Error('2d canvas context unavailable');
  measure.font = font;
  canvas.width = Math.ceil(measure.measureText(text).width + pad * 2);
  canvas.height = Math.ceil(fontPx * 1.7);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  ctx.font = font; // canvas resize resets state
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur = fontPx * 0.22;
  ctx.fillStyle = color;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const entry = { texture, aspect: canvas.width / canvas.height };
  labelCache.set(key, entry);
  return entry;
}

export const Label: React.FC<{
  text: string;
  position?: Vec3;
  /** World-unit height of the rendered text sprite. */
  height?: number;
  color?: string;
  opacity?: number;
}> = ({ text, position = [0, 0, 0], height = 0.3, color = '#ffffff', opacity = 1 }) => {
  const { texture, aspect } = getLabelTexture(text, color);
  return (
    <sprite position={position} scale={[height * aspect, height, 1]}>
      <spriteMaterial map={texture} transparent opacity={opacity} depthWrite={false} />
    </sprite>
  );
};

/** Linear blend of two points — orbit→dock trajectories etc. */
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Deterministic sawtooth 0..1 — looping travel/pulse cycles. */
export const saw = (frame: number, period: number, offset = 0): number =>
  ((((frame + offset) % period) + period) % period) / period;

/** Pure sine breath 0..1 — safe in loops (not a hook). */
export const breathAt = (frame: number, period: number, phase = 0): number =>
  (Math.sin(((frame + phase) / period) * Math.PI * 2) + 1) / 2;

/** Faint twinkling starfield shell — shared depth cue behind every 3D scene. */
export const Stars: React.FC<{ frame: number; count?: number }> = ({ frame, count = 40 }) => {
  const rnd = seededSeries(7, count * 4);
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const theta = rnd[i * 4] * Math.PI * 2;
        const phi = Math.acos(rnd[i * 4 + 1] * 2 - 1);
        const r = 7 + rnd[i * 4 + 2] * 5;
        const twinkle = 0.1 + breathAt(frame, 80 + rnd[i * 4 + 3] * 60, i * 9) * 0.16;
        return (
          <Glow
            key={i}
            color="#c7d2fe"
            scale={0.1 + rnd[i * 4 + 3] * 0.14}
            opacity={twinkle}
            position={[
              Math.sin(phi) * Math.cos(theta) * r,
              (rnd[i * 4 + 1] - 0.5) * 6,
              Math.sin(phi) * Math.sin(theta) * r - 2,
            ]}
          />
        );
      })}
    </>
  );
};
