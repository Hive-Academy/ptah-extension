/**
 * story-scenes-v2 — the visual upgrade of the 8 beats of "From Cold Clone to
 * Scalable SaaS" (promos/ptah-saas-story.json). Each scene is a COMPOSITE of
 * at least two visual layers (3D + 2D kinetic type + number payoff / product
 * surface) with spatial camera motion via CameraRig or the story-kit-3d dolly
 * helpers, reusing the heavy 3D kit (GlassHero, Icon3D, StudioFloor,
 * ContactShadow, GltfModel, ProviderOrbit-style hex core) — no new GLB assets.
 *
 * Brand discipline preserved: amber #f5a524 is the ONLY accent; emerald #34d399
 * only for success/active; ink #08090c base; sentence case; no glow blobs.
 *
 * DETERMINISM: every motion derives from useCurrentFrame() / `frame`. No
 * Math.random, no CSS animations, no useFrame(delta), no THREE.Clock.
 */
import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import * as THREE from 'three';
import type { ConceptSceneProps } from '../PromoReel';
import { THEME } from '../theme';
import {
  CameraRig,
  ConceptThreeCanvas,
  Glow,
  Label,
  LightRig,
  PALETTE,
  Stars,
  breathAt,
  lerp3,
  type Vec3,
} from '../concept3d/three-kit';
import {
  ContactShadow,
  FilmGrade,
  GltfModel,
  Icon3D,
  preloadGltf,
  StageEnvironment,
  StudioFloor,
} from '../concept3d/three-assets';
import { GlassHero } from '../concept3d/GlassHero';
import { CaptionRail } from './scene-kit';
import {
  AMBER,
  EMERALD,
  TEXT_STRONG,
  TEXT_SOFT,
  TEXT_FAINT,
  ShaderBackdrop,
  GrainLayer,
  Vignette,
  storyRootStyle,
} from './story-kit';
import {
  CenterAt,
  Chip,
  CinematicOrbit,
  CinematicPushIn,
  Kicker,
  NumberWheelInline,
  win,
} from './story-kit-3d';
import { SoftBlurIn } from '../remocn/components/remocn/soft-blur-in';
import { TrackingIn } from '../remocn/components/remocn/tracking-in';
import { NumberWheel } from '../remocn/components/remocn/number-wheel';
import { GlassCodeBlock } from '../remocn/components/remocn/glass-code-block';
import {
  TerminalSimulator,
  type TerminalLine,
} from '../remocn/components/remocn/terminal-simulator';

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const EASE = Easing.inOut(Easing.cubic);

// Preload the reusable GLB set (no new assets — same as AssetSheet/AgentShowcase).
const ROBOT = 'models/RobotExpressive.glb';
const ROCKET = 'models/rocket.glb';
const DRONE = 'models/drone.glb';
const COMPUTER = 'models/computer.glb';
[ROBOT, ROCKET, DRONE, COMPUTER].forEach(preloadGltf);

const FLOOR_Y = -1.55;
const SHADOW_Y = FLOOR_Y + 0.02;

// ── Beat 1 · Hook ────────────────────────────────────────────────────────────
export const StoryHookV2: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const df = durationFrames;

  // Slow camera push through the sparse 3D glass-node field.
  const { position, lookAt } = CinematicPushIn(
    frame,
    df,
    [0, 0.2, 9.5],
    [0, 0.1, 7.0],
    [0, 0, 0],
  );

  const line1Op = win(frame, 6, df * 0.5, 14);
  const line2Op = win(frame, df * 0.32, df, 14);

  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.5} />
      {/* 3D glass-node field with a slow camera push — reads as "cold, drifting
          intelligence" behind the kinetic type. */}
      <FilmGrade grain={0} aberration={0.4} vignette={0.4} contrast={1.05} saturate={1.05}>
        <ConceptThreeCanvas fov={42}>
          <CameraRig position={position} lookAt={lookAt} />
          <LightRig />
          <Stars frame={frame} count={28} />
          <SparseGlyphField frame={frame} duration={df} reveal={interpolate(frame, [0, 24], [0, 1], CLAMP)} />
        </ConceptThreeCanvas>
      </FilmGrade>
      <GrainLayer opacity={0.05} />

      {/* Kinetic type — the cold-start claim. */}
      <AbsoluteFill style={{ opacity: line1Op }}>
        <CenterAt dy={-40 * s}>
          <SoftBlurIn
            text="Most AI coding tools start cold."
            fontSize={Math.round(66 * s)}
            color={TEXT_STRONG}
            fontWeight={600}
          />
        </CenterAt>
      </AbsoluteFill>
      <Sequence from={Math.round(df * 0.32)}>
        <AbsoluteFill style={{ opacity: line2Op }}>
          <CenterAt dy={64 * s}>
            <SoftBlurIn
              text="They forget. They autocomplete."
              fontSize={Math.round(36 * s)}
              color={TEXT_FAINT}
              fontWeight={500}
            />
          </CenterAt>
        </AbsoluteFill>
      </Sequence>

      <CaptionRail slide={slide} durationFrames={df} width={width} />
      <Vignette amount={0.42} />
    </AbsoluteFill>
  );
};

