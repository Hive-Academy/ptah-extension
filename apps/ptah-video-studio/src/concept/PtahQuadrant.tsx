/**
 * PtahQuadrant — a 2x2 technical-footprint quadrant. X = time to first UI
 * (left is fast), Y = architectural rigor (up is more). Dyad lands bottom-left
 * (fast, low rigor); Ptah lands top-right (slow, high rigor) and stays alive.
 *
 * Phase 1: axes + grid draw in. Phase 2: the amber Dyad dot drops bottom-left.
 * Phase 3: the indigo Ptah dot drops top-right, emphasized with a breathing
 * glow. Phase 4: Ptah's heavy stack fades in as chips. Phase 5: a note that the
 * friction is intentional — the codebase survives year two.
 *
 * Frame-driven only. Indigo carries Ptah/rigor; amber is used solely on the
 * Dyad comparison dot.
 */
import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from 'remotion';
import { THEME } from '../theme';
import type { ConceptSceneProps } from '../PromoReel';
import { CaptionRail, usePhases, useBreath } from './scene-kit';
import { BorderBeam, ShimmerSweep } from '../components/effects';

// Light-to-core indigo beam — Ptah/rigor accent (amber stays on the Dyad dot).
const BEAM_FROM = '#8ea2ff';

const CHIPS =['Nx monorepo', 'NestJS', 'Angular', 'DDD boundaries', 'multi-tenant', 'modular libs'];

