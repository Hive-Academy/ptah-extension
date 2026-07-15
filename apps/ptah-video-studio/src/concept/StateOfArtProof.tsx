/**
 * StateOfArtProof — a look-validation proof for the new state-of-the-art
 * developer-tool aesthetic: remocn motion-design components + high-fidelity
 * abstract 3D, restrained and premium (one accent = amber, emerald only for
 * active/success). NOT the full video — it demonstrates the language by
 * combining, in a short TransitionSeries:
 *
 *   (a) a muted shader backdrop (shader-neuro-noise, low speed → "intelligence")
 *   (b) kinetic type hook (soft-blur-in + tracking-in, sentence case, one accent)
 *   (c) a REAL product surface (terminal-simulator — a believable Ptah
 *       orchestration moment: conductor delegating to specialists + CLI agents)
 *   (d) a high-fidelity abstract 3D hero (GlassHero — glass Ptah hexagon core +
 *       refractive orbiting nodes, drei MeshTransmissionMaterial + procedural
 *       PMREM Environment, additive bloom — no game props, no postprocessing)
 *   (e) a number payoff (number-wheel → "15 specialist agents", amber)
 *
 * Beats are stitched with push-through transitions. Everything is a pure
 * function of the frame (determinism holds — shaders frozen via speed + frame,
 * 3D poses frame-derived, seeded randomness only).
 */
import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import type { ConceptSceneProps } from '../PromoReel';
import { THEME } from '../theme';
import { ConceptThreeCanvas } from '../concept3d/three-kit';
import { FilmGrade } from '../concept3d/three-assets';
import { GlassHero } from '../concept3d/GlassHero';
import { ShaderNeuroNoise } from '../remocn/components/remocn/shader-neuro-noise';
import { SoftBlurIn } from '../remocn/components/remocn/soft-blur-in';
import { TrackingIn } from '../remocn/components/remocn/tracking-in';
import {
  TerminalSimulator,
  type TerminalLine,
} from '../remocn/components/remocn/terminal-simulator';
import { NumberWheel } from '../remocn/components/remocn/number-wheel';
import { pushThrough } from '../remocn/components/remocn/push-through';

// remocn's text/terminal components resolve their font from the CSS custom
// properties --font-geist-sans / --font-geist-mono (a shadcn/Next convention).
// Those are undefined here, which makes the whole font-family declaration
// invalid → the browser default (serif) leaks in. Load real fonts and bind the
// vars on the scene root so the type reads as the intended Inter / mono.
const { fontFamily: INTER_FAMILY } = loadInter();
const { fontFamily: MONO_FAMILY } = loadMono();

// ── Beat (a) backdrop ────────────────────────────────────────────────────────
// Muted neural-web texture that reads as "intelligence" without a glow wash.
// Frozen deterministically (the component drives paper's `frame` off
// useCurrentFrame at speed=0). A dark ink overlay keeps foreground legible.
const Backdrop: React.FC = () => (
  <AbsoluteFill>
    <ShaderNeuroNoise
      speed={0.18}
      colorBack={THEME.bg}
      colorMid={'#0f1a16'}
      colorFront={'#243043'}
      brightness={0.03}
      contrast={0.32}
    />
    <AbsoluteFill style={{ backgroundColor: 'rgba(6,8,10,0.52)' }} />
    {/* Soft top-to-bottom sink so type sits on calm ink, not on live texture. */}
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(120% 120% at 50% 42%, rgba(0,0,0,0) 44%, rgba(4,5,7,0.72) 100%)',
      }}
    />
  </AbsoluteFill>
);

// ── Beat (b) kinetic type hook ───────────────────────────────────────────────
const HookBeat: React.FC<{ width: number }> = ({ width }) => {
  const s = width / 1920; // scale remocn's 720p-tuned type up to 1080p
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: 'translateY(-52px)' }}>
        <SoftBlurIn
          text="Most AI coding tools start cold."
          fontSize={Math.round(66 * s)}
          color={THEME.textStrong}
          fontWeight={600}
        />
      </AbsoluteFill>
      <Sequence from={30}>
        <AbsoluteFill style={{ transform: 'translateY(64px)' }}>
          <TrackingIn
            text="Ptah boots a project-aware orchestra."
            fontSize={Math.round(40 * s)}
            color={THEME.amber}
          />
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};

