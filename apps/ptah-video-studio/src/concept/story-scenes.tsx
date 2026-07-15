/**
 * story-scenes — the 8 beats of "From Cold Clone to Scalable SaaS"
 * (promos/ptah-saas-story.json). Each beat is a ConceptScene paced to fill its
 * Kokoro VO clip (durationFrames). Language: remocn kinetic type + real product
 * surfaces + the elevated glass crystal hero. Discipline: ONE accent = amber;
 * emerald only for active/success; sentence case; real facts from the knowledge
 * base; restrained motion; no glow-blob washes; a founder narrative thread.
 */
import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { ConceptSceneProps } from '../PromoReel';
import { THEME } from '../theme';
import { ConceptThreeCanvas } from '../concept3d/three-kit';
import { FilmGrade } from '../concept3d/three-assets';
import { GlassHero } from '../concept3d/GlassHero';
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
  CenterAt,
} from './story-kit';
import { SoftBlurIn } from '../remocn/components/remocn/soft-blur-in';
import { TrackingIn } from '../remocn/components/remocn/tracking-in';
import { NumberWheel } from '../remocn/components/remocn/number-wheel';
import { GlassCodeBlock } from '../remocn/components/remocn/glass-code-block';
import {
  TerminalSimulator,
  type TerminalLine,
} from '../remocn/components/remocn/terminal-simulator';

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** Phase window opacity — fades a sub-element in at `a` and out at `b` (frames). */
function win(frame: number, a: number, b: number, fade = 14): number {
  return interpolate(frame, [a - fade, a, b, b + fade], [0, 1, 1, 0], CLAMP);
}

// A small labelled chip (CLI mirrors, tech stack). Restrained 1px elevation.
const Chip: React.FC<{ label: string; accent?: boolean; s: number }> = ({
  label,
  accent = false,
  s,
}) => (
  <div
    style={{
      padding: `${10 * s}px ${20 * s}px`,
      borderRadius: 999,
      border: `1px solid ${accent ? AMBER : 'rgba(255,255,255,0.14)'}`,
      background: 'rgba(255,255,255,0.03)',
      color: accent ? AMBER : TEXT_SOFT,
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

// Small caption kicker at the top of a beat.
const Kicker: React.FC<{ text: string; s: number; opacity?: number }> = ({
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
        color: TEXT_FAINT,
        fontSize: 24 * s,
        fontWeight: 600,
        letterSpacing: '0.02em',
      }}
    >
      {text}
    </div>
  </AbsoluteFill>
);

// ── Beat 1 · Hook ────────────────────────────────────────────────────────────
export const StoryHook: React.FC<ConceptSceneProps> = ({ durationFrames }) => {
  const { width } = useVideoConfig();
  const s = width / 1920;
  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.5} />
      <CenterAt dy={-40 * s}>
        <SoftBlurIn
          text="Most AI coding tools start cold."
          fontSize={Math.round(66 * s)}
          color={TEXT_STRONG}
          fontWeight={600}
        />
      </CenterAt>
      <Sequence from={Math.round(durationFrames * 0.32)}>
        <CenterAt dy={64 * s}>
          <SoftBlurIn
            text="They forget. They autocomplete."
            fontSize={Math.round(36 * s)}
            color={TEXT_FAINT}
            fontWeight={500}
          />
        </CenterAt>
      </Sequence>
      <Vignette amount={0.4} />
    </AbsoluteFill>
  );
};

// ── Beat 2 · Positioning ─────────────────────────────────────────────────────
export const StoryPositioning: React.FC<ConceptSceneProps> = ({ durationFrames }) => {
  const { width } = useVideoConfig();
  const s = width / 1920;
  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.52} />
      <CenterAt dy={-46 * s}>
        <TrackingIn text="Ptah" fontSize={Math.round(150 * s)} color={AMBER} fontWeight={700} />
      </CenterAt>
      <Sequence from={Math.round(durationFrames * 0.28)}>
        <CenterAt dy={92 * s}>
          <SoftBlurIn
            text="boots a project-aware orchestra."
            fontSize={Math.round(44 * s)}
            color={TEXT_STRONG}
            fontWeight={500}
          />
        </CenterAt>
      </Sequence>
      <Vignette amount={0.42} />
    </AbsoluteFill>
  );
};

// ── Beat 3 · Setup Wizard ────────────────────────────────────────────────────
const WIZARD_STEPS = ['Welcome', 'Scan', 'Analysis', 'Selection', 'Enhance', 'Generation', 'Completion'];

