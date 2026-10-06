import { constants, createReadStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { BENCH_DATA_DIR_ENV, resolveBenchDataDir } from '../../bench-data';
import { sha256File } from './candidate-row-diff';
import {
  compareCodePoints,
  sha256,
  type BenchDataRules,
} from './verify-candidate-manifest';

/** Split of `gt-memory-real@v1` (benchmark-design.md §10.2). Bounds are UTC, end exclusive. */
export const SEED_WINDOW = {
  from: '2026-09-06T00:00:00.000Z',
  to: '2026-10-01T00:00:00.000Z',
} as const;
export const EVAL_WINDOW = {
  from: '2026-10-01T00:00:00.000Z',
  to: '2026-10-07T00:00:00.000Z',
} as const;
export const SAMPLE_ORDER_PREFIX = 'TASK_2026_620:real';
export const SAMPLE_SIZE = 20;
export const MIN_BYTES = 200 * 1024;
export const MAX_BYTES = 5 * 1024 * 1024;
export const SESSIONS_RELATIVE_DIR = join('sessions', 'gt-memory-real-v1');

export type SessionWindow = 'seed' | 'eval' | 'straddling' | 'outside';
export type ExclusionReason =
  | 'no-timestamps'
  | 'worktree-619-cwd'
  | 'bench-temp-cwd'
  | 'unparseable-lines'
  | 'modified-after-window'
  | 'size-out-of-range';

export interface SessionScan {
  file: string;
  bytes: number;
  /** File mtime (ISO); a write after the eval window closed means the session ran past the freeze. */
  modifiedAt: string;
  lines: number;
  unparseableLines: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  cwds: string[];
}

export interface ClassifiedSession {
  file: string;
  bytes: number;
  unparseableLines: number;
  window: SessionWindow | null;
  exclusion: ExclusionReason | null;
  orderKey: string;
}

export interface SampledSession {
  opaqueId: string;
  file: string;
  /** Size and hash of the copied file, both measured on the same copy. */
  bytes: number;
  sha256: string;
  lines: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
}

export interface SessionSampleManifest {
  sample: 'gt-memory-real@v1 held-out sessions';
  sourceDir: string;
  seedWindow: typeof SEED_WINDOW;
  evalWindow: typeof EVAL_WINDOW;
  order: string;
  sizeRange: { minBytes: number; maxBytes: number };
  counts: Record<string, number>;
  /**
   * Sessions dropped after copying because the copy (re-read) no longer
   * qualified, e.g. a transcript still being written; replaced by the next pick.
   */
  rejectedAtCopy: { file: string; reason: string }[];
  /** True when sampled before the eval window closed; re-sample before labelling. */
  provisional: boolean;
  /** Files whose window is `seed`, kept for the memory seed; not copied. */
  seedWindowFiles: number;
  sessions: SampledSession[];
}

export interface SampleSessionsOptions {
  benchDataDir: string;
  /** Read-only transcript dir of the main repository (e.g. `~/.claude/projects/<repo>`). */
  sourceDir: string;
  sampleSize?: number;
  /** Directories whose sessions came from a bench temp home. Defaults to `[os.tmpdir()]`. */
  tempRoots?: readonly string[];
  overwrite?: boolean;
  /**
   * Sample before the eval window has closed. The result is marked
   * `provisional`: sessions may still be growing. Default `false` (refuse).
   */
  allowOpenWindow?: boolean;
  /** Current time in ms (specs only). Default `Date.now()`. */
  now?: number;
  /** Overrides for 619's bench-data rules (specs only). */
  benchDataRules?: BenchDataRules;
}

export interface SampleSessionsResult {
  outputDir: string;
  manifestPath: string;
  manifest: SessionSampleManifest;
}

/** Streams one JSONL transcript and records its timestamp range and every `cwd`. */
export async function scanSession(
  path: string,
  file: string,
): Promise<SessionScan> {
  const info = await stat(path);
  const bytes = info.size;
  let first: number | null = null;
  let last: number | null = null;
  let lines = 0;
  let unparseable = 0;
  const cwds = new Set<string>();
  const reader = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of reader) {
    if (line.trim() === '') continue;
    lines += 1;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      unparseable += 1;
      continue;
    }
    if (typeof record !== 'object' || record === null) continue;
    const fields = record as Record<string, unknown>;
    const timestamp = fields['timestamp'];
    if (typeof timestamp === 'string') {
      const ms = Date.parse(timestamp);
      if (!Number.isNaN(ms)) {
        if (first === null || ms < first) first = ms;
        if (last === null || ms > last) last = ms;
      }
    }
    if (typeof fields['cwd'] === 'string') cwds.add(fields['cwd']);
  }
  return {
    file,
    bytes,
    modifiedAt: new Date(info.mtimeMs).toISOString(),
    lines,
    unparseableLines: unparseable,
    firstTimestamp: first === null ? null : new Date(first).toISOString(),
    lastTimestamp: last === null ? null : new Date(last).toISOString(),
    cwds: [...cwds].sort(compareCodePoints),
  };
}

