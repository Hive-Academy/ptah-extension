/**
 * The ID-allocation race — a regression test for TASK_2026_194.
 *
 * ## What actually went wrong
 *
 * Task-id allocation was (and, in the hand-written orchestration flow, still is
 * unless the skill prose is followed) a non-atomic folder scan: read the highest
 * `NNN`, add 1, `mkdir -p`, write `task.md`. Two orchestrator sessions running
 * against the same `.ptah/specs` both scanned, both picked the same id, and both
 * wrote — the second write silently clobbered the first. `TASK_2026_188`/`189`
 * were lost this way and had to be re-filed as `192`/`193`. `.ptah/**` is
 * gitignored, so there was no merge conflict and no undo.
 *
 * ## What the fix is
 *
 * `TaskWriterService.create` reserves the folder with `createDirectoryExclusive`
 * — the `IFileSystemProvider` port's only compare-and-swap, a non-recursive
 * `mkdir` that rejects with `EEXIST` on an existing path. The claim IS the lock:
 * a concurrent grab of the same id becomes a re-scan-and-retry, never a clobber.
 *
 * ## What these tests pin (acceptance criteria 1 and 2)
 *
 *  1. Two allocations racing for the same `NNN` resolve to two DISTINCT ids —
 *     proven both by genuine parallel `create` calls and by the deterministic
 *     "reserve that sees the folder pre-created" interleaving.
 *  2. A create can never land a carrier on top of an existing one: the loser of
 *     an id race walks past the winner's folder, leaving the winner's `task.md`
 *     byte-for-byte intact.
 */
import * as path from 'path';
import {
  createMockFileSystemProvider,
  type MockFileSystemProvider,
} from '@ptah-extension/platform-core/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { normalizeWorkspaceRoot } from './normalize-workspace-root';
import { NoOpTaskIndexNotifier } from './task-index.port';
import {
  NoOpTaskFolderVisibility,
  type ITaskFolderVisibility,
} from './task-folder-visibility.port';
import { parseTaskFile } from './task-frontmatter';
import { TaskWriterService } from './task-writer.service';

const ROOT = 'd:/tmp/ws-create-race';
const YEAR = new Date().getFullYear();

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function specsDir(): string {
  return path.join(normalizeWorkspaceRoot(ROOT), '.ptah', 'specs');
}

function carrierPath(id: string): string {
  return path.join(specsDir(), id, 'task.md');
}

function makeWriter(
  visibility: ITaskFolderVisibility = new NoOpTaskFolderVisibility(),
) {
  const fs = createMockFileSystemProvider();
  const writer = new TaskWriterService(
    fs,
    makeLogger(),
    new NoOpTaskIndexNotifier(),
    visibility,
  );
  return { fs, writer };
}

