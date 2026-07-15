import * as path from 'path';
import { createMockFileSystemProvider } from '@ptah-extension/platform-core/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { normalizeWorkspaceRoot } from './normalize-workspace-root';
import { NoOpTaskIndexNotifier } from './task-index.port';
import { parseTaskFile } from './task-frontmatter';
import { TaskWriterService } from './task-writer.service';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

const ROOT = 'd:/tmp/ws-writer';
const YEAR = new Date().getFullYear();

function specsDir(): string {
  return path.join(normalizeWorkspaceRoot(ROOT), '.ptah', 'specs');
}

function makeWriter() {
  const fs = createMockFileSystemProvider();
  const writer = new TaskWriterService(
    fs,
    makeLogger(),
    new NoOpTaskIndexNotifier(),
  );
  return { fs, writer };
}

describe('TaskWriterService.create', () => {
  it('creates a round-trip-valid task.md with zero issues', async () => {
    const { writer } = makeWriter();

    const result = await writer.create(ROOT, {
      title: 'First task',
      type: 'FEATURE',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.task.id).toBe(`TASK_${YEAR}_001`);
    expect(result.task.status).toBe('backlog');
    expect(result.task.type).toBe('FEATURE');
    expect(result.task.frontmatterValid).toBe(true);
    expect(result.task.validationIssues).toHaveLength(0);
  });

  it('rejects a collision without overwriting (TASK_FOLDER_EXISTS)', async () => {
    const { fs, writer } = makeWriter();
    await writer.create(ROOT, { title: 'one', type: 'FEATURE' });
    // Pre-create the next allocation target's folder.
    await fs.createDirectory(path.join(specsDir(), `TASK_${YEAR}_002`));

    const result = await writer.create(ROOT, { title: 'two', type: 'BUGFIX' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('TASK_FOLDER_EXISTS');
  });

  it('rejects an empty title', async () => {
    const { writer } = makeWriter();
    const result = await writer.create(ROOT, { title: '  ', type: 'FEATURE' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('INVALID_PARAMS');
  });
});

describe('TaskWriterService.updateStatus', () => {
  it('preserves the body while refreshing status + updated', async () => {
    const { fs, writer } = makeWriter();
    const created = await writer.create(ROOT, {
      title: 'Body task',
      type: 'FEATURE',
      description: 'Keep this body intact.',
    });
    expect(created.success).toBe(true);
    if (!created.success) return;
    const id = created.task.id;
    const carrier = path.join(specsDir(), id, 'task.md');

    const before = await fs.readFile(carrier);
    const body = before.slice(before.indexOf('\n## Description'));

    const result = await writer.updateStatus(ROOT, id, 'in_progress');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.task.status).toBe('in_progress');

    const after = await fs.readFile(carrier);
    expect(after.endsWith(body)).toBe(true);
    const reparsed = parseTaskFile(id, after);
    expect(reparsed.kind).toBe('task');
    if (reparsed.kind !== 'task') return;
    expect(reparsed.task.status).toBe('in_progress');
    expect(reparsed.task.updated).not.toBe(created.task.updated);
  });

  it('returns TASK_NOT_FOUND for a missing folder', async () => {
    const { writer } = makeWriter();
    const result = await writer.updateStatus(ROOT, 'TASK_2026_999', 'done');
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('TASK_NOT_FOUND');
  });

  it('returns TASK_EXCLUDED for an invalid-frontmatter carrier', async () => {
    const { fs, writer } = makeWriter();
    const carrier = path.join(specsDir(), 'TASK_2026_500', 'task.md');
    await fs.writeFile(carrier, '---\nstatus: wip\ntitle: bad\n---\nbody');

    const result = await writer.updateStatus(ROOT, 'TASK_2026_500', 'done');

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('TASK_EXCLUDED');
  });

  it('notifies the index after mutating the file (write-order)', async () => {
    const fs = createMockFileSystemProvider();
    const notifier = new NoOpTaskIndexNotifier();
    const spy = jest.spyOn(notifier, 'applyFolderChange');
    const writer = new TaskWriterService(fs, makeLogger(), notifier);

    const created = await writer.create(ROOT, {
      title: 't',
      type: 'FEATURE',
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    await writer.updateStatus(ROOT, created.task.id, 'done');

    expect(spy).toHaveBeenCalledWith(
      normalizeWorkspaceRoot(ROOT),
      created.task.id,
    );
  });
});
