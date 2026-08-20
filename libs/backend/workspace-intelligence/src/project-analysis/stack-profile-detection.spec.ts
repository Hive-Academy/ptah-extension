import 'reflect-metadata';

import { FileType } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { FileSystemService } from '../services/file-system.service';
import { ProjectDetectorService } from './project-detector.service';
import { FrameworkDetectorService } from './framework-detector.service';
import { MonorepoDetectorService } from './monorepo-detector.service';
import { Framework, MonorepoType, ProjectType } from '../types/workspace.types';

/**
 * Registry-driven detection, across all three detectors.
 *
 * Deliberately a feature spec rather than three sets of additions to the
 * per-service specs: the point being pinned is that one table now answers for
 * all of them, and the fixtures below are the same workspace root seen from
 * three angles. The existing `*-detector.service.spec.ts` files stay as they
 * are — they are the pre-registry regression bar and must not be rewritten to
 * match the new implementation.
 */

const WORKSPACE = '/test/workspace';

/** A workspace root, expressed the way `FileSystemService.readDirectory` returns it. */
function root(...names: string[]): Array<{ name: string; type: FileType }> {
  return names.map((name) => ({ name, type: FileType.File }));
}

function buildFileSystem(): jest.Mocked<FileSystemService> {
  return {
    readDirectory: jest.fn(),
    readFile: jest.fn(),
    stat: jest.fn(),
    exists: jest.fn().mockResolvedValue(false),
    isVirtualWorkspace: jest.fn(),
    dispose: jest.fn(),
  } as unknown as jest.Mocked<FileSystemService>;
}

function buildWorkspaceProvider(): jest.Mocked<IWorkspaceProvider> {
  return {
    getWorkspaceFolders: jest.fn().mockReturnValue([]),
    getWorkspaceRoot: jest.fn().mockReturnValue(undefined),
    getConfiguration: jest.fn(),
    onDidChangeConfiguration: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn(),
  } as unknown as jest.Mocked<IWorkspaceProvider>;
}

describe('ProjectDetectorService — registry-sourced filename tests', () => {
  let fileSystem: jest.Mocked<FileSystemService>;
  let service: ProjectDetectorService;

  beforeEach(() => {
    fileSystem = buildFileSystem();
    service = new ProjectDetectorService(fileSystem, buildWorkspaceProvider());
  });

  it.each([
    ['MyApp.sln'],
    ['MyApp.slnx'],
    ['MyApp.csproj'],
    ['MyApp.fsproj'],
    ['MyApp.vbproj'],
    ['global.json'],
    ['Directory.Build.props'],
    ['Directory.Packages.props'],
  ])('detects .NET from %s', async (manifest) => {
    fileSystem.readDirectory.mockResolvedValue(root(manifest));
    expect(await service.detectProjectType(WORKSPACE)).toBe(ProjectType.DotNet);
  });

  it.each([
    ['requirements.txt'],
    ['pyproject.toml'],
    ['setup.py'],
    ['setup.cfg'],
    ['Pipfile'],
    ['uv.lock'],
    ['poetry.lock'],
  ])('detects Python from %s', async (manifest) => {
    fileSystem.readDirectory.mockResolvedValue(root(manifest));
    expect(await service.detectProjectType(WORKSPACE)).toBe(ProjectType.Python);
  });

  it('still resolves a plain Node workspace to Node', async () => {
    fileSystem.readDirectory.mockResolvedValue(root('package.json'));
    fileSystem.readFile.mockResolvedValue('{}');
    expect(await service.detectProjectType(WORKSPACE)).toBe(ProjectType.Node);
  });

  it('keeps the Node framework check ahead of the new .NET rules', async () => {
    // A mixed repo — an Angular frontend beside a .NET API. The framework the
    // user works in wins, exactly as it did before the registry.
    fileSystem.readDirectory.mockResolvedValue(
      root('package.json', 'Api.csproj'),
    );
    fileSystem.readFile.mockResolvedValue(
      JSON.stringify({ dependencies: { '@angular/core': '21.0.0' } }),
    );
    expect(await service.detectProjectType(WORKSPACE)).toBe(
      ProjectType.Angular,
    );
  });

  it('keeps Java ahead of .NET, as the original ordering did', async () => {
    fileSystem.readDirectory.mockResolvedValue(
      root('pom.xml', 'Legacy.csproj'),
    );
    expect(await service.detectProjectType(WORKSPACE)).toBe(ProjectType.Java);
  });

  it('returns General for a root with nothing recognisable', async () => {
    fileSystem.readDirectory.mockResolvedValue(root('README.md', 'LICENSE'));
    expect(await service.detectProjectType(WORKSPACE)).toBe(
      ProjectType.General,
    );
  });
});

