/**
 * Philosophy — two opposed philosophies you must choose between.
 *
 * p1: the title "Two opposed philosophies" settles in. p2: the left column —
 * "Visual momentum" (amber) — fills with small iteration dots pulsing quickly,
 * the feel of rapid vibe-coding. p3: the right column — "Engineering discipline"
 * (indigo) — stacks neat structured blocks bottom-up, the feel of deliberate
 * architecture. p4: a horizontal trade-off slider labelled Speed ↔ Rigor whose
 * handle is FORCED to pick — it swings to one end or the other and can never
 * rest in the middle, where a red "not both" marker flashes; a row of
 * bring-your-own-model chips sits beneath it.
 *
 * Semantic color: momentum / speed = amber, discipline / rigor = indigo, the
 * impossible middle = red. Fully frame-driven and deterministic.
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

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const RED = '#ef4444';

const COL_BG = 'rgba(255,255,255,0.045)';
const COL_BORDER = '1px solid rgba(255,255,255,0.1)';

const ColumnShell: React.FC<{
  S: number;
  accent: string;
  /** Quick container settle (0..1) — the column is a STABLE frame; content animates inside. */
  enter: number;
  /** Inner title-row entrance (0..1), staggered just after the frame settles. */
  headEnter: number;
  title: string;
  children: React.ReactNode;
}> = ({ S, accent, enter, headEnter, title, children }) => (
  <div
    style={{
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: S * 0.018,
      // Container: quick fade + a tiny one-time settle, then held rock-steady.
      opacity: enter,
      transform: `translateY(${interpolate(enter, [0, 1], [8, 0], {
        easing: Easing.out(Easing.cubic),
      })}px)`,
      background: COL_BG,
      border: COL_BORDER,
      borderRadius: S * 0.03,
      boxShadow: '0 40px 120px rgba(0,0,0,0.55)',
      padding: S * 0.04,
      position: 'relative',
      overflow: 'hidden',
    }}
  >
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: S * 0.012,
        opacity: headEnter,
        transform: `translateY(${interpolate(headEnter, [0, 1], [10, 0], {
          easing: Easing.out(Easing.cubic),
        })}px)`,
      }}
    >
      <span style={{ width: S * 0.014, height: S * 0.014, borderRadius: 999, background: accent }} />
      <span style={{ fontSize: S * 0.026, fontWeight: 700, color: accent }}>{title}</span>
    </div>
    {children}
    {/* accent border beam — column edge lights up in its own philosophy color */}
    <BorderBeam thickness={1} colorFrom={accent} colorTo={accent} />
  </div>
);

/** Fast, loose iteration dots — the amber "visual momentum" feel. */
const MomentumDots: React.FC<{
  S: number;
  accent: string;
  accentDeep: string;
  startFrame: number;
}> = ({ S, accent, accentDeep, startFrame }) => {
  const frame = useCurrentFrame();
  const boxH = S * 0.16;
  const dots = [
    { x: 0.14, y: 0.28, o: 0 },
    { x: 0.32, y: 0.62, o: 7 },
    { x: 0.27, y: 0.14, o: 13 },
    { x: 0.48, y: 0.4, o: 4 },
    { x: 0.6, y: 0.72, o: 10 },
    { x: 0.7, y: 0.24, o: 2 },
    { x: 0.83, y: 0.55, o: 15 },
    { x: 0.45, y: 0.84, o: 9 },
    { x: 0.9, y: 0.82, o: 5 },
  ];
  return (
    <div style={{ position: 'relative', height: boxH }}>
      {dots.map((d, i) => {
        // Each dot pops in on its own beat inside the steady column...
        const appear = interpolate(
          frame,
          [startFrame + i * 4, startFrame + i * 4 + 8],
          [0, 1],
          CLAMP,
        );
        // ...then keeps its fast pulse (short period) — rapid iteration cadence.
        const pulse = (Math.sin(((frame + d.o) / 20) * Math.PI * 2) + 1) / 2;
        const r = S * 0.009 + pulse * S * 0.007;
        return (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: `${d.x * 100}%`,
              top: `${d.y * 100}%`,
              width: r,
              height: r,
              marginLeft: -r / 2,
              marginTop: -r / 2,
              borderRadius: 999,
              background: `radial-gradient(circle, ${accent}, ${accentDeep})`,
              opacity: appear * (0.4 + pulse * 0.6),
              transform: `scale(${appear})`,
              boxShadow: `0 0 ${S * 0.012 * pulse}px ${accent}`,
            }}
          />
        );
      })}
    </div>
  );
};

