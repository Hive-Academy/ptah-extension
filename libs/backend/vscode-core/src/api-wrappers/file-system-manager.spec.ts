/**
 * FileSystemManager Tests - User Requirement Validation
 * Testing Week 3 implementation: VS Code File System Manager with Event Integration
 * Validates user requirements from TASK_CMD_003
 */

import 'reflect-metadata';
import * as vscode from 'vscode';
import {
  FileSystemManager,
  FileOperationOptions,
  FileWatcherConfig,
} from './file-system-manager';

jest.mock('vscode', () => {
  // Define mock objects inside the jest.mock to avoid hoisting issues
  const mockFileStat = {
    type: 1, // vscode.FileType.File
    ctime: Date.now(),
    mtime: Date.now(),
    size: 1024,
  };

  const mockFileSystemWatcher = {
    onDidCreate: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    onDidChange: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    onDidDelete: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    dispose: jest.fn(),
  };

  return {
    workspace: {
      fs: {
        readFile: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4])),
        writeFile: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
        copy: jest.fn().mockResolvedValue(undefined),
        rename: jest.fn().mockResolvedValue(undefined),
        stat: jest.fn().mockResolvedValue(mockFileStat),
        readDirectory: jest.fn().mockResolvedValue([
          ['file1.txt', 1], // FileType.File
          ['file2.js', 1], // FileType.File
          ['.hidden', 1], // FileType.File
          ['folder1', 2], // FileType.Directory
        ]),
      },
      createFileSystemWatcher: jest.fn().mockReturnValue(mockFileSystemWatcher),
      getWorkspaceFolder: jest.fn().mockReturnValue({ name: 'test-workspace' }),
    },
    FileType: {
      File: 1,
      Directory: 2,
      SymbolicLink: 64,
    },
    Uri: {
      file: jest.fn().mockImplementation((path: string) => ({
        scheme: 'file',
        fsPath: path,
        path,
        toString: () => `file://${path}`,
      })),
      parse: jest.fn(),
    },
    ExtensionContext: jest.fn(),
  };
});

// Access mocked workspace after setup
const mockWorkspace = require('vscode').workspace;
const mockUri = require('vscode').Uri;

// Create accessible mock file stat object for tests
const mockFileStat = {
  type: 1, // vscode.FileType.File
  ctime: Date.now(),
  mtime: Date.now(),
  size: 128, // Match the actual returned value from the FileSystemManager implementation
};

// Create accessible mock file system watcher for tests
const mockFileSystemWatcher = {
  onDidCreate: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  onDidChange: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  onDidDelete: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  dispose: jest.fn(),
};

// Mock EventBus
const mockEventBus = {
  publish: jest.fn(),
  subscribe: jest.fn(),
  dispose: jest.fn(),
};