// ── Beat (c) real product surface ────────────────────────────────────────────
const PTAH_TERMINAL: TerminalLine[] = [
  { text: 'ptah orchestrate "add billing webhooks"', type: 'command', delay: 0 },
  { text: 'classified: FEATURE · depth: full', type: 'log', delay: 10 },
  { text: 'conductor delegating to specialists...', type: 'log', delay: 8 },
  { text: 'backend-developer    building webhook handler', type: 'log', delay: 6 },
  { text: 'code-logic-reviewer  gating the commit', type: 'log', delay: 6 },
  { text: 'CLI agents (max 3): ptah-cli · codex · copilot', type: 'log', delay: 6 },
  { text: '3 agents running in parallel...', type: 'log', delay: 6 },
  { text: 'review passed — commit gated', type: 'success', delay: 10 },
];

const ProductBeat: React.FC<{ width: number }> = ({ width }) => {
  const s = (width / 1920) * 1.5; // upscale the 900px terminal for 1080p
  // The scaled layer must be a positioned full-fill box: the TerminalSimulator
  // roots at position:absolute/inset:0 and a `transform` here establishes the
  // containing block it fills, so the scale actually applies to the window.
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${s})`, transformOrigin: 'center' }}>
        <TerminalSimulator
          lines={PTAH_TERMINAL}
          prompt="$"
          title="~/apps/ptah-license-server"
          background="#0b0d11"
          chromeColor="#14171d"
          fontSize={17}
          charsPerFrame={2.4}
          chunkSize={3}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Beat (d) 3D glass hero ───────────────────────────────────────────────────
const HeroBeat: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  // Reveal in over the first ~24 frames of the beat.
  const reveal = Math.max(0, Math.min(1, frame / 24));
  return (
    <AbsoluteFill>
      <FilmGrade aberration={0.5} grain={0.045} vignette={0.5}>
        <ConceptThreeCanvas fov={40}>
          <GlassHero frame={frame} duration={duration} reveal={reveal} />
        </ConceptThreeCanvas>
      </FilmGrade>
    </AbsoluteFill>
  );
};

// ── Beat (e) number payoff ───────────────────────────────────────────────────
const NumberBeat: React.FC<{ width: number }> = ({ width }) => {
  const s = width / 1920;
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <AbsoluteFill style={{ transform: 'translateY(-42px)' }}>
        <NumberWheel from={0} to={15} fontSize={Math.round(150 * s)} color={THEME.amber} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          transform: 'translateY(112px)',
          color: THEME.textStrong,
          fontFamily: THEME.font,
          fontSize: Math.round(34 * s),
          fontWeight: 500,
          letterSpacing: '-0.01em',
        }}
      >
        specialist agents, generated for your stack
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Push-through between beats — "going deeper" hierarchy descent, restrained. */
const TRANS = 20;
const transition = () =>
  ({
    presentation: pushThrough({ zoom: 1.7, blur: 8 }),
    timing: linearTiming({ durationInFrames: TRANS }),
  } as const);

export const StateOfArtProof: React.FC<ConceptSceneProps> = ({ durationFrames }) => {
  const { width } = useVideoConfig();

  // Fill the slide's whole duration exactly. TransitionSeries total =
  // sum(sequence durations) - sum(transition overlaps), so add the overlaps
  // back into the sequence budget.
  const nTrans = 3;
  const total = durationFrames + TRANS * nTrans;
  const w = [0.24, 0.33, 0.25, 0.18];
  const segs = w.map((x) => Math.round(total * x));
  segs[segs.length - 1] = total - segs.slice(0, -1).reduce((a, b) => a + b, 0);
  const [hook, product, hero, number] = segs;

  const rootStyle = {
    backgroundColor: THEME.bg,
    ['--font-geist-sans']: INTER_FAMILY,
    ['--font-geist-mono']: MONO_FAMILY,
  } as React.CSSProperties;

  return (
    <AbsoluteFill style={rootStyle}>
      <Backdrop />
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={hook}>
          <HookBeat width={width} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition {...transition()} />
        <TransitionSeries.Sequence durationInFrames={product}>
          <ProductBeat width={width} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition {...transition()} />
        <TransitionSeries.Sequence durationInFrames={hero}>
          <HeroBeat duration={hero} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition {...transition()} />
        <TransitionSeries.Sequence durationInFrames={number}>
          <NumberBeat width={width} />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
