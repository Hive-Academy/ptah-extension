/**
 * spec-extractor — pure(ish) reader for a single `.ptah/specs/TASK_*` folder.
 *
 * Task-level completion is driven ENTIRELY by the `task.md` frontmatter contract
 * (shared `parseTaskFile` from `@ptah-extension/task-specs`): a folder with no
 * valid `task.md` is skipped (returns `null`), and `completed` means the
 * frontmatter `status` is `done` or `cancelled`. There is no legacy emoji /
 * state-file / marker-file completion inference (TASK_2026_157, no-legacy).
 *
 * The orchestration skill still writes graded, attributed artifacts here:
 *  - `batches.md` — per-batch `**Recommended Executor**` (the subagent slug)
 *                  plus a word-token COMPLETE/FAILED status. Its former name
 *                  `tasks.md` is read as a PERMANENT fallback: task folders live
 *                  under the gitignored `.ptah/**`, so no migration can ever be
 *                  assumed to have run, and the fallback is never deprecated.
 *  - `*-review.md` / `test-report.md` — graded critique of the work produced.
 *
 * The parse helpers (`parseBatchVerdicts`, `detectStatus`, `normalizeExecutor`)
 * are exported pure functions so they can be unit-tested without the filesystem.
 */
import { open, readdir, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { parseTaskFile } from '@ptah-extension/task-specs';
import {
  BATCHES_FILE,
  CARRIER_FILE,
  LEGACY_BATCHES_FILE,
} from '@ptah-extension/shared';

export type SpecBatchStatus = 'COMPLETE' | 'FAILED';

export interface SpecBatchVerdict {
  readonly slug: string;
  readonly status: SpecBatchStatus;
}

export interface HarvestedSpec {
  readonly taskId: string;
  readonly dir: string;
  readonly completed: boolean;
  readonly harvested: boolean;
  readonly batches: readonly SpecBatchVerdict[];
  /** Concatenated, trimmed task-level review text (graded findings). */
  readonly reviewFindings: string;
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly artifactDigest: string;
  readonly reviews: readonly SpecReviewVerdict[];
  readonly diagnostics: readonly string[];
}

export interface SpecReviewVerdict {
  readonly file: string;
  readonly digest: string;
  readonly verdict: 'pass' | 'fail';
  readonly runId: string | null;
  readonly sessionId: string | null;
  readonly batch: number | null;
  readonly taskId: string | null;
}

export const HARVEST_MARKER_FILE = '.harvested.json';

const REVIEW_FILES = [
  'code-logic-review.md',
  'code-style-review.md',
  'visual-review.md',
  'test-report.md',
] as const;

const MAX_FINDINGS_CHARS = 6000;
const MAX_ARTIFACT_BYTES = 256 * 1024;
const MAX_ARTIFACTS = 64;

function terminalVerdict(value: unknown): 'pass' | 'fail' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (['pass', 'passed', 'approved', 'complete', 'success'].includes(normalized)) return 'pass';
  if (['fail', 'failed', 'rejected', 'revise'].includes(normalized)) return 'fail';
  return null;
}

function stringField(value: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) if (typeof value[key] === 'string' && value[key]) return value[key] as string;
  return null;
}