describe('FrameworkDetectorService — .NET application model', () => {
  let fileSystem: jest.Mocked<FileSystemService>;
  let service: FrameworkDetectorService;

  beforeEach(() => {
    fileSystem = buildFileSystem();
    service = new FrameworkDetectorService(fileSystem);
  });

  it('detects ASP.NET Core from the Web SDK', async () => {
    fileSystem.readDirectory.mockResolvedValue(root('Api.csproj'));
    fileSystem.readFile.mockResolvedValue(
      '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup /></Project>',
    );
    expect(await service.detectFramework(WORKSPACE, ProjectType.DotNet)).toBe(
      Framework.AspNetCore,
    );
  });

  it('detects Blazor ahead of ASP.NET Core on a Web SDK project', async () => {
    // Blazor apps ARE Web SDK projects. If the SDK were tested first,
    // Framework.Blazor would be unreachable — the same defect that left
    // Flask and FastAPI dead in this file.
    fileSystem.readDirectory.mockResolvedValue(root('Client.csproj'));
    fileSystem.readFile.mockResolvedValue(
      '<Project Sdk="Microsoft.NET.Sdk.Web">' +
        '<ItemGroup><PackageReference Include="Microsoft.AspNetCore.Components.WebAssembly" Version="8.0.0" /></ItemGroup>' +
        '</Project>',
    );
    expect(await service.detectFramework(WORKSPACE, ProjectType.DotNet)).toBe(
      Framework.Blazor,
    );
  });

  it('detects a worker service from the Worker SDK', async () => {
    fileSystem.readDirectory.mockResolvedValue(root('Worker.csproj'));
    fileSystem.readFile.mockResolvedValue(
      '<Project Sdk="Microsoft.NET.Sdk.Worker" />',
    );
    expect(await service.detectFramework(WORKSPACE, ProjectType.DotNet)).toBe(
      Framework.DotNetWorker,
    );
  });

  it('returns undefined for a plain class library', async () => {
    fileSystem.readDirectory.mockResolvedValue(root('Domain.csproj'));
    fileSystem.readFile.mockResolvedValue(
      '<Project Sdk="Microsoft.NET.Sdk" />',
    );
    expect(
      await service.detectFramework(WORKSPACE, ProjectType.DotNet),
    ).toBeUndefined();
  });

  it('returns undefined when there is no project file to read', async () => {
    fileSystem.readDirectory.mockResolvedValue(root('README.md'));
    expect(
      await service.detectFramework(WORKSPACE, ProjectType.DotNet),
    ).toBeUndefined();
  });

  it('survives an unreadable project file', async () => {
    fileSystem.readDirectory.mockResolvedValue(root('Broken.csproj'));
    fileSystem.readFile.mockRejectedValue(new Error('EACCES'));
    expect(
      await service.detectFramework(WORKSPACE, ProjectType.DotNet),
    ).toBeUndefined();
  });
});

describe('FrameworkDetectorService — reachable Flask and FastAPI', () => {
  let fileSystem: jest.Mocked<FileSystemService>;
  let service: FrameworkDetectorService;

  beforeEach(() => {
    fileSystem = buildFileSystem();
    service = new FrameworkDetectorService(fileSystem);
  });

  /** Only the named Python manifest exists; `manage.py` and configs do not. */
  function onlyManifest(manifest: string, content: string): void {
    fileSystem.exists.mockImplementation(async (candidate: string) =>
      candidate.endsWith(manifest),
    );
    fileSystem.readFile.mockResolvedValue(content);
  }

  it('detects FastAPI from requirements.txt', async () => {
    onlyManifest('requirements.txt', 'fastapi==0.115.0\nuvicorn==0.32.0\n');
    expect(await service.detectFramework(WORKSPACE, ProjectType.Python)).toBe(
      Framework.FastAPI,
    );
  });

  it('detects Flask from requirements.txt', async () => {
    onlyManifest('requirements.txt', 'Flask==3.0.0\n');
    expect(await service.detectFramework(WORKSPACE, ProjectType.Python)).toBe(
      Framework.Flask,
    );
  });

  it('detects FastAPI from pyproject.toml, which has no requirements.txt', async () => {
    onlyManifest(
      'pyproject.toml',
      '[project]\ndependencies = ["fastapi>=0.115", "pydantic>=2"]\n',
    );
    expect(await service.detectFramework(WORKSPACE, ProjectType.Python)).toBe(
      Framework.FastAPI,
    );
  });

  it('detects Django from pyproject.toml', async () => {
    onlyManifest('pyproject.toml', '[project]\ndependencies = ["django>=5"]\n');
    expect(await service.detectFramework(WORKSPACE, ProjectType.Python)).toBe(
      Framework.Django,
    );
  });

  it('keeps Django ahead of FastAPI when both are declared', async () => {
    onlyManifest('requirements.txt', 'django==5.1\nfastapi==0.115.0\n');
    expect(await service.detectFramework(WORKSPACE, ProjectType.Python)).toBe(
      Framework.Django,
    );
  });

  it('still lets manage.py win outright', async () => {
    fileSystem.exists.mockImplementation(async (candidate: string) =>
      candidate.endsWith('manage.py'),
    );
    expect(await service.detectFramework(WORKSPACE, ProjectType.Python)).toBe(
      Framework.Django,
    );
  });

  it('returns undefined when no framework is named', async () => {
    onlyManifest('requirements.txt', 'requests==2.32.0\n');
    expect(
      await service.detectFramework(WORKSPACE, ProjectType.Python),
    ).toBeUndefined();
  });
});

