/**
 * PtahOrchestra — the climax scene: memory + parallel agent orchestra + autonomy.
 *
 * The 3x3 grid of nine subagent tiles is the PERSISTENT CENTERPIECE. It sits
 * dormant while the memory story plays, wakes when a primary agent fans a goal
 * out across it, then keeps "working" (breath-pulsed) for the rest of the hold
 * while the side panel cycles through the autonomy beats. Seven phases, one per
 * caption, each with its own sub-beats so nothing ever freezes:
 *
 *  p1 memory      — hybrid vector search scanning/indexing the codebase
 *  p2 recall      — a note "3 weeks ago: switched auth to JWT" surfaces
 *  p3 goal        — a primary agent node receives a high-level goal
 *  p4 fan-out     — connectors draw, nine model tiles light in sequence, pulse
 *  p5 cron        — a clock schedules nightly jobs while a moon says "you're away"
 *  p6 approve     — a phone approval card: "run: rm cache?" → Approved (green)
 *  p7 close       — "an automated workforce that keeps shipping while you're away"
 *
 * Fully frame-driven / deterministic: no Math.random, no timers, no CSS anim.
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
import { BorderBeam, ShimmerSweep, Particles } from '../components/effects';

// Light-to-core indigo beam — Ptah/scale accent (amber is reserved for Dyad).
const BEAM_FROM = '#8ea2ff';

const CLAMP ={ extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const GREEN = '#34d399';
// Cool moonlight — amber is reserved for Dyad, so "away" reads in pale indigo.
const MOON = '#cdd8ff';

/** Nine subagents, each tagged with a model — the parallel orchestra. */
const MODELS = ['Opus', 'Sonnet', 'Haiku', 'GPT', 'Codex', 'Gemini', 'Grok', 'Kimi', 'GLM'];

/** Deterministic sawtooth 0..1 with an offset — used for looping "work" bars. */
const saw = (frame: number, period: number, offset = 0): number =>
  (((frame + offset) % period) + period) % period / period;

/** Pure breath (0..1) — safe to call inside loops/conditionals (not a hook). */
const breathAt = (frame: number, period: number, phase = 0): number =>
  (Math.sin(((frame + phase) / period) * Math.PI * 2) + 1) / 2;

/** Cross-fade envelope for a panel that owns frame window [a,b]. */
const windowOpacity = (frame: number, a: number, b: number, fade: number, holdEnd = false): number => {
  const inn = interpolate(frame, [a, a + fade], [0, 1], CLAMP);
  const out = holdEnd ? 1 : interpolate(frame, [b - fade, b], [1, 0], CLAMP);
  return Math.min(inn, out);
};

const cardStyle = (S: number): React.CSSProperties => ({
  background: 'rgba(255,255,255,0.045)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: S * 0.03,
  boxShadow: '0 40px 120px rgba(0,0,0,0.55)',
});

