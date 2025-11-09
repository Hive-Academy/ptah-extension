import 'reflect-metadata';
import * as vscode from 'vscode';
import { ProjectDetectorService } from './project-detector.service';
import { ProjectType } from '../types/workspace.types';
import type { FileSystemService } from '../services/file-system.service';

// Mock vscode module
jest.mock('vscode', () => ({
  Uri: {
    file: jest.fn((path: string) => ({ scheme: 'file', fsPath: path, path })),
    parse: jest.fn((uri: string) => ({
      scheme: 'vscode-vfs',
      fsPath: uri,
      path: uri,
    })),
    joinPath: jest.fn((base: unknown, ...pathSegments: string[]) => {
      const basePath = (base as { fsPath: string }).fsPath;
      return {
        scheme: 'file',
        fsPath: `${basePath}/${pathSegments.join('/')}`,
        path: `${basePath}/${pathSegments.join('/')}`,
      };
    }),
  },
  FileType: {
    Unknown: 0,
    File: 1,
    Directory: 2,
    SymbolicLink: 64,
  },
  workspace: {
    workspaceFolders: undefined,
  },
}));

describe('ProjectDetectorService', () => {
  let service: ProjectDetectorService;
  let mockFileSystem: jest.Mocked<FileSystemService>;

  beforeEach(() => {
    // Create mock FileSystemService
    mockFileSystem = {
      readDirectory: jest.fn(),
      readFile: jest.fn(),
      stat: jest.fn(),
      exists: jest.fn(),
      isVirtualWorkspace: jest.fn(),
      dispose: jest.fn(),
    } as unknown as jest.Mocked<FileSystemService>;

    // Create service instance with mocked dependencies
    service = new ProjectDetectorService(mockFileSystem);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('detectProjectTypes', () => {
    it('should return empty map when no workspace folders exist', async () => {
      // Arrange
      Object.defineProperty(vscode.workspace, 'workspaceFolders', {
        value: undefined,
        writable: true,
      });

      // Act
      const result = await service.detectProjectTypes();

      // Assert
      expect(result.size).toBe(0);
    });

    it('should detect project type for each workspace folder', async () => {
      // Arrange
      const folder1Uri = vscode.Uri.file('/workspace/folder1');
      const folder2Uri = vscode.Uri.file('/workspace/folder2');
      Object.defineProperty(vscode.workspace, 'workspaceFolders', {
        value: [
          { uri: folder1Uri, name: 'folder1', index: 0 },
          { uri: folder2Uri, name: 'folder2', index: 1 },
        ],
        writable: true,
      });
      mockFileSystem.readDirectory.mockResolvedValueOnce([
        ['package.json', vscode.FileType.File],
        ['node_modules', vscode.FileType.Directory],
      ]);
      mockFileSystem.readDirectory.mockResolvedValueOnce([
        ['requirements.txt', vscode.FileType.File],
        ['main.py', vscode.FileType.File],
      ]);

      // Act
      const result = await service.detectProjectTypes();

      // Assert
      expect(result.size).toBe(2);
      expect(result.get(folder1Uri)).toBe(ProjectType.Node);
      expect(result.get(folder2Uri)).toBe(ProjectType.Python);
    });
  });

  describe('detectProjectType', () => {
    it('should detect Node.js project from package.json', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['package.json', vscode.FileType.File],
        ['src', vscode.FileType.Directory],
      ]);
      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({ name: 'test-project' })
      );

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.Node);
    });

    it('should detect React project from package.json dependencies', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['package.json', vscode.FileType.File],
      ]);
      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({
          name: 'react-app',
          dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
        })
      );

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.React);
    });

    it('should detect Next.js project from package.json dependencies', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['package.json', vscode.FileType.File],
      ]);
      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({
          name: 'nextjs-app',
          dependencies: { next: '^14.0.0', react: '^18.0.0' },
        })
      );

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.NextJS);
    });

    it('should detect Vue project from package.json dependencies', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['package.json', vscode.FileType.File],
      ]);
      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({
          name: 'vue-app',
          dependencies: { vue: '^3.0.0' },
        })
      );

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.Vue);
    });

    it('should detect Angular project from package.json dependencies', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['package.json', vscode.FileType.File],
      ]);
      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({
          name: 'angular-app',
          dependencies: { '@angular/core': '^17.0.0' },
        })
      );

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.Angular);
    });

    it('should detect Angular project from angular.json', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['angular.json', vscode.FileType.File],
        ['src', vscode.FileType.Directory],
      ]);

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.Angular);
    });

    it('should detect Python project from requirements.txt', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['requirements.txt', vscode.FileType.File],
        ['main.py', vscode.FileType.File],
      ]);

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.Python);
    });

    it('should detect Python project from pyproject.toml', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['pyproject.toml', vscode.FileType.File],
        ['src', vscode.FileType.Directory],
      ]);

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.Python);
    });

    it('should detect Python project from setup.py', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['setup.py', vscode.FileType.File],
        ['src', vscode.FileType.Directory],
      ]);

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.Python);
    });

    it('should detect Python project from Pipfile', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['Pipfile', vscode.FileType.File],
        ['Pipfile.lock', vscode.FileType.File],
      ]);

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.Python);
    });

    it('should detect Java project from pom.xml', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['pom.xml', vscode.FileType.File],
        ['src', vscode.FileType.Directory],
      ]);

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.Java);
    });

    it('should detect Java project from build.gradle', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['build.gradle', vscode.FileType.File],
        ['src', vscode.FileType.Directory],
      ]);

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.Java);
    });

    it('should detect Java project from build.gradle.kts', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['build.gradle.kts', vscode.FileType.File],
        ['src', vscode.FileType.Directory],
      ]);

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.Java);
    });

    it('should detect .NET project from .csproj file', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['MyApp.csproj', vscode.FileType.File],
        ['Program.cs', vscode.FileType.File],
      ]);

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.DotNet);
    });

    it('should detect .NET project from .fsproj file', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['MyApp.fsproj', vscode.FileType.File],
        ['Program.fs', vscode.FileType.File],
      ]);

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.DotNet);
    });

    it('should detect .NET project from .sln file', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['MySolution.sln', vscode.FileType.File],
        ['src', vscode.FileType.Directory],
      ]);

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.DotNet);
    });

    it('should detect Rust project from Cargo.toml', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['Cargo.toml', vscode.FileType.File],
        ['src', vscode.FileType.Directory],
      ]);

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.Rust);
    });

    it('should detect Go project from go.mod', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['go.mod', vscode.FileType.File],
        ['main.go', vscode.FileType.File],
      ]);

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.Go);
    });

    it('should detect PHP project from composer.json', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['composer.json', vscode.FileType.File],
        ['src', vscode.FileType.Directory],
      ]);

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.PHP);
    });

    it('should detect Ruby project from Gemfile', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['Gemfile', vscode.FileType.File],
        ['app', vscode.FileType.Directory],
      ]);

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.Ruby);
    });

    it('should detect Vue project from nuxt.config.js', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['nuxt.config.js', vscode.FileType.File],
        ['pages', vscode.FileType.Directory],
      ]);

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.Vue);
    });

    it('should detect Vue project from nuxt.config.ts', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['nuxt.config.ts', vscode.FileType.File],
        ['pages', vscode.FileType.Directory],
      ]);

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.Vue);
    });

    it('should detect React project from gatsby-config.js', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['gatsby-config.js', vscode.FileType.File],
        ['src', vscode.FileType.Directory],
      ]);

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.React);
    });

    it('should detect Node project from vite.config.js', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['vite.config.js', vscode.FileType.File],
        ['src', vscode.FileType.Directory],
      ]);

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.Node);
    });

    it('should detect Node project from webpack.config.js', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['webpack.config.js', vscode.FileType.File],
        ['src', vscode.FileType.Directory],
      ]);

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.Node);
    });

    it('should return General for unrecognized project structure', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['README.md', vscode.FileType.File],
        ['docs', vscode.FileType.Directory],
      ]);

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.General);
    });

    it('should return General and log warning on file system error', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      const consoleWarnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      mockFileSystem.readDirectory.mockRejectedValue(
        new Error('Permission denied')
      );

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.General);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to detect project type'),
        'Permission denied'
      );

      consoleWarnSpy.mockRestore();
    });

    it('should prioritize Next.js over React when both dependencies exist', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['package.json', vscode.FileType.File],
      ]);
      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({
          name: 'nextjs-app',
          dependencies: {
            next: '^14.0.0',
            react: '^18.0.0',
            'react-dom': '^18.0.0',
          },
        })
      );

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.NextJS);
    });

    it('should handle invalid package.json gracefully and return Node type', async () => {
      // Arrange
      const uri = vscode.Uri.file('/workspace');
      mockFileSystem.readDirectory.mockResolvedValue([
        ['package.json', vscode.FileType.File],
      ]);
      mockFileSystem.readFile.mockResolvedValue('{ invalid json }');

      // Act
      const result = await service.detectProjectType(uri);

      // Assert
      expect(result).toBe(ProjectType.Node);
    });
  });

  describe('dispose', () => {
    it('should dispose cleanly without errors', () => {
      // Act & Assert - should not throw
      expect(() => service.dispose()).not.toThrow();
    });
  });
});
