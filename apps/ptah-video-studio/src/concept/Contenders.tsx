/**
 * Contenders — the two tools introduced as opposites, in one split composition.
 *
 * A LEFT (Dyad, amber) and RIGHT (Ptah, indigo) card face off across a central
 * "VS" badge. Dyad reveals first (p1) as an open-source, local-first builder,
 * then its little mock window "publishes instantly" (p2). Ptah reveals second
 * (p3) as an AI coding orchestra — a repository being indexed by a sweeping
 * scan line, coordinated agent nodes below it. Finally (p4) both are held while
 * contrast pills ("quick chat window" vs "technical co-founder") settle in and
 * the divider glow between them intensifies.
 *
 * Semantic color: Dyad / speed = amber, Ptah / scale = indigo. Everything is
 * frame-driven off useCurrentFrame — no timers, no CSS animation, deterministic.
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

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const CARD_BG = 'rgba(255,255,255,0.045)';
const CARD_BORDER = '1px solid rgba(255,255,255,0.1)';
const CARD_SHADOW = '0 40px 120px rgba(0,0,0,0.55)';

/** A small inline lightning bolt — Dyad's "instant" glyph. */
const Bolt: React.FC<{ size: number; color: string; glow: number }> = ({
  size,
  color,
  glow,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    style={{ filter: `drop-shadow(0 0 ${size * 0.28 * glow}px ${color})` }}
  >
    <polygon points="13,2 5,13 11,13 9,22 19,10 12,10" fill={color} />
  </svg>
);

/** Dyad's mock builder window that fills a publish bar and flips to "Live". */
const PublishWindow: React.FC<{
  S: number;
  accent: string;
  accentDeep: string;
  publishStart: number;
  publishEnd: number;
  badgeStart: number;
  /** Inner-element entrance (0..1) — the window itself settles into the steady card. */
  enter: number;
}> = ({ S, accent, accentDeep, publishStart, publishEnd, badgeStart, enter }) => {
  const frame = useCurrentFrame();
  const publish = interpolate(frame, [publishStart, publishEnd], [0, 1], CLAMP);
  const badge = interpolate(
    frame,
    [badgeStart, badgeStart + (publishEnd - publishStart) * 0.4],
    [0, 1],
    CLAMP,
  );
  const dot = S * 0.011;
  const lines = [0.82, 0.55, 0.68];

  return (
    <div
      style={{
        opacity: enter,
        transform: `translateY(${interpolate(enter, [0, 1], [12, 0], {
          easing: Easing.out(Easing.cubic),
        })}px)`,
        borderRadius: S * 0.018,
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.09)',
        overflow: 'hidden',
      }}
    >
      {/* Title bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: dot,
          padding: `${S * 0.012}px ${S * 0.016}px`,
          background: 'rgba(255,255,255,0.04)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <span style={{ width: dot, height: dot, borderRadius: 999, background: '#ef4444aa' }} />
        <span style={{ width: dot, height: dot, borderRadius: 999, background: `${accent}cc` }} />
        <span style={{ width: dot, height: dot, borderRadius: 999, background: '#22c55eaa' }} />
        <span
          style={{
            marginInlineStart: S * 0.012,
            flex: 1,
            height: dot * 1.4,
            borderRadius: 999,
            background: 'rgba(255,255,255,0.07)',
          }}
        />
      </div>
      {/* Body: placeholder blocks */}
      <div style={{ padding: S * 0.016, display: 'flex', flexDirection: 'column', gap: S * 0.01 }}>
        {lines.map((w, i) => (
          <span
            key={i}
            style={{
              width: `${w * 100}%`,
              height: S * 0.012,
              borderRadius: 999,
              background: 'rgba(255,255,255,0.09)',
            }}
          />
        ))}
      </div>
      {/* Footer: publish progress + Live badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: S * 0.014,
          padding: `${S * 0.012}px ${S * 0.016}px ${S * 0.016}px`,
        }}
      >
        <div
          style={{
            flex: 1,
            height: S * 0.014,
            borderRadius: 999,
            background: 'rgba(255,255,255,0.08)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${publish * 100}%`,
              height: '100%',
              borderRadius: 999,
              background: `linear-gradient(90deg, ${accent}, ${accentDeep})`,
            }}
          />
        </div>
        <span
          style={{
            opacity: badge,
            transform: `perspective(${S * 0.3}px) rotateX(${interpolate(
              badge,
              [0, 1],
              [90, 0],
            )}deg)`,
            transformOrigin: 'center',
            display: 'inline-flex',
            alignItems: 'center',
            gap: S * 0.006,
            padding: `${S * 0.006}px ${S * 0.012}px`,
            borderRadius: 999,
            fontSize: S * 0.016,
            fontWeight: 800,
            color: '#0a0f1e',
            background: `linear-gradient(90deg, ${accent}, ${accentDeep})`,
            whiteSpace: 'nowrap',
          }}
        >
          Live
        </span>
      </div>
    </div>
  );
};

/** Ptah's repo being indexed by a vertical scan line, plus agent nodes. */
const RepoIndex: React.FC<{ S: number; accent: string; nodesStart: number }> = ({
  S,
  accent,
  nodesStart,
}) => {
  const frame = useCurrentFrame();
  const bodyH = S * 0.15;
  const pad = S * 0.016;
  const scanB = useBreath(80);
  const scanY = interpolate(scanB, [0, 1], [pad, bodyH - pad]);
  const codeLines = [0.9, 0.62, 0.8, 0.48, 0.72, 0.58];
  const rowGap = (bodyH - pad * 2) / codeLines.length;
  const nodes = [0, 1, 2];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S * 0.014 }}>
      {/* Repo panel */}
      <div
        style={{
          position: 'relative',
          height: bodyH,
          borderRadius: S * 0.018,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.09)',
          overflow: 'hidden',
        }}
      >
        {codeLines.map((w, i) => {
          const y = pad + i * rowGap + rowGap * 0.5;
          const near = 1 - Math.min(1, Math.abs(y - scanY) / (rowGap * 1.2));
          return (
            <span
              key={i}
              style={{
                position: 'absolute',
                insetInlineStart: pad,
                top: y - S * 0.006,
                width: `${w * 62}%`,
                height: S * 0.012,
                borderRadius: 999,
                background: `rgba(255,255,255,${0.12 + near * 0.5})`,
                boxShadow: near > 0.4 ? `0 0 ${S * 0.02 * near}px ${accent}` : 'none',
              }}
            />
          );
        })}
        {/* Scan line */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: scanY,
            height: S * 0.004,
            background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
            boxShadow: `0 0 ${S * 0.02}px ${accent}`,
          }}
        />
      </div>
      {/* Coordinated agent nodes (the "orchestra") */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `0 ${S * 0.02}px`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: S * 0.03,
            right: S * 0.03,
            top: '50%',
            height: 1,
            background: 'rgba(255,255,255,0.12)',
          }}
        />
        {nodes.map((n) => {
          // Each agent node pops in on its own beat, then keeps its living pulse.
          const appear = interpolate(
            frame,
            [nodesStart + n * 7, nodesStart + n * 7 + 10],
            [0, 1],
            CLAMP,
          );
          const pulse = (Math.sin(((frame + n * 15) / 46) * Math.PI * 2) + 1) / 2;
          const d = S * 0.018 + pulse * S * 0.006;
          return (
            <span
              key={n}
              style={{
                position: 'relative',
                width: d,
                height: d,
                borderRadius: 999,
                background: accent,
                opacity: appear,
                transform: `scale(${appear})`,
                boxShadow: `0 0 ${S * 0.014 * (0.4 + pulse * 0.6)}px ${accent}`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

/** Small pill under a card giving the p4 "chat window vs co-founder" contrast. */
const ContrastPill: React.FC<{ S: number; accent: string; enter: number; label: string }> = ({
  S,
  accent,
  enter,
  label,
}) => (
  <div
    style={{
      opacity: enter,
      transform: `translateY(${interpolate(enter, [0, 1], [14, 0], {
        easing: Easing.out(Easing.cubic),
      })}px)`,
      alignSelf: 'flex-start',
      display: 'inline-flex',
      alignItems: 'center',
      gap: S * 0.008,
      padding: `${S * 0.008}px ${S * 0.016}px`,
      borderRadius: 999,
      fontSize: S * 0.02,
      fontWeight: 700,
      color: THEME.textStrong,
      background: `${accent}22`,
      border: `1px solid ${accent}66`,
      whiteSpace: 'nowrap',
    }}
  >
    <span style={{ width: S * 0.008, height: S * 0.008, borderRadius: 999, background: accent }} />
    {label}
  </div>
);

const Card: React.FC<{
  S: number;
  width: number;
  accent: string;
  /** Container opacity only — the card is a STABLE frame; content animates inside it. */
  opacity: number;
  /** Tiny one-time settle offset (px) applied at the very start, then held rock-steady. */
  translateY: number;
  header: React.ReactNode;
  children: React.ReactNode;
  /** Optional low-opacity background layer (e.g. Meteors), clipped behind content. */
  backdrop?: React.ReactNode;
}> = ({ S, width, accent, opacity, translateY, header, children, backdrop }) => (
  <div
    style={{
      width,
      display: 'flex',
      flexDirection: 'column',
      gap: S * 0.02,
      opacity,
      transform: `translateY(${translateY}px)`,
      background: CARD_BG,
      border: CARD_BORDER,
      borderRadius: S * 0.03,
      boxShadow: CARD_SHADOW,
      padding: S * 0.04,
      position: 'relative',
      overflow: 'hidden',
    }}
  >
    {backdrop ? (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          borderRadius: 'inherit',
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        {backdrop}
      </div>
    ) : null}
    <div
      style={{
        position: 'absolute',
        insetInlineStart: 0,
        top: 0,
        bottom: 0,
        width: S * 0.008,
        background: `linear-gradient(180deg, ${accent}, ${accent}55)`,
      }}
    />
    {/* content sits above the backdrop; the border beam masks to the edge on top */}
    <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: S * 0.02 }}>
      {header}
      {children}
    </div>
    <BorderBeam thickness={1} colorFrom={accent} colorTo={accent} />
  </div>
);

export const Contenders: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const S = Math.min(width, height);
  const portrait = height > width;
  const contentW = Math.min(width * 0.9, S * 1.15);

  const { phaseFrames } = usePhases(durationFrames, 4);
  const p = (i: number) => phaseFrames * i;
  const rise = (start: number, damping = 20) =>
    spring({ frame: frame - start, fps, config: { damping, mass: 0.7 } });

  // Inner-element entrance style: a small staggered fade + tiny lift, so content
  // populates INSIDE the steady card frame instead of the frame itself moving.
  const enterStyle = (e: number, dy = 12): React.CSSProperties => ({
    opacity: e,
    transform: `translateY(${interpolate(e, [0, 1], [dy, 0], {
      easing: Easing.out(Easing.cubic),
    })}px)`,
  });

  // Container frames: quick opacity/settle at the very start, then ROCK-STEADY.
  // No drift/breath/scale on the whole card — only a tiny one-time translateY.
  const cardTy = interpolate(frame, [4, 14], [8, 0], CLAMP);
  const dyadOpacity = interpolate(frame, [2, 14], [0, 1], CLAMP);
  // Ptah's pre-reveal opacity trick stays; its frame position is stable throughout.
  const ptahReveal = interpolate(frame, [p(2), p(2) + 12], [0, 1], CLAMP);
  const ptahOpacity = 0.12 + 0.88 * ptahReveal;

  // Per-element staggered reveals inside the two steady frames.
  const dyadHeadEnter = rise(6, 18);
  const dyadSubEnter = rise(11, 18);
  const dyadWindowEnter = rise(16, 18);
  const dyadPubLabelEnter = rise(p(1) + phaseFrames * 0.55, 18);
  const ptahHeadEnter = rise(p(2) + 2, 18);
  const ptahSubEnter = rise(p(2) + 7, 18);
  const ptahBodyEnter = rise(p(2) + 12, 18);
  const ptahRuleLabelEnter = rise(p(2) + phaseFrames * 0.55, 18);

  const vsEnter = rise(phaseFrames * 0.3, 16);
  const contrastEnter = rise(p(3) + phaseFrames * 0.1);

  const vsBreath = useBreath(70);
  const dividerBoost = interpolate(frame, [p(3), p(3) + phaseFrames * 0.45], [0, 1], CLAMP);
  const vsGlow = S * (0.02 + vsBreath * 0.02 + dividerBoost * 0.05);

  const cardW = portrait ? contentW : (contentW - S * 0.12) / 2;
  const vsSize = S * 0.085;

  const headingStyle: React.CSSProperties = {
    fontSize: S * 0.05,
    fontWeight: 800,
    color: THEME.textStrong,
    display: 'flex',
    alignItems: 'center',
    gap: S * 0.014,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: S * 0.026,
    fontWeight: 700,
    color: THEME.textSoft,
  };

  const dyadCard = (
    <Card
      S={S}
      width={cardW}
      accent={THEME.amber}
      opacity={dyadOpacity}
      translateY={cardTy}
      backdrop={<Meteors count={3} color={THEME.amber} />}
      header={
        <div style={{ display: 'flex', flexDirection: 'column', gap: S * 0.008 }}>
          <div style={{ ...headingStyle, color: THEME.amber, ...enterStyle(dyadHeadEnter, 10) }}>
            <Bolt size={S * 0.05} color={THEME.amber} glow={0.4 + vsBreath * 0.6} />
            <ShimmerSweep delayFrames={phaseFrames * 0.05}>Dyad</ShimmerSweep>
          </div>
          <div style={{ ...labelStyle, ...enterStyle(dyadSubEnter, 8) }}>
            open-source · local-first
          </div>
        </div>
      }
    >
      <PublishWindow
        S={S}
        accent={THEME.amber}
        accentDeep={THEME.amberDeep}
        publishStart={p(1) + phaseFrames * 0.12}
        publishEnd={p(1) + phaseFrames * 0.62}
        badgeStart={p(1) + phaseFrames * 0.5}
        enter={dyadWindowEnter}
      />
      <div
        style={{
          ...labelStyle,
          fontSize: S * 0.022,
          color: THEME.textFaint,
          ...enterStyle(dyadPubLabelEnter, 8),
        }}
      >
        publishes instantly
      </div>
      <ContrastPill S={S} accent={THEME.amber} enter={contrastEnter} label="quick chat window" />
    </Card>
  );

  const ptahCard = (
    <Card
      S={S}
      width={cardW}
      accent={THEME.indigo}
      opacity={ptahOpacity}
      translateY={cardTy}
      header={
        <div style={{ display: 'flex', flexDirection: 'column', gap: S * 0.008 }}>
          <div style={{ ...headingStyle, color: THEME.indigo, ...enterStyle(ptahHeadEnter, 10) }}>
            <span
              style={{
                width: S * 0.05,
                height: S * 0.05,
                borderRadius: S * 0.012,
                border: `2px solid ${THEME.indigo}`,
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gridTemplateRows: '1fr 1fr',
                gap: S * 0.005,
                padding: S * 0.007,
                boxSizing: 'border-box',
              }}
            >
              {[0, 1, 2, 3].map((n) => (
                <span key={n} style={{ background: `${THEME.indigo}cc`, borderRadius: S * 0.003 }} />
              ))}
            </span>
            <ShimmerSweep delayFrames={phaseFrames * 2}>Ptah</ShimmerSweep>
          </div>
          <div style={{ ...labelStyle, ...enterStyle(ptahSubEnter, 8) }}>AI coding orchestra</div>
        </div>
      }
    >
      <div style={enterStyle(ptahBodyEnter, 12)}>
        <RepoIndex S={S} accent={THEME.indigo} nodesStart={p(2) + phaseFrames * 0.35} />
      </div>
      <div
        style={{
          ...labelStyle,
          fontSize: S * 0.022,
          color: THEME.textFaint,
          ...enterStyle(ptahRuleLabelEnter, 8),
        }}
      >
        enforces architectural rules
      </div>
      <ContrastPill
        S={S}
        accent={THEME.indigo}
        enter={contrastEnter}
        label="technical co-founder"
      />
    </Card>
  );

  const vsBadge = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          width: vsSize,
          height: vsSize,
          borderRadius: 999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: S * 0.032,
          fontWeight: 800,
          color: THEME.textStrong,
          background: 'linear-gradient(135deg, rgba(245,181,68,0.22), rgba(79,107,237,0.22))',
          border: '1px solid rgba(255,255,255,0.18)',
          boxShadow: `0 0 ${vsGlow}px rgba(255,255,255,0.35)`,
          opacity: vsEnter,
          transform: `scale(${interpolate(vsEnter, [0, 1], [0.6, 1])})`,
          zIndex: 2,
        }}
      >
        VS
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
        gap: S * 0.03,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: portrait ? 'column' : 'row',
          alignItems: portrait ? 'center' : 'stretch',
          justifyContent: 'center',
          gap: S * 0.02,
          width: contentW,
        }}
      >
        {dyadCard}
        {vsBadge}
        {ptahCard}
      </div>

      <CaptionRail slide={slide} durationFrames={durationFrames} width={width} />
    </AbsoluteFill>
  );
};
