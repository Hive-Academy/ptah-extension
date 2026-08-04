/**
 * builders-scenes — the 8 beats of the "Ptah Builders" membership launch reel
 * (promos/ptah-builders-launch.json + promos/ptah-builders-launch-vertical.json).
 *
 * Capture-free: every beat is a composite of a 3D stage (three-kit / three-assets
 * / GlassHero) plus 2D kinetic type and a numeric payoff, exactly like
 * story-scenes-v2. NOTHING here depends on the Electron app, Docker, the license
 * server, or the community surface — so this reel can be rendered today.
 *
 * Brand discipline (same contract as story-scenes-v2): amber #f5a524 is THE
 * accent; emerald #34d399 only for success/active/"included"; ink #08090c base;
 * sentence case; no glow blobs.
 *
 * DETERMINISM: every motion derives from useCurrentFrame() / `frame`. No
 * Math.random, no CSS animations, no useFrame(delta), no THREE.Clock.
 *
 * PRICING NOTE: the offer beat renders `$29` / `$290` from the constants below.
 * The founding-member discount is confirmed at 70% off the first year. See
 * EARLY_ADOPTER_LABEL below (and the matching `vo` line in the promo spec) —
 * one place each.
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
import { CenterAt, Chip, CinematicOrbit, CinematicPushIn, Kicker, win } from './story-kit-3d';
import { SoftBlurIn } from '../remocn/components/remocn/soft-blur-in';
import { TrackingIn } from '../remocn/components/remocn/tracking-in';
import { GlassCodeBlock } from '../remocn/components/remocn/glass-code-block';
import {
  TerminalSimulator,
  type TerminalLine,
} from '../remocn/components/remocn/terminal-simulator';

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const EASE = Easing.inOut(Easing.cubic);

const ROBOT = 'models/RobotExpressive.glb';
const ROCKET = 'models/rocket.glb';
const COMPUTER = 'models/computer.glb';
[ROBOT, ROCKET, COMPUTER].forEach(preloadGltf);

const FLOOR_Y = -1.55;
const SHADOW_Y = FLOOR_Y + 0.02;

// ── Offer constants — the ONLY place prices live in the render tree ──────────
const PRICE_MONTHLY = 29;
const PRICE_YEARLY = 290;
/** The confirmed founding-member offer: 70% off the first year. */
const EARLY_ADOPTER_LABEL = '70% off first year · limited seats';

// ── Beat 1 · Hook — the gap between learning and shipping ────────────────────
export const BuildersHook: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const df = durationFrames;

  const { position, lookAt } = CinematicPushIn(
    frame,
    df,
    [0, 0.2, 9.8],
    [0, 0.1, 7.0],
    [0, 0, 0],
  );

  const line1Op = win(frame, 6, df * 0.52, 14);
  const line2Op = win(frame, df * 0.34, df, 14);

  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.52} />
      <FilmGrade grain={0} aberration={0.4} vignette={0.4} contrast={1.05} saturate={1.05}>
        <ConceptThreeCanvas fov={42}>
          <CameraRig position={position} lookAt={lookAt} />
          <LightRig />
          <Stars frame={frame} count={26} />
          <UnfinishedField frame={frame} reveal={interpolate(frame, [0, 24], [0, 1], CLAMP)} />
        </ConceptThreeCanvas>
      </FilmGrade>
      <GrainLayer opacity={0.05} />

      <AbsoluteFill style={{ opacity: line1Op }}>
        <CenterAt dy={-42 * s}>
          <SoftBlurIn
            text="You have finished the tutorials."
            fontSize={Math.round(64 * s)}
            color={TEXT_STRONG}
            fontWeight={600}
          />
        </CenterAt>
      </AbsoluteFill>
      <Sequence from={Math.round(df * 0.34)}>
        <AbsoluteFill style={{ opacity: line2Op }}>
          <CenterAt dy={62 * s}>
            <SoftBlurIn
              text="You still have not shipped the product."
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

