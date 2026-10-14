/**
 * SubagentHandoffIndex — names pending handoff records on main-thread prompts.
 *
 * Per workspace it keeps the record file names of
 * `<workspace>/.ptah/subagent-handoffs/` (names only, sorted oldest first,
 * uncapped), loaded by one guarded `readdir` at first use and again by a
 * names-only rescan once the list is {@link INDEX_RESCAN_MS} old, so records
 * written by another host appear. {@link SubagentHandoffIndex.publish} adds a
 * record this process wrote.
 *
 * {@link SubagentHandoffIndex.pointerFor} builds the pointer for one prompt
 * within {@link POINTER_BUDGET_MS}: it reads the heads of at most
 * {@link MAX_HEAD_READS} records visible to the prompting session, starting
 * after that session's cursor, so every pending record is named within
 * `ceil(C / 10)` prompts (`C` = the session's candidates). Each head visit
 * is raced against the remaining budget; when it expires the pointer ends
 * with the directory timeout line and the abandoned visit leaves the cursor
 * where it was. The budget stays below the hook's own bound
 * (`POINTER_TIMEOUT_MS`) so that line reaches the prompt. A resolved record
 * (`consumed`/`dismissed`) leaves the list; one older than
 * {@link HANDOFF_RETENTION_MS} is deleted. A pending or malformed record is
 * never deleted. A record whose head cannot be read is listed with a note to
 * open it directly, and the cursor moves past it.
 *
 * Audience comes from the record name's owner hash: a record owned by a
 * session in `hidden` (another live session of this process) is not shown; one
 * owned by neither the prompting session nor a hidden one is shown with
 * takeover text. Lines carry paths only, never record content.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import { SUBAGENT_HANDOFF_DIR } from './subagent-handoff-files';
import {
  HANDOFF_RECORD_HEAD_BYTES,
  checkHandoffDir,
  parseRecordHead,
  parseRecordName,
  type HandoffRecordStatus,
} from './subagent-handoff-record';

/** Age at which the name list is rescanned from disk. */
export const INDEX_RESCAN_MS = 60_000;
/** Time one prompt's pointer may take. */
export const POINTER_BUDGET_MS = 600;
/** Record heads read per prompt. */
export const MAX_HEAD_READS = 10;
/** A resolved record older than this is deleted. */
export const HANDOFF_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
/** Temporary record files (left by a failed unlink) checked per load. */
export const MAX_TEMP_CLEANUPS = 10;

/** `.<record name>.tmp`: a record write that was never removed (`publishComplete`). */
function isRecordTempName(name: string): boolean {
  return (
    name.startsWith('.') &&
    name.endsWith('.tmp') &&
    parseRecordName(name.slice(1, -'.tmp'.length)) !== undefined
  );
}

const POINTER_HEADER =
  'Ptah: subagent handoff records are pending. For each: read it, continue ' +
  'from it, then set `status: consumed` in its frontmatter (or ' +
  '`status: dismissed` only if you will not continue it, or if its subagent ' +
  'finished normally and returned its result; if its subagent is still ' +
  'running, leave the record pending).';
const FOREIGN_SUFFIX =
  ' (from another or an ended session; continue it only if that session is ' +
  'not running, else leave it)';
const MALFORMED_SUFFIX = ' (frontmatter unreadable)';
const UNREADABLE_SUFFIX = ' (could not be read; open it directly)';

/** Who sees which records on one prompt. */
export interface HandoffPointerAudience {
  /** Owner hashes of the prompting session (its id and its rekey aliases). */
  readonly own: ReadonlySet<string>;
  /** Owner hashes of the other live sessions of this process. */
  readonly hidden: ReadonlySet<string>;
  /** The prompting session's rotation cursor. */
  readonly cursorKey: string;
}

/** The filesystem reads of the index; injectable for fault tests. */
export interface HandoffIndexFs {
  readdir(dir: string): Promise<string[]>;
  lstat(file: string): Promise<{ isFile(): boolean; readonly mtimeMs: number }>;
  /** The first `bytes` bytes of `file`, as UTF-8. */
  readHead(file: string, bytes: number): Promise<string>;
  unlink(file: string): Promise<void>;
}

const nodeIndexFs: HandoffIndexFs = {
  readdir: (dir) => fs.readdir(dir),
  lstat: (file) => fs.lstat(file),
  readHead: async (file, bytes) => {
    const handle = await fs.open(file, 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
      return buffer.toString('utf8', 0, bytesRead);
    } finally {
      await handle.close();
    }
  },
  unlink: (file) => fs.unlink(file),
};

interface WorkspaceIndex {
  readonly workspace: string;
  readonly dir: string;
  /** Record names, sorted. */
  names: string[];
  /** A load has completed at least once. */
  ready: boolean;
  loadedAt: number;
  loading?: Promise<void>;
  /** Names published while a load runs; merged when it resolves. */
  readonly published: Set<string>;
  /** Last visited name per cursor key. */
  readonly cursors: Map<string, string>;
}

