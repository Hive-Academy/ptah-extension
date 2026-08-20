/**
 * ColdStart — a standard AI assistant that "starts cold every time".
 *
 * Four phases hung off usePhases(durationFrames, 4), one per caption:
 *  p0  a code-editor window fills in, pasted line by line, amber chrome + caret.
 *  p1  an AI suggestion bubble slides in with a HALLUCINATED variable, flagged
 *      by a red wavy underline and a small "undefined" badge.
 *  p2  a "Memory" side panel's note — "yesterday: switched DB to Postgres" —
 *      greys out and fades: the assistant has forgotten it.
 *  p3  the window RESETS to cold: content desaturates under a cold-blue tint and
 *      a frost "cold start" indicator crystallizes in.
 *
 * Stable-container model: the editor window + Memory panel are VISUALLY STABLE
 * frames — they settle in over the first ~10 frames (fade + tiny rise) then hold
 * rock-steady. All life is per-element inside them: code lines type in per line,
 * the AI bubble springs in, the red underline + "undefined" badge pop, the memory
 * note greys out, the caret blinks. No whole-card drift/scale.
 *
 * Fully frame-driven (useCurrentFrame + interpolate/spring/useBreath): no
 * Math.random, no timers, no CSS animation. Sized off S = min(width,height) so
 * it reads at both 1920x1080 and 1080x1920.
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

type Token = { t: string; c: string };

/** Pasted source, token-coloured so the editor reads as real code, not lorem. */
const codeLines = (kw: string, str: string, plain: string, strong: string, punct: string): Token[][] => [
  [{ t: 'import', c: kw }, { t: ' { db } ', c: plain }, { t: 'from', c: kw }, { t: " 'server/db'", c: str }],
  [],
  [{ t: 'export async function', c: kw }, { t: ' getUser', c: strong }, { t: '(id) {', c: punct }],
  [{ t: '  const user = ', c: plain }, { t: 'await', c: kw }, { t: ' db.', c: plain }, { t: 'query', c: str }, { t: '(id)', c: punct }],
  [{ t: '  return', c: kw }, { t: ' user', c: plain }],
  [{ t: '}', c: punct }],
];

const Snowflake: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round">
    <line x1="12" y1="2" x2="12" y2="22" />
    <line x1="3" y1="7" x2="21" y2="17" />
    <line x1="21" y1="7" x2="3" y2="17" />
    <path d="M12 6 l-2.4 2.4 M12 6 l2.4 2.4 M12 18 l-2.4 -2.4 M12 18 l2.4 -2.4" />
    <path d="M6.2 8.6 l0.2 3.4 M17.8 8.6 l-0.2 3.4 M6.2 15.4 l0.2 -3.4 M17.8 15.4 l-0.2 -3.4" />
  </svg>
);

