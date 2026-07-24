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
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { THEME } from '../theme';
import type { ResolvedOverlay } from './resolved';

type Corner = 'tl' | 'tr' | 'bl' | 'br';

const CORNER_STYLE: Record<Corner, React.CSSProperties> = {
  tl: { top: '7%', left: '4%' },
  tr: { top: '7%', right: '4%' },
  bl: { bottom: '13%', left: '4%' },
  br: { bottom: '13%', right: '4%' },
};

/** Enter (spring) + tail fade envelope for an overlay of `durationFrames`. */
function useEnvelope(durationFrames: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 17, mass: 0.5, stiffness: 130 } });
  const fadeOut = interpolate(frame, [durationFrames - 8, durationFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return { enter, opacity: enter * fadeOut };
}

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

// ── Keyword pop-up chip ───────────────────────────────────────────────────────
const KeywordChip: React.FC<{ text: string; corner: Corner; durationFrames: number }> = ({
  text,
  corner,
  durationFrames,
}) => {
  const { height } = useVideoConfig();
  const { enter, opacity } = useEnvelope(durationFrames);
  const fontSize = Math.round(height * 0.03);
  const scale = interpolate(enter, [0, 1], [0.7, 1]);
  return (
    <div
      style={{
        position: 'absolute',
        ...CORNER_STYLE[corner],
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: corner.endsWith('l') ? 'left center' : 'right center',
        padding: `${fontSize * 0.5}px ${fontSize}px`,
        borderRadius: 999,
        background: `linear-gradient(90deg, ${THEME.amber}, ${THEME.amberDeep})`,
        color: '#1a1200',
        fontWeight: 800,
        fontSize,
        letterSpacing: 0.3,
        fontFamily: THEME.font,
        boxShadow: '0 14px 40px rgba(245,158,11,0.35), 0 0 0 1px rgba(255,255,255,0.15) inset',
      }}
    >
      {text}
    </div>
  );
};

// ── Stat callout card ─────────────────────────────────────────────────────────
const StatCard: React.FC<{ value: string; label: string; corner: Corner; durationFrames: number }> = ({
  value,
  label,
  corner,
  durationFrames,
}) => {
  const { height } = useVideoConfig();
  const { enter, opacity } = useEnvelope(durationFrames);
  const valueSize = Math.round(height * 0.072);
  const labelSize = Math.round(height * 0.022);
  const y = interpolate(enter, [0, 1], [24, 0]);
  return (
    <div
      style={{
        position: 'absolute',
        ...CORNER_STYLE[corner],
        opacity,
        transform: `translateY(${y}px)`,
        padding: `${labelSize}px ${labelSize * 1.6}px`,
        borderRadius: labelSize,
        background: 'rgba(8,10,18,0.82)',
        border: '1px solid rgba(245,181,68,0.2)',
        boxShadow: '0 22px 60px rgba(0,0,0,0.6)',
        backdropFilter: 'blur(10px)',
        fontFamily: THEME.font,
        textAlign: corner.endsWith('l') ? 'left' : 'right',
      }}
    >
      <div
        style={{
          fontSize: valueSize,
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: -2,
          background: `linear-gradient(90deg, ${THEME.amberLight}, ${THEME.amber})`,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}
      >
        {value}
      </div>
      <div style={{ marginTop: labelSize * 0.5, fontSize: labelSize, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', color: THEME.textSoft }}>
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
      return <KeywordChip text={overlay.text} corner={overlay.corner ?? 'tr'} durationFrames={durationFrames} />;
    case 'stat':
      return <StatCard value={overlay.value} label={overlay.label} corner={overlay.corner ?? 'tr'} durationFrames={durationFrames} />;
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