/** Pure classification: window, exclusion and the `sha256(prefix + filename)` order key. */
export function classifySession(
  scan: SessionScan,
  tempRoots: readonly string[],
): ClassifiedSession {
  const base = {
    file: scan.file,
    bytes: scan.bytes,
    unparseableLines: scan.unparseableLines,
    orderKey: sha256(SAMPLE_ORDER_PREFIX + scan.file),
  };
  if (scan.firstTimestamp === null || scan.lastTimestamp === null) {
    return { ...base, window: null, exclusion: 'no-timestamps' };
  }
  const window = windowOf(
    Date.parse(scan.firstTimestamp),
    Date.parse(scan.lastTimestamp),
  );
  let exclusion: ExclusionReason | null = null;
  if (scan.cwds.some(isTask619WorktreePath)) exclusion = 'worktree-619-cwd';
  else if (
    scan.cwds.some((cwd) => tempRoots.some((root) => isWithin(cwd, root)))
  )
    exclusion = 'bench-temp-cwd';
  // A line that does not parse is a transcript captured mid-write (or
  // corrupted); ground truth drafted from it could be silently wrong.
  else if (scan.unparseableLines > 0) exclusion = 'unparseable-lines';
  // Still written after the eval window closed: the session ran past the
  // freeze, so any copy of it is a partial capture.
  else if (Date.parse(scan.modifiedAt) >= Date.parse(EVAL_WINDOW.to))
    exclusion = 'modified-after-window';
  else if (scan.bytes < MIN_BYTES || scan.bytes > MAX_BYTES)
    exclusion = 'size-out-of-range';
  return { ...base, window, exclusion };
}

function windowOf(first: number, last: number): SessionWindow {
  const inside = (w: { from: string; to: string }): boolean =>
    first >= Date.parse(w.from) && last < Date.parse(w.to);
  if (inside(SEED_WINDOW)) return 'seed';
  if (inside(EVAL_WINDOW)) return 'eval';
  const overlaps = (w: { from: string; to: string }): boolean =>
    first < Date.parse(w.to) && last >= Date.parse(w.from);
  return overlaps(SEED_WINDOW) || overlaps(EVAL_WINDOW)
    ? 'straddling'
    : 'outside';
}

function isTask619WorktreePath(cwd: string): boolean {
  return /[\\/]\.claude-worktrees[\\/]task-619(?![0-9])/i.test(cwd);
}

