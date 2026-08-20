/**
 * three-assets — the ASSET tier of the 3D kit: real GLB models, a PBR studio
 * environment, and extruded 2D-icon badges. Sits alongside three-kit (which
 * stays primitives-only) and lifts 3D scenes past the "primitive geometries"
 * ceiling into glass + emissive + reflective props on a dark studio.
 *
 * DETERMINISM CONTRACT (extends three-kit's — this file is the ONLY place async
 * loaders are allowed):
 *  - GLB loading is gated by delayRender()/continueRender() so the FIRST
 *    rendered frame is never blank and out-of-order frame rendering is safe
 *    (each render worker holds its own frame until its own load resolves).
 *    This is the pattern from remotion-dev/remotion-three-gltf-example, done
 *    imperatively (no <Suspense> throw) so the delayRender handle can never be
 *    orphaned by a suspended re-render.
 *  - Loaded GLTFs are cached at module scope, so studio scrubbing and chunk
 *    re-mounts reuse the parse instead of re-fetching.
 *  - The environment map is built SYNCHRONOUSLY from a procedural equirect
 *    canvas → PMREMGenerator. No HDRI download, no drei preset CDN fetch — both
 *    would be network-dependent and would break the "no blank frames / any
 *    order" guarantee in offline render workers. Reflections are brand-tinted.
 *  - Icon extrusion is synchronous (SVGLoader.parse, not .load).
 *  - No useFrame, no Math.random/Date.now/THREE.Clock. Motion still comes from
 *    the scene via useCurrentFrame(); these components are pose/props-driven.
 */