/** A drifting lattice of half-built "cpu" glyphs — abandoned side projects. A
 *  deterministic minority glow emerald (the few that ever shipped). */
const UnfinishedField: React.FC<{ frame: number; reveal: number }> = ({ frame, reveal }) => {
  const nodes = useMemo(() => {
    const out: { pos: Vec3; scale: number; phase: number; shipped: boolean }[] = [];
    let i = 0;
    for (let x = -7; x <= 7; x += 2.4) {
      for (let y = -2.5; y <= 2.5; y += 2.4) {
        for (let z = -3; z <= 1; z += 2.4) {
          if (i % 3 !== 0) {
            i++;
            continue;
          }
          out.push({
            pos: [x, y, z],
            scale: 0.2 + ((i % 4) / 4) * 0.1,
            phase: i * 13,
            shipped: i % 11 === 0,
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
        const spin = frame * 0.007 + idx * 0.5;
        return (
          <group
            key={idx}
            position={[n.pos[0], n.pos[1] + bob, n.pos[2]]}
            scale={[n.scale * reveal, n.scale * reveal, n.scale * reveal]}
            rotation={[spin * 0.4, spin, spin * 0.3]}
          >
            <Icon3D
              glyph="cpu"
              color={n.shipped ? PALETTE.emerald : PALETTE.amberDeep}
              size={1}
              emissiveIntensity={n.shipped ? 0.7 : 0.28}
              metalness={0.5}
              roughness={0.34}
              opacity={Math.min(1, reveal * (n.shipped ? 0.85 : 0.45))}
            />
          </group>
        );
      })}
    </>
  );
};

// ── Beat 2 · The promise — Ptah Builders ─────────────────────────────────────
export const BuildersPromise: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const df = durationFrames;
  const reveal = interpolate(frame, [0, 30], [0, 1], CLAMP);
  const subOp = win(frame, df * 0.3, df, 14);

  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.54} />
      <GrainLayer opacity={0.05} />
      <FilmGrade grain={0} aberration={0} vignette={0.42} contrast={1.05} saturate={1.05}>
        <ConceptThreeCanvas fov={40}>
          <GlassHero frame={frame} duration={df} reveal={reveal} />
        </ConceptThreeCanvas>
      </FilmGrade>

      <CenterAt dy={-54 * s}>
        <TrackingIn
          text="Ptah Builders"
          fontSize={Math.round(112 * s)}
          color={AMBER}
          fontWeight={700}
        />
      </CenterAt>
      <Sequence from={Math.round(df * 0.28)}>
        <AbsoluteFill style={{ opacity: subOp }}>
          <CenterAt dy={82 * s}>
            <SoftBlurIn
              text="Six to eight weeks. One real SaaS. Shipped."
              fontSize={Math.round(42 * s)}
              color={TEXT_STRONG}
              fontWeight={500}
            />
          </CenterAt>
        </AbsoluteFill>
      </Sequence>

      <CaptionRail slide={slide} durationFrames={df} width={width} />
      <Vignette amount={0.44} />
    </AbsoluteFill>
  );
};

// ── Beat 3 · The cohort track ────────────────────────────────────────────────
const COHORT_WEEKS = [
  'Foundation',
  'Domain',
  'Auth',
  'Billing',
  'Agents',
  'Hardening',
  'Deploy',
  'Launch',
];

/** An 8-stop progress track, filled by frame — the cohort's week-by-week spine.
 *  Same grammar as story-scenes-v2's WizardSteps, widened for 8 stops. */
