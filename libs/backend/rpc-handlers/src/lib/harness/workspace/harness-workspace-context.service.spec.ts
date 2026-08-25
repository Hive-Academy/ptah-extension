import 'reflect-metadata';

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type { PluginLoaderService } from '@ptah-extension/agent-sdk';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

import { HarnessWorkspaceContextService } from './harness-workspace-context.service';

function buildService(workspaceRoot: string | undefined): {
  service: HarnessWorkspaceContextService;
} {
  const workspaceProvider = {
    getWorkspaceRoot: () => workspaceRoot,
  } as unknown as IWorkspaceProvider;
  const pluginLoader = {
    resolveCurrentPluginPaths: () => [],
    discoverSkillsForPlugins: () => [],
    getDisabledSkillIds: () => [],
  } as unknown as PluginLoaderService;

  const service = new HarnessWorkspaceContextService(
    createMockLogger() as unknown as Logger,
    pluginLoader,
    workspaceProvider,
  );
  return { service };
}

describe('HarnessWorkspaceContextService.discoverAvailableSkills', () => {
  it('preserves bare slug invocation while exposing source-qualified metadata', () => {
    const workspaceProvider = {
      getWorkspaceRoot: () => undefined,
    } as unknown as IWorkspaceProvider;
    const pluginLoader = {
      resolveCurrentPluginPaths: () => ['D:/plugins/ptah-core'],
      discoverSkillsForPlugins: () => [
        {
          skillId: 'run-tests',
          descriptorId: 'ptah-core:run-tests',
          invocationName: 'run-tests',
          displayName: 'Run tests',
          description: 'Runs tests',
          pluginId: 'ptah-core',
          sourceId: 'ptah-core',
          source: 'bundled' as const,
          invocability: 'invocable' as const,
        },
      ],
      getDisabledSkillIds: () => [],
    } as unknown as PluginLoaderService;
    const service = new HarnessWorkspaceContextService(
      createMockLogger() as unknown as Logger,
      pluginLoader,
      workspaceProvider,
    );

    expect(service.discoverAvailableSkills()).toEqual([
      expect.objectContaining({
        id: 'run-tests',
        invocationName: 'run-tests',
        descriptorId: 'ptah-core:run-tests',
        source: 'plugin',
        provenance: 'bundled',
        sourceId: 'ptah-core',
        invocability: 'invocable',
      }),
    ]);
  });

  it('reports a disabled skill as not invocable without changing its skill ID', () => {
    const workspaceProvider = {
      getWorkspaceRoot: () => undefined,
    } as unknown as IWorkspaceProvider;
    const pluginLoader = {
      resolveCurrentPluginPaths: () => ['D:/plugins/ptah-core'],
      discoverSkillsForPlugins: () => [
        {
          skillId: 'run-tests',
          descriptorId: 'ptah-core:run-tests',
          invocationName: 'run-tests',
          displayName: 'Run tests',
          description: 'Runs tests',
          pluginId: 'ptah-core',
          sourceId: 'ptah-core',
          source: 'bundled' as const,
          invocability: 'invocable' as const,
        },
      ],
      getDisabledSkillIds: () => ['run-tests'],
    } as unknown as PluginLoaderService;
    const service = new HarnessWorkspaceContextService(
      createMockLogger() as unknown as Logger,
      pluginLoader,
      workspaceProvider,
    );

    expect(service.discoverAvailableSkills()[0]).toMatchObject({
      id: 'run-tests',
      invocationName: 'run-tests',
      invocability: 'not-invocable',
      isActive: false,
    });
  });
});

describe('HarnessWorkspaceContextService.isWorkspaceEffectivelyEmpty', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-empty-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('treats a missing workspace as empty', async () => {
    const { service } = buildService(undefined);
    expect(await service.isWorkspaceEffectivelyEmpty()).toBe(true);
  });

  it('treats a directory with only dot-entries as empty', async () => {
    await fs.mkdir(path.join(root, '.git'), { recursive: true });
    await fs.mkdir(path.join(root, '.claude'), { recursive: true });
    const { service } = buildService(root);
    expect(await service.isWorkspaceEffectivelyEmpty()).toBe(true);
  });

  it('treats a directory with only seed docs as empty', async () => {
    await fs.writeFile(path.join(root, 'README.md'), '# hi', 'utf-8');
    await fs.mkdir(path.join(root, 'docs'), { recursive: true });
    await fs.writeFile(path.join(root, 'docs', 'prd.md'), 'plan', 'utf-8');
    const { service } = buildService(root);
    expect(await service.isWorkspaceEffectivelyEmpty()).toBe(true);
  });

  it('treats a directory with package.json as not empty', async () => {
    await fs.writeFile(path.join(root, 'package.json'), '{}', 'utf-8');
    const { service } = buildService(root);
    expect(await service.isWorkspaceEffectivelyEmpty()).toBe(false);
  });

  it('treats a directory with a top-level source file as not empty', async () => {
    await fs.writeFile(path.join(root, 'index.ts'), 'export {}', 'utf-8');
    const { service } = buildService(root);
    expect(await service.isWorkspaceEffectivelyEmpty()).toBe(false);
  });

  it('treats a directory with source files nested one level deep as not empty', async () => {
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'main.py'), 'print(1)', 'utf-8');
    const { service } = buildService(root);
    expect(await service.isWorkspaceEffectivelyEmpty()).toBe(false);
  });

  // TASK_2026_270: the bug this method had. A workspace holding a real .NET
  // solution reported EMPTY, so New Project scaffolded on top of existing work.
  // The old inline manifest list knew `.cs` but could not express `*.csproj`.
  it('treats a solution-only .NET workspace as not empty', async () => {
    await fs.writeFile(path.join(root, 'MyApp.sln'), '', 'utf-8');
    await fs.writeFile(path.join(root, 'MyApp.csproj'), '<Project />', 'utf-8');
    const { service } = buildService(root);
    expect(await service.isWorkspaceEffectivelyEmpty()).toBe(false);
  });

  it.each([
    'MyApp.sln',
    'MyApp.slnx',
    'App.csproj',
    'App.fsproj',
    'App.vbproj',
  ])('treats a workspace holding only %s as not empty', async (projectFile) => {
    await fs.writeFile(path.join(root, projectFile), '', 'utf-8');
    const { service } = buildService(root);
    expect(await service.isWorkspaceEffectivelyEmpty()).toBe(false);
  });

  it('treats central package management alone as not empty', async () => {
    await fs.writeFile(
      path.join(root, 'Directory.Packages.props'),
      '<Project />',
      'utf-8',
    );
    const { service } = buildService(root);
    expect(await service.isWorkspaceEffectivelyEmpty()).toBe(false);
  });

  it.each(['uv.lock', 'poetry.lock', 'setup.cfg', 'Pipfile'])(
    'treats a Python workspace declared only by %s as not empty',
    async (manifest) => {
      await fs.writeFile(path.join(root, manifest), '', 'utf-8');
      const { service } = buildService(root);
      expect(await service.isWorkspaceEffectivelyEmpty()).toBe(false);
    },
  );

  it('still honours the languages that have no stack profile', async () => {
    await fs.writeFile(path.join(root, 'go.mod'), 'module x', 'utf-8');
    const { service } = buildService(root);
    expect(await service.isWorkspaceEffectivelyEmpty()).toBe(false);
  });

  it.each(['Main.fs', 'Program.vb', 'Service.cs'])(
    'treats a lone %s source file as not empty',
    async (sourceFile) => {
      await fs.writeFile(path.join(root, sourceFile), '', 'utf-8');
      const { service } = buildService(root);
      expect(await service.isWorkspaceEffectivelyEmpty()).toBe(false);
    },
  );
});

