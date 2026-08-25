/**
 * PromoReel — capture-free concept-promo composition.
 *
 * Each "slide" renders an animated CONCEPT SCENE that demonstrates one idea —
 * instead of text that describes it. A spoken line and word-synced captions sit
 * over the component; the animation itself carries the message.
 *
 * Driven by `scripts/render-promo.mjs`, which reads a spec from
 * `promos/<slug>.json`, narrates its `vo` lines, stages music + SFX, and renders
 * this composition. Landscape (1920x1080) or vertical (1080x1920) via `format`.
 *
 * A shared cinematic layer (Backdrop → AnimatedGridPattern → AmbientOrbs →
 * Particles) sits behind every scene, and PromoSoundDesign ducks the music bed
 * under narration + fires a whoosh at each slide cut. Scene components live in
 * `src/concept/` and are looked up by `slide.scene` against CONCEPT_SCENES.
 */
import React from 'react';
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { AmbientOrbs } from './components/AmbientOrbs';
import { Backdrop } from './components/Backdrop';
import { PromoSoundDesign, type VoWindow } from './components/PromoSoundDesign';
import { Watermark } from './components/Watermark';
import { AnimatedGridPattern, Particles } from './components/effects';
import { CONCEPT_SCENES } from './concept';
import { CaptionRail, SfxProvider } from './concept/scene-kit';
import { TerminalPlayer, type TuiFramesData } from './components/TerminalPlayer';
import { THEME } from './theme';

export const PROMO_FPS = 30;

/** Scenes built on the NEW amber/emerald operator stage — these get the calmed
 *  emerald center glow; all others keep the legacy dim-blue backdrop. */
const NEW_STAGE_SCENES = new Set<string>([
  'asset-sheet',
  'agent-showcase',
  'state-of-art-proof',
  'glass-hero',
  'story-hook',
  'story-positioning',
  'story-wizard',
  'story-orchestration',
  'story-foundation',
  'story-lifecycle',
  'story-proof',
  'story-cta',
  'builders-hook',
  'builders-promise',
  'builders-cohort',
  'builders-course',
  'builders-vault',
  'builders-room',
  'builders-proof',
  'builders-offer',
]);

/** Extra on-screen breath after each scene's timeline ends. */
const BREATH_MS = 420;
/** Default scene hold when a slide sets no explicit holdMs. */
const DEFAULT_HOLD_MS = 7000;

export interface PromoSlide {
  /**
   * `scene` renders a concept component; `capture` plays real product footage
   * full-frame (the Xirp-style act — no device frame, no virtual camera, the
   * recording carries itself).
   */
  kind: 'scene' | 'capture' | 'terminal';
  /** Concept-scene key (see the CONCEPT_SCENES registry in src/concept). */
  scene?: string;
  /**
   * `kind: 'capture'` only — staticFile-relative video staged into the promo's
   * public dir by render-promo.mjs's stageCaptures().
   */
  src?: string;
  /** `kind: 'capture'` only — source scene slug, resolved by render-promo.mjs. */
  capture?: string;
  /**
   * `kind: 'capture'` only — use the scene's composited `out/<slug>.mp4` instead
   * of its clean `raw.webm`. Off by default: the rendered file already carries
   * baked captions, a device frame and the watermark.
   */
  captureRendered?: boolean;
  /**
   * `kind: 'terminal'` only — scene slug whose `tui-frames.json` to play.
   * render-promo.mjs inlines the resolved grids onto `frames`.
   */
  terminal?: string;
  /** `kind: 'terminal'` only — per-frame grids, inlined by render-promo.mjs. */
  frames?: TuiFramesData;
  /** `kind: 'capture' | 'terminal'` — where to start inside the recording. */
  startFromMs?: number;
  /**
   * Cut style INTO the next slide. Defaults to the legacy cross-fade; `cut`
   * gives the hard flash cuts a flat 2D reel needs (a fade between a black
   * frame and a full-bleed amber frame reads as a muddy brown wash).
   */
  transition?: 'cut' | 'xfade';
  /**
   * Sequential captions the scene cross-fades through across its duration —
   * one per narration beat. The scene paces them off `durationFrames`.
   */
  captions?: string[];
  /** Legacy single caption (fallback when `captions` is absent). */
  caption?: string;
  /**
   * One multi-sentence spoken script played over the whole evolving scene.
   * Its clip length drives the slide's hold.
   */
  vo?: string;
  /** Scene animation length in ms (the VO clip extends it if longer). */
  holdMs?: number;
  /**
   * Real per-caption timing windows (clip-relative ms), resolved by
   * render-promo.mjs from the VO clip's word alignment (ElevenLabs only).
   * `CaptionRail`/`PhaseStage` use these instead of an even 1/N slice when
   * present. Absent for kokoro (no alignment) → even-slice fallback.
   */
  captionWindowsMs?: { startMs: number; endMs: number }[];
  /**
   * Verbatim per-word VO timing (clip-relative ms). `CaptionRail` renders
   * these word-synced (TikTok-style) instead of the paraphrased captions when
   * present. Absent for kokoro → paraphrased-caption fallback.
   */
  voWordsMs?: { text: string; startMs: number; endMs: number }[];
}

