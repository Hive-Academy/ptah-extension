/**
 * LowerThird — word-synced animated caption overlay.
 *
 * Driven by the whisper-derived caption tokens (captions.json). Each token
 * fades/pops in at its `startMs` (TikTok-style highlight), positioned at the
 * bottom 6% of the frame — matching where the baked `#ptah-director-caption`
 * used to sit so the look is consistent with the legacy recordings.
 *
 * Caption timestamps are relative to the narration audio track, which the
 * composition offsets by the intro length; callers pass `offsetMs` so the
 * words line up with the audio sequences.
 */
import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { CaptionToken } from '../lib/load-manifest';

export interface LowerThirdProps {
  captions: CaptionToken[];
  /** ms added to every caption's start/end (intro offset on the narration). */
  offsetMs?: number;
  /** Frame height, used to scale font so 4k isn't tiny. */
  videoHeight: number;
}

/** Group caption tokens into short visible phrases (≈ 6 words / phrase). */
function groupTokens(captions: CaptionToken[], perPhrase = 6) {
  const phrases: { startMs: number; endMs: number; tokens: CaptionToken[] }[] = [];
  for (let i = 0; i < captions.length; i += perPhrase) {
    const tokens = captions.slice(i, i + perPhrase);
    if (tokens.length === 0) continue;
    phrases.push({
      startMs: tokens[0].startMs,
      endMs: tokens[tokens.length - 1].endMs,
      tokens,
    });
  }
  return phrases;
}

export const LowerThird: React.FC<LowerThirdProps> = ({
  captions,
  offsetMs = 0,
  videoHeight,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowMs = (frame / fps) * 1000;

  const phrases = groupTokens(captions);
  const active = phrases.find(
    (p) => nowMs >= p.startMs + offsetMs && nowMs <= p.endMs + offsetMs + 400,
  );
  if (!active) return null;

  const fontSize = Math.round(videoHeight * 0.034);

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: '6%',
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
          gap: `0 ${fontSize * 0.35}px`,
          maxWidth: '84%',
          padding: `${fontSize * 0.5}px ${fontSize}px`,
          borderRadius: fontSize * 0.5,
          background: 'rgba(8, 10, 18, 0.72)',
          backdropFilter: 'blur(6px)',
        }}
      >
        {active.tokens.map((token, i) => {
          const tokenStart = token.startMs + offsetMs;
          const appeared = nowMs >= tokenStart;
          const pop = interpolate(
            nowMs,
            [tokenStart, tokenStart + 120],
            [0.6, 1],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          );
          return (
            <span
              key={`${token.startMs}-${i}`}
              style={{
                fontFamily:
                  'Inter, "Segoe UI", system-ui, -apple-system, sans-serif',
                fontWeight: 700,
                fontSize,
                lineHeight: 1.2,
                color: appeared ? '#ffffff' : 'rgba(255,255,255,0.35)',
                transform: `scale(${appeared ? pop : 0.6})`,
                transition: 'none',
                textShadow: '0 2px 8px rgba(0,0,0,0.6)',
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