import React, { Suspense, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import * as THREE from 'three';
import { useLoader, useThree } from '@react-three/fiber';
import {
  GLTFLoader,
  type GLTF,
} from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { PALETTE } from './three-kit';
import type { Vec3 } from './three-kit';

// ───────────────────────────────────────────────────────────────────────────
// GltfModel — deterministic GLB loader wrapper
// ───────────────────────────────────────────────────────────────────────────

/**
 * Preload a model outside render (call at a scene module's top level). Warms
 * R3F's useLoader cache so the first studio scrub / render frame is instant.
 */
export const preloadGltf = (src: string): void => {
  useLoader.preload(GLTFLoader, staticFile(src));
};

// ── brandify — remap any GLB's materials to one Ptah PBR language ───────────

export type BrandifyOptions = {
  /** Primary metal color for mid-value parts (default operator amber). */
  base?: string;
  /** Accent color for saturated parts (default operator emerald). */
  accent?: string;
  /** Dark-glass color for near-black parts (default ink). */
  glass?: string;
  /** Emissive color for lights / eyes / glowing parts (default amber-light). */
  emissive?: string;
  metalness?: number;
  roughness?: number;
  emissiveIntensity?: number;
  /** Mesh-name substrings (case-insensitive) FORCED to emissive-on, e.g. ['eye']. */
  glowParts?: string[];
};

const BRAND_DEFAULTS = {
  base: '#f5a524',
  accent: '#34d399',
  glass: '#0e1015',
  emissive: '#ffbb4d',
} as const;

function luma(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * Traverse a loaded/cloned GLB and REPLACE every mesh material with a brand PBR
 * material, so props from wildly different sources (a textured lantern, a
 * clearcoat car, a vertex-colored robot) all speak ONE material language:
 * amber metal base, emerald accent on saturated parts, dark glass on near-black
 * parts, amber emissive on lights/eyes. Textures are intentionally dropped —
 * that is what kills the source-fidelity clash and enforces the palette. Vertex
 * colors are preserved (they carry a model's shading detail) and simply
 * multiply the brand color.
 *
 * Operates on the CLONE only — never disposes the shared cached source
 * materials, so the useLoader cache stays valid for other frames/instances.
 */
export function brandify(root: THREE.Object3D, opts: BrandifyOptions = {}): void {
  const base = new THREE.Color(opts.base ?? BRAND_DEFAULTS.base);
  const accent = new THREE.Color(opts.accent ?? BRAND_DEFAULTS.accent);
  const glass = new THREE.Color(opts.glass ?? BRAND_DEFAULTS.glass);
  const emissiveCol = new THREE.Color(opts.emissive ?? BRAND_DEFAULTS.emissive);
  const metalness = opts.metalness ?? 0.9;
  const roughness = opts.roughness ?? 0.28;
  const emissiveIntensity = opts.emissiveIntensity ?? 1.5;
  const glowParts = (opts.glowParts ?? []).map((s) => s.toLowerCase());

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = (mesh.name || '').toLowerCase();
    const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
      | THREE.MeshStandardMaterial
      | undefined;
    const origColor = src?.color ? src.color.clone() : new THREE.Color('#888888');
    const l = luma(origColor);
    const sat =
      Math.max(origColor.r, origColor.g, origColor.b) -
      Math.min(origColor.r, origColor.g, origColor.b);
    const origEmissive = src?.emissive ? luma(src.emissive) : 0;
    const forceGlow = glowParts.some((p) => name.includes(p));

    let color = base.clone();
    let mMetal = metalness;
    let mRough = roughness;
    let emissive = new THREE.Color('#000000');
    let eInt = 0;

    if (forceGlow || origEmissive > 0.04) {
      color = emissiveCol.clone(); // lights / eyes / named glow parts
      emissive = emissiveCol.clone();
      eInt = emissiveIntensity;
      mMetal = 0.2;
      mRough = 0.35;
    } else if (l < 0.13) {
      color = glass.clone(); // near-black → dark glass
      mMetal = 0.4;
      mRough = 0.12;
    } else if (sat > 0.2) {
      color = accent.clone(); // saturated → emerald accent
      mMetal = 0.85;
      mRough = 0.3;
    }

    mesh.material = new THREE.MeshStandardMaterial({
      color,
      metalness: mMetal,
      roughness: mRough,
      emissive,
      emissiveIntensity: eInt,
      envMapIntensity: 1.3,
      vertexColors: src?.vertexColors ?? false,
      flatShading: src?.flatShading ?? false,
    });
  });
}

export type GltfModelProps = {
  /** staticFile-relative path, e.g. "models/RobotExpressive.glb". */
  src: string;
  /** Uniform scale or per-axis. Applied AFTER auto-normalization. */
  scale?: number | Vec3;
  rotation?: Vec3;
  position?: Vec3;
  /** Auto-center + fit into a unit cube so `scale` is in world units. */
  normalize?: boolean;
  /** Remap materials to the Ptah PBR language. `true` = defaults; object = tune. */
  brandify?: boolean | BrandifyOptions;
  /** Override every standard material's envMapIntensity (PBR reflection gain). */
  envMapIntensity?: number;
  /** Multiply every material's emissiveIntensity (make emissive props glow). */
  emissiveBoost?: number;
  /** delayRender label + timeout override (ms). */
  timeoutMs?: number;
};

/**
 * Inner: actually loads + draws the GLB. useLoader() SUSPENDS until the parse
 * resolves, so by the time this commits, the <primitive> is in the tree R3F
 * draws — no blank/late-draw frame. The cloned scene is centered/normalized and
 * its materials are per-instance tuned. `onReady` releases the parent's
 * delayRender exactly once (deps=[onReady], and onReady is stable).
 */
const GltfInner: React.FC<
  Omit<GltfModelProps, 'timeoutMs'> & { onReady: () => void }
> = ({
  src,
  scale = 1,
  rotation = [0, 0, 0],
  position = [0, 0, 0],
  normalize = true,
  brandify: brandifyProp,
  envMapIntensity,
  emissiveBoost,
  onReady,
}) => {
  const gltf = useLoader(GLTFLoader, staticFile(src)) as GLTF;

  useEffect(() => {
    onReady();
  }, [onReady]);

  // Stable dep key so the (expensive) clone+brandify memo only re-runs when the
  // brandify options actually change — not every frame on a fresh object prop.
  const brandifyKey = brandifyProp ? JSON.stringify(brandifyProp) : '';

  const object = useMemo(() => {
    const model = cloneSkinned(gltf.scene) as THREE.Object3D;
    const holder = new THREE.Group();
    holder.add(model);

    if (brandifyProp) {
      brandify(model, brandifyProp === true ? {} : brandifyProp);
    }

    if (normalize) {
      // Geometry-based bounds: union each mesh's rest-pose geometry box
      // transformed by its own world matrix. Robust for SkinnedMesh, where
      // Box3.setFromObject can return a wildly wrong posed box.
      model.updateWorldMatrix(true, true);
      const box = new THREE.Box3();
      model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const gb = (mesh.geometry.boundingBox as THREE.Box3).clone();
        gb.applyMatrix4(mesh.matrixWorld);
        box.union(gb);
      });
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      model.position.sub(center); // recenter at origin (model units)
      holder.scale.setScalar(1 / maxDim); // fit into a unit cube
    }

    // Per-instance material tuning — clone materials so tuning one instance
    // never bleeds into another that shares the same source material.
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const tune = (mat: THREE.Material): THREE.Material => {
        const std = mat.clone() as THREE.MeshStandardMaterial;
        if ('envMapIntensity' in std && envMapIntensity != null) {
          std.envMapIntensity = envMapIntensity;
        }
        if (emissiveBoost != null && std.emissive) {
          std.emissiveIntensity = (std.emissiveIntensity ?? 1) * emissiveBoost;
        }
        return std;
      };
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(tune)
        : tune(mesh.material);
    });

    return holder;
  }, [gltf, normalize, brandifyKey, envMapIntensity, emissiveBoost]);

  const s: Vec3 = typeof scale === 'number' ? [scale, scale, scale] : scale;
  return (
    <group position={position} rotation={rotation} scale={s}>
      <primitive object={object} />
    </group>
  );
};