export function parseReviewVerdict(file: string, content: string, digest: string): SpecReviewVerdict | null {
  let verdict: 'pass' | 'fail' | null = null;
  let runId: string | null = null;
  let sessionId: string | null = null;
  let batch: number | null = null;
  let taskId: string | null = null;
  if (file.endsWith('.json')) {
    let value: unknown;
    try { value = JSON.parse(content); } catch { return null; }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const data: Record<string, unknown> = value as Record<string, unknown>;
    verdict = terminalVerdict(data['finalVerdict'] ?? data['final_verdict'] ?? data['verdict'] ?? data['status']);
    if (verdict === null && typeof data['pass'] === 'boolean') verdict = data['pass'] ? 'pass' : 'fail';
    taskId = stringField(data, 'taskId', 'task_id');
    runId = stringField(data, 'runId', 'run_id');
    sessionId = stringField(data, 'sessionId', 'session_id');
    const rawBatch = data['batch'] ?? data['batchNumber'];
    batch = typeof rawBatch === 'number' && Number.isSafeInteger(rawBatch) ? rawBatch : null;
  } else {
    const fields = [...content.matchAll(/^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:final\s+)?(?:verdict|review status|status)(?:\*\*)?\s*:\s*([a-z]+)\b/gim)];
    verdict = terminalVerdict(fields.at(-1)?.[1]);
    if (!verdict) {
      const sections = [...content.matchAll(/^\s*#{1,6}\s+(?:final\s+)?(?:verdict|review status|status)\s*\n\s*(?:[-*]\s*)?(pass|passed|fail|failed|approved|rejected|revise|complete|success)\b/gim)];
      verdict = terminalVerdict(sections.at(-1)?.[1]);
    }
    runId = /^\s*run[_ -]?id\s*:\s*([\w:-]+)/im.exec(content)?.[1] ?? null;
    sessionId = /^\s*session[_ -]?id\s*:\s*([\w:-]+)/im.exec(content)?.[1] ?? null;
    const batchText = /^\s*batch\s*:\s*(\d+)/im.exec(content)?.[1];
    batch = batchText ? Number(batchText) : null;
    taskId = /^\s*task[_ -]?id\s*:\s*(TASK_[\w-]+)/im.exec(content)?.[1] ?? null;
  }
  return verdict ? { file, digest, verdict, runId, sessionId, batch, taskId } : null;
}

/**
 * Reduce a raw `**Recommended Executor**` value to a single subagent slug.
 * Strips markdown/brackets, keeps the first pipe/comma-delimited segment, and
 * returns the leading kebab token (`backend-developer`). Non-agent executors
 * like "CLI agent" reduce to a harmless token that matches no library slug.
 */
export function normalizeExecutor(raw: string): string | null {
  const cleaned = raw.replace(/[[\]`*]/g, '').trim();
  const first = cleaned.split(/[|,]/)[0]?.trim() ?? '';
  const match = /^[a-z0-9]+(?:-[a-z0-9]+)*/i.exec(first);
  return match ? match[0].toLowerCase() : null;
}

/**
 * Classify a chunk of tasks.md text into a terminal verdict. FAILED wins over
 * COMPLETE; an unresolved (pending/in-progress) chunk returns null.
 */
export function detectStatus(text: string): SpecBatchStatus | null {
  if (/\bFAILED\b/.test(text)) return 'FAILED';
  if (/\b(PENDING|IN PROGRESS|IMPLEMENTED)\b/.test(text)) return null;
  if (/\bCOMPLETE\b/.test(text)) return 'COMPLETE';
  return null;
}

/**
 * Parse per-batch verdicts from tasks.md. Each `## Batch` block contributes one
 * verdict keyed on its executor slug, using the batch-heading status (falling
 * back to the aggregate status of the block's text). Batches without a terminal
 * status or a resolvable executor are skipped.
 */
export function parseBatchVerdicts(tasksMd: string): SpecBatchVerdict[] {
  const blocks = tasksMd.split(/^##\s+Batch\b/im).slice(1);
  const verdicts: SpecBatchVerdict[] = [];
  for (const block of blocks) {
    const headingLine = block.split('\n', 1)[0] ?? '';
    const execMatch = /\*\*Recommended Executor\*\*:\s*(.+)/i.exec(block);
    if (!execMatch) continue;
    const slug = normalizeExecutor(execMatch[1]);
    if (!slug) continue;
    const status = detectStatus(headingLine);
    if (!status) continue;
    verdicts.push({ slug, status });
  }
  return verdicts;
}

async function readFileSafe(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_ARTIFACT_BYTES) return null;
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(MAX_ARTIFACT_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return bytesRead > MAX_ARTIFACT_BYTES ? null : buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    // degradation-audit: optional-capability - Spec files include optional
    // reviews and legacy batches; null consistently means no readable artifact.
    return null;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    // degradation-audit: optional-capability - This is an existence probe for
    // an optional harvest marker; false means it is absent or inaccessible.
    return false;
  }
}

/**
 * Read and classify a single TASK_* spec folder. Returns null when the folder
 * has no valid `task.md` frontmatter carrier (no-legacy: legacy folders without
 * a carrier are skipped, never inferred). `completed` is derived solely from the
 * frontmatter `status` (`done` / `cancelled`).
 */
export async function extractSpec(dir: string, specsRoot = dirname(dir)): Promise<HarvestedSpec | null> {
  const taskId = basename(dir);
  if (!/^TASK_[A-Za-z0-9_-]+$/.test(taskId)) return null;
  const root = await realpath(specsRoot).catch(() => null);
  const actual = await realpath(dir).catch(() => null);
  if (!root || !actual) return null;
  const inside = relative(root, actual);
  if (!inside || inside.startsWith('..') || isAbsolute(inside) || resolve(root, taskId) !== resolve(dir)) return null;
  const diagnostics: string[] = [];
  const digest = createHash('sha256');
  const safeRead = async (file: string): Promise<string | null> => {
    const path = join(dir, file);
    const target = await realpath(path).catch(() => null);
    if (!target) return null;
    if (relative(actual, target).startsWith('..') || isAbsolute(relative(actual, target))) {
      diagnostics.push(`${file}: path outside task folder`);
      return null;
    }
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || info.size > MAX_ARTIFACT_BYTES) { diagnostics.push(`${file}: unreadable or oversized`); return null; }
    const content = await readFileSafe(path);
    if (content !== null) { digest.update(file); digest.update('\0'); digest.update(content); digest.update('\0'); }
    else diagnostics.push(`${file}: unreadable or oversized`);
    return content;
  };

  const taskMd = await safeRead(CARRIER_FILE);
  if (taskMd === null) return null; // no carrier — folder skipped

  const parsed = parseTaskFile(taskId, taskMd);
  if (parsed.kind === 'excluded') return null; // no valid frontmatter — skipped

  const completed =
    parsed.task.status === 'done' || parsed.task.status === 'cancelled';

  // `batches.md` first, then its legacy name. PERMANENT fallback — never warn.
  const batchesMd =
    (await safeRead(BATCHES_FILE)) ??
    (await safeRead(LEGACY_BATCHES_FILE));
  const harvested = await fileExists(join(dir, HARVEST_MARKER_FILE));
  const batches = batchesMd ? parseBatchVerdicts(batchesMd) : [];

  const findingsParts: string[] = [];
  const reviews: SpecReviewVerdict[] = [];
  const entries = await readdir(dir).catch(() => [] as string[]);
  const reviewFiles = [...new Set([...REVIEW_FILES, ...entries.filter((name) => /^(?:[\w-]+-review\.md|judge-round-\d+\.json)$/.test(name))])].sort().slice(0, MAX_ARTIFACTS);
  if (entries.filter((name) => /^(?:[\w-]+-review\.md|judge-round-\d+\.json)$/.test(name)).length > MAX_ARTIFACTS) diagnostics.push('review artifact count exceeds limit');
  for (const file of reviewFiles) {
    const content = await safeRead(file);
    if (content && content.trim().length > 0) {
      findingsParts.push(`### ${file}\n${content.trim()}`);
      const review = parseReviewVerdict(file, content, createHash('sha256').update(content).digest('hex'));
      if (review && (review.taskId === null || review.taskId === taskId)) reviews.push(review);
      else if (review?.taskId && review.taskId !== taskId) diagnostics.push(`${file}: task id mismatch`);
      else if (file.endsWith('.json')) diagnostics.push(`${file}: invalid or missing terminal verdict`);
    }
  }
  const reviewFindings = findingsParts
    .join('\n\n')
    .slice(0, MAX_FINDINGS_CHARS);

  const { windowStart, windowEnd } = await readWindow(dir);

  return {
    taskId,
    dir,
    completed,
    harvested,
    batches,
    reviewFindings,
    windowStart,
    windowEnd,
    artifactDigest: digest.digest('hex'),
    reviews,
    diagnostics: diagnostics.slice(0, 8),
  };
}

async function readWindow(
  dir: string,
): Promise<{ windowStart: number; windowEnd: number }> {
  let windowStart = Number.POSITIVE_INFINITY;
  let windowEnd = 0;
  try {
    const entries = await readdir(dir);
    for (const entry of entries) {
      try {
        const info = await stat(join(dir, entry));
        if (!info.isFile()) continue;
        windowStart = Math.min(windowStart, info.mtimeMs);
        windowEnd = Math.max(windowEnd, info.mtimeMs);
      } catch {
        // skip unreadable entry
      }
    }
  } catch {
    // unreadable dir — leave defaults
  }
  if (!Number.isFinite(windowStart)) windowStart = 0;
  return { windowStart, windowEnd };
}
