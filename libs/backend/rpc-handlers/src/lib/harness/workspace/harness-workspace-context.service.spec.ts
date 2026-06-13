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
});
