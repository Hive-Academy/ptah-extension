/**
 * Beat-driven overlays for the self-shot compositions.
 *
 * <OverlayLayer> places each resolved overlay in its own <Sequence> window
 * ([atMs, atMs+durationMs] on the body clock) and picks the presentational
 * component by `type`. Each overlay springs in and fades out near the end of its
 * window, using the shared brand tokens (THEME/BRAND) so they match the showcase
 * lower-thirds/callouts. B-roll cutaways reuse existing showcase mp4s as sources.
 */
import React from 'react';
import {
  AbsoluteFill,
  Easing,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { THEME } from '../theme';
import { GraphicScene } from './graphics';
import { AnimatedIcon, type IconName } from './icons';
import type { ResolvedOverlay } from './resolved';

type Corner = 'tl' | 'tr' | 'bl' | 'br';

const CORNER_STYLE: Record<Corner, React.CSSProperties> = {
  tl: { top: '7%', left: '4%' },
  tr: { top: '7%', right: '4%' },
  bl: { bottom: '13%', left: '4%' },
  br: { bottom: '13%', right: '4%' },
};

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/**
 * Motion envelope shared by every corner overlay.
 *
 * `enter` springs the card in, `exit` slides it back out over the last frames
 * (a fade alone reads as a glitch at this size), and the rest are staggered
 * sub-timelines so a card assembles itself: icon strokes draw, then the text
 * wipes, then the accent bar fills. `float` is a slow idle drift that keeps a
 * card from looking like a frozen PNG while it sits on screen.
 */
function useEnvelope(durationFrames: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 17, mass: 0.5, stiffness: 130 } });
  const exit = interpolate(frame, [durationFrames - 10, durationFrames], [0, 1], CLAMP);
  const draw = interpolate(frame, [2, 20], [0, 1], CLAMP);
  const wipe = interpolate(frame, [7, 26], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  const bar = interpolate(frame, [14, 34], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  const count = interpolate(frame, [3, 26], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  // One shimmer sweep shortly after the card lands, then it rests.
  const shimmer = interpolate(frame, [16, 40], [-1, 2], CLAMP);
  const float = Math.sin((frame / fps) * 1.15) * 2.5;
  return { enter, exit, opacity: enter * (1 - exit), draw, wipe, bar, count, shimmer, float };
}

/** Split "24 skills" → { num: 24, suffix: " skills" } so the number can count up. */
function splitNumeric(value: string): { num: number; suffix: string } | null {
  const m = /^(\d[\d,]*)(.*)$/.exec(value.trim());
  if (!m) return null;
  return { num: Number(m[1].replace(/,/g, '')), suffix: m[2] };
}

/** Diagonal light sweep that crosses a card once, just after it lands. */
const Shimmer: React.FC<{ progress: number; radius: number }> = ({ progress, radius }) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      borderRadius: radius,
      overflow: 'hidden',
      pointerEvents: 'none',
    }}
  >
    <div
      style={{
        position: 'absolute',
        inset: '-40%',
        transform: `translateX(${progress * 130}%)`,
        background:
          'linear-gradient(105deg, transparent 42%, rgba(255,255,255,0.16) 50%, transparent 58%)',
      }}
    />
  </div>
);