// ── Side panel: p1 + p2 — hybrid vector search indexing, then a recalled note ──
const MemoryPanel: React.FC<{ S: number; pf: number }> = ({ S, pf }) => {
  const frame = useCurrentFrame();
  const rows = 6;
  const cells = 9;
  // A scanning highlight sweeps top→bottom continuously across the rows.
  const sweep = saw(frame, pf * 0.55);
  const scanRow = sweep * rows;
  // The recalled note surfaces during phase 2 (idx 1).
  const noteProg = interpolate(frame, [pf * 1.02, pf * 1.02 + pf * 0.5], [0, 1], CLAMP);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S * 0.018, height: '100%' }}>
      <div style={{ fontSize: S * 0.026, fontWeight: 700, color: THEME.indigo, letterSpacing: 0.5 }}>
        HYBRID VECTOR SEARCH
      </div>
      <div style={{ fontSize: S * 0.02, fontWeight: 700, color: THEME.textFaint }}>
        indexing your codebase
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: S * 0.014, marginTop: S * 0.01 }}>
        {Array.from({ length: rows }).map((_, r) => {
          const near = 1 - Math.min(1, Math.abs(scanRow - (r + 0.5)) / 1.1);
          const filled = interpolate(frame, [r * pf * 0.05, r * pf * 0.05 + pf * 0.4], [0, 1], CLAMP);
          return (
            <div key={r} style={{ display: 'flex', alignItems: 'center', gap: S * 0.012 }}>
              <div
                style={{
                  width: S * 0.09,
                  fontSize: S * 0.015,
                  fontWeight: 700,
                  color: near > 0.4 ? THEME.textSoft : THEME.textFaint,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {['auth.ts', 'db.schema', 'router.tsx', 'agent.ts', 'store.ts', 'api.ts'][r]}
              </div>
              <div style={{ display: 'flex', gap: S * 0.006, flex: 1 }}>
                {Array.from({ length: cells }).map((__, c) => {
                  const on = filled > c / cells;
                  const glow = near * (0.5 + 0.5 * Math.sin((frame + c * 6) * 0.3));
                  return (
                    <div
                      key={c}
                      style={{
                        flex: 1,
                        height: S * 0.018,
                        borderRadius: S * 0.004,
                        background: on
                          ? `rgba(79,107,237,${0.35 + near * 0.55})`
                          : 'rgba(255,255,255,0.06)',
                        boxShadow: on && near > 0.5 ? `0 0 ${S * 0.01 * glow}px ${THEME.indigo}` : 'none',
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Recalled note surfacing out of memory into a new session. */}
      <div
        style={{
          marginTop: S * 0.016,
          opacity: noteProg,
          transform: `translateY(${interpolate(noteProg, [0, 1], [S * 0.03, 0])}px)`,
          background: 'rgba(79,107,237,0.12)',
          border: `1px solid rgba(79,107,237,${0.35 * noteProg + 0.15})`,
          borderRadius: S * 0.02,
          padding: S * 0.018,
        }}
      >
        <div style={{ fontSize: S * 0.016, fontWeight: 700, color: THEME.indigo }}>
          RECALLED · 3 weeks ago
        </div>
        <div style={{ fontSize: S * 0.024, fontWeight: 800, color: THEME.textStrong, marginTop: S * 0.006 }}>
          "Switched auth to JWT"
        </div>
        <div style={{ fontSize: S * 0.015, fontWeight: 600, color: THEME.textFaint, marginTop: S * 0.006 }}>
          surfaced into a brand-new session
        </div>
      </div>
    </div>
  );
};

// ── Side panel: p3 + p4 — a primary agent receives a goal, then dispatches ──
const GoalPanel: React.FC<{ S: number; pf: number }> = ({ S, pf }) => {
  const frame = useCurrentFrame();
  const caret = useBreath(20) > 0.5 ? '▍' : ' ';
  const dispatch = interpolate(frame, [pf * 3.0, pf * 3.4], [0, 1], CLAMP);
  const count = Math.round(interpolate(frame, [pf * 3.05, pf * 3.55], [0, 9], CLAMP));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S * 0.018, height: '100%', justifyContent: 'center' }}>
      <div style={{ fontSize: S * 0.026, fontWeight: 700, color: THEME.indigo, letterSpacing: 0.5 }}>
        PRIMARY AGENT
      </div>
      <div
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: S * 0.02,
          padding: S * 0.02,
        }}
      >
        <div style={{ fontSize: S * 0.016, fontWeight: 700, color: THEME.textFaint }}>HIGH-LEVEL GOAL</div>
        <div style={{ fontSize: S * 0.026, fontWeight: 800, color: THEME.textStrong, marginTop: S * 0.008 }}>
          Ship the billing module{caret}
        </div>
      </div>
      <div
        style={{
          opacity: dispatch,
          transform: `translateY(${interpolate(dispatch, [0, 1], [S * 0.02, 0])}px)`,
          display: 'flex',
          alignItems: 'center',
          gap: S * 0.012,
          fontSize: S * 0.022,
          fontWeight: 800,
          color: THEME.indigo,
        }}
      >
        <span>Fanning out →</span>
        <span style={{ color: THEME.textStrong }}>{count} agents</span>
      </div>
    </div>
  );
};

// ── Side panel: p5 — cron schedules nightly work while a moon says "away" ──
const Clock: React.FC<{ S: number }> = ({ S }) => {
  const frame = useCurrentFrame();
  const r = S * 0.05;
  const minute = (frame * 6) % 360;
  const hour = (frame * 0.5) % 360;
  const hand = (deg: number, len: number, w: number, col: string) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return (
      <line
        x1={r}
        y1={r}
        x2={r + Math.cos(rad) * len}
        y2={r + Math.sin(rad) * len}
        stroke={col}
        strokeWidth={w}
        strokeLinecap="round"
      />
    );
  };
  return (
    <svg width={r * 2} height={r * 2} viewBox={`0 0 ${r * 2} ${r * 2}`}>
      <circle cx={r} cy={r} r={r - S * 0.004} fill="rgba(79,107,237,0.1)" stroke="rgba(79,107,237,0.55)" strokeWidth={S * 0.004} />
      {hand(hour, r * 0.5, S * 0.006, THEME.textSoft)}
      {hand(minute, r * 0.72, S * 0.004, THEME.indigo)}
      <circle cx={r} cy={r} r={S * 0.006} fill={THEME.indigo} />
    </svg>
  );
};

const Moon: React.FC<{ S: number; glow: number }> = ({ S, glow }) => {
  const r = S * 0.022;
  return (
    <svg width={r * 2} height={r * 2} viewBox="0 0 24 24" style={{ filter: `drop-shadow(0 0 ${glow * 6}px ${MOON})` }}>
      <path
        d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"
        fill={MOON}
        opacity={0.5 + glow * 0.5}
      />
    </svg>
  );
};

const CronPanel: React.FC<{ S: number; pf: number }> = ({ S, pf }) => {
  const frame = useCurrentFrame();
  const jobs = [
    { name: 'Nightly dependency scan', at: '02:00' },
    { name: 'Security review', at: '03:30' },
  ];
  const glow = useBreath(60);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S * 0.018, height: '100%', justifyContent: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: S * 0.014 }}>
        <Clock S={S} />
        <div>
          <div style={{ fontSize: S * 0.026, fontWeight: 700, color: THEME.indigo }}>SCHEDULED</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: S * 0.008, fontSize: S * 0.016, fontWeight: 700, color: THEME.textFaint }}>
            <Moon S={S} glow={glow} /> while you're away
          </div>
        </div>
      </div>
      {jobs.map((j, i) => {
        const appear = interpolate(frame, [pf * (4.05 + i * 0.12), pf * (4.05 + i * 0.12) + pf * 0.25], [0, 1], CLAMP);
        const pulse = breathAt(frame, 50, i * 25);
        return (
          <div
            key={j.name}
            style={{
              opacity: appear,
              transform: `translateX(${interpolate(appear, [0, 1], [-S * 0.02, 0])}px)`,
              display: 'flex',
              alignItems: 'center',
              gap: S * 0.012,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: S * 0.016,
              padding: S * 0.016,
            }}
          >
            <div
              style={{
                width: S * 0.012,
                height: S * 0.012,
                borderRadius: '50%',
                background: THEME.indigo,
                boxShadow: `0 0 ${S * 0.01 * (0.4 + pulse * 0.6)}px ${THEME.indigo}`,
              }}
            />
            <div style={{ flex: 1, fontSize: S * 0.02, fontWeight: 700, color: THEME.textStrong }}>{j.name}</div>
            <div style={{ fontSize: S * 0.018, fontWeight: 800, color: THEME.indigo, fontVariantNumeric: 'tabular-nums' }}>{j.at}</div>
          </div>
        );
      })}
    </div>
  );
};