const WeekTrack: React.FC<{ frame: number; stepDur: number; s: number }> = ({
  frame,
  stepDur,
  s,
}) => {
  const n = COHORT_WEEKS.length;
  const W = 1600 * s;
  const R = 20 * s;
  const inner = W - 2 * R;
  const fillFrac = interpolate(frame, [0, (n - 1) * stepDur], [0, 1], CLAMP);
  return (
    <div style={{ position: 'relative', width: W, height: 108 * s }}>
      <div
        style={{
          position: 'absolute',
          top: R - 1.5 * s,
          left: R,
          width: inner,
          height: 3 * s,
          background: 'rgba(255,255,255,0.14)',
          borderRadius: 2,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: R - 1.5 * s,
          left: R,
          width: inner * fillFrac,
          height: 3 * s,
          background: AMBER,
          borderRadius: 2,
        }}
      />
      {COHORT_WEEKS.map((label, i) => {
        const x = R + inner * (i / (n - 1));
        const active = frame >= i * stepDur + 4;
        const pop = interpolate(frame, [i * stepDur, i * stepDur + 10], [0.7, 1], CLAMP);
        const isLast = i === n - 1;
        return (
          <div
            key={label}
            style={{
              position: 'absolute',
              left: x,
              top: 0,
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12 * s,
            }}
          >
            <div
              style={{
                width: R * 2,
                height: R * 2,
                borderRadius: 999,
                background: active ? (isLast ? EMERALD : AMBER) : 'rgba(255,255,255,0.06)',
                border: `2px solid ${
                  active ? (isLast ? EMERALD : AMBER) : 'rgba(255,255,255,0.18)'
                }`,
                transform: `scale(${pop})`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#08090c',
                fontSize: 18 * s,
                fontWeight: 700,
              }}
            >
              {active ? '✓' : ''}
            </div>
            <span
              style={{
                fontFamily: THEME.font,
                color: active ? TEXT_SOFT : TEXT_FAINT,
                fontSize: 19 * s,
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export const BuildersCohort: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const df = durationFrames;

  const { position, lookAt } = CinematicPushIn(
    frame,
    df,
    [0, 1.5, 9.8],
    [0, 1.2, 8.0],
    [0, 0.5, 0],
  );

  const trackOp = win(frame, 10, df * 0.62, 12);
  const shipOp = win(frame, df * 0.68, df, 12);
  const stepDur = Math.max(10, Math.round((df * 0.5) / COHORT_WEEKS.length));

  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.6} />
      <FilmGrade grain={0} aberration={0.4} vignette={0.42} contrast={1.05} saturate={1.05}>
        <ConceptThreeCanvas fov={40}>
          <StageEnvironment intensity={1.15} exposure={1.12} />
          <CameraRig position={position} lookAt={lookAt} />
          <Stars frame={frame} count={22} />
          <StudioFloor y={FLOOR_Y} size={22} opacity={interpolate(frame, [0, 24], [0, 1], CLAMP)} />
          <ContactShadow position={[0, SHADOW_Y, 0]} radius={1.4} opacity={0.6} />

          <group position={[0, FLOOR_Y + 0.55, 0]} scale={[1.5, 1.5, 1.5]}>
            <GltfModel
              src={COMPUTER}
              normalize
              rotation={[0, -0.4, 0]}
              brandify={{
                base: '#454b55',
                accent: PALETTE.amber,
                glowParts: ['screen', 'monitor', 'display'],
                emissive: PALETTE.amberLight,
                metalness: 0.5,
                roughness: 0.52,
              }}
              envMapIntensity={1.1}
            />
          </group>
          <Glow color={PALETTE.amber} scale={2.4} opacity={0.3} position={[0, FLOOR_Y + 0.8, 0]} />
        </ConceptThreeCanvas>
      </FilmGrade>

      <Kicker text="The cohort" s={s} opacity={trackOp} />

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: trackOp }}>
        <WeekTrack frame={frame} stepDur={stepDur} s={s} />
      </AbsoluteFill>

      <Sequence from={Math.round(df * 0.66)}>
        <AbsoluteFill
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            opacity: shipOp,
            flexDirection: 'column',
            gap: 18 * s,
          }}
        >
          <div
            style={{
              fontFamily: THEME.font,
              color: TEXT_STRONG,
              fontSize: 46 * s,
              fontWeight: 600,
            }}
          >
            Not a course project. A product in production.
          </div>
          <div style={{ display: 'flex', gap: 20 * s }}>
            <Chip label="Weekly live build" s={s} />
            <Chip label="Reviewed work" s={s} />
            <Chip label="Deployed at the end" s={s} accent />
          </div>
        </AbsoluteFill>
      </Sequence>

      <CaptionRail slide={slide} durationFrames={df} width={width} />
      <Vignette amount={0.42} />
    </AbsoluteFill>
  );
};

// ── Beat 4 · The foundational course ─────────────────────────────────────────
const BOUNDARY_CODE = `// libs/backend/platform-core — the port
export interface IWorkspaceProvider {
  getConfiguration<T>(key: string): T | undefined;
}

// adapters implement it; nothing else may reach across
depConstraints: [
  { sourceTag: 'scope:backend', onlyDependOnLibsWithTags: ['scope:backend', 'scope:shared'] },
]`;

export const BuildersCourse: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const df = durationFrames;
  const kickerOp = win(frame, 8, df * 0.5, 14);
  const chipsOp = win(frame, df * 0.56, df, 14);

  const { position, lookAt } = CinematicOrbit(frame, df, 0.7, 0.15, [0, 0, 0], 0.3, 0);

  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.6} />
      <FilmGrade grain={0} aberration={0.4} vignette={0.42} contrast={1.05} saturate={1.05}>
        <ConceptThreeCanvas fov={42}>
          <StageEnvironment intensity={0.85} exposure={1.05} />
          <CameraRig position={position} lookAt={lookAt} />
          <Stars frame={frame} count={20} />

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
            <mesh position={[0, 2.0, 0]}>
              <boxGeometry args={[6.2, 0.05, 0.25]} />
              <meshStandardMaterial
                color={PALETTE.amber}
                emissive={PALETTE.amber}
                emissiveIntensity={0.6}
                metalness={0.4}
                roughness={0.3}
              />
            </mesh>
          </group>
        </ConceptThreeCanvas>
      </FilmGrade>

      <Kicker text="Included · the foundation course" s={s} opacity={kickerOp} />

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ transform: `scale(${1.15 * s})`, transformOrigin: 'center' }}>
          <GlassCodeBlock
            code={BOUNDARY_CODE}
            title="the architecture you are taught to defend"
            glassColor="#0e1319"
            showTrafficLights
            aura={false}
            fontSize={20}
          />
        </div>
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingBottom: 150 * s,
          opacity: chipsOp,
        }}
      >
        <div style={{ display: 'flex', gap: 20 * s }}>
          <Chip label="Nx monorepo" s={s} />
          <Chip label="NestJS" s={s} />
          <Chip label="Angular" s={s} />
          <Chip label="Enforced boundaries" s={s} accent />
        </div>
      </AbsoluteFill>

      <CaptionRail slide={slide} durationFrames={df} width={width} />
      <Vignette amount={0.4} />
    </AbsoluteFill>
  );
};

