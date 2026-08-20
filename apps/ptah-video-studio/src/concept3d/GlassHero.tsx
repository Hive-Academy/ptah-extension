/**
 * GlassHero — the state-of-the-art abstract 3D hero: a CRISP glass Ptah hexagon
 * crystal core, two gold metal rings, and a few refractive glass nodes that dock
 * onto the hex, lit by a hand-built local dark-studio environment (PMREM from a
 * local equirect — NO CDN/HDRI fetch) plus RectAreaLight softboxes for elongated
 * crystal highlights. The warm amber core glows THROUGH the crystal; bloom is a
 * safe additive sprite (no EffectComposer).
 *
 * DETERMINISM CONTRACT:
 *  - Every pose is a pure function of the `frame` prop (interpolate/trig). No
 *    useFrame-driven state, no Math.random / Date.now / THREE.Clock.
 *  - The environment is built SYNCHRONOUSLY from a local equirect canvas →
 *    PMREM. No network fetch, so offline render workers never get a blank frame
 *    and any frame order is safe.
 *  - MeshTransmissionMaterial renders the scene to an FBO each frame; the scene
 *    state is a pure function of `frame`, so that buffer is deterministic.
 *    `temporalDistortion={0}` + a STATIC `distortion` remove every time-seeded
 *    term (verified by re-rendering the same frame — see the checkpoint report).
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { MeshTransmissionMaterial } from '@react-three/drei';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { CameraRig, Glow, PALETTE, breathAt, type Vec3 } from './three-kit';
import { ContactShadow, StudioFloor } from './three-assets';

const TAU = Math.PI * 2;

// ───────────────────────────────────────────────────────────────────────────
// HeroStudio — local dark-studio PMREM env + RectAreaLight softbox rig
// ───────────────────────────────────────────────────────────────────────────

/** A dark studio equirect with crisp SOFTBOX rectangles (feathered, elongated)
 *  so a low-roughness crystal reflects clean streak highlights — the tell of a
 *  real studio HDRI. Drawn synchronously; feeds PMREM. */
function buildStudioEquirect(): THREE.CanvasTexture {
  const w = 2048;
  const h = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#0c0f13');
  grad.addColorStop(0.5, '#070a0d');
  grad.addColorStop(1, '#030405');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Feathered elongated "softbox": a radial glow squashed into a rectangle.
  const softbox = (
    cx: number,
    cy: number,
    rw: number,
    rh: number,
    color: string,
  ): void => {
    const maxR = Math.max(rw, rh);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    g.addColorStop(0, color);
    g.addColorStop(0.55, color.replace(/[\d.]+\)$/, '0.3)'));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rw / maxR, rh / maxR);
    ctx.translate(-cx, -cy);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  };

  softbox(w * 0.34, h * 0.26, w * 0.3, h * 0.06, 'rgba(232,244,255,0.95)'); // cool key
  softbox(w * 0.5, h * 0.12, w * 0.42, h * 0.04, 'rgba(210,228,244,0.6)'); // top strip
  softbox(w * 0.76, h * 0.62, w * 0.2, h * 0.05, 'rgba(245,165,36,0.4)'); // warm rim
  softbox(w * 0.2, h * 0.7, w * 0.16, h * 0.05, 'rgba(52,211,153,0.16)'); // emerald fill

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

const RectSoftbox: React.FC<{
  position: Vec3;
  color: string;
  intensity: number;
  width: number;
  height: number;
}> = ({ position, color, intensity, width, height }) => {
  const ref = useRef<THREE.RectAreaLight>(null);
  useEffect(() => {
    ref.current?.lookAt(0, 0, 0);
  }, [position]);
  return (
    <rectAreaLight
      ref={ref}
      position={position}
      color={color}
      intensity={intensity}
      width={width}
      height={height}
    />
  );
};

/** drei-free crisp studio: PMREM env from the local equirect + ACES grade +
 *  RectAreaLight softboxes. Renderer state restored on unmount so the grade
 *  never leaks into a sibling scene sharing the reconciler. */