export const ColdStart: React.FC<ConceptSceneProps> = ({ slide, durationFrames, locale }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const S = Math.min(width, height);
  const portrait = height > width;
  const contentW = Math.min(width * 0.9, S * 1.15);

  const kw = THEME.indigo;
  const str = THEME.amber;
  const plain = THEME.textSoft;
  const strong = THEME.textStrong;
  const punct = THEME.textFaint;
  const lines = codeLines(kw, str, plain, strong, punct);

  const { phaseFrames: p } = usePhases(durationFrames, 4);
  const caret = useBreath(30); // blinking cursor — continuous life during the hold

  // p3 — cold reset. Desaturates + tints the editor and clears its code.
  const cold = interpolate(frame, [3 * p, 3 * p + p * 0.45], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
  const frost = spring({ frame: frame - (3 * p + p * 0.1), fps, config: { damping: 18, mass: 0.7 } });
  const frostGlow = 0.5 + useBreath(48) * 0.5;

  // Container settle — the outer editor+memory shell is a STABLE frame: it fades
  // and nudges up over the first ~10 frames, then holds rock-steady for the
  // whole scene. No drift, no whole-card spring. All motion lives inside it.
  const shellFade = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const shellRise = interpolate(frame, [0, 10], [10, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  // p1 — AI suggestion bubble with a hallucinated variable.
  const bubbleStart = p * 1.0 + p * 0.06;
  const bubbleEnter = spring({ frame: frame - bubbleStart, fps, config: { damping: 20, mass: 0.7 } });
  const badgeEnter = spring({ frame: frame - (bubbleStart + p * 0.12), fps, config: { damping: 16, mass: 0.6 } });
  const bubbleGlow = 0.4 + useBreath(54, 12) * 0.6;

  // p2 — the Memory note is forgotten: greys further and fades toward nothing.
  const noteBase = spring({ frame: frame - p * 0.2, fps, config: { damping: 20, mass: 0.7 } });
  const noteFade = interpolate(frame, [2 * p + p * 0.08, 2 * p + p * 0.6], [1, 0.08], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const noteForget = interpolate(frame, [2 * p, 2 * p + p * 0.55], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const codeFont = S * 0.021;
  const rowH = codeFont * 1.9;
  const editorRadius = S * 0.028;

  const editorStyle: React.CSSProperties = portrait
    ? { flex: '0 0 auto', width: '100%' }
    : { flex: '1.75 1 0', minWidth: 0 };
  const memoryStyle: React.CSSProperties = portrait
    ? { flex: '0 0 auto', width: '100%' }
    : { flex: '1 1 0', minWidth: 0 };

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: THEME.font,
        flexDirection: 'column',
        gap: S * 0.045,
      }}
    >
      <div
        style={{
          width: contentW,
          display: 'flex',
          flexDirection: portrait ? 'column' : 'row',
          alignItems: 'stretch',
          gap: S * 0.03,
          transform: `translateY(${shellRise}px)`,
          opacity: shellFade,
        }}
      >
        {/* ---------------- Editor / chat window ---------------- */}
        <div
          style={{
            ...editorStyle,
            position: 'relative',
            borderRadius: editorRadius,
            background: 'rgba(255,255,255,0.045)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 40px 120px rgba(0,0,0,0.55)',
            overflow: 'hidden',
          }}
        >
          {/* title bar — amber chrome accent */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: S * 0.012,
              padding: `${S * 0.018}px ${S * 0.022}px`,
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              background: 'linear-gradient(180deg, rgba(245,181,68,0.10), rgba(245,181,68,0))',
            }}
          >
            {[THEME.amber, THEME.amberDeep, THEME.textFaint].map((c, i) => (
              <span key={i} style={{ width: S * 0.014, height: S * 0.014, borderRadius: 999, background: c, opacity: 0.85 }} />
            ))}
            <span
              style={{
                marginInlineStart: S * 0.02,
                fontSize: S * 0.02,
                fontWeight: 700,
                color: THEME.textSoft,
                borderBottom: `2px solid ${THEME.amber}`,
                paddingBottom: S * 0.006,
              }}
            >
              auth.ts
            </span>
          </div>

          {/* code body (desaturates + clears on cold reset) */}
          <div
            style={{
              position: 'relative',
              padding: `${S * 0.026}px ${S * 0.028}px`,
              minHeight: rowH * 6.4,
              filter: `saturate(${1 - cold}) brightness(${1 - cold * 0.28})`,
            }}
          >
            {lines.map((tokens, i) => {
              const lineStart = p * 0.06 + i * p * 0.12;
              const enter = spring({ frame: frame - lineStart, fps, config: { damping: 22, mass: 0.6 } });
              const isLastCode = i === lines.length - 2; // the `return user` line
              return (
                <div
                  key={i}
                  style={{
                    height: rowH,
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: codeFont,
                    fontFamily: 'ui-monospace, "Cascadia Code", Menlo, monospace',
                    fontWeight: 600,
                    whiteSpace: 'pre',
                    opacity: enter * (1 - cold * 0.9),
                    transform: `translateX(${interpolate(enter, [0, 1], [-14, 0])}px)`,
                  }}
                >
                  <span
                    style={{
                      width: S * 0.03,
                      color: THEME.textFaint,
                      opacity: 0.5,
                      fontSize: codeFont * 0.82,
                    }}
                  >
                    {i + 1}
                  </span>
                  {tokens.map((tk, j) => (
                    <span key={j} style={{ color: tk.c }}>
                      {tk.t}
                    </span>
                  ))}
                  {isLastCode ? (
                    <span
                      style={{
                        display: 'inline-block',
                        width: codeFont * 0.12,
                        height: codeFont,
                        marginInlineStart: codeFont * 0.2,
                        background: THEME.amber,
                        opacity: caret > 0.5 ? 0.9 * (1 - cold) : 0.05,
                      }}
                    />
                  ) : null}
                </div>
              );
            })}

            {/* p1 — AI suggestion bubble with a hallucinated variable */}
            <div
              style={{
                marginTop: S * 0.02,
                display: 'flex',
                gap: S * 0.014,
                alignItems: 'flex-start',
                opacity: bubbleEnter * (1 - cold),
                transform: `translateY(${interpolate(bubbleEnter, [0, 1], [16, 0])}px)`,
              }}
            >
              <span
                style={{
                  flex: '0 0 auto',
                  width: S * 0.028,
                  height: S * 0.028,
                  borderRadius: 999,
                  background: `linear-gradient(180deg, ${THEME.indigo}, ${THEME.indigo}88)`,
                  boxShadow: `0 0 ${S * 0.02 * bubbleGlow}px ${THEME.indigo}`,
                }}
              />
              <div
                style={{
                  flex: 1,
                  borderRadius: S * 0.018,
                  background: 'rgba(79,107,237,0.12)',
                  border: '1px solid rgba(79,107,237,0.4)',
                  padding: `${S * 0.016}px ${S * 0.018}px`,
                }}
              >
                <ShimmerSweep delayFrames={bubbleStart} style={{ marginBottom: S * 0.008 }}>
                  <div style={{ fontSize: S * 0.015, fontWeight: 700, color: THEME.textFaint, letterSpacing: 0.4 }}>
                    AI SUGGESTION
                  </div>
                </ShimmerSweep>
                <div
                  style={{
                    fontSize: codeFont,
                    fontFamily: 'ui-monospace, "Cascadia Code", Menlo, monospace',
                    fontWeight: 600,
                    color: THEME.textSoft,
                    whiteSpace: 'pre-wrap',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: S * 0.008,
                  }}
                >
                  <span>
                    <span style={{ color: kw }}>const</span> cached = {' '}
                    <span
                      style={{
                        color: RED,
                        textDecoration: 'underline',
                        textDecorationStyle: 'wavy',
                        textDecorationColor: RED,
                        textUnderlineOffset: codeFont * 0.22,
                      }}
                    >
                      ctxCache
                    </span>
                    <span style={{ color: punct }}>.get(id)</span>
                  </span>
                  <span
                    style={{
                      opacity: badgeEnter,
                      transform: `scale(${interpolate(badgeEnter, [0, 1], [0.7, 1])})`,
                      fontSize: S * 0.014,
                      fontWeight: 800,
                      color: RED,
                      background: 'rgba(239,68,68,0.14)',
                      border: '1px solid rgba(239,68,68,0.5)',
                      borderRadius: 999,
                      padding: `${S * 0.004}px ${S * 0.01}px`,
                    }}
                  >
                    undefined
                  </span>
                </div>
              </div>
            </div>

            {/* p3 — cold-blue reset tint */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                background: `linear-gradient(180deg, rgba(90,150,225,${cold * 0.22}), rgba(60,110,200,${cold * 0.32}))`,
                boxShadow: `inset 0 0 ${S * 0.12}px rgba(120,180,240,${cold * 0.35})`,
              }}
            />
          </div>

          {/* p3 — frost "cold start" indicator */}
          <div
            style={{
              position: 'absolute',
              top: S * 0.06,
              insetInlineEnd: S * 0.024,
              display: 'flex',
              alignItems: 'center',
              gap: S * 0.01,
              padding: `${S * 0.008}px ${S * 0.014}px`,
              borderRadius: 999,
              background: 'rgba(120,180,240,0.14)',
              border: '1px solid rgba(150,200,245,0.5)',
              boxShadow: `0 0 ${S * 0.03 * frostGlow}px rgba(150,200,245,0.55)`,
              opacity: frost,
              transform: `scale(${interpolate(frost, [0, 1], [0.7, 1])})`,
            }}
          >
            <Snowflake size={S * 0.022} color="#bfe0ff" />
            <span style={{ fontSize: S * 0.016, fontWeight: 800, color: '#dcefff', letterSpacing: 0.4 }}>cold start</span>
          </div>

          {/* amber border beam — the editor chrome "lights up" travelling the border */}
          <BorderBeam thickness={1} colorFrom={THEME.amber} colorTo={THEME.amberDeep} />
        </div>

        {/* ---------------- Memory side panel ---------------- */}
        <div
          style={{
            ...memoryStyle,
            borderRadius: editorRadius,
            background: 'rgba(255,255,255,0.045)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 40px 120px rgba(0,0,0,0.55)',
            padding: S * 0.024,
            display: 'flex',
            flexDirection: 'column',
            gap: S * 0.016,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: S * 0.012 }}>
            <span style={{ width: S * 0.014, height: S * 0.014, borderRadius: 999, background: THEME.indigo }} />
            <span style={{ fontSize: S * 0.022, fontWeight: 800, color: THEME.textStrong }}>Memory</span>
          </div>

          {/* the forgotten note */}
          <div
            style={{
              position: 'relative',
              borderRadius: S * 0.016,
              background: 'rgba(255,255,255,0.04)',
              border: '1px dashed rgba(255,255,255,0.18)',
              padding: S * 0.018,
              opacity: noteBase * noteFade,
              filter: `grayscale(${noteForget}) blur(${noteForget * 1.4}px)`,
            }}
          >
            <div style={{ fontSize: S * 0.014, fontWeight: 700, color: THEME.textFaint, marginBottom: S * 0.008 }}>YESTERDAY</div>
            <div style={{ position: 'relative', fontSize: S * 0.018, fontWeight: 600, color: THEME.textSoft, lineHeight: 1.4 }}>
              switched DB to Postgres
              {/* strike-through that draws across as it is forgotten */}
              <span
                style={{
                  position: 'absolute',
                  insetInlineStart: 0,
                  top: '50%',
                  height: 2,
                  width: `${noteForget * 100}%`,
                  background: THEME.textFaint,
                }}
              />
            </div>
          </div>

          {/* faint ghosts of older notes to give the panel body */}
          {[0.32, 0.2].map((op, i) => (
            <div
              key={i}
              style={{
                borderRadius: S * 0.014,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                padding: S * 0.014,
                opacity: op * noteBase * (1 - cold * 0.6),
              }}
            >
              <div style={{ height: S * 0.01, width: '70%', borderRadius: 999, background: 'rgba(255,255,255,0.14)' }} />
              <div style={{ height: S * 0.01, width: '45%', borderRadius: 999, background: 'rgba(255,255,255,0.1)', marginTop: S * 0.008 }} />
            </div>
          ))}
        </div>
      </div>

      <CaptionRail slide={slide} durationFrames={durationFrames} width={width} />
    </AbsoluteFill>
  );
};