/** A sparse field of small extruded Icon3D spark/cpu glyphs + tiny icosahedrons
 *  drifting behind the hook text — "intelligence in the air" without a wash. */
const SparseGlyphField: React.FC<{
  frame: number;
  duration: number;
  reveal: number;
}> = ({ frame, reveal }) => {
  // Deterministic lattice of glyph positions.
  const nodes = useMemo(() => {
    const out: { pos: Vec3; glyph: 'spark' | 'cpu'; scale: number; phase: number }[] = [];
    let i = 0;
    const spread = 7;
    const step = 2.4;
    for (let x = -spread; x <= spread; x += step) {
      for (let y = -2.5; y <= 2.5; y += step) {
        for (let z = -3; z <= 1; z += step) {
          if (i % 3 !== 0) { i++; continue; }
          out.push({
            pos: [x, y, z],
            glyph: i % 2 === 0 ? 'spark' : 'cpu',
            scale: 0.22 + ((i % 4) / 4) * 0.1,
            phase: i * 13,
          });
          i++;
        }
      }
    }
    return out;
  }, []);

  return (
    <>
      {nodes.map((n, idx) => {
        const bob = breathAt(frame, 130, n.phase) * 0.22 - 0.11;
        const spin = frame * 0.008 + idx * 0.5;
        const opacity = Math.min(1, reveal * 0.6);
        return (
          <group
            key={idx}
            position={[n.pos[0], n.pos[1] + bob, n.pos[2]]}
            scale={[n.scale * reveal, n.scale * reveal, n.scale * reveal]}
            rotation={[spin * 0.4, spin, spin * 0.3]}
          >
            <Icon3D
              glyph={n.glyph}
              color={idx % 5 === 0 ? PALETTE.emerald : PALETTE.amber}
              size={1}
              emissiveIntensity={0.5}
              metalness={0.5}
              roughness={0.3}
              opacity={opacity}
            />
          </group>
        );
      })}
    </>
  );
};

// ── Beat 2 · Positioning ─────────────────────────────────────────────────────
export const StoryPositioningV2: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const df = durationFrames;

  // GlassHero rising + rotating behind the text; camera slowly pushes in.
  const reveal = interpolate(frame, [0, 30], [0, 1], CLAMP);

  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.54} />
      <GrainLayer opacity={0.05} />
      <FilmGrade grain={0} aberration={0} vignette={0.42} contrast={1.05} saturate={1.05}>
        <ConceptThreeCanvas fov={40}>
          <GlassHero frame={frame} duration={df} reveal={reveal} />
        </ConceptThreeCanvas>
      </FilmGrade>

      {/* Amber "Ptah" tracking in, sub-line below. Crystal rises behind. */}
      <CenterAt dy={-46 * s}>
        <TrackingIn text="Ptah" fontSize={Math.round(150 * s)} color={AMBER} fontWeight={700} />
      </CenterAt>
      <Sequence from={Math.round(df * 0.28)}>
        <CenterAt dy={92 * s}>
          <SoftBlurIn
            text="boots a project-aware orchestra."
            fontSize={Math.round(44 * s)}
            color={TEXT_STRONG}
            fontWeight={500}
          />
        </CenterAt>
      </Sequence>

      <CaptionRail slide={slide} durationFrames={df} width={width} />
      <Vignette amount={0.44} />
    </AbsoluteFill>
  );
};

// ── Beat 3 · Setup Wizard ────────────────────────────────────────────────────
const WIZARD_STEPS = ['Welcome', 'Scan', 'Analysis', 'Selection', 'Enhance', 'Generation', 'Completion'];

