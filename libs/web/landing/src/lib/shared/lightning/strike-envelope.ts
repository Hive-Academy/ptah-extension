/**
 * Timing and shape of one hero strike. Durations are milliseconds, sizes CSS
 * pixels. A strike starts thin and dim, ramps brightness and halo up to a
 * capped peak (0.8 s), holds while it writhes and flickers (2.1 s), then
 * fades out (0.6 s): 3.5 s visible in total. A dark gap of 1.2 to 2 s
 * follows before the next one.
 */
export const STRIKE = {
  rampMs: 800,
  holdMs: 2100,
  fadeMs: 600,
  minGapMs: 1200,
  maxGapMs: 2000,
  firstDelayMs: 600,
  /** Level of the first frame, so the strike starts visible but faint. */
  startLevel: 0.12,
  /** Peak brightness: the cap the ramp climbs to. */
  intensityCap: 0.9,
  /** Brightness `k` of the `k / distance` light (about the core half-width). */
  coreMin: 1.2,
  coreMax: 5.5,
  /** Halo cut-off radius. */
  glowMin: 40,
  glowMax: 130,
  /** Brightness wavers by up to flickerDepth, re-drawn every flickerMs. */
  flickerMs: 70,
  flickerDepth: 0.16,
} as const;

export const STRIKE_TOTAL_MS = STRIKE.rampMs + STRIKE.holdMs + STRIKE.fadeMs;

/** The visual parameters of a bolt at one moment of a strike. */
export interface StrikeLook {
  intensity: number;
  core: number;
  glow: number;
}

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

function mix(from: number, to: number, level: number): number {
  return from + (to - from) * level;
}

/** A stable pseudo-random value in [0, 1) for `x`. */
export function hash01(x: number): number {
  const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Level (0 to 1) `t` ms into a strike: ramp, hold, fade; 0 outside it. */
export function strikeLevel(t: number): number {
  if (!(t >= 0 && t < STRIKE_TOTAL_MS)) return 0;
  if (t < STRIKE.rampMs) return mix(STRIKE.startLevel, 1, smooth(t / STRIKE.rampMs));
  const fading = t - STRIKE.rampMs - STRIKE.holdMs;
  return fading < 0 ? 1 : 1 - smooth(fading / STRIKE.fadeMs);
}

/**
 * Intensity, core and halo `t` ms into the strike with seed `seed`, written
 * into `out` (pass one to reuse it every frame instead of allocating).
 */
export function strikeLook(
  t: number,
  seed: number,
  out: StrikeLook = { intensity: 0, core: 0, glow: 0 },
): StrikeLook {
  const level = strikeLevel(t);
  const waver = 1 - STRIKE.flickerDepth * hash01(Math.floor(t / STRIKE.flickerMs) + seed);
  out.intensity = STRIKE.intensityCap * level * waver;
  out.core = mix(STRIKE.coreMin, STRIKE.coreMax, level);
  out.glow = mix(STRIKE.glowMin, STRIKE.glowMax, level);
  return out;
}

/** Seconds `t` ms into a strike: the clock the bolt writhes to. */
export function strikeSeconds(t: number): number {
  return Math.max(0, t) / 1000;
}

/** A dark gap drawn from [minGapMs, maxGapMs). */
export function strikeGap(random: () => number): number {
  return STRIKE.minGapMs + random() * (STRIKE.maxGapMs - STRIKE.minGapMs);
}