/** A grid/axis line that draws itself in as `p` goes 0→1. */
const DrawLine: React.FC<{
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  p: number;
  stroke: string;
  width: number;
  dash?: string;
}> = ({ x1, y1, x2, y2, p, stroke, width, dash }) => {
  const len = Math.hypot(x2 - x1, y2 - y1);
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap="round"
      strokeDasharray={dash ?? len}
      strokeDashoffset={
        dash
          ? 0
          : interpolate(p, [0, 1], [len, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
      }
      opacity={dash ? interpolate(p, [0, 1], [0, 1], { extrapolateLeft: 'clamp' }) : 1}
    />
  );
};

const DyadDot: React.FC<{ start: number }> = ({ start }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const land = spring({ frame: frame - start, fps, config: { damping: 20, mass: 0.7 } });
  const breath = useBreath(96, 20);
  const dropY = interpolate(land, [0, 1], [-16, 0]);
  const scale = interpolate(land, [0, 1], [0, 1]) * (0.97 + breath * 0.06);
  return (
    <g transform={`translate(27, 73)`} opacity={land}>
      <g transform={`translate(0, ${dropY}) scale(${scale})`}>
        <circle r={7} fill={THEME.amber} opacity={0.14 + breath * 0.08} />
        <circle r={3.4} fill={THEME.amber} />
        <circle r={3.4} fill="none" stroke="#fff" strokeWidth={0.5} opacity={0.5} />
      </g>
      <text
        x={0}
        y={13}
        textAnchor="middle"
        style={{ fontFamily: THEME.font, fontSize: 4.4, fontWeight: 800, fill: THEME.amber }}
      >
        Dyad
      </text>
      <text
        x={0}
        y={18}
        textAnchor="middle"
        style={{ fontFamily: THEME.font, fontSize: 2.7, fontWeight: 600, fill: THEME.textFaint }}
      >
        fast · low rigor
      </text>
    </g>
  );
};

const PtahDot: React.FC<{ start: number }> = ({ start }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const land = spring({ frame: frame - start, fps, config: { damping: 20, mass: 0.7 } });
  const breath = useBreath(70);
  const dropY = interpolate(land, [0, 1], [-18, 0]);
  const scale = interpolate(land, [0, 1], [0, 1]);
  return (
    <g transform={`translate(73, 27)`} opacity={land}>
      <g transform={`translate(0, ${dropY}) scale(${scale})`}>
        <circle r={12 + breath * 4.5} fill={THEME.indigo} opacity={0.1 + breath * 0.16} />
        <circle r={9 + breath * 2.5} fill={THEME.indigo} opacity={0.08 + breath * 0.1} />
        <circle r={6.4} fill="none" stroke={THEME.indigo} strokeWidth={0.8} opacity={0.6 + breath * 0.4} />
        <circle r={3.8} fill={THEME.indigo} />
        <circle r={3.8} fill="none" stroke="#fff" strokeWidth={0.6} opacity={0.7} />
      </g>
      <text
        x={0}
        y={-11}
        textAnchor="middle"
        style={{ fontFamily: THEME.font, fontSize: 5, fontWeight: 800, fill: THEME.textStrong }}
      >
        Ptah
      </text>
      <text
        x={0}
        y={-6}
        textAnchor="middle"
        style={{ fontFamily: THEME.font, fontSize: 2.7, fontWeight: 700, fill: THEME.indigo }}
      >
        high rigor · heavy stack
      </text>
    </g>
  );
};

const Chip: React.FC<{ label: string; start: number; s: number }> = ({ label, start, s }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - start, fps, config: { damping: 20, mass: 0.7 } });
  const breath = useBreath(84, start);
  return (
    <span
      style={{
        opacity: enter,
        transform: `translateY(${interpolate(enter, [0, 1], [12, 0]) + interpolate(breath, [0, 1], [-1.5, 1.5])}px)`,
        padding: `${s * 0.008}px ${s * 0.018}px`,
        borderRadius: 999,
        background: `${THEME.indigo}24`,
        border: `1px solid ${THEME.indigo}66`,
        color: THEME.textStrong,
        fontSize: s * 0.02,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
};

export const PtahQuadrant: React.FC<ConceptSceneProps> = ({ slide, durationFrames, locale }) => {
  void locale;
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const s = Math.min(width, height);
  const portrait = height > width;
  const contentW = Math.min(width * 0.9, s * 1.15);

  const { phaseFrames } = usePhases(durationFrames, 5);
  const axesStart = phaseFrames * 0.05;
  const dyadStart = phaseFrames * 1;
  const ptahStart = phaseFrames * 2;
  const chipsStart = phaseFrames * 3;
  const noteStart = phaseFrames * 4;

  // Axis / grid draw-in progress, lightly staggered across phase 1.
  const dp = (o: number) =>
    interpolate(frame, [axesStart + o, axesStart + o + phaseFrames * 0.5], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    });

  // Chart card: a STABLE frame. It settles in with a quick fade + tiny
  // translateY over ~10 frames, then holds ROCK-STEADY — no spring overshoot,
  // no ongoing drift. Its axes, dots, chips and note animate individually
  // INSIDE it.
  const cardSettle = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const noteIn = spring({ frame: frame - noteStart, fps, config: { damping: 20, mass: 0.7 } });

  const Q = portrait ? s * 0.72 : s * 0.56;

  const chart = (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: s * 0.01 }}>
      {/* Y axis label (rotated). */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: s * 0.05,
        }}
      >
        <span
          style={{
            transform: 'rotate(-90deg)',
            whiteSpace: 'nowrap',
            fontSize: s * 0.021,
            fontWeight: 700,
            color: THEME.textSoft,
          }}
        >
          Architectural rigor ↑
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: s * 0.008 }}>
        <svg width={Q} height={Q} viewBox="0 0 100 100">
          {/* Quadrant fills — top-right (Ptah) subtly indigo, hint of structure. */}
          <rect
            x={50}
            y={8}
            width={42}
            height={42}
            fill={THEME.indigo}
            opacity={interpolate(dp(0), [0, 1], [0, 0.06])}
          />
          {/* Outer frame. */}
          <rect
            x={8}
            y={8}
            width={84}
            height={84}
            fill="none"
            stroke="rgba(255,255,255,0.14)"
            strokeWidth={0.5}
            strokeDasharray={336}
            strokeDashoffset={interpolate(dp(0), [0, 1], [336, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })}
          />
          {/* Mid grid. */}
          <DrawLine x1={50} y1={8} x2={50} y2={92} p={dp(phaseFrames * 0.06)} stroke="rgba(255,255,255,0.12)" width={0.5} />
          <DrawLine x1={8} y1={50} x2={92} y2={50} p={dp(phaseFrames * 0.06)} stroke="rgba(255,255,255,0.12)" width={0.5} />
          {/* Strong axes (left + bottom). */}
          <DrawLine x1={8} y1={92} x2={8} y2={8} p={dp(phaseFrames * 0.12)} stroke="rgba(255,255,255,0.4)" width={0.9} />
          <DrawLine x1={8} y1={92} x2={92} y2={92} p={dp(phaseFrames * 0.12)} stroke="rgba(255,255,255,0.4)" width={0.9} />

          <DyadDot start={dyadStart} />
          <PtahDot start={ptahStart} />
        </svg>

        {/* X axis label. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            paddingInline: s * 0.01,
          }}
        >
          <span style={{ fontSize: s * 0.016, fontWeight: 700, color: THEME.textFaint }}>← fast</span>
          <span style={{ fontSize: s * 0.021, fontWeight: 700, color: THEME.textSoft }}>
            Time to first UI →
          </span>
          <span style={{ width: s * 0.05 }} />
        </div>
      </div>
    </div>
  );

  const chips = (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: s * 0.014,
        alignItems: 'flex-start',
        alignContent: 'flex-start',
        justifyContent: portrait ? 'center' : 'flex-start',
        maxWidth: portrait ? Q : s * 0.34,
      }}
    >
      {CHIPS.map((label, i) => (
        <Chip key={label} label={label} start={chipsStart + i * phaseFrames * 0.11} s={s} />
      ))}
    </div>
  );

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: THEME.font,
        flexDirection: 'column',
        gap: s * 0.04,
      }}
    >
      <div
        style={{
          ...( {
            background: 'rgba(255,255,255,0.045)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: s * 0.03,
            boxShadow: '0 40px 120px rgba(0,0,0,0.55)',
            position: 'relative',
            overflow: 'hidden',
          } as React.CSSProperties),
          padding: s * 0.04,
          maxWidth: contentW,
          opacity: cardSettle,
          transform: `translateY(${interpolate(cardSettle, [0, 1], [8, 0])}px)`,
          display: 'flex',
          flexDirection: 'column',
          gap: s * 0.028,
        }}
      >
        {/* Indigo border beam — the card border "lights up" travelling. */}
        <BorderBeam durationMs={4200} thickness={2} colorFrom={BEAM_FROM} colorTo={THEME.indigo} />

        <ShimmerSweep delayFrames={10} durationFrames={26}>
          <span style={{ fontSize: s * 0.03, fontWeight: 800, color: THEME.textStrong }}>
            Technical footprint
          </span>
        </ShimmerSweep>

        <div
          style={{
            display: 'flex',
            flexDirection: portrait ? 'column' : 'row',
            alignItems: portrait ? 'center' : 'flex-start',
            gap: portrait ? s * 0.028 : s * 0.03,
          }}
        >
          {chart}
          {chips}
        </div>

        {/* Phase 5 note — friction is intentional. */}
        <div
          style={{
            alignSelf: portrait ? 'center' : 'flex-start',
            display: 'flex',
            alignItems: 'center',
            gap: s * 0.012,
            padding: `${s * 0.012}px ${s * 0.02}px`,
            borderRadius: 999,
            background: `${THEME.indigo}14`,
            border: `1px solid ${THEME.indigo}44`,
            opacity: noteIn,
            transform: `translateY(${interpolate(noteIn, [0, 1], [12, 0])}px)`,
          }}
        >
          <span style={{ width: s * 0.01, height: s * 0.01, borderRadius: 999, background: THEME.indigo }} />
          <span style={{ fontSize: s * 0.02, fontWeight: 700, color: THEME.textStrong }}>
            friction is intentional — survives year two
          </span>
        </div>
      </div>

      <CaptionRail slide={slide} durationFrames={durationFrames} width={width} />
    </AbsoluteFill>
  );
};
