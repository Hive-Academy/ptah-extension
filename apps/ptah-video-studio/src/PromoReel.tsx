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
import { SfxProvider } from './concept/scene-kit';
import { THEME } from './theme';

export const PROMO_FPS = 30;

/** Extra on-screen breath after each scene's timeline ends. */
const BREATH_MS = 420;
/** Default scene hold when a slide sets no explicit holdMs. */
const DEFAULT_HOLD_MS = 7000;

export interface PromoSlide {
  /** Only concept scenes now — the component IS the message. */
  kind: 'scene';
  /** Concept-scene key (see the CONCEPT_SCENES registry in src/concept). */
  scene?: string;
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

const Slide: React.FC<{
  slide: PromoSlide;
  durationFrames: number;
  locale: Locale;
  whooshSrc?: string;
}> = ({ slide, durationFrames, locale, whooshSrc }) => {
  const frame = useCurrentFrame();
  // Fade the whole scene out over its last XFADE frames so cuts feel soft.
  const exit = interpolate(
    frame,
    [durationFrames - XFADE_FRAMES, durationFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const Scene = (slide.scene && CONCEPT_SCENES[slide.scene]) || MissingScene;

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <Scene slide={slide} durationFrames={durationFrames} locale={locale} whooshSrc={whooshSrc} />
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

  return (
    <SfxProvider tickSrc={tickSrc} chimeSrc={chimeSrc}>
      <AbsoluteFill style={{ backgroundColor: THEME.bg, direction: dir }}>
        {/* Shared cinematic backdrop, behind every scene. */}
        <Backdrop />
        <AnimatedGridPattern opacity={0.04} />
        <AmbientOrbs />
        <Particles count={20} opacity={0.09} />

        <PromoSoundDesign
          musicSrc={musicFile ? staticFile(musicFile) : undefined}
          musicVolume={musicVolume}
          voWindows={voWindows}
          whooshFrames={slideWhooshFrames}
          whooshSrc={whooshSrc}
        />
        {slides.map((slide, i) => (
          <Sequence
            key={i}
            from={windows[i].fromFrame}
            durationInFrames={windows[i].durationFrames + XFADE_FRAMES}
            name={`${i + 1}-${slide.scene ?? 'scene'}`}
          >
            <Slide
              slide={slide}
              durationFrames={windows[i].durationFrames + XFADE_FRAMES}
              locale={locale}
              whooshSrc={whooshSrc}
            />
            {narrationFiles[i] ? <Audio src={staticFile(narrationFiles[i])} /> : null}
          </Sequence>
        ))}
        <Watermark videoHeight={height} />
      </AbsoluteFill>
    </SfxProvider>
  );
};