const WizardSteps: React.FC<{ frame: number; stepDur: number; s: number }> = ({
  frame,
  stepDur,
  s,
}) => {
  const steps = WIZARD_STEPS;
  const n = steps.length;
  const W = 1560 * s;
  const R = 22 * s;
  const inner = W - 2 * R;
  const fillFrac = interpolate(frame, [0, (n - 1) * stepDur], [0, 1], CLAMP);
  return (
    <div style={{ position: 'relative', width: W, height: 110 * s }}>
      <div style={{ position: 'absolute', top: R - 1.5 * s, left: R, width: inner, height: 3 * s, background: 'rgba(255,255,255,0.14)', borderRadius: 2 }} />
      <div style={{ position: 'absolute', top: R - 1.5 * s, left: R, width: inner * fillFrac, height: 3 * s, background: AMBER, borderRadius: 2 }} />
      {steps.map((label, i) => {
        const x = R + inner * (i / (n - 1));
        const active = frame >= i * stepDur + 4;
        const pop = interpolate(frame, [i * stepDur, i * stepDur + 10], [0.7, 1], CLAMP);
        return (
          <div key={i} style={{ position: 'absolute', left: x, top: 0, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 * s }}>
            <div
              style={{
                width: R * 2,
                height: R * 2,
                borderRadius: 999,
                background: active ? AMBER : 'rgba(255,255,255,0.06)',
                border: `2px solid ${active ? AMBER : 'rgba(255,255,255,0.18)'}`,
                transform: `scale(${pop})`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#08090c',
                fontSize: 20 * s,
                fontWeight: 700,
              }}
            >
              {active ? '✓' : ''}
            </div>
            <span style={{ fontFamily: THEME.font, color: active ? TEXT_SOFT : TEXT_FAINT, fontSize: 20 * s, fontWeight: 500, whiteSpace: 'nowrap' }}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export const StoryWizardV2: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const df = durationFrames;

  // Camera: slow push-in on the 3D console stage.
  const { position, lookAt } = CinematicPushIn(
    frame,
    df,
    [0, 1.4, 9.5],
    [0, 1.2, 8.0],
    [0, 0.5, 0],
  );

  const stepsOp = win(frame, 10, df * 0.42, 12);
  const numOp = win(frame, df * 0.48, df * 0.68, 12);
  const chipsOp = win(frame, df * 0.74, df, 12);
  const chipPeel = interpolate(frame, [df * 0.82, df * 0.98], [0, 1], CLAMP);
  const stepDur = Math.max(10, Math.round((df * 0.36) / WIZARD_STEPS.length));

  // Orbiting agent chips in 3D (Copilot/Codex/Cursor) around the console.
  const agentChips = [
    { name: 'Copilot', color: '#7aa2ff' },
    { name: 'Codex', color: '#7fd4c1' },
    { name: 'Cursor', color: '#b48cff' },
  ];

  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.6} />
      {/* 3D stage: a computer/console prop with small orbiting agent chips. */}
      <FilmGrade grain={0} aberration={0.4} vignette={0.42} contrast={1.05} saturate={1.05}>
        <ConceptThreeCanvas fov={40}>
          <StageEnvironment intensity={0.9} exposure={1.05} />
          <CameraRig position={position} lookAt={lookAt} />
          <Stars frame={frame} count={22} />
          <StudioFloor y={FLOOR_Y} size={22} opacity={interpolate(frame, [0, 24], [0, 1], CLAMP)} />
          <ContactShadow position={[0, SHADOW_Y, 0]} radius={1.4} opacity={0.6} />

          {/* Console prop. */}
          <group position={[0, FLOOR_Y + 0.55, 0]} scale={[1.5, 1.5, 1.5]}>
            <GltfModel
              src={COMPUTER}
              normalize
              rotation={[0, -0.4, 0]}
              brandify={{
                base: '#454b55',
                accent: PALETTE.emerald,
                glowParts: ['screen', 'monitor', 'display'],
                emissive: PALETTE.emeraldLight,
                metalness: 0.5,
                roughness: 0.52,
              }}
              envMapIntensity={1.1}
            />
          </group>
          <Glow color={PALETTE.emerald} scale={2.0} opacity={0.22} position={[0, FLOOR_Y + 0.8, 0]} />

          {/* Orbiting agent chips. */}
          {agentChips.map((a, i) => {
            const angle = (i / agentChips.length) * Math.PI * 2 + frame * 0.02;
            const r = 1.8 + breathAt(frame, 90, i * 30) * 0.15;
            const pos: Vec3 = [
              Math.cos(angle) * r,
              FLOOR_Y + 1.1 + Math.sin(angle * 2 + i) * 0.18,
              Math.sin(angle) * r * 0.6,
            ];
            return (
              <group key={a.name} position={pos}>
                <mesh>
                  <icosahedronGeometry args={[0.16, 1]} />
                  <meshStandardMaterial
                    color={a.color}
                    emissive={a.color}
                    emissiveIntensity={0.6}
                    metalness={0.3}
                    roughness={0.3}
                  />
                </mesh>
                <Glow color={a.color} scale={0.8} opacity={0.4} />
                <Label text={a.name} position={[0, 0.34, 0]} height={0.18} opacity={0.85} />
              </group>
            );
          })}
        </ConceptThreeCanvas>
      </FilmGrade>

      <Kicker text="Setup wizard" s={s} opacity={stepsOp} />

      {/* Phase A — the 7-step 2D overlay. */}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: stepsOp }}>
        <WizardSteps frame={frame} stepDur={stepDur} s={s} />
      </AbsoluteFill>

      {/* Phase B — 15 specialist agents payoff (NumberWheel + 3D nodes fly in). */}
      <Sequence from={Math.round(df * 0.46)}>
        <AbsoluteFill style={{ opacity: numOp }}>
          <CenterAt dy={-30 * s}>
            <NumberWheel from={0} to={15} fontSize={Math.round(140 * s)} color={AMBER} />
          </CenterAt>
          <AbsoluteFill
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              transform: `translateY(${108 * s}px)`,
              color: TEXT_STRONG,
              fontFamily: THEME.font,
              fontSize: 32 * s,
              fontWeight: 500,
            }}
          >
            specialist agents, from your real code
          </AbsoluteFill>
        </AbsoluteFill>
      </Sequence>

      {/* Phase C — mirrored to every CLI (chips peel outward). */}
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          opacity: chipsOp,
          gap: 22 * s,
          flexDirection: 'column',
        }}
      >
        <div style={{ color: TEXT_SOFT, fontFamily: THEME.font, fontSize: 30 * s, fontWeight: 500, marginBottom: 8 * s }}>
          Mirrored to every CLI
        </div>
        <div style={{ display: 'flex', gap: 26 * s }}>
          <div style={{ transform: `translateX(${-chipPeel * 120 * s}px)` }}>
            <Chip label="Copilot" s={s} />
          </div>
          <Chip label="Codex" s={s} />
          <div style={{ transform: `translateX(${chipPeel * 120 * s}px)` }}>
            <Chip label="Cursor" s={s} />
          </div>
        </div>
      </AbsoluteFill>

      <CaptionRail slide={slide} durationFrames={df} width={width} />
      <Vignette amount={0.42} />
    </AbsoluteFill>
  );
};

