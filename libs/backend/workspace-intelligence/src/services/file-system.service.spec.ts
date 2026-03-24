/**
 * File System Service Tests
 */

import 'reflect-metadata'; // Required for tsyringe
import { FileSystemService, FileSystemError } from './file-system.service';
import { FileType } from '@ptah-extension/platform-core';
import type {
  IFileSystemProvider,
  DirectoryEntry,
  FileStat,
} from '@ptah-extension/platform-core';

describe('FileSystemService', () => {
  let service: FileSystemService;
  let mockFsProvider: jest.Mocked<IFileSystemProvider>;

  beforeEach(() => {
    mockFsProvider = {
      readFile: jest.fn(),
      readFileBytes: jest.fn(),
      writeFile: jest.fn(),
      writeFileBytes: jest.fn(),
      readDirectory: jest.fn(),
      stat: jest.fn(),
      exists: jest.fn(),
      delete: jest.fn(),
      createDirectory: jest.fn(),
      copy: jest.fn(),
      findFiles: jest.fn(),
      createFileWatcher: jest.fn(),
    };

    service = new FileSystemService(mockFsProvider);
  });

  describe('readFile', () => {
    it('should read file contents as UTF-8 string', async () => {
      const filePath = '/test/file.txt';
      const mockContent = 'Hello, World!';

      mockFsProvider.readFile.mockResolvedValue(mockContent);

      const result = await service.readFile(filePath);

      expect(result).toBe(mockContent);
      expect(mockFsProvider.readFile).toHaveBeenCalledWith(filePath);
    });

    it('should handle UTF-8 content with special characters', async () => {
      const filePath = '/test/unicode.txt';
      const mockContent = 'Hello 🌍 世界';

      mockFsProvider.readFile.mockResolvedValue(mockContent);

      const result = await service.readFile(filePath);

      expect(result).toBe(mockContent);
    });

    it('should throw FileSystemError when read fails', async () => {
      const filePath = '/test/missing.txt';
      const originalError = new Error('File not found');

      mockFsProvider.readFile.mockRejectedValue(originalError);

      await expect(service.readFile(filePath)).rejects.toThrow(FileSystemError);
      await expect(service.readFile(filePath)).rejects.toThrow(
        `Failed to read file: ${filePath}`
      );
    });
  });

  describe('readDirectory', () => {
    it('should read directory contents', async () => {
      const dirPath = '/test/dir';
      const mockEntries: DirectoryEntry[] = [
        { name: 'file1.ts', type: FileType.File },
        { name: 'file2.ts', type: FileType.File },
        { name: 'subdir', type: FileType.Directory },
      ];

      mockFsProvider.readDirectory.mockResolvedValue(mockEntries);

      const result = await service.readDirectory(dirPath);

      expect(result).toEqual(mockEntries);
      expect(mockFsProvider.readDirectory).toHaveBeenCalledWith(dirPath);
    });

    it('should return empty array for empty directory', async () => {
      const dirPath = '/test/empty';
      mockFsProvider.readDirectory.mockResolvedValue([]);

      const result = await service.readDirectory(dirPath);

      expect(result).toEqual([]);
    });

    it('should throw FileSystemError when directory does not exist', async () => {
      const dirPath = '/test/nonexistent';
      const originalError = new Error('Directory not found');

      mockFsProvider.readDirectory.mockRejectedValue(originalError);

      await expect(service.readDirectory(dirPath)).rejects.toThrow(
        FileSystemError
      );
      await expect(service.readDirectory(dirPath)).rejects.toThrow(
        `Failed to read directory: ${dirPath}`
      );
    });

    it('should handle symbolic links', async () => {
      const dirPath = '/test/dir';
      const mockEntries: DirectoryEntry[] = [
        { name: 'link', type: FileType.SymbolicLink },
        { name: 'file.ts', type: FileType.File },
      ];

      mockFsProvider.readDirectory.mockResolvedValue(mockEntries);

      const result = await service.readDirectory(dirPath);

      expect(result).toEqual(mockEntries);
    });
  });

  describe('stat', () => {
    it('should return file stats for file', async () => {
      const filePath = '/test/file.ts';
      const mockStat: FileStat = {
        type: FileType.File,
        size: 1024,
        ctime: Date.now(),
        mtime: Date.now(),
      };

      mockFsProvider.stat.mockResolvedValue(mockStat);

      const result = await service.stat(filePath);

      expect(result).toEqual(mockStat);
      expect(mockFsProvider.stat).toHaveBeenCalledWith(filePath);
    });

    it('should return directory stats', async () => {
      const dirPath = '/test/dir';
      const mockStat: FileStat = {
        type: FileType.Directory,
        size: 0,
        ctime: Date.now(),
        mtime: Date.now(),
      };

      mockFsProvider.stat.mockResolvedValue(mockStat);

      const result = await service.stat(dirPath);

      expect(result.type).toBe(FileType.Directory);
    });

    it('should throw FileSystemError when stat fails', async () => {
      const filePath = '/test/missing';
      const originalError = new Error('File not found');

      mockFsProvider.stat.mockRejectedValue(originalError);

      await expect(service.stat(filePath)).rejects.toThrow(FileSystemError);
      await expect(service.stat(filePath)).rejects.toThrow(
        `Failed to stat: ${filePath}`
      );
    });
  });

  describe('isVirtualWorkspace', () => {
    it('should return false for local file paths', () => {
      const result = service.isVirtualWorkspace('/local/path/file.ts');
      expect(result).toBe(false);
    });

    it('should return true for vscode-vfs:// scheme', () => {
      const result = service.isVirtualWorkspace(
        'vscode-vfs://github/owner/repo/file.ts'
      );
      expect(result).toBe(true);
    });

    it('should return false for file:// scheme', () => {
      const result = service.isVirtualWorkspace('file:///local/path');
      expect(result).toBe(false);
    });

    it('should return true for custom schemes', () => {
      const result = service.isVirtualWorkspace(
        'custom-scheme://path/to/resource'
      );
      expect(result).toBe(true);
    });

    it('should return true for http:// and https:// schemes', () => {
      expect(service.isVirtualWorkspace('http://example.com/file')).toBe(true);
      expect(service.isVirtualWorkspace('https://example.com/file')).toBe(true);
    });
  });

  describe('exists', () => {
    it('should return true when file exists', async () => {
      const filePath = '/test/exists.ts';
      mockFsProvider.exists.mockResolvedValue(true);

      const result = await service.exists(filePath);

      expect(result).toBe(true);
    });

    it('should return false when file does not exist', async () => {
      const filePath = '/test/missing.ts';
      mockFsProvider.exists.mockResolvedValue(false);

      const result = await service.exists(filePath);

      expect(result).toBe(false);
    });

    it('should return true for directories', async () => {
      const dirPath = '/test/dir';
      mockFsProvider.exists.mockResolvedValue(true);

      const result = await service.exists(dirPath);

      expect(result).toBe(true);
    });

    it('should return false for errors', async () => {
      const filePath = '/test/forbidden.ts';
      mockFsProvider.exists.mockRejectedValue(new Error('Permission denied'));

      const result = await service.exists(filePath);

      expect(result).toBe(false);
    });
  });

  describe('FileSystemError', () => {
    it('should create error with message', () => {
      const error = new FileSystemError('Test error message');

      expect(error.message).toBe('Test error message');
      expect(error.name).toBe('FileSystemError');
      expect(error.cause).toBeUndefined();
    });

    it('should create error with cause', () => {
      const originalError = new Error('Original error');

      const error = new FileSystemError('Wrapped error', originalError);

      expect(error.message).toBe('Wrapped error');
      expect(error.cause).toBe(originalError);
      expect(error.stack).toContain('Caused by:');
    });

    it('should chain error stacks', () => {
      const originalError = new Error('Root cause');
      originalError.stack = 'Error: Root cause\n  at somewhere';

      const error = new FileSystemError('High-level error', originalError);

      expect(error.stack).toContain('Caused by: Error: Root cause');
    });
  });
});
