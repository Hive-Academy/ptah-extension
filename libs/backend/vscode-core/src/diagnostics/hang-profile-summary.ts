/**
 * Top self-time frames of a V8 `.cpuprofile`, restricted to a hang window.
 *
 * The hang line has room for a handful of names, not a flame graph. Self time
 * (time a frame was on top of the stack) is what names the synchronous
 * culprit: a 9 s `better-sqlite3` `.all()` shows up as one frame with ~9 s of
 * self time, regardless of who called it.
 */
import { z } from 'zod';

/** Default number of frames a hang line carries. */
export const TOP_SELF_TIME_LIMIT = 10;

/** Characters of a script URL kept, from the end (the file name matters most). */
export const MAX_FRAME_URL_LENGTH = 120;

/**
 * The subset of the V8 `Profiler.Profile` this reads. Parsed rather than cast:
 * the object arrives through the inspector protocol as `object`.
 */
export const CpuProfileSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.number(),
      callFrame: z.object({
        functionName: z.string(),
        url: z.string(),
        lineNumber: z.number(),
      }),
    }),
  ),
  startTime: z.number(),
  endTime: z.number(),
  samples: z.array(z.number()).optional(),
  timeDeltas: z.array(z.number()).optional(),
});

export type CpuProfileData = z.infer<typeof CpuProfileSchema>;

/** One frame in the summary. */
export interface SelfTimeEntry {
  /** Function name, `(anonymous)` when V8 has none. */
  readonly fn: string;
  /** `url:line` (1-based line), url clipped from the left. */
  readonly at: string;
  readonly selfMs: number;
}

export interface SelfTimeSummary {
  readonly entries: SelfTimeEntry[];
  /** Sampled milliseconds the entries were ranked over. */
  readonly sampledMs: number;
  /** False when no sample fell in the window and the whole profile was used. */
  readonly windowed: boolean;
}

/** Profile-clock window, in microseconds (the profile's own time base). */
export interface ProfileWindowUs {
  readonly startUs: number;
  readonly endUs: number;
}

/** Frames that are never a culprit: the root and the idle marker. */
const IGNORED_FRAMES = new Set(['(root)', '(idle)']);

/**
 * Rank frames by self time inside `window`. A sample's duration is the gap to
 * the next sample (the last runs to `endTime`), as DevTools attributes it.
 * Falls back to the whole profile when the window holds no sample.
 */
export function summarizeSelfTime(
  profile: CpuProfileData,
  window?: ProfileWindowUs,
  limit: number = TOP_SELF_TIME_LIMIT,
): SelfTimeSummary {
  const windowed = window !== undefined ? rank(profile, window, limit) : null;
  if (windowed !== null && windowed.entries.length > 0) {
    return { ...windowed, windowed: true };
  }
  const whole = rank(profile, undefined, limit);
  return { ...whole, windowed: false };
}

function rank(
  profile: CpuProfileData,
  window: ProfileWindowUs | undefined,
  limit: number,
): Omit<SelfTimeSummary, 'windowed'> {
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  const nodeKey = new Map<number, { fn: string; at: string } | null>();
  for (const node of profile.nodes) {
    const name = node.callFrame.functionName;
    nodeKey.set(
      node.id,
      IGNORED_FRAMES.has(name)
        ? null
        : {
            fn: name === '' ? '(anonymous)' : name,
            at: `${clipUrl(node.callFrame.url)}:${node.callFrame.lineNumber + 1}`,
          },
    );
  }

  const selfUs = new Map<string, { fn: string; at: string; us: number }>();
  let sampledUs = 0;
  let timestamp = profile.startTime;
  for (let i = 0; i < samples.length; i++) {
    timestamp += deltas[i] ?? 0;
    const next =
      i + 1 < samples.length
        ? timestamp + (deltas[i + 1] ?? 0)
        : profile.endTime;
    const duration = Math.max(0, next - timestamp);
    if (
      window !== undefined &&
      (timestamp < window.startUs || timestamp > window.endUs)
    ) {
      continue;
    }
    const frame = nodeKey.get(samples[i]);
    if (frame === undefined || frame === null) continue;
    sampledUs += duration;
    const key = `${frame.fn}\u0000${frame.at}`;
    const entry = selfUs.get(key);
    if (entry === undefined) selfUs.set(key, { ...frame, us: duration });
    else entry.us += duration;
  }

  const entries = [...selfUs.values()]
    .sort((a, b) => b.us - a.us)
    .slice(0, limit)
    .map((entry) => ({
      fn: entry.fn,
      at: entry.at,
      selfMs: Math.round(entry.us / 100) / 10,
    }));
  return { entries, sampledMs: Math.round(sampledUs / 1000) };
}

function clipUrl(url: string): string {
  if (url === '') return '(native)';
  return url.length > MAX_FRAME_URL_LENGTH
    ? `…${url.slice(url.length - MAX_FRAME_URL_LENGTH + 1)}`
    : url;
}
