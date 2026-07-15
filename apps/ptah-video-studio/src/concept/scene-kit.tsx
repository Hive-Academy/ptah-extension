/**
 * scene-kit — shared pacing + caption helpers so every concept scene fills its
 * slide's full `durationFrames` with continuous, professional motion and a
 * sequential caption rail, instead of a short burst that then freezes.
 *
 * Everything here is FRAME-DRIVEN (useCurrentFrame) so it renders
 * deterministically. No CSS animation/transition, no timers, no Math.random.
 */
import React, { createContext, useContext } from 'react';
import {
  Audio,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from 'remotion';
import { THEME } from '../theme';
import type { PromoSlide, Locale } from '../PromoReel';
import { SectionTransition, type TransitionKind } from '../components/SectionTransition';

/**
 * SfxProvider/useSfx — makes the staged UI tick/success-chime SFX available to
 * any deeply-nested component (NumberTicker, a scene's own "success" beat)
 * without prop-drilling them through every scene's render tree. Provided once
 * at the PromoReel root; absent values just mean that sound is skipped.
 */
const SfxContext = createContext<{ tickSrc?: string; chimeSrc?: string }>({});
export const SfxProvider: React.FC<{
  tickSrc?: string;
  chimeSrc?: string;
  children: React.ReactNode;
}> = ({ tickSrc, chimeSrc, children }) => (
  <SfxContext.Provider value={{ tickSrc, chimeSrc }}>{children}</SfxContext.Provider>
);
export function useSfx(): { tickSrc?: string; chimeSrc?: string } {
  return useContext(SfxContext);
}

/** Normalize a slide's captions to an ordered list (new `captions`, else legacy `caption`). */
export function sceneCaptions(slide: PromoSlide): string[] {
  if (slide.captions && slide.captions.length > 0) return slide.captions;
  if (slide.caption) return [slide.caption];
  return [];
}

/**
 * Split [0, durationFrames] into `count` phase windows and report where we are.
 * `phase` is the active index, `local` is 0..1 progress within it, `global` is
 * 0..1 across the whole slide. Scenes hang their reveals off phase boundaries so
 * the visual beat lands with the narration beat.
 */
export function usePhases(
  durationFrames: number,
  count: number,
): { phase: number; local: number; global: number; phaseFrames: number } {
  const frame = useCurrentFrame();
  const safeCount = Math.max(1, count);
  const phaseFrames = durationFrames / safeCount;
  const global = interpolate(frame, [0, durationFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const raw = frame / phaseFrames;
  const phase = Math.min(safeCount - 1, Math.max(0, Math.floor(raw)));
  const local = Math.min(1, Math.max(0, raw - phase));
  return { phase, local, global, phaseFrames };
}

/**
 * Continuous ambient breath 0..1 (slow sine) for parallax/scale/opacity — keeps
 * a scene alive across its whole hold. `period` in frames, `phase` offsets it so
 * stacked elements don't pulse in lockstep.
 */
export function useBreath(period = 90, phase = 0): number {
  const frame = useCurrentFrame();
  return (Math.sin(((frame + phase) / period) * Math.PI * 2) + 1) / 2;
}

/**
 * A gentle, ever-present vertical drift (px) so the hero card never sits
 * perfectly still — the difference between "product demo" and "static mockup".
 */
export function useDrift(amplitude = 6, period = 120, phase = 0): number {
  const b = useBreath(period, phase);
  return interpolate(b, [0, 1], [-amplitude, amplitude]);
}

/** One spoken word with its real timing (clip-relative ms) — see `PromoSlide.voWordsMs`. */
type VoWord = { text: string; startMs: number; endMs: number };

/**
 * Group VO words into short visible phrases (~7 words), also breaking on a
 * large time gap between words (so words either side of a pause never share
 * one caption). Same technique as the showcase pipeline's `LowerThird`.
 */
function groupWords(words: VoWord[], perPhrase = 7, gapMs = 900) {
  const phrases: { startMs: number; endMs: number; words: VoWord[] }[] = [];
  let cur: VoWord[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    phrases.push({ startMs: cur[0].startMs, endMs: cur[cur.length - 1].endMs, words: cur });
    cur = [];
  };
  for (const word of words) {
    if (cur.length > 0) {
      const prev = cur[cur.length - 1];
      if (cur.length >= perPhrase || word.startMs - prev.endMs > gapMs) flush();
    }
    cur.push(word);
  }
  flush();
  return phrases;
}

/**
 * CaptionRail — verbatim, word-synced captions (TikTok-style): the active
 * phrase springs into a pill, the word currently being spoken highlights in
 * amber, spoken words stay white, upcoming words sit dimmed. Driven by
 * `slide.voWordsMs` (real per-word VO timing resolved by render-promo.mjs from
 * the ElevenLabs alignment) — this is what's ACTUALLY said, not a paraphrase,
 * so it can never drift out of sync with or disagree with the voice.
 *
 * Falls back to the slide's paraphrased `captions`/`caption` text, evenly
 * sliced across `durationFrames`, only when there's no VO alignment at all
 * (kokoro engine, or a silent slide) — same as the old behavior.
 */
export const CaptionRail: React.FC<{
  slide: PromoSlide;
  durationFrames: number;
  width: number;
}> = ({ slide, durationFrames, width }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const nowMs = (frame / fps) * 1000;

  // Captions are a FIXED bottom overlay, OUT of the scene's flex flow, so a
  // changing phrase length never shifts the scene content above it. Anchored by
  // the bottom edge (alignItems flex-end) so a second line grows upward and the
  // baseline stays put — no vertical jump between one- and two-line phrases.
  const shell = (node: React.ReactNode): React.ReactNode => (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: Math.round(height * 0.06),
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-end',
        pointerEvents: 'none',
      }}
    >
      {node}
    </div>
  );

  if (slide.voWordsMs && slide.voWordsMs.length > 0) {
    const phrases = groupWords(slide.voWordsMs);
    const activeIdx = phrases.findIndex(
      (p) => nowMs >= p.startMs && nowMs <= p.endMs + 420,
    );
    if (activeIdx < 0) return null;
    const active = phrases[activeIdx];

    const fontSize = Math.round(width * 0.052);
    const localFrame = frame - (active.startMs / 1000) * fps;
    const enter = spring({ frame: localFrame, fps, config: { damping: 18, mass: 0.5, stiffness: 140 } });
    const rise = interpolate(enter, [0, 1], [22, 0]);

    return shell(
      <div
        style={{
          width: width * 0.88,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          alignItems: 'center',
          gap: `${fontSize * 0.22}px ${fontSize * 0.32}px`,
          padding: `${fontSize * 0.5}px ${fontSize}px`,
          borderRadius: fontSize * 0.6,
          background: 'rgba(8, 14, 11, 0.72)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 18px 50px rgba(0,0,0,0.5)',
          opacity: enter,
          transform: `translateY(${rise}px)`,
        }}
      >
        {active.words.map((word, i) => {
          const appeared = nowMs >= word.startMs;
          const speaking = nowMs >= word.startMs && nowMs <= word.endMs + 120;
          const pop = interpolate(nowMs, [word.startMs, word.startMs + 130], [0.65, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          return (
            <span
              key={`${word.startMs}-${i}`}
              style={{
                fontFamily: THEME.font,
                fontWeight: 800,
                fontSize,
                lineHeight: 1.25,
                color: speaking ? THEME.amber : appeared ? THEME.textStrong : 'rgba(255,255,255,0.35)',
                transform: `scale(${appeared ? pop : 0.65})`,
                textShadow: '0 2px 10px rgba(0,0,0,0.6)',
              }}
            >
              {word.text}
            </span>
          );
        })}
      </div>
    );
  }

  // Full-narration fallback (kokoro / no word alignment): show the ACTUAL
  // spoken text — the slide's `vo` — chunked into short subtitle phrases and
  // timed across the clip by word count, so the on-screen words ARE the
  // narration (not a paraphrased headline) and pace with the voice. Only when
  // there's no `vo` at all do we fall back to the paraphrased `captions`.
  const phrases = slide.vo && slide.vo.trim() ? chunkVo(slide.vo) : sceneCaptions(slide);
  if (phrases.length === 0) return null;

  // Weight each phrase's on-screen window by its word count so longer lines
  // hold longer — approximates natural speech pacing across `durationFrames`.
  const weights = phrases.map((p) => Math.max(1, p.split(/\s+/).filter(Boolean).length));
  const totalW = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  const wins = phrases.map((p, i) => {
    const from = (acc / totalW) * durationFrames;
    acc += weights[i];
    const to = (acc / totalW) * durationFrames;
    return { p, from, to };
  });
  const foundIdx = wins.findIndex((w) => frame >= w.from && frame < w.to);
  const idx = foundIdx >= 0 ? foundIdx : wins.length - 1;
  const win = wins[idx];
  const seg = Math.max(1, win.to - win.from);
  const local = frame - win.from;
  const fadeIn = interpolate(local, [0, 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const isLast = idx === wins.length - 1;
  const fadeOut = isLast
    ? 1
    : interpolate(local, [seg - 8, seg], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const rise = interpolate(fadeIn, [0, 1], [12, 0], { easing: Easing.out(Easing.cubic) });
  const fontSize = Math.round(width * 0.036);

  return shell(
    <div
      style={{
        width: width * 0.82,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        fontFamily: THEME.font,
        fontSize,
        fontWeight: 700,
        lineHeight: 1.35,
        color: THEME.textStrong,
        padding: `${fontSize * 0.5}px ${fontSize}px`,
        borderRadius: fontSize * 0.6,
        background: 'rgba(8, 14, 11, 0.72)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 18px 50px rgba(0,0,0,0.5)',
        textShadow: '0 2px 10px rgba(0,0,0,0.6)',
        opacity: Math.min(fadeIn, fadeOut),
        transform: `translateY(${rise}px)`,
      }}
    >
      {win.p}
    </div>
  );
};

/**
 * Split a full VO paragraph into short, readable subtitle phrases: break on
 * sentence enders first, then cap each run at ~9 words so no line overflows.
 * The result is the ACTUAL narration text, ready to time across a slide.
 */
function chunkVo(vo: string, maxWords = 9): string[] {
  const sentences = vo.match(/[^.!?]+[.!?]*/g) ?? [vo];
  const out: string[] = [];
  for (const s of sentences) {
    const words = s.trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i += maxWords) {
      out.push(words.slice(i, i + maxWords).join(' '));
    }
  }
  return out;
}

/** Arabic-Indic digit table + formatter, shared by every scene that shows a metric. */
const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
export const toArabicDigits = (input: string): string =>
  input.replace(/[0-9]/g, (d) => ARABIC_DIGITS[Number(d)]);

/** Locale-aware number formatting (Western digits for `en`, Arabic-Indic + `٫` decimal for `ar`). */
export function formatNumber(value: number, decimals: number, locale: Locale): string {
  const fixed = decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString();
  if (locale !== 'ar') return fixed;
  return toArabicDigits(fixed).replace('.', '٫');
}

/** Frame-driven count-up from `from` to `to` across [fromFrame, toFrame], clamped at the ends. */
export function useCountUp(from: number, to: number, fromFrame: number, toFrame: number): number {
  const frame = useCurrentFrame();
  return interpolate(frame, [fromFrame, toFrame], [from, to], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

/**
 * NumberTicker — a locale-formatted count-up value, for scenes that just need
 * a plain animated number+suffix instead of hand-rolling `interpolate` +
 * `formatNumber` inline. Layout/typography stay the caller's responsibility
 * (pass `style`); this owns only the value math and text.
 *
 * Plays a soft tick right as the count-up lands (from `useSfx()`'s `tickSrc`,
 * when staged) — a beat of attention on the number finishing, not just a
 * silent number appearing. `tick={false}` opts a specific instance out.
 */
export const NumberTicker: React.FC<{
  from: number;
  to: number;
  fromFrame: number;
  toFrame: number;
  decimals?: number;
  suffix?: string;
  locale: Locale;
  style?: React.CSSProperties;
  tick?: boolean;
}> = ({ from, to, fromFrame, toFrame, decimals = 0, suffix = '', locale, style, tick = true }) => {
  const value = useCountUp(from, to, fromFrame, toFrame);
  const { tickSrc } = useSfx();
  const tickFrame = Math.max(0, Math.round(toFrame));
  return (
    <span style={style}>
      {formatNumber(value, decimals, locale)}
      {suffix}
      {tick && tickSrc && toFrame > fromFrame ? (
        <Sequence from={tickFrame} durationInFrames={12}>
          <Audio src={tickSrc} volume={0.4} />
        </Sequence>
      ) : null}
    </span>
  );
};

/** Per-phase whip/zoom burst choice for `PhaseStage` — first/last phase skip the missing edge. */
function defaultPhaseTransition(
  index: number,
  count: number,
): { enter?: TransitionKind; exit?: TransitionKind; dir?: 1 | -1 } {
  return {
    enter: index > 0 ? 'whip' : undefined,
    exit: index < count - 1 ? 'zoom' : undefined,
    dir: 1,
  };
}

/**
 * Group a slide's real per-caption VO windows into `phaseCount` buckets (as
 * even as possible) and return each bucket's [startMs, endMs). Returns null
 * when there aren't at least as many captions as phases (nothing sane to
 * group), so the caller falls back to equal-duration phases.
 */
function groupCaptionWindows(
  windows: { startMs: number; endMs: number }[],
  phaseCount: number,
): { startMs: number; endMs: number }[] | null {
  if (windows.length < phaseCount) return null;
  const base = Math.floor(windows.length / phaseCount);
  const extra = windows.length % phaseCount;
  const groups: { startMs: number; endMs: number }[] = [];
  let idx = 0;
  for (let p = 0; p < phaseCount; p++) {
    const size = base + (p >= phaseCount - extra ? 1 : 0);
    const slice = windows.slice(idx, idx + size);
    idx += size;
    if (slice.length === 0) return null;
    groups.push({ startMs: slice[0].startMs, endMs: slice[slice.length - 1].endMs });
  }
  return groups;
}

/**
 * PhaseStage — splits `durationFrames` into `count` windows and mounts ONLY
 * the active phase's content at any given frame (via nested `<Sequence>`,
 * which Remotion mounts/unmounts by frame range), each wrapped in a
 * `SectionTransition` whip/zoom cut burst at its boundary, with a whoosh at
 * the same beat. Replaces the old pattern of rendering every phase's JSX
 * simultaneously (always mounted, revealed via opacity) inside one static
 * card — phases now read as real shot cuts instead of a screen filling up.
 *
 * When `slide.captionWindowsMs` is available (real VO word-alignment timing,
 * resolved by render-promo.mjs) and there are at least as many captions as
 * phases, phase boundaries are grouped from those real sentence timings
 * instead of an even 1/N division. Falls back to equal division otherwise
 * (kokoro engine, a silent slide, or fewer captions than phases).
 */
export const PhaseStage: React.FC<{
  durationFrames: number;
  count: number;
  /** The slide, so real VO timing can drive phase boundaries — see above. */
  slide?: PromoSlide;
  transitions?: Array<{ enter?: TransitionKind; exit?: TransitionKind; dir?: 1 | -1 }>;
  /** Cut-beat SFX played at every phase boundary after the first (staged by render-promo.mjs). */
  whooshSrc?: string;
  render: (phaseIndex: number, phaseFrames: number) => React.ReactNode;
}> = ({ durationFrames, count, slide, transitions, whooshSrc, render }) => {
  const { fps } = useVideoConfig();
  const safeCount = Math.max(1, count);

  const grouped = slide?.captionWindowsMs
    ? groupCaptionWindows(slide.captionWindowsMs, safeCount)
    : null;

  const windows = grouped
    ? grouped.map((g, i) => {
        const fromMs = g.startMs;
        const toMs = i < grouped.length - 1 ? grouped[i + 1].startMs : null;
        const from = i === 0 ? 0 : Math.round((fromMs / 1000) * fps);
        const to = toMs != null ? Math.round((toMs / 1000) * fps) : durationFrames;
        return { from, duration: Math.max(1, to - from) };
      })
    : Array.from({ length: safeCount }, (_, i) => {
        const phaseFrames = durationFrames / safeCount;
        const from = Math.round(i * phaseFrames);
        const to = Math.round((i + 1) * phaseFrames);
        return { from, duration: Math.max(1, to - from) };
      });

  return (
    <>
      {windows.map(({ from, duration }, i) => {
        const t = transitions?.[i] ?? defaultPhaseTransition(i, safeCount);
        return (
          <Sequence key={i} from={from} durationInFrames={duration} name={`phase-${i}`}>
            {/* durationInFrames is Sequence-scoped, so SectionTransition reads
                this phase's length from context — no explicit prop needed. */}
            <SectionTransition enter={t.enter} exit={t.exit} dir={t.dir ?? 1}>
              {render(i, duration)}
            </SectionTransition>
            {i > 0 && whooshSrc ? <Audio src={whooshSrc} volume={0.32} /> : null}
          </Sequence>
        );
      })}
    </>
  );
};
