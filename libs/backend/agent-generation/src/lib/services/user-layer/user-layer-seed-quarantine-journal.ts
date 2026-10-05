/**
 * The seed quarantine's cumulative journal and its per-root pass lock
 * (TASK_2026_609, code-logic review F3).
 *
 * The completion marker is written only after a pass with zero failures, so it
 * cannot be the record of a pass that half-succeeded: a retry after `EBUSY`
 * used to write a marker listing only the clones IT moved, and every clone an
 * earlier pass had moved vanished from the record that the Agents tab lists
 * and Restore reads. The journal is that missing record. Every verified move is
 * merged into it before the move counts as done, and the marker is written as
 * the union of the journal and the final pass.
 *
 * The journal is a separate file rather than a field of the marker on purpose:
 * the marker's existence means "done", which a partial pass must never claim.
 * Its name starts with `.` and is not `*.md`, so no clone listing, orphan
 * reaper or harness source resolver reads it as a clone.
 */
import { join, resolve } from 'path';
import { readFile } from 'fs/promises';
import type { Logger } from '@ptah-extension/vscode-core';
import { isErrnoCode } from './source-hash';
import type { UserLayerFsOps } from './user-layer-fs-ops';

/** Written into the scoped agents root; merged after every verified move. */
export const SEED_QUARANTINE_JOURNAL = '.ptah-seed-quarantine.journal.json';

/**
 * The clone slug rule of `skills-synthesis-rpc.schema.ts` (`SlugSchema`),
 * duplicated here because agent-generation does not import rpc-handlers. A
 * recorded slug becomes a path segment, so anything else is dropped.
 */
const AGENT_SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const AGENT_SLUG_MAX_LENGTH = 128;

export function isSafeAgentSlug(slug: string): boolean {
  return (
    slug.length <= AGENT_SLUG_MAX_LENGTH &&
    slug !== '.' &&
    slug !== '..' &&
    !slug.includes('..') &&
    AGENT_SLUG_PATTERN.test(slug)
  );
}

/** The three outcome lists the journal and the v1 marker share. */
export interface SeedQuarantineLists {
  readonly quarantined: readonly string[];
  readonly keptWithLocalWork: readonly string[];
  readonly keptUnprovable: readonly string[];
}

const LIST_KEYS = [
  'quarantined',
  'keptWithLocalWork',
  'keptUnprovable',
] as const;

export const EMPTY_SEED_QUARANTINE_LISTS: SeedQuarantineLists = {
  quarantined: [],
  keptWithLocalWork: [],
  keptUnprovable: [],
};

/**
 * One pass's view of the journal. The pass lock makes this the only writer
 * for its scoped root in this process, so each merge starts from the record
 * this object last wrote.
 */
export class SeedQuarantineJournal {
  private constructor(
    private readonly fs: UserLayerFsOps,
    private readonly logger: Logger,
    private readonly scopedAgentsRoot: string,
    private current: SeedQuarantineLists,
  ) {}

  /**
   * The journal in `scopedAgentsRoot`; absent is empty. `null` (warned) when
   * it exists but cannot be read, parsed or validated: the caller must then
   * move nothing, because a move whose record cannot be merged is the bug
   * this journal fixes. Unsafe slugs are dropped one by one, with a warning.
   */
  static async open(
    fs: UserLayerFsOps,
    logger: Logger,
    scopedAgentsRoot: string,
  ): Promise<SeedQuarantineJournal | null> {
    const read = await readJournalFile(scopedAgentsRoot);
    if (read.status === 'unreadable') {
      logger.warn(
        '[UserLayerMirror] seed quarantine journal unreadable; nothing moved',
        { scopedAgentsRoot, reason: read.reason },
      );
      return null;
    }
    if (read.droppedSlugs.length > 0) {
      logger.warn(
        '[UserLayerMirror] seed quarantine journal: unsafe slugs dropped',
        {
          scopedAgentsRoot,
          droppedSlugs: read.droppedSlugs.map((s) =>
            JSON.stringify(s.slice(0, 80)),
          ),
        },
      );
    }
    return new SeedQuarantineJournal(fs, logger, scopedAgentsRoot, read.lists);
  }

  get lists(): SeedQuarantineLists {
    return this.current;
  }

  /** Record one verified move. Throws when the record could not be written. */
  async recordMove(slug: string): Promise<void> {
    await this.write(
      mergeSeedQuarantineLists(this.current, {
        ...EMPTY_SEED_QUARANTINE_LISTS,
        quarantined: [slug],
      }),
    );
  }