// ── Beat 4 · Orchestration ───────────────────────────────────────────────────
const ORCHESTRATION_LINES: TerminalLine[] = [
  { text: 'ptah orchestrate "add billing webhooks"', type: 'command', delay: 0 },
  { text: 'classified: FEATURE · depth: full', type: 'log', delay: 12 },
  { text: 'conductor never writes code — it delegates', type: 'log', delay: 8 },
  { text: 'backend-developer     building webhook handler', type: 'log', delay: 8 },
  { text: 'nestjs-specialist     wiring the Paddle route', type: 'log', delay: 6 },
  { text: 'CLI agents (max 3): ptah-cli · codex · copilot', type: 'log', delay: 8 },
  { text: '3 agents running in parallel...', type: 'log', delay: 6 },
  { text: 'code-logic-reviewer   reviewing the diff...', type: 'log', delay: 10 },
  { text: 'review passed — commit gated', type: 'success', delay: 12 },
];

export const StoryOrchestrationV2: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const df = durationFrames;
  const capOp = win(frame, df * 0.62, df, 16);

  // Slow camera orbit around the terminal-in-glass-slab.
  const { position, lookAt } = CinematicOrbit(
    frame,
    df,
    0.9, // radius — small orbit, mostly a drift
    0.2,
    [0, 0, 0],
    0.35, // ~1/3 revolution over the beat
    Math.PI * 0.25, // start offset
  );

  // 3D agent nodes fanning out around the terminal.
  const agents = [
    { name: 'backend', color: PALETTE.amber },
    { name: 'nestjs', color: PALETTE.emerald },
    { name: 'reviewer', color: PALETTE.amberLight },
  ];

  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.62} />
      <FilmGrade grain={0} aberration={0.5} vignette={0.42} contrast={1.06} saturate={1.05}>
        <ConceptThreeCanvas fov={42}>
          <StageEnvironment intensity={0.85} exposure={1.05} />
          <CameraRig position={position} lookAt={lookAt} />
          <Stars frame={frame} count={20} />

          {/* Glass slab frame around the terminal — a refractive box. */}
          <group rotation={[0, frame * 0.002, 0]}>
            <mesh position={[0, 0, -0.1]}>
              <boxGeometry args={[5.4, 3.2, 0.18]} />
              <meshPhysicalMaterial
                transmission={0.9}
                thickness={0.4}
                roughness={0.12}
                ior={1.45}
                clearcoat={1}
                clearcoatRoughness={0.08}
                attenuationColor={'#dce8f4'}
                attenuationDistance={2.2}
                color={'#ffffff'}
                transparent
                opacity={0.55}
                envMapIntensity={1.5}
              />
            </mesh>
            {/* Thin amber border rings. */}
            <mesh position={[0, 1.6, 0]}>
              <boxGeometry args={[5.4, 0.04, 0.2]} />
              <meshStandardMaterial color={PALETTE.amber} emissive={PALETTE.amber} emissiveIntensity={0.6} metalness={0.4} roughness={0.3} />
            </mesh>
            <mesh position={[0, -1.6, 0]}>
              <boxGeometry args={[5.4, 0.04, 0.2]} />
              <meshStandardMaterial color={PALETTE.amber} emissive={PALETTE.amber} emissiveIntensity={0.6} metalness={0.4} roughness={0.3} />
            </mesh>
          </group>

          {/* Agent nodes fanning out around the terminal. */}
          {agents.map((a, i) => {
            const angle = (i / agents.length) * Math.PI * 2 + frame * 0.006;
            const r = 3.4 + breathAt(frame, 80, i * 20) * 0.18;
            const pos: Vec3 = [Math.cos(angle) * r, Math.sin(angle) * 0.8, Math.sin(angle) * r * 0.5];
            return (
              <group key={a.name} position={pos}>
                <mesh>
                  <icosahedronGeometry args={[0.2, 1]} />
                  <meshStandardMaterial
                    color={a.color}
                    emissive={a.color}
                    emissiveIntensity={0.7}
                    metalness={0.3}
                    roughness={0.3}
                  />
                </mesh>
                <Glow color={a.color} scale={0.9} opacity={0.4} />
                <Label text={a.name} position={[0, 0.4, 0]} height={0.2} opacity={0.85} />
              </group>
            );
          })}
        </ConceptThreeCanvas>
      </FilmGrade>

      {/* TerminalSimulator as a 2D overlay, scaled to sit inside the glass slab. */}
      <AbsoluteFill style={{ transform: `scale(${1.3 * s})`, transformOrigin: 'center' }}>
        <TerminalSimulator
          lines={ORCHESTRATION_LINES}
          prompt="$"
          title="~/apps/ptah-license-server"
          background="#0b0d11"
          chromeColor="#14171d"
          fontSize={17}
          charsPerFrame={2.2}
          chunkSize={3}
        />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingBottom: 80 * s,
          opacity: capOp,
        }}
      >
        <div
          style={{
            fontFamily: THEME.font,
            color: TEXT_SOFT,
            fontSize: 30 * s,
            fontWeight: 500,
          }}
        >
          Reviewed before every commit
        </div>
      </AbsoluteFill>
      <CaptionRail slide={slide} durationFrames={df} width={width} />
      <Vignette amount={0.4} />
    </AbsoluteFill>
  );
};