describe('HarnessWorkspaceContextService.resolveWorkspaceContext', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-context-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reports no workspace when none is open', async () => {
    const { service } = buildService(undefined);
    expect(await service.resolveWorkspaceContext()).toEqual({
      projectName: 'No workspace',
      projectType: 'unknown',
      frameworks: [],
      languages: [],
    });
  });

  // The regression bar: a TypeScript workspace must resolve exactly as it did
  // before the registry existed.
  it('reports TypeScript plus frameworks for a Node workspace', async () => {
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        dependencies: { '@angular/core': '21.0.0', '@nestjs/core': '11.0.0' },
      }),
      'utf-8',
    );
    const { service } = buildService(root);
    const context = await service.resolveWorkspaceContext();

    expect(context.languages).toEqual(['TypeScript']);
    expect(context.frameworks).toEqual(['Angular', 'NestJS']);
    expect(context.projectType).toBe('angular');
    expect(context.projectName).toBe(path.basename(root));
  });

  it('reports nx-monorepo for an Nx workspace', async () => {
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ devDependencies: { nx: '22.6.5' } }),
      'utf-8',
    );
    const { service } = buildService(root);
    expect((await service.resolveWorkspaceContext()).projectType).toBe(
      'nx-monorepo',
    );
  });

  // A package.json that exists but does not parse has never counted as a
  // TypeScript workspace. Pinned so the registry rewire cannot quietly change
  // it by matching on mere file presence.
  it('does not claim TypeScript for an unparseable package.json', async () => {
    await fs.writeFile(path.join(root, 'package.json'), '{ nope', 'utf-8');
    const { service } = buildService(root);
    const context = await service.resolveWorkspaceContext();

    expect(context.languages).toEqual([]);
    expect(context.projectType).toBe('workspace');
  });

  // TASK_2026_270: the other bug. This rendered `Languages: (none detected)`
  // into the agent prompt for every .NET repo.
  it('reports .NET for a solution-only workspace', async () => {
    await fs.writeFile(path.join(root, 'MyApp.sln'), '', 'utf-8');
    await fs.writeFile(path.join(root, 'MyApp.csproj'), '<Project />', 'utf-8');
    const { service } = buildService(root);
    expect((await service.resolveWorkspaceContext()).languages).toEqual([
      '.NET',
    ]);
  });

  it('reports Python for a uv workspace, not just requirements.txt', async () => {
    await fs.writeFile(path.join(root, 'pyproject.toml'), '', 'utf-8');
    await fs.writeFile(path.join(root, 'uv.lock'), '', 'utf-8');
    const { service } = buildService(root);
    expect((await service.resolveWorkspaceContext()).languages).toEqual([
      'Python',
    ]);
  });

  it('reports every language present, in registry order', async () => {
    await fs.writeFile(path.join(root, 'package.json'), '{}', 'utf-8');
    await fs.writeFile(path.join(root, 'Api.csproj'), '<Project />', 'utf-8');
    await fs.writeFile(path.join(root, 'requirements.txt'), '', 'utf-8');
    await fs.writeFile(path.join(root, 'go.mod'), 'module x', 'utf-8');
    await fs.writeFile(path.join(root, 'Cargo.toml'), '', 'utf-8');
    const { service } = buildService(root);

    expect((await service.resolveWorkspaceContext()).languages).toEqual([
      'TypeScript',
      '.NET',
      'Python',
      'Go',
      'Rust',
    ]);
  });

  it('detects nothing in an empty workspace', async () => {
    const { service } = buildService(root);
    const context = await service.resolveWorkspaceContext();
    expect(context.languages).toEqual([]);
    expect(context.frameworks).toEqual([]);
  });
});
