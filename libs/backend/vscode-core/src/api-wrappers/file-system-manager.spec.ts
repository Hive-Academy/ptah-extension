/**
 * FileSystemManager unit tests.
 *
 * Exercises the real FileSystemManager surface: read/write/delete/copy/move,
 * stat, readDirectory (with filtering), file watcher creation and disposal,
 * metric tracking on both success and failure, and disposal.
 */

import 'reflect-metadata';
import type * as vscode from 'vscode';

import {
  FileSystemManager,
  type FileWatcherConfig,
} from './file-system-manager';

// -------------------------------------------------------------------------
// Module-level vscode mock
// -------------------------------------------------------------------------
jest.mock('vscode', () => ({
  workspace: {
    fs: {
      readFile: jest.fn(),
      writeFile: jest.fn(),
      delete: jest.fn(),
      copy: jest.fn(),
      rename: jest.fn(),
      stat: jest.fn(),
      readDirectory: jest.fn(),
    },
    createFileSystemWatcher: jest.fn(),
    getWorkspaceFolder: jest.fn(),
  },
  FileType: {
    Unknown: 0,
    File: 1,
    Directory: 2,
    SymbolicLink: 64,
  },
  Uri: {
    file: (path: string) => ({
      scheme: 'file',
      fsPath: path,
      path,
      authority: '',
      query: '',
      fragment: '',
      toString: () => `file://${path}`,
    }),
  },
}));

type MockFs = {
  readFile: jest.Mock;
  writeFile: jest.Mock;
  delete: jest.Mock;
  copy: jest.Mock;
  rename: jest.Mock;
  stat: jest.Mock;
  readDirectory: jest.Mock;
};

const vscodeModule = jest.requireMock<{
  workspace: {
    fs: MockFs;
    createFileSystemWatcher: jest.Mock;
    getWorkspaceFolder: jest.Mock;
  };
  Uri: { file: (path: string) => vscode.Uri };
  FileType: { File: number; Directory: number };
}>('vscode');

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------
interface MockWatcher {
  onDidCreate: jest.Mock;
  onDidChange: jest.Mock;
  onDidDelete: jest.Mock;
  dispose: jest.Mock;
}

function createMockWatcher(): MockWatcher {
  return {
    onDidCreate: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    onDidChange: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    onDidDelete: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    dispose: jest.fn(),
  };
}

function createMockContext(): Pick<vscode.ExtensionContext, 'subscriptions'> {
  return { subscriptions: [] } as Pick<
    vscode.ExtensionContext,
    'subscriptions'
  >;
}

function buildStat(size: number): vscode.FileStat {
  return {
    type: vscodeModule.FileType.File,
    ctime: 0,
    mtime: 0,
    size,
  } as unknown as vscode.FileStat;
}

