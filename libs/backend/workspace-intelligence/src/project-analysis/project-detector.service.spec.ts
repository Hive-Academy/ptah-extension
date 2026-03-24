import 'reflect-metadata';
import { ProjectDetectorService } from './project-detector.service';
import { ProjectType } from '../types/workspace.types';
import { FileType } from '@ptah-extension/platform-core';
import type { FileSystemService } from '../services/file-system.service';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

describe('ProjectDetectorService', () => {
  let service: ProjectDetectorService;
  let mockFileSystem: jest.Mocked<FileSystemService>;
  let mockWorkspaceProvider: jest.Mocked<IWorkspaceProvider>;

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

    mockWorkspaceProvider = {
      getWorkspaceFolders: jest.fn().mockReturnValue([]),
      getWorkspaceRoot: jest.fn().mockReturnValue(undefined),
      getConfiguration: jest.fn(),
      onDidChangeConfiguration: jest.fn(),
      onDidChangeWorkspaceFolders: jest.fn(),
    } as unknown as jest.Mocked<IWorkspaceProvider>;

    // Create service instance with mocked dependencies
    service = new ProjectDetectorService(mockFileSystem, mockWorkspaceProvider);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('detectProjectTypes', () => {
    it('should return empty map when no workspace folders exist', async () => {
      mockWorkspaceProvider.getWorkspaceFolders.mockReturnValue([]);

      const result = await service.detectProjectTypes();

      expect(result.size).toBe(0);
    });

    it('should detect project type for each workspace folder', async () => {
      mockWorkspaceProvider.getWorkspaceFolders.mockReturnValue([
        '/workspace/folder1',
        '/workspace/folder2',
      ]);
      mockFileSystem.readDirectory.mockResolvedValueOnce([
        { name: 'package.json', type: FileType.File },
        { name: 'node_modules', type: FileType.Directory },
      ]);
      mockFileSystem.readDirectory.mockResolvedValueOnce([
        { name: 'requirements.txt', type: FileType.File },
        { name: 'main.py', type: FileType.File },
      ]);

      const result = await service.detectProjectTypes();

      expect(result.size).toBe(2);
      expect(result.get('/workspace/folder1')).toBe(ProjectType.Node);
      expect(result.get('/workspace/folder2')).toBe(ProjectType.Python);
    });
  });

  describe('detectProjectType', () => {
    it('should detect Node.js project from package.json', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'package.json', type: FileType.File },
        { name: 'src', type: FileType.Directory },
      ]);
      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({ name: 'test-project' })
      );

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.Node);
    });

    it('should detect React project from package.json dependencies', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'package.json', type: FileType.File },
      ]);
      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({
          name: 'react-app',
          dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
        })
      );

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.React);
    });

    it('should detect Next.js project from package.json dependencies', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'package.json', type: FileType.File },
      ]);
      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({
          name: 'nextjs-app',
          dependencies: { next: '^14.0.0', react: '^18.0.0' },
        })
      );

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.NextJS);
    });

    it('should detect Vue project from package.json dependencies', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'package.json', type: FileType.File },
      ]);
      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({
          name: 'vue-app',
          dependencies: { vue: '^3.0.0' },
        })
      );

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.Vue);
    });

    it('should detect Angular project from package.json dependencies', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'package.json', type: FileType.File },
      ]);
      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({
          name: 'angular-app',
          dependencies: { '@angular/core': '^17.0.0' },
        })
      );

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.Angular);
    });

    it('should detect Angular project from angular.json', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'angular.json', type: FileType.File },
        { name: 'src', type: FileType.Directory },
      ]);

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.Angular);
    });

    it('should detect Python project from requirements.txt', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'requirements.txt', type: FileType.File },
        { name: 'main.py', type: FileType.File },
      ]);

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.Python);
    });

    it('should detect Python project from pyproject.toml', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'pyproject.toml', type: FileType.File },
        { name: 'src', type: FileType.Directory },
      ]);

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.Python);
    });

    it('should detect Python project from setup.py', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'setup.py', type: FileType.File },
        { name: 'src', type: FileType.Directory },
      ]);

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.Python);
    });

    it('should detect Python project from Pipfile', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'Pipfile', type: FileType.File },
        { name: 'Pipfile.lock', type: FileType.File },
      ]);

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.Python);
    });

    it('should detect Java project from pom.xml', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'pom.xml', type: FileType.File },
        { name: 'src', type: FileType.Directory },
      ]);

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.Java);
    });

    it('should detect Java project from build.gradle', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'build.gradle', type: FileType.File },
        { name: 'src', type: FileType.Directory },
      ]);

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.Java);
    });

    it('should detect Java project from build.gradle.kts', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'build.gradle.kts', type: FileType.File },
        { name: 'src', type: FileType.Directory },
      ]);

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.Java);
    });

    it('should detect .NET project from .csproj file', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'MyApp.csproj', type: FileType.File },
        { name: 'Program.cs', type: FileType.File },
      ]);

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.DotNet);
    });

    it('should detect .NET project from .fsproj file', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'MyApp.fsproj', type: FileType.File },
        { name: 'Program.fs', type: FileType.File },
      ]);

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.DotNet);
    });

    it('should detect .NET project from .sln file', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'MySolution.sln', type: FileType.File },
        { name: 'src', type: FileType.Directory },
      ]);

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.DotNet);
    });

    it('should detect Rust project from Cargo.toml', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'Cargo.toml', type: FileType.File },
        { name: 'src', type: FileType.Directory },
      ]);

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.Rust);
    });

    it('should detect Go project from go.mod', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'go.mod', type: FileType.File },
        { name: 'main.go', type: FileType.File },
      ]);

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.Go);
    });

    it('should detect PHP project from composer.json', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'composer.json', type: FileType.File },
        { name: 'src', type: FileType.Directory },
      ]);

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.PHP);
    });

    it('should detect Ruby project from Gemfile', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'Gemfile', type: FileType.File },
        { name: 'app', type: FileType.Directory },
      ]);

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.Ruby);
    });

    it('should detect Vue project from nuxt.config.js', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'nuxt.config.js', type: FileType.File },
        { name: 'pages', type: FileType.Directory },
      ]);

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.Vue);
    });

    it('should detect Vue project from nuxt.config.ts', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'nuxt.config.ts', type: FileType.File },
        { name: 'pages', type: FileType.Directory },
      ]);

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.Vue);
    });

    it('should detect React project from gatsby-config.js', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'gatsby-config.js', type: FileType.File },
        { name: 'src', type: FileType.Directory },
      ]);

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.React);
    });

    it('should detect Node project from vite.config.js', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'vite.config.js', type: FileType.File },
        { name: 'src', type: FileType.Directory },
      ]);

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.Node);
    });

    it('should detect Node project from webpack.config.js', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'webpack.config.js', type: FileType.File },
        { name: 'src', type: FileType.Directory },
      ]);

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.Node);
    });

    it('should return General for unrecognized project structure', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'README.md', type: FileType.File },
        { name: 'docs', type: FileType.Directory },
      ]);

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.General);
    });

    it('should return General and log warning on file system error', async () => {
      const consoleWarnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      mockFileSystem.readDirectory.mockRejectedValue(
        new Error('Permission denied')
      );

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.General);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to detect project type'),
        'Permission denied'
      );

      consoleWarnSpy.mockRestore();
    });

    it('should prioritize Next.js over React when both dependencies exist', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'package.json', type: FileType.File },
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

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.NextJS);
    });

    it('should handle invalid package.json gracefully and return Node type', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'package.json', type: FileType.File },
      ]);
      mockFileSystem.readFile.mockResolvedValue('{ invalid json }');

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.Node);
    });
  });

  describe('dispose', () => {
    it('should dispose cleanly without errors', () => {
      expect(() => service.dispose()).not.toThrow();
    });
  });
});
