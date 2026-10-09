/**
 * Ground-truth independence guarantee 2 (benchmark-design.md 10.1): labels
 * are committed before the first scored run, and the runner refuses a run
 * whose ground-truth commit is newer than the first scored run of that
 * ground-truth version.
 *
 * A plan suite names its ground truth as `{ id, paths }`: the versioned id
 * (for example `gt-memory@v1`) and the repo-relative committed files it is
 * read from. Before a scored run the runner
 *   1. refuses any of those paths with uncommitted or untracked changes;
 *   2. takes the newest commit touching them (`git log -1`);
 *   3. refuses when an earlier run already scored that id and the commit is
 *      newer than that run's start, so a label edit needs a new version id.
 * After the run, ids scored for the first time are recorded in
 * `<benchData>/runs/first-scored-runs/`, one create-once file per id
 * (private, per machine).
 */

import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { compareCodeUnits } from '../../utils/compare-code-units';
import type { GitRunner } from './read-path-guard';

export const FIRST_SCORED_RUN_SCHEMA_ID = '620.first-scored-run.v1';

export interface GroundTruthRef {
  readonly id: string;
  /** Repo-relative, `/`-separated committed paths (files or directories). */
  readonly paths: readonly string[];
}

export interface GroundTruthCommit {
  readonly id: string;
  readonly commit: string;
  /** Committer date, ISO 8601. */
  readonly committedAt: string;
}

const firstScoredRunSchema = z.strictObject({
  runId: z.string().min(1),
  startedAt: z.string().datetime(),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  committedAt: z.string().datetime({ offset: true }),
});
export type FirstScoredRun = z.infer<typeof firstScoredRunSchema>;

/** One entry file: the id it records plus its first scored run. */
const entrySchema = firstScoredRunSchema.extend({
  schemaId: z.literal(FIRST_SCORED_RUN_SCHEMA_ID),
  id: z.string().min(1),
});

export interface FirstScoredRunLedger {
  readonly groundTruths: Readonly<Record<string, FirstScoredRun>>;
}

/** The run must not be scored against this ground truth. */
export class GroundTruthFreshnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroundTruthFreshnessError';
  }
}

export function firstScoredRunsDir(benchDataDir: string): string {
  return join(benchDataDir, 'runs', 'first-scored-runs');
}

/** One ref per id; two suites naming one id must name the same paths. */
export function mergeGroundTruthRefs(
  refs: readonly GroundTruthRef[],
): GroundTruthRef[] {
  const byId = new Map<string, GroundTruthRef>();
  for (const ref of refs) {
    const paths = [...new Set(ref.paths)].sort(compareCodeUnits);
    const seen = byId.get(ref.id);
    if (seen === undefined) {
      byId.set(ref.id, { id: ref.id, paths });
    } else if (seen.paths.join('\0') !== paths.join('\0')) {
      throw new GroundTruthFreshnessError(
        `ground truth ${ref.id} is named with two different path sets`,
      );
    }
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Steps 1-2 of the module header, for every ref. */
export function resolveGroundTruthCommits(
  refs: readonly GroundTruthRef[],
  git: GitRunner,
): GroundTruthCommit[] {
  return refs.map((ref) => {
    const dirty = git([
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      ...ref.paths,
    ]).trim();
    if (dirty.length > 0) {
      throw new GroundTruthFreshnessError(
        `ground truth ${ref.id} has uncommitted changes; commit the labels before a scored run:\n${dirty}`,
      );
    }
    const log = git([
      'log',
      '-1',
      '--format=%H%x00%cI',
      '--',
      ...ref.paths,
    ]).trim();
    const [commit, committedAt] = log.split('\0');
    if (!commit || !committedAt) {
      throw new GroundTruthFreshnessError(
        `ground truth ${ref.id} has no commit touching ${ref.paths.join(', ')}`,
      );
    }
    return { id: ref.id, commit, committedAt };
  });
}

function entryFile(id: string): string {
  return `${createHash('sha256').update(id, 'utf8').digest('hex')}.json`;
}

/** Every recorded entry; a malformed entry fails closed (blocks the run). */
export function readFirstScoredRuns(dir: string): FirstScoredRunLedger {
  const groundTruths: Record<string, FirstScoredRun> = {};
  if (!existsSync(dir)) return { groundTruths };
  for (const name of readdirSync(dir)) {
    if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
    const entry = entrySchema.parse(
      JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown,
    );
    if (name !== entryFile(entry.id)) {
      throw new GroundTruthFreshnessError(
        `first-scored entry ${join(dir, name)} names ${entry.id}, which belongs in another file`,
      );
    }
    groundTruths[entry.id] = {
      runId: entry.runId,
      startedAt: entry.startedAt,
      commit: entry.commit,
      committedAt: entry.committedAt,
    };
  }
  return { groundTruths };
}

/** Step 3: refuse a commit newer than the id's first scored run. */
export function assertGroundTruthNotNewer(
  commits: readonly GroundTruthCommit[],
  ledger: FirstScoredRunLedger,
): void {
  const refused = commits.flatMap((gt) => {
    const first = ledger.groundTruths[gt.id];
    if (first === undefined || first.commit === gt.commit) return [];
    return Date.parse(gt.committedAt) > Date.parse(first.startedAt)
      ? [
          `${gt.id}: commit ${gt.commit} (${gt.committedAt}) is newer than its first scored run ${first.runId} (${first.startedAt}); give the changed labels a new version id`,
        ]
      : [];
  });
  if (refused.length > 0) {
    throw new GroundTruthFreshnessError(
      `ground truth changed after it was first scored:\n${refused.join('\n')}`,
    );
  }
}

/**
 * Record ids scored for the first time. Each id is its own file, published
 * with a hard link from a complete temp file: the link fails with `EEXIST`
 * when another run published that id first, and that earlier entry wins. No
 * run ever rewrites another id's entry, so concurrent runs sharing one bench
 * data folder cannot drop each other's entries, and a reader never sees a
 * half-written one.
 */
export function recordFirstScoredRuns(
  dir: string,
  commits: readonly GroundTruthCommit[],
  run: { readonly runId: string; readonly startedAt: string },
): FirstScoredRunLedger {
  if (commits.length > 0) mkdirSync(dir, { recursive: true });
  for (const gt of commits) {
    // No existence pre-check: the link itself is the test, so a stale view
    // of the ledger (another run published meanwhile) takes the same path.
    const target = join(dir, entryFile(gt.id));
    const entry = entrySchema.parse({
      schemaId: FIRST_SCORED_RUN_SCHEMA_ID,
      id: gt.id,
      runId: run.runId,
      startedAt: run.startedAt,
      commit: gt.commit,
      committedAt: gt.committedAt,
    });
    const temp = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(temp, `${JSON.stringify(entry, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    try {
      linkSync(temp, target);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    } finally {
      unlinkSync(temp);
    }
  }
  return readFirstScoredRuns(dir);
}
