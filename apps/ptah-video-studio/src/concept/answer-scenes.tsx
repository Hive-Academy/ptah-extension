/**
 * answer-scenes — the "Ptah answers Xirp" reel (promos/ptah-xirp-answer.json).
 *
 * Five acts, flat 2D, hard cuts. Deliberately no 3D and no camera moves: the
 * reference this answers carries a whole 64s promo on typography, staggered
 * multiply, a logo build and one object wipe. See xirp-kit.tsx for the six
 * devices these scenes are assembled from.
 *
 * Every scene paces itself off `durationFrames`, so a slide grows or shrinks
 * with its narration clip without leaving a frozen tail.
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ConceptSceneProps } from '../PromoReel';
import {
  AMBER,
  INK,
  INTER_FAMILY,
  MONO_FAMILY,
  TEXT_FAINT,
  TEXT_SOFT,
  TEXT_STRONG,
} from './story-kit';
import {
  AppWindow,
  DocIcon,
  Flat,
  GOLD_LIGHT,
  LAPIS,
  PtahLogo,
  easeInOut,
  ShapeBurst,
  TypeOn,
  VendorIcon,
  WordFill,
  displayStyle,
  easeOut,
  monoStyle,
  progress,
  sessionLines,
  stagger,
  type VendorKey,
} from './xirp-kit';

/** Stage scale — all sizes below are authored against a 1920-wide frame. */
const useScale = () => useVideoConfig().width / 1920;

// ── Act 1a — session sprawl ──────────────────────────────────────────────────

const SPRAWL: VendorKey[] = [
  'claude', 'codex', 'gemini', 'claude', 'copilot', 'gemini',
  'codex', 'claude', 'gemini', 'copilot', 'codex', 'claude',
];

/**
 * One window becomes twelve. The stack is an isometric cascade offset down and
 * right, newest on top — the literal render of "one session, then three, then a
 * dozen, none of them aware of the others".
 */