// ── Beat 5 · The private source-code pack ────────────────────────────────────
const VAULT_LINES: TerminalLine[] = [
  { text: 'git clone git@github.com:ptah-builders/source-pack.git', type: 'command', delay: 0 },
  { text: 'members only — access granted with your membership', type: 'log', delay: 12 },
  { text: 'apps/api          NestJS + Prisma + Paddle', type: 'log', delay: 8 },
  { text: 'apps/web          Angular, signals, OnPush', type: 'log', delay: 6 },
  { text: 'libs/backend      ports and adapters, tagged', type: 'log', delay: 6 },
  { text: 'libs/shared       the one bridge between sides', type: 'log', delay: 6 },
  { text: 'infra/            docker, migrations, CI', type: 'log', delay: 6 },
  { text: 'ready — start from working code, not a blank folder', type: 'success', delay: 12 },
];

export const BuildersVault: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const df = durationFrames;
  const capOp = win(frame, df * 0.66, df, 16);

  const { position, lookAt } = CinematicOrbit(
    frame,
    df,
    0.9,
    0.2,
    [0, 0, 0],
    0.32,
    Math.PI * 0.25,
  );

  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.62} />
      <FilmGrade grain={0} aberration={0.5} vignette={0.42} contrast={1.06} saturate={1.05}>
        <ConceptThreeCanvas fov={42}>
          <StageEnvironment intensity={0.85} exposure={1.05} />
          <CameraRig position={position} lookAt={lookAt} />
          <Stars frame={frame} count={20} />

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
            <mesh position={[0, 1.6, 0]}>
              <boxGeometry args={[5.4, 0.04, 0.2]} />
              <meshStandardMaterial
                color={PALETTE.amber}
                emissive={PALETTE.amber}
                emissiveIntensity={0.6}
                metalness={0.4}
                roughness={0.3}
              />
            </mesh>
            <mesh position={[0, -1.6, 0]}>
              <boxGeometry args={[5.4, 0.04, 0.2]} />
              <meshStandardMaterial
                color={PALETTE.amber}
                emissive={PALETTE.amber}
                emissiveIntensity={0.6}
                metalness={0.4}
                roughness={0.3}
              />
            </mesh>
          </group>

          {/* A locked shield glyph orbiting the slab — "private repo". */}
          <group
            position={[3.5, 0.6 + breathAt(frame, 110) * 0.2 - 0.1, 0.8]}
            rotation={[0, frame * 0.01, 0]}
            scale={[0.7, 0.7, 0.7]}
          >
            <Icon3D
              glyph="shield"
              color={PALETTE.emerald}
              size={1}
              emissiveIntensity={0.8}
              metalness={0.4}
              roughness={0.3}
            />
          </group>
          <Glow color={PALETTE.emerald} scale={1.4} opacity={0.26} position={[3.5, 0.6, 0.8]} />
        </ConceptThreeCanvas>
      </FilmGrade>

      <AbsoluteFill style={{ transform: `scale(${1.3 * s})`, transformOrigin: 'center' }}>
        <TerminalSimulator
          lines={VAULT_LINES}
          prompt="$"
          title="ptah-builders/source-pack"
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
          style={{ fontFamily: THEME.font, color: TEXT_SOFT, fontSize: 30 * s, fontWeight: 500 }}
        >
          The source pack is yours for as long as you are a member
        </div>
      </AbsoluteFill>

      <CaptionRail slide={slide} durationFrames={df} width={width} />
      <Vignette amount={0.4} />
    </AbsoluteFill>
  );
};