// ── Beat 5 · Nx / hexagonal foundation ───────────────────────────────────────
export const StoryFoundationV2: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const df = durationFrames;
  const reveal = interpolate(frame, [0, 30], [0, 1], CLAMP);
  const numOp = win(frame, df * 0.5, df * 0.86);
  const capA = win(frame, 16, df * 0.5, 16);
  const capB = win(frame, df * 0.82, df, 14);

  // The GlassHero crystal is the spine; we ALSO render provider/adapter nodes
  // that dock onto the hex faces (reusing the ProviderOrbit docking pattern).
  // Camera: push + slow orbit via GlassHero's own rig, augmented here.
  // GlassHero sets its own CameraRig internally, so we let it drive the camera.

  // Docking nodes (6 ports visible, 3 adapters docked) — reuse ProviderOrbit pattern.
  const CORE_R = 1.25;
  const ORBIT_R = 2.8;
  const PROVIDERS = [
    { name: 'Claude', color: '#f0925c', docked: true },
    { name: 'Codex', color: '#7fd4c1', docked: true },
    { name: 'Copilot', color: '#7aa2ff', docked: true },
    { name: 'Kimi', color: '#b48cff', docked: false },
    { name: 'GLM', color: '#5eead4', docked: false },
    { name: 'Ollama', color: '#e2e8f0', docked: false },
  ] as const;

  const dockProgress = interpolate(frame, [df * 0.25, df * 0.6], [0, 1], { ...CLAMP, easing: EASE });
  const dockEase = dockProgress * dockProgress * (3 - 2 * dockProgress);

  const nodes = PROVIDERS.map((p, i) => {
    const angle = (i / PROVIDERS.length) * Math.PI * 2 + frame * 0.004;
    const orbitPos: Vec3 = [
      Math.cos(angle) * ORBIT_R,
      Math.sin(angle * 2 + i * 1.7) * 0.16,
      Math.sin(angle) * ORBIT_R,
    ];
    const anchor: Vec3 = [
      Math.cos(angle) * (CORE_R + 0.6),
      0,
      Math.sin(angle) * (CORE_R + 0.6),
    ];
    const dock = p.docked ? dockEase : 0;
    return { ...p, position: lerp3(orbitPos, anchor, dock), angle };
  });

  const corePulse = 0.45 + dockEase * 0.8 + breathAt(frame, 70) * 0.25;
  const coreEdges = useMemo(
    () => new THREE.EdgesGeometry(new THREE.CylinderGeometry(CORE_R, CORE_R, 0.5, 6)),
    [],
  );

  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.6} />
      <GrainLayer opacity={0.05} />
      <FilmGrade grain={0} aberration={0} vignette={0.42} contrast={1.05} saturate={1.05}>
        <ConceptThreeCanvas fov={40}>
          {/* Use GlassHero for the crystal spine — it sets its own camera rig. */}
          <GlassHero frame={frame} duration={df} reveal={reveal} />

          {/* Extra: provider/adapter nodes docking onto the hex faces. These
              share the scene with GlassHero's crystal. */}
          {nodes.map((n) => (
            <group key={n.name} position={n.position}>
              <mesh>
                <icosahedronGeometry args={[0.22, 1]} />
                <meshStandardMaterial
                  color={n.color}
                  emissive={n.color}
                  emissiveIntensity={0.5 + (n.docked ? dockEase * 0.9 : 0) + breathAt(frame, 48, 0) * 0.15}
                  metalness={0.25}
                  roughness={0.35}
                  transparent
                  opacity={reveal}
                />
              </mesh>
              <Glow color={n.color} scale={1.1 + (n.docked ? dockEase * 0.5 : 0)} opacity={reveal * 0.45} />
              <Label text={n.name} position={[0, 0.5, 0]} height={0.2} opacity={reveal * 0.85} />
            </group>
          ))}

          {/* Extra core edge ring to reinforce the hexagonal ports read. */}
          <group rotation={[Math.PI / 2, 0, frame * 0.004]}>
            <lineSegments geometry={coreEdges} scale={[1.04, 1.04, 1.04]}>
              <lineBasicMaterial color={PALETTE.amber} transparent opacity={reveal * 0.5} />
            </lineSegments>
          </group>
          <Glow color={PALETTE.amber} scale={3.2} opacity={reveal * (0.2 + dockEase * 0.15)} />
        </ConceptThreeCanvas>
      </FilmGrade>

      {/* Caption A — name the core. */}
      <AbsoluteFill
        style={{ alignItems: 'center', justifyContent: 'flex-start', paddingTop: 130 * s, opacity: capA }}
      >
        <div style={{ fontFamily: THEME.font, color: TEXT_SOFT, fontSize: 30 * s, fontWeight: 500 }}>
          A hexagonal core
        </div>
      </AbsoluteFill>

      {/* Payoff — 16 platform ports · 3 adapters. */}
      <Sequence from={Math.round(df * 0.46)}>
        <AbsoluteFill style={{ opacity: numOp, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 150 * s }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 * s }}>
            <NumberWheelInline to={16} s={s} />
            <span style={{ fontFamily: THEME.font, color: TEXT_STRONG, fontSize: 40 * s, fontWeight: 600 }}>
              platform ports · 3 adapters
            </span>
          </div>
        </AbsoluteFill>
      </Sequence>

      {/* Caption B — the promise. */}
      <AbsoluteFill
        style={{ alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 80 * s, opacity: capB }}
      >
        <div style={{ fontFamily: THEME.font, color: AMBER, fontSize: 30 * s, fontWeight: 600 }}>
          Boundaries enforced, day one
        </div>
      </AbsoluteFill>
      <CaptionRail slide={slide} durationFrames={df} width={width} />
      <Vignette amount={0.4} />
    </AbsoluteFill>
  );
};