/** Neat blocks stacking bottom-up — the indigo "engineering discipline" feel. */
const DisciplineBlocks: React.FC<{
  S: number;
  accent: string;
  startFrame: number;
  phaseFrames: number;
}> = ({ S, accent, startFrame, phaseFrames }) => {
  const frame = useCurrentFrame();
  const rows = 4;
  const cols = 3;
  const boxH = S * 0.16;
  const gap = S * 0.008;
  const brickH = (boxH - gap * (rows - 1)) / rows;
  const breath = useBreath(120);

  return (
    <div
      style={{
        height: boxH,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        gap,
      }}
    >
      {Array.from({ length: rows }).map((_, rowFromTop) => {
        // Bottom row lands first: rowFromBottom 0 is the base.
        const rowFromBottom = rows - 1 - rowFromTop;
        const appearAt = startFrame + phaseFrames * 0.08 + rowFromBottom * phaseFrames * 0.16;
        const appear = interpolate(frame, [appearAt, appearAt + phaseFrames * 0.14], [0, 1], CLAMP);
        const settle = interpolate(breath, [0, 1], [-1, 1]) * (rowFromBottom + 1) * 0.3;
        return (
          <div key={rowFromTop} style={{ display: 'flex', gap, height: brickH }}>
            {Array.from({ length: cols }).map((__, c) => (
              <div
                key={c}
                style={{
                  flex: 1,
                  borderRadius: S * 0.006,
                  background: `linear-gradient(180deg, ${accent}, ${accent}88)`,
                  border: `1px solid ${accent}55`,
                  opacity: appear,
                  transform: `translateY(${interpolate(appear, [0, 1], [10, settle])}px)`,
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
};

/** The Speed ↔ Rigor trade-off; the handle is forced to one end at a time. */
const TradeoffSlider: React.FC<{ S: number; enter: number; startFrame: number }> = ({
  S,
  enter,
  startFrame,
}) => {
  const frame = useCurrentFrame();
  // Swing pushed toward the extremes so it dwells at ends, transits fast.
  const swing = Math.sin(((frame - startFrame) / 44) * Math.PI * 2);
  const eased = Math.sign(swing) * Math.pow(Math.abs(swing), 0.35); // -1..1, end-biased
  const handlePct = interpolate(eased, [-1, 1], [4, 96]);
  const centerNear = 1 - Math.min(1, Math.abs(eased) / 0.4); // 1 when crossing middle
  const trackH = S * 0.02;
  const knob = S * 0.05;

  return (
    <div
      style={{
        // Small inner settle only — the outer slider block is the steady frame.
        transform: `translateY(${interpolate(enter, [0, 1], [10, 0])}px)`,
        display: 'flex',
        flexDirection: 'column',
        gap: S * 0.016,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: S * 0.028, fontWeight: 800, color: THEME.amber }}>Speed</span>
        <span style={{ fontSize: S * 0.03, fontWeight: 700, color: THEME.textFaint }}>↔</span>
        <span style={{ fontSize: S * 0.028, fontWeight: 800, color: THEME.indigo }}>Rigor</span>
      </div>
      <div
        style={{
          position: 'relative',
          height: knob,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {/* Track */}
        <div
          style={{
            width: '100%',
            height: trackH,
            borderRadius: 999,
            background: `linear-gradient(90deg, ${THEME.amber}66, rgba(255,255,255,0.08), ${THEME.indigo}66)`,
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        />
        {/* Forbidden middle marker */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: knob * 0.72,
            height: knob * 0.72,
            marginLeft: -(knob * 0.36),
            marginTop: -(knob * 0.36),
            borderRadius: 999,
            border: `2px solid ${RED}`,
            background: `${RED}22`,
            opacity: 0.35 + centerNear * 0.65,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              width: '58%',
              height: 2,
              background: RED,
              transform: 'rotate(45deg)',
              boxShadow: `0 0 ${S * 0.01 * centerNear}px ${RED}`,
            }}
          />
        </div>
        {/* Handle */}
        <div
          style={{
            position: 'absolute',
            left: `${handlePct}%`,
            top: '50%',
            width: knob,
            height: knob,
            marginLeft: -(knob / 2),
            marginTop: -(knob / 2),
            borderRadius: 999,
            background: eased < 0 ? THEME.amber : THEME.indigo,
            border: '2px solid rgba(255,255,255,0.85)',
            boxShadow: `0 0 ${S * 0.02}px ${eased < 0 ? THEME.amber : THEME.indigo}`,
            zIndex: 2,
          }}
        />
      </div>
    </div>
  );
};

/** Bring-your-own-model chips — both tools take the same providers. */
const ModelChips: React.FC<{ S: number; startFrame: number }> = ({ S, startFrame }) => {
  const frame = useCurrentFrame();
  const chips = ['Anthropic', 'OpenAI'];
  const labelEnter = interpolate(frame, [startFrame, startFrame + 8], [0, 1], CLAMP);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: S * 0.012,
      }}
    >
      <span
        style={{
          fontSize: S * 0.02,
          fontWeight: 700,
          color: THEME.textFaint,
          opacity: labelEnter,
          transform: `translateY(${interpolate(labelEnter, [0, 1], [10, 0])}px)`,
        }}
      >
        Bring your own model
      </span>
      {chips.map((c, i) => {
        // Each provider chip pops in on its own beat inside the steady block.
        const chipEnter = interpolate(
          frame,
          [startFrame + 6 + i * 6, startFrame + 6 + i * 6 + 8],
          [0, 1],
          CLAMP,
        );
        return (
          <span
            key={c}
            style={{
              opacity: chipEnter,
              transform: `translateY(${interpolate(chipEnter, [0, 1], [12, 0], {
                easing: Easing.out(Easing.cubic),
              })}px) scale(${interpolate(chipEnter, [0, 1], [0.9, 1])})`,
              padding: `${S * 0.006}px ${S * 0.016}px`,
              borderRadius: 999,
              fontSize: S * 0.02,
              fontWeight: 700,
              color: THEME.textStrong,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.14)',
              whiteSpace: 'nowrap',
            }}
          >
            {c}
          </span>
        );
      })}
    </div>
  );
};

export const Philosophy: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const S = Math.min(width, height);
  const portrait = height > width;
  const contentW = Math.min(width * 0.9, S * 1.15);

  const { phaseFrames } = usePhases(durationFrames, 4);
  const p = (i: number) => phaseFrames * i;
  const rise = (start: number) =>
    spring({ frame: frame - start, fps, config: { damping: 20, mass: 0.7 } });

  // Container frames settle in QUICKLY (opacity + a tiny one-time translateY) at
  // their beat, then hold ROCK-STEADY — no drift/breath/scale on the whole frame.
  const settleAt = (start: number, dur = 10) => interpolate(frame, [start, start + dur], [0, 1], CLAMP);

  const titleSettle = settleAt(p(0) + phaseFrames * 0.05);
  const leftSettle = settleAt(p(1));
  const rightSettle = settleAt(p(2));
  const sliderSettle = settleAt(p(3));

  // Inner-element staggered entrances that populate INSIDE the steady frames.
  const leftHeadEnter = rise(p(1) + phaseFrames * 0.06);
  const rightHeadEnter = rise(p(2) + phaseFrames * 0.06);
  const sliderInner = rise(p(3) + 6);

  const titlePulse = useBreath(90);

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: THEME.font,
        flexDirection: 'column',
        gap: S * 0.03,
      }}
    >
      <div
        style={{
          width: contentW,
          display: 'flex',
          flexDirection: 'column',
          gap: S * 0.03,
        }}
      >
        {/* Title — a stable container: quick settle, then held steady. */}
        <div
          style={{
            opacity: titleSettle,
            transform: `translateY(${interpolate(titleSettle, [0, 1], [8, 0], {
              easing: Easing.out(Easing.cubic),
            })}px)`,
            textAlign: 'center',
          }}
        >
          <ShimmerSweep delayFrames={phaseFrames * 0.05}>
            <div
              style={{
                fontSize: S * 0.05,
                fontWeight: 800,
                color: THEME.textStrong,
                letterSpacing: -0.5,
              }}
            >
              Two opposed philosophies
            </div>
          </ShimmerSweep>
          <div
            style={{
              marginTop: S * 0.012,
              height: 3,
              width: interpolate(titlePulse, [0, 1], [S * 0.12, S * 0.18]),
              marginInline: 'auto',
              borderRadius: 999,
              background: `linear-gradient(90deg, ${THEME.amber}, ${THEME.indigo})`,
            }}
          />
        </div>

        {/* Two columns */}
        <div
          style={{
            display: 'flex',
            flexDirection: portrait ? 'column' : 'row',
            gap: S * 0.03,
          }}
        >
          <ColumnShell
            S={S}
            accent={THEME.amber}
            enter={leftSettle}
            headEnter={leftHeadEnter}
            title="Visual momentum"
          >
            <MomentumDots
              S={S}
              accent={THEME.amber}
              accentDeep={THEME.amberDeep}
              startFrame={p(1) + phaseFrames * 0.14}
            />
          </ColumnShell>
          <ColumnShell
            S={S}
            accent={THEME.indigo}
            enter={rightSettle}
            headEnter={rightHeadEnter}
            title="Engineering discipline"
          >
            <DisciplineBlocks
              S={S}
              accent={THEME.indigo}
              startFrame={p(2)}
              phaseFrames={phaseFrames}
            />
          </ColumnShell>
        </div>

        {/* Trade-off slider + BYO chips (p4) */}
        <div
          style={{
            background: COL_BG,
            border: COL_BORDER,
            borderRadius: S * 0.03,
            boxShadow: '0 40px 120px rgba(0,0,0,0.55)',
            padding: S * 0.04,
            display: 'flex',
            flexDirection: 'column',
            gap: S * 0.026,
            // Stable frame: quick settle, then steady while the slider/chips animate inside.
            opacity: sliderSettle,
            transform: `translateY(${interpolate(sliderSettle, [0, 1], [8, 0])}px)`,
          }}
        >
          <TradeoffSlider S={S} enter={sliderInner} startFrame={p(3)} />
          <ModelChips S={S} startFrame={p(3) + phaseFrames * 0.22} />
        </div>
      </div>

      <CaptionRail slide={slide} durationFrames={durationFrames} width={width} />
    </AbsoluteFill>
  );
};