// ── Beat 6 · The room — live sessions + private community, EN and AR ─────────
const MEMBER_SEATS = 10;

export const BuildersRoom: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const df = durationFrames;
  const headOp = win(frame, 10, df * 0.56, 14);
  const langOp = win(frame, df * 0.6, df, 14);

  const { position, lookAt } = CinematicOrbit(frame, df, 6.4, 1.6, [0, 0, 0], 0.28, Math.PI * 0.15);

  // Members joining the ring, one every few frames — deterministic.
  const joinSpan = df * 0.5;
  const coreEdges = useMemo(
    () => new THREE.EdgesGeometry(new THREE.CylinderGeometry(1.0, 1.0, 0.4, 6)),
    [],
  );

  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.58} />
      <GrainLayer opacity={0.05} />
      <FilmGrade grain={0} aberration={0.4} vignette={0.42} contrast={1.05} saturate={1.05}>
        <ConceptThreeCanvas fov={42}>
          <StageEnvironment intensity={0.9} exposure={1.05} />
          <CameraRig position={position} lookAt={lookAt} />
          <Stars frame={frame} count={24} />

          {/* The session core — a hexagonal amber ring, the live room. */}
          <group rotation={[Math.PI / 2, 0, frame * 0.004]}>
            <lineSegments geometry={coreEdges}>
              <lineBasicMaterial color={PALETTE.amber} transparent opacity={0.6} />
            </lineSegments>
          </group>
          <Glow color={PALETTE.amber} scale={2.6} opacity={0.2} />

          {/* Members arriving into the ring. */}
          {Array.from({ length: MEMBER_SEATS }, (_, i) => {
            const arrive = interpolate(
              frame,
              [(i / MEMBER_SEATS) * joinSpan, (i / MEMBER_SEATS) * joinSpan + 18],
              [0, 1],
              { ...CLAMP, easing: EASE },
            );
            if (arrive <= 0.001) return null;
            const angle = (i / MEMBER_SEATS) * Math.PI * 2 + frame * 0.005;
            const r = 2.9 + breathAt(frame, 95, i * 24) * 0.14;
            const pos: Vec3 = [
              Math.cos(angle) * r,
              Math.sin(angle * 2 + i) * 0.22,
              Math.sin(angle) * r,
            ];
            const accent = i % 3 === 0;
            return (
              <group key={i} position={pos} scale={[arrive, arrive, arrive]}>
                <mesh>
                  <icosahedronGeometry args={[0.2, 1]} />
                  <meshStandardMaterial
                    color={accent ? PALETTE.emerald : PALETTE.amberLight}
                    emissive={accent ? PALETTE.emerald : PALETTE.amberLight}
                    emissiveIntensity={0.6}
                    metalness={0.3}
                    roughness={0.3}
                  />
                </mesh>
                <Glow
                  color={accent ? PALETTE.emerald : PALETTE.amberLight}
                  scale={0.9}
                  opacity={arrive * 0.4}
                />
              </group>
            );
          })}

          <Label text="LIVE" position={[0, 1.35, 0]} height={0.26} color={THEME.textSoft} opacity={0.8} />
        </ConceptThreeCanvas>
      </FilmGrade>

      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'flex-start',
          paddingTop: 140 * s,
          opacity: headOp,
          flexDirection: 'column',
          gap: 16 * s,
        }}
      >
        <div
          style={{ fontFamily: THEME.font, color: TEXT_STRONG, fontSize: 48 * s, fontWeight: 600 }}
        >
          Weekly live sessions. A private room.
        </div>
        <div
          style={{ fontFamily: THEME.font, color: TEXT_FAINT, fontSize: 28 * s, fontWeight: 500 }}
        >
          You are never the only person debugging this at midnight.
        </div>
      </AbsoluteFill>

      <Sequence from={Math.round(df * 0.58)}>
        <AbsoluteFill
          style={{
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingBottom: 150 * s,
            opacity: langOp,
            flexDirection: 'column',
            gap: 16 * s,
          }}
        >
          <div style={{ display: 'flex', gap: 22 * s }}>
            <Chip label="English cohort" s={s} accent />
            <Chip label="Arabic cohort" s={s} accent />
          </div>
          <div
            style={{ fontFamily: THEME.font, color: TEXT_SOFT, fontSize: 26 * s, fontWeight: 500 }}
          >
            Running side by side
          </div>
        </AbsoluteFill>
      </Sequence>

      <CaptionRail slide={slide} durationFrames={df} width={width} />
      <Vignette amount={0.42} />
    </AbsoluteFill>
  );
};

