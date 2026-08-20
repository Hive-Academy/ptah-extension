import * as path from 'path';
import { createMockFileSystemProvider } from '@ptah-extension/platform-core/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { normalizeWorkspaceRoot } from './normalize-workspace-root';
import { TaskScannerService } from './task-scanner.service';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

const ROOT = 'd:/tmp/ws-scan';

function specsDir(): string {
  return path.join(normalizeWorkspaceRoot(ROOT), '.ptah', 'specs');
}

function carrier(folder: string): string {
  return path.join(specsDir(), folder, 'task.md');
}

function validTask(id: string): string {
  return `---\nstatus: backlog\ntitle: ${id}\n---\nbody`;
}

describe('TaskScannerService', () => {
  it('returns a clean no-op when .ptah/specs is missing', async () => {
    const fs = createMockFileSystemProvider();
    const scanner = new TaskScannerService(fs, makeLogger());

    const result = await scanner.scan(ROOT);

    expect(result).toEqual({ tasks: [], excluded: [], specsDirExists: false });
  });

  it('classifies a mixed tree into included tasks and typed exclusions', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile(carrier('TASK_2026_001'), validTask('TASK_2026_001'));
    await fs.writeFile(carrier('TASK_2026_002'), validTask('TASK_2026_002'));
    // Folder with no carrier.
    await fs.createDirectory(path.join(specsDir(), 'TASK_2026_003'));
    // Folder with invalid frontmatter.
    await fs.writeFile(
      carrier('TASK_2026_004'),
      '---\nstatus: wip\ntitle: bad\n---\nbody',
    );
    // Archive + dot dirs must be skipped.
    await fs.writeFile(
      path.join(specsDir(), '.archive', 'TASK_OLD', 'task.md'),
      validTask('TASK_OLD'),
    );

    const scanner = new TaskScannerService(fs, makeLogger());
    const result = await scanner.scan(ROOT);

    expect(result.specsDirExists).toBe(true);
    expect(result.tasks.map((t) => t.id).sort()).toEqual([
      'TASK_2026_001',
      'TASK_2026_002',
    ]);
    const excludedByFolder = Object.fromEntries(
      result.excluded.map((e) => [e.folderName, e.reason]),
    );
    expect(excludedByFolder['TASK_2026_003']).toBe('no_carrier');
    expect(excludedByFolder['TASK_2026_004']).toBe('invalid_status');
    expect(excludedByFolder['.archive']).toBeUndefined();
  });

  it('marks an unreadable carrier as excluded without throwing', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile(carrier('TASK_2026_010'), validTask('TASK_2026_010'));
    const realRead = fs.readFile.getMockImplementation();
    fs.readFile.mockImplementation(async (p: string) => {
      if (p.includes('TASK_2026_010')) {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      }
      return realRead ? realRead(p) : '';
    });

    const scanner = new TaskScannerService(fs, makeLogger());
    const result = await scanner.scan(ROOT);

    expect(result.tasks).toHaveLength(0);
    expect(result.excluded).toEqual([
      { folderName: 'TASK_2026_010', reason: 'unreadable' },
    ]);
  });

  /**
   * The scan is FLAT, and this test exists to keep it that way.
   *
   * Sub-tasks are expressed with a `parent:` key, never with a nested folder.
   * The scanner builds exactly one candidate carrier path per top-level folder,
   * so a carrier one directory deeper than that is invisible to it — and
   * equally invisible to the id allocator and the doctor, which walk the same
   * level. A nested task would therefore be silently unschedulable and could
   * have its id re-issued to a different task. Asserting the flat contract
   * freezes behaviour that is already correct rather than implementing it.
   */
  it('never indexes a carrier nested inside another task folder', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile(
      path.join(specsDir(), 'TASK_2026_030', 'TASK_2026_031', 'task.md'),
      validTask('TASK_2026_031'),
    );

    const scanner = new TaskScannerService(fs, makeLogger());
    const result = await scanner.scan(ROOT);

    expect(result.tasks).toHaveLength(0);
    expect(result.excluded).toEqual([
      { folderName: 'TASK_2026_030', reason: 'no_carrier' },
    ]);
  });

  it('attaches the markdown body to included tasks', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile(
      carrier('TASK_2026_020'),
      '---\nstatus: done\ntitle: t\n---\n## Description\n\nHello.\n',
    );
    const scanner = new TaskScannerService(fs, makeLogger());

    const result = await scanner.scan(ROOT);

    expect(result.tasks[0].body).toContain('Hello.');
  });
});

/**
 * Cross-file validation (TASK_2026_181).
 *
 * These issues are merged into `validationIssues` HERE rather than left to the
 * board, so the row the index persists is self-describing: `tasks:list` carries
 * the warning without its caller having to rebuild the graph to find it.
 */