/**
 * Remotion-safe GLB loader. This OUTER component never suspends, so its
 * delayRender handle is created exactly once and can never be orphaned by a
 * suspended re-render. GltfInner (below the <Suspense> boundary) suspends on
 * useLoader until the parse resolves, then commits the model into the tree and
 * calls back to release the handle — so Remotion only captures a frame once the
 * model is present AND drawn. Frames render correctly in any order (useLoader
 * caches per URL).
 */
export const GltfModel: React.FC<GltfModelProps> = ({
  timeoutMs = 30000,
  ...props
}) => {
  const [handle] = useState(() =>
    delayRender(`GltfModel ${props.src}`, { timeoutInMilliseconds: timeoutMs }),
  );
  const onReady = React.useCallback(() => continueRender(handle), [handle]);
  return (
    <Suspense fallback={null}>
      <GltfInner {...props} onReady={onReady} />
    </Suspense>
  );
};

// ───────────────────────────────────────────────────────────────────────────
// StageEnvironment — procedural dark-studio PBR env + brand light rig
// ───────────────────────────────────────────────────────────────────────────

/**
 * Equirectangular studio "HDRI", drawn synchronously: a dark emerald-tinted →
 * black vertical gradient with a soft cool key patch, a low emerald fill and a
 * warm amber rim. Patches are broad and gentle (no hard hotspots) so the glossy
 * floor reads as a clean studio sweep, not a procedural ripple. Feeds PMREM so
 * glass/metal props pick up on-brand specular without washing out the dark
 * backdrop.
 */
function buildStudioEquirect(): THREE.CanvasTexture {
  const w = 1024;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#0a120e'); // up — very dim emerald-ink dome
  grad.addColorStop(0.5, '#07090c'); // horizon — near black
  grad.addColorStop(1, '#020305'); // down — black floor
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const patch = (x: number, y: number, r: number, color: string): void => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(0.6, color.replace(/[\d.]+\)$/, '0.12)'));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
  patch(w * 0.32, h * 0.24, w * 0.46, 'rgba(200,224,214,0.26)'); // soft cool key
  patch(w * 0.78, h * 0.34, w * 0.4, 'rgba(52,211,153,0.1)'); // dim emerald fill
  patch(w * 0.55, h * 0.7, w * 0.34, 'rgba(245,165,36,0.08)'); // faint amber rim

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

export type StageEnvironmentProps = {
  /** Scales the whole light rig (key/kicker/fill/accent) together. */
  intensity?: number;
  /** Also paint the env onto the scene background (default false — keep the
   *  shared Backdrop/orbs visible behind the 3D). */
  asBackground?: boolean;
  /** ACES tone-mapping exposure. Slightly >1 lifts the studio without blowing
   *  the emissive props. */
  exposure?: number;
};

/**
 * drei-free studio environment + renderer grade. Generates a PMREM env map from
 * the procedural equirect (IBL for every PBR material), grades the renderer to
 * ACES Filmic + sRGB output at a tuned exposure, and drives a motivated
 * 3-point rig: cool EMERALD key upper-left, warm AMBER kicker behind-right, soft
 * emerald low fill. Models read dimensional (amber/emerald complementary sculpt)
 * instead of flat-lit. All settings are restored on unmount so the grade never
 * leaks into another scene sharing the reconciler.
 */