// ── Beat 7 · Proof — Ptah itself is the reference build ──────────────────────
export const BuildersProof: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const df = durationFrames;
  const rowOp = win(frame, df * 0.36, df, 14);

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

          <ContactShadow position={[-3.8, SHADOW_Y, -0.3]} radius={1.0} opacity={rocketIn * 0.65} />
          {rocketIn > 0.001 ? (
            <group
              position={[-3.8, FLOOR_Y + 1.1, -0.3]}
              scale={[2.0 * rocketIn, 2.0 * rocketIn, 2.0 * rocketIn]}
            >
              <GltfModel
                src={ROCKET}
                normalize
                rotation={[0, 0.5, 0]}
                brandify={{
                  base: PALETTE.amberDeep,
                  accent: PALETTE.emerald,
                  glowParts: ['window', 'thruster', 'flame'],
                  emissive: PALETTE.amberLight,
                }}
                envMapIntensity={1.3}
              />
            </group>
          ) : null}
          <Glow
            color={PALETTE.amber}
            scale={1.8}
            opacity={rocketIn * 0.28}
            position={[-3.8, FLOOR_Y + 0.9, -0.3]}
          />

          <ContactShadow
            position={[0, SHADOW_Y, 0.6]}
            radius={1.3}
            opacity={robotIn * 0.7}
            scale={[1, 0.85]}
          />
          {robotIn > 0.001 ? (
            <group
              position={[0, FLOOR_Y + breathAt(frame, 150) * 0.1, 0.6]}
              scale={[2.4 * robotIn, 2.4 * robotIn, 2.4 * robotIn]}
            >
              <GltfModel
                src={ROBOT}
                normalize
                position={[0, 0.5, 0]}
                rotation={[0, 0.2, 0]}
                brandify={{
                  base: PALETTE.amber,
                  accent: PALETTE.amberLight,
                  glowParts: ['head_4'],
                  emissive: PALETTE.emeraldLight,
                  emissiveIntensity: 0.75,
                }}
                envMapIntensity={1.2}
              />
            </group>
          ) : null}
          <Glow color={PALETTE.amber} scale={1.7} opacity={robotIn * 0.1} position={[0, 0.1, -0.1]} />

          <group position={[3.4, FLOOR_Y + 0.6, 0.2]} rotation={[0, -0.35, 0]}>
            <mesh>
              <boxGeometry args={[0.9, 1.3, 0.65]} />
              <meshStandardMaterial
                color="#3c424c"
                metalness={0.7}
                roughness={0.42}
                envMapIntensity={1.2}
              />
            </mesh>
            {[0.45, 0.2, -0.05, -0.3, -0.52].map((sy) => (
              <mesh key={sy} position={[0, sy, 0.33]}>
                <boxGeometry args={[0.66, 0.07, 0.03]} />
                <meshStandardMaterial
                  color={PALETTE.emerald}
                  emissive={PALETTE.emerald}
                  emissiveIntensity={1.4}
                  toneMapped={false}
                />
              </mesh>
            ))}
          </group>
          <ContactShadow position={[3.4, SHADOW_Y, 0.2]} radius={0.85} opacity={0.55} scale={[1.2, 1]} />
          <Glow color={PALETTE.emerald} scale={1.4} opacity={0.25} position={[3.4, FLOOR_Y + 0.6, 0.2]} />
        </ConceptThreeCanvas>
      </FilmGrade>

      <CenterAt dy={-60 * s}>
        <SoftBlurIn
          text="I am not teaching theory."
          fontSize={Math.round(68 * s)}
          color={TEXT_STRONG}
          fontWeight={600}
        />
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
          Ptah ships on the exact stack you will build on
        </div>
      </AbsoluteFill>

      <CaptionRail slide={slide} durationFrames={df} width={width} />
      <Vignette amount={0.42} />
    </AbsoluteFill>
  );
};