describe('TaskWriterService.create — concurrent allocation cannot clobber (TASK_2026_194)', () => {
  it('two parallel creates against one filesystem resolve to two DISTINCT ids, both carriers valid', async () => {
    const { fs, writer } = makeWriter();

    // A genuine race: both creates start with nothing on disk, so both scan the
    // same empty listing and both propose `_001`. Exactly one wins the exclusive
    // claim; the other gets EEXIST, re-scans, and takes `_002`. The mock's
    // `createDirectoryExclusive` is a synchronous check-and-claim with no
    // interleaving await, so it has the same all-or-nothing semantics as the
    // real `node:fs` mkdir — a double-claim is impossible.
    const [a, b] = await Promise.all([
      writer.create(ROOT, { title: 'session A', type: 'FEATURE' }),
      writer.create(ROOT, { title: 'session B', type: 'BUGFIX' }),
    ]);

    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    if (!a.success || !b.success) return;

    // THE property criterion 1 demands: two ids, not one.
    expect(a.task.id).not.toBe(b.task.id);
    expect(new Set([a.task.id, b.task.id]).size).toBe(2);
    expect(a.task.id).toMatch(/^TASK_\d{4}_\d{3,}_[0-9a-f]{4}$/);
    expect(b.task.id).toMatch(/^TASK_\d{4}_\d{3,}_[0-9a-f]{4}$/);

    // Both carriers exist on disk and round-trip cleanly — neither create left a
    // half-written or clobbered folder behind.
    for (const created of [a, b]) {
      const raw = await fs.readFile(carrierPath(created.task.id));
      const parsed = parseTaskFile(created.task.id, raw);
      expect(parsed.kind).toBe('task');
      if (parsed.kind !== 'task') continue;
      expect(parsed.task.validationIssues).toHaveLength(0);
    }

    // The two titles landed in two different carriers — proof the second create
    // did not overwrite the first.
    const rawA = await fs.readFile(carrierPath(a.task.id));
    const rawB = await fs.readFile(carrierPath(b.task.id));
    expect(rawA).toContain('session A');
    expect(rawB).toContain('session B');
  });

  it('a stale scan still produces a distinct id and leaves the winner untouched', async () => {
    const { fs, writer } = makeWriter();

    // Session A wins _001 first, the honest way.
    const a = await writer.create(ROOT, { title: 'winner A', type: 'FEATURE' });
    expect(a.success).toBe(true);
    if (!a.success) return;
    expect(a.task.id).toMatch(/^TASK_\d{4}_\d{3,}_[0-9a-f]{4}$/);
    expect(a.task.id).toMatch(new RegExp(`^TASK_${YEAR}_001_`));

    // Snapshot A's carrier so we can prove B never writes over it.
    const aCarrierBefore = await fs.readFile(carrierPath(a.task.id));

    // Session B scans a STALE listing: its first `readDirectory` returns empty,
    // as if B read `.ptah/specs` before A's folder was visible (a network share,
    // an FS cache). B therefore proposes numeric sequence `_001` too, while its
    // independently drawn suffix keeps the full id distinct.
    const realReadDirectory = fs.readDirectory.getMockImplementation();
    if (!realReadDirectory) throw new Error('mock readDirectory missing');
    let stale = true;
    fs.readDirectory.mockImplementation(async (target: string) => {
      if (stale && target === specsDir()) {
        stale = false;
        return [];
      }
      return realReadDirectory(target);
    });

    const b = await writer.create(ROOT, { title: 'loser B', type: 'BUGFIX' });

    // B did NOT clobber and did NOT fail: the discriminator makes its full id
    // distinct even though the stale scan selected the same numeric sequence.
    expect(b.success).toBe(true);
    if (!b.success) return;
    expect(b.task.id).toMatch(/^TASK_\d{4}_\d{3,}_[0-9a-f]{4}$/);
    expect(b.task.id).not.toBe(a.task.id);

    // B claimed only its own suffixed folder and never touched A's folder.
    expect(fs.createDirectoryExclusive).toHaveBeenCalledWith(
      path.join(specsDir(), b.task.id),
    );

    // Criterion 2: A's carrier is byte-for-byte what A wrote. No overwrite.
    const aCarrierAfter = await fs.readFile(carrierPath(a.task.id));
    expect(aCarrierAfter).toBe(aCarrierBefore);
    expect(aCarrierAfter).toContain('winner A');
    expect(aCarrierAfter).not.toContain('loser B');
  });

  /**
   * The cross-CHECKOUT half of the same race (TASK_2026_403).
   *
   * `.ptah/**` is gitignored, so a sibling worktree's task folders are visible
   * only through `git worktree list` + a directory read, and a branch pushed to
   * `origin/main` only through `git ls-tree`. Without either, this checkout's
   * local scan is empty and it happily re-proposes a NUMBER another checkout
   * already owns — the exclusive `mkdir` cannot save it, because the two
   * folders live on different paths and both claims succeed.
   */
  it('does not re-propose a number that only another checkout can see', async () => {
    const elsewhere: ITaskFolderVisibility = {
      async listBeyondWorkspace() {
        return [`TASK_${YEAR}_001_aaaa`];
      },
    };
    const { writer } = makeWriter(elsewhere);

    const created = await writer.create(ROOT, {
      title: 'second checkout',
      type: 'FEATURE',
    });

    expect(created.success).toBe(true);
    if (!created.success) return;
    expect(created.task.id).toMatch(
      new RegExp(`^TASK_${YEAR}_002_[0-9a-f]{4}$`),
    );
  });
});