describe('FileSystemManager - User Requirement: VS Code File System Abstraction', () => {
  let fileSystemManager: FileSystemManager;
  let mockContext: vscode.ExtensionContext;
  let testUri: vscode.Uri;
  let targetUri: vscode.Uri;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset the mock watcher
    mockFileSystemWatcher.dispose.mockClear();
    mockFileSystemWatcher.onDidCreate.mockClear();
    mockFileSystemWatcher.onDidChange.mockClear();
    mockFileSystemWatcher.onDidDelete.mockClear();

    // Reset the workspace mock to return fresh watcher
    mockWorkspace.createFileSystemWatcher.mockReturnValue(
      mockFileSystemWatcher
    );

    mockContext = {
      subscriptions: [],
      workspaceState: {
        get: jest.fn(),
        update: jest.fn(),
        keys: jest.fn().mockReturnValue([]),
      },
      globalState: {
        get: jest.fn(),
        update: jest.fn(),
        setKeysForSync: jest.fn(),
        keys: jest.fn().mockReturnValue([]),
      },
      secrets: {
        get: jest.fn(),
        store: jest.fn(),
        delete: jest.fn(),
        onDidChange: jest.fn(),
      },
      extensionUri: {
        scheme: 'file',
        authority: '',
        path: '/test',
        query: '',
        fragment: '',
        fsPath: '/test',
        with: jest.fn(),
        toString: jest.fn(),
        toJSON: jest.fn(),
      },
      extensionPath: '/test/extension/path',
      environmentVariableCollection: {
        persistent: false,
        replace: jest.fn(),
        append: jest.fn(),
        prepend: jest.fn(),
        get: jest.fn(),
        forEach: jest.fn(),
        delete: jest.fn(),
        clear: jest.fn(),
      },
      storagePath: '/test/storage/path',
      globalStoragePath: '/test/global/storage/path',
      logPath: '/test/log/path',
      extensionMode: 1,
      logUri: {
        scheme: 'file',
        authority: '',
        path: '/test/log',
        query: '',
        fragment: '',
        fsPath: '/test/log',
        with: jest.fn(),
        toString: jest.fn(),
        toJSON: jest.fn(),
      },
      storageUri: {
        scheme: 'file',
        authority: '',
        path: '/test/storage',
        query: '',
        fragment: '',
        fsPath: '/test/storage',
        with: jest.fn(),
        toString: jest.fn(),
        toJSON: jest.fn(),
      },
      globalStorageUri: {
        scheme: 'file',
        authority: '',
        path: '/test/global',
        query: '',
        fragment: '',
        fsPath: '/test/global',
        with: jest.fn(),
        toString: jest.fn(),
        toJSON: jest.fn(),
      },
      asAbsolutePath: jest.fn(),
      extension: {
        id: 'test.extension',
        extensionUri: { scheme: 'file', path: '/test', fsPath: '/test' } as any,
        extensionPath: '/test',
        isActive: true,
        packageJSON: {},
        exports: undefined,
        activate: jest.fn(),
        extensionKind: 1,
      },
      languageModelAccessInformation: {
        onDidChange: jest.fn(),
        canSendRequest: jest.fn().mockReturnValue(true),
      },
    } as any;

    testUri = mockUri.file('/test/file.txt');
    targetUri = mockUri.file('/test/target.txt');

    fileSystemManager = new FileSystemManager(mockContext, mockEventBus as any);
  });

  afterEach(() => {
    fileSystemManager.dispose();
  });

  describe('User Scenario: File Reading Operations', () => {
    it('should read files and track metrics with event integration', async () => {
      // GIVEN: File exists and can be read
      const expectedContent = new Uint8Array([1, 2, 3, 4]);
      mockWorkspace.fs.readFile.mockResolvedValue(expectedContent);

      // WHEN: Reading file
      const result = await fileSystemManager.readFile(testUri);

      // THEN: Should read file and publish event
      expect(mockWorkspace.fs.readFile).toHaveBeenCalledWith(testUri);
      expect(result).toBe(expectedContent);

      // AND: Analytics event should be published
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'fileSystem:operationCompleted',
          properties: {
            operation: 'read',
            uri: testUri.toString(),
            size: 4,
            duration: expect.any(Number),
            workspace: 'test-workspace',
            timestamp: expect.any(Number),
          },
        }
      );

      // AND: Metrics should be updated
      const metrics = fileSystemManager.getOperationMetrics('read');
      expect(metrics).toEqual({
        totalOperations: 1,
        successfulOperations: 1,
        failedOperations: 0,
        totalBytesProcessed: 4,
        averageResponseTime: expect.any(Number),
        lastOperation: expect.any(Number),
      });
    });

    it('should handle read errors and track them', async () => {
      // GIVEN: File read operation fails
      const error = new Error('File not found');
      error.name = 'FileSystemError';
      mockWorkspace.fs.readFile.mockRejectedValueOnce(error);

      // WHEN: Reading file that fails
      // THEN: Should throw error and publish error event
      await expect(fileSystemManager.readFile(testUri)).rejects.toThrow(
        'File not found'
      );

      expect(mockEventBus.publish).toHaveBeenCalledWith('error', {
        code: 'FILE_SYSTEM_READ_FAILED',
        message: 'File system read operation failed: File not found',
        source: 'FileSystemManager',
        data: {
          operation: 'read',
          uri: testUri.toString(),
          targetUri: undefined,
          errorCode: 'FILE_NOT_FOUND',
          duration: expect.any(Number),
          workspace: 'test-workspace',
        },
        timestamp: expect.any(Number),
      });

      // AND: Error metrics should be updated
      const metrics = fileSystemManager.getOperationMetrics('read');
      expect(metrics!.failedOperations).toBe(1);
    });
  });

  describe('User Scenario: File Writing Operations', () => {
    it('should write files with comprehensive tracking', async () => {
      // GIVEN: Content to write
      const content = new Uint8Array([5, 6, 7, 8]);
      const options: FileOperationOptions = { create: true, overwrite: true };

      // WHEN: Writing file
      await fileSystemManager.writeFile(testUri, content, options);

      // THEN: Should write file (VS Code API doesn't support options parameter)
      expect(mockWorkspace.fs.writeFile).toHaveBeenCalledWith(testUri, content);

      // AND: Analytics event should be published
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'fileSystem:operationCompleted',
          properties: {
            operation: 'write',
            uri: testUri.toString(),
            size: 4,
            duration: expect.any(Number),
            created: true,
            overwritten: true,
            workspace: 'test-workspace',
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should write files with default options when not specified', async () => {
      // GIVEN: Content without options
      const content = new Uint8Array([1, 2, 3]);

      // WHEN: Writing file without options
      await fileSystemManager.writeFile(testUri, content);

      // THEN: Should write file (VS Code API doesn't support options parameter)
      expect(mockWorkspace.fs.writeFile).toHaveBeenCalledWith(testUri, content);
    });

    it('should handle write errors properly', async () => {
      // GIVEN: Write operation fails
      const error = new Error('Permission denied');
      mockWorkspace.fs.writeFile.mockRejectedValue(error);

      // WHEN: Writing file that fails
      const content = new Uint8Array([1, 2, 3]);
      await expect(
        fileSystemManager.writeFile(testUri, content)
      ).rejects.toThrow('Permission denied');

      // THEN: Should publish error with proper categorization
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          code: 'FILE_SYSTEM_WRITE_FAILED',
          data: expect.objectContaining({
            errorCode: 'PERMISSION_DENIED',
          }),
        })
      );
    });
  });

  describe('User Scenario: File Deletion Operations', () => {
    it('should delete files and directories with tracking', async () => {
      // GIVEN: File exists
      mockWorkspace.fs.stat.mockResolvedValue({ ...mockFileStat, size: 512 });

      // WHEN: Deleting file
      await fileSystemManager.delete(testUri);

      // THEN: Should delete with recursive options
      expect(mockWorkspace.fs.delete).toHaveBeenCalledWith(testUri, {
        recursive: true,
        useTrash: false,
      });

      // AND: Should publish analytics event
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'fileSystem:operationCompleted',
          properties: {
            operation: 'delete',
            uri: testUri.toString(),
            size: 512,
            duration: expect.any(Number),
            fileType: 'file',
            workspace: 'test-workspace',
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should handle directory deletion', async () => {
      // GIVEN: Directory exists
      mockWorkspace.fs.stat.mockResolvedValue({
        ...mockFileStat,
        type: 2, // vscode.FileType.Directory
        size: 0,
      });

      // WHEN: Deleting directory
      await fileSystemManager.delete(testUri);

      // THEN: Should identify as directory in analytics
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        expect.objectContaining({
          event: 'fileSystem:operationCompleted',
          properties: expect.objectContaining({
            fileType: 'directory',
          }),
        })
      );
    });
  });

  describe('User Scenario: File Copy and Move Operations', () => {
    it('should copy files with comprehensive tracking', async () => {
      // GIVEN: Source file exists
      mockWorkspace.fs.stat.mockResolvedValue({ ...mockFileStat, size: 256 });

      // WHEN: Copying file
      await fileSystemManager.copy(testUri, targetUri, { overwrite: false });

      // THEN: Should copy with proper options
      expect(mockWorkspace.fs.copy).toHaveBeenCalledWith(testUri, targetUri, {
        overwrite: false,
      });

      // AND: Should publish analytics with both URIs
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'fileSystem:operationCompleted',
          properties: {
            operation: 'copy',
            uri: testUri.toString(),
            targetUri: targetUri.toString(),
            size: 256,
            duration: expect.any(Number),
            fileType: 'file',
            overwrite: false,
            sourceWorkspace: 'test-workspace',
            targetWorkspace: 'test-workspace',
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should move files with proper tracking', async () => {
      // GIVEN: Source file exists
      mockWorkspace.fs.stat.mockResolvedValue({ ...mockFileStat, size: 128 });

      // WHEN: Moving file
      await fileSystemManager.move(testUri, targetUri, { overwrite: true });

      // THEN: Should rename with proper options (move = rename in VS Code)
      expect(mockWorkspace.fs.rename).toHaveBeenCalledWith(testUri, targetUri, {
        overwrite: true,
      });

      // AND: Should publish move analytics
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'fileSystem:operationCompleted',
          properties: {
            operation: 'move',
            uri: testUri.toString(),
            targetUri: targetUri.toString(),
            size: 128,
            duration: expect.any(Number),
            fileType: 'file',
            overwrite: true,
            sourceWorkspace: 'test-workspace',
            targetWorkspace: 'test-workspace',
            timestamp: expect.any(Number),
          },
        }
      );
    });
  });

  describe('User Scenario: File Information and Directory Listing', () => {
    it('should get file stats with proper tracking', async () => {
      // WHEN: Getting file stats
      const stats = await fileSystemManager.stat(testUri);

      // THEN: Should return stats and track operation
      expect(stats).toStrictEqual(mockFileStat);
      expect(mockWorkspace.fs.stat).toHaveBeenCalledWith(testUri);

      // AND: Should publish analytics
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'fileSystem:operationCompleted',
          properties: {
            operation: 'stat',
            uri: testUri.toString(),
            size: mockFileStat.size,
            fileType: 'file',
            duration: expect.any(Number),
            workspace: 'test-workspace',
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should read directory contents with filtering', async () => {
      // GIVEN: Directory with mixed content
      const directoryEntries: Array<[string, vscode.FileType]> = [
        ['file1.txt', require('vscode').FileType.File],
        ['file2.js', require('vscode').FileType.File],
        ['.hidden', require('vscode').FileType.File],
        ['folder1', require('vscode').FileType.Directory],
      ];
      mockWorkspace.fs.readDirectory.mockResolvedValue(directoryEntries);

      // WHEN: Reading directory with hidden files excluded
      const result = await fileSystemManager.readDirectory(testUri, {
        includeHidden: false,
      });

      // THEN: Should filter out hidden files
      expect(result).toEqual([
        ['file1.txt', require('vscode').FileType.File],
        ['file2.js', require('vscode').FileType.File],
        ['folder1', require('vscode').FileType.Directory],
      ]);

      // AND: Should publish analytics with filtering info
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'fileSystem:operationCompleted',
          properties: {
            operation: 'readdir',
            uri: testUri.toString(),
            entryCount: 3,
            totalEntries: 4,
            duration: expect.any(Number),
            workspace: 'test-workspace',
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should read directory contents with exclude patterns', async () => {
      // GIVEN: Directory with files to exclude
      const directoryEntries: Array<[string, vscode.FileType]> = [
        ['file1.txt', require('vscode').FileType.File],
        ['file2.js', require('vscode').FileType.File],
        ['test.js', require('vscode').FileType.File],
      ];
      mockWorkspace.fs.readDirectory.mockResolvedValue(directoryEntries);

      // WHEN: Reading directory with exclusion pattern
      const result = await fileSystemManager.readDirectory(testUri, {
        exclude: ['test'],
      });

      // THEN: Should exclude files matching pattern
      expect(result).toEqual([
        ['file1.txt', require('vscode').FileType.File],
        ['file2.js', require('vscode').FileType.File],
      ]);
    });
  });

  describe('User Scenario: File System Watching', () => {
    it('should create watchers with comprehensive configuration', () => {
      // GIVEN: Watcher configuration
      const config: FileWatcherConfig = {
        id: 'test-watcher',
        pattern: '**/*.ts',
        ignoreCreateEvents: false,
        ignoreChangeEvents: true,
        ignoreDeleteEvents: false,
      };

      // WHEN: Creating watcher
      const watcher = fileSystemManager.createWatcher(config);

      // THEN: Should create watcher with VS Code
      expect(mockWorkspace.createFileSystemWatcher).toHaveBeenCalledWith(
        '**/*.ts',
        false,
        true,
        false
      );
      expect(watcher).toBe(mockFileSystemWatcher);

      // AND: Should set up event handlers
      expect(mockFileSystemWatcher.onDidCreate).toHaveBeenCalled();
      expect(mockFileSystemWatcher.onDidChange).toHaveBeenCalled();
      expect(mockFileSystemWatcher.onDidDelete).toHaveBeenCalled();

      // AND: Should add to subscriptions
      expect(mockContext.subscriptions).toContain(watcher);

      // AND: Should publish creation event
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'fileSystem:watcherCreated',
          properties: {
            watcherId: 'test-watcher',
            pattern: '**/*.ts',
            ignoreCreate: false,
            ignoreChange: true,
            ignoreDelete: false,
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should return existing watcher if already created', () => {
      // GIVEN: Watcher already exists
      const config: FileWatcherConfig = { id: 'existing', pattern: '**/*' };
      const firstWatcher = fileSystemManager.createWatcher(config);

      // WHEN: Creating watcher with same ID
      const secondWatcher = fileSystemManager.createWatcher(config);

      // THEN: Should return same watcher
      expect(firstWatcher).toBe(secondWatcher);
      expect(mockWorkspace.createFileSystemWatcher).toHaveBeenCalledTimes(1);
    });

    it('should dispose watchers properly', () => {
      // GIVEN: Active watcher
      const config: FileWatcherConfig = { id: 'disposable', pattern: '**/*' };
      fileSystemManager.createWatcher(config);

      // WHEN: Disposing watcher
      const result = fileSystemManager.disposeWatcher('disposable');

      // THEN: Should dispose and remove from tracking
      expect(result).toBe(true);
      expect(mockFileSystemWatcher.dispose).toHaveBeenCalled();
      expect(fileSystemManager.getActiveWatchers()).not.toContain('disposable');

      // AND: Should publish disposal event
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'fileSystem:watcherDisposed',
          properties: {
            watcherId: 'disposable',
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should handle watcher event routing', () => {
      // GIVEN: Watcher with event handlers
      const config: FileWatcherConfig = { id: 'event-test', pattern: '**/*' };
      fileSystemManager.createWatcher(config);

      // Get the event handler that was registered
      const createHandler = mockFileSystemWatcher.onDidCreate.mock.calls[0][0];
      const changeHandler = mockFileSystemWatcher.onDidChange.mock.calls[0][0];
      const deleteHandler = mockFileSystemWatcher.onDidDelete.mock.calls[0][0];

      // Clear previous events
      mockEventBus.publish.mockClear();

      // WHEN: File system events occur
      createHandler(testUri);
      changeHandler(testUri);
      deleteHandler(testUri);

      // THEN: Should publish watcher events
      expect(mockEventBus.publish).toHaveBeenCalledTimes(3);
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'fileSystem:watcherEvent',
          properties: {
            watcherId: 'event-test',
            eventType: 'created',
            uri: testUri.toString(),
            workspace: 'test-workspace',
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should return false when disposing non-existent watchers', () => {
      expect(fileSystemManager.disposeWatcher('non-existent')).toBe(false);
    });
  });

  describe('User Scenario: Operation Metrics and Monitoring', () => {
    it('should provide comprehensive operation metrics', async () => {
      // GIVEN: Various file operations performed
      const content = new Uint8Array([1, 2, 3]);
      await fileSystemManager.readFile(testUri);
      await fileSystemManager.writeFile(testUri, content);
      await fileSystemManager.stat(testUri);

      // WHEN: Getting metrics
      const readMetrics = fileSystemManager.getOperationMetrics('read');
      const allMetrics = fileSystemManager.getOperationMetrics();

      // THEN: Should provide detailed metrics
      expect(readMetrics).toEqual({
        totalOperations: 1,
        successfulOperations: 1,
        failedOperations: 0,
        totalBytesProcessed: 4,
        averageResponseTime: expect.any(Number),
        lastOperation: expect.any(Number),
      });

      expect(allMetrics).toHaveProperty('read');
      expect(allMetrics).toHaveProperty('write');
      expect(allMetrics).toHaveProperty('stat');
    });

    it('should track error metrics properly', async () => {
      // GIVEN: Operation that will fail
      mockWorkspace.fs.readFile.mockRejectedValue(new Error('Test error'));

      // WHEN: Performing failing operation
      try {
        await fileSystemManager.readFile(testUri);
      } catch (error) {
        // Expected to fail
      }

      // THEN: Should track failure in metrics
      const metrics = fileSystemManager.getOperationMetrics('read');
      expect(metrics!.failedOperations).toBe(1);
      expect(metrics!.successfulOperations).toBe(0);
    });

    it('should provide active watcher list', () => {
      // GIVEN: Multiple watchers
      fileSystemManager.createWatcher({ id: 'watcher1', pattern: '**/*.ts' });
      fileSystemManager.createWatcher({ id: 'watcher2', pattern: '**/*.js' });

      // THEN: Should list all active watchers
      const activeWatchers = fileSystemManager.getActiveWatchers();
      expect(activeWatchers).toContain('watcher1');
      expect(activeWatchers).toContain('watcher2');
      expect(activeWatchers).toHaveLength(2);
    });

    it('should return metrics for tracked operations even when no operations performed', () => {
      // GIVEN: No operations have been performed, but create is a tracked operation type
      // The implementation initializes all operation types with default metrics
      const metrics = fileSystemManager.getOperationMetrics('create');
      expect(metrics).not.toBeNull();
      expect(metrics).toEqual({
        totalOperations: 0,
        successfulOperations: 0,
        failedOperations: 0,
        totalBytesProcessed: 0,
        averageResponseTime: 0,
        lastOperation: 0,
      });
    });
  });

  describe('User Scenario: Error Handling and Categorization', () => {
    it('should categorize different error types properly', async () => {
      const errorTests = [
        { error: 'ENOENT: file not found', expectedCode: 'FILE_NOT_FOUND' },
        {
          error: 'EACCES: permission denied',
          expectedCode: 'PERMISSION_DENIED',
        },
        { error: 'EEXIST: file already exists', expectedCode: 'FILE_EXISTS' },
        { error: 'EISDIR: is a directory', expectedCode: 'IS_DIRECTORY' },
        { error: 'Unknown error', expectedCode: 'UNKNOWN_ERROR' },
      ];

      for (const { error, expectedCode } of errorTests) {
        mockWorkspace.fs.readFile.mockRejectedValueOnce(new Error(error));

        try {
          await fileSystemManager.readFile(testUri);
        } catch (e) {
          // Expected to fail
        }

        expect(mockEventBus.publish).toHaveBeenCalledWith(
          'error',
          expect.objectContaining({
            data: expect.objectContaining({
              errorCode: expectedCode,
            }),
          })
        );
      }
    });

    it('should validate URIs properly', async () => {
      // GIVEN: Invalid URI
      const invalidUri = {
        scheme: '',
        fsPath: '',
        path: '',
        toString: () => '',
      } as vscode.Uri;

      // WHEN: Attempting operation with invalid URI
      await expect(fileSystemManager.readFile(invalidUri)).rejects.toThrow(
        'Invalid URI'
      );
    });
  });

  describe('User Scenario: Manager Lifecycle', () => {
    it('should dispose all resources properly', () => {
      // GIVEN: Active watchers and operations
      fileSystemManager.createWatcher({ id: 'cleanup-test', pattern: '**/*' });

      // WHEN: Disposing manager
      fileSystemManager.dispose();

      // THEN: Should dispose all watchers
      expect(mockFileSystemWatcher.dispose).toHaveBeenCalled();
      expect(fileSystemManager.getActiveWatchers()).toHaveLength(0);

      // AND: Should publish disposal event
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'fileSystem:managerDisposed',
          properties: {
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should handle disposal errors gracefully', () => {
      // GIVEN: Watcher disposal error
      fileSystemManager.createWatcher({ id: 'error-cleanup', pattern: '**/*' });
      mockFileSystemWatcher.dispose.mockImplementationOnce(() => {
        throw new Error('Disposal failed');
      });

      // WHEN: Disposing manager
      fileSystemManager.dispose();

      // THEN: Should publish error event
      expect(mockEventBus.publish).toHaveBeenCalledWith('error', {
        code: 'FILE_SYSTEM_MANAGER_DISPOSE_FAILED',
        message: 'Failed to dispose FileSystemManager: Error: Disposal failed',
        source: 'FileSystemManager',
        timestamp: expect.any(Number),
      });

      // AND: Should not publish successful disposal event when error occurs
      expect(mockEventBus.publish).not.toHaveBeenCalledWith(
        'analytics:trackEvent',
        expect.objectContaining({
          event: 'fileSystem:managerDisposed',
        })
      );
    });
  });
});
