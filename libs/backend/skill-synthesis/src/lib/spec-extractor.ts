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
 *  - `tasks.md`  — per-batch `**Recommended Executor**` (the subagent slug) plus
 *                  a word-token COMPLETE/FAILED status.
 *  - `*-review.md` / `test-report.md` — graded critique of the work produced.
 *
 * The parse helpers (`parseBatchVerdicts`, `detectStatus`, `normalizeExecutor`)
 * are exported pure functions so they can be unit-tested without the filesystem.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseTaskFile } from '@ptah-extension/task-specs';

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
}

export const HARVEST_MARKER_FILE = '.harvested.json';

const REVIEW_FILES = [
  'code-logic-review.md',
  'code-style-review.md',
  'visual-review.md',
  'test-report.md',
] as const;

const MAX_FINDINGS_CHARS = 6000;

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
    const status = detectStatus(headingLine) ?? detectStatus(block);
    if (!status) continue;
    verdicts.push({ slug, status });
  }
  return verdicts;
}

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and classify a single TASK_* spec folder. Returns null when the folder
 * has no valid `task.md` frontmatter carrier (no-legacy: legacy folders without
 * a carrier are skipped, never inferred). `completed` is derived solely from the
 * frontmatter `status` (`done` / `cancelled`).
 */
export async function extractSpec(dir: string): Promise<HarvestedSpec | null> {
  const taskId = basename(dir);

  const taskMd = await readFileSafe(join(dir, 'task.md'));
  if (taskMd === null) return null; // no carrier — folder skipped

  const parsed = parseTaskFile(taskId, taskMd);
  if (parsed.kind === 'excluded') return null; // no valid frontmatter — skipped

  const completed =
    parsed.task.status === 'done' || parsed.task.status === 'cancelled';

  const tasksMd = await readFileSafe(join(dir, 'tasks.md'));
  const harvested = await fileExists(join(dir, HARVEST_MARKER_FILE));
  const batches = tasksMd ? parseBatchVerdicts(tasksMd) : [];

  const findingsParts: string[] = [];
  for (const file of REVIEW_FILES) {
    const content = await readFileSafe(join(dir, file));
    if (content && content.trim().length > 0) {
      findingsParts.push(`### ${file}\n${content.trim()}`);
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
