/**
 * LowerThird — word-synced animated caption overlay (TikTok-style).
 *
 * Driven by whisper-derived caption tokens (captions.json), which caption.mjs
 * writes on the FOOTAGE timeline (each beat's words offset by its tMs), so with
 * offsetMs=0 the active phrase and the beat's <Audio> stay locked.
 *
 * The active phrase springs up into a branded pill; the word currently being
 * spoken is highlighted in amber while the rest stay white.
 */
import React from 'react';
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from 'remotion';
import type { CaptionToken } from '../lib/load-manifest';
import { THEME } from '../theme';

export interface LowerThirdProps {
  captions: CaptionToken[];
  /** ms added to every caption's start/end (e.g. an intro offset). */
  offsetMs?: number;
  /** Frame height, used to scale font so 4k isn't tiny. */
  videoHeight: number;
  /** Vertical placement — moved to 'top' during close-up shots. */
  position?: 'top' | 'bottom';
}

/**
 * Group caption tokens into short visible phrases (≈ 6 words / phrase). A phrase
 * also breaks on a large time gap between tokens so words from two different
 * beats (separated by on-screen dwell) never share one lower-third.
 */
function groupTokens(captions: CaptionToken[], perPhrase = 6, gapMs = 1000) {
  const phrases: { startMs: number; endMs: number; tokens: CaptionToken[] }[] = [];
  let cur: CaptionToken[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    phrases.push({
      startMs: cur[0].startMs,
      endMs: cur[cur.length - 1].endMs,
      tokens: cur,
    });
    cur = [];
  };
  for (const token of captions) {
    if (cur.length > 0) {
      const prev = cur[cur.length - 1];
      if (cur.length >= perPhrase || token.startMs - prev.endMs > gapMs) flush();
    }
    cur.push(token);
  }
  flush();
  return phrases;
}

export const LowerThird: React.FC<LowerThirdProps> = ({
  captions,
  offsetMs = 0,
  videoHeight,
  position = 'bottom',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowMs = (frame / fps) * 1000;

  const phrases = groupTokens(captions);
  const activeIdx = phrases.findIndex(
    (p) => nowMs >= p.startMs + offsetMs && nowMs <= p.endMs + offsetMs + 420,
  );
  if (activeIdx < 0) return null;
  const active = phrases[activeIdx];

  const fontSize = Math.round(videoHeight * 0.036);
  const localFrame = frame - ((active.startMs + offsetMs) / 1000) * fps;
  const enter = spring({
    frame: localFrame,
    fps,
    config: { damping: 18, mass: 0.5, stiffness: 140 },
  });
  const rise = interpolate(enter, [0, 1], [26, 0]);

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        ...(position === 'top' ? { top: '8%' } : { bottom: '6.5%' }),
        display: 'flex',
        justifyContent: 'center',
        padding: '0 8%',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: `0 ${fontSize * 0.36}px`,
          maxWidth: '82%',
          padding: `${fontSize * 0.52}px ${fontSize * 1.05}px`,
          borderRadius: fontSize * 0.62,
          background: 'rgba(8, 10, 18, 0.78)',
          border: '1px solid rgba(245,181,68,0.18)',
          boxShadow: '0 18px 50px rgba(0,0,0,0.55)',
          backdropFilter: 'blur(8px)',
          opacity: enter,
          transform: `translateY(${rise}px)`,
        }}
      >
        {active.tokens.map((token, i) => {
          const tokenStart = token.startMs + offsetMs;
          const tokenEnd = token.endMs + offsetMs;
          const appeared = nowMs >= tokenStart;
          const speaking = nowMs >= tokenStart && nowMs <= tokenEnd + 120;
          const pop = interpolate(
            nowMs,
            [tokenStart, tokenStart + 130],
            [0.62, 1],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          );
          return (
            <span
              key={`${token.startMs}-${i}`}
              style={{
                fontFamily: THEME.font,
                fontWeight: 800,
                fontSize,
                lineHeight: 1.22,
                color: speaking
                  ? THEME.amber
                  : appeared
                    ? '#ffffff'
                    : 'rgba(255,255,255,0.34)',
                transform: `scale(${appeared ? pop : 0.62})`,
                transition: 'none',
                textShadow: '0 2px 10px rgba(0,0,0,0.65)',
              }}
            >
              {token.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};