/** Which language a scene renders its baked-in UI text in. */
export type Locale = 'ar' | 'en';

/**
 * Props every concept scene receives. `durationFrames` is the slide's full
 * on-screen length (including the exit xfade) so a scene can pace its phased
 * reveals and caption cross-fades to fill exactly — no dead, frozen tail.
 */
export type ConceptSceneProps = {
  slide: PromoSlide;
  durationFrames: number;
  locale: Locale;
  /** Cut-beat SFX for the scene's own `PhaseStage` phase transitions, if staged. */
  whooshSrc?: string;
};

export interface PromoSpec {
  slug: string;
  title?: string;
  format?: 'vertical' | 'landscape';
  /** BCP-47-ish tag; an "ar…" value implies RTL unless `rtl` is set. */
  lang?: string;
  /** Force right-to-left layout (defaults from `lang`). */
  rtl?: boolean;
  /** Narration engine/voice/model overrides consumed by render-promo.mjs. */
  engine?: 'kokoro' | 'elevenlabs';
  voice?: string;
  model?: string;
  /** ElevenLabs delivery controls (consumed by render-promo.mjs). */
  speed?: number;
  stability?: number;
  similarity?: number;
  style?: number;
  /** Music-bed filename in assets/music/ (null disables); consumed by render-promo.mjs. */
  music?: string | null;
  /** Music-bed volume 0..1 override. */
  musicVolume?: number;
  /**
   * Skip the shared cinematic backdrop (Backdrop + grid + orbs + particles).
   * Flat 2D reels own their own background per scene — leaving the ambient
   * layer on washes every hard-cut flat fill with drifting orbs.
   */
  bare?: boolean;
  /**
   * Burn word-synced subtitles of the ACTUAL narration along the bottom.
   * Opt-in per spec: scenes built on `PhaseStage` render their own CaptionRail
   * internally, so switching this on for those reels would double the captions.
   */
  subtitles?: boolean;
  slides: PromoSlide[];
}

/** Whether a spec renders right-to-left (explicit flag, else Arabic lang). */
export function promoIsRtl(spec: PromoSpec): boolean {
  return spec.rtl ?? /^ar/i.test(spec.lang ?? '');
}

/** Scene-UI language for a spec — English when `lang` starts "en", else Arabic. */
export function promoLocale(spec: PromoSpec): Locale {
  return /^en/i.test(spec.lang ?? '') ? 'en' : 'ar';
}

// Type alias (not interface) so the implicit index signature satisfies
// Remotion's `Record<string, unknown>` composition-props constraint.
export type PromoReelProps = {
  spec: PromoSpec;
  /** Per-slide narration clip length in ms (null = no clip). */
  clipDurationsMs: (number | null)[];
  /** Slide index -> staticFile-relative wav path (public dir = scene dir). */
  narrationFiles: Record<number, string>;
  /** staticFile-relative music-bed path (public dir = scene dir); loops under all slides. */
  musicFile?: string;
  /** Music-bed volume 0..1 (default 0.28). */
  musicVolume?: number;
  /** staticFile-relative cut-beat whoosh (staged by render-promo.mjs's stagePromoSfx). */
  whooshFile?: string;
  /** staticFile-relative UI tick (staged by stagePromoSfx) — see SfxProvider/NumberTicker. */
  tickFile?: string;
  /** staticFile-relative success chime (staged by stagePromoSfx) — scenes opt in at a real success beat. */
  chimeFile?: string;
};