  /**
   * Record a pass's kept slugs. A failed write is only reported: nothing moved
   * for them, and the marker is the union of the journal and the pass anyway.
   */
  async recordKept(kept: SeedQuarantineLists): Promise<void> {
    if (kept.keptWithLocalWork.length + kept.keptUnprovable.length === 0) {
      return;
    }
    try {
      await this.write(
        mergeSeedQuarantineLists(this.current, { ...kept, quarantined: [] }),
      );
    } catch (error: unknown) {
      // degradation-audit: optional-capability - see the doc comment above.
      this.logger.warn('[UserLayerMirror] seed quarantine journal not updated', {
        scopedAgentsRoot: this.scopedAgentsRoot,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async write(next: SeedQuarantineLists): Promise<void> {
    await this.fs.writeTextAtomic(
      join(this.scopedAgentsRoot, SEED_QUARANTINE_JOURNAL),
      JSON.stringify(
        {
          version: 1,
          quarantined: next.quarantined,
          keptWithLocalWork: next.keptWithLocalWork,
          keptUnprovable: next.keptUnprovable,
        },
        null,
        2,
      ),
    );
    this.current = next;
  }
}

type JournalFileRead =
  | {
      readonly status: 'ok';
      readonly lists: SeedQuarantineLists;
      readonly droppedSlugs: readonly string[];
    }
  | { readonly status: 'unreadable'; readonly reason: string };

async function readJournalFile(
  scopedAgentsRoot: string,
): Promise<JournalFileRead> {
  let raw: unknown;
  try {
    raw = JSON.parse(
      await readFile(join(scopedAgentsRoot, SEED_QUARANTINE_JOURNAL), 'utf8'),
    );
  } catch (error: unknown) {
    if (isErrnoCode(error, 'ENOENT')) {
      return {
        status: 'ok',
        lists: EMPTY_SEED_QUARANTINE_LISTS,
        droppedSlugs: [],
      };
    }
    return {
      status: 'unreadable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { status: 'unreadable', reason: 'journal is not an object' };
  }
  const record = raw as Record<string, unknown>;
  if (record['version'] !== 1) {
    return { status: 'unreadable', reason: 'unsupported journal version' };
  }
  const droppedSlugs: string[] = [];
  const lists: Record<(typeof LIST_KEYS)[number], string[]> = {
    quarantined: [],
    keptWithLocalWork: [],
    keptUnprovable: [],
  };
  for (const key of LIST_KEYS) {
    const value = record[key];
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
      return { status: 'unreadable', reason: `${key} is not a list of strings` };
    }
    for (const slug of value as string[]) {
      if (isSafeAgentSlug(slug)) lists[key].push(slug);
      else droppedSlugs.push(slug);
    }
  }
  return {
    status: 'ok',
    lists: mergeSeedQuarantineLists(EMPTY_SEED_QUARANTINE_LISTS, lists),
    droppedSlugs,
  };
}

/**
 * Union of two records. A slug `added` reports as quarantined leaves both kept
 * lists: it was kept once and has since been proven a seed copy and moved.
 */
export function mergeSeedQuarantineLists(
  base: SeedQuarantineLists,
  added: SeedQuarantineLists,
): SeedQuarantineLists {
  const quarantined = union(base.quarantined, added.quarantined);
  const movedNow = new Set(added.quarantined);
  const kept = (a: readonly string[], b: readonly string[]) =>
    union(a, b).filter((slug) => !movedNow.has(slug));
  return {
    quarantined,
    keptWithLocalWork: kept(base.keptWithLocalWork, added.keptWithLocalWork),
    keptUnprovable: kept(base.keptUnprovable, added.keptUnprovable),
  };
}

/**
 * Serialises whole quarantine passes per scoped root, in process. Two
 * overlapping mirror passes used to run the marker check and the marker write
 * concurrently and overwrite each other's record; under this lock the second
 * pass starts after the first has finished and sees its marker.
 */
export class SeedQuarantinePassLock {
  private readonly inflight = new Map<string, Promise<void>>();

  async run<T>(scopedAgentsRoot: string, fn: () => Promise<T>): Promise<T> {
    const key = resolve(scopedAgentsRoot);
    const prior = this.inflight.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    this.inflight.set(key, gate);
    // A gate only ever resolves, so a rejected prior pass still releases this.
    await prior;
    try {
      return await fn();
    } finally {
      release();
      if (this.inflight.get(key) === gate) this.inflight.delete(key);
    }
  }
}

function union(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])];
}