/** What one head read found. */
type HeadRead =
  | { readonly kind: 'gone' }
  | {
      readonly kind: 'status';
      readonly status: HandoffRecordStatus;
      readonly mtimeMs: number;
    };

function errorCodeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

export class SubagentHandoffIndex {
  private readonly workspaces = new Map<string, WorkspaceIndex>();

  constructor(
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
    private readonly files: HandoffIndexFs = nodeIndexFs,
  ) {}

  /** A record this process wrote: list it without waiting for a rescan. */
  publish(workspace: string, name: string): void {
    const index = this.workspaces.get(path.resolve(workspace));
    if (!index) {
      // The first load reads it from disk.
      return;
    }
    if (index.loading) {
      index.published.add(name);
    }
    insertSorted(index.names, name);
  }

  /** A session ended: drop its rotation cursor in every workspace. */
  forgetCursor(cursorKey: string): void {
    for (const index of this.workspaces.values()) {
      index.cursors.delete(cursorKey);
    }
  }

  /** The pointer lines for one main-thread prompt, or `undefined` when nothing is pending. */
  async pointerFor(
    workspace: string,
    audience: HandoffPointerAudience,
  ): Promise<string | undefined> {
    const deadline = this.now() + POINTER_BUDGET_MS;
    const index = this.indexOf(path.resolve(workspace));
    try {
      this.refresh(index);
      if (!index.ready) {
        await waitUntil(index.loading, deadline - this.now());
        if (!index.ready) {
          return timeoutLine(index.dir);
        }
      }
      return await this.collect(index, audience, deadline);
    } catch (error: unknown) {
      this.logger.debug('[SubagentHandoffIndex] Pointer not built', {
        errorCode: errorCodeOf(error),
      });
      return timeoutLine(index.dir);
    }
  }

  private indexOf(workspace: string): WorkspaceIndex {
    let index = this.workspaces.get(workspace);
    if (!index) {
      index = {
        workspace,
        dir: path.join(workspace, SUBAGENT_HANDOFF_DIR),
        names: [],
        ready: false,
        loadedAt: 0,
        published: new Set(),
        cursors: new Map(),
      };
      this.workspaces.set(workspace, index);
    }
    return index;
  }

  /** Start the first load, a retry of a failed one, or a rescan of a stale list (one at a time). */
  private refresh(index: WorkspaceIndex): void {
    if (
      index.loading ||
      (index.ready && this.now() - index.loadedAt < INDEX_RESCAN_MS)
    ) {
      return;
    }
    index.loading = this.load(index).finally(() => {
      index.loading = undefined;
    });
  }

  private async load(index: WorkspaceIndex): Promise<void> {
    try {
      const check = await checkHandoffDir(index.workspace, false);
      if (!check.ok && check.reason === 'refused') {
        this.logger.debug(
          '[SubagentHandoffIndex] Handoff directory refused (link or outside the workspace)',
        );
      }
      const found = check.ok ? await this.files.readdir(check.dir) : [];
      const names = new Set(
        found.filter((name) => parseRecordName(name) !== undefined),
      );
      for (const name of index.published) {
        names.add(name);
      }
      index.published.clear();
      index.names = [...names].sort();
      index.ready = true;
      index.loadedAt = this.now();
      if (check.ok) {
        await this.removeStaleTemps(check.dir, found);
      }
    } catch (error: unknown) {
      // The next prompt retries.
      this.logger.debug('[SubagentHandoffIndex] Handoff records not listed', {
        errorCode: errorCodeOf(error),
      });
    }
  }

  private async collect(
    index: WorkspaceIndex,
    audience: HandoffPointerAudience,
    deadline: number,
  ): Promise<string | undefined> {
    const candidates = index.names.filter((name) => {
      const parts = parseRecordName(name);
      return parts !== undefined && !audience.hidden.has(parts.owner);
    });
    if (candidates.length === 0) {
      return undefined;
    }
    const cursor = index.cursors.get(audience.cursorKey);
    const after =
      cursor === undefined ? 0 : candidates.findIndex((name) => name > cursor);
    const start = after < 0 ? 0 : after;
    const end = Math.min(candidates.length, start + MAX_HEAD_READS);
    const listed: string[] = [];
    let visited = 0;
    let expired = false;
    for (let i = start; i < end; i += 1) {
      const remaining = deadline - this.now();
      if (remaining <= 0) {
        // Out of time before the first visit: nothing was checked.
        expired = visited === 0;
        break;
      }
      const name = candidates[i];
      // A visit the deadline abandons keeps running but never moves the cursor.
      const line = await raceDeadline(
        this.visit(index, name, audience),
        remaining,
      );
      if (line === EXPIRED) {
        expired = true;
        break;
      }
      if (line) {
        listed.push(line);
      }
      index.cursors.set(audience.cursorKey, name);
      visited += 1;
    }
    const lines = listed.length > 0 ? [POINTER_HEADER, ...listed] : [];
    const more = candidates.length - visited;
    if (expired) {
      lines.push(timeoutLine(index.dir));
    } else if (more > 0) {
      lines.push(
        `Ptah: ${more} more handoff records in \`${index.dir}\` are not checked yet; later prompts name them.`,
      );
    }
    return lines.length > 0 ? lines.join('\n') : undefined;
  }

