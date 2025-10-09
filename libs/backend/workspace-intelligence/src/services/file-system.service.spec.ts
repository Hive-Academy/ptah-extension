/**
 * File System Service Tests
 */

import 'reflect-metadata'; // Required for tsyringe
import { FileSystemService, FileSystemError } from './file-system.service';
import * as vscode from 'vscode';

// Mock VS Code module
jest.mock('vscode', () => ({
  Uri: {
    file: (path: string) => ({
      scheme: 'file',
      fsPath: path,
      toString: () => `file://${path}`,
    }),
    parse: (uri: string) => {
      const scheme = uri.split(':')[0];
      return { scheme, toString: () => uri };
    },
  },
  FileType: {
    File: 1,
    Directory: 2,
    SymbolicLink: 64,
  },
  workspace: {
    fs: {
      readFile: jest.fn(),
      readDirectory: jest.fn(),
      stat: jest.fn(),
    },
  },
}));

describe('FileSystemService', () => {
  let service: FileSystemService;

  beforeEach(() => {
    service = new FileSystemService();
  });

  describe('readFile', () => {
    it('should read file contents as UTF-8 string', async () => {
      // Arrange
      const uri = vscode.Uri.file('/test/file.txt');
      const mockContent = 'Hello, World!';
      const mockBytes = new TextEncoder().encode(mockContent);

      jest.spyOn(vscode.workspace.fs, 'readFile').mockResolvedValue(mockBytes);

      // Act
      const result = await service.readFile(uri);

      // Assert
      expect(result).toBe(mockContent);
      expect(vscode.workspace.fs.readFile).toHaveBeenCalledWith(uri);
    });

    it('should handle UTF-8 content with special characters', async () => {
      // Arrange
      const uri = vscode.Uri.file('/test/unicode.txt');
      const mockContent = 'Hello 🌍 世界';
      const mockBytes = new TextEncoder().encode(mockContent);

      jest.spyOn(vscode.workspace.fs, 'readFile').mockResolvedValue(mockBytes);

      // Act
      const result = await service.readFile(uri);

      // Assert
      expect(result).toBe(mockContent);
    });

    it('should throw FileSystemError when read fails', async () => {
      // Arrange
      const uri = vscode.Uri.file('/test/missing.txt');
      const originalError = new Error('File not found');

      jest
        .spyOn(vscode.workspace.fs, 'readFile')
        .mockRejectedValue(originalError);

      // Act & Assert
      await expect(service.readFile(uri)).rejects.toThrow(FileSystemError);
      await expect(service.readFile(uri)).rejects.toThrow(
        `Failed to read file: ${uri.toString()}`
      );
    });

    it('should handle virtual workspace URIs', async () => {
      // Arrange
      const uri = vscode.Uri.parse('vscode-vfs://github/owner/repo/file.ts');
      const mockContent = 'export const test = true;';
      const mockBytes = new TextEncoder().encode(mockContent);

      jest.spyOn(vscode.workspace.fs, 'readFile').mockResolvedValue(mockBytes);

      // Act
      const result = await service.readFile(uri);

      // Assert
      expect(result).toBe(mockContent);
      expect(vscode.workspace.fs.readFile).toHaveBeenCalledWith(uri);
    });
  });

  describe('readDirectory', () => {
    it('should read directory contents', async () => {
      // Arrange
      const uri = vscode.Uri.file('/test/dir');
      const mockEntries: [string, vscode.FileType][] = [
        ['file1.ts', vscode.FileType.File],
        ['file2.ts', vscode.FileType.File],
        ['subdir', vscode.FileType.Directory],
      ];

      jest
        .spyOn(vscode.workspace.fs, 'readDirectory')
        .mockResolvedValue(mockEntries);

      // Act
      const result = await service.readDirectory(uri);

      // Assert
      expect(result).toEqual(mockEntries);
      expect(vscode.workspace.fs.readDirectory).toHaveBeenCalledWith(uri);
    });

    it('should return empty array for empty directory', async () => {
      // Arrange
      const uri = vscode.Uri.file('/test/empty');
      const mockEntries: [string, vscode.FileType][] = [];

      jest
        .spyOn(vscode.workspace.fs, 'readDirectory')
        .mockResolvedValue(mockEntries);

      // Act
      const result = await service.readDirectory(uri);

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw FileSystemError when directory does not exist', async () => {
      // Arrange
      const uri = vscode.Uri.file('/test/nonexistent');
      const originalError = new Error('Directory not found');

      jest
        .spyOn(vscode.workspace.fs, 'readDirectory')
        .mockRejectedValue(originalError);

      // Act & Assert
      await expect(service.readDirectory(uri)).rejects.toThrow(FileSystemError);
      await expect(service.readDirectory(uri)).rejects.toThrow(
        `Failed to read directory: ${uri.toString()}`
      );
    });

    it('should handle symbolic links', async () => {
      // Arrange
      const uri = vscode.Uri.file('/test/dir');
      const mockEntries: [string, vscode.FileType][] = [
        ['link', vscode.FileType.SymbolicLink],
        ['file.ts', vscode.FileType.File],
      ];

      jest
        .spyOn(vscode.workspace.fs, 'readDirectory')
        .mockResolvedValue(mockEntries);

      // Act
      const result = await service.readDirectory(uri);

      // Assert
      expect(result).toEqual(mockEntries);
    });
  });

  describe('stat', () => {
    it('should return file stats for file', async () => {
      // Arrange
      const uri = vscode.Uri.file('/test/file.ts');
      const mockStat: vscode.FileStat = {
        type: vscode.FileType.File,
        size: 1024,
        ctime: Date.now(),
        mtime: Date.now(),
      };

      jest.spyOn(vscode.workspace.fs, 'stat').mockResolvedValue(mockStat);

      // Act
      const result = await service.stat(uri);

      // Assert
      expect(result).toEqual(mockStat);
      expect(vscode.workspace.fs.stat).toHaveBeenCalledWith(uri);
    });

    it('should return directory stats', async () => {
      // Arrange
      const uri = vscode.Uri.file('/test/dir');
      const mockStat: vscode.FileStat = {
        type: vscode.FileType.Directory,
        size: 0,
        ctime: Date.now(),
        mtime: Date.now(),
      };

      jest.spyOn(vscode.workspace.fs, 'stat').mockResolvedValue(mockStat);

      // Act
      const result = await service.stat(uri);

      // Assert
      expect(result.type).toBe(vscode.FileType.Directory);
    });

    it('should throw FileSystemError when stat fails', async () => {
      // Arrange
      const uri = vscode.Uri.file('/test/missing');
      const originalError = new Error('File not found');

      jest.spyOn(vscode.workspace.fs, 'stat').mockRejectedValue(originalError);

      // Act & Assert
      await expect(service.stat(uri)).rejects.toThrow(FileSystemError);
      await expect(service.stat(uri)).rejects.toThrow(
        `Failed to stat: ${uri.toString()}`
      );
    });
  });

  describe('isVirtualWorkspace', () => {
    it('should return false for file:// scheme', () => {
      // Arrange
      const uri = vscode.Uri.file('/local/path/file.ts');

      // Act
      const result = service.isVirtualWorkspace(uri);

      // Assert
      expect(result).toBe(false);
    });

    it('should return true for vscode-vfs:// scheme', () => {
      // Arrange
      const uri = vscode.Uri.parse('vscode-vfs://github/owner/repo/file.ts');

      // Act
      const result = service.isVirtualWorkspace(uri);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true for untitled:// scheme', () => {
      // Arrange
      const uri = vscode.Uri.parse('untitled:Untitled-1');

      // Act
      const result = service.isVirtualWorkspace(uri);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true for custom schemes', () => {
      // Arrange
      const uri = vscode.Uri.parse('custom-scheme://path/to/resource');

      // Act
      const result = service.isVirtualWorkspace(uri);

      // Assert
      expect(result).toBe(true);
    });

    it('should handle http:// and https:// schemes', () => {
      // Arrange
      const httpUri = vscode.Uri.parse('http://example.com/file');
      const httpsUri = vscode.Uri.parse('https://example.com/file');

      // Act & Assert
      expect(service.isVirtualWorkspace(httpUri)).toBe(true);
      expect(service.isVirtualWorkspace(httpsUri)).toBe(true);
    });
  });

  describe('exists', () => {
    it('should return true when file exists', async () => {
      // Arrange
      const uri = vscode.Uri.file('/test/exists.ts');
      const mockStat: vscode.FileStat = {
        type: vscode.FileType.File,
        size: 100,
        ctime: Date.now(),
        mtime: Date.now(),
      };

      jest.spyOn(vscode.workspace.fs, 'stat').mockResolvedValue(mockStat);

      // Act
      const result = await service.exists(uri);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when file does not exist', async () => {
      // Arrange
      const uri = vscode.Uri.file('/test/missing.ts');

      jest
        .spyOn(vscode.workspace.fs, 'stat')
        .mockRejectedValue(new Error('Not found'));

      // Act
      const result = await service.exists(uri);

      // Assert
      expect(result).toBe(false);
    });

    it('should return true for directories', async () => {
      // Arrange
      const uri = vscode.Uri.file('/test/dir');
      const mockStat: vscode.FileStat = {
        type: vscode.FileType.Directory,
        size: 0,
        ctime: Date.now(),
        mtime: Date.now(),
      };

      jest.spyOn(vscode.workspace.fs, 'stat').mockResolvedValue(mockStat);

      // Act
      const result = await service.exists(uri);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for permission denied errors', async () => {
      // Arrange
      const uri = vscode.Uri.file('/test/forbidden.ts');

      jest
        .spyOn(vscode.workspace.fs, 'stat')
        .mockRejectedValue(new Error('Permission denied'));

      // Act
      const result = await service.exists(uri);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('FileSystemError', () => {
    it('should create error with message', () => {
      // Arrange & Act
      const error = new FileSystemError('Test error message');

      // Assert
      expect(error.message).toBe('Test error message');
      expect(error.name).toBe('FileSystemError');
      expect(error.cause).toBeUndefined();
    });

    it('should create error with cause', () => {
      // Arrange
      const originalError = new Error('Original error');

      // Act
      const error = new FileSystemError('Wrapped error', originalError);

      // Assert
      expect(error.message).toBe('Wrapped error');
      expect(error.cause).toBe(originalError);
      expect(error.stack).toContain('Caused by:');
    });

    it('should chain error stacks', () => {
      // Arrange
      const originalError = new Error('Root cause');
      originalError.stack = 'Error: Root cause\n  at somewhere';

      // Act
      const error = new FileSystemError('High-level error', originalError);

      // Assert
      expect(error.stack).toContain('Caused by: Error: Root cause');
    });
  });
});