// ── Lower-third intro card ────────────────────────────────────────────────────
const LowerThirdCard: React.FC<{ title: string; subtitle?: string; durationFrames: number }> = ({
  title,
  subtitle,
  durationFrames,
}) => {
  const { height } = useVideoConfig();
  const { enter, opacity } = useEnvelope(durationFrames);
  const titleSize = Math.round(height * 0.038);
  const subSize = Math.round(height * 0.022);
  const x = interpolate(enter, [0, 1], [-40, 0]);
  return (
    <div
      style={{
        position: 'absolute',
        left: '5.5%',
        bottom: '11%',
        opacity,
        transform: `translateX(${x}px)`,
        fontFamily: THEME.font,
        display: 'flex',
        alignItems: 'stretch',
        gap: titleSize * 0.55,
      }}
    >
      <div
        style={{
          width: Math.max(4, Math.round(height * 0.006)),
          borderRadius: 99,
          background: `linear-gradient(180deg, ${THEME.amber}, ${THEME.amberDeep})`,
          boxShadow: `0 0 16px ${THEME.amberDeep}`,
        }}
      />
      <div
        style={{
          padding: `${titleSize * 0.5}px ${titleSize}px`,
          borderRadius: titleSize * 0.5,
          background: 'rgba(8,10,18,0.8)',
          border: '1px solid rgba(245,181,68,0.18)',
          boxShadow: '0 18px 50px rgba(0,0,0,0.55)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <div style={{ fontSize: titleSize, fontWeight: 800, color: THEME.textStrong, letterSpacing: -0.5 }}>
          {title}
        </div>
        {subtitle ? (
          <div style={{ marginTop: titleSize * 0.22, fontSize: subSize, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', color: THEME.amberLight }}>
            {subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
};

// ── Keyword chip: icon badge + wiped text + accent underline ──────────────────
const KeywordChip: React.FC<{
  text: string;
  corner: Corner;
  durationFrames: number;
  icon?: IconName;
}> = ({ text, corner, durationFrames, icon }) => {
  const { height } = useVideoConfig();
  const { enter, exit, opacity, draw, wipe, bar, shimmer, float } = useEnvelope(durationFrames);
  const fontSize = Math.round(height * 0.028);
  const radius = fontSize * 0.85;
  const badge = Math.round(fontSize * 2.15);
  const left = corner.endsWith('l');
  const dir = left ? -1 : 1;
  const x = interpolate(enter, [0, 1], [dir * 70, 0]) + dir * exit * 46;
  const scale = interpolate(enter, [0, 1], [0.9, 1]);

  return (
    <div
      style={{
        position: 'absolute',
        ...CORNER_STYLE[corner],
        opacity,
        transform: `translate(${x}px, ${float}px) scale(${scale})`,
        transformOrigin: left ? 'left center' : 'right center',
        display: 'flex',
        alignItems: 'center',
        gap: fontSize * 0.72,
        padding: `${fontSize * 0.52}px ${fontSize * 1.05}px`,
        borderRadius: radius,
        background: 'rgba(8,10,18,0.82)',
        border: '1px solid rgba(245,181,68,0.22)',
        boxShadow: '0 20px 55px rgba(0,0,0,0.58), 0 0 34px rgba(245,158,11,0.10)',
        backdropFilter: 'blur(10px)',
        fontFamily: THEME.font,
      }}
    >
      <Shimmer progress={shimmer} radius={radius} />

      {icon ? (
        <div
          style={{
            width: badge,
            height: badge,
            borderRadius: badge,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: `linear-gradient(140deg, ${THEME.amber}, ${THEME.amberDeep})`,
            boxShadow: `0 0 22px ${THEME.amberDeep}66`,
            transform: `scale(${interpolate(enter, [0, 1], [0.55, 1])})`,
          }}
        >
          <AnimatedIcon
            name={icon}
            size={Math.round(badge * 0.56)}
            color="#1a1200"
            progress={draw}
            strokeWidth={2.4}
          />
        </div>
      ) : null}

      <div style={{ position: 'relative', paddingBottom: fontSize * 0.28 }}>
        <div
          style={{
            fontSize,
            fontWeight: 800,
            letterSpacing: 0.2,
            color: THEME.textStrong,
            whiteSpace: 'nowrap',
            clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)`,
          }}
        >
          {text}
        </div>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: Math.max(2, Math.round(fontSize * 0.11)),
            borderRadius: 99,
            background: `linear-gradient(90deg, ${THEME.amber}, ${THEME.amberDeep})`,
            transform: `scaleX(${bar})`,
            transformOrigin: 'left center',
          }}
        />
      </div>
    </div>
  );
};

// ── Stat callout card ─────────────────────────────────────────────────────────
const StatCard: React.FC<{
  value: string;
  label: string;
  corner: Corner;
  durationFrames: number;
  icon?: IconName;
}> = ({ value, label, corner, durationFrames, icon }) => {
  const { height } = useVideoConfig();
  const { enter, exit, opacity, draw, wipe, bar, count, shimmer, float } =
    useEnvelope(durationFrames);
  const valueSize = Math.round(height * 0.072);
  const labelSize = Math.round(height * 0.022);
  const radius = labelSize * 1.1;
  const badge = Math.round(labelSize * 2.3);
  const y = interpolate(enter, [0, 1], [30, 0]) + exit * 26;
  const scale = interpolate(enter, [0, 1], [0.92, 1]);

  // Count the leading number up; anything non-numeric renders as-is.
  const parts = splitNumeric(value);
  const shown = parts ? `${Math.round(parts.num * count)}${parts.suffix}` : value;

  return (
    <div
      style={{
        position: 'absolute',
        ...CORNER_STYLE[corner],
        opacity,
        transform: `translateY(${y + float}px) scale(${scale})`,
        transformOrigin: corner.endsWith('l') ? 'left top' : 'right top',
        padding: `${labelSize * 1.05}px ${labelSize * 1.7}px`,
        borderRadius: radius,
        background: 'rgba(8,10,18,0.84)',
        border: '1px solid rgba(245,181,68,0.22)',
        boxShadow: '0 26px 70px rgba(0,0,0,0.62), 0 0 46px rgba(245,158,11,0.12)',
        backdropFilter: 'blur(12px)',
        fontFamily: THEME.font,
        textAlign: 'left',
        minWidth: labelSize * 11,
      }}
    >
      <Shimmer progress={shimmer} radius={radius} />

      {icon ? (
        <div
          style={{
            width: badge,
            height: badge,
            borderRadius: badge * 0.34,
            marginBottom: labelSize * 0.6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(245,181,68,0.13)',
            border: '1px solid rgba(245,181,68,0.3)',
            transform: `scale(${interpolate(enter, [0, 1], [0.6, 1])})`,
          }}
        >
          <AnimatedIcon
            name={icon}
            size={Math.round(badge * 0.58)}
            color={THEME.amberLight}
            progress={draw}
            strokeWidth={2}
          />
        </div>
      ) : null}

      <div
        style={{
          fontSize: valueSize,
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: -2,
          fontVariantNumeric: 'tabular-nums',
          background: `linear-gradient(90deg, ${THEME.amberLight}, ${THEME.amber})`,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}
      >
        {shown}
      </div>

      <div
        style={{
          marginTop: labelSize * 0.55,
          height: Math.max(2, Math.round(labelSize * 0.14)),
          borderRadius: 99,
          background: `linear-gradient(90deg, ${THEME.amber}, ${THEME.amberDeep})`,
          transform: `scaleX(${bar})`,
          transformOrigin: 'left center',
        }}
      />

      <div
        style={{
          marginTop: labelSize * 0.5,
          fontSize: labelSize,
          fontWeight: 600,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          color: THEME.textSoft,
          whiteSpace: 'nowrap',
          clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)`,
        }}
      >
        {label}
      </div>
    </div>
  );
};

// ── B-roll cutaway (existing showcase mp4) ────────────────────────────────────
const BrollCutaway: React.FC<{
  src: string;
  layout: 'full' | 'pip';
  corner: Corner;
  durationFrames: number;
}> = ({ src, layout, corner, durationFrames }) => {
  const { width, height } = useVideoConfig();
  const { enter, opacity } = useEnvelope(durationFrames);

  if (layout === 'full') {
    // Full-screen cutaway: fade/scale in over the founder.
    const scale = interpolate(enter, [0, 1], [1.04, 1]);
    return (
      <AbsoluteFill style={{ opacity, background: THEME.bg }}>
        <OffthreadVideo
          src={src}
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})` }}
        />
      </AbsoluteFill>
    );
  }

  // PiP cutaway: a bordered rounded card in a corner.
  const cardW = Math.round(width * 0.34);
  const cardH = Math.round((cardW * 9) / 16);
  const margin = Math.round(height * 0.05);
  const pos: React.CSSProperties = {
    ...(corner.startsWith('t') ? { top: margin } : { bottom: margin }),
    ...(corner.endsWith('l') ? { left: margin } : { right: margin }),
  };
  const y = interpolate(enter, [0, 1], [20, 0]);
  return (
    <div
      style={{
        position: 'absolute',
        ...pos,
        width: cardW,
        height: cardH,
        opacity,
        transform: `translateY(${y}px)`,
        borderRadius: Math.round(cardW * 0.03),
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 30px 70px rgba(0,0,0,0.62)',
      }}
    >
      <OffthreadVideo src={src} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </div>
  );
};

function OverlayItem({ overlay }: { overlay: ResolvedOverlay }) {
  const { fps } = useVideoConfig();
  const durationFrames = Math.max(1, Math.round((overlay.durationMs / 1000) * fps));
  switch (overlay.type) {
    case 'lower-third':
      return <LowerThirdCard title={overlay.title} subtitle={overlay.subtitle} durationFrames={durationFrames} />;
    case 'keyword':
      return (
        <KeywordChip
          text={overlay.text}
          corner={overlay.corner ?? 'tr'}
          durationFrames={durationFrames}
          icon={overlay.icon}
        />
      );
    case 'stat':
      return (
        <StatCard
          value={overlay.value}
          label={overlay.label}
          corner={overlay.corner ?? 'tr'}
          durationFrames={durationFrames}
          icon={overlay.icon}
        />
      );
    case 'graphic':
      return <GraphicScene name={overlay.name} layout={overlay.layout} durationFrames={durationFrames} />;
    case 'broll':
      return <BrollCutaway src={overlay.src} layout={overlay.layout} corner={overlay.corner ?? 'br'} durationFrames={durationFrames} />;
    default:
      return null;
  }
}

export const OverlayLayer: React.FC<{ overlays: ResolvedOverlay[] }> = ({ overlays }) => {
  const { fps } = useVideoConfig();
  return (
    <>
      {overlays.map((overlay, i) => {
        const from = Math.round((overlay.atMs / 1000) * fps);
        const durationInFrames = Math.max(1, Math.round((overlay.durationMs / 1000) * fps));
        return (
          <Sequence key={`ov-${i}`} from={from} durationInFrames={durationInFrames} name={`overlay-${overlay.type}-${i}`}>
            <OverlayItem overlay={overlay} />
          </Sequence>
        );
      })}
    </>
  );
};

/** B-roll cutaways that fully replace the frame (layout:'full') — rendered ABOVE
 *  captions so a full cutaway hides the founder + his captions while it plays. */
export const FullBrollLayer: React.FC<{ overlays: ResolvedOverlay[] }> = ({ overlays }) => {
  const { fps } = useVideoConfig();
  const fulls = overlays.filter((o) => o.type === 'broll' && o.layout === 'full');
  return (
    <>
      {fulls.map((overlay, i) => {
        const from = Math.round((overlay.atMs / 1000) * fps);
        const durationInFrames = Math.max(1, Math.round((overlay.durationMs / 1000) * fps));
        return (
          <Sequence key={`fb-${i}`} from={from} durationInFrames={durationInFrames} name={`broll-full-${i}`}>
            <OverlayItem overlay={overlay} />
          </Sequence>
        );
      })}
    </>
  );
};

/** Non-full overlays only (lower-third/keyword/stat + PiP b-roll). */
export const CornerOverlayLayer: React.FC<{ overlays: ResolvedOverlay[] }> = ({ overlays }) => {
  const corner = overlays.filter((o) => !(o.type === 'broll' && o.layout === 'full'));
  return <OverlayLayer overlays={corner} />;
};