export const AnswerSprawl: React.FC<ConceptSceneProps> = ({ durationFrames }) => {
  const frame = useCurrentFrame();
  const s = useScale();
  const { width, height } = useVideoConfig();

  const winW = Math.round(780 * s);
  const winH = Math.round(470 * s);
  const stepX = Math.round(42 * s);
  const stepY = Math.round(31 * s);

  // Windows appear across the first 72% of the slide, then the whole stack
  // drifts back and dims — "you are not in control of this any more".
  const buildEnd = Math.round(durationFrames * 0.72);
  const driftP = easeOut(progress(frame, buildEnd, durationFrames));

  return (
    <AbsoluteFill style={{ background: INK }}>
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          transform: `scale(${1 - driftP * 0.14}) translateY(${driftP * -18 * s}px)`,
        }}
      >
        <div style={{ position: 'relative', width, height }}>
          {SPRAWL.map((vendor, i) => {
            const p = stagger(frame, i, SPRAWL.length, 6, buildEnd, 12);
            if (p <= 0) return null;
            const e = easeOut(p);
            // Centre the whole cascade: the stack grows down-right from an
            // origin offset back by half its total travel.
            const originX = width / 2 - winW / 2 - (SPRAWL.length * stepX) / 2;
            const originY = height / 2 - winH / 2 - (SPRAWL.length * stepY) / 2;
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: originX + i * stepX,
                  top: originY + i * stepY,
                  opacity: e,
                  transform: `translate(${(1 - e) * 26 * s}px, ${(1 - e) * 18 * s}px) scale(${0.97 + e * 0.03})`,
                  zIndex: i,
                }}
              >
                <AppWindow
                  width={winW}
                  height={winH}
                  vendor={vendor}
                  lines={sessionLines(vendor, i + 1)}
                  // Buried windows recede behind an ink scrim so the newest
                  // stays legible without the stack becoming a grey smear.
                  fade={0.55 + 0.45 * (i / (SPRAWL.length - 1))}
                />
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Act 1b — siloed context ──────────────────────────────────────────────────

const DOCS = ['AGENTS.md', 'CLAUDE.md', '.mcp.json', 'skills/', 'settings.json'];

/**
 * The config files appear one at a time, then vanish one at a time — the setup
 * you built by hand, invisible to everyone else on the team.
 */
export const AnswerSilo: React.FC<ConceptSceneProps> = ({ durationFrames }) => {
  const frame = useCurrentFrame();
  const s = useScale();

  const inEnd = Math.round(durationFrames * 0.52);
  const outStart = Math.round(durationFrames * 0.64);

  return (
    <AbsoluteFill style={{ background: INK, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', gap: Math.round(88 * s), alignItems: 'flex-end' }}>
        {DOCS.map((name, i) => {
          const appear = stagger(frame, i, DOCS.length, 4, inEnd, 12);
          // Vanish in the SAME order they arrived, so the eye tracks the loss.
          const vanish = stagger(frame, i, DOCS.length, outStart, durationFrames - 6, 10);
          const p = appear * (1 - vanish);
          if (p <= 0.001) return null;
          return <DocIcon key={name} name={name} size={Math.round(124 * s)} p={p} />;
        })}
      </div>
    </AbsoluteFill>
  );
};

// ── Act 1c — the ask ─────────────────────────────────────────────────────────

/** Full-frame terminal, prompt typed live. The moment before the work starts. */
export const AnswerAsk: React.FC<ConceptSceneProps> = ({ durationFrames }) => {
  const frame = useCurrentFrame();
  const s = useScale();
  const typeP = progress(frame, Math.round(durationFrames * 0.1), Math.round(durationFrames * 0.72));

  return (
    <AbsoluteFill style={{ background: INK, alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          width: '78%',
          background: '#0b0d11',
          border: '1px solid rgba(255,255,255,0.09)',
          borderRadius: Math.round(14 * s),
          padding: `${Math.round(52 * s)}px ${Math.round(58 * s)}px`,
          boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
        }}
      >
        <div
          style={{
            ...monoStyle(s),
            fontSize: Math.round(21 * s),
            color: TEXT_FAINT,
            marginBottom: Math.round(30 * s),
          }}
        >
          ~/apps/ptah-license-server
        </div>
        <div style={{ ...monoStyle(s), display: 'flex', gap: '0.6em' }}>
          <span style={{ color: AMBER }}>&rsaquo;</span>
          <TypeOn
            text="add Paddle webhook retries with idempotency"
            p={typeP}
            color={TEXT_STRONG}
          />
        </div>
        <div
          style={{
            ...monoStyle(s),
            fontSize: Math.round(18 * s),
            color: 'rgba(255,255,255,0.28)',
            marginTop: Math.round(34 * s),
          }}
        >
          one agent · one session · no memory of yesterday
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── Act 2 / 5 — the brand ident ──────────────────────────────────────────────

/**
 * Full-bleed lapis flash carrying the real medallion. It strikes in, the
 * wordmark types after it, then the wordmark reverses out before the cut. Used
 * twice — Act 2 stinger and the end-card open — the way the reference reuses
 * its ident.
 */
export const AnswerIdent: React.FC<ConceptSceneProps> = ({ durationFrames }) => {
  const frame = useCurrentFrame();
  const s = useScale();

  const revealP = progress(frame, Math.round(durationFrames * 0.04), Math.round(durationFrames * 0.44));
  const wordP = progress(frame, Math.round(durationFrames * 0.42), Math.round(durationFrames * 0.68));
  // Reverse-out: the wordmark un-types before the cut, same as the reference.
  const outP = progress(frame, Math.round(durationFrames * 0.84), durationFrames);
  const word = wordP * (1 - outP);

  return (
    <Flat color={LAPIS}>
      <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(30 * s) }}>
        <PtahLogo size={Math.round(230 * s)} reveal={revealP} />
        <span
          style={{
            fontFamily: INTER_FAMILY,
            fontSize: Math.round(126 * s),
            fontWeight: 700,
            letterSpacing: '-0.04em',
            color: GOLD_LIGHT,
          }}
        >
          <TypeOn text="Ptah" p={word} caret={false} />
        </span>
      </div>
    </Flat>
  );
};

// ── Act 3b — the vendor row + equation ───────────────────────────────────────

const ROW: { key: VendorKey; name: string; by: string }[] = [
  { key: 'claude', name: 'Claude', by: 'by Anthropic' },
  { key: 'gemini', name: 'Gemini', by: 'by Google' },
  { key: 'codex', name: 'Codex', by: 'by OpenAI' },
  { key: 'copilot', name: 'Copilot', by: 'by GitHub' },
];

/**
 * The four vendors land as equal citizens, then the integration claim: Ptah
 * drives each vendor's OFFICIAL agent SDK under the user's own account, so
 * nothing here is scraping or key-sharing and no subscription is at risk. That
 * reassurance is the first question every developer asks about a tool that sits
 * on top of paid AI subscriptions, so it gets its own line on screen.
 */
export const AnswerVendors: React.FC<ConceptSceneProps> = ({ durationFrames }) => {
  const frame = useCurrentFrame();
  const s = useScale();

  const rowEnd = Math.round(durationFrames * 0.4);
  const lineP = progress(frame, Math.round(durationFrames * 0.44), Math.round(durationFrames * 0.68));
  const safeP = progress(frame, Math.round(durationFrames * 0.66), Math.round(durationFrames * 0.9));

  return (
    <AbsoluteFill style={{ background: INK, alignItems: 'center', justifyContent: 'center' }}>
      {/* Lifted clear of the bottom subtitle rail — this is the tallest scene in
          the reel and its safety pill lands exactly where CaptionRail sits. */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: Math.round(64 * s),
          transform: `translateY(${Math.round(-92 * s)}px)`,
        }}
      >
        {/* All four stay mounted at opacity 0 so the row's width never changes —
            conditionally rendering them would re-centre the flex row on every
            arrival and the whole group would visibly slide. */}
        <div style={{ display: 'flex', gap: Math.round(72 * s) }}>
          {ROW.map((vendor, i) => {
            const p = easeOut(stagger(frame, i, ROW.length, 4, rowEnd, 12));
            return (
              <div
                key={vendor.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: Math.round(18 * s),
                  opacity: p,
                  transform: `translateY(${(1 - p) * 18 * s}px)`,
                }}
              >
                <VendorIcon vendor={vendor.key} size={Math.round(66 * s)} />
                <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                  <span
                    style={{
                      fontFamily: INTER_FAMILY,
                      fontSize: Math.round(38 * s),
                      fontWeight: 700,
                      color: TEXT_STRONG,
                      letterSpacing: '-0.02em',
                    }}
                  >
                    {vendor.name}
                  </span>
                  <span
                    style={{
                      fontFamily: INTER_FAMILY,
                      fontSize: Math.round(25 * s),
                      color: TEXT_FAINT,
                    }}
                  >
                    {vendor.by}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: Math.round(22 * s),
            opacity: easeOut(lineP),
            transform: `translateY(${(1 - easeOut(lineP)) * 14 * s}px)`,
          }}
        >
          {/* The medallion is a detailed raster — below ~100px the rim engraving
              and inner glyphs turn to mush, so inline uses stay generous. */}
          <PtahLogo size={Math.round(112 * s)} reveal={lineP} glow={false} />
          <span
            style={{
              fontFamily: INTER_FAMILY,
              fontSize: Math.round(54 * s),
              fontWeight: 600,
              color: TEXT_STRONG,
              letterSpacing: '-0.025em',
            }}
          >
            Ptah drives their official agent SDKs.
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: Math.round(16 * s),
            opacity: easeOut(safeP),
            transform: `translateY(${(1 - easeOut(safeP)) * 12 * s}px)`,
            padding: `${Math.round(14 * s)}px ${Math.round(30 * s)}px`,
            borderRadius: 999,
            border: `1px solid ${AMBER}44`,
            background: `${AMBER}14`,
          }}
        >
          <span
            style={{
              fontFamily: INTER_FAMILY,
              fontSize: Math.round(30 * s),
              fontWeight: 500,
              color: TEXT_SOFT,
              letterSpacing: '-0.015em',
            }}
          >
            Your accounts. Your subscriptions.{' '}
            <span style={{ color: AMBER, fontWeight: 700 }}>Nothing to get banned.</span>
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── Act 4 — the statement + shape burst ──────────────────────────────────────

/**
 * A two-line claim that fills word by word, with brand shapes rising underneath
 * once the line has landed. `slide.captions[0]` supplies the copy so the spec
 * stays the single source of on-screen text.
 */
export const AnswerStatement: React.FC<ConceptSceneProps> = ({ slide, durationFrames }) => {
  const frame = useCurrentFrame();
  const s = useScale();
  const { width, height } = useVideoConfig();

  const text = slide.captions?.[0] ?? slide.caption ?? '';
  const fillP = progress(frame, Math.round(durationFrames * 0.08), Math.round(durationFrames * 0.62));
  const burstFrom = Math.round(durationFrames * 0.42);
  const burstP = progress(frame, burstFrom, burstFrom + 12);

  return (
    <AbsoluteFill style={{ background: INK }}>
      <ShapeBurst
        frame={Math.max(0, frame - burstFrom)}
        width={width}
        height={height}
        count={34}
        p={burstP}
      />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: '0 14%' }}>
        <div style={{ ...displayStyle(s, 700), fontSize: Math.round(78 * s), position: 'relative' }}>
          <WordFill text={text} p={fillP} strong={TEXT_STRONG} dim="rgba(255,255,255,0.22)" />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Act 4b — the mark wipe ───────────────────────────────────────────────────

/**
 * Object-as-transition: a logo iris. The medallion lands, then the end card's
 * lapis field grows out of it as a circle until it owns the frame — the mark
 * literally becomes the next scene's background.
 *
 * An earlier pass flew the medallion at the lens and off the top. It read as a
 * giant cropped disc drifting through frame with no legible subject, which is
 * the failure mode of scaling a detailed round mark past the frame edge.
 */
export const AnswerWipe: React.FC<ConceptSceneProps> = ({ durationFrames }) => {
  const frame = useCurrentFrame();
  const s = useScale();
  const { width, height } = useVideoConfig();

  const land = easeOut(progress(frame, 0, Math.round(durationFrames * 0.45)));
  const iris = easeInOut(progress(frame, Math.round(durationFrames * 0.34), durationFrames));

  // The circle must reach the frame corners, not just the edges.
  const maxR = Math.hypot(width, height) / 2;
  const size = Math.round(230 * s);

  return (
    <AbsoluteFill style={{ background: INK, overflow: 'hidden' }}>
      {/* Lapis iris, growing from the exact centre the medallion sits on. */}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            width: maxR * 2,
            height: maxR * 2,
            // AbsoluteFill is a COLUMN flexbox, so without this the circle's
            // height gets shrunk to the frame while its width overflows, and
            // the iris renders as a wide ellipse instead of a circle.
            flexShrink: 0,
            borderRadius: '50%',
            background: LAPIS,
            transform: `scale(${iris})`,
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ transform: `scale(${0.85 + land * 0.15})` }}>
          <PtahLogo size={size} reveal={land} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Act 5 — the end card ─────────────────────────────────────────────────────

/** Full-bleed lapis close: medallion, claim, URL typed on. */
export const AnswerEndCard: React.FC<ConceptSceneProps> = ({ durationFrames }) => {
  const frame = useCurrentFrame();
  const s = useScale();

  const revealP = progress(frame, 2, Math.round(durationFrames * 0.3));
  const wordP = progress(frame, Math.round(durationFrames * 0.24), Math.round(durationFrames * 0.42));
  const claimP = progress(frame, Math.round(durationFrames * 0.4), Math.round(durationFrames * 0.72));
  const urlP = progress(frame, Math.round(durationFrames * 0.68), Math.round(durationFrames * 0.9));

  return (
    <Flat color={LAPIS}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: Math.round(34 * s),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(22 * s) }}>
          <PtahLogo size={Math.round(178 * s)} reveal={revealP} />
          <span
            style={{
              fontFamily: INTER_FAMILY,
              fontSize: Math.round(76 * s),
              fontWeight: 700,
              letterSpacing: '-0.04em',
              color: GOLD_LIGHT,
            }}
          >
            <TypeOn text="Ptah" p={wordP} caret={false} />
          </span>
        </div>

        <div style={{ ...displayStyle(s, 700), fontSize: Math.round(54 * s), maxWidth: '70%' }}>
          <WordFill
            text="The orchestra layer between AI agents and your codebase."
            p={claimP}
            strong={TEXT_STRONG}
            dim="rgba(255,255,255,0.22)"
          />
        </div>

        <div
          style={{
            fontFamily: MONO_FAMILY,
            fontSize: Math.round(36 * s),
            fontWeight: 600,
            color: GOLD_LIGHT,
            marginTop: Math.round(10 * s),
          }}
        >
          <TypeOn text="ptah.live" p={urlP} caret={false} />
        </div>
      </div>
    </Flat>
  );
};
