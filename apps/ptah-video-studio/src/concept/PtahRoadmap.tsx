/**
 * PtahRoadmap — Ptah refuses to code first: it plans, writes a strict roadmap
 * file, and gates every task against it.
 *
 * Phase 1: a chat — the user asks to "start a new project" and Ptah declines to
 * write code yet ("Let's plan first"). Phase 2: a discovery-phase indicator
 * scans the system. Phase 3: a `roadmap.md` file card materializes with a
 * phased checklist whose boxes tick in sequence. Phase 4: an off-roadmap task
 * row appears and is BLOCKED in red — not on the roadmap, won't execute.
 *
 * Frame-driven only. Ptah/planning colour is indigo; the block is red, used
 * sparingly on the single refused row.
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

const RED = '#ef4444';

const PHASES: { label: string; note: string }[] = [
  { label: 'Phase 0 · Platform', note: 'Nx workspace + CI' },
  { label: 'Phase 1 · Auth', note: 'sessions + guards' },
  { label: 'Phase 2 · Data', note: 'schema + migrations' },
  { label: 'Phase 3 · Features', note: 'domain modules' },
  { label: 'Phase 4 · Polish', note: 'a11y + perf' },
];

const cardStyle = (s: number): React.CSSProperties => ({
  background: 'rgba(255,255,255,0.045)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: s * 0.03,
  boxShadow: '0 40px 120px rgba(0,0,0,0.55)',
});

/** A rounded checkbox that fills indigo and strokes a check as `p` goes 0→1. */
const Check: React.FC<{ size: number; p: number }> = ({ size, p }) => {
  const len = 22;
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: size * 0.28,
        background: interpolate(p, [0, 1], [0, 1]) > 0.02 ? THEME.indigo : 'transparent',
        border: `2px solid ${p > 0.5 ? THEME.indigo : 'rgba(255,255,255,0.3)'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: interpolate(p, [0, 0.15], [0.6, 1], { extrapolateRight: 'clamp' }),
      }}
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24">
        <polyline
          points="5,13 10,18 19,7"
          fill="none"
          stroke="#fff"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={len}
          strokeDashoffset={interpolate(p, [0, 1], [len, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })}
        />
      </svg>
    </div>
  );
};

/** A single scanning dot with its own breath phase (keeps hooks out of loops). */
const ScanDot: React.FC<{ s: number; phase: number }> = ({ s, phase }) => {
  const b = useBreath(40, phase);
  return (
    <span
      style={{
        width: s * 0.012,
        height: s * 0.012,
        borderRadius: 999,
        background: THEME.indigo,
        opacity: 0.35 + b * 0.65,
      }}
    />
  );
};

const Bubble: React.FC<{
  who: string;
  text: string;
  mine: boolean;
  accent: string;
  s: number;
  chip?: string;
  /** Per-element entrance 0..1 — the bubble populates INSIDE the stable card. */
  appear?: number;
}> = ({ who, text, mine, accent, s, chip, appear = 1 }) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: mine ? 'flex-end' : 'flex-start',
      gap: s * 0.008,
      opacity: appear,
      transform: `translateY(${interpolate(appear, [0, 1], [14, 0])}px)`,
    }}
  >
    <span style={{ fontSize: s * 0.017, fontWeight: 700, color: THEME.textFaint }}>{who}</span>
    <div
      style={{
        maxWidth: '86%',
        padding: `${s * 0.018}px ${s * 0.026}px`,
        borderRadius: s * 0.028,
        borderBottomRightRadius: mine ? s * 0.008 : s * 0.028,
        borderBottomLeftRadius: mine ? s * 0.028 : s * 0.008,
        background: mine ? 'rgba(255,255,255,0.09)' : `${accent}22`,
        border: `1px solid ${mine ? 'rgba(255,255,255,0.12)' : `${accent}55`}`,
        color: THEME.textStrong,
        fontSize: s * 0.024,
        fontWeight: 600,
        lineHeight: 1.3,
      }}
    >
      {text}
    </div>
    {chip ? (
      <span
        style={{
          marginTop: s * 0.004,
          padding: `${s * 0.006}px ${s * 0.014}px`,
          borderRadius: 999,
          background: `${accent}1f`,
          border: `1px solid ${accent}66`,
          color: accent,
          fontSize: s * 0.016,
          fontWeight: 700,
          letterSpacing: 0.2,
        }}
      >
        {chip}
      </span>
    ) : null}
  </div>
);

export const PtahRoadmap: React.FC<ConceptSceneProps> = ({ slide, durationFrames, locale }) => {
  void locale;
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const s = Math.min(width, height);
  const portrait = height > width;
  const contentW = Math.min(width * 0.9, s * 1.15);

  const { phaseFrames } = usePhases(durationFrames, 4);
  const chatStart = phaseFrames * 0.02;
  const discoveryStart = phaseFrames * 1;
  const roadmapStart = phaseFrames * 2;
  const blockedStart = phaseFrames * 3;

  const appear = (start: number, damping = 20, mass = 0.7) =>
    spring({ frame: frame - start, fps, config: { damping, mass } });

  // Container settle: a quick fade + tiny translateY over ~10 frames, then it
  // holds ROCK-STEADY. No spring overshoot, no ongoing drift — the frame is a
  // stable surface that its inner elements then populate.
  const settle = (start: number) =>
    interpolate(frame, [start, start + 10], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    });

  // Outer cards settle once and hold.
  const chatSettle = settle(chatStart);
  const discoverySettle = settle(discoveryStart);
  const roadmapSettle = settle(roadmapStart);

  // Inner elements get their own staggered entrances INSIDE each stable card.
  const bubble0In = appear(chatStart + 6);
  const bubble1In = appear(chatStart + 16);
  const scanRowIn = appear(discoveryStart + 6);
  const discoveryTextIn = appear(discoveryStart + 12);
  const discoveryBarIn = appear(discoveryStart + 18);
  const titleBarIn = appear(roadmapStart + 6);
  const blockedIn = appear(blockedStart);

  const scan = useBreath(40);
  const blockPulse = useBreath(34);

  const leftW = portrait ? contentW : contentW * 0.42;
  const rightW = portrait ? contentW : contentW * 0.54;

  const chatBlock = (
    <div
      style={{
        width: leftW,
        display: 'flex',
        flexDirection: 'column',
        gap: portrait ? s * 0.02 : s * 0.022,
      }}
    >
      {/* Chat card — user asks, Ptah declines to write code yet. */}
      <div
        style={{
          ...cardStyle(s),
          padding: s * 0.03,
          display: 'flex',
          flexDirection: 'column',
          gap: s * 0.016,
          opacity: chatSettle,
          transform: `translateY(${interpolate(chatSettle, [0, 1], [8, 0])}px)`,
        }}
      >
        <Bubble
          who="You"
          text="Start a new project"
          mine
          accent={THEME.indigo}
          s={s}
          appear={bubble0In}
        />
        <Bubble
          who="Ptah"
          text="Let's plan first."
          mine={false}
          accent={THEME.indigo}
          s={s}
          chip="refuses to write code yet"
          appear={bubble1In}
        />
      </div>

      {/* Discovery-phase indicator. */}
      <div
        style={{
          ...cardStyle(s),
          padding: `${s * 0.018}px ${s * 0.026}px`,
          display: 'flex',
          alignItems: 'center',
          gap: s * 0.018,
          opacity: discoverySettle,
          transform: `translateY(${interpolate(discoverySettle, [0, 1], [8, 0])}px)`,
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: s * 0.008,
            opacity: scanRowIn,
            transform: `translateX(${interpolate(scanRowIn, [0, 1], [-10, 0])}px)`,
          }}
        >
          {[0, 13, 26].map((phase) => (
            <ScanDot key={phase} s={s} phase={phase} />
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: s * 0.002,
            opacity: discoveryTextIn,
            transform: `translateX(${interpolate(discoveryTextIn, [0, 1], [-10, 0])}px)`,
          }}
        >
          <span style={{ fontSize: s * 0.024, fontWeight: 800, color: THEME.textStrong }}>
            Discovery phase
          </span>
          <span style={{ fontSize: s * 0.017, fontWeight: 600, color: THEME.textFaint }}>
            mapping the system before code
          </span>
        </div>
        <div
          style={{
            marginLeft: 'auto',
            width: s * 0.05,
            height: s * 0.012,
            borderRadius: 999,
            background: 'rgba(255,255,255,0.08)',
            overflow: 'hidden',
            opacity: discoveryBarIn,
            transform: `scaleX(${interpolate(discoveryBarIn, [0, 1], [0.6, 1])})`,
            transformOrigin: 'left center',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${30 + scan * 60}%`,
              background: THEME.indigo,
              borderRadius: 999,
            }}
          />
        </div>
      </div>
    </div>
  );

  const roadmapBlock = (
    <div
      style={{
        width: rightW,
        ...cardStyle(s),
        position: 'relative',
        overflow: 'hidden',
        opacity: roadmapSettle,
        transform: `translateY(${interpolate(roadmapSettle, [0, 1], [8, 0])}px)`,
      }}
    >
      {/* Indigo border beam — the roadmap.md card's edge lights up (Ptah/scale). */}
      <BorderBeam colorFrom={THEME.indigo} colorTo={THEME.indigo} />

      {/* File title bar. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: s * 0.012,
          padding: `${s * 0.016}px ${s * 0.026}px`,
          background: 'rgba(255,255,255,0.05)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          opacity: titleBarIn,
          transform: `translateY(${interpolate(titleBarIn, [0, 1], [-8, 0])}px)`,
        }}
      >
        {['#f56', '#fb5', '#5c8'].map((c) => (
          <span
            key={c}
            style={{ width: s * 0.012, height: s * 0.012, borderRadius: 999, background: c, opacity: 0.7 }}
          />
        ))}
        <ShimmerSweep delayFrames={Math.round(roadmapStart)} style={{ marginLeft: s * 0.008 }}>
          <span
            style={{
              fontSize: s * 0.022,
              fontWeight: 800,
              color: THEME.textSoft,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            roadmap.md
          </span>
        </ShimmerSweep>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: s * 0.015,
            fontWeight: 700,
            color: THEME.indigo,
            padding: `${s * 0.005}px ${s * 0.012}px`,
            borderRadius: 999,
            background: `${THEME.indigo}1f`,
            border: `1px solid ${THEME.indigo}55`,
          }}
        >
          generated
        </span>
      </div>

      {/* Phased checklist — boxes tick in sequence. */}
      <div style={{ padding: s * 0.026, display: 'flex', flexDirection: 'column', gap: s * 0.014 }}>
        {PHASES.map((p, i) => {
          const tickStart = roadmapStart + phaseFrames * 0.12 + i * phaseFrames * 0.14;
          const tick = interpolate(frame, [tickStart, tickStart + phaseFrames * 0.12], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.out(Easing.cubic),
          });
          const rowIn = interpolate(frame, [tickStart - phaseFrames * 0.06, tickStart], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          return (
            <div
              key={p.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: s * 0.018,
                opacity: 0.4 + rowIn * 0.6,
                transform: `translateX(${interpolate(rowIn, [0, 1], [-14, 0])}px)`,
              }}
            >
              <Check size={s * 0.034} p={tick} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: s * 0.002 }}>
                <span
                  style={{
                    fontSize: s * 0.024,
                    fontWeight: 700,
                    color: THEME.textStrong,
                  }}
                >
                  {p.label}
                </span>
                <span style={{ fontSize: s * 0.016, fontWeight: 600, color: THEME.textFaint }}>
                  {p.note}
                </span>
              </div>
            </div>
          );
        })}

        {/* Off-roadmap task — blocked. */}
        <div
          style={{
            marginTop: s * 0.006,
            paddingTop: s * 0.016,
            borderTop: '1px dashed rgba(255,255,255,0.12)',
            display: 'flex',
            alignItems: 'center',
            gap: s * 0.018,
            opacity: blockedIn,
            transform: `translateY(${interpolate(blockedIn, [0, 1], [14, 0])}px)`,
          }}
        >
          <div
            style={{
              width: s * 0.034,
              height: s * 0.034,
              flexShrink: 0,
              borderRadius: s * 0.01,
              border: `2px solid ${RED}`,
              background: `${RED}22`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: RED,
              fontSize: s * 0.024,
              fontWeight: 900,
              boxShadow: `0 0 ${s * (0.006 + blockPulse * 0.014)}px ${RED}`,
            }}
          >
            ✕
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: s * 0.003, minWidth: 0 }}>
            <span
              style={{
                fontSize: s * 0.024,
                fontWeight: 700,
                color: THEME.textSoft,
                textDecoration: 'line-through',
                textDecorationColor: `${RED}aa`,
              }}
            >
              Ship checkout page
            </span>
            <span style={{ fontSize: s * 0.017, fontWeight: 800, color: RED }}>
              not on roadmap — won't execute
            </span>
          </div>
        </div>
      </div>
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
          display: 'flex',
          flexDirection: portrait ? 'column' : 'row',
          alignItems: portrait ? 'stretch' : 'center',
          justifyContent: 'center',
          gap: portrait ? s * 0.03 : s * 0.04,
        }}
      >
        {chatBlock}
        {roadmapBlock}
      </div>

      <CaptionRail slide={slide} durationFrames={durationFrames} width={width} />
    </AbsoluteFill>
  );
};