// ── Beat 6 · SaaS lifecycle ──────────────────────────────────────────────────
const WEBHOOK_CODE = `@Post('paddle')
@HttpCode(200)
async handle(@Req() req: RawBodyRequest<Request>) {
  this.verify(req);              // signature + idempotency
  await this.subscriptions.apply(req.body);
  return { received: true };
}`;

export const StoryLifecycleV2: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const df = durationFrames;
  const tickOp = win(frame, df * 0.55, df, 14);

  // Slow orbit around the glass code panel.
  const { position, lookAt } = CinematicOrbit(
    frame,
    df,
    0.7,
    0.15,
    [0, 0, 0],
    0.3,
    0,
  );

  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.6} />
      <FilmGrade grain={0} aberration={0.4} vignette={0.42} contrast={1.05} saturate={1.05}>
        <ConceptThreeCanvas fov={42}>
          <StageEnvironment intensity={0.85} exposure={1.05} />
          <CameraRig position={position} lookAt={lookAt} />
          <Stars frame={frame} count={20} />

          {/* 3D glass panel behind the code block. */}
          <group rotation={[0, frame * 0.001, 0]}>
            <mesh position={[0, 0, -0.15]}>
              <boxGeometry args={[6.2, 4.0, 0.2]} />
              <meshPhysicalMaterial
                transmission={0.9}
                thickness={0.4}
                roughness={0.12}
                ior={1.45}
                clearcoat={1}
                clearcoatRoughness={0.08}
                attenuationColor={'#dce8f4'}
                attenuationDistance={2.2}
                color={'#ffffff'}
                transparent
                opacity={0.45}
                envMapIntensity={1.5}
              />
            </mesh>
            {/* Amber accent bar. */}
            <mesh position={[0, 2.0, 0]}>
              <boxGeometry args={[6.2, 0.05, 0.25]} />
              <meshStandardMaterial color={PALETTE.amber} emissive={PALETTE.amber} emissiveIntensity={0.6} metalness={0.4} roughness={0.3} />
            </mesh>
          </group>

          {/* Small 3D server/webhook element (a brandified primitive server rack). */}
          <group position={[3.2, -1.0, 1.0]} rotation={[0, -0.4, 0]}>
            <mesh>
              <boxGeometry args={[0.8, 1.2, 0.6]} />
              <meshStandardMaterial color="#3c424c" metalness={0.7} roughness={0.42} envMapIntensity={1.2} />
            </mesh>
            {[0.4, 0.18, -0.04, -0.26, -0.48].map((sy) => (
              <mesh key={sy} position={[0, sy, 0.31]}>
                <boxGeometry args={[0.6, 0.07, 0.03]} />
                <meshStandardMaterial color={PALETTE.emerald} emissive={PALETTE.emerald} emissiveIntensity={1.4} toneMapped={false} />
              </mesh>
            ))}
          </group>
          <Glow color={PALETTE.emerald} scale={1.4} opacity={0.28} position={[3.2, -0.8, 1.0]} />
        </ConceptThreeCanvas>
      </FilmGrade>

      {/* GlassCodeBlock as a 2D overlay on the glass panel. */}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ transform: `scale(${1.25 * s})`, transformOrigin: 'center' }}>
          <GlassCodeBlock
            code={WEBHOOK_CODE}
            title="apps/api/webhooks/paddle.controller.ts"
            glassColor="#0e1319"
            showTrafficLights
            aura={false}
            fontSize={22}
          />
        </div>
      </AbsoluteFill>

      {/* Emerald active tick — success beat. */}
      <AbsoluteFill
        style={{ alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 96 * s, opacity: tickOp }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 * s }}>
          <span style={{ color: EMERALD, fontSize: 30 * s }}>✓</span>
          <span style={{ fontFamily: THEME.font, color: TEXT_SOFT, fontSize: 30 * s, fontWeight: 500 }}>
            Licensing · webhooks · trials — scaffolded in order
          </span>
        </div>
      </AbsoluteFill>
      <CaptionRail slide={slide} durationFrames={df} width={width} />
      <Vignette amount={0.42} />
    </AbsoluteFill>
  );
};