export function promoDims(spec: PromoSpec): { width: number; height: number } {
  return spec.format === 'landscape'
    ? { width: 1920, height: 1080 }
    : { width: 1080, height: 1920 };
}

/**
 * Per-slide hold in ms. The scene's own animation length (`holdMs`) drives
 * pacing; if the VO clip is longer, it extends the hold so the line never gets
 * cut. Breath is added after.
 */
function slideHoldMs(slide: PromoSlide, clipMs: number | null | undefined): number {
  const vo = clipMs && clipMs > 0 ? clipMs : 0;
  const explicit = slide.holdMs ?? 0;
  const base = Math.max(vo, explicit);
  return (base > 0 ? base : DEFAULT_HOLD_MS) + BREATH_MS;
}

export function promoDurationInFrames(
  spec: PromoSpec,
  clipDurationsMs: (number | null)[] = [],
): number {
  const totalMs = spec.slides.reduce(
    (acc, slide, i) => acc + slideHoldMs(slide, clipDurationsMs[i]),
    0,
  );
  return Math.max(1, Math.round((totalMs / 1000) * PROMO_FPS));
}

/** Cross-slide transition length (frames) — scenes fade over each other. */
const XFADE_FRAMES = 8;

/** Fallback when a spec names a scene key that isn't registered yet. */
const MissingScene: React.FC<ConceptSceneProps> = ({ slide }) => {
  const { width } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: THEME.font,
        padding: '0 8%',
        textAlign: 'center',
        color: THEME.textSoft,
        fontSize: Math.round(width * 0.04),
        fontWeight: 700,
      }}
    >
      {slide.caption ?? `scene "${slide.scene ?? ''}" not found`}
    </AbsoluteFill>
  );
};

/** Per-slide exit cross-fade length — zero when the spec asks for a hard cut. */
function xfadeFramesFor(slide: PromoSlide): number {
  return slide.transition === 'cut' ? 0 : XFADE_FRAMES;
}

/**
 * Real product footage, full-frame. No DeviceFrame and no virtual camera: this
 * is the Xirp-style product act, where the recording is the whole shot. Muted,
 * because the source mp4s carry their own narration.
 */
const CaptureSlide: React.FC<{ slide: PromoSlide }> = ({ slide }) => {
  if (!slide.src) return <MissingScene slide={slide} durationFrames={0} locale="en" />;
  return (
    <AbsoluteFill style={{ backgroundColor: THEME.bg }}>
      <OffthreadVideo
        src={staticFile(slide.src)}
        startFrom={Math.round(((slide.startFromMs ?? 0) / 1000) * PROMO_FPS)}
        muted
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </AbsoluteFill>
  );
};

const Slide: React.FC<{
  slide: PromoSlide;
  durationFrames: number;
  locale: Locale;
  whooshSrc?: string;
  subtitles?: boolean;
}> = ({ slide, durationFrames, locale, whooshSrc, subtitles }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const xfade = xfadeFramesFor(slide);
  // Fade the whole scene out over its last XFADE frames so cuts feel soft.
  // A `cut` slide skips this entirely — see PromoSlide.transition.
  const exit =
    xfade === 0
      ? 1
      : interpolate(frame, [durationFrames - xfade, durationFrames], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });

  const Scene = (slide.scene && CONCEPT_SCENES[slide.scene]) || MissingScene;

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      {slide.kind === 'terminal' ? (
        slide.frames ? (
          <AbsoluteFill style={{ backgroundColor: THEME.bg }}>
            <TerminalPlayer data={slide.frames} startFromMs={slide.startFromMs} />
          </AbsoluteFill>
        ) : (
          <MissingScene slide={slide} durationFrames={0} locale="en" />
        )
      ) : slide.kind === 'capture' ? (
        <CaptureSlide slide={slide} />
      ) : (
        <Scene slide={slide} durationFrames={durationFrames} locale={locale} whooshSrc={whooshSrc} />
      )}
      {/* Subtitles sit ABOVE the scene so a capture slide's footage never
          covers them. CaptionRail returns null when a slide has no narration,
          so silent slides (ident, wipe) stay clean. */}
      {subtitles ? (
        <CaptionRail slide={slide} durationFrames={durationFrames} width={width} />
      ) : null}
    </AbsoluteFill>
  );
};