// ── Beat 8 · The offer + CTA ─────────────────────────────────────────────────
/**
 * A price card. The number is rendered STATICALLY on purpose — a digit wheel on
 * a price reads as an unsettled value and, at this type size, its per-column
 * absolute layout drifts out of baseline alignment. Count-ups belong on stats,
 * not on what the viewer is being asked to pay.
 */
const PriceCard: React.FC<{
  amount: number;
  unit: string;
  note: string;
  s: number;
  accent?: boolean;
}> = ({ amount, unit, note, s, accent = false }) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 10 * s,
      padding: `${28 * s}px ${44 * s}px`,
      borderRadius: 24 * s,
      border: `1px solid ${accent ? AMBER : 'rgba(255,255,255,0.16)'}`,
      // Opaque enough to stay legible over the GlassHero crystal behind it.
      background: accent ? 'rgba(38,26,6,0.82)' : 'rgba(10,13,16,0.78)',
      minWidth: 320 * s,
    }}
  >
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 * s }}>
      <span
        style={{
          fontFamily: THEME.font,
          color: accent ? AMBER : TEXT_STRONG,
          fontSize: 44 * s,
          fontWeight: 700,
        }}
      >
        $
      </span>
      <span
        style={{
          fontFamily: THEME.font,
          color: accent ? AMBER : TEXT_STRONG,
          fontSize: 92 * s,
          fontWeight: 700,
          lineHeight: 1,
          letterSpacing: '-0.02em',
        }}
      >
        {amount}
      </span>
      <span
        style={{ fontFamily: THEME.font, color: TEXT_SOFT, fontSize: 28 * s, fontWeight: 500 }}
      >
        {unit}
      </span>
    </div>
    <div style={{ fontFamily: THEME.font, color: TEXT_FAINT, fontSize: 23 * s, fontWeight: 500 }}>
      {note}
    </div>
  </div>
);