/** Reliable horizontal step rail (the remocn progress-steps horizontal layout
 *  collapses under a scaled container). Nodes activate left→right; the amber
 *  fill line tracks the last active node. Pure fn of `frame`. */
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

export const StoryWizard: React.FC<ConceptSceneProps> = ({ durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const df = durationFrames;

  // Mutually-exclusive phases (small gaps, tight fades) so payoffs never stack.
  const stepsOp = win(frame, 10, df * 0.42, 12);
  const numOp = win(frame, df * 0.48, df * 0.68, 12);
  const chipsOp = win(frame, df * 0.74, df, 12);
  const chipPeel = interpolate(frame, [df * 0.82, df * 0.98], [0, 1], CLAMP);
  const stepDur = Math.max(10, Math.round((df * 0.36) / WIZARD_STEPS.length));

  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.56} />
      <Kicker text="Setup wizard" s={s} opacity={stepsOp} />

      {/* Phase A — the 7 steps running. */}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: stepsOp }}>
        <WizardSteps frame={frame} stepDur={stepDur} s={s} />
      </AbsoluteFill>

      {/* Phase B — 15 specialist agents payoff. */}
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

export const StoryOrchestration: React.FC<ConceptSceneProps> = ({ durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const capOp = win(frame, durationFrames * 0.62, durationFrames, 16);
  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.58} />
      <AbsoluteFill style={{ transform: `scale(${1.5 * s})`, transformOrigin: 'center' }}>
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
      <Vignette amount={0.4} />
    </AbsoluteFill>
  );
};

// ── Beat 5 · Nx / hexagonal foundation ───────────────────────────────────────
export const StoryFoundation: React.FC<ConceptSceneProps> = ({ durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const df = durationFrames;
  const reveal = interpolate(frame, [0, 30], [0, 1], CLAMP);
  const numOp = win(frame, df * 0.5, df * 0.86);
  const capA = win(frame, 16, df * 0.5, 16);
  const capB = win(frame, df * 0.82, df, 14);

  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.6} />
      <GrainLayer opacity={0.05} />
      <FilmGrade grain={0} aberration={0} vignette={0.42} contrast={1.05} saturate={1.05}>
        <ConceptThreeCanvas fov={40}>
          <GlassHero frame={frame} duration={df} reveal={reveal} />
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
      <Vignette amount={0.4} />
    </AbsoluteFill>
  );
};

// Small inline number-wheel wrapper (fixed count window) for the "16" payoff.
const NumberWheelInline: React.FC<{ to: number; s: number }> = ({ to, s }) => (
  <div style={{ position: 'relative', width: to >= 10 ? 130 * s : 80 * s, height: 90 * s }}>
    <NumberWheel from={0} to={to} fontSize={Math.round(84 * s)} color={AMBER} />
  </div>
);

// ── Beat 6 · SaaS lifecycle ──────────────────────────────────────────────────
const WEBHOOK_CODE = `@Post('paddle')
@HttpCode(200)
async handle(@Req() req: RawBodyRequest<Request>) {
  this.verify(req);              // signature + idempotency
  await this.subscriptions.apply(req.body);
  return { received: true };
}`;

export const StoryLifecycle: React.FC<ConceptSceneProps> = ({ durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const df = durationFrames;
  const tickOp = win(frame, df * 0.55, df, 14);
  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.58} />
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
      <Vignette amount={0.42} />
    </AbsoluteFill>
  );
};

// ── Beat 7 · Proof ───────────────────────────────────────────────────────────
export const StoryProof: React.FC<ConceptSceneProps> = ({ durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const df = durationFrames;
  const rowOp = win(frame, df * 0.34, df, 14);
  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.54} />
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
      <Vignette amount={0.42} />
    </AbsoluteFill>
  );
};

// ── Beat 8 · CTA ─────────────────────────────────────────────────────────────
export const StoryCta: React.FC<ConceptSceneProps> = ({ durationFrames }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const s = width / 1920;
  const df = durationFrames;
  const lineOp = win(frame, 24, df, 16);
  const ctaOp = win(frame, df * 0.4, df, 14);
  return (
    <AbsoluteFill style={storyRootStyle()}>
      <ShaderBackdrop veil={0.66} />
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
      <Vignette amount={0.5} />
    </AbsoluteFill>
  );
};