export const StageEnvironment: React.FC<StageEnvironmentProps> = ({
  intensity = 1,
  asBackground = false,
  exposure = 1.06,
}) => {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useLayoutEffect(() => {
    // ── renderer grade ──────────────────────────────────────────────────
    const prev = {
      toneMapping: gl.toneMapping,
      exposure: gl.toneMappingExposure,
      colorSpace: gl.outputColorSpace,
    };
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = exposure;
    gl.outputColorSpace = THREE.SRGBColorSpace;

    // ── IBL env map ─────────────────────────────────────────────────────
    const pmrem = new THREE.PMREMGenerator(gl);
    pmrem.compileEquirectangularShader();
    const equirect = buildStudioEquirect();
    const rt = pmrem.fromEquirectangular(equirect);
    scene.environment = rt.texture;
    if (asBackground) scene.background = rt.texture;

    return () => {
      gl.toneMapping = prev.toneMapping;
      gl.toneMappingExposure = prev.exposure;
      gl.outputColorSpace = prev.colorSpace;
      if (scene.environment === rt.texture) scene.environment = null;
      if (scene.background === rt.texture) scene.background = null;
      rt.dispose();
      equirect.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, asBackground, exposure]);

  return (
    <>
      <ambientLight intensity={0.16 * intensity} />
      {/* Key — cool emerald-white, high and to the LEFT (main shaper). Pulled
          back so it stops stacking into a murky green center. */}
      <directionalLight
        position={[-7.5, 8.5, 5.5]}
        intensity={1.6 * intensity}
        color="#bfe8d8"
      />
      {/* Kicker/rim — warm amber from BEHIND-RIGHT, separates props from the
          dark backdrop. Calmed so metallic props don't clip red-hot. */}
      <directionalLight
        position={[7.5, 4.5, -6.5]}
        intensity={1.6 * intensity}
        color={PALETTE.amber}
      />
      {/* Fill — soft, low, front, emerald: opens the shadows without flattening. */}
      <directionalLight
        position={[2.5, 1.5, 6.5]}
        intensity={0.5 * intensity}
        color={PALETTE.emerald}
      />
      {/* Faint amber ground bounce — warmth licking the underside of glass. */}
      <pointLight
        position={[0, -1.4, 3.5]}
        intensity={6 * intensity}
        color="#f59e0b"
        distance={20}
        decay={2}
      />
    </>
  );
};

// ───────────────────────────────────────────────────────────────────────────
// Grounding — reflective studio floor + soft contact shadows
// ───────────────────────────────────────────────────────────────────────────

/** Radial white→black texture (opaque) — an alphaMap that fades a plane to a
 *  soft disc. Module-cached. */
let radialAlphaTex: THREE.CanvasTexture | null = null;
function getRadialAlpha(): THREE.CanvasTexture {
  if (radialAlphaTex) return radialAlphaTex;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.55, '#8a8a8a');
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  radialAlphaTex = new THREE.CanvasTexture(canvas);
  return radialAlphaTex;
}

/** Soft dark radial blob (transparent edges) for a fake baked contact shadow. */
let shadowBlobTex: THREE.CanvasTexture | null = null;
function getShadowBlob(): THREE.CanvasTexture {
  if (shadowBlobTex) return shadowBlobTex;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  shadowBlobTex = new THREE.CanvasTexture(canvas);
  return shadowBlobTex;
}

export type StudioFloorProps = {
  y?: number;
  /** Diameter of the visible (faded) floor disc. */
  size?: number;
  color?: string;
  roughness?: number;
  metalness?: number;
  envMapIntensity?: number;
  opacity?: number;
};

/**
 * Glossy dark studio floor. A low-roughness metallic plane reflects the
 * StageEnvironment env, and an alphaMap fades the disc into the black backdrop
 * so it never washes out — a hint of reflected sheen under the hero that reads
 * instantly as "premium studio". Composites cleanly over the shared Backdrop.
 */