// ── Beat 7 · Proof ───────────────────────────────────────────────────────────
export const StoryProofV2: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const df = durationFrames;
  const rowOp = win(frame, df * 0.34, df, 14);

  // Slow camera truck across the prop shelf.
  const pf = df / 3;
  const camKeys = [0, pf, 2 * pf, df];
  const camPos: Vec3 = [
    interpolate(frame, camKeys, [-2.0, -0.4, 0.8, 1.8], { ...CLAMP, easing: EASE }),
    interpolate(frame, camKeys, [1.6, 1.4, 1.25, 1.1], { ...CLAMP, easing: EASE }),
    interpolate(frame, camKeys, [11.0, 10.2, 9.6, 9.2], { ...CLAMP, easing: EASE }),
  ];
  const camLook: Vec3 = [
    interpolate(frame, camKeys, [-1.2, -0.2, 0.4, 1.0], { ...CLAMP, easing: EASE }),
    0.1,
    0,
  ];

  const rocketIn = interpolate(frame, [pf * 0.1, pf * 0.7], [0, 1], { ...CLAMP, easing: EASE });
  const robotIn = interpolate(frame, [pf * 0.4, pf * 0.7], [0, 1], { ...CLAMP, easing: EASE });
  const floorIn = interpolate(frame, [0, pf * 0.5], [0, 1], { ...CLAMP, easing: EASE });

  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.56} />
      <FilmGrade aberration={0.5} grain={0.04} vignette={0.42} contrast={1.06} saturate={1.05}>
        <ConceptThreeCanvas fov={40}>
          <StageEnvironment intensity={0.95} exposure={1.08} />
          <CameraRig position={camPos} lookAt={camLook} />
          <Stars frame={frame} count={26} />
          <StudioFloor y={FLOOR_Y} size={28} opacity={floorIn} />

          {/* Rocket (left). */}
          <ContactShadow position={[-3.8, SHADOW_Y, -0.3]} radius={1.0} opacity={rocketIn * 0.65} />
          {rocketIn > 0.001 ? (
            <group position={[-3.8, FLOOR_Y + 1.1, -0.3]} scale={[2.0 * rocketIn, 2.0 * rocketIn, 2.0 * rocketIn]}>
              <GltfModel
                src={ROCKET}
                normalize
                rotation={[0, 0.5, 0]}
                brandify={{ base: PALETTE.amberDeep, accent: PALETTE.emerald, glowParts: ['window', 'thruster', 'flame'], emissive: PALETTE.amberLight }}
                envMapIntensity={1.3}
              />
            </group>
          ) : null}
          <Glow color={PALETTE.amber} scale={1.8} opacity={rocketIn * 0.28} position={[-3.8, FLOOR_Y + 0.9, -0.3]} />

          {/* Robot (center). */}
          <ContactShadow position={[0, SHADOW_Y, 0.6]} radius={1.3} opacity={robotIn * 0.7} scale={[1, 0.85]} />
          {robotIn > 0.001 ? (
            <group position={[0, FLOOR_Y + breathAt(frame, 150) * 0.1, 0.6]} scale={[2.4 * robotIn, 2.4 * robotIn, 2.4 * robotIn]}>
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
          <Glow color={PALETTE.amber} scale={1.7} opacity={robotIn * 0.1} position={[0, 0.1, -0.1]} />
          <Label text="AGENT" position={[0, FLOOR_Y + 0.14, 1.6]} height={0.22} color={THEME.textSoft} opacity={robotIn * 0.65} />

          {/* Server rack (right) — a brandified primitive. */}
          <group position={[3.4, FLOOR_Y + 0.6, 0.2]} rotation={[0, -0.35, 0]}>
            <mesh>
              <boxGeometry args={[0.9, 1.3, 0.65]} />
              <meshStandardMaterial color="#3c424c" metalness={0.7} roughness={0.42} envMapIntensity={1.2} />
            </mesh>
            {[0.45, 0.2, -0.05, -0.3, -0.52].map((sy) => (
              <mesh key={sy} position={[0, sy, 0.33]}>
                <boxGeometry args={[0.66, 0.07, 0.03]} />
                <meshStandardMaterial color={PALETTE.emerald} emissive={PALETTE.emerald} emissiveIntensity={1.4} toneMapped={false} />
              </mesh>
            ))}
          </group>
          <ContactShadow position={[3.4, SHADOW_Y, 0.2]} radius={0.85} opacity={0.55} scale={[1.2, 1]} />
          <Glow color={PALETTE.emerald} scale={1.4} opacity={0.25} position={[3.4, FLOOR_Y + 0.6, 0.2]} />
        </ConceptThreeCanvas>
      </FilmGrade>

      <CenterAt dy={-60 * s}>
        <SoftBlurIn text="Ptah runs on this." fontSize={Math.round(72 * s)} color={TEXT_STRONG} fontWeight={600} />
      </CenterAt>
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          transform: `translateY(${70 * s}px)`,
          opacity: rowOp,
          gap: 20 * s,
        }}
      >
        <div style={{ display: 'flex', gap: 20 * s }}>
          <Chip label="NestJS" s={s} />
          <Chip label="Prisma" s={s} />
          <Chip label="Paddle" s={s} accent />
        </div>
        <div
          style={{
            marginTop: 26 * s,
            fontFamily: THEME.font,
            color: TEXT_FAINT,
            fontSize: 26 * s,
            fontWeight: 500,
          }}
        >
          a real SaaS license server, in production
        </div>
      </AbsoluteFill>
      <CaptionRail slide={slide} durationFrames={df} width={width} />
      <Vignette amount={0.42} />
    </AbsoluteFill>
  );
};

