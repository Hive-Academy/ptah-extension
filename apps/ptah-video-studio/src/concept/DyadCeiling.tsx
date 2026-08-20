/**
 * DyadCeiling — extreme initial momentum, but a hard ceiling.
 *
 * A momentum area chart (amber) climbs steeply (p1), then SLAMS into a hard red
 * horizontal ceiling — "custom enterprise logic won't fit" — with an impact
 * flash (p2). A contrast chip row follows: "vibe coding" (amber, active) vs
 * "formal architecture" (greyed, struck), plus a timeline pill "blank slate →
 * live URL: days" (p3). Finally a subtle see-saw hints "flexibility traded for
 * validation" (p4). The climb keeps a gentle deterministic vibration/settle at
 * the tip after impact so the scene never freezes.
 *
 * Semantic color: DYAD (speed) scene — amber momentum; red only for the ceiling.
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
import { BorderBeam, ShimmerSweep, Meteors } from '../components/effects';

const SPRING = { damping: 20, mass: 0.7 };
const RED = '#ef4444';

const Chip: React.FC<{
  label: string;
  S: number;
  appear: number;
  active?: boolean;
  struck?: number;
}> = ({ label, S, appear, active, struck = 0 }) => (
  <div
    style={{
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      gap: S * 0.01,
      padding: `${S * 0.014}px ${S * 0.024}px`,
      borderRadius: 999,
      background: active ? 'rgba(245,181,68,0.16)' : 'rgba(255,255,255,0.04)',
      border: `1px solid ${active ? THEME.amber : 'rgba(255,255,255,0.12)'}`,
      color: active ? THEME.amber : THEME.textFaint,
      fontSize: S * 0.024,
      fontWeight: 700,
      whiteSpace: 'nowrap',
      opacity: appear * (active ? 1 : 1 - struck * 0.35),
      transform: `scale(${interpolate(appear, [0, 1], [0.85, 1])})`,
    }}
  >
    <span
      style={{
        width: S * 0.013,
        height: S * 0.013,
        borderRadius: 999,
        background: active ? THEME.amber : THEME.textFaint,
        boxShadow: active ? `0 0 ${S * 0.018}px ${THEME.amber}` : 'none',
      }}
    />
    <span style={{ position: 'relative' }}>
      {label}
      {struck > 0 ? (
        <span
          style={{
            position: 'absolute',
            left: 0,
            top: '52%',
            height: Math.max(2, S * 0.0028),
            width: `${struck * 100}%`,
            background: RED,
            borderRadius: 999,
          }}
        />
      ) : null}
    </span>
  </div>
);

export const DyadCeiling: React.FC<ConceptSceneProps> = ({ slide, durationFrames, locale }) => {
  void locale;
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const S = Math.min(width, height);
  const portrait = height > width;
  const contentW = Math.min(width * 0.9, S * 1.15);

  const pad = S * 0.04;
  const cardW = contentW;
  const inner = cardW - pad * 2;
  const chartW = inner;
  const chartH = portrait ? S * 0.42 : S * 0.32;

  const { phaseFrames } = usePhases(durationFrames, 4);
  const breath = useBreath(70);
  const vibBreath = useBreath(9, 11);

  // The momentum card is a STABLE frame: it settles in fast at the very start
  // (opacity + a tiny translateY over ~10 frames) then holds ROCK-STEADY — no
  // drift/scale on the whole card. Everything animated lives INSIDE it: the
  // momentum line/area draw, the ceiling, the impact flash, the chips + pill.
  const cardSettle = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Momentum curve: rises fast, flattens as it reaches the ceiling at tHit.
  const tHit = 0.72;
  const bottomY = chartH;
  const ceilingY = chartH * 0.14;
  const usable = bottomY - ceilingY;
  const value = (t: number) => 1 - Math.pow(1 - Math.min(Math.max(t / tHit, 0), 1), 2.6);

  const impact = phaseFrames; // curve reaches the ceiling as p2 begins
  const rev = interpolate(frame, [phaseFrames * 0.12, phaseFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  // Gentle settle after impact, but never fully still — keeps the tip alive.
  const settle = interpolate(frame, [impact, impact + phaseFrames * 0.8], [1, 0.3], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const vib = frame > impact ? (vibBreath - 0.5) * S * 0.01 * settle : 0;

  const steps = 64;
  const revSteps = Math.max(1, Math.round(steps * rev));
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= revSteps; i++) {
    const t = i / steps;
    const w = t; // vibration weighted toward the (right) tip
    const x = t * chartW;
    const y = bottomY - value(t) * usable + vib * w;
    pts.push({ x, y });
  }
  const tip = pts[pts.length - 1];
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  const areaPath = `${linePath} L ${tip.x.toFixed(2)} ${bottomY} L 0 ${bottomY} Z`;

  const ceilingAppear = interpolate(frame, [phaseFrames * 0.2, phaseFrames * 0.55], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const ceilingHot = interpolate(frame, [impact - 3, impact + 6], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const labelAppear = spring({ frame: frame - (impact + 4), fps, config: SPRING });
  const flash = interpolate(frame, [impact, impact + 2, impact + 16], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const flashX = tHit * chartW;

  const tipPulse = 0.5 + breath * 0.5;

  const chipsAppear = spring({ frame: frame - (2 * phaseFrames + phaseFrames * 0.05), fps, config: SPRING });
  const chipStruck = interpolate(frame, [2 * phaseFrames + phaseFrames * 0.4, 2 * phaseFrames + phaseFrames * 0.85], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const seesawAppear = spring({ frame: frame - (3 * phaseFrames + phaseFrames * 0.05), fps, config: SPRING });

  // See-saw: validation side settles down, flexibility side lifts (traded away).
  const beatOsc = interpolate(breath, [0, 1], [-2, 2]);
  const tilt = seesawAppear * 9 + beatOsc * seesawAppear;
  const beamW = portrait ? inner * 0.72 : inner * 0.5;
  const beamH = beamW * 0.4;

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: THEME.font,
        flexDirection: 'column',
        gap: height * 0.02,
      }}
    >
      {/* Subtle amber meteors behind the rising-momentum area — Dyad speed motif. */}
      <Meteors count={4} color={THEME.amber} />

      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          width: cardW,
          padding: pad,
          borderRadius: S * 0.03,
          background: 'rgba(255,255,255,0.045)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 40px 120px rgba(0,0,0,0.55)',
          display: 'flex',
          flexDirection: 'column',
          gap: S * 0.028,
          opacity: cardSettle,
          transform: `translateY(${interpolate(cardSettle, [0, 1], [8, 0])}px)`,
        }}
      >
        {/* Amber border beam — the momentum card's edge lights up. */}
        <BorderBeam colorFrom={THEME.amber} colorTo={THEME.amberDeep} />

        <ShimmerSweep delayFrames={Math.round(phaseFrames * 0.15)}>
          <div style={{ fontSize: S * 0.03, fontWeight: 800, color: THEME.textStrong }}>Momentum</div>
        </ShimmerSweep>

        {/* Chart */}
        <div style={{ position: 'relative', width: chartW, height: chartH }}>
          <svg
            width={chartW}
            height={chartH}
            viewBox={`0 0 ${chartW} ${chartH}`}
            style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
          >
            <defs>
              <linearGradient id="dyad-momentum" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={THEME.amber} stopOpacity={0.55} />
                <stop offset="100%" stopColor={THEME.amber} stopOpacity={0.02} />
              </linearGradient>
            </defs>

            {/* baseline */}
            <line x1={0} y1={bottomY} x2={chartW} y2={bottomY} stroke="rgba(255,255,255,0.1)" strokeWidth={S * 0.002} />

            {/* momentum area + line */}
            <path d={areaPath} fill="url(#dyad-momentum)" />
            <path
              d={linePath}
              fill="none"
              stroke={THEME.amber}
              strokeWidth={S * 0.006}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ filter: `drop-shadow(0 0 ${S * 0.012}px rgba(245,181,68,0.5))` }}
            />

            {/* hard ceiling */}
            <line
              x1={0}
              y1={ceilingY}
              x2={chartW}
              y2={ceilingY}
              stroke={`rgba(239,68,68,${0.25 + ceilingHot * 0.75})`}
              strokeWidth={S * (0.003 + ceilingHot * 0.003)}
              strokeDasharray={`${S * 0.014} ${S * 0.01}`}
              strokeLinecap="round"
              opacity={ceilingAppear}
            />

            {/* glowing tip */}
            <circle
              cx={tip.x}
              cy={tip.y}
              r={S * 0.011 * (0.85 + tipPulse * 0.3)}
              fill={THEME.amber}
              style={{ filter: `drop-shadow(0 0 ${S * 0.02 * tipPulse}px ${THEME.amber})` }}
            />
          </svg>

          {/* impact flash at the collision point */}
          <div
            style={{
              position: 'absolute',
              left: flashX - S * 0.09,
              top: ceilingY - S * 0.09,
              width: S * 0.18,
              height: S * 0.18,
              borderRadius: '50%',
              background: `radial-gradient(circle, rgba(239,68,68,0.7) 0%, rgba(239,68,68,0) 65%)`,
              opacity: flash,
              transform: `scale(${interpolate(flash, [0, 1], [0.4, 1.15])})`,
            }}
          />

          {/* ceiling label */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: ceilingY - S * 0.05,
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              opacity: labelAppear,
              transform: `translateY(${interpolate(labelAppear, [0, 1], [8, 0])}px)`,
            }}
          >
            <span
              style={{
                padding: `${S * 0.008}px ${S * 0.02}px`,
                borderRadius: 999,
                background: 'rgba(239,68,68,0.14)',
                border: `1px solid ${RED}`,
                color: RED,
                fontSize: S * 0.022,
                fontWeight: 800,
                whiteSpace: 'nowrap',
              }}
            >
              custom enterprise logic won't fit
            </span>
          </div>
        </div>

        {/* Contrast chips + timeline pill */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: S * 0.018,
            opacity: chipsAppear,
            transform: `translateY(${interpolate(chipsAppear, [0, 1], [14, 0])}px)`,
          }}
        >
          <Chip label="vibe coding" S={S} appear={chipsAppear} active />
          <Chip label="formal architecture" S={S} appear={chipsAppear} struck={chipStruck} />
          <span
            style={{
              marginInlineStart: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: S * 0.01,
              padding: `${S * 0.012}px ${S * 0.022}px`,
              borderRadius: 999,
              background: 'rgba(245,181,68,0.1)',
              border: '1px solid rgba(245,181,68,0.4)',
              color: THEME.textStrong,
              fontSize: S * 0.022,
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            blank slate <span style={{ color: THEME.amber, fontWeight: 800 }}>→</span> live URL
            <span style={{ color: THEME.amber, fontWeight: 800 }}>: days</span>
          </span>
        </div>

        {/* See-saw: flexibility traded for validation */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: S * 0.012,
            opacity: seesawAppear,
            transform: `translateY(${interpolate(seesawAppear, [0, 1], [14, 0])}px)`,
          }}
        >
          <svg width={beamW} height={beamH} viewBox={`0 0 ${beamW} ${beamH}`} style={{ overflow: 'visible' }}>
            {/* fulcrum */}
            <path
              d={`M ${beamW / 2} ${beamH * 0.5} L ${beamW / 2 - beamH * 0.28} ${beamH} L ${beamW / 2 + beamH * 0.28} ${beamH} Z`}
              fill="rgba(255,255,255,0.18)"
            />
            <g transform={`rotate(${tilt} ${beamW / 2} ${beamH * 0.5})`}>
              <line
                x1={beamW * 0.1}
                y1={beamH * 0.5}
                x2={beamW * 0.9}
                y2={beamH * 0.5}
                stroke="rgba(255,255,255,0.55)"
                strokeWidth={S * 0.005}
                strokeLinecap="round"
              />
              {/* flexibility pan (left) — lifted / traded away */}
              <circle cx={beamW * 0.1} cy={beamH * 0.5} r={S * 0.014} fill={THEME.amber} opacity={0.5} />
              {/* validation pan (right) — settled down / chosen */}
              <circle cx={beamW * 0.9} cy={beamH * 0.5} r={S * 0.014} fill={THEME.textStrong} />
            </g>
          </svg>
          <span style={{ fontSize: S * 0.024, fontWeight: 700, color: THEME.textSoft }}>
            <span style={{ color: THEME.amber }}>flexibility</span> traded for{' '}
            <span style={{ color: THEME.textStrong, fontWeight: 800 }}>validation</span>
          </span>
        </div>
      </div>

      <CaptionRail slide={slide} durationFrames={durationFrames} width={width} />
    </AbsoluteFill>
  );
};