export const StudioFloor: React.FC<StudioFloorProps> = ({
  y = 0,
  size = 42,
  color = '#05070b',
  // Higher roughness → a soft studio sweep instead of a sharp procedural
  // ripple / a hard reflected hotspot of the env patches.
  roughness = 0.6,
  metalness = 1,
  envMapIntensity = 1.15,
  opacity = 1,
}) => (
  <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]}>
    <circleGeometry args={[size / 2, 64]} />
    <meshStandardMaterial
      color={color}
      metalness={metalness}
      roughness={roughness}
      envMapIntensity={envMapIntensity}
      transparent
      opacity={opacity}
      alphaMap={getRadialAlpha()}
      depthWrite={false}
    />
  </mesh>
);

export type ContactShadowProps = {
  position?: Vec3;
  /** World radius of the shadow blob. */
  radius?: number;
  opacity?: number;
  /** Optional non-uniform footprint (x, z scale) for wide props. */
  scale?: [number, number];
};

/**
 * Soft baked contact shadow — a dark radial blob laid flat just above the
 * floor, directly under a model, so it visually sits on the stage. Deterministic
 * (a static CanvasTexture; no shadow-map jitter), cheap, and reads as a soft
 * ambient-occlusion pool.
 */
export const ContactShadow: React.FC<ContactShadowProps> = ({
  position = [0, 0, 0],
  radius = 1,
  opacity = 0.7,
  scale = [1, 1],
}) => (
  <mesh
    rotation={[-Math.PI / 2, 0, 0]}
    position={position}
    scale={[radius * scale[0], radius * scale[1], 1]}
  >
    <planeGeometry args={[2, 2]} />
    <meshBasicMaterial
      map={getShadowBlob()}
      transparent
      opacity={opacity}
      depthWrite={false}
      color="#000000"
    />
  </mesh>
);

// ───────────────────────────────────────────────────────────────────────────
// Icon3D — extruded, beveled, emissive 2D-icon badges
// ───────────────────────────────────────────────────────────────────────────

/**
 * FILLED (not stroke) 24×24 SVG glyph paths — solid so SVGLoader.createShapes
 * yields real extrudable shapes. Add glyphs here or pass a raw `path`.
 */
export const ICON_PATHS = {
  // lightning bolt
  bolt: 'M13 2 L4 14 L11 14 L10 22 L20 9 L13 9 Z',
  // four-point sparkle
  spark: 'M12 2 C13 8 16 11 22 12 C16 13 13 16 12 22 C11 16 8 13 2 12 C8 11 11 8 12 2 Z',
  // rounded shield
  shield: 'M12 2 L20 5 V11 C20 16 16.5 20 12 22 C7.5 20 4 16 4 11 V5 Z',
  // solid rounded square "chip"
  cpu: 'M6 4 H18 A2 2 0 0 1 20 6 V18 A2 2 0 0 1 18 20 H6 A2 2 0 0 1 4 18 V6 A2 2 0 0 1 6 4 Z',
  // upward play/rocket triangle
  play: 'M6 3 L21 12 L6 21 Z',
} as const;

export type IconGlyph = keyof typeof ICON_PATHS;

/** Extrude + bevel + center + normalize a filled SVG path to a ~1-unit glyph. */
function buildIconGeometry(d: string, depth: number): THREE.ExtrudeGeometry {
  const parsed = new SVGLoader().parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${d}"/></svg>`,
  );
  const shapes: THREE.Shape[] = [];
  for (const p of parsed.paths) {
    for (const shape of SVGLoader.createShapes(p)) shapes.push(shape);
  }
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.4,
    bevelSize: 0.6,
    bevelSegments: 3,
    steps: 1,
    curveSegments: 16,
  });
  geo.computeBoundingBox();
  const bb = geo.boundingBox as THREE.Box3;
  const cx = (bb.min.x + bb.max.x) / 2;
  const cy = (bb.min.y + bb.max.y) / 2;
  const cz = (bb.min.z + bb.max.z) / 2;
  const maxDim = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y) || 1;
  geo.translate(-cx, -cy, -cz);
  geo.scale(1 / maxDim, -1 / maxDim, 1 / maxDim); // flip Y: SVG is Y-down
  return geo;
}

export type Icon3DProps = {
  /** Named glyph from ICON_PATHS, or supply a raw filled path via `path`. */
  glyph?: IconGlyph;
  /** Raw filled SVG path `d` in a 24×24 viewBox (overrides `glyph`). */
  path?: string;
  color?: string;
  /** World size of the (normalized) glyph. */
  size?: number;
  /** Extrusion depth in glyph-normalized units before `size`. */
  depth?: number;
  position?: Vec3;
  rotation?: Vec3;
  emissiveIntensity?: number;
  metalness?: number;
  roughness?: number;
  opacity?: number;
};

