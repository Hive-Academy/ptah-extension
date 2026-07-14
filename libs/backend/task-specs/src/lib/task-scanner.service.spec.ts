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