describe('MonorepoDetectorService — .NET solutions and Python workspaces', () => {
  let fileSystem: jest.Mocked<FileSystemService>;
  let service: MonorepoDetectorService;

  beforeEach(() => {
    fileSystem = buildFileSystem();
    service = new MonorepoDetectorService(fileSystem, buildWorkspaceProvider());
    fileSystem.readDirectory.mockResolvedValue(root());
  });

  const SLN_WITH_THREE = [
    'Microsoft Visual Studio Solution File, Format Version 12.00',
    'Project("{FAE04EC0}") = "Api", "src\\Api\\Api.csproj", "{A}"',
    'EndProject',
    'Project("{FAE04EC0}") = "Domain", "src\\Domain\\Domain.csproj", "{B}"',
    'EndProject',
    'Project("{FAE04EC0}") = "Tests", "test\\Tests\\Tests.csproj", "{C}"',
    'EndProject',
  ].join('\n');

  it('detects a .sln grouping several projects', async () => {
    fileSystem.readDirectory.mockResolvedValue(root('MyApp.sln'));
    fileSystem.readFile.mockResolvedValue(SLN_WITH_THREE);

    const result = await service.detectMonorepo(WORKSPACE);

    expect(result.isMonorepo).toBe(true);
    expect(result.type).toBe(MonorepoType.DotNetSolution);
    expect(result.packageCount).toBe(3);
    expect(result.workspaceFiles).toEqual(['MyApp.sln']);
  });

  it('detects a .slnx grouping several projects', async () => {
    fileSystem.readDirectory.mockResolvedValue(root('MyApp.slnx'));
    fileSystem.readFile.mockResolvedValue(
      '<Solution><Project Path="src/Api/Api.csproj" /><Project Path="src/Web/Web.csproj" /></Solution>',
    );

    const result = await service.detectMonorepo(WORKSPACE);

    expect(result.type).toBe(MonorepoType.DotNetSolution);
    expect(result.packageCount).toBe(2);
  });

  it('does not call a single-project solution a monorepo', async () => {
    fileSystem.readDirectory.mockResolvedValue(root('Solo.sln'));
    fileSystem.readFile.mockResolvedValue(
      'Project("{FAE04EC0}") = "Solo", "Solo.csproj", "{A}"\nEndProject',
    );
    expect((await service.detectMonorepo(WORKSPACE)).isMonorepo).toBe(false);
  });

  it('reports Nx, not the solution, for an Nx workspace containing .NET', async () => {
    fileSystem.readDirectory.mockResolvedValue(root('MyApp.sln', 'nx.json'));
    fileSystem.exists.mockImplementation(async (candidate: string) =>
      candidate.endsWith('nx.json'),
    );
    fileSystem.readFile.mockResolvedValue('{}');

    expect((await service.detectMonorepo(WORKSPACE)).type).toBe(
      MonorepoType.Nx,
    );
  });

  it('detects a uv workspace and counts its members', async () => {
    fileSystem.exists.mockImplementation(async (candidate: string) =>
      candidate.endsWith('pyproject.toml'),
    );
    fileSystem.readFile.mockResolvedValue(
      ['[tool.uv.workspace]', 'members = ["packages/*", "apps/api"]', ''].join(
        '\n',
      ),
    );

    const result = await service.detectMonorepo(WORKSPACE);

    expect(result.type).toBe(MonorepoType.UvWorkspace);
    expect(result.packageCount).toBe(2);
  });

  it('detects a Poetry root with sibling path dependencies', async () => {
    fileSystem.exists.mockImplementation(async (candidate: string) =>
      candidate.endsWith('pyproject.toml'),
    );
    fileSystem.readFile.mockResolvedValue(
      [
        '[tool.poetry]',
        'name = "root"',
        '[tool.poetry.dependencies]',
        'core = { path = "packages/core", develop = true }',
        'api = { path = "packages/api", develop = true }',
      ].join('\n'),
    );

    const result = await service.detectMonorepo(WORKSPACE);

    expect(result.type).toBe(MonorepoType.PoetryWorkspace);
    expect(result.packageCount).toBe(2);
  });

  it('does not call a single vendored path dependency a monorepo', async () => {
    fileSystem.exists.mockImplementation(async (candidate: string) =>
      candidate.endsWith('pyproject.toml'),
    );
    fileSystem.readFile.mockResolvedValue(
      ['[tool.poetry]', 'vendored = { path = "vendor/thing" }'].join('\n'),
    );
    expect((await service.detectMonorepo(WORKSPACE)).isMonorepo).toBe(false);
  });

  it('does not call a plain single-package pyproject a monorepo', async () => {
    fileSystem.exists.mockImplementation(async (candidate: string) =>
      candidate.endsWith('pyproject.toml'),
    );
    fileSystem.readFile.mockResolvedValue('[project]\nname = "app"\n');
    expect((await service.detectMonorepo(WORKSPACE)).isMonorepo).toBe(false);
  });
});