/**
 * A premium 3D icon badge: an extruded, beveled, emissive brand-colored glyph
 * that reads as a solid object under StageEnvironment reflections — not a flat
 * sprite. Fully synchronous / deterministic.
 */
export const Icon3D: React.FC<Icon3DProps> = ({
  glyph = 'spark',
  path,
  color = PALETTE.amber,
  size = 1,
  depth = 6,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  emissiveIntensity = 0.85,
  metalness = 0.6,
  roughness = 0.25,
  opacity = 1,
}) => {
  const d = path ?? ICON_PATHS[glyph];
  const geometry = useMemo(() => buildIconGeometry(d, depth), [d, depth]);
  return (
    <group position={position} rotation={rotation} scale={[size, size, size]}>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={emissiveIntensity}
          metalness={metalness}
          roughness={roughness}
          transparent={opacity < 1}
          opacity={opacity}
        />
      </mesh>
    </group>
  );
};

// ───────────────────────────────────────────────────────────────────────────
// FilmGrade — 2D cinematic post (deterministic, over the canvas — NOT in-WebGL)
// ───────────────────────────────────────────────────────────────────────────

export type FilmGradeProps = {
  children: React.ReactNode;
  /** Vignette darkness 0..1 at the corners. */
  vignette?: number;
  /** Film-grain overlay opacity 0..~0.12. */
  grain?: number;
  /** Edge chromatic-aberration channel offset in px (0 disables). */
  aberration?: number;
  /** CSS contrast multiplier applied to the graded layer. */
  contrast?: number;
  /** CSS saturation multiplier applied to the graded layer. */
  saturate?: number;
};

/**
 * Cinematic 2D post as a Remotion overlay (fully deterministic — no WebGL
 * EffectComposer, so no Remotion out-of-order/demand-frameloop hazards):
 *   • filmic contrast/saturation lift + edge chromatic aberration via an SVG
 *     channel-split filter applied to the wrapped canvas layer,
 *   • a soft vignette,
 *   • SEEDED film grain whose turbulence seed is derived from useCurrentFrame()
 *     (animated yet a pure function of the frame → identical on any re-render,
 *     any order).
 * Wrap the ThreeCanvas; keep captions OUTSIDE so text stays crisp/ungrained.
 */
export const FilmGrade: React.FC<FilmGradeProps> = ({
  children,
  vignette = 0.55,
  grain = 0.055,
  aberration = 1.4,
  contrast = 1.07,
  saturate = 1.08,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const gradeFilter =
    (aberration > 0 ? 'url(#ptah-ca) ' : '') +
    `contrast(${contrast}) saturate(${saturate})`;

  return (
    <AbsoluteFill>
      {/* SVG filter defs (0-size, just carries the CA filter). */}
      <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
        <defs>
          <filter id="ptah-ca" x="-2%" y="-2%" width="104%" height="104%">
            {/* red shifted +x, blue shifted -x, green kept — screened back. */}
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="r"
            />
            <feOffset in="r" dx={aberration} dy="0" result="rO" />
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="g"
            />
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
              result="b"
            />
            <feOffset in="b" dx={-aberration} dy="0" result="bO" />
            <feBlend in="rO" in2="g" mode="screen" result="rg" />
            <feBlend in="rg" in2="bO" mode="screen" />
          </filter>
        </defs>
      </svg>

      {/* Graded + chromatically-aberrated canvas layer. */}
      <AbsoluteFill style={{ filter: gradeFilter }}>{children}</AbsoluteFill>

      {/* Vignette — soft radial darken toward the corners. */}
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          background: `radial-gradient(125% 118% at 50% 45%, rgba(0,0,0,0) 52%, rgba(0,0,0,${vignette}) 100%)`,
        }}
      />

      {/* Seeded, frame-animated film grain (overlay blend, low opacity). */}
      {grain > 0 ? (
        <AbsoluteFill
          style={{ pointerEvents: 'none', opacity: grain, mixBlendMode: 'overlay' }}
        >
          <svg width={width} height={height}>
            <filter id="ptah-grain">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.9"
                numOctaves={2}
                seed={frame}
                stitchTiles="stitch"
              />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <rect width="100%" height="100%" filter="url(#ptah-grain)" />
          </svg>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
