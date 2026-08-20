/**
 * DecisionTree — the verdict scene: a flowchart that chooses by primary goal.
 *
 * A root question drops in and two connectors draw downward; a LEFT branch
 * ("MVP Speed → Dyad", amber) and a RIGHT branch ("Enterprise Scale → Ptah",
 * indigo) fill in with staggered bullets; a closing two-line tagline lands.
 * Four phases, one per caption. The connectors keep a continuous data-flow
 * shimmer and the nodes breath-glow so the tree never freezes across its hold.
 *
 * Fully frame-driven / deterministic: connector reveals use SVG stroke-dashoffset
 * on a normalized pathLength — no Math.random, no timers, no CSS animation.
 */
import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from 'remotion';
import { THEME } from '../theme';
import type { ConceptSceneProps } from '../PromoReel';
import { CaptionRail, usePhases, useBreath } from './scene-kit';
import { BorderBeam, ShimmerSweep } from '../components/effects';

// Light-to-core indigo beam — root/scale accent (amber stays on the MVP branch).
const BEAM_FROM = '#8ea2ff';

const CLAMP ={ extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const saw = (frame: number, period: number, offset = 0): number =>
  (((frame + offset) % period) + period) % period / period;
const breathAt = (frame: number, period: number, phase = 0): number =>
  (Math.sin(((frame + phase) / period) * Math.PI * 2) + 1) / 2;

type Branch = { kicker: string; title: string; accent: string; bullets: string[] };

const LEFT: Branch = {
  kicker: 'MVP SPEED',
  title: 'Dyad',
  accent: THEME.amber,
  bullets: ['Solo founders / non-technical', 'Zero boilerplate', 'Live URL in days'],
};
const RIGHT: Branch = {
  kicker: 'ENTERPRISE SCALE',
  title: 'Ptah',
  accent: THEME.indigo,
  bullets: ['Custom backend logic', 'Strict security', 'Long-term maintainability'],
};

// A branch card: accent header, title, and bullets that stagger in then hold.
const BranchNode: React.FC<{
  branch: Branch;
  S: number;
  pf: number;
  enterFrame: number;
  bulletStart: number;
  width: number;
}> = ({ branch, S, pf, enterFrame, bulletStart, width }) => {
  const frame = useCurrentFrame();
  // The branch card is a STABLE frame: it settles in fast (~10 frames, opacity +
  // a tiny lift) and then holds put. Its CONTENT — kicker, title, bullets —
  // staggers in inside the steady frame, so the tree populates without the whole
  // card sliding or scaling.
  const cardIn = interpolate(frame, [enterFrame, enterFrame + 10], [0, 1], CLAMP);
  const kickerIn = interpolate(frame, [enterFrame + 4, enterFrame + 15], [0, 1], CLAMP);
  const titleIn = interpolate(frame, [enterFrame + 9, enterFrame + 22], [0, 1], CLAMP);
  const glow = breathAt(frame, 80);

  return (
    <div
      style={{
        width,
        opacity: cardIn,
        transform: `translateX(-50%) translateY(${interpolate(cardIn, [0, 1], [S * 0.012, 0])}px)`,
        background: 'rgba(255,255,255,0.045)',
        border: `1px solid ${branch.accent}55`,
        borderRadius: S * 0.03,
        boxShadow: `0 40px 120px rgba(0,0,0,0.55), 0 0 ${S * 0.02 * glow * cardIn}px ${branch.accent}55`,
        padding: S * 0.032,
        overflow: 'hidden',
      }}
    >
      {/* Accent top bar. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: S * 0.006,
          background: `linear-gradient(90deg, ${branch.accent}, ${branch.accent}55)`,
        }}
      />
      <div
        style={{
          fontSize: S * 0.02,
          fontWeight: 700,
          letterSpacing: 1,
          color: branch.accent,
          opacity: kickerIn,
          transform: `translateX(${interpolate(kickerIn, [0, 1], [-S * 0.012, 0])}px)`,
        }}
      >
        {branch.kicker}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: S * 0.012,
          marginTop: S * 0.004,
          opacity: titleIn,
          transform: `translateY(${interpolate(titleIn, [0, 1], [S * 0.01, 0])}px)`,
        }}
      >
        <span style={{ fontSize: S * 0.026, fontWeight: 700, color: THEME.textFaint }}>→</span>
        <span style={{ fontSize: S * 0.05, fontWeight: 800, color: THEME.textStrong }}>{branch.title}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: S * 0.014, marginTop: S * 0.022 }}>
        {branch.bullets.map((b, i) => {
          const bs = bulletStart + i * pf * 0.14;
          const bp = interpolate(frame, [bs, bs + pf * 0.28], [0, 1], CLAMP);
          const dot = breathAt(frame, 46, i * 18);
          return (
            <div
              key={b}
              style={{
                opacity: bp,
                transform: `translateX(${interpolate(bp, [0, 1], [-S * 0.02, 0])}px)`,
                display: 'flex',
                alignItems: 'center',
                gap: S * 0.014,
              }}
            >
              <div
                style={{
                  width: S * 0.014,
                  height: S * 0.014,
                  flexShrink: 0,
                  borderRadius: '50%',
                  background: branch.accent,
                  boxShadow: `0 0 ${S * 0.01 * dot}px ${branch.accent}`,
                }}
              />
              <span style={{ fontSize: S * 0.024, fontWeight: 700, color: THEME.textSoft }}>{b}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const DecisionTree: React.FC<ConceptSceneProps> = ({ slide, durationFrames, locale }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const S = Math.min(width, height);
  const portrait = height > width;
  const W = Math.min(width * 0.9, S * 1.15);

  const { phaseFrames: pf } = usePhases(durationFrames, 4);
  // The tree is a STABLE stage — no drift on the container. The root node and the
  // two branch cards are steady frames; only their content and the connectors
  // between them animate. The root settles in fast, then holds rock-steady.
  const rootIn = interpolate(frame, [0, 10], [0, 1], CLAMP);
  const rootGlow = useBreath(70);
  const caret = useBreath(20) > 0.5;

  // Layout coordinates (deterministic, per format).
  const rootW = portrait ? W * 0.78 : W * 0.46;
  const branchW = portrait ? W * 0.7 : W * 0.4;
  const rootBottomY = portrait ? S * 0.15 : S * 0.13;

  const leftCx = portrait ? W / 2 : W * 0.26;
  const rightCx = portrait ? W / 2 : W * 0.74;
  const leftTop = portrait ? S * 0.26 : S * 0.24;
  const rightTop = portrait ? S * 0.62 : S * 0.24;
  const treeH = portrait ? rightTop + S * 0.34 : leftTop + S * 0.36;

  // Connector paths. Landscape: root fans to left+right. Portrait: root→left,
  // then a routed spine down the gutter to the lower (right) branch.
  const gutter = W * 0.11;
  const c1d = `M ${W / 2} ${rootBottomY} L ${leftCx} ${leftTop}`;
  const c2d = portrait
    ? `M ${W / 2} ${rootBottomY} L ${gutter} ${rootBottomY + S * 0.05} L ${gutter} ${rightTop - S * 0.05} L ${rightCx} ${rightTop}`
    : `M ${W / 2} ${rootBottomY} L ${rightCx} ${rightTop}`;

  const connectors = [
    { d: c1d, color: LEFT.accent, start: pf * 0.2 },
    { d: c2d, color: RIGHT.accent, start: pf * 0.35 },
  ];

  const closeO = interpolate(frame, [pf * 3, pf * 3 + pf * 0.2], [0, 1], CLAMP);

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        fontFamily: THEME.font,
        gap: height * 0.02,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: W,
          height: treeH,
        }}
      >
        {/* Connectors. */}
        <svg width={W} height={treeH} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          {connectors.map((c, i) => {
            const draw = interpolate(frame, [c.start, c.start + pf * 0.5], [0, 1], CLAMP);
            const flow = -saw(frame, pf * 0.6, i * 20);
            return (
              <g key={i}>
                <path
                  d={c.d}
                  fill="none"
                  stroke={`${c.color}55`}
                  strokeWidth={S * 0.0035}
                  pathLength={1}
                  strokeDasharray={1}
                  strokeDashoffset={1 - draw}
                />
                <path
                  d={c.d}
                  fill="none"
                  stroke={c.color}
                  strokeWidth={S * 0.004}
                  strokeLinecap="round"
                  pathLength={1}
                  strokeDasharray="0.05 0.2"
                  strokeDashoffset={flow}
                  opacity={draw * 0.9}
                />
              </g>
            );
          })}
        </svg>

        {/* Root question node. */}
        <div
          style={{
            position: 'absolute',
            left: W / 2,
            top: 0,
            width: rootW,
            transform: `translateX(-50%) translateY(${interpolate(rootIn, [0, 1], [-S * 0.012, 0])}px)`,
            opacity: rootIn,
            textAlign: 'center',
            background: 'rgba(255,255,255,0.05)',
            border: `1px solid rgba(255,255,255,${0.12 + rootGlow * 0.12})`,
            borderRadius: S * 0.03,
            boxShadow: `0 40px 120px rgba(0,0,0,0.55), 0 0 ${S * 0.02 * rootGlow}px rgba(79,107,237,0.4)`,
            padding: `${S * 0.028}px ${S * 0.03}px`,
            overflow: 'hidden',
          }}
        >
          {/* Indigo border beam — the root node border "lights up" travelling. */}
          <BorderBeam durationMs={4200} thickness={2} colorFrom={BEAM_FROM} colorTo={THEME.indigo} />

          <div style={{ fontSize: S * 0.02, fontWeight: 700, letterSpacing: 1, color: THEME.textFaint }}>DECIDE BY</div>
          <ShimmerSweep delayFrames={10} durationFrames={26}>
            <div style={{ fontSize: S * 0.038, fontWeight: 800, color: THEME.textStrong, marginTop: S * 0.006 }}>
              What is your primary goal?
              <span style={{ opacity: caret ? 1 : 0, color: THEME.indigo }}>▍</span>
            </div>
          </ShimmerSweep>
        </div>

        {/* Branch nodes. */}
        <div style={{ position: 'absolute', left: leftCx, top: leftTop }}>
          <BranchNode branch={LEFT} S={S} pf={pf} enterFrame={pf} bulletStart={pf + pf * 0.18} width={branchW} />
        </div>
        <div style={{ position: 'absolute', left: rightCx, top: rightTop }}>
          <BranchNode branch={RIGHT} S={S} pf={pf} enterFrame={pf * 2} bulletStart={pf * 2 + pf * 0.18} width={branchW} />
        </div>

        {/* Closing two-line verdict. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: S * 0.02,
            background: `rgba(5,6,12,${closeO * 0.95})`,
            borderRadius: S * 0.03,
            opacity: closeO,
            pointerEvents: 'none',
          }}
        >
          {[
            { a: 'Ship fast →', b: 'Dyad.', color: THEME.amber, delay: pf * 3.05 },
            { a: 'Build permanent →', b: 'Ptah.', color: THEME.indigo, delay: pf * 3.3 },
          ].map((line) => {
            const lp = interpolate(frame, [line.delay, line.delay + pf * 0.3], [0, 1], CLAMP);
            return (
              <div
                key={line.b}
                style={{
                  opacity: lp,
                  transform: `translateY(${interpolate(lp, [0, 1], [S * 0.03, 0])}px)`,
                  fontSize: S * 0.056,
                  fontWeight: 800,
                  color: THEME.textStrong,
                }}
              >
                {line.a} <span style={{ color: line.color }}>{line.b}</span>
              </div>
            );
          })}
        </div>
      </div>

      <CaptionRail slide={slide} durationFrames={durationFrames} width={width} />
    </AbsoluteFill>
  );
};