describe('TaskScannerService — cross-file issues', () => {
  function taskWith(id: string, frontmatter: string): string {
    return `---\nstatus: backlog\ntitle: ${id}\n${frontmatter}\n---\nbody`;
  }

  function codesFor(
    result: Awaited<ReturnType<TaskScannerService['scan']>>,
    id: string,
  ): string[] {
    const found = result.tasks.find((t) => t.id === id);
    return (found?.validationIssues ?? []).map((issue) => issue.code);
  }

  it('reports a multi-file parent cycle no single carrier can see', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile(
      carrier('TASK_2026_040'),
      taskWith('TASK_2026_040', 'parent: TASK_2026_041'),
    );
    await fs.writeFile(
      carrier('TASK_2026_041'),
      taskWith('TASK_2026_041', 'parent: TASK_2026_040'),
    );

    const result = await new TaskScannerService(fs, makeLogger()).scan(ROOT);

    expect(codesFor(result, 'TASK_2026_040')).toEqual(['parent_cycle']);
    expect(codesFor(result, 'TASK_2026_041')).toEqual(['parent_cycle']);
    // The whole point of merging here: the persisted row says so itself.
    for (const task of result.tasks) {
      expect(task.frontmatterValid).toBe(false);
    }
  });

  it('reports parent_depth_exceeded on the child making the claim', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile(carrier('TASK_2026_050'), validTask('TASK_2026_050'));
    await fs.writeFile(
      carrier('TASK_2026_051'),
      taskWith('TASK_2026_051', 'parent: TASK_2026_050'),
    );
    await fs.writeFile(
      carrier('TASK_2026_052'),
      taskWith('TASK_2026_052', 'parent: TASK_2026_051'),
    );

    const result = await new TaskScannerService(fs, makeLogger()).scan(ROOT);

    expect(codesFor(result, 'TASK_2026_052')).toEqual([
      'parent_depth_exceeded',
    ]);
    expect(codesFor(result, 'TASK_2026_051')).toEqual([]);
    expect(codesFor(result, 'TASK_2026_050')).toEqual([]);
    // All three stay on the board.
    expect(result.tasks).toHaveLength(3);
  });

  /**
   * The two passes do not see the same set of bad entries, and one field can
   * hold both kinds at once.
   *
   * `knownFolders` — what the per-file parser is given — is the RAW directory
   * listing, so a folder that exists but whose carrier is broken looks fine to
   * it. `byId` — what the cross-file pass builds — holds only the carriers that
   * parsed, so that same entry is precisely the one it catches. A task naming
   * one of each in a single `relates_to` array is therefore the case where a
   * de-duplication key that knows the field but not the ENTRY silently drops
   * the graph's finding. There is no second chance to surface it: `tasks-ui`
   * never calls the cross-file pass itself.
   */
  it('keeps BOTH findings when one relates_to array holds a parser-caught and a graph-caught entry', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile(
      carrier('TASK_2026_080'),
      taskWith(
        'TASK_2026_080',
        'relates_to:\n  - TASK_2026_081\n  - TASK_2026_082',
      ),
    );
    // Exists as a folder — so the PARSER sees it as known and stays silent —
    // but its carrier has no title, so it never becomes a task and the graph
    // is the only pass that can flag it.
    await fs.writeFile(
      carrier('TASK_2026_081'),
      '---\nstatus: backlog\n---\nbody',
    );
    // No folder at all: the parser catches this one on its own.

    const result = await new TaskScannerService(fs, makeLogger()).scan(ROOT);

    expect(result.excluded).toContainEqual({
      folderName: 'TASK_2026_081',
      reason: 'missing_title',
    });

    const issues =
      result.tasks.find((t) => t.id === 'TASK_2026_080')?.validationIssues ??
      [];

    // BOTH survive the merge, and each names the entry it is about.
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.code === 'dangling_relation')).toBe(true);
    expect(issues.map((i) => i.ref).sort()).toEqual([
      'TASK_2026_081',
      'TASK_2026_082',
    ]);
    expect(issues.map((i) => i.message).join('\n')).toContain('TASK_2026_081');

    // The graph's finding says something the parser structurally could not.
    const graphCaught = issues.find((i) => i.ref === 'TASK_2026_081');
    expect(graphCaught?.message).toContain('readable carrier');
  });

  it('does not report a self-parent twice when both passes catch it', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile(
      carrier('TASK_2026_060'),
      taskWith('TASK_2026_060', 'parent: TASK_2026_060'),
    );

    const result = await new TaskScannerService(fs, makeLogger()).scan(ROOT);

    // The parser catches the self-parent case on its own and the graph catches
    // it again; the author must be told once. Both passes name the same entry,
    // so the finer-grained key still collapses them — widening the key must not
    // turn into restating the parser's findings in different wording.
    expect(codesFor(result, 'TASK_2026_060')).toEqual(['parent_cycle']);
  });

  it('reports one dangling relation once when both passes name the same entry', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile(
      carrier('TASK_2026_065'),
      taskWith('TASK_2026_065', 'duplicates:\n  - TASK_2026_993'),
    );

    const result = await new TaskScannerService(fs, makeLogger()).scan(ROOT);

    expect(codesFor(result, 'TASK_2026_065')).toEqual(['dangling_relation']);
  });

  it('leaves a clean tree valid and issue-free', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile(carrier('TASK_2026_070'), validTask('TASK_2026_070'));
    await fs.writeFile(
      carrier('TASK_2026_071'),
      taskWith(
        'TASK_2026_071',
        'parent: TASK_2026_070\nrelates_to:\n  - TASK_2026_070',
      ),
    );

    const result = await new TaskScannerService(fs, makeLogger()).scan(ROOT);

    for (const task of result.tasks) {
      expect(task.validationIssues).toEqual([]);
      expect(task.frontmatterValid).toBe(true);
    }
  });
});