function isWithin(target: string, root: string): boolean {
  const fold = (p: string): string =>
    process.platform === 'win32' ? p.toLowerCase() : p;
  const rel = relative(fold(resolve(root)), fold(resolve(target)));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Samples the held-out eval-window sessions and copies them, with a SHA-256
 * manifest, into `<benchDataDir>/sessions/gt-memory-real-v1/`. The source dir
 * is only read.
 */
export async function sampleSessions(
  options: SampleSessionsOptions,
): Promise<SampleSessionsResult> {
  const benchDataDir = resolveBenchDataDir({
    ...options.benchDataRules,
    env: { [BENCH_DATA_DIR_ENV]: options.benchDataDir },
  });
  const sourceDir = resolve(options.sourceDir);
  if (isWithin(sourceDir, benchDataDir) || isWithin(benchDataDir, sourceDir)) {
    throw new Error(
      'The transcript source dir and the bench data dir must not contain each other',
    );
  }
  const now = options.now ?? Date.now();
  const provisional = now < Date.parse(EVAL_WINDOW.to);
  if (provisional && options.allowOpenWindow !== true) {
    throw new Error(
      `The eval window is still open until ${EVAL_WINDOW.to}; sessions may still be written. Sample after it closes (or pass allowOpenWindow for a provisional sample)`,
    );
  }
  const sampleSize = options.sampleSize ?? SAMPLE_SIZE;
  const tempRoots = options.tempRoots ?? [tmpdir()];
  const outputDir = join(benchDataDir, SESSIONS_RELATIVE_DIR);
  const manifestPath = join(outputDir, 'manifest.json');
  if ((await exists(outputDir)) && options.overwrite !== true) {
    throw new Error(
      `A session sample already exists at ${outputDir}; pass overwrite to rebuild it`,
    );
  }

  const files = (await readdir(sourceDir, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
    .map((e) => e.name)
    .sort(compareCodePoints);
  const classified: ClassifiedSession[] = [];
  for (const file of files) {
    const scan = await scanSession(join(sourceDir, file), file);
    classified.push(classifySession(scan, tempRoots));
  }
  const counts: Record<string, number> = { files: files.length };
  for (const c of classified) {
    const key = c.exclusion
      ? `excluded:${c.exclusion}`
      : `window:${c.window ?? 'none'}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const eligible = classified
    .filter((c) => c.window === 'eval' && c.exclusion === null)
    .sort((a, b) => compareCodePoints(a.orderKey, b.orderKey));
  counts['eligibleEval'] = eligible.length;
  if (eligible.length < sampleSize) {
    throw new Error(
      `Only ${eligible.length} eligible eval-window sessions; ${sampleSize} are required`,
    );
  }

  const stagingDir = `${outputDir}.staging-${process.pid}`;
  await rm(stagingDir, { recursive: true, force: true });
  const sessions: SampledSession[] = [];
  try {
    await mkdir(join(stagingDir, 'transcripts'), { recursive: true });
    const rejectedAtCopy: { file: string; reason: string }[] = [];
    for (const pick of eligible) {
      if (sessions.length === sampleSize) break;
      const target = join(stagingDir, 'transcripts', pick.file);
      await copyFile(
        join(sourceDir, pick.file),
        target,
        constants.COPYFILE_EXCL,
      );
      // Everything recorded comes from the copy, so size, hash and content
      // agree even when the source grew between the scan and the copy.
      const copyScan = await scanSession(target, pick.file);
      const copied = classifySession(copyScan, tempRoots);
      const reason =
        copied.exclusion ??
        (copied.window === 'eval' ? null : `window:${copied.window ?? 'none'}`);
      if (reason !== null) {
        await rm(target, { force: true });
        rejectedAtCopy.push({ file: pick.file, reason });
        continue;
      }
      sessions.push({
        opaqueId: `RS-${pick.orderKey.slice(0, 12).toUpperCase()}`,
        file: pick.file,
        bytes: copyScan.bytes,
        sha256: await sha256File(target),
        lines: copyScan.lines,
        firstTimestamp: copyScan.firstTimestamp,
        lastTimestamp: copyScan.lastTimestamp,
      });
    }
    counts['rejectedAtCopy'] = rejectedAtCopy.length;
    if (sessions.length < sampleSize) {
      throw new Error(
        `Only ${sessions.length} sessions still qualified after copying; ${sampleSize} are required`,
      );
    }
    const manifest: SessionSampleManifest = {
      sample: 'gt-memory-real@v1 held-out sessions',
      sourceDir,
      seedWindow: SEED_WINDOW,
      evalWindow: EVAL_WINDOW,
      order: `sha256("${SAMPLE_ORDER_PREFIX}" + filename), ascending`,
      sizeRange: { minBytes: MIN_BYTES, maxBytes: MAX_BYTES },
      counts,
      rejectedAtCopy,
      provisional,
      seedWindowFiles: classified.filter(
        (c) => c.window === 'seed' && c.exclusion === null,
      ).length,
      sessions,
    };
    await writeFile(
      join(stagingDir, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(join(benchDataDir, 'sessions'), { recursive: true });
    await rename(stagingDir, outputDir);
    return { outputDir, manifestPath, manifest };
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
