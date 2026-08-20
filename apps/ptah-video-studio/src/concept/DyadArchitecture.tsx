/**
 * DyadArchitecture — Dyad's speed comes from pre-built integrations.
 *
 * An architecture node graph assembles itself. A central amber "Your App" node
 * appears (p1), then an animated connection line draws out to a "Supabase" node
 * — "Auth + Database" (p2), then to a "Vercel" node — "Hosting" (p3); a small
 * green check pill pops on each as it wires up ("a few clicks"). Finally a
 * de-emphasized "Backend boilerplate" box is struck through and marked skipped
 * (p4). Lines are inline SVG with deterministic stroke-dashoffset draw-on plus a
 * continuous energy pulse so the graph stays alive across the whole hold.
 *
 * Semantic color: this is a DYAD (speed) scene — lead with amber.
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
const GREEN = '#34d399';

type Frac = { x: number; y: number };

const CheckPill: React.FC<{ appear: number; S: number }> = ({ appear, S }) => (
  <div
    style={{
      position: 'absolute',
      top: -S * 0.03,
      insetInlineEnd: -S * 0.02,
      display: 'flex',
      alignItems: 'center',
      gap: S * 0.008,
      padding: `${S * 0.008}px ${S * 0.016}px`,
      borderRadius: 999,
      background: 'rgba(52,211,153,0.16)',
      border: `1px solid ${GREEN}`,
      color: GREEN,
      fontSize: S * 0.019,
      fontWeight: 700,
      whiteSpace: 'nowrap',
      opacity: appear,
      transform: `scale(${interpolate(appear, [0, 1], [0.4, 1])})`,
      transformOrigin: 'center',
      boxShadow: `0 0 ${S * 0.03}px rgba(52,211,153,0.35)`,
    }}
  >
    <svg width={S * 0.02} height={S * 0.02} viewBox="0 0 24 24" fill="none">
      <path d="M4 12.5l5 5L20 6" stroke={GREEN} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    wired
  </div>
);

const NodeCard: React.FC<{
  cx: number;
  cy: number;
  w: number;
  h: number;
  S: number;
  appear: number;
  float: number;
  accent: string;
  title: string;
  subtitle: string;
  strong?: boolean;
  glow?: number;
  checked?: boolean;
  checkAppear?: number;
  /** Render a travelling amber BorderBeam so the card's edge lights up. */
  beam?: boolean;
  /** When set, wrap the title in a one-time ShimmerSweep firing at this frame. */
  shimmerDelay?: number;
}> = ({ cx, cy, w, h, S, appear, float, accent, title, subtitle, strong, glow = 0, checked, checkAppear = 0, beam, shimmerDelay }) => (
  <div
    style={{
      position: 'absolute',
      left: cx - w / 2,
      top: cy - h / 2 + float,
      width: w,
      height: h,
      overflow: beam ? 'hidden' : undefined,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      gap: S * 0.008,
      padding: S * 0.028,
      borderRadius: S * 0.03,
      background: strong
        ? 'linear-gradient(180deg, rgba(245,181,68,0.16), rgba(245,158,11,0.06))'
        : 'rgba(255,255,255,0.045)',
      border: `1px solid ${strong ? accent : 'rgba(255,255,255,0.1)'}`,
      boxShadow: strong
        ? `0 40px 120px rgba(0,0,0,0.55), 0 0 ${S * (0.02 + glow * 0.05)}px rgba(245,181,68,${0.3 + glow * 0.4})`
        : '0 40px 120px rgba(0,0,0,0.55)',
      opacity: appear,
      transform: `translateY(${interpolate(appear, [0, 1], [22, 0])}px) scale(${interpolate(appear, [0, 1], [0.9, 1])})`,
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: S * 0.014 }}>
      <span
        style={{
          width: S * 0.016,
          height: S * 0.016,
          borderRadius: 999,
          background: accent,
          boxShadow: `0 0 ${S * 0.02}px ${accent}`,
          flex: '0 0 auto',
        }}
      />
      {shimmerDelay !== undefined ? (
        <ShimmerSweep delayFrames={shimmerDelay}>
          <span style={{ fontSize: S * 0.03, fontWeight: 800, color: THEME.textStrong, whiteSpace: 'nowrap' }}>
            {title}
          </span>
        </ShimmerSweep>
      ) : (
        <span style={{ fontSize: S * 0.03, fontWeight: 800, color: THEME.textStrong, whiteSpace: 'nowrap' }}>
          {title}
        </span>
      )}
    </div>
    <span style={{ fontSize: S * 0.021, fontWeight: 700, color: THEME.textSoft, whiteSpace: 'nowrap' }}>
      {subtitle}
    </span>
    {checked ? <CheckPill appear={checkAppear} S={S} /> : null}
    {beam ? <BorderBeam colorFrom={THEME.amber} colorTo={THEME.amberDeep} /> : null}
  </div>
);