const HeroStudio: React.FC<{ exposure?: number }> = ({ exposure = 1.1 }) => {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useLayoutEffect(() => {
    RectAreaLightUniformsLib.init();
    const prev = {
      toneMapping: gl.toneMapping,
      exposure: gl.toneMappingExposure,
      colorSpace: gl.outputColorSpace,
    };
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = exposure;
    gl.outputColorSpace = THREE.SRGBColorSpace;

    const pmrem = new THREE.PMREMGenerator(gl);
    pmrem.compileEquirectangularShader();
    const equirect = buildStudioEquirect();
    const rt = pmrem.fromEquirectangular(equirect);
    const prevEnv = scene.environment;
    scene.environment = rt.texture;

    return () => {
      gl.toneMapping = prev.toneMapping;
      gl.toneMappingExposure = prev.exposure;
      gl.outputColorSpace = prev.colorSpace;
      if (scene.environment === rt.texture) scene.environment = prevEnv;
      rt.dispose();
      equirect.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, exposure]);

  return (
    <>
      <ambientLight intensity={0.18} />
      <RectSoftbox position={[-4.5, 4, 4]} color="#e8f4ff" intensity={5.5} width={6} height={2.4} />
      <RectSoftbox position={[5, -1.5, 3]} color={PALETTE.amberLight} intensity={3.2} width={5} height={2} />
      <directionalLight position={[-6, 7, 5]} intensity={0.5} color="#cfe0ea" />
      <pointLight position={[0, -1.2, 3]} intensity={4} color="#f59e0b" distance={18} decay={2} />
    </>
  );
};

// ───────────────────────────────────────────────────────────────────────────
// OrbitNode — a refractive glass satellite that docks onto a hex face
// ───────────────────────────────────────────────────────────────────────────

/** Placed INSIDE the hex's spinning frame so it co-rotates; `radius` (driven by
 *  the docking curve upstream) interpolates inward to nestle against a hex face.
 *  Emissive spark is clamped so it never blows to white. Cheaper
 *  MeshPhysicalMaterial transmission (env-only refraction, no FBO) keeps three
 *  satellites affordable. */
const OrbitNode: React.FC<{
  angle: number;
  radius: number;
  spin: number;
  scale: number;
  accent?: boolean;
  reveal: number;
}> = ({ angle, radius, spin, scale, accent = false, reveal }) => {
  const pos: Vec3 = [Math.cos(angle) * radius, 0, Math.sin(angle) * radius];
  const tint = accent ? PALETTE.emerald : '#dce8f4';
  const s = scale * reveal;
  return (
    <group position={pos}>
      <mesh scale={[s, s, s]} rotation={[spin * 0.6, spin, spin * 0.3]}>
        <icosahedronGeometry args={[0.5, 0]} />
        <meshPhysicalMaterial
          transmission={1}
          thickness={0.4}
          roughness={0.05}
          ior={1.46}
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={0.05}
          attenuationColor={tint}
          attenuationDistance={1.4}
          color={'#ffffff'}
          envMapIntensity={1.8}
          transparent
          opacity={Math.min(1, reveal * 1.2)}
        />
      </mesh>
      <mesh scale={[0.06 * s, 0.06 * s, 0.06 * s]}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshStandardMaterial
          color={accent ? PALETTE.emeraldLight : PALETTE.amberLight}
          emissive={accent ? PALETTE.emeraldLight : PALETTE.amberLight}
          emissiveIntensity={1.6}
        />
      </mesh>
      <Glow color={accent ? PALETTE.emerald : PALETTE.amberLight} scale={0.42 * s} opacity={reveal * 0.28} />
    </group>
  );
};

// ───────────────────────────────────────────────────────────────────────────
// GlassHero
// ───────────────────────────────────────────────────────────────────────────

export type GlassHeroProps = {
  /** Frame local to the hero beat (0 = beat start). */
  frame: number;
  /** Beat length in frames — paces the reveal + camera push + docking. */
  duration: number;
  /** 0..1 master reveal (entrance). */
  reveal?: number;
  /** Show the reflective floor + contact shadow (off for a floating hero). */
  floor?: boolean;
};

export const GlassHero: React.FC<GlassHeroProps> = ({
  frame,
  duration,
  reveal = 1,
  floor = true,
}) => {
  const spin = frame * 0.007;
  const bob = breathAt(frame, 160) * 0.05;
  const coreGlow = 0.55 + breathAt(frame, 95) * 0.28;

  const t = duration > 0 ? Math.min(1, frame / duration) : 0;
  const ease = t * t * (3 - 2 * t);
  const camPos: Vec3 = [0.1 * ease, 0.3 - 0.18 * ease, 6.0 - 0.9 * ease];

  // Docking: nodes settle from a wide orbit onto the hex faces over the beat.
  const dock = Math.max(0, Math.min(1, (frame - duration * 0.25) / (duration * 0.5)));
  const dockEase = dock * dock * (3 - 2 * dock);
  const nodeRadius = 2.15 - 0.62 * dockEase;

  const FLOOR_Y = -1.8;

  const glassBackground = useMemo(() => new THREE.Color('#2b3742'), []);

  return (
    <>
      <HeroStudio exposure={1.1} />
      <CameraRig position={camPos} lookAt={[0, 0.02, 0]} />

      {floor ? (
        <>
          <StudioFloor y={FLOOR_Y} size={20} opacity={reveal} />
          <ContactShadow position={[0, FLOOR_Y + 0.02, 0]} radius={1.8} opacity={reveal * 0.5} scale={[1.3, 1]} />
        </>
      ) : null}

      {/* Oriented + spinning hero frame: hexagon FACE toward camera, spin in-plane. */}
      <group position={[0, bob, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[reveal, reveal, reveal]}>
        <group rotation={[0, spin, 0]}>
          {/* Crisp glass hexagon crystal. */}
          <mesh>
            <cylinderGeometry args={[1.25, 1.25, 0.5, 6]} />
            <MeshTransmissionMaterial
              backside
              samples={10}
              resolution={1024}
              transmission={1}
              thickness={0.85}
              roughness={0.06}
              ior={1.5}
              chromaticAberration={0.03}
              anisotropy={0.1}
              distortion={0.0}
              distortionScale={0.0}
              temporalDistortion={0}
              attenuationColor={'#dce8f4'}
              attenuationDistance={4}
              color={'#ffffff'}
              background={glassBackground}
            />
          </mesh>
          {/* Warm amber gem core — glows through the crisp crystal. */}
          <mesh scale={[0.28, 0.28, 0.28]}>
            <icosahedronGeometry args={[1, 3]} />
            <meshStandardMaterial
              color={PALETTE.amber}
              emissive={PALETTE.amber}
              emissiveIntensity={1.7 * coreGlow}
              metalness={0.25}
              roughness={0.3}
            />
          </mesh>

          {/* Refractive nodes co-rotating + docking to the hex faces. */}
          {[0, 1, 2].map((i) => {
            const base = (i * TAU) / 3;
            const nodeReveal = Math.max(0, Math.min(1, reveal * 1.15 - i * 0.08));
            return (
              <OrbitNode
                key={i}
                angle={base}
                radius={nodeRadius}
                spin={spin * 3 + i}
                scale={0.3 + (i === 1 ? 0.04 : 0)}
                accent={i === 1}
                reveal={nodeReveal}
              />
            );
          })}
        </group>
      </group>

      {/* Safe additive bloom — small warm halo through the core (no wash). */}
      <Glow color={PALETTE.amber} scale={1.2} opacity={reveal * coreGlow * 0.16} position={[0, 0.02, 0.35]} />

      {/* Two thin gold metal rings — catch the softbox reflections, frame core. */}
      <group rotation={[Math.PI / 2.25, spin * 0.5, 0]}>
        <mesh>
          <torusGeometry args={[2.0, 0.03, 20, 160]} />
          <meshStandardMaterial color={'#f2d79a'} metalness={1} roughness={0.16} envMapIntensity={1.7} />
        </mesh>
      </group>
      <group rotation={[Math.PI / 2.55, -spin * 0.35, 0.28]}>
        <mesh>
          <torusGeometry args={[2.34, 0.018, 16, 160]} />
          <meshStandardMaterial color={PALETTE.amberLight} metalness={1} roughness={0.24} envMapIntensity={1.4} />
        </mesh>
      </group>
    </>
  );
};