export const BuildersOffer: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const df = durationFrames;
  const reveal = interpolate(frame, [0, 40], [0, 1], CLAMP);
  // Price block and CTA block are MUTUALLY EXCLUSIVE windows — the vertical
  // budget above the caption rail only fits one of them at a time.
  const priceOp = win(frame, 18, df * 0.56, 14);
  const ctaOp = win(frame, df * 0.64, df, 14);

  const { position, lookAt } = CinematicPushIn(
    frame,
    df,
    [0, 0.2, 7.2],
    [0, 0.2, 8.6],
    [0, 0, 0],
  );

  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.68} />
      <GrainLayer opacity={0.05} />
      <FilmGrade grain={0} aberration={0} vignette={0.44} contrast={1.05} saturate={1.05}>
        <ConceptThreeCanvas fov={40}>
          <GlassHero frame={frame} duration={df} reveal={reveal} floor={false} />
          <CameraRig position={position} lookAt={lookAt} />
        </ConceptThreeCanvas>
      </FilmGrade>

      {/* Phase A — the offer. TrackingIn positions itself absolute/inset:0, so
          it must be offset with CenterAt (a transform), never with padding. */}
      <AbsoluteFill style={{ opacity: priceOp }}>
        <CenterAt dy={-250 * s}>
          <TrackingIn
            text="Ptah Builders"
            fontSize={Math.round(74 * s)}
            color={AMBER}
            fontWeight={700}
          />
        </CenterAt>
        <AbsoluteFill
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            transform: `translateY(${40 * s}px)`,
            flexDirection: 'column',
            gap: 24 * s,
          }}
        >
          <div style={{ display: 'flex', gap: 28 * s, alignItems: 'stretch' }}>
            <PriceCard amount={PRICE_MONTHLY} unit="/ month" note="cancel any time" s={s} />
            <PriceCard amount={PRICE_YEARLY} unit="/ year" note="two months free" s={s} accent />
          </div>
          <Chip label={EARLY_ADOPTER_LABEL} s={s} accent />
        </AbsoluteFill>
      </AbsoluteFill>

      {/* Phase B — the CTA, centered in the now-empty frame. */}
      <Sequence from={Math.round(df * 0.6)}>
        <AbsoluteFill
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            // Lifted clear of the crystal's central emissive hotspot, which
            // otherwise washes out the domain line sitting on top of it.
            transform: `translateY(${-180 * s}px)`,
            opacity: ctaOp,
            gap: 22 * s,
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: `${16 * s}px ${40 * s}px`,
              borderRadius: 999,
              background: AMBER,
              color: '#08090c',
              fontFamily: THEME.font,
              fontSize: 34 * s,
              fontWeight: 700,
            }}
          >
            Join the next cohort
          </div>
          <div
            style={{
              fontFamily: THEME.font,
              color: TEXT_SOFT,
              fontSize: 28 * s,
              fontWeight: 500,
              padding: `${6 * s}px ${18 * s}px`,
              borderRadius: 999,
              background: 'rgba(8,10,13,0.55)',
            }}
          >
            ptah.live
          </div>
        </AbsoluteFill>
      </Sequence>

      <CaptionRail slide={slide} durationFrames={df} width={width} />
      <Vignette amount={0.5} />
    </AbsoluteFill>
  );
};
