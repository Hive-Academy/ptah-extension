import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  MAX_INSPECTED_PROJECTS,
  ProjectDetectorService,
} from './project-detector.service';
import { MonorepoDetectorService } from './monorepo-detector.service';
import { MAX_DISCOVERY_DEPTH } from './monorepo-member-discovery';
import { FrameworkDetectorService } from './framework-detector.service';
import { DependencyAnalyzerService } from './dependency-analyzer.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { Framework, MonorepoType, ProjectType } from '../types/workspace.types';
import { FileType } from '@ptah-extension/platform-core';
import { FileSystemService } from '../services/file-system.service';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';

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
        JSON.stringify({ name: 'test-project' }),
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
        }),
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
        }),
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
        }),
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
        }),
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

    it('should let angular.json win over react in package.json dependencies', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'package.json', type: FileType.File },
        { name: 'angular.json', type: FileType.File },
        { name: 'nx.json', type: FileType.File },
        { name: 'src', type: FileType.Directory },
      ]);
      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({
          name: 'nx-workspace',
          devDependencies: {
            react: '^18.0.0',
            '@angular/core': '^18.0.0',
            ink: '^5.0.0',
          },
        }),
      );

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.Angular);
    });

    it('should still detect React from package.json devDependencies when no angular.json exists', async () => {
      mockFileSystem.readDirectory.mockResolvedValue([
        { name: 'package.json', type: FileType.File },
        { name: 'src', type: FileType.Directory },
      ]);
      mockFileSystem.readFile.mockResolvedValue(
        JSON.stringify({
          name: 'react-app',
          devDependencies: {
            react: '^18.0.0',
            '@angular/core': '^18.0.0',
          },
        }),
      );

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.React);
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
        new Error('Permission denied'),
      );

      const result = await service.detectProjectType('/workspace');

      expect(result).toBe(ProjectType.General);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to detect project type'),
        'Permission denied',
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
        }),
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

/**
 * TASK_2026_559 Batch 10 — monorepo-first detection on a real directory tree.
 *
 * The single-signal specs above feed one mocked directory listing, so none of
 * them combines "root deps span two frameworks" with "no root angular.json"
 * AND "a real multi-app Nx tree". These fixtures do, on disk. The r1 review
 * regressions (B1, B2, S1-S4) are named in their titles.
 */