// ── Beat 8 · CTA ─────────────────────────────────────────────────────────────
export const StoryCtaV2: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const df = durationFrames;
  const lineOp = win(frame, 24, df, 16);
  const ctaOp = win(frame, df * 0.4, df, 14);
  const reveal = interpolate(frame, [0, 40], [0, 1], CLAMP);

  // Gentle camera pull-back.
  const { position, lookAt } = CinematicPushIn(
    frame,
    df,
    [0, 0.2, 7.2],
    [0, 0.2, 8.6],
    [0, 0, 0],
  );

  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.66} />
      <GrainLayer opacity={0.05} />
      <FilmGrade grain={0} aberration={0} vignette={0.44} contrast={1.05} saturate={1.05}>
        <ConceptThreeCanvas fov={40}>
          {/* Override GlassHero's internal camera with our pull-back rig. We
              mount GlassHero for the crystal but supply our own CameraRig AFTER
              so it wins the pose. */}
          <GlassHero frame={frame} duration={df} reveal={reveal} floor={false} />
          <CameraRig position={position} lookAt={lookAt} />
        </ConceptThreeCanvas>
      </FilmGrade>

      <CenterAt dy={-70 * s}>
        <TrackingIn text="Ptah" fontSize={Math.round(128 * s)} color={AMBER} fontWeight={700} />
      </CenterAt>
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          transform: `translateY(${44 * s}px)`,
          opacity: lineOp,
        }}
      >
        <div style={{ fontFamily: THEME.font, color: TEXT_STRONG, fontSize: 40 * s, fontWeight: 500 }}>
          Build scalable SaaS from day one.
        </div>
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          transform: `translateY(${140 * s}px)`,
          opacity: ctaOp,
          gap: 18 * s,
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: `${14 * s}px ${34 * s}px`,
            borderRadius: 999,
            background: AMBER,
            color: '#08090c',
            fontFamily: THEME.font,
            fontSize: 30 * s,
            fontWeight: 700,
          }}
        >
          Get Ptah free
        </div>
        <div style={{ fontFamily: THEME.font, color: TEXT_FAINT, fontSize: 26 * s, fontWeight: 500 }}>
          ptah.live
        </div>
      </AbsoluteFill>
      <CaptionRail slide={slide} durationFrames={df} width={width} />
      <Vignette amount={0.5} />
    </AbsoluteFill>
  );
};