  /** Read one record's head; its pointer line, or `undefined` once it left the list. */
  private async visit(
    index: WorkspaceIndex,
    name: string,
    audience: HandoffPointerAudience,
  ): Promise<string | undefined> {
    const file = path.join(index.dir, name);
    const owner = parseRecordName(name)?.owner;
    const prefix =
      owner !== undefined && audience.own.has(owner)
        ? `- ${file}`
        : `- ${file}${FOREIGN_SUFFIX}`;
    let read: HeadRead;
    try {
      read = await this.readHead(file);
    } catch (error: unknown) {
      this.logger.debug('[SubagentHandoffIndex] Handoff record head not read', {
        errorCode: errorCodeOf(error),
      });
      return `${prefix}${UNREADABLE_SUFFIX}`;
    }
    if (read.kind === 'gone') {
      removeName(index.names, name);
      return undefined;
    }
    if (read.status === 'consumed' || read.status === 'dismissed') {
      removeName(index.names, name);
      if (this.now() - read.mtimeMs > HANDOFF_RETENTION_MS) {
        await this.deleteResolved(file);
      }
      return undefined;
    }
    return read.status === 'malformed'
      ? `${prefix}${MALFORMED_SUFFIX}`
      : prefix;
  }

  /** Missing or not a regular file (a link, a directory): `gone`. Rejects on other errors. */
  private async readHead(file: string): Promise<HeadRead> {
    try {
      const stat = await this.files.lstat(file);
      if (!stat.isFile()) {
        return { kind: 'gone' };
      }
      const head = await this.files.readHead(file, HANDOFF_RECORD_HEAD_BYTES);
      return {
        kind: 'status',
        status: parseRecordHead(head),
        mtimeMs: stat.mtimeMs,
      };
    } catch (error: unknown) {
      if (errorCodeOf(error) === 'ENOENT') {
        return { kind: 'gone' };
      }
      throw error;
    }
  }

  /**
   * Delete temporary record files older than {@link HANDOFF_RETENTION_MS}
   * (a record write is bounded to seconds, so none is still in use), at most
   * {@link MAX_TEMP_CLEANUPS} per load. Never rejects.
   */
  private async removeStaleTemps(dir: string, found: string[]): Promise<void> {
    const temps = found.filter(isRecordTempName).slice(0, MAX_TEMP_CLEANUPS);
    for (const name of temps) {
      const file = path.join(dir, name);
      try {
        const stat = await this.files.lstat(file);
        if (
          stat.isFile() &&
          this.now() - stat.mtimeMs > HANDOFF_RETENTION_MS
        ) {
          await this.files.unlink(file);
        }
      } catch (error: unknown) {
        this.logger.debug(
          '[SubagentHandoffIndex] Temporary handoff file not removed',
          { errorCode: errorCodeOf(error) },
        );
      }
    }
  }

  private async deleteResolved(file: string): Promise<void> {
    try {
      await this.files.unlink(file);
    } catch (error: unknown) {
      this.logger.debug(
        '[SubagentHandoffIndex] Resolved handoff record not deleted',
        {
          errorCode: errorCodeOf(error),
        },
      );
    }
  }
}

function timeoutLine(dir: string): string {
  return `Ptah: handoff records could not be checked in time; look in \`${dir}\` for \`*.handoff.md\` files with \`status: pending\`.`;
}

/** What {@link raceDeadline} returns when `ms` passed first. */
const EXPIRED: unique symbol = Symbol('expired');

/** `pending`'s value, or {@link EXPIRED} once `ms` (at least 0) passed first; the timer is cleared. */
async function raceDeadline<T>(
  pending: Promise<T>,
  ms: number,
): Promise<T | typeof EXPIRED> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<typeof EXPIRED>((resolve) => {
        timer = setTimeout(() => resolve(EXPIRED), Math.max(0, ms));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Wait for `pending` at most `ms`. */
async function waitUntil(
  pending: Promise<void> | undefined,
  ms: number,
): Promise<void> {
  if (!pending || ms <= 0) {
    return;
  }
  await raceDeadline(pending, ms);
}

function insertSorted(names: string[], name: string): void {
  let low = 0;
  let high = names.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (names[mid] < name) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  if (names[low] !== name) {
    names.splice(low, 0, name);
  }
}

function removeName(names: string[], name: string): void {
  const at = names.indexOf(name);
  if (at >= 0) {
    names.splice(at, 1);
  }
}