describe('ProjectDetectorService — monorepo fixtures (temp dir)', () => {
  let root: string;
  /** Absolute paths whose reads the fake provider rejects. */
  let failingReads: Set<string>;
  let fileSystem: FileSystemService;
  let detector: ProjectDetectorService;
  let monorepoDetector: MonorepoDetectorService;

  const abs = (relativePath: string): string =>
    path.join(root, ...relativePath.split('/'));

  const write = (relativePath: string, content: unknown): void => {
    const target = abs(relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  };

  const nxApp = (dir: string, executor: string, name?: string): void =>
    writeNxApp(write, dir, executor, name);

  const compose = () => composeMonorepo(root, monorepoDetector, detector);

  const projectInfo = async () => {
    const service = new WorkspaceService(
      detector,
      new FrameworkDetectorService(fileSystem),
      new DependencyAnalyzerService(fileSystem),
      monorepoDetector,
      fileSystem,
      {
        getWorkspaceRoot: jest.fn().mockReturnValue(undefined),
        getWorkspaceFolders: jest.fn().mockReturnValue([]),
        onDidChangeWorkspaceFolders: jest.fn(() => ({ dispose: jest.fn() })),
      } as unknown as IWorkspaceProvider,
      { captureException: jest.fn() } as never,
    );
    try {
      return await service.getProjectInfo(root);
    } finally {
      service.dispose();
    }
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-monorepo-fixture-'));
    failingReads = new Set();
    fileSystem = new FileSystemService(nodeFileSystemProvider(failingReads));
    const provider = {
      getWorkspaceFolders: jest.fn().mockReturnValue([root]),
      getWorkspaceRoot: jest.fn().mockReturnValue(root),
    } as unknown as IWorkspaceProvider;
    detector = new ProjectDetectorService(fileSystem, provider);
    monorepoDetector = new MonorepoDetectorService(fileSystem, provider);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('Nx workspace, root deps react + @angular/core, no root angular.json', () => {
    beforeEach(() => writeNxWorkspace(write));

    it('reproduces the root-only guess the composition replaces', async () => {
      // Documented bug shape: root detection alone ranks react first.
      await expect(detector.detectProjectType(root)).resolves.toBe(
        ProjectType.React,
      );
    });

    it('reports the monorepo root as its language, never react, plus the app set', async () => {
      const composition = await compose();

      expect(composition.rootType).toBe(ProjectType.Node);
      expect(composition.manifestRootType).toBe(ProjectType.React);
      expect(composition.complete).toBe(true);
      expect(composition.totalProjects).toBe(4);
      expect(composition.projects).toEqual([
        { name: 'api', path: 'apps/api', type: ProjectType.Node },
        {
          name: 'dashboard',
          path: 'apps/dashboard',
          type: ProjectType.Angular,
          framework: Framework.Angular,
        },
        { name: 'landing', path: 'apps/landing', type: ProjectType.React },
        {
          name: 'storefront',
          path: 'apps/storefront',
          type: ProjectType.NextJS,
          framework: Framework.NextJS,
        },
      ]);
    });

    it('WorkspaceService calls detectMonorepo first and never reports react for the root', async () => {
      const detectMonorepo = jest.spyOn(monorepoDetector, 'detectMonorepo');
      const detectProjectType = jest.spyOn(detector, 'detectProjectType');

      const info = await projectInfo();

      expect(detectMonorepo.mock.invocationCallOrder[0]).toBeLessThan(
        detectProjectType.mock.invocationCallOrder[0],
      );
      expect(info?.type).toBe(ProjectType.Node);
      expect(info?.monorepoType).toBe(MonorepoType.Nx);
      expect(info?.version).toBe('1.2.3');
      expect(
        info?.projects?.map((p) => `${p.path}:${p.type}:${p.framework}`),
      ).toEqual([
        'apps/api:node:undefined',
        'apps/dashboard:angular:angular',
        'apps/landing:react:react',
        'apps/storefront:nextjs:nextjs',
      ]);
      expect(info?.projectDiscovery).toEqual({
        totalProjects: 4,
        inspectedProjects: 4,
        complete: true,
        issues: [],
      });
    });

    it('r1 S4: keeps the JSX/TSX statistics a react root had after the root becomes node', async () => {
      write('apps/landing/src/main.tsx', 'export {};');
      write('apps/landing/src/legacy.jsx', 'export {};');
      write('apps/dashboard/src/app.component.html', '<p></p>');

      const info = await projectInfo();

      expect(info?.type).toBe(ProjectType.Node);
      expect(info?.fileStatistics['.tsx']).toBe(1);
      expect(info?.fileStatistics['.jsx']).toBe(1);
      expect(info?.fileStatistics['.html']).toBe(1);
      expect(info?.fileStatistics['.scss']).toBe(0);
      expect(info?.fileStatistics['.json']).toBeGreaterThan(0);
    });

    it('r1 S1: finds Nx projects under libs/ and nested app roots, not only apps/*', async () => {
      nxApp('libs/backend/core', '@nx/js:tsc', 'core');
      nxApp('apps/team/web', '@angular-devkit/build-angular:application');

      const composition = await compose();

      expect(composition.projects.map((p) => p.path)).toEqual([
        'apps/api',
        'apps/dashboard',
        'apps/landing',
        'apps/storefront',
        'apps/team/web',
        'libs/backend/core',
      ]);
    });

    it('r1 S3: an explicit Angular build executor wins over React tooling in the app deps', async () => {
      nxApp('apps/admin', '@angular-devkit/build-angular:application');
      write('apps/admin/package.json', {
        name: 'admin',
        dependencies: { '@angular/core': '^18.0.0' },
        devDependencies: { react: '^18.0.0', '@testing-library/react': '^14' },
      });

      const info = await projectInfo();
      const admin = info?.projects?.find((p) => p.path === 'apps/admin');

      expect(admin?.type).toBe(ProjectType.Angular);
      expect(admin?.framework).toBe(Framework.Angular);
    });

    it('r1 B2: keeps a project whose only manifest is malformed, as unknown with a reason', async () => {
      write('apps/broken/project.json', '{ "name": "broken", ');

      const composition = await compose();

      expect(composition.totalProjects).toBe(5);
      expect(
        composition.projects.find((p) => p.path === 'apps/broken'),
      ).toEqual({
        name: 'broken',
        path: 'apps/broken',
        type: ProjectType.Unknown,
        issue: 'project.json could not be read or parsed',
      });
    });

    it('r1 B2: keeps a project whose only manifest cannot be read', async () => {
      write('apps/locked/project.json', { name: 'locked' });
      failingReads.add(abs('apps/locked/project.json'));

      const composition = await compose();

      expect(
        composition.projects.find((p) => p.path === 'apps/locked'),
      ).toEqual({
        name: 'locked',
        path: 'apps/locked',
        type: ProjectType.Unknown,
        issue: 'project.json could not be read or parsed',
      });
    });

    it('r1 B2: a directory that cannot be read marks discovery incomplete', async () => {
      failingReads.add(abs('apps'));

      const composition = await compose();

      expect(composition.complete).toBe(false);
      expect(composition.issues).toContain('apps/ could not be read');
    });
  });

  it('r1 S1 + S2: follows package.json workspaces (services/*, nested **) and keeps Express', async () => {
    write('package.json', {
      name: 'yarn-root',
      private: true,
      workspaces: ['services/*', 'tools/**'],
    });
    write('services/api/package.json', {
      name: '@acme/api',
      dependencies: { express: '^4.0.0' },
    });
    write('services/scratch/notes.md', '#');
    write('tools/team/web/package.json', {
      name: '@acme/web',
      dependencies: { react: '^18.0.0' },
    });

    const info = await projectInfo();

    expect(info?.monorepoType).toBe(MonorepoType.YarnWorkspaces);
    expect(
      info?.projects?.map((p) => `${p.name}:${p.type}:${p.framework}`),
    ).toEqual(['@acme/api:node:express', '@acme/web:react:react']);
    expect(info?.projectDiscovery?.complete).toBe(true);
  });

  it('r1 S1: follows pnpm-workspace.yaml globs including exclusions', async () => {
    write('package.json', { name: 'pnpm-root' });
    write(
      'pnpm-workspace.yaml',
      'packages:\n  - \'libs/*\'\n  - "!libs/skip"\n',
    );
    write('libs/ui/package.json', { name: 'ui', dependencies: { vue: '^3' } });
    write('libs/skip/package.json', { name: 'skip' });

    const composition = await compose();

    expect(composition.projects.map((p) => `${p.path}:${p.type}`)).toEqual([
      'libs/ui:vue',
    ]);
  });

  it('r2 B1: discloses the depth bound when an Nx project sits below it', async () => {
    write('nx.json', {});
    write('package.json', { name: 'deep-root' });
    // `apps` plus MAX_DISCOVERY_DEPTH nested levels puts web one level below.
    const deep = Array.from({ length: MAX_DISCOVERY_DEPTH }, (_, i) => `d${i}`);
    write(`apps/${deep.join('/')}/web/project.json`, {
      targets: { build: { executor: '@nx/vite:build' } },
    });

    const composition = await compose();

    expect(composition.complete).toBe(false);
    expect(composition.issues).toContain(
      `directories deeper than ${MAX_DISCOVERY_DEPTH} levels were not searched; more projects may exist`,
    );
  });

  it('r2 B1: discloses the depth bound for a ** workspace pattern', async () => {
    write('package.json', { name: 'deep-yarn', workspaces: ['apps/**'] });
    const deep = Array.from({ length: MAX_DISCOVERY_DEPTH }, (_, i) => `d${i}`);
    write(`apps/${deep.join('/')}/web/package.json`, { name: 'web' });

    const composition = await compose();

    expect(composition.complete).toBe(false);
    expect(composition.issues).toContain(
      `directories deeper than ${MAX_DISCOVERY_DEPTH} levels were not searched; more projects may exist`,
    );
  });

  it('r2 B2: keeps pnpm members declared with trailing and between-item comments', async () => {
    write('package.json', { name: 'pnpm-root' });
    write(
      'pnpm-workspace.yaml',
      [
        '# workspace members',
        'packages:',
        "  - 'services/*' # applications",
        '  # tooling lives here',
        '  - "tools/*"',
        "  - '!tools/skip' # not a member",
        '',
      ].join('\n'),
    );
    write('services/api/package.json', { name: 'api' });
    write('tools/cli/package.json', { name: 'cli' });
    write('tools/skip/package.json', { name: 'skip' });

    const composition = await compose();

    expect(composition.projects.map((p) => p.path)).toEqual([
      'services/api',
      'tools/cli',
    ]);
    expect(composition.complete).toBe(true);
  });

  it('r2 S1: the build target decides, not an auxiliary lint executor', async () => {
    write('nx.json', {});
    write('package.json', { name: 'rn-root' });
    write('apps/mobile/project.json', {
      name: 'mobile',
      targets: {
        lint: { executor: '@angular-eslint/builder:lint' },
        build: { executor: '@nx/react-native:bundle' },
      },
    });
    write('apps/mobile/package.json', {
      name: 'mobile',
      dependencies: { react: '^18.0.0', 'react-native': '^0.74.0' },
    });

    const composition = await compose();

    expect(composition.projects[0]).toMatchObject({
      type: ProjectType.React,
      framework: Framework.React,
    });
  });

  it('r3 S1: a quoted brace glob in a pnpm flow array is one pattern', async () => {
    write('package.json', { name: 'pnpm-root' });
    write('pnpm-workspace.yaml', "packages: ['{services,tools}/*']\n");
    write('services/api/package.json', { name: 'api' });
    write('tools/cli/package.json', { name: 'cli' });

    const composition = await compose();

    expect(composition.projects.map((p) => p.path)).toEqual([
      'services/api',
      'tools/cli',
    ]);
    expect(composition.complete).toBe(true);
  });

  it('r3 S1: an unusable workspace glob is a reported issue, not a failed analysis', async () => {
    write('package.json', { name: 'pnpm-root' });
    write('pnpm-workspace.yaml', "packages:\n  - '{apps/a,libs/b}'\n");
    write('apps/a/package.json', { name: 'a' });

    const composition = await compose();

    expect(composition.complete).toBe(false);
    expect(composition.issues).toContain(
      "workspace pattern '{apps/a,libs/b}' could not be used",
    );
  });

  it('r3 S2: an application bundle target outranks a custom-named tooling target', async () => {
    write('nx.json', {});
    write('package.json', { name: 'rn-root' });
    write('apps/web/project.json', {
      name: 'web',
      targets: {
        check: { executor: '@angular-eslint/builder:lint' },
        bundle: { executor: '@nx/react-native:bundle' },
      },
    });
    write('apps/web/package.json', {
      name: 'web',
      dependencies: { react: '^18.0.0' },
    });

    const composition = await compose();

    expect(composition.projects[0]).toMatchObject({
      type: ProjectType.React,
      framework: Framework.React,
    });
  });

  it('r2 S2: a member with nuxt and vue in its own manifest reports Nuxt', async () => {
    write('package.json', { name: 'vue-root', workspaces: ['apps/*'] });
    write('apps/shop/package.json', {
      name: 'shop',
      dependencies: { nuxt: '^3.0.0', vue: '^3.0.0' },
    });

    const info = await projectInfo();

    expect(info?.projects?.[0]).toMatchObject({
      type: ProjectType.Vue,
      framework: Framework.Nuxt,
    });
  });

  it('r1 S1: discloses the apps/* + packages/* fallback when nothing is declared', async () => {
    write('turbo.json', {});
    write('package.json', { name: 'turbo-root' });
    write('apps/web/package.json', { name: 'web' });

    const composition = await compose();

    expect(composition.projects.map((p) => p.path)).toEqual(['apps/web']);
    expect(composition.issues).toContain(
      'no declared workspace members; apps/* and packages/* listed by convention',
    );
  });

  it('leaves a single-app workspace with the same deps on single-app detection', async () => {
    write('package.json', {
      name: 'single',
      dependencies: { react: '^18.0.0', '@angular/core': '^18.0.0' },
    });

    const monorepo = await monorepoDetector.detectMonorepo(root);

    expect(monorepo.isMonorepo).toBe(false);
    await expect(detector.detectProjectType(root)).resolves.toBe(
      ProjectType.React,
    );
  });
});

/**
 * Bulk fixtures over an in-memory `IFileSystemProvider` (TASK_2026_559 Batch
 * 11b, r1 M2). On real disk the inspection-cap case made 200+ serial manifest
 * reads and exceeded Jest's 5 s default when disk reads slowed under machine
 * load; here every read resolves without I/O, so only the logic is measured.
 * The root is never created on disk: a stray real-disk read fails the test.
 */
describe('ProjectDetectorService — bulk monorepo fixtures (in memory)', () => {
  const root = path.join(os.tmpdir(), 'ptah-memory-fixture-never-on-disk');
  let files: Map<string, string>;
  let detector: ProjectDetectorService;
  let monorepoDetector: MonorepoDetectorService;

  const write: WriteFixture = (relativePath, content) => {
    files.set(
      path.join(root, ...relativePath.split('/')),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  };

  const compose = () => composeMonorepo(root, monorepoDetector, detector);

  beforeEach(() => {
    files = new Map();
    const fileSystem = new FileSystemService(memoryFileSystemProvider(files));
    const provider = {
      getWorkspaceFolders: jest.fn().mockReturnValue([root]),
      getWorkspaceRoot: jest.fn().mockReturnValue(root),
    } as unknown as IWorkspaceProvider;
    detector = new ProjectDetectorService(fileSystem, provider);
    monorepoDetector = new MonorepoDetectorService(fileSystem, provider);
  });

  it('r1 B1: counts every project past the inspection cap and says so', async () => {
    expect(fs.existsSync(root)).toBe(false);
    writeNxWorkspace(write);
    const extra = MAX_INSPECTED_PROJECTS + 6;
    for (let i = 0; i < extra; i++) {
      writeNxApp(write, `libs/pkg-${String(i).padStart(3, '0')}`, '@nx/js:tsc');
    }
    // Plain folders never take a project slot.
    for (let i = 0; i < 20; i++) {
      write(`libs/aaa-plain-${i}/README.md`, '#');
    }

    const composition = await compose();

    expect(composition.totalProjects).toBe(4 + extra);
    expect(composition.projects).toHaveLength(MAX_INSPECTED_PROJECTS);
    expect(composition.complete).toBe(false);
    expect(composition.issues).toContain(
      `${4 + extra - MAX_INSPECTED_PROJECTS} of ${4 + extra} projects not inspected (limit ${MAX_INSPECTED_PROJECTS})`,
    );
  });

  it('r2 B3: summarises member inspection failures in the composition, whatever their position', async () => {
    write('nx.json', {});
    write('package.json', { name: 'many-root' });
    for (let i = 0; i < 30; i++) {
      writeNxApp(write, `libs/pkg-${String(i).padStart(2, '0')}`, '@nx/js:tsc');
    }
    write('libs/pkg-29/project.json', '{ "name": ');

    const composition = await compose();

    expect(composition.complete).toBe(false);
    expect(composition.issues).toContain(
      '1 project could not be fully inspected: libs/pkg-29 (project.json could not be read or parsed)',
    );
  });
});

/** Writes one fixture file, given a `/`-separated workspace-relative path. */
type WriteFixture = (relativePath: string, content: unknown) => void;

function writeNxApp(
  write: WriteFixture,
  dir: string,
  executor: string,
  name?: string,
): void {
  write(`${dir}/project.json`, {
    ...(name ? { name } : {}),
    targets: { build: { executor } },
  });
}

/**
 * The Nx workspace both fixture suites build on: root deps react +
 * @angular/core, no root angular.json, four apps and one plain folder.
 */
function writeNxWorkspace(write: WriteFixture): void {
  write('nx.json', { npmScope: 'fixture' });
  write('package.json', {
    name: 'fixture-workspace',
    version: '1.2.3',
    dependencies: { react: '^18.0.0', '@angular/core': '^18.0.0' },
    devDependencies: { nx: '^19.0.0' },
  });
  writeNxApp(
    write,
    'apps/dashboard',
    '@angular-devkit/build-angular:application',
    'dashboard',
  );
  writeNxApp(write, 'apps/landing', '@nx/vite:build', 'landing');
  write('apps/landing/package.json', {
    name: 'landing',
    dependencies: { react: '^18.0.0' },
  });
  writeNxApp(write, 'apps/api', '@nx/js:node', 'api');
  writeNxApp(write, 'apps/storefront', '@nx/next:build');
  // A plain folder with no manifest is not a project.
  write('apps/notes/README.md', '# notes');
}

async function composeMonorepo(
  root: string,
  monorepoDetector: MonorepoDetectorService,
  detector: ProjectDetectorService,
) {
  const monorepo = await monorepoDetector.detectMonorepo(root);
  expect(monorepo.isMonorepo).toBe(true);
  return detector.detectMonorepoComposition(
    root,
    await monorepoDetector.detectDeclaredMembers(root, monorepo.type),
  );
}

/**
 * `IFileSystemProvider` over `files` (absolute path -> content); directories
 * are the path prefixes of those files. A missing path rejects like ENOENT.
 */
function memoryFileSystemProvider(
  files: ReadonlyMap<string, string>,
): IFileSystemProvider {
  const entriesOf = (dir: string): Map<string, FileType> => {
    const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
    const entries = new Map<string, FileType>();
    for (const file of files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const [name, ...rest] = file.slice(prefix.length).split(path.sep);
      entries.set(name, rest.length > 0 ? FileType.Directory : FileType.File);
    }
    return entries;
  };
  const notFound = (p: string): Error =>
    new Error(`ENOENT: no such file or directory, '${p}'`);
  return {
    readFile: async (p: string) => {
      const content = files.get(path.normalize(p));
      if (content === undefined) throw notFound(p);
      return content;
    },
    readDirectory: async (p: string) => {
      const entries = entriesOf(path.normalize(p));
      if (entries.size === 0) throw notFound(p);
      return [...entries].map(([name, type]) => ({ name, type }));
    },
    exists: async (p: string) =>
      files.has(path.normalize(p)) || entriesOf(path.normalize(p)).size > 0,
  } as unknown as IFileSystemProvider;
}

/**
 * `IFileSystemProvider` over the real disk, for the temp-dir fixtures. A read
 * of any path in `failing` rejects, standing in for EACCES.
 */
function nodeFileSystemProvider(
  failing: ReadonlySet<string> = new Set(),
): IFileSystemProvider {
  const guard = (p: string): void => {
    if (failing.has(p)) {
      throw new Error('EACCES: permission denied');
    }
  };
  return {
    readFile: async (p: string) => {
      guard(p);
      return fs.promises.readFile(p, 'utf8');
    },
    readDirectory: async (p: string) => {
      guard(p);
      return (await fs.promises.readdir(p, { withFileTypes: true })).map(
        (entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? FileType.Directory : FileType.File,
        }),
      );
    },
    exists: async (p: string) => fs.existsSync(p),
  } as unknown as IFileSystemProvider;
}