export const DyadArchitecture: React.FC<ConceptSceneProps> = ({ slide, durationFrames, locale }) => {
  void locale;
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const S = Math.min(width, height);
  const portrait = height > width;
  const contentW = Math.min(width * 0.9, S * 1.15);
  const stageW = contentW;
  const stageH = portrait ? contentW * 1.18 : contentW * 0.54;

  const { phaseFrames } = usePhases(durationFrames, 4);
  const breath = useBreath(90);

  // The graph STAGE is a stable container: it settles in fast at the very start
  // (opacity + a tiny translateY over ~10 frames) then holds ROCK-STEADY — no
  // drift/breath on the whole graph. The nodes, lines, pills and pulse populate
  // INSIDE this fixed frame via their own staggered per-element entrances.
  const stageSettle = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Node layout (fractions of the stage) — vertical stack in portrait.
  const P: Record<'app' | 'supabase' | 'vercel' | 'skipped', Frac> = portrait
    ? {
        app: { x: 0.5, y: 0.45 },
        supabase: { x: 0.5, y: 0.14 },
        vercel: { x: 0.5, y: 0.71 },
        skipped: { x: 0.5, y: 0.93 },
      }
    : {
        app: { x: 0.5, y: 0.4 },
        supabase: { x: 0.16, y: 0.4 },
        vercel: { x: 0.84, y: 0.4 },
        skipped: { x: 0.5, y: 0.86 },
      };

  const px = (f: Frac) => f.x * stageW;
  const py = (f: Frac) => f.y * stageH;

  const appW = portrait ? S * 0.42 : S * 0.28;
  const intW = portrait ? S * 0.4 : S * 0.25;
  const nodeH = S * 0.15;
  const skipW = portrait ? S * 0.44 : S * 0.34;

  // Phase-anchored reveals.
  const appAppear = spring({ frame: frame - phaseFrames * 0.15, fps, config: SPRING });
  const supaAppear = spring({ frame: frame - (phaseFrames + phaseFrames * 0.05), fps, config: SPRING });
  const vercelAppear = spring({ frame: frame - (2 * phaseFrames + phaseFrames * 0.05), fps, config: SPRING });
  const skipAppear = spring({ frame: frame - (3 * phaseFrames + phaseFrames * 0.05), fps, config: SPRING });

  const draw = (start: number) =>
    interpolate(frame, [start, start + phaseFrames * 0.45], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.inOut(Easing.cubic),
    });
  const supaLine = draw(phaseFrames + phaseFrames * 0.15);
  const vercelLine = draw(2 * phaseFrames + phaseFrames * 0.15);

  const supaCheck = spring({ frame: frame - (phaseFrames + phaseFrames * 0.65), fps, config: SPRING });
  const vercelCheck = spring({ frame: frame - (2 * phaseFrames + phaseFrames * 0.65), fps, config: SPRING });

  const strike = interpolate(frame, [3 * phaseFrames + phaseFrames * 0.2, 3 * phaseFrames + phaseFrames * 0.7], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const appC = { x: px(P.app), y: py(P.app) };
  const supaC = { x: px(P.supabase), y: py(P.supabase) };
  const vercelC = { x: px(P.vercel), y: py(P.vercel) };
  const skipC = { x: px(P.skipped), y: py(P.skipped) };

  type Conn = { to: { x: number; y: number }; progress: number };
  const conns: Conn[] = [
    { to: supaC, progress: supaLine },
    { to: vercelC, progress: vercelLine },
  ];

  // Continuous energy pulse offset for wired lines.
  const pulseOffset = -((frame * 2.2) % (S * 0.045));

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
      {/* Subtle amber meteor streaks behind the graph — Dyad speed motif. */}
      <Meteors count={3} color={THEME.amber} />

      <div
        style={{
          position: 'relative',
          width: stageW,
          height: stageH,
          opacity: stageSettle,
          transform: `translateY(${interpolate(stageSettle, [0, 1], [8, 0])}px)`,
        }}
      >
        <svg
          width={stageW}
          height={stageH}
          viewBox={`0 0 ${stageW} ${stageH}`}
          style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
        >
          {conns.map((c, i) => {
            const dx = c.to.x - appC.x;
            const dy = c.to.y - appC.y;
            const len = Math.hypot(dx, dy);
            return (
              <g key={i}>
                {/* faint rail */}
                <line
                  x1={appC.x}
                  y1={appC.y}
                  x2={c.to.x}
                  y2={c.to.y}
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth={S * 0.004}
                  strokeLinecap="round"
                />
                {/* drawn amber connection */}
                <line
                  x1={appC.x}
                  y1={appC.y}
                  x2={c.to.x}
                  y2={c.to.y}
                  stroke={THEME.amber}
                  strokeWidth={S * 0.005}
                  strokeLinecap="round"
                  strokeDasharray={len}
                  strokeDashoffset={len * (1 - c.progress)}
                  style={{ filter: `drop-shadow(0 0 ${S * 0.01}px rgba(245,181,68,0.5))` }}
                />
                {/* continuous energy pulse once wired */}
                {c.progress > 0.99 ? (
                  <line
                    x1={appC.x}
                    y1={appC.y}
                    x2={c.to.x}
                    y2={c.to.y}
                    stroke="#ffffff"
                    strokeWidth={S * 0.005}
                    strokeLinecap="round"
                    strokeDasharray={`${S * 0.012} ${S * 0.033}`}
                    strokeDashoffset={pulseOffset}
                    opacity={0.55}
                  />
                ) : null}
              </g>
            );
          })}
          {/* skipped connection — dashed + struck */}
          <line
            x1={appC.x}
            y1={appC.y}
            x2={skipC.x}
            y2={skipC.y}
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={S * 0.003}
            strokeDasharray={`${S * 0.01} ${S * 0.01}`}
            strokeLinecap="round"
            opacity={skipAppear * 0.6}
          />
        </svg>

        <NodeCard
          cx={supaC.x}
          cy={supaC.y}
          w={intW}
          h={nodeH}
          S={S}
          appear={supaAppear}
          float={0}
          accent={THEME.amber}
          title="Supabase"
          subtitle="Auth + Database"
          checked
          checkAppear={supaCheck}
        />
        <NodeCard
          cx={vercelC.x}
          cy={vercelC.y}
          w={intW}
          h={nodeH}
          S={S}
          appear={vercelAppear}
          float={0}
          accent={THEME.amber}
          title="Vercel"
          subtitle="Hosting"
          checked
          checkAppear={vercelCheck}
        />

        {/* Central app node — amber, breathing glow. */}
        <NodeCard
          cx={appC.x}
          cy={appC.y}
          w={appW}
          h={nodeH}
          S={S}
          appear={appAppear}
          float={0}
          accent={THEME.amber}
          title="Your App"
          subtitle="a few clicks to wire up"
          strong
          glow={breath}
          beam
          shimmerDelay={phaseFrames * 0.15}
        />

        {/* Skipped backend boilerplate — greyed + struck. */}
        <div
          style={{
            position: 'absolute',
            left: skipC.x - skipW / 2,
            top: skipC.y - nodeH * 0.42,
            width: skipW,
            height: nodeH * 0.84,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: S * 0.02,
            padding: `${S * 0.02}px ${S * 0.028}px`,
            borderRadius: S * 0.03,
            background: 'rgba(255,255,255,0.03)',
            border: '1px dashed rgba(255,255,255,0.14)',
            opacity: skipAppear * (1 - strike * 0.45),
            transform: `translateY(${interpolate(skipAppear, [0, 1], [18, 0])}px)`,
          }}
        >
          <span
            style={{
              position: 'relative',
              fontSize: S * 0.026,
              fontWeight: 700,
              color: THEME.textFaint,
              whiteSpace: 'nowrap',
            }}
          >
            Backend boilerplate
            <span
              style={{
                position: 'absolute',
                left: 0,
                top: '52%',
                height: Math.max(2, S * 0.003),
                width: `${strike * 100}%`,
                background: '#ef4444',
                borderRadius: 999,
              }}
            />
          </span>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: S * 0.008,
              padding: `${S * 0.006}px ${S * 0.014}px`,
              borderRadius: 999,
              background: 'rgba(239,68,68,0.14)',
              border: '1px solid rgba(239,68,68,0.5)',
              color: '#ef4444',
              fontSize: S * 0.018,
              fontWeight: 800,
              whiteSpace: 'nowrap',
              opacity: strike,
            }}
          >
            <svg width={S * 0.017} height={S * 0.017} viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="#ef4444" strokeWidth={3.4} strokeLinecap="round" />
            </svg>
            skipped
          </span>
        </div>
      </div>

      <CaptionRail slide={slide} durationFrames={durationFrames} width={width} />
    </AbsoluteFill>
  );
};