// ── Side panel: p6 — phone approval request → Approved (green) ──
const PhonePanel: React.FC<{ S: number; pf: number }> = ({ S, pf }) => {
  const frame = useCurrentFrame();
  const local = interpolate(frame, [pf * 5, pf * 6], [0, 1], CLAMP);
  const approved = local > 0.58;
  const approveProg = interpolate(local, [0.58, 0.72], [0, 1], CLAMP);
  const phoneW = S * 0.2;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          width: phoneW,
          borderRadius: S * 0.03,
          background: 'linear-gradient(180deg,#0b1120,#070b16)',
          border: '2px solid rgba(255,255,255,0.14)',
          boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
          padding: S * 0.014,
        }}
      >
        <div style={{ width: phoneW * 0.28, height: S * 0.006, borderRadius: 999, background: 'rgba(255,255,255,0.2)', margin: `${S * 0.006}px auto ${S * 0.014}px` }} />
        {/* Slack/Discord-style approval card */}
        <div
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: `1px solid ${approved ? GREEN : 'rgba(255,255,255,0.12)'}`,
            borderRadius: S * 0.018,
            padding: S * 0.014,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: S * 0.008, marginBottom: S * 0.01 }}>
            <div style={{ width: S * 0.018, height: S * 0.018, borderRadius: S * 0.005, background: THEME.indigo }} />
            <div style={{ fontSize: S * 0.014, fontWeight: 800, color: THEME.textStrong }}>Ptah Agent</div>
            <div style={{ fontSize: S * 0.012, fontWeight: 600, color: THEME.textFaint }}>· now</div>
          </div>
          <div style={{ fontSize: S * 0.015, fontWeight: 600, color: THEME.textSoft }}>Wants to run:</div>
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: S * 0.016,
              fontWeight: 700,
              color: approved ? GREEN : THEME.textStrong,
              background: 'rgba(0,0,0,0.3)',
              borderRadius: S * 0.008,
              padding: `${S * 0.006}px ${S * 0.01}px`,
              margin: `${S * 0.008}px 0`,
            }}
          >
            rm -rf cache
          </div>

          {approved ? (
            <div
              style={{
                opacity: approveProg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: S * 0.008,
                background: 'rgba(52,211,153,0.16)',
                borderRadius: S * 0.01,
                padding: S * 0.01,
                fontSize: S * 0.017,
                fontWeight: 800,
                color: GREEN,
              }}
            >
              <svg width={S * 0.02} height={S * 0.02} viewBox="0 0 24 24">
                <path d="M20 6 9 17l-5-5" fill="none" stroke={GREEN} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={30} strokeDashoffset={30 - approveProg * 30} />
              </svg>
              Approved
            </div>
          ) : (
            <div style={{ display: 'flex', gap: S * 0.008 }}>
              <div style={{ flex: 1, textAlign: 'center', background: GREEN, color: '#052e1c', borderRadius: S * 0.01, padding: S * 0.008, fontSize: S * 0.015, fontWeight: 800 }}>
                Approve
              </div>
              <div style={{ flex: 1, textAlign: 'center', background: 'rgba(255,255,255,0.08)', color: THEME.textSoft, borderRadius: S * 0.01, padding: S * 0.008, fontSize: S * 0.015, fontWeight: 800 }}>
                Deny
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── The persistent centerpiece: primary node + fan-out connectors + 3x3 grid ──
const Orchestra: React.FC<{ S: number; pf: number; gridPx: number }> = ({ S, pf, gridPx }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const gap = gridPx * 0.05;
  const tile = (gridPx - gap * 2) / 3;
  const nodeZone = gridPx * 0.24;
  const colH = nodeZone + gridPx;

  // Wake sequence: node appears at p3, connectors + tiles light through p4.
  const nodeEnter = spring({ frame: frame - pf * 2, fps, config: { damping: 20, mass: 0.7 } });
  const nodePulse = useBreath(70);

  const centers = MODELS.map((_, i) => {
    const c = i % 3;
    const r = Math.floor(i / 3);
    return {
      x: c * (tile + gap) + tile / 2,
      y: nodeZone + r * (tile + gap) + tile / 2,
    };
  });
  const nodeX = gridPx / 2;
  const nodeY = nodeZone * 0.55;

  return (
    <div style={{ position: 'relative', width: gridPx, height: colH }}>
      {/* Fan-out connectors (draw with normalized dashoffset, then flow). */}
      <svg width={gridPx} height={colH} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        {centers.map((p, i) => {
          const drawStart = pf * 2.55 + i * pf * 0.05;
          const draw = interpolate(frame, [drawStart, drawStart + pf * 0.45], [0, 1], CLAMP);
          const flow = -saw(frame, pf * 0.5, i * 12);
          return (
            <g key={i}>
              <line
                x1={nodeX} y1={nodeY} x2={p.x} y2={p.y}
                stroke="rgba(79,107,237,0.5)" strokeWidth={S * 0.003}
                pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw}
              />
              <line
                x1={nodeX} y1={nodeY} x2={p.x} y2={p.y}
                stroke={THEME.indigo} strokeWidth={S * 0.004} strokeLinecap="round"
                pathLength={1} strokeDasharray="0.05 0.16" strokeDashoffset={flow}
                opacity={draw * 0.9}
              />
            </g>
          );
        })}
      </svg>

      {/* Primary agent node. */}
      <div
        style={{
          position: 'absolute',
          left: nodeX,
          top: nodeY,
          transform: `translate(-50%,-50%) scale(${0.6 + nodeEnter * 0.4})`,
          opacity: nodeEnter,
          width: gridPx * 0.28,
          textAlign: 'center',
          padding: `${S * 0.008}px 0`,
          background: 'rgba(79,107,237,0.18)',
          border: `1px solid rgba(79,107,237,${0.5 + nodePulse * 0.4})`,
          borderRadius: S * 0.016,
          boxShadow: `0 0 ${S * 0.02 * nodePulse}px ${THEME.indigo}`,
          fontSize: S * 0.018,
          fontWeight: 800,
          color: THEME.textStrong,
          zIndex: 2,
        }}
      >
        Primary Agent
      </div>

      {/* 3x3 subagent grid — dormant, then lit + pulsing in parallel. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: nodeZone,
          width: gridPx,
          height: gridPx,
          display: 'grid',
          gridTemplateColumns: 'repeat(3,1fr)',
          gridTemplateRows: 'repeat(3,1fr)',
          gap,
        }}
      >
        {MODELS.map((m, i) => {
          const activeFrom = pf * 3.0 + i * pf * 0.07;
          const active = spring({ frame: frame - activeFrom, fps, config: { damping: 16, mass: 0.6 } });
          const pulse = breathAt(frame, 48, i * 11);
          const work = saw(frame, pf * 0.6, i * 20);
          const lit = active;
          return (
            <div
              key={m}
              style={{
                position: 'relative',
                borderRadius: S * 0.016,
                background: lit > 0.1 ? `rgba(79,107,237,${0.08 + lit * 0.12})` : 'rgba(255,255,255,0.035)',
                border: `1px solid rgba(79,107,237,${0.12 + lit * (0.35 + pulse * 0.35)})`,
                boxShadow: lit > 0.5 ? `0 0 ${S * 0.014 * pulse * lit}px rgba(79,107,237,0.7)` : 'none',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: tile * 0.12,
                overflow: 'hidden',
                opacity: 0.4 + lit * 0.6,
                transform: `scale(${0.9 + lit * 0.1})`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: tile * 0.06 }}>
                <div
                  style={{
                    width: tile * 0.09,
                    height: tile * 0.09,
                    borderRadius: '50%',
                    background: lit > 0.5 ? THEME.indigo : 'rgba(255,255,255,0.25)',
                    boxShadow: lit > 0.5 ? `0 0 ${S * 0.008 * pulse}px ${THEME.indigo}` : 'none',
                  }}
                />
                <div style={{ fontSize: tile * 0.15, fontWeight: 800, color: lit > 0.4 ? THEME.textStrong : THEME.textFaint }}>{m}</div>
              </div>
              {/* Looping "working" bar. */}
              <div style={{ height: tile * 0.07, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${lit > 0.4 ? 20 + work * 80 : 0}%`,
                    background: `linear-gradient(90deg, ${THEME.indigo}, rgba(79,107,237,0.5))`,
                    borderRadius: 999,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const PtahOrchestra: React.FC<ConceptSceneProps> = ({ slide, durationFrames, locale }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const S = Math.min(width, height);
  const portrait = height > width;
  const contentW = Math.min(width * 0.9, S * 1.15);

  const { phaseFrames: pf } = usePhases(durationFrames, 7);
  // The panel is a STABLE stage: it settles in fast (~10 frames, opacity + a
  // tiny lift) and then holds rock-steady for the whole (long) scene. No drift,
  // no breath, no whole-card spring — every bit of motion lives INSIDE it.
  const containerIn = interpolate(frame, [0, 10], [0, 1], CLAMP);

  const gridPx = portrait ? Math.min(contentW * 0.8, S * 0.62) : S * 0.46;
  const fade = pf * 0.16;

  // Side-panel cross-fade windows (frame ranges) by phase.
  const memO = windowOpacity(frame, 0, pf * 2, fade);
  const goalO = windowOpacity(frame, pf * 2, pf * 4, fade);
  const cronO = windowOpacity(frame, pf * 4, pf * 5, fade);
  const phoneO = windowOpacity(frame, pf * 5, pf * 6, fade);

  // Closing overlay (p7) dims the orchestra and states the thesis.
  const closeO = windowOpacity(frame, pf * 6, durationFrames, fade, true);

  const panelH = portrait ? S * 0.4 : gridPx + gridPx * 0.24;

  const sidePanel = (
    <div style={{ position: 'relative', flex: portrait ? 'none' : '1 1 0', width: portrait ? gridPx : 'auto', minWidth: 0, height: panelH }}>
      <div style={{ position: 'absolute', inset: 0, opacity: memO, pointerEvents: 'none' }}>
        <MemoryPanel S={S} pf={pf} />
      </div>
      <div style={{ position: 'absolute', inset: 0, opacity: goalO, pointerEvents: 'none' }}>
        <GoalPanel S={S} pf={pf} />
      </div>
      <div style={{ position: 'absolute', inset: 0, opacity: cronO, pointerEvents: 'none' }}>
        <CronPanel S={S} pf={pf} />
      </div>
      <div style={{ position: 'absolute', inset: 0, opacity: phoneO, pointerEvents: 'none' }}>
        <PhonePanel S={S} pf={pf} />
      </div>
    </div>
  );

  const center = <Orchestra S={S} pf={pf} gridPx={gridPx} />;

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
          ...cardStyle(S),
          width: contentW,
          padding: S * 0.04,
          opacity: containerIn,
          transform: `translateY(${interpolate(containerIn, [0, 1], [8, 0])}px)`,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Subtle indigo particle haze behind the orchestra — keeps it "alive". */}
        <Particles count={12} seed={7} color={THEME.indigo} opacity={0.05} />

        {/* Indigo border beam — the panel border "lights up" travelling. */}
        <BorderBeam durationMs={4600} thickness={2} colorFrom={BEAM_FROM} colorTo={THEME.indigo} />

        {/* Header: title + away status. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: S * 0.028, position: 'relative' }}>
          <ShimmerSweep delayFrames={10} durationFrames={28}>
            <div style={{ fontSize: S * 0.036, fontWeight: 800, color: THEME.textStrong }}>Ptah Orchestra</div>
          </ShimmerSweep>
          <div style={{ display: 'flex', alignItems: 'center', gap: S * 0.01, fontSize: S * 0.02, fontWeight: 700, color: THEME.textFaint }}>
            <Moon S={S} glow={frame > pf * 4 ? breathAt(frame, 60) : 0.15} />
            {frame > pf * 4 ? 'away' : 'active'}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: portrait ? 'column' : 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: S * 0.04,
            position: 'relative',
          }}
        >
          {portrait ? (
            <>
              {center}
              {sidePanel}
            </>
          ) : (
            <>
              {sidePanel}
              {center}
            </>
          )}
        </div>

        {/* Closing thesis overlay. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: S * 0.06,
            textAlign: 'center',
            background: `rgba(5,6,12,${closeO * 0.72})`,
            borderRadius: S * 0.03,
            opacity: closeO,
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: S * 0.04, fontWeight: 800, lineHeight: 1.3, color: THEME.textStrong }}>
            An <span style={{ color: THEME.indigo }}>automated workforce</span> that keeps
            <br />
            shipping while you're away.
          </div>
        </div>
      </div>

      <CaptionRail slide={slide} durationFrames={durationFrames} width={width} />
    </AbsoluteFill>
  );
};