export const PromoReel: React.FC<PromoReelProps> = ({
  spec,
  clipDurationsMs,
  narrationFiles,
  musicFile,
  musicVolume = 0.28,
  whooshFile,
  tickFile,
  chimeFile,
}) => {
  const { height } = useVideoConfig();
  const slides = spec.slides ?? [];
  // `direction` is an inherited CSS property, so setting it once on the root
  // flips every scene's text and flex flow to right-to-left for Arabic promos.
  const dir = promoIsRtl(spec) ? 'rtl' : 'ltr';
  const locale = promoLocale(spec);
  const whooshSrc = whooshFile ? staticFile(whooshFile) : undefined;
  const tickSrc = tickFile ? staticFile(tickFile) : undefined;
  const chimeSrc = chimeFile ? staticFile(chimeFile) : undefined;

  // Cumulative slide windows in frames.
  let cursorMs = 0;
  const windows = slides.map((slide, i) => {
    const holdMs = slideHoldMs(slide, clipDurationsMs[i]);
    const fromFrame = Math.round((cursorMs / 1000) * PROMO_FPS);
    const durationFrames = Math.max(1, Math.round((holdMs / 1000) * PROMO_FPS));
    cursorMs += holdMs;
    return { fromFrame, durationFrames };
  });

  // One VO ducking window per narrated slide, in composition-timeline frames.
  const voWindows: VoWindow[] = slides
    .map((_, i) => {
      const clipMs = clipDurationsMs[i];
      if (!clipMs || clipMs <= 0) return null;
      return {
        fromFrame: windows[i].fromFrame,
        durationFrames: Math.round((clipMs / 1000) * PROMO_FPS),
      };
    })
    .filter((w): w is VoWindow => w !== null);

  // Whoosh at every slide cut after the first.
  const slideWhooshFrames = windows.slice(1).map((w) => w.fromFrame);

  // NEW operator-stage reels (amber/emerald ink) get the calmed emerald center
  // glow; every other reel (incl. the shipped dyad-vs-ptah promo) keeps the
  // legacy dim-blue center — no dyad scene file is touched.
  const usesOperatorStage = slides.some(
    (s) => s.scene && NEW_STAGE_SCENES.has(s.scene),
  );
  const backdropGlow = usesOperatorStage
    ? THEME.bgGlow
    : THEME.bgGlowLegacy;

  return (
    <SfxProvider tickSrc={tickSrc} chimeSrc={chimeSrc}>
      <AbsoluteFill style={{ backgroundColor: THEME.bg, direction: dir }}>
        {/* Shared cinematic backdrop, behind every scene. Flat 2D reels opt out
            via `bare` — see PromoSpec.bare. */}
        {spec.bare ? null : (
          <>
            <Backdrop glow={backdropGlow} />
            <AnimatedGridPattern opacity={0.04} />
            <AmbientOrbs glow={backdropGlow} />
            <Particles count={20} opacity={0.09} />
          </>
        )}

        <PromoSoundDesign
          musicSrc={musicFile ? staticFile(musicFile) : undefined}
          musicVolume={musicVolume}
          voWindows={voWindows}
          whooshFrames={slideWhooshFrames}
          whooshSrc={whooshSrc}
        />
        {slides.map((slide, i) => {
          // A cross-fading slide is held XFADE frames past its window so it can
          // fade over the next one. A hard-cut slide ends exactly on its window.
          const total = windows[i].durationFrames + xfadeFramesFor(slide);
          return (
            <Sequence
              key={i}
              from={windows[i].fromFrame}
              durationInFrames={total}
              name={`${i + 1}-${slide.scene ?? slide.kind}`}
            >
              <Slide
                slide={slide}
                durationFrames={total}
                locale={locale}
                whooshSrc={whooshSrc}
                subtitles={spec.subtitles}
              />
              {narrationFiles[i] ? <Audio src={staticFile(narrationFiles[i])} /> : null}
            </Sequence>
          );
        })}
        {/* The corner wordmark belongs on the cinematic reels. On a flat reel it
            sits over full-bleed amber flash frames as a dark smudge, and the
            ident/end card already carry the brand explicitly. */}
        {spec.bare ? null : <Watermark videoHeight={height} />}
      </AbsoluteFill>
    </SfxProvider>
  );
};