describe('FileSystemManager', () => {
  let context: Pick<vscode.ExtensionContext, 'subscriptions'>;
  let fs: MockFs;
  let manager: FileSystemManager;

  const testUri = vscodeModule.Uri.file('/tmp/test.txt');
  const targetUri = vscodeModule.Uri.file('/tmp/target.txt');

  beforeEach(() => {
    jest.clearAllMocks();
    fs = vscodeModule.workspace.fs;

    // Reset all fs method defaults so each test starts from a clean slate.
    fs.readFile.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    fs.writeFile.mockResolvedValue(undefined);
    fs.delete.mockResolvedValue(undefined);
    fs.copy.mockResolvedValue(undefined);
    fs.rename.mockResolvedValue(undefined);
    fs.stat.mockResolvedValue(buildStat(1024));
    fs.readDirectory.mockResolvedValue([]);

    context = createMockContext();
    manager = new FileSystemManager(context as vscode.ExtensionContext);
  });

  afterEach(() => {
    manager.dispose();
  });

  // ---------------------------------------------------------------------
  // Construction / metric initialisation
  // ---------------------------------------------------------------------
  describe('construction', () => {
    it('initialises metrics for every known operation type', () => {
      const metrics = manager.getOperationMetrics() as Record<
        string,
        { totalOperations: number }
      >;

      expect(Object.keys(metrics).sort()).toEqual(
        [
          'copy',
          'create',
          'delete',
          'move',
          'read',
          'readdir',
          'stat',
          'write',
        ].sort(),
      );
      Object.values(metrics).forEach((entry) => {
        expect(entry.totalOperations).toBe(0);
      });
    });
  });

  // ---------------------------------------------------------------------
  // readFile
  // ---------------------------------------------------------------------
  describe('readFile', () => {
    it('delegates to workspace.fs.readFile and returns the bytes', async () => {
      const content = await manager.readFile(testUri);

      expect(fs.readFile).toHaveBeenCalledWith(testUri);
      expect(Array.from(content)).toEqual([1, 2, 3, 4]);
    });

    it('increments success metrics with the byte count', async () => {
      await manager.readFile(testUri);

      const metrics = manager.getOperationMetrics('read');
      if (metrics === null || Array.isArray(metrics)) {
        throw new Error('expected per-operation metrics object');
      }
      expect(metrics.totalOperations).toBe(1);
      expect(metrics.successfulOperations).toBe(1);
      expect(metrics.totalBytesProcessed).toBe(4);
    });

    it('propagates errors and increments failure metrics', async () => {
      const failure = new Error('ENOENT: not found');
      fs.readFile.mockRejectedValueOnce(failure);

      await expect(manager.readFile(testUri)).rejects.toBe(failure);

      const metrics = manager.getOperationMetrics('read');
      if (metrics === null || Array.isArray(metrics)) {
        throw new Error('expected per-operation metrics object');
      }
      expect(metrics.failedOperations).toBe(1);
    });

    it('rejects on an invalid URI', async () => {
      const invalid = { scheme: '', fsPath: '' } as vscode.Uri;
      await expect(manager.readFile(invalid)).rejects.toThrow(
        /Invalid URI for read operation/,
      );
    });
  });

  // ---------------------------------------------------------------------
  // writeFile
  // ---------------------------------------------------------------------
  describe('writeFile', () => {
    it('delegates to workspace.fs.writeFile with the content', async () => {
      const payload = new Uint8Array([9, 9, 9]);
      await manager.writeFile(testUri, payload);

      expect(fs.writeFile).toHaveBeenCalledWith(testUri, payload);
    });

    it('tracks bytes processed on success', async () => {
      const payload = new Uint8Array(16);
      await manager.writeFile(testUri, payload);

      const metrics = manager.getOperationMetrics('write');
      if (metrics === null || Array.isArray(metrics)) {
        throw new Error('expected per-operation metrics object');
      }
      expect(metrics.totalBytesProcessed).toBe(16);
    });

    it('propagates errors', async () => {
      const failure = new Error('EACCES: permission denied');
      fs.writeFile.mockRejectedValueOnce(failure);

      await expect(
        manager.writeFile(testUri, new Uint8Array([0])),
      ).rejects.toBe(failure);
    });
  });

  // ---------------------------------------------------------------------
  // delete
  // ---------------------------------------------------------------------
  describe('delete', () => {
    it('stats the target, deletes recursively without trash, and tracks size', async () => {
      fs.stat.mockResolvedValueOnce(buildStat(256));
      await manager.delete(testUri);

      expect(fs.stat).toHaveBeenCalledWith(testUri);
      expect(fs.delete).toHaveBeenCalledWith(testUri, {
        recursive: true,
        useTrash: false,
      });

      const metrics = manager.getOperationMetrics('delete');
      if (metrics === null || Array.isArray(metrics)) {
        throw new Error('expected per-operation metrics object');
      }
      expect(metrics.totalBytesProcessed).toBe(256);
    });

    it('propagates errors from workspace.fs.delete', async () => {
      fs.delete.mockRejectedValueOnce(new Error('delete failed'));
      await expect(manager.delete(testUri)).rejects.toThrow('delete failed');
    });
  });

  // ---------------------------------------------------------------------
  // copy
  // ---------------------------------------------------------------------
  describe('copy', () => {
    it('delegates to workspace.fs.copy with overwrite defaulting to false', async () => {
      await manager.copy(testUri, targetUri);

      expect(fs.copy).toHaveBeenCalledWith(testUri, targetUri, {
        overwrite: false,
      });
    });

    it('forwards overwrite=true when requested', async () => {
      await manager.copy(testUri, targetUri, { overwrite: true });

      expect(fs.copy).toHaveBeenCalledWith(testUri, targetUri, {
        overwrite: true,
      });
    });

    it('propagates errors and increments failure metrics', async () => {
      fs.copy.mockRejectedValueOnce(new Error('EEXIST: already exists'));
      await expect(manager.copy(testUri, targetUri)).rejects.toThrow(
        'EEXIST: already exists',
      );

      const metrics = manager.getOperationMetrics('copy');
      if (metrics === null || Array.isArray(metrics)) {
        throw new Error('expected per-operation metrics object');
      }
      expect(metrics.failedOperations).toBe(1);
    });
  });

  // ---------------------------------------------------------------------
  // move
  // ---------------------------------------------------------------------
  describe('move', () => {
    it('delegates to workspace.fs.rename with overwrite defaulting to false', async () => {
      await manager.move(testUri, targetUri);

      expect(fs.rename).toHaveBeenCalledWith(testUri, targetUri, {
        overwrite: false,
      });
    });

    it('forwards overwrite=true when requested', async () => {
      await manager.move(testUri, targetUri, { overwrite: true });

      expect(fs.rename).toHaveBeenCalledWith(testUri, targetUri, {
        overwrite: true,
      });
    });

    it('propagates errors', async () => {
      fs.rename.mockRejectedValueOnce(new Error('rename failed'));
      await expect(manager.move(testUri, targetUri)).rejects.toThrow(
        'rename failed',
      );
    });
  });

  // ---------------------------------------------------------------------
  // stat
  // ---------------------------------------------------------------------
  describe('stat', () => {
    it('returns the FileStat from vscode.workspace.fs.stat', async () => {
      const stat = buildStat(42);
      fs.stat.mockResolvedValueOnce(stat);

      await expect(manager.stat(testUri)).resolves.toBe(stat);
    });

    it('propagates errors and increments failure metrics', async () => {
      fs.stat.mockRejectedValueOnce(new Error('stat failed'));
      await expect(manager.stat(testUri)).rejects.toThrow('stat failed');

      const metrics = manager.getOperationMetrics('stat');
      if (metrics === null || Array.isArray(metrics)) {
        throw new Error('expected per-operation metrics object');
      }
      expect(metrics.failedOperations).toBe(1);
    });
  });

  // ---------------------------------------------------------------------
  // readDirectory (with filtering)
  // ---------------------------------------------------------------------
  describe('readDirectory', () => {
    beforeEach(() => {
      fs.readDirectory.mockResolvedValue([
        ['visible.txt', vscodeModule.FileType.File],
        ['.hidden', vscodeModule.FileType.File],
        ['node_modules', vscodeModule.FileType.Directory],
        ['keep', vscodeModule.FileType.Directory],
      ]);
    });

    it('filters hidden entries by default', async () => {
      const entries = await manager.readDirectory(testUri);

      const names = entries.map(([name]) => name);
      expect(names).toContain('visible.txt');
      expect(names).not.toContain('.hidden');
    });

    it('includes hidden entries when includeHidden=true', async () => {
      const entries = await manager.readDirectory(testUri, {
        includeHidden: true,
      });

      const names = entries.map(([name]) => name);
      expect(names).toContain('.hidden');
    });

    it('applies exclude patterns', async () => {
      const entries = await manager.readDirectory(testUri, {
        exclude: ['node_modules'],
      });

      const names = entries.map(([name]) => name);
      expect(names).toContain('visible.txt');
      expect(names).toContain('keep');
      expect(names).not.toContain('node_modules');
    });

    it('propagates errors', async () => {
      fs.readDirectory.mockRejectedValueOnce(new Error('readdir failed'));
      await expect(manager.readDirectory(testUri)).rejects.toThrow(
        'readdir failed',
      );
    });
  });

  // ---------------------------------------------------------------------
  // createWatcher / disposeWatcher
  // ---------------------------------------------------------------------
  describe('watchers', () => {
    it('createWatcher() creates the watcher, wires event handlers, and tracks it', () => {
      const watcher = createMockWatcher();
      vscodeModule.workspace.createFileSystemWatcher.mockReturnValueOnce(
        watcher,
      );

      const config: FileWatcherConfig = {
        id: 'watch.1',
        pattern: '**/*.ts',
        ignoreCreateEvents: false,
        ignoreChangeEvents: false,
        ignoreDeleteEvents: false,
      };

      const result = manager.createWatcher(config);

      expect(
        vscodeModule.workspace.createFileSystemWatcher,
      ).toHaveBeenCalledWith('**/*.ts', false, false, false);
      expect(result).toBe(watcher);
      expect(watcher.onDidCreate).toHaveBeenCalledTimes(1);
      expect(watcher.onDidChange).toHaveBeenCalledTimes(1);
      expect(watcher.onDidDelete).toHaveBeenCalledTimes(1);
      expect(context.subscriptions).toContain(watcher);
      expect(manager.getActiveWatchers()).toEqual(['watch.1']);
    });

    it('returns the existing watcher when the same id is requested again', () => {
      const watcher = createMockWatcher();
      vscodeModule.workspace.createFileSystemWatcher.mockReturnValue(watcher);

      const first = manager.createWatcher({
        id: 'watch.dup',
        pattern: '**/*.ts',
      });
      const second = manager.createWatcher({
        id: 'watch.dup',
        pattern: '**/*.ts',
      });

      expect(second).toBe(first);
      expect(
        vscodeModule.workspace.createFileSystemWatcher,
      ).toHaveBeenCalledTimes(1);
    });

    it('disposeWatcher() disposes and forgets the watcher', () => {
      const watcher = createMockWatcher();
      vscodeModule.workspace.createFileSystemWatcher.mockReturnValueOnce(
        watcher,
      );
      manager.createWatcher({ id: 'watch.disp', pattern: '**/*.ts' });

      expect(manager.disposeWatcher('watch.disp')).toBe(true);
      expect(watcher.dispose).toHaveBeenCalledTimes(1);
      expect(manager.getActiveWatchers()).toEqual([]);
    });

    it('disposeWatcher() returns false for an unknown id', () => {
      expect(manager.disposeWatcher('watch.unknown')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // dispose
  // ---------------------------------------------------------------------
  describe('dispose', () => {
    it('disposes every active watcher and clears operation metrics', () => {
      const w1 = createMockWatcher();
      const w2 = createMockWatcher();
      vscodeModule.workspace.createFileSystemWatcher
        .mockReturnValueOnce(w1)
        .mockReturnValueOnce(w2);

      manager.createWatcher({ id: 'w.1', pattern: '**/*' });
      manager.createWatcher({ id: 'w.2', pattern: '**/*' });

      manager.dispose();

      expect(w1.dispose).toHaveBeenCalledTimes(1);
      expect(w2.dispose).toHaveBeenCalledTimes(1);
      expect(manager.getActiveWatchers()).toEqual([]);
      expect(manager.getOperationMetrics()).toEqual({});
    });
  });
});
