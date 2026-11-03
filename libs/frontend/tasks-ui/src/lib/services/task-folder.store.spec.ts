import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { TaskSpecDetail } from '@ptah-extension/shared';
import { TaskFolderStore } from './task-folder.store';

const ok = <T>(data: T) => ({ success: true, isSuccess: () => true, data });
const err = (error: string) => ({
  success: false,
  isSuccess: () => false,
  error,
});

interface Deferred {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
}

function deferred(): Deferred {
  let resolve: (value: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const TASK = 'TASK_2026_001';
const ROOT = 'D:/ws';

function makeDetail(partial: Partial<TaskSpecDetail> = {}): TaskSpecDetail {
  return {
    id: TASK,
    folderName: TASK,
    status: 'backlog',
    type: 'FEATURE',
    title: 'A task',
    dependsOn: [],
    labels: [],
    duplicates: [],
    relatesTo: [],
    created: null,
    updated: null,
    frontmatterValid: true,
    validationIssues: [],
    body: '',
    artifacts: ['context.md', 'decisions.md'],
    entries: [
      { name: 'task.md', kind: 'file' },
      { name: 'context.md', kind: 'file' },
      { name: 'decisions.md', kind: 'file' },
      { name: 'prototype', kind: 'directory' },
    ],
    ...partial,
  };
}

describe('TaskFolderStore', () => {
  let store: TaskFolderStore;
  let rpcCall: jest.Mock;

  beforeEach(() => {
    rpcCall = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        TaskFolderStore,
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall },
        },
      ],
    });
    store = TestBed.inject(TaskFolderStore);
    store.selectTask(TASK, ROOT);
    store.setDetail(makeDetail());
  });

  describe('entries', () => {
    it('maps the detail listing into root rows', () => {
      const listing = store.listing();
      expect(listing.status).toBe('ready');
      expect(listing.directory).toBe('');
      const names = store.entries().map((row) => `${row.name}:${row.presence}`);
      expect(names).toContain('context.md:present');
      expect(names).toContain('implementation-plan.md:missing');
      expect(names).toContain('decisions.md:present');
      expect(names).toContain('prototype:present');
      expect(store.breadcrumbs()).toEqual([{ label: TASK, path: '' }]);
    });

    it('is loading until the detail arrives and idle after reset', () => {
      store.selectTask(TASK, ROOT);
      expect(store.listing().status).toBe('loading');
      store.reset();
      expect(store.listing().status).toBe('idle');
      expect(store.entries()).toEqual([]);
    });

    it('ignores a detail for another folder', () => {
      store.selectTask(TASK, ROOT);
      store.setDetail(makeDetail({ id: 'OTHER', folderName: 'OTHER' }));
      expect(store.listing().status).toBe('loading');
    });
  });

  describe('readFile', () => {
    it('reads a workflow document through tasks:getArtifact', async () => {
      rpcCall.mockResolvedValue(ok({ file: 'context.md', content: '# Ctx' }));

      const state = await store.readFile('context.md');

      expect(rpcCall).toHaveBeenCalledWith('tasks:getArtifact', {
        taskId: TASK,
        file: 'context.md',
        workspaceRoot: ROOT,
      });
      expect(state).toEqual({ status: 'ready', file: 'context.md', content: '# Ctx' });
      expect(store.document()).toEqual(state);
      expect(store.openFile()).toBe('context.md');
    });

    it('maps a null workflow document to missing', async () => {
      rpcCall.mockResolvedValue(ok({ file: 'test-report.md', content: null }));
      await store.readFile('test-report.md');
      expect(store.document()).toEqual({ status: 'missing', file: 'test-report.md' });
    });

    it('keeps the legacy tasks.md on the closed document reader', async () => {
      rpcCall.mockResolvedValue(ok({ file: 'tasks.md', content: '- [ ] a' }));
      await store.readFile('tasks.md');
      expect(rpcCall.mock.calls[0][0]).toBe('tasks:getArtifact');
      expect(store.document().status).toBe('ready');
    });

    it('reads extra markdown through tasks:readFolderMarkdown', async () => {
      rpcCall.mockResolvedValue(
        ok({ taskId: TASK, file: 'decisions.md', state: 'ready', content: '' }),
      );

      await store.readFile('decisions.md');

      expect(rpcCall).toHaveBeenCalledWith('tasks:readFolderMarkdown', {
        taskId: TASK,
        file: 'decisions.md',
        workspaceRoot: ROOT,
      });
      expect(store.document()).toEqual({
        status: 'ready',
        file: 'decisions.md',
        content: '',
      });
    });

    it.each([
      'missing',
      'unreadable',
      'binary',
      'directory',
      'too_large',
      'rejected',
    ] as const)('surfaces the %s state', async (state) => {
      rpcCall.mockResolvedValue(
        ok({ taskId: TASK, file: 'notes.md', state, content: null }),
      );

      const result = await store.readFile('notes.md');

      expect(result).toEqual({ status: state, file: 'notes.md' });
      expect(store.document()).toEqual({ status: state, file: 'notes.md' });
    });

    it('rejects an ineligible name locally without a host call', async () => {
      await expect(store.readFile('../secret.md')).resolves.toEqual({
        status: 'rejected',
        file: '../secret.md',
      });
      await store.readFile('Notes.TXT');
      expect(store.document()).toEqual({ status: 'rejected', file: 'Notes.TXT' });
      expect(rpcCall).not.toHaveBeenCalled();
    });

    it('turns an RPC failure into an error state', async () => {
      rpcCall.mockResolvedValue(err('INVALID_PARAMS'));
      await store.readFile('decisions.md');
      expect(store.document()).toEqual({
        status: 'error',
        file: 'decisions.md',
        message: 'INVALID_PARAMS',
      });
    });

    it('turns a thrown transport error into an error state', async () => {
      rpcCall.mockRejectedValue(new Error('timeout'));
      await expect(store.readFile('context.md')).resolves.toEqual({
        status: 'error',
        file: 'context.md',
        message: 'timeout',
      });
    });

    it('refuses a response naming another file or task', async () => {
      rpcCall.mockResolvedValueOnce(
        ok({ taskId: 'OTHER', file: 'decisions.md', state: 'ready', content: 'x' }),
      );
      await store.readFile('decisions.md');
      expect(store.document().status).toBe('error');

      rpcCall.mockResolvedValueOnce(ok({ file: 'batches.md', content: 'x' }));
      await store.readFile('context.md');
      expect(store.document().status).toBe('error');
    });

    it('refuses an unknown state', async () => {
      rpcCall.mockResolvedValue(
        ok({ taskId: TASK, file: 'notes.md', state: 'weird', content: null }),
      );
      await store.readFile('notes.md');
      expect(store.document().status).toBe('error');
    });

    it('shows the LAST selected file when responses arrive out of order', async () => {
      const first = deferred();
      const second = deferred();
      const third = deferred();
      rpcCall
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
        .mockReturnValueOnce(third.promise);

      const a = store.readFile('context.md');
      const b = store.readFile('decisions.md');
      const c = store.readFile('implementation-plan.md');
      expect(store.document()).toEqual({
        status: 'loading',
        file: 'implementation-plan.md',
      });

      third.resolve(ok({ file: 'implementation-plan.md', content: '# Plan' }));
      second.resolve(
        ok({ taskId: TASK, file: 'decisions.md', state: 'ready', content: 'D' }),
      );
      first.resolve(ok({ file: 'context.md', content: '# Ctx' }));

      await expect(a).resolves.toBeNull();
      await expect(b).resolves.toBeNull();
      await expect(c).resolves.toEqual({
        status: 'ready',
        file: 'implementation-plan.md',
        content: '# Plan',
      });
      expect(store.document()).toEqual({
        status: 'ready',
        file: 'implementation-plan.md',
        content: '# Plan',
      });
    });

    it('drops a read that lands after a task switch', async () => {
      const pending = deferred();
      rpcCall.mockReturnValueOnce(pending.promise);

      const read = store.readFile('context.md');
      store.selectTask('TASK_2026_002', ROOT);
      pending.resolve(ok({ file: 'context.md', content: '# Old' }));

      await expect(read).resolves.toBeNull();
      expect(store.document()).toEqual({ status: 'idle' });
      expect(store.openFile()).toBeNull();
    });

    it('drops a read that lands after a root switch for the same task', async () => {
      const pending = deferred();
      rpcCall.mockReturnValueOnce(pending.promise);

      const read = store.readFile('context.md');
      store.selectTask(TASK, 'E:/other');
      pending.resolve(ok({ file: 'context.md', content: '# Old root' }));

      await expect(read).resolves.toBeNull();
      expect(store.document()).toEqual({ status: 'idle' });
    });

    it('drops a read that lands after closeDocument', async () => {
      const pending = deferred();
      rpcCall.mockReturnValueOnce(pending.promise);

      const read = store.readFile('context.md');
      store.closeDocument();
      pending.resolve(ok({ file: 'context.md', content: '# Late' }));

      await expect(read).resolves.toBeNull();
      expect(store.document()).toEqual({ status: 'idle' });
    });

    it('closes the reader for null', async () => {
      rpcCall.mockResolvedValue(ok({ file: 'context.md', content: 'x' }));
      await store.readFile('context.md');
      await store.readFile(null);
      expect(store.document()).toEqual({ status: 'idle' });
    });

    it('uses the folder name, not the frontmatter id', async () => {
      store.selectTask('fm-id', ROOT);
      store.setDetail(makeDetail({ id: 'fm-id', folderName: TASK }));
      rpcCall.mockResolvedValue(ok({ file: 'context.md', content: 'x' }));

      await store.readFile('context.md');

      expect(rpcCall).toHaveBeenCalledWith(
        'tasks:getArtifact',
        expect.objectContaining({ taskId: TASK }),
      );
    });
  });

  describe('openDirectory', () => {
    it('lists a nested directory with breadcrumbs', async () => {
      rpcCall.mockResolvedValue(
        ok({
          taskId: TASK,
          directory: 'prototype/assets',
          state: 'ready',
          entries: [
            { name: 'logo.svg', kind: 'file' },
            { name: 'icons', kind: 'directory' },
            { name: '../escape', kind: 'file' },
          ],
        }),
      );

      await store.openDirectory('prototype/assets');

      expect(rpcCall).toHaveBeenCalledWith('tasks:listFolderEntries', {
        taskId: TASK,
        directory: 'prototype/assets',
        workspaceRoot: ROOT,
      });
      expect(store.listing().status).toBe('ready');
      expect(store.entries().map((row) => row.name)).toEqual(['logo.svg', 'icons']);
      expect(store.breadcrumbs()).toEqual([
        { label: TASK, path: '' },
        { label: 'prototype', path: 'prototype' },
        { label: 'assets', path: 'prototype/assets' },
      ]);

      await store.openDirectory('');
      expect(store.listing().directory).toBe('');
      expect(store.entries().some((row) => row.name === 'context.md')).toBe(true);
    });

    it.each(['missing', 'unreadable', 'rejected', 'too_many'] as const)(
      'surfaces the %s listing state',
      async (state) => {
        rpcCall.mockResolvedValue(
          ok({ taskId: TASK, directory: 'prototype', state, entries: [] }),
        );
        await store.openDirectory('prototype');
        expect(store.listing()).toEqual({
          directory: 'prototype',
          status: state,
          entries: [],
          message: null,
        });
      },
    );

    it('rejects an unsafe path locally', async () => {
      await store.openDirectory('prototype/../..');
      expect(store.listing().status).toBe('rejected');
      expect(rpcCall).not.toHaveBeenCalled();
    });

    it('turns a failure into an error state', async () => {
      rpcCall.mockResolvedValue(err('boom'));
      await store.openDirectory('prototype');
      expect(store.listing()).toMatchObject({ status: 'error', message: 'boom' });
    });

    it('keeps the latest directory when listings race', async () => {
      const first = deferred();
      const second = deferred();
      rpcCall.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

      const a = store.openDirectory('prototype');
      const b = store.openDirectory('prototype/assets');
      second.resolve(
        ok({
          taskId: TASK,
          directory: 'prototype/assets',
          state: 'ready',
          entries: [{ name: 'b.png', kind: 'file' }],
        }),
      );
      first.resolve(
        ok({
          taskId: TASK,
          directory: 'prototype',
          state: 'ready',
          entries: [{ name: 'a.html', kind: 'file' }],
        }),
      );
      await Promise.all([a, b]);

      expect(store.directory()).toBe('prototype/assets');
      expect(store.entries().map((row) => row.name)).toEqual(['b.png']);
    });

    it('resets to the root on task switch and drops the late listing', async () => {
      const pending = deferred();
      rpcCall.mockReturnValueOnce(pending.promise);

      const listing = store.openDirectory('prototype');
      store.selectTask('TASK_2026_002', ROOT);
      pending.resolve(
        ok({ taskId: TASK, directory: 'prototype', state: 'ready', entries: [] }),
      );
      await listing;

      expect(store.directory()).toBe('');
      expect(store.listing().status).toBe('loading');
    });
  });
});